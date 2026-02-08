import { Routes, Route } from 'react-router-dom'
import JobListPage from './pages/JobListPage'
import JobDetailPage from './pages/JobDetailPage'
import CompanyPage from './pages/CompanyPage'
import DescriptionDemoPage from './pages/DescriptionDemoPage'
import ComparisonTool from './pages/ComparisonTool'
import Layout from './components/Layout'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<JobListPage />} />
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/companies/:companySlug" element={<CompanyPage />} />
        <Route path="/demo/description-formatting" element={<DescriptionDemoPage />} />
        <Route path="/compare" element={<ComparisonTool />} />
      </Routes>
    </Layout>
  )
}

export default App
