const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

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
    return path.join(
        process.cwd(),
        'node_modules',
        'youtube-dl-exec',
        'bin',
        process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    );
}

async function downloadWithYtDlp(url, ytDlpArgs) {
    const tempDir = path.join(os.tmpdir(), 'convertisseurytb', `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    const ytDlpBinary = getYtDlpBinary();
    const { stdout } = await execFileAsync(
        ytDlpBinary,
        [
            '--no-playlist',
            '--no-warnings',
            '--print',
            'after_move:filepath',
            '--output',
            path.join(tempDir, '%(title).200s-%(id)s.%(ext)s'),
            ...ytDlpArgs,
            url,
        ],
        {
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        }
    );

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