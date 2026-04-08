import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ACCESS_KEY, SECRET_KEY, TOKEN_TTL, THUMBNAIL_DIR, VAULT_DIR, TMP_DIR } from './config.js';
import { getDetailedListing, findItemPath, getMeta, vaultDataPath, writeToVault, finalizeVaultItem, isVaultItem, saveMeta, indexMoofOffsets } from './storage.js';

import { generateThumbnail, getVideoDuration, normalizeVideo, STREAM_HWM } from './media.js';
import { getAesKey, getCipherAtOffset, resolveDecryptKey } from './crypto.js';
import { getHLSIndexCached, setHLSIndexCached, evictHLSCache } from './hlscache.js';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import mime from 'mime-types';
import { repairQueue } from './queue.js';


const router = Router();

// ── HLS Index helper (uses shared in-memory cache) ─────────────────────────────
async function getHLSIndex(id: string, indexPath: string, fileSize: number): Promise<number[]> {
    const cached = getHLSIndexCached(id);
    if (cached) return cached;

    let offsets: number[];
    if (await fs.pathExists(indexPath)) {
        offsets = await fs.readJson(indexPath);
    } else {
        offsets = [];
        for (let i = 0; i < fileSize; i += 10 * 1024 * 1024) offsets.push(i);
    }

    setHLSIndexCached(id, offsets);
    return offsets;
}

export { evictHLSCache };  // re-export for convenience (admin reindex route)
const KEY_BUFFER = getAesKey(ACCESS_KEY);

// ── Token store ───────────────────────────────────────────────────────────────
const tokens: Map<string, { expires: number, userKey: string }> = new Map();

function issueToken(userKey: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, {
        expires: Date.now() + TOKEN_TTL * 1000,
        userKey
    });
    return token;
}

function getSessionData(token: string) {
    const data = tokens.get(token);
    if (!data) return null;
    if (Date.now() > data.expires) {
        tokens.delete(token);
        return null;
    }
    return data;
}

const tokenRequired = (req: Request, res: Response, next: NextFunction) => {
    const token = (req.query?.token as string) || (req.body?.token as string);
    const session = token ? getSessionData(token) : null;

    if (!session) {
        console.warn(`[Auth] Blocked ${req.method} ${req.path} - Token missing or invalid`);
        return res.status(401).json({ error: "Unauthorized" });
    }

    res.locals.userKey = session.userKey;
    next();
};

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth', (req: Request, res: Response) => {
    const { key, userKey } = req.body;
    if (key !== ACCESS_KEY) {
        return res.status(401).json({ error: "Invalid key" });
    }
    const sanitizedKey = (userKey || '').trim();
    const token = issueToken(sanitizedKey);
    res.json({
        token,
        expires_in: TOKEN_TTL,
        hasUserKey: sanitizedKey.length > 0,   // ← tells frontend the session level
    });
});

router.delete('/auth', tokenRequired, (req: Request, res: Response) => {
    const token = req.query.token as string;
    tokens.delete(token);
    res.json({ status: "ok" });
});

