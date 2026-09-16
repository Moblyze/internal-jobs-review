"""Pull a pay rate out of a job description, with its period attached.

WHY THIS EXISTS (2026-09-16)
----------------------------
The Workday API scraper matched pay with:

    r'\\$[\\d,]+(?:\\s*-\\s*\\$?[\\d,]+)?(?:\\s*(?:per|/)\\s*(?:year|hour|yr|hr))?'

which has two defects that put wrong pay on the public site:

1. ``[\\d,]+`` does not include a decimal point, so "$44.68/hour" matched as
   "$44" -- the match stopped dead at the period. The sheet, the feed and
   jobs.moblyze.me then showed "$44" for a job that pays $44.68 an hour.
2. The period group was OPTIONAL, so a bare "$44" was a perfectly good match.
   3,925 of the 6,453 feed rows carrying a salary state no period at all. An
   amount with no period is not just incomplete, it is unusable: the site
   cannot turn it into a JobPosting ``baseSalary`` (Google requires a unit), and
   "$44" on a page is ambiguous between an hourly rate and a daily one.

So: capture decimals, and REQUIRE a period. A row with no recoverable period is
better left empty than filled with half a number, because the site treats a
present salary as something it can show.

The regex also took the first ``$`` in the description, which in a US posting is
often a benefit ("$5,000 tuition reimbursement"), so an amount qualified as a
benefit or a premium is rejected. This mirrors the same discipline applied on
the site side in ``jobs-moblyze-me/src/lib/market/salary-from-description.ts``;
the two are deliberately the same shape, since they solve the same problem at
different ends of the pipe.
"""

import re
from typing import Optional

# An amount with an explicit period. The period is required, and decimals are
# part of the number rather than a place for the match to stop.
_AMOUNT = re.compile(
    r'(?:[$£€]|\b(?:USD|GBP|EUR)\s?)'          # currency
    r'\s?\d[\d,]*(?:\.\d+)?'                    # amount, decimals included
    r'(?:\s*(?:-|–|—|to)\s*(?:[$£€]\s?)?\d[\d,]*(?:\.\d+)?)?'   # optional range
    r'\s*(?:per\s+|/\s*|a\s+|an\s+)?'           # optional connector
    r'(hourly|hour|hr|daily|day|weekly|week|wk|monthly|month|mo|annually|annum|yearly|year|yr)\b',
    re.IGNORECASE,
)

# Words meaning the amount is not the job's base pay.
_NOT_BASE_PAY = re.compile(
    r'\b(differential|per\s?diem|bonus|overtime|premium|allowance|stipend|'
    r'sign[-\s]?on|signing|relocation|referral|tuition|reimburse\w*|'
    r'401\s?\(?k\)?|pension|scholarship|discount|savings|incentive)\b',
    re.IGNORECASE,
)

# Plausible pay by period. Outside these the match is not pay.
_BOUNDS = {
    'HOUR': (10, 250),
    'DAY': (100, 3000),
    'WEEK': (300, 10000),
    'MONTH': (1000, 60000),
    'YEAR': (20000, 600000),
}

_PERIOD_TO_UNIT = {
    'hourly': 'HOUR', 'hour': 'HOUR', 'hr': 'HOUR',
    'daily': 'DAY', 'day': 'DAY',
    'weekly': 'WEEK', 'week': 'WEEK', 'wk': 'WEEK',
    'monthly': 'MONTH', 'month': 'MONTH', 'mo': 'MONTH',
    'annually': 'YEAR', 'annum': 'YEAR', 'yearly': 'YEAR', 'year': 'YEAR', 'yr': 'YEAR',
}

# How much text either side of the amount is inspected for a disqualifier.
_CONTEXT = 70


def extract_salary(description: Optional[str]) -> Optional[str]:
    """The pay a description states, exactly as written, or None.

    Returns the matched text rather than a normalized amount, so downstream
    keeps showing pay the way the employer stated it.
    """
    if not description:
        return None
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', description))
    if not text.strip():
        return None

    for match in _AMOUNT.finditer(text):
        matched = match.group(0).strip()
        start, end = match.start(), match.end()
        before = text[max(0, start - _CONTEXT):start]
        after = text[end:end + _CONTEXT]
        if _NOT_BASE_PAY.search(before) or _NOT_BASE_PAY.search(after):
            continue

        unit = _PERIOD_TO_UNIT.get(match.group(1).lower())
        if not unit:
            continue
        low, high = _BOUNDS[unit]
        values = [
            float(n.replace(',', ''))
            for n in re.findall(r'\d[\d,]*(?:\.\d+)?', matched)
        ]
        if not values or any(v < low or v > high for v in values):
            continue
        return matched
    return None
