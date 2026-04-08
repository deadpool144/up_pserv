import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import { PORT, FOLDERS, TMP_DIR } from './config.js';
import routes from './routes.js';
import fs from 'fs-extra';
import { detectHW } from './hwdetect.js';

const app = express();

// Initialize required directories sequentially to avoid races
async function initDirs() {
    for (const dirPath of Object.values(FOLDERS)) {
        await fs.ensureDir(dirPath as string);
    }
}
initDirs().catch(err => console.error('[Fatal] Directory init failed:', err));


// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Safety: catch malformed JSON before it crashes the process
app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('[Safety] Malformed JSON blocked');
        return res.status(400).json({ error: 'Malformed JSON' });
    }
    next();
});

// File uploads: 2GB limit, temp files for large uploads
app.use(fileUpload({
    limits: { fileSize: 2000 * 1024 * 1024 },
    useTempFiles : true,
    tempFileDir  : TMP_DIR,
    debug        : false,
    preserveExtension: true,
    abortOnLimit : true,
    uploadTimeout: 0,        // no timeout on individual chunk receive
    createParentPath: true,
}));

// Keep-alive tuning — improves throughput for local LAN multi-user use
app.use((_req, res, next) => {
    res.setHeader('Connection', 'keep-alive');
    next();
});

// API Routes
app.use('/api', routes);

// ── Startup ───────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n[Server] ════════════════════════════════════════════`);
    console.log(`[Server] SecurVault Media Server`);
    console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
    console.log(`[Server] ════════════════════════════════════════════`);

    // 1. Detect hardware capabilities (NVENC → QSV → CPU)
    try {
        console.log('[Server] Detecting hardware encoder...');
        const caps = await detectHW();
        console.log(`[Server] Encoder    : ${caps.encoder.toUpperCase()}`);
        console.log(`[Server] CPU Threads: ${caps.threads} (${caps.isLowEnd ? 'low-end' : 'mid/high-end'} mode)`);
        console.log(`[Server] Queue Jobs : ${caps.concurrency} concurrent (local LAN: 2-user optimized)`);
    } catch (hwErr) {
        console.error('[Server] HW detection failed (will default to CPU):', hwErr);
    }

    // 2. Re-queue any videos interrupted by a previous crash/restart
    try {
        const { repairQueue } = await import('./queue.js');
        console.log('[Queue] Scanning interrupted tasks...');
        await repairQueue.requeuePendingTasks();
        console.log('[Queue] Scan complete');
    } catch (err) {
        console.error('[Server] Failed to start repair queue:', err);
    }

    console.log('[Server] Ready ✅\n');
}); 


// ── Global Error Handling ───────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n[Fatal] Unhandled Rejection at:', promise, '\nReason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('\n[Fatal] Uncaught Exception:', err);
    process.exit(1);
});

// Keep-alive and timeout tuning for local LAN
server.keepAliveTimeout = 120_000;
server.headersTimeout   = 125_000;
server.requestTimeout   = 300_000;

