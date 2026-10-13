import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Search,
  Download,
  ExternalLink,
  HardDrive,
  ImageIcon,
  CheckCircle2,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { FacebookPageInfo, DownloadStats } from '../types';
import { getActiveDirectoryHandle, pickDownloadDirectory } from '../services/file-system';
import { downloadManager } from '../services/download-manager';

export const PopupApp: React.FC = () => {
  const [pageInfo, setPageInfo] = useState<FacebookPageInfo | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [stats, setStats] = useState<DownloadStats>({
    totalDiscovered: 0,
    completed: 0,
    pending: 0,
    downloading: 0,
    failed: 0,
    skipped: 0,
    excluded: 0,
    progressPercent: 0,
    bytesDownloaded: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initPopup();
  }, []);

  const initPopup = async () => {
    setLoading(true);
    // 1. Get folder
    const dir = await getActiveDirectoryHandle();
    if (dir) {
      setFolderName(dir.name);
    }

    // 2. Refresh stats
    const s = await downloadManager.refreshStats();
    setStats(s);

    // 3. Query active tab
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.url && activeTab.url.includes('facebook.com') && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { type: 'DETECT_PAGE' }, (response: any) => {
          if (!chrome.runtime.lastError && response?.pageInfo) {
            setPageInfo(response.pageInfo);
          }
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const handleOpenDashboard = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  };

  const handlePickFolder = async () => {
    try {
      const { name } = await pickDownloadDirectory();
      setFolderName(name);
    } catch (err: any) {
      if (err.message !== 'USER_CANCELLED') {
        alert('تعذر فتح منتقي المجلدات.');
      }
    }
  };

  const handleQuickScan = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id && activeTab.url?.includes('facebook.com')) {
      chrome.tabs.sendMessage(
        activeTab.id,
        {
          type: 'START_SCAN',
          options: {
            scope: 'all',
            highestResolution: true,
            organizeByAlbums: true,
            includeCoverAndProfile: false,
            selectedAlbumIds: [],
          },
        },
        () => {
          // Open persistent dashboard so user can track comfortably
          handleOpenDashboard();
        }
      );
    } else {
      alert('يرجى الانتقال إلى تبويب صفحة فيسبوك أولاً.');
    }
  };

  return (
    <div
      dir="rtl"
      style={{
        width: '380px',
        padding: '20px',
        background: '#090d16',
        color: '#f8fafc',
        fontFamily: "'Cairo', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ImageIcon size={20} color="#ffffff" />
          </div>
          <div>
            <h2 style={{ fontSize: '15px', fontWeight: '700', lineHeight: 1.2 }}>
              تحميل صور فيسبوك
            </h2>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Facebook Photo Downloader</span>
          </div>
        </div>

        <button
          onClick={handleOpenDashboard}
          className="btn btn-outline"
          style={{ padding: '6px 10px', fontSize: '11px' }}
          title="فتح لوحة التحكم المستمرة في تبويب مستقل"
        >
          <ExternalLink size={13} />
          <span>لوحة التحكم</span>
        </button>
      </div>

      {/* Page Detection Status */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '12px 14px',
          marginBottom: '14px',
        }}
      >
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>الصفحة الحالية:</div>
        {pageInfo ? (
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#60a5fa' }}>
            {pageInfo.pageName}
            {pageInfo.activeAlbumName ? ` • ${pageInfo.activeAlbumName}` : ''}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#fca5a5' }}>
            يرجى الانتقال لصفحة فيسبوك في المتصفح
          </div>
        )}
      </div>

      {/* Selected Folder */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '12px 14px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDrive size={16} color={folderName ? '#10b981' : '#f59e0b'} />
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>مجلد الحفظ:</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: folderName ? '#a7f3d0' : '#fcd34d' }}>
              {folderName || 'لم يتم الاختيار'}
            </div>
          </div>
        </div>
        <button
          onClick={handlePickFolder}
          className="btn btn-outline"
          style={{ padding: '4px 10px', fontSize: '11px' }}
        >
          <FolderOpen size={13} />
          <span>اختيار</span>
        </button>
      </div>

      {/* Stats Summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            padding: '10px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>المكتشفة</div>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#60a5fa', marginTop: '2px' }}>
            {stats.totalDiscovered}
          </div>
        </div>
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            padding: '10px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>المحملة</div>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#34d399', marginTop: '2px' }}>
            {stats.completed}
          </div>
        </div>
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            padding: '10px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>الانتظار</div>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#fbbf24', marginTop: '2px' }}>
            {stats.pending}
          </div>
        </div>
      </div>

      {/* Primary Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: '10px' }}
          onClick={handleQuickScan}
        >
          <Search size={16} />
          <span>فحص صور الصفحة</span>
        </button>

        <button
          className="btn btn-outline"
          style={{ width: '100%', padding: '10px', border: '1px solid rgba(59, 130, 246, 0.4)' }}
          onClick={handleOpenDashboard}
        >
          <ExternalLink size={16} />
          <span>فتح لوحة التحكم المستمرة</span>
        </button>
      </div>
    </div>
  );
};
