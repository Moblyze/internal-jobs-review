# ROVOP

## Company Overview

| Field | Value |
|-------|-------|
| **Legal Name** | ROVOP Ltd |
| **Parent Group** | Edison Chouest Offshore / Chouest Group (acquired May 2024) |
| **Brand Name** | ROVOP |
| **Website** | https://www.rovop.com |
| **HQ** | Silvertrees, Westhill Drive, Westhill, Aberdeenshire AB32 6BH, Scotland, UK |
| **Sector** | Subsea services — ROV (Remotely Operated Vehicle) operations, survey, inspection, construction, decommissioning |
| **Employees** | ~300-320 (sources vary: 311-319 reported) |

## About

ROVOP is the world's largest independent provider of ROV services, founded in 2011 in Aberdeen, Scotland. The company provides high-performing ROV assets and personnel for subsea operations across oil & gas, offshore wind, and utilities sectors.

In May 2024, ROVOP was acquired by the Edison Chouest family of companies (Chouest Group), which also owns C-Innovation, a subsea services company. Post-acquisition, the combined Chouest fleet includes 100+ ROVs and 6 AUVs (Autonomous Underwater Vehicles).

ROVOP operates a fleet of 42+ ROV systems deployed on 26+ vessels worldwide, with a strong and growing pipeline of international projects.

## Global Offices

- Westhill, Aberdeenshire, Scotland, UK (HQ)
- Dubai, UAE (Office 204, Jumeirah Business Centre 1, Cluster G, JLT)
- Operations worldwide via vessel-based deployments

## Services

- ROV piloting and operations (inspection, survey, construction support)
- Subsea inspection, maintenance, and repair (IMR)
- Offshore wind farm support
- Decommissioning
- Touch-down monitoring (TDM)
- AUV operations (via Chouest Group integration)

## Key Roles Hired

- ROV Pilot Technician (multiple levels)
- Senior ROV Pilot Technician
- ROV Trainee Pilot Technician
- ROV Tooling Technician
- ROV Superintendent
- Office Administrator (Houston)

## Certifications Commonly Required

- IMCA competence certification (ROV roles)
- BOSIET (Basic Offshore Safety Induction and Emergency Training)
- Valid offshore medical certificate
- OPITO certifications (offshore training)

## Careers & Recruiting

### Direct ATS

| Region | Platform | URL |
|--------|----------|-----|
| Global | **Custom ASP.NET portal** | https://jobs.rovop.com/jobs.aspx |

- Careers landing page: https://www.rovop.com/careers/
- Job listing URL: `https://jobs.rovop.com/jobs.aspx`
- Job detail URL pattern: `https://jobs.rovop.com/job/{title-slug}-{numeric-id}.aspx`
- Example: `https://jobs.rovop.com/job/rov-pilot-technician-36.aspx`
- Registration / Job alerts: `https://jobs.rovop.com/register.aspx`
- Candidate login: `https://jobs.rovop.com/login.aspx`
- GDPR agreement: `https://jobs.rovop.com/gdpr-candidate-agreement.aspx`
- Contact email: rov@rovop.com
- Contact phone: +971 (0) 45706944

### ATS Platform Details

The recruitment site at jobs.rovop.com is a **custom-built ASP.NET application** (not a known commercial ATS like Workday, Taleo, SuccessFactors, or Workable). Key indicators:

- `.aspx` file extensions throughout (ASP.NET Web Forms or MVC)
- Custom URL structure: `/job/{slug}-{id}.aspx`
- Dedicated login/register pages (candidate portal functionality)
- No known public API or RSS feed
- Server-rendered HTML (not SPA/JavaScript-heavy)

**Scraping approach:** Playwright browser automation required. No API shortcut available.

### Third-Party Job Board Presence

| Board | URL | Notes |
|-------|-----|-------|
| LinkedIn | https://www.linkedin.com/company/rovop | Active company profile |
| LinkedIn Showcase | https://www.linkedin.com/showcase/rovop-recruitment/ | Dedicated recruitment page |
| GulfTalent | https://www.gulftalent.com/companies/rovop-careers | Listed |
| beBee | Various listings | Job posts syndicated |
| Rigzone | https://www.rigzone.com/a-rov-jobs/ | ROV jobs category (not ROVOP-specific) |
| Indeed | — | Individual positions appear via syndication |
| Glassdoor | — | Company profile exists |

**Not found on:** ZipRecruiter (ROVOP-specific), EnergyJobline, OGV Energy

### Contingent / Contract Workforce

- Heavily rotation-based workforce (e.g., 6/6 rotation patterns)
- Both permanent and ad-hoc (contract) positions available
- International project deployments: Brazil, North Sea, Middle East, West Africa, Asia Pacific
- Significant expansion in 2026 due to growing project pipeline

## Parent Company: Edison Chouest Offshore

- US-based marine transportation company
- HQ: Galliano, Louisiana, USA
- Family-owned by the Chouest family
- One of the largest privately held marine transportation companies
- Related entities: C-Innovation (subsea), Caltex Oil Tools, Bram Offshore
- Website: http://chouest.com

## Scraper Configuration

- **Platform:** Custom ASP.NET (rovop)
- **Scraper class:** `ROVOPScraper`
- **Extraction method:** Playwright browser automation
- **URL pattern:** `jobs.rovop.com/job/{slug}-{id}.aspx`
- **Search names for aggregators:** "ROVOP", "ROVOP Ltd", "Rovop"

## Research Date

Last updated: 2026-03-17
