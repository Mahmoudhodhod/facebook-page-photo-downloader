import React, { useState, useEffect, useRef } from 'react';
import {
  FolderOpen,
  Search,
  Download,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  FileJson,
  Trash2,
  ExternalLink,
  Layers,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Clock,
  Settings as SettingsIcon,
  ChevronDown,
  Globe,
  HardDrive,
  RefreshCw,
  Maximize2,
  Sparkles,
  Ban,
  CheckSquare,
  Square,
  XCircle,
} from 'lucide-react';

import {
  PhotoItem,
  DownloadStats,
  ScanState,
  DownloadState,
  ActivityLogItem,
  AppSettings,
  FacebookPageInfo,
  ScanOptions,
} from '../types';
import {
  getAllPhotos,
  clearAllPhotos,
  getSettings,
  updateSettings,
  getRecentLogs,
  clearLogs,
  updatePhoto,
  addLog,
  togglePhotoExcluded,
  setPhotosExcluded,
} from '../services/db';
import {
  pickDownloadDirectory,
  getActiveDirectoryHandle,
} from '../services/file-system';
import { downloadManager } from '../services/download-manager';
import { exportReportCSV, exportReportJSON } from '../services/report-export';
import { resolveFullResolutionPhoto } from '../services/full-res-resolver';

