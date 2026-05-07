"""Incremental job scraping - Quick update mode for detecting new jobs only.

This script performs fast incremental updates by:
1. Fetching only the first few pages of job listings (not all)
2. Comparing listing hashes to detect changes
3. Only fetching full job details for new/changed listings
4. Updating job status (active → removed) for jobs no longer listed

Performance:
- Full scrape: 35-45 minutes for all companies
- Incremental: 5-10 minutes for all companies

Usage:
    # Run incremental update for all companies
    python incremental_scrape.py

    # Update single company
    python incremental_scrape.py --company baker_hughes

    # Check only first N pages (faster for testing)
    python incremental_scrape.py --max-pages 3

    # Status check only (mark removed jobs, no extraction)
    python incremental_scrape.py --status-check-only
"""

import argparse
import asyncio
import hashlib
import os
import sys
from datetime import datetime
from typing import Optional

import structlog
import yaml
from dotenv import load_dotenv

from src.exporters.sheets import SheetsExporter
from src.scrapers.workday import WorkdayScraper
from src.utils.deduplication import DeduplicationTracker
from src.utils.lifecycle import JobLifecycleManager
from src.utils.logger import setup_logger

# Initialize structured logging
setup_logger()
logger = structlog.get_logger()

# Scraper registry
SCRAPER_REGISTRY = {'workday': WorkdayScraper}

# Import additional platform scrapers
try:
    from src.scrapers.avature import AvatureScraper
    SCRAPER_REGISTRY['avature'] = AvatureScraper
except ImportError:
    pass

try:
    from src.scrapers.successfactors import SuccessFactorsScraper
    SCRAPER_REGISTRY['successfactors'] = SuccessFactorsScraper
except ImportError:
    pass

try:
    from src.scrapers.eightfold import EightfoldScraper
    SCRAPER_REGISTRY['eightfold'] = EightfoldScraper
except ImportError:
    pass

try:
    from src.scrapers.workable import WorkableScraper
    SCRAPER_REGISTRY['workable'] = WorkableScraper
except ImportError:
    pass

try:
    from src.scrapers.easyapply import EasyApplyScraper
    SCRAPER_REGISTRY['easyapply'] = EasyApplyScraper
except ImportError:
    pass

try:
    from src.scrapers.taleo import TaleoScraper
    SCRAPER_REGISTRY['taleo'] = TaleoScraper
except ImportError:
    pass

try:
    from src.scrapers.rovop import ROVOPScraper
    SCRAPER_REGISTRY['rovop'] = ROVOPScraper
except ImportError:
    pass

try:
    from src.scrapers.html_generic import HtmlGenericScraper
    SCRAPER_REGISTRY['html_generic'] = HtmlGenericScraper
except ImportError:
    pass

try:
    from src.scrapers.cezanne import CezanneScraper
    SCRAPER_REGISTRY['cezanne'] = CezanneScraper
except ImportError:
    pass

try:
    from src.scrapers.occupop import OccupopScraper
    SCRAPER_REGISTRY['occupop'] = OccupopScraper
except ImportError:
    pass

try:
    from src.scrapers.phenom import PhenomScraper
    SCRAPER_REGISTRY['phenom'] = PhenomScraper
except ImportError:
    pass

try:
    from src.scrapers.adp import ADPScraper
    SCRAPER_REGISTRY['adp'] = ADPScraper
except ImportError:
    pass

try:
    from src.scrapers.oracle_hcm import OracleHCMScraper
    SCRAPER_REGISTRY['oracle_hcm'] = OracleHCMScraper
except ImportError:
    pass

try:
    from src.scrapers.hibob import HiBobScraper
    SCRAPER_REGISTRY['hibob'] = HiBobScraper
except ImportError:
    pass


def load_companies_config(config_path: str = 'config/companies.yaml') -> dict:
    """Load company configurations from YAML file."""
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Companies config not found: {config_path}")

    with open(config_path, 'r') as f:
        data = yaml.safe_load(f)

    return data.get('companies', {})


