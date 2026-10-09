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
    selectedMissingTabIds: new Set(),
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
    downloadSelectedCount: document.getElementById('downloadSelectedCount'),
    downloadTotalMissingCount: document.getElementById('downloadTotalMissingCount'),
    downloadBackupBtn: document.getElementById('downloadBackupBtn'),
    downloadBackupBtnText: document.getElementById('downloadBackupBtnText'),
    downloadInstructions: document.getElementById('downloadInstructions'),
    closeExportedTabsBtn: document.getElementById('closeExportedTabsBtn'),
    closeExportedTabsBtnText: document.getElementById('closeExportedTabsBtnText'),
    filterInput: document.getElementById('filterInput'),
    toggleSelectAllBtn: document.getElementById('toggleSelectAllBtn'),
    toggleSelectAllText: document.getElementById('toggleSelectAllText'),
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

    // Toggle select/deselect all missing manga
    if (elements.toggleSelectAllBtn) {
      elements.toggleSelectAllBtn.addEventListener('click', handleToggleSelectAll);
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
    state.selectedMissingTabIds.clear();
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
   * Updates selection counts, button texts, and enabled states based on state.selectedMissingTabIds.
   */
  function updateSelectionUI() {
    const selectedCount = state.selectedMissingTabIds.size;
    const totalMissing = state.lastComparisonResults ? state.lastComparisonResults.missingCount : 0;

    if (elements.downloadSelectedCount) {
      elements.downloadSelectedCount.textContent = selectedCount;
    }
    if (elements.downloadTotalMissingCount) {
      elements.downloadTotalMissingCount.textContent = totalMissing;
    }

    if (elements.toggleSelectAllText) {
      if (totalMissing > 0 && selectedCount === totalMissing) {
        elements.toggleSelectAllText.textContent = 'Deselect All';
      } else {
        elements.toggleSelectAllText.textContent = 'Select All';
      }
    }

    if (elements.downloadBackupBtn) {
      if (selectedCount === 0) {
        elements.downloadBackupBtn.disabled = true;
        elements.downloadBackupBtnText.textContent = 'Select manga to export';
      } else {
        elements.downloadBackupBtn.disabled = false;
        elements.downloadBackupBtnText.textContent = `Download Updated .tachibk (+${selectedCount} Selected)`;
      }
    }
  }

  /**
   * Toggles select all or deselect all missing manga.
   */
  function handleToggleSelectAll() {
    if (!state.lastComparisonResults || !state.lastComparisonResults.missing) return;
    const allMissing = state.lastComparisonResults.missing;
    const shouldSelectAll = state.selectedMissingTabIds.size < allMissing.length;

    if (shouldSelectAll) {
      state.selectedMissingTabIds = new Set(allMissing.map(m => m.id));
    } else {
      state.selectedMissingTabIds.clear();
    }

    // Update all item checkboxes in DOM
    const itemCheckboxes = elements.resultsList.querySelectorAll('.manga-checkbox');
    itemCheckboxes.forEach(cb => {
      const tabId = Number(cb.dataset.tabId);
      const isChecked = state.selectedMissingTabIds.has(tabId);
      cb.checked = isChecked;
      const itemEl = cb.closest('.manga-item');
      if (itemEl) {
        itemEl.classList.toggle('selected', isChecked);
      }
    });

    // Update all domain checkboxes and badges in DOM
    const domainGroups = elements.resultsList.querySelectorAll('.domain-group');
    domainGroups.forEach(group => {
      const domainCheckbox = group.querySelector('.domain-checkbox');
      const domainBadge = group.querySelector('.domain-selected-badge');
      const cbs = group.querySelectorAll('.manga-checkbox');
      let checkedInGroup = 0;
      cbs.forEach(cb => {
        if (cb.checked) checkedInGroup++;
      });
      if (domainCheckbox) {
        domainCheckbox.checked = cbs.length > 0 && checkedInGroup === cbs.length;
      }
      if (domainBadge) {
        domainBadge.textContent = `${checkedInGroup}/${cbs.length} selected`;
      }
    });

    updateSelectionUI();
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
    // Default to selecting all missing tabs
    state.selectedMissingTabIds = new Set(comparison.missing.map(m => m.id));

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
      elements.downloadBackupBtn.classList.remove('loading');
      updateSelectionUI();
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
            (item.backupTitle && item.backupTitle.toLowerCase().includes(query)) ||
            domain.toLowerCase().includes(query)
        );
      }

      if (items.length === 0) continue;
      totalRendered += items.length;

      const groupEl = document.createElement('div');
      groupEl.className = 'domain-group';

      // Count selected in this domain
      const selectedInDomain = items.filter(item => state.selectedMissingTabIds.has(item.id)).length;
      const isDomainAllSelected = items.length > 0 && selectedInDomain === items.length;

      // Domain Header
      const headerEl = document.createElement('div');
      headerEl.className = 'domain-header';
      headerEl.title = 'Click to collapse or expand domain';

      const domainInfoEl = document.createElement('div');
      domainInfoEl.className = 'domain-info';

      const domainLabel = document.createElement('label');
      domainLabel.className = 'domain-checkbox-label';
      domainLabel.title = `Toggle all ${items.length} manga from ${domain}`;

      const domainCheckbox = document.createElement('input');
      domainCheckbox.type = 'checkbox';
      domainCheckbox.className = 'domain-checkbox';
      domainCheckbox.checked = isDomainAllSelected;

      const domainNameEl = document.createElement('span');
      domainNameEl.className = 'domain-name';
      domainNameEl.textContent = domain;

      domainLabel.appendChild(domainCheckbox);
      domainLabel.appendChild(domainNameEl);
      domainInfoEl.appendChild(domainLabel);

      const domainRightEl = document.createElement('div');
      domainRightEl.className = 'domain-header-right';

      const domainBadge = document.createElement('span');
      domainBadge.className = 'domain-badge domain-selected-badge';
      domainBadge.textContent = `${selectedInDomain}/${items.length} selected`;

      const chevronEl = document.createElement('div');
      chevronEl.className = 'domain-chevron';
      chevronEl.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;

      domainRightEl.appendChild(domainBadge);
      domainRightEl.appendChild(chevronEl);

      headerEl.appendChild(domainInfoEl);
      headerEl.appendChild(domainRightEl);
      groupEl.appendChild(headerEl);

      // Toggle collapse on header click (avoid toggle when clicking checkbox or label)
      headerEl.addEventListener('click', (e) => {
        if (e.target.closest('.domain-checkbox') || e.target.closest('.domain-checkbox-label')) {
          return;
        }
        groupEl.classList.toggle('collapsed');
      });

      // Manga Items Container
      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'manga-items-container';

      // Keep references to item checkboxes for syncing domain toggle
      const itemCheckboxes = [];

      for (const item of items) {
        const itemEl = document.createElement('div');
        const isSelected = state.selectedMissingTabIds.has(item.id);
        itemEl.className = `manga-item${isSelected ? ' selected' : ''}`;

        // Checkbox container
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'manga-checkbox-container';
        checkboxContainer.title = 'Select to add to backup';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'manga-checkbox';
        checkbox.dataset.tabId = String(item.id);
        checkbox.checked = isSelected;
        itemCheckboxes.push(checkbox);

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            state.selectedMissingTabIds.add(item.id);
            itemEl.classList.add('selected');
          } else {
            state.selectedMissingTabIds.delete(item.id);
            itemEl.classList.remove('selected');
          }
          const currentCount = items.filter(it => state.selectedMissingTabIds.has(it.id)).length;
          domainCheckbox.checked = currentCount === items.length;
          domainBadge.textContent = `${currentCount}/${items.length} selected`;
          updateSelectionUI();
        });

        checkboxContainer.appendChild(checkbox);

        const detailsEl = document.createElement('div');
        detailsEl.className = 'manga-details';

        // Upper Title: exactly the page that is open
        const tabTitleEl = document.createElement('div');
        tabTitleEl.className = 'manga-tab-title';
        tabTitleEl.textContent = item.originalTitle;
        tabTitleEl.title = `${item.originalTitle}\n${item.url}`;

        // Below Title: how the title will be added to the backup
        const backupTitleEl = document.createElement('div');
        backupTitleEl.className = 'manga-backup-title';
        const displayBackupTitle = item.backupTitle || item.cleanedTitle;
        backupTitleEl.title = `Title to be added to .tachibk backup: "${displayBackupTitle}"`;

        const backupLabel = document.createElement('span');
        backupLabel.className = 'backup-label';
        backupLabel.textContent = 'Added as:';

        const backupName = document.createElement('span');
        backupName.className = 'backup-name';
        backupName.textContent = displayBackupTitle;

        backupTitleEl.appendChild(backupLabel);
        backupTitleEl.appendChild(backupName);

        detailsEl.appendChild(tabTitleEl);
        detailsEl.appendChild(backupTitleEl);

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

        itemEl.appendChild(checkboxContainer);
        itemEl.appendChild(detailsEl);
        itemEl.appendChild(switchBtn);
        itemsContainer.appendChild(itemEl);
      }

      // Domain checkbox click toggles all items in this domain
      domainCheckbox.addEventListener('change', () => {
        const checkState = domainCheckbox.checked;
        for (const item of items) {
          if (checkState) {
            state.selectedMissingTabIds.add(item.id);
          } else {
            state.selectedMissingTabIds.delete(item.id);
          }
        }
        for (const cb of itemCheckboxes) {
          cb.checked = checkState;
          const parentItem = cb.closest('.manga-item');
          if (parentItem) {
            parentItem.classList.toggle('selected', checkState);
          }
        }
        const currentCount = checkState ? items.length : 0;
        domainBadge.textContent = `${currentCount}/${items.length} selected`;
        updateSelectionUI();
      });

      groupEl.appendChild(itemsContainer);
      elements.resultsList.appendChild(groupEl);
    }

    if (totalRendered === 0 && query) {
      elements.resultsList.textContent = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;';
      emptyDiv.appendChild(document.createTextNode('No missing manga matching "'));
      const strongEl = document.createElement('strong');
      strongEl.textContent = query;
      emptyDiv.appendChild(strongEl);
      emptyDiv.appendChild(document.createTextNode('"'));
      elements.resultsList.appendChild(emptyDiv);
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
      if (state.lastComparisonResults) {
        if (Array.isArray(state.lastComparisonResults.found)) {
          state.lastComparisonResults.found = state.lastComparisonResults.found.filter(
            t => !closedSet.has(t.id)
          );
          state.lastComparisonResults.foundCount = state.lastComparisonResults.found.length;
        }
        if (Array.isArray(state.lastComparisonResults.missing)) {
          state.lastComparisonResults.missing = state.lastComparisonResults.missing.filter(
            t => !closedSet.has(t.id)
          );
          state.lastComparisonResults.missingCount = state.lastComparisonResults.missing.length;
          if (state.lastComparisonResults.missingByDomain) {
            for (const domain of Object.keys(state.lastComparisonResults.missingByDomain)) {
              state.lastComparisonResults.missingByDomain[domain] =
                state.lastComparisonResults.missingByDomain[domain].filter(t => !closedSet.has(t.id));
              if (state.lastComparisonResults.missingByDomain[domain].length === 0) {
                delete state.lastComparisonResults.missingByDomain[domain];
              }
            }
          }
        }
      }

      // Also clean from selected set
      for (const id of tabIds) {
        state.selectedMissingTabIds.delete(id);
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
      updateSelectionUI();

      if (remainingMissing > 0 && state.lastComparisonResults && state.lastComparisonResults.missingByDomain) {
        renderResultsList(state.lastComparisonResults.missingByDomain, elements.filterInput.value.trim());
      } else if (remainingMissing === 0) {
        elements.resultsList.classList.add('hidden');
        if (elements.downloadBackupCard) {
          elements.downloadBackupCard.classList.add('hidden');
        }
      }

      if (remainingFound === 0) {
        elements.foundCollapsible.classList.add('hidden');
        if (remainingMissing === 0) {
          elements.allFoundState.textContent = '';
          const iconDiv = document.createElement('div');
          iconDiv.className = 'all-found-icon';
          iconDiv.style.color = 'var(--color-success)';
          iconDiv.textContent = '✓';

          const titleH3 = document.createElement('h3');
          titleH3.textContent = 'All Library Tabs Closed';

          const descP = document.createElement('p');
          descP.textContent = 'Your open tabs are now clean and up to date.';

          elements.allFoundState.appendChild(iconDiv);
          elements.allFoundState.appendChild(titleH3);
          elements.allFoundState.appendChild(descP);
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

    const missingList = (state.lastComparisonResults.missing || []).filter(
      item => state.selectedMissingTabIds.has(item.id)
    );

    if (missingList.length === 0) {
      alert('Please select at least one missing manga to add to your backup.');
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

      // Deselect the exported items
      for (const item of missingList) {
        state.selectedMissingTabIds.delete(item.id);
      }

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

      // Update checkboxes and counters in UI
      const itemCheckboxes = elements.resultsList.querySelectorAll('.manga-checkbox');
      itemCheckboxes.forEach(cb => {
        const tabId = Number(cb.dataset.tabId);
        const isChecked = state.selectedMissingTabIds.has(tabId);
        cb.checked = isChecked;
        const itemEl = cb.closest('.manga-item');
        if (itemEl) {
          itemEl.classList.toggle('selected', isChecked);
        }
      });

      const domainGroups = elements.resultsList.querySelectorAll('.domain-group');
      domainGroups.forEach(group => {
        const domainCheckbox = group.querySelector('.domain-checkbox');
        const domainBadge = group.querySelector('.domain-selected-badge');
        const cbs = group.querySelectorAll('.manga-checkbox');
        let checkedInGroup = 0;
        cbs.forEach(cb => {
          if (cb.checked) checkedInGroup++;
        });
        if (domainCheckbox) {
          domainCheckbox.checked = cbs.length > 0 && checkedInGroup === cbs.length;
        }
        if (domainBadge) {
          domainBadge.textContent = `${checkedInGroup}/${cbs.length} selected`;
        }
      });

      updateSelectionUI();
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

      const titleSpan = document.createElement('span');
      titleSpan.className = 'found-item-title';
      titleSpan.title = item.originalTitle || '';
      titleSpan.textContent = item.cleanedTitle || '';

      const matchedSpan = document.createElement('span');
      matchedSpan.className = 'found-item-matched';
      matchedSpan.title = `Matched with library entry: ${item.matchedWith || ''}`;
      matchedSpan.textContent = `✓ ${item.matchedWith || ''}`;

      detailsEl.appendChild(titleSpan);
      detailsEl.appendChild(matchedSpan);

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
