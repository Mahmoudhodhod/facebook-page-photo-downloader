/**
 * Full-Resolution Image Resolver for Facebook
 * Extracts genuine maximum-resolution image URLs directly from Facebook GraphQL/Relay payloads,
 * OpenGraph metadata, photo viewer pages, and display_resources without fake upscaling.
 */

import { getHighestResFromSrcset } from '../content/resolution-picker';

export interface FullResImageInfo {
  url: string;
  width?: number;
  height?: number;
  source: 'graphql' | 'og_meta' | 'media_vc' | 'photo_page' | 'srcset' | 'dom';
}

/**
 * Unescapes Facebook inline JSON escaped URLs.
 * e.g. "https:\/\/scontent.xx.fbcdn.net\/v\/... \u0026oe=..." -> "https://scontent.xx.fbcdn.net/v/... &oe=..."
 */
export function unescapeFacebookUrl(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Checks if a Facebook CDN URL is a cropped/small thumbnail.
 */
export function isThumbnailUrl(url: string): boolean {
  if (!url) return false;
  return /stp=c[0-9]|(?:_|\b)(?:p160x160|p320x320|p480x480|s320x320|s480x480|p720x720|s720x720)(?:_|\b)/i.test(url);
}

/**
 * Scans an HTML string or text payload (such as a fetched Facebook photo page)
 * and extracts all candidate high-resolution image URLs.
 */
export function extractFullResFromHtml(html: string): FullResImageInfo | null {
  if (!html) return null;

  const candidates: FullResImageInfo[] = [];

  // Strategy 1: Media viewer DOM element (data-visualcompletion="media-vc-image")
  // Facebook renders the highest resolution image directly in this element in theater mode!
  const mediaVcImgMatch = html.match(/<img[^>]*data-visualcompletion=["']media-vc-image["'][^>]*>/i);
  if (mediaVcImgMatch) {
    const imgTag = mediaVcImgMatch[0];
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    const srcsetMatch = imgTag.match(/srcset=["']([^"']+)["']/i);

    if (srcsetMatch && srcsetMatch[1]) {
      const best = getHighestResFromSrcset(unescapeFacebookUrl(srcsetMatch[1]));
      if (best && best.url) {
        candidates.push({
          url: best.url,
          width: best.width,
          source: 'media_vc',
        });
      }
    }

    if (srcMatch && srcMatch[1]) {
      const unescaped = unescapeFacebookUrl(srcMatch[1]);
      if (unescaped.includes('fbcdn.net') && !unescaped.includes('/rsrc.php/')) {
        candidates.push({
          url: unescaped,
          width: 1440, // Facebook viewer images are at least 1440-2048px
          source: 'media_vc',
        });
      }
    }
  }

  // Strategy 2: OpenGraph meta tag (og:image) + dimensions
  // Facebook puts the high-resolution uncropped image in og:image
  const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                  html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);

  if (ogMatch && ogMatch[1]) {
    const unescaped = unescapeFacebookUrl(ogMatch[1]);
    if (unescaped.includes('fbcdn.net') && !unescaped.includes('/rsrc.php/')) {
      const widthMatch = html.match(/<meta\s+(?:property|name)=["']og:image:width["']\s+content=["']([0-9]+)["']/i);
      const heightMatch = html.match(/<meta\s+(?:property|name)=["']og:image:height["']\s+content=["']([0-9]+)["']/i);
      const width = widthMatch ? parseInt(widthMatch[1], 10) : 1200; // og:image is typically 1200w
      const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;

      candidates.push({
        url: unescaped,
        width,
        height,
        source: 'og_meta',
      });
    }
  }

  // Strategy 3: GraphQL Image objects in embedded JSON scripts
  // Pattern: "image":{"height":...,"uri":"https:\/\/...","width":...}
  // or "viewer_image":{"uri":"..."}
  // or "display_resources":[{"src":"...","config_width":...}]
  const jsonRegex = /"(?:image|viewer_image|full_screen_image|large_share_image|photo_image)"\s*:\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = jsonRegex.exec(html)) !== null) {
    const block = match[1];
    const uriMatch = block.match(/"uri"\s*:\s*"([^"]+)"/);
    if (!uriMatch || !uriMatch[1]) continue;

    const rawUri = uriMatch[1];
    const unescapedUri = unescapeFacebookUrl(rawUri);

    if (!unescapedUri.includes('fbcdn.net') || unescapedUri.includes('/rsrc.php/')) {
      continue;
    }

    const widthMatch = block.match(/"width"\s*:\s*([0-9]+)/);
    const heightMatch = block.match(/"height"\s*:\s*([0-9]+)/);

    const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;

    candidates.push({
      url: unescapedUri,
      width,
      height,
      source: 'graphql',
    });
  }

  // Strategy 4: display_resources in Relay stores
  // e.g. "src":"https:\/\/...","config_width":2048,"config_height":1536
  const displayResRegex = /"src"\s*:\s*"(https?:\\\/\\\/[^"]+fbcdn\.net[^"]+)"[^}]*"config_width"\s*:\s*([0-9]+)/g;
  while ((match = displayResRegex.exec(html)) !== null) {
    const unescaped = unescapeFacebookUrl(match[1]);
    const width = parseInt(match[2], 10);
    if (!unescaped.includes('/rsrc.php/')) {
      candidates.push({
        url: unescaped,
        width,
        source: 'graphql',
      });
    }
  }

  // Strategy 5: Find any scontent URL in JSON
  const scontentRegex = /"(?:uri|src)"\s*:\s*"(https?:\\\/\\\/[^"]+scontent[^"]+)"/g;
  while ((match = scontentRegex.exec(html)) !== null) {
    const unescaped = unescapeFacebookUrl(match[1]);
    if (!unescaped.includes('/rsrc.php/')) {
      if (!candidates.some((c) => c.url === unescaped)) {
        candidates.push({
          url: unescaped,
          width: isThumbnailUrl(unescaped) ? 320 : 1080,
          source: 'photo_page',
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort candidates prioritizing:
  // 1. Non-thumbnail strictly above thumbnails
  // 2. Maximum resolution / width
  candidates.sort((a, b) => {
    const aThumb = isThumbnailUrl(a.url) ? 1 : 0;
    const bThumb = isThumbnailUrl(b.url) ? 1 : 0;
    // Always prefer non-thumbnail!
    if (aThumb !== bThumb) return aThumb - bThumb;

    // Both are non-thumbnails or both are thumbnails: sort by width descending
    const aWidth = a.width || (aThumb ? 320 : 1080);
    const bWidth = b.width || (bThumb ? 320 : 1080);
    return bWidth - aWidth;
  });

  return candidates[0];
}

/**
 * In-page harvester:
 * Reads all <script type="application/json"> elements in the current DOM
 * to pre-populate a cache of photo FBIDs to their maximum resolution URLs.
 */
export function harvestPageScriptPhotos(): Map<string, FullResImageInfo> {
  const map = new Map<string, FullResImageInfo>();

  try {
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of scripts) {
      const content = script.textContent;
      if (!content || !content.includes('fbcdn.net')) continue;

      // Scan for photo nodes with id and image
      const photoIdRegex = /"(?:id|photo_id|fbid)"\s*:\s*"([0-9]{8,25})"/g;
      let idMatch: RegExpExecArray | null;

      while ((idMatch = photoIdRegex.exec(content)) !== null) {
        const fbid = idMatch[1];
        const windowStart = Math.max(0, idMatch.index - 500);
        const windowEnd = Math.min(content.length, idMatch.index + 2500);
        const chunk = content.substring(windowStart, windowEnd);

        const extracted = extractFullResFromHtml(chunk);
        if (extracted && (!map.has(fbid) || (extracted.width || 0) > (map.get(fbid)?.width || 0))) {
          map.set(fbid, extracted);
        }
      }
    }
  } catch (err) {
    console.warn('Error harvesting page scripts for full-res photos', err);
  }

  return map;
}

/**
 * Fetches the photo page for a given photo in the authenticated session
 * and resolves its true maximum resolution image.
 */
export async function resolveFullResolutionPhoto(
  fbid?: string,
  currentUrl?: string,
  postUrl?: string,
  abortSignal?: AbortSignal
): Promise<FullResImageInfo | null> {
  // Candidate URLs to fetch on Facebook
  const urlsToTry: string[] = [];

  if (postUrl && postUrl.includes('facebook.com')) {
    urlsToTry.push(postUrl);
  }

  if (fbid) {
    urlsToTry.push(`https://www.facebook.com/photo/?fbid=${encodeURIComponent(fbid)}`);
    urlsToTry.push(`https://www.facebook.com/photo.php?fbid=${encodeURIComponent(fbid)}`);
  }

  for (const pageUrl of urlsToTry) {
    try {
      if (abortSignal?.aborted) return null;

      const response = await fetch(pageUrl, {
        signal: abortSignal,
        credentials: 'include',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
      });

      if (!response.ok) continue;

      const html = await response.text();
      const candidate = extractFullResFromHtml(html);

      if (candidate && candidate.url) {
        // If candidate is a non-thumbnail or has higher resolution, return it
        const currentIsThumb = currentUrl ? isThumbnailUrl(currentUrl) : true;
        const candidateIsThumb = isThumbnailUrl(candidate.url);

        if (!candidateIsThumb || !currentIsThumb) {
          return candidate;
        }
      }
    } catch {
      // Continue to next URL attempt
    }
  }

  return null;
}
