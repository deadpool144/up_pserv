/**
 * media.ts
 * 
 * Adaptive transcoding engine.
 * - Encoder priority: NVENC → QSV → CPU (libx264, all threads)
 * - HDD-friendly: tuned probesize/analyzeduration, 256KB read chunks
 * - Low-end safe: ultrafast preset, thread-count from hwdetect
 * - Stderr monitoring for GPU init failures (not just exit codes)
 */

import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'stream';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
// @ts-ignore
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { getAesKey, getCipherAtOffset } from './crypto.js';
import { ACCESS_KEY, THUMBNAIL_DIR, CPU_THREADS, KEY_BUFFER } from './config.js';
import { getHWCaps } from './hwdetect.js';

const ffBin = (typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.path) as string;

if (ffBin) {
    ffmpeg.setFfmpegPath(ffBin);
}
if (ffprobeStatic) {
    const p = typeof ffprobeStatic === 'string' ? ffprobeStatic : (ffprobeStatic as any).path;
    if (p) ffmpeg.setFfprobePath(p);
}


// ── Read-stream tuning ────────────────────────────────────────────────────────
// 256KB chunks are more efficient on HDDs than the default 64KB
const READ_HWM = 256 * 1024;

// ── GPU error keywords detected in FFmpeg stderr ──────────────────────────────
const GPU_INIT_ERRORS = [
    'Cannot load', 'MFXInit', 'Error initializing', 'No device',
    'out of memory', 'CUDA error', 'not supported', 'device busy'
];

function isGPUInitError(msg: string): boolean {
    return GPU_INIT_ERRORS.some(e => msg.toLowerCase().includes(e.toLowerCase()));
}

