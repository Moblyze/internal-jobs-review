#!/usr/bin/env python3
"""Liveness classifier tests on saved source pages, one live and one dead per ATS.

Fixtures under tests/fixtures/liveness/ were captured on 2026-09-12 from the URLs
in each *.meta.json (large script/style blocks stripped). No test touches the
network: classifiers are pure, and the prober runs on an httpx.MockTransport.

Run with: python -m pytest tests/test_liveness.py -v
"""

import json
import os
from datetime import date

import httpx
import pytest

from src.utils import liveness as lv

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "liveness")
TODAY = date(2026, 9, 12)


def fixture(name: str) -> lv.Response:
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        body = f.read()
    with open(os.path.join(FX, name + ".meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    return lv.Response(meta["status"], meta["final_url"], body)


def meta(name: str) -> dict:
    with open(os.path.join(FX, name + ".meta.json"), encoding="utf-8") as f:
        return json.load(f)


class TestWorkday:
    def test_live_cxs_json_is_live_with_end_date(self):
        v = lv.classify_workday_cxs(fixture("workday_cxs_live.json"), TODAY)
        assert v.status == lv.LIVE
        assert v.valid_through == "2026-09-18"

    def test_s22_permission_denied_is_dead(self):
        v = lv.classify_workday_cxs(fixture("workday_cxs_dead.json"), TODAY)
        assert (v.status, v.http) == (lv.DEAD, 403)

    def test_end_date_in_the_past_is_dead(self):
        v = lv.classify_workday_cxs(fixture("workday_cxs_live.json"), date(2026, 9, 19))
        assert v.status == lv.DEAD and "validThrough past" in v.reason

    def test_other_403_is_blocked_not_dead(self):
        r = lv.Response(403, "https://x.wd5.myworkdayjobs.com/wday/cxs/x/site/job/a", '{"errorCode":"S99"}')
        assert lv.classify_workday_cxs(r, TODAY).status == lv.BLOCKED

    def test_cxs_url_builder(self):
        assert lv.workday_cxs_url(
            "https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/Houston-Texas/QA-Manager_R2097766"
        ) == "https://kbr.wd5.myworkdayjobs.com/wday/cxs/kbr/KBR_Careers/job/Houston-Texas/QA-Manager_R2097766"
        assert lv.workday_cxs_url("https://kbr.wd5.myworkdayjobs.com/KBR_Careers") is None


class TestSuccessFactorsFamily:
    def test_technipfmc_live_microdata_valid_through(self):
        v = lv.classify_html(meta("successfactors_live.html")["url"], fixture("successfactors_live.html"),
                             "TEC SERVICOS OFFSHORE", TODAY)
        assert v.status == lv.LIVE
        assert v.valid_through == "2026-09-18"

    def test_phillips66_position_filled_is_dead(self):
        v = lv.classify_html(meta("successfactors_dead.html")["url"], fixture("successfactors_dead.html"),
                             "Instrument and Electrical Technician", TODAY)
        assert v.status == lv.DEAD and "position has been filled" in v.reason

    def test_exxon_no_longer_taking_is_dead(self):
        v = lv.classify_html(meta("successfactors_dead_exxon.html")["url"],
                             fixture("successfactors_dead_exxon.html"), "Design Supervisor", TODAY)
        assert v.status == lv.DEAD and "no longer taking" in v.reason

    def test_lrqa_dead(self):
        v = lv.classify_html(meta("lrqa_dead.html")["url"], fixture("lrqa_dead.html"), "Trainer", TODAY)
        assert v.status == lv.DEAD

    def test_subsea7_live_and_dead(self):
        live = lv.classify_html(meta("avature_live.html")["url"], fixture("avature_live.html"), None, TODAY)
        dead = lv.classify_html(meta("avature_dead.html")["url"], fixture("avature_dead.html"), None, TODAY)
        assert live.status == lv.LIVE and live.valid_through == "2026-12-11"
        assert dead.status == lv.DEAD

    def test_live_page_with_past_valid_through_is_dead(self):
        v = lv.classify_html(meta("successfactors_live.html")["url"], fixture("successfactors_live.html"),
                             None, date(2026, 12, 1))
        assert v.status == lv.DEAD and v.valid_through == "2026-09-18"


class TestEightfold:
    def test_live_has_jobposting(self):
        v = lv.classify_eightfold(meta("eightfold_live.html")["url"], fixture("eightfold_live.html"), None, TODAY)
        assert v.status == lv.LIVE and v.valid_through == "2027-03-10"

    def test_shell_without_jobposting_is_dead(self):
        v = lv.classify_eightfold(meta("eightfold_dead.html")["url"], fixture("eightfold_dead.html"), None, TODAY)
        assert v.status == lv.DEAD and "shell" in v.reason

    def test_has_expired_marker_is_ignored_on_eightfold(self):
        # every Eightfold page carries a password-reset "has expired" string
        assert lv.EXPIRED_RE.search(lv._text_of(fixture("eightfold_live.html").text))
        assert lv.classify_eightfold("https://slb.eightfold.ai/careers/job/1", fixture("eightfold_live.html"),
                                     None, TODAY).status == lv.LIVE


class TestOracleHcm:
    def test_live_requisition(self):
        v = lv.classify_oracle_api(fixture("oracle_live.json"), TODAY)
        assert v.status == lv.LIVE and v.valid_through is None

    def test_empty_items_is_dead(self):
        assert lv.classify_oracle_api(fixture("oracle_dead.json"), TODAY).status == lv.DEAD

    def test_api_url(self):
        u = lv.oracle_api_url("https://ebfr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobs/job/29160")
        assert u.startswith("https://ebfr.fa.us2.oraclecloud.com/hcmRestApi/") and 'Id="29160"' in u and "siteNumber=jobs" in u


class TestWorkable:
    def test_live_page_title(self):
        m = meta("workable_live.html")
        v = lv.classify_html(m["url"], fixture("workable_live.html"), "Party Chief / Senior Surveyor", TODAY)
        assert v.status == lv.LIVE

    def test_not_found_redirect_is_dead(self):
        m = meta("workable_dead.html")
        v = lv.classify_html(m["url"], fixture("workable_dead.html"), "Anything", TODAY)
        assert v.status == lv.DEAD and v.reason == "redirect not_found"

    def test_api_fallback(self):
        live = lv.Response(200, "https://apply.workable.com/api/v1/accounts/a/jobs/b", '{"title":"Surveyor"}')
        gone = lv.Response(404, "https://apply.workable.com/api/v1/accounts/a/jobs/b", "")
        limited = lv.Response(429, "https://apply.workable.com/api/v1/accounts/a/jobs/b", "")
        assert lv.classify_workable_api(live).status == lv.LIVE
        assert lv.classify_workable_api(gone).status == lv.DEAD
        assert lv.classify_workable_api(limited).status == lv.BLOCKED


class TestOsmThome:
    def test_live(self):
        assert lv.classify_osm_api(fixture("osm_live.json")).status == lv.LIVE

    def test_404_is_dead(self):
        assert lv.classify_osm_api(fixture("osm_dead.json")).status == lv.DEAD


class TestAdp:
    def test_live(self):
        assert lv.classify_adp_api(fixture("adp_live.json")).status == lv.LIVE

    def test_untitled_requisition_is_dead(self):
        assert lv.classify_adp_api(fixture("adp_dead.json")).status == lv.DEAD

    def test_api_url(self):
        u = lv.adp_api_url("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html"
                           "?cid=d096c643&ccId=1900010&jobId=9206942316511_1&lang=en_US")
        assert u.endswith("job-requisitions/9206942316511_1?cid=d096c643&ccId=1900010&lang=en_US")


class TestGenericHtml:
    def test_easyapply_live_jsonld_and_dead_marker(self):
        live = lv.classify_html(meta("easyapply_live.html")["url"], fixture("easyapply_live.html"), None, TODAY)
        dead = lv.classify_html(meta("easyapply_dead.html")["url"], fixture("easyapply_dead.html"), "Driver", TODAY)
        assert live.status == lv.LIVE and live.valid_through == "2026-10-12"
        assert dead.status == lv.DEAD and "job you are looking for" in dead.reason

    def test_rippling_live_title_and_dead_listing_redirect(self):
        live = lv.classify_html(meta("rippling_live.html")["url"], fixture("rippling_live.html"),
                                "Intermediate Electrical Engineer", TODAY)
        assert live.status == lv.LIVE and live.reason == "title on page" and live.valid_through is None
        dead = lv.classify_html(meta("rippling_dead.html")["url"], fixture("rippling_dead.html"), "Anything", TODAY)
        assert dead.status == lv.DEAD and dead.reason == "redirect to listing"

    def test_petrofac_title_on_page_and_closed_marker(self):
        live = lv.classify_html(meta("petrofac_live.html")["url"], fixture("petrofac_live.html"),
                                "Senior Engineer, Quality", TODAY)
        dead = lv.classify_html(meta("petrofac_dead.html")["url"], fixture("petrofac_dead.html"),
                                "Maintenance Planner", TODAY)
        assert live.status == lv.LIVE and live.reason == "title on page"
        assert dead.status == lv.DEAD and "has been closed" in dead.reason

    def test_taleo_title_on_page(self):
        v = lv.classify_html(meta("taleo_live.html")["url"], fixture("taleo_live.html"), "Driller - Brazil", TODAY)
        assert v.status == lv.LIVE and v.reason == "title on page"
        # a different row title on the same page is not evidence either way
        v = lv.classify_html(meta("taleo_live.html")["url"], fixture("taleo_live.html"), "Subsea Welder", TODAY)
        assert v.status == lv.UNKNOWN

    def test_crewbase_page_410_is_dead_and_live_page_has_valid_through(self):
        dead = lv.classify_html(meta("crewbase_dead.html")["url"], fixture("crewbase_dead.html"), None, TODAY)
        live = lv.classify_html(meta("crewbase_live.html")["url"], fixture("crewbase_live.html"), None, TODAY)
        assert (dead.status, dead.http) == (lv.DEAD, 410)
        assert live.status == lv.LIVE and live.valid_through == "2026-10-12"

    def test_missing_title_without_marker_is_unknown(self):
        r = lv.Response(200, "https://example.com/job/1", "<html><title>Careers</title><body>Welcome</body></html>")
        assert lv.classify_html("https://example.com/job/1", r, "Subsea Engineer", TODAY).status == lv.UNKNOWN

    def test_challenge_and_5xx(self):
        r = lv.Response(503, "https://example.com/job/1", "<html>Just a moment...</html>")
        assert lv.classify_html("https://example.com/job/1", r, None, TODAY).status == lv.BLOCKED
        r = lv.Response(502, "https://example.com/job/1", "")
        assert lv.classify_html("https://example.com/job/1", r, None, TODAY).status == lv.UNKNOWN
        r = lv.Response(None, "https://example.com/job/1", "", error="ConnectTimeout: x")
        assert lv.classify_html("https://example.com/job/1", r, None, TODAY).status == lv.UNKNOWN


class TestValidThroughParsing:
    @pytest.mark.parametrize("raw,expected", [
        ("2026-10-12T17:03:18.447Z", "2026-10-12"),
        ("2026-10-12T00:00", "2026-10-12"),
        ("2027-03-10T11:23:05", "2027-03-10"),
        ("Fri Sep 18 03:00:00 UTC 2026", "2026-09-18"),
        ("2026-09-18", "2026-09-18"),
        ("", None),
        (None, None),
        ("soon", None),
    ])
    def test_parse(self, raw, expected):
        assert lv.parse_valid_through(raw) == expected


class TestCrewBaseSitemap:
    def test_sitemap_index_and_shard_parse(self):
        with open(os.path.join(FX, "crewbase_sitemap_index.xml"), encoding="utf-8") as f:
            shards, urls = lv.parse_sitemap_urls(f.read())
        assert "https://crewbase.pro/sitemap-jobs-0.xml" in shards and urls == []
        with open(os.path.join(FX, "crewbase_sitemap_jobs_0.xml"), encoding="utf-8") as f:
            shards, urls = lv.parse_sitemap_urls(f.read())
        assert shards == [] and len(urls) == 20 and urls[0].startswith("https://crewbase.pro/jobs/")

    def test_classify_against_live_set(self):
        live = {"https://crewbase.pro/jobs/abc"}
        assert lv.classify_crewbase("https://crewbase.pro/jobs/abc", live).status == lv.LIVE
        assert lv.classify_crewbase("https://crewbase.pro/jobs/zzz", live).status == lv.DEAD
        assert lv.classify_crewbase("https://crewbase.pro/jobs/zzz", None).status == lv.UNKNOWN


class TestRouting:
    def test_host_kinds(self):
        assert lv.host_kind("https://kbr.wd5.myworkdayjobs.com/en-US/x/job/a/b") == "workday"
        assert lv.host_kind("https://jobs.worley.com/careers/job/1") == "eightfold"
        assert lv.host_kind("https://careers.technipfmc.com/job/x/1/") == "html"
        assert lv.host_kind("https://careers.technipfmc.com/job/x/1/", platform="successfactors") == "html"
        assert lv.host_kind("https://crewbase.pro/jobs/x") == "crewbase"

    def test_excluded_hosts(self):
        assert lv.is_excluded_host("https://www.indeed.com/viewjob?jk=1")
        assert lv.is_excluded_host("https://uk.indeed.com/viewjob?jk=1")
        assert lv.is_excluded_host("https://jooble.org/jdp/1")
        assert lv.is_excluded_host("https://www.linkedin.com/jobs/view/1")
        assert not lv.is_excluded_host("https://jobs.worley.com/careers/job/1")


def _mock_prober(routes: dict, **kw) -> lv.LivenessProber:
    """A prober whose HTTP layer answers from `routes` {url_prefix: (status, body, headers)}."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        for prefix, (status, body, headers) in routes.items():
            if str(request.url).startswith(prefix):
                return httpx.Response(status, text=body, headers=headers or {})
        return httpx.Response(404, text="")

    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    p = lv.LivenessProber(client=client, min_interval=0, today=TODAY, **kw)
    p.calls = calls
    return p


class TestProber:
    def test_excluded_host_is_never_requested(self):
        p = _mock_prober({})
        v = p.probe("https://www.indeed.com/viewjob?jk=1")
        assert v.status == lv.UNKNOWN and "excluded" in v.reason and p.calls == []

    def test_robots_disallow_marks_unknown_without_fetching_the_page(self):
        p = _mock_prober({
            "https://career4.successfactors.com/robots.txt": (200, "User-agent: *\nDisallow: /\nAllow: /login\n", None),
        })
        v = p.probe("https://career4.successfactors.com/sfcareer/jobreqcareer?jobId=1&company=HALprod", "Welder")
        assert v.status == lv.UNKNOWN and v.reason.startswith("robots disallows")
        assert p.calls == ["https://career4.successfactors.com/robots.txt"]

    def test_workday_robots_rule_on_site_root_covers_localized_rows(self):
        # bpinternational.wd3.myworkdayjobs.com/robots.txt as of 2026-09-12
        robots = ("User-agent: *\nDisallow: /bpCareers/\nDisallow: /bpCWCareersSite/\n"
                  "Disallow: /bpEarlyCareers/\nDisallow: /bpPrivateExternalCareersSite/\nDisallow: /refreshFacet/")
        p = _mock_prober({"https://bpinternational.wd3.myworkdayjobs.com/robots.txt": (200, robots, None)})
        v = p.probe("https://bpinternational.wd3.myworkdayjobs.com/en-US/bpCareers/job/Loc/Role_R1")
        assert v.status == lv.UNKNOWN and "robots disallows /bpCareers/" in v.reason
        assert p.calls == ["https://bpinternational.wd3.myworkdayjobs.com/robots.txt"]

    def test_workday_allow_list_tenant_is_probed(self):
        # kbr.wd5.myworkdayjobs.com/robots.txt as of 2026-09-12
        robots = "User-agent: *\nAllow: /KBR_Careers/\nDisallow: /refreshFacet/\n"
        body = json.dumps({"jobPostingInfo": {"posted": True}})
        p = _mock_prober({
            "https://kbr.wd5.myworkdayjobs.com/robots.txt": (200, robots, None),
            "https://kbr.wd5.myworkdayjobs.com/wday/cxs/kbr/KBR_Careers/job/L/R_1": (200, body, None),
        })
        v = p.probe("https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/L/R_1")
        assert v.status == lv.LIVE and v.valid_through is None

    def test_robots_unavailable_marks_unknown(self):
        p = _mock_prober({"https://x.example/robots.txt": (503, "", None)})
        v = p.probe("https://x.example/job/1", "Rigger")
        assert v.status == lv.UNKNOWN and "unavailable" in v.reason

    def test_missing_robots_means_allowed(self):
        p = _mock_prober({
            "https://x.example/job/1": (200, '<html><title>Rigger Offshore - X</title></html>', None),
        })
        v = p.probe("https://x.example/job/1", "Rigger Offshore")
        assert v.status == lv.LIVE and v.fetched_url == "https://x.example/job/1"

    def test_eightfold_deny_by_default_with_specific_allow_is_probed(self):
        # slb.eightfold.ai/robots.txt and jobs.worley.com/robots.txt as of
        # 2026-09-13: "Disallow: /" followed by "Allow: /careers" is the
        # Eightfold-templated pattern that made Worley and Schlumberger come
        # back 100% UNKNOWN in the 2026-09-13 03:00Z probe (run
        # 34734549584) -- stdlib urllib.robotparser evaluates rules by file
        # order and hits "Disallow: /" before ever considering the longer,
        # more specific "Allow: /careers", incorrectly disallowing every job
        # page on the host. The real page (verified live 2026-09-13) has a
        # full JobPosting JSON-LD block, so a correctly-permissive robots
        # check should let this classify as LIVE.
        robots = ("User-agent: *\nDisallow: /\nAllow: /$\nAllow: /careers\n"
                  "Allow: /api/apply\nAllow: /api/pcsx\n")
        html = ('<html><script type="application/ld+json">'
                '{"@type": "JobPosting", "title": "Project Accountant II"}'
                '</script></html>')
        p = _mock_prober({
            "https://jobs.worley.com/robots.txt": (200, robots, None),
            "https://jobs.worley.com/careers/job/1133911358992": (200, html, None),
        })
        v = p.probe("https://jobs.worley.com/careers/job/1133911358992", platform="eightfold")
        assert v.status == lv.LIVE, v.reason
        assert p.calls == [
            "https://jobs.worley.com/robots.txt",
            "https://jobs.worley.com/careers/job/1133911358992",
        ]

    def test_eightfold_deny_by_default_still_blocks_paths_outside_any_allow(self):
        robots = "User-agent: *\nDisallow: /\nAllow: /careers\n"
        p = _mock_prober({"https://jobs.worley.com/robots.txt": (200, robots, None)})
        v = p.probe("https://jobs.worley.com/candidate/profile/1", platform="eightfold")
        assert v.status == lv.UNKNOWN and v.reason.startswith("robots disallows")


class TestRobotsLongestMatch:
    """Unit coverage for parse_robots_rules()/robots_can_fetch(), the
    longest-match-wins replacement for stdlib urllib.robotparser (2026-09-13:
    see the large comment above parse_robots_rules() in liveness.py)."""

    UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

    def test_longer_allow_beats_earlier_shorter_disallow(self):
        robots = "User-agent: *\nDisallow: /\nAllow: /careers\n"
        assert lv.robots_can_fetch(robots, self.UA, "/careers/job/123") is True

    def test_disallow_wins_outside_the_allow_prefix(self):
        robots = "User-agent: *\nDisallow: /\nAllow: /careers\n"
        assert lv.robots_can_fetch(robots, self.UA, "/candidate/login") is False

    def test_no_matching_rule_means_allowed(self):
        robots = "User-agent: *\nDisallow: /private/\n"
        assert lv.robots_can_fetch(robots, self.UA, "/careers/job/1") is True

    def test_end_anchor_matches_only_exact_path(self):
        robots = "User-agent: *\nDisallow: /\nAllow: /$\n"
        assert lv.robots_can_fetch(robots, self.UA, "/") is True
        assert lv.robots_can_fetch(robots, self.UA, "/careers") is False

    def test_equal_length_tie_prefers_allow(self):
        robots = "User-agent: *\nDisallow: /jobs\nAllow: /jobs\n"
        assert lv.robots_can_fetch(robots, self.UA, "/jobs") is True

    def test_wildcard_star_matches_any_sequence(self):
        robots = "User-agent: *\nDisallow: /*/refreshFacet\n"
        assert lv.robots_can_fetch(robots, self.UA, "/en-US/refreshFacet") is False
        assert lv.robots_can_fetch(robots, self.UA, "/en-US/job/1") is True

    def test_named_agent_group_overrides_star(self):
        robots = ("User-agent: *\nDisallow: /careers\n"
                   "User-agent: Mozilla\nAllow: /careers\n")
        assert lv.robots_can_fetch(robots, self.UA, "/careers/job/1") is True

    def test_empty_disallow_value_is_a_noop(self):
        robots = "User-agent: *\nDisallow:\n"
        assert lv.robots_can_fetch(robots, self.UA, "/anything") is True

    def test_workday_routes_to_cxs_and_honors_robots_off(self):
        body = json.dumps({"jobPostingInfo": {"posted": True, "endDate": "2026-12-31"}})
        p = _mock_prober({"https://t.wd5.myworkdayjobs.com/wday/cxs/t/Site/job/L/R_1": (200, body, None)},
                         honor_robots=False)
        v = p.probe("https://t.wd5.myworkdayjobs.com/en-US/Site/job/L/R_1")
        assert v.status == lv.LIVE and v.valid_through == "2026-12-31"
        assert v.fetched_url == "https://t.wd5.myworkdayjobs.com/wday/cxs/t/Site/job/L/R_1"

    def test_crewbase_uses_sitemap_not_pages(self):
        idx = ('<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
               '<sitemap><loc>https://crewbase.pro/sitemap-static.xml</loc></sitemap>'
               '<sitemap><loc>https://crewbase.pro/sitemap-jobs-0.xml</loc></sitemap></sitemapindex>')
        shard = ('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 '<url><loc>https://crewbase.pro/jobs/aaa</loc></url></urlset>')
        p = _mock_prober({
            "https://crewbase.pro/robots.txt": (404, "", None),
            "https://crewbase.pro/sitemap.xml": (200, idx, None),
            "https://crewbase.pro/sitemap-jobs-0.xml": (200, shard, None),
        })
        assert p.probe("https://crewbase.pro/jobs/aaa").status == lv.LIVE
        assert p.probe("https://crewbase.pro/jobs/bbb").status == lv.DEAD
        assert p.probe("https://crewbase.pro/jobs/ccc").status == lv.DEAD
        # robots + index + one job shard; never a job page, and only once
        assert sorted(p.calls) == ["https://crewbase.pro/robots.txt", "https://crewbase.pro/sitemap-jobs-0.xml",
                                   "https://crewbase.pro/sitemap.xml"]

    def test_crewbase_failed_shard_means_unknown_for_all(self):
        idx = ('<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
               '<sitemap><loc>https://crewbase.pro/sitemap-jobs-0.xml</loc></sitemap></sitemapindex>')
        p = _mock_prober({
            "https://crewbase.pro/robots.txt": (404, "", None),
            "https://crewbase.pro/sitemap.xml": (200, idx, None),
            "https://crewbase.pro/sitemap-jobs-0.xml": (500, "", None),
        })
        assert p.probe("https://crewbase.pro/jobs/aaa").status == lv.UNKNOWN

    def test_no_retries_on_transport_error(self):
        def handler(request):
            raise httpx.ConnectTimeout("slow")
        client = httpx.Client(transport=httpx.MockTransport(handler))
        p = lv.LivenessProber(client=client, min_interval=0, today=TODAY, honor_robots=False)
        v = p.probe("https://x.example/job/1", "Rigger")
        assert v.status == lv.UNKNOWN and v.reason.startswith("error:") and p.requests_made == 1
