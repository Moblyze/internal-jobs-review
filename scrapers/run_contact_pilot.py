"""Dry-run pilot for contact extraction across the 8 ROV + rope-access employers.

Runs each pilot scraper with a small max_jobs cap, extracts JobPosting objects
(which now include contact_* fields per the pilot branch), and dumps a summary
JSON to docs/superpowers/reports/.

Usage from scrapers/:
    .venv/bin/python run_contact_pilot.py [--max-jobs 10] [--only rovop,sulmara]

Does NOT write to Google Sheets. Does NOT use the dedup or lifecycle trackers.
Pure probe: what does `extract_contacts()` see in real postings right now?
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

import structlog
import yaml
from dotenv import load_dotenv

from src.utils.logger import setup_logger

# Initialize structured logging
setup_logger()
logger = structlog.get_logger()


PILOT_COMPANIES = [
    "rovop",
    "sulmara",
    "interocean",
    "helix_energy",
    "oceaneering",
    "subsea7",
    "altrad_sparrows_us",
    "taurus_ig",
]


def _load_scraper_registry() -> dict:
    """Lazy-import scraper classes — some platforms are optional."""
    registry: dict = {}

    def _try(platform: str, module_path: str, class_name: str) -> None:
        try:
            module = __import__(module_path, fromlist=[class_name])
            registry[platform] = getattr(module, class_name)
        except ImportError as e:
            logger.warning("scraper_import_failed", platform=platform, error=str(e))

    _try("workday", "src.scrapers.workday", "WorkdayScraper")
    _try("avature", "src.scrapers.avature", "AvatureScraper")
    _try("successfactors", "src.scrapers.successfactors", "SuccessFactorsScraper")
    _try("eightfold", "src.scrapers.eightfold", "EightfoldScraper")
    _try("workable", "src.scrapers.workable", "WorkableScraper")
    _try("easyapply", "src.scrapers.easyapply", "EasyApplyScraper")
    _try("phenom", "src.scrapers.phenom", "PhenomScraper")
    _try("taleo", "src.scrapers.taleo", "TaleoScraper")
    _try("adp", "src.scrapers.adp", "ADPScraper")
    _try("occupop", "src.scrapers.occupop", "OccupopScraper")
    _try("rovop", "src.scrapers.rovop", "ROVOPScraper")
    _try("html_generic", "src.scrapers.html_generic", "HtmlGenericScraper")
    _try("pbs_wordpress", "src.scrapers.pbs_wordpress", "PBSWordPressScraper")

    return registry


async def run_company(key: str, config: dict, registry: dict, max_jobs: int) -> dict:
    """Run a single scraper and extract contact-field summary."""
    company_name = config.get("name", key)
    platform = config.get("platform")
    scraper_class = registry.get(platform)

    record: dict = {
        "key": key,
        "company": company_name,
        "platform": platform,
        "extract_contacts_flag": config.get("extract_contacts", False),
        "jobs_scraped": 0,
        "jobs_with_any_contact_field": 0,
        "by_source": {},
        "samples": [],
        "error": None,
    }

    if not scraper_class:
        record["error"] = f"no scraper class registered for platform '{platform}'"
        return record

    try:
        scraper = scraper_class(config)
        start = datetime.utcnow()
        jobs = await scraper.extract_all_jobs(max_jobs=max_jobs)
        record["jobs_scraped"] = len(jobs)
        record["duration_seconds"] = round((datetime.utcnow() - start).total_seconds(), 1)

        for job in jobs:
            source = job.contact_source or ""
            record["by_source"][source] = record["by_source"].get(source, 0) + 1
            has_any = any([
                job.contact_name,
                job.contact_title,
                job.contact_email,
                job.contact_phone,
                job.contact_linkedin_url,
            ])
            if has_any:
                record["jobs_with_any_contact_field"] += 1
                if len(record["samples"]) < 3:
                    record["samples"].append({
                        "title": job.title,
                        "url": str(job.url),
                        "contact_name": job.contact_name,
                        "contact_title": job.contact_title,
                        "contact_email": job.contact_email,
                        "contact_phone": job.contact_phone,
                        "contact_linkedin_url": job.contact_linkedin_url,
                        "contact_source": job.contact_source,
                    })
    except Exception as e:
        record["error"] = f"{type(e).__name__}: {e}"
        logger.error("pilot_scraper_failed", company=company_name, error=str(e))

    return record


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-jobs", type=int, default=10,
                        help="Max jobs per company (default 10)")
    parser.add_argument("--only", type=str, default="",
                        help="Comma-separated subset of pilot keys (default: all 8)")
    parser.add_argument("--timeout-per-company", type=int, default=180,
                        help="Seconds per company before aborting (default 180)")
    args = parser.parse_args()

    load_dotenv()
    registry = _load_scraper_registry()

    with open("config/companies.yaml") as f:
        all_companies = yaml.safe_load(f).get("companies", {})

    target_keys = [k.strip() for k in args.only.split(",") if k.strip()] or PILOT_COMPANIES
    missing = [k for k in target_keys if k not in all_companies]
    if missing:
        print(f"ERROR: unknown company keys: {missing}", file=sys.stderr)
        sys.exit(1)

    report = {
        "run_at": datetime.utcnow().isoformat() + "Z",
        "max_jobs_per_company": args.max_jobs,
        "companies": [],
    }

    for key in target_keys:
        config = all_companies[key]
        print(f"\n=== Running: {key} ({config.get('platform')}) ===", flush=True)
        try:
            record = await asyncio.wait_for(
                run_company(key, config, registry, args.max_jobs),
                timeout=args.timeout_per_company,
            )
        except asyncio.TimeoutError:
            record = {
                "key": key,
                "company": config.get("name", key),
                "platform": config.get("platform"),
                "error": f"timed out after {args.timeout_per_company}s",
                "jobs_scraped": 0,
            }
        report["companies"].append(record)
        summary = (
            f"  → {record.get('jobs_scraped', 0)} jobs, "
            f"{record.get('jobs_with_any_contact_field', 0)} with contacts, "
            f"error={record.get('error')}"
        )
        print(summary, flush=True)

    out_dir = Path("../../docs/superpowers/reports")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{datetime.utcnow().strftime('%Y-%m-%d')}-contact-extraction-pilot-raw.json"
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nWrote: {out_path.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
