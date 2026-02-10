import { useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Button component that allows users to copy the current URL with filters
 * Useful for sharing filtered job searches
 */
function ShareFilterButton({ className = '' }) {
  const [copied, setCopied] = useState(false)
  const location = useLocation()

  const handleShare = async () => {
    const url = `${window.location.origin}${location.pathname}${location.search}`

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
      // Fallback for browsers that don't support clipboard API
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleShare}
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 bg-white border border-gray-300 rounded-md shadow-sm transition-colors ${className}`}
      title="Copy shareable URL with current filters"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-600">Copied!</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

export default ShareFilterButton
