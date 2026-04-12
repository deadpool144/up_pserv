import crypto from 'crypto';

/**
 * AES-256-CTR cipher at a specific byte offset (symmetric — works for both
 * encryption and decryption because CTR XOR is self-inverse).
 */
export function getCipherAtOffset(key: Buffer, nonce: Buffer, offset: number) {
    const hexNonce = nonce.toString('hex');
    const intNonce = BigInt('0x' + hexNonce);
    const blockOffset = BigInt(Math.floor(offset / 16));
    const newCounterInt = (intNonce + blockOffset) % (BigInt(1) << BigInt(128));
    const newNonceHex = newCounterInt.toString(16).padStart(32, '0');
    const newNonce = Buffer.from(newNonceHex, 'hex');

    const cipher = crypto.createDecipheriv('aes-256-ctr', key, newNonce);

    const remainder = offset % 16;
    if (remainder > 0) {
        cipher.update(Buffer.alloc(remainder));
    }
    return cipher;
}

/** sha256(accessKey) — the vault master key (Level 1) */
export function getAesKey(secret: string): Buffer {
    return crypto.createHash('sha256').update(secret).digest();
}

/** sha256(serverSecret + userKey) — the personal derived key (Level 2) */
export function deriveFinalKey(serverSecret: string, userKey: string): Buffer {
    return crypto.createHash('sha256').update(serverSecret + userKey).digest();
}

/** 
 * Generates a public fingerprint (ID) for a user key. 
 * Used to isolate files between different personal keys without storing the key itself.
 */
export function getUserKeyId(serverSecret: string, userKey: string): string | null {
    if (!userKey) return null;
    // We use a secondary hash of the derived key to act as a public ID
    const derived = deriveFinalKey(serverSecret, userKey);
    return crypto.createHash('sha256').update(derived).digest('hex').slice(0, 16);
}

export function processChunk(data: Buffer, key: Buffer, nonce: Buffer, offset: number): Buffer {
    const cipher = getCipherAtOffset(key, nonce, offset);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

export const getDecipherAtOffset = getCipherAtOffset;

// ── Encryption tier constants ────────────────────────────────────────────────
/** Level 0: no encryption (plaintext). Used for audio. */
export const ENC_NONE  = 0 as const;
/** Level 1: master-key encrypted. Accessible to all authenticated users. */
export const ENC_VAULT = 1 as const;
/** Level 2: personal-key encrypted. Requires userKey at login. */
export const ENC_USER  = 2 as const;

/**
 * Resolve the decryption key for a vault item based on its encLevel.
 *
 * @param encLevel  The encLevel stored in meta.json (0 | 1 | 2 | undefined)
 * @param isEncrypted  Legacy field (pre-encLevel era)
 * @param masterKey  The pre-computed master KEY_BUFFER (sha256(ACCESS_KEY))
 * @param secretKey  The SECRET_KEY string (from config)
 * @param userKey    The session userKey (empty string if not supplied)
 * @returns  The decryption Buffer, or null for plaintext
 */
export function resolveDecryptKey(
    encLevel: 0 | 1 | 2 | undefined,
    isEncrypted: boolean | undefined,
    masterKey: Buffer,
    secretKey: string,
    userKey: string
): Buffer | null {
    // Explicit encLevel takes precedence
    if (encLevel === 0) return null;                          // plaintext
    if (encLevel === 1) return masterKey;                     // master key
    if (encLevel === 2) return deriveFinalKey(secretKey, userKey); // personal key

    // ── Backward compatibility (no encLevel in old meta) ──────────────────
    // isEncrypted === true  → old dual-key file (derives key)
    // isEncrypted === false → explicitly unencrypted (old audio)
    // isEncrypted === undefined → old file encrypted with master key only
    if (isEncrypted === true)    return deriveFinalKey(secretKey, userKey);
    if (isEncrypted === false)   return null;
    return masterKey; // undefined → level 1 compat
}

