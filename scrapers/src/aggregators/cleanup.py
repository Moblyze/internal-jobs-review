"""
Data cleanup and normalization functions for aggregator job data.

Standardizes locations, employment types, dates, salaries, and extracts
certifications from job descriptions. All functions use standard library only.
"""

import re
import html
from datetime import datetime


# ---------------------------------------------------------------------------
# US state name -> abbreviation mapping
# ---------------------------------------------------------------------------

US_STATES: dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC",
}

# Reverse lookup: abbreviation -> abbreviation (for validation)
US_STATE_ABBREVS: set[str] = set(US_STATES.values())

# Common US county suffixes to detect and strip county names
_COUNTY_RE = re.compile(
    r",\s*(?:\w+\s+)?county\b", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Company-name-in-location detection
# ---------------------------------------------------------------------------

# Corporate suffixes that indicate a string is a company name, not a location.
# Sorted longest-first so regex alternation prefers longer matches.
_CORPORATE_SUFFIXES = [
    "Limited Liability Company",
    "Proprietary Limited",
    "Pty Ltd",
    "Pty. Ltd.",
    "Corp.",
    "Corp",
    "Inc.",
    "Inc",
    "LLC",
    "L.L.C.",
    "Ltd.",
    "Ltd",
    "LLP",
    "L.L.P.",
    "GmbH",
    "S.A.",
    "S.A",
    "S.r.l.",
    "S.r.l",
    "B.V.",
    "B.V",
    "BV",
    "N.V.",
    "N.V",
    "NV",
    "AG",
    "SE",
    "PLC",
    "Plc",
    "P.L.C.",
    "Pty",
    "A/S",
    "AS",
    "GmbH & Co. KG",
    "Co.",
    "Company",
    "& Co",
    "Group",
    "Holdings",
    "Solutions",
    "Services",
    "Enterprises",
    "International",
    "Technologies",
    "Engineering",
    "Industries",
    "Corporation",
    "Associates",
    "Consulting",
    "Partners",
]

# Build a regex pattern from the suffixes (case-insensitive, word boundary)
_CORPORATE_SUFFIX_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(s) for s in _CORPORATE_SUFFIXES) + r")\s*$",
    re.IGNORECASE,
)


def _strings_similar(a: str, b: str, threshold: float = 0.7) -> bool:
    """Check if two strings are similar using character-level overlap.

    Uses Jaccard similarity on character trigrams. Returns True if the
    similarity score exceeds the threshold.
    """
    if not a or not b:
        return False
    a_lower = a.lower().strip()
    b_lower = b.lower().strip()

    # Exact match
    if a_lower == b_lower:
        return True

    # One is a substring of the other
    if a_lower in b_lower or b_lower in a_lower:
        return True

    # Trigram similarity
    def trigrams(s: str) -> set[str]:
        return {s[i:i+3] for i in range(max(len(s) - 2, 1))}

    t_a = trigrams(a_lower)
    t_b = trigrams(b_lower)
    if not t_a or not t_b:
        return False

    intersection = len(t_a & t_b)
    union = len(t_a | t_b)
    return (intersection / union) >= threshold


def looks_like_company_name(location: str, company: str = "") -> bool:
    """Detect if a location string is actually a company name.

    Returns True if:
    - The string ends with a corporate suffix (LLC, Inc, Corp, Ltd, etc.)
    - The string is very similar to the job's company name

    Args:
        location: The location string to check.
        company: The job's company name for similarity comparison.
    """
    if not location or not location.strip():
        return False

    loc = location.strip()

    # Check for corporate suffixes
    if _CORPORATE_SUFFIX_RE.search(loc):
        return True

    # Check similarity to company name
    if company and _strings_similar(loc, company):
        return True

    return False


