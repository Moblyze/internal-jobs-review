import Parser from 'rss-parser'

const parser = new Parser({
  timeout: 30_000,
  headers: { 'User-Agent': 'Mozilla/5.0 Moblyze BD intel feed/1.0' },
})

export async function fetchRss(source) {
  const feed = await parser.parseURL(source.url)
  return parseRssItems(feed.items || [], source)
}

export function parseRssItems(items, source) {
  return items
    .filter(it => it.title && it.link)
    .map(it => ({
      sources: [{ id: source.id, name: source.name, url: it.link }],
      headline: it.title.trim(),
      body: (it.contentSnippet || it.content || '').trim(),
      url: it.link,
      published_at: it.isoDate ? new Date(it.isoDate).toISOString() : null,
    }))
}
