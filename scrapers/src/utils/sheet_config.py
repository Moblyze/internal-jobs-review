"""Where the "Job Scraping Results" spreadsheet lives (Nov 10, 2026).

The original spreadsheet (1xb3Q...) hit Google's size wall on Nov 5, 2026
("document is too large to edit"). It is kept, frozen and renamed, as a
fallback. Live rows moved to a NEW spreadsheet, and removed rows go to the
archive spreadsheet. Every reader and writer opens these by ID: opening by
name would pick whichever file with that title Drive returns first, which can
silently split writes across two sheets.

Override with GOOGLE_SHEETS_SPREADSHEET_ID / GOOGLE_SHEETS_ARCHIVE_SPREADSHEET_ID.
"""

import os

JOBS_SPREADSHEET_ID = '1MIaxJRCCoXI2ndethvbY_1XDjjcbIKJkuxkOaGv38IA'
ARCHIVE_SPREADSHEET_ID = '1hG21eAhd4iYqieZvDMbLECL3yDFBFRLrygdxCdpe6VE'
# Frozen at Nov 5, 2026. Never write to it.
FROZEN_SPREADSHEET_ID = '1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y'


def jobs_spreadsheet_id() -> str:
    return os.getenv('GOOGLE_SHEETS_SPREADSHEET_ID') or JOBS_SPREADSHEET_ID


def archive_spreadsheet_id() -> str:
    return os.getenv('GOOGLE_SHEETS_ARCHIVE_SPREADSHEET_ID') or ARCHIVE_SPREADSHEET_ID


def open_jobs_spreadsheet(client, retry=None):
    """gspread Spreadsheet for the live jobs sheet, opened by ID."""
    sid = jobs_spreadsheet_id()
    if sid == FROZEN_SPREADSHEET_ID:
        raise RuntimeError('Refusing to open the frozen Nov 5, 2026 jobs spreadsheet for live work')
    return retry(client.open_by_key, sid) if retry else client.open_by_key(sid)


def open_archive_spreadsheet(client, retry=None):
    sid = archive_spreadsheet_id()
    return retry(client.open_by_key, sid) if retry else client.open_by_key(sid)
