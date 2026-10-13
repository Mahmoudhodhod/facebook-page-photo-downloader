import { PhotoItem, DownloadStats, DownloadState, AppSettings } from '../types';
import {
  getAllPhotos,
  updatePhoto,
  addLog,
  getSettings,
  getPhotosByStatus,
} from './db';
import {
  getActiveDirectoryHandle,
  saveImageToFileSystem,
  saveImageViaChromeDownloads,
  SaveFileResult,
} from './file-system';
import { resolveFullResolutionPhoto, isThumbnailUrl } from './full-res-resolver';

export type DownloadListener = (stats: DownloadStats) => void;
export type PhotoUpdateListener = (photo: PhotoItem) => void;

class DownloadManager {
  private state: DownloadState = 'idle';
  private concurrency = 2;
  private activeWorkers = 0;
  private abortController: AbortController | null = null;
  private queue: PhotoItem[] = [];
  private statsListeners: Set<DownloadListener> = new Set();
  private photoListeners: Set<PhotoUpdateListener> = new Set();
  private currentStats: DownloadStats = {
    totalDiscovered: 0,
    completed: 0,
    pending: 0,
    downloading: 0,
    failed: 0,
    skipped: 0,
    excluded: 0,
    progressPercent: 0,
    bytesDownloaded: 0,
  };

  constructor() {
    this.refreshStats();
  }

  public getState(): DownloadState {
    return this.state;
  }

  public getStats(): DownloadStats {
    return { ...this.currentStats };
  }

  public subscribeStats(listener: DownloadListener): () => void {
    this.statsListeners.add(listener);
    listener(this.getStats());
    return () => this.statsListeners.delete(listener);
  }

  public subscribePhotoUpdates(listener: PhotoUpdateListener): () => void {
    this.photoListeners.add(listener);
    return () => this.photoListeners.delete(listener);
  }

  private notifyStats() {
    const stats = this.getStats();
    for (const listener of this.statsListeners) {
      listener(stats);
    }
  }

  private notifyPhoto(photo: PhotoItem) {
    for (const listener of this.photoListeners) {
      listener(photo);
    }
  }

  public async refreshStats(): Promise<DownloadStats> {
    const photos = await getAllPhotos();
    let completed = 0;
    let pending = 0;
    let downloading = 0;
    let failed = 0;
    let skipped = 0;
    let excluded = 0;
    let bytesDownloaded = 0;

    for (const p of photos) {
      if (p.excluded) {
        excluded++;
      }
      if (p.status === 'completed') {
        completed++;
        bytesDownloaded += p.fileSize || 0;
      } else if (p.status === 'pending' || p.status === 'discovered') {
        if (!p.excluded) {
          pending++;
        }
      } else if (p.status === 'downloading') {
        downloading++;
      } else if (p.status === 'failed') {
        failed++;
      } else if (p.status === 'skipped') {
        skipped++;
      }
    }

    const total = photos.length;
    const activeTotal = total - excluded;
    const finishedCount = completed + skipped;
    const progressPercent = activeTotal > 0 ? Math.round((finishedCount / activeTotal) * 100) : 0;

    this.currentStats = {
      totalDiscovered: total,
      completed,
      pending,
      downloading,
      failed,
      skipped,
      excluded,
      progressPercent,
      bytesDownloaded,
      startTime: this.currentStats.startTime,
    };

    this.notifyStats();
    return this.currentStats;
  }

  /**
   * Start or resume downloading all pending photos (ignoring excluded ones).
   */
  public async startDownload(): Promise<void> {
    if (this.state === 'downloading') return;

    const settings = await getSettings();
    this.concurrency = Math.min(Math.max(settings.concurrency || 2, 1), 3);

    // Get active directory handle
    const dirInfo = await getActiveDirectoryHandle();
    if (!dirInfo || !dirInfo.hasPermission) {
      await addLog('warn', 'لم يتم اختيار مجلد حفظ أو انتهت صلاحية الوصول. يرجى اختيار مجلد الحفظ أولاً.');
      throw new Error('NO_DIRECTORY_SELECTED');
    }

    const photos = await getAllPhotos();
    const toDownload = photos.filter(
      (p) => !p.excluded && (p.status === 'discovered' || p.status === 'pending' || p.status === 'downloading')
    );

    if (toDownload.length === 0) {
      await addLog('info', 'لا توجد صور مجهزة للتحميل (تحقق من عدم استبعاد جميع الصور).');
      return;
    }

    this.state = 'downloading';
    this.abortController = new AbortController();
    this.queue = [...toDownload];
    this.currentStats.startTime = Date.now();

    await addLog(
      'info',
      `بدء عملية التحميل: ${toDownload.length} صورة مجهزة للتحميل (تزامن: ${this.concurrency})`,
      `المجلد: ${dirInfo.name}`
    );

    this.spawnWorkers(dirInfo.handle, settings);
  }

  /**
   * Pause current downloading process.
   */
  public async pause(): Promise<void> {
    if (this.state !== 'downloading') return;

    this.state = 'paused';
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    await addLog('warn', 'تم إيقاف التحميل مؤقتاً بواسطة المستخدم.');
    await this.refreshStats();
  }

