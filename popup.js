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
    originalBackupBuffer: null,
    highlightedTabs: [],
    lastComparisonResults: null,
    lastExportedTabs: []
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
    downloadBackupCard: document.getElementById('downloadBackupCard'),
    downloadMissingCount: document.getElementById('downloadMissingCount'),
    downloadBackupBtn: document.getElementById('downloadBackupBtn'),
    downloadBackupBtnText: document.getElementById('downloadBackupBtnText'),
    downloadInstructions: document.getElementById('downloadInstructions'),
    closeExportedTabsBtn: document.getElementById('closeExportedTabsBtn'),
    closeExportedTabsBtnText: document.getElementById('closeExportedTabsBtnText'),
    filterInput: document.getElementById('filterInput'),
    copyBtn: document.getElementById('copyBtn'),
    resultsList: document.getElementById('resultsList'),
    allFoundState: document.getElementById('allFoundState'),
    openTabBtn: document.getElementById('openTabBtn'),
    foundCollapsible: document.getElementById('foundCollapsible'),
    foundToggleBtn: document.getElementById('foundToggleBtn'),
    foundToggleCount: document.getElementById('foundToggleCount'),
    foundListContainer: document.getElementById('foundListContainer'),
    closeFoundTabsBtn: document.getElementById('closeFoundTabsBtn'),
    closeFoundBtnText: document.getElementById('closeFoundBtnText'),
    closeAllFoundStateBtn: document.getElementById('closeAllFoundStateBtn'),
    closeAllFoundStateText: document.getElementById('closeAllFoundStateText')
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

    // Check IndexedDB for persisted backup buffer
    if (typeof BackupStorage !== 'undefined') {
      try {
        const stored = await BackupStorage.getBackup();
        if (stored && stored.buffer) {
          state.originalBackupBuffer = stored.buffer;
          if (!state.backupFileName && stored.fileName) {
            state.backupFileName = stored.fileName;
          }
        }
      } catch (e) {
        console.warn('Could not restore backup buffer from IndexedDB:', e);
      }
    }

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

    // Download updated backup with missing manga
    if (elements.downloadBackupBtn) {
      elements.downloadBackupBtn.addEventListener('click', handleDownloadUpdatedBackup);
    }

    // Close exported tabs
    if (elements.closeExportedTabsBtn) {
      elements.closeExportedTabsBtn.addEventListener('click', handleCloseExportedTabs);
    }

    // Found manga collapsible toggle
    if (elements.foundToggleBtn) {
      elements.foundToggleBtn.addEventListener('click', () => {
        elements.foundListContainer.classList.toggle('hidden');
        elements.foundToggleBtn.classList.toggle('open');
      });
    }

    // Close Found Tabs (bulk close with confirmation)
    if (elements.closeFoundTabsBtn) {
      elements.closeFoundTabsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.lastComparisonResults || !state.lastComparisonResults.found) return;
        const tabIds = state.lastComparisonResults.found.map(t => t.id);
        handleCloseFoundTabsWithConfirm(
          elements.closeFoundTabsBtn,
          elements.closeFoundBtnText,
          tabIds,
          'Close Found Tabs'
        );
      });
    }

    // Close All Checked Tabs (celebration state)
    if (elements.closeAllFoundStateBtn) {
      elements.closeAllFoundStateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.lastComparisonResults || !state.lastComparisonResults.found) return;
        const tabIds = state.lastComparisonResults.found.map(t => t.id);
        handleCloseFoundTabsWithConfirm(
          elements.closeAllFoundStateBtn,
          elements.closeAllFoundStateText,
          tabIds,
          'Close All Checked Tabs'
        );
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
      if (api.storage && api.storage.local) {
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
      }

      // Also retrieve raw buffer from IndexedDB if not already in memory
      if (!state.originalBackupBuffer && typeof BackupStorage !== 'undefined') {
        const stored = await BackupStorage.getBackup();
        if (stored && stored.buffer) {
          state.originalBackupBuffer = stored.buffer;
          if (!state.backupFileName && stored.fileName) {
            state.backupFileName = stored.fileName;
          }
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
    state.originalBackupBuffer = null;
    state.lastComparisonResults = null;
    state.lastExportedTabs = [];

    try {
      if (api.storage && api.storage.local) {
        await api.storage.local.remove(STORAGE_KEY_BACKUP);
      }
      if (typeof BackupStorage !== 'undefined') {
        await BackupStorage.clearBackup();
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

      const arrayBuffer = await file.arrayBuffer();
      state.originalBackupBuffer = arrayBuffer;
      state.backupFileName = file.name;

      if (typeof BackupStorage !== 'undefined') {
        try {
          await BackupStorage.saveBackup(arrayBuffer, file.name);
        } catch (e) {
          console.warn('BackupStorage save failed:', e);
        }
      }

      const parsed = await BackupParser.parseKomikkuBackup(arrayBuffer);

      if (parsed.count === 0) {
        alert('No manga titles could be extracted from this file. Please ensure it is a valid Komikku or Tachiyomi backup (.tachibk / .proto.gz).');
        elements.progressBarContainer.classList.add('hidden');
        return;
      }

      state.komikkuTitles = parsed.titles;
      state.komikkuTitlesList = parsed.titlesList;

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

    // Configure Download Updated Backup Card
    if (elements.downloadInstructions) {
      elements.downloadInstructions.classList.add('hidden');
    }
    if (comparison.missingCount > 0 && elements.downloadBackupCard) {
      elements.downloadBackupCard.classList.remove('hidden');
      elements.downloadMissingCount.textContent = comparison.missingCount;
      elements.downloadBackupBtnText.textContent = `Download Updated .tachibk (+${comparison.missingCount})`;
      elements.downloadBackupBtn.disabled = false;
      elements.downloadBackupBtn.classList.remove('loading');
    } else if (elements.downloadBackupCard) {
      elements.downloadBackupCard.classList.add('hidden');
    }

    // Reset search filter and close buttons
    elements.filterInput.value = '';
    if (elements.closeFoundTabsBtn) {
      elements.closeFoundTabsBtn.classList.remove('confirming');
      elements.closeFoundBtnText.textContent = 'Close Found Tabs';
    }
    if (elements.closeAllFoundStateBtn) {
      elements.closeAllFoundStateBtn.classList.remove('confirming');
      elements.closeAllFoundStateText.textContent = 'Close All Checked Tabs';
    }

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
   * Confirmation timer for closing tabs to prevent accidental clicks.
   */
  let closeConfirmTimer = null;

  /**
   * Two-step confirmation handler for closing tabs.
   * First click arms confirmation; second click executes closure.
   * Auto-reverts after 4 seconds if not confirmed.
   *
   * @param {HTMLElement} buttonEl
   * @param {HTMLElement} textEl
   * @param {number[]} tabIds
   * @param {string} defaultText
   */
  function handleCloseFoundTabsWithConfirm(buttonEl, textEl, tabIds, defaultText) {
    if (!tabIds || tabIds.length === 0) return;

    if (!buttonEl.classList.contains('confirming')) {
      // Step 1: Arm confirmation
      buttonEl.classList.add('confirming');
      textEl.textContent = `Confirm Close (${tabIds.length})?`;

      clearTimeout(closeConfirmTimer);
      closeConfirmTimer = setTimeout(() => {
        buttonEl.classList.remove('confirming');
        textEl.textContent = defaultText;
      }, 4000);
    } else {
      // Step 2: Confirmed! Execute tab closure
      clearTimeout(closeConfirmTimer);
      buttonEl.classList.remove('confirming');
      textEl.textContent = 'Closing...';
      executeCloseTabs(tabIds, buttonEl, textEl, defaultText);
    }
  }

  /**
   * Closes an array of tab IDs and updates application state and counters.
   * @param {number[]} tabIds
   * @param {HTMLElement} buttonEl
   * @param {HTMLElement} textEl
   * @param {string} defaultText
   */
  async function executeCloseTabs(tabIds, buttonEl, textEl, defaultText) {
    if (!tabIds || tabIds.length === 0) return;

    try {
      await api.tabs.remove(tabIds);

      textEl.textContent = `✓ Closed ${tabIds.length} tabs!`;
      setTimeout(() => {
        textEl.textContent = defaultText;
      }, 2000);

      // Remove closed tabs from state
      const closedSet = new Set(tabIds);
      if (state.lastComparisonResults && Array.isArray(state.lastComparisonResults.found)) {
        state.lastComparisonResults.found = state.lastComparisonResults.found.filter(
          t => !closedSet.has(t.id)
        );
        state.lastComparisonResults.foundCount = state.lastComparisonResults.found.length;
      }

      const remainingFound = state.lastComparisonResults ? state.lastComparisonResults.foundCount : 0;
      const remainingMissing = state.lastComparisonResults ? state.lastComparisonResults.missingCount : 0;

      // Update exported tabs count if any were closed
      if (Array.isArray(state.lastExportedTabs) && state.lastExportedTabs.length > 0) {
        state.lastExportedTabs = state.lastExportedTabs.filter(id => !closedSet.has(id));
        if (elements.closeExportedTabsBtn) {
          if (state.lastExportedTabs.length === 0) {
            elements.closeExportedTabsBtn.classList.add('hidden');
          } else {
            elements.closeExportedTabsBtnText.textContent = `Close Exported Tabs (${state.lastExportedTabs.length})`;
          }
        }
      }

      elements.metricInLibrary.textContent = remainingFound;
      elements.metricMissing.textContent = remainingMissing;
      elements.metricChecked.textContent = remainingFound + remainingMissing;
      elements.foundToggleCount.textContent = remainingFound;

      if (remainingFound === 0) {
        elements.foundCollapsible.classList.add('hidden');
        if (remainingMissing === 0) {
          elements.allFoundState.innerHTML = `
            <div class="all-found-icon" style="color: var(--color-success);">✓</div>
            <h3>All Library Tabs Closed</h3>
            <p>Your open tabs are now clean and up to date.</p>
          `;
        }
      } else {
        renderFoundList(state.lastComparisonResults.found);
      }

      await updateHighlightedTabs();
    } catch (err) {
      console.error('Error closing tabs:', err);
      textEl.textContent = 'Failed to close tabs';
      setTimeout(() => {
        textEl.textContent = defaultText;
      }, 2000);
    }
  }

  /**
   * Generates and downloads an updated .tachibk containing all missing manga.
   */
  async function handleDownloadUpdatedBackup() {
    if (!state.lastComparisonResults || state.lastComparisonResults.missingCount === 0) {
      alert('No missing manga to add to backup.');
      return;
    }

    // Ensure we have the original backup buffer
    if (!state.originalBackupBuffer) {
      if (typeof BackupStorage !== 'undefined') {
        try {
          const stored = await BackupStorage.getBackup();
          if (stored && stored.buffer) {
            state.originalBackupBuffer = stored.buffer;
            if (!state.backupFileName && stored.fileName) {
              state.backupFileName = stored.fileName;
            }
          }
        } catch (e) {}
      }
    }

    if (!state.originalBackupBuffer) {
      alert('The original backup file data is not available in memory. Please select or drag & drop your .tachibk file again.');
      triggerSafeFileSelect();
      return;
    }

    const missingList = state.lastComparisonResults.missing;
    elements.downloadBackupBtn.disabled = true;
    elements.downloadBackupBtn.classList.add('loading');
    elements.downloadBackupBtnText.textContent = 'Generating updated backup...';

    try {
      // Yield to allow animation frame
      await new Promise(r => setTimeout(r, 40));

      const exportResult = await BackupParser.exportUpdatedBackup(
        state.originalBackupBuffer,
        missingList
      );

      // Generate output filename
      const baseName = (state.backupFileName || 'komikku_backup')
        .replace(/\.(tachibk|proto\.gz|gz|json)$/i, '');
      const dateStr = new Date().toISOString().slice(0, 10);
      const downloadName = `${baseName}_added_${exportResult.addedCount}_manga_${dateStr}.tachibk`;

      // Trigger download via Blob URL
      const blobUrl = URL.createObjectURL(exportResult.blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

      // Track last exported tabs for tab closing convenience
      state.lastExportedTabs = missingList.map(item => item.id).filter(Boolean);

      // Update in-memory library with newly added titles
      for (const title of exportResult.addedTitles) {
        state.komikkuTitles.add(title.toLowerCase());
        state.komikkuTitlesList.push(title);
      }
      // Save updated titles to storage
      await saveLibraryToStorage(state.backupFileName, state.komikkuTitlesList);

      // Update library count in header badge
      showLoadedFileUI(state.backupFileName, state.komikkuTitles.size);

      // Show completed button state and instructions banner
      elements.downloadBackupBtnText.textContent = `✓ Downloaded (+${exportResult.addedCount} Added)`;
      elements.downloadBackupBtn.classList.remove('loading');
      elements.downloadInstructions.classList.remove('hidden');

      if (elements.closeExportedTabsBtn && state.lastExportedTabs.length > 0) {
        elements.closeExportedTabsBtn.classList.remove('hidden');
        elements.closeExportedTabsBtnText.textContent = `Close Exported Tabs (${state.lastExportedTabs.length})`;
      }
    } catch (err) {
      console.error('Failed to export updated backup:', err);
      alert(`Error creating updated backup: ${err.message}`);
      elements.downloadBackupBtnText.textContent = 'Download Updated .tachibk';
      elements.downloadBackupBtn.disabled = false;
      elements.downloadBackupBtn.classList.remove('loading');
    }
  }

  /**
   * Closes browser tabs that were exported to the backup file.
   */
  function handleCloseExportedTabs() {
    if (!state.lastExportedTabs || state.lastExportedTabs.length === 0) return;
    const tabIds = [...state.lastExportedTabs];
    handleCloseFoundTabsWithConfirm(
      elements.closeExportedTabsBtn,
      elements.closeExportedTabsBtnText,
      tabIds,
      `Close Exported Tabs (${tabIds.length})`
    );
  }

  /**
   * Renders the list of manga that were found in the Komikku library.
   * Provides full transparency into what matched and individual tab close buttons.
   * @param {Array<{ id: number, cleanedTitle: string, originalTitle: string, matchedWith: string }>} foundItems
   */
  function renderFoundList(foundItems) {
    if (!elements.foundListContainer) return;
    elements.foundListContainer.innerHTML = '';

    for (let i = 0; i < foundItems.length; i++) {
      const item = foundItems[i];
      const el = document.createElement('div');
      el.className = 'found-item';

      const detailsEl = document.createElement('div');
      detailsEl.className = 'found-item-details';
      detailsEl.innerHTML = `
        <span class="found-item-title" title="${escapeHtml(item.originalTitle)}">${escapeHtml(item.cleanedTitle)}</span>
        <span class="found-item-matched" title="Matched with library entry: ${escapeHtml(item.matchedWith)}">✓ ${escapeHtml(item.matchedWith)}</span>
      `;

      // Individual close button
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-close-single-tab';
      closeBtn.title = 'Close this tab in Zen Browser';
      closeBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;

      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.tabs.remove(item.id);
          el.style.opacity = '0';
          setTimeout(() => {
            el.remove();
            if (state.lastComparisonResults && Array.isArray(state.lastComparisonResults.found)) {
              const idx = state.lastComparisonResults.found.findIndex(f => f.id === item.id);
              if (idx !== -1) {
                state.lastComparisonResults.found.splice(idx, 1);
                state.lastComparisonResults.foundCount = state.lastComparisonResults.found.length;

                const remainingFound = state.lastComparisonResults.foundCount;
                const remainingMissing = state.lastComparisonResults.missingCount;
                elements.metricInLibrary.textContent = remainingFound;
                elements.metricChecked.textContent = remainingFound + remainingMissing;
                elements.foundToggleCount.textContent = remainingFound;

                if (remainingFound === 0) {
                  elements.foundCollapsible.classList.add('hidden');
                }
              }
            }
            updateHighlightedTabs();
          }, 150);
        } catch (err) {
          console.warn('Failed to close tab:', err);
        }
      });

      el.appendChild(detailsEl);
      el.appendChild(closeBtn);
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
