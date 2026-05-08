import { Link, useLocation } from 'react-router-dom'

function Layout({ children }) {
  const location = useLocation()

  const navLinks = [
    { to: '/', label: 'Jobs' },
    { to: '/feed', label: 'Intel' },
    { to: '/companies', label: 'Companies' },
    { to: '/compare', label: 'Compare' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link to="/" className="text-2xl font-bold text-gray-900 hover:text-blue-600 transition-colors">
                Moblyze Jobs
              </Link>
              <p className="text-sm text-gray-500 mt-1">Internal Preview</p>
            </div>
            <nav className="flex items-center gap-1 sm:gap-2">
              {navLinks.map(link => {
                const isActive = link.to === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(link.to)
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-gray-500 text-sm">
          Moblyze Jobs Preview • Internal Use Only
        </div>
      </footer>
    </div>
  )
}

export default Layout
