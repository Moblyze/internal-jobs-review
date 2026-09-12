"""Source-page liveness: is a scraped job still open at its source?

WHY THIS EXISTS (2026-09-12)
----------------------------
The lifecycle manager retires a job when it is missing from a listing diff.
That diff has false positives (SuccessFactors page caps, timeouts, partial
scrapes) and cannot see rows the state DB never knew. Jesse's direction on
2026-09-12: closures come from asking the SOURCE PAGE, and the flat 120-day
freshness rule is replaced by this per-URL liveness signal.

Rules were calibrated on a 726-URL probe the same day (liveness_probe_2026-09-12.csv):

  Workday          /wday/cxs/{tenant}/{site}/job/... JSON: 200 posted=true -> LIVE
                   (endDate = validThrough); 403 errorCode S22 or 404 -> DEAD
  SuccessFactors / TalentBrew / Avature (careers.<co>.com/job/.../<id>/)
                   JobPosting microdata with validThrough -> LIVE unless the
                   date is past; "position has been filled" / "no longer
                   taking" / "no longer available" markers -> DEAD
  Eightfold        live page carries a JSON-LD JobPosting; a gone job renders
                   the bare careers shell with no JobPosting -> DEAD. Text
                   markers are ignored ("has expired" is a password-reset
                   string on every page).
  Oracle HCM       recruitingCEJobRequisitionDetails REST: items -> LIVE
                   (ExternalPostedEndDate = validThrough); empty -> DEAD
  Workable         job page: redirect to ?not_found=true -> DEAD; title on
                   page -> LIVE; api/v1 job detail as a fallback (404 -> DEAD)
  OSM Thome        maritime.osmaportal.com/api/jobs/{id}: 200 -> LIVE, 404 -> DEAD
  ADP              job-requisitions/{id} REST: requisitionTitle -> LIVE, else DEAD
  CrewBase         the site's job sitemaps list every live URL; a row whose
                   URL is not in the sitemap is DEAD (per-page GET is 410 for
                   those). No per-page requests at all.
  everything else  generic HTML: 404/410 -> DEAD; JSON-LD JobPosting ->
                   LIVE (validThrough past -> DEAD); redirect to the listing
                   -> DEAD; expiry marker -> DEAD; job title on the page ->
                   LIVE; otherwise UNKNOWN
  Indeed, Jooble, LinkedIn, Glassdoor are never requested (challenge walls,
  robots, ToS) -> UNKNOWN "host excluded".

Politeness: browser-like User-Agent, 10 s timeout, redirects followed, one
request per second per host, no retries, robots.txt honored for both the row
URL and the URL actually fetched (disallowed -> UNKNOWN with the reason).

Every classifier is a pure function over (response, title, today) so the
rules are testable on saved fixtures without a network.
"""

from __future__ import annotations

import html as htmlmod
import json
import logging
import re
import threading
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx

logger = logging.getLogger(__name__)

LIVE = "LIVE"
DEAD = "DEAD"
BLOCKED = "BLOCKED"
UNKNOWN = "UNKNOWN"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
# No application/json in the HTML Accept: Workday content-negotiates and
# answers a 114-byte {"widget":"redirect"} JSON for every job when JSON is
# acceptable.
HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
JSON_ACCEPT = "application/json"
DEFAULT_TIMEOUT = 10.0
DEFAULT_MIN_INTERVAL = 1.0
MAX_BODY_BYTES = 2_500_000

# Hosts that are never requested. Indeed and Jooble answer with a Cloudflare
# challenge and their robots forbid job pages; LinkedIn and Glassdoor are
# ToS-restricted and authwalled.
EXCLUDED_HOST_SUFFIXES = ("indeed.com", "jooble.org", "linkedin.com", "glassdoor.com")