// ── Parse HH:MM:SS.mmm → seconds ────────────────────────────────────────────
function parseFFmpegTime(t: string): number {
    const parts = t.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

// ── Shared FFmpeg runner with real-time progress ──────────────────────────────
function runFFmpeg(
    ffmpegBin: string,
    args: string[],
    totalDuration?: number,   // seconds — enables % + ETA display
    mode: string = 'ffmpeg'   // e.g. 'QSV', 'NVENC', 'CPU', 'Remux'
): Promise<void> {
    return new Promise((resolve, reject) => {
        const shortArgs = args.slice(0, 6).join(' ');
        console.log(`  │   [${mode}] ${shortArgs} ...`);


        // Add -progress pipe:2 so FFmpeg emits key=value progress lines
        const fullArgs = ['-progress', 'pipe:2', '-nostats', ...args];
        const proc = spawn(ffmpegBin, fullArgs, { stdio: ['ignore', 'ignore', 'pipe'] });

        const runStart = Date.now();
        let currentTime = 0;
        let lastPrint   = 0;
        let speed       = 0;
        let stderrBuf   = '';

        proc.stderr.on('data', (d: Buffer) => {
            stderrBuf += d.toString();
            const lines = stderrBuf.split('\n');
            stderrBuf   = lines.pop() ?? '';   // keep incomplete last line

            for (const line of lines) {
                const l = line.trim();

                // -progress key=value pairs
                if (l.startsWith('out_time=')) {
                    const t = l.split('=')[1];
                    currentTime = parseFFmpegTime(t);
                } else if (l.startsWith('speed=')) {
                    speed = parseFloat(l.split('=')[1]) || 0;
                }

                // Legacy stderr progress line e.g. "frame= 123 fps=45 ... time=00:01:23"
                if (l.includes('time=') && l.includes('speed=')) {
                    const tm = l.match(/time=(\d+:\d+:\d+\.?\d*)/);
                    const sp = l.match(/speed=\s*([\d.]+)x/);
                    if (tm) currentTime = parseFFmpegTime(tm[1]);
                    if (sp) speed = parseFloat(sp[1]);
                }

                // GPU errors
                if (isGPUInitError(l)) {
                    console.warn(`\n  │   [GPU] ${l.trim()}`);
                }
            }

            // Print a live progress line (throttled to every 5 seconds)
            const now = Date.now();
            if (now - lastPrint >= 5000 && currentTime > 0) {
                lastPrint = now;
                const elapsed = (now - runStart) / 1000;
                let logLine: string;

                if (totalDuration && totalDuration > 0) {
                    const pct = Math.min(100, (currentTime / totalDuration) * 100).toFixed(1);
                    const remaining = speed > 0
                        ? ((totalDuration - currentTime) / speed)
                        : 0;
                    const eta = remaining > 0
                        ? ` ETA ${remaining < 60 ? Math.round(remaining) + 's' : (remaining / 60).toFixed(1) + 'm'}`
                        : '';
                    logLine = `  │   ${pct.padStart(5)}%  pos=${currentTime.toFixed(1)}s  speed=${speed.toFixed(1)}x  elapsed=${Math.round(elapsed)}s${eta}`;
                } else {
                    logLine = `  │   pos=${currentTime.toFixed(1)}s  speed=${speed.toFixed(1)}x  elapsed=${Math.round(elapsed)}s`;
                }

                // Standard log for stability (prevents vanishing on Windows)
                console.log(logLine);
            }

        });

        proc.on('error', (err) => {
            console.error('\n  │   [FFmpeg Process Error]', err);
            reject(err);
        });

        proc.on('close', (code) => {
            const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
            
            // No \r cleanup needed as we use console.log


            if (code === 0) {
                console.log(`  │   └─ FFmpeg finished in ${elapsed}s`);
                resolve();
            } else {
                reject(new Error(`FFmpeg exited with code ${code} after ${elapsed}s`));
            }
        });
    });
}



// ── Build encoder args for each backend ──────────────────────────────────────
function buildNVENCArgs(inputPath: string, outputPath: string): string[] {
    return [
        '-hwaccel', 'cuda',
        '-hwaccel_output_format', 'cuda',
        '-i', inputPath,
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',           // NVENC p1=fastest … p7=best quality; p4 is balanced
        '-rc', 'vbr',
        '-cq', '24',
        '-b:v', '0',
        '-maxrate', '3M',
        '-bufsize', '6M',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-map', '0:v:0?', '-map', '0:a:0?', '-sn',
        '-pix_fmt', 'yuv420p',
        '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
        '-f', 'mp4', '-y', outputPath
    ];
}

function buildQSVArgs(inputPath: string, outputPath: string): string[] {
    return [
        '-init_hw_device', 'qsv=qsv:hw',
        '-filter_hw_device', 'qsv',
        '-hwaccel', 'qsv',
        '-hwaccel_output_format', 'qsv',
        '-i', inputPath,
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-global_quality', '22',
        '-look_ahead', '0',
        '-vf', 'vpp_qsv=format=nv12',    // Ensure hardware surface is NV12 (optimal for QSV enc)
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-map', '0:v:0?', '-map', '0:a:0?', '-sn',
        '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
        '-f', 'mp4', '-y', outputPath
    ];
}

function buildCPUArgs(inputPath: string, outputPath: string, threads: number): string[] {
    return [
        '-threads', String(threads),    // Use all logical CPU threads
        '-i', inputPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',         // Fastest encode; fine for local streaming
        '-crf', '24',
        '-tune', 'fastdecode',          // Optimise output for low-end client decoding
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-map', '0:v:0?', '-map', '0:a:0?', '-sn',
        '-pix_fmt', 'yuv420p',
        '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
        '-f', 'mp4', '-y', outputPath
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export async function generateThumbnail(filePath: string | Readable, id: string, type: string, encKey: Buffer | null = null) {
    const outPath = path.join(THUMBNAIL_DIR, id);
    await fs.ensureDir(THUMBNAIL_DIR);

    let thumbBuffer: Buffer;

    try {
        if (type.startsWith('image/')) {
            if (typeof filePath === 'string') {
                thumbBuffer = await sharp(filePath)
                    .resize(400, 400, { fit: 'cover', position: 'center' })
                    .jpeg({ quality: 80 })
                    .toBuffer();
            } else {
                const transformer = sharp()
                    .resize(400, 400, { fit: 'cover', position: 'center' })
                    .jpeg({ quality: 80 });
                filePath.pipe(transformer);
                thumbBuffer = await transformer.toBuffer();
            }
        } else if (type.startsWith('video/') || type.startsWith('audio/')) {
            const tmpFile = path.join(THUMBNAIL_DIR, `${id}_tmp.jpg`);
            const mediaTmp = path.join(THUMBNAIL_DIR, `${id}_m.tmp`);

            if (typeof filePath !== 'string') {
                const writeStream = fs.createWriteStream(mediaTmp);
                filePath.pipe(writeStream);
                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                });
            }

            const ffmpegInput = typeof filePath === 'string' ? filePath : mediaTmp;

            await new Promise<void>((resolve, reject) => {
                const cmd = ffmpeg(ffmpegInput);

                if (type.startsWith('audio/')) {
                    cmd.output(tmpFile)
                       .frames(1)
                       .on('end', () => resolve())
                       .on('error', (err) => {
                           console.warn(`[Media] Audio cover extraction failed for ${id}: ${err.message}`);
                           resolve();
                       })
                       .run();
                } else {
                    cmd.on('error', (err) => reject(err))
                       .on('end', () => resolve())
                       .screenshots({
                           count: 1,
                           timestamps: ['1'],
                           filename: path.basename(tmpFile),
                           folder: path.dirname(tmpFile),
                           size: '400x?'
                       });
                }
            });

            if (await fs.pathExists(tmpFile)) {
                thumbBuffer = await fs.readFile(tmpFile);
                await fs.remove(tmpFile);
            } else {
                if (type.startsWith('audio/')) {
                    if (fs.existsSync(mediaTmp)) await fs.remove(mediaTmp);
                    return;
                }
                throw new Error('FFmpeg finished but no thumbnail was created.');
            }

            if (fs.existsSync(mediaTmp)) await fs.remove(mediaTmp);
        } else {
            return;
        }

        if (!encKey) {
            // Level 0: Write standard plaintext JPEG
            await fs.writeFile(outPath, thumbBuffer!);
        } else {
            // Level 1/2: Write encrypted packet (nonce + ciphertext)
            const nonce = crypto.randomBytes(16);
            const cipher = getCipherAtOffset(encKey, nonce, 0);
            const encrypted = Buffer.concat([cipher.update(thumbBuffer!), cipher.final()]);
            await fs.writeFile(outPath, Buffer.concat([nonce, encrypted]));
        }
    } catch (err: any) {
        console.error(`[Media] Thumbnail generation failed for ${id}:`, err?.message || err);
        throw err; // Re-throw so storage.ts can detect failure
    } finally {
        // Ensure all possible temp files are scrubbed
        const mediaTmp = path.join(THUMBNAIL_DIR, `${id}_m.tmp`);
        const imageTmp = path.join(THUMBNAIL_DIR, `${id}_tmp.jpg`);
        try {
            if (fs.existsSync(mediaTmp)) fs.removeSync(mediaTmp);
            if (fs.existsSync(imageTmp)) fs.removeSync(imageTmp);
        } catch (scErr) {
            // Non-fatal cleanup error
        }
    }
}

/**
 * Normalizes a video for smooth HLS streaming.
 * If forceTranscode=true: tries best available GPU encoder, falls back down the chain.
 * If forceTranscode=false: fast remux only (copy streams + faststart).
 */
export async function normalizeVideo(
    inputPath: string,
    outputPath: string,
    forceTranscode: boolean = false
): Promise<void> {
    const ffBin = (typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.path) as string;
    if (!ffBin) throw new Error('FFmpeg path not found');

    // Quick-probe source duration so runFFmpeg can show % + ETA
    let srcDuration: number | undefined;
    try { srcDuration = (await getVideoMetadata(inputPath)).duration; } catch { /* non-fatal */ }

    if (!forceTranscode) {
        // Fast path: remux with faststart, no re-encode
        await runFFmpeg(ffBin, [
            '-i', inputPath,
            '-c', 'copy',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
            '-f', 'mp4', '-y', outputPath
        ], srcDuration, 'Remux');
        return;
    }


    // ── Full transcode: try each encoder in order ─────────────────────────────
    const caps = getHWCaps();

    // 1. NVENC
    if (caps.encoder === 'nvenc') {
        try {
            console.log('  │   [Transcode] Attempting NVENC...');
            if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
            await runFFmpeg(ffBin, buildNVENCArgs(inputPath, outputPath), srcDuration, 'NVENC');

            const { size } = await fs.stat(outputPath);
            if (size > 100 * 1024) {
                console.log(`  │   ✅ NVENC OK (${(size/1024/1024).toFixed(1)} MB)`);
                return;
            }
            console.warn('  │   NVENC output too small, falling through...');
        } catch (e: any) {
            console.warn(`  │   NVENC failed: ${e.message?.slice(0, 120)}`);
        }
    }

    // 2. QSV
    if (caps.encoder === 'nvenc' || caps.encoder === 'qsv') {
        try {
            console.log('  │   [Transcode] Attempting QSV...');
            if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
            await runFFmpeg(ffBin, buildQSVArgs(inputPath, outputPath), srcDuration, 'QSV');

            const { size } = await fs.stat(outputPath);
            if (size > 100 * 1024) {
                console.log(`  │   ✅ QSV OK (${(size/1024/1024).toFixed(1)} MB)`);
                return;
            }
            console.warn('  │   QSV output too small, falling to CPU...');
        } catch (e: any) {
            console.warn(`  │   QSV failed: ${e.message?.slice(0, 120)}`);
        }
    }

    // 3. CPU fallback — always available
    console.log(`  │   [Transcode] CPU fallback (${caps.threads} threads)...`);
    if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
    await runFFmpeg(ffBin, buildCPUArgs(inputPath, outputPath, caps.threads), srcDuration, 'CPU');

    const { size } = await fs.stat(outputPath);
    if (size < 100 * 1024) throw new Error('CPU transcode failed: output too small');
    console.log(`  │   ✅ CPU OK (${(size/1024/1024).toFixed(1)} MB)`);
}


/**
 * Probes video duration using ffprobe (async, non-blocking).
 */
export interface VideoMetadata {
    duration: number;
    fps: number;
    timescale: number;
}

export async function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
    const { spawnSync } = await import('child_process');
    const p = typeof ffprobeStatic === 'string' ? ffprobeStatic : (ffprobeStatic as any).path;
    if (!p) throw new Error('ffprobe path not found');

    const runProbe = (args: string[]) => {
        const result = spawnSync(p, args, { encoding: 'utf8', timeout: 30000 });
        if (result.status !== 0) return null;
        try { return JSON.parse(result.stdout); } catch { return null; }
    };

    // Fast probe (works for most files)
    let data = runProbe(['-v', 'quiet', '-print_format', 'json',
                         '-show_format', '-show_streams', inputPath]);

    // Deep scan fallback (MKV, TS, etc. with missing headers)
    if (!data || !(data.format?.duration || data.streams?.some((s: any) => s.duration))) {
        console.log(`[Probe] Fast probe failed, deep scan for ${path.basename(inputPath)}...`);
        data = runProbe([
            '-v', 'quiet', '-print_format', 'json',
            '-show_format', '-show_streams',
            '-probesize', '50M',
            '-analyze_duration', '50M',
            inputPath
        ]);
    }

    if (!data) return { duration: 0, fps: 23.976, timescale: 90000 };

    const formatDur = parseFloat(data.format?.duration || '0');
    let maxStreamDur = 0;
    let fps = 23.976;
    let timescale = 90000;

    for (const s of (data.streams || [])) {
        if (s.duration) {
            const sd = parseFloat(s.duration);
            if (sd > maxStreamDur) maxStreamDur = sd;
        }
        // Extract frame rate and timescale (time_base) from video stream
        if (s.codec_type === 'video') {
            if (s.avg_frame_rate) {
                const [num, den] = s.avg_frame_rate.split('/').map(Number);
                if (num && den) {
                    const calculated = num / den;
                    if (calculated > 0) fps = calculated;
                }
            }
            if (s.time_base) {
                const [num, den] = s.time_base.split('/').map(Number);
                // In MP4, timescale is the denominator of time_base (e.g. 1/30000)
                if (den && den > 0) timescale = den;
            }
        }
    }

    const finalDur = Math.max(formatDur, maxStreamDur);
    console.log(`[Probe] Duration: ${finalDur.toFixed(2)}s, FPS: ${fps.toFixed(3)}, Timescale: ${timescale}`);
    return { duration: finalDur, fps, timescale };
}

