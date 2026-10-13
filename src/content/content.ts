import { FacebookScanner } from './fb-scanner';
import { detectFacebookPage } from './page-detector';
import { ExtensionMessage, PhotoItem, ScanState, FacebookPageInfo } from '../types';

let scannerInstance: FacebookScanner | null = null;
let statusBannerEl: HTMLDivElement | null = null;

function updateOnPageStatus(state: ScanState, count: number, message?: string) {
  if (state === 'idle' || state === 'stopped') {
    if (statusBannerEl) {
      statusBannerEl.remove();
      statusBannerEl = null;
    }
    return;
  }

  if (!statusBannerEl) {
    statusBannerEl = document.createElement('div');
    statusBannerEl.id = 'fb-photo-downloader-pill';
    statusBannerEl.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.3);
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      direction: rtl;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.3s ease;
      cursor: pointer;
    `;
    document.body.appendChild(statusBannerEl);
  }

  const stateColors: Record<ScanState, string> = {
    idle: '#64748b',
    scanning: '#3b82f6',
    paused: '#f59e0b',
    completed: '#10b981',
    stopped: '#ef4444',
  };

  const stateLabels: Record<ScanState, string> = {
    idle: 'خامل',
    scanning: 'جاري فحص الصور...',
    paused: 'الفحص متوقف مؤقتاً',
    completed: 'اكتمل الفحص!',
    stopped: 'تم إيقاف الفحص',
  };

  statusBannerEl.innerHTML = `
    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${stateColors[state]}; box-shadow:0 0 8px ${stateColors[state]};"></span>
    <span><strong>تحميل صور فيسبوك:</strong> ${stateLabels[state]} (${count} صورة)</span>
  `;
}

function initScanner(): FacebookScanner {
  if (!scannerInstance) {
    scannerInstance = new FacebookScanner(
      (photos: PhotoItem[], pageInfo: FacebookPageInfo) => {
        // Send batch to extension background & dashboard
        try {
          chrome.runtime.sendMessage({
            type: 'PHOTOS_DISCOVERED',
            payload: { photos, pageInfo },
          });
        } catch (e) {
          console.warn('Could not send message to extension background', e);
        }

        updateOnPageStatus(
          scannerInstance?.getState() || 'scanning',
          scannerInstance?.getDiscoveredCount() || 0
        );
      },
      (state: ScanState, message?: string) => {
        try {
          chrome.runtime.sendMessage({
            type: 'SCAN_STATUS_CHANGED',
            state,
            message,
          });
        } catch (e) {
          console.warn('Could not send status change to extension', e);
        }

        updateOnPageStatus(state, scannerInstance?.getDiscoveredCount() || 0, message);
      }
    );
  }
  return scannerInstance;
}

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
  if (message.type === 'DETECT_PAGE') {
    const pageInfo = detectFacebookPage();
    sendResponse({ pageInfo });
    return true;
  }

  if (message.type === 'START_SCAN') {
    const scanner = initScanner();
    scanner.start(message.options);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PAUSE_SCAN') {
    if (scannerInstance) {
      scannerInstance.pause();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESUME_SCAN') {
    if (scannerInstance) {
      scannerInstance.resume();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_SCAN') {
    if (scannerInstance) {
      scannerInstance.stop();
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});
