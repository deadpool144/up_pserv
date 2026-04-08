import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import mime from 'mime-types';
import { pipeline } from 'stream/promises';
import { Transform, PassThrough } from 'stream';

import { VAULT_DIR, THUMBNAIL_DIR, TMP_DIR, ACCESS_KEY } from './config.js';
import {
    getAesKey,
    getCipherAtOffset,
    getDecipherAtOffset, // 🔥 FIX
    processChunk
} from './crypto.js';

import {
    generateThumbnail,
    normalizeVideo,
    getVideoDuration
} from './media.js';

const KEY_BUFFER = getAesKey(ACCESS_KEY);

export interface FileMeta {
    id: string;
    name: string;
    original: string;
    size: number;
    nonce: string;
    type: string;
    created_at: number;
    duration?: number;
    status?: "ready" | "processing" | "error";
    /** 
     * Encryption level:
     *  0 = plaintext
     *  1 = master key (sha256(ACCESS_KEY)) — accessible to any authenticated user
     *  2 = personal key (sha256(SECRET_KEY+userKey)) — requires personal key at login
     * undefined = legacy files, treated as level 1
     */
    encLevel?: 0 | 1 | 2;
    /** @deprecated use encLevel instead. kept for backward compat reading */
    isEncrypted?: boolean;
    thumb?: boolean;
}

export async function saveMeta(folder: string, meta: FileMeta) {
    await fs.writeJson(path.join(folder, "meta.json"), meta);
}

export async function getMeta(folder: string): Promise<FileMeta> {
    return await fs.readJson(path.join(folder, "meta.json"));
}

export async function isVaultItem(p: string): Promise<boolean> {
    return (await fs.pathExists(p)) &&
           (await fs.stat(p)).isDirectory() &&
           (await fs.pathExists(path.join(p, "meta.json")));
}

export function vaultDataPath(folder: string): string {
    const monolith = path.join(folder, "data.enc");
    if (fs.existsSync(monolith)) return monolith;

    const legacy = path.join(folder, "c0000.dat");
    if (fs.existsSync(legacy)) return legacy;

    return monolith;
}

export async function findItemPath(enc_name: string): Promise<string | null> {
    const subfolders = ["images", "videos", "music", "documents", "files"];

    for (const sub of subfolders) {
        const p = path.join(VAULT_DIR, sub, enc_name);
        if (await isVaultItem(p)) return p;
    }

    const p_root = path.join(VAULT_DIR, enc_name);
    if (await isVaultItem(p_root)) return p_root;

    return null;
}

export async function getDetailedListing(v_type: string = "all") {
    const subfolders = ["images", "videos", "music", "documents", "files"];
    let detailed: FileMeta[] = [];

    for (const sub of subfolders) {
        const sub_path = path.join(VAULT_DIR, sub);
        if (!(await fs.pathExists(sub_path))) continue;

        const entries = await fs.readdir(sub_path);

        for (const n of entries) {
            const p = path.join(sub_path, n);
            if (await isVaultItem(p)) {
                try {
                    const m = await getMeta(p);
                    m.id = n;
                    detailed.push(m);
                } catch { continue; }
            }
        }
    }

    if (VAULT_DIR && await fs.pathExists(VAULT_DIR)) {
        const rootEntries = await fs.readdir(VAULT_DIR);
        for (const n of rootEntries) {
            if (subfolders.includes(n)) continue;
            const p = path.join(VAULT_DIR, n);
            if (await isVaultItem(p)) {
                try {
                    const m = await getMeta(p);
                    m.id = n;
                    detailed.push(m);
                } catch { continue; }
            }
        }
    }

    detailed.sort((a, b) => b.created_at - a.created_at);

    if (v_type === "images") {
        detailed = detailed.filter(d => d.type.includes("image"));
    } else if (v_type === "videos") {
        detailed = detailed.filter(d => d.type.includes("video"));
    } else if (v_type === "music") {
        detailed = detailed.filter(d => d.type.includes("audio"));
    }

    return detailed;
}

// ── Simple sequential chunk writer ───────────────────────────────────────────
// Chunks arrive one at a time (sequential upload), so no locking needed.
// We just open the file and write at the correct offset.

export async function writeToVault(
    data: Buffer,
    key: Buffer | null,
    nonce: Buffer,
    globalOffset: number,
    folder: string,
    _isLastChunk = false   // kept for API compat, not needed for sequential
) {
    const dp = vaultDataPath(folder);
    const finalData = key ? processChunk(data, key, nonce, globalOffset) : data;

    await fs.ensureFile(dp);

    // Open for writing (create if missing), write at exact offset, close immediately
    const flags = globalOffset === 0 ? 'w' : 'r+';
    const fd = await fs.open(dp, flags).catch(() => fs.open(dp, 'r+'));
    try {
        await fs.write(fd, finalData, 0, finalData.length, globalOffset);
    } finally {
        await fs.close(fd);
    }
}


