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
    libraryEntries: [],
    sources: { byId: new Map(), byName: new Map() },
    duplicates: {
      groups: [],
      totalDuplicatesCount: 0,
      duplicateGroupsCount: 0,
      sameSourceGroupsCount: 0,
      crossSourceGroupsCount: 0,
      sourcesInDuplicates: []
    },
    backupFileName: '',
    originalBackupBuffer: null,
    highlightedTabs: [],
    lastComparisonResults: null,
    selectedMissingTabIds: new Set(),
    lastExportedTabs: [],
    activeView: 'compare',
    libFilterMode: 'all',
    libSourceFilter: 'all',
    libCategoryFilter: 'all',
    libSearchQuery: '',
    categories: [],
    categoriesByOrder: new Map(),
    uncategorizedCount: 0,
    selectedDuplicateEntryIds: new Set(),
    selectedLibraryEntryIds: new Set(),
    sourcePreferences: [],
    activeAutoRule: 'sourcePreference',
    lastCleanedBlob: null,
    pendingDeletionEntries: []
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
    closeAllFoundStateText: document.getElementById('closeAllFoundStateText'),

    // View Navigation Tabs
    tabNavCompare: document.getElementById('tabNavCompare'),
    tabNavLibrary: document.getElementById('tabNavLibrary'),
    navDupBadge: document.getElementById('navDupBadge'),
    compareViewContainer: document.getElementById('compareViewContainer'),
    libraryViewContainer: document.getElementById('libraryViewContainer'),

    // Library View Elements
    libraryEmptyState: document.getElementById('libraryEmptyState'),
    libraryContent: document.getElementById('libraryContent'),
    libMetricTotal: document.getElementById('libMetricTotal'),
    libMetricUnique: document.getElementById('libMetricUnique'),
    libMetricSources: document.getElementById('libMetricSources'),
    libMetricCategories: document.getElementById('libMetricCategories'),
    libMetricCatPill: document.getElementById('libMetricCatPill'),
    libMetricDuplicates: document.getElementById('libMetricDuplicates'),
    libMetricDupPill: document.getElementById('libMetricDupPill'),
    dupAlertBanner: document.getElementById('dupAlertBanner'),
    dupAlertTitle: document.getElementById('dupAlertTitle'),
    dupAlertSubtitle: document.getElementById('dupAlertSubtitle'),
    dupAlertActionBtn: document.getElementById('dupAlertActionBtn'),
    cleanLibraryBanner: document.getElementById('cleanLibraryBanner'),
    libSearchInput: document.getElementById('libSearchInput'),
    libSourceFilter: document.getElementById('libSourceFilter'),
    libCategoryFilter: document.getElementById('libCategoryFilter'),
    btnFilterAll: document.getElementById('btnFilterAll'),
    btnFilterDups: document.getElementById('btnFilterDups'),
    countAllBtn: document.getElementById('countAllBtn'),
    countDupsBtn: document.getElementById('countDupsBtn'),
    libraryList: document.getElementById('libraryList'),

    // Library Multi-Selection Toolbar Elements
    libSelectionBar: document.getElementById('libSelectionBar'),
    libSelectAllCheckbox: document.getElementById('libSelectAllCheckbox'),
    libSelectCount: document.getElementById('libSelectCount'),
    libClearSelectionBtn: document.getElementById('libClearSelectionBtn'),
    libSelectAllBtn: document.getElementById('libSelectAllBtn'),
    libOpenSelectedBtn: document.getElementById('libOpenSelectedBtn'),
    libOpenSelectedText: document.getElementById('libOpenSelectedText'),

    // Duplicate Management & Cleanup Elements
    dupActionsBar: document.getElementById('dupActionsBar'),
    dupSelectCount: document.getElementById('dupSelectCount'),
    btnDeselectAllDups: document.getElementById('btnDeselectAllDups'),
    btnAutoSelectRules: document.getElementById('btnAutoSelectRules'),
    rulesDropdownMenu: document.getElementById('rulesDropdownMenu'),
    ruleSourcePref: document.getElementById('ruleSourcePref'),
    ruleOldest: document.getElementById('ruleOldest'),
    ruleNewest: document.getElementById('ruleNewest'),
    ruleSelectAll: document.getElementById('ruleSelectAll'),
    btnOpenSourcePreferences: document.getElementById('btnOpenSourcePreferences'),
    btnDeleteSelectedDups: document.getElementById('btnDeleteSelectedDups'),
    btnDeleteSelectedText: document.getElementById('btnDeleteSelectedText'),

    // Source Priority Modal
    sourcePrefModalBackdrop: document.getElementById('sourcePrefModalBackdrop'),
    sourcePrefModal: document.getElementById('sourcePrefModal'),
    btnCloseSourcePrefModal: document.getElementById('btnCloseSourcePrefModal'),
    sourcePriorityList: document.getElementById('sourcePriorityList'),
    btnResetSourcePriorities: document.getElementById('btnResetSourcePriorities'),
    btnSaveSourcePriorities: document.getElementById('btnSaveSourcePriorities'),

    // Deletion Confirmation Modal
    deleteConfirmModalBackdrop: document.getElementById('deleteConfirmModalBackdrop'),
    deleteConfirmModal: document.getElementById('deleteConfirmModal'),
    btnCloseDeleteConfirmModal: document.getElementById('btnCloseDeleteConfirmModal'),
    confirmDeleteCount: document.getElementById('confirmDeleteCount'),
    confirmTitlesCount: document.getElementById('confirmTitlesCount'),
    confirmRetainedCount: document.getElementById('confirmRetainedCount'),
    btnCancelDelete: document.getElementById('btnCancelDelete'),
    btnConfirmDelete: document.getElementById('btnConfirmDelete'),

    // Cleanup Success & Download Modal
    cleanupSuccessModalBackdrop: document.getElementById('cleanupSuccessModalBackdrop'),
    cleanupSuccessModal: document.getElementById('cleanupSuccessModal'),
    btnCloseCleanupSuccessModal: document.getElementById('btnCloseCleanupSuccessModal'),
    cleanupSuccessSummaryText: document.getElementById('cleanupSuccessSummaryText'),
    cleanupSuccessRemovedCount: document.getElementById('cleanupSuccessRemovedCount'),
    cleanupSuccessRemainingCount: document.getElementById('cleanupSuccessRemainingCount'),
    btnDownloadCleanedBackup: document.getElementById('btnDownloadCleanedBackup'),
    btnDownloadCleanedText: document.getElementById('btnDownloadCleanedText'),
    btnCloseCleanupSuccessBtn: document.getElementById('btnCloseCleanupSuccessBtn')
  };

  // Storage Keys
  const STORAGE_KEY_BACKUP = 'komikku_compare_backup_data_v2';
  const STORAGE_KEY_SOURCE_PRIORITIES = 'komikku_source_priorities_v1';

  /**
   * Initializes extension popup.
   */
  async function init() {
    setupEventListeners();
    await loadSourcePreferences();
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

    // View Navigation Tabs
    if (elements.tabNavCompare) {
      elements.tabNavCompare.addEventListener('click', () => switchView('compare'));
    }
    if (elements.tabNavLibrary) {
      elements.tabNavLibrary.addEventListener('click', () => switchView('library'));
    }

    // Duplicate alert action button
    if (elements.dupAlertActionBtn) {
      elements.dupAlertActionBtn.addEventListener('click', () => {
        state.libFilterMode = 'duplicates';
        updateLibraryFilterButtons();
        updateDuplicateSelectionUI();
        renderLibraryView();
      });
    }

    // Library filter mode toggle buttons (All / Duplicates)
    if (elements.btnFilterAll) {
      elements.btnFilterAll.addEventListener('click', () => {
        state.libFilterMode = 'all';
        updateLibraryFilterButtons();
        updateDuplicateSelectionUI();
        renderLibraryView();
      });
    }
    if (elements.btnFilterDups) {
      elements.btnFilterDups.addEventListener('click', () => {
        state.libFilterMode = 'duplicates';
        updateLibraryFilterButtons();
        updateDuplicateSelectionUI();
        renderLibraryView();
      });
    }

    // Duplicate Action Bar & Auto-Select Rules
    if (elements.btnAutoSelectRules && elements.rulesDropdownMenu) {
      elements.btnAutoSelectRules.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.rulesDropdownMenu.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.dup-rules-dropdown-wrapper')) {
          elements.rulesDropdownMenu.classList.add('hidden');
        }
      });
    }

    if (elements.ruleSourcePref) {
      elements.ruleSourcePref.addEventListener('click', () => {
        if (elements.rulesDropdownMenu) elements.rulesDropdownMenu.classList.add('hidden');
        applyAutoSelectRule('sourcePreference');
      });
    }
    if (elements.ruleOldest) {
      elements.ruleOldest.addEventListener('click', () => {
        if (elements.rulesDropdownMenu) elements.rulesDropdownMenu.classList.add('hidden');
        applyAutoSelectRule('oldest');
      });
    }
    if (elements.ruleNewest) {
      elements.ruleNewest.addEventListener('click', () => {
        if (elements.rulesDropdownMenu) elements.rulesDropdownMenu.classList.add('hidden');
        applyAutoSelectRule('newest');
      });
    }
    if (elements.ruleSelectAll) {
      elements.ruleSelectAll.addEventListener('click', () => {
        if (elements.rulesDropdownMenu) elements.rulesDropdownMenu.classList.add('hidden');
        applyAutoSelectRule('all');
      });
    }
    if (elements.btnDeselectAllDups) {
      elements.btnDeselectAllDups.addEventListener('click', () => {
        applyAutoSelectRule('none');
      });
    }

    // Source Priorities Modal
    if (elements.btnOpenSourcePreferences) {
      elements.btnOpenSourcePreferences.addEventListener('click', openSourcePreferencesModal);
    }
    if (elements.btnCloseSourcePrefModal) {
      elements.btnCloseSourcePrefModal.addEventListener('click', closeSourcePreferencesModal);
    }
    if (elements.sourcePrefModalBackdrop) {
      elements.sourcePrefModalBackdrop.addEventListener('click', (e) => {
        if (e.target === elements.sourcePrefModalBackdrop) closeSourcePreferencesModal();
      });
    }
    if (elements.btnResetSourcePriorities) {
      elements.btnResetSourcePriorities.addEventListener('click', handleResetSourcePriorities);
    }
    if (elements.btnSaveSourcePriorities) {
      elements.btnSaveSourcePriorities.addEventListener('click', handleSaveSourcePriorities);
    }

    // Duplicate Deletion Confirmation Modal
    if (elements.btnDeleteSelectedDups) {
      elements.btnDeleteSelectedDups.addEventListener('click', () => openDeleteConfirmModal());
    }
    if (elements.btnCloseDeleteConfirmModal) {
      elements.btnCloseDeleteConfirmModal.addEventListener('click', closeDeleteConfirmModal);
    }
    if (elements.btnCancelDelete) {
      elements.btnCancelDelete.addEventListener('click', closeDeleteConfirmModal);
    }
    if (elements.deleteConfirmModalBackdrop) {
      elements.deleteConfirmModalBackdrop.addEventListener('click', (e) => {
        if (e.target === elements.deleteConfirmModalBackdrop) closeDeleteConfirmModal();
      });
    }
    if (elements.btnConfirmDelete) {
      elements.btnConfirmDelete.addEventListener('click', executeDuplicateDeletion);
    }

    // Cleanup Success & Download Modal
    if (elements.btnCloseCleanupSuccessModal) {
      elements.btnCloseCleanupSuccessModal.addEventListener('click', closeCleanupSuccessModal);
    }
    if (elements.btnCloseCleanupSuccessBtn) {
      elements.btnCloseCleanupSuccessBtn.addEventListener('click', closeCleanupSuccessModal);
    }
    if (elements.cleanupSuccessModalBackdrop) {
      elements.cleanupSuccessModalBackdrop.addEventListener('click', (e) => {
        if (e.target === elements.cleanupSuccessModalBackdrop) closeCleanupSuccessModal();
      });
    }
    if (elements.btnDownloadCleanedBackup) {
      elements.btnDownloadCleanedBackup.addEventListener('click', downloadCleanedBackup);
    }

    // Library category dropdown filter
    if (elements.libCategoryFilter) {
      elements.libCategoryFilter.addEventListener('change', (e) => {
        state.libCategoryFilter = e.target.value;
        renderLibraryView();
        updateLibrarySelectionUI();
      });
    }

    // Library source dropdown filter
    if (elements.libSourceFilter) {
      elements.libSourceFilter.addEventListener('change', (e) => {
        state.libSourceFilter = e.target.value;
        renderLibraryView();
        updateLibrarySelectionUI();
      });
    }

    // Library search filter
    if (elements.libSearchInput) {
      elements.libSearchInput.addEventListener('input', (e) => {
        state.libSearchQuery = e.target.value.trim().toLowerCase();
        renderLibraryView();
        updateLibrarySelectionUI();
      });
    }

    // Library Multi-Selection Toolbar listeners
    if (elements.libSelectAllCheckbox) {
      elements.libSelectAllCheckbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const filteredEntries = getFilteredLibraryEntries();
        if (checked) {
          for (const entry of filteredEntries) {
            state.selectedLibraryEntryIds.add(entry.id);
          }
        } else {
          for (const entry of filteredEntries) {
            state.selectedLibraryEntryIds.delete(entry.id);
          }
        }
        updateLibrarySelectionUI();
        renderLibraryView();
      });
    }

    if (elements.libSelectAllBtn) {
      elements.libSelectAllBtn.addEventListener('click', () => {
        selectAllFilteredLibraryEntries();
      });
    }

    if (elements.libClearSelectionBtn) {
      elements.libClearSelectionBtn.addEventListener('click', () => {
        clearLibrarySelection();
      });
    }

    if (elements.libOpenSelectedBtn) {
      elements.libOpenSelectedBtn.addEventListener('click', () => {
        openSelectedMangaPages();
      });
    }
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

      // If we have originalBackupBuffer, re-parse to populate rich library entries and duplicates
      if (state.originalBackupBuffer && state.libraryEntries.length === 0) {
        try {
          const parsed = await BackupParser.parseKomikkuBackup(state.originalBackupBuffer);
          if (parsed && parsed.count > 0) {
            state.komikkuTitles = parsed.titles;
            state.komikkuTitlesList = parsed.titlesList;
            state.libraryEntries = parsed.entries || [];
            state.sources = parsed.sources || { byId: new Map(), byName: new Map() };
            state.categories = parsed.categories || [];
            state.categoriesByOrder = parsed.categoriesByOrder || new Map();
            state.uncategorizedCount = parsed.uncategorizedCount || 0;
            state.duplicates = parsed.duplicates || {
              groups: [],
              totalDuplicatesCount: 0,
              duplicateGroupsCount: 0,
              sameSourceGroupsCount: 0,
              crossSourceGroupsCount: 0,
              sourcesInDuplicates: []
            };

            syncSourcePreferencesWithDuplicates();
            if (state.duplicates.duplicateGroupsCount > 0) {
              BackupParser.applyDuplicateSelectionRule(state.duplicates.groups, state.activeAutoRule, {
                sourcePreferences: state.sourcePreferences
              });
              state.selectedDuplicateEntryIds.clear();
              for (const g of state.duplicates.groups) {
                for (const e of g.entries) {
                  if (e.isSelectedForDelete) state.selectedDuplicateEntryIds.add(e.id);
                }
              }
            }

            updateLibraryUIStats();
            populateSourceFilterDropdown();
            populateCategoryFilterControls();
            updateDuplicateSelectionUI();
            renderLibraryView();
          }
        } catch (err) {
          console.warn('Could not re-parse restored backup buffer:', err);
        }
      } else if (state.libraryEntries.length > 0) {
        updateLibraryUIStats();
        populateSourceFilterDropdown();
        populateCategoryFilterControls();
        updateDuplicateSelectionUI();
        renderLibraryView();
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
    state.libraryEntries = [];
    state.sources = { byId: new Map(), byName: new Map() };
    state.duplicates = {
      groups: [],
      totalDuplicatesCount: 0,
      duplicateGroupsCount: 0,
      sameSourceGroupsCount: 0,
      crossSourceGroupsCount: 0,
      sourcesInDuplicates: []
    };
    state.backupFileName = '';
    state.originalBackupBuffer = null;
    state.lastComparisonResults = null;
    state.selectedMissingTabIds.clear();
    state.lastExportedTabs = [];
    state.libFilterMode = 'all';
    state.libSourceFilter = 'all';
    state.libCategoryFilter = 'all';
    state.libSearchQuery = '';
    state.categories = [];
    state.categoriesByOrder = new Map();
    state.uncategorizedCount = 0;
    state.selectedDuplicateEntryIds.clear();
    state.selectedLibraryEntryIds.clear();
    state.lastCleanedBlob = null;
    state.pendingDeletionEntries = [];

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

    if (elements.libMetricCategories) elements.libMetricCategories.textContent = '0';

    if (elements.libSearchInput) elements.libSearchInput.value = '';
    updateLibraryUIStats();
    populateSourceFilterDropdown();
    populateCategoryFilterControls();
    updateDuplicateSelectionUI();
    updateLibrarySelectionUI();
    renderLibraryView();

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
      state.libraryEntries = parsed.entries || [];
      state.sources = parsed.sources || { byId: new Map(), byName: new Map() };
      state.categories = parsed.categories || [];
      state.categoriesByOrder = parsed.categoriesByOrder || new Map();
      state.uncategorizedCount = parsed.uncategorizedCount || 0;
      state.duplicates = parsed.duplicates || {
        groups: [],
        totalDuplicatesCount: 0,
        duplicateGroupsCount: 0,
        sameSourceGroupsCount: 0,
        crossSourceGroupsCount: 0,
        sourcesInDuplicates: []
      };

      // Synchronize and apply duplicate selection rule
      syncSourcePreferencesWithDuplicates();
      if (state.duplicates.duplicateGroupsCount > 0) {
        BackupParser.applyDuplicateSelectionRule(state.duplicates.groups, state.activeAutoRule, {
          sourcePreferences: state.sourcePreferences
        });
        state.selectedDuplicateEntryIds.clear();
        for (const g of state.duplicates.groups) {
          for (const e of g.entries) {
            if (e.isSelectedForDelete) state.selectedDuplicateEntryIds.add(e.id);
          }
        }
      }

      // Save to local storage for persistence
      await saveLibraryToStorage(file.name, parsed.titlesList);

      showLoadedFileUI(file.name, parsed.count);
      updateLibraryUIStats();
      populateSourceFilterDropdown();
      populateCategoryFilterControls();
      updateDuplicateSelectionUI();
      renderLibraryView();
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

  /**
   * Switches active top tab between Compare and Library view.
   * @param {'compare'|'library'} viewName
   */
  function switchView(viewName) {
    state.activeView = viewName;
    if (viewName === 'compare') {
      if (elements.tabNavCompare) elements.tabNavCompare.classList.add('active');
      if (elements.tabNavLibrary) elements.tabNavLibrary.classList.remove('active');
      if (elements.compareViewContainer) elements.compareViewContainer.classList.remove('hidden');
      if (elements.libraryViewContainer) elements.libraryViewContainer.classList.add('hidden');
      updateDuplicateSelectionUI();
    } else {
      if (elements.tabNavCompare) elements.tabNavCompare.classList.remove('active');
      if (elements.tabNavLibrary) elements.tabNavLibrary.classList.add('active');
      if (elements.compareViewContainer) elements.compareViewContainer.classList.add('hidden');
      if (elements.libraryViewContainer) elements.libraryViewContainer.classList.remove('hidden');
      updateDuplicateSelectionUI();
      renderLibraryView();
    }
  }

  /**
   * Updates statistical badges and banners in Library Explorer.
   */
  function updateLibraryUIStats() {
    const totalEntries = state.libraryEntries ? state.libraryEntries.length : 0;
    const uniqueTitles = state.komikkuTitles ? state.komikkuTitles.size : 0;
    const dupCount = (state.duplicates && state.duplicates.duplicateGroupsCount) ? state.duplicates.duplicateGroupsCount : 0;

    // Count unique source names
    const sourceNames = new Set((state.libraryEntries || []).map(e => e.sourceName).filter(Boolean));
    const totalSources = sourceNames.size;

    const totalCategories = (state.categories && state.categories.length) ? state.categories.length : 0;

    if (elements.libMetricTotal) elements.libMetricTotal.textContent = totalEntries.toLocaleString();
    if (elements.libMetricUnique) elements.libMetricUnique.textContent = uniqueTitles.toLocaleString();
    if (elements.libMetricSources) elements.libMetricSources.textContent = totalSources.toLocaleString();
    if (elements.libMetricCategories) elements.libMetricCategories.textContent = totalCategories.toLocaleString();
    if (elements.libMetricDuplicates) elements.libMetricDuplicates.textContent = dupCount.toLocaleString();

    if (elements.countAllBtn) elements.countAllBtn.textContent = totalEntries.toLocaleString();
    if (elements.countDupsBtn) elements.countDupsBtn.textContent = dupCount.toLocaleString();

    // Nav bar duplicate badge
    if (elements.navDupBadge) {
      if (dupCount > 0) {
        elements.navDupBadge.textContent = dupCount.toLocaleString();
        elements.navDupBadge.classList.remove('hidden');
      } else {
        elements.navDupBadge.classList.add('hidden');
      }
    }

    // Toggle Empty State vs Populated Content
    if (totalEntries === 0) {
      if (elements.libraryEmptyState) elements.libraryEmptyState.classList.remove('hidden');
      if (elements.libraryContent) elements.libraryContent.classList.add('hidden');
      if (elements.dupAlertBanner) elements.dupAlertBanner.classList.add('hidden');
      if (elements.cleanLibraryBanner) elements.cleanLibraryBanner.classList.add('hidden');
    } else {
      if (elements.libraryEmptyState) elements.libraryEmptyState.classList.add('hidden');
      if (elements.libraryContent) elements.libraryContent.classList.remove('hidden');

      if (dupCount > 0) {
        if (elements.dupAlertBanner) elements.dupAlertBanner.classList.remove('hidden');
        if (elements.cleanLibraryBanner) elements.cleanLibraryBanner.classList.add('hidden');
        if (elements.dupAlertSubtitle) {
          const sCount = state.duplicates.sameSourceGroupsCount || 0;
          const cCount = state.duplicates.crossSourceGroupsCount || 0;
          const totalExtra = state.duplicates.totalDuplicatesCount || dupCount;
          const breakdown = [];
          if (sCount > 0) breakdown.push(`${sCount} same-source`);
          if (cCount > 0) breakdown.push(`${cCount} cross-source`);
          const breakdownText = breakdown.length ? ` (${breakdown.join(', ')})` : '';
          elements.dupAlertSubtitle.textContent = `${dupCount} duplicate title ${dupCount === 1 ? 'group' : 'groups'} with ${totalExtra} redundant ${totalExtra === 1 ? 'entry' : 'entries'}${breakdownText}.`;
        }
      } else {
        if (elements.dupAlertBanner) elements.dupAlertBanner.classList.add('hidden');
        if (elements.cleanLibraryBanner) elements.cleanLibraryBanner.classList.remove('hidden');
      }
    }
  }

  /**
   * Populates the category filter dropdown next to the sources filter.
   * If the backup contains no categories, displays "No categories yet".
   * Fully AMO-compliant: constructs DOM nodes with document.createElement and textContent.
   */
  function populateCategoryFilterControls() {
    if (!elements.libCategoryFilter) return;

    const prevSelected = state.libCategoryFilter || 'all';

    // Clear dropdown safely
    while (elements.libCategoryFilter.firstChild) {
      elements.libCategoryFilter.removeChild(elements.libCategoryFilter.firstChild);
    }

    const categories = state.categories || [];

    if (categories.length === 0) {
      // If there are no categories in the user's tachibk file, show "No categories yet"
      const emptyOpt = document.createElement('option');
      emptyOpt.value = 'all';
      emptyOpt.textContent = 'No categories yet';
      emptyOpt.selected = true;
      elements.libCategoryFilter.appendChild(emptyOpt);
      state.libCategoryFilter = 'all';
      return;
    }

    // Default option: "All Categories"
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Categories';
    if (prevSelected === 'all') allOpt.selected = true;
    elements.libCategoryFilter.appendChild(allOpt);

    let matchFound = (prevSelected === 'all');

    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat.name;
      opt.textContent = `${cat.name} (${cat.count || 0})`;
      if (prevSelected === cat.name) {
        opt.selected = true;
        matchFound = true;
      }
      elements.libCategoryFilter.appendChild(opt);
    }

    if (state.uncategorizedCount > 0) {
      const uncatOpt = document.createElement('option');
      uncatOpt.value = '__uncategorized__';
      uncatOpt.textContent = `Uncategorized (${state.uncategorizedCount})`;
      if (prevSelected === '__uncategorized__') {
        uncatOpt.selected = true;
        matchFound = true;
      }
      elements.libCategoryFilter.appendChild(uncatOpt);
    }

    if (!matchFound) {
      allOpt.selected = true;
      state.libCategoryFilter = 'all';
    }
  }

  /**
   * Populates the source filter <select> based on active library entries.
   */
  function populateSourceFilterDropdown() {
    if (!elements.libSourceFilter) return;

    const prevSelected = state.libSourceFilter || 'all';

    // Safe AMO-compliant DOM clear
    while (elements.libSourceFilter.firstChild) {
      elements.libSourceFilter.removeChild(elements.libSourceFilter.firstChild);
    }

    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'all';
    defaultOpt.textContent = 'All Sources';
    elements.libSourceFilter.appendChild(defaultOpt);

    const sourceCounts = new Map();
    for (const entry of (state.libraryEntries || [])) {
      const src = entry.sourceName || 'Unknown Source';
      sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
    }

    const sortedSources = Array.from(sourceCounts.keys()).sort((a, b) => a.localeCompare(b));
    for (const src of sortedSources) {
      const count = sourceCounts.get(src);
      const opt = document.createElement('option');
      opt.value = src;
      opt.textContent = `${src} (${count})`;
      if (src === prevSelected) {
        opt.selected = true;
      }
      elements.libSourceFilter.appendChild(opt);
    }
  }

  /**
   * Updates toggle button active classes for All vs Duplicates.
   */
  function updateLibraryFilterButtons() {
    if (elements.btnFilterAll && elements.btnFilterDups) {
      if (state.libFilterMode === 'duplicates') {
        elements.btnFilterAll.classList.remove('active');
        elements.btnFilterDups.classList.add('active');
      } else {
        elements.btnFilterAll.classList.add('active');
        elements.btnFilterDups.classList.remove('active');
      }
    }
    updateLibrarySelectionUI();
    updateDuplicateSelectionUI();
  }

  /**
   * Returns a specific source pill class for color-coding known manga sources.
   * @param {string} sourceName
   * @returns {string}
   */
  function getSourcePillClass(sourceName) {
    const s = (sourceName || '').toLowerCase();
    if (s.includes('mangadex')) return 'source-mangadex';
    if (s.includes('comix')) return 'source-comix';
    if (s.includes('asura')) return 'source-asura';
    if (s.includes('weeb') || s.includes('central')) return 'source-weebcentral';
    if (s.includes('flame')) return 'source-flame';
    return '';
  }

  /**
   * Returns library entries filtered by current search query, source, and category.
   * @returns {Array} Filtered library entries
   */
  function getFilteredLibraryEntries() {
    if (!state.libraryEntries || state.libraryEntries.length === 0) return [];
    const query = state.libSearchQuery || '';
    const sourceFilter = state.libSourceFilter || 'all';
    const categoryFilter = state.libCategoryFilter || 'all';

    return state.libraryEntries.filter(entry => {
      // 1. Source filter
      if (sourceFilter !== 'all' && entry.sourceName !== sourceFilter) {
        return false;
      }

      // 2. Category filter
      if (categoryFilter === '__uncategorized__') {
        if (!entry.isUncategorized && Array.isArray(entry.categoryNames) && entry.categoryNames.length > 0) {
          return false;
        }
      } else if (categoryFilter !== 'all') {
        if (!Array.isArray(entry.categoryNames) || !entry.categoryNames.includes(categoryFilter)) {
          return false;
        }
      }

      // 3. Search query (matches title, artist, author, source, and category names)
      if (query) {
        const titleMatch = entry.title && entry.title.toLowerCase().includes(query);
        const artistMatch = entry.artist && entry.artist.toLowerCase().includes(query);
        const authorMatch = entry.author && entry.author.toLowerCase().includes(query);
        const sourceMatch = entry.sourceName && entry.sourceName.toLowerCase().includes(query);
        const catMatch = Array.isArray(entry.categoryNames) && entry.categoryNames.some(cn => cn.toLowerCase().includes(query));
        if (!titleMatch && !artistMatch && !authorMatch && !sourceMatch && !catMatch) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Updates multi-selection bar state (counts, tri-state checkbox, Open Selected button).
   */
  function updateLibrarySelectionUI() {
    const isAllEntriesView = state.activeView === 'library' && state.libFilterMode !== 'duplicates';
    const hasEntries = state.libraryEntries && state.libraryEntries.length > 0;

    if (elements.libSelectionBar) {
      if (isAllEntriesView && hasEntries) {
        elements.libSelectionBar.classList.remove('hidden');
      } else {
        elements.libSelectionBar.classList.add('hidden');
      }
    }

    const filtered = getFilteredLibraryEntries();
    const selectedCount = state.selectedLibraryEntryIds.size;
    let visibleSelectedCount = 0;
    for (const e of filtered) {
      if (state.selectedLibraryEntryIds.has(e.id)) {
        visibleSelectedCount++;
      }
    }

    if (elements.libSelectCount) {
      elements.libSelectCount.textContent = `${selectedCount} selected`;
    }

    if (elements.libSelectAllCheckbox) {
      if (filtered.length === 0) {
        elements.libSelectAllCheckbox.checked = false;
        elements.libSelectAllCheckbox.indeterminate = false;
        elements.libSelectAllCheckbox.disabled = true;
      } else {
        elements.libSelectAllCheckbox.disabled = false;
        if (visibleSelectedCount === filtered.length) {
          elements.libSelectAllCheckbox.checked = true;
          elements.libSelectAllCheckbox.indeterminate = false;
        } else if (visibleSelectedCount > 0) {
          elements.libSelectAllCheckbox.checked = false;
          elements.libSelectAllCheckbox.indeterminate = true;
        } else {
          elements.libSelectAllCheckbox.checked = false;
          elements.libSelectAllCheckbox.indeterminate = false;
        }
      }
    }

    if (elements.libClearSelectionBtn) {
      if (selectedCount > 0) {
        elements.libClearSelectionBtn.classList.remove('hidden');
      } else {
        elements.libClearSelectionBtn.classList.add('hidden');
      }
    }

    if (elements.libOpenSelectedBtn) {
      elements.libOpenSelectedBtn.disabled = selectedCount === 0;
    }
    if (elements.libOpenSelectedText) {
      elements.libOpenSelectedText.textContent = `Open Selected (${selectedCount})`;
    }
  }

  /**
   * Toggles selection of a specific library entry.
   * @param {string} entryId
   */
  function toggleLibraryEntrySelection(entryId) {
    if (!entryId) return;
    if (state.selectedLibraryEntryIds.has(entryId)) {
      state.selectedLibraryEntryIds.delete(entryId);
    } else {
      state.selectedLibraryEntryIds.add(entryId);
    }

    // Direct DOM sync for immediate response
    const card = document.querySelector(`.lib-entry-card[data-entry-id="${entryId}"]`);
    if (card) {
      const isSelected = state.selectedLibraryEntryIds.has(entryId);
      card.classList.toggle('selected', isSelected);
      const cb = card.querySelector('.lib-card-checkbox');
      if (cb) cb.checked = isSelected;
    }

    updateLibrarySelectionUI();
  }

  /**
   * Selects all currently filtered library entries.
   */
  function selectAllFilteredLibraryEntries() {
    const filtered = getFilteredLibraryEntries();
    for (const entry of filtered) {
      state.selectedLibraryEntryIds.add(entry.id);
    }
    updateLibrarySelectionUI();
    renderLibraryView();
  }

  /**
   * Clears entire library selection.
   */
  function clearLibrarySelection() {
    state.selectedLibraryEntryIds.clear();
    updateLibrarySelectionUI();
    renderLibraryView();
  }

  /**
   * Opens the destination details/reader page for a single manga entry.
   * @param {{ url?: string, sourceName?: string, sourceId?: string, title?: string }} entry
   */
  function openMangaPage(entry) {
    if (!entry) return;
    const url = (typeof BackupParser !== 'undefined' && BackupParser.getMangaUrl)
      ? BackupParser.getMangaUrl(entry)
      : (entry.url || 'https://www.google.com');

    if (api && api.tabs && api.tabs.create) {
      api.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  }

  /**
   * Opens all selected manga pages in separate background tabs.
   * Deduplicates URLs and confirms if opening a large batch (> 25 tabs).
   */
  async function openSelectedMangaPages() {
    if (state.selectedLibraryEntryIds.size === 0) return;

    const selectedEntries = (state.libraryEntries || []).filter(e =>
      state.selectedLibraryEntryIds.has(e.id)
    );

    if (selectedEntries.length === 0) return;

    // Deduplicate target URLs to prevent duplicate tabs
    const uniqueUrls = new Set();
    const toOpen = [];

    for (const entry of selectedEntries) {
      const url = (typeof BackupParser !== 'undefined' && BackupParser.getMangaUrl)
        ? BackupParser.getMangaUrl(entry)
        : (entry.url || '');

      if (url && !uniqueUrls.has(url)) {
        uniqueUrls.add(url);
        toOpen.push({ title: entry.title, url });
      }
    }

    if (toOpen.length === 0) {
      alert('Could not resolve destination web pages for the selected manga.');
      return;
    }

    if (toOpen.length > 25) {
      const proceed = confirm(
        `You have selected ${toOpen.length} manga titles to open in separate tabs.\n\nOpening this many tabs simultaneously may cause high browser memory usage. Do you wish to continue?`
      );
      if (!proceed) return;
    }

    for (const item of toOpen) {
      try {
        if (api && api.tabs && api.tabs.create) {
          api.tabs.create({ url: item.url, active: false });
        } else {
          window.open(item.url, '_blank');
        }
      } catch (err) {
        console.warn(`Could not open tab for ${item.title}:`, err);
      }
    }
  }

  /**
   * State tracking for library rendering pagination/chunking
   */
  let libraryRenderLimit = 150;

  /**
   * Renders the Library Explorer list (either all entries or duplicate groups).
   * Fully AMO-compliant: constructs DOM nodes with document.createElement, textContent, setAttribute.
   */
  function renderLibraryView(showAllLimit = false) {
    if (!elements.libraryList) return;

    if (showAllLimit) {
      libraryRenderLimit += 200;
    } else {
      libraryRenderLimit = 150;
    }

    // Clear previous items safely
    while (elements.libraryList.firstChild) {
      elements.libraryList.removeChild(elements.libraryList.firstChild);
    }

    if (!state.libraryEntries || state.libraryEntries.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-search-state';
      const p = document.createElement('p');
      p.textContent = 'No library entries to display.';
      emptyBox.appendChild(p);
      elements.libraryList.appendChild(emptyBox);
      updateLibrarySelectionUI();
      return;
    }

    const query = state.libSearchQuery || '';
    const sourceFilter = state.libSourceFilter || 'all';

    if (state.libFilterMode === 'duplicates') {
      renderDuplicateGroupsView(query, sourceFilter);
    } else {
      renderAllEntriesView();
    }

    updateLibrarySelectionUI();
  }

  /**
   * Renders the 'All Entries' view.
   */
  function renderAllEntriesView() {
    // Build quick lookup for duplicates
    const dupKeySet = new Set((state.duplicates && state.duplicates.groups) ? state.duplicates.groups.map(g => g.key) : []);
    const filtered = getFilteredLibraryEntries();

    if (filtered.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-search-state';
      const p1 = document.createElement('strong');
      p1.textContent = 'No manga matching filter';
      const p2 = document.createElement('span');
      p2.textContent = 'Try adjusting your search terms, source, or category filter.';
      emptyBox.appendChild(p1);
      emptyBox.appendChild(p2);
      elements.libraryList.appendChild(emptyBox);
      return;
    }

    const totalMatching = filtered.length;
    const toRender = filtered.slice(0, libraryRenderLimit);

    for (const entry of toRender) {
      const isSelected = state.selectedLibraryEntryIds.has(entry.id);

      const card = document.createElement('div');
      card.className = `lib-entry-card ${isSelected ? 'selected' : ''}`.trim();
      card.setAttribute('data-entry-id', entry.id);

      // Multi-selection checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'manga-checkbox lib-card-checkbox';
      cb.checked = isSelected;
      cb.title = `Select "${entry.title}"`;
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleLibraryEntrySelection(entry.id);
      });
      card.appendChild(cb);

      // Card-level click navigation to manga page (unless clicking controls)
      card.addEventListener('click', (e) => {
        if (e.target.closest('input, button, select, a')) return;
        openMangaPage(entry);
      });

      const main = document.createElement('div');
      main.className = 'lib-entry-main';

      // Clickable title with visual link icon
      const titleEl = document.createElement('span');
      titleEl.className = 'lib-entry-title clickable-title';
      titleEl.title = `Click to open "${entry.title}" in a new tab`;

      const titleText = document.createElement('span');
      titleText.textContent = entry.title;
      titleEl.appendChild(titleText);

      const openIcon = document.createElement('span');
      openIcon.className = 'title-open-icon';
      openIcon.textContent = '↗';
      openIcon.setAttribute('aria-hidden', 'true');
      titleEl.appendChild(openIcon);

      titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openMangaPage(entry);
      });
      main.appendChild(titleEl);

      const sub = document.createElement('div');
      sub.className = 'lib-entry-sub';

      // Source pill
      const pill = document.createElement('span');
      const pillClass = getSourcePillClass(entry.sourceName);
      pill.className = `source-pill ${pillClass}`.trim();
      pill.textContent = entry.sourceName || 'Unknown Source';
      sub.appendChild(pill);

      // Category pills
      if (Array.isArray(entry.categoryNames) && entry.categoryNames.length > 0) {
        for (const catName of entry.categoryNames) {
          const catPill = document.createElement('span');
          catPill.className = 'category-pill';
          catPill.textContent = `📁 ${catName}`;
          catPill.title = `Category: ${catName}`;
          sub.appendChild(catPill);
        }
      }

      // Author / Artist if available
      const creator = (entry.author || entry.artist || '').trim();
      if (creator) {
        const creatorEl = document.createElement('span');
        creatorEl.className = 'lib-entry-creator';
        creatorEl.textContent = `• ${creator}`;
        sub.appendChild(creatorEl);
      }

      // Relative or absolute URL if available
      if (entry.url && entry.url !== '/') {
        const urlEl = document.createElement('span');
        urlEl.className = 'lib-entry-url';
        urlEl.textContent = entry.url;
        urlEl.title = entry.url;
        sub.appendChild(urlEl);
      }

      main.appendChild(sub);
      card.appendChild(main);

      // Duplicate badge if this entry has duplicates in the library
      const normKey = (typeof BackupParser !== 'undefined' && BackupParser.getNormalizedDuplicateKey)
        ? BackupParser.getNormalizedDuplicateKey(entry.title)
        : entry.title.toLowerCase();

      if (dupKeySet.has(normKey)) {
        const dupBadge = document.createElement('button');
        dupBadge.type = 'button';
        dupBadge.className = 'lib-entry-badge-dup';
        dupBadge.title = 'Click to inspect duplicates of this title';
        dupBadge.textContent = '⚠️ Duplicate';
        dupBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          state.libFilterMode = 'duplicates';
          state.libSearchQuery = entry.title.toLowerCase();
          if (elements.libSearchInput) elements.libSearchInput.value = entry.title;
          updateLibraryFilterButtons();
          renderLibraryView();
        });
        card.appendChild(dupBadge);
      }

      elements.libraryList.appendChild(card);
    }

    // Show more button if truncated
    if (totalMatching > libraryRenderLimit) {
      const moreBtnContainer = document.createElement('div');
      moreBtnContainer.style.textAlign = 'center';
      moreBtnContainer.style.padding = '8px';

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'btn-sm btn-secondary';
      moreBtn.textContent = `Show More (+${Math.min(200, totalMatching - libraryRenderLimit)} of ${totalMatching - libraryRenderLimit} remaining)`;
      moreBtn.addEventListener('click', () => {
        renderLibraryView(true);
      });
      moreBtnContainer.appendChild(moreBtn);
      elements.libraryList.appendChild(moreBtnContainer);
    }
  }

  /**
   * Loads saved source preference ordering from storage.
   */
  async function loadSourcePreferences() {
    try {
      if (api.storage && api.storage.local) {
        const data = await api.storage.local.get(STORAGE_KEY_SOURCE_PRIORITIES);
        if (data && Array.isArray(data[STORAGE_KEY_SOURCE_PRIORITIES])) {
          state.sourcePreferences = data[STORAGE_KEY_SOURCE_PRIORITIES];
        }
      }
    } catch (e) {
      console.warn('Could not load source preferences from storage:', e);
    }
  }

  /**
   * Persists source preference ordering to storage.
   * @param {string[]} prefs
   */
  async function saveSourcePreferences(prefs) {
    state.sourcePreferences = prefs;
    try {
      if (api.storage && api.storage.local) {
        await api.storage.local.set({ [STORAGE_KEY_SOURCE_PRIORITIES]: prefs });
      }
    } catch (e) {
      console.warn('Could not save source preferences to storage:', e);
    }
  }

  /**
   * Synchronizes source preference list with sources currently present among duplicate manga.
   * Keeps existing order and appends newly discovered sources to the bottom.
   */
  function syncSourcePreferencesWithDuplicates() {
    const sourcesInDups = (state.duplicates && Array.isArray(state.duplicates.sourcesInDuplicates))
      ? state.duplicates.sourcesInDuplicates
      : [];

    if (sourcesInDups.length === 0) return;

    const currentList = Array.isArray(state.sourcePreferences) ? [...state.sourcePreferences] : [];
    const ordered = [];

    // Retain existing ranking for sources that are still present
    for (const src of currentList) {
      if (sourcesInDups.includes(src) && !ordered.includes(src)) {
        ordered.push(src);
      }
    }

    // Append newly found sources at the end
    for (const src of sourcesInDups) {
      if (!ordered.includes(src)) {
        ordered.push(src);
      }
    }

    state.sourcePreferences = ordered;
  }

  /**
   * Applies an automated duplicate selection rule and updates UI selection state.
   * @param {'sourcePreference' | 'oldest' | 'newest' | 'all' | 'none'} ruleName
   */
  function applyAutoSelectRule(ruleName) {
    if (!state.duplicates || !Array.isArray(state.duplicates.groups) || state.duplicates.groups.length === 0) {
      return;
    }
    state.activeAutoRule = ruleName;
    BackupParser.applyDuplicateSelectionRule(state.duplicates.groups, ruleName, {
      sourcePreferences: state.sourcePreferences
    });

    // Synchronize selectedDuplicateEntryIds
    state.selectedDuplicateEntryIds.clear();
    if (ruleName !== 'none') {
      for (const group of state.duplicates.groups) {
        for (const entry of group.entries) {
          if (entry.isSelectedForDelete) {
            state.selectedDuplicateEntryIds.add(entry.id);
          }
        }
      }
    }

    updateDuplicateSelectionUI();
    renderLibraryView();
  }

  /**
   * Updates duplicate selection toolbar count, delete button disabled status, and visibility.
   */
  function updateDuplicateSelectionUI() {
    const count = state.selectedDuplicateEntryIds.size;
    if (elements.dupSelectCount) {
      elements.dupSelectCount.textContent = `${count} duplicate${count === 1 ? '' : 's'} selected`;
    }
    if (elements.btnDeleteSelectedDups) {
      elements.btnDeleteSelectedDups.disabled = count === 0;
    }
    if (elements.btnDeleteSelectedText) {
      elements.btnDeleteSelectedText.textContent = `Delete Selected (${count})`;
    }

    // Action bar is visible only when in Duplicates filter view with > 0 duplicates
    const isDupsView = state.activeView === 'library' && state.libFilterMode === 'duplicates';
    const hasDups = state.duplicates && state.duplicates.duplicateGroupsCount > 0;
    if (elements.dupActionsBar) {
      if (isDupsView && hasDups) {
        elements.dupActionsBar.classList.remove('hidden');
      } else {
        elements.dupActionsBar.classList.add('hidden');
      }
    }
  }

  /**
   * Toggles selection of a specific duplicate entry, maintaining the invariant
   * that at least 1 entry is retained per group.
   * @param {string} groupKey
   * @param {string} entryId
   */
  function toggleDuplicateEntrySelection(groupKey, entryId) {
    const group = (state.duplicates && state.duplicates.groups)
      ? state.duplicates.groups.find(g => g.key === groupKey)
      : null;
    if (!group) return;

    const entry = group.entries.find(e => e.id === entryId);
    if (!entry) return;

    const willSelectForDelete = !state.selectedDuplicateEntryIds.has(entryId);

    if (willSelectForDelete) {
      // If marking the current keep entry for deletion, transfer keep status to another copy
      if (entry.isKeep) {
        const otherEntry = group.entries.find(e => e.id !== entryId);
        if (otherEntry) {
          otherEntry.isKeep = true;
          otherEntry.isSelectedForDelete = false;
          otherEntry.decisionReason = 'Retained entry (automatic fallback)';
          state.selectedDuplicateEntryIds.delete(otherEntry.id);
          group.keepEntry = otherEntry;
        } else {
          alert('Cannot delete this entry: at least one copy of every manga must be retained.');
          return;
        }
      }

      state.selectedDuplicateEntryIds.add(entryId);
      entry.isSelectedForDelete = true;
      entry.isKeep = false;
      entry.decisionReason = 'Manually selected for deletion';
    } else {
      state.selectedDuplicateEntryIds.delete(entryId);
      entry.isSelectedForDelete = false;
      entry.decisionReason = 'Preserved by user';

      // Ensure at least one entry has isKeep = true
      const hasKeep = group.entries.some(e => e.isKeep);
      if (!hasKeep) {
        entry.isKeep = true;
        entry.decisionReason = 'Designated entry to retain';
        group.keepEntry = entry;
      }
    }

    updateDuplicateSelectionUI();
    renderLibraryView();
  }

  /**
   * Designates a specific entry to be kept and marks all other copies in the group for deletion.
   * @param {string} groupKey
   * @param {string} entryId
   */
  function setGroupKeepEntry(groupKey, entryId) {
    const group = (state.duplicates && state.duplicates.groups)
      ? state.duplicates.groups.find(g => g.key === groupKey)
      : null;
    if (!group) return;

    for (const entry of group.entries) {
      if (entry.id === entryId) {
        entry.isKeep = true;
        entry.isSelectedForDelete = false;
        entry.decisionReason = 'Designated entry to retain (user choice)';
        state.selectedDuplicateEntryIds.delete(entry.id);
        group.keepEntry = entry;
      } else {
        entry.isKeep = false;
        entry.isSelectedForDelete = true;
        entry.decisionReason = 'Redundant duplicate entry';
        state.selectedDuplicateEntryIds.add(entry.id);
      }
    }

    updateDuplicateSelectionUI();
    renderLibraryView();
  }

  /**
   * Opens the Source Priority Ranking modal.
   */
  function openSourcePreferencesModal() {
    syncSourcePreferencesWithDuplicates();
    renderSourcePreferencesList();
    if (elements.sourcePrefModalBackdrop) {
      elements.sourcePrefModalBackdrop.classList.remove('hidden');
    }
  }

  /**
   * Closes the Source Priority Ranking modal.
   */
  function closeSourcePreferencesModal() {
    if (elements.sourcePrefModalBackdrop) {
      elements.sourcePrefModalBackdrop.classList.add('hidden');
    }
  }

  let draggedSourceIndex = null;

  /**
   * Renders the draggable and reorderable source priority list.
   */
  function renderSourcePreferencesList() {
    if (!elements.sourcePriorityList) return;
    while (elements.sourcePriorityList.firstChild) {
      elements.sourcePriorityList.removeChild(elements.sourcePriorityList.firstChild);
    }

    const list = state.sourcePreferences;
    if (!list || list.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'modal-desc';
      emptyP.textContent = 'No duplicate sources found in current backup.';
      elements.sourcePriorityList.appendChild(emptyP);
      return;
    }

    // Calculate duplicate entry count per source
    const countsBySource = new Map();
    if (state.duplicates && state.duplicates.groups) {
      for (const g of state.duplicates.groups) {
        for (const e of g.entries) {
          const s = e.sourceName || 'Unknown Source';
          countsBySource.set(s, (countsBySource.get(s) || 0) + 1);
        }
      }
    }

    list.forEach((sourceName, index) => {
      const item = document.createElement('div');
      item.className = 'source-priority-item';
      item.draggable = true;
      item.dataset.index = String(index);

      const left = document.createElement('div');
      left.className = 'source-priority-item-left';

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.title = 'Drag to reorder priority';
      handle.textContent = '⋮⋮';
      left.appendChild(handle);

      const rankBadge = document.createElement('span');
      rankBadge.className = 'source-priority-rank';
      rankBadge.textContent = String(index + 1);
      left.appendChild(rankBadge);

      const name = document.createElement('span');
      name.className = 'source-priority-name';
      name.textContent = sourceName;
      left.appendChild(name);

      item.appendChild(left);

      const count = countsBySource.get(sourceName) || 0;
      const countEl = document.createElement('span');
      countEl.className = 'source-priority-count';
      countEl.textContent = `${count} entries`;
      item.appendChild(countEl);

      const arrows = document.createElement('div');
      arrows.className = 'source-priority-arrows';

      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn-rank-move';
      btnUp.textContent = '▲';
      btnUp.title = 'Move Up';
      btnUp.disabled = index === 0;
      btnUp.addEventListener('click', (e) => {
        e.stopPropagation();
        moveSourcePriority(index, index - 1);
      });
      arrows.appendChild(btnUp);

      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn-rank-move';
      btnDown.textContent = '▼';
      btnDown.title = 'Move Down';
      btnDown.disabled = index === list.length - 1;
      btnDown.addEventListener('click', (e) => {
        e.stopPropagation();
        moveSourcePriority(index, index + 1);
      });
      arrows.appendChild(btnDown);

      item.appendChild(arrows);

      // Drag and drop event handlers
      item.addEventListener('dragstart', (e) => {
        draggedSourceIndex = index;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        draggedSourceIndex = null;
        const allItems = elements.sourcePriorityList.querySelectorAll('.source-priority-item');
        allItems.forEach(el => el.classList.remove('drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (draggedSourceIndex !== null && draggedSourceIndex !== index) {
          moveSourcePriority(draggedSourceIndex, index);
        }
      });

      elements.sourcePriorityList.appendChild(item);
    });
  }

  /**
   * Reorders source priority list.
   * @param {number} fromIdx
   * @param {number} toIdx
   */
  function moveSourcePriority(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= state.sourcePreferences.length ||
        toIdx < 0 || toIdx >= state.sourcePreferences.length) return;

    const list = [...state.sourcePreferences];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    state.sourcePreferences = list;
    renderSourcePreferencesList();
  }

  /**
   * Resets source priority list to natural alphabetical order.
   */
  function handleResetSourcePriorities() {
    const sourcesInDups = (state.duplicates && Array.isArray(state.duplicates.sourcesInDuplicates))
      ? [...state.duplicates.sourcesInDuplicates]
      : [];
    state.sourcePreferences = sourcesInDups.sort((a, b) => a.localeCompare(b));
    renderSourcePreferencesList();
  }

  /**
   * Saves source priorities to storage, re-applies source preference rule, and closes modal.
   */
  async function handleSaveSourcePriorities() {
    await saveSourcePreferences(state.sourcePreferences);
    closeSourcePreferencesModal();
    applyAutoSelectRule('sourcePreference');
  }

  /**
   * Opens pre-deletion confirmation modal summarizing entries to be removed.
   * @param {Array<Object>} [customEntries] Optional custom list for single-entry deletion
   */
  function openDeleteConfirmModal(customEntries = null) {
    let entriesToDelete = [];
    if (Array.isArray(customEntries) && customEntries.length > 0) {
      entriesToDelete = customEntries;
    } else {
      for (const group of (state.duplicates.groups || [])) {
        for (const entry of group.entries) {
          if (state.selectedDuplicateEntryIds.has(entry.id)) {
            entriesToDelete.push(entry);
          }
        }
      }
    }

    if (entriesToDelete.length === 0) {
      alert('No duplicate entries selected for deletion.');
      return;
    }

    state.pendingDeletionEntries = entriesToDelete;

    const totalToDelete = entriesToDelete.length;
    const affectedTitles = new Set(entriesToDelete.map(e => e.title.toLowerCase())).size;
    const totalLibrary = state.libraryEntries ? state.libraryEntries.length : 0;
    const remainingCount = Math.max(0, totalLibrary - totalToDelete);

    if (elements.confirmDeleteCount) {
      elements.confirmDeleteCount.textContent = `${totalToDelete} duplicate ${totalToDelete === 1 ? 'entry' : 'entries'}`;
    }
    if (elements.confirmTitlesCount) {
      elements.confirmTitlesCount.textContent = `${affectedTitles} unique ${affectedTitles === 1 ? 'title' : 'titles'}`;
    }
    if (elements.confirmRetainedCount) {
      elements.confirmRetainedCount.textContent = `${remainingCount.toLocaleString()} manga`;
    }

    if (elements.deleteConfirmModalBackdrop) {
      elements.deleteConfirmModalBackdrop.classList.remove('hidden');
    }
  }

  /**
   * Closes pre-deletion confirmation modal.
   */
  function closeDeleteConfirmModal() {
    state.pendingDeletionEntries = [];
    if (elements.deleteConfirmModalBackdrop) {
      elements.deleteConfirmModalBackdrop.classList.add('hidden');
    }
  }

  /**
   * Executes deletion of pending duplicate entries from the backup.
   */
  async function executeDuplicateDeletion() {
    const entriesToDelete = state.pendingDeletionEntries;
    if (!entriesToDelete || entriesToDelete.length === 0) return;

    closeDeleteConfirmModal();

    if (!state.originalBackupBuffer) {
      alert('Original backup buffer not found in memory. Please reload the backup file.');
      return;
    }

    elements.progressBarContainer.classList.remove('hidden');
    elements.progressText.textContent = `Removing ${entriesToDelete.length} duplicates from backup...`;

    try {
      await new Promise(r => setTimeout(r, 40));

      const result = await BackupParser.removeEntriesFromBackup(
        state.originalBackupBuffer,
        entriesToDelete
      );

      // Update in-memory buffer and cleaned Blob
      state.originalBackupBuffer = result.compressedBytes;
      state.lastCleanedBlob = result.blob;

      // Persist cleaned buffer in IndexedDB
      if (typeof BackupStorage !== 'undefined') {
        try {
          await BackupStorage.saveBackup(result.compressedBytes, state.backupFileName);
        } catch (e) {
          console.warn('BackupStorage update failed:', e);
        }
      }

      // Re-parse the updated backup buffer
      const parsed = await BackupParser.parseKomikkuBackup(result.compressedBytes);
      state.komikkuTitles = parsed.titles;
      state.komikkuTitlesList = parsed.titlesList;
      state.libraryEntries = parsed.entries || [];
      state.sources = parsed.sources || { byId: new Map(), byName: new Map() };
      state.categories = parsed.categories || [];
      state.categoriesByOrder = parsed.categoriesByOrder || new Map();
      state.uncategorizedCount = parsed.uncategorizedCount || 0;
      state.duplicates = parsed.duplicates || {
        groups: [],
        totalDuplicatesCount: 0,
        duplicateGroupsCount: 0,
        sameSourceGroupsCount: 0,
        crossSourceGroupsCount: 0,
        sourcesInDuplicates: []
      };

      // Clear selection set
      state.selectedDuplicateEntryIds.clear();

      // Save updated titles to extension storage
      await saveLibraryToStorage(state.backupFileName, parsed.titlesList);

      // Re-run auto selection if any duplicates remain
      if (state.duplicates.duplicateGroupsCount > 0) {
        BackupParser.applyDuplicateSelectionRule(state.duplicates.groups, state.activeAutoRule, {
          sourcePreferences: state.sourcePreferences
        });
        for (const g of state.duplicates.groups) {
          for (const e of g.entries) {
            if (e.isSelectedForDelete) {
              state.selectedDuplicateEntryIds.add(e.id);
            }
          }
        }
      }

      // Update UI elements
      showLoadedFileUI(state.backupFileName, parsed.count);
      updateLibraryUIStats();
      populateSourceFilterDropdown();
      populateCategoryFilterControls();
      updateDuplicateSelectionUI();
      renderLibraryView();

      // Open Success Modal
      openCleanupSuccessModal(result.removedCount, state.libraryEntries.length);
    } catch (err) {
      console.error('Failed to remove duplicate entries:', err);
      alert(`Cleanup failed: ${err.message}`);
    } finally {
      elements.progressBarContainer.classList.add('hidden');
    }
  }

  /**
   * Opens the post-cleanup success and download modal.
   * @param {number} removedCount
   * @param {number} remainingCount
   */
  function openCleanupSuccessModal(removedCount, remainingCount) {
    if (elements.cleanupSuccessRemovedCount) {
      elements.cleanupSuccessRemovedCount.textContent = `${removedCount}`;
    }
    if (elements.cleanupSuccessRemainingCount) {
      elements.cleanupSuccessRemainingCount.textContent = `${remainingCount.toLocaleString()}`;
    }
    if (elements.cleanupSuccessSummaryText) {
      elements.cleanupSuccessSummaryText.textContent = `Successfully removed ${removedCount} duplicate ${removedCount === 1 ? 'entry' : 'entries'} from your library backup.`;
    }
    if (elements.cleanupSuccessModalBackdrop) {
      elements.cleanupSuccessModalBackdrop.classList.remove('hidden');
    }
  }

  /**
   * Closes the post-cleanup success modal.
   */
  function closeCleanupSuccessModal() {
    if (elements.cleanupSuccessModalBackdrop) {
      elements.cleanupSuccessModalBackdrop.classList.add('hidden');
    }
  }

  /**
   * Triggers download of the cleaned .tachibk backup file.
   */
  function downloadCleanedBackup() {
    if (!state.lastCleanedBlob && !state.originalBackupBuffer) {
      alert('No cleaned backup available to download.');
      return;
    }

    const blob = state.lastCleanedBlob || new Blob([state.originalBackupBuffer], { type: 'application/gzip' });
    const originalName = state.backupFileName || 'backup.tachibk';
    const baseName = originalName.replace(/\.(tachibk|proto\.gz|gz|json)$/i, '');
    const ext = originalName.endsWith('.tachibk') ? '.tachibk' : '.proto.gz';
    const filename = `${baseName}_cleaned${ext}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /**
   * Renders the 'Duplicates' grouped view with checkboxes, keep/delete badges,
   * reason indicators, date added, and individual action buttons.
   * Fully AMO-compliant: constructs DOM nodes with document.createElement, textContent, setAttribute.
   */
  function renderDuplicateGroupsView(query, sourceFilter) {
    const categoryFilter = state.libCategoryFilter || 'all';

    const allGroups = (state.duplicates && state.duplicates.groups) ? state.duplicates.groups : [];

    const filtered = allGroups.filter(group => {
      // 1. Source filter: at least one entry in the group matches this source
      if (sourceFilter !== 'all') {
        const hasSource = group.entries.some(e => e.sourceName === sourceFilter);
        if (!hasSource) return false;
      }

      // 2. Category filter: at least one entry in the group matches this category
      if (categoryFilter === '__uncategorized__') {
        const hasUncat = group.entries.some(e => e.isUncategorized || !e.categoryNames || e.categoryNames.length === 0);
        if (!hasUncat) return false;
      } else if (categoryFilter !== 'all') {
        const hasCat = group.entries.some(e => Array.isArray(e.categoryNames) && e.categoryNames.includes(categoryFilter));
        if (!hasCat) return false;
      }

      // 3. Search query
      if (query) {
        const canonMatch = group.canonicalTitle.toLowerCase().includes(query);
        const entriesMatch = group.entries.some(e =>
          (e.title && e.title.toLowerCase().includes(query)) ||
          (e.sourceName && e.sourceName.toLowerCase().includes(query)) ||
          (e.author && e.author.toLowerCase().includes(query)) ||
          (e.artist && e.artist.toLowerCase().includes(query)) ||
          (Array.isArray(e.categoryNames) && e.categoryNames.some(cn => cn.toLowerCase().includes(query)))
        );
        if (!canonMatch && !entriesMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-search-state';
      const p1 = document.createElement('strong');
      p1.textContent = allGroups.length === 0 ? 'No Duplicate Titles Found!' : 'No duplicates matching filter';
      const p2 = document.createElement('span');
      p2.textContent = allGroups.length === 0
        ? 'Your library has 0 duplicate entries across all sources.'
        : 'Try adjusting your search terms, source, or category filter.';
      emptyBox.appendChild(p1);
      emptyBox.appendChild(p2);
      elements.libraryList.appendChild(emptyBox);
      return;
    }

    const totalMatching = filtered.length;
    const toRender = filtered.slice(0, libraryRenderLimit);

    for (const group of toRender) {
      const groupCard = document.createElement('div');
      groupCard.className = 'dup-group-card';

      // Group Header
      const header = document.createElement('div');
      header.className = 'dup-group-header';

      const titleRow = document.createElement('div');
      titleRow.className = 'dup-group-title-row';

      const title = document.createElement('span');
      title.className = 'dup-group-title';
      title.textContent = group.canonicalTitle;
      title.title = group.canonicalTitle;
      titleRow.appendChild(title);

      const countBadge = document.createElement('span');
      countBadge.className = 'dup-count-badge';
      countBadge.textContent = `${group.count} copies`;
      titleRow.appendChild(countBadge);

      header.appendChild(titleRow);

      // Type Badge (Same Source vs Cross-Source)
      const typeBadge = document.createElement('span');
      typeBadge.className = `dup-type-badge ${group.isSameSource ? 'same-source' : 'cross-source'}`;
      typeBadge.textContent = group.isSameSource ? 'Same Source' : 'Cross-Source';
      typeBadge.title = group.isSameSource
        ? 'All copies belong to the same manga source'
        : `Copies from ${group.sources.length} different sources: ${group.sources.join(', ')}`;
      header.appendChild(typeBadge);

      groupCard.appendChild(header);

      // Group Entries
      const entriesContainer = document.createElement('div');
      entriesContainer.className = 'dup-group-entries';

      for (const entry of group.entries) {
        const isDelete = state.selectedDuplicateEntryIds.has(entry.id);
        const isKeep = !isDelete;

        const row = document.createElement('div');
        row.className = `dup-entry-row ${isDelete ? 'marked-for-delete' : 'marked-as-keep'}`;

        const left = document.createElement('div');
        left.className = 'dup-entry-left';

        // Checkbox for selection
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'manga-checkbox dup-entry-checkbox';
        checkbox.checked = isDelete;
        checkbox.title = isKeep
          ? 'Currently designated to KEEP. Checking will select for deletion and designate another copy to keep.'
          : 'Toggle selection for deletion';
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        checkbox.addEventListener('change', () => {
          toggleDuplicateEntrySelection(group.key, entry.id);
        });
        left.appendChild(checkbox);

        // Click row to open manga page (unless clicking controls)
        row.addEventListener('click', (e) => {
          if (e.target.closest('input, button, select, a')) return;
          openMangaPage(entry);
        });

        // Entry Information
        const info = document.createElement('div');
        info.className = 'dup-entry-info';

        const rowTitle = document.createElement('span');
        rowTitle.className = 'dup-entry-title clickable-title';
        rowTitle.title = `Click to open "${entry.title}" (${entry.sourceName || 'source'}) in a new tab`;

        const rowTitleText = document.createElement('span');
        rowTitleText.textContent = entry.title;
        rowTitle.appendChild(rowTitleText);

        const openIcon = document.createElement('span');
        openIcon.className = 'title-open-icon';
        openIcon.textContent = '↗';
        openIcon.setAttribute('aria-hidden', 'true');
        rowTitle.appendChild(openIcon);

        rowTitle.addEventListener('click', (e) => {
          e.stopPropagation();
          openMangaPage(entry);
        });
        info.appendChild(rowTitle);

        // Metadata row
        const meta = document.createElement('div');
        meta.className = 'dup-entry-meta';

        // Source pill
        const pill = document.createElement('span');
        const pillClass = getSourcePillClass(entry.sourceName);
        pill.className = `source-pill ${pillClass}`.trim();
        pill.textContent = entry.sourceName || 'Unknown Source';
        meta.appendChild(pill);

        // Category pills
        if (Array.isArray(entry.categoryNames) && entry.categoryNames.length > 0) {
          for (const catName of entry.categoryNames) {
            const catPill = document.createElement('span');
            catPill.className = 'category-pill';
            catPill.textContent = `📁 ${catName}`;
            catPill.title = `Category: ${catName}`;
            meta.appendChild(catPill);
          }
        }

        // Status badge (✓ KEEP vs 🗑 DELETE)
        const badge = document.createElement('span');
        badge.className = `badge-status ${isKeep ? 'badge-keep' : 'badge-delete'}`;
        badge.textContent = isKeep ? '✓ KEEP' : '🗑 DELETE';
        meta.appendChild(badge);

        // Date Added badge
        const dateBadge = document.createElement('span');
        dateBadge.className = 'dup-date-badge';
        dateBadge.textContent = `📅 ${entry.formattedDate || 'Unknown date'}`;
        dateBadge.title = entry.dateAdded > 0
          ? `Added: ${new Date(entry.dateAdded).toLocaleString()}`
          : 'Date added not recorded in backup';
        meta.appendChild(dateBadge);

        // Decision Reason badge
        if (entry.decisionReason) {
          const reasonBadge = document.createElement('span');
          reasonBadge.className = 'dup-reason-badge';
          reasonBadge.textContent = entry.decisionReason;
          reasonBadge.title = `Cleanup reason: ${entry.decisionReason}`;
          meta.appendChild(reasonBadge);
        }

        info.appendChild(meta);
        left.appendChild(info);
        row.appendChild(left);

        // Right Action Buttons
        const right = document.createElement('div');
        right.className = 'dup-entry-right';

        if (!isKeep) {
          const btnKeep = document.createElement('button');
          btnKeep.type = 'button';
          btnKeep.className = 'btn-set-keep';
          btnKeep.textContent = 'Keep This';
          btnKeep.title = 'Keep this copy instead and select other duplicates for deletion';
          btnKeep.addEventListener('click', (e) => {
            e.stopPropagation();
            setGroupKeepEntry(group.key, entry.id);
          });
          right.appendChild(btnKeep);
        }

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-delete-single';
        btnDel.textContent = '🗑';
        btnDel.title = 'Delete this individual duplicate entry';
        btnDel.addEventListener('click', (e) => {
          e.stopPropagation();
          openDeleteConfirmModal([entry]);
        });
        right.appendChild(btnDel);

        row.appendChild(right);
        entriesContainer.appendChild(row);
      }

      groupCard.appendChild(entriesContainer);
      elements.libraryList.appendChild(groupCard);
    }

    // Show more button if truncated
    if (totalMatching > libraryRenderLimit) {
      const moreBtnContainer = document.createElement('div');
      moreBtnContainer.style.textAlign = 'center';
      moreBtnContainer.style.padding = '8px';

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'btn-sm btn-secondary';
      moreBtn.textContent = `Show More (+${Math.min(200, totalMatching - libraryRenderLimit)} of ${totalMatching - libraryRenderLimit} remaining)`;
      moreBtn.addEventListener('click', () => {
        renderLibraryView(true);
      });
      moreBtnContainer.appendChild(moreBtn);
      elements.libraryList.appendChild(moreBtnContainer);
    }
  }

  // Initialize once DOM is ready
  document.addEventListener('DOMContentLoaded', init);
})();
