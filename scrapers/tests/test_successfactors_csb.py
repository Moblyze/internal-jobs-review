#!/usr/bin/env python3
"""Unit tests for the SuccessFactors Career Site Builder HTTP scraper.

Run with: python -m pytest tests/test_successfactors_csb.py -v
"""

from datetime import datetime

import pytest

from src.scrapers.successfactors_csb import SuccessFactorsCsbScraper


def _scraper(base_url='https://careers.vestas.com', **extra):
    cfg = {'name': 'Vestas', 'platform': 'successfactors_csb', 'sheet_name': 'Vestas',
           'base_url': base_url, 'rate_limit_delay': 0, **extra}
    return SuccessFactorsCsbScraper(cfg)


LISTING = '''
<span class="paginationLabel">Results <b>1 – 2</b> of <b>638</b></span>
<table><tbody>
<tr class="data-row">
  <td class="colTitle"><span class="jobTitle"><a class="jobTitle-link" href="/job/Emmetsburg-Technician-II-IA/1431226533/">Technician II</a></span></td>
  <td class="colLocation"><span class="jobLocation">Emmetsburg, IA, US, 50536</span></td>
  <td class="colDate"><span class="jobDate">12 Sept 2026</span></td>
</tr>
<tr class="data-row">
  <td class="colTitle"><a class="jobTitle-link" href="/RWE/job/Austin-Sr-Product-Manager%2C-AI-Transformation-TX-78701/1415821833/">Sr Product Manager</a></td>
  <td class="colLocation"><span class="jobLocation">Austin, TX, US, 78701 +1 weitere …</span></td>
</tr>
</tbody></table>
'''

SITEMAP = '''<?xml version="1.0"?><urlset>
<url><loc>https://careers.vestas.com/</loc></url>
<url><loc>https://careers.vestas.com/job/Emmetsburg-Technician-II-IA/1431226533/</loc></url>
<url><loc>https://jobs.rwe.com/RWE/job/Tokyo-Transport-&amp;-Installation-Manager/1418624733/</loc></url>
</urlset>'''

DETAIL = '''<div class="job"><h1>Technician II</h1>
<span class="jobGeoLocation">Emmetsburg, IA, US, 50536</span>
<span itemprop="description"><p>Requisition ID: 75248</p><p>Service <b>wind</b> turbines.</p><ul><li>GWO required</li></ul></span></div>'''


