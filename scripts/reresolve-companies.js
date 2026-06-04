// scripts/reresolve-companies.js
//
// One-off: re-resolve company-overview cache entries after a cascade fix.
// The COMPANIES KV cache is 1-year TTL, so stale/wrong entries (e.g. KHNP that
// matched "LEAR CORP", or website-less EDGAR matches) persist until invalidated.
// This invalidates each name (needs the admin token) then re-fetches it so the
// FIXED cascade re-resolves and re-caches, and prints the result so you can
// verify the fix live.
//
// Usage:
//   ADMIN_TOKEN=<PDL_FEED_ADMIN_TOKEN> node scripts/reresolve-companies.js
//   ADMIN_TOKEN=… node scripts/reresolve-companies.js "Some Co" "Other Co"   # custom list

const WORKER = process.env.PDL_COMPANY_FEED_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'
const ORIGIN = process.env.PREWARM_ORIGIN || 'https://moblyze.github.io'
const TOKEN = process.env.ADMIN_TOKEN
if (!TOKEN) { console.error('Set ADMIN_TOKEN (the Worker PDL_FEED_ADMIN_TOKEN).'); process.exit(1) }

// The 20 no-domain / wrong-match companies found 2026-06-04. Override via argv.
const DEFAULT = [
  'Bechtel Energy Inc.', 'TotalEnergies SE', 'Korea Hydro & Nuclear Power (KHNP)',
  'Nuclear Power Corporation of India Limited (NPCIL)', 'Santos Ltd / Repsol SA',
  'Shell PLC / INEOS Group (joint)', 'Perpetua Resources', 'SOLV Energy', 'DESRI',
  'Cornish Metals', 'Atlantic Mining', 'enCore Energy Corp.', 'Nextnorth Holdings Corp',
  '80 Mile', 'Ur-Energy', 'Falcon Gold Corp.', 'US ITER', 'Akkuyu Nuclear JSC',
  'Jaguar Uranium Corp.', 'The Nuclear Company',
]

async function main() {
  const cos = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT
  let withSite = 0
  for (const c of cos) {
    const e = encodeURIComponent(c)
    const del = await fetch(`${WORKER}/api/cache/company/${e}`, {
      method: 'DELETE', headers: { Origin: ORIGIN, 'X-Admin-Token': TOKEN },
    })
    if (!del.ok) { console.log(`  ! ${c} → invalidate failed (HTTP ${del.status})`); continue }
    let d = {}
    try { d = await (await fetch(`${WORKER}/api/company/${e}`, { headers: { Origin: ORIGIN } })).json() } catch {}
    const site = d.website || null
    if (site) withSite++
    console.log(`  ${site ? '✓' : '·'} ${c.slice(0, 40).padEnd(40)} site=${site || '-'}  name=${d.display_name || d.name || d.error || '?'}  src=${d._source || ''}`)
  }
  console.log(`\n${withSite}/${cos.length} now resolve a website. Re-run build-contact-coverage + prewarm-contacts to pick up newly-enrichable contacts.`)
}
main().catch(e => { console.error('fatal', e); process.exit(1) })
