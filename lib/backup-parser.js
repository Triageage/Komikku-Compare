/**
 * Komikku / Tachiyomi Backup Parser (.tachibk / .proto.gz)
 * Supports GZIP decompression (via native DecompressionStream or bundled Pako)
 * and lightweight Protobuf binary extraction for manga titles.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof pako !== 'undefined' ? pako : null);
  } else {
    root.BackupParser = factory(root.pako);
  }
})(typeof self !== 'undefined' ? self : this, function (pakoLib) {
  'use strict';

  /**
   * Reads a protobuf varint from Uint8Array at offset.
   * @param {Uint8Array} bytes
   * @param {number} offset
   * @returns {[number, number]} [value, nextOffset]
   */
  function readVarint(bytes, offset) {
    let value = 0n;
    let shift = 0n;
    const len = bytes.length;
    while (offset < len) {
      const b = BigInt(bytes[offset++]);
      value |= (b & 0x7fn) << shift;
      shift += 7n;
      if ((b & 0x80n) === 0n) break;
      if (shift > 64n) break; // safety guard
    }
    return [Number(value), offset];
  }

  /**
   * Reads a 64-bit protobuf varint without precision loss, returning [BigInt, nextOffset].
   * Crucial for 64-bit Tachiyomi/Komikku source IDs (> 2^53) which lose precision in standard JS Number.
   * @param {Uint8Array} bytes
   * @param {number} offset
   * @returns {[bigint, number]} [value, nextOffset]
   */
  function readVarintBigInt(bytes, offset) {
    let value = 0n;
    let shift = 0n;
    const len = bytes.length;
    while (offset < len) {
      const b = BigInt(bytes[offset++]);
      value |= (b & 0x7fn) << shift;
      shift += 7n;
      if ((b & 0x80n) === 0n) break;
      if (shift > 64n) break; // safety guard
    }
    return [value, offset];
  }

  /**
   * Decompresses a GZIP ArrayBuffer using native DecompressionStream or Pako fallback.
   * @param {ArrayBuffer|Uint8Array} input
   * @returns {Promise<Uint8Array>}
   */
  async function decompressGzip(input) {
    const uint8Input = input instanceof Uint8Array ? input : new Uint8Array(input);

    // 1. Check if the file is actually GZIP-compressed (magic bytes 0x1F, 0x8B)
    const isGzip = uint8Input.length >= 2 && uint8Input[0] === 0x1f && uint8Input[1] === 0x8b;

    if (!isGzip) {
      // It might already be uncompressed protobuf or JSON
      return uint8Input;
    }

    // 2. Try native DecompressionStream (supported in Firefox 113+ / Zen Browser)
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const stream = new Response(uint8Input).body.pipeThrough(new DecompressionStream('gzip'));
        const decompressedBuffer = await new Response(stream).arrayBuffer();
        return new Uint8Array(decompressedBuffer);
      } catch (err) {
        console.warn('Native DecompressionStream error, attempting Pako fallback:', err);
      }
    }

    // 3. Fallback to bundled pako
    const pako = pakoLib || (typeof window !== 'undefined' ? window.pako : null);
    if (pako && typeof pako.inflate === 'function') {
      try {
        return pako.inflate(uint8Input);
      } catch (err) {
        throw new Error('Pako decompression failed: ' + err.message);
      }
    }

    throw new Error('No compatible GZIP decompressor found (neither DecompressionStream nor Pako available).');
  }

  /**
   * Strictly parses Protobuf wire format for Tachiyomi/Komikku Backup.
   * Outer Message: Backup
   *  - Field 1 (wire 2): repeated BackupManga
   * Inside BackupManga:
   *  - Field 2 (wire 2): string url
   *  - Field 3 (wire 2): string title
   * @param {Uint8Array} bytes
   * @returns {string[]} List of manga titles
   */
  /**
   * Strictly parses Protobuf wire format for Tachiyomi/Komikku Backup.
   * Outer Message: Backup
   *  - Field 1 (wire 2): repeated BackupManga
   * Inside BackupManga:
   *  - Field 2 (wire 2): string url
   *  - Field 3 (wire 2): string title
   *  - Field 100 (wire 0): bool favorite (Komikku / Mihon / SY)
   *  - Field 16 (wire 0): bool favorite (Tachiyomi 1.x)
   * @param {Uint8Array} bytes
   * @param {{ libraryOnly?: boolean }} [options]
   * @returns {string[]} List of manga titles
   */
  function parseStructuredProtobuf(bytes, options = { libraryOnly: true }) {
    const titles = [];
    const textDecoder = new TextDecoder('utf-8');
    const totalBytes = bytes.length;
    let offset = 0;
    const libraryOnly = options && options.libraryOnly !== false;

    while (offset < totalBytes) {
      let tag, nextOffset;
      try {
        [tag, nextOffset] = readVarint(bytes, offset);
      } catch (e) {
        break;
      }
      offset = nextOffset;
      const fieldNumber = tag >>> 3;
      const wireType = tag & 0x07;

      if (wireType === 2) {
        const [len, dataOffset] = readVarint(bytes, offset);
        const fieldEnd = dataOffset + len;
        if (fieldEnd > totalBytes || len < 0) break;

        // Field 1: BackupManga
        if (fieldNumber === 1) {
          let mangaOffset = dataOffset;
          let mangaTitle = null;
          let isFavorite = true; // In Komikku/Tachiyomi, default is true unless explicitly set to false (0)

          while (mangaOffset < fieldEnd) {
            const [mangaTag, nextMangaOffset] = readVarint(bytes, mangaOffset);
            mangaOffset = nextMangaOffset;
            const mangaField = mangaTag >>> 3;
            const mangaWire = mangaTag & 0x07;

            if (mangaWire === 2) {
              const [fieldLen, contentOffset] = readVarint(bytes, mangaOffset);
              const contentEnd = contentOffset + fieldLen;
              if (contentEnd > fieldEnd) break;

              // Field 3 in BackupManga is title
              if (mangaField === 3 && fieldLen > 0) {
                try {
                  const titleBytes = bytes.subarray(contentOffset, contentEnd);
                  mangaTitle = textDecoder.decode(titleBytes).trim();
                } catch (e) {
                  // Ignore UTF-8 decode error
                }
              }
              mangaOffset = contentEnd;
            } else if (mangaWire === 0) {
              const [val, o] = readVarint(bytes, mangaOffset);
              mangaOffset = o;

              // Field 100 in Komikku/Mihon is favorite (0 = not in library, 1 = in library)
              // Field 16 in older Tachiyomi schemas is favorite
              if (mangaField === 100 || (mangaField === 16 && mangaWire === 0)) {
                isFavorite = (val !== 0);
              }
            } else if (mangaWire === 1) {
              mangaOffset += 8;
            } else if (mangaWire === 5) {
              mangaOffset += 4;
            } else {
              // Unknown wire type inside BackupManga, skip to end of this manga object
              break;
            }
          }

          // Only include if marked as favorite (in Library), or if libraryOnly filtering is off
          if (mangaTitle && (!libraryOnly || isFavorite)) {
            titles.push(mangaTitle);
          }
        }
        offset = fieldEnd;
      } else if (wireType === 0) {
        const [, o] = readVarint(bytes, offset);
        offset = o;
      } else if (wireType === 1) {
        offset += 8;
      } else if (wireType === 5) {
        offset += 4;
      } else {
        // Unknown wire type, break out of structured parse
        break;
      }
    }

    return titles;
  }

  /**
   * Fallback scanner that searches for Field 3 wire 2 (0x1A) strings in decompressed buffer.
   * Useful if backup schema has variations or outer wrapper was modified.
   * @param {Uint8Array} bytes
   * @returns {string[]} List of manga titles
   */
  function scanProtobufFallback(bytes) {
    const titles = new Set();
    const textDecoder = new TextDecoder('utf-8');
    const len = bytes.length;
    let i = 0;

    while (i < len - 3) {
      // 0x1A is tag for (Field 3, Wire Type 2)
      if (bytes[i] === 0x1a) {
        try {
          const [strLen, strOffset] = readVarint(bytes, i + 1);
          // Plausible manga title length: 1 to 256 characters
          if (strLen > 0 && strLen <= 256 && strOffset + strLen <= len) {
            const slice = bytes.subarray(strOffset, strOffset + strLen);
            // Verify all characters are plausible printable UTF-8 (no control characters except spaces)
            const titleStr = textDecoder.decode(slice).trim();
            if (
              titleStr.length > 0 &&
              !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(titleStr) &&
              !titleStr.startsWith('http://') &&
              !titleStr.startsWith('https://') &&
              !titleStr.includes('.jpg') &&
              !titleStr.includes('.png')
            ) {
              titles.add(titleStr);
              i = strOffset + strLen;
              continue;
            }
          }
        } catch (e) {
          // ignore scan error
        }
      }
      i++;
    }

    return Array.from(titles);
  }

  /**
   * Fallback JSON parser in case user uploads an uncompressed or JSON-formatted backup.
   * @param {Uint8Array} bytes
   * @returns {string[]} List of manga titles
   */
  function parseJsonBackup(bytes, options = { libraryOnly: true }) {
    try {
      const text = new TextDecoder('utf-8').decode(bytes);
      const firstChar = text.trim().charAt(0);
      if (firstChar !== '{' && firstChar !== '[') return [];

      const data = JSON.parse(text);
      const titles = new Set();
      const libraryOnly = options && options.libraryOnly !== false;

      function extractFromList(list) {
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (item && typeof item.title === 'string' && item.title.trim()) {
            if (libraryOnly && item.favorite === false) {
              continue; // Exclude non-library items
            }
            titles.add(item.title.trim());
          }
        }
      }

      if (Array.isArray(data)) {
        extractFromList(data);
      } else if (data && typeof data === 'object') {
        extractFromList(data.backupManga);
        extractFromList(data.manga);
        extractFromList(data.mangas);
      }

      return Array.from(titles);
    } catch (e) {
      return [];
    }
  }

  /**
   * Encodes a number or BigInt into a protobuf varint byte array.
   * @param {number|BigInt|string} value
   * @returns {number[]}
   */
  function writeVarint(value) {
    let big = BigInt(value);
    if (big < 0n) {
      big = 0x10000000000000000n + big;
    }
    const bytes = [];
    while (big >= 0x80n) {
      bytes.push(Number((big & 0x7Fn) | 0x80n));
      big >>= 7n;
    }
    bytes.push(Number(big & 0x7Fn));
    return bytes;
  }

  function encodeVarintField(fieldNumber, value) {
    const tag = (fieldNumber << 3) | 0;
    return [...writeVarint(tag), ...writeVarint(value)];
  }

  function encodeStringField(fieldNumber, str) {
    const tag = (fieldNumber << 3) | 2;
    const strBytes = new TextEncoder().encode(str || '');
    return [...writeVarint(tag), ...writeVarint(strBytes.length), ...strBytes];
  }

  function encodeMessageField(fieldNumber, messageBytes) {
    const tag = (fieldNumber << 3) | 2;
    return [...writeVarint(tag), ...writeVarint(messageBytes.length), ...messageBytes];
  }

  /**
   * Compresses a Uint8Array using native CompressionStream or bundled Pako.
   * @param {Uint8Array} uint8Array
   * @returns {Promise<Uint8Array>}
   */
  async function compressGzip(uint8Array) {
    const input = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);

    if (typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Response(input).body.pipeThrough(new CompressionStream('gzip'));
        const compressedBuffer = await new Response(stream).arrayBuffer();
        return new Uint8Array(compressedBuffer);
      } catch (err) {
        console.warn('Native CompressionStream failed, attempting Pako fallback:', err);
      }
    }

    const pako = pakoLib || (typeof window !== 'undefined' ? window.pako : null);
    if (pako && typeof pako.gzip === 'function') {
      try {
        return pako.gzip(input);
      } catch (err) {
        throw new Error('Pako GZIP compression failed: ' + err.message);
      }
    }

    throw new Error('No compatible GZIP compressor found (neither CompressionStream nor Pako available).');
  }

  /**
   * Scans outer Backup message for Field 101 (repeated BackupSource).
   * @param {Uint8Array} bytes
   * @returns {{ byId: Map<string, string>, byName: Map<string, string> }}
   */
  function parseBackupSources(bytes) {
    const byId = new Map();
    const byName = new Map();
    const textDecoder = new TextDecoder('utf-8');
    const totalBytes = bytes.length;
    let offset = 0;

    while (offset < totalBytes) {
      let tag, nextOffset;
      try {
        [tag, nextOffset] = readVarint(bytes, offset);
      } catch (e) {
        break;
      }
      offset = nextOffset;
      const fieldNumber = tag >>> 3;
      const wireType = tag & 0x07;

      if (wireType === 2) {
        const [len, dataOffset] = readVarint(bytes, offset);
        const fieldEnd = dataOffset + len;
        if (fieldEnd > totalBytes || len < 0) break;

        // Field 101: BackupSource
        if (fieldNumber === 101) {
          let sOffset = dataOffset;
          let sourceName = '';
          let sourceId = null;

          while (sOffset < fieldEnd) {
            const [sTag, nextSOffset] = readVarint(bytes, sOffset);
            sOffset = nextSOffset;
            const sField = sTag >>> 3;
            const sWire = sTag & 0x07;

            if (sWire === 2) {
              const [sLen, sDataOffset] = readVarint(bytes, sOffset);
              const sEnd = sDataOffset + sLen;
              if (sEnd > fieldEnd) break;
              if (sField === 1 && sLen > 0) {
                try {
                  sourceName = textDecoder.decode(bytes.subarray(sDataOffset, sEnd)).trim();
                } catch (e) {}
              }
              sOffset = sEnd;
            } else if (sWire === 0) {
              const [val, o] = readVarintBigInt(bytes, sOffset);
              sOffset = o;
              if (sField === 2) {
                sourceId = val.toString();
              }
            } else if (sWire === 1) {
              sOffset += 8;
            } else if (sWire === 5) {
              sOffset += 4;
            } else {
              break;
            }
          }

          if (sourceId) {
            byId.set(sourceId, sourceName);
            if (sourceName) {
              byName.set(sourceName.toLowerCase(), sourceId);
            }
          }
        }
        offset = fieldEnd;
      } else if (wireType === 0) {
        const [, o] = readVarint(bytes, offset);
        offset = o;
      } else if (wireType === 1) {
        offset += 8;
      } else if (wireType === 5) {
        offset += 4;
      } else {
        break;
      }
    }

    return { byId, byName };
  }

  const KNOWN_DOMAIN_SOURCES = [
    { regex: /weebcentral\.com/i, name: 'Weeb Central', id: '2131019126180322627' },
    { regex: /comix\.(to|net|org)/i, name: 'Comix', id: '7537715367149829912' },
    { regex: /mangafire\.to/i, name: 'MangaFire', id: '6084907896154116083' },
    { regex: /mangadex\.org/i, name: 'MangaDex', id: '2499283573021220255' },
    { regex: /(mangakakalot|manganato|chapmanganato|natomanga)\.com/i, name: 'Mangakakalot', id: '2528986671771677900' },
    { regex: /mangago\.me/i, name: 'Mangago', id: '2470059397662084186' },
    { regex: /comick\.(io|app|live|cc)/i, name: 'Comick (Unoriginal)', id: '4972933717624256217' },
    { regex: /webtoons\.com/i, name: 'Webtoons.com', id: '2522335540328470744' },
    { regex: /manhwa18\.cc/i, name: 'Manhwa18.cc', id: '4841602236575491202' },
    { regex: /nhentai\.net/i, name: 'NHentai', id: '7309872737163460316' },
    { regex: /toonily\.(me|com)/i, name: 'Toonily.me', id: '1581110056159285576' },
    { regex: /e-hentai\.org/i, name: 'E-Hentai', id: '57122881048805941' },
    { regex: /imhentai\.xxx/i, name: 'IMHentai', id: '1797754663718263026' },
    { regex: /manhwax\.(top|com)/i, name: 'Manhwax', id: '7310092753988370613' },
    { regex: /weebdex\.org/i, name: 'WeebDex', id: '371958378926280825' },
    { regex: /kagane\.org/i, name: 'Kagane', id: '4024736764982024684' },
    { regex: /asura(scans|comic|\.gg|\.com)/i, name: 'Asura Scans', id: '8522335540328470123' },
    { regex: /flame(comics|scans)/i, name: 'Flame Comics', id: '7522335540328470124' },
    { regex: /reaper(scans|\.com)/i, name: 'Reaper Scans', id: '6522335540328470125' },
    { regex: /bato\.to/i, name: 'Bato.to', id: '2971557565147974499' }
  ];

  function hashDomainToSourceId(domain) {
    let h = 0x811c9dc5n;
    const s = (domain || 'unknown').toLowerCase();
    for (let i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i));
      h = (h * 0x01000193n) & 0x7FFFFFFFFFFFFFFFn;
    }
    return (h || 123456789n).toString();
  }

  function resolveSourceForDomain(domain, knownSources) {
    const cleanDomain = (domain || '').toLowerCase().trim();

    // 1. Check known source rules
    for (const item of KNOWN_DOMAIN_SOURCES) {
      if (item.regex.test(cleanDomain)) {
        return { name: item.name, id: item.id, isNew: false };
      }
    }

    // 2. Check if existing backup sources match
    if (knownSources && knownSources.byName) {
      for (const [name, id] of knownSources.byName.entries()) {
        const coreName = name.replace(/[^a-z0-9]/g, '');
        const coreDomain = cleanDomain.replace(/[^a-z0-9]/g, '');
        if (coreName.length >= 4 && (coreDomain.includes(coreName) || coreName.includes(coreDomain))) {
          return { name, id, isNew: false };
        }
      }
    }

    // 3. Fallback: generate source name from domain and stable positive 64-bit ID
    const parts = cleanDomain.split('.').filter(p => !['www', 'com', 'org', 'net', 'to', 'io', 'me', 'top', 'tv'].includes(p));
    const rawName = parts.length > 0 ? parts[0] : cleanDomain;
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const newId = hashDomainToSourceId(cleanDomain);

    return { name: formattedName, id: newId, isNew: true };
  }

  function extractMangaUrl(tabUrl, domain) {
    if (!tabUrl) return '/';
    try {
      const u = new URL(tabUrl);
      const cleanDomain = (domain || u.hostname || '').toLowerCase();
      let rel = u.pathname;
      if (!rel || rel === '/') return tabUrl;

      // Clean trailing slash
      rel = rel.replace(/\/+$/, '');

      // 1. Comix specific handling:
      // Comix URLs are:
      //   Series page:  /title/<comic-slug-or-id>
      //   Chapter page: /title/<comic-slug-or-id>/<chapter-id>-chapter-<num>
      // Extension baseUrl is "https://comix.to/title", so manga.url must be "/<comic-slug-or-id>".
      if (cleanDomain.includes('comix.')) {
        const withoutTitle = rel.replace(/^\/title\//i, '/');
        const segs = withoutTitle.split('/').filter(Boolean);
        if (segs.length >= 1) {
          // The first segment after /title is ALWAYS the canonical comic slug/id
          return '/' + segs[0];
        }
        return withoutTitle;
      }

      // 2. General chapter/reader segment stripping across all manga sites:
      // Handles:
      //   - /comic/title/chapter-1
      //   - /comic/title/ch-1
      //   - /comic/title/11452354-chapter-1
      //   - /comic/title/c1
      //   - /comic/title/episode-5
      //   - /comic/title/read/1
      const cleanedRel = rel.replace(/\/(?:(?:\d+[-_])?(?:chapter|ch|episode|ep|c|read|viewer)[\/_-]?\d+(?:\.\d+)?.*|\d+[-_]chapter.*)$/i, '');
      if (cleanedRel && cleanedRel !== rel && cleanedRel.length > 1) {
        rel = cleanedRel;
      }

      // 3. Handle trailing pure numeric chapter IDs: e.g. /comic/title/123
      const numericCleaned = rel.replace(/\/\d+(?:\.\d+)?$/, '');
      if (numericCleaned && numericCleaned !== rel && numericCleaned.length > 1) {
        const segs = numericCleaned.split('/').filter(Boolean);
        if (segs.length >= 1) {
          rel = numericCleaned;
        }
      }

      return rel;
    } catch (e) {
      return tabUrl;
    }
  }

  function createBackupMangaPayload(manga) {
    const body = [];
    const nowMs = manga.dateAdded || Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    // Field 1: source (int64)
    body.push(...encodeVarintField(1, manga.sourceId));

    // Field 2: url (string)
    body.push(...encodeStringField(2, manga.url || '/'));

    // Field 3: title (string)
    body.push(...encodeStringField(3, manga.title || 'Untitled'));

    // Field 8: status (0 = UNKNOWN)
    body.push(...encodeVarintField(8, 0));

    // Field 13: dateAdded (int64)
    body.push(...encodeVarintField(13, nowMs));

    // Field 100: favorite (bool) -> 1
    body.push(...encodeVarintField(100, 1));

    // Field 106: lastModifiedAt (int64 seconds)
    body.push(...encodeVarintField(106, nowSec));

    // Field 107: dateFetched (int64 seconds)
    body.push(...encodeVarintField(107, nowSec));

    // Field 109: chapterFlags (0)
    body.push(...encodeVarintField(109, 0));

    // Field 111: updateStrategy (0 = ALWAYS_UPDATE)
    body.push(...encodeVarintField(111, 0));

    // Wrap in Field 1 (BackupManga in Backup)
    return encodeMessageField(1, body);
  }

  function createBackupSourcePayload(sourceName, sourceId) {
    const body = [];
    // Field 1: name (string)
    body.push(...encodeStringField(1, sourceName || ''));
    // Field 2: sourceId (int64)
    body.push(...encodeVarintField(2, sourceId));

    // Wrap in Field 101 (BackupSource in Backup)
    return encodeMessageField(101, body);
  }

  /**
   * Main entry point to parse a Komikku (.tachibk / .proto.gz) file or ArrayBuffer.
   * @param {File|Blob|ArrayBuffer} fileOrBuffer
   * @param {{ libraryOnly?: boolean }} [options]
   * @returns {Promise<{ titles: Set<string>, titlesList: string[], count: number, sources: { byId: Map<string, string>, byName: Map<string, string> } }>}
   */
  async function parseKomikkuBackup(fileOrBuffer, options = { libraryOnly: true }) {
    let arrayBuffer;
    if (fileOrBuffer instanceof ArrayBuffer) {
      arrayBuffer = fileOrBuffer;
    } else if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === 'function') {
      arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
      throw new Error('Invalid input: expected File, Blob, or ArrayBuffer.');
    }

    // 1. Decompress GZIP payload
    const decompressedBytes = await decompressGzip(arrayBuffer);

    // 2. Structured Protobuf decode (Field 1 -> Field 3, filtered by favorite/library status)
    let titles = parseStructuredProtobuf(decompressedBytes, options);

    // If libraryOnly was requested but 0 titles found (e.g. backup with no favorite fields), retry without filter
    if ((!titles || titles.length === 0) && options && options.libraryOnly) {
      titles = parseStructuredProtobuf(decompressedBytes, { libraryOnly: false });
    }

    // 3. If structured decode still returned empty, try fallback scanner
    if (!titles || titles.length === 0) {
      titles = scanProtobufFallback(decompressedBytes);
    }

    // 4. If still empty, check if it's a JSON export
    if (!titles || titles.length === 0) {
      titles = parseJsonBackup(decompressedBytes, options);
    }

    // 5. Scan sources
    const sources = parseBackupSources(decompressedBytes);

    // 6. Store lowercased Set for case-insensitive matching
    const titlesSet = new Set();
    const uniqueTitlesList = [];

    for (const title of titles) {
      const clean = title.trim();
      if (clean) {
        titlesSet.add(clean.toLowerCase());
        uniqueTitlesList.push(clean);
      }
    }

    return {
      titles: titlesSet,
      titlesList: uniqueTitlesList,
      count: titlesSet.size,
      sources: sources
    };
  }

  /**
   * Takes an existing backup (ArrayBuffer/Uint8Array/File) and a list of missing manga,
   * injects them into the Protobuf byte stream as library favorites, and re-compresses with GZIP.
   *
   * @param {File|Blob|ArrayBuffer|Uint8Array} fileOrBuffer
   * @param {Array<{ cleanedTitle?: string, title?: string, url?: string, domain?: string }>} missingMangaList
   * @returns {Promise<{
   *   compressedBytes: Uint8Array,
   *   addedCount: number,
   *   addedTitles: string[],
   *   blob: Blob
   * }>}
   */
  async function exportUpdatedBackup(fileOrBuffer, missingMangaList) {
    let arrayBuffer;
    if (fileOrBuffer instanceof ArrayBuffer) {
      arrayBuffer = fileOrBuffer;
    } else if (fileOrBuffer instanceof Uint8Array) {
      arrayBuffer = fileOrBuffer.buffer.slice(
        fileOrBuffer.byteOffset,
        fileOrBuffer.byteOffset + fileOrBuffer.byteLength
      );
    } else if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === 'function') {
      arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
      throw new Error('Invalid input: expected File, Blob, ArrayBuffer, or Uint8Array.');
    }

    if (!Array.isArray(missingMangaList) || missingMangaList.length === 0) {
      throw new Error('No missing manga provided to add to backup.');
    }

    // 1. Decompress existing backup
    const decompressed = await decompressGzip(arrayBuffer);

    // 2. Scan existing backup sources
    const knownSources = parseBackupSources(decompressed);

    // 3. Deduplicate missing manga
    const seenTitles = new Set();
    const cleanList = [];

    for (const item of missingMangaList) {
      const title = (item.backupTitle || item.cleanedTitle || item.title || '').trim();
      if (!title) continue;
      const lower = title.toLowerCase();
      if (seenTitles.has(lower)) continue;
      seenTitles.add(lower);
      cleanList.push({
        title: title,
        url: item.url || '',
        domain: item.domain || (item.url ? new URL(item.url).hostname : '')
      });
    }

    if (cleanList.length === 0) {
      throw new Error('No valid manga titles found in the missing list.');
    }

    // 4. Construct Protobuf payloads
    const bytesToPrepend = [];
    const addedTitles = [];
    const addedSourcesSet = new Set(knownSources.byId.keys());

    for (const manga of cleanList) {
      const source = resolveSourceForDomain(manga.domain, knownSources);
      const relativeUrl = extractMangaUrl(manga.url, manga.domain);

      // Always ensure the source is registered in BackupSource (Field 101)
      if (!addedSourcesSet.has(source.id)) {
        addedSourcesSet.add(source.id);
        const sourcePayload = createBackupSourcePayload(source.name, source.id);
        bytesToPrepend.push(...sourcePayload);
      }

      // Create BackupManga (Field 1) entry
      const mangaPayload = createBackupMangaPayload({
        title: manga.title,
        url: relativeUrl,
        sourceId: source.id,
        dateAdded: Date.now()
      });
      bytesToPrepend.push(...mangaPayload);
      addedTitles.push(manga.title);
    }

    // 5. Prepend new records to the decompressed byte buffer
    const prependArray = new Uint8Array(bytesToPrepend);
    const updatedDecompressed = new Uint8Array(prependArray.length + decompressed.length);
    updatedDecompressed.set(prependArray, 0);
    updatedDecompressed.set(decompressed, prependArray.length);

    // 6. Recompress with GZIP
    const compressedBytes = await compressGzip(updatedDecompressed);
    const blob = new Blob([compressedBytes], { type: 'application/gzip' });

    return {
      compressedBytes,
      addedCount: addedTitles.length,
      addedTitles,
      blob
    };
  }

  return {
    decompressGzip,
    compressGzip,
    readVarint,
    readVarintBigInt,
    writeVarint,
    encodeVarintField,
    encodeStringField,
    encodeMessageField,
    parseStructuredProtobuf,
    scanProtobufFallback,
    parseJsonBackup,
    parseBackupSources,
    resolveSourceForDomain,
    extractMangaUrl,
    createBackupMangaPayload,
    createBackupSourcePayload,
    parseKomikkuBackup,
    exportUpdatedBackup
  };
});

