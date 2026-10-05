# Komikku Compare — Zen Browser Extension

A high-performance Manifest V3 browser extension built specifically for **Zen Browser** (and Firefox) that cross-references your currently selected (highlighted) browser tabs with a **Komikku** (or **Tachiyomi** / **Mihon**) backup file (`.tachibk`) to reveal which manga you haven't added to your library yet.

---

## Features

- **Zen Browser Multi-Tab Querying**:
  - Queries **only** the tabs you have highlighted/selected in the active window (`browser.tabs.query({ highlighted: true, currentWindow: true })`).
  - Friendly smart reminder appears if only 1 tab is highlighted, teaching you how to multi-select tabs in Zen Browser (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + click or <kbd>Shift</kbd> + click).
- **Fast Offline .tachibk Parsing**:
  - Automatically decompresses GZIP-compressed Protocol Buffers via native browser `DecompressionStream('gzip')` with bundled `pako.min.js` fallback.
  - Zero-dependency binary Protobuf reader extracts Field 3 (manga title) from `BackupManga` (Field 1).
  - Built-in heuristic scanner and JSON backup fallback to support variations across Tachiyomi forks (Mihon, Komikku, TachiyomiSY, Neko).
  - Persists parsed library in browser storage so you don't need to re-upload every time the popup opens.
- **Intelligent Title Cleaning**:
  - Strips scanlation SEO junk, chapter numbers, domain names, and delimiters (`-`, `|`, `–`, `—`, `~`, `»`, `•`, `:`, etc.).
  - Handles chapter-first formats like MangaDex (`Ch. 142 - Jujutsu Kaisen - MangaDex` &rarr; `jujutsu kaisen`).
  - Strips words like `Read`, `Chapter [X]`, `Online`, `Free`, `[RAW]`, `(Official)`, etc.
- **Bidirectional & Normalized Matching**:
  - Exact match, bidirectional substring match, and punctuation-normalized matching (`SPY×FAMILY` &harr; `spy x family`).
- **Domain-Grouped Results**:
  - Groups missing manga by source domain (e.g. `mangakakalot.com`, `mangadex.org`).
  - One-click "Go to tab" button to instantly switch to and focus the tab.
  - Quick search filter and one-click "Copy" export formatted as Markdown.

---

## File Structure

```
Komikku Compare/
├── manifest.json              # Manifest V3 configuration with Gecko ID for Zen Browser
├── popup.html                 # Modern Zen-themed extension popup interface
├── popup.css                  # Dark mode styling with glowing accents and smooth micro-animations
├── popup.js                   # Popup orchestrator, tab queries, and storage handling
├── lib/
│   ├── pako.min.js            # Bundled lightweight GZIP decompression library
│   ├── backup-parser.js       # Binary Protobuf and GZIP reader for .tachibk files
│   ├── title-cleaner.js       # Scanlation SEO spam & chapter cleaner
│   └── matcher.js             # Exact, substring, and normalized library comparator
├── icons/
│   ├── icon.svg               # Vector icon
│   ├── icon-16.png            # 16x16 icon
│   ├── icon-32.png            # 32x32 icon
│   ├── icon-48.png            # 48x48 icon
│   └── icon-128.png           # 128x128 icon
└── test/
    └── test-runner.html       # Automated browser test suite verifying all logic
```

---

## Installation in Zen Browser

1. Open **Zen Browser**.
2. In the URL bar, type:
   ```text
   about:debugging#/runtime/this-firefox
   ```
   and press <kbd>Enter</kbd>.
3. Click the **"Load Temporary Add-on..."** button.
4. Navigate to this folder (`c:\Users\krohi\Downloads\Komikku Compare`) and select **`manifest.json`**.
5. The **Komikku Compare** icon will now appear in your Zen Browser toolbar!

---

## How to Use

1. **Upload Backup**:
   - Click the extension icon in Zen Browser.
   - Drag and drop your `.tachibk` file into the upload box (or click "browse files").
   - The extension will decompress and index your manga library.
2. **Select Tabs**:
   - In Zen Browser, hold <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on macOS) and click tabs across your tab bar to multi-select the manga tabs you want to check.
   - Alternatively, hold <kbd>Shift</kbd> to select a continuous range of tabs.
3. **Compare**:
   - Click the extension icon and click **"Process Selected Tabs"**.
4. **Review Results**:
   - Missing manga are grouped by website domain.
   - Click **"Go to tab"** next to any item to switch straight to that tab.
   - Click **"Copy"** to copy the missing manga list formatted in Markdown.
