import Parser from 'rss-parser'

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 Moblyze BD intel feed/1.0'

// Some publishers sit behind a WAF (CloudFront/AWS Bot Control) that 403s any
// non-browser User-Agent, including our polite default. Those sources carry a
// `user_agent` override in sources.json so only they send a browser UA.
const parserCache = new Map()

export function parserFor(userAgent = DEFAULT_USER_AGENT) {
  if (!parserCache.has(userAgent)) {
    parserCache.set(userAgent, new Parser({
      timeout: 30_000,
      headers: { 'User-Agent': userAgent },
    }))
  }
  return parserCache.get(userAgent)
}

export async function fetchRss(source) {
  const feed = await parserFor(source.user_agent || DEFAULT_USER_AGENT).parseURL(source.url)
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
