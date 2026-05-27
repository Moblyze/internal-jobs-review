#!/usr/bin/env python3
"""CLI for querying job aggregator sources."""

import argparse
import sys
import os
import yaml
import logging
from dotenv import load_dotenv
from typing import Optional

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.aggregators.base import AggregatorFilters
from src.aggregators.jobspy_adapter import JobSpyAggregator
from src.aggregators.adzuna_adapter import AdzunaAggregator
from src.aggregators.jooble_adapter import JoobleAggregator
from src.aggregators.usajobs_adapter import USAJobsAggregator
from src.aggregators.rigzone_adapter import RigzoneAggregator
from src.aggregators.roadtechs_adapter import RoadtechsAggregator
from src.aggregators.energyjobline_adapter import EnergyJoblineAggregator
from src.aggregators.oiljobfinder_adapter import OilJobFinderAggregator
from src.aggregators.linemancentral_adapter import LinemanCentralAggregator
from src.aggregators.energypeople_adapter import EnergyPeopleAggregator
from src.aggregators.energyjobsearch_adapter import EnergyJobSearchAggregator
from src.aggregators.ogvenergy_adapter import OGVEnergyAggregator
from src.aggregators.oilgasvacancy_adapter import OilGasVacancyAggregator
from src.aggregators.gcaptain_adapter import GCaptainAggregator
from src.aggregators.oceancrew_adapter import OceanCrewAggregator
from src.aggregators.riggaccess_adapter import RiggAccessAggregator
from src.aggregators.irata_adapter import IRATAAggregator
from src.aggregators.airswift_adapter import AirswiftAggregator
from src.aggregators.nesfircroft_adapter import NESFircroftAggregator
from src.aggregators.brunel_adapter import BrunelAggregator
from src.aggregators.rovplanet_adapter import ROVPlanetAggregator
from src.aggregators.underwaterjobs_adapter import UnderwaterJobsAggregator
from src.aggregators.oriongroup_adapter import OrionGroupAggregator
from src.aggregators.cammachbryant_adapter import CammachBryantAggregator
from src.aggregators.spencerogden_adapter import SpencerOgdenAggregator
from src.aggregators.atlasprofessionals_adapter import AtlasProfessionalsAggregator
from src.aggregators.petroplan_adapter import PetroplanAggregator
from src.aggregators.gulftalent_adapter import GulfTalentAggregator
from src.aggregators.dedup import AggregatorDedup
from src.aggregators.relevance import RelevanceFilter
from src.exporters.sheets import SheetsExporter

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

AGGREGATORS = {
    "jobspy": JobSpyAggregator,
    "adzuna": AdzunaAggregator,
    "jooble": JoobleAggregator,
    "usajobs": USAJobsAggregator,
    "rigzone": RigzoneAggregator,
    "roadtechs": RoadtechsAggregator,
    "energyjobline": EnergyJoblineAggregator,
    "oiljobfinder": OilJobFinderAggregator,
    "linemancentral": LinemanCentralAggregator,
    "energypeople": EnergyPeopleAggregator,
    "energyjobsearch": EnergyJobSearchAggregator,
    "ogvenergy": OGVEnergyAggregator,
    "oilgasvacancy": OilGasVacancyAggregator,
    # Maritime / Rope Access (Tier 1)
    "gcaptain": GCaptainAggregator,
    "oceancrew": OceanCrewAggregator,
    "riggaccess": RiggAccessAggregator,
    "irata": IRATAAggregator,
    # Major Staffing Agencies (Tier 2)
    "airswift": AirswiftAggregator,
    "nesfircroft": NESFircroftAggregator,
    "brunel": BrunelAggregator,
    # Subsea / diving niche boards
    "rovplanet": ROVPlanetAggregator,
    "underwaterjobs": UnderwaterJobsAggregator,
    # Energy staffing agencies (Vennture-platform + server-rendered)
    "oriongroup": OrionGroupAggregator,
    "cammachbryant": CammachBryantAggregator,
    # Wave 2 agencies — Atlas names the end-client (wp-json); SO/Petroplan blind
    "spencerogden": SpencerOgdenAggregator,
    "atlasprofessionals": AtlasProfessionalsAggregator,
    "petroplan": PetroplanAggregator,
    # Structured Gulf board (headed Playwright — energy breadth, mostly permanent)
    "gulftalent": GulfTalentAggregator,
}

def load_profiles(path="config/aggregators.yaml"):
    with open(path) as f:
        config = yaml.safe_load(f)
    return config.get("search_profiles", {})

def get_aggregators(source=None):
    """Get aggregator instances, optionally filtered by source name."""
    if source:
        if source not in AGGREGATORS:
            print(f"Unknown source: {source}. Available: {', '.join(AGGREGATORS.keys())}")
            sys.exit(1)
        return {source: AGGREGATORS[source]()}
    return {name: cls() for name, cls in AGGREGATORS.items()}

def cmd_sources(args):
    """List all available sources and their configuration status."""
    print("\n  Available Aggregator Sources")
    print("  " + "=" * 50)
    for name, cls in AGGREGATORS.items():
        instance = cls()
        configured = instance.is_configured()
        status = "READY" if configured else "NEEDS CONFIG"
        symbol = "+" if configured else "-"
        print(f"  [{symbol}] {name:12s}  {status}")
    print()

