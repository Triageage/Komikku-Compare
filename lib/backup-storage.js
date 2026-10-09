/**
 * Komikku Compare - Backup Storage Manager
 * Uses IndexedDB to reliably persist large .tachibk ArrayBuffers (10MB - 100MB+)
 * across extension popup sessions and upload tabs without storage quota restrictions.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BackupStorage = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'KomikkuCompareDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'backups';
  const BACKUP_RECORD_KEY = 'current_backup';

  let dbPromise = null;

  /**
   * Opens or initializes the IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });

    return dbPromise;
  }

  /**
   * Saves a backup file ArrayBuffer or Uint8Array to IndexedDB.
   * @param {ArrayBuffer|Uint8Array|Blob|File} fileOrBuffer
   * @param {string} fileName
   * @returns {Promise<boolean>}
   */
  async function saveBackup(fileOrBuffer, fileName = 'backup.tachibk') {
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
      throw new Error('Unsupported buffer type for saveBackup');
    }

    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record = {
        id: BACKUP_RECORD_KEY,
        buffer: arrayBuffer,
        fileName: fileName,
        byteLength: arrayBuffer.byteLength,
        savedAt: Date.now()
      };

      const putRequest = store.put(record);

      putRequest.onsuccess = () => resolve(true);
      putRequest.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieves the current stored backup record from IndexedDB.
   * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, byteLength: number, savedAt: number }|null>}
   */
  async function getBackup() {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(BACKUP_RECORD_KEY);

        getRequest.onsuccess = () => {
          resolve(getRequest.result || null);
        };

        getRequest.onerror = (e) => {
          reject(e.target.error);
        };
      });
    } catch (e) {
      console.warn('BackupStorage.getBackup failed:', e);
      return null;
    }
  }

  /**
   * Clears the stored backup record from IndexedDB.
   * @returns {Promise<boolean>}
   */
  async function clearBackup() {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const deleteRequest = store.delete(BACKUP_RECORD_KEY);

        deleteRequest.onsuccess = () => resolve(true);
        deleteRequest.onerror = (e) => reject(e.target.error);
      });
    } catch (e) {
      console.warn('BackupStorage.clearBackup failed:', e);
      return false;
    }
  }

  return {
    openDb,
    saveBackup,
    getBackup,
    clearBackup
  };
});
