# Komikku Compare — Zen Browser & Firefox Extension

A high-performance Manifest V3 browser extension built specifically for **Zen Browser** and **Firefox** that cross-references your selected browser tabs with your **Komikku** (or **Tachiyomi** / **Mihon**) library backup (`.tachibk`) to reveal missing manga, identify duplicate entries across sources, and manage your library categories.

---

## Key Features

### 1. Tab Comparison & Missing Manga Detection
- **Zen Browser Multi-Tab Querying**:
  - Queries **only** the tabs you have highlighted/selected in the active window (`browser.tabs.query({ highlighted: true, currentWindow: true })`).
  - Helpful tooltip reminder if only 1 tab is selected (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + click or <kbd>Shift</kbd> + click to multi-select).
- **Intelligent Title Cleaning**:
  - Strips scanlation SEO junk, chapter numbers, website domain names, and delimiters (`-`, `|`, `–`, `—`, `~`, `»`, `•`, etc.).
  - Handles chapter-first formats (e.g. `Ch. 142 - Jujutsu Kaisen - MangaDex` &rarr; `jujutsu kaisen`).
  - Cleans keywords like `Read`, `Chapter [X]`, `Online`, `Free`, `[RAW]`, `(Official)`.
- **Bidirectional & Normalized Matching**:
  - Exact match, bidirectional substring match, and punctuation-normalized matching (`SPY×FAMILY` &harr; `spy x family`).
- **Domain-Grouped Results**:
  - Groups missing manga by source domain (e.g. `mangadex.org`, `weebcentral.com`).
  - One-click **"Go to tab"** button to jump directly to any tab.
  - Markdown export copy button.
- **Tab Hygiene (Close Found Tabs)**:
  - One-click action to close all tabs already present in your library, leaving only missing manga open.

### 2. Library Explorer with Sources & Categories
- **Complete Library Overview**:
  - Displays total manga count, unique titles, source count, category count, and duplicate count.
- **Side-by-Side Unified Dropdowns**:
  - **Sources Dropdown**: Filter by source extension (e.g., MangaDex, Weeb Central, Asura, Flame) with title counts.
  - **Categories Dropdown**: Sits directly next to the Sources dropdown to filter by user-created categories (e.g., `Favorites`, `Manhwa`, `Completed`) with counts, plus an `Uncategorized` filter.
  - If a backup file has no categories, the dropdown clearly displays **"No categories yet"**.
  - **Simultaneous Filtering**: Search queries, source filters, and category filters operate concurrently.
- **Rich Manga Cards**:
  - Displays title, author/artist, URL path, distinct colored source pill (`.source-pill`), category badges (`📁 Category`), and duplicate alert badges.

### 3. Duplicate Detection, Priority Ranking & Cleanup
- **Cross-Source & Same-Source Duplicate Detection**:
  - Identifies duplicate entries across identical or different sources using canonical title normalization.
- **Automated Duplicate Selection Rules**:
  - **By Source Priorities**: Retain copies from your preferred sources based on customizable drag/button priority rankings.
  - **Keep Oldest Added**: Preserves the first entry added to your library and marks newer duplicates for deletion.
  - **Keep Newest Added**: Preserves the most recently added entry and marks older copies for deletion.
  - **Select All Duplicates**: Keeps 1 entry per group and marks all redundant copies.
- **Granular Manual Selection**:
  - Interactive checkboxes on every duplicate entry with clear `✓ KEEP` vs `🗑 DELETE` designation badges and date added timestamps.
- **Clean Backup Export**:
  - Excises selected duplicate manga directly from the Protobuf binary structure.
  - Downloads a clean, updated `.tachibk` file ready to restore in Komikku.

### 4. Fast Offline Parsing & Security
- **100% Offline & Private**: Zero external network requests; all parsing, matching, and de-duplication happen in-browser.
- **Protobuf Binary Reader**: High-speed, zero-dependency parser extracts `BackupManga`, `BackupSource`, and `BackupCategory` fields.
- **IndexedDB & Local Storage Caching**: Persists your library across popup sessions so you don't need to re-upload on every open.
- **AMO Compliant**: Fully compliant with Mozilla Add-on Store policies (no unsafe `innerHTML` with dynamic content).

---

## Project Structure

```text
Komikku Compare/
├── manifest.json              # Manifest V3 extension configuration (Gecko ID for Zen/Firefox)
├── popup.html                 # Main popup UI (Compare view, Library Explorer, modals)
├── popup.css                  # Dark mode Zen-browser aesthetic stylesheet
├── popup.js                   # Application state, event handlers, and UI rendering
├── upload.html                # Full-page drag-and-drop backup upload view
├── upload.js                  # Full-page upload controller
├── package-extension.ps1      # Mozilla AMO packaging script (POSIX forward slashes)
├── README.md                  # Project documentation
├── lib/
│   ├── backup-parser.js       # Protobuf binary reader, duplicate detection & cleanup engine
│   ├── backup-storage.js      # IndexedDB backup buffer persistence manager
│   ├── matcher.js             # Title matching and normalization engine
│   ├── pako.min.js            # Bundled GZIP decompression/compression library
│   └── title-cleaner.js       # Scanlation title cleaner & sanitizer
├── icons/
│   ├── icon.svg               # Extension vector icon
│   ├── icon-16.png            # 16x16 icon
│   ├── icon-32.png            # 32x32 icon
│   ├── icon-48.png            # 48x48 icon
│   └── icon-128.png           # 128x128 icon
└── test/
    ├── test-runner.html       # Automated browser test suite (78 tests)
    └── test_category_ui_interaction.html # Category parsing & unified dropdown test suite
```

---

## Installation & Testing

### Loading as a Temporary Extension in Zen Browser / Firefox

1. Open **Zen Browser** (or **Firefox**).
2. Navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
3. Click **"Load Temporary Add-on..."**.
4. Browse to the extension directory and select **`manifest.json`**.
5. The **Komikku Compare** icon will appear in your browser toolbar!

### Packaging for Mozilla Add-on Store (AMO)

To build a clean zip archive compliant with Mozilla AMO requirements:
```powershell
powershell -ExecutionPolicy Bypass -File package-extension.ps1
```
This generates `komikku-compare-v1.1.0.zip` with normalized POSIX forward slashes.

---

## How to Use

1. **Load Your Backup**:
   - Click the extension icon in your browser toolbar.
   - Drop your `.tachibk` file into the upload area (or use the full-page upload).
2. **Compare Selected Tabs**:
   - Multi-select manga tabs in Zen Browser (<kbd>Ctrl</kbd> + click or <kbd>Shift</kbd> + click).
   - In the popup, click **"Process Selected Tabs"** to view missing vs. library titles.
3. **Explore Your Library & Filter**:
   - Switch to the **Library & Duplicates** tab.
   - Use the **Sources** dropdown and **Categories** dropdown side-by-side to filter your collection.
   - Use the search bar to find manga by title, author, artist, source, or category.
4. **Manage & Clean Duplicates**:
   - Click the **Duplicates** toggle button to inspect duplicate groups.
   - Use **Auto-Select ▾** to apply cleanup rules (by source priorities, oldest, or newest).
   - Click **"Delete Selected"** to preview and confirm removal.
   - Click **"Download Cleaned .tachibk"** to save your updated backup file and restore it in Komikku.