# host suffix -> classifier kind
HOST_KINDS = (
    ("myworkdayjobs.com", "workday"),
    ("eightfold.ai", "eightfold"),
    ("jobs.worley.com", "eightfold"),
    ("oraclecloud.com", "oracle"),
    ("apply.workable.com", "workable"),
    ("jobs.osmthome.com", "osm"),
    ("workforcenow.adp.com", "adp"),
    ("crewbase.pro", "crewbase"),
)
# companies.yaml platform -> classifier kind (a hint; the host wins when it is a known ATS host)
PLATFORM_KINDS = {
    "workday": "workday",
    "workday_api": "workday",
    "eightfold": "eightfold",
    "oracle_hcm": "oracle",
    "workable": "workable",
    "adp": "adp",
    "crewbase": "crewbase",
}

CREWBASE_SITEMAP_INDEX = "https://crewbase.pro/sitemap.xml"
_SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

EXPIRED_RE = re.compile(
    r"(no longer available|no longer accepting|no longer taking|no longer active|no longer open|"
    r"no longer posted|no longer exists|has expired|job (has )?expired|this job is expired|"
    r"position has been filled|has been filled|job not found|posting (has )?(closed|expired)|"
    r"not currently accepting|cannot be found|could not be found|could not find (the|this) job|"
    r"is closed|requisition is no longer|job you (requested|are looking for)|job (is )?unavailable|"
    r"not available anymore|has been (closed|removed)|(we're|we are) sorry)",
    re.I,
)
CHALLENGE_RE = re.compile(
    r"(cf-chl|challenge-platform|Just a moment|Attention Required|Authenticating\.\.\.|"
    r"Access Denied|Please verify you are a human|captcha)",
    re.I,
)
_LISTING_PATHS = {
    "", "/jobs", "/careers", "/search", "/jobs/search", "/search-jobs", "/careers/search",
    "/en-us", "/en", "/home",
}
_LOCALE_RE = re.compile(r"^[a-z]{2}-[A-Z]{2}$")
_META_VALID_THROUGH_RE = (
    re.compile(r"itemprop=[\"']validThrough[\"']\s+content=[\"']([^\"']+)"),
    re.compile(r"content=[\"']([^\"']+)[\"']\s+itemprop=[\"']validThrough[\"']"),
)


@dataclass
class Response:
    """The parts of an HTTP exchange the classifiers look at."""

    status_code: Optional[int]
    url: str            # final URL after redirects
    text: str = ""
    error: Optional[str] = None


@dataclass
class Verdict:
    status: str
    reason: str
    valid_through: Optional[str] = None   # ISO date (YYYY-MM-DD) when the source states one
    http: Optional[int] = None
    fetched_url: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "reason": self.reason,
            "valid_through": self.valid_through,
            "http": self.http,
            "fetched_url": self.fetched_url,
        }


# --------------------------------------------------------------------------
# text helpers
# --------------------------------------------------------------------------

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", htmlmod.unescape(s or "").lower()).strip()


def _text_of(body: str) -> str:
    b = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", body)
    b = re.sub(r"(?s)<[^>]+>", " ", b)
    return _norm(b)


def _title_tag(body: str) -> str:
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
    return htmlmod.unescape(m.group(1)).strip() if m else ""


def title_found(title: Optional[str], body: str) -> Optional[bool]:
    """Title present in the page text, or >= 70% of its significant tokens in <title>/h1.

    None when there is no title to look for.
    """
    t = _norm(title or "")
    if not t:
        return None
    if t in _text_of(body):
        return True
    toks = [w for w in t.split() if len(w) > 2]
    if not toks:
        return None
    head = _norm(_title_tag(body) + " " + " ".join(re.findall(r"(?is)<h1[^>]*>(.*?)</h1>", body)))
    return sum(w in head for w in toks) / len(toks) >= 0.7


def jsonld_jobposting(body: str) -> tuple[bool, Optional[str], Optional[str]]:
    """(has JobPosting, raw validThrough, JSON-LD title) from ld+json blocks or microdata."""
    for m in re.finditer(r"(?is)<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", body):
        raw = m.group(1).strip()
        try:
            d = json.loads(raw)
        except ValueError:
            if "JobPosting" in raw:
                vt = re.search(r'validThrough"\s*:\s*"([^"]+)', raw)
                ti = re.search(r'"title"\s*:\s*"([^"]+)', raw)
                return True, vt.group(1) if vt else None, ti.group(1) if ti else None
            continue
        items = d if isinstance(d, list) else [d]
        for it in list(items):
            if isinstance(it, dict) and "@graph" in it and isinstance(it["@graph"], list):
                items.extend(it["@graph"])
        for it in items:
            if not isinstance(it, dict):
                continue
            t = it.get("@type")
            if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
                return True, it.get("validThrough"), it.get("title")
    if re.search(r"itemtype=[\"'][^\"']*JobPosting", body):
        for rx in _META_VALID_THROUGH_RE:
            m = rx.search(body)
            if m:
                return True, m.group(1), None
        return True, None, None
    return False, None, None