/**
 * Identifies subtitle tracks in a video file.
 */
export async function getSubtitleTracks(inputPath: string): Promise<{index: number, label: string, lang: string}[]> {
    const { spawnSync } = await import('child_process');
    const p = typeof ffprobeStatic === 'string' ? ffprobeStatic : (ffprobeStatic as any).path;
    if (!p) throw new Error('ffprobe path not found');

    const result = spawnSync(p, [
        '-v', 'error',
        '-select_streams', 's',
        '-show_entries', 'stream=index,codec_name:stream_tags=label,language',
        '-of', 'json',
        inputPath
    ], { encoding: 'utf8' });

    if (result.status !== 0) return [];
    try {
        const data = JSON.parse(result.stdout);
        const incompatibleCodecs = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvbsub', 'xsub'];
        
        return (data.streams || [])
            .filter((s: any) => !incompatibleCodecs.includes(s.codec_name))
            .map((s: any) => ({
                index: s.index,
                label: s.tags?.label || `Track ${s.index}`,
                lang: s.tags?.language || 'und'
            }));
    } catch {
        return [];
    }
}

/**
 * Extracts a subtitle track to a WebVTT file.
 */
export async function extractSubtitle(inputPath: string, streamIndex: number, outputPath: string): Promise<void> {
    const ffBin = (typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.path) as string;
    if (!ffBin) throw new Error('FFmpeg path not found');

    // Convert to webvtt for browser compatibility
    const args = [
        '-i', inputPath,
        '-map', `0:${streamIndex}`,
        '-f', 'webvtt',
        '-y', outputPath
    ];

    await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffBin, args);
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Subtitle extraction failed with code ${code}`));
        });
        proc.on('error', reject);
    });
}

/**
 * Spawns a live FFmpeg process for on-the-fly streaming transcoding.
 * Automatically selects the best encoder. Falls back on stderr GPU errors.
 * Returns a ChildProcess: pipe data to stdin, read from stdout.
 */
export function spawnStreamProcessor(
    req: any,
    _useQSV: boolean = true,   // kept for API compat; ignored (auto-detected)
    inputOptions: string[] = []
): ChildProcessWithoutNullStreams {
    if (!ffmpegPath) throw new Error('FFmpeg not found');

    const caps = getHWCaps();
    const ffBin = (typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.path) as string;

    const baseInputArgs = [
        '-nostdin',
        '-loglevel', 'error',
        ...inputOptions,
        '-thread_queue_size', '512',    // Prevents stalls when reading from HDD/slow pipe
        '-probesize', '2M',             // Faster start; enough for most containers
        '-analyzeduration', '2M',
        '-fflags', '+genpts',           // Stabilize timestamps for live streams
        '-i', 'pipe:0'
    ];

    const outputArgs = [
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+separate_moof+omit_tfhd_offset',
        '-flush_packets', '1',
        'pipe:1'
    ];

    // Bitrate limits — conservative for local LAN
    const bitrateArgs = [
        '-maxrate', '2500k',
        '-bufsize', '5M',
        '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    ];

    const buildArgs = (videoArgs: string[]): string[] =>
        [...baseInputArgs, ...videoArgs, ...bitrateArgs, ...outputArgs];

    let ff: ChildProcessWithoutNullStreams;
    let gpuFailed = false;

    // ── Try GPU encoder first ─────────────────────────────────────────────────
    if (caps.encoder === 'nvenc') {
        console.log('[Stream] Spawning NVENC live transcode...');
        ff = spawn(ffBin, buildArgs([
            '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
            '-c:v', 'h264_nvenc', '-preset', 'p2', '-rc', 'vbr', '-cq', '28'
        ]));
    } else if (caps.encoder === 'qsv') {
        console.log('[Stream] Spawning QSV live transcode (Full HW Acc)...');
        ff = spawn(ffBin, buildArgs([
            '-init_hw_device', 'qsv=qsv:hw', '-filter_hw_device', 'qsv',
            '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv',
            '-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '28', 
            '-look_ahead', '0', '-vf', 'vpp_qsv=format=nv12'
        ]));
    } else {
        console.log(`[Stream] Spawning CPU live transcode (${caps.threads} threads)...`);
        ff = spawn(ffBin, buildArgs([
            '-threads', String(caps.threads),
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-tune', 'fastdecode'
        ]));
    }

    // ── Stderr monitor: detect GPU init failures and log errors ──────────────
    ff.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (isGPUInitError(msg) && !gpuFailed) {
            gpuFailed = true;
            console.error(`[Stream] GPU init error detected in stderr: ${msg.trim()}`);
            // Note: we can't restart mid-stream; client will reconnect and
            // hwdetect will pick CPU next time if detectHW() is called again.
        }
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('invalid')) {
            console.error('[Stream] FFmpeg stderr:', msg.trim());
        }
    });

    // ── Client disconnect → kill FFmpeg ──────────────────────────────────────
    req.on('close', () => {
        console.log('[Stream] Client disconnected → killing FFmpeg');
        ff.kill('SIGKILL');
    });

    // ── Broken pipe on stdout (normal on client exit) ─────────────────────────
    ff.stdout.on('error', (err: any) => {
        if (err.code === 'EPIPE') {
            console.log('[Stream] stdout EPIPE (client disconnected, normal)');
        } else {
            console.error('[Stream] stdout error:', err.message);
        }
        ff.kill('SIGKILL');
    });

    // ── Suppress stdin errors ─────────────────────────────────────────────────
    ff.stdin.on('error', () => {});

    // ── Log close code ────────────────────────────────────────────────────────
    ff.on('close', (code) => {
        const normal = code === 0 || code === null || code === 255 || code === -40;
        if (normal) {
            console.log('[Stream] FFmpeg closed normally (code:', code, ')');
        } else {
            console.error('[Stream] FFmpeg closed unexpectedly (code:', code, ')');
        }
    });

    return ff;
}

// Export the tuned read-stream HWM for use in routes
export const STREAM_HWM = READ_HWM;

/**
 * Extracts a thumbnail from a file already in the vault.
 * Useful for re-indexing or fallback after failed upload processing.
 */
export async function generateSafeThumbnail(
    vaultPath: string,
    nonce: string | Buffer,
    mimeType: string,
    id: string,
    encKey: Buffer | null
) {
    const nonceBuf = typeof nonce === 'string' ? Buffer.from(nonce, 'base64') : nonce;
    
    // Create a read stream that handles decryption on-the-fly if needed
    let readStream: Readable = fs.createReadStream(vaultPath);
    
    if (encKey) {
        const { getDecipherAtOffset } = await import('./crypto.js');
        const decipher = getDecipherAtOffset(encKey, nonceBuf, 0);
        const transform = new PassThrough();
        readStream.pipe(decipher).pipe(transform);
        readStream = transform as any;
    }

    await generateThumbnail(readStream, id, mimeType, encKey);
}