  /**
   * Resume downloading after pause.
   */
  public async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await addLog('info', 'استكمال التحميل...');
    await this.startDownload();
  }

  /**
   * Cancel downloads and reset active items to pending.
   */
  public async cancel(): Promise<void> {
    this.state = 'cancelled';
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.queue = [];

    // Reset currently downloading items back to pending
    const downloadingPhotos = await getPhotosByStatus('downloading');
    for (const p of downloadingPhotos) {
      p.status = 'pending';
      await updatePhoto(p);
    }

    await addLog('warn', 'تم إلغاء عملية التحميل.');
    this.state = 'idle';
    await this.refreshStats();
  }

  /**
   * Retry all previously failed photos.
   */
  public async retryFailed(): Promise<void> {
    const failedPhotos = await getPhotosByStatus('failed');
    if (failedPhotos.length === 0) {
      await addLog('info', 'لا توجد صور فاشلة لإعادة المحاولة.');
      return;
    }

    for (const p of failedPhotos) {
      p.status = 'pending';
      p.error = undefined;
      p.retryCount = 0;
      await updatePhoto(p);
    }

    await addLog('info', `إعادة محاولة تحميل ${failedPhotos.length} صورة فاشلة.`);
    await this.refreshStats();
    await this.startDownload();
  }

  private spawnWorkers(dirHandle: FileSystemDirectoryHandle, settings: AppSettings) {
    const needed = this.concurrency - this.activeWorkers;
    for (let i = 0; i < needed; i++) {
      this.activeWorkers++;
      this.processQueue(dirHandle, settings).finally(() => {
        this.activeWorkers--;
        if (this.activeWorkers === 0 && this.queue.length === 0 && this.state === 'downloading') {
          this.state = 'completed';
          addLog('success', 'اكتمل التحميل بنجاح لجميع الصور المكتشفة!');
          this.refreshStats();
        }
      });
    }
  }

  private async processQueue(
    dirHandle: FileSystemDirectoryHandle,
    settings: AppSettings
  ): Promise<void> {
    while (this.queue.length > 0 && this.state === 'downloading') {
      const photo = this.queue.shift();
      if (!photo) break;

      photo.status = 'downloading';
      await updatePhoto(photo);
      this.notifyPhoto(photo);
      await this.refreshStats();

      try {
        const result = await this.downloadWithRetry(photo, dirHandle, settings);
        if (result.skipped) {
          photo.status = 'skipped';
          photo.fileName = result.fileName;
          photo.filePath = result.filePath;
          await updatePhoto(photo);
          await addLog('info', `تخطي صورة موجودة مسبقاً: ${result.fileName}`);
        } else {
          photo.status = 'completed';
          photo.downloadedAt = Date.now();
          photo.fileName = result.fileName;
          photo.filePath = result.filePath;
          await updatePhoto(photo);
          await addLog('success', `تم تحميل الصورة: ${result.fileName}`);
        }
      } catch (err: any) {
        if ((this.state as string) === 'paused' || (this.state as string) === 'cancelled' || this.abortController?.signal.aborted) {
          // If aborted, set back to pending
          photo.status = 'pending';
          await updatePhoto(photo);
          break;
        }

        photo.status = 'failed';
        photo.error = err.message || 'Unknown network error';
        await updatePhoto(photo);
        await addLog('error', `فشل تحميل الصورة [ID: ${photo.id}]: ${photo.error}`);
      }

      this.notifyPhoto(photo);
      await this.refreshStats();

      // Micro-pause between downloads to respect network etiquette
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /**
   * Fetch image with exponential backoff on transient errors.
   */
  private async downloadWithRetry(
    photo: PhotoItem,
    dirHandle: FileSystemDirectoryHandle,
    settings: AppSettings
  ): Promise<SaveFileResult> {
    const MAX_RETRIES = 3;
    let lastError: any = null;

    // Automatically resolve true full-size image from Facebook if photo is a thumbnail/preview
    const isPreviewOrCropped = !photo.width || photo.width < 1200 || isThumbnailUrl(photo.url);
    if (isPreviewOrCropped && (photo.fbid || photo.postUrl)) {
      try {
        const fullRes = await resolveFullResolutionPhoto(
          photo.fbid,
          photo.url,
          photo.postUrl,
          this.abortController?.signal
        );
        if (fullRes && fullRes.url) {
          photo.url = fullRes.url;
          photo.width = fullRes.width || photo.width;
          photo.height = fullRes.height || photo.height;
          await updatePhoto(photo);
          await addLog('info', `تم جلب الحجم الكامل الأصلي للصورة [ID: ${photo.id}] (${photo.width || 'Full'} px)`);
        }
      } catch {
        // Fall back to candidate URL if deep fetch cannot resolve
      }
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('ABORTED');
      }

      try {
        const response = await fetch(photo.url, {
          signal: this.abortController?.signal,
          headers: {
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        photo.fileSize = blob.size;

        // Build a readable base name: page or album + fbid or timestamp
        const albumClean = photo.albumName ? photo.albumName.replace(/\s+/g, '_') : 'photo';
        const idClean = photo.fbid || photo.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const baseName = `${albumClean}_${idClean}`;

        // Save via File System Access API
        return await saveImageToFileSystem({
          dirHandle,
          blob,
          baseName,
          albumName: photo.albumName,
          createAlbumFolder: settings.createAlbumFolders,
          skipExisting: settings.skipExisting,
          url: photo.url,
        });
      } catch (err: any) {
        lastError = err;
        photo.retryCount = attempt + 1;

        if (this.abortController?.signal.aborted) {
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 500ms, 1000ms, 2000ms + jitter
          const delay = 500 * Math.pow(2, attempt) + Math.random() * 300;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}

export const downloadManager = new DownloadManager();
