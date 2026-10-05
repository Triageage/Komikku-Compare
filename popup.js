/**
 * Komikku Compare - Popup Controller
 * Manages backup file ingestion, tab querying, title cleaning,
 * cross-referencing, and UI presentation for Zen Browser.
 */

(function () {
  'use strict';

  // Cross-browser extension API shim (Zen Browser / Firefox uses `browser`, Chrome uses `chrome`)
  const api = typeof browser !== 'undefined' ? browser : chrome;

  // Application State
  const state = {
    komikkuTitles: new Set(),
    komikkuTitlesList: [],
    backupFileName: '',
    highlightedTabs: [],
    lastComparisonResults: null
  };

  // DOM Elements
  const elements = {
    libraryBadge: document.getElementById('libraryBadge'),
    statusDot: document.getElementById('statusDot'),
    badgeText: document.getElementById('badgeText'),
    fileInput: document.getElementById('fileInput'),
    dropZone: document.getElementById('dropZone'),
    dropZoneContent: document.getElementById('dropZoneContent'),
    browseBtn: document.getElementById('browseBtn'),
    fileInfo: document.getElementById('fileInfo'),
    fileName: document.getElementById('fileName'),
    fileStats: document.getElementById('fileStats'),
    clearFileBtn: document.getElementById('clearFileBtn'),
    progressBarContainer: document.getElementById('progressBarContainer'),
    progressText: document.getElementById('progressText'),
    selectedTabsCountLabel: document.getElementById('selectedTabsCountLabel'),
    refreshTabsBtn: document.getElementById('refreshTabsBtn'),
    multiSelectNotice: document.getElementById('multiSelectNotice'),
    processBtn: document.getElementById('processBtn'),
    resultsSection: document.getElementById('resultsSection'),
    metricChecked: document.getElementById('metricChecked'),
    metricInLibrary: document.getElementById('metricInLibrary'),
    metricMissing: document.getElementById('metricMissing'),
    filterInput: document.getElementById('filterInput'),
    copyBtn: document.getElementById('copyBtn'),
    resultsList: document.getElementById('resultsList'),
    allFoundState: document.getElementById('allFoundState'),
    openTabBtn: document.getElementById('openTabBtn'),
    foundCollapsible: document.getElementById('foundCollapsible'),
    foundToggleBtn: document.getElementById('foundToggleBtn'),
    foundToggleCount: document.getElementById('foundToggleCount'),
    foundListContainer: document.getElementById('foundListContainer')
  };

  // Storage Keys
  const STORAGE_KEY_BACKUP = 'komikku_compare_backup_data_v2';

  /**
   * Initializes extension popup.
   */
  async function init() {
    setupEventListeners();
    await restoreSavedLibrary();
    await updateHighlightedTabs();

    // Listen for storage changes from upload tab
    if (api.storage && api.storage.onChanged) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY_BACKUP]) {
          restoreSavedLibrary();
        }
      });
    }
  }

  /**
   * Opens the file selection dialog or dedicated upload tab.
   * In Firefox/Zen Browser, opening an OS file picker inside a popup steals focus,
   * causing Firefox to automatically destroy the popup. To prevent this,
   * we open the dedicated upload tab unless already running in a full tab.
   */
  function triggerSafeFileSelect() {
    const isFullTab = window.innerWidth > 500 || window.location.search.includes('tab=1');
    if (isFullTab) {
      elements.fileInput.click();
    } else {
      api.tabs.create({ url: 'upload.html?auto=1' });
    }
  }

  /**
   * Registers DOM event handlers.
   */
  function setupEventListeners() {
    // Open in full tab button
    if (elements.openTabBtn) {
      elements.openTabBtn.addEventListener('click', () => {
        api.tabs.create({ url: 'popup.html?tab=1' });
      });
    }

    // File upload triggers (safe against Firefox popup focus loss)
    elements.browseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerSafeFileSelect();
    });

    elements.dropZone.addEventListener('click', (e) => {
      if (state.komikkuTitles.size > 0) return; // Don't trigger if file already loaded
      if (e.target.closest('#clearFileBtn')) return;
      triggerSafeFileSelect();
    });

    elements.fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop support (works 100% inside popup without focus loss!)
    elements.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.dropZone.classList.add('dragover');
    });

    elements.dropZone.addEventListener('dragleave', () => {
      elements.dropZone.classList.remove('dragover');
    });

    elements.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processUploadedFile(e.dataTransfer.files[0]);
      }
    });

    // Clear backup
    elements.clearFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearLibrary();
    });

    // Refresh tabs
    elements.refreshTabsBtn.addEventListener('click', () => {
      updateHighlightedTabs();
    });

    // Process selected tabs
    elements.processBtn.addEventListener('click', handleProcessSelectedTabs);

    // Found manga collapsible toggle
    if (elements.foundToggleBtn) {
      elements.foundToggleBtn.addEventListener('click', () => {
        elements.foundListContainer.classList.toggle('hidden');
        elements.foundToggleBtn.classList.toggle('open');
      });
    }

    // Search filter
    elements.filterInput.addEventListener('input', () => {
      if (state.lastComparisonResults) {
        renderResultsList(state.lastComparisonResults.missingByDomain, elements.filterInput.value.trim());
      }
    });

    // Copy missing list
    elements.copyBtn.addEventListener('click', handleCopyResults);
  }

  /**
   * Restores previously loaded backup from storage if available.
   */
  async function restoreSavedLibrary() {
    try {
      if (!api.storage || !api.storage.local) return;
      const data = await api.storage.local.get(STORAGE_KEY_BACKUP);
      if (data && data[STORAGE_KEY_BACKUP]) {
        const saved = data[STORAGE_KEY_BACKUP];
        if (Array.isArray(saved.titles) && saved.titles.length > 0) {
          state.komikkuTitles = new Set(saved.titles.map(t => t.toLowerCase()));
          state.komikkuTitlesList = saved.titles;
          state.backupFileName = saved.fileName || 'backup.tachibk';

          showLoadedFileUI(state.backupFileName, state.komikkuTitles.size);
        }
      }
    } catch (e) {
      console.warn('Could not restore cached backup:', e);
    }
  }

  /**
   * Persists parsed titles to storage for subsequent popup opens.
   */
  async function saveLibraryToStorage(fileName, titlesList) {
    try {
      if (!api.storage || !api.storage.local) return;
      await api.storage.local.set({
        [STORAGE_KEY_BACKUP]: {
          fileName: fileName,
          titles: titlesList,
          savedAt: Date.now()
        }
      });
    } catch (e) {
      console.warn('Storage save error (library will stay in session memory):', e);
    }
  }

  /**
   * Clears stored library.
   */
  async function clearLibrary() {
    state.komikkuTitles.clear();
    state.komikkuTitlesList = [];
    state.backupFileName = '';
    state.lastComparisonResults = null;

    try {
      if (api.storage && api.storage.local) {
        await api.storage.local.remove(STORAGE_KEY_BACKUP);
      }
    } catch (e) {}

    // Reset UI
    elements.fileInput.value = '';
    elements.fileInfo.classList.add('hidden');
    elements.dropZoneContent.classList.remove('hidden');
    elements.statusDot.classList.remove('active');
    elements.badgeText.textContent = 'No backup loaded';
    elements.resultsSection.classList.add('hidden');

    updateProcessButtonState();
  }

  /**
   * Queries highlighted tabs in the active window.
   */
  async function updateHighlightedTabs() {
    try {
      // Query ONLY tabs selected/highlighted in current active window
      const tabs = await api.tabs.query({ highlighted: true, currentWindow: true });
      state.highlightedTabs = tabs || [];

      const count = state.highlightedTabs.length;

      if (count === 0) {
        elements.selectedTabsCountLabel.textContent = 'No tabs selected';
        elements.multiSelectNotice.classList.remove('hidden');
      } else if (count === 1) {
        elements.selectedTabsCountLabel.textContent = '1 tab selected';
        // Show friendly reminder to multi-select
        elements.multiSelectNotice.classList.remove('hidden');
      } else {
        elements.selectedTabsCountLabel.textContent = `${count} tabs selected`;
        // Multi-selection is active! Hide reminder
        elements.multiSelectNotice.classList.add('hidden');
      }

      updateProcessButtonState();
    } catch (err) {
      console.error('Error querying highlighted tabs:', err);
      elements.selectedTabsCountLabel.textContent = 'Unable to query tabs';
    }
  }

  /**
   * Updates state of Process button based on library and tab selection.
   */
  function updateProcessButtonState() {
    const hasLibrary = state.komikkuTitles.size > 0;
    const hasTabs = state.highlightedTabs.length > 0;
    elements.processBtn.disabled = !hasLibrary || !hasTabs;
  }

  /**
   * Handles file selection from file input.
   */
  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFile(e.target.files[0]);
    }
  }

  /**
   * Processes uploaded .tachibk backup file.
   */
  async function processUploadedFile(file) {
    if (!file) return;

    // Show progress
    elements.progressBarContainer.classList.remove('hidden');
    elements.progressText.textContent = `Decompressing ${file.name}...`;

    try {
      // Allow DOM to update progress animation
      await new Promise(resolve => setTimeout(resolve, 30));

      const parsed = await BackupParser.parseKomikkuBackup(file);

      if (parsed.count === 0) {
        alert('No manga titles could be extracted from this file. Please ensure it is a valid Komikku or Tachiyomi backup (.tachibk / .proto.gz).');
        elements.progressBarContainer.classList.add('hidden');
        return;
      }

      state.komikkuTitles = parsed.titles;
      state.komikkuTitlesList = parsed.titlesList;
      state.backupFileName = file.name;

      // Save to local storage for persistence
      await saveLibraryToStorage(file.name, parsed.titlesList);

      showLoadedFileUI(file.name, parsed.count);
    } catch (err) {
      console.error('Failed to parse backup:', err);
      alert(`Error reading backup: ${err.message}`);
    } finally {
      elements.progressBarContainer.classList.add('hidden');
      updateProcessButtonState();
    }
  }

  /**
   * Updates the UI when a backup file is loaded.
   */
  function showLoadedFileUI(fileName, count) {
    elements.dropZoneContent.classList.add('hidden');
    elements.fileInfo.classList.remove('hidden');
    elements.fileName.textContent = fileName;
    elements.fileStats.textContent = `✓ ${count.toLocaleString()} manga titles indexed`;

    elements.statusDot.classList.add('active');
    elements.badgeText.textContent = `${count.toLocaleString()} loaded`;
    elements.libraryBadge.title = `${count.toLocaleString()} manga titles loaded from ${fileName}`;

    updateProcessButtonState();
  }

  /**
   * Processes the selected (highlighted) tabs against the loaded Komikku library.
   */
  async function handleProcessSelectedTabs() {
    if (state.komikkuTitles.size === 0) {
      alert('Please upload a Komikku backup file first.');
      return;
    }

    // Refresh highlighted tabs to ensure we have the exact latest selection
    await updateHighlightedTabs();

    if (state.highlightedTabs.length === 0) {
      alert('No tabs are currently selected in this window.');
      return;
    }

    // Cross-reference tabs with library
    const comparison = MangaMatcher.compareTabsWithLibrary(
      state.highlightedTabs,
      state.komikkuTitles
    );

    state.lastComparisonResults = comparison;

    // Update UI Metrics
    elements.resultsSection.classList.remove('hidden');
    elements.metricChecked.textContent = comparison.totalTabs;
    elements.metricInLibrary.textContent = comparison.foundCount;
    elements.metricMissing.textContent = comparison.missingCount;

    // Reset search filter
    elements.filterInput.value = '';

    // Render Results List
    if (comparison.missingCount === 0) {
      elements.resultsList.classList.add('hidden');
      elements.allFoundState.classList.remove('hidden');
    } else {
      elements.allFoundState.classList.add('hidden');
      elements.resultsList.classList.remove('hidden');
      renderResultsList(comparison.missingByDomain, '');
    }

    // Render Found in Library collapsible
    if (comparison.foundCount > 0 && elements.foundCollapsible) {
      elements.foundCollapsible.classList.remove('hidden');
      elements.foundToggleCount.textContent = comparison.foundCount;
      renderFoundList(comparison.found);
    } else if (elements.foundCollapsible) {
      elements.foundCollapsible.classList.add('hidden');
    }

    // Scroll results into view smoothly
    elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Renders the grouped missing manga list.
   * @param {Record<string, Array<{ id: number, cleanedTitle: string, originalTitle: string, url: string, domain: string }>>} grouped
   * @param {string} filterText
   */
  function renderResultsList(grouped, filterText = '') {
    elements.resultsList.innerHTML = '';
    const query = filterText.toLowerCase();

    const domainKeys = Object.keys(grouped).sort();
    let totalRendered = 0;

    for (const domain of domainKeys) {
      let items = grouped[domain];

      if (query) {
        items = items.filter(
          item =>
            item.cleanedTitle.toLowerCase().includes(query) ||
            item.originalTitle.toLowerCase().includes(query) ||
            domain.toLowerCase().includes(query)
        );
      }

      if (items.length === 0) continue;
      totalRendered += items.length;

      const groupEl = document.createElement('div');
      groupEl.className = 'domain-group';

      // Domain Header
      const headerEl = document.createElement('div');
      headerEl.className = 'domain-header';
      headerEl.innerHTML = `
        <div class="domain-info">
          <span class="domain-name">${escapeHtml(domain)}</span>
        </div>
        <span class="domain-badge">${items.length} missing</span>
      `;
      groupEl.appendChild(headerEl);

      // Manga Items Container
      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'manga-items-container';

      for (const item of items) {
        const itemEl = document.createElement('div');
        itemEl.className = 'manga-item';

        const detailsEl = document.createElement('div');
        detailsEl.className = 'manga-details';

        const cleanTitleEl = document.createElement('div');
        cleanTitleEl.className = 'manga-clean-title';
        cleanTitleEl.textContent = item.cleanedTitle;
        cleanTitleEl.title = item.cleanedTitle;

        const rawTitleEl = document.createElement('div');
        rawTitleEl.className = 'manga-raw-title';
        rawTitleEl.textContent = item.originalTitle;
        rawTitleEl.title = item.url;

        detailsEl.appendChild(cleanTitleEl);
        detailsEl.appendChild(rawTitleEl);

        // Switch to Tab Button
        const switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.className = 'btn-switch-tab';
        switchBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span>Go to tab</span>
        `;
        switchBtn.addEventListener('click', () => {
          activateTab(item.id, item.windowId);
        });

        itemEl.appendChild(detailsEl);
        itemEl.appendChild(switchBtn);
        itemsContainer.appendChild(itemEl);
      }

      groupEl.appendChild(itemsContainer);
      elements.resultsList.appendChild(groupEl);
    }

    if (totalRendered === 0 && query) {
      elements.resultsList.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">
          No missing manga matching "<strong>${escapeHtml(query)}</strong>"
        </div>
      `;
    }
  }

  /**
   * Renders the list of manga that were found in the Komikku library.
   * Provides full transparency into what matched and why.
   * @param {Array<{ cleanedTitle: string, originalTitle: string, matchedWith: string }>} foundItems
   */
  function renderFoundList(foundItems) {
    if (!elements.foundListContainer) return;
    elements.foundListContainer.innerHTML = '';

    for (const item of foundItems) {
      const el = document.createElement('div');
      el.className = 'found-item';
      el.innerHTML = `
        <span class="found-item-title" title="${escapeHtml(item.originalTitle)}">${escapeHtml(item.cleanedTitle)}</span>
        <span class="found-item-matched" title="Matched with library entry: ${escapeHtml(item.matchedWith)}">✓ ${escapeHtml(item.matchedWith)}</span>
      `;
      elements.foundListContainer.appendChild(el);
    }
  }

  /**
   * Activates and focuses a specific browser tab.
   * @param {number} tabId
   * @param {number} windowId
   */
  async function activateTab(tabId, windowId) {
    try {
      await api.tabs.update(tabId, { active: true });
      if (windowId) {
        await api.windows.update(windowId, { focused: true });
      }
    } catch (e) {
      console.warn('Could not switch to tab:', e);
    }
  }

  /**
   * Copies missing manga list to system clipboard.
   */
  async function handleCopyResults() {
    if (!state.lastComparisonResults || state.lastComparisonResults.missing.length === 0) {
      return;
    }

    const { missingByDomain, missingCount } = state.lastComparisonResults;
    let text = `# Missing Manga (${missingCount} total)\n\n`;

    for (const [domain, items] of Object.entries(missingByDomain)) {
      text += `### ${domain} (${items.length})\n`;
      for (const item of items) {
        text += `- ${item.cleanedTitle}: ${item.url}\n`;
      }
      text += '\n';
    }

    try {
      await navigator.clipboard.writeText(text);
      const originalSpan = elements.copyBtn.querySelector('span');
      const prevText = originalSpan.textContent;
      originalSpan.textContent = 'Copied!';
      setTimeout(() => {
        originalSpan.textContent = prevText;
      }, 1500);
    } catch (e) {
      alert('Failed to copy to clipboard.');
    }
  }

  /**
   * Helper to escape HTML strings.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize once DOM is ready
  document.addEventListener('DOMContentLoaded', init);
})();
