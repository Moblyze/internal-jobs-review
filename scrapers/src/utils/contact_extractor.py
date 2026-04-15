"""Extract hiring-manager / recruiter contact info from plain-text job descriptions.

Stateless module. All input is plain text (as returned by Playwright `inner_text()`).
No network calls, no I/O, no logging state. Used via `extract_contacts()`.
"""

from typing import Optional


EMPTY_RESULT: dict = {
    "contact_name": "",
    "contact_title": "",
    "contact_email": "",
    "contact_phone": "",
    "contact_linkedin_url": "",
    "contact_source": "",
}


def extract_contacts(description: str, employer_name: str) -> dict:
    """Return a dict of 6 contact fields extracted from the job description.

    Keys always present; values default to empty string.
    """
    result = dict(EMPTY_RESULT)
    if not description:
        return result
    # Filled in by later tasks.
    return result
