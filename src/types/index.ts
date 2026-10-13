export type PhotoStatus = 'discovered' | 'pending' | 'downloading' | 'completed' | 'failed' | 'skipped';

export interface PhotoItem {
  id: string; // Stable unique ID (fbid or normalized hash)
  url: string; // Highest resolution URL
  thumbnailUrl?: string; // Preview URL
  width?: number;
  height?: number;
  fbid?: string;
  albumName?: string;
  albumId?: string;
  caption?: string;
  postUrl?: string;
  discoveredAt: number;
  status: PhotoStatus;
  downloadedAt?: number;
  fileSize?: number;
  fileName?: string;
  filePath?: string;
  error?: string;
  retryCount: number;
  excluded?: boolean; // When true, excluded from downloading
}

export interface AlbumInfo {
  id: string;
  name: string;
  url: string;
  photoCount?: number;
  coverPhotoUrl?: string;
  selected: boolean;
}

export interface FacebookPageInfo {
  url: string;
  pageName: string;
  pageId?: string;
  pageType: 'page_home' | 'page_photos' | 'page_albums' | 'single_album' | 'timeline' | 'unknown';
  activeAlbumName?: string;
}

export interface ScanOptions {
  scope: 'all' | 'albums_only' | 'timeline_only' | 'selected_albums';
  highestResolution: boolean;
  organizeByAlbums: boolean;
  maxPhotos?: number; // 0 for unlimited
  includeCoverAndProfile: boolean;
  selectedAlbumIds: string[];
}

export interface DownloadStats {
  totalDiscovered: number;
  completed: number;
  pending: number;
  downloading: number;
  failed: number;
  skipped: number;
  excluded: number;
  progressPercent: number;
  bytesDownloaded: number;
  startTime?: number;
  elapsedTime?: number;
}

export type ScanState = 'idle' | 'scanning' | 'paused' | 'completed' | 'stopped';
export type DownloadState = 'idle' | 'downloading' | 'paused' | 'completed' | 'cancelled';

export interface ActivityLogItem {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  details?: string;
}

export interface AppSettings {
  concurrency: number; // 1 to 3
  skipExisting: boolean;
  createAlbumFolders: boolean;
  arabicLanguage: boolean;
  theme: 'dark' | 'light';
  savedFolderName?: string;
  hasDirectoryPermission: boolean;
}

// Chrome runtime message contracts
export type ExtensionMessage =
  | { type: 'DETECT_PAGE' }
  | { type: 'PAGE_DETECTED'; payload: FacebookPageInfo }
  | { type: 'START_SCAN'; options: ScanOptions }
  | { type: 'PAUSE_SCAN' }
  | { type: 'RESUME_SCAN' }
  | { type: 'STOP_SCAN' }
  | { type: 'PHOTOS_DISCOVERED'; payload: { photos: PhotoItem[]; pageInfo?: FacebookPageInfo } }
  | { type: 'SCAN_STATUS_CHANGED'; state: ScanState; message?: string }
  | { type: 'OPEN_DASHBOARD' }
  | { type: 'SYNC_STATE_REQUEST' }
  | { type: 'SYNC_STATE_RESPONSE'; payload: { scanState: ScanState; downloadState: DownloadState; stats: DownloadStats } };
