# Facebook Page Photo Downloader (تحميل صور صفحات فيسبوك)

A complete, production-ready Google Chrome extension designed to scan and download all photos from Facebook Pages that you own or manage, directly into a folder selected on your computer via the native File System Access API.

---

## 🌟 Key Features

1. **Native Folder Selection**:
   - Uses Chrome's **File System Access API** (`showDirectoryPicker()`) from a persistent dashboard tab.
   - Saves downloaded photos directly into your chosen local folder on Mac or Windows without prompting per image.
   - Automatically organizes photos into subfolders by album when enabled.
   - Built-in fallback to Chrome Downloads API if filesystem access is restricted.

2. **Smart Photo Discovery Engine**:
   - Multi-strategy DOM extraction with fallback selectors (works with modern Facebook desktop layouts).
   - Handles Facebook dynamic rendering and infinite scrolling with intelligent bottom detection.
   - Filters out Facebook UI assets, avatars, reaction stickers, emojis, and advertisement banners.
   - Stable deduplication engine using Facebook IDs (`fbid`) and normalized CDN hashes.
   - Authentic resolution picker: extracts the highest available resolution from Facebook `srcset` attributes and full-size image links without fake upscaling.

3. **Persistent Download Manager**:
   - Controls: **Download All**, **Pause**, **Resume**, **Cancel**, and **Retry Failed**.
   - Adjustable concurrency (1 to 3 concurrent downloads).
   - Automatic exponential backoff retry on temporary network hiccups.
   - Deduplication & skip existing: checks target disk folder and IndexedDB state before downloading.
   - Session persistence via **IndexedDB**: active state is never lost if the popup closes or the service worker goes idle.

4. **Modern Arabic RTL Interface**:
   - First-class Arabic user interface with RTL layout support and English toggle.
   - Standardized requested Arabic labels:
     - **اختيار مجلد الحفظ** (Choose Download Folder)
     - **فحص صور الصفحة** (Scan Page Photos)
     - **الصور المكتشفة** (Discovered Photos)
     - **تحميل جميع الصور** (Download All)
     - **إيقاف مؤقت** (Pause)
     - **استكمال التحميل** (Resume)
     - **إعادة محاولة الملفات الفاشلة** (Retry Failed)
     - **اكتمل التحميل** (Download Complete)
   - Real-time statistics: Discovered, Downloaded, Pending, Failed, Skipped, and Progress percentage.
   - Live activity log and photo preview gallery.
   - Report export: Export full audit report in **CSV** or **JSON** format.

---

## 📁 Project Structure

```
facebook-photo-downloader/
├── package.json
├── tsconfig.json
├── vite.config.ts            # Main Vite config for popup, dashboard, and background
├── vite.content.config.ts    # Dedicated IIFE bundle config for content script
├── popup.html                # Extension popup entry point
├── dashboard.html            # Persistent extension dashboard tab
├── public/
│   ├── manifest.json         # Manifest V3 configuration
│   └── icons/                # Extension icons (16, 32, 48, 128)
├── src/
│   ├── types/index.ts        # TypeScript data contracts & message definitions
│   ├── background/
│   │   └── background.ts     # Service worker: badge management, tab coordination
│   ├── content/
│   │   ├── content.ts        # Content script entry & floating status pill
│   │   ├── fb-scanner.ts     # Infinite scroll & modular DOM discovery engine
│   │   ├── page-detector.ts  # Page name, active tab & album classification
│   │   └── resolution-picker.ts # Srcset parser, FBID extraction & asset filter
│   ├── services/
│   │   ├── db.ts             # IndexedDB persistence (photos, handles, logs, settings)
│   │   ├── file-system.ts    # File System Access API & file writing
│   │   ├── download-manager.ts # Concurrency queue, backoff retry & state management
│   │   └── report-export.ts  # CSV and JSON manifest exporter
│   ├── dashboard/
│   │   ├── DashboardApp.tsx  # Full persistent control center React component
│   │   └── main.tsx
│   ├── popup/
│   │   ├── PopupApp.tsx      # Quick inspection popup React component
│   │   └── main.tsx
│   └── styles/
│       └── globals.css       # Glassmorphism dark theme & Arabic typography
├── dist/                     # Production build ready to load in Chrome
└── test/
    └── extension.test.ts     # Automated unit & integration tests
```

---

## 🚀 How to Install in Google Chrome

1. Clone or download the repository:
   ```bash
   git clone https://github.com/Mahmoudhodhod/facebook-page-photo-downloader.git
   cd facebook-page-photo-downloader
   ```
2. Install dependencies & build (already pre-built in `dist/`):
   ```bash
   npm install
   npm run build
   ```
3. Open Google Chrome and go to `chrome://extensions/`.
4. In the top-right corner, enable **Developer mode** (وضع مطور البرامج).
5. Click the **Load unpacked** (تحميل برمجية غير معبأة) button.
6. In the file picker, select the `dist` folder inside the project.
7. The extension **Facebook Page Photo Downloader** is now installed and will appear in your Chrome toolbar.

---

## 🧪 Testing Against Your Facebook Page

Follow this workflow:

1. **Log in to Facebook**:
   - Open Chrome and log into your Facebook account normally.
2. **Navigate to your Page**:
   - Go to your managed Facebook Page (e.g. `https://www.facebook.com/YourPage/photos` or any album).
3. **Open the Extension**:
   - Click the extension icon in the Chrome toolbar.
   - Click **فتح لوحة التحكم المستمرة (Open Persistent Dashboard)** to open the dedicated control tab.
4. **Choose Destination Folder**:
   - Click **اختيار مجلد الحفظ (Choose Download Folder)**.
   - A native folder selection dialog opens. Select any folder on your Mac or Windows computer.
   - The selected folder name will be displayed in green.
5. **Scan Photos**:
   - Click **فحص صور الصفحة (Scan Page Photos)**.
   - The scanner begins scrolling and extracting images from the page.
   - Discovered photos appear in real-time in the gallery and statistics cards.
6. **Download Photos**:
   - Click **تحميل جميع الصور (Download All)**.
   - Images are saved directly into your local directory.
   - You can pause, resume, cancel, or retry failed downloads anytime.
7. **Export Report**:
   - Click **CSV** or **JSON** to download a complete manifest report of all discovered and downloaded files.

---

## 🔒 Security & Privacy

- **Zero Credential Collection**: Never prompts for or collects Facebook passwords, cookies, or session tokens.
- **100% Client-Side**: All photo downloads stream directly from Facebook's CDN straight to your local hard drive. No intermediary servers are involved.
- **Respects Facebook Access**: Scans only what is visible and accessible through your authenticated browser session.
