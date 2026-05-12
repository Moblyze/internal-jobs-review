import { useState } from 'react'

const ARCHETYPE_LABEL = {
  project_manager:        'Project Manager',
  hiring_manager:         'Hiring Manager',
  ops_director:           'Ops Director',
  site_manager:           'Site Manager',
  business_unit_director: 'BU Director',
  hr_business_partner:    'HR Business Partner',
  rov_supervisor:         'ROV Supervisor',
  survey_lead:            'Survey Lead',
  ndt_supervisor:         'NDT Supervisor',
  drilling_supervisor:    'Drilling Supervisor',
}

function NamedPersonCard({ person }) {
  return (
    <div className="border border-gray-200 rounded-md p-2 bg-white">
      <div className="text-sm font-semibold text-gray-900">{person.name}</div>
      <div className="text-xs text-gray-600">{person.title}</div>
      {person.company ? <div className="text-[11px] text-gray-500 mt-0.5">{person.company}</div> : null}
    </div>
  )
}

export default function DecisionMakers({ keyPeople = [], archetypes = [], company, onArchetypeClick }) {
  const [showAll, setShowAll] = useState(false)
  const decisionMakers = (keyPeople || []).filter(p => p?.hiring_relevance === 'likely_decision_maker')
  const contextOnly = (keyPeople || []).filter(p => p?.hiring_relevance === 'context_only')

  const hasNamed = decisionMakers.length > 0
  const hasArchetypes = (archetypes || []).length > 0
  if (!hasNamed && !hasArchetypes) return null

  return (
    <div className="space-y-3 mt-3">
      {hasNamed && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">Decision-makers (named)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {decisionMakers.map((p, i) => <NamedPersonCard key={i} person={p} />)}
          </div>
          {contextOnly.length > 0 && (
            <button
              type="button"
              className="text-xs text-gray-500 underline mt-1"
              onClick={() => setShowAll(s => !s)}
            >
              {showAll ? 'Hide other mentions' : `Show all ${keyPeople.length} mentioned`}
            </button>
          )}
          {showAll && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 opacity-70">
              {contextOnly.map((p, i) => <NamedPersonCard key={i} person={p} />)}
            </div>
          )}
        </div>
      )}

      {hasArchetypes && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
            Decision-makers (search) {company ? <span className="font-normal text-gray-500">— at {company}</span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {archetypes.map(a => (
              <button
                key={a}
                type="button"
                onClick={() => onArchetypeClick?.(a)}
                className="text-[11px] font-medium px-2 py-1 rounded-full bg-blue-50 text-blue-800 hover:bg-blue-100"
              >
                {ARCHETYPE_LABEL[a] || a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
