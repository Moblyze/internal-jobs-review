import { useState } from 'react'
import { Link } from 'react-router-dom'

// Icon components using inline SVG
const ArrowLeft = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)

const Sparkles = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
)

const SplitSquareHorizontal = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4m6-14h4a2 2 0 012 2v12a2 2 0 01-2 2h-4m-6-14v14m0-14h6m-6 14h6" />
  </svg>
)

// Mock data - Baker Hughes Supply Chain Localization Leader job
const DEMO_JOB = {
  id: "baker-hughes-https---bakerhughes-wd5-myworkdayjobs-com-en-us-bakerhughes-job-ae-abu-dhabi-al-ghaith-holding-tower-airport-road-supply-chain-localization-leader-r156427",
  title: "Supply Chain Localization Leader",
  company: "Baker Hughes",
  location: "locations\nAE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD",
  description: "Do you enjoy working on Supply Chain projects?\n\nWould you like the opportunity to work for oilfield services company?\n\nJoin our team\n\nOur Oilfield Services business provides intelligent, connected technologies to monitor and control our energy extraction assets. Our team arranging technical expertise to meet our client expectation. We provide customers with the peace of mind needed to reliably and efficiently improve their operations.\n\nPartner with the best\n\nAs the Supply Chain Localization Leader you will be responsible for leading and executing an integrated Supply Chain Localization strategy under UAE Unified ICV Program v4.0, targeting Goods Manufactured and Third-Party Spend to shift sourcing from import-heavy to locally optimized. You will drive measurable ICV uplift, ensuring compliance with MOIAT and ADNOC frameworks, and spearheading facility optimization projects across UAE to enhance operational efficiency and local value creation.\n\nAs a Supply Chain Localization Leader, you will be responsible for:\nDeveloping and executing Supply Chain Localization Strategy for Baker Hughes business in the UAE. Targeting shift to UAE Based ICV-Certified Suppliers. Specific categories focus is needed on are Goods Manufactured as well as Third Party Spend.\nPerforming analysis of current supply chain Practices, conducting existing spend diagnostics, mapping high spend categories to UAE-Made alternatives.\nRevamping Supply Chain for Local Sourcing, Partner with Local suppliers for active participation in Local Supplier Development programs.\nEngaging with Suppliers to support their ICV Certifications and Scores, Conducting supplier training workshops in Conjunction with the ICV Leader.\nCollaborating with cross-functional teams (Business Segments, GeoZones, Supply Chain) to drive UAE-based supply chain localization in alignment with the established localization strategy\nEnsuring compliance with MoIAT and ADNOC ICV frameworks; Supporting with Internal / External ICV Audits specific to Third Party Spend and Goods Manufactured categories.\nIdentifying and leading facility cost optimization projects throughout the UAE Baker Hughes business.\nTo be successful in this role you will have:\nBachelors in supply chain, Engineering, Procurement or Business.\nMinimum 5 Years with Supply Chain function, preferably within the Oil and Gas industry.\nThorough understanding of the MoIAT and ADNOC In Country Value frameworks (is preferred).\nProven Supply Chain Localization and/or Supplier Development experience.\nStrong Analytical and Data Driven Decision making, ability to work within a matrix organization while leading with influence, executive communication Skills.\n\nWorking with Us \n\nOur people are at the heart of what we do at Baker Hughes. We know we are better when all of our people are developed, engaged and able to bring their whole authentic selves to work. We invest in the health and well-being of our workforce, train, reward talent, and develop leaders at all levels to bring out the best in each other.\n\n \n\nWorking for you\n\nOur inventions have revolutionized energy for over a century. But to keep going forward tomorrow, we know we have to push the boundaries today. We prioritize rewarding those who embrace change with a package that reflects how much we value their input. Join us, and you can expect:\n\nContemporary work-life balance policies and wellbeing activities\nComprehensive private medical care options\nSafety net of life insurance and disability programs\nTailored financial programs\nAdditional elected or voluntary benefits\n\n#LI_Onsite\n\nThe Baker Hughes internal title for this role is: Project Management Advisor - Functional Mgmt",
  url: "https://bakerhughes.wd5.myworkdayjobs.com/en-US/BakerHughes/job/AE-ABU-DHABI-AL-GHAITH-HOLDING-TOWER-AIRPORT-ROAD/Supply-Chain-Localization-Leader_R156427"
}

// Mock structured data that AI would return
const MOCK_STRUCTURED_DATA = {
  overview: "As the Supply Chain Localization Leader, you will lead and execute an integrated Supply Chain Localization strategy under UAE Unified ICV Program v4.0. This role focuses on shifting sourcing from import-heavy to locally optimized, driving measurable ICV uplift while ensuring compliance with MOIAT and ADNOC frameworks.",
  responsibilities: [
    "Develop and execute Supply Chain Localization Strategy for Baker Hughes business in the UAE, targeting shift to UAE Based ICV-Certified Suppliers with specific focus on Goods Manufactured and Third Party Spend",
    "Perform analysis of current supply chain practices, conducting existing spend diagnostics and mapping high spend categories to UAE-Made alternatives",
    "Revamp Supply Chain for Local Sourcing and partner with local suppliers for active participation in Local Supplier Development programs",
    "Engage with suppliers to support their ICV Certifications and Scores, conducting supplier training workshops in conjunction with the ICV Leader",
    "Collaborate with cross-functional teams (Business Segments, GeoZones, Supply Chain) to drive UAE-based supply chain localization in alignment with the established localization strategy",
    "Ensure compliance with MoIAT and ADNOC ICV frameworks; support Internal/External ICV Audits specific to Third Party Spend and Goods Manufactured categories",
    "Identify and lead facility cost optimization projects throughout the UAE Baker Hughes business"
  ],
  requirements: [
    "Bachelor's degree in Supply Chain, Engineering, Procurement or Business",
    "Minimum 5 years with Supply Chain function, preferably within the Oil and Gas industry",
    "Thorough understanding of the MoIAT and ADNOC In Country Value frameworks (preferred)",
    "Proven Supply Chain Localization and/or Supplier Development experience",
    "Strong analytical and data-driven decision making skills",
    "Ability to work within a matrix organization while leading with influence",
    "Executive communication skills"
  ],
  benefits: [
    "Contemporary work-life balance policies and wellbeing activities",
    "Comprehensive private medical care options",
    "Safety net of life insurance and disability programs",
    "Tailored financial programs",
    "Additional elected or voluntary benefits"
  ]
}