export const DashboardApp: React.FC = () => {
  // App State
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
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
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [hasFolderPermission, setHasFolderPermission] = useState<boolean>(false);
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [detectedPage, setDetectedPage] = useState<FacebookPageInfo | null>(null);

  // Filter & Options
  const [activeTab, setActiveTab] = useState<'photos' | 'logs' | 'settings'>('photos');
  const [photoFilter, setPhotoFilter] = useState<'all' | 'included' | 'excluded' | 'completed' | 'pending' | 'failed' | 'skipped'>('all');
  const [settings, setSettings] = useState<AppSettings>({
    concurrency: 2,
    skipExisting: true,
    createAlbumFolders: true,
    arabicLanguage: true,
    theme: 'dark',
    hasDirectoryPermission: false,
  });
  const [scanOptions, setScanOptions] = useState<ScanOptions>({
    scope: 'all',
    highestResolution: true,
    organizeByAlbums: true,
    includeCoverAndProfile: false,
    selectedAlbumIds: [],
  });
  const [isUpgrading, setIsUpgrading] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    loadInitialData();

    // Subscribe to download manager updates
    const unsubscribeStats = downloadManager.subscribeStats((newStats) => {
      setStats(newStats);
      setDownloadState(downloadManager.getState());
    });

    const unsubscribePhoto = downloadManager.subscribePhotoUpdates((updatedPhoto) => {
      setPhotos((prev) => {
        const index = prev.findIndex((p) => p.id === updatedPhoto.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = updatedPhoto;
          return next;
        }
        return [updatedPhoto, ...prev];
      });
    });

    // Listen to background & content script runtime messages
    const messageListener = (message: any) => {
      if (message.type === 'PHOTOS_DISCOVERED') {
        const batch: PhotoItem[] = message.payload.photos;
        if (message.payload.pageInfo) {
          setDetectedPage(message.payload.pageInfo);
        }
        setPhotos((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const newItems = batch.filter((p) => !existingIds.has(p.id));
          return [...prev, ...newItems];
        });
        downloadManager.refreshStats();
        refreshLogs();
      } else if (message.type === 'SCAN_STATUS_CHANGED') {
        setScanState(message.state);
        refreshLogs();
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      unsubscribeStats();
      unsubscribePhoto();
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  const loadInitialData = async () => {
    // 1. Settings
    const s = await getSettings();
    setSettings(s);

    // 2. Folder handle
    const dirInfo = await getActiveDirectoryHandle();
    if (dirInfo) {
      setSelectedFolder(dirInfo.name);
      setHasFolderPermission(dirInfo.hasPermission);
    }

    // 3. Photos & Stats
    const storedPhotos = await getAllPhotos();
    setPhotos(storedPhotos);
    const refreshed = await downloadManager.refreshStats();
    setStats(refreshed);

    // 4. Logs
    refreshLogs();

    // 5. Try detecting active Facebook tab
    queryActiveFacebookTab();
  };

  const refreshLogs = async () => {
    const recent = await getRecentLogs(80);
    setLogs(recent);
  };

  const queryActiveFacebookTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'DETECT_PAGE' }, (response: any) => {
          if (chrome.runtime.lastError) {
            return;
          }
          if (response && response.pageInfo) {
            setDetectedPage(response.pageInfo);
          }
        });
      }
    } catch (e) {
      console.warn('Could not query tabs', e);
    }
  };

  // Folder Picker Handlers
  const handleChooseFolder = async () => {
    try {
      const { handle, name } = await pickDownloadDirectory();
      setSelectedFolder(name);
      setHasFolderPermission(true);
      await updateSettings({ savedFolderName: name, hasDirectoryPermission: true });
      refreshLogs();
    } catch (err: any) {
      if (err.message !== 'USER_CANCELLED') {
        alert('حدث خطأ أثناء اختيار المجلد. يرجى التأكد من دعم متصفحك لواجهة File System Access.');
      }
    }
  };

  // Scan Controls
  const handleStartScan = async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    if (tabs.length === 0 || !tabs[0].id) {
      alert('يرجى فتح صفحة فيسبوك في تبويب نشط أولاً ثم الضغط على فحص صور الصفحة.');
      return;
    }

    const activeFbTab = tabs[0];
    chrome.tabs.sendMessage(
      activeFbTab.id!,
      { type: 'START_SCAN', options: scanOptions },
      (response: any) => {
        if (chrome.runtime.lastError) {
          alert('تعذر الاتصال بصفحة فيسبوك. يرجى إعادة تحميل صفحة فيسبوك والمحاولة مجدداً.');
          return;
        }
        setScanState('scanning');
      }
    );
  };

  const handlePauseScan = async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'PAUSE_SCAN' });
      setScanState('paused');
    }
  };

  const handleResumeScan = async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'RESUME_SCAN' });
      setScanState('scanning');
    }
  };

  const handleStopScan = async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_SCAN' });
      setScanState('stopped');
    }
  };

  // Download Controls
  const handleStartDownload = async () => {
    try {
      await downloadManager.startDownload();
      setDownloadState('downloading');
    } catch (err: any) {
      if (err.message === 'NO_DIRECTORY_SELECTED') {
        handleChooseFolder();
      } else {
        alert(err.message);
      }
    }
  };

  const handlePauseDownload = async () => {
    await downloadManager.pause();
    setDownloadState('paused');
  };

  const handleResumeDownload = async () => {
    await downloadManager.resume();
    setDownloadState('downloading');
  };

  const handleCancelDownload = async () => {
    if (confirm('هل أنت متأكد من رغبتك في إلغاء عملية التحميل الجارية؟')) {
      await downloadManager.cancel();
      setDownloadState('idle');
    }
  };

  const handleRetryFailed = async () => {
    await downloadManager.retryFailed();
    setDownloadState('downloading');
  };

  const handleToggleExclude = async (photoId: string) => {
    const isNowExcluded = await togglePhotoExcluded(photoId);
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, excluded: isNowExcluded } : p))
    );
    await downloadManager.refreshStats();
  };

  const handleSetAllExcluded = async (excluded: boolean) => {
    const ids = photos.map((p) => p.id);
    await setPhotosExcluded(ids, excluded);
    setPhotos((prev) => prev.map((p) => ({ ...p, excluded })));
    await downloadManager.refreshStats();
  };

  const handleExcludeLowRes = async () => {
    const lowRes = photos.filter((p) => !p.width || p.width < 1000);
    if (lowRes.length === 0) {
      alert(isRtl ? 'لا توجد صور منخفضة الدقة لاستبعادها.' : 'No low resolution photos to exclude.');
      return;
    }
    const lowResIds = lowRes.map((p) => p.id);
    await setPhotosExcluded(lowResIds, true);
    setPhotos((prev) =>
      prev.map((p) => (!p.width || p.width < 1000 ? { ...p, excluded: true } : p))
    );
    await downloadManager.refreshStats();
    await addLog('info', `تم استبعاد ${lowResIds.length} صورة منخفضة الدقة من قائمة التحميل.`);
    refreshLogs();
  };

  const handleExcludeCompleted = async () => {
    const completed = photos.filter((p) => p.status === 'completed');
    if (completed.length === 0) {
      alert(isRtl ? 'لا توجد صور مكتملة لاستبعادها.' : 'No completed photos to exclude.');
      return;
    }
    const completedIds = completed.map((p) => p.id);
    await setPhotosExcluded(completedIds, true);
    setPhotos((prev) =>
      prev.map((p) => (p.status === 'completed' ? { ...p, excluded: true } : p))
    );
    await downloadManager.refreshStats();
    await addLog('info', `تم استبعاد ${completedIds.length} صورة مكتملة التحميل.`);
    refreshLogs();
  };

  const handleUpgradeAllToFullRes = async () => {
    const toUpgrade = photos.filter((p) => (!p.width || p.width < 1200) && (p.fbid || p.postUrl));
    if (toUpgrade.length === 0) {
      alert(isRtl ? 'جميع الصور الحالية مسجلة بالفعل بالحجم الأصلي الكامل.' : 'All photos are already at full resolution.');
      return;
    }

    setIsUpgrading(true);
    await addLog('info', `بدء جلب الحجم الكامل الأصلي لـ ${toUpgrade.length} صورة من فيسبوك...`);

    let upgraded = 0;
    for (const p of toUpgrade) {
      try {
        const full = await resolveFullResolutionPhoto(p.fbid, p.url, p.postUrl);
        if (full && full.url) {
          p.url = full.url;
          p.width = full.width || p.width;
          p.height = full.height || p.height;
          await updatePhoto(p);
          upgraded++;
        }
      } catch {
        // continue
      }
    }

    const refreshed = await getAllPhotos();
    setPhotos(refreshed);
    setIsUpgrading(false);
    await addLog('success', `اكتمل جلب الحجم الكامل الأصلي بنجاح! تم ترقية ${upgraded} صورة.`);
    refreshLogs();
  };

  const handleClearAllPhotos = async () => {
    if (confirm('هل أنت متأكد من رغبتك في مسح جميع الصور المكتشفة من القائمة؟ (لن يتم حذف الملفات المحملة على القرص)')) {
      await clearAllPhotos();
      setPhotos([]);
      await downloadManager.refreshStats();
      refreshLogs();
    }
  };

  const handleSaveSettings = async (partial: Partial<AppSettings>) => {
    const updated = await updateSettings(partial);
    setSettings(updated);
  };

  // Filtered Photos List
  const filteredPhotos = photos.filter((p) => {
    if (photoFilter === 'all') return true;
    if (photoFilter === 'included') return !p.excluded;
    if (photoFilter === 'excluded') return !!p.excluded;
    if (photoFilter === 'completed') return p.status === 'completed';
    if (photoFilter === 'pending') return (p.status === 'pending' || p.status === 'discovered') && !p.excluded;
    if (photoFilter === 'failed') return p.status === 'failed';
    if (photoFilter === 'skipped') return p.status === 'skipped';
    return true;
  });

  const isRtl = settings.arabicLanguage;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        maxWidth: '1440px',
        margin: '0 auto',
        padding: '24px 32px',
        minHeight: '100vh',
      }}
    >
      {/* Header Bar */}
      <header
        className="glass-panel"
        style={{
          padding: '20px 28px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(37, 99, 235, 0.35)',
            }}
          >
            <ImageIcon size={26} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.02em' }}>
              {isRtl ? 'تحميل صور صفحة فيسبوك' : 'Facebook Page Photo Downloader'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {detectedPage ? (
                  <>
                    <strong style={{ color: '#60a5fa' }}>{detectedPage.pageName}</strong>
                    {detectedPage.activeAlbumName ? ` • ${detectedPage.activeAlbumName}` : ''}
                  </>
                ) : (
                  (isRtl ? 'لم يتم العثور على صفحة فيسبوك نشطة' : 'No active Facebook Page detected')
                )}
              </span>
              <button
                onClick={queryActiveFacebookTab}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={isRtl ? 'تحديث الاتصال بالصفحة' : 'Refresh page detection'}
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Header Actions & Folder Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              background: selectedFolder ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${selectedFolder ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
            }}
          >
            <HardDrive size={16} color={selectedFolder ? '#10b981' : '#ef4444'} />
            <span style={{ color: selectedFolder ? '#a7f3d0' : '#fca5a5' }}>
              {selectedFolder
                ? `${isRtl ? 'مجلد الحفظ:' : 'Destination:'} ${selectedFolder}`
                : (isRtl ? 'لم يتم تحديد مجلد الحفظ' : 'No folder selected')}
            </span>
          </div>

          <button
            className="btn btn-outline"
            onClick={handleChooseFolder}
            style={{ borderColor: selectedFolder ? 'rgba(255,255,255,0.1)' : 'var(--primary)' }}
          >
            <FolderOpen size={16} />
            <span>{isRtl ? 'اختيار مجلد الحفظ' : 'Choose Download Folder'}</span>
          </button>

          <button
            className="btn btn-outline"
            onClick={() => handleSaveSettings({ arabicLanguage: !settings.arabicLanguage })}
            title="تبديل اللغة / Toggle Language"
          >
            <Globe size={16} />
            <span>{isRtl ? 'English' : 'عربي'}</span>
          </button>
        </div>
      </header>

      {/* Main Action Bar */}
      <section
        className="glass-panel"
        style={{
          padding: '20px 28px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        {/* Left Side: Scan & Download Primary Triggers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Scan Controls */}
          {scanState === 'idle' || scanState === 'stopped' || scanState === 'completed' ? (
            <button className="btn btn-primary" onClick={handleStartScan}>
              <Search size={17} />
              <span>{isRtl ? 'فحص صور الصفحة' : 'Scan Page Photos'}</span>
            </button>
          ) : scanState === 'scanning' ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-warning" onClick={handlePauseScan}>
                <Pause size={17} />
                <span>{isRtl ? 'إيقاف مؤقت للفحص' : 'Pause Scan'}</span>
              </button>
              <button className="btn btn-outline" onClick={handleStopScan}>
                <span>{isRtl ? 'إنهاء الفحص' : 'Stop Scan'}</span>
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={handleResumeScan}>
              <Play size={17} />
              <span>{isRtl ? 'استكمال الفحص' : 'Resume Scan'}</span>
            </button>
          )}

          {/* Download Controls */}
          {downloadState === 'idle' || downloadState === 'completed' ? (
            <button
              className="btn btn-success"
              onClick={handleStartDownload}
              disabled={photos.length === 0}
            >
              <Download size={17} />
              <span>{isRtl ? 'تحميل جميع الصور' : 'Download All'}</span>
            </button>
          ) : downloadState === 'downloading' ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-warning" onClick={handlePauseDownload}>
                <Pause size={17} />
                <span>{isRtl ? 'إيقاف مؤقت' : 'Pause'}</span>
              </button>
              <button className="btn btn-danger" onClick={handleCancelDownload}>
                <span>{isRtl ? 'إلغاء' : 'Cancel'}</span>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-success" onClick={handleResumeDownload}>
                <Play size={17} />
                <span>{isRtl ? 'استكمال التحميل' : 'Resume'}</span>
              </button>
              <button className="btn btn-danger" onClick={handleCancelDownload}>
                <span>{isRtl ? 'إلغاء' : 'Cancel'}</span>
              </button>
            </div>
          )}

          {/* Retry Failed button */}
          {stats.failed > 0 && downloadState !== 'downloading' && (
            <button className="btn btn-outline" onClick={handleRetryFailed} style={{ color: '#fca5a5' }}>
              <RotateCcw size={16} />
              <span>{isRtl ? 'إعادة محاولة الملفات الفاشلة' : 'Retry Failed'}</span>
            </button>
          )}

          {/* Upgrade to Full Resolution Button */}
          {photos.length > 0 && downloadState !== 'downloading' && (
            <button
              className="btn btn-outline"
              onClick={handleUpgradeAllToFullRes}
              disabled={isUpgrading}
              style={{ borderColor: 'rgba(59, 130, 246, 0.4)', color: '#93c5fd' }}
              title={isRtl ? 'جلب الحجم الكامل الأصلي لجميع الصور من فيسبوك' : 'Fetch full original size images from Facebook'}
            >
              <Sparkles size={16} />
              <span>
                {isUpgrading
                  ? (isRtl ? 'جاري جلب الحجم الكامل...' : 'Fetching Full Size...')
                  : (isRtl ? 'جلب الحجم الأصلي للصور' : 'Fetch Full Size Images')}
              </span>
            </button>
          )}
        </div>

        {/* Right Side: Export Reports */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            className="btn btn-outline"
            onClick={exportReportCSV}
            disabled={photos.length === 0}
            title={isRtl ? 'تصدير تقرير CSV للصور' : 'Export CSV Report'}
          >
            <FileSpreadsheet size={16} />
            <span>CSV</span>
          </button>
          <button
            className="btn btn-outline"
            onClick={exportReportJSON}
            disabled={photos.length === 0}
            title={isRtl ? 'تصدير تقرير JSON' : 'Export JSON Report'}
          >
            <FileJson size={16} />
            <span>JSON</span>
          </button>
          {photos.length > 0 && downloadState !== 'downloading' && (
            <button
              className="btn btn-outline"
              onClick={handleClearAllPhotos}
              title={isRtl ? 'مسح القائمة' : 'Clear List'}
              style={{ color: '#f87171' }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </section>

      {/* Real-time Statistics Cards */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        {/* Card 1: Discovered */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'الصور المكتشفة' : 'Total Discovered'}
            </span>
            <Search size={18} color="#3b82f6" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px', color: '#60a5fa' }}>
            {stats.totalDiscovered.toLocaleString()}
          </div>
        </div>

        {/* Card 2: Completed */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'اكتمل التحميل' : 'Downloaded'}
            </span>
            <CheckCircle2 size={18} color="#10b981" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px', color: '#34d399' }}>
            {stats.completed.toLocaleString()}
          </div>
        </div>

        {/* Card 3: Pending */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'قيد الانتظار' : 'Pending'}
            </span>
            <Clock size={18} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px', color: '#fbbf24' }}>
            {stats.pending.toLocaleString()}
          </div>
        </div>

        {/* Card 4: Skipped / Duplicates */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'تم تخطيها (موجودة)' : 'Skipped / Existing'}
            </span>
            <AlertCircle size={18} color="#94a3b8" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px', color: '#cbd5e1' }}>
            {stats.skipped.toLocaleString()}
          </div>
        </div>

        {/* Card 5: Excluded */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'مستبعدة من التحميل' : 'Excluded Photos'}
            </span>
            <Ban size={18} color="#f87171" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px', color: '#fca5a5' }}>
            {stats.excluded.toLocaleString()}
          </div>
        </div>

        {/* Card 6: Failed */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'فشل التحميل' : 'Failed'}
            </span>
            <AlertTriangle size={18} color="#ef4444" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '8px', color: '#f87171' }}>
            {stats.failed.toLocaleString()}
          </div>
        </div>

        {/* Card 7: Progress Percentage */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>
              {isRtl ? 'نسبة التقدم' : 'Progress'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--primary)' }}>
              {stats.progressPercent}%
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: '9999px',
              marginTop: '16px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${stats.progressPercent}%`,
                background: 'linear-gradient(90deg, #3b82f6, #10b981)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </section>

      {/* Tabs Navigation (Photos Gallery | Live Activity Log | Settings) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '12px',
          marginBottom: '20px',
        }}
      >
        <button
          className={`btn ${activeTab === 'photos' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('photos')}
        >
          <ImageIcon size={16} />
          <span>{isRtl ? 'معرض الصور المكتشفة' : 'Discovered Gallery'} ({photos.length})</span>
        </button>

        <button
          className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => {
            setActiveTab('logs');
            refreshLogs();
          }}
        >
          <Clock size={16} />
          <span>{isRtl ? 'سجل النشاط المباشر' : 'Live Activity Log'}</span>
        </button>

        <button
          className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('settings')}
        >
          <SettingsIcon size={16} />
          <span>{isRtl ? 'خيارات الفحص والتحميل' : 'Download Options'}</span>
        </button>
      </div>

      {/* Tab 1: Photos Gallery */}
      {activeTab === 'photos' && (
        <div>
          {/* Gallery Filter Pills */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
              flexWrap: 'wrap',
            }}
          >
            {(['all', 'included', 'excluded', 'completed', 'pending', 'skipped', 'failed'] as const).map((filterKey) => {
              const labels: Record<string, string> = {
                all: isRtl ? 'الكل' : 'All',
                included: isRtl ? 'مجهزة للتحميل' : 'Included',
                excluded: isRtl ? 'مستبعدة' : 'Excluded',
                completed: isRtl ? 'مكتمل' : 'Completed',
                pending: isRtl ? 'قيد الانتظار' : 'Pending',
                skipped: isRtl ? 'تم التخطي' : 'Skipped',
                failed: isRtl ? 'فشل' : 'Failed',
              };
              return (
                <button
                  key={filterKey}
                  onClick={() => setPhotoFilter(filterKey)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '9999px',
                    border: '1px solid',
                    borderColor: photoFilter === filterKey ? 'var(--primary)' : 'rgba(255,255,255,0.08)',
                    background: photoFilter === filterKey ? 'var(--primary-glow)' : 'transparent',
                    color: photoFilter === filterKey ? '#ffffff' : 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  {labels[filterKey]}
                </button>
              );
            })}
          </div>

          {/* Batch Selection & Exclusion Toolbar */}
          {photos.length > 0 && (
            <div
              className="glass-panel"
              style={{
                padding: '12px 18px',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                background: 'rgba(15, 23, 42, 0.75)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                  {isRtl ? 'التحكم بالاستبعاد:' : 'Batch Actions:'}
                </span>

                <button
                  className="btn btn-outline"
                  onClick={() => handleSetAllExcluded(false)}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  title={isRtl ? 'تضمين جميع الصور في التحميل' : 'Include all photos'}
                >
                  <CheckSquare size={14} color="#34d399" />
                  <span>{isRtl ? 'تحديد الكل للتحميل' : 'Select All'}</span>
                </button>

                <button
                  className="btn btn-outline"
                  onClick={() => handleSetAllExcluded(true)}
                  style={{ padding: '6px 12px', fontSize: '12px', color: '#fca5a5' }}
                  title={isRtl ? 'استبعاد جميع الصور من التحميل' : 'Exclude all photos'}
                >
                  <Square size={14} />
                  <span>{isRtl ? 'استبعاد الكل' : 'Exclude All'}</span>
                </button>

                <button
                  className="btn btn-outline"
                  onClick={handleExcludeCompleted}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  title={isRtl ? 'استبعاد الصور المكتملة مسبقاً' : 'Exclude completed photos'}
                >
                  <Ban size={14} color="#94a3b8" />
                  <span>{isRtl ? 'استبعاد المكتملة' : 'Exclude Completed'}</span>
                </button>

                <button
                  className="btn btn-outline"
                  onClick={handleExcludeLowRes}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  title={isRtl ? 'استبعاد الصور المصغرة ذات الدقة المنخفضة' : 'Exclude low-res thumbnails'}
                >
                  <Ban size={14} color="#fbbf24" />
                  <span>{isRtl ? 'استبعاد المصغرات' : 'Exclude Low-Res'}</span>
                </button>
              </div>

              {/* Counter status badge */}
              <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#34d399', fontWeight: 'bold' }}>
                  {photos.length - stats.excluded} {isRtl ? 'مجهزة للتحميل' : 'Ready'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span style={{ color: stats.excluded > 0 ? '#f87171' : 'var(--text-muted)', fontWeight: 'bold' }}>
                  {stats.excluded} {isRtl ? 'مستبعدة' : 'Excluded'}
                </span>
              </div>
            </div>
          )}

          {filteredPhotos.length === 0 ? (
            <div
              className="glass-panel"
              style={{
                padding: '60px 20px',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <Search size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
              <p style={{ fontSize: '16px', fontWeight: '500' }}>
                {isRtl
                  ? 'لم يتم العثور على صور حتى الآن. افتح صفحة فيسبوك وانقر على "فحص صور الصفحة".'
                  : 'No photos discovered yet. Open your Facebook Page and click "Scan Page Photos".'}
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '16px',
              }}
            >
              {filteredPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="glass-panel"
                  style={{
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    opacity: photo.excluded ? 0.6 : 1,
                    border: photo.excluded ? '1px dashed rgba(239, 68, 68, 0.5)' : undefined,
                    background: photo.excluded ? 'rgba(30, 15, 20, 0.35)' : undefined,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div
                    style={{
                      height: '180px',
                      background: 'rgba(0,0,0,0.4)',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={photo.thumbnailUrl || photo.url}
                      alt={photo.caption || 'Facebook photo'}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transition: 'transform 0.3s ease',
                        filter: photo.excluded ? 'grayscale(40%)' : undefined,
                      }}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />

                    {/* Interactive Exclusion Badge Button on Thumbnail */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExclude(photo.id);
                      }}
                      style={{
                        position: 'absolute',
                        top: '10px',
                        left: '10px',
                        background: photo.excluded ? 'rgba(239, 68, 68, 0.95)' : 'rgba(16, 185, 129, 0.9)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '9999px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        backdropFilter: 'blur(8px)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                        zIndex: 3,
                      }}
                      title={photo.excluded ? (isRtl ? 'إعادة تضمين الصورة للتحميل' : 'Include in download') : (isRtl ? 'استبعاد الصورة من التحميل' : 'Exclude from download')}
                    >
                      {photo.excluded ? <Ban size={12} /> : <Check size={12} />}
                      <span>{photo.excluded ? (isRtl ? 'مستبعدة' : 'Excluded') : (isRtl ? 'مجهزة' : 'Selected')}</span>
                    </button>

                    {/* Status Badge */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        padding: '4px 10px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: '700',
                        backdropFilter: 'blur(8px)',
                        background:
                          photo.status === 'completed'
                            ? 'rgba(16, 185, 129, 0.85)'
                            : photo.status === 'downloading'
                            ? 'rgba(59, 130, 246, 0.85)'
                            : photo.status === 'failed'
                            ? 'rgba(239, 68, 68, 0.85)'
                            : photo.status === 'skipped'
                            ? 'rgba(148, 163, 184, 0.85)'
                            : 'rgba(245, 158, 11, 0.85)',
                        color: '#ffffff',
                      }}
                    >
                      {photo.status === 'completed'
                        ? (isRtl ? 'مكتمل' : 'Done')
                        : photo.status === 'downloading'
                        ? (isRtl ? 'جاري التحميل...' : 'Downloading...')
                        : photo.status === 'failed'
                        ? (isRtl ? 'فشل' : 'Failed')
                        : photo.status === 'skipped'
                        ? (isRtl ? 'تم التخطي' : 'Skipped')
                        : (isRtl ? 'بانتظار التحميل' : 'Pending')}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#60a5fa',
                          fontWeight: '600',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {photo.albumName || (isRtl ? 'صور الصفحة' : 'Page Photos')}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {photo.width && photo.width >= 1200 ? (
                          <span style={{ color: '#34d399', fontWeight: 'bold' }}>
                            {photo.width} × {photo.height || photo.width} px (الحجم الكامل الأصلي)
                          </span>
                        ) : photo.width ? (
                          <span>{photo.width} × {photo.height || photo.width} px</span>
                        ) : (
                          <span>Full Res</span>
                        )}
                        {photo.fileSize ? ` • ${(photo.fileSize / 1024).toFixed(0)} KB` : ''}
                      </div>
                    </div>

                    <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
                      {/* Exclude / Include button */}
                      <button
                        className="btn btn-outline"
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          color: photo.excluded ? '#34d399' : '#f87171',
                          borderColor: photo.excluded ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                        }}
                        title={photo.excluded ? (isRtl ? 'تضمين الصورة للتحميل' : 'Include') : (isRtl ? 'استبعاد من التحميل' : 'Exclude')}
                        onClick={() => handleToggleExclude(photo.id)}
                      >
                        {photo.excluded ? <CheckSquare size={12} /> : <Ban size={12} />}
                        <span>{photo.excluded ? (isRtl ? 'تضمين' : 'Include') : (isRtl ? 'استبعاد' : 'Exclude')}</span>
                      </button>

                      {/* Upgrade resolution button */}
                      {(!photo.width || photo.width < 1200) && (
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: '11px', color: '#60a5fa' }}
                          title={isRtl ? 'جلب الحجم الكامل الأصلي لهذه الصورة' : 'Fetch full original resolution'}
                          onClick={async () => {
                            const full = await resolveFullResolutionPhoto(photo.fbid, photo.url, photo.postUrl);
                            if (full && full.url) {
                              photo.url = full.url;
                              photo.width = full.width;
                              photo.height = full.height;
                              await updatePhoto(photo);
                              setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...photo } : p)));
                            }
                          }}
                        >
                          <Sparkles size={12} />
                        </button>
                      )}

                      {/* Open image in new tab */}
                      <a
                        href={photo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-outline"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        title={isRtl ? 'فتح الصورة بالحجم الكامل' : 'Open Full Image'}
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Live Activity Log */}
      {activeTab === 'logs' && (
        <div className="glass-panel" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700' }}>
              {isRtl ? 'سجل النشاط المباشر' : 'Live Activity Log'}
            </h3>
            <button
              className="btn btn-outline"
              onClick={async () => {
                await clearLogs();
                setLogs([]);
              }}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              <Trash2 size={14} />
              <span>{isRtl ? 'مسح السجل' : 'Clear Log'}</span>
            </button>
          </div>

          <div
            style={{
              maxHeight: '480px',
              overflowY: 'auto',
              background: 'rgba(0, 0, 0, 0.45)',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'monospace',
              fontSize: '13px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                {isRtl ? 'لا توجد أنشطة مسجلة بعد' : 'No activity logged yet'}
              </div>
            ) : (
              logs.map((log) => {
                const colorMap = {
                  info: '#60a5fa',
                  success: '#34d399',
                  warn: '#fbbf24',
                  error: '#f87171',
                };
                return (
                  <div
                    key={log.id}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      paddingBottom: '6px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span style={{ color: colorMap[log.level], fontWeight: 'bold' }}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {log.message}
                      {log.details && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                          {log.details}
                        </div>
                      )}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Tab 3: Download & Scan Options */}
      {activeTab === 'settings' && (
        <div className="glass-panel" style={{ padding: '24px 28px', maxWidth: '800px', margin: '0 auto' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>
            {isRtl ? 'خيارات الفحص والتحميل' : 'Scan & Download Preferences'}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Scope */}
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                {isRtl ? 'نطاق استخراج الصور' : 'Photo Extraction Scope'}
              </label>
              <select
                value={scanOptions.scope}
                onChange={(e) => setScanOptions({ ...scanOptions, scope: e.target.value as any })}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              >
                <option value="all">{isRtl ? 'جميع صور الصفحة المتاحة (All accessible page photos)' : 'All accessible page photos'}</option>
                <option value="albums_only">{isRtl ? 'الألبومات فقط (Albums only)' : 'Albums only'}</option>
                <option value="timeline_only">{isRtl ? 'صور منشورات الخط الزمني فقط (Timeline post images only)' : 'Timeline post images only'}</option>
              </select>
            </div>

            {/* Organize into album folders */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>
                  {isRtl ? 'تنظيم داخل مجلدات فرعية حسب الألبوم' : 'Organize into album subfolders'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {isRtl
                    ? 'إنشاء مجلد مستقل لكل ألبوم داخل مجلد الحفظ المختار'
                    : 'Create a dedicated subfolder for each album inside the chosen folder'}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.createAlbumFolders}
                onChange={(e) => handleSaveSettings({ createAlbumFolders: e.target.checked })}
                style={{ width: '20px', height: '20px', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
            </div>

            {/* Skip Existing Files */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>
                  {isRtl ? 'تخطي الملفات المحملة مسبقاً' : 'Skip Existing Files'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {isRtl
                    ? 'فحص المجلد وتخطي الصور التي تم حفظها مسبقاً لمنع التكرار'
                    : 'Check disk and skip already downloaded images'}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.skipExisting}
                onChange={(e) => handleSaveSettings({ skipExisting: e.target.checked })}
                style={{ width: '20px', height: '20px', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
            </div>

            {/* Concurrency slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: '600', fontSize: '14px' }}>
                  {isRtl ? 'عدد التحميلات المتزامنة' : 'Concurrent Downloads (1-3)'}
                </span>
                <span style={{ fontWeight: '700', color: 'var(--primary)' }}>
                  {settings.concurrency}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="3"
                step="1"
                value={settings.concurrency}
                onChange={(e) => handleSaveSettings({ concurrency: parseInt(e.target.value, 10) })}
                style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {isRtl
                  ? 'يُنصح باختيار 2 لتحقيق توازن ممتاز بين السرعة وتجنب حظر الشبكة'
                  : 'Setting 2 is recommended for optimal speed and network reliability'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
