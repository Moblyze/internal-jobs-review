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

# Stagger between successive company starts, in seconds (2026-09-14 fix).
#
# MAX_CONCURRENT_SCRAPES bounds how many companies run at once, but every
# permitted slot still fires its FIRST request in the same instant: with 12
# slots and Python dict order == companies.yaml order, verification run
# 34849506151 still launched exactly 12 companies simultaneously at t=0,
# including 4 Playwright-heavy ones (Chevron, Marathon Petroleum,
# Schlumberger, Worley) alongside Baker Hughes and KBR. Log evidence from
# that run: both companies' httpx connect attempts took ~55-65 wall-clock
# seconds to time out against a configured 30s REQUEST_TIMEOUT -- roughly
# 2x inflation, and IDENTICAL to the millisecond between two unrelated
# tenants (kbr.wd5.myworkdayjobs.com vs bakerhughes.wd5.myworkdayjobs.com).
# Matching delays across independent domains rules out a per-tenant/Workday
# -side rate limit; it points at a shared LOCAL bottleneck (this runner's
# CPU/DNS/socket capacity, or asyncio event-loop scheduling) hit hardest by
# everything starting at the exact same instant. See also the
# REQUEST_TIMEOUT increase in workday_api.py/icims.py/successfactors_csb.py/
# smartrecruiters.py, which makes a request that's merely delayed (not
# genuinely dead) survive rather than fail outright.
STARTUP_STAGGER_SECONDS = float(os.environ.get('STARTUP_STAGGER_SECONDS', '1.5'))

# A company that historically returns a meaningful number of jobs but comes
# back with 0 extracted this run is treated as a hard failure, not a quiet
# zero. 10 mirrors the CRITICAL_PREV_THRESHOLD already used by
# scripts/check_scrape_health.py, so both signals agree on what "meaningful"
# means. Below this, a 0 this run is plausibly a real "no postings today."
CRITICAL_REGRESSION_BASELINE = 10

# How a critical regression turns into the run's exit code (2026-09-24).
#
# From 2026-09-13 any single regressed employer failed the whole run. The run
# then went red on every one of the 8 scheduled days Sep 15-24, and red every
# day reads as "the scraper is broken" when ~80 of ~88 employers were fine and
# their rows reached the sheet. It also hid which failures were real: a source
# that is genuinely broken (OSM Thome, every day) looked the same as one that
# lost a race once (PG Global, one day). So:
#   - a company that zeroes on PERSISTENT_ZERO_RUNS consecutive runs fails the
#     run (it is broken, somebody must look);
#   - SYSTEMIC_REGRESSION_COUNT or more zeroes in one run fail it too (that is
#     the runner or a shared dependency, not one site; Sep 14 had 24);
#   - anything less is reported as a warning annotation plus the job summary
#     table, and the run stays green. It is still counted: the streak table
#     turns tomorrow's repeat into a failure.
PERSISTENT_ZERO_RUNS = int(os.environ.get('PERSISTENT_ZERO_RUNS', '2'))
SYSTEMIC_REGRESSION_COUNT = int(os.environ.get('SYSTEMIC_REGRESSION_COUNT', '10'))

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
    from src.scrapers.pinpoint import PinpointScraper
    SCRAPER_REGISTRY['pinpoint'] = PinpointScraper
except ImportError:
    pass

try:
    from src.scrapers.lever import LeverScraper
    SCRAPER_REGISTRY['lever'] = LeverScraper
except ImportError:
    pass

try:
    from src.scrapers.bullhorn import BullhornScraper
    SCRAPER_REGISTRY['bullhorn'] = BullhornScraper
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


def classify_regressions(
    regressions: list[dict],
    streaks: dict,
    persistent_runs: int = PERSISTENT_ZERO_RUNS,
    systemic_count: int = SYSTEMIC_REGRESSION_COUNT,
) -> dict:
    """Split critical regressions into what fails the run and what only warns.

    streaks: {company: consecutive zero runs including this one}. A company
    missing from it (dry run, no state) counts as a first occurrence.
    Returns {'persistent': [...], 'transient': [...], 'systemic': bool,
    'fail': bool}. Pure, so it is unit-testable.
    """
    persistent = [r for r in regressions if streaks.get(r['company'], 1) >= persistent_runs]
    transient = [r for r in regressions if streaks.get(r['company'], 1) < persistent_runs]
    systemic = len(regressions) >= systemic_count
    return {
        'persistent': persistent,
        'transient': transient,
        'systemic': systemic,
        'fail': bool(persistent) or systemic,
    }


