/**
 * Detail shard routing, shared by the site build (scripts/build-site-data.mjs)
 * and the SPA (src/hooks/useJobs.js). Both sides MUST use this one function so a
 * job id always maps to the same shard. FNV-1a, 32 bit, over UTF-16 code units.
 */
export function jobShardIndex(id, shardCount) {
  let h = 0x811c9dc5
  const s = String(id)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % shardCount
}

/** Two-digit-or-more zero-padded hex key for a shard index (file name stem). */
export function shardKey(index, shardCount) {
  const width = Math.max(2, (shardCount - 1).toString(16).length)
  return index.toString(16).padStart(width, '0')
}
