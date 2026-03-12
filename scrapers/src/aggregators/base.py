from abc import ABC, abstractmethod
from typing import Optional
from src.models.job import JobPosting

class AggregatorFilters:
    """Common filters for aggregator searches."""
    def __init__(self, keywords: list[str], job_types: list[str] = None, countries: list[str] = None, max_results: int = 50):
        self.keywords = keywords
        self.job_types = job_types or ["contract", "temporary"]
        self.countries = countries or ["us"]
        self.max_results = max_results

class BaseAggregator(ABC):
    """Abstract base for job aggregator adapters."""
    name: str = "base"

    @abstractmethod
    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search for jobs matching filters. Returns list of JobPosting."""
        pass

    @abstractmethod
    def count(self, filters: AggregatorFilters) -> int:
        """Get count of matching jobs without fetching all details."""
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Check if this adapter has required API keys/config."""
        pass