def write_step_summary(results: list[dict], baseline: dict, verdict: dict, streaks: dict) -> None:
    """Per-source outcome table for the GitHub Actions run page."""
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if not path:
        return
    ok = sum(1 for r in results if r['total_extracted'] > 0)
    lines = [
        "## Employer scrapers",
        "",
        f"{ok} of {len(results)} sources extracted jobs; "
        f"{sum(r['total_extracted'] for r in results)} jobs extracted, "
        f"{sum(r['exported'] for r in results)} new rows exported.",
        "",
    ]
    bad = verdict['persistent'] + verdict['transient']
    if bad:
        lines += [
            "| Source | Active on file | Extracted | Zero runs in a row | Verdict | Reason |",
            "|---|---|---|---|---|---|",
        ]
        for r in bad:
            streak = streaks.get(r['company'], 1)
            v = 'FAIL (persistent)' if r in verdict['persistent'] else 'warn (first zero)'
            reason = (r.get('error') or 'no jobs extracted').replace('|', '/')[:120]
            lines.append(
                f"| {r['company']} | {baseline.get(r['company'], 0)} | 0 | {streak} | {v} | {reason} |"
            )
        if verdict['systemic']:
            lines += ["", f"**Systemic:** {len(bad)} sources zeroed in one run (threshold "
                          f"{SYSTEMIC_REGRESSION_COUNT}); suspect the runner or a shared dependency."]
    else:
        lines.append("No source with an established history came back empty.")
    try:
        with open(path, 'a') as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError as e:
        logger.warning("step_summary_write_failed", error=str(e))


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
            'active_before': lifecycle_summary.get('active_before', 0),
            'large_retire': lifecycle_summary.get('large_retire', False),
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

    async def scrape_company_limited(config: dict, start_index: int) -> dict:
        # Spread out the initial burst: without this, the first
        # MAX_CONCURRENT_SCRAPES companies all fire their first network
        # request in the same instant (see STARTUP_STAGGER_SECONDS above).
        # Only the first wave needs it in principle, but staggering every
        # company by queue position is simplest and the cumulative delay is
        # small (at most (MAX_CONCURRENT_SCRAPES - 1) * STARTUP_STAGGER_SECONDS
        # for any one company, since later companies only start once an
        # earlier slot frees up anyway).
        await asyncio.sleep(min(start_index, MAX_CONCURRENT_SCRAPES - 1) * STARTUP_STAGGER_SECONDS)
        async with scrape_semaphore:
            return await scrape_company(
                config=config,
                tracker=tracker,
                lifecycle_manager=lifecycle_manager,
                exporter=exporter,
                max_jobs=max_jobs,
                dry_run=dry_run
            )

    tasks = [
        scrape_company_limited(config, i)
        for i, config in enumerate(companies_to_scrape.values())
    ]

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

    # Regressions are judged here, before the tracker closes, because the
    # zero-run streak lives in the same state DB (see classify_regressions).
    critical_regressions = find_critical_regressions(results, baseline_active_counts)
    if dry_run:
        streaks = {}
    else:
        streaks = tracker.update_zero_streaks(
            scraped=[r['company'] for r in results],
            zeroed={r['company']: r.get('error') for r in critical_regressions},
        )
    verdict = classify_regressions(critical_regressions, streaks)

    # Close tracker
    tracker.close()

    # Calculate summary stats
    pipeline_duration = (datetime.utcnow() - pipeline_start).total_seconds()
    success_count = sum(1 for r in results if r['success'])
    total_extracted = sum(r['total_extracted'] for r in results)
    total_new = sum(r['new_jobs'] for r in results)
    total_removed = sum(r['removed_jobs'] for r in results)
    total_exported = sum(r['exported'] for r in results)

    # Large retire batches are noted in #monitoring, never held (2026-09-24 rule:
    # dead jobs come off the site; size alone is not a reason to keep them).
    large = [r for r in results if r.get('large_retire')]
    if large and not dry_run:
        from src.utils.monitoring import format_large_retire_note, post_monitoring_note
        post_monitoring_note(format_large_retire_note(
            "Daily Job Scraping",
            [(r['company'], r['removed_jobs'], r['active_before'], "missing from a full listing read")
             for r in large]))

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
    write_step_summary(results, baseline_active_counts, verdict, streaks)

    if critical_regressions:
        print("!" * 95)
        print(f"{len(critical_regressions)} companies with an established job history "
              f"extracted ZERO jobs this run "
              f"({len(verdict['persistent'])} persistent, {len(verdict['transient'])} first-time"
              f"{', SYSTEMIC' if verdict['systemic'] else ''})")
        print("!" * 95)
        for r in critical_regressions:
            baseline = baseline_active_counts.get(r['company'], 0)
            streak = streaks.get(r['company'], 1)
            reason = r.get('error') or 'no jobs extracted (see per-company logs for listing_page_failed / scrape_timeout)'
            line = (f"  {r['company']}: {baseline} active on file -> 0 extracted this run, "
                    f"{streak} run(s) in a row ({reason})")
            print(line)
            logger.error(
                "critical_extraction_regression",
                company=r['company'],
                baseline_active=baseline,
                total_extracted=0,
                zero_streak=streak,
                error=r.get('error'),
            )
            # Annotation on the run page. Persistent (or systemic) regressions
            # are errors and fail the run; a first-time zero is a warning.
            level = 'error' if (r in verdict['persistent'] or verdict['systemic']) else 'warning'
            print(f"::{level}::Scrape regression: {line.strip()}")
        print("!" * 95 + "\n")

    if verdict['fail']:
        logger.error(
            "pipeline_had_critical_regressions",
            count=len(critical_regressions),
            persistent=[r['company'] for r in verdict['persistent']],
            systemic=verdict['systemic'],
        )
        sys.exit(1)
    elif success_count > 0:
        if critical_regressions:
            logger.warning(
                "pipeline_partial_success",
                first_time_zero=[r['company'] for r in verdict['transient']],
                note="each is a warning today and fails the run if it repeats on the next run",
            )
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
