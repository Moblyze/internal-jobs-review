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

import os  # noqa: E402 -- needed by the os.environ.get() calls in the constants below

# Default per-company timeout in seconds (45 minutes).
# The overall GH Actions job timeout is 90 minutes. All companies run concurrently,
# so the bottleneck is the slowest company. Companies with 1000+ jobs use
# max_detail_pages in companies.yaml to cap detail page fetching.
DEFAULT_COMPANY_TIMEOUT = 2700  # 45 minutes

# Cap on how many companies scrape concurrently (2026-09-13 incident fix).
#
# Previously every company ran as a concurrent asyncio task with no limit at
# all: on 2026-09-13, ~71 companies (up from ~45) launched at once on one
# GH Actions runner. ~28 of those use a Playwright-based scraper (each its
# own headless Chromium process) and the rest are httpx-only API clients
# (workday_api, icims, successfactors_csb, smartrecruiters). The resulting
# CPU/memory/socket contention caused 23 httpx-based companies to fail their
# very first listing request within milliseconds of each other, and 3
# Playwright-heavy companies (Chevron, Marathon Petroleum, SGS) to blow
# through the 45-min per-company timeout — all previously working fine.
# See also MAX_CONCURRENT_BROWSERS in src/scrapers/base.py, which caps the
# heavier resource (Chromium processes) specifically.
#
# 2026-09-14: the regression repeated on the next scheduled run (34825740852,
# 09:01Z) with the same failure shape (24 employers, same set, same tight
# timestamp clustering), confirming this isn't transient. Design and
# rationale: docs/2026-09-13-runner-contention-scheduling-fix-proposal.md.
MAX_CONCURRENT_SCRAPES = int(os.environ.get('MAX_CONCURRENT_SCRAPES', '12'))

# A company that historically returns a meaningful number of jobs but comes
# back with 0 extracted this run is treated as a hard failure, not a quiet
# zero. 10 mirrors the CRITICAL_PREV_THRESHOLD already used by
# scripts/check_scrape_health.py, so both signals agree on what "meaningful"
# means. Below this, a 0 this run is plausibly a real "no postings today."
CRITICAL_REGRESSION_BASELINE = 10

import argparse
import asyncio
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
    from src.scrapers.pbs_wordpress import PBSWordPressScraper
    SCRAPER_REGISTRY['pbs_wordpress'] = PBSWordPressScraper
except ImportError:
    pass

try:
    from src.scrapers.rippling import RipplingScraper
    SCRAPER_REGISTRY['rippling'] = RipplingScraper
except ImportError:
    pass

try:
    from src.scrapers.oracle_hcm import OracleHCMScraper
    SCRAPER_REGISTRY['oracle_hcm'] = OracleHCMScraper
except ImportError:
    pass

try:
    from src.scrapers.crewbase import CrewBaseScraper
    SCRAPER_REGISTRY['crewbase'] = CrewBaseScraper
except ImportError:
    pass

try:
    from src.scrapers.workday_api import WorkdayApiScraper
    SCRAPER_REGISTRY['workday_api'] = WorkdayApiScraper
except ImportError:
    pass

try:
    from src.scrapers.smartrecruiters import SmartRecruitersScraper
    SCRAPER_REGISTRY['smartrecruiters'] = SmartRecruitersScraper
except ImportError:
    pass

try:
    from src.scrapers.successfactors_csb import SuccessFactorsCsbScraper
    SCRAPER_REGISTRY['successfactors_csb'] = SuccessFactorsCsbScraper
except ImportError:
    pass

try:
    from src.scrapers.icims import ICIMSScraper
    SCRAPER_REGISTRY['icims'] = ICIMSScraper
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


