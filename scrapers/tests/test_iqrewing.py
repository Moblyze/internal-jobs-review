"""IQrewing adapter: parsing against the page shapes seen live on Oct 27, 2026."""

from src.scrapers.iqrewing import (
    build_description,
    listed_total,
    parse_card_text,
    parse_detail_description,
    parse_listing,
)

LISTING = '''
<div>At sea (121)</div><div>Ashore (0)</div><div>Oil and gas (0)</div>
<a href="https://iqrewing.com/eng/job/14495" class="group" data-category="sea">
  <div>3rd Mate</div>
  <div><img src="/img/vessels/1_vessel.svg" /><div>General Cargo</div>
    <div><p>DWT:</p><div>7900</div></div>
    <div><div>Engine:</div><div>Daihatsu</div></div>
    <div><div>HP:</div><div>2500</div></div></div>
  <div><div> Joining date:</div><div>21-10-2026</div></div>
  <p>4 months</p>
</a>
<a href="https://iqrewing.com/eng/job/14449" data-category="sea"><div>Ch Eng</div><div>AHTS</div>
  <div>Joining date:</div><div>25-10-2026</div><p>2 months</p></a>
<a href="https://iqrewing.com/eng/job/14449" data-category="sea"><div>Ch Eng</div></a>
<a href="https://iqrewing.com/eng/jobs?page=2">2</a>
'''

DETAIL = '''
<div class="uppercase">Description</div>
<p class="leading">We are looking for a 3rd Mate able to join a General Cargo vessel (2009 y.b., MHL flag)<br />
Conditions of employment:  4 months contract (+-1), monthly wages: 3300 USD (Shipmoney)<br />
<br />
Requirements: rank experience, good command of English<br />
<br />
+7 931 231 21 61 Yulia </p>
<div class="uppercase">Manager</div><div>Some Manager</div>
'''


class TestListing:
    def test_cards(self):
        cards = parse_listing(LISTING)
        assert [c['job_id'] for c in cards] == ['14495', '14449']
        first = cards[0]
        assert first['title'] == '3rd Mate'
        assert first['vessel'] == 'General Cargo'
        assert first['facts'] == {'DWT': '7900', 'Engine': 'Daihatsu', 'HP': '2500', 'Joining date': '21-10-2026'}
        assert first['duration'] == '4 months'
        assert first['url'] == 'https://iqrewing.com/eng/job/14495'

    def test_pagination_links_are_not_cards(self):
        assert all('/job/' in c['url'] and 'jobs?' not in c['url'] for c in parse_listing(LISTING))

    def test_listed_total_sums_categories(self):
        assert listed_total(LISTING) == 121

    def test_card_without_vessel(self):
        card = parse_card_text(['Cook', 'Joining date:', '01-11-2026', '6 months'])
        assert card['vessel'] == '' and card['facts'] == {'Joining date': '01-11-2026'}


class TestDetail:
    def test_description_keeps_the_wage(self):
        text = parse_detail_description(DETAIL)
        assert 'monthly wages: 3300 USD' in text
        assert text.startswith('We are looking for a 3rd Mate')

    def test_phone_only_line_is_dropped(self):
        assert '931' not in parse_detail_description(DETAIL)

    def test_manager_block_is_not_captured(self):
        assert 'Some Manager' not in parse_detail_description(DETAIL)

    def test_built_description_leads_with_vessel_facts(self):
        card = parse_listing(LISTING)[0]
        text = build_description(card, parse_detail_description(DETAIL))
        assert text.splitlines()[0] == 'Vessel type: General Cargo'
        assert 'Contract length: 4 months' in text
        assert 'monthly wages: 3300 USD' in text