def cmd_count(args):
    """Get job counts from sources."""
    profiles = load_profiles()
    if args.profile not in profiles:
        print(f"Unknown profile: {args.profile}. Available: {', '.join(profiles.keys())}")
        sys.exit(1)

    profile = profiles[args.profile]
    filters = AggregatorFilters(
        keywords=profile["keywords"],
        job_types=profile.get("job_types", ["contract", "temporary"]),
        countries=profile.get("countries", ["us"]),
        max_results=50,
    )

    aggregators = get_aggregators(args.source)

    print(f"\n  Job Counts for profile: {args.profile}")
    print(f"  Keywords: {', '.join(filters.keywords[:3])}{'...' if len(filters.keywords) > 3 else ''}")
    print(f"  Countries: {', '.join(filters.countries)}")
    print("  " + "-" * 40)

    total = 0
    for name, agg in aggregators.items():
        if not agg.is_configured():
            print(f"  {name:12s}  SKIPPED (not configured)")
            continue
        try:
            count = agg.count(filters)
            print(f"  {name:12s}  {count:,} jobs")
            total += count
        except Exception as e:
            print(f"  {name:12s}  ERROR: {e}")

    print("  " + "-" * 40)
    print(f"  {'TOTAL':12s}  {total:,} jobs")
    print()

def get_sheets_exporter() -> Optional[SheetsExporter]:
    """Initialize Google Sheets exporter from environment variables."""
    credentials_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH')
    if not credentials_path:
        print("  ERROR: GOOGLE_SERVICE_ACCOUNT_PATH env var not set. Cannot export to Sheets.")
        return None
    try:
        return SheetsExporter(credentials_path)
    except Exception as e:
        print(f"  ERROR: Failed to initialize Sheets exporter: {e}")
        return None


def cmd_search(args):
    """Search sources and display results."""
    profiles = load_profiles()
    if args.profile not in profiles:
        print(f"Unknown profile: {args.profile}. Available: {', '.join(profiles.keys())}")
        sys.exit(1)

    profile = profiles[args.profile]
    filters = AggregatorFilters(
        keywords=profile["keywords"],
        job_types=profile.get("job_types", ["contract", "temporary"]),
        countries=profile.get("countries", ["us"]),
        max_results=args.limit,
    )

    aggregators = get_aggregators(args.source)
    dedup = AggregatorDedup()

    all_jobs = []
    for name, agg in aggregators.items():
        if not agg.is_configured():
            print(f"  [{name}] Skipped (not configured)")
            continue
        try:
            print(f"  [{name}] Searching...")
            jobs = agg.search(filters)
            print(f"  [{name}] Found {len(jobs)} raw results")
            all_jobs.extend(jobs)
        except Exception as e:
            print(f"  [{name}] Error: {e}")

    # Apply dedup
    filtered, dedup_stats = dedup.filter_results(all_jobs)

    # Apply relevance filter
    relevance = RelevanceFilter(
        include_keywords=profile.get("relevance_include", []),
        exclude_keywords=profile.get("relevance_exclude", []),
    )
    filtered, rel_stats = relevance.filter_results(filtered)

    print(f"\n  Results for profile: {args.profile}")
    print(f"  Total raw: {dedup_stats['total']} | Excluded (known company): {dedup_stats['excluded_company']} | Known URL: {dedup_stats['known_url']} | After dedup: {dedup_stats['kept']}")
    print(f"  Relevance filter: removed {rel_stats['excluded_negative']} (negative kw) + {rel_stats['excluded_irrelevant']} (no positive kw) = {rel_stats['excluded_negative'] + rel_stats['excluded_irrelevant']} removed | Kept: {rel_stats['kept']}")
    print("  " + "=" * 90)

    if not filtered:
        print("  No results after filtering.")
        return

    for i, job in enumerate(filtered[:args.limit], 1):
        source = job.source_aggregator or "unknown"
        print(f"\n  {i:3d}. [{source:8s}] {job.title}")
        print(f"       Company:  {job.company}")
        print(f"       Location: {job.location}")
        print(f"       Type:     {job.employment_type or 'N/A'}")
        if job.salary:
            print(f"       Salary:   {job.salary}")
        print(f"       URL:      {str(job.url)[:80]}")

    print(f"\n  Showing {min(len(filtered), args.limit)} of {len(filtered)} results\n")

    # Export to Google Sheets if --export flag is set
    if getattr(args, 'export', False) and filtered:
        sheet_name = args.sheet_name or f"Aggregator - {args.profile}"
        print(f"  Exporting {len(filtered[:args.limit])} jobs to Google Sheets worksheet: '{sheet_name}'...")
        exporter = get_sheets_exporter()
        if exporter:
            try:
                exported = exporter.export_jobs(filtered[:args.limit], sheet_name)
                print(f"  Successfully exported {exported} jobs to '{sheet_name}'")
            except Exception as e:
                print(f"  ERROR: Export failed: {e}")

def main():
    parser = argparse.ArgumentParser(description="Job Aggregator CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # sources command
    subparsers.add_parser("sources", help="List available sources")

    # count command
    count_parser = subparsers.add_parser("count", help="Get job counts")
    count_parser.add_argument("--profile", required=True, help="Search profile name")
    count_parser.add_argument("--source", help="Specific source (default: all)")

    # search command
    search_parser = subparsers.add_parser("search", help="Search for jobs")
    search_parser.add_argument("--profile", required=True, help="Search profile name")
    search_parser.add_argument("--source", help="Specific source (default: all)")
    search_parser.add_argument("--limit", type=int, default=20, help="Max results (default: 20)")
    search_parser.add_argument("--export", action="store_true", help="Export results to Google Sheets")
    search_parser.add_argument("--sheet-name", type=str, help="Worksheet name for export (default: 'Aggregator - <profile>')")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "sources":
        cmd_sources(args)
    elif args.command == "count":
        cmd_count(args)
    elif args.command == "search":
        cmd_search(args)

if __name__ == "__main__":
    main()
