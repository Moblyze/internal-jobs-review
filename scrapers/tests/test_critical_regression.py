#!/usr/bin/env python3
"""Unit tests for main.find_critical_regressions.

2026-09-13 incident: the daily run reported overall workflow success even
though 23 companies with an established job history extracted 0 jobs, because
main.py's exit code only cared whether AT LEAST ONE company succeeded. These
tests cover the fix: a company that had a meaningful number of active jobs on
file but returns 0 this run must be flagged as a critical regression.

Run with: python -m pytest tests/test_critical_regression.py -v
"""

from main import find_critical_regressions, CRITICAL_REGRESSION_BASELINE


def _result(company, total_extracted, **extra):
    return {
        'company': company,
        'total_extracted': total_extracted,
        'new_jobs': 0,
        'removed_jobs': 0,
        'exported': 0,
        'duration_seconds': 1.0,
        'success': total_extracted > 0 or extra.pop('success', False),
        **extra,
    }


class TestFindCriticalRegressions:
    def test_flags_company_with_history_that_returns_zero(self):
        results = [_result('KBR', 0, error='Timed out after 2700s')]
        baseline = {'KBR': 1072}

        criticals = find_critical_regressions(results, baseline)

        assert len(criticals) == 1
        assert criticals[0]['company'] == 'KBR'

    def test_does_not_flag_a_company_with_no_history(self):
        """A brand-new source with 0 active jobs on file legitimately
        extracting 0 today is not a regression -- it may just have no
        postings yet."""
        results = [_result('New Employer', 0)]
        baseline = {'New Employer': 0}

        assert find_critical_regressions(results, baseline) == []

    def test_does_not_flag_a_small_company_below_threshold(self):
        """A company with a handful of historical jobs returning 0 today is
        plausibly a real 'no postings' day, not a scrape failure."""
        results = [_result('Tiny Co', 0)]
        baseline = {'Tiny Co': CRITICAL_REGRESSION_BASELINE - 1}

        assert find_critical_regressions(results, baseline) == []

    def test_does_not_flag_a_healthy_company(self):
        results = [_result('Intertek', 299)]
        baseline = {'Intertek': 305}

        assert find_critical_regressions(results, baseline) == []

    def test_flags_multiple_companies_independently(self):
        """Mirrors the 2026-09-13 run: some companies healthy, some
        critical -- the healthy ones must not mask the critical ones."""
        results = [
            _result('Intertek', 299),
            _result('KBR', 0, error='Timed out after 2700s'),
            _result('Baker Hughes', 0, error='listing_page_failed'),
            _result('Halliburton', 450),
        ]
        baseline = {'Intertek': 305, 'KBR': 1072, 'Baker Hughes': 567, 'Halliburton': 440}

        criticals = find_critical_regressions(results, baseline)

        assert {r['company'] for r in criticals} == {'KBR', 'Baker Hughes'}

    def test_missing_baseline_entry_defaults_to_zero_and_is_not_flagged(self):
        """A company absent from baseline_active_counts (e.g. a lookup
        mismatch) must fail safe -- never flag -- rather than crash."""
        results = [_result('Unknown To Baseline', 0)]

        assert find_critical_regressions(results, {}) == []

    def test_custom_threshold_is_respected(self):
        results = [_result('Mid-size Co', 0)]
        baseline = {'Mid-size Co': 5}

        assert find_critical_regressions(results, baseline, threshold=5) == [results[0]]
        assert find_critical_regressions(results, baseline, threshold=6) == []


# ---------------------------------------------------------------------------
# 2026-09-24: exit-code policy. A first-time zero warns; a repeat or a
# systemic wave fails the run.
# ---------------------------------------------------------------------------

from main import classify_regressions  # noqa: E402


class TestClassifyRegressions:
    def test_first_time_zero_is_a_warning_not_a_failure(self):
        regs = [_result('PG Global', 0)]
        v = classify_regressions(regs, {'PG Global': 1}, persistent_runs=2, systemic_count=10)
        assert v['fail'] is False
        assert [r['company'] for r in v['transient']] == ['PG Global']
        assert v['persistent'] == []

    def test_repeat_zero_fails_the_run(self):
        """OSM Thome zeroed on every run Sep 18-24: that is a broken source."""
        regs = [_result('OSM Thome', 0, error='Timed out after 2700s'), _result('WRS', 0)]
        v = classify_regressions(regs, {'OSM Thome': 7, 'WRS': 1}, persistent_runs=2, systemic_count=10)
        assert v['fail'] is True
        assert [r['company'] for r in v['persistent']] == ['OSM Thome']
        assert [r['company'] for r in v['transient']] == ['WRS']

    def test_many_first_time_zeroes_in_one_run_is_systemic(self):
        regs = [_result(f'Co{i}', 0) for i in range(10)]
        v = classify_regressions(regs, {f'Co{i}': 1 for i in range(10)}, persistent_runs=2, systemic_count=10)
        assert v['systemic'] is True
        assert v['fail'] is True

    def test_missing_streak_counts_as_first_occurrence(self):
        """Dry runs do not touch the streak table; a zero there must not fail."""
        v = classify_regressions([_result('KBR', 0)], {}, persistent_runs=2, systemic_count=10)
        assert v['fail'] is False

    def test_no_regressions_passes(self):
        v = classify_regressions([], {}, persistent_runs=2, systemic_count=10)
        assert v == {'persistent': [], 'transient': [], 'systemic': False, 'fail': False}


class TestZeroStreaks:
    def test_streak_increments_and_resets(self, tmp_path):
        from src.utils.deduplication import DeduplicationTracker
        t = DeduplicationTracker(str(tmp_path / 'state.db'))
        assert t.update_zero_streaks(['A', 'B'], {'A': 'timeout'}) == {'A': 1}
        assert t.update_zero_streaks(['A', 'B'], {'A': None, 'B': None}) == {'A': 2, 'B': 1}
        # A recovers, B repeats
        assert t.update_zero_streaks(['A', 'B'], {'B': None}) == {'B': 2}
        assert t.update_zero_streaks(['A'], {'A': None}) == {'A': 1}
        t.close()
