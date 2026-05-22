# Contract-Role Source Map — Energy / Subsea / Rope Access

**Purpose:** Moblyze's institutional knowledge of **where contract/contingent energy roles get posted**, by market, with scrapeability and current ingest status. This map drives scraper-build priorities and feeds **employer demand-intelligence** into the target-clients BD pipeline.

**Last updated:** 2026-05-22 (initial build — from a parallel source audit + the existing aggregator-layer audit).

---

## Why this exists

Moblyze prioritizes **contract/contingent** placements (full-time still scraped, but contract is the priority). Contract roles rarely live on corporate career sites — those skew permanent. Contract demand surfaces first on:

1. **Staffing-agency boards** (Spencer Ogden, Airswift, NES Fircroft, Brunel, Orion, Atlas) — these are the *originators*. General energy boards (Rigzone, Energy Jobline) are largely downstream echoes of what agencies already pushed out.
2. **Niche subsea/rope boards** (SubseaJobs, ROV-Jobs, UnderwaterJobs, IRATA, SPRAT).
3. **Regional boards** for markets that bypass global boards (FINN.no for Norway, NGOilGas for Nigeria, Vagas for Brazil, NaukriGulf for the Gulf).

**Strategic reframe — agency boards as an intelligence asset.** We don't want the agencies as BD clients (they're filtered out of the target-clients employer rollup). But every contract role an agency posts reveals (or lets us infer) an **operator with live contract demand right now**. That is a leading BD signal — a ready buyer we can answer immediately with candidates. So:

```
contract posting (agency board / aggregator)
   → extract or infer the END EMPLOYER (the operator the role is really for)
   → set an "active contract demand" signal on that target-client record
   → BD trigger (hot account) + candidate match (we have people for it)
```

The crux that determines intelligence yield is **end-employer attribution**: how often a posting names or lets us infer the operator (named / inferable from project+location+role / blind). Blind postings still give market-level demand signal; named/inferable ones pin to a specific account. This must be measured per source.

**Focus markets (priority):**
- **Tier 1:** US Gulf, UK/North Sea
- **Tier 2:** Norway, West Africa (Nigeria/Angola/Ghana), Brazil, Middle East (UAE/Saudi/Qatar/Oman), APAC (Australia/Singapore/Malaysia)

---

## Current ingest status (2026-05-22)

The aggregator layer (`scrapers/src/aggregators/`, run by `.github/workflows/daily-scrape.yml` at 09:00 UTC, exporting to Google Sheets) is **live and producing ~1,000+ contract job records/day** across 21 of 28 search profiles.

| State | Sources |
|---|---|
| **Live & producing** | jobspy (Indeed/LinkedIn), adzuna, jooble, usajobs, rigzone, roadtechs, energyjobsearch, oilgasvacancy, gcaptain, oceancrew, linemancentral, riggaccess (rope), irata (rope), **airswift (agency)** |
| **Fixed 2026-05-22** | **ogvenergy** — was rate-limited on CI IPs, hanging 30s/query and starving the 7 broad profiles (subsea_oil_gas, ndt_inspection, drilling_operations, marine_offshore_ops, pipeline_mechanical, survey_geophysical, process_plant_operations). Timeout capped 30s→8s; those profiles now run. |
| **Revived & live 2026-05-22 (agency demand-intel)** | **nesfircroft** + **brunel** (discovered first-party JSON APIs), **oriongroup** (Vennture gateway API, `orionjobs.com`), **cammachbryant** (server-rendered, `wearecammach.com`, `jobType=3` contract filter). All agency-blind on end-client → *market-level* demand signal. |
| **New niche adapters 2026-05-22** | **rovplanet** (subsea/ROV trade board — postings name the employer → *per-account* attribution), **underwaterjobs** (commercial diving). Registry now 24 adapters. |
| **Disabled — dead source** | energyjobline (bot wall since 2026-03), energypeople (subdomain dead), oiljobfinder (403) |
| **Dropped — nonexistent / off-vertical** | `subseajobs.co.uk`, `rov-jobs.net`, `spratcertification.com` = NXDOMAIN; TowerClimber (SPRAT substitute) = telecom, off-vertical — rope access already covered by `irata` + `riggaccess`. |

