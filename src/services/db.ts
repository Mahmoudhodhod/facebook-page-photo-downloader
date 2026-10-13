import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { PhotoItem, AlbumInfo, ActivityLogItem, AppSettings } from '../types';

interface FbDownloaderDB extends DBSchema {
  photos: {
    key: string;
    value: PhotoItem;
    indexes: {
      'by-status': string;
      'by-album': string;
      'by-discovered': number;
    };
  };
  albums: {
    key: string;
    value: AlbumInfo;
  };
  handles: {
    key: string;
    value: {
      key: string;
      handle: FileSystemDirectoryHandle;
      name: string;
      savedAt: number;
    };
  };
  logs: {
    key: string;
    value: ActivityLogItem;
    indexes: {
      'by-timestamp': number;
    };
  };
  settings: {
    key: string;
    value: AppSettings;
  };
}

const DB_NAME = 'fb_page_photo_downloader_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FbDownloaderDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FbDownloaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FbDownloaderDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Photos store
        if (!db.objectStoreNames.contains('photos')) {
          const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
          photoStore.createIndex('by-status', 'status');
          photoStore.createIndex('by-album', 'albumId');
          photoStore.createIndex('by-discovered', 'discoveredAt');
        }

        // Albums store
        if (!db.objectStoreNames.contains('albums')) {
          db.createObjectStore('albums', { keyPath: 'id' });
        }

        // Directory handles store
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'key' });
        }

        // Logs store
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id' });
          logStore.createIndex('by-timestamp', 'timestamp');
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

// Photo Operations
export async function savePhotos(photos: PhotoItem[]): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('photos', 'readwrite');
  let newPhotosCount = 0;

  for (const photo of photos) {
    const existing = await tx.store.get(photo.id);
    if (!existing) {
      await tx.store.add(photo);
      newPhotosCount++;
    } else {
      // If existing but higher resolution URL was discovered, update URL
      if (existing.status === 'discovered' && photo.url && photo.url !== existing.url) {
        await tx.store.put({ ...existing, url: photo.url, width: photo.width || existing.width, height: photo.height || existing.height });
      }
    }
  }

  await tx.done;
  return newPhotosCount;
}

export async function updatePhoto(photo: PhotoItem): Promise<void> {
  const db = await getDB();
  await db.put('photos', photo);
}

export async function togglePhotoExcluded(photoId: string): Promise<boolean> {
  const db = await getDB();
  const photo = await db.get('photos', photoId);
  if (!photo) return false;
  photo.excluded = !photo.excluded;
  await db.put('photos', photo);
  return photo.excluded;
}

export async function setPhotosExcluded(photoIds: string[], excluded: boolean): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('photos', 'readwrite');
  for (const id of photoIds) {
    const photo = await tx.store.get(id);
    if (photo) {
      photo.excluded = excluded;
      await tx.store.put(photo);
    }
  }
  await tx.done;
}

export async function getAllPhotos(): Promise<PhotoItem[]> {
  const db = await getDB();
  return db.getAll('photos');
}

export async function getPhotosByStatus(status: PhotoItem['status']): Promise<PhotoItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('photos', 'by-status', status);
}

export async function clearAllPhotos(): Promise<void> {
  const db = await getDB();
  await db.clear('photos');
}

// Album Operations
export async function saveAlbums(albums: AlbumInfo[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('albums', 'readwrite');
  for (const album of albums) {
    await tx.store.put(album);
  }
  await tx.done;
}

export async function getAllAlbums(): Promise<AlbumInfo[]> {
  const db = await getDB();
  return db.getAll('albums');
}

// Directory Handle Operations
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDB();
  await db.put('handles', {
    key: 'chosenDirectory',
    handle,
    name: handle.name,
    savedAt: Date.now(),
  });
}

export async function getSavedDirectoryHandle(): Promise<{ handle: FileSystemDirectoryHandle; name: string } | null> {
  try {
    const db = await getDB();
    const item = await db.get('handles', 'chosenDirectory');
    if (item && item.handle) {
      return { handle: item.handle, name: item.name };
    }
  } catch (err) {
    console.warn('Could not retrieve directory handle from IndexedDB:', err);
  }
  return null;
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await getDB();
  await db.delete('handles', 'chosenDirectory');
}

// Logs Operations
export async function addLog(level: ActivityLogItem['level'], message: string, details?: string): Promise<ActivityLogItem> {
  const logItem: ActivityLogItem = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    level,
    message,
    details,
  };
  try {
    const db = await getDB();
    await db.put('logs', logItem);
  } catch (e) {
    console.error('Failed to save log to DB', e);
  }
  return logItem;
}

export async function getRecentLogs(limit = 100): Promise<ActivityLogItem[]> {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('logs', 'by-timestamp');
    return all.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

export async function clearLogs(): Promise<void> {
  const db = await getDB();
  await db.clear('logs');
}

// Settings Operations
const DEFAULT_SETTINGS: AppSettings = {
  concurrency: 2,
  skipExisting: true,
  createAlbumFolders: true,
  arabicLanguage: true,
  theme: 'dark',
  hasDirectoryPermission: false,
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const db = await getDB();
    const saved = await db.get('settings', 'app_settings');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const db = await getDB();
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await db.put('settings', updated, 'app_settings');
  return updated;
}