def sanitize_location(location: str, company: str = "") -> str:
    """Clean a location string, replacing company names with 'Unknown'.

    Call this before or instead of normalize_location() to catch company
    names that were accidentally placed in the location field.

    Args:
        location: Raw location string from scraper.
        company: The job's company name (for similarity check).

    Returns:
        The original location if it looks valid, or 'Unknown' if it
        looks like a company name.
    """
    if not location or not location.strip():
        return "Unknown"

    if looks_like_company_name(location, company):
        return "Unknown"

    return location


def normalize_location(location: str) -> str:
    """Standardize location to 'City, State' (US) or 'City, Country' (intl).

    Examples:
        'Houston, Harris County'     -> 'Houston, TX'
        'Houston, Texas, USA'        -> 'Houston, TX'
        'Aberdeen, United Kingdom'   -> 'Aberdeen, United Kingdom'
        'Various Locations'          -> 'Various Locations'
        'Texas'                      -> 'Texas'
    """
    if not location or not location.strip():
        return ""

    location = location.strip()

    # Pass through vague/multi-location strings
    lower = location.lower()
    if lower in ("various locations", "remote", "multiple locations", "nationwide"):
        return location

    parts = [p.strip() for p in location.split(",") if p.strip()]

    if len(parts) == 1:
        # Single token -- could be a state name or city, leave as-is
        return location

    # Strip trailing "USA" / "US" / "United States"
    is_us = False
    if parts[-1].lower() in ("usa", "us", "united states", "united states of america"):
        is_us = True
        parts = parts[:-1]

    if not parts:
        return location

    # Check if last part is a US state name or abbreviation
    last = parts[-1]
    last_lower = last.lower()

    if last_lower in US_STATES:
        abbrev = US_STATES[last_lower]
        is_us = True
    elif last.upper() in US_STATE_ABBREVS:
        abbrev = last.upper()
        is_us = True
    else:
        abbrev = None

    if is_us and abbrev and len(parts) >= 2:
        # Take the city (first part), strip any county suffix
        city = parts[0]
        city = _COUNTY_RE.sub("", city).strip()
        return f"{city}, {abbrev}"

    # Handle county-only second part: "Houston, Harris County"
    if len(parts) == 2 and re.search(r"\bcounty\b", parts[1], re.IGNORECASE):
        # Strip county name and return just the city
        # Adzuna commonly returns "City, County" for US locations
        return parts[0]

    # International or unresolved -- rejoin cleaned parts
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Employment type normalization
# ---------------------------------------------------------------------------

_EMPLOYMENT_TYPE_MAP: dict[str, str] = {
    "contract": "Contract",
    "contract_time": "Contract",
    "contractor": "Contract",
    "temp": "Temporary",
    "temporary": "Temporary",
    "perm": "Full-time",
    "permanent": "Full-time",
    "full-time": "Full-time",
    "full time": "Full-time",
    "fulltime": "Full-time",
    "part-time": "Part-time",
    "part time": "Part-time",
    "parttime": "Part-time",
    "temp to direct": "Temp-to-Hire",
    "temp-to-hire": "Temp-to-Hire",
    "temp to hire": "Temp-to-Hire",
    "temp-to-direct": "Temp-to-Hire",
    "contract to hire": "Temp-to-Hire",
    "contract-to-hire": "Temp-to-Hire",
}


def normalize_employment_type(emp_type: str | None) -> str:
    """Map employment type string to a standard value.

    Returns one of: Contract, Temporary, Full-time, Part-time,
    Temp-to-Hire, or Unknown.
    """
    if not emp_type or not emp_type.strip():
        return "Unknown"

    key = emp_type.strip().lower()
    return _EMPLOYMENT_TYPE_MAP.get(key, "Unknown")


# ---------------------------------------------------------------------------
# Date normalization
# ---------------------------------------------------------------------------

