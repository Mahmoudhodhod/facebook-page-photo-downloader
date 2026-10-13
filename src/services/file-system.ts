import { saveDirectoryHandle, getSavedDirectoryHandle } from './db';

export interface SaveFileResult {
  success: boolean;
  filePath: string;
  fileName: string;
  skipped: boolean;
  error?: string;
}

/**
 * Sanitize folder and file names across Mac, Windows, Linux.
 */
export function sanitizeName(name: string): string {
  if (!name) return 'Untitled';
  // Remove dangerous path characters and control characters
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  // Avoid Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) {
    clean = `${clean}_file`;
  }
  // Trim excessive length
  if (clean.length > 100) {
    clean = clean.substring(0, 100).trim();
  }
  return clean || 'Untitled';
}

/**
 * Open the native File System Directory Picker (must be triggered by user gesture).
 */
export async function pickDownloadDirectory(): Promise<{ handle: FileSystemDirectoryHandle; name: string }> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('FILE_SYSTEM_API_NOT_SUPPORTED');
  }

  try {
    const handle = await (window as any).showDirectoryPicker({
      id: 'fb-page-photo-downloader-dest',
      mode: 'readwrite',
      startIn: 'downloads',
    });

    await saveDirectoryHandle(handle);
    return { handle, name: handle.name };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('USER_CANCELLED');
    }
    throw err;
  }
}

/**
 * Verify or re-request permission for a persisted DirectoryHandle.
 */
export async function verifyDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  readWrite = true
): Promise<boolean> {
  const options: any = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }

  try {
    if ((await (handle as any).queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await (handle as any).requestPermission(options)) === 'granted') {
      return true;
    }
  } catch (err) {
    console.warn('Error checking/requesting directory permission:', err);
  }
  return false;
}

/**
 * Retrieve directory handle from IndexedDB and verify permission.
 */
export async function getActiveDirectoryHandle(): Promise<{
  handle: FileSystemDirectoryHandle;
  name: string;
  hasPermission: boolean;
} | null> {
  const saved = await getSavedDirectoryHandle();
  if (!saved) return null;

  try {
    const hasPermission = await verifyDirectoryPermission(saved.handle, true);
    return {
      handle: saved.handle,
      name: saved.name,
      hasPermission,
    };
  } catch {
    return {
      handle: saved.handle,
      name: saved.name,
      hasPermission: false,
    };
  }
}

/**
 * Get or create a subfolder within a parent directory.
 */
export async function getOrCreateSubfolder(
  parentHandle: FileSystemDirectoryHandle,
  subfolderName: string
): Promise<FileSystemDirectoryHandle> {
  const cleanName = sanitizeName(subfolderName);
  return await parentHandle.getDirectoryHandle(cleanName, { create: true });
}

/**
 * Determine suitable file extension based on MIME type or URL.
 */
export function getExtensionFromBlob(blob: Blob, fallbackUrl = ''): string {
  const mime = blob.type.toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('avif')) return 'avif';

  // Fallback to URL extension
  try {
    const urlObj = new URL(fallbackUrl);
    const pathname = urlObj.pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'jpg';
    if (pathname.endsWith('.png')) return 'png';
    if (pathname.endsWith('.webp')) return 'webp';
  } catch {
    // Ignore invalid url
  }
  return 'jpg';
}

/**
 * Check if a file already exists in a directory handle.
 */
export async function fileExistsInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<boolean> {
  try {
    await dirHandle.getFileHandle(fileName, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Save an image directly to the chosen directory via File System Access API.
 */
export async function saveImageToFileSystem(params: {
  dirHandle: FileSystemDirectoryHandle;
  blob: Blob;
  baseName: string;
  albumName?: string;
  createAlbumFolder: boolean;
  skipExisting: boolean;
  url: string;
}): Promise<SaveFileResult> {
  const { dirHandle, blob, baseName, albumName, createAlbumFolder, skipExisting, url } = params;

  let targetDir = dirHandle;
  let folderPath = '';

  if (createAlbumFolder && albumName && albumName.trim().length > 0) {
    const cleanAlbum = sanitizeName(albumName);
    targetDir = await getOrCreateSubfolder(dirHandle, cleanAlbum);
    folderPath = `${cleanAlbum}/`;
  }

  const ext = getExtensionFromBlob(blob, url);
  const cleanBase = sanitizeName(baseName);
  let fileName = `${cleanBase}.${ext}`;

  // Check if file exists
  const alreadyExists = await fileExistsInDirectory(targetDir, fileName);

  if (alreadyExists) {
    if (skipExisting) {
      return {
        success: true,
        filePath: `${folderPath}${fileName}`,
        fileName,
        skipped: true,
      };
    }

    // Generate unique numbered filename to prevent accidental overwrite
    let counter = 1;
    let uniqueName = `${cleanBase}_${counter}.${ext}`;
    while (await fileExistsInDirectory(targetDir, uniqueName)) {
      counter++;
      uniqueName = `${cleanBase}_${counter}.${ext}`;
    }
    fileName = uniqueName;
  }

  // Write file
  try {
    const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(blob);
    await writable.close();

    return {
      success: true,
      filePath: `${folderPath}${fileName}`,
      fileName,
      skipped: false,
    };
  } catch (err: any) {
    return {
      success: false,
      filePath: `${folderPath}${fileName}`,
      fileName,
      skipped: false,
      error: err.message || 'Error writing file to disk',
    };
  }
}

/**
 * Fallback download via chrome.downloads API into user's default Downloads directory.
 */
export async function saveImageViaChromeDownloads(params: {
  blob: Blob;
  baseName: string;
  albumName?: string;
  createAlbumFolder: boolean;
  url: string;
}): Promise<SaveFileResult> {
  const { blob, baseName, albumName, createAlbumFolder, url } = params;
  const ext = getExtensionFromBlob(blob, url);
  const cleanBase = sanitizeName(baseName);
  let folderPrefix = 'FB_Page_Photos/';

  if (createAlbumFolder && albumName && albumName.trim().length > 0) {
    folderPrefix += `${sanitizeName(albumName)}/`;
  }

  const fileName = `${cleanBase}.${ext}`;
  const targetPath = `${folderPrefix}${fileName}`;
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url: objectUrl,
        filename: targetPath,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      (downloadId: number | undefined) => {
        URL.revokeObjectURL(objectUrl);
        if (chrome.runtime.lastError || !downloadId) {
          resolve({
            success: false,
            filePath: targetPath,
            fileName,
            skipped: false,
            error: chrome.runtime.lastError?.message || 'Download failed',
          });
        } else {
          resolve({
            success: true,
            filePath: targetPath,
            fileName,
            skipped: false,
          });
        }
      }
    );
  });
}
