const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index?q=%22material+definitive+agreement%22&dateRange=custom&startdt={start}&enddt={end}&forms=8-K'

export async function fetchEdgar(source) {
  const today = new Date()
  const lookback = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000) // last 3d
  const fmt = d => d.toISOString().slice(0, 10)
  const url = EDGAR_SEARCH.replace('{start}', fmt(lookback)).replace('{end}', fmt(today))

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Moblyze BD intel feed jesse@moblyze.me',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`EDGAR ${res.status}`)
  const json = await res.json()
  return parseEdgarHits(json)
}

export function parseEdgarHits(json) {
  const hits = json?.hits?.hits || []
  return hits.map(h => {
    const src = h._source || {}
    const cik = (src.ciks || ['0000000000'])[0].replace(/^0+/, '') || '0'
    const adsh = src.adsh || ''
    const accNoDashes = adsh.replace(/-/g, '')
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=8-K&dateb=&owner=include&count=40`
    const filingUrl = adsh
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/${adsh}-index.htm`
      : url
    const company = (src.display_names || ['Unknown'])[0]
    return {
      source: { id: 'sec_edgar_8k', name: 'SEC EDGAR 8-K', url: filingUrl },
      headline: `${company} — 8-K material definitive agreement`,
      body: `Form 8-K filed ${src.file_date}. Material definitive agreement disclosed; scope and counterparty TBD from filing exhibits.`,
      url: filingUrl,
      published_at: src.file_date ? new Date(src.file_date).toISOString() : null,
    }
  })
}