---

## Full source map

Sorted roughly by contract-role density × focus-market coverage. "Covered?" = already in the ingest pipeline.

| Source | URL | Type | Markets | Contract focus | Scrapeability | Covered? |
|---|---|---|---|---|---|---|
| Spencer Ogden | spencerogden.com/jobs | Agency | Gulf, NS, Norway, ME, WA, Brazil, APAC | Strong | JS (React XHR) | No |
| Airswift | jobs.airswift.com | Agency | Gulf, NS, ME, Norway, APAC, WA, Brazil | Strong (10k+) | JS / works via adapter | **Yes** |
| NES Fircroft | nesfircroft.com/jobs | Agency | all focus markets | Strong | JS SPA (Vennture) | Broken |
| Brunel | brunel.net/en/jobs | Agency | NS, Norway, ME, NL, APAC, Brazil | Strong (contract-only) | JS (Sitecore React) | Broken |
| Orion Group | **orionjobs.com**/job-search | Agency | NS, Norway, ME, WA, Gulf | Strong (diving div.) | Vennture gateway JSON API | **Yes** |
| Petroplan | petroplan.com/jobs | Agency | NS, ME, Gulf, WA, APAC | Strong | JS (WP-JSON maybe) | No |
| Atlas Professionals | atlasprofessionals.com/en/vacancies | Agency | NS, Norway, ME, APAC | Strong (offshore/marine) | JS (Next.js) | No |
| Fircroft | fircroft.com/jobs | Agency | NS, ME, APAC, WA, Gulf | Strong | JS SPA | No |
| Cammach Bryant | **wearecammach.com**/jobs/filter?jobType=3 | Agency | NS (Aberdeen) | Strong (contract-filtered) | Server-rendered HTML | **Yes** |
| Hays O&G | hays.com/jobs/oil-gas-jobs | Agency | NS, APAC, ME, Norway | Strong | JS (CF-protected) | No |
| Rigzone | rigzone.com/jobs | Board | Global | Moderate | JS (403 bare curl) | Yes |
| EnergyJobSearch / OilAndGasJobSearch | energyjobsearch.com | Board | Global (offshore/subsea) | Strong | JS (handled) | Yes |
| OGV Energy | jobs.globalenergynetwork.net | Board | NS, Global | Strong | AJAX (CI-rate-limited) | Yes (capped) |
| OilGasVacancy | oilgasvacancy.com | Board | Global offshore | Moderate | Static | Yes |
| GCaptain | jobsite.gcaptain.com | Board/crewing | Marine, Gulf, offshore | Strong | Static (CF-contingent) | Yes |
| OceanCrew | oceancrew.org | Crewing | Global marine | Strong | Static | Yes |
| Roadtechs | roadtechs.com | Board | US domestic | Strong | Static | Yes |
| riggaccess | rigg-access.com | Niche (rope) | Global | Strong | JSON API | Yes |
| IRATA | irata.org/jobs | Association (rope) | NS, Global | Strong | Static | Yes |
| ROVPlanet | rovplanet.com/jobs/list2 | Niche (subsea/ROV) | Global | Strong (employer-named) | Static | **Yes** |
| UnderwaterJobs.com | underwaterjobs.com/all_jobs | Niche (diving) | US-dominant, global | Strong | Static | **Yes** |
| SPRAT | spratcertification.com — NXDOMAIN | Association (rope) | — | — | dead | No (rope covered by irata/riggaccess) |
| SubseaJobs.co.uk | subseajobs.co.uk — NXDOMAIN | Niche | — | — | dead | No |
| ROV-Jobs.net | rov-jobs.net — NXDOMAIN | Niche | — | — | dead | No |
| OilCareers (UK) | oilcareers.com | Board | NS, Global | Strong | Static | No |
| CJHunter | cjhunter.com/jobs | Board | US (contract) | Strong | Static | No |
| Adzuna / Jooble / Indeed (JobSpy) / USAJobs | — | Aggregator | Global / US | Moderate | API / JS | Yes |
| NGOilGas | ngoilgas.com | Regional | Nigeria/WA | Strong (WA) | Static | No |
| OilGasJob.ng | oilgasjob.ng | Regional | Nigeria | Moderate | Static | No |
| FINN.no Jobb | finn.no/job | Board | Norway | Moderate | JS (public API) | No |
| NaukriGulf | naukrigulf.com | Board | ME (UAE/Saudi/Qatar) | Moderate | JS (CF, 200 w/ UA) | No |
| GulfTalent | gulftalent.com | Board | ME (GCC) | Moderate | JS | No |
| SEEK | seek.com.au | Board | Australia | Moderate | JS (unofficial API) | No |
| Vagas.com.br | vagas.com.br | Board | Brazil | Moderate | JS (403 bot UA) | No |
| Drilling Contractor (IADC) | drillingcontractor.org/jobs | Association | US, Global | Moderate (drilling) | Static | No |
| Maxwell Bond / Glenrock | maxwellbond.co.uk / glenrock.co.uk | Agency | NS (Aberdeen) | Moderate | Static | No |

