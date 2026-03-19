"""Update Source Coverage Matrix and Target Companies worksheets in Google Sheets.

Reads all company worksheets from the scraper spreadsheet, builds a companies x sources
matrix showing job counts, and writes/updates the "Source Coverage Matrix" and
"Target Companies" worksheets.

Designed to run after each scrape as part of the daily workflow.

Usage:
    python scripts/update_source_matrix.py
    python scripts/update_source_matrix.py --dry-run

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH - path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME - spreadsheet name
"""

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError, WorksheetNotFound

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Google Sheets API scopes
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

# Worksheets to skip when reading job data
SKIP_SHEETS = {
    'Overview',
    'Source Coverage Matrix',
    'Target Companies',
    'Aggregator Jobs',
    'Template',
}

# Aggregator spreadsheet ID (same as export-jobs.js)
AGGREGATOR_SPREADSHEET_ID = '1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y'

# Path to companies.json (relative to repo root)
COMPANIES_JSON_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'public', 'data', 'companies.json'
)


def authenticate(credentials_path: str):
    """Authenticate with Google Sheets API and return client + spreadsheet."""
    credentials = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)
    client = gspread.authorize(credentials)
    return client


def read_employer_jobs(spreadsheet) -> list[dict]:
    """Read all job data from employer worksheets."""
    jobs = []

    for ws in spreadsheet.worksheets():
        title = ws.title
        if title in SKIP_SHEETS:
            continue

        try:
            all_values = ws.get_all_values()
        except APIError as e:
            logger.warning(f'Failed to read worksheet {title}: {e}')
            continue

        if len(all_values) <= 1:
            continue

        headers = all_values[0]

        # Build column index map
        col_map = {h: i for i, h in enumerate(headers)}
        if 'URL' not in col_map or 'Title' not in col_map:
            logger.debug(f'Skipping {title}: missing required columns')
            continue

        company_col = col_map.get('Company')
        status_col = col_map.get('Status')
        scraped_col = col_map.get('Scraped At')

        for row in all_values[1:]:
            if len(row) <= col_map['URL'] or not row[col_map['URL']]:
                continue

            company = row[company_col] if company_col is not None and len(row) > company_col else title
            status = row[status_col] if status_col is not None and len(row) > status_col else 'active'
            scraped_at = row[scraped_col] if scraped_col is not None and len(row) > scraped_col else ''

            jobs.append({
                'company': company or title,
                'source': 'direct',
                'status': status or 'active',
                'scraped_at': scraped_at,
            })

    logger.info(f'Read {len(jobs)} employer jobs from {spreadsheet.title}')
    return jobs


def read_aggregator_jobs(client) -> list[dict]:
    """Read jobs from the aggregator spreadsheet."""
    jobs = []

    try:
        spreadsheet = client.open_by_key(AGGREGATOR_SPREADSHEET_ID)
        ws = spreadsheet.worksheet('Aggregator Jobs')
    except (WorksheetNotFound, gspread.exceptions.SpreadsheetNotFound) as e:
        logger.warning(f'Could not open aggregator spreadsheet: {e}')
        return jobs

    try:
        all_values = ws.get_all_values()
    except APIError as e:
        logger.warning(f'Failed to read aggregator worksheet: {e}')
        return jobs

    if len(all_values) <= 1:
        return jobs

    headers = all_values[0]
    col_map = {h: i for i, h in enumerate(headers)}

    company_col = col_map.get('Company', 2)
    source_col = col_map.get('Source', 6)
    status_col = col_map.get('Status', 13)
    scraped_col = col_map.get('Scraped At', 15)

    for row in all_values[1:]:
        if len(row) <= 5:
            continue

        company = row[company_col] if len(row) > company_col else ''
        source = row[source_col] if len(row) > source_col else ''
        status = row[status_col] if len(row) > status_col else 'active'
        scraped_at = row[scraped_col] if len(row) > scraped_col else ''

        if not company:
            continue

        jobs.append({
            'company': company,
            'source': source or 'unknown',
            'status': status or 'active',
            'scraped_at': scraped_at,
        })

    logger.info(f'Read {len(jobs)} aggregator jobs')
    return jobs


def build_source_matrix(jobs: list[dict]):
    """Build the companies x sources matrix from job data."""
    # Filter to active jobs
    active_jobs = [j for j in jobs if j['status'] not in ('removed', 'paused')]
    logger.info(f'Active jobs: {len(active_jobs)} of {len(jobs)} total')

    # Count jobs per company per source
    company_source_counts = defaultdict(lambda: defaultdict(int))
    source_set = set()

    for job in active_jobs:
        company = job['company']
        source = job['source']
        company_source_counts[company][source] += 1
        source_set.add(source)

    # Sort sources: 'direct' first, then alphabetically
    sources = sorted(source_set, key=lambda s: (0 if s == 'direct' else 1, s))

    # Sort companies by total job count descending
    company_totals = {
        c: sum(counts.values())
        for c, counts in company_source_counts.items()
    }
    companies = sorted(company_totals.keys(), key=lambda c: -company_totals[c])

    # Build rows
    header_row = ['Company'] + sources + ['Total']
    data_rows = []
    column_totals = [0] * len(sources)
    grand_total = 0

    for company in companies:
        row = [company]
        company_total = 0
        for i, source in enumerate(sources):
            count = company_source_counts[company].get(source, 0)
            row.append(count)
            column_totals[i] += count
            company_total += count
        row.append(company_total)
        grand_total += company_total
        data_rows.append(row)

    totals_row = ['TOTAL'] + column_totals + [grand_total]

    return {
        'header_row': header_row,
        'data_rows': data_rows,
        'totals_row': totals_row,
        'sources': sources,
        'companies': companies,
    }


