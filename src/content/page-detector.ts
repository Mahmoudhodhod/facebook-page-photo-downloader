import { FacebookPageInfo } from '../types';

export function detectFacebookPage(): FacebookPageInfo {
  const currentUrl = window.location.href;

  let pageName = 'Facebook Page';
  let pageType: FacebookPageInfo['pageType'] = 'unknown';
  let activeAlbumName: string | undefined;

  // 1. Determine Page Type from URL
  if (currentUrl.includes('/photos_albums') || currentUrl.includes('/albums')) {
    pageType = 'page_albums';
  } else if (currentUrl.includes('/photos') || currentUrl.includes('/photos_by')) {
    pageType = 'page_photos';
  } else if (currentUrl.includes('/media/set/') || currentUrl.includes('/photos/a.')) {
    pageType = 'single_album';
  } else if (currentUrl.includes('/posts/') || currentUrl.includes('/permalink/')) {
    pageType = 'timeline';
  } else if (window.location.pathname.length > 1) {
    pageType = 'page_home';
  }

  // 2. Extract Page Name with robust multi-selector fallbacks
  const nameSelectors = [
    // Modern Facebook header selectors
    'div[role="main"] h1',
    'div[data-pagelet="ProfileTilesFeed"] h1',
    'div[data-pagelet="ProfileHeader"] h1',
    'div[data-pagelet="page_header"] h1',
    'h1[dir="auto"]',
    'h1 span[dir="auto"]',
    'div[role="navigation"] + div h1',
  ];

  for (const selector of nameSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 0) {
      const text = el.textContent.trim();
      // Ignore common non-page texts
      if (!text.toLowerCase().includes('facebook') && !text.toLowerCase().includes('notifications')) {
        pageName = text;
        break;
      }
    }
  }

  // Fallback: document.title parsing ("Page Name | Facebook" or "Page Name - Facebook")
  if (pageName === 'Facebook Page' && document.title) {
    const cleanedTitle = document.title
      .replace(/\s*\|\s*facebook/i, '')
      .replace(/\s*-\s*facebook/i, '')
      .replace(/\([0-9]+\)\s*/, '') // Remove notification badge (1) Page Name
      .trim();
    if (cleanedTitle.length > 0) {
      pageName = cleanedTitle;
    }
  }

  // 3. Extract Album Name if in single album view
  if (pageType === 'single_album') {
    const albumTitleSelectors = [
      'div[role="main"] h2',
      'div[role="main"] span[dir="auto"]',
      'div[data-pagelet*="Album"] h1',
      'div[data-pagelet*="Album"] h2',
    ];
    for (const sel of albumTitleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 0) {
        activeAlbumName = el.textContent.trim();
        break;
      }
    }
  }

  return {
    url: currentUrl,
    pageName,
    pageType,
    activeAlbumName,
  };
}
