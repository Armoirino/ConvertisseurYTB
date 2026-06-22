const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;

const ytDlpCacheDir = path.join(os.tmpdir(), 'convertisseurytb-bin');
const ytDlpBinaryPath = path.join(ytDlpCacheDir, 'yt-dlp');
let ytDlpWrapPromise = null;

function isYouTubeUrl(input) {
    try {
        const parsedUrl = new URL(input);
        const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
        return (
            host === 'youtube.com' ||
            host === 'm.youtube.com' ||
            host === 'music.youtube.com' ||
            host === 'youtu.be' ||
            host.endsWith('.youtube.com')
        );
    } catch {
        return false;
    }
}

function getYtDlpBinary() {
    return ytDlpBinaryPath;
}

async function ensureYtDlpWrap() {
    if (ytDlpWrapPromise) {
        return ytDlpWrapPromise;
    }

    ytDlpWrapPromise = (async () => {
        await fs.promises.mkdir(ytDlpCacheDir, { recursive: true });

        if (!fs.existsSync(ytDlpBinaryPath)) {
            await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
        }

        return new YTDlpWrap(ytDlpBinaryPath);
    })();

    return ytDlpWrapPromise;
}

async function downloadWithYtDlp(url, ytDlpArgs) {
    const tempDir = path.join(os.tmpdir(), 'convertisseurytb', `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    const ytDlpWrap = await ensureYtDlpWrap();
    const stdout = await ytDlpWrap.execPromise([
        '--no-playlist',
        '--no-warnings',
        '--ffmpeg-location',
        ffmpegPath,
        '--print',
        'after_move:filepath',
        '--output',
        path.join(tempDir, '%(title).200s-%(id)s.%(ext)s'),
        ...ytDlpArgs,
        url,
    ]);

    const generatedFilePath = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();

    if (!generatedFilePath) {
        throw new Error('Impossible de récupérer le fichier généré');
    }

    return { generatedFilePath, tempDir };
}

module.exports = async (req, res) => {
    const { url, format } = req.query;

    if (!url || !isYouTubeUrl(url)) {
        return res.status(400).send('URL invalide');
    }

    try {
        if (format === 'mp3') {
            const { generatedFilePath, tempDir } = await downloadWithYtDlp(url, [
                '--extract-audio',
                '--audio-format',
                'mp3',
                '--audio-quality',
                '0',
            ]);

            res.setHeader('Content-Disposition', `attachment; filename="${path.basename(generatedFilePath)}"`);
            res.setHeader('Content-Type', 'audio/mpeg');

            const cleanup = async () => {
                await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            };

            res.on('finish', cleanup);
            res.on('close', cleanup);

            fs.createReadStream(generatedFilePath)
                .on('error', (err) => {
                    console.error('Erreur lecture MP3:', err.message);
                    if (!res.headersSent) {
                        res.status(500).send('Erreur lors de la lecture du MP3');
                    } else {
                        res.destroy(err);
                    }
                })
                .pipe(res);
            return;
        }

        const { generatedFilePath, tempDir } = await downloadWithYtDlp(url, [
            '-f',
            'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--merge-output-format',
            'mp4',
        ]);

        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(generatedFilePath)}"`);
        res.setHeader('Content-Type', 'video/mp4');

        const cleanup = async () => {
            await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        };

        res.on('finish', cleanup);
        res.on('close', cleanup);

        fs.createReadStream(generatedFilePath)
            .on('error', (err) => {
                console.error('Erreur lecture MP4:', err.message);
                if (!res.headersSent) {
                    res.status(500).send('Erreur lors de la lecture du MP4');
                } else {
                    res.destroy(err);
                }
            })
            .pipe(res);
    } catch (err) {
        console.error('Erreur téléchargement:', err.stack || err.message);
        res.status(500).send(`Erreur lors du traitement: ${err.message}`);
    }
};