class TestSuccessFactorsCsbScraper:
    def test_search_url_and_defaults(self):
        s = _scraper()
        assert s.origin == 'https://careers.vestas.com'
        assert s._search_url(20) == 'https://careers.vestas.com/search/?q=&startrow=20'
        assert s.sitemap_url == 'https://careers.vestas.com/sitemap.xml'

    def test_parse_total_reads_last_number_in_any_language(self):
        assert SuccessFactorsCsbScraper.parse_total(LISTING) == 638
        assert SuccessFactorsCsbScraper.parse_total(
            '<span class="paginationLabel">Ergebnisse <b>1 – 25</b> von <b>226</b></span>') == 226
        assert SuccessFactorsCsbScraper.parse_total('<p>no label</p>') is None

    def test_parse_listing_rows(self):
        cards = _scraper().parse_listing(LISTING)
        assert [c['url'] for c in cards] == [
            'https://careers.vestas.com/job/Emmetsburg-Technician-II-IA/1431226533/',
            'https://careers.vestas.com/RWE/job/Austin-Sr-Product-Manager%2C-AI-Transformation-TX-78701/1415821833/',
        ]
        assert cards[0]['title'] == 'Technician II'
        assert cards[0]['location'] == 'Emmetsburg, IA, US, 50536'
        assert cards[0]['posted_date'] == datetime(2026, 9, 12)
        assert cards[0]['requisition_id'] == '1431226533'
        assert cards[1]['location'] == 'Austin, TX, US, 78701'  # "+1 weitere" trimmed
        assert cards[1]['posted_date'] is None

    def test_parse_sitemap_keys_job_ids_and_unescapes(self):
        ids = SuccessFactorsCsbScraper.parse_sitemap(SITEMAP)
        assert ids == {
            '1431226533': 'https://careers.vestas.com/job/Emmetsburg-Technician-II-IA/1431226533/',
            '1418624733': 'https://jobs.rwe.com/RWE/job/Tokyo-Transport-&-Installation-Manager/1418624733/',
        }

    def test_parse_detail(self):
        d = _scraper().parse_detail(DETAIL)
        assert d['description'] == 'Requisition ID: 75248\nService wind turbines.\nGWO required'
        assert d['location'] == 'Emmetsburg, IA, US, 50536'
        assert d['requisition_id'] == '75248'
        assert _scraper().parse_detail('<p>nothing</p>') is None

    def test_title_from_url(self):
        assert SuccessFactorsCsbScraper.title_from_url(
            'https://careers.vestas.com/job/Emmetsburg-Technician-II-IA/1431226533/') == 'Emmetsburg Technician II IA'

    @pytest.mark.asyncio
    async def test_fetch_listing_pages_by_rows_per_page_until_total(self):
        s = _scraper()
        page1 = LISTING
        page2 = LISTING.replace('1431226533', '2222222222').replace('1415821833', '3333333333')
        page3 = LISTING  # repeats -> stop
        pages = {0: page1, 2: page2, 4: page3}
        calls = []

        async def fake_get(client, url):
            startrow = int(url.rsplit('startrow=', 1)[1])
            calls.append(startrow)
            return pages[startrow]

        s._get = fake_get
        cards = await s.fetch_listing(client=None)
        assert calls == [0, 2, 4]
        assert len(cards) == 4

    @pytest.mark.asyncio
    async def test_known_urls_skip_detail_sitemap_keeps_known_and_budget_defers(self):
        s = _scraper(max_new_details_per_run=1)
        detail_calls = []
        known = 'https://careers.vestas.com/job/Known-Role/1000/'
        gone_but_in_sitemap = 'https://careers.vestas.com/job/Still-Live-Role/1001/'
        unknown_in_sitemap = 'https://careers.vestas.com/job/Never-Seen/1002/'

        async def fake_listing(client, max_jobs=None):
            return [
                {'title': 'Known', 'url': known, 'company': 'Vestas', 'location': 'A', 'posted_date': None, 'requisition_id': '1000'},
                {'title': 'New one', 'url': 'https://careers.vestas.com/job/New-One/2001/', 'company': 'Vestas', 'location': 'B', 'posted_date': None, 'requisition_id': '2001'},
                {'title': 'New two', 'url': 'https://careers.vestas.com/job/New-Two/2002/', 'company': 'Vestas', 'location': 'C', 'posted_date': None, 'requisition_id': '2002'},
            ]

        async def fake_sitemap(client):
            return {'1000': known, '1001': gone_but_in_sitemap, '1002': unknown_in_sitemap}

        async def fake_detail(client, url):
            detail_calls.append(url)
            return {'description': 'A real description with enough words in it.', 'location': 'Aarhus N, DK', 'requisition_id': '75248'}

        s.fetch_listing = fake_listing
        s.fetch_sitemap_ids = fake_sitemap
        s.fetch_detail = fake_detail
        s.set_known_url_checker(lambda url: url in (known, gone_but_in_sitemap))

        jobs = await s.extract_all_jobs()
        urls = [str(j.url) for j in jobs]
        assert detail_calls == ['https://careers.vestas.com/job/New-One/2001/']
        assert urls == [known, 'https://careers.vestas.com/job/New-One/2001/', gone_but_in_sitemap]
        assert unknown_in_sitemap not in urls
        assert 'listing only' in jobs[0].description and 'listing only' in jobs[2].description
        assert jobs[1].location == 'Aarhus N, DK' and jobs[1].requisition_id == '75248'