def normalize_date(date_str: str | None) -> str:
    """Normalize a date string to YYYY-MM-DD format.

    Handles ISO 8601 with timezone offsets, 'Z' suffix, and plain dates.
    Returns empty string for None/empty input.
    """
    if not date_str or not date_str.strip():
        return ""

    date_str = date_str.strip()

    # Already in YYYY-MM-DD format
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
        return date_str

    # Strip timezone offset (+00:00, -05:00, etc.) or Z suffix
    cleaned = re.sub(r"[Zz]$", "", date_str)
    cleaned = re.sub(r"[+-]\d{2}:\d{2}$", "", cleaned)
    # Strip fractional seconds (.123456)
    cleaned = re.sub(r"\.\d+$", "", cleaned)

    # Try parsing ISO-like formats
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue

    # Fallback: return original if we can't parse
    return date_str


# ---------------------------------------------------------------------------
# HTML stripping
# ---------------------------------------------------------------------------

def strip_html(text: str) -> str:
    """Remove HTML tags, decode entities, and normalize whitespace.

    Returns a clean plain-text string with no leading/trailing whitespace.
    """
    if not text:
        return ""

    # Remove HTML tags
    cleaned = re.sub(r"<[^>]+>", " ", text)

    # Decode HTML entities (&amp; -> &, etc.)
    cleaned = html.unescape(cleaned)

    # Collapse whitespace (spaces, tabs, newlines) to single space
    cleaned = re.sub(r"\s+", " ", cleaned)

    return cleaned.strip()


# ---------------------------------------------------------------------------
# Certification extraction
# ---------------------------------------------------------------------------

# Each entry is (compiled regex, label or callable that takes the match).
_CERT_PATTERNS: list[tuple[re.Pattern, str | None]] = [
    # IRATA with optional level
    (re.compile(r"\bIRATA\s+Level\s+([1-3])\b", re.IGNORECASE), None),
    (re.compile(r"\bIRATA\b", re.IGNORECASE), "IRATA"),

    # CSWIP with optional sub-code
    (re.compile(r"\bCSWIP\s+(3\.\d)\b", re.IGNORECASE), None),
    (re.compile(r"\bCSWIP\b", re.IGNORECASE), "CSWIP"),

    # OPITO-related
    (re.compile(r"\bBOSIET\b", re.IGNORECASE), "BOSIET"),
    (re.compile(r"\bHUET\b", re.IGNORECASE), "HUET"),
    (re.compile(r"\bMIST\b", re.IGNORECASE), "MIST"),
    (re.compile(r"\bOPITO\b", re.IGNORECASE), "OPITO"),

    # NEBOSH with optional sub-code
    (re.compile(r"\bNEBOSH\s+(IGC)\b", re.IGNORECASE), None),
    (re.compile(r"\bNEBOSH\b", re.IGNORECASE), "NEBOSH"),

    # COMPEX with optional sub-code
    (re.compile(r"\bCOMPEX\s+(Ex0[1-4])\b", re.IGNORECASE), None),
    (re.compile(r"\bCOMPEX\b", re.IGNORECASE), "COMPEX"),

    # GWO
    (re.compile(r"\bGWO\b", re.IGNORECASE), "GWO"),
    (re.compile(r"\bGlobal\s+Wind\s+Organisation\b", re.IGNORECASE), "GWO"),

    # NACE CIP
    (re.compile(r"\bNACE\s+CIP\s+Level\s+([1-3])\b", re.IGNORECASE), None),
    (re.compile(r"\bNACE\b", re.IGNORECASE), "NACE"),

    # Construction cards
    (re.compile(r"\bSSSTS\b", re.IGNORECASE), "SSSTS"),
    (re.compile(r"\bSMSTS\b", re.IGNORECASE), "SMSTS"),
    (re.compile(r"\bCSCS\b", re.IGNORECASE), "CSCS"),

    # CDL
    (re.compile(r"\bCDL-A\b", re.IGNORECASE), "CDL-A"),
    (re.compile(r"\bCDL-B\b", re.IGNORECASE), "CDL-B"),
    (re.compile(r"\bCDL\b", re.IGNORECASE), "CDL"),

    # OSHA
    (re.compile(r"\bOSHA\s+30\b", re.IGNORECASE), "OSHA 30"),
    (re.compile(r"\bOSHA\s+10\b", re.IGNORECASE), "OSHA 10"),

    # API codes
    (re.compile(r"\bAPI\s+510\b", re.IGNORECASE), "API 510"),
    (re.compile(r"\bAPI\s+570\b", re.IGNORECASE), "API 570"),
    (re.compile(r"\bAPI\s+580\b", re.IGNORECASE), "API 580"),
    (re.compile(r"\bAPI\s+653\b", re.IGNORECASE), "API 653"),

    # ASNT / NDT methods
    (re.compile(r"\bASNT\s+Level\s+(I{1,3})\b", re.IGNORECASE), None),
    (re.compile(r"\bASNT\b", re.IGNORECASE), "ASNT"),
    (re.compile(r"\bNDT\b", re.IGNORECASE), "NDT"),
    (re.compile(r"\b(?:RT|Radiographic\s+Testing)\b", re.IGNORECASE), "RT"),
    (re.compile(r"\bUT\b", re.IGNORECASE), "UT"),
    (re.compile(r"\bMT\b", re.IGNORECASE), "MT"),
    (re.compile(r"\bPT\b", re.IGNORECASE), "PT"),

    # Other
    (re.compile(r"\bPMP\b"), "PMP"),
    (re.compile(r"\bTWIC\b", re.IGNORECASE), "TWIC"),
    (re.compile(r"\bH2S\b", re.IGNORECASE), "H2S"),
    (re.compile(r"\bFirst\s+Aid\b", re.IGNORECASE), "First Aid"),
    (re.compile(r"\bCPR\b", re.IGNORECASE), "CPR"),
]


