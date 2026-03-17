"""Job Scraping Pipeline - Main Entry Point

Orchestrates the complete job scraping pipeline:
1. Load company configs from YAML
2. Launch Playwright to scrape Workday career portals
3. Extract and validate job data
4. Deduplicate against SQLite history
5. Export new jobs to Google Sheets

Usage:
    # Scrape all companies
    python main.py

    # Scrape single company for testing
    python main.py --company baker_hughes --max-jobs 10

    # Dry run (extract but don't write to Sheets)
    python main.py --dry-run --max-jobs 5
"""

import argparse
import asyncio
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

# Scraper registry: maps platform type to scraper class
SCRAPER_REGISTRY = {'workday': WorkdayScraper}

# Try to import additional platform scrapers (may not exist yet)
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


def load_companies_config(config_path: str = 'config/companies.yaml') -> dict:
    """
    Load company configurations from YAML file.

    Args:
        config_path: Path to companies.yaml config file

    Returns:
        Dict mapping company keys to config dicts

    Raises:
        FileNotFoundError: If config file doesn't exist
        yaml.YAMLError: If config file is malformed
    """
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Companies config not found: {config_path}")

    with open(config_path, 'r') as f:
        data = yaml.safe_load(f)

    return data.get('companies', {})


async def scrape_company(
    config: dict,
    tracker: DeduplicationTracker,
    lifecycle_manager: JobLifecycleManager,
    exporter: Optional[SheetsExporter],
    max_jobs: Optional[int] = None,
    dry_run: bool = False
) -> dict:
    """
    Scrape jobs from one company's career portal.

    Args:
        config: Company configuration dict from companies.yaml
        tracker: DeduplicationTracker for filtering duplicates
        lifecycle_manager: JobLifecycleManager for status tracking
        exporter: SheetsExporter for writing results (None if dry run)
        max_jobs: Optional limit on jobs to extract (for testing)
        dry_run: If True, extract and validate but don't write to Sheets

    Returns:
        Summary dict with:
            - company: Company name
            - total_extracted: Total jobs extracted
            - new_jobs: Count of new (non-duplicate) jobs
            - removed_jobs: Count of jobs marked as removed
            - exported: Count written to Sheets (0 if dry run)
            - duration_seconds: Scraping duration
    """
    company_name = config['name']
    start_time = datetime.utcnow()

    logger.info("scrape_start", company=company_name, max_jobs=max_jobs, dry_run=dry_run)

    try:
        # Get scraper class from registry based on platform
        platform = config.get('platform', 'workday')
        scraper_class = SCRAPER_REGISTRY.get(platform)

        if not scraper_class:
            logger.error("unknown_platform", platform=platform, company=company_name)
            duration = (datetime.utcnow() - start_time).total_seconds()
            return {
                'company': company_name,
                'total_extracted': 0,
                'new_jobs': 0,
                'removed_jobs': 0,
                'exported': 0,
                'duration_seconds': round(duration, 2),
                'success': False,
                'error': f'Platform "{platform}" not supported (scraper not available)'
            }

        # Create scraper and extract jobs
        scraper = scraper_class(config)
        jobs = await scraper.extract_all_jobs(max_jobs=max_jobs)

        # Filter duplicates
        new_jobs = tracker.filter_new(jobs)

        logger.info(
            "deduplication_complete",
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
        if new_jobs and not dry_run:
            if exporter:
                exported_count = exporter.export_jobs(new_jobs, config['sheet_name'])
                # Mark as scraped after successful export
                tracker.mark_batch(new_jobs)
                # Mark as exported to prevent re-exporting if job is seen again
                if exported_count > 0:
                    tracker.mark_exported(new_jobs)
                    logger.info(
                        "export_tracking_updated",
                        company=company_name,
                        exported=exported_count,
                        marked_exported=len(new_jobs)
                    )
                else:
                    logger.warning(
                        "export_failed_or_partial",
                        company=company_name,
                        expected=len(new_jobs),
                        exported=exported_count,
                        note="Jobs NOT marked as exported due to export failure"
                    )
            else:
                logger.warning("no_exporter", company=company_name, note="Dry run mode")
        elif not new_jobs:
            logger.info("no_new_jobs", company=company_name)
        else:
            logger.info("dry_run_skip_export", company=company_name, jobs=len(new_jobs))

        # Calculate duration
        duration = (datetime.utcnow() - start_time).total_seconds()

        logger.info(
            "scrape_complete",
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
        # Log error and return failure summary (don't crash entire pipeline)
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.error(
            "scrape_failed",
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
    max_jobs: Optional[int] = None,
    dry_run: bool = False
):
    """
    Main orchestration: scrape all configured Workday companies.

    Args:
        company_filter: If set, scrape only this company key (e.g., 'baker_hughes')
        max_jobs: Optional limit on jobs per company (for testing)
        dry_run: If True, extract and validate but don't write to Sheets

    Exit codes:
        0: At least one company succeeded
        1: All companies failed
    """
    pipeline_start = datetime.utcnow()

    logger.info(
        "pipeline_start",
        company_filter=company_filter,
        max_jobs=max_jobs,
        dry_run=dry_run
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
    skipped_platforms = set()

    for key, config in all_companies.items():
        platform = config.get('platform', 'workday')
        if platform in SCRAPER_REGISTRY:
            companies_to_scrape[key] = config
        else:
            skipped_platforms.add(platform)

    if skipped_platforms:
        logger.warning(
            "platforms_unavailable",
            platforms=list(skipped_platforms),
            note="Scraper implementations not yet available for these platforms"
        )

    if not companies_to_scrape:
        logger.error("no_companies_available", note="No companies with available scrapers found")
        sys.exit(1)

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

    # Scrape companies in parallel (faster, reduces 3hr runtime to ~30 mins)
    tasks = []
    for company_key, config in companies_to_scrape.items():
        task = scrape_company(
            config=config,
            tracker=tracker,
            lifecycle_manager=lifecycle_manager,
            exporter=exporter,
            max_jobs=max_jobs,
            dry_run=dry_run
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

    # Update Overview sheet with per-run reporting
    if exporter and not dry_run:
        try:
            tracker_stats = tracker.get_stats()
            exporter.update_overview_sheet(
                company_configs=all_companies,
                scrape_results=results,
                tracker_stats=tracker_stats
            )
            logger.info("overview_sheet_updated")
        except Exception as e:
            logger.error("overview_update_failed", error=str(e), exc_info=True)

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
        "pipeline_complete",
        companies_scraped=len(results),
        companies_succeeded=success_count,
        companies_failed=len(results) - success_count,
        total_extracted=total_extracted,
        total_new=total_new,
        total_removed=total_removed,
        total_exported=total_exported,
        duration_seconds=round(pipeline_duration, 2)
    )

    # Print summary table for user
    print("\n" + "=" * 95)
    print("JOB SCRAPING PIPELINE SUMMARY")
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
    print(f"\nDuration: {round(pipeline_duration, 2)}s")
    print("=" * 95 + "\n")

    # Exit code: 0 if at least one company succeeded, 1 if all failed
    if success_count > 0:
        sys.exit(0)
    else:
        logger.error("all_companies_failed", note="No companies successfully scraped")
        sys.exit(1)


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Job scraping pipeline for oilfield services companies",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape all companies
  python main.py

  # Scrape one company for testing
  python main.py --company baker_hughes --max-jobs 10

  # Dry run (validate but don't write to Sheets)
  python main.py --dry-run --max-jobs 5

  # Debug with verbose logging
  LOG_LEVEL=DEBUG python main.py --company noble_corporation
        """
    )

    parser.add_argument(
        '--company',
        type=str,
        help='Scrape only this company (e.g., baker_hughes, noble_corporation, kbr)'
    )

    parser.add_argument(
        '--max-jobs',
        type=int,
        help='Limit jobs per company (for testing/debugging)'
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Extract and validate but do not write to Google Sheets'
    )

    return parser.parse_args()


if __name__ == '__main__':
    args = parse_args()

    asyncio.run(main(
        company_filter=args.company,
        max_jobs=args.max_jobs,
        dry_run=args.dry_run
    ))
