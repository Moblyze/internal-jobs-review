#!/usr/bin/env python3
"""Tests for the SuccessFactors/TalentBrew detail-page parser (Halliburton fix).

Run with: python -m pytest tests/test_successfactors_detail.py -v
"""

import json

from src.scrapers.successfactors import SuccessFactorsScraper

BODY = '<p>We are looking for the right people.</p><ul><li>Weld pipe</li><li>API 1104</li></ul>' * 20


def _page(with_jsonld=True):
    ld = json.dumps({'@context': 'https://schema.org', '@type': 'JobPosting',
                     'title': 'Welder', 'description': BODY, 'datePosted': '2026-9-11'})
    script = f'<script type="application/ld+json">{ld}</script>' if with_jsonld else ''
    return f'''<html><head>{script}</head><body>
    <section class="job-description"><div class="item"><h1>Welder</h1><span class="job-location">Tulsa, OK</span>
    <div class="ats-description">{BODY}</div></div></section>
    <section class="job-description"><div class="ats-description">{BODY}</div></section>
    </body></html>'''


def test_parse_detail_prefers_json_ld():
    parsed = SuccessFactorsScraper.parse_detail_html(_page())
    assert parsed['source'] == 'json-ld'
    assert parsed['description'].startswith('We are looking for the right people.\nWeld pipe\nAPI 1104')
    assert len(parsed['description']) > 1000


def test_parse_detail_falls_back_to_ats_description_not_wrapper():
    parsed = SuccessFactorsScraper.parse_detail_html(_page(with_jsonld=False))
    assert parsed['source'] == 'div.ats-description'
    assert 'Tulsa, OK' not in parsed['description']  # wrapper section text excluded
    assert parsed['description'].startswith('We are looking for the right people.')


def test_parse_detail_empty_page():
    parsed = SuccessFactorsScraper.parse_detail_html('<html><body><p>nothing here</p></body></html>')
    assert parsed == {'description': '', 'source': None}