// Mock StructuredJobDescription component (placeholder until real one is ready)
const StructuredJobDescription = ({ data }) => {
  return (
    <div className="space-y-6">
      {/* Overview */}
      {data.overview && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Overview</h3>
          <p className="text-gray-700 leading-relaxed">{data.overview}</p>
        </div>
      )}

      {/* Responsibilities */}
      {data.responsibilities && data.responsibilities.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Key Responsibilities</h3>
          <ul className="space-y-2">
            {data.responsibilities.map((item, idx) => (
              <li key={idx} className="flex items-start">
                <span className="text-blue-600 mr-2 mt-1">•</span>
                <span className="text-gray-700">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Requirements */}
      {data.requirements && data.requirements.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Requirements</h3>
          <ul className="space-y-2">
            {data.requirements.map((item, idx) => (
              <li key={idx} className="flex items-start">
                <span className="text-blue-600 mr-2 mt-1">•</span>
                <span className="text-gray-700">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Benefits */}
      {data.benefits && data.benefits.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Benefits</h3>
          <ul className="space-y-2">
            {data.benefits.map((item, idx) => (
              <li key={idx} className="flex items-start">
                <span className="text-green-600 mr-2 mt-1">•</span>
                <span className="text-gray-700">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Mock AI parser (placeholder until real one is ready)
const mockAiDescriptionParser = async (description) => {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 1500))
  return MOCK_STRUCTURED_DATA
}

function DescriptionDemoPage() {
  const [viewMode, setViewMode] = useState('split') // 'split', 'before', 'after'
  const [isProcessing, setIsProcessing] = useState(false)
  const [structuredData, setStructuredData] = useState(null)
  const [hasProcessed, setHasProcessed] = useState(false)

  const handleProcessWithAI = async () => {
    setIsProcessing(true)
    try {
      const result = await mockAiDescriptionParser(DEMO_JOB.description)
      setStructuredData(result)
      setHasProcessed(true)
    } catch (error) {
      console.error('Error processing description:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="text-gray-600 hover:text-gray-900">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  AI Job Description Formatting Demo
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  See how AI transforms raw job descriptions into structured, readable formats
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('split')}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  viewMode === 'split'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <SplitSquareHorizontal className="w-4 h-4" />
                Split View
              </button>
              <button
                onClick={() => setViewMode('before')}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  viewMode === 'before'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Before Only
              </button>
              <button
                onClick={() => setViewMode('after')}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  viewMode === 'after'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                After Only
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Job Info */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{DEMO_JOB.title}</h2>
              <p className="text-gray-600 mt-1">{DEMO_JOB.company}</p>
              <p className="text-sm text-gray-500 mt-1">
                {DEMO_JOB.location.replace('locations\n', '')}
              </p>
            </div>

            {!hasProcessed && (
              <button
                onClick={handleProcessWithAI}
                disabled={isProcessing}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium flex items-center gap-2 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Sparkles className={`w-5 h-5 ${isProcessing ? 'animate-spin' : ''}`} />
                {isProcessing ? 'Processing with AI...' : 'Process with AI'}
              </button>
            )}

            {hasProcessed && (
              <div className="flex items-center gap-2 text-green-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">Processed</span>
              </div>
            )}
          </div>
        </div>

        {/* Comparison View */}
        <div className={`grid gap-6 ${viewMode === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {/* Before */}
          {(viewMode === 'split' || viewMode === 'before') && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="bg-red-50 border-b border-red-100 px-6 py-3">
                <h3 className="text-lg font-semibold text-red-900">Before: Raw Text</h3>
                <p className="text-sm text-red-600 mt-1">
                  Unstructured wall of text, hard to scan
                </p>
              </div>
              <div className="p-6">
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                    {DEMO_JOB.description}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* After */}
          {(viewMode === 'split' || viewMode === 'after') && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="bg-green-50 border-b border-green-100 px-6 py-3">
                <h3 className="text-lg font-semibold text-green-900">After: AI Structured</h3>
                <p className="text-sm text-green-600 mt-1">
                  Clean sections, bullet points, easy to scan
                </p>
              </div>
              <div className="p-6">
                {!hasProcessed ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <Sparkles className="w-12 h-12 mb-4" />
                    <p className="text-center">
                      Click "Process with AI" to see the transformation
                    </p>
                  </div>
                ) : isProcessing ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                    <p className="text-gray-600">Restructuring with AI...</p>
                  </div>
                ) : (
                  <StructuredJobDescription data={structuredData} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Key Improvements Callout */}
        {hasProcessed && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-3">Key Improvements</h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-blue-900">Clear section headers for easy navigation</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-blue-900">Bullet points instead of dense paragraphs</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-blue-900">Structured overview summarizing the role</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-blue-900">Organized requirements and benefits</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-blue-900">Better readability and scannability</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">✓</span>
                <span className="text-blue-900">Mobile-friendly responsive design</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default DescriptionDemoPage