def build_target_companies(jobs: list[dict], target_companies: list[dict]):
    """Build the target companies worksheet data."""
    if not target_companies:
        return None

    # Build name lookup including brand variations
    name_to_target = {}
    for tc in target_companies:
        name_to_target[tc['name'].lower()] = tc
        for variant in tc.get('brandVariations', []):
            name_to_target[variant.lower()] = tc

    active_jobs = [j for j in jobs if j['status'] not in ('removed', 'paused')]

    # Count per target company per source
    company_counts = defaultdict(lambda: defaultdict(int))
    last_scraped = {}

    for job in active_jobs:
        target = name_to_target.get(job['company'].lower())
        if not target:
            continue

        name = target['name']
        source = job['source']
        company_counts[name][source] += 1

        scraped = job.get('scraped_at', '')
        if scraped and (name not in last_scraped or scraped > last_scraped[name]):
            last_scraped[name] = scraped

    # Collect sources for target companies
    source_set = set()
    for counts in company_counts.values():
        source_set.update(counts.keys())
    sources = sorted(source_set, key=lambda s: (0 if s == 'direct' else 1, s))

    # Build rows
    header_row = ['Company'] + sources + ['Total', 'ATS Platform', 'Careers URL', 'Last Scraped']
    data_rows = []

    for tc in target_companies:
        counts = company_counts.get(tc['name'], {})
        row = [tc['name']]

        total = 0
        for src in sources:
            count = counts.get(src, 0)
            row.append(count)
            total += count

        ats_platform = tc.get('ats', [{}])[0].get('platform', '') if tc.get('ats') else ''
        careers_url = tc.get('careersUrl', '')
        last_date = last_scraped.get(tc['name'], '')
        if last_date and 'T' in last_date:
            last_date = last_date.split('T')[0]

        row.extend([total, ats_platform, careers_url, last_date])
        data_rows.append(row)

    return {
        'header_row': header_row,
        'data_rows': data_rows,
        'sources': sources,
    }


def write_matrix_to_sheet(spreadsheet, matrix: dict):
    """Write the source coverage matrix to a worksheet."""
    sheet_name = 'Source Coverage Matrix'
    header_row = matrix['header_row']
    data_rows = matrix['data_rows']
    totals_row = matrix['totals_row']

    total_rows = 1 + len(data_rows) + 1 + 1  # header + data + blank + totals
    total_cols = len(header_row)

    # Get or create worksheet
    try:
        ws = spreadsheet.worksheet(sheet_name)
        ws.clear()
        # Resize if needed
        if ws.row_count < total_rows + 5:
            ws.resize(rows=total_rows + 10, cols=total_cols + 2)
    except WorksheetNotFound:
        ws = spreadsheet.add_worksheet(
            title=sheet_name,
            rows=total_rows + 10,
            cols=total_cols + 2,
        )

    # Assemble all rows
    all_rows = [header_row] + data_rows + [[]] + [totals_row]

    # Write data
    def col_to_letter(idx):
        letter = ''
        while idx >= 0:
            letter = chr(idx % 26 + ord('A')) + letter
            idx = idx // 26 - 1
        return letter

    last_col = col_to_letter(total_cols - 1)
    range_notation = f'A1:{last_col}{len(all_rows)}'

    ws.update(values=all_rows, range_name=range_notation, value_input_option='RAW')

    # Bold header row
    ws.format(f'A1:{last_col}1', {'textFormat': {'bold': True}})

    # Bold totals row
    totals_row_num = len(all_rows)
    ws.format(f'A{totals_row_num}:{last_col}{totals_row_num}', {'textFormat': {'bold': True}})

    # Freeze row 1 and column A
    ws.freeze(rows=1, cols=1)

    logger.info(
        f'Wrote {sheet_name}: {len(data_rows)} companies x {len(matrix["sources"])} sources'
    )


