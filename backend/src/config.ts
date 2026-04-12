import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ROOT_DIR = path.resolve(__dirname, '../../');

export const PORT = parseInt(process.env.PORT || '5001');
export const SECRET_KEY = process.env.SECRET_KEY || 'default_secret';
export const ACCESS_KEY = process.env.ACCESS_KEY || 'default_access';
export const TOKEN_TTL = parseInt(process.env.TOKEN_TTL || '86400'); // 24h

export const VAULT_DIR = process.env.VAULT_DIR || path.join(ROOT_DIR, 'vault');
export const PLAYLIST_FILE = path.join(VAULT_DIR, 'playlists.json');
export const THUMBNAIL_DIR = path.join(ROOT_DIR, 'thumbnails');
export const TMP_DIR = path.join(ROOT_DIR, 'temp');

export const FOLDERS = {
    vault: VAULT_DIR,
    thumbnails: THUMBNAIL_DIR,
    temp: TMP_DIR
};

// The Master Vault Key is derived from the SECRET_KEY.
// This decouples the LOGIN (ACCESS_KEY) from the ENCRYPTION (SECRET_KEY).
export const KEY_BUFFER = crypto.createHash('sha256').update(SECRET_KEY).digest();

/** Legacy key for thumbnails/files encrypted before the ACCESS_KEY -> SECRET_KEY split. */
export const LEGACY_KEY_BUFFER = crypto.createHash('sha256').update(ACCESS_KEY).digest();

// ── System tuning (auto-detected) ────────────────────────────────────────────
const _cpuLogical = os.cpus().length; // Hyperthreading-aware (e.g. i3-2100 = 4)
export const CPU_THREADS = Math.max(1, _cpuLogical - 1); // Reserve 1 for Node/Express
export const IS_LOW_END  = _cpuLogical <= 4;             // i3-2100, older Celerons etc.
// Local LAN: at most 2 concurrent users. Low-end gets 1 job to stay responsive.
export const QUEUE_CONCURRENCY = IS_LOW_END ? 1 : 2;
