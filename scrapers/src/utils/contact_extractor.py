"""Extract hiring-manager / recruiter contact info from plain-text job descriptions.

Stateless module. All input is plain text (as returned by Playwright `inner_text()`).
No network calls, no I/O, no logging state. Used via `extract_contacts()`.
"""

import re
from typing import Optional


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

LABEL_RE = re.compile(
    r"(?:Contact|Recruiter|Hiring Manager|Reporting to|"
    r"For more information contact|Questions\?\s*Contact)\s*[:\-]\s*"
    r"|Posted by\s+",
    re.IGNORECASE,
)

# Case-sensitive name pattern — must start with a capital. Applied at the
# position immediately after a LABEL_RE match.
NAME_RE = re.compile(
    r"(?:Dr\.\s+|Mr\.\s+|Ms\.\s+|Mrs\.\s+)?"
    r"[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}"
)

REJECTED_NAME_TOKENS: set[str] = {
    "apply", "now", "click", "here", "visit", "see", "below",
    "above", "website", "link", "site", "career", "careers",
    "submit", "online", "portal", "form",
}


BLOCKLIST_EXACT: set[str] = {
    "info", "careers", "career", "jobs", "job", "hr",
    "recruiting", "recruitment", "recruiter", "recruiters",
    "talent", "talentacquisition", "ta",
    "apply", "application", "applications",
    "hiring", "contact", "contactus",
    "enquiries", "enquiry", "inquiries", "inquiry",
    "hello", "hi", "support", "admin", "office",
    "mail", "mailbox", "general", "reception",
    "communications", "comms", "media", "press",
    "marketing", "sales", "feedback", "helpdesk", "service",
    "no-reply", "noreply", "donotreply", "do-not-reply",
    "postmaster", "webmaster", "abuse",
}


def _normalize_company_token(name: str) -> str:
    """Lowercase, strip corp suffixes, strip non-alphanum, for comparison."""
    s = name.lower()
    for suffix in (" group", " ltd", " limited", " inc", " llc", " corp", " corporation", " plc", " us"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
    return "".join(ch for ch in s if ch.isalnum())


def is_personal_email(email: str, employer_name: str) -> bool:
    """Return True if the email looks like a real individual's mailbox.

    Rejects generic mailboxes (info@, careers@, etc.), team patterns
    (sales-team@), anything containing the employer's own name, and
    anything that doesn't match a name-like shape heuristic.
    """
    if not email or "@" not in email:
        return False

    local, _, _domain = email.partition("@")
    local_lower = local.lower()

    if local_lower in BLOCKLIST_EXACT:
        return False

    if local_lower.startswith(("no-reply", "noreply", "donotreply", "do-not-reply")):
        return False

    if "-team" in local_lower or "_team" in local_lower:
        return False

    company_token = _normalize_company_token(employer_name)
    local_alnum = "".join(ch for ch in local_lower if ch.isalnum())
    if company_token and company_token in local_alnum:
        return False

    if "." in local_lower or "_" in local_lower:
        tokens = [t for t in local_lower.replace("_", ".").split(".") if t]
        if len(tokens) >= 2 and all(len(t) >= 1 for t in tokens):
            return True

    if len(local_lower) >= 4 and local_lower.isalnum():
        return True

    return False


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

    Keys always present; values default to empty string. Precedence for
    `contact_name` / `contact_source`:
        1. Labeled-pattern capture ("Contact: Jane Doe") — `labeled_pattern`.
        2. Email-derived name (from "first.last@" local part) — `email_derived`.
        3. Email present but no derivable name — `body_text`.
        4. Nothing found — empty.
    """
    result = dict(EMPTY_RESULT)
    if not description:
        return result

    labeled_name, _label_end = _find_labeled_name(description)
    email = _find_first_personal_email(description, employer_name)

    if labeled_name and not email:
        result["contact_name"] = labeled_name
        result["contact_source"] = "labeled_pattern"
        return result

    if email:
        result["contact_email"] = email
        result["contact_source"] = "body_text"
        if labeled_name:
            result["contact_name"] = labeled_name
            result["contact_source"] = "labeled_pattern"
        else:
            derived = _derive_name_from_local_part(email)
            if derived:
                result["contact_name"] = derived
                result["contact_source"] = "email_derived"

    return result


def _is_plausible_name(candidate: str) -> bool:
    """Reject captures that are action verbs or single-token values."""
    tokens = candidate.split()
    if len(tokens) < 2:
        return False
    lowered = {t.lower().strip(".,") for t in tokens}
    if lowered & REJECTED_NAME_TOKENS:
        return False
    return True


def _find_labeled_name(description: str) -> tuple[Optional[str], Optional[int]]:
    """Return (name, match_end_index) from first labeled-pattern hit, else (None, None).

    Walks every label occurrence; the first that's followed by a plausible
    name wins. This tolerates false-label hits that don't precede real names.
    """
    for label_match in LABEL_RE.finditer(description):
        name_match = NAME_RE.match(description, label_match.end())
        if not name_match:
            continue
        candidate = name_match.group(0).strip()
        if _is_plausible_name(candidate):
            return (candidate, name_match.end())
    return (None, None)


def _find_first_personal_email(description: str, employer_name: str) -> str:
    for match in EMAIL_RE.finditer(description):
        candidate = match.group(0)
        if is_personal_email(candidate, employer_name):
            return candidate
    return ""


def _derive_name_from_local_part(email: str) -> str:
    """Return 'First Last' from 'first.last@...' or empty if not derivable."""
    local, _, _domain = email.partition("@")
    local = local.replace("_", ".")
    tokens = [t for t in local.split(".") if t]
    if len(tokens) < 2:
        return ""
    return " ".join(t[:1].upper() + t[1:].lower() for t in tokens)
