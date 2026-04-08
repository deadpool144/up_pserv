/**
 * hwdetect.ts
 * 
 * Probes available FFmpeg hardware encoders ONCE at startup.
 * Detection order: NVENC (NVIDIA) → QSV (Intel iGPU) → CPU (libx264, all threads)
 * 
 * Compatible with everything from GT 210 / i3-2100 to modern iGPU / discrete GPU.
 */

import { spawnSync } from 'child_process';
import os from 'os';
// @ts-ignore
import ffmpegStatic from 'ffmpeg-static';

export type HWEncoder = 'nvenc' | 'qsv' | 'cpu';

export interface HWCapabilities {
    encoder: HWEncoder;
    threads: number;          // Number of logical CPU threads to give FFmpeg
    concurrency: number;      // Max parallel transcode jobs
    isLowEnd: boolean;        // True if ≤4 logical threads (applies conservative settings)
    ffmpegPath: string;
}

let _caps: HWCapabilities | null = null;

/** Returns cached capability detection result. Call once at startup. */
export function getHWCaps(): HWCapabilities {
    if (_caps) return _caps;
    throw new Error('[HWDetect] Not initialized. Call detectHW() first.');
}

/**
 * Runs hardware detection. Safe to call at any time; subsequent calls are no-ops.
 */
export async function detectHW(): Promise<HWCapabilities> {
    if (_caps) return _caps;

    const ffmpegPath: string = (ffmpegStatic as any)?.default ?? ffmpegStatic ?? 'ffmpeg';
    const cpuCount = os.cpus().length; // Logical threads (hyperthreading counted)
    const isLowEnd = cpuCount <= 4;    // i3-2100 has 2 cores / 4 threads

    // ── Local-network tuned concurrency ──────────────────────────────────────
    // At most 2 users simultaneously. Cap transcode jobs accordingly:
    // Low-end (≤4 threads):  1 job   — protect system responsiveness
    // Mid (5-8 threads):     2 jobs  — handles 2 users concurrently
    // High (9+ threads):     2 jobs  — still cap at 2 for local LAN use case
    const concurrency = isLowEnd ? 1 : 2;

    // Threads to give FFmpeg: leave 1 thread for Node/Express, use the rest
    const threads = Math.max(1, cpuCount - 1);

    console.log(`[HWDetect] CPU: ${cpuCount} logical threads | Low-end: ${isLowEnd} | Concurrency: ${concurrency}`);

    // ── Test NVENC (NVIDIA) ──────────────────────────────────────────────────
    if (testEncoder(ffmpegPath, 'h264_nvenc')) {
        console.log('[HWDetect] ✅ NVIDIA NVENC detected — using GPU encoder');
        _caps = { encoder: 'nvenc', threads, concurrency, isLowEnd, ffmpegPath };
        return _caps;
    }

    // ── Test QSV (Intel iGPU) ────────────────────────────────────────────────
    if (testEncoder(ffmpegPath, 'h264_qsv')) {
        console.log('[HWDetect] ✅ Intel QSV detected — using iGPU encoder');
        _caps = { encoder: 'qsv', threads, concurrency, isLowEnd, ffmpegPath };
        return _caps;
    }

    // ── CPU fallback (libx264 with all threads) ───────────────────────────────
    console.log(`[HWDetect] ℹ️  No GPU encoder available — using CPU (libx264, ${threads} threads)`);
    _caps = { encoder: 'cpu', threads, concurrency, isLowEnd, ffmpegPath };
    return _caps;
}

/**
 * Tests if a specific FFmpeg encoder works by trying to encode 1 frame of black video
 * into /dev/null (Windows: NUL). Returns true if FFmpeg exits 0.
 */
function testEncoder(ffmpegPath: string, encoderName: string): boolean {
    try {
        const nullOut = process.platform === 'win32' ? 'NUL' : '/dev/null';

        const args = encoderName === 'h264_nvenc'
            ? [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=black:s=128x128:r=1:d=0.1',
                '-c:v', 'h264_nvenc',
                '-frames:v', '1',
                '-f', 'null', nullOut
              ]
            : encoderName === 'h264_qsv'
            ? [
                '-hide_banner', '-loglevel', 'error',
                '-init_hw_device', 'qsv=qsv:hw',
                '-filter_hw_device', 'qsv',
                '-f', 'lavfi', '-i', 'color=black:s=128x128:r=1:d=0.1',
                '-vf', 'hwupload=extra_hw_frames=64,format=qsv',
                '-c:v', 'h264_qsv',
                '-frames:v', '1',
                '-f', 'null', nullOut
              ]
            : [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=black:s=128x128:r=1:d=0.1',
                '-c:v', encoderName,
                '-frames:v', '1',
                '-f', 'null', nullOut
              ];

        const result = spawnSync(ffmpegPath, args, {
            timeout: 8000, // 8s max for init; HDD + old GPU can be slow
            stdio: 'pipe'
        });

        return result.status === 0;
    } catch {
        return false;
    }
}