_DATE_FORMATS = ("%a %b %d %H:%M:%S %Z %Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M", "%m/%d/%Y")


def parse_valid_through(raw: Optional[str]) -> Optional[str]:
    """Normalize the many validThrough spellings to an ISO date, or None."""
    if not raw:
        return None
    s = str(raw).strip()
    try:
        d = datetime.fromisoformat(re.sub(r"Z$", "+00:00", s))
        return d.date().isoformat()
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def _is_past(valid_through: Optional[str], today: date) -> bool:
    return bool(valid_through) and date.fromisoformat(valid_through) < today


def listing_redirect(url: str, final_url: Optional[str]) -> bool:
    """A job URL that lands on the careers listing/search page is a removed job."""
    if not final_url or final_url == url:
        return False
    p = urlparse(final_url)
    path = p.path.rstrip("/").lower()
    q = p.query.lower()
    if path in _LISTING_PATHS:
        return True
    if path.endswith(("/search-jobs", "/careers", "/jobs", "/all-subsea7-jobs")):
        return True
    return "q=" in q and "jobid" not in q


def _json(resp: Response):
    try:
        return json.loads(resp.text)
    except (ValueError, TypeError):
        return None


def _blocked(resp: Response) -> Optional[Verdict]:
    c = resp.status_code
    challenge = bool(CHALLENGE_RE.search(resp.text[:20000])) if resp.text else False
    if c in (401, 403, 429) or (c == 503 and challenge):
        return Verdict(BLOCKED, f"http {c}" + (" challenge" if challenge else ""), http=c)
    return None


def _transport(resp: Response) -> Optional[Verdict]:
    if resp.error:
        return Verdict(UNKNOWN, "error: " + resp.error[:60], http=resp.status_code)
    if resp.status_code == 503 and resp.text and CHALLENGE_RE.search(resp.text[:20000]):
        return Verdict(BLOCKED, "http 503 challenge", http=503)
    if resp.status_code is None or resp.status_code >= 500:
        return Verdict(UNKNOWN, f"http {resp.status_code}", http=resp.status_code)
    return None


# --------------------------------------------------------------------------
# classifiers (pure)
# --------------------------------------------------------------------------

def classify_html(url: str, resp: Response, title: Optional[str], today: date,
                  ignore_markers: bool = False, shell_is_dead: Optional[str] = None) -> Verdict:
    """Generic page classifier; the per-ATS HTML rules are parameters on top of it."""
    v = _transport(resp)
    if v:
        return v
    c = resp.status_code
    if c in (404, 410):
        return Verdict(DEAD, f"http {c}", http=c)
    v = _blocked(resp)
    if v:
        return v
    body = resp.text or ""
    if "not_found=true" in (resp.url or ""):
        return Verdict(DEAD, "redirect not_found", http=c)
    if listing_redirect(url, resp.url):
        return Verdict(DEAD, "redirect to listing", http=c)
    has_jp, vt_raw, _jt = jsonld_jobposting(body)
    if has_jp:
        vt = parse_valid_through(vt_raw)
        if _is_past(vt, today):
            return Verdict(DEAD, f"validThrough past {vt}", valid_through=vt, http=c)
        return Verdict(LIVE, "jsonld JobPosting", valid_through=vt, http=c)
    if shell_is_dead:
        return Verdict(DEAD, shell_is_dead, http=c)
    if not ignore_markers:
        m = EXPIRED_RE.search(_text_of(body))
        if m:
            return Verdict(DEAD, "marker: " + m.group(0)[:40], http=c)
    found = title_found(title, body)
    if found:
        return Verdict(LIVE, "title on page", http=c)
    if found is False:
        return Verdict(UNKNOWN, "title missing, no marker", http=c)
    return Verdict(UNKNOWN, "ambiguous", http=c)


