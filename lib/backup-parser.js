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
    const entries = [];
    const categories = [];
    const textDecoder = new TextDecoder('utf-8');
    const totalBytes = bytes.length;
    let offset = 0;
    const libraryOnly = options && options.libraryOnly !== false;

    while (offset < totalBytes) {
      const tagOffset = offset;
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
          let mangaUrl = '';
          let mangaSourceId = null;
          let mangaArtist = '';
          let mangaAuthor = '';
          let mangaDateAdded = 0;
          let mangaCategories = [];
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

              // Field 2 in BackupManga is url
              if (mangaField === 2 && fieldLen > 0) {
                try {
                  const urlBytes = bytes.subarray(contentOffset, contentEnd);
                  mangaUrl = textDecoder.decode(urlBytes).trim();
                } catch (e) {}
              }
              // Field 3 in BackupManga is title
              else if (mangaField === 3 && fieldLen > 0) {
                try {
                  const titleBytes = bytes.subarray(contentOffset, contentEnd);
                  mangaTitle = textDecoder.decode(titleBytes).trim();
                } catch (e) {
                  // Ignore UTF-8 decode error
                }
              }
              // Field 4 in BackupManga is artist
              else if (mangaField === 4 && fieldLen > 0) {
                try {
                  const artistBytes = bytes.subarray(contentOffset, contentEnd);
                  mangaArtist = textDecoder.decode(artistBytes).trim();
                } catch (e) {}
              }
              // Field 5 in BackupManga is author
              else if (mangaField === 5 && fieldLen > 0) {
                try {
                  const authorBytes = bytes.subarray(contentOffset, contentEnd);
                  mangaAuthor = textDecoder.decode(authorBytes).trim();
                } catch (e) {}
              }
              // Field 17 in BackupManga is repeated int64 categories (packed varints)
              else if (mangaField === 17 && fieldLen > 0) {
                let pOffset = contentOffset;
                while (pOffset < contentEnd) {
                  const [cVal, nextPOffset] = readVarint(bytes, pOffset);
                  mangaCategories.push(cVal);
                  pOffset = nextPOffset;
                }
              }
              mangaOffset = contentEnd;
            } else if (mangaWire === 0) {
              if (mangaField === 1) {
                // Field 1 is source ID (int64)
                const [val, o] = readVarintBigInt(bytes, mangaOffset);
                mangaOffset = o;
                mangaSourceId = val.toString();
              } else if (mangaField === 13) {
                // Field 13 is dateAdded (int64 milliseconds or seconds)
                const [val, o] = readVarintBigInt(bytes, mangaOffset);
                mangaOffset = o;
                let dVal = Number(val);
                if (dVal > 0 && dVal < 10000000000) {
                  dVal *= 1000;
                }
                mangaDateAdded = dVal;
              } else if (mangaField === 17) {
                // Field 17 is repeated int64 categories (individual varint)
                const [val, o] = readVarint(bytes, mangaOffset);
                mangaOffset = o;
                mangaCategories.push(val);
              } else {
                const [val, o] = readVarint(bytes, mangaOffset);
                mangaOffset = o;

                // Field 100 in Komikku/Mihon is favorite (0 = not in library, 1 = in library)
                // Field 16 in older Tachiyomi schemas is favorite
                if (mangaField === 100 || (mangaField === 16 && mangaWire === 0)) {
                  isFavorite = (val !== 0);
                }
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
            entries.push({
              title: mangaTitle,
              url: mangaUrl,
              sourceId: mangaSourceId || '',
              artist: mangaArtist,
              author: mangaAuthor,
              dateAdded: mangaDateAdded || 0,
              categories: mangaCategories,
              isFavorite: isFavorite,
              byteStart: tagOffset,
              byteEnd: fieldEnd
            });
          }
        }
        // Field 2: BackupCategory
        else if (fieldNumber === 2) {
          let catOffset = dataOffset;
          let catName = '';
          let catOrder = 0;
          let catFlags = 0;

          while (catOffset < fieldEnd) {
            const [cTag, nextCOffset] = readVarint(bytes, catOffset);
            catOffset = nextCOffset;
            const cField = cTag >>> 3;
            const cWire = cTag & 0x07;

            if (cWire === 2) {
              const [cLen, cDataOffset] = readVarint(bytes, catOffset);
              const cEnd = cDataOffset + cLen;
              if (cEnd > fieldEnd) break;
              if (cField === 1 && cLen > 0) {
                try {
                  catName = textDecoder.decode(bytes.subarray(cDataOffset, cEnd)).trim();
                } catch (e) {}
              }
              catOffset = cEnd;
            } else if (cWire === 0) {
              const [cVal, nextCValOffset] = readVarint(bytes, catOffset);
              catOffset = nextCValOffset;
              if (cField === 2) {
                catOrder = cVal;
              } else if (cField === 100) {
                catFlags = cVal;
              }
            } else if (cWire === 1) {
              catOffset += 8;
            } else if (cWire === 5) {
              catOffset += 4;
            } else {
              break;
            }
          }

          if (catName) {
            categories.push({
              name: catName,
              order: catOrder,
              flags: catFlags
            });
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

    categories.sort((a, b) => (a.order || 0) - (b.order || 0));
    titles.entries = entries;
    titles.categories = categories;
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
      const entries = [];
      const categories = [];
      const libraryOnly = options && options.libraryOnly !== false;

      // Extract categories if object
      if (data && typeof data === 'object') {
        const rawCats = data.categories || data.backupCategories || [];
        if (Array.isArray(rawCats)) {
          for (let i = 0; i < rawCats.length; i++) {
            const c = rawCats[i];
            if (typeof c === 'string' && c.trim()) {
              categories.push({ name: c.trim(), order: i, flags: 0 });
            } else if (c && typeof c.name === 'string' && c.name.trim()) {
              categories.push({
                name: c.name.trim(),
                order: typeof c.order === 'number' ? c.order : i,
                flags: c.flags || 0
              });
            }
          }
        }
      }
      categories.sort((a, b) => (a.order || 0) - (b.order || 0));

      function extractFromList(list) {
        if (!Array.isArray(list)) return;
        for (let idx = 0; idx < list.length; idx++) {
          const item = list[idx];
          if (item && typeof item.title === 'string' && item.title.trim()) {
            const isFav = item.favorite !== false;
            if (libraryOnly && !isFav) {
              continue; // Exclude non-library items
            }
            let dAdded = Number(item.dateAdded || item.date_added || 0);
            if (dAdded > 0 && dAdded < 10000000000) dAdded *= 1000;
            const cleanTitle = item.title.trim();
            titles.add(cleanTitle);

            let itemCats = [];
            let itemCatNames = [];
            if (Array.isArray(item.categories)) {
              for (const c of item.categories) {
                if (typeof c === 'number') {
                  itemCats.push(c);
                } else if (typeof c === 'string') {
                  itemCatNames.push(c.trim());
                }
              }
            }

            entries.push({
              title: cleanTitle,
              url: item.url || '',
              sourceId: (item.source || item.sourceId || '').toString(),
              artist: item.artist || '',
              author: item.author || '',
              dateAdded: dAdded || 0,
              categories: itemCats,
              categoryNames: itemCatNames,
              isFavorite: isFav,
              jsonIndex: idx
            });
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

      const res = Array.from(titles);
      res.entries = entries;
      res.categories = categories;
      return res;
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

  /**
   * Scans outer Backup message for Field 2 (repeated BackupCategory).
   * @param {Uint8Array} bytes
   * @returns {Array<{ name: string, order: number, flags: number }>}
   */
  function parseBackupCategories(bytes) {
    const categories = [];
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

        // Field 2: BackupCategory
        if (fieldNumber === 2) {
          let catOffset = dataOffset;
          let catName = '';
          let catOrder = 0;
          let catFlags = 0;

          while (catOffset < fieldEnd) {
            const [cTag, nextCOffset] = readVarint(bytes, catOffset);
            catOffset = nextCOffset;
            const cField = cTag >>> 3;
            const cWire = cTag & 0x07;

            if (cWire === 2) {
              const [cLen, cDataOffset] = readVarint(bytes, catOffset);
              const cEnd = cDataOffset + cLen;
              if (cEnd > fieldEnd) break;
              if (cField === 1 && cLen > 0) {
                try {
                  catName = textDecoder.decode(bytes.subarray(cDataOffset, cEnd)).trim();
                } catch (e) {}
              }
              catOffset = cEnd;
            } else if (cWire === 0) {
              const [cVal, nextCValOffset] = readVarint(bytes, catOffset);
              catOffset = nextCValOffset;
              if (cField === 2) {
                catOrder = cVal;
              } else if (cField === 100) {
                catFlags = cVal;
              }
            } else if (cWire === 1) {
              catOffset += 8;
            } else if (cWire === 5) {
              catOffset += 4;
            } else {
              break;
            }
          }

          if (catName) {
            categories.push({
              name: catName,
              order: catOrder,
              flags: catFlags
            });
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

    categories.sort((a, b) => (a.order || 0) - (b.order || 0));
    return categories;
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

    // Field 17: categories (repeated int64)
    if (Array.isArray(manga.categories) && manga.categories.length > 0) {
      for (const catOrder of manga.categories) {
        body.push(...encodeVarintField(17, catOrder));
      }
    }

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

  function createBackupCategoryPayload(name, order = 0, flags = 0) {
    const body = [];
    // Field 1: name (string)
    body.push(...encodeStringField(1, name || ''));
    // Field 2: order (int64)
    body.push(...encodeVarintField(2, order));
    // Field 100: flags (int64)
    if (flags) {
      body.push(...encodeVarintField(100, flags));
    }

    // Wrap in Field 2 (BackupCategory in Backup)
    return encodeMessageField(2, body);
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
   * Normalizes a manga title for duplicate detection.
   * Strips non-identifying noise (brackets, HTML entities, tags, punctuation differences)
   * while preserving the core distinctive title tokens.
   * @param {string} title
   * @returns {string}
   */
  function getNormalizedDuplicateKey(title) {
    if (!title || typeof title !== 'string') return '';

    let s = title.trim();

    // 1. Decode HTML entities
    s = s.replace(/&amp;/gi, '&')
         .replace(/&#39;/gi, "'")
         .replace(/&quot;/gi, '"')
         .replace(/&lt;/gi, '<')
         .replace(/&gt;/gi, '>');

    // 2. Replace smart quotes / apostrophes
    s = s.replace(/[‘’`]/g, "'").replace(/[“”]/g, '"');

    // 3. Remove common tags in brackets or parentheses:
    // e.g. [RAW], [Official], (Official), (Colored), [Digital Colored], [Webtoon], [Digital], (English), [Scanlation]
    s = s.replace(/\[[^\]]*(?:raw|official|color|digital|webtoon|scan|fan|trans|eng|hq|hd|remaster)[^\]]*\]/gi, '');
    s = s.replace(/\([^)]*(?:raw|official|color|digital|webtoon|scan|fan|trans|eng|hq|hd|remaster)[^)]*\)/gi, '');

    // 4. Normalize multiplication signs and " x "
    // e.g., SPY×FAMILY -> spy x family, HUNTER×HUNTER -> hunter x hunter
    s = s.replace(/×/g, ' x ');

    // 5. Replace dashes, colons, middle dots, slashes, underscores with a single space
    // Middle dots: · (U+00B7), ・ (U+30FB), • (U+2022)
    s = s.replace(/[—–―\-_:·・•\/\\|~]/g, ' ');

    // 6. Remove quotes, exclamation marks, question marks, commas, periods, parentheses, brackets
    s = s.replace(/['"!?,\.()[\]{}#]/g, '');

    // 7. Lowercase and collapse consecutive whitespace
    s = s.toLowerCase().replace(/\s+/g, ' ').trim();

    return s;
  }

  /**
   * Scans a list of library entries and groups duplicates by normalized title.
   * Identifies both same-source duplicates and cross-source duplicates.
   *
   * @param {Array<{ title: string, sourceId?: string, sourceName?: string, url?: string, artist?: string, author?: string }>} entries
   * @returns {{
   *   groups: Array<{
   *     key: string,
   *     normalizedKey: string,
   *     canonicalTitle: string,
   *     count: number,
   *     isSameSource: boolean,
   *     isCrossSource: boolean,
   *     sources: string[],
   *     entries: Array<{ title: string, sourceId: string, sourceName: string, url: string, artist: string, author: string }>
   *   }>,
   *   totalDuplicatesCount: number,
   *   duplicateGroupsCount: number,
   *   sameSourceGroupsCount: number,
   *   crossSourceGroupsCount: number
   * }}
   */
  function findDuplicateTitles(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return {
        groups: [],
        totalDuplicatesCount: 0,
        duplicateGroupsCount: 0,
        sameSourceGroupsCount: 0,
        crossSourceGroupsCount: 0
      };
    }

    const groupMap = new Map();

    for (const entry of entries) {
      if (!entry || !entry.title) continue;
      const key = getNormalizedDuplicateKey(entry.title);
      if (!key) continue;

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key).push(entry);
    }

    const duplicateGroups = [];
    let totalExtraEntries = 0;
    let sameSourceCount = 0;
    let crossSourceCount = 0;

    for (const [key, groupEntries] of groupMap.entries()) {
      if (groupEntries.length > 1) {
        // Pick canonical title (prefer original casing)
        const canonicalTitle = groupEntries[0].title || key;

        // Check source distribution
        const distinctSourceIds = new Set(groupEntries.map(e => e.sourceId || e.sourceName || 'unknown'));
        const distinctSourceNames = Array.from(new Set(groupEntries.map(e => e.sourceName || 'Unknown Source')));

        const isSameSource = distinctSourceIds.size === 1;
        const isCrossSource = distinctSourceIds.size > 1;

        if (isSameSource) sameSourceCount++;
        if (isCrossSource) crossSourceCount++;

        totalExtraEntries += (groupEntries.length - 1);

        duplicateGroups.push({
          key: key,
          normalizedKey: key,
          canonicalTitle: canonicalTitle,
          count: groupEntries.length,
          isSameSource: isSameSource,
          isCrossSource: isCrossSource,
          sources: distinctSourceNames,
          entries: groupEntries
        });
      }
    }

    // Sort duplicate groups by count descending, then alphabetical by canonicalTitle
    duplicateGroups.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.canonicalTitle.localeCompare(b.canonicalTitle);
    });

    // Collect all distinct sources appearing among duplicate entries
    const sourcesInDuplicates = new Set();
    for (const group of duplicateGroups) {
      for (const entry of group.entries) {
        if (entry.sourceName) sourcesInDuplicates.add(entry.sourceName);
      }
    }

    return {
      groups: duplicateGroups,
      totalDuplicatesCount: totalExtraEntries,
      duplicateGroupsCount: duplicateGroups.length,
      sameSourceGroupsCount: sameSourceCount,
      crossSourceGroupsCount: crossSourceCount,
      sourcesInDuplicates: Array.from(sourcesInDuplicates).sort((a, b) => a.localeCompare(b))
    };
  }

  /**
   * Formats a unix timestamp (milliseconds) into a human-readable localized date.
   * @param {number} timestamp
   * @returns {string}
   */
  function formatDate(timestamp) {
    if (!timestamp || typeof timestamp !== 'number' || timestamp <= 0) {
      return 'Unknown date';
    }
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return 'Unknown date';
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return 'Unknown date';
    }
  }

  /**
   * Computes priority rank for a given source name against user preference order.
   * Lower rank number means higher priority.
   * Sources not in preferences fall back to 99999 (lowest priority).
   * @param {string} sourceName
   * @param {string[]} sourcePreferences
   * @returns {number}
   */
  function getEntrySourceRank(sourceName, sourcePreferences) {
    if (!Array.isArray(sourcePreferences) || sourcePreferences.length === 0) return 99999;
    const cleanSource = (sourceName || '').trim().toLowerCase();
    const idx = sourcePreferences.findIndex(s => (s || '').trim().toLowerCase() === cleanSource);
    return idx >= 0 ? idx : 99999;
  }

  /**
   * Applies an automated duplicate selection rule across duplicate groups.
   * Designates exactly 1 entry to KEEP per group and marks all others for DELETION.
   *
   * @param {Array<Object>} duplicateGroups Array of duplicate groups
   * @param {'sourcePreference' | 'oldest' | 'newest' | 'all' | 'none'} rule
   * @param {{ sourcePreferences?: string[] }} [options]
   * @returns {{ totalSelectedForDelete: number, groupsAffected: number }}
   */
  function applyDuplicateSelectionRule(duplicateGroups, rule, options = {}) {
    if (!Array.isArray(duplicateGroups)) return { totalSelectedForDelete: 0, groupsAffected: 0 };
    const sourcePreferences = Array.isArray(options.sourcePreferences) ? options.sourcePreferences : [];

    let totalSelected = 0;
    let groupsAffected = 0;

    for (const group of duplicateGroups) {
      if (!group || !Array.isArray(group.entries) || group.entries.length < 2) continue;

      if (rule === 'none') {
        for (const entry of group.entries) {
          entry.isKeep = false;
          entry.isSelectedForDelete = false;
          entry.decisionReason = '';
        }
        group.keepEntry = null;
        continue;
      }

      // Clone list to sort for determining keep candidate
      const sorted = [...group.entries];

      if (rule === 'sourcePreference') {
        sorted.sort((a, b) => {
          const rankA = getEntrySourceRank(a.sourceName, sourcePreferences);
          const rankB = getEntrySourceRank(b.sourceName, sourcePreferences);
          if (rankA !== rankB) return rankA - rankB;

          // Tie-breaker 1: If both have dates > 0, prefer oldest date
          if (a.dateAdded > 0 && b.dateAdded > 0 && a.dateAdded !== b.dateAdded) {
            return a.dateAdded - b.dateAdded;
          }
          if (a.dateAdded > 0 && (!b.dateAdded || b.dateAdded <= 0)) return -1;
          if (b.dateAdded > 0 && (!a.dateAdded || a.dateAdded <= 0)) return 1;

          // Tie-breaker 2: stable entry index
          return (a.entryIndex || 0) - (b.entryIndex || 0);
        });
      } else if (rule === 'oldest') {
        sorted.sort((a, b) => {
          if (a.dateAdded > 0 && b.dateAdded > 0 && a.dateAdded !== b.dateAdded) {
            return a.dateAdded - b.dateAdded;
          }
          if (a.dateAdded > 0 && (!b.dateAdded || b.dateAdded <= 0)) return -1;
          if (b.dateAdded > 0 && (!a.dateAdded || a.dateAdded <= 0)) return 1;
          return (a.entryIndex || 0) - (b.entryIndex || 0);
        });
      } else if (rule === 'newest') {
        sorted.sort((a, b) => {
          if (a.dateAdded > 0 && b.dateAdded > 0 && a.dateAdded !== b.dateAdded) {
            return b.dateAdded - a.dateAdded;
          }
          if (a.dateAdded > 0 && (!b.dateAdded || b.dateAdded <= 0)) return -1;
          if (b.dateAdded > 0 && (!a.dateAdded || a.dateAdded <= 0)) return 1;
          return (a.entryIndex || 0) - (b.entryIndex || 0);
        });
      } else {
        // 'all' or default: preserve first entry
        sorted.sort((a, b) => (a.entryIndex || 0) - (b.entryIndex || 0));
      }

      const keepCandidate = sorted[0];
      group.keepEntry = keepCandidate;

      let keepReason = '';
      if (rule === 'sourcePreference') {
        const r = getEntrySourceRank(keepCandidate.sourceName, sourcePreferences);
        keepReason = (r < 99999)
          ? `Highest source priority (#${r + 1} ${keepCandidate.sourceName})`
          : `Retained entry (${keepCandidate.sourceName})`;
      } else if (rule === 'oldest') {
        keepReason = keepCandidate.dateAdded > 0
          ? `Oldest added (${keepCandidate.formattedDate})`
          : `First added entry`;
      } else if (rule === 'newest') {
        keepReason = keepCandidate.dateAdded > 0
          ? `Most recently added (${keepCandidate.formattedDate})`
          : `Latest added entry`;
      } else {
        keepReason = `Retained original entry`;
      }

      for (const entry of group.entries) {
        if (entry === keepCandidate) {
          entry.isKeep = true;
          entry.isSelectedForDelete = false;
          entry.decisionReason = keepReason;
        } else {
          entry.isKeep = false;
          entry.isSelectedForDelete = true;
          totalSelected++;

          let delReason = '';
          if (rule === 'sourcePreference') {
            const rankE = getEntrySourceRank(entry.sourceName, sourcePreferences);
            if (entry.sourceName === keepCandidate.sourceName) {
              delReason = `Duplicate on same source (${entry.sourceName})`;
            } else if (rankE < 99999) {
              delReason = `Lower source priority (#${rankE + 1} ${entry.sourceName})`;
            } else {
              delReason = `Unranked source (${entry.sourceName})`;
            }
          } else if (rule === 'oldest') {
            delReason = entry.dateAdded > 0
              ? `Newer duplicate (${entry.formattedDate})`
              : `Duplicate entry`;
          } else if (rule === 'newest') {
            delReason = entry.dateAdded > 0
              ? `Older duplicate (${entry.formattedDate})`
              : `Duplicate entry`;
          } else {
            delReason = `Redundant duplicate entry`;
          }

          entry.decisionReason = delReason;
        }
      }

      groupsAffected++;
    }

    return { totalSelectedForDelete: totalSelected, groupsAffected: groupsAffected };
  }

  /**
   * Removes selected manga entries from a backup (.tachibk ArrayBuffer / Uint8Array) and re-compresses with GZIP.
   * For Protobuf: Omits exact byte ranges [byteStart, byteEnd] of deleted BackupManga records, preserving all other data.
   * For JSON: Filters out deleted entries and re-encodes.
   *
   * @param {File|Blob|ArrayBuffer|Uint8Array} fileOrBuffer
   * @param {Array<{ byteStart?: number, byteEnd?: number, jsonIndex?: number, title?: string, url?: string, sourceId?: string }>} entriesToRemove
   * @returns {Promise<{
   *   compressedBytes: Uint8Array,
   *   removedCount: number,
   *   remainingCount: number,
   *   blob: Blob
   * }>}
   */
  async function removeEntriesFromBackup(fileOrBuffer, entriesToRemove) {
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

    if (!Array.isArray(entriesToRemove) || entriesToRemove.length === 0) {
      throw new Error('No duplicate entries selected for deletion.');
    }

    // 1. Decompress
    const decompressed = await decompressGzip(arrayBuffer);

    // 2. Check if JSON
    const isJson = decompressed.length > 0 && (decompressed[0] === 0x7b || decompressed[0] === 0x5b);

    if (isJson) {
      const text = new TextDecoder('utf-8').decode(decompressed);
      const data = JSON.parse(text);
      const toRemoveKeys = new Set(entriesToRemove.map(e => `${(e.title || '').trim().toLowerCase()}_${(e.url || '').trim()}_${(e.sourceId || '').toString()}`));
      const toRemoveIndices = new Set(entriesToRemove.map(e => e.jsonIndex).filter(i => typeof i === 'number'));

      function filterMangaList(list) {
        if (!Array.isArray(list)) return list;
        return list.filter((item, idx) => {
          if (toRemoveIndices.has(idx)) return false;
          const k = `${(item.title || '').trim().toLowerCase()}_${(item.url || '').trim()}_${(item.source || item.sourceId || '').toString()}`;
          return !toRemoveKeys.has(k);
        });
      }

      if (Array.isArray(data)) {
        const filtered = filterMangaList(data);
        const encoded = new TextEncoder().encode(JSON.stringify(filtered));
        const compressed = await compressGzip(encoded);
        return {
          compressedBytes: compressed,
          removedCount: entriesToRemove.length,
          remainingCount: filtered.length,
          blob: new Blob([compressed], { type: 'application/gzip' })
        };
      } else if (data && typeof data === 'object') {
        if (data.backupManga) data.backupManga = filterMangaList(data.backupManga);
        if (data.manga) data.manga = filterMangaList(data.manga);
        if (data.mangas) data.mangas = filterMangaList(data.mangas);
        const encoded = new TextEncoder().encode(JSON.stringify(data));
        const compressed = await compressGzip(encoded);
        return {
          compressedBytes: compressed,
          removedCount: entriesToRemove.length,
          remainingCount: (data.backupManga || data.manga || []).length,
          blob: new Blob([compressed], { type: 'application/gzip' })
        };
      }
    }

    // 3. Protobuf removal via exact byte slicing
    // Collect all valid [byteStart, byteEnd] ranges
    const ranges = [];
    for (const entry of entriesToRemove) {
      if (typeof entry.byteStart === 'number' && typeof entry.byteEnd === 'number' && entry.byteEnd > entry.byteStart) {
        ranges.push({ start: entry.byteStart, end: entry.byteEnd });
      }
    }

    // If byte ranges were not present on some entries, scan decompressed buffer to locate them
    if (ranges.length < entriesToRemove.length) {
      const missingEntries = entriesToRemove.filter(e => typeof e.byteStart !== 'number' || typeof e.byteEnd !== 'number');
      if (missingEntries.length > 0) {
        const parsed = parseStructuredProtobuf(decompressed, { libraryOnly: false });
        for (const target of missingEntries) {
          const tClean = (target.title || '').trim().toLowerCase();
          const match = parsed.entries ? parsed.entries.find(p =>
            p.title.trim().toLowerCase() === tClean &&
            (!target.sourceId || p.sourceId === target.sourceId) &&
            (!target.url || p.url === target.url)
          ) : null;
          if (match && typeof match.byteStart === 'number' && typeof match.byteEnd === 'number') {
            ranges.push({ start: match.byteStart, end: match.byteEnd });
          }
        }
      }
    }

    if (ranges.length === 0) {
      throw new Error('Could not resolve byte positions for the selected duplicate entries.');
    }

    // Sort ranges ascending by start offset
    ranges.sort((a, b) => a.start - b.start);

    // Merge overlapping or adjacent ranges
    const merged = [];
    for (const r of ranges) {
      if (merged.length === 0) {
        merged.push({ start: r.start, end: r.end });
      } else {
        const last = merged[merged.length - 1];
        if (r.start <= last.end) {
          last.end = Math.max(last.end, r.end);
        } else {
          merged.push({ start: r.start, end: r.end });
        }
      }
    }

    let bytesToRemove = 0;
    for (const r of merged) {
      bytesToRemove += (r.end - r.start);
    }

    const cleanedBytes = new Uint8Array(decompressed.length - bytesToRemove);
    let writeOffset = 0;
    let readOffset = 0;

    for (const r of merged) {
      if (r.start > readOffset) {
        const chunk = decompressed.subarray(readOffset, r.start);
        cleanedBytes.set(chunk, writeOffset);
        writeOffset += chunk.length;
      }
      readOffset = r.end;
    }

    if (readOffset < decompressed.length) {
      const chunk = decompressed.subarray(readOffset, decompressed.length);
      cleanedBytes.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    // 4. Recompress with GZIP
    const compressedBytes = await compressGzip(cleanedBytes);
    const blob = new Blob([compressedBytes], { type: 'application/gzip' });

    return {
      compressedBytes,
      blob,
      removedCount: entriesToRemove.length,
      remainingCount: Math.max(0, (decompressed.length - bytesToRemove))
    };
  }

  /**
   * Main entry point to parse a Komikku (.tachibk / .proto.gz) file or ArrayBuffer.
   * @param {File|Blob|ArrayBuffer} fileOrBuffer
   * @param {{ libraryOnly?: boolean }} [options]
   * @returns {Promise<{
   *   titles: Set<string>,
   *   titlesList: string[],
   *   count: number,
   *   sources: { byId: Map<string, string>, byName: Map<string, string> },
   *   entries: Array<{ title: string, url: string, sourceId: string, sourceName: string, artist: string, author: string, isFavorite: boolean }>,
   *   duplicates: ReturnType<typeof findDuplicateTitles>
   * }>}
   */
  async function parseKomikkuBackup(fileOrBuffer, options = { libraryOnly: true }) {
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

    // 5. Scan sources and categories
    const sources = parseBackupSources(decompressedBytes);
    const rawCategories = (titles && Array.isArray(titles.categories) && titles.categories.length > 0)
      ? titles.categories
      : parseBackupCategories(decompressedBytes);

    rawCategories.sort((a, b) => (a.order || 0) - (b.order || 0));
    const categoriesByOrder = new Map(rawCategories.map(c => [c.order, c.name]));
    const categoryCounts = new Map();
    for (const c of rawCategories) {
      categoryCounts.set(c.name, 0);
    }
    let uncategorizedCount = 0;

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

    // 7. Extract rich library entries with resolved sources and categories
    const rawEntries = titles && titles.entries ? titles.entries : [];
    const resolvedEntries = [];

    for (const entry of rawEntries) {
      let sourceName = '';
      if (entry.sourceId && sources.byId.has(entry.sourceId)) {
        sourceName = sources.byId.get(entry.sourceId);
      } else if (entry.sourceId) {
        const known = KNOWN_DOMAIN_SOURCES.find(k => k.id === entry.sourceId);
        if (known) {
          sourceName = known.name;
        } else {
          sourceName = `Source #${entry.sourceId}`;
        }
      } else if (entry.url) {
        const resolved = resolveSourceForDomain(entry.url, sources);
        sourceName = resolved.name;
      } else {
        sourceName = 'Unknown Source';
      }

      const catOrders = Array.isArray(entry.categories) ? entry.categories : [];
      let catNames = [];
      for (const o of catOrders) {
        if (categoriesByOrder.has(o)) {
          catNames.push(categoriesByOrder.get(o));
        }
      }
      if (catNames.length === 0 && Array.isArray(entry.categoryNames)) {
        catNames = entry.categoryNames;
      }

      if (catNames.length === 0) {
        uncategorizedCount++;
      } else {
        for (const cn of catNames) {
          categoryCounts.set(cn, (categoryCounts.get(cn) || 0) + 1);
        }
      }

      resolvedEntries.push({
        id: `entry_${resolvedEntries.length}`,
        entryIndex: resolvedEntries.length,
        title: entry.title,
        url: entry.url || '',
        sourceId: entry.sourceId || '',
        sourceName: sourceName,
        artist: entry.artist || '',
        author: entry.author || '',
        dateAdded: entry.dateAdded || 0,
        formattedDate: formatDate(entry.dateAdded || 0),
        isFavorite: entry.isFavorite !== false,
        categories: catOrders,
        categoryNames: catNames,
        isUncategorized: catNames.length === 0,
        byteStart: entry.byteStart,
        byteEnd: entry.byteEnd,
        jsonIndex: entry.jsonIndex
      });
    }

    // Fallback if entries were not captured but titles exist
    if (resolvedEntries.length === 0 && uniqueTitlesList.length > 0) {
      for (const t of uniqueTitlesList) {
        resolvedEntries.push({
          id: `entry_${resolvedEntries.length}`,
          entryIndex: resolvedEntries.length,
          title: t,
          url: '',
          sourceId: '',
          sourceName: 'Unknown Source',
          artist: '',
          author: '',
          dateAdded: 0,
          formattedDate: 'Unknown date',
          isFavorite: true,
          categories: [],
          categoryNames: [],
          isUncategorized: true
        });
        uncategorizedCount++;
      }
    }

    const duplicates = findDuplicateTitles(resolvedEntries);

    const enrichedCategories = rawCategories.map(c => ({
      name: c.name,
      order: c.order,
      flags: c.flags || 0,
      count: categoryCounts.get(c.name) || 0
    }));

    return {
      titles: titlesSet,
      titlesList: uniqueTitlesList,
      count: titlesSet.size,
      sources: sources,
      categories: enrichedCategories,
      categoriesByOrder: categoriesByOrder,
      uncategorizedCount: uncategorizedCount,
      entries: resolvedEntries,
      duplicates: duplicates
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
    parseBackupCategories,
    resolveSourceForDomain,
    extractMangaUrl,
    createBackupMangaPayload,
    createBackupCategoryPayload,
    createBackupSourcePayload,
    getNormalizedDuplicateKey,
    findDuplicateTitles,
    formatDate,
    getEntrySourceRank,
    applyDuplicateSelectionRule,
    removeEntriesFromBackup,
    parseKomikkuBackup,
    exportUpdatedBackup
  };
});

