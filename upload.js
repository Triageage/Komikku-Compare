/**
 * Komikku Compare - Dedicated Upload Controller
 * Safely handles .tachibk file selection in Zen Browser without focus-loss popup closing.
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const STORAGE_KEY_BACKUP = 'komikku_compare_backup_data_v2';

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressText = document.getElementById('progressText');
  const uploadContainer = document.getElementById('uploadContainer');
  const successCard = document.getElementById('successCard');
  const successTitle = document.getElementById('successTitle');
  const successDesc = document.getElementById('successDesc');
  const returnBtn = document.getElementById('returnBtn');
  const replaceBtn = document.getElementById('replaceBtn');

  // Trigger file picker when drop zone is clicked
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  });

  // Drag and drop support
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  });

  // Return / Close button
  returnBtn.addEventListener('click', () => {
    window.close();
  });

  // Replace button
  replaceBtn.addEventListener('click', () => {
    successCard.classList.add('hidden');
    uploadContainer.classList.remove('hidden');
    fileInput.value = '';
    fileInput.click();
  });

  // Auto-open file chooser on load if requested via query param
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auto') === '1') {
    setTimeout(() => {
      fileInput.click();
    }, 150);
  }

  async function processFile(file) {
    if (!file) return;

    progressBarContainer.classList.remove('hidden');
    progressText.textContent = `Decompressing and parsing ${file.name}...`;

    try {
      // Yield thread for animation
      await new Promise(r => setTimeout(r, 40));

      const parsed = await BackupParser.parseKomikkuBackup(file);

      if (parsed.count === 0) {
        alert('No manga titles could be extracted from this file. Please verify it is a valid Komikku or Tachiyomi backup file (.tachibk / .proto.gz).');
        progressBarContainer.classList.add('hidden');
        return;
      }

      // Persist to extension storage
      if (api.storage && api.storage.local) {
        await api.storage.local.set({
          [STORAGE_KEY_BACKUP]: {
            fileName: file.name,
            titles: parsed.titlesList,
            savedAt: Date.now()
          }
        });
      }

      // Show success
      uploadContainer.classList.add('hidden');
      successCard.classList.remove('hidden');
      successTitle.textContent = `✓ Indexed ${parsed.count.toLocaleString()} Titles!`;
      successDesc.textContent = `Loaded from "${file.name}". Your library is now active in Komikku Compare. You can close this tab and open the extension popup.`;

    } catch (err) {
      console.error(err);
      alert(`Error reading backup: ${err.message}`);
    } finally {
      progressBarContainer.classList.add('hidden');
    }
  }
})();
