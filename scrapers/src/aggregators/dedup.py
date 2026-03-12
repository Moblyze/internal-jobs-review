import re
import yaml
import hashlib
import sqlite3
import os

class AggregatorDedup:
    """Deduplication for aggregator results against directly-scraped employers."""

    def __init__(self, companies_yaml_path: str = 'config/companies.yaml', db_path: str = 'data/scraper_state.db'):
        self.excluded_companies = self._load_excluded_companies(companies_yaml_path)
        self.db_path = db_path

    def _load_excluded_companies(self, path: str) -> set[str]:
        """Load company names from companies.yaml and normalize them."""
        if not os.path.exists(path):
            return set()
        with open(path) as f:
            config = yaml.safe_load(f)
        names = set()
        for key, company in config.get('companies', {}).items():
            name = company.get('name', '')
            names.add(self._normalize_company(name))
        return names

    def _normalize_company(self, name: str) -> str:
        """Normalize company name for matching."""
        name = name.lower().strip()
        # Remove common suffixes
        for suffix in [' inc', ' inc.', ' llc', ' corp', ' corp.', ' corporation', ' company', ' co.', ' co', ' ltd', ' ltd.', ' limited', ' plc', ' sa', ' se', ' ag']:
            if name.endswith(suffix):
                name = name[:-len(suffix)].strip()
        # Remove punctuation
        name = re.sub(r'[^\w\s]', '', name)
        return name.strip()

    def is_excluded_company(self, company_name: str) -> bool:
        """Check if a company name matches one of the directly-scraped employers."""
        normalized = self._normalize_company(company_name)
        # Exact match
        if normalized in self.excluded_companies:
            return True
        # Substring match (e.g., "Baker Hughes Energy Services" contains "baker hughes")
        for excluded in self.excluded_companies:
            if excluded in normalized or normalized in excluded:
                return True
        return False

    def is_url_known(self, url: str) -> bool:
        """Check if URL already exists in the scraper state database."""
        if not os.path.exists(self.db_path):
            return False
        url_hash = hashlib.sha256(url.encode('utf-8')).hexdigest()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM scraped_jobs WHERE url_hash = ? LIMIT 1", (url_hash,))
        result = cursor.fetchone() is not None
        conn.close()
        return result

    def filter_results(self, jobs: list) -> tuple[list, dict]:
        """Filter out jobs from excluded companies and known URLs.
        Returns (filtered_jobs, stats_dict)."""
        stats = {'total': len(jobs), 'excluded_company': 0, 'known_url': 0, 'kept': 0}
        filtered = []
        for job in jobs:
            company = getattr(job, 'company', '') if hasattr(job, 'company') else job.get('company', '')
            url = str(getattr(job, 'url', '')) if hasattr(job, 'url') else str(job.get('url', ''))

            if self.is_excluded_company(company):
                stats['excluded_company'] += 1
                continue
            if url and self.is_url_known(url):
                stats['known_url'] += 1
                continue
            filtered.append(job)
            stats['kept'] += 1
        return filtered, stats
