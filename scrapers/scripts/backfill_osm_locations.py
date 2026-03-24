"""One-time script to backfill OSM Thome locations in Google Sheets.

The OSM scraper previously couldn't extract locations (Vue SPA + sitemap approach).
Now that we have the portal API, this script:
1. Fetches all OSM jobs from the API (with real locations)
2. Reads existing OSM rows from the Google Sheet
3. Updates the Location column for rows that have "Location Not Specified"

Usage:
    cd scrapers
    python scripts/backfill_osm_locations.py [--dry-run]
"""

import argparse
import json
import os
import sys
from urllib.request import Request, urlopen

import gspread
from google.oauth2.service_account import Credentials

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

SHEET_NAME = 'OSM Thome'
API_URL = 'https://maritime.osmaportal.com/api/jobs'
API_HEADERS = {'X-Job-Portal': 'yes'}
PER_PAGE = 100

# Column indices (0-based) matching SheetsExporter.HEADER_ROW
LOCATION_COL = 2  # 'Location'
URL_COL = 4       # 'URL'


def fetch_api_locations():
    """Fetch all OSM jobs from the portal API and build a URL->location map."""
    url_to_location = {}
    page = 1

    while page <= 50:
        req_url = f"{API_URL}?page={page}&per_page={PER_PAGE}"
        req = Request(req_url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)',
            'Accept': 'application/json',
            **API_HEADERS,
        })
        resp = urlopen(req, timeout=30)
        data = json.loads(resp.read().decode('utf-8'))

        jobs = data.get('data', [])
        if not jobs:
            break

        for job in jobs:
            slug = job.get('slug', '')
            job_id = job.get('id', '')
            job_url = f"https://jobs.osmthome.com/jobs/{job_id}/{slug}" if job_id else ''

            locations = job.get('locations', [])
            location = ', '.join(
                loc.get('label', '') for loc in locations if loc.get('label')
            ) if locations else ''

            if job_url and location:
                url_to_location[job_url] = location

        meta = data.get('meta', {})
        if page >= meta.get('last_page', 1):
            break
        page += 1

    return url_to_location


def main():
    parser = argparse.ArgumentParser(description='Backfill OSM Thome locations')
    parser.add_argument('--dry-run', action='store_true', help='Print changes without writing')
    args = parser.parse_args()

    # Find credentials
    cred_paths = [
        '../job-scraping/config/service_account.json',
        os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', ''),
    ]
    cred_path = next((p for p in cred_paths if p and os.path.exists(p)), None)
    if not cred_path:
        print("ERROR: No service account credentials found.")
        print("Place service_account.json at ../job-scraping/config/service_account.json")
        sys.exit(1)

    # Fetch locations from API
    print("Fetching locations from OSM portal API...")
    url_to_location = fetch_api_locations()
    print(f"  Got locations for {len(url_to_location)} jobs")

    # Connect to Google Sheets
    print("Connecting to Google Sheets...")
    credentials = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    gc = gspread.authorize(credentials)
    spreadsheet = gc.open("Job Scraper Data")
    worksheet = spreadsheet.worksheet(SHEET_NAME)

    # Read all rows
    all_values = worksheet.get_all_values()
    print(f"  Found {len(all_values) - 1} existing rows in '{SHEET_NAME}'")

    # Find rows needing location updates
    updates = []
    for row_idx, row in enumerate(all_values[1:], start=2):  # Skip header
        if len(row) <= URL_COL:
            continue

        current_location = row[LOCATION_COL] if len(row) > LOCATION_COL else ''
        url = row[URL_COL]

        # Only update if current location is missing/placeholder
        if current_location and current_location not in (
            'Location Not Specified', 'Location not specified', 'Location, WV', ''
        ):
            continue

        # Look up new location from API
        new_location = url_to_location.get(url, '')
        if not new_location:
            continue

        updates.append({
            'row': row_idx,
            'url': url,
            'old': current_location,
            'new': new_location,
        })

    print(f"\nFound {len(updates)} rows to update")

    if not updates:
        print("Nothing to do!")
        return

    # Show sample
    for u in updates[:5]:
        print(f"  Row {u['row']}: '{u['old']}' -> '{u['new']}'")
    if len(updates) > 5:
        print(f"  ... and {len(updates) - 5} more")

    if args.dry_run:
        print("\n[DRY RUN] No changes written.")
        return

    # Batch update location column
    print(f"\nUpdating {len(updates)} rows in Google Sheets...")
    # gspread batch_update expects list of {'range': 'A1', 'values': [[...]]}
    location_col_letter = 'C'  # Column C = Location (0-indexed col 2)
    batch = []
    for u in updates:
        cell = f"'{SHEET_NAME}'!{location_col_letter}{u['row']}"
        batch.append({'range': cell, 'values': [[u['new']]]})

    # Process in batches of 100 to avoid API limits
    batch_size = 100
    for i in range(0, len(batch), batch_size):
        chunk = batch[i:i + batch_size]
        worksheet.batch_update(chunk)
        print(f"  Updated rows {i + 1}-{min(i + batch_size, len(batch))}")

    print(f"\nDone! Updated {len(updates)} OSM Thome locations.")


if __name__ == '__main__':
    main()
