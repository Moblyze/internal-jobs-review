"""WordPress REST adapter: field mapping.

Payloads are trimmed copies of real WRS (jobs.worldwide-rs.com, post type
recruiterwp_job) posts fetched 2026-10-26.
"""

from datetime import datetime

import pytest

from src.scrapers.wp_rest import (
    build_employment_type_text,
    build_job_data,
    build_location,
    build_posted_date,
    html_to_text,
)

OFFSHORE_BODY = (
    '<h1>Offshore Delivery Lead</h1>\n<p><strong>Location:</strong> Baku, Azerbaijan<br />'
    '<strong>Contract:</strong> 12-Month Renewable Contract<br />'
    '<strong>Rate:</strong> Day Rate (USD)</p>\n<h3>The Opportunity</h3>'
    '<p>We are seeking an experienced Offshore Delivery Lead.</p>'
)

POST = {
    'id': 4957,
    'slug': 'offshore-delivery-lead-azerbaijan-38860',
    'date_gmt': '2026-10-26T00:00:00',
    'link': 'https://jobs.worldwide-rs.com/jobs/offshore-delivery-lead-azerbaijan-38860/',
    'title': {'rendered': 'Offshore Delivery Lead &#8211; Azerbaijan'},
    'content': {'rendered': OFFSHORE_BODY},
    'class_list': ['post-4957', 'recruiterwp_job', 'location-baku'],
}


class TestLocation:
    def test_location_line_in_the_body(self):
        assert build_location(html_to_text(OFFSHORE_BODY)) == 'Baku, Azerbaijan'

    def test_next_field_on_the_same_line_is_cut(self):
        assert build_location('Location: Houston, TX Contract: Permanent') == 'Houston, TX'

    def test_falls_back_to_the_location_term(self):
        assert build_location('no location line here', ['post-1', 'location-new-orleans']) == 'New Orleans'

    def test_nothing_to_build(self):
        assert build_location('no location line here', ['post-1']) == ''


class TestJobData:
    def test_maps_a_post(self):
        data = build_job_data(POST, 'WRS')
        assert data['title'] == 'Offshore Delivery Lead – Azerbaijan'
        assert data['company'] == 'WRS'
        assert data['location'] == 'Baku, Azerbaijan'
        assert data['url'] == POST['link']
        assert data['requisition_id'] == 'offshore-delivery-lead-azerbaijan-38860'
        assert 'We are seeking an experienced Offshore Delivery Lead.' in data['description']
        assert data['posted_date'] == datetime(2026, 10, 26)
        assert data['salary'] is None  # "Day Rate (USD)" states no amount

    def test_pay_with_a_period_is_captured(self):
        post = dict(POST, content={'rendered': '<p>Location: Austin, TX</p><p>Salary Range:</p><p>$63.00/Hr. to $70.00/Hr.</p><p>ABOUT THE ROLE</p>'})
        assert build_job_data(post, 'WRS')['salary'] == '$63.00/Hr'

    def test_amount_without_a_period_is_not_pay(self):
        post = dict(POST, content={'rendered': '<p>Location: Austin, TX</p><p>Salary: $120,000 base. Apply now.</p>'})
        assert build_job_data(post, 'WRS')['salary'] is None

    @pytest.mark.parametrize('content', [{'rendered': ''}, {'rendered': '<p> </p>'}, {}])
    def test_empty_body_is_skipped(self, content):
        assert build_job_data(dict(POST, content=content), 'WRS') is None

    def test_no_link_is_skipped(self):
        assert build_job_data(dict(POST, link=''), 'WRS') is None


class TestSmallHelpers:
    def test_contract_text(self):
        assert build_employment_type_text(html_to_text(OFFSHORE_BODY)) == '12-Month Renewable Contract'

    @pytest.mark.parametrize('post', [{}, {'date': 'not a date'}])
    def test_bad_date_is_none(self, post):
        assert build_posted_date(post) is None
