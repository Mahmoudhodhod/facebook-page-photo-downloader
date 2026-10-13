import { PhotoItem } from '../types';

export interface ExtractedImageCandidate {
  url: string;
  width?: number;
  height?: number;
  fbid?: string;
  albumName?: string;
  caption?: string;
  postUrl?: string;
}

/**
 * Parses Facebook srcset string to locate the candidate with the highest width descriptor.
 */
export function getHighestResFromSrcset(srcset: string): { url: string; width: number } | null {
  if (!srcset || typeof srcset !== 'string') return null;

  try {
    const candidates = srcset
      .split(',')
      .map((entry) => {
        const trimmed = entry.trim();
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) return null;
        const url = parts[0];
        const widthDescriptor = parts[1];
        const width = parseInt(widthDescriptor.replace(/[^0-9]/g, ''), 10);
        return isNaN(width) ? null : { url, width };
      })
      .filter((c): c is { url: string; width: number } => c !== null);

    if (candidates.length === 0) return null;

    // Sort descending by width
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0];
  } catch {
    return null;
  }
}

/**
 * Extracts Facebook Photo ID (fbid) from photo URLs or parent anchor links.
 */
export function extractFbid(hrefOrSrc: string): string | undefined {
  if (!hrefOrSrc) return undefined;

  try {
    // 1. Check URL query params: fbid= or story_fbid=
    const fbidMatch = hrefOrSrc.match(/[?&](?:story_)?fbid=([0-9]+)/i);
    if (fbidMatch && fbidMatch[1]) {
      return fbidMatch[1];
    }

    // 2. Check media/set/?set=a.123456
    const setMatch = hrefOrSrc.match(/[?&]set=[a-z]\.([0-9]+)/i);
    if (setMatch && setMatch[1]) {
      return setMatch[1];
    }

    // 3. Check photo path: /photo/?fbid= or /photos/.../123456789/
    const pathMatch = hrefOrSrc.match(/\/photos\/(?:[^/]+\/)?([0-9]{8,25})/i);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }

    // 4. Check post path: /posts/123456789
    const postMatch = hrefOrSrc.match(/\/posts\/([0-9]{8,25})/i);
    if (postMatch && postMatch[1]) {
      return postMatch[1];
    }

    // 5. Check CDN filename: numbers of 8-25 digits (e.g. 123456789_987654321_n.jpg or 111_222_333_n.jpg)
    const cleanUrl = hrefOrSrc.split('?')[0];
    const fileName = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
    const numbersInFile = fileName.match(/[0-9]{8,25}/g);
    if (numbersInFile && numbersInFile.length > 0) {
      // In 3-part filenames (uploadId_fbid_hash), the second number is often the fbid
      if (numbersInFile.length >= 2 && numbersInFile[1].length >= 10) {
        return numbersInFile[1];
      }
      return numbersInFile[0];
    }
  } catch {
    // Ignore extraction errors
  }
  return undefined;
}

/**
 * Checks if an image URL or element is a Facebook UI icon, emoji, reaction, or ad asset.
 */
export function isFacebookUiOrAdAsset(img: HTMLImageElement, src: string): boolean {
  if (!src) return true;

  const lowerSrc = src.toLowerCase();

  // Exclude static resources and icons
  if (
    lowerSrc.includes('/rsrc.php/') ||
    lowerSrc.includes('/emoji.php/') ||
    lowerSrc.includes('data:image/svg') ||
    lowerSrc.includes('data:image/gif') ||
    lowerSrc.includes('/assets/') ||
    lowerSrc.includes('spacer.gif') ||
    lowerSrc.includes('/speed_bracket/')
  ) {
    return true;
  }

  // Check element attributes and classes
  const alt = (img.getAttribute('alt') || '').toLowerCase();
  const ariaLabel = (img.getAttribute('aria-label') || '').toLowerCase();

  // Exclude reaction emojis (like, love, care, haha, wow, sad, angry) in English & Arabic
  const reactionKeywords = [
    'like', 'love', 'care', 'haha', 'wow', 'sad', 'angry',
    'إعجاب', 'أحببته', 'أدعمه', 'هاها', 'واو', 'أحزنني', 'أغضبني',
    'profile picture', 'صورة الملف الشخصي للمستخدم',
  ];

  if (reactionKeywords.some((k) => ariaLabel.includes(k) && !ariaLabel.includes('photo'))) {
    // If it's a small reaction sticker
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 80) {
      return true;
    }
  }

  // Check dimensions: exclude small icons, badges, and avatars (less than 100x100)
  const width = img.naturalWidth || img.width || img.clientWidth;
  const height = img.naturalHeight || img.height || img.clientHeight;

  if (width > 0 && height > 0 && (width < 100 || height < 100)) {
    // Small icon or avatar
    return true;
  }

  // Check parent container for reaction tray or comment box
  if (img.closest('[role="button"][aria-label*="Reaction"], [aria-label*="تفاعل"]')) {
    return true;
  }

  return false;
}

/**
 * Generates a stable unique ID for a photo to prevent duplicate collection.
 */
export function generatePhotoId(candidate: ExtractedImageCandidate): string {
  if (candidate.fbid) {
    return `fb_${candidate.fbid}`;
  }

  // Generate normalized hash from clean URL pathname
  try {
    const urlObj = new URL(candidate.url);
    // Strip dynamic ephemeral token params like oh, oe, _nc_ht
    const path = urlObj.pathname;
    return `hash_${hashString(path)}`;
  } catch {
    return `hash_${hashString(candidate.url)}`;
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extracts the best image URL and metadata from a Facebook DOM image element.
 */
export function extractCandidateFromElement(img: HTMLImageElement): ExtractedImageCandidate | null {
  const src = img.currentSrc || img.src;
  if (!src || isFacebookUiOrAdAsset(img, src)) {
    return null;
  }

  let finalUrl = src;
  let finalWidth = img.naturalWidth || img.width;
  let finalHeight = img.naturalHeight || img.height;

  // 1. Try to extract highest resolution from srcset
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const bestSrcset = getHighestResFromSrcset(srcset);
    if (bestSrcset && bestSrcset.url) {
      finalUrl = bestSrcset.url;
      finalWidth = bestSrcset.width;
    }
  }

  // 2. Check parent anchor tag for photo links or fbid
  const parentAnchor = img.closest('a') as HTMLAnchorElement | null;
  const href = parentAnchor ? parentAnchor.href : '';
  const fbid = extractFbid(href) || extractFbid(finalUrl);

  // 3. Check for caption / alt text
  const caption = img.getAttribute('alt') || parentAnchor?.getAttribute('aria-label') || undefined;

  // 4. Try to identify album context if available in container
  let albumName: string | undefined;
  const albumContainer = img.closest('[data-pagelet*="Album"], [aria-label*="Album"], [aria-label*="ألبوم"]');
  if (albumContainer) {
    const albumTitleEl = albumContainer.querySelector('h1, h2, h3, [role="heading"]');
    if (albumTitleEl && albumTitleEl.textContent) {
      albumName = albumTitleEl.textContent.trim();
    }
  }

  return {
    url: finalUrl,
    width: finalWidth,
    height: finalHeight,
    fbid,
    albumName,
    caption,
    postUrl: href || undefined,
  };
}
