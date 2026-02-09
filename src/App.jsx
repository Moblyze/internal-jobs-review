import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'

// Lazy load route components
const JobListPage = lazy(() => import('./pages/JobListPage'))
const JobDetailPage = lazy(() => import('./pages/JobDetailPage'))
const CompanyPage = lazy(() => import('./pages/CompanyPage'))
const DescriptionDemoPage = lazy(() => import('./pages/DescriptionDemoPage'))
const ComparisonTool = lazy(() => import('./pages/ComparisonTool'))

// Loading fallback component
function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '200px'
    }}>
      <div style={{
        border: '4px solid #f3f3f3',
        borderTop: '4px solid #3498db',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        animation: 'spin 1s linear infinite'
      }} />
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

function App() {
  return (
    <Layout>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<JobListPage />} />
          <Route path="/jobs/:jobSlug" element={<JobDetailPage />} />
          <Route path="/companies/:companySlug" element={<CompanyPage />} />
          <Route path="/demo/description-formatting" element={<DescriptionDemoPage />} />
          <Route path="/compare" element={<ComparisonTool />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

export default App