def write_target_companies_to_sheet(spreadsheet, target_data: dict):
    """Write the target companies data to a worksheet."""
    if not target_data:
        logger.info('Skipping Target Companies (no data)')
        return

    sheet_name = 'Target Companies'
    header_row = target_data['header_row']
    data_rows = target_data['data_rows']

    total_rows = 1 + len(data_rows) + 5
    total_cols = len(header_row)

    try:
        ws = spreadsheet.worksheet(sheet_name)
        ws.clear()
        if ws.row_count < total_rows:
            ws.resize(rows=total_rows, cols=total_cols + 2)
    except WorksheetNotFound:
        ws = spreadsheet.add_worksheet(
            title=sheet_name,
            rows=total_rows,
            cols=total_cols + 2,
        )

    all_rows = [header_row] + data_rows

    def col_to_letter(idx):
        letter = ''
        while idx >= 0:
            letter = chr(idx % 26 + ord('A')) + letter
            idx = idx // 26 - 1
        return letter

    last_col = col_to_letter(total_cols - 1)
    range_notation = f'A1:{last_col}{len(all_rows)}'

    ws.update(values=all_rows, range_name=range_notation, value_input_option='RAW')

    # Bold header
    ws.format(f'A1:{last_col}1', {'textFormat': {'bold': True}})

    # Freeze row 1 and column A
    ws.freeze(rows=1, cols=1)

    logger.info(f'Wrote {sheet_name}: {len(data_rows)} companies')


def print_matrix(matrix: dict):
    """Print the matrix to console (dry-run mode)."""
    header = matrix['header_row']
    data = matrix['data_rows']
    totals = matrix['totals_row']

    all_rows = [header] + data + [totals]
    col_widths = [
        max(len(str(row[i])) for row in all_rows if i < len(row))
        for i in range(len(header))
    ]

    def fmt_row(row):
        parts = []
        for i, cell in enumerate(row):
            s = str(cell)
            if i == 0:
                parts.append(s.ljust(col_widths[i]))
            else:
                parts.append(s.rjust(col_widths[i]))
        return '  '.join(parts)

    print('\n' + '=' * 80)
    print('SOURCE COVERAGE MATRIX')
    print('=' * 80)
    print(fmt_row(header))
    print('-' * 80)
    for row in data:
        print(fmt_row(row))
    print('-' * 80)
    print(fmt_row(totals))
    print('=' * 80)


def main():
    parser = argparse.ArgumentParser(description='Update Source Coverage Matrix in Google Sheets')
    parser.add_argument('--dry-run', action='store_true', help='Print matrix to console without writing to Sheets')
    args = parser.parse_args()

    # Load credentials
    credentials_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH')
    if not credentials_path and not args.dry_run:
        print('Error: GOOGLE_SERVICE_ACCOUNT_PATH env var not set')
        sys.exit(1)

    spreadsheet_name = os.getenv('GOOGLE_SHEETS_SPREADSHEET_NAME', 'Job Scraping Results')

    # Load target companies
    target_companies = []
    if os.path.exists(COMPANIES_JSON_PATH):
        with open(COMPANIES_JSON_PATH) as f:
            data = json.load(f)
            target_companies = data.get('companies', [])
        logger.info(f'Loaded {len(target_companies)} target companies from companies.json')
    else:
        logger.warning(f'companies.json not found at {COMPANIES_JSON_PATH}')

    if args.dry_run:
        # In dry-run mode, try to read from jobs-index.json instead of Sheets
        jobs_index_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            '..', '..', 'public', 'data', 'jobs-index.json'
        )

        if os.path.exists(jobs_index_path):
            with open(jobs_index_path) as f:
                index_jobs = json.load(f)
            logger.info(f'Loaded {len(index_jobs)} jobs from jobs-index.json (dry-run)')

            # Convert to our internal format
            jobs = []
            for j in index_jobs:
                jobs.append({
                    'company': j.get('company', ''),
                    'source': j.get('source', 'direct') or 'direct',
                    'status': j.get('status', 'active') or 'active',
                    'scraped_at': j.get('scrapedAt', ''),
                })
        else:
            logger.error(f'No data source available for dry-run. Expected: {jobs_index_path}')
            sys.exit(1)

        matrix = build_source_matrix(jobs)
        target_data = build_target_companies(jobs, target_companies)

        print_matrix(matrix)
        if target_data:
            print('\nTarget Companies:')
            for row in [target_data['header_row']] + target_data['data_rows']:
                print('  ' + '  |  '.join(str(c) for c in row))
        return

    # Authenticate
    logger.info('Authenticating with Google Sheets...')
    client = authenticate(credentials_path)
    spreadsheet = client.open(spreadsheet_name)
    logger.info(f'Connected to: {spreadsheet_name}')

    # Read all job data
    logger.info('Reading employer jobs...')
    employer_jobs = read_employer_jobs(spreadsheet)

    logger.info('Reading aggregator jobs...')
    aggregator_jobs = read_aggregator_jobs(client)

    all_jobs = employer_jobs + aggregator_jobs
    logger.info(f'Total jobs: {len(all_jobs)}')

    # Build matrices
    matrix = build_source_matrix(all_jobs)
    target_data = build_target_companies(all_jobs, target_companies)

    # Write to sheets
    logger.info('Writing Source Coverage Matrix...')
    write_matrix_to_sheet(spreadsheet, matrix)

    logger.info('Writing Target Companies...')
    write_target_companies_to_sheet(spreadsheet, target_data)

    logger.info('Done.')


if __name__ == '__main__':
    main()
