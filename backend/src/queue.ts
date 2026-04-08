/**
 * queue.ts
 *
 * Background video normalization queue.
 * - Parallel concurrency controlled by QUEUE_CONCURRENCY (auto-tuned per CPU)
 * - Rich console progress: per-step timing, summary box on completion
 */

import { normalizeVideo, getVideoDuration } from './media.js';
import { getMeta, saveMeta, indexMoofOffsets, vaultDataPath } from './storage.js';
import { TMP_DIR, VAULT_DIR, QUEUE_CONCURRENCY } from './config.js';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { getCipherAtOffset, getDecipherAtOffset } from './crypto.js';
import { evictHLSCache } from './hlscache.js';
import { getHWCaps } from './hwdetect.js';



export interface RepairTask {
    id: string;
    folder: string;
    originalName: string;
    encryptionKey?: string;
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtBytes(b: number): string {
    if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
    return b + ' B';
}

function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = ((ms % 60_000) / 1000).toFixed(0);
    return `${m}m ${s}s`;
}

function fmtDur(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/** Prints "  ├─ <label>..." immediately, returns a function to print "done (Xms)\n" */
function stepTimer(label: string): () => void {
    const t = Date.now();
    process.stdout.write(`  ├─ ${label}... `);
    return () => process.stdout.write(`done (${fmtMs(Date.now() - t)})\n`);
}

// ─────────────────────────────────────────────────────────────────────────────

class BackgroundQueue {
    private queue: RepairTask[] = [];
    private activeJobs = 0;
    private readonly maxConcurrency: number;

    constructor(concurrency?: number) {
        this.maxConcurrency = concurrency ?? QUEUE_CONCURRENCY;
        console.log(`[Queue] Initialized — max concurrency: ${this.maxConcurrency}`);
    }

    async add(task: RepairTask) {
        console.log(`[Queue] Queued: "${task.originalName}"  (active: ${this.activeJobs}/${this.maxConcurrency})`);
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
                    originalName: item.original,
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

    private _drain() {
        while (this.queue.length > 0 && this.activeJobs < this.maxConcurrency) {
            const task = this.queue.shift()!;
            this.activeJobs++;
            this._runTask(task).finally(() => {
                this.activeJobs--;
                this._drain();
            });
        }
    }

    private async _runTask(task: RepairTask) {
        const jobStart = Date.now();
        let rawTmp: string | null = null;
        let normTmp: string | null = null;

        // ── Job header ────────────────────────────────────────────────────────
        console.log('');
        try {
            const caps = getHWCaps();
            console.log(`┌─ [Video] Processing: "${task.originalName}"`);
            console.log(`│   ├─ Encoder  : ${caps.encoder.toUpperCase()}`);
            console.log(`│   ├─ Capacity : ${caps.concurrency} concurrent`);
            
            const meta    = await getMeta(task.folder);
            const dp      = vaultDataPath(task.folder);
            const nonce   = Buffer.from(meta.nonce, 'base64');
            const srcSize = (await fs.stat(dp)).size;

            console.log(`│   ├─ File     : ${fmtBytes(srcSize)}`);
            console.log(`│   ├─ ID       : ${task.id}`);
            console.log(`│   └─ Slot     : ${this.activeJobs}/${this.maxConcurrency}`);
            console.log('│');

            const startTime = Date.now();

            let decryptKey: Buffer | null = null;
            if (meta.encLevel && meta.encLevel > 0) {
                if (!task.encryptionKey) throw new Error('Missing decryption key for encrypted video');
                decryptKey = Buffer.from(task.encryptionKey, 'hex');
            } else if (meta.isEncrypted) {
                // backward compat
                if (!task.encryptionKey) throw new Error('Missing decryption key for encrypted video');
                decryptKey = Buffer.from(task.encryptionKey, 'hex');
            }

            rawTmp  = path.join(TMP_DIR, `${task.id}_raw.mp4`);
            normTmp = path.join(TMP_DIR, `${task.id}_norm.mp4`);


            // ── Step 1: Decrypt ───────────────────────────────────────────────
            const endDecrypt = stepTimer('Step 1/5  Decrypt to temp');
            if (decryptKey) {
                const decipher = getDecipherAtOffset(decryptKey, nonce, 0);
                await pipeline(fs.createReadStream(dp), decipher, fs.createWriteStream(rawTmp));
            } else {
                await fs.copy(dp, rawTmp);
            }
            endDecrypt();

            const rawStats = await fs.stat(rawTmp);
            if (rawStats.size < 100_000) throw new Error('Raw file too small (corrupt or incomplete)');

            // ── Step 2: Normalize / transcode ─────────────────────────────────
            const isMKV = task.originalName.toLowerCase().endsWith('.mkv');
            const method = isMKV ? caps.encoder.toUpperCase() : 'Remux (Copy)';
            const modeLabel = isMKV ? `Full transcode (MKV→MP4) [Method: ${method}]` : 'Remux (copy + faststart) [Method: Instant]';
            console.log(`  ├─ Step 2/5  ${modeLabel}`);


            const normStart = Date.now();
            await normalizeVideo(rawTmp, normTmp, isMKV);
            const normMs    = Date.now() - normStart;
            const normStats = await fs.stat(normTmp);
            
            if (normStats.size < 100_000) throw new Error('Normalized output too small (corrupt)');
            console.log(`  │   └─ Step complete (${fmtMs(normMs)})  ${fmtBytes(rawStats.size)} → ${fmtBytes(normStats.size)}`);


            // ── Step 3: Probe duration ────────────────────────────────────────
            const endProbe = stepTimer('Step 3/5  Probe duration');
            const duration = await getVideoDuration(normTmp);
            endProbe();
            if (!duration || duration <= 0) throw new Error('Invalid duration after normalization');
            console.log(`  │   └─ ${fmtDur(duration)}`);

            // ── Step 4: Re-encrypt back to vault ──────────────────────────────
            const endEnc  = stepTimer('Step 4/5  Re-encrypt to vault');
            const newNonce = crypto.randomBytes(16);
            if (decryptKey) {
                const encryptor = getCipherAtOffset(decryptKey, newNonce, 0);
                await pipeline(fs.createReadStream(normTmp), encryptor, fs.createWriteStream(dp));
            } else {
                await fs.copy(normTmp, dp);
            }
            endEnc();

            // ── Step 5: Update meta + rebuild HLS index ───────────────────────
            const endIdx  = stepTimer('Step 5/5  Rebuild HLS index');
            const outSize = (await fs.stat(dp)).size;
            meta.nonce    = newNonce.toString('base64');
            meta.size     = outSize;
            meta.duration = duration;
            meta.status   = 'ready';
            meta.type     = 'video/mp4';
            await saveMeta(task.folder, meta);

            const offsets = await indexMoofOffsets(dp, newNonce, decryptKey);

            await fs.writeJson(path.join(task.folder, 'hls_index.json'), offsets);
            evictHLSCache(task.id);
            endIdx();
            console.log(`  │   └─ ${offsets.length} segments`);

            // ── Completion summary ────────────────────────────────────────────
            const totalMs = Date.now() - jobStart;
            console.log('│');
            console.log(`└─ ✅  COMPLETE  "${task.originalName}"`);
            console.log(`   ├─ Video    : ${fmtDur(duration)}`);
            console.log(`   ├─ Output   : ${fmtBytes(outSize)}`);
            console.log(`   ├─ Segments : ${offsets.length}`);
            console.log(`   └─ Time     : ${fmtMs(totalMs)}`);
            console.log('');

        } catch (err: any) {
            const totalMs = Date.now() - jobStart;
            console.log('│');
            console.log(`└─ ❌  FAILED  "${task.originalName}"  (after ${fmtMs(totalMs)})`);
            console.log(`   └─ ${err.message}`);
            console.log('');
            try {
                const meta  = await getMeta(task.folder);
                meta.status = 'error';
                await saveMeta(task.folder, meta);
            } catch { /* best effort */ }

        } finally {
            if (rawTmp  && await fs.pathExists(rawTmp))  await fs.remove(rawTmp);
            if (normTmp && await fs.pathExists(normTmp)) await fs.remove(normTmp);
        }
    }
}

export const repairQueue = new BackgroundQueue();
