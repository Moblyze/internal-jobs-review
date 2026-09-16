"""Pay extraction: decimals survive, and a period is mandatory.

The strings here are taken from real scraped descriptions in the feed, which is
where the defect showed up: "$44.68/hour" was being stored as "$44".
"""

import pytest

from src.utils.salary import extract_salary


class TestDecimalsSurvive:
    """The reported bug: the old regex stopped at the decimal point."""

    @pytest.mark.parametrize(
        'description,expected',
        [
            ('Hourly rate for this position is $44.68/hour.', '$44.68/hour'),
            ('The pay rate is $37.48/hour for this shift', '$37.48/hour'),
            ('Pay: $34.96/hr', '$34.96/hr'),
            ('Salary range $63,496.00-$79,369.00/year', '$63,496.00-$79,369.00/year'),
            ('Compensation of $55.54 per hour', '$55.54 per hour'),
        ],
    )
    def test_keeps_the_cents(self, description, expected):
        assert extract_salary(description) == expected


class TestPeriodIsRequired:
    """An amount with no period is worse than nothing: it cannot become a
    JobPosting baseSalary and reads ambiguously on a page."""

    @pytest.mark.parametrize(
        'description',
        [
            'The salary for this role is $44',
            'Salary: $106,950',
            'Compensation $90,000 - $105,000 depending on experience',
            'Budget of $250,000 for the project',
        ],
    )
    def test_bare_amount_is_not_pay(self, description):
        assert extract_salary(description) is None


class TestNotBasePay:
    """A figure qualified as a benefit or a premium is not the job's pay."""

    @pytest.mark.parametrize(
        'description',
        [
            '401(k) plan with employer match up to $5,000 per year',
            'Tuition reimbursement up to $10,000 per year',
            'Weekend Night shift Differential Pay of $6/hour',
            'Per Diem: $224.96 each day when travelling',
            'Signing bonus of $20,000 per year of service',
            'Relocation allowance of $15,000 per year',
        ],
    )
    def test_rejected(self, description):
        assert extract_salary(description) is None


class TestImplausibleAmounts:
    @pytest.mark.parametrize(
        'description',
        [
            'Pay rate of $3/hour',            # below any real wage
            'Salary of $5,000,000 per year',  # not a wage
            'Rate: $2.50 per hour',
        ],
    )
    def test_out_of_bounds_rejected(self, description):
        assert extract_salary(description) is None


class TestPeriodSpellings:
    @pytest.mark.parametrize(
        'description,expected',
        [
            ('Rate: $850 per day', '$850 per day'),
            ('Rate: £650 a day', '£650 a day'),
            ('Salary: $95,000 annually', '$95,000 annually'),
            ('Pay: $1,800 per week', '$1,800 per week'),
            ('Salary: $120,000 per annum', '$120,000 per annum'),
            ('Rate: $52.00 hourly', '$52.00 hourly'),
        ],
    )
    def test_recognised(self, description, expected):
        assert extract_salary(description) == expected


class TestEdges:
    @pytest.mark.parametrize('value', [None, '', '   ', 'No salary information provided'])
    def test_nothing_to_find(self, value):
        assert extract_salary(value) is None

    def test_reads_through_html(self):
        assert extract_salary('<p><strong>Pay:</strong> $44.68/hour</p>') == '$44.68/hour'

    def test_skips_a_benefit_to_find_the_real_rate(self):
        description = (
            'Benefits include a 401(k) with up to $5,000 per year matched. '
            'The hourly rate for this position is $44.68/hour.'
        )
        assert extract_salary(description) == '$44.68/hour'
