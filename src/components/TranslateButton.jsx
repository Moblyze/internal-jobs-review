/**
 * Translate Button Component
 *
 * Shows a translate button on job descriptions detected as non-English.
 * Uses MyMemory Translation API (free, no API key, CORS-friendly).
 * Translates text in chunks and passes translated content back via callback.
 */

import { useState, useEffect, useCallback } from 'react'

const MYMEMORY_API = 'https://api.mymemory.translated.net/get'
const MAX_CHUNK_LENGTH = 450 // MyMemory supports ~500 chars per request

/**
 * Detect if text contains non-English characters
 */
function detectNonEnglish(text) {
  if (!text) return false
  // Non-Latin scripts: Chinese, Japanese, Korean, Arabic, Cyrillic, Thai, Hindi, etc.
  const nonLatinPattern = /[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3000-\u9FFF\uAC00-\uD7AF\u0900-\u097F\u1100-\u11FF]/
  // High density of accented Latin characters (Portuguese, Spanish, French, German, etc.)
  const accentedPattern = /[\u00C0-\u00FF\u0100-\u017F\u0180-\u024F]/g
  const accentedMatches = text.match(accentedPattern) || []
  const accentDensity = accentedMatches.length / Math.max(text.length, 1)

  return nonLatinPattern.test(text) || accentDensity > 0.03
}

/**
 * Split text into chunks at sentence boundaries
 */
function splitIntoChunks(text, maxLength) {
  const chunks = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Find the last sentence boundary within maxLength
    let splitAt = maxLength
    const searchArea = remaining.substring(0, maxLength)

    // Try splitting at sentence boundaries (. ! ? followed by space or newline)
    const sentenceEnd = searchArea.lastIndexOf('. ')
    const exclamEnd = searchArea.lastIndexOf('! ')
    const questEnd = searchArea.lastIndexOf('? ')
    const newlineEnd = searchArea.lastIndexOf('\n')

    const bestEnd = Math.max(sentenceEnd, exclamEnd, questEnd, newlineEnd)
    if (bestEnd > maxLength * 0.3) {
      splitAt = bestEnd + 1
    }

    chunks.push(remaining.substring(0, splitAt).trim())
    remaining = remaining.substring(splitAt).trim()
  }

  return chunks
}

// Translation cache to avoid re-translating the same text
const translationCache = new Map()

/**
 * Translate a single chunk of text via MyMemory API
 */
async function translateChunk(text, sourceLang = 'auto', targetLang = 'en') {
  const cacheKey = `${text}|${targetLang}`
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)
  }

  const langPair = `${sourceLang === 'auto' ? '' : sourceLang}|${targetLang}`
  const url = `${MYMEMORY_API}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Translation API error: ${response.status}`)
  }

  const data = await response.json()

  if (data.responseStatus === 200 && data.responseData?.translatedText) {
    const translated = data.responseData.translatedText
    translationCache.set(cacheKey, translated)
    return translated
  }

  throw new Error(data.responseDetails || 'Translation failed')
}

/**
 * Translate full text by splitting into chunks
 */
async function translateText(text, onProgress) {
  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH)
  const translated = []

  for (let i = 0; i < chunks.length; i++) {
    const result = await translateChunk(chunks[i])
    translated.push(result)
    if (onProgress) {
      onProgress(Math.round(((i + 1) / chunks.length) * 100))
    }
  }

  return translated.join(' ')
}

/**
 * TranslateButton component
 *
 * @param {string} text - The text to check/translate
 * @param {function} onTranslated - Callback with translated text (null to show original)
 * @param {string} className - Additional CSS classes
 */
export default function TranslateButton({ text, onTranslated, className = '' }) {
  const [showButton, setShowButton] = useState(false)
  const [isTranslated, setIsTranslated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    setShowButton(text && detectNonEnglish(text))
    // Reset translation state when text changes (navigating to new job)
    setIsTranslated(false)
    setError(null)
  }, [text])

  const handleTranslate = useCallback(async () => {
    if (isTranslated) {
      // Revert to original
      setIsTranslated(false)
      if (onTranslated) onTranslated(null)
      return
    }

    setIsLoading(true)
    setError(null)
    setProgress(0)

    try {
      const translated = await translateText(text, setProgress)
      setIsTranslated(true)
      if (onTranslated) onTranslated(translated)
    } catch (err) {
      console.error('Translation error:', err)
      setError('Translation failed. Try again.')
    } finally {
      setIsLoading(false)
    }
  }, [text, isTranslated, onTranslated])

  if (!showButton && !isTranslated) return null

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleTranslate}
        disabled={isLoading}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md
          transition-all disabled:opacity-70
          ${isTranslated
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'
            : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-300'
          }
          ${className}
        `}
        title={isTranslated ? 'Show original text' : 'Translate to English'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
        {isLoading
          ? `Translating... ${progress}%`
          : isTranslated
            ? 'Show Original'
            : 'Translate to English'
        }
      </button>
      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
    </div>
  )
}

export { detectNonEnglish }
