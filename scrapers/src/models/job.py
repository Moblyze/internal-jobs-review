"""JobPosting Pydantic model for data validation and schema definition."""

from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, HttpUrl, Field, field_validator


class JobPosting(BaseModel):
    """
    Validated job posting data model.

    Enforces required fields and validates data types before export to Google Sheets.
    All jobs must pass validation to ensure data quality.
    """

    # Required fields (EXTRACT-06 through EXTRACT-09)
    title: str = Field(min_length=1, description="Job title")
    company: str = Field(description="Company name")
    location: str = Field(description="Job location")
    description: str = Field(min_length=10, description="Job description")
    url: HttpUrl = Field(description="Job posting URL")

    # Optional fields (EXTRACT-11 through EXTRACT-14)
    posted_date: Optional[datetime] = Field(None, description="Date job was posted")
    skills: list[str] = Field(default_factory=list, description="Required skills (e.g., 'project management', 'welding')")
    certifications: list[str] = Field(default_factory=list, description="Required certifications/licenses (e.g., 'CDL-A', 'OSHA 30', 'API 510') - EXTRACT-14")
    salary: Optional[str] = Field(None, description="Salary information when available")
    requisition_id: Optional[str] = Field(None, description="Job requisition ID (unique identifier from ATS)")
    employment_type: Optional[str] = Field(None, description="Employment type (e.g., 'Full-Time', 'Contractor', 'Part-Time', 'Temporary', 'Internship')")
    source_aggregator: Optional[str] = Field(None, description="Source aggregator name (e.g., 'jobspy', 'adzuna', 'jooble')")

    # Job lifecycle tracking
    status: Literal["active", "removed", "paused"] = Field(
        default="active",
        description="Job status: active (currently posted), removed (no longer on source site), paused (temporarily hidden)"
    )
    status_changed_date: Optional[datetime] = Field(
        None,
        description="When the job status last changed"
    )

    # Metadata
    scraped_at: datetime = Field(default_factory=lambda: datetime.utcnow(), description="When job was scraped")

    @field_validator('title', 'company', 'location')
    @classmethod
    def no_empty_strings(cls, v: str) -> str:
        """
        Strip whitespace and reject empty strings for required text fields.

        Ensures data quality by preventing whitespace-only values.
        """
        if not v or not v.strip():
            raise ValueError('Field cannot be empty or whitespace')
        return v.strip()

    def to_sheet_row(self) -> list:
        """
        Convert job posting to flat list for Google Sheets export.

        Returns:
            List of values in column order: [title, company, location, description,
            url, requisition_id, posted_date, skills, certifications, salary,
            employment_type, status, status_changed_date, scraped_at]
        """
        return [
            self.title,
            self.company,
            self.location,
            self.description,
            str(self.url),
            self.requisition_id or '',
            self.posted_date.isoformat() if self.posted_date else '',
            '; '.join(self.skills) if self.skills else '',
            '; '.join(self.certifications) if self.certifications else '',
            self.salary or '',
            self.employment_type or '',
            self.status,
            self.status_changed_date.isoformat() if self.status_changed_date else '',
            self.scraped_at.isoformat()
        ]
