import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * SEO component for managing meta tags and canonical URLs
 * Updates document head based on current page and URL parameters
 */
function SEO({ title, description, canonical }) {
  const location = useLocation()

  useEffect(() => {
    // Update page title
    if (title) {
      document.title = `${title} | Moblyze Jobs`
    } else {
      document.title = 'Moblyze Jobs - Skilled Trades & Energy Opportunities'
    }

    // Update meta description
    const metaDescription = document.querySelector('meta[name="description"]')
    if (metaDescription) {
      metaDescription.setAttribute('content', description || 'Find job opportunities in skilled trades and energy sectors')
    } else {
      const meta = document.createElement('meta')
      meta.name = 'description'
      meta.content = description || 'Find job opportunities in skilled trades and energy sectors'
      document.head.appendChild(meta)
    }

    // Update canonical URL (helps with SEO when URL params are used)
    const canonicalUrl = canonical || `${window.location.origin}${location.pathname}`
    let canonicalLink = document.querySelector('link[rel="canonical"]')

    if (canonicalLink) {
      canonicalLink.setAttribute('href', canonicalUrl)
    } else {
      canonicalLink = document.createElement('link')
      canonicalLink.rel = 'canonical'
      canonicalLink.href = canonicalUrl
      document.head.appendChild(canonicalLink)
    }

    // Update Open Graph tags for social sharing
    updateMetaTag('og:title', title || 'Moblyze Jobs')
    updateMetaTag('og:description', description || 'Find job opportunities in skilled trades and energy sectors')
    updateMetaTag('og:url', canonicalUrl)

  }, [title, description, canonical, location.pathname])

  // Inject site-wide structured data (WebSite + Organization) once
  useEffect(() => {
    // Only add if not already present
    if (document.querySelector('script[data-schema="site-wide"]')) return

    const siteSchema = [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Moblyze Jobs',
        url: window.location.origin,
        description: 'Find job opportunities in skilled trades and energy sectors',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Moblyze',
        url: 'https://moblyze.me',
        description: 'Moblyze connects job seekers with opportunities in skilled trades and energy sectors.',
      },
    ]

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute('data-schema', 'site-wide')
    script.textContent = JSON.stringify(siteSchema)
    document.head.appendChild(script)

    return () => {
      const el = document.querySelector('script[data-schema="site-wide"]')
      if (el) document.head.removeChild(el)
    }
  }, [])

  return null
}

/**
 * Helper function to update or create Open Graph meta tags
 */
function updateMetaTag(property, content) {
  let tag = document.querySelector(`meta[property="${property}"]`)

  if (tag) {
    tag.setAttribute('content', content)
  } else {
    tag = document.createElement('meta')
    tag.setAttribute('property', property)
    tag.setAttribute('content', content)
    document.head.appendChild(tag)
  }
}

export default SEO
