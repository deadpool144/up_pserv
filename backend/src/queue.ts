/**
 * queue.ts
 * 
 * Background video normalization queue.
 * - Parallel concurrency controlled by QUEUE_CONCURRENCY (auto-tuned per CPU)
 * - Local-network optimized: max 2 concurrent for LAN use (≤4 logical cores = 1)
 * - Always cleans up temp files, marks failed videos as 'error' in meta
 */

import { normalizeVideo, getVideoDuration } from './media.js';
import { getMeta, saveMeta, indexMoofOffsets, vaultDataPath } from './storage.js';
import { KEY_BUFFER, TMP_DIR, VAULT_DIR, QUEUE_CONCURRENCY } from './config.js';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { getCipherAtOffset, getDecipherAtOffset } from './crypto.js';
import { evictHLSCache } from './hlscache.js';

export interface RepairTask {
    id: string;
    folder: string;
    originalName: string;
    encryptionKey?: string;
}

class BackgroundQueue {
    private queue: RepairTask[] = [];
    private activeJobs = 0;
    private readonly maxConcurrency: number;

    constructor(concurrency?: number) {
        this.maxConcurrency = concurrency ?? QUEUE_CONCURRENCY;
        console.log(`[Queue] Initialized — max concurrency: ${this.maxConcurrency}`);
    }

    async add(task: RepairTask) {
        console.log(`[Queue] Queued: ${task.originalName} (active: ${this.activeJobs}/${this.maxConcurrency})`);
        this.queue.push(task);
        this._drain();
    }

    async requeuePendingTasks() {
        console.log('[Queue] Scanning interrupted tasks...');
        const { getDetailedListing } = await import('./storage.js');

        const items = await getDetailedListing('all');
        let requeued = 0;

        for (const item of items) {
            if (item.status === 'processing') {
                const subPath =
                    item.type.startsWith('video/') ? 'videos' :
                    item.type.startsWith('image/') ? 'images' : 'files';

                await this.add({
                    id: item.id,
                    folder: path.join(VAULT_DIR, subPath, item.id),
                    originalName: item.original
                });
                requeued++;
            }
        }

        if (requeued > 0) {
            console.log(`[Queue] Re-queued ${requeued} interrupted task(s)`);
        } else {
            console.log('[Queue] No interrupted tasks found');
        }
    }

    /** Fire off as many jobs as concurrency allows */
    private _drain() {
        while (this.queue.length > 0 && this.activeJobs < this.maxConcurrency) {
            const task = this.queue.shift()!;
            this.activeJobs++;
            this._runTask(task).finally(() => {
                this.activeJobs--;
                this._drain(); // pick up next item when a slot opens
            });
        }
    }

    private async _runTask(task: RepairTask) {
        console.log(`[Queue] Processing: ${task.originalName} (slot ${this.activeJobs}/${this.maxConcurrency})`);

        let rawTmp: string | null = null;
        let normTmp: string | null = null;

        try {
            const meta = await getMeta(task.folder);
            const dp = vaultDataPath(task.folder);
            const nonce = Buffer.from(meta.nonce, 'base64');

            let decryptKey: Buffer | null = null;
            if (meta.isEncrypted) {
                if (!task.encryptionKey) throw new Error('Missing decryption key for encrypted video');
                decryptKey = Buffer.from(task.encryptionKey, 'hex');
            }

            rawTmp  = path.join(TMP_DIR, `${task.id}_raw.mp4`);
            normTmp = path.join(TMP_DIR, `${task.id}_norm.mp4`);

            // 1. Decrypt to temp file (or plain copy)
            if (decryptKey) {
                const decipher = getDecipherAtOffset(decryptKey, nonce, 0);
                await pipeline(fs.createReadStream(dp), decipher, fs.createWriteStream(rawTmp));
            } else {
                await fs.copy(dp, rawTmp);
            }

            // 2. Validate raw file
            const rawStats = await fs.stat(rawTmp);
            if (rawStats.size < 100_000) throw new Error('Raw file too small (corrupt or incomplete)');

            // 3. Normalize (transcode or remux)
            const isMKV = task.originalName.toLowerCase().endsWith('.mkv');
            await normalizeVideo(rawTmp, normTmp, isMKV);

            // 4. Validate output
            const normStats = await fs.stat(normTmp);
            if (normStats.size < 100_000) throw new Error('Normalized output too small');

            // 5. Probe duration
            const duration = await getVideoDuration(normTmp);
            if (!duration || duration <= 0) throw new Error('Invalid duration after normalization');

            // 6. Re-encrypt output back to vault
            const newNonce = crypto.randomBytes(16);
            if (decryptKey) {
                const encryptor = getCipherAtOffset(decryptKey, newNonce, 0);
                await pipeline(fs.createReadStream(normTmp), encryptor, fs.createWriteStream(dp));
            } else {
                await fs.copy(normTmp, dp);
            }

            // 7. Update metadata
            meta.nonce = newNonce.toString('base64');
            meta.size = (await fs.stat(dp)).size;
            meta.duration = duration;
            meta.status = 'ready';
            meta.type = 'video/mp4';
            await saveMeta(task.folder, meta);

            // 8. Rebuild HLS moof index
            const offsets = await indexMoofOffsets(dp, newNonce);
            await fs.writeJson(path.join(task.folder, 'hls_index.json'), offsets);
            evictHLSCache(task.id); // flush in-memory cache so next request reads fresh index

            console.log(`[Queue] ✅ Done: ${task.originalName} (${duration.toFixed(2)}s, ${offsets.length} segments)`);

        } catch (err: any) {
            console.error(`[Queue] ❌ Failed ${task.originalName} (${task.id}): ${err.message}`);
            try {
                const meta = await getMeta(task.folder);
                meta.status = 'error';
                await saveMeta(task.folder, meta);
            } catch { /* best effort */ }

        } finally {
            // Always clean up temp files
            if (rawTmp  && await fs.pathExists(rawTmp))  await fs.remove(rawTmp);
            if (normTmp && await fs.pathExists(normTmp)) await fs.remove(normTmp);
        }
    }
}

export const repairQueue = new BackgroundQueue();
