"""Adzuna salary: never publish their estimate, always state the period.

Adzuna's `salary_is_predicted` is "1" when the figure is their own model output,
not the employer's. Their details page says so out loud: "$81,680 per year -
estimated" (verified against a live page 2026-09-16). Those were being ingested
as if the employer had stated them, and would reach a public job page and the
JobPosting baseSalary once the trade is released.
"""

import pytest

from src.aggregators.adzuna_adapter import _build_salary


class TestPredictedSalaryIsDropped:
    @pytest.mark.parametrize('flag', ['1', 1, 'true', 'True'])
    def test_predicted_is_not_pay(self, flag):
        item = {'salary_min': 81680, 'salary_max': 81680, 'salary_is_predicted': flag}
        assert _build_salary(item) is None

    def test_a_predicted_range_is_dropped_too(self):
        item = {'salary_min': 50000, 'salary_max': 70000, 'salary_is_predicted': '1'}
        assert _build_salary(item) is None


class TestStatedSalaryKeepsItsPeriod:
    """The old string had no period at all, which the site cannot turn into a
    baseSalary and which reads ambiguously on a page."""

    def test_range(self):
        item = {'salary_min': 50000, 'salary_max': 70000, 'salary_is_predicted': '0'}
        assert _build_salary(item) == '$50,000 - $70,000 per year'

    def test_point_value_is_not_rendered_as_a_range(self):
        item = {'salary_min': 81680, 'salary_max': 81680, 'salary_is_predicted': '0'}
        assert _build_salary(item) == '$81,680 per year'

    def test_minimum_only(self):
        item = {'salary_min': 50000, 'salary_is_predicted': '0'}
        assert _build_salary(item) == '$50,000+ per year'


class TestEdges:
    @pytest.mark.parametrize('item', [{}, {'salary_max': 70000}, {'salary_min': 0}])
    def test_nothing_to_report(self, item):
        assert _build_salary(item) is None

    def test_absent_flag_is_treated_as_stated(self):
        # Only an explicit prediction flag suppresses the figure; a missing
        # field must not silently drop a real salary.
        item = {'salary_min': 50000, 'salary_max': 70000}
        assert _build_salary(item) == '$50,000 - $70,000 per year'