// ── Files ─────────────────────────────────────────────────────────────────────
router.get('/files', tokenRequired, async (req: Request, res: Response) => {
    const limit  = parseInt(req.query.limit  as string || '50');
    const offset = parseInt(req.query.offset as string || '0');
    const vType  = req.query.type as string || 'all';
    const userKey: string = res.locals.userKey || '';

    try {
        const detailed = await getDetailedListing(vType);
        const total = detailed.length;
        const page  = detailed.slice(offset, offset + limit);

        const resItems = await Promise.all(page.map(async (d) => {
            // Determine effective enc level (handle legacy files)
            const eLvl: number = d.encLevel ?? (d.isEncrypted === false ? 0 : 1);
            // Accessible = level 0/1 always, level 2 only if session has a userKey
            const accessible = eLvl < 2 || userKey.length > 0;

            return {
                id: d.id,
                name: d.name,
                size: d.size,
                type: d.type,
                status: d.status ?? 'ready',
                encLevel: eLvl,
                accessible,
                thumb: await fs.pathExists(path.join(THUMBNAIL_DIR, d.id)),
                created: d.created_at,
            };
        }));

        res.json({ items: resItems, total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get('/file/:id', tokenRequired, async (req: Request, res: Response) => {
    const encName = req.params.id as string;
    const userKey: string = res.locals.userKey || '';
    try {
        const folder = await findItemPath(encName);
        if (!folder) return res.status(404).json({ error: "Not found" });

        const meta = await getMeta(folder);
        const eLvl: number = meta.encLevel ?? (meta.isEncrypted === false ? 0 : 1);
        const accessible = eLvl < 2 || userKey.length > 0;

        res.json({
            id: meta.id,
            name: meta.name,
            original: meta.original,
            size: meta.size,
            type: meta.type,
            created: meta.created_at,
            duration: meta.duration,
            status: meta.status ?? 'ready',
            encLevel: eLvl,
            accessible,
            thumb: await fs.pathExists(path.join(THUMBNAIL_DIR, meta.id))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ── Stream / Download ────────────────────────────────────────────────────────
router.get(['/preview/:id', '/download/:id'], tokenRequired, async (req: Request, res: Response) => {
    const encName = req.params.id as string;
    const isDownload = req.path.startsWith('/download');

    try {
        const folder = await findItemPath(encName);
        if (!folder) return res.status(404).send("Not found");

        const meta = await getMeta(folder);
        const dp = vaultDataPath(folder);
        if (!(await fs.pathExists(dp))) return res.status(404).send("No data");

        const totalSize = meta.size;
        const nonce = Buffer.from(meta.nonce, 'base64');
        const mimeType = meta.type;

        let start = 0;
        let end = totalSize - 1;
        let statusCode = 200;

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            start = parseInt(parts[0], 10);
            end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
            end = Math.min(end, totalSize - 1);
            statusCode = 206;
        }

        const length = end - start + 1;
        const isPDF = meta.type.includes('pdf');
        const isImage = meta.type.startsWith('image/');
        const headers: any = {
            "Content-Length": length,
            "Accept-Ranges": "bytes",
            "Content-Type": meta.type || "application/octet-stream",
            "Cache-Control": isImage ? "private, max-age=300" : "no-cache",
        };

        if (isDownload) {
            const safeName = meta.name.replace(/"/g, "_");
            headers["Content-Disposition"] = `attachment; filename="${safeName}"`;
        } else if (isPDF) {
            // Force inline display for PDF viewer iframe
            headers["Content-Disposition"] = `inline; filename="${meta.name}"`;
            headers["X-Frame-Options"] = "SAMEORIGIN";
        }

        res.setHeader("Accept-Ranges", "bytes");

        const isVideo = meta.type.startsWith('video/') || meta.original.toLowerCase().endsWith('.mkv');
        const needsTranscode = (meta.status !== "ready" && meta.original.toLowerCase().endsWith('.mkv')) || req.query.transcode === 'true';

        console.log(`[Stream] Request for ${meta.original} (Status: ${meta.status}, NeedsTranscode: ${needsTranscode})`);

        if (isVideo && needsTranscode) {
            console.log(`[Stream] Dynamic QSV Transcode for ${meta.original}`);

            // For live transcoding, we send 200 OK and chunked delivery
            res.status(200);
            res.setHeader("Content-Type", "video/mp4");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.removeHeader("Content-Length");

            const { spawnStreamProcessor } = await import('./media.js');
            const isMKV = meta.original.toLowerCase().endsWith('.mkv');
            
            let startByte = 0;
            const inputOptions = isMKV ? ['-f', 'matroska'] : [];

            if (isMKV) {
                let seekTime = 0;
                if (req.query.t) {
                    seekTime = parseFloat(req.query.t as string);
                } else if (range && totalSize > 0 && (meta.duration || 0) > 0) {
                    // 🔥 AUTO-SEEK: Convert byte range to estimated seconds
                    seekTime = (start / totalSize) * (meta.duration || 0);
                    console.log(`[Stream] Auto-derived seek: ${seekTime.toFixed(2)}s from byte ${start}`);
                }

                if (seekTime > 0) {
                    const indexPath = path.join(folder, "hls_index.json");
                    if (await fs.pathExists(indexPath)) {
                        const offsets: number[] = await fs.readJson(indexPath);
                        const duration = meta.duration || 0;
                        
                        if (duration > 0 && offsets.length > 0) {
                            const segmentDuration = duration / offsets.length;
                            const segmentIndex = Math.floor(seekTime / segmentDuration);
                            const safeIndex = Math.min(offsets.length - 1, Math.max(0, segmentIndex));
                            
                            startByte = offsets[safeIndex];
                            inputOptions.push('-ss', seekTime.toFixed(2));
                            console.log(`[Stream] Refined seeking to ${seekTime.toFixed(2)}s (Byte: ${startByte})`);
                        }
                    }
                }
            }

            const ffmpeg = spawnStreamProcessor(req, true, inputOptions);

            const readStream = fs.createReadStream(dp, { start: startByte, highWaterMark: STREAM_HWM });
            const decryptor = getCipherAtOffset(KEY_BUFFER, nonce, startByte);

            // Sniffer to verify decryption
            let snifferBuffer = Buffer.alloc(0);
            const sniffer = new (await import('stream')).Transform({
                transform(chunk, encoding, callback) {
                    if (snifferBuffer.length < 16) {
                        snifferBuffer = Buffer.concat([snifferBuffer, chunk.slice(0, 16 - snifferBuffer.length)]);
                        if (snifferBuffer.length >= 4) {
                            console.log(`[Stream] Sniffed: ${snifferBuffer.slice(0, 4).toString('hex')} (Match: ${snifferBuffer.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? "MKV" : "NO"})`);
                        }
                    }
                    callback(null, chunk);
                }
            });

            ffmpeg.stderr?.on('data', (d) => {
                const msg = d.toString();
                if (msg.includes('error') || msg.includes('Error')) {
                    console.error("[FFmpeg-Live]", msg);
                }
            });

            // Input hint is now handled by spawnStreamProcessor(true, inputOptions)

            readStream.pipe(decryptor).pipe(sniffer).pipe(ffmpeg.stdin);
            ffmpeg.stdout.pipe(res);
            return;
        }

        // Standard direct pipe (H.264 compatible)
        // Ensure we send the 206 status code for seeking
        res.status(statusCode);
        Object.entries(headers).forEach(([k, v]: [string, any]) => res.setHeader(k, v));
        if (statusCode === 206) {
            res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
        }

        // ── Key resolution (encLevel system) ───────────────────────────────
        const userKey: string = res.locals.userKey || '';
        const eLvl = meta.encLevel ?? (meta.isEncrypted === false ? 0 : 1);

        // Block access to level-2 files if session has no personal key
        if (eLvl === 2 && userKey.length === 0) {
            if (!res.headersSent) res.status(403).json({ error: "Personal key required", encLevel: 2 });
            return;
        }

        const decryptKey = resolveDecryptKey(meta.encLevel, meta.isEncrypted, KEY_BUFFER, SECRET_KEY, userKey);

        const readStream = fs.createReadStream(dp, { start, end, highWaterMark: STREAM_HWM });

        if (decryptKey) {
            const decryptor = getCipherAtOffset(decryptKey, nonce, start);
            readStream.pipe(decryptor).pipe(res);
        } else {
            readStream.pipe(res);
        }
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).send("Internal Error");
    }
});


// ── Virtual HLS Streaming (Byte-Range) ────────────────────────────────────
router.get('/stream/:id/v.m3u8', tokenRequired, async (req: Request, res: Response) => {
    try {
        const encId = req.params.id as string;
        const token = (req.query.token as string) || '';
        const folder = await findItemPath(encId);
        if (!folder) return res.status(404).send('Not found');

        const meta = await getMeta(folder);
        if (meta.status === 'processing') {
            return res.status(503).send('Video is still processing...');
        }

        const indexPath = path.join(folder, 'hls_index.json');
        const offsets = await getHLSIndex(encId, indexPath, meta.size);

        const duration = meta.duration || 0;
        const segDuration = offsets.length > 0 ? (duration / offsets.length) : 10;
        const targetDuration = Math.ceil(segDuration) + 2;

        let m3u8 = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${targetDuration}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4?token=${token}"\n`;
        for (let i = 0; i < offsets.length; i++) {
            m3u8 += `#EXTINF:${segDuration.toFixed(3)},\nseg-${i}.m4s?token=${token}\n`;
        }
        m3u8 += '#EXT-X-ENDLIST';

        // Playlist can be revalidated after 5s (short TTL in case video re-indexes)
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Vary', 'Origin');
        res.send(m3u8);
    } catch (err) {
        console.error('[HLS-M3U8]', err);
        res.status(500).send('HLS Error');
    }
});

router.get('/stream/:id/init.mp4', tokenRequired, async (req: Request, res: Response) => {
    const encId = req.params.id as string;
    const folder = await findItemPath(encId);
    if (!folder) return res.status(404).send('Not found');
    const meta = await getMeta(folder);
    const dp = vaultDataPath(folder);
    const nonce = Buffer.from(meta.nonce, 'base64');

    // Init segment: bytes 0 → first moof offset
    const indexPath = path.join(folder, 'hls_index.json');
    const offsets = await getHLSIndex(encId, indexPath, meta.size);
    const end = offsets.length > 0 ? offsets[0] - 1 : 128 * 1024 - 1;
    const segLen = end + 1;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', segLen);
    // Init segment is immutable once the video is indexed — cache aggressively
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    const readStream = fs.createReadStream(dp, { start: 0, end, highWaterMark: STREAM_HWM });
    const decryptor = getCipherAtOffset(KEY_BUFFER, nonce, 0);
    readStream.on('data', (c) => {
        const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c as any);
        res.write(decryptor.update(chunk));
    });
    readStream.on('end', () => res.end(decryptor.final()));
    readStream.on('error', (err) => {
        console.error('[HLS-Init] Read error:', err.message);
        if (!res.headersSent) res.status(500).end();
    });
});

router.get('/stream/:id/seg-:num.m4s', tokenRequired, async (req: Request, res: Response) => {
    const encId = req.params.id as string;
    const segNum = parseInt(req.params.num as string);
    const folder = await findItemPath(encId);
    if (!folder) return res.status(404).send('Not found');
    const meta = await getMeta(folder);
    const dp = vaultDataPath(folder);
    const nonce = Buffer.from(meta.nonce, 'base64');

    const indexPath = path.join(folder, 'hls_index.json');
    const offsets = await getHLSIndex(encId, indexPath, meta.size);

    let start: number, end: number;
    if (offsets.length > 0) {
        if (segNum >= offsets.length) return res.status(404).send('End of stream');
        start = offsets[segNum];
        end = (segNum + 1 < offsets.length) ? offsets[segNum + 1] - 1 : meta.size - 1;
    } else {
        const chunkSize = 2 * 1024 * 1024;
        start = segNum * chunkSize;
        end = Math.min(start + chunkSize - 1, meta.size - 1);
    }

    const segLen = end - start + 1;
    res.setHeader('Content-Type', 'video/iso.segment');
    res.setHeader('Content-Length', segLen);
    // Segments are immutable; browsers/hls.js can cache them safely
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable');

    try {
        const readStream = fs.createReadStream(dp, { start, end, highWaterMark: STREAM_HWM });
        const decryptor = getCipherAtOffset(KEY_BUFFER, nonce, start);

        readStream.on('error', (err) => {
            console.error('[HLS-Seg] Read error:', err.message);
            if (!res.headersSent) res.status(500).end();
        });

        readStream.pipe(decryptor).pipe(res);
    } catch (err: any) {
        console.error('[HLS-Seg] Error:', err.message);
        if (!res.headersSent) res.status(500).end();
    }
});

// ── Thumbnails ───────────────────────────────────────────────────────────────
router.get('/thumbnail/:id', tokenRequired, async (req: Request, res: Response) => {
    const encName = req.params.id as string;
    const thPath = path.join(THUMBNAIL_DIR, encName);

    if (!(await fs.pathExists(thPath))) {
        return res.status(404).send("Not found");
    }

    res.writeHead(200, { "Content-Type": "image/jpeg" });

    const readStream = fs.createReadStream(thPath);
    let headerHandled = false;
    let decryptor: any = null;

    readStream.on('data', (chunk: Buffer) => {
        let data = chunk;
        if (!headerHandled) {
            const nonce = data.slice(0, 16);
            data = data.slice(16);
            decryptor = getCipherAtOffset(KEY_BUFFER, nonce, 0);
            headerHandled = true;
        }
        if (data.length > 0) {
            res.write(decryptor.update(data));
        }
    });

    readStream.on('end', () => {
        res.end();
    });
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/delete/:id', tokenRequired, async (req: Request, res: Response) => {
    const encName = req.params.id as string;
    try {
        const folder = await findItemPath(encName);
        if (folder) await fs.remove(folder);
        const thPath = path.join(THUMBNAIL_DIR, encName);
        if (await fs.pathExists(thPath)) await fs.remove(thPath);
        res.json({ status: "ok" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete" });
    }
});

// ── Upload ───────────────────────────────────────────────────────────────────
// Track uploads that have been initialized (prevents parallel-chunk race on .state creation)
const _uploadInitLocks = new Set<string>();

router.post('/upload-chunk', tokenRequired, async (req: Request, res: Response) => {
    const fileId       = req.body.file_id      as string || "";
    const chunkIndex   = parseInt(req.body.chunk_index  as string || '0');
    const totalChunks  = parseInt(req.body.total_chunks as string || '1');
    const filename     = req.body.filename     as string || "file";
    const globalOffset = parseInt(req.body.offset       as string || '0');
    const shouldRandomize = req.body.should_randomize === 'true';
    const userKey: string = res.locals.userKey || '';

    // ── Determine enc level ───────────────────────────────────────────────
    const isAudio = (mime.lookup(filename) || "").toString().startsWith("audio/");
    // Audio is always level 0 (plaintext) so it can stream without personal key
    let encLevel: 0 | 1 | 2 = isAudio ? 0 : (parseInt(req.body.enc_level as string || '1') as 0 | 1 | 2);
    // Clamp: can only use level 2 if session actually has a userKey
    if (encLevel === 2 && userKey.length === 0) encLevel = 1;
    // Clamp: must be 0, 1, or 2
    if (![0, 1, 2].includes(encLevel)) encLevel = 1;

    const chunkFile = (req as any).files?.chunk;
    if (!chunkFile || !fileId) return res.status(400).send("Missing data");

    const tempDir = path.join(TMP_DIR, fileId);
    await fs.ensureDir(tempDir);

    const statePath = path.join(tempDir, '.state');
    let nonce: Buffer;

    // Init lock: only the first chunk creates .state; others wait briefly and read it
    if (!_uploadInitLocks.has(fileId)) {
        _uploadInitLocks.add(fileId);
        nonce = crypto.randomBytes(16);
        await fs.writeJson(statePath, { nonce: nonce.toString('base64'), encLevel });
    } else {
        // Wait up to 200ms for .state to be ready (parallel chunk may beat this one)
        for (let t = 0; t < 20; t++) {
            if (await fs.pathExists(statePath)) break;
            await new Promise(r => setTimeout(r, 10));
        }
        const state = await fs.readJson(statePath);
        nonce = Buffer.from(state.nonce, 'base64');
    }

    // ── Resolve encryption key ────────────────────────────────────────────
    let encKey: Buffer | null = null;
    if (encLevel === 1) {
        encKey = KEY_BUFFER;  // master key
    } else if (encLevel === 2) {
        const { deriveFinalKey } = await import('./crypto.js');
        encKey = deriveFinalKey(SECRET_KEY, userKey);
    }

    const data = chunkFile.tempFilePath
        ? (await fs.readFile(chunkFile.tempFilePath))
        : chunkFile.data;
    if (!data || data.length === 0) console.warn("[Upload] Empty chunk");

    await writeToVault(data, encKey, nonce, globalOffset, tempDir);

    // Sequential upload: the last chunk index means we're done
    if (chunkIndex === totalChunks - 1) {
        const totalSize = globalOffset + data.length;
        await finalizeVaultItem(tempDir, filename, nonce, totalSize, encLevel, shouldRandomize, encKey);
        
        // Trigger background processing for videos
        if ((mime.lookup(filename) || "").toString().startsWith("video/")) {
            repairQueue.add({
                id: fileId,
                folder: path.join(VAULT_DIR, "videos", fileId),
                originalName: filename,
                encryptionKey: encKey?.toString('hex')
            });
        }

        _uploadInitLocks.delete(fileId);
        console.log(`[Upload] ✅ Done: ${filename} (encLevel=${encLevel})`);

    }

    res.send("OK");
});




// ── Playlists ───────────────────────────────────────────────────────────────
import { PLAYLIST_FILE } from './config.js';

interface Playlist {
    id: string;
    name: string;
    items: string[]; // file IDs
}

async function getPlaylists(): Promise<Playlist[]> {
    if (!(await fs.pathExists(PLAYLIST_FILE))) return [];
    try {
        return await fs.readJson(PLAYLIST_FILE);
    } catch {
        return [];
    }
}

async function savePlaylists(pl: Playlist[]) {
    await fs.ensureDir(path.dirname(PLAYLIST_FILE));
    await fs.writeJson(PLAYLIST_FILE, pl, { spaces: 2 });
}

router.get('/playlists', tokenRequired, async (req: Request, res: Response) => {
    try {
        const pl = await getPlaylists();
        res.json(pl);
    } catch (err) {
        res.status(500).send("List error");
    }
});

router.post('/playlists', tokenRequired, async (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name) return res.status(400).send("Name required");
    try {
        const pl = await getPlaylists();
        const newPl: Playlist = {
            id: crypto.randomBytes(8).toString('hex'),
            name,
            items: []
        };
        pl.push(newPl);
        await savePlaylists(pl);
        res.json(newPl);
    } catch (err) {
        res.status(500).send("Create error");
    }
});

router.delete('/playlists/:id', tokenRequired, async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        let pl = await getPlaylists();
        pl = pl.filter(p => p.id !== id);
        await savePlaylists(pl);
        res.json({ status: "ok" });
    } catch (err) {
        res.status(500).send("Delete error");
    }
});

router.post('/playlists/:id/add', tokenRequired, async (req: Request, res: Response) => {
    const { id } = req.params;
    const { fileId } = req.body;
    if (!fileId) return res.status(400).send("fileId required");
    try {
        const pl = await getPlaylists();
        const target = pl.find(p => p.id === id);
        if (!target) return res.status(404).send("Playlist not found");
        if (!target.items.includes(fileId)) {
            target.items.push(fileId);
            await savePlaylists(pl);
        }
        res.json(target);
    } catch (err) {
        res.status(500).send("Add error");
    }
});

router.delete('/playlists/:id/remove/:fileId', tokenRequired, async (req: Request, res: Response) => {
    const { id, fileId } = req.params;
    try {
        const pl = await getPlaylists();
        const target = pl.find(p => p.id === id);
        if (!target) return res.status(404).send("Playlist not found");
        target.items = target.items.filter(fid => fid !== fileId);
        await savePlaylists(pl);
        res.json(target);
    } catch (err) {
        res.status(500).send("Remove error");
    }
});


// ── Admin: Sync/Reindex (Temporary) ────────────────────────────────────────
router.get('/admin/reindex', tokenRequired, async (req: Request, res: Response) => {
    try {
        console.log("--- Starting Admin Reindex (Full Repair) ---");
        const videoDir = path.join(VAULT_DIR, "videos");
        if (!(await fs.pathExists(videoDir))) return res.send("No videos found.");

        const targetId = req.query.id as string;
        let entries = await fs.readdir(videoDir);
        if (targetId) {
            console.log(`[Admin] Targeted reindex for ID: ${targetId}`);
            entries = entries.filter(e => e.includes(targetId));
        }

        console.log(`[Admin] Re-indexing ${entries.length} items in ${videoDir}`);
        let count = 0;
        const force = req.query.force === 'true';

        for (const id of entries) {
            const p = path.join(videoDir, id);
            const exists = await isVaultItem(p);
            console.log(`[Admin] Checking ${id}: isVaultItem=${exists} at ${p}`);
            if (!exists) continue;

            try {
                const meta = await getMeta(p);
                const dp = vaultDataPath(p);
                const isMKV = meta.type.includes('matroska') || meta.original.toLowerCase().endsWith('.mkv');

                if (!meta.duration || meta.duration === 0 || force || isMKV) {
                    console.log(`[Repairing] ${meta.original}...`);
                    const oldNonce = Buffer.from(meta.nonce, 'base64');
                    const rawTmp = path.join(TMP_DIR, `${id}_raw.mp4`);
                    const normTmp = path.join(TMP_DIR, `${id}_norm.mp4`);

                    // 1. Decrypt (Robustly with pipeline)
                    const { pipeline } = await import('stream/promises');
                    const decryptor = getCipherAtOffset(KEY_BUFFER, oldNonce, 0);

                    if (await fs.pathExists(rawTmp)) await fs.remove(rawTmp);
                    if (await fs.pathExists(normTmp)) await fs.remove(normTmp);

                    await pipeline(
                        fs.createReadStream(dp),
                        decryptor,
                        fs.createWriteStream(rawTmp)
                    );

                    // 2. Transcode & Probe result
                    await normalizeVideo(rawTmp, normTmp, isMKV || force);
                    const duration = await getVideoDuration(normTmp);

                    // 3. Re-encrypt normalized back to data.enc (streaming)
                    const newNonce = crypto.randomBytes(16);
                    const encryptor = getCipherAtOffset(KEY_BUFFER, newNonce, 0);

                    await pipeline(
                        fs.createReadStream(normTmp),
                        encryptor,
                        fs.createWriteStream(dp)
                    );

                    // 4. Update Meta & Index
                    meta.nonce = newNonce.toString('base64');
                    meta.size = (await fs.stat(dp)).size;
                    meta.type = 'video/mp4';
                    meta.duration = duration;
                    await saveMeta(p, meta);

                    const offsets = await indexMoofOffsets(dp, newNonce);
                    await fs.writeJson(path.join(p, "hls_index.json"), offsets);
                    evictHLSCache(id); // ← flush in-memory cache so next request re-reads

                    // 5. Cleanup
                    if (await fs.pathExists(rawTmp)) await fs.remove(rawTmp);
                    if (await fs.pathExists(normTmp)) await fs.remove(normTmp);

                    console.log(`[Fixed] ${meta.original}: ${duration.toFixed(2)}s`);
                    count++;
                }
            } catch (itemErr) {
                console.error(`Error processing ${id}:`, itemErr);
            }
        }
        res.send(`Successfully reindexed/repaired ${count} videos.`);
    } catch (err: any) {
        console.error("Reindex error:", err.message);
        if (!res.headersSent) res.status(500).send("Reindex failed: " + err.message);
    }
});

export default router;
