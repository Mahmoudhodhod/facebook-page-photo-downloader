import { getAllPhotos } from './db';
import { PhotoItem } from '../types';

export function convertToCSV(photos: PhotoItem[]): string {
  const headers = [
    'ID',
    'FBID',
    'Status',
    'File Name',
    'File Path',
    'File Size (Bytes)',
    'Album Name',
    'Discovered Date',
    'Downloaded Date',
    'Image URL',
    'Error Message',
  ];

  const escapeCSV = (field: any) => {
    if (field === null || field === undefined) return '""';
    const str = String(field).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = photos.map((p) => [
    escapeCSV(p.id),
    escapeCSV(p.fbid || ''),
    escapeCSV(p.status),
    escapeCSV(p.fileName || ''),
    escapeCSV(p.filePath || ''),
    escapeCSV(p.fileSize || 0),
    escapeCSV(p.albumName || ''),
    escapeCSV(p.discoveredAt ? new Date(p.discoveredAt).toISOString() : ''),
    escapeCSV(p.downloadedAt ? new Date(p.downloadedAt).toISOString() : ''),
    escapeCSV(p.url),
    escapeCSV(p.error || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

export async function exportReportCSV(): Promise<void> {
  const photos = await getAllPhotos();
  const csvContent = '\uFEFF' + convertToCSV(photos); // Include UTF-8 BOM for Arabic support in Excel
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerBrowserDownload(blob, `facebook_photos_manifest_${Date.now()}.csv`);
}

export async function exportReportJSON(): Promise<void> {
  const photos = await getAllPhotos();
  const jsonContent = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalPhotos: photos.length,
      photos,
    },
    null,
    2
  );
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  triggerBrowserDownload(blob, `facebook_photos_manifest_${Date.now()}.json`);
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
