"""Kuiper Group portal adapter: field mapping against the JSON seen live on Oct 27, 2026."""

from src.scrapers.kuiper import build_description, build_location, build_salary, parse_detail_description

JOB = {
    'id': 70, 'position': 'Floorman', 'work_site': '', 'sector': 'Oil & Gas',
    'job_type': 'Full Time', 'yrs_exp': '2 Years', 'show_salary_on_website': 0,
    'currency': 'SAR', 'salary_format': '',
    'country': {'id': 27, 'name': 'SAUDI ARABIA'},
    'manpowerrequestwebsite': {'principalwebsite': {'name': 'H&P Drilling'}},
}


def test_location_title_cases_the_country():
    assert build_location(JOB) == 'Saudi Arabia'


def test_location_with_work_site():
    assert build_location({**JOB, 'work_site': 'Dammam'}) == 'Dammam, Saudi Arabia'


def test_location_missing():
    assert build_location({}) == 'Location Not Specified'


def test_salary_hidden_unless_shown_on_website():
    assert build_salary({**JOB, 'salary_format': '5,000'}) is None
    assert build_salary({**JOB, 'show_salary_on_website': 1, 'salary_format': '5,000'}) == 'SAR 5,000'


def test_description_names_the_client_and_keeps_the_body():
    body = parse_detail_description(
        '<div id="job_description"><p>Assist in setting up drilling equipment</p>'
        '<p>Monitor the mud system</p></div>'
    )
    text = build_description(JOB, body)
    assert text.splitlines()[0] == 'Client: H&P Drilling'
    assert 'Monitor the mud system' in text


def test_no_detail_block():
    assert parse_detail_description('<html></html>') == ''