def extract_certifications(description: str) -> list[str]:
    """Extract known certifications from job description text.

    Uses word-boundary regex matching to avoid false positives.
    Returns a unique, sorted list of certification strings.
    """
    if not description:
        return []

    found: set[str] = set()

    for pattern, label in _CERT_PATTERNS:
        for match in pattern.finditer(description):
            if label is not None:
                found.add(label)
            else:
                # Build label from the full match text
                full = match.group(0).strip()
                # Normalize casing for known prefixes
                if full.upper().startswith("IRATA"):
                    level = match.group(1)
                    found.add(f"IRATA Level {level}")
                elif full.upper().startswith("CSWIP"):
                    code = match.group(1)
                    found.add(f"CSWIP {code}")
                elif full.upper().startswith("NEBOSH"):
                    sub = match.group(1).upper()
                    found.add(f"NEBOSH {sub}")
                elif full.upper().startswith("COMPEX"):
                    sub = match.group(1)
                    found.add(f"COMPEX {sub}")
                elif full.upper().startswith("NACE"):
                    level = match.group(1)
                    found.add(f"NACE CIP Level {level}")
                elif full.upper().startswith("ASNT"):
                    level = match.group(1).upper()
                    found.add(f"ASNT Level {level}")
                else:
                    found.add(full)

    return sorted(found)


# ---------------------------------------------------------------------------
# Salary normalization
# ---------------------------------------------------------------------------

# Pattern: "$71,040 - $71,040" or "$36 - $40 per hour" etc.
_SALARY_RANGE_RE = re.compile(
    r"\$\s*([\d,]+(?:\.\d+)?[kK]?)"   # min value
    r"\s*[-\u2013]\s*"                  # dash separator
    r"\$\s*([\d,]+(?:\.\d+)?[kK]?)"    # max value
    r"(?:\s*(?:per\s+)?(hour|hr|year|yr|annual|annually))?" ,  # optional period
    re.IGNORECASE,
)

_SINGLE_SALARY_RE = re.compile(
    r"\$\s*([\d,]+(?:\.\d+)?[kK]?)"
    r"(?:\s*(?:per\s+)?(hour|hr|year|yr|annual|annually))?",
    re.IGNORECASE,
)