def find_critical_regressions(
    results: list[dict],
    baseline_active_counts: dict,
    threshold: int = CRITICAL_REGRESSION_BASELINE,
) -> list[dict]:
    """Return the results for companies that had an established job history
    (>= threshold active jobs on file before this run) but extracted 0 jobs
    this run. Pulled out as a pure function so it's unit-testable without
    standing up the whole scrape pipeline; see main() for how it gates the
    workflow's exit code."""
    return [
        r for r in results
        if baseline_active_counts.get(r['company'], 0) >= threshold
        and r['total_extracted'] == 0
    ]


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
    company_timeout = config.get('timeout_seconds', DEFAULT_COMPANY_TIMEOUT)
    start_time = datetime.utcnow()

    logger.info("scrape_start", company=company_name, max_jobs=max_jobs, dry_run=dry_run, timeout_seconds=company_timeout)

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

        # Create scraper and extract jobs (with per-company timeout)
        scraper = scraper_class(config)
        # API-based scrapers can skip the per-job detail request for URLs that
        # are already exported (the lifecycle diff only needs the URL).
        if hasattr(scraper, 'set_known_url_checker'):
            scraper.set_known_url_checker(tracker.is_duplicate)
        try:
            jobs = await asyncio.wait_for(
                scraper.extract_all_jobs(max_jobs=max_jobs),
                timeout=company_timeout
            )
        except asyncio.TimeoutError:
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.error(
                "scrape_timeout",
                company=company_name,
                timeout_seconds=company_timeout,
                duration_seconds=round(duration, 2)
            )
            return {
                'company': company_name,
                'total_extracted': 0,
                'new_jobs': 0,
                'removed_jobs': 0,
                'exported': 0,
                'duration_seconds': round(duration, 2),
                'success': False,
                'error': f'Timed out after {company_timeout}s'
            }

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

    # Apply company filter if specified (single key, or comma-separated keys)
    if company_filter:
        requested = [k.strip() for k in company_filter.split(',') if k.strip()]
        missing = [k for k in requested if k not in all_companies]
        if missing:
            logger.error(
                "company_not_found",
                company_filter=missing,
                available=list(all_companies.keys())
            )
            sys.exit(1)
        companies_to_scrape = {k: all_companies[k] for k in requested}

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

    # Snapshot each company's known-active job count *before* scraping, so we
    # can tell a real "0 postings today" apart from a scrape that silently
    # failed to extract anything (see the critical-regression check below).
    baseline_active_counts = {
        config['name']: len(tracker.get_active_jobs_by_company(config['name']))
        for config in companies_to_scrape.values()
    }

    # Scrape companies in parallel, bounded by MAX_CONCURRENT_SCRAPES (faster
    # than fully sequential, but no longer unbounded — see the constant's
    # comment for why unbounded concurrency caused the 2026-09-13 incident).
    scrape_semaphore = asyncio.Semaphore(MAX_CONCURRENT_SCRAPES)

    async def scrape_company_limited(config: dict) -> dict:
        async with scrape_semaphore:
            return await scrape_company(
                config=config,
                tracker=tracker,
                lifecycle_manager=lifecycle_manager,
                exporter=exporter,
                max_jobs=max_jobs,
                dry_run=dry_run
            )

    tasks = [scrape_company_limited(config) for config in companies_to_scrape.values()]

    # Run all company scrapes concurrently (bounded)
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

    # Critical-regression check (2026-09-13 incident fix).
    #
    # Before this, a company that extracted 0 jobs (a bad listing-page
    # response, a timeout that discarded partial results, etc.) was just
    # another row in the table above marked "success": True if the scraper
    # itself didn't raise. main.py's own summary logic only failed the
    # process when EVERY company failed, so the workflow reported overall
    # success on 2026-09-13 even with 23 employers silently returning 0.
    #
    # A company is flagged CRITICAL here if it had >= CRITICAL_REGRESSION_
    # BASELINE active jobs on file *before* this run but extracted 0 *this*
    # run. That baseline (10) matches check_scrape_health.py's threshold.
    # This check is independent of (and catches failures earlier than)
    # check_scrape_health.py's day-over-day snapshot comparison, because the
    # lifecycle manager's safety threshold intentionally leaves "active in
    # DB" unchanged when a scrape returns too few jobs to trust for removal
    # detection — which means that signal alone never moves on a 0-job run
    # and a day-over-day check of it can miss the failure entirely.
    critical_regressions = find_critical_regressions(results, baseline_active_counts)

    if critical_regressions:
        print("!" * 95)
        print(f"CRITICAL: {len(critical_regressions)} companies with an established job history "
              f"extracted ZERO jobs this run")
        print("!" * 95)
        for r in critical_regressions:
            baseline = baseline_active_counts.get(r['company'], 0)
            reason = r.get('error') or 'no jobs extracted (see per-company logs for listing_page_failed / scrape_timeout)'
            line = f"  {r['company']}: {baseline} active on file -> 0 extracted this run ({reason})"
            print(line)
            logger.error(
                "critical_extraction_regression",
                company=r['company'],
                baseline_active=baseline,
                total_extracted=0,
                error=r.get('error'),
            )
            # GitHub Actions annotation: shows up as an unmissable red banner
            # on the run summary, not just buried in the step log.
            print(f"::error::Critical scrape regression: {line.strip()}")
        print("!" * 95 + "\n")

    # Exit code: 0 only if at least one company succeeded AND there are no
    # critical regressions. A run with 40 healthy companies and 23 silent
    # zeros must NOT report success.
    if critical_regressions:
        logger.error(
            "pipeline_had_critical_regressions",
            count=len(critical_regressions),
            companies=[r['company'] for r in critical_regressions],
        )
        sys.exit(1)
    elif success_count > 0:
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
        help='Scrape only these companies: one key or a comma-separated list (e.g., kbr or kbr,baker_hughes)'
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
