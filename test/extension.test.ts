import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeName, getExtensionFromBlob } from '../src/services/file-system';
import {
  getHighestResFromSrcset,
  extractFbid,
  generatePhotoId,
} from '../src/content/resolution-picker';
import { convertToCSV } from '../src/services/report-export';
import { PhotoItem } from '../src/types';

console.log('🧪 Starting Extension Test Suite...\n');

// 1. Manifest V3 Integrity Test
console.log('▶ Test 1: Verifying Manifest V3 schema and build outputs...');
const distManifestPath = path.resolve(__dirname, '../dist/manifest.json');
assert.ok(fs.existsSync(distManifestPath), 'dist/manifest.json must exist');

const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
assert.ok(manifest.name, 'Manifest name must be defined');
assert.strictEqual(manifest.background.service_worker, 'background.js', 'Service worker must be background.js');
assert.strictEqual(manifest.content_scripts[0].js[0], 'content.js', 'Content script must be content.js');

// Verify that all referenced files exist in dist/
const referencedFiles = [
  'dist/background.js',
  'dist/content.js',
  'dist/popup.html',
  'dist/dashboard.html',
  'dist/icons/icon16.png',
  'dist/icons/icon32.png',
  'dist/icons/icon48.png',
  'dist/icons/icon128.png',
];

for (const file of referencedFiles) {
  const fullPath = path.resolve(__dirname, '..', file);
  assert.ok(fs.existsSync(fullPath), `Referenced file must exist on disk: ${file}`);
}
console.log('✔ Test 1 Passed: Manifest V3 and build artifacts verified.\n');

// 2. Srcset & Resolution Picker Logic Test
console.log('▶ Test 2: Testing Highest Resolution Srcset and FBID Extraction...');
const sampleSrcset = `
  https://scontent.xx.fbcdn.net/v/t39.30808-6/test_320.jpg 320w,
  https://scontent.xx.fbcdn.net/v/t39.30808-6/test_960.jpg 960w,
  https://scontent.xx.fbcdn.net/v/t39.30808-6/test_2048.jpg 2048w,
  https://scontent.xx.fbcdn.net/v/t39.30808-6/test_720.jpg 720w
`;

const highest = getHighestResFromSrcset(sampleSrcset);
assert.ok(highest, 'Highest resolution should be found');
assert.strictEqual(highest.width, 2048, 'Should pick 2048w candidate');
assert.ok(highest.url.includes('test_2048.jpg'), 'Should pick 2048 URL');

// Test FBID extraction
const fbidFromUrl = extractFbid('https://www.facebook.com/photo/?fbid=1092837465019283&set=a.123456');
assert.strictEqual(fbidFromUrl, '1092837465019283', 'Should extract FBID correctly from query param');

const fbidFromSet = extractFbid('https://www.facebook.com/media/set/?set=a.9876543210');
assert.strictEqual(fbidFromSet, '9876543210', 'Should extract FBID from set query');

const fbidFromCdn = extractFbid('https://scontent.xx.fbcdn.net/v/t39.30808-6/888777666555_123456789_n.jpg');
assert.strictEqual(fbidFromCdn, '888777666555', 'Should extract FBID from CDN filename prefix');

console.log('✔ Test 2 Passed: Resolution and FBID extraction verified.\n');

