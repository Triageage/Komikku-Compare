/**
 * Tab Title Cleaner for Manga / Manhwa / Manhua Websites
 * Strips scanlation SEO spam, chapter numbers, domain names, and delimiters
 * to isolate the authentic manga title.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TitleCleaner = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Common manga aggregator & scanlation site brand names / keywords
  const KNOWN_SCANLATION_SITES = [
    'mangakakalot',
    'manganato',
    'mangadex',
    'asura',
    'asurascans',
    'reaper',
    'reaperscans',
    'flame',
    'flamecomics',
    'bato',
    'batoto',
    'webtoon',
    'webtoons',
    'mangapark',
    'mangasee',
    'mangasee123',
    'mangalife',
    'tapas',
    'lezhin',
    'viz',
    'viz media',
    'shonen jump',
    'mangaplus',
    'manga reader',
    'mangareader',
    'readmanga',
    'readberserk',
    'readonepiece',
    'manhuaga',
    'manhwatop',
    'topmanhua',
    'comicextra',
    'zinmanga',
    '1stkissmanga',
    'mangaowl',
    'novelcool',
    'manhuaus',
    'earlymanga',
    'kunmanga',
    'manhuascan',
    'void scans',
    'luminous scans',
    'zero scans',
    'tcb scans'
  ];

  /**
   * Decodes basic HTML entities commonly found in page titles.
   * @param {string} str
   * @returns {string}
   */
  function decodeHtmlEntities(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#8211;/g, '-')
      .replace(/&#8212;/g, '-')
      .replace(/&#8217;/g, "'")
      .replace(/&#8216;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"');
  }

  /**
   * Tests if a title segment looks like pure chapter/volume/episode info.
   * Examples: "Chapter 1050", "Ch. 142", "Vol. 1", "Episode 55", "Ch. 75.5"
   * @param {string} segment
   * @returns {boolean}
   */
  function isChapterOrVolumeSegment(segment) {
    const s = segment.trim().toLowerCase();
    return /^(?:(?:vol(?:ume)?\.?\s*\d+|v\d+)[\s,]+)?(?:ch(?:ap(?:ter)?)?\.?\s*\d+(?:\.\d+)?|vol(?:ume)?\.?\s*\d+|ep(?:isode)?\.?\s*\d+|season\s*\d+|s\d+)(?:\s*\[.*\])?$/i.test(s);
  }

  /**
   * Tests if a title segment is likely a site name or branding.
   * @param {string} segment
   * @param {string} domainStem
   * @returns {boolean}
   */
  function isSiteBrandingSegment(segment, domainStem) {
    const s = segment.trim().toLowerCase();
    if (domainStem && (s === domainStem || s.includes(domainStem))) {
      return true;
    }
    return KNOWN_SCANLATION_SITES.some(site => s === site || s.includes(site));
  }

  /**
   * Tests if a title segment is pure SEO spam.
   * Examples: "Read Manga Online Free", "High Quality", "Free Online"
   * @param {string} segment
   * @returns {boolean}
   */
  function isSeoSpamSegment(segment) {
    const s = segment.trim().toLowerCase();
    return /^(?:read\s+)?(?:manga\s+)?(?:online\s+)?(?:free|in high quality|hq|hd|latest update|all chapters|raw|full)$/i.test(s);
  }

  /**
   * Cleans a raw tab title into a canonical manga title.
   * Example: "Read One Piece Chapter 1050 - Mangakakalot" -> "one piece"
   * Example: "Ch. 142 - Jujutsu Kaisen - MangaDex" -> "jujutsu kaisen"
   *
   * @param {string} rawTitle - Raw document.title from browser tab
   * @param {string} [tabUrl] - Optional URL to aid domain stripping
   * @returns {string} Lowercased, cleaned manga title
   */
  function cleanTabTitle(rawTitle, tabUrl = '', options = false) {
    if (!rawTitle || typeof rawTitle !== 'string') return '';

    const preserveCase = typeof options === 'boolean' ? options : !!(options && options.preserveCase);
    let title = decodeHtmlEntities(rawTitle).trim();

    // 1. Extract domain stem if URL is provided
    let domainStem = '';
    if (tabUrl) {
      try {
        const hostname = new URL(tabUrl).hostname.replace(/^www\./, '');
        domainStem = hostname.split('.')[0].toLowerCase();
      } catch (e) {
        // ignore invalid url
      }
    }

    // 2. Normalize unicode punctuation: en-dash, em-dash, quotes, bullets/middle dots
    title = title
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u00B7\u30FB\u2022\u25CF]/g, ' - ');

    // 3. Remove bracketed metadata: [RAW], [ENG], [Scan], (Official), (English), etc.
    title = title
      .replace(/\[\s*(?:raw|eng|scan|official|colored|color|webtoon|hq|hd|disc|discussion|ch|chapter|v\d+|vol\d+)[^\]]*\]/gi, ' ')
      .replace(/\(\s*(?:raw|eng|scan|official|colored|color|webtoon|hq|hd|disc|discussion|english|digital)[^)]*\)/gi, ' ');

    // 4. Split by standard separators: " - ", " | ", " – ", " — ", " ~ ", " » ", " • ", " // ", " : "
    const separatorPattern = /\s+(?:[-|–—~»•/:]|--)\s+/;
    const rawSegments = title.split(separatorPattern).map(s => s.trim()).filter(Boolean);

    let candidate = title;

    if (rawSegments.length > 1) {
      // Filter out segments that are chapter numbers, site branding, or SEO spam
      const validSegments = rawSegments.filter(seg => {
        if (isSiteBrandingSegment(seg, domainStem)) return false;
        if (isChapterOrVolumeSegment(seg)) return false;
        if (isSeoSpamSegment(seg)) return false;
        return true;
      });

      if (validSegments.length > 0) {
        // Typically the first valid segment is the title (e.g., "One Piece Chapter 1050" or "Jujutsu Kaisen")
        candidate = validSegments[0];
      } else {
        // Fallback: pick the longest segment
        candidate = rawSegments.reduce((a, b) => (a.length >= b.length ? a : b), rawSegments[0]);
      }
    } else {
      // Single segment, but may contain trailing " - SiteName" without spaces or after colon
      // Strip everything after " - " or " | " if present
      const firstDash = candidate.search(/\s+[-|–—]\s+/);
      if (firstDash !== -1) {
        candidate = candidate.slice(0, firstDash);
      }
    }

    // 5. Clean within the candidate segment:
    // Remove leading "Read " or "Reading "
    candidate = candidate.replace(/^(?:read|reading)\s+/i, '');

    // Remove chapter/volume/episode markers at the end of the title
    // e.g. "One Piece Chapter 1050", "Solo Leveling Ch. 179", "Tower of God Episode 550", "Title · Ch.39"
    candidate = candidate.replace(/\s*(?:[-|–—~»•/:]|--)?\s*(?:chapter|chap?\.?|vol(?:ume)?\.?|ep(?:isode)?\.?|season)\s*\d+(?:\.\d+)?.*$/i, '');
    
    // Remove standalone hash numbers like "One Piece #1050"
    candidate = candidate.replace(/\s+#\d+(?:\.\d+)?.*$/i, '');

    // Remove SEO trailing phrases like "Manga Online", "Read Online Free", "Online Free"
    candidate = candidate.replace(/\s+(?:manga\s+)?online(?:\s+(?:for\s+)?free)?.*$/i, '');
    candidate = candidate.replace(/\s+in\s+high\s+quality.*$/i, '');
    candidate = candidate.replace(/\s+(?:all\s+)?chapters?.*$/i, '');
    candidate = candidate.replace(/\s+latest\s+update.*$/i, '');
    candidate = candidate.replace(/\s+for\s+free.*$/i, '');

    // Remove trailing "Manga" if preceded by title, e.g. "Dandadan Manga" -> "Dandadan"
    // (Only if string has more than 1 word, so manga titled just "Manga" isn't erased)
    if (/\s+manga$/i.test(candidate)) {
      candidate = candidate.replace(/\s+manga$/i, '');
    }

    // Remove leading/trailing punctuation and symbols
    candidate = candidate.replace(/^[\s\-_,:|~.•·・●]+/, '').replace(/[\s\-_,:|~.•·・●]+$/, '');

    // Collapse multiple whitespace to single space
    candidate = candidate.replace(/\s+/g, ' ').trim();

    return preserveCase ? candidate : candidate.toLowerCase();
  }

  /**
   * Extracts clean domain name from URL, removing 'www.'
   * @param {string} url
   * @returns {string}
   */
  function extractDomain(url) {
    if (!url) return 'Unknown';
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) {
      return 'Unknown';
    }
  }

  return {
    cleanTabTitle,
    extractDomain,
    decodeHtmlEntities,
    KNOWN_SCANLATION_SITES
  };
});