def _normalize_period(period: str | None) -> str:
    """Map period text to /hr or /yr."""
    if not period:
        return ""
    p = period.lower().strip()
    if p in ("hour", "hr"):
        return "/hr"
    if p in ("year", "yr", "annual", "annually"):
        return "/yr"
    return ""


def _strip_commas(val: str) -> str:
    return val.replace(",", "")


def normalize_salary(salary_str: str | None) -> str:
    """Light cleanup and normalization of salary strings.

    Examples:
        '$71,040 - $71,040'       -> '$71,040/yr'
        '$36 - $40 per hour'      -> '$36-$40/hr'
        '$99.2k - $138.88k'       -> '$99.2k-$138.88k/yr'
        None                      -> ''
    """
    if not salary_str or not salary_str.strip():
        return ""

    salary_str = salary_str.strip()

    m = _SALARY_RANGE_RE.search(salary_str)
    if m:
        lo, hi, period = m.group(1), m.group(2), m.group(3)
        period_str = _normalize_period(period)

        # Infer period from magnitude if not explicit
        if not period_str:
            # If values contain 'k' or are large numbers, assume yearly
            lo_clean = _strip_commas(lo.lower().rstrip("k"))
            try:
                lo_val = float(lo_clean)
                if "k" in lo.lower() or lo_val > 500:
                    period_str = "/yr"
                elif lo_val < 500:
                    period_str = "/hr"
            except ValueError:
                pass

        # Collapse identical min/max
        if lo == hi:
            return f"${lo}{period_str}"

        return f"${lo}-${hi}{period_str}"

    # Not a range -- return original
    return salary_str


# ---------------------------------------------------------------------------
# Full job dict cleanup
# ---------------------------------------------------------------------------

def cleanup_job(job_dict: dict) -> dict:
    """Apply all normalization functions to a raw job dict.

    Expects keys matching the export_aggregator_jobs.py output format.
    Returns a new dict with cleaned values (does not mutate the input).
    """
    cleaned = dict(job_dict)

    # Text fields -- strip_html on description
    if "description" in cleaned:
        cleaned["description"] = strip_html(cleaned.get("description") or "")

    # Location -- sanitize first (catch company names), then normalize
    if "location" in cleaned:
        company = cleaned.get("company") or ""
        cleaned["location"] = normalize_location(
            sanitize_location(cleaned.get("location") or "", company)
        )

    # Employment type
    if "employment_type" in cleaned:
        cleaned["employment_type"] = normalize_employment_type(
            cleaned.get("employment_type")
        )

    # Dates
    if "posted_date" in cleaned:
        cleaned["posted_date"] = normalize_date(cleaned.get("posted_date"))
    if "scraped_at" in cleaned:
        cleaned["scraped_at"] = normalize_date(cleaned.get("scraped_at"))
    if "status_changed_date" in cleaned:
        cleaned["status_changed_date"] = normalize_date(
            cleaned.get("status_changed_date")
        )

    # Salary
    if "salary" in cleaned:
        cleaned["salary"] = normalize_salary(cleaned.get("salary"))

    # Extract certifications from the (already cleaned) description
    # Merge with any existing certifications from the source
    desc = cleaned.get("description") or ""
    extracted = extract_certifications(desc)
    existing = cleaned.get("certifications") or ""
    if isinstance(existing, str) and existing:
        existing_list = [c.strip() for c in existing.replace(",", ";").split(";") if c.strip()]
    elif isinstance(existing, list):
        existing_list = existing
    else:
        existing_list = []
    merged = sorted(set(existing_list + extracted))
    cleaned["certifications"] = "; ".join(merged)

    # Trim simple string fields
    for key in ("title", "company", "url", "source", "profile", "status"):
        if key in cleaned and isinstance(cleaned[key], str):
            cleaned[key] = cleaned[key].strip()

    return cleaned