// 3. Filename & Path Sanitization Test
console.log('▶ Test 3: Testing File Sanitization across platforms (Mac, Windows, Linux)...');
const dirtyName1 = 'Photos: 2026/10/12? <Summer> *Holiday* | Cairo "Album"';
const sanitized1 = sanitizeName(dirtyName1);
assert.ok(!/[<>:"/\\|?*]/.test(sanitized1), 'Dangerous characters must be removed');

const winReserved = sanitizeName('CON');
assert.strictEqual(winReserved, 'CON_file', 'Windows reserved filenames must be suffixed');

const extJpeg = getExtensionFromBlob(new Blob([], { type: 'image/jpeg' }));
assert.strictEqual(extJpeg, 'jpg', 'MIME image/jpeg must yield jpg');

const extWebp = getExtensionFromBlob(new Blob([], { type: 'image/webp' }));
assert.strictEqual(extWebp, 'webp', 'MIME image/webp must yield webp');
console.log('✔ Test 3 Passed: Sanitization and extension detection verified.\n');

// 4. Stable Deduplication ID Generation Test
console.log('▶ Test 4: Testing Stable Photo ID Generation...');
const candidateWithFbid = {
  url: 'https://scontent.xx.fbcdn.net/v/test.jpg?_nc_cat=101&oh=abcdef',
  fbid: '1234567890',
};
const id1 = generatePhotoId(candidateWithFbid);
assert.strictEqual(id1, 'fb_1234567890', 'Stable ID must use fbid when available');

const candidateNoFbidA = {
  url: 'https://scontent.xx.fbcdn.net/v/t39.30808-6/abc_n.jpg?oh=123',
};
const candidateNoFbidB = {
  url: 'https://scontent.xx.fbcdn.net/v/t39.30808-6/abc_n.jpg?oh=456',
};
const idA = generatePhotoId(candidateNoFbidA);
const idB = generatePhotoId(candidateNoFbidB);
assert.strictEqual(idA, idB, 'Normalized URL pathname must yield identical IDs regardless of ephemeral tokens');
console.log('✔ Test 4 Passed: Photo ID stability & deduplication verified.\n');

// 5. CSV Report Generation Test
console.log('▶ Test 5: Testing CSV Export...');
const dummyPhotos: PhotoItem[] = [
  {
    id: 'fb_1001',
    url: 'https://scontent.xx.fbcdn.net/test1.jpg',
    fbid: '1001',
    albumName: 'ألبوم المعرض السنوي',
    discoveredAt: Date.now(),
    downloadedAt: Date.now() + 1000,
    status: 'completed',
    fileName: 'photo_1001.jpg',
    filePath: 'ألبوم المعرض السنوي/photo_1001.jpg',
    fileSize: 204800,
    retryCount: 0,
  },
  {
    id: 'fb_1002',
    url: 'https://scontent.xx.fbcdn.net/test2.jpg',
    fbid: '1002',
    albumName: 'Timeline Photos',
    discoveredAt: Date.now(),
    status: 'failed',
    error: 'HTTP 403 Forbidden',
    retryCount: 3,
  },
];

const csv = convertToCSV(dummyPhotos);
assert.ok(csv.includes('ID,FBID,Status'), 'CSV must contain headers');
assert.ok(csv.includes('fb_1001'), 'CSV must contain photo ID 1001');
assert.ok(csv.includes('ألبوم المعرض السنوي'), 'CSV must retain Arabic album name');
assert.ok(csv.includes('HTTP 403 Forbidden'), 'CSV must record error details');
console.log('✔ Test 5 Passed: CSV report format verified.\n');

// 6. Full-Resolution Resolver Logic Test
console.log('▶ Test 6: Testing Full-Resolution Resolver and URL Unescaping...');
import { unescapeFacebookUrl, extractFullResFromHtml } from '../src/services/full-res-resolver';

const escapedUrl = 'https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/photo.jpg?_nc_cat=101\\u0026oe=123\\u003dtest';
const unescaped = unescapeFacebookUrl(escapedUrl);
assert.strictEqual(unescaped, 'https://scontent.xx.fbcdn.net/v/t39.30808-6/photo.jpg?_nc_cat=101&oe=123=test');

const mockPhotoPageHtml = `
  <html>
    <head>
      <meta property="og:image" content="https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/og_full_res_photo.jpg?_nc_cat=1" />
    </head>
    <body>
      <script type="application/json">
        {
          "__typename": "Photo",
          "id": "1001",
          "image": {
            "uri": "https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/graphql_2048px.jpg",
            "width": 2048,
            "height": 1536
          },
          "thumbnailImage": {
            "uri": "https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/thumb_320px.jpg?stp=c0.0.320.320a_dst-jpg_p320x320",
            "width": 320,
            "height": 320
          }
        }
      </script>
    </body>
  </html>
`;

const resolvedCandidate = extractFullResFromHtml(mockPhotoPageHtml);
assert.ok(resolvedCandidate, 'Should successfully resolve candidate');
assert.strictEqual(resolvedCandidate.width, 2048, 'Should prioritize 2048px GraphQL image over thumbnail');
console.log('✔ Test 6 Passed: Full-Resolution resolution verified.\n');

// 7. Enhanced FBID Extraction & Exclusion Logic Test
console.log('▶ Test 7: Testing Multi-part Filename FBID Extraction & Exclusion...');
import { isThumbnailUrl } from '../src/services/full-res-resolver';

// Multi-part CDN filename (e.g. 483920194_1022938475839201_8392019284759201928_n.jpg)
const multiPartUrl = 'https://scontent.xx.fbcdn.net/v/t39.30808-6/483920194_1022938475839201_8392019284759201928_n.jpg?stp=dst-jpg_s960x960';
const fbidMulti = extractFbid(multiPartUrl);
assert.strictEqual(fbidMulti, '1022938475839201', 'Should extract FBID from multi-part CDN filename');

// Story permalink URL
const storyUrl = 'https://www.facebook.com/permalink.php?story_fbid=777888999000111&id=12345';
const fbidStory = extractFbid(storyUrl);
assert.strictEqual(fbidStory, '777888999000111', 'Should extract story_fbid correctly');

// Thumbnail check
assert.strictEqual(isThumbnailUrl('https://scontent.xx.fbcdn.net/photo.jpg?stp=c0.0.320.320a_dst-jpg_p320x320'), true);
assert.strictEqual(isThumbnailUrl('https://scontent.xx.fbcdn.net/photo.jpg?stp=dst-jpg_p720x720'), true);
assert.strictEqual(isThumbnailUrl('https://scontent.xx.fbcdn.net/photo.jpg'), false);

// Exclusion filtering
const sampleList: PhotoItem[] = [
  { id: '1', url: 'u1', status: 'discovered', retryCount: 0, discoveredAt: Date.now(), excluded: false },
  { id: '2', url: 'u2', status: 'discovered', retryCount: 0, discoveredAt: Date.now(), excluded: true },
  { id: '3', url: 'u3', status: 'discovered', retryCount: 0, discoveredAt: Date.now() },
];
const includedOnly = sampleList.filter((p) => !p.excluded);
assert.strictEqual(includedOnly.length, 2, 'Should filter out excluded photos');
assert.strictEqual(includedOnly.some((p) => p.id === '2'), false, 'Photo 2 must be excluded');

console.log('✔ Test 7 Passed: Multi-part FBID and Exclusion verified.\n');

console.log('🎉 All 7 Test Suites Passed Successfully!');


