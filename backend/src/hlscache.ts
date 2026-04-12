import { FragmentIndex } from './storage.js';

const _cache = new Map<string, (number | FragmentIndex)[]>();

export function getHLSIndexCached(id: string): (number | FragmentIndex)[] | undefined {
    return _cache.get(id);
}

export function setHLSIndexCached(id: string, offsets: (number | FragmentIndex)[]) {
    _cache.set(id, offsets);
}

export function evictHLSCache(id: string) {
    _cache.delete(id);
    console.log(`[HLSCache] Evicted cache for ${id}`);
}
