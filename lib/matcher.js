/**
 * Manga Matcher & Comparator
 * Cross-references cleaned tab titles with Komikku library titles.
 * Handles exact matching, punctuation-insensitive matching, and strict word-bounded substring matching.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./title-cleaner')
    );
  } else {
    root.MangaMatcher = factory(root.TitleCleaner);
  }
})(typeof self !== 'undefined' ? self : this, function (TitleCleaner) {
  'use strict';

  /**
   * Helper to escape special characters for regular expressions.
   * @param {string} str
   * @returns {string}
   */
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Normalizes a title for punctuation-insensitive matching.
   * Strips symbols like '×' (as in SPY×FAMILY), colons, hyphens, and whitespace.
   * @param {string} str
   * @returns {string}
   */
  function normalizePunctuation(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/×/g, 'x')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Pre-computes normalized lookups from the Komikku title set.
   * @param {Set<string>|string[]} komikkuTitles
   * @returns {{
   *   rawSet: Set<string>,
   *   list: string[],
   *   normalizedMap: Map<string, string>,
   *   processedList: Array<{ original: string, lower: string, normalized: string }>
   * }}
   */
  function prepareLibraryIndex(komikkuTitles) {
    const rawSet = komikkuTitles instanceof Set ? komikkuTitles : new Set(komikkuTitles);
    const list = Array.from(rawSet);
    const normalizedMap = new Map();
    const processedList = [];

    for (let i = 0; i < list.length; i++) {
      const orig = list[i];
      const lower = orig.toLowerCase().trim();
      const norm = normalizePunctuation(orig);

      if (norm.length >= 2 && !normalizedMap.has(norm)) {
        normalizedMap.set(norm, orig);
      }

      processedList.push({
        original: orig,
        lower: lower,
        normalized: norm
      });
    }

    return { rawSet, list, normalizedMap, processedList };
  }

  /**
   * Determines if a cleaned tab title matches any Komikku library entry.
   * Prevents false positives by enforcing word boundaries and minimum length/ratio thresholds.
   *
   * @param {string} cleanTitle - The cleaned, lowercased tab title
   * @param {{
   *   rawSet: Set<string>,
   *   list: string[],
   *   normalizedMap: Map<string, string>,
   *   processedList: Array<{ original: string, lower: string, normalized: string }>
   * }} index
   * @returns {{ matched: boolean, matchedTitle?: string }}
   */
  function checkMatch(cleanTitle, index) {
    if (!cleanTitle || typeof cleanTitle !== 'string') {
      return { matched: false };
    }

    const clean = cleanTitle.trim().toLowerCase();
    if (clean.length === 0) {
      return { matched: false };
    }

    // 1. Direct exact lowercase match (O(1))
    if (index.rawSet.has(clean)) {
      return { matched: true, matchedTitle: clean };
    }

    // 2. Normalized exact match (O(1) lookup, e.g. "SPY x FAMILY" vs "SPY×FAMILY")
    const normTab = normalizePunctuation(clean);
    if (normTab.length >= 3 && index.normalizedMap.has(normTab)) {
      return { matched: true, matchedTitle: index.normalizedMap.get(normTab) };
    }

    // 3. Word-bounded substring matching
    // Avoid short tokens or common single-letter noise
    const tabLen = clean.length;
    const tabRegex = tabLen >= 4 ? new RegExp('\\b' + escapeRegex(clean) + '\\b', 'i') : null;

    for (let i = 0; i < index.processedList.length; i++) {
      const item = index.processedList[i];
      const kLower = item.lower;
      const kLen = kLower.length;

      // Exact check
      if (kLower === clean) {
        return { matched: true, matchedTitle: item.original };
      }

      // Case A: The cleaned tab title is a substantive prefix or word-bounded substring of a longer library title
      // Example: Tab = "frieren", Library = "Sousou no Frieren" or "Frieren: Beyond Journey's End"
      // Guard: Tab title must be at least 4 chars and represent at least 35% of the library title
      if (tabRegex && kLen > tabLen && (tabLen / kLen >= 0.35)) {
        if (tabRegex.test(kLower)) {
          return { matched: true, matchedTitle: item.original };
        }
      }

      // Case B: The library title is a substantive prefix or word-bounded substring of the tab title
      // Example: Library = "One Piece", Tab = "One Piece Digital Colored Edition"
      // Guard: Library title must be at least 4 chars and represent at least 50% of the tab title!
      // This strictly prevents short words like "Love" from falsely matching "Love and Risk"!
      if (kLen >= 4 && tabLen > kLen && (kLen / tabLen >= 0.50)) {
        const kRegex = new RegExp('\\b' + escapeRegex(kLower) + '\\b', 'i');
        if (kRegex.test(clean)) {
          return { matched: true, matchedTitle: item.original };
        }
      }
    }

    return { matched: false };
  }

  /**
   * Cross-references an array of browser tabs against Komikku library titles.
   * @param {Array<{ id: number, title: string, url: string, favIconUrl?: string }>} tabs
   * @param {Set<string>|string[]} komikkuTitles
   * @returns {{
   *   totalTabs: number,
   *   missingCount: number,
   *   foundCount: number,
   *   missing: Array<{ id: number, cleanedTitle: string, originalTitle: string, url: string, domain: string, favIconUrl?: string }>,
   *   found: Array<{ id: number, cleanedTitle: string, originalTitle: string, matchedWith: string, url: string, domain: string }>,
   *   missingByDomain: Record<string, Array<{ id: number, cleanedTitle: string, originalTitle: string, url: string, domain: string }>>
   * }}
   */
  function compareTabsWithLibrary(tabs, komikkuTitles) {
    const cleaner = TitleCleaner || (typeof window !== 'undefined' ? window.TitleCleaner : null);
    const index = prepareLibraryIndex(komikkuTitles);

    const missing = [];
    const found = [];
    const missingByDomain = {};

    for (const tab of tabs) {
      const url = tab.url || '';
      const domain = cleaner ? cleaner.extractDomain(url) : 'Unknown';
      const cleanedTitle = cleaner ? cleaner.cleanTabTitle(tab.title, url) : (tab.title || '').toLowerCase().trim();
      const displayCleanedTitle = cleaner ? cleaner.cleanTabTitle(tab.title, url, true) : (tab.title || '').trim();

      const effectiveTitle = cleanedTitle || (tab.title || '').trim().toLowerCase();
      const matchResult = checkMatch(effectiveTitle, index);

      const tabRecord = {
        id: tab.id,
        windowId: tab.windowId,
        cleanedTitle: effectiveTitle,
        backupTitle: displayCleanedTitle || effectiveTitle,
        originalTitle: tab.title || 'Untitled Tab',
        url: url,
        domain: domain,
        favIconUrl: tab.favIconUrl
      };

      if (matchResult.matched) {
        tabRecord.matchedWith = matchResult.matchedTitle;
        found.push(tabRecord);
      } else {
        missing.push(tabRecord);

        if (!missingByDomain[domain]) {
          missingByDomain[domain] = [];
        }
        missingByDomain[domain].push(tabRecord);
      }
    }

    return {
      totalTabs: tabs.length,
      missingCount: missing.length,
      foundCount: found.length,
      missing,
      found,
      missingByDomain
    };
  }

  return {
    normalizePunctuation,
    prepareLibraryIndex,
    checkMatch,
    compareTabsWithLibrary
  };
});
