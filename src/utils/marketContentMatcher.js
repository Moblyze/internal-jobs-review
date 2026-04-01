/**
 * Market Content Matcher
 *
 * Some focus markets can be identified by job content (title/description),
 * not just the scraping profile. This allows jobs scraped under one profile
 * to appear in another market's filter if the content matches.
 */

const MARKET_CONTENT_RULES = {
  decommissioning: {
    terms: [
      'decommission',
      'decom ',
      'plug and abandon',
      'p&a',
      'well abandonment',
      'topside removal',
      'platform removal',
      'jacket removal',
      'conductor removal',
      'late life',
      'cessation of production',
      'asset removal',
      'asset retirement',
      'cold stack',
      'warm stack',
      'well plugging',
      'site restoration',
      'offshore dismantl',
      'make safe',
      'subsea decom',
      'pipeline decom',
    ],
  },
}

/**
 * Check if a job matches a market based on its content.
 * Returns true if the job's title or description contains any of the market's terms.
 */
export function jobMatchesMarketContent(job, marketSlug) {
  const rule = MARKET_CONTENT_RULES[marketSlug]
  if (!rule) return false

  const text = ((job.title || '') + ' ' + (job.description || '')).toLowerCase()
  return rule.terms.some(term => text.includes(term))
}

/**
 * Check if a job matches any of the selected markets,
 * either by profile or by content.
 */
export function jobMatchesMarkets(job, selectedMarkets) {
  if (!selectedMarkets || selectedMarkets.length === 0) return true

  return selectedMarkets.some(market => {
    // Match by profile (original behavior)
    if (job.profile === market) return true
    // Match by content (for markets with content rules)
    return jobMatchesMarketContent(job, market)
  })
}

/** Markets that have content-based matching rules */
export const CONTENT_MATCHED_MARKETS = Object.keys(MARKET_CONTENT_RULES)
