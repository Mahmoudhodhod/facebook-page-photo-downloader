import { PhotoItem, ScanOptions, ScanState, FacebookPageInfo } from '../types';
import { extractCandidateFromElement, generatePhotoId } from './resolution-picker';
import { detectFacebookPage } from './page-detector';
import { harvestPageScriptPhotos } from '../services/full-res-resolver';

export class FacebookScanner {
  private state: ScanState = 'idle';
  private options: ScanOptions = {
    scope: 'all',
    highestResolution: true,
    organizeByAlbums: true,
    includeCoverAndProfile: false,
    selectedAlbumIds: [],
  };
  private discoveredMap: Map<string, PhotoItem> = new Map();
  private scriptPhotosCache: Map<string, any> = new Map();
  private consecutiveEmptyScrolls = 0;
  private maxConsecutiveEmptyScrolls = 5;
  private isScanningLoopActive = false;
  private pageInfo: FacebookPageInfo | null = null;
  private onPhotosBatch: (photos: PhotoItem[], pageInfo: FacebookPageInfo) => void;
  private onStatusChange: (state: ScanState, message?: string) => void;

  constructor(
    onPhotosBatch: (photos: PhotoItem[], pageInfo: FacebookPageInfo) => void,
    onStatusChange: (state: ScanState, message?: string) => void
  ) {
    this.onPhotosBatch = onPhotosBatch;
    this.onStatusChange = onStatusChange;
  }

  public getState(): ScanState {
    return this.state;
  }

  public getDiscoveredCount(): number {
    return this.discoveredMap.size;
  }

  public async start(options?: Partial<ScanOptions>): Promise<void> {
    if (this.state === 'scanning') return;

    if (options) {
      this.options = { ...this.options, ...options };
    }

    this.state = 'scanning';
    this.consecutiveEmptyScrolls = 0;
    this.pageInfo = detectFacebookPage();
    this.onStatusChange('scanning', 'جاري فحص صور الصفحة والتمرير التلقائي...');

    // Run first discovery pass on current visible view
    await this.scanVisibleDOM();

    // Start infinite scroll discovery loop
    this.runScrollLoop();
  }

  public pause(): void {
    if (this.state !== 'scanning') return;
    this.state = 'paused';
    this.onStatusChange('paused', 'تم إيقاف الفحص مؤقتاً.');
  }

