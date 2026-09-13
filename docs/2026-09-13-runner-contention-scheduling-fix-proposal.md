# Runner contention: diagnosis and a ready-to-apply scheduling fix (not yet applied)

Status: **design only, NOT applied to main.py / base.py on this branch.** Jesse
asked to hold off restructuring scheduling until we see whether the failure
reproduces on the 2026-09-14 scheduled run, so this branch has only the
silent-failure-logging fix and the critical-regression failure signal
applied. This doc (plus commit `<SCHEDULING_FIX_COMMIT>` and its immediate
revert `<REVERT_COMMIT>` further down this branch's history) is the design to
apply if the failure recurs.

## What happened (2026-09-13)

Daily Job Scraping run `34749143208` (09:13Z) reported workflow-level success
but 23 employers returned `total_extracted: 0` with a single
`listing_page_failed` at `offset: 0`, and 3 more (Chevron, Marathon Petroleum,
SGS) hit the 2,700s per-company timeout. All 23 had worked fine the day
before in manual run `34721939692`. The failing set spans every httpx-only
adapter family (`workday_api`, `icims`, `successfactors_csb`,
`smartrecruiters`) plus several Playwright-based ones.

## Confirmation (VERIFIED)

Jesse dispatched a same-day confirmation run scraping ONLY the three
`workday_api` companies that failed that morning: KBR, Baker Hughes, BP
(run `34757759928`, 12:41Z). Run alone, all three succeeded:

| Company | Result run alone |
|---|---|
| KBR | 1,072 extracted (500 new) |
| Baker Hughes | 567 extracted |
| BP | 364 extracted (326 new, 458 removed) |

Same adapter code, same day, same network path — the only variable removed
was the other ~68 companies running concurrently. This rules out an
adapter/parsing regression and points at runner-level resource contention.

## Root cause (VERIFIED from code on origin/main, commit `c3be298`)

`scrapers/main.py`'s `main()` builds one `asyncio.gather(*tasks)` over
**every** company with no concurrency limit at all — see the `# Scrape
companies in parallel` block. `scrapers/config/companies.yaml` has 71
companies; per-platform counts:

```
11 workday_api        8 icims               8 html_generic
 9 workday             6 successfactors      6 rippling
 4 oracle_hcm          3 successfactors_csb  3 smartrecruiters
 2 workable            2 occupop             2 eightfold
 2 adp                 1 taleo               1 rovop
 1 pbs_wordpress       1 easyapply           1 crewbase
 1 avature
```

`workday`, `successfactors`, `html_generic` (partially), `avature`,
`occupop`, `rovop`, and `taleo` (~28 companies) call
`BaseScraper._get_browser_context()`, which launches its **own** headless
Chromium process (`src/scrapers/base.py`). The rest (`workday_api`, `icims`,
`successfactors_csb`, `smartrecruiters`, and others) are httpx-only, no
browser.

With zero concurrency limiting, all ~71 tasks start at once on a single
`ubuntu-latest` GH Actions runner (2 vCPU, ~7GB RAM). ~28 concurrent Chromium
processes launching simultaneously is enough to starve the runner's CPU,
memory, and outbound socket/DNS capacity. That matches the failure shape
exactly:

- The httpx-only adapters' very first request (`offset: 0`) failed outright
  during that startup burst — consistent with a runner too starved to
  complete a TCP/TLS handshake in time, not a per-adapter bug (`workday_api.py`
  request retries exhaust in ~14-90s; the failures clustered in tight
  timestamp bands, consistent with several tasks hitting the same
  contention window and giving up together).
- The Playwright-heavy companies with the most jobs/detail pages (Chevron,
  Marathon Petroleum, SGS) were slow enough under CPU contention to blow the
  45-minute per-company timeout — the same failure mode as the prior Sept 12
  incident, just now hitting different (bigger) companies because the
  company count grew ~45 -> ~71 without any scheduling change.

This is CONJECTURE only in the sense that we didn't instrument the runner's
CPU/memory directly during the failing run (GH Actions doesn't expose that by
default) — but the confirmation run's result, the unbounded-`gather` code, and
the shape of the failures (breadth across every adapter family, tight
timestamp clustering, zero linkage to any single adapter's parsing logic) all
point the same direction.

## Proposed fix (ready to apply)

Two independent, additive caps — deliberately not a full matrix-job redesign,
to minimize risk of a new regression while still directly targeting the
confirmed bottleneck:

1. **`MAX_CONCURRENT_BROWSERS` in `src/scrapers/base.py`** (default 6): a
   module-level `asyncio.Semaphore` acquired in `_get_browser_context()` and
   released in `_close_browser()`, so at most N Chromium processes run at
   once regardless of how many companies main.py has launched. This caps the
   single heaviest resource directly.
2. **`MAX_CONCURRENT_SCRAPES` in `main.py`** (default 12): wraps
   `scrape_company()` in an `asyncio.Semaphore` so httpx-only companies also
   can't all pile on the network stack at once.

Both are environment-variable overridable, default to conservative values
chosen to keep the 90-minute `employer-scrapers` job timeout comfortably safe
(71 companies / 12 concurrent ~= 6 batches; even at 10-15 min/batch for the
slower ones, well under 90 min), and fail safe (a launch failure after
acquiring a browser slot releases it, so slots never leak).

**A matrix-job split** (each shard on its own GH Actions runner) is the more
thorough alternative if the semaphore approach doesn't fully resolve it —
worth considering if the 2026-09-14 run repeats the failure even after this
lands — but it requires re-plumbing dedup-state merging across more shards
and is a bigger surface area to get wrong, so it's not the first thing to
reach for.

## Why this isn't applied yet

Jesse's call (2026-09-13, in-session): one data point (this morning's run)
isn't enough to justify restructuring the daily workflow's scheduling. If the
2026-09-14 scheduled run (09:00 UTC) reproduces the same failure pattern
(especially the same or an overlapping set of companies), that's confirmation
this is systemic and the fix below should be applied. If it does NOT
reproduce, treat 09-13 as a one-off (e.g., a transient GH Actions
infrastructure blip, or a temporary bump in a shared resource) and revisit.

**To apply:** `git revert <REVERT_COMMIT>` on this branch re-lands the
semaphore code from commit `<SCHEDULING_FIX_COMMIT>` cleanly.
