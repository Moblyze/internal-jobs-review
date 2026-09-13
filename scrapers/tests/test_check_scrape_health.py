#!/usr/bin/env python3
"""Unit tests for scripts/check_scrape_health.classify_health.

2026-09-13 incident: the CrewBase Liveness Probe (run 34758491427)
legitimately retired 19,279 rows (removed_reason='source_gone') across
~30 maritime crewing agencies. The health check's old logic only compared
active-count snapshots and had no way to tell that apart from a silent
scrape failure, so it fired 30 CRITICALs for a deliberate, source-confirmed
retirement. These tests cover the fix: a drop to 0 is silenced only when
fully explained by source_gone retirements since the baseline snapshot; an
unexplained drop -- a genuine scrape failure -- still alarms.

Run with: python -m pytest tests/test_check_scrape_health.py -v
"""

from scripts.check_scrape_health import (
    CRITICAL_PREV_THRESHOLD,
    WARN_PREV_THRESHOLD,
    classify_health,
)


def _snapshot(company: str, active_count: int) -> dict:
    return {company: {'active_count': active_count, 'total_count': active_count, 'ts': '2026-09-13T03:00:00'}}


class TestDeliberateRetirementIsSilent:
    def test_full_drop_explained_by_source_gone_is_silenced_not_critical(self):
        """CrewBase-shaped case: AZS had 16 active, all 16 retired as
        source_gone by the liveness probe, now 0 active. Must NOT alarm."""
        previous = _snapshot('AZS', 16)
        current_active = {}
        source_gone_counts = {'AZS': 16}

        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            {'AZS'}, previous, current_active, source_gone_counts,
        )

        assert criticals == []
        assert warnings == []
        assert silenced == [('AZS', 16, 16)]

    def test_source_gone_count_exceeding_previous_active_still_silences(self):
        """Defensive: explained >= prev_active clamps at 0, never goes
        negative or flips the comparison."""
        previous = _snapshot('AZS', 10)
        criticals, warnings, silenced, _, _ = classify_health(
            {'AZS'}, previous, {}, {'AZS': 50},
        )
        assert criticals == [] and silenced == [('AZS', 10, 50)]

    def test_many_companies_mass_retirement_all_silenced(self):
        """Mirrors the real incident shape: several companies, all fully
        explained, none alarm."""
        companies = ['AZS', 'BSM', 'NovoCrew']
        previous = {}
        for c in companies:
            previous.update(_snapshot(c, 12))
        source_gone_counts = {c: 12 for c in companies}

        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            set(companies), previous, {}, source_gone_counts,
        )

        assert criticals == []
        assert {s[0] for s in silenced} == set(companies)


class TestGenuineScrapeFailureStillAlarms:
    def test_zero_source_gone_context_still_critical(self):
        """Today's original incident shape: KBR had 1,072 active, extracted
        0 this run, nothing was deliberately retired. Must still alarm."""
        previous = _snapshot('KBR', 1072)
        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            {'KBR'}, previous, {}, {},
        )
        assert criticals == [('KBR', 1072, 0)]
        assert silenced == []

    def test_partial_source_gone_explanation_still_alarms_on_the_remainder(self):
        """A company drops from 50 to 0; only 16 are explained by
        source_gone. The other 34 are unexplained and must still alarm --
        a real failure overlapping a legitimate retirement is not masked."""
        previous = _snapshot('BigCo', 50)
        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            {'BigCo'}, previous, {}, {'BigCo': 16},
        )
        assert criticals == [('BigCo', 50, 0)]
        assert silenced == []

    def test_below_critical_threshold_with_no_explanation_is_unchanged(self):
        previous = _snapshot('TinyCo', CRITICAL_PREV_THRESHOLD - 1)
        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            {'TinyCo'}, previous, {}, {},
        )
        assert criticals == [] and silenced == [] and unchanged == 1

    def test_warning_tier_partial_drop_unaffected_by_unrelated_source_gone(self):
        previous = _snapshot('MidCo', WARN_PREV_THRESHOLD)
        current_active = {'MidCo': 5}  # well under 50% of 20
        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            {'MidCo'}, previous, current_active, {},
        )
        assert warnings == [('MidCo', WARN_PREV_THRESHOLD, 5)]

    def test_new_source_not_in_previous_snapshot_is_not_alarmed(self):
        criticals, warnings, silenced, unchanged, new_sources = classify_health(
            {'BrandNewCo'}, {}, {'BrandNewCo': 0}, {},
        )
        assert criticals == [] and silenced == [] and new_sources == 1
