"""Relevance filter for aggregator results.

Removes false positive jobs that don't match the search profile's domain.
Runs AFTER dedup filtering. Each profile defines:
  - relevance_include: at least one keyword must appear in title/company/description
  - relevance_exclude: if any keyword appears in title, the job is excluded
"""

import logging

logger = logging.getLogger(__name__)


class RelevanceFilter:
    """Filter aggregator results by relevance to the search profile."""

    def __init__(self, include_keywords: list[str] = None, exclude_keywords: list[str] = None):
        self.include_keywords = [k.lower() for k in (include_keywords or [])]
        self.exclude_keywords = [k.lower() for k in (exclude_keywords or [])]

    def _get_field(self, job, field: str) -> str:
        """Get a field from a job object or dict, returning lowercase string."""
        if hasattr(job, field):
            val = getattr(job, field, '') or ''
        else:
            val = job.get(field, '') or ''
        return str(val).lower()

    def _matches_any(self, text: str, keywords: list[str]) -> str | None:
        """Check if text contains any of the keywords. Returns the matched keyword or None."""
        for kw in keywords:
            if kw in text:
                return kw
        return None

    def is_relevant(self, job) -> tuple[bool, str]:
        """Check if a job is relevant to the profile.

        Returns (is_relevant, reason).
        - reason is empty string if relevant
        - reason describes why it was excluded if not relevant
        """
        title = self._get_field(job, 'title')
        company = self._get_field(job, 'company')
        description = self._get_field(job, 'description')

        # Check exclusions against title only (description may contain tangential mentions)
        if self.exclude_keywords:
            matched = self._matches_any(title, self.exclude_keywords)
            if matched:
                return False, f"title matched exclude keyword '{matched}'"

        # Check inclusions against title, company, and description (loose match)
        if self.include_keywords:
            searchable = f"{title} {company} {description}"
            matched = self._matches_any(searchable, self.include_keywords)
            if not matched:
                return False, "no include keyword found in title/company/description"

        return True, ""

    def filter_results(self, jobs: list) -> tuple[list, dict]:
        """Filter jobs by relevance.

        Returns (filtered_jobs, stats_dict).
        """
        stats = {
            'total': len(jobs),
            'excluded_irrelevant': 0,
            'excluded_negative': 0,
            'kept': 0,
        }

        if not self.include_keywords and not self.exclude_keywords:
            # No relevance config -- pass everything through
            stats['kept'] = len(jobs)
            return jobs, stats

        filtered = []
        for job in jobs:
            relevant, reason = self.is_relevant(job)
            if relevant:
                filtered.append(job)
                stats['kept'] += 1
            else:
                if reason.startswith("title matched exclude"):
                    stats['excluded_negative'] += 1
                else:
                    stats['excluded_irrelevant'] += 1
                title = self._get_field(job, 'title')
                logger.debug(f"Relevance filter removed: '{title}' -- {reason}")

        return filtered, stats
