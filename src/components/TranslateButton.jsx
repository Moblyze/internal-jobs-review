/**
 * Translate Button Component
 *
 * Provides an elegant translate toggle for job descriptions in foreign languages.
 * Uses the Google Translate API to translate page content inline.
 *
 * Flow:
 * 1. User clicks "Translate" button
 * 2. Google Translate script is loaded (lazy, only when needed)
 * 3. Content is translated to user's preferred language
 * 4. User can click "Show Original" to revert
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// Google Translate initialization
let googleTranslateLoaded = false
let googleTranslateLoadPromise = null

function loadGoogleTranslate() {
  if (googleTranslateLoaded) return Promise.resolve()
  if (googleTranslateLoadPromise) return googleTranslateLoadPromise

  googleTranslateLoadPromise = new Promise((resolve) => {
    // Create the hidden Google Translate element
    const translateDiv = document.createElement('div')
    translateDiv.id = 'google_translate_element'
    translateDiv.style.display = 'none'
    document.body.appendChild(translateDiv)

    // Define the callback
    window.googleTranslateElementInit = () => {
      new window.google.translate.TranslateElement(
        {
          pageLanguage: 'auto',
          autoDisplay: false,
          layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE
        },
        'google_translate_element'
      )
      googleTranslateLoaded = true
      resolve()
    }

    // Load the script
    const script = document.createElement('script')
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    script.async = true
    document.body.appendChild(script)
  })

  return googleTranslateLoadPromise
}

function triggerTranslation(targetLang = 'en') {
  // Find the Google Translate select element and trigger translation
  const selectEl = document.querySelector('.goog-te-combo')
  if (selectEl) {
    selectEl.value = targetLang
    selectEl.dispatchEvent(new Event('change'))
    return true
  }
  return false
}

function restoreOriginal() {
  // Click the "Show original" link that Google Translate provides
  const banner = document.querySelector('.goog-te-banner-frame')
  if (banner) {
    try {
      const bannerDoc = banner.contentDocument || banner.contentWindow.document
      const restoreBtn = bannerDoc.querySelector('.goog-te-button button')
      if (restoreBtn) {
        restoreBtn.click()
        return true
      }
    } catch (e) {
      // Cross-origin frame access may fail
    }
  }

  // Alternative: reset the cookie
  document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
  document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.' + window.location.hostname
  window.location.reload()
  return true
}

/**
 * Detect if text contains non-English characters
 */
function detectNonEnglish(text) {
  if (!text) return false
  // Check for common non-Latin scripts and accented characters that suggest non-English
  // This checks for: Chinese, Japanese, Korean, Arabic, Cyrillic, Thai, Hindi, etc.
  const nonLatinPattern = /[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3000-\u9FFF\uAC00-\uD7AF\u0900-\u097F\u1100-\u11FF]/
  // Also check for high density of accented Latin characters (Portuguese, Spanish, French, German, etc.)
  const accentedPattern = /[\u00C0-\u00FF\u0100-\u017F\u0180-\u024F]/g
  const accentedMatches = text.match(accentedPattern) || []
  const accentDensity = accentedMatches.length / Math.max(text.length, 1)

  return nonLatinPattern.test(text) || accentDensity > 0.03
}

export default function TranslateButton({ text, className = '' }) {
  const [isTranslated, setIsTranslated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showButton, setShowButton] = useState(false)

  // Detect if translation might be needed
  useEffect(() => {
    if (text && detectNonEnglish(text)) {
      setShowButton(true)
    } else {
      setShowButton(false)
    }
  }, [text])

  const handleTranslate = useCallback(async () => {
    if (isTranslated) {
      restoreOriginal()
      setIsTranslated(false)
      return
    }

    setIsLoading(true)
    try {
      await loadGoogleTranslate()
      // Small delay to let the translate element initialize
      await new Promise(r => setTimeout(r, 500))
      const success = triggerTranslation('en')
      if (success) {
        setIsTranslated(true)
      }
    } catch (err) {
      console.error('Translation error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [isTranslated])

  // Always show the button (user may want to translate even if we don't detect non-English)
  // But auto-show it prominently when non-English is detected
  return (
    <button
      onClick={handleTranslate}
      disabled={isLoading}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md
        transition-all disabled:opacity-50
        ${isTranslated
          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'
          : showButton
            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-300 animate-pulse-once'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-gray-300'
        }
        ${className}
      `}
      title={isTranslated ? 'Show original text' : 'Translate this page to English'}
    >
      {/* Globe/Translate icon */}
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
      </svg>
      {isLoading ? 'Translating...' : isTranslated ? 'Show Original' : 'Translate'}
    </button>
  )
}

export { detectNonEnglish }
