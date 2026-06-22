const urlInput = document.getElementById('url');
const statusEl = document.getElementById('status');
const percentEl = document.getElementById('percent');
const progressBar = document.getElementById('progressBar');
const formatButtons = document.querySelectorAll('[data-format]');
const downloadButton = document.getElementById('downloadButton');
const doneActions = document.getElementById('doneActions');
const resetButton = document.getElementById('resetButton');

let deferredPrompt = null;
let selectedFormat = 'mp3';
let activeXhr = null;
let loadingTimer = null;

function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = type ? `status ${type}` : 'status';
}

function setProgress(percent) {
    const normalizedPercent = Math.max(0, Math.min(100, percent));
    percentEl.textContent = `${Math.round(normalizedPercent)}%`;
    progressBar.style.width = `${normalizedPercent}%`;
}

function startLoadingAnimation() {
    clearInterval(loadingTimer);
    loadingTimer = setInterval(() => {
        const currentPercent = Number.parseFloat(percentEl.textContent) || 0;
        if (currentPercent >= 92) {
            return;
        }

        const nextPercent = currentPercent + Math.max(1, (92 - currentPercent) * 0.08);
        setProgress(nextPercent);
    }, 260);
}

function stopLoadingAnimation() {
    clearInterval(loadingTimer);
    loadingTimer = null;
}

function resetState() {
    if (activeXhr) {
        activeXhr.abort();
        activeXhr = null;
    }

    stopLoadingAnimation();

    setStatus('En attente d’un lien.');
    setProgress(0);
    doneActions.hidden = true;
    downloadButton.disabled = false;
    urlInput.value = '';
    urlInput.focus();
}

function triggerBrowserDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function startDownload(format) {
    const url = urlInput.value.trim();

    if (!url) {
        setStatus('Ajoute un lien YouTube valide avant de lancer le téléchargement.', 'error');
        setProgress(0);
        return;
    }

    downloadButton.disabled = true;
    doneActions.hidden = true;
    setStatus(`Téléchargement en cours en ${format.toUpperCase()}...`);
    setProgress(8);
    startLoadingAnimation();

    const controller = new AbortController();
    activeXhr = controller;

    try {
        const response = await fetch(`/download?url=${encodeURIComponent(url)}&format=${format}`, {
            method: 'GET',
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Le téléchargement a échoué.');
        }

        const disposition = response.headers.get('Content-Disposition') || '';
        const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
        const fileName = fileNameMatch ? fileNameMatch[1] : `download.${format}`;
        const blob = await response.blob();

        stopLoadingAnimation();
        setProgress(100);
        setStatus('Téléchargement terminé.');
        triggerBrowserDownload(blob, fileName);
        doneActions.hidden = false;
        downloadButton.disabled = false;
        activeXhr = null;
    } catch (error) {
        activeXhr = null;
        downloadButton.disabled = false;
        stopLoadingAnimation();

        if (error.name === 'AbortError') {
            setStatus('Téléchargement annulé.', 'error');
        } else {
            setStatus(error.message || 'Erreur réseau pendant le téléchargement.', 'error');
        }

        setProgress(0);
    }
}

formatButtons.forEach((button) => {
    button.addEventListener('click', () => {
        selectedFormat = button.dataset.format;
        formatButtons.forEach((item) => item.classList.toggle('is-active', item === button));
        setStatus(`Format sélectionné: ${selectedFormat.toUpperCase()}.`);
    });
});

urlInput.addEventListener('input', () => {
    if (statusEl.classList.contains('error')) {
        setStatus('Colle un lien YouTube, puis choisis MP3 ou MP4.');
    }
});

downloadButton.addEventListener('click', () => startDownload(selectedFormat));
resetButton.addEventListener('click', resetState);

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setStatus('Tu peux aussi installer cette app depuis le navigateur.');
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

setProgress(0);
setStatus('En attente d’un lien.');