def classify_eightfold(url: str, resp: Response, title: Optional[str], today: date) -> Verdict:
    return classify_html(url, resp, title, today, ignore_markers=True,
                         shell_is_dead="eightfold shell, no JobPosting")


def classify_workday_cxs(resp: Response, today: date) -> Verdict:
    v = _transport(resp)
    if v:
        return v
    c = resp.status_code
    if c == 404:
        return Verdict(DEAD, "cxs 404", http=c)
    if c == 403 and '"S22"' in (resp.text or ""):
        return Verdict(DEAD, "cxs S22 permission denied (job not posted)", http=c)
    v = _blocked(resp)
    if v:
        return v
    if c != 200:
        return Verdict(UNKNOWN, f"cxs http {c}", http=c)
    d = _json(resp)
    info = (d or {}).get("jobPostingInfo") if isinstance(d, dict) else None
    if not isinstance(info, dict) or not info:
        return Verdict(UNKNOWN, "cxs 200 without jobPostingInfo", http=c)
    vt = parse_valid_through(info.get("endDate"))
    if info.get("posted", True) is False:
        return Verdict(DEAD, "cxs posted=false", valid_through=vt, http=c)
    if _is_past(vt, today):
        return Verdict(DEAD, f"validThrough past {vt}", valid_through=vt, http=c)
    return Verdict(LIVE, "cxs posted", valid_through=vt, http=c)


def classify_oracle_api(resp: Response, today: date) -> Verdict:
    v = _transport(resp)
    if v:
        return v
    v = _blocked(resp)
    if v:
        return v
    c = resp.status_code
    if c == 404:
        return Verdict(DEAD, "oracle 404", http=c)
    d = _json(resp)
    if not isinstance(d, dict) or "items" not in d:
        return Verdict(UNKNOWN, f"oracle http {c}, no items field", http=c)
    items = d.get("items") or []
    if not items:
        return Verdict(DEAD, "oracle: requisition not found", http=c)
    vt = parse_valid_through((items[0] or {}).get("ExternalPostedEndDate"))
    if _is_past(vt, today):
        return Verdict(DEAD, f"validThrough past {vt}", valid_through=vt, http=c)
    return Verdict(LIVE, "oracle requisition", valid_through=vt, http=c)


def classify_workable_api(resp: Response) -> Verdict:
    v = _transport(resp)
    if v:
        return v
    v = _blocked(resp)
    if v:
        return v
    c = resp.status_code
    if c == 404:
        return Verdict(DEAD, "workable api 404", http=c)
    d = _json(resp)
    if c == 200 and isinstance(d, dict) and d.get("title"):
        return Verdict(LIVE, "workable api job", http=c)
    return Verdict(UNKNOWN, f"workable api http {c}", http=c)


def classify_osm_api(resp: Response) -> Verdict:
    v = _transport(resp)
    if v:
        return v
    v = _blocked(resp)
    if v:
        return v
    c = resp.status_code
    if c == 404:
        return Verdict(DEAD, "osm api 404 (no longer available)", http=c)
    d = _json(resp)
    data = (d or {}).get("data", d) if isinstance(d, dict) else None
    if c == 200 and isinstance(data, dict) and (data.get("id") or data.get("name") or data.get("title")):
        if data.get("is_expired") is True or data.get("is_active") is False:
            return Verdict(DEAD, "osm api expired/inactive", http=c)
        return Verdict(LIVE, "osm api job", http=c)
    return Verdict(UNKNOWN, f"osm api http {c}", http=c)


_ADP_OPEN_STATES = {"open", "active", "published", "posted"}


