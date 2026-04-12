import fs from 'fs-extra';
import path from 'path';
import { VAULT_DIR, TMP_DIR, ACCESS_KEY } from './config.js';
import { isVaultItem, getMeta, saveMeta, vaultDataPath, indexMoofOffsets } from './storage.js';
import { getVideoMetadata } from './media.js';
import { getAesKey, getDecipherAtOffset } from './crypto.js'; // 🔥 FIX

const KEY_BUFFER = getAesKey(ACCESS_KEY);

async function fix() {
    console.log("--- Starting HLS Duration Fix ---");

    const videoDir = path.join(VAULT_DIR, "videos");
    if (!(await fs.pathExists(videoDir))) {
        console.log("No videos folder found.");
        return;
    }

    const entries = await fs.readdir(videoDir);

    for (const id of entries) {
        const p = path.join(videoDir, id);

        if (!(await isVaultItem(p))) continue;

        let rawTmp: string | null = null;

        try {
            const meta = await getMeta(p);
            const dp = vaultDataPath(p);

            if (meta.duration && meta.duration > 0) {
                console.log(`[Skip] ${meta.original}`);
                continue;
            }

            console.log(`[Probing] ${meta.original} (${id})...`);

            const nonce = Buffer.from(meta.nonce, 'base64');
            rawTmp = path.join(TMP_DIR, `${id}_probe.mp4`);

            await fs.ensureDir(TMP_DIR);
            if (!rawTmp) throw new Error("Failed to generate temp path");

            // 🔥 FIX: proper decryption
            const decipher = getDecipherAtOffset(KEY_BUFFER, nonce, 0);

            await new Promise<void>((resolve, reject) => {
                const readStream = fs.createReadStream(dp);
                const writeStream = fs.createWriteStream(rawTmp as string);

                readStream
                    .pipe(decipher)
                    .pipe(writeStream)
                    .on('finish', resolve)
                    .on('error', reject);

                readStream.on('error', reject);
            });

            // 🔥 Timeout protection (important)
            const { duration, fps, timescale } = await Promise.race([
                getVideoMetadata(rawTmp),
                new Promise<any>((_, reject) =>
                    setTimeout(() => reject(new Error("FFprobe timeout")), 15000)
                )
            ]);

            if (!duration || duration <= 0) {
                throw new Error("Invalid duration detected");
            }

            meta.duration = duration;
            meta.fps = fps;
            meta.timescale = timescale;
            await saveMeta(p, meta);

            console.log(`[Success] ${meta.original} → ${duration.toFixed(2)}s`);

            // 🔥 Rebuild index
            const fragments = await indexMoofOffsets(dp, nonce, KEY_BUFFER);
            await fs.writeJson(path.join(p, "hls_index.json"), fragments);
            
            console.log(`[Index] ${fragments.length} segments`);

        } catch (err: any) {
            console.error(`[Error] ${id}:`, err?.message || err);

        } finally {
            // 🔥 ALWAYS cleanup
            if (rawTmp && await fs.pathExists(rawTmp)) {
                await fs.remove(rawTmp);
            }
        }
    }

    console.log("--- Sync Complete ---");
}

fix().catch(console.error);