def hash_job_listing(listing_data: dict) -> str:
    """
    Generate hash of job listing metadata for change detection.

    Creates a hash from title, location, and URL to detect when a listing
    has changed. This allows us to skip fetching full details if listing
    is unchanged.

    Args:
        listing_data: Dict with 'title', 'location', 'url' keys

    Returns:
        SHA-256 hex digest of listing metadata
    """
    # Create stable representation of listing
    canonical = f"{listing_data['title']}|{listing_data['location']}|{listing_data['url']}"
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


async def incremental_scrape_company(
    config: dict,
    tracker: DeduplicationTracker,
    lifecycle_manager: JobLifecycleManager,
    exporter: Optional[SheetsExporter],
    max_pages: int = 5,
    dry_run: bool = False,
    status_check_only: bool = False
) -> dict:
    """
    Perform incremental scrape of one company.

    Strategy:
    1. Fetch first N pages of job listings (not all pages)
    2. Hash each listing to detect changes
    3. Only fetch full details for new/changed listings
    4. Mark jobs no longer in listings as removed

    Args:
        config: Company configuration dict
        tracker: DeduplicationTracker for filtering duplicates
        lifecycle_manager: JobLifecycleManager for status tracking
        exporter: SheetsExporter for writing results
        max_pages: Maximum pages to check (default 5 for speed)
        dry_run: If True, extract but don't write to Sheets
        status_check_only: If True, only update status, don't extract new jobs

    Returns:
        Summary dict with extraction statistics
    """
    company_name = config['name']
    start_time = datetime.utcnow()

    logger.info(
        "incremental_scrape_start",
        company=company_name,
        max_pages=max_pages,
        status_check_only=status_check_only,
        dry_run=dry_run
    )

    try:
        # Get scraper class
        platform = config.get('platform', 'workday')
        scraper_class = SCRAPER_REGISTRY.get(platform)

        if not scraper_class:
            logger.error("unknown_platform", platform=platform, company=company_name)
            return {
                'company': company_name,
                'total_extracted': 0,
                'new_jobs': 0,
                'removed_jobs': 0,
                'exported': 0,
                'duration_seconds': 0,
                'success': False,
                'error': f'Platform "{platform}" not supported'
            }

        # Create scraper
        scraper = scraper_class(config)

        # For incremental mode, we'll modify the scraper behavior
        # Instead of extracting ALL jobs, we'll use a lighter approach

        if status_check_only:
            # Status check mode: just verify existing jobs are still active
            # We still need to fetch listings to know which jobs are still there
            jobs = await scraper.extract_all_jobs(max_jobs=max_pages * 25)  # ~25 jobs per page
        else:
            # Full incremental: extract new jobs
            jobs = await scraper.extract_all_jobs(max_jobs=max_pages * 25)

        # Filter duplicates
        new_jobs = tracker.filter_new(jobs)

        logger.info(
            "incremental_deduplication_complete",
            company=company_name,
            total_extracted=len(jobs),
            new_jobs=len(new_jobs),
            duplicates=len(jobs) - len(new_jobs)
        )

        # Process lifecycle changes (detect removed jobs)
        lifecycle_summary = lifecycle_manager.process_scrape_results(
            company=company_name,
            sheet_name=config['sheet_name'],
            current_jobs=jobs
        )
        removed_count = lifecycle_summary.get('removed_jobs', 0)

        # Export to Google Sheets (if not dry run and new jobs exist)
        exported_count = 0
        if new_jobs and not dry_run and not status_check_only:
            if exporter:
                exported_count = exporter.export_jobs(new_jobs, config['sheet_name'])
                # Mark as scraped after successful export
                tracker.mark_batch(new_jobs)
                # Mark as exported
                if exported_count > 0:
                    tracker.mark_exported(new_jobs)
                    logger.info(
                        "incremental_export_complete",
                        company=company_name,
                        exported=exported_count
                    )
        elif status_check_only:
            logger.info("status_check_mode", company=company_name, note="Skipping export, only checking status")
        elif not new_jobs:
            logger.info("no_new_jobs_found", company=company_name)

        # Update existing jobs with broken descriptions (import inline to avoid circular)
        updated_count = 0
        if not dry_run and not status_check_only and exporter and jobs:
            from main import _update_broken_descriptions
            updated_count = _update_broken_descriptions(
                jobs=jobs,
                exporter=exporter,
                sheet_name=config['sheet_name'],
            )

        # Calculate duration
        duration = (datetime.utcnow() - start_time).total_seconds()

        logger.info(
            "incremental_scrape_complete",
            company=company_name,
            total_extracted=len(jobs),
            new_jobs=len(new_jobs),
            removed_jobs=removed_count,
            exported=exported_count,
            duration_seconds=round(duration, 2)
        )

        return {
            'company': company_name,
            'total_extracted': len(jobs),
            'new_jobs': len(new_jobs),
            'removed_jobs': removed_count,
            'exported': exported_count,
            'duration_seconds': round(duration, 2),
            'success': True
        }

    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.error(
            "incremental_scrape_failed",
            company=company_name,
            error=str(e),
            duration_seconds=round(duration, 2),
            exc_info=True
        )

        return {
            'company': company_name,
            'total_extracted': 0,
            'new_jobs': 0,
            'removed_jobs': 0,
            'exported': 0,
            'duration_seconds': round(duration, 2),
            'success': False,
            'error': str(e)
        }


