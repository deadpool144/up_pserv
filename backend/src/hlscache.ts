/**
 * hlscache.ts
 * 
 * Shared in-memory HLS segment index cache.
 * Extracted to avoid circular imports between routes.ts and queue.ts.
 */

const _cache = new Map<string, number[]>();

export function getHLSIndexCached(id: string): number[] | undefined {
    return _cache.get(id);
}

export function setHLSIndexCached(id: string, offsets: number[]) {
    _cache.set(id, offsets);
}

export function evictHLSCache(id: string) {
    _cache.delete(id);
    // Log only in dev; comment out if logs are too noisy
    console.log(`[HLSCache] Evicted cache for ${id}`);
}