def classify_adp_api(resp: Response) -> Verdict:
    v = _transport(resp)
    if v:
        return v
    v = _blocked(resp)
    if v:
        return v
    c = resp.status_code
    if c == 404:
        return Verdict(DEAD, "adp api 404", http=c)
    d = _json(resp)
    if c != 200 or not isinstance(d, dict):
        return Verdict(UNKNOWN, f"adp api http {c}", http=c)
    if not d.get("requisitionTitle"):
        return Verdict(DEAD, "adp: requisition has no title (unpublished)", http=c)
    state = d.get("requisitionStatusCode")
    if isinstance(state, dict):
        state = state.get("codeValue")
    if state and str(state).lower() not in _ADP_OPEN_STATES:
        return Verdict(DEAD, f"adp status {state}", http=c)
    return Verdict(LIVE, "adp requisition", http=c)


def classify_crewbase(url: str, live_urls: Optional[set]) -> Verdict:
    if live_urls is None:
        return Verdict(UNKNOWN, "crewbase sitemap unavailable")
    if url.rstrip("/") in live_urls:
        return Verdict(LIVE, "in crewbase sitemap")
    return Verdict(DEAD, "not in crewbase sitemap")


# --------------------------------------------------------------------------
# URL builders for the per-ATS status endpoints
# --------------------------------------------------------------------------

def workday_cxs_url(url: str) -> Optional[str]:
    """https://{tenant}.wdN.myworkdayjobs.com/{locale}/{site}/job/... -> /wday/cxs/{tenant}/{site}/job/..."""
    p = urlparse(url)
    parts = [x for x in p.path.split("/") if x]
    if not parts:
        return None
    if _LOCALE_RE.match(parts[0]):
        parts = parts[1:]
    if len(parts) < 3 or parts[1] != "job":
        return None
    tenant = p.netloc.split(".")[0]
    return f"https://{p.netloc}/wday/cxs/{tenant}/{parts[0]}/" + "/".join(parts[1:])


def workday_site_url(url: str) -> Optional[str]:
    """The same Workday job URL without its /{locale}/ prefix (the form robots rules use)."""
    p = urlparse(url)
    parts = [x for x in p.path.split("/") if x]
    if len(parts) >= 2 and _LOCALE_RE.match(parts[0]):
        return f"https://{p.netloc}/" + "/".join(parts[1:])
    return None


def oracle_api_url(url: str) -> Optional[str]:
    p = urlparse(url)
    m = re.search(r"/sites/([^/]+)/job/(\d+)", p.path)
    if not m:
        return None
    site, rid = m.group(1), m.group(2)
    return (f"https://{p.netloc}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails"
            f"?expand=all&onlyData=true&finder=ById;Id=\"{rid}\",siteNumber={site}")


def workable_api_url(url: str) -> Optional[str]:
    m = re.match(r"/([^/]+)/j/([^/]+)/?", urlparse(url).path)
    if not m:
        return None
    return f"https://apply.workable.com/api/v1/accounts/{m.group(1)}/jobs/{m.group(2)}"


def osm_api_url(url: str) -> Optional[str]:
    m = re.search(r"/jobs/(\d+)", urlparse(url).path)
    return f"https://maritime.osmaportal.com/api/jobs/{m.group(1)}" if m else None


def adp_api_url(url: str) -> Optional[str]:
    q = parse_qs(urlparse(url).query)
    jid, cid, cc = (q.get("jobId") or [None])[0], (q.get("cid") or [None])[0], (q.get("ccId") or [""])[0]
    if not (jid and cid):
        return None
    return (f"https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/"
            f"job-requisitions/{jid}?cid={cid}&ccId={cc}&lang=en_US")


def host_kind(url: str, platform: Optional[str] = None) -> str:
    host = urlparse(url).netloc.lower()
    for suffix, kind in HOST_KINDS:
        if host == suffix or host.endswith("." + suffix):
            return kind
    return PLATFORM_KINDS.get(platform or "", "html")