/**
 * 🔥 FIXED: Correct decryption + stable scanning
 */
export async function indexMoofOffsets(dp: string, nonce: Buffer, decryptKey?: Buffer): Promise<number[]> {
    const offsets: number[] = [];

    const keyToUse = decryptKey ?? KEY_BUFFER;
    const decipher = getDecipherAtOffset(keyToUse, nonce, 0);
    const MOOF = Buffer.from('moof');

    let position = 0;
    let buffer = Buffer.alloc(0);

    const scanner = new Transform({
        transform(chunk, _, cb) {
            const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any);
            const decrypted = decipher.update(bufferChunk);

            buffer = Buffer.concat([buffer, decrypted]);

            let idx;
            while ((idx = buffer.indexOf(MOOF)) !== -1) {
                const start = position + idx - 4;
                if (start >= 0) offsets.push(start);

                buffer = buffer.slice(idx + 4);
                position += idx + 4;
            }

            if (buffer.length > 8) {
                const trim = buffer.length - 8;
                buffer = buffer.slice(-8);
                position += trim;
            }

            cb();
        },
        flush(cb) {
            decipher.final();
            cb();
        }
    });

    await pipeline(
        fs.createReadStream(dp),
        scanner,
        new PassThrough()
    );

    return offsets;
}

/**
 * 🔥 FIXED: Safe thumbnail generation (no manual stream bugs)
 */
async function generateSafeThumbnail(dp: string, nonce: Buffer, mimeType: string, id: string, key: Buffer | null) {
    const decipher = key ? getDecipherAtOffset(key, nonce, 0) : null;

    const source = fs.createReadStream(dp);
    const stream = new PassThrough();

    if (decipher) {
        pipeline(source, decipher, stream).catch(() => {});
    } else {
        pipeline(source, stream).catch(() => {});
    }

    await generateThumbnail(stream as any, id, mimeType);
}

/**
 * Finalize a vault item after all chunks are uploaded.
 * @param encLevel  0=plaintext, 1=master-key, 2=personal-key
 * @param encKey    The actual key buffer used (null for level 0)
 */
export async function finalizeVaultItem(
    tempDir: string,
    originalName: string,
    nonce: Buffer,
    totalSize: number,
    encLevel: 0 | 1 | 2,
    shouldRandomize: boolean,
    encKey: Buffer | null
) {
    const enc_name = path.basename(tempDir);
    const mimeType = mime.lookup(originalName) || "application/octet-stream";

    // Classify into sub-folder
    let sub = "files";
    if (mimeType.startsWith("image/")) sub = "images";
    else if (mimeType.startsWith("video/")) sub = "videos";
    else if (mimeType.startsWith("audio/")) sub = "music";
    else if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text")) sub = "documents";

    const finalDir = path.join(VAULT_DIR, sub, enc_name);
    await fs.ensureDir(path.dirname(finalDir));

    const meta: FileMeta = {
        id: enc_name,
        name: originalName,
        original: originalName,
        size: totalSize,
        nonce: nonce.toString('base64'),
        type: mimeType,
        created_at: Date.now() / 1000,
        duration: 0,
        status: mimeType.startsWith("video/") ? "processing" : "ready",
        encLevel,
        isEncrypted: encLevel > 0,  // backward compat flag
    };

    await saveMeta(tempDir, meta);

    // Windows holds file locks briefly after close; retry up to 3x with 150ms gap
    if (await fs.pathExists(finalDir)) await fs.remove(finalDir);
    let moved = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await fs.move(tempDir, finalDir);
            moved = true;
            break;
        } catch (err: any) {
            if (attempt < 2 && (err.code === 'EPERM' || err.code === 'EBUSY')) {
                await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
            } else {
                throw err;
            }
        }
    }
    if (!moved) throw new Error(`Could not move ${tempDir} → ${finalDir}`);

    // Queue video processing
    if (mimeType.startsWith('video/')) {
        const { repairQueue } = await import('./queue.js');
        await repairQueue.add({
            id: enc_name,
            folder: finalDir,
            originalName,
            encryptionKey: encKey?.toString('hex')
        });
    }

    // Thumbnail generation (use the same key that encrypted the data)
    try {
        const dp = vaultDataPath(finalDir);
        await generateSafeThumbnail(dp, nonce, mimeType, enc_name, encKey);

        const updatedMeta = await getMeta(finalDir);
        updatedMeta.thumb = true;
        await saveMeta(finalDir, updatedMeta);
    } catch (err) {
        console.error("[Storage] Thumbnail failed:", err);
    }
}
