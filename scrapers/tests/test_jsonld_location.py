"""Location from a page's schema.org JobPosting JSON-LD.

Written against Altrad UK's Eploy portal (2026-09-16), where the town exists
ONLY in the JSON-LD and the page title. Without this, every Altrad job resolved
to "Unknown" and would have been rejected by the public store's country gate,
so all 156 of its jobs were unpublishable.
"""

import json

import pytest

from src.scrapers.html_generic import location_from_jsonld


def page(*blocks) -> str:
    return "".join(
        f'<script type="application/ld+json">{json.dumps(b)}</script>' for b in blocks
    )


ALTRAD = {
    "@type": "JobPosting",
    "title": "Pipefitter Advanced - Bridgwater",
    "jobLocation": {
        "@type": "Place",
        "address": {
            "@type": "PostalAddress",
            "addressCountry": "United Kingdom",
            "streetAddress": "Mallard Court, Express Park, Bristol Road",
            "postalCode": "TA64RN",
            "addressLocality": "Bridgwater",
            "addressRegion": "Somerset",
        },
    },
}


class TestRealWorldShape:
    def test_altrad_eploy_page(self):
        assert location_from_jsonld(page(ALTRAD)) == "Bridgwater, United Kingdom"

    def test_ignores_non_jobposting_blocks(self):
        org = {"@type": "Organization", "name": "Altrad"}
        breadcrumb = {"@type": "BreadcrumbList", "itemListElement": []}
        assert location_from_jsonld(page(org, breadcrumb, ALTRAD)) == "Bridgwater, United Kingdom"


class TestShapeVariants:
    def test_jobposting_inside_a_list(self):
        assert location_from_jsonld(page([ALTRAD])) == "Bridgwater, United Kingdom"

    def test_jobposting_inside_a_graph(self):
        graph = {"@context": "https://schema.org", "@graph": [ALTRAD]}
        assert location_from_jsonld(page(graph)) == "Bridgwater, United Kingdom"

    def test_type_given_as_a_list(self):
        job = {**ALTRAD, "@type": ["JobPosting", "Thing"]}
        assert location_from_jsonld(page(job)) == "Bridgwater, United Kingdom"

    def test_joblocation_given_as_a_list_takes_the_first(self):
        job = {**ALTRAD, "jobLocation": [ALTRAD["jobLocation"]]}
        assert location_from_jsonld(page(job)) == "Bridgwater, United Kingdom"

    def test_region_used_when_there_is_no_locality(self):
        job = {
            "@type": "JobPosting",
            "jobLocation": {
                "address": {"addressRegion": "Aberdeenshire", "addressCountry": "United Kingdom"}
            },
        }
        assert location_from_jsonld(page(job)) == "Aberdeenshire, United Kingdom"

    def test_country_alone_is_still_useful(self):
        job = {"@type": "JobPosting", "jobLocation": {"address": {"addressCountry": "Norway"}}}
        assert location_from_jsonld(page(job)) == "Norway"

    def test_locality_alone(self):
        job = {"@type": "JobPosting", "jobLocation": {"address": {"addressLocality": "Aberdeen"}}}
        assert location_from_jsonld(page(job)) == "Aberdeen"

    def test_address_as_a_plain_string(self):
        job = {"@type": "JobPosting", "jobLocation": {"address": "Aberdeen, United Kingdom"}}
        assert location_from_jsonld(page(job)) == "Aberdeen, United Kingdom"

    def test_country_as_an_object(self):
        job = {
            "@type": "JobPosting",
            "jobLocation": {
                "address": {
                    "addressLocality": "Stavanger",
                    "addressCountry": {"@type": "Country", "name": "Norway"},
                }
            },
        }
        assert location_from_jsonld(page(job)) == "Stavanger, Norway"

    def test_duplicate_locality_and_country_not_repeated(self):
        job = {
            "@type": "JobPosting",
            "jobLocation": {"address": {"addressLocality": "Singapore", "addressCountry": "Singapore"}},
        }
        assert location_from_jsonld(page(job)) == "Singapore"


class TestNothingToFind:
    @pytest.mark.parametrize(
        "html",
        [
            "",
            "<html><body>no scripts here</body></html>",
            '<script type="application/ld+json">{not json at all}</script>',
            page({"@type": "Organization", "name": "Altrad"}),
            page({"@type": "JobPosting", "title": "No location given"}),
            page({"@type": "JobPosting", "jobLocation": {"address": {}}}),
        ],
    )
    def test_returns_none(self, html):
        assert location_from_jsonld(html) is None

    def test_one_unparseable_block_does_not_hide_a_good_one(self):
        html = '<script type="application/ld+json">{broken</script>' + page(ALTRAD)
        assert location_from_jsonld(html) == "Bridgwater, United Kingdom"