def is_excluded_host(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(host == s or host.endswith("." + s) for s in EXCLUDED_HOST_SUFFIXES)


def parse_sitemap_urls(xml_text: str) -> tuple[list[str], list[str]]:
    """(child sitemap locs, url locs) from a sitemap index or a urlset."""
    root = ET.fromstring(xml_text)
    sitemaps = [e.text.strip() for e in root.iter(_SITEMAP_NS + "sitemap")
                for e in [e.find(_SITEMAP_NS + "loc")] if e is not None and e.text]
    urls = [e.text.strip() for e in root.iter(_SITEMAP_NS + "url")
            for e in [e.find(_SITEMAP_NS + "loc")] if e is not None and e.text]
    return sitemaps, urls


# --------------------------------------------------------------------------
# the prober (network side)
# --------------------------------------------------------------------------

class LivenessProber:
    """Throttled, robots-aware, retry-free fetcher that routes each URL to its classifier."""

    def __init__(self, user_agent: str = USER_AGENT, timeout: float = DEFAULT_TIMEOUT,
                 min_interval: float = DEFAULT_MIN_INTERVAL, honor_robots: bool = True,
                 today: Optional[date] = None, client: Optional[httpx.Client] = None):
        self.user_agent = user_agent
        self.min_interval = min_interval
        self.honor_robots = honor_robots
        self.today = today or datetime.now(timezone.utc).date()
        self._client = client or httpx.Client(
            headers={"User-Agent": user_agent, "Accept-Language": "en-US,en;q=0.9"},
            timeout=timeout, follow_redirects=True,
        )
        self._lock = threading.Lock()
        self._next_slot: dict[str, float] = {}
        self._robots: dict[str, Optional[urllib.robotparser.RobotFileParser]] = {}
        self._robots_lock = threading.Lock()
        self._crewbase_live: Optional[set] = None
        self._crewbase_loaded = False
        self._crewbase_lock = threading.Lock()
        self.requests_made = 0

    # -- transport ---------------------------------------------------------

    def _throttle(self, host: str) -> None:
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next_slot.get(host, 0.0))
            self._next_slot[host] = slot + self.min_interval
        if slot > now:
            time.sleep(slot - now)

    def fetch(self, url: str, accept: str = HTML_ACCEPT, headers: Optional[dict] = None) -> Response:
        """One request, throttled per host, no retries."""
        self._throttle(urlparse(url).netloc.lower())
        h = {"Accept": accept}
        if headers:
            h.update(headers)
        with self._lock:
            self.requests_made += 1
        try:
            r = self._client.get(url, headers=h)
        except httpx.HTTPError as e:
            return Response(None, url, "", error=type(e).__name__ + ": " + str(e)[:80])
        text = r.text if len(r.content) <= MAX_BODY_BYTES else r.content[:MAX_BODY_BYTES].decode("utf-8", "replace")
        return Response(r.status_code, str(r.url), text)

    # -- robots --------------------------------------------------------------

    def _robots_for(self, host: str) -> Optional[urllib.robotparser.RobotFileParser]:
        """RobotFileParser for the host; None when robots.txt could not be read (5xx/error)."""
        with self._robots_lock:
            if host in self._robots:
                return self._robots[host]
        rp = urllib.robotparser.RobotFileParser()
        resp = self.fetch(f"https://{host}/robots.txt", accept="text/plain,*/*;q=0.8")
        if resp.error or resp.status_code is None or resp.status_code >= 500:
            result = None
        elif resp.status_code >= 400:
            rp.parse([])          # no robots file: everything allowed
            result = rp
        else:
            rp.parse(resp.text.splitlines())
            result = rp
        with self._robots_lock:
            self._robots[host] = result
        return result

    def robots_allows(self, url: str) -> tuple[bool, str]:
        if not self.honor_robots:
            return True, ""
        host = urlparse(url).netloc.lower()
        rp = self._robots_for(host)
        if rp is None:
            return False, f"robots.txt unavailable on {host}"
        if rp.can_fetch(self.user_agent, url):
            return True, ""
        return False, f"robots disallows {urlparse(url).path[:60]} on {host}"

    # -- crewbase ------------------------------------------------------------

    def crewbase_live_urls(self, index_url: str = CREWBASE_SITEMAP_INDEX) -> Optional[set]:
        """Every job URL in CrewBase's sitemaps, or None if any shard failed (never guess)."""
        with self._crewbase_lock:
            if self._crewbase_loaded:
                return self._crewbase_live
            self._crewbase_loaded = True
            allowed, why = self.robots_allows(index_url)
            if not allowed:
                logger.warning("crewbase sitemap skipped: %s", why)
                return None
            idx = self.fetch(index_url, accept="application/xml,text/xml,*/*;q=0.8")
            if idx.error or idx.status_code != 200:
                logger.warning("crewbase sitemap index failed: http %s %s", idx.status_code, idx.error)
                return None
            try:
                shards, urls = parse_sitemap_urls(idx.text)
            except ET.ParseError as e:
                logger.warning("crewbase sitemap index unparsable: %s", e)
                return None
            live = set(u.rstrip("/") for u in urls)
            job_shards = [s for s in shards if "sitemap-jobs" in s]
            for shard in job_shards:
                r = self.fetch(shard, accept="application/xml,text/xml,*/*;q=0.8")
                if r.error or r.status_code != 200:
                    logger.warning("crewbase shard failed (%s): http %s %s", shard, r.status_code, r.error)
                    return None
                try:
                    _s, shard_urls = parse_sitemap_urls(r.text)
                except ET.ParseError as e:
                    logger.warning("crewbase shard unparsable (%s): %s", shard, e)
                    return None
                live.update(u.rstrip("/") for u in shard_urls)
            if not job_shards or not live:
                logger.warning("crewbase sitemap listed no job shards / urls; treating as unavailable")
                return None
            self._crewbase_live = live
            logger.info("crewbase sitemap: %d live job urls across %d shards", len(live), len(job_shards))
            return live

    # -- routing -------------------------------------------------------------

    def probe(self, url: str, title: Optional[str] = None, platform: Optional[str] = None) -> Verdict:
        """LIVE / DEAD / BLOCKED / UNKNOWN for one job URL."""
        if is_excluded_host(url):
            return Verdict(UNKNOWN, "host excluded (challenge wall / robots / ToS)")
        kind = host_kind(url, platform)
        if kind == "crewbase":
            return classify_crewbase(url, self.crewbase_live_urls())

        api_url = None
        if kind == "workday":
            api_url = workday_cxs_url(url)
        elif kind == "oracle":
            api_url = oracle_api_url(url)
        elif kind == "osm":
            api_url = osm_api_url(url)
        elif kind == "adp":
            api_url = adp_api_url(url)

        to_check = [url, api_url]
        if kind == "workday":
            # Workday tenants write robots rules against the site root
            # (Disallow: /bpCareers/) while rows carry the localized form
            # (/en-US/bpCareers/...): honor the rule as the tenant meant it.
            to_check.append(workday_site_url(url))
        for u in filter(None, to_check):
            allowed, why = self.robots_allows(u)
            if not allowed:
                return Verdict(UNKNOWN, why, fetched_url=u)

        if kind == "workday" and api_url:
            resp = self.fetch(api_url, accept=JSON_ACCEPT)
            v = classify_workday_cxs(resp, self.today)
        elif kind == "oracle" and api_url:
            resp = self.fetch(api_url, accept=JSON_ACCEPT)
            v = classify_oracle_api(resp, self.today)
        elif kind == "osm" and api_url:
            resp = self.fetch(api_url, accept=JSON_ACCEPT, headers={"X-Job-Portal": "yes"})
            v = classify_osm_api(resp)
        elif kind == "adp" and api_url:
            resp = self.fetch(api_url, accept=JSON_ACCEPT)
            v = classify_adp_api(resp)
        elif kind == "eightfold":
            resp = self.fetch(url)
            v = classify_eightfold(url, resp, title, self.today)
        elif kind == "workable":
            resp = self.fetch(url)
            v = classify_html(url, resp, title, self.today)
            wapi = workable_api_url(url)
            if v.status == UNKNOWN and wapi:
                allowed, why = self.robots_allows(wapi)
                if allowed:
                    resp = self.fetch(wapi, accept=JSON_ACCEPT)
                    v = classify_workable_api(resp)
                    api_url = wapi
        else:
            resp = self.fetch(url)
            v = classify_html(url, resp, title, self.today)
        v.fetched_url = api_url or url
        return v

    def close(self) -> None:
        self._client.close()