  public resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'scanning';
    this.onStatusChange('scanning', 'استكمال الفحص...');
    this.runScrollLoop();
  }

  public stop(): void {
    this.state = 'stopped';
    this.onStatusChange('stopped', 'تم إنهاء الفحص.');
  }

  /**
   * Scans visible DOM using multi-strategy fallback selectors.
   */
  private async scanVisibleDOM(): Promise<number> {
    const candidates: PhotoItem[] = [];

    // Modular Selector Strategies
    const selectorStrategies = [
      // 1. Photos Grid / Media Tab items
      'div[role="main"] a[href*="/photo"] img',
      'div[role="main"] a[href*="/photos"] img',
      'div[data-pagelet*="ProfileTilesFeed"] img',
      'div[data-pagelet*="ProfileAppSection"] img',
      // 2. Timeline Post Photos / Multi-image Collages
      'div[role="feed"] div[role="article"] img',
      'div[role="article"] a[href*="/photo"] img',
      'div[data-ad-preview="message"] ~ div img',
      // 3. Lightbox / Modal Image viewer if open
      'div[role="dialog"] img[data-visualcompletion="media-vc-image"]',
      'div[role="dialog"] img[src*="fbcdn.net"]',
      // 4. General fallback within main content
      'div[role="main"] img[src*="fbcdn.net"]',
    ];

    const queriedElements = new Set<HTMLImageElement>();

    for (const strategy of selectorStrategies) {
      try {
        const elements = document.querySelectorAll<HTMLImageElement>(strategy);
        elements.forEach((el) => queriedElements.add(el));
      } catch {
        // Strategy failed, continue to next
      }
    }

    const defaultAlbum = this.pageInfo?.activeAlbumName || (this.pageInfo?.pageType === 'page_photos' ? 'Page Photos' : 'Timeline Photos');

    // Harvest embedded Facebook JSON scripts for full resolution photos
    const freshScriptPhotos = harvestPageScriptPhotos();
    freshScriptPhotos.forEach((v, k) => this.scriptPhotosCache.set(k, v));

    for (const img of queriedElements) {
      const candidate = extractCandidateFromElement(img);
      if (!candidate) continue;

      let resolvedUrl = candidate.url;
      let resolvedWidth = candidate.width;
      let resolvedHeight = candidate.height;

      if (candidate.fbid && this.scriptPhotosCache.has(candidate.fbid)) {
        const fullRes = this.scriptPhotosCache.get(candidate.fbid);
        if (fullRes && fullRes.url) {
          resolvedUrl = fullRes.url;
          resolvedWidth = fullRes.width || resolvedWidth;
          resolvedHeight = fullRes.height || resolvedHeight;
        }
      }

      const photoId = generatePhotoId(candidate);
      if (this.discoveredMap.has(photoId)) {
        // If discovered earlier with lower res, upgrade it!
        const existing = this.discoveredMap.get(photoId)!;
        if (resolvedWidth && (!existing.width || resolvedWidth > existing.width)) {
          existing.url = resolvedUrl;
          existing.width = resolvedWidth;
          existing.height = resolvedHeight;
        }
        continue;
      }

      const photoItem: PhotoItem = {
        id: photoId,
        url: resolvedUrl,
        thumbnailUrl: img.src || candidate.url,
        width: resolvedWidth,
        height: resolvedHeight,
        fbid: candidate.fbid,
        albumName: candidate.albumName || defaultAlbum,
        caption: candidate.caption,
        postUrl: candidate.postUrl,
        discoveredAt: Date.now(),
        status: 'discovered',
        retryCount: 0,
      };

      this.discoveredMap.set(photoId, photoItem);
      candidates.push(photoItem);

      // Check maxPhotos limit
      if (this.options.maxPhotos && this.discoveredMap.size >= this.options.maxPhotos) {
        break;
      }
    }

    if (candidates.length > 0 && this.pageInfo) {
      this.onPhotosBatch(candidates, this.pageInfo);
    }

    return candidates.length;
  }

  /**
   * Infinite scrolling engine with idle & bottom detection.
   */
  private async runScrollLoop(): Promise<void> {
    if (this.isScanningLoopActive) return;
    this.isScanningLoopActive = true;

    try {
      while (this.state === 'scanning') {
        // Check if max photos reached
        if (this.options.maxPhotos && this.discoveredMap.size >= this.options.maxPhotos) {
          this.state = 'completed';
          this.onStatusChange('completed', `تم الوصول إلى الحد الأقصى المطلوب (${this.discoveredMap.size} صورة).`);
          break;
        }

        const previousHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        const previousScrollY = window.scrollY;

        // Perform smooth scroll downwards with small organic variation
        const scrollDistance = 750 + Math.floor(Math.random() * 250);
        window.scrollBy({
          top: scrollDistance,
          behavior: 'smooth',
        });

        // Wait for Facebook dynamic rendering & network lazy load
        await new Promise((resolve) => setTimeout(resolve, 1200 + Math.random() * 400));

        // Scan newly visible DOM
        const newFound = await this.scanVisibleDOM();

        const currentHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        const currentScrollY = window.scrollY;

        if (newFound === 0) {
          // Check if height actually didn't expand or scroll didn't move
          if (currentScrollY === previousScrollY && currentHeight === previousHeight) {
            this.consecutiveEmptyScrolls++;
          } else {
            this.consecutiveEmptyScrolls++;
          }

          // If reached maximum consecutive empty attempts, verify if bottom reached
          if (this.consecutiveEmptyScrolls >= this.maxConsecutiveEmptyScrolls) {
            // Attempt one final scroll to absolute bottom to trigger any final lazy loaders
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const finalFound = await this.scanVisibleDOM();

            if (finalFound === 0) {
              this.state = 'completed';
              this.onStatusChange(
                'completed',
                `اكتمل فحص صور الصفحة بنجاح! تم اكتشاف إجمالي ${this.discoveredMap.size} صورة.`
              );
              break;
            } else {
              this.consecutiveEmptyScrolls = 0;
            }
          }
        } else {
          this.consecutiveEmptyScrolls = 0;
        }
      }
    } finally {
      this.isScanningLoopActive = false;
    }
  }
}
