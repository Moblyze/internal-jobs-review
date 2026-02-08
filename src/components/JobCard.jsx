import { Link } from 'react-router-dom'
import { timeAgo, companyToSlug } from '../utils/formatters'
import { filterValidSkills } from '../utils/skillValidator'
import { formatLocation } from '../utils/locationParser'

function JobCard({ job }) {
  return (
    <Link
      to={`/jobs/${job.id}`}
      className="block bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-lg font-semibold text-gray-900 line-clamp-2 flex-1">
          {job.title}
        </h3>
        {job.status === 'removed' && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 whitespace-nowrap">
            Removed
          </span>
        )}
        {job.status === 'paused' && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap">
            Paused
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-3">
        <Link
          to={`/companies/${companyToSlug(job.company)}`}
          onClick={(e) => e.stopPropagation()}
          className="text-blue-600 hover:text-blue-700 font-medium text-sm"
        >
          {job.company}
        </Link>

        {(() => {
          const formattedLocation = formatLocation(job.location);
          if (!formattedLocation) return null;

          return (
            <div className="flex items-center text-gray-600 text-sm">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"></path>
              </svg>
              {formattedLocation}
            </div>
          );
        })()}
      </div>

      {job.description && (
        <p className="text-gray-700 text-sm line-clamp-3 mb-3">
          {job.description}
        </p>
      )}

      {(() => {
        const validSkills = filterValidSkills(job.skills);
        if (validSkills.length === 0) return null;

        return (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {validSkills.slice(0, 3).map((skill, index) => (
              <span
                key={index}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
              >
                {skill}
              </span>
            ))}
            {validSkills.length > 3 && (
              <span className="text-xs text-gray-500">
                +{validSkills.length - 3} more
              </span>
            )}
          </div>
        );
      })()}

      <div className="flex items-center justify-between text-xs text-gray-500">
        {job.salary && (
          <span className="font-medium text-green-600">{job.salary}</span>
        )}
        {job.postedDate && (
          <span>{timeAgo(job.postedDate)}</span>
        )}
      </div>
    </Link>
  )
}

export default JobCard
