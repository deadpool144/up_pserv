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
import { ACCESS_KEY, THUMBNAIL_DIR, CPU_THREADS } from './config.js';
import { getHWCaps } from './hwdetect.js';

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath as any);
}
if (ffprobeStatic) {
    const p = typeof ffprobeStatic === 'string' ? ffprobeStatic : (ffprobeStatic as any).path;
    if (p) ffmpeg.setFfprobePath(p);
}

const KEY_BUFFER = getAesKey(ACCESS_KEY);

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

// ── Shared FFmpeg runner ──────────────────────────────────────────────────────
function runFFmpeg(ffmpegBin: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`[Transcode] ffmpeg ${args.slice(0, 6).join(' ')} ...`);
        const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

        const stderrChunks: string[] = [];
        proc.stderr.on('data', (d: Buffer) => {
            const msg = d.toString();
            stderrChunks.push(msg);
            // Log GPU init errors immediately
            if (isGPUInitError(msg)) {
                console.warn(`[Transcode] GPU stderr: ${msg.trim()}`);
            }
        });

        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                const stderr = stderrChunks.join('').slice(-800);
                reject(new Error(`FFmpeg exited ${code}: ${stderr}`));
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
        '-look_ahead', '0',        // Disable lookahead — saves RAM on low-end iGPU
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-map', '0:v:0?', '-map', '0:a:0?', '-sn',
        '-pix_fmt', 'yuv420p',
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

export async function generateThumbnail(filePath: string | Readable, id: string, type: string) {
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

        const nonce = crypto.randomBytes(16);
        const cipher = getCipherAtOffset(KEY_BUFFER, nonce, 0);
        const encrypted = Buffer.concat([cipher.update(thumbBuffer!), cipher.final()]);
        await fs.writeFile(outPath, Buffer.concat([nonce, encrypted]));
    } catch (err: any) {
        console.error(`[Media] Thumbnail failed for ${id}:`, err?.message || err);
    }
}

/**
 * Normalizes a video for smooth HLS streaming.
 * 
 * If forceTranscode=true: tries best available GPU encoder, falls back down the chain.
 * If forceTranscode=false: fast remux only (copy streams + faststart).
 */
export async function normalizeVideo(
    inputPath: string,
    outputPath: string,
    forceTranscode: boolean = false
): Promise<void> {
    const ffBin = ffmpegPath as string;
    if (!ffBin) throw new Error('FFmpeg path not found');

    if (!forceTranscode) {
        // Fast path: just remux with faststart, no re-encode
        await runFFmpeg(ffBin, [
            '-i', inputPath,
            '-c', 'copy',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
            '-f', 'mp4', '-y', outputPath
        ]);
        return;
    }

    // ── Full transcode: try each encoder in order ─────────────────────────────
    const caps = getHWCaps();

    // 1. NVENC
    if (caps.encoder === 'nvenc') {
        try {
            console.log('[Transcode] Attempting NVENC...');
            if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
            await runFFmpeg(ffBin, buildNVENCArgs(inputPath, outputPath));
            const { size } = await fs.stat(outputPath);
            if (size > 100 * 1024) {
                console.log(`[Transcode] ✅ NVENC OK (${Math.round(size / 1024 / 1024)}MB)`);
                return;
            }
            console.warn('[Transcode] NVENC output too small, falling through...');
        } catch (e: any) {
            console.warn(`[Transcode] NVENC failed: ${e.message?.slice(0, 200)}`);
        }
    }

    // 2. QSV
    if (caps.encoder === 'nvenc' || caps.encoder === 'qsv') {
        try {
            console.log('[Transcode] Attempting QSV...');
            if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
            await runFFmpeg(ffBin, buildQSVArgs(inputPath, outputPath));
            const { size } = await fs.stat(outputPath);
            if (size > 100 * 1024) {
                console.log(`[Transcode] ✅ QSV OK (${Math.round(size / 1024 / 1024)}MB)`);
                return;
            }
            console.warn('[Transcode] QSV output too small, falling to CPU...');
        } catch (e: any) {
            console.warn(`[Transcode] QSV failed: ${e.message?.slice(0, 200)}`);
        }
    }

    // 3. CPU fallback — always available
    console.log(`[Transcode] CPU fallback (${caps.threads} threads)...`);
    if (await fs.pathExists(outputPath)) await fs.remove(outputPath);
    await runFFmpeg(ffBin, buildCPUArgs(inputPath, outputPath, caps.threads));
    const { size } = await fs.stat(outputPath);
    if (size < 100 * 1024) throw new Error('CPU transcode failed: output too small');
    console.log(`[Transcode] ✅ CPU OK (${Math.round(size / 1024 / 1024)}MB)`);
}

/**
 * Probes video duration using ffprobe (async, non-blocking).
 */
export async function getVideoDuration(inputPath: string): Promise<number> {
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
            '-probesize', '50M',        // reduced from 100M to be politer on HDD
            '-analyze_duration', '50M',
            inputPath
        ]);
    }

    if (!data) return 0;

    const formatDur = parseFloat(data.format?.duration || '0');
    let maxStreamDur = 0;
    for (const s of (data.streams || [])) {
        if (s.duration) {
            const sd = parseFloat(s.duration);
            if (sd > maxStreamDur) maxStreamDur = sd;
        }
    }

    const finalDur = Math.max(formatDur, maxStreamDur);
    console.log(`[Probe] Duration: ${finalDur.toFixed(2)}s`);
    return finalDur;
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
    const ffBin = ffmpegPath as string;

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
        console.log('[Stream] Spawning QSV live transcode...');
        ff = spawn(ffBin, buildArgs([
            '-init_hw_device', 'qsv=qsv:hw', '-filter_hw_device', 'qsv',
            '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv',
            '-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '28', '-look_ahead', '0'
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