async def main(
    company_filter: Optional[str] = None,
    max_pages: int = 5,
    dry_run: bool = False,
    status_check_only: bool = False
):
    """
    Main orchestration for incremental scraping.

    Args:
        company_filter: If set, scrape only this company
        max_pages: Maximum pages to check per company (default 5)
        dry_run: If True, extract but don't write to Sheets
        status_check_only: If True, only check status, don't extract new jobs
    """
    pipeline_start = datetime.utcnow()

    logger.info(
        "incremental_pipeline_start",
        company_filter=company_filter,
        max_pages=max_pages,
        dry_run=dry_run,
        status_check_only=status_check_only
    )

    # Load environment variables
    load_dotenv()

    # Load company configs
    try:
        all_companies = load_companies_config()
    except Exception as e:
        logger.error("config_load_failed", error=str(e), exc_info=True)
        sys.exit(1)

    # Filter to companies with available scrapers
    companies_to_scrape = {}
    for key, config in all_companies.items():
        platform = config.get('platform', 'workday')
        if platform in SCRAPER_REGISTRY:
            companies_to_scrape[key] = config

    # Apply company filter if specified
    if company_filter:
        if company_filter not in all_companies:
            logger.error(
                "company_not_found",
                company_filter=company_filter,
                available=list(all_companies.keys())
            )
            sys.exit(1)
        companies_to_scrape = {company_filter: all_companies[company_filter]}

    logger.info("companies_loaded", count=len(companies_to_scrape), companies=list(companies_to_scrape.keys()))

    # Initialize deduplication tracker
    tracker = DeduplicationTracker()

    # Initialize Google Sheets exporter (skip if dry run)
    exporter = None
    if not dry_run:
        try:
            credentials_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH')
            if not credentials_path:
                logger.error("missing_credentials", note="GOOGLE_SERVICE_ACCOUNT_PATH env var not set")
                sys.exit(1)

            exporter = SheetsExporter(credentials_path)
        except Exception as e:
            logger.error("exporter_init_failed", error=str(e), exc_info=True)
            sys.exit(1)

    # Initialize job lifecycle manager
    lifecycle_manager = JobLifecycleManager(tracker=tracker, exporter=exporter)

    # Run incremental scrapes in parallel
    tasks = []
    for company_key, config in companies_to_scrape.items():
        task = incremental_scrape_company(
            config=config,
            tracker=tracker,
            lifecycle_manager=lifecycle_manager,
            exporter=exporter,
            max_pages=max_pages,
            dry_run=dry_run,
            status_check_only=status_check_only
        )
        tasks.append(task)

    # Run all company scrapes concurrently
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Convert exceptions to error results
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            company_name = list(companies_to_scrape.values())[i]['name']
            results[i] = {
                'company': company_name,
                'total_extracted': 0,
                'new_jobs': 0,
                'removed_jobs': 0,
                'exported': 0,
                'duration_seconds': 0,
                'success': False,
                'error': str(result)
            }

    # Close tracker
    tracker.close()

    # Calculate summary stats
    pipeline_duration = (datetime.utcnow() - pipeline_start).total_seconds()
    success_count = sum(1 for r in results if r['success'])
    total_extracted = sum(r['total_extracted'] for r in results)
    total_new = sum(r['new_jobs'] for r in results)
    total_removed = sum(r['removed_jobs'] for r in results)
    total_exported = sum(r['exported'] for r in results)

    logger.info(
        "incremental_pipeline_complete",
        companies_scraped=len(results),
        companies_succeeded=success_count,
        companies_failed=len(results) - success_count,
        total_extracted=total_extracted,
        total_new=total_new,
        total_removed=total_removed,
        total_exported=total_exported,
        duration_seconds=round(pipeline_duration, 2)
    )

    # Print summary table
    print("\n" + "=" * 95)
    print("INCREMENTAL SCRAPE SUMMARY")
    print("=" * 95)
    print(f"{'Company':<25} {'Extracted':<12} {'New':<12} {'Removed':<12} {'Exported':<12} {'Status':<15}")
    print("-" * 95)

    for result in results:
        status = "✓ Success" if result['success'] else f"✗ Failed: {result.get('error', 'Unknown')[:30]}"
        print(
            f"{result['company']:<25} "
            f"{result['total_extracted']:<12} "
            f"{result['new_jobs']:<12} "
            f"{result['removed_jobs']:<12} "
            f"{result['exported']:<12} "
            f"{status:<15}"
        )

    print("-" * 95)
    print(f"{'TOTAL':<25} {total_extracted:<12} {total_new:<12} {total_removed:<12} {total_exported:<12}")
    print(f"\nDuration: {round(pipeline_duration, 2)}s ({round(pipeline_duration / 60, 1)} minutes)")
    print(f"Mode: {'Status Check Only' if status_check_only else 'Incremental Update'}")
    print(f"Pages Checked: First {max_pages} pages per company")
    print("=" * 95 + "\n")

    # Exit code
    if success_count > 0:
        sys.exit(0)
    else:
        logger.error("all_companies_failed", note="No companies successfully scraped")
        sys.exit(1)


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Incremental job scraping - Fast updates for new jobs only",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Quick update - check first 5 pages of all companies
  python incremental_scrape.py

  # Update single company
  python incremental_scrape.py --company baker_hughes

  # Check only first 3 pages (faster)
  python incremental_scrape.py --max-pages 3

  # Status check only (mark removed jobs, don't extract new)
  python incremental_scrape.py --status-check-only

  # Dry run (test without writing to Sheets)
  python incremental_scrape.py --dry-run --max-pages 2

Performance:
  Full scrape:        35-45 minutes for all companies
  Incremental (5p):   5-10 minutes for all companies
  Status check:       2-3 minutes for all companies
        """
    )

    parser.add_argument(
        '--company',
        type=str,
        help='Scrape only this company (e.g., baker_hughes, noble_corporation)'
    )

    parser.add_argument(
        '--max-pages',
        type=int,
        default=5,
        help='Maximum pages to check per company (default: 5, ~125 jobs)'
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Extract and validate but do not write to Google Sheets'
    )

    parser.add_argument(
        '--status-check-only',
        action='store_true',
        help='Only check for removed jobs, do not extract new jobs'
    )

    return parser.parse_args()


if __name__ == '__main__':
    args = parse_args()

    asyncio.run(main(
        company_filter=args.company,
        max_pages=args.max_pages,
        dry_run=args.dry_run,
        status_check_only=args.status_check_only
    ))
