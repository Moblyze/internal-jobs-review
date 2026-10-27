"""TOS (jobs.tospeople.com) adapter: parsing against the page shapes seen live on Oct 27, 2026.

The pages carry their data in the Next.js RSC stream, so the fixtures build that
stream the same way the site does: JSON strings pushed via self.__next_f.push.
"""

import json

from src.scrapers.tos_people import (
    page_count,
    parse_detail_description,
    parse_filters,
    parse_postings,
    posting_links,
    rsc_payload,
)


def _page(payload: str, body: str = '') -> str:
    # The site splits its stream across several pushes; split ours too.
    half = len(payload) // 2
    pushes = ''.join(
        f'<script>self.__next_f.push([1,{json.dumps(part)}])</script>'
        for part in (payload[:half], payload[half:])
    )
    return f'<html><body>{body}{pushes}</body></html>'


FILTERS = (
    '{"filterName":"Location","filterSlot":"$n1","filterId":"aaa","values":['
    '{"valueId":"loc-sea","stringValue":"Southeast Asia"},'
    '{"valueId":"loc-ww","stringValue":"Worldwide"}]},'
    '{"filterName":"Workfield","filterSlot":"$n2","filterId":"bbb","values":['
    '{"valueId":"wf-off","stringValue":"Offshore"},'
    '{"valueId":"wf-port","stringValue":"Port & Logistics"}]}'
)


def _posting(short_id, title, loc='loc-sea', wf='wf-off', state='JOB_POSTING_STATE_OPEN'):
    return json.dumps({
        'id': f'5d70f6eb-67fa-4a33-b31b-0b86fd6ea9{short_id[-2:]}',
        'title': title,
        'summary': f'{title} summary',
        'shortId': short_id,
        'languagesIso6393': 'eng',
        'state': state,
        'assignedMembers': [{'givenName': 'A', 'familyName': 'B', 'primaryEmail': 'a.b@example.com'}],
        'createdAt': '2026-10-19T07:38:54Z',
        'slot1FilterValue': [loc],
        'slot2FilterValue': [wf],
    }, separators=(',', ':'))


LISTING_PAYLOAD = (
    '1:["$","div",null,{"currentPage":"$n1","totalPages":"$n44"}]\n'
    f'2:{{"filters":[{FILTERS}]}}\n'
    f'3:{{"jobs":[{_posting("10644", "Master for MPSV")},{_posting("10651", "Heftruckchauffeur", wf="wf-port")}]}}\n'
)
LISTING_LINKS = (
    '<a href="/en/job-posting/10644/master-for-mpsv">x</a>'
    '<a href="/en/job-posting/10651/heftruckchauffeur">y</a>'
)


class TestListing:
    def test_payload_is_reassembled_across_pushes(self):
        payload = rsc_payload(_page(LISTING_PAYLOAD))
        assert payload == LISTING_PAYLOAD

    def test_postings(self):
        postings = parse_postings(rsc_payload(_page(LISTING_PAYLOAD)))
        assert [p['shortId'] for p in postings] == ['10644', '10651']
        assert postings[0]['title'] == 'Master for MPSV'

    def test_filters_name_the_value_ids(self):
        filters = parse_filters(rsc_payload(_page(LISTING_PAYLOAD)))
        assert filters['Location']['loc-sea'] == 'Southeast Asia'
        assert filters['Workfield']['wf-port'] == 'Port & Logistics'

    def test_page_count(self):
        assert page_count(rsc_payload(_page(LISTING_PAYLOAD))) == 44

    def test_links_carry_the_slug(self):
        links = posting_links(_page(LISTING_PAYLOAD, LISTING_LINKS))
        assert links == {
            '10644': '/en/job-posting/10644/master-for-mpsv',
            '10651': '/en/job-posting/10651/heftruckchauffeur',
        }

    def test_duplicate_objects_collapse(self):
        payload = LISTING_PAYLOAD + f'4:{{"similar":[{_posting("10644", "Master for MPSV")}]}}\n'
        assert len(parse_postings(payload)) == 2


DOC = {
    'type': 'doc',
    'content': [
        {'type': 'heading', 'attrs': {'level': 2}, 'content': [
            {'type': 'text', 'text': 'WE ARE LOOKING FOR '},
            {'type': 'text', 'marks': [{'type': 'bold'}], 'text': 'Master, C/O, C/E for MPSV'}]},
        {'type': 'bulletList', 'content': [
            {'type': 'listItem', 'content': [{'type': 'paragraph', 'content': [
                {'type': 'text', 'text': 'Has valid STCW certificates (COC class III)'}]}]},
            {'type': 'listItem', 'content': [{'type': 'paragraph', 'content': [
                {'type': 'text', 'text': 'Ready to join ASAP'}]}]}]},
        {'type': 'heading', 'attrs': {'level': 2}, 'content': [{'type': 'text', 'text': 'CONTACT'}]},
        {'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Do you have any questions? Email us.'}]},
    ],
}


class TestDetail:
    def _payload(self):
        return rsc_payload(_page('5:["$","$L25",null,{"content":' + json.dumps(DOC, separators=(',', ':')) + '}]\n'))

    def test_doc_is_flattened_with_list_items(self):
        text = parse_detail_description(self._payload())
        assert text.startswith('WE ARE LOOKING FOR Master, C/O, C/E for MPSV')
        assert '- Has valid STCW certificates (COC class III)' in text
        assert '- Ready to join ASAP' in text

    def test_contact_block_is_dropped(self):
        text = parse_detail_description(self._payload())
        assert 'CONTACT' not in text
        assert 'Email us' not in text

    def test_no_doc(self):
        assert parse_detail_description('1:{"nothing":true}') == ''