**Flagged defunct / not worth it:** oilcareers.ae (404), jobangolaonline.com (403 + thin), oilandgasjobs.com.au (resume site), oilgasjobs.co.uk (parked), Jobberman/Bayt/Infojobs (general consumer boards, weak O&G contract density).

---

## Prioritized gaps (weighted to Tier-1: US Gulf + UK/North Sea)

**Wave 1 — cheap, static-HTML, exact-discipline (in progress 2026-05-22):**
Orion Group (agency, diving division — NS+WA+Gulf), Cammach Bryant (Aberdeen-only, high signal), SubseaJobs.co.uk, ROV-Jobs.net, UnderwaterJobs.com (US diving → Gulf), SPRAT (US/Canada rope access).

**Wave 1.5 — revive the broken agency adapters (in progress):**
NES Fircroft + Brunel. Highest demand-intel unlock for the effort (scaffolding already exists; needs JSON-endpoint discovery or Playwright rendering).

**Wave 2 — JS, higher effort, highest density:**
Spencer Ogden (single highest contract density), Petroplan (possible WP-JSON API), Atlas Professionals (Dutch NS + Norway offshore), Fircroft. Revive EnergyJobline (largest dedicated board; bot wall → needs headless browser).

**Wave 3 — Tier-2 market gaps (build even at n=1; high local value):**
- **Norway:** FINN.no (public Schibsted API) — local operators post here in Norwegian, bypassing global boards.
- **West Africa:** NGOilGas (Nigeria) — local operators (NLNG, SEPLAT, NNPC contractors) appear here first.
- **Brazil:** Vagas.com.br (Playwright) — Subsea7/TechnipFMC Brazil ops.
- **Middle East:** NaukriGulf (ADNOC/Aramco contractors).
- **APAC:** SEEK (unofficial API) for Australian offshore.

---

## Demand-intelligence flow (next phase)

Once the agency feeds are producing, build the pipeline that turns postings into BD signals:

1. **End-employer attribution** — per source, sample real postings and measure how often the operator is named / inferable / blind. Prioritize sources with high recoverability.
2. **Employer extraction/inference** — parse the named client, or infer from project + location + role.
3. **Demand signal** — write an `active_contract_demand` flag (+ count, role, recency) onto the matching target-client record.
4. **Qualification input** — this is a *stronger* qualification signal than careers-page keyword density (the current proxy): "posted 3 contract ROV roles this month" beats "says 'subsea' a lot." Fold into target-clients Phase 2 qualification.

---

## Maintenance

- Update the **ingest status** table whenever an adapter is added, fixed, disabled, or a source dies.
- Re-verify "broken/disabled" sources periodically — sites change anti-bot posture.
- Keep gap waves ranked by Tier-1 weighting unless market priorities change.
