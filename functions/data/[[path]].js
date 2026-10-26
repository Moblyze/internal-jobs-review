// Serves /data/* files that cannot ship as static Pages assets from the private
// R2 bucket: people-data and anything over Pages' 25 MiB per-file limit.
// Everything else under /data/ falls through to static assets (next()).
// The whole hostname sits behind Cloudflare Access, so this is never public.
//
// R2 layout (written by scripts/private-data.sh and the cf-deploy action):
//   feed/decision_makers.json          raw JSON (people-data)
//   current/jobs-current.json.gz       full rows of current jobs, gzip (ops consumers)
//   archive/jobs/YYYY-MM.jsonl.gz      full corpus archive, NOT served here (analysis only)
// The browser never needs jobs-current: the SPA reads the sharded index/detail files
// that ship as static Pages assets (see scripts/build-site-data.mjs).
const R2_KEYS = {
  'feed/decision_makers.json': { key: 'feed/decision_makers.json', gzip: false },
  'jobs-current.json': { key: 'current/jobs-current.json.gz', gzip: true },
}

export async function onRequestGet({ request, params, env, next }) {
  const rel = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')
  const entry = R2_KEYS[rel]
  if (!entry) return next()

  const obj = await env.PRIVATE_DATA.get(entry.key)
  if (!obj) return new Response('Not found', { status: 404 })

  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  })
  if (entry.gzip) headers.set('Content-Encoding', 'gzip')
  if (obj.etag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { headers })
}
