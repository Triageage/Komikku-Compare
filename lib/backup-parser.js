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
   * Main entry point to parse a Komikku (.tachibk / .proto.gz) file or ArrayBuffer.
   * @param {File|Blob|ArrayBuffer} fileOrBuffer
   * @param {{ libraryOnly?: boolean }} [options]
   * @returns {Promise<{ titles: Set<string>, titlesList: string[], count: number }>}
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

    // 5. Store lowercased Set for case-insensitive matching
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
      count: titlesSet.size
    };
  }

  return {
    decompressGzip,
    readVarint,
    parseStructuredProtobuf,
    scanProtobufFallback,
    parseJsonBackup,
    parseKomikkuBackup
  };
});
