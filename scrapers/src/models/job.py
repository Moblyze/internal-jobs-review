"""JobPosting Pydantic model for data validation and schema definition."""

from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, HttpUrl, Field, field_validator, model_validator


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

    # Contact enrichment (2026-04 pilot — populated for employers with
    # `extract_contacts: true` in companies.yaml).
    contact_name: Optional[str] = Field(None, description="Hiring contact name")
    contact_title: Optional[str] = Field(None, description="Hiring contact title")
    contact_email: Optional[str] = Field(None, description="Hiring contact personal email")
    contact_phone: Optional[str] = Field(None, description="Hiring contact phone")
    contact_linkedin_url: Optional[str] = Field(None, description="Hiring contact LinkedIn profile URL")
    contact_source: Optional[str] = Field(None, description="Extraction source label (labeled_pattern, body_text, email_derived)")

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

    @model_validator(mode='after')
    def sanitize_company_in_location(self) -> 'JobPosting':
        """Replace location with 'Unknown' if it looks like a company name.

        Catches cases where aggregator adapters accidentally put the company
        name in the location field (e.g., 'Allison Offshore Services LLC'
        instead of a real geographic location).
        """
        from src.aggregators.cleanup import looks_like_company_name
        if looks_like_company_name(self.location, self.company):
            self.location = "Unknown"
        return self

    def to_sheet_row(self) -> list:
        """
        Convert job posting to flat list for Google Sheets export.

        Returns:
            List of 20 values in column order: [title, company, location,
            description, url, requisition_id, posted_date, skills,
            certifications, salary, employment_type, status,
            status_changed_date, scraped_at, contact_name, contact_title,
            contact_email, contact_phone, contact_linkedin_url,
            contact_source]
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
            self.scraped_at.isoformat(),
            self.contact_name or '',
            self.contact_title or '',
            self.contact_email or '',
            self.contact_phone or '',
            self.contact_linkedin_url or '',
            self.contact_source or '',
        ]
