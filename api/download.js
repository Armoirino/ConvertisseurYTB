const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ytdl = require('@distube/ytdl-core');

const YT_CLIENTS = ['WEB_EMBEDDED', 'TV', 'ANDROID', 'IOS'];

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

function spawnFfmpeg(args) {
    return spawn(ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
}

function ytdlOptions(overrides = {}) {
    return {
        requestOptions: {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                referer: 'https://www.youtube.com/',
            },
        },
        playerClients: YT_CLIENTS,
        highWaterMark: 1 << 25,
        ...overrides,
    };
}

module.exports = async (req, res) => {
    const { url, format } = req.query;

    if (!url || !isYouTubeUrl(url)) {
        return res.status(400).send('URL invalide');
    }

    try {
        const info = await ytdl.getInfo(url, ytdlOptions());
        const safeTitle = info.videoDetails.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

        if (format === 'mp3') {
            res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
            res.setHeader('Content-Type', 'audio/mpeg');

            const audioStream = ytdl(url, {
                ...ytdlOptions(),
                filter: 'audioonly',
                quality: 'highestaudio',
            });

            const ffmpeg = spawnFfmpeg([
                '-i', 'pipe:0',
                '-vn',
                '-f', 'mp3',
                '-b:a', '192k',
                'pipe:1',
            ]);

            audioStream.on('error', (err) => {
                console.error('Erreur audio stream:', err.message);
                if (!res.headersSent) {
                    res.status(500).send(`Erreur audio: ${err.message}`);
                } else {
                    res.destroy(err);
                }
            });

            ffmpeg.stderr.on('data', (chunk) => {
                console.error(String(chunk));
            });

            ffmpeg.on('error', (err) => {
                console.error('Erreur ffmpeg MP3:', err.message);
                if (!res.headersSent) {
                    res.status(500).send(`Erreur MP3: ${err.message}`);
                } else {
                    res.destroy(err);
                }
            });

            ffmpeg.on('close', (code) => {
                if (code !== 0 && !res.headersSent) {
                    res.status(500).send('Erreur lors de la conversion MP3');
                }
            });

            audioStream.pipe(ffmpeg.stdin);
            ffmpeg.stdout.pipe(res);
            return;
        }

        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');

        const videoStream = ytdl(url, {
            ...ytdlOptions(),
            filter: (formatItem) => formatItem.container === 'mp4' && formatItem.hasVideo && formatItem.hasAudio,
            quality: 'highest',
        });

        const ffmpeg = spawnFfmpeg([
            '-i', 'pipe:0',
            '-c', 'copy',
            '-f', 'mp4',
            'pipe:1',
        ]);

        videoStream.on('error', (err) => {
            console.error('Erreur vidéo stream:', err.message);
            if (!res.headersSent) {
                res.status(500).send(`Erreur vidéo: ${err.message}`);
            } else {
                res.destroy(err);
            }
        });

        ffmpeg.stderr.on('data', (chunk) => {
            console.error(String(chunk));
        });

        ffmpeg.on('error', (err) => {
            console.error('Erreur ffmpeg MP4:', err.message);
            if (!res.headersSent) {
                res.status(500).send(`Erreur MP4: ${err.message}`);
            } else {
                res.destroy(err);
            }
        });

        ffmpeg.on('close', (code) => {
            if (code !== 0 && !res.headersSent) {
                res.status(500).send('Erreur lors de la conversion MP4');
            }
        });

        videoStream.pipe(ffmpeg.stdin);
        ffmpeg.stdout.pipe(res);
    } catch (err) {
        console.error('Erreur téléchargement:', err.stack || err.message);
        res.status(500).send(`Erreur lors du traitement: ${err.message}`);
    }
};