import { ExtensionMessage } from '../types';
import { savePhotos, addLog } from '../services/db';

// Update extension action badge
export function updateBadge(text: string, color = '#2563eb') {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch (err) {
    console.warn('Failed to update badge', err);
  }
}

// Open or switch to persistent dashboard tab
export async function openDashboardTab(): Promise<chrome.tabs.Tab> {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find((t) => t.url && t.url.startsWith(dashboardUrl));

  if (existingTab && existingTab.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return existingTab;
  }

  return await chrome.tabs.create({ url: dashboardUrl });
}

// Background event listeners
chrome.runtime.onInstalled.addListener(() => {
  console.log('Facebook Page Photo Downloader extension installed.');
  updateBadge('', '#2563eb');
});

// Handle incoming messages
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
  if (message.type === 'OPEN_DASHBOARD') {
    openDashboardTab().then((tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'PHOTOS_DISCOVERED') {
    const { photos, pageInfo } = message.payload;
    if (photos && photos.length > 0) {
      savePhotos(photos).then((newCount) => {
        if (newCount > 0) {
          updateBadge(String(photos.length), '#2563eb');
          addLog(
            'info',
            `تم اكتشاف ${newCount} صورة جديدة من صفحة: ${pageInfo?.pageName || 'فيسبوك'}`
          );
        }
      });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SCAN_STATUS_CHANGED') {
    if (message.state === 'scanning') {
      updateBadge('•••', '#3b82f6');
    } else if (message.state === 'completed') {
      updateBadge('OK', '#10b981');
    } else if (message.state === 'stopped' || message.state === 'idle') {
      updateBadge('', '#64748b');
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});
