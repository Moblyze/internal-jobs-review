# Moblyze Public Job Listing Website

## What This Is

An SEO-optimized public-facing website that displays all Moblyze jobs from the GraphQL API, making jobs discoverable through organic search and driving mobile app downloads through strategic conversion touchpoints.

## Core Value

Job seekers must be able to discover Moblyze jobs through Google search and seamlessly convert to mobile app users, creating a web-to-app funnel that grows the candidate pipeline.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Jobs discoverable through organic search (individual job pages with SEO optimization)
- [ ] Category pages for browsing jobs by industry sector, location, and role type
- [ ] Overview/search page with filters for all three dimensions (industry, location, role)
- [ ] Individual job detail pages with full job information
- [ ] App download CTAs (banner + bottom CTA) on all job pages
- [ ] Branch.io deferred deep link integration (install → account creation → job context)
- [ ] GraphQL API integration to fetch all job data
- [ ] Server-side rendering for SEO (crawlable, indexable content)
- [ ] Mobile-responsive design (many job seekers browse on mobile)
- [ ] Fast page load performance (Core Web Vitals for SEO ranking)

### Out of Scope

- User authentication on web — V1 is read-only, accounts created in mobile app only
- Job applications on web — All applications happen in mobile app after account creation
- User profiles/dashboards on web — Mobile app only
- Job alerts or saved searches on web — Future feature, not V1
- Employer/recruiter portal on web — Separate product (moblyze-web already exists for this)
- Real-time job updates — Jobs can be fetched on page load, no WebSocket/polling needed
- Advanced search (boolean, salary ranges, etc.) — Simple filtering sufficient for V1

## Context

**Business Context:**
- Moblyze connects job seekers with opportunities in skilled trades and energy sectors
- Mobile app is primary product, but lacks web discoverability
- Competitors have job board websites that rank in Google search
- Current web presence (moblyze.me) is a static landing page with no job content
- Need to capture organic search traffic for job-related queries

**Technical Environment:**
- **Existing infrastructure:**
  - moblyze-api: Go backend with GraphQL API (job data already exists)
  - moblyze-mobile: React Native mobile app (job browsing, applications, profiles)
  - Branch.io: Deep linking service (integrated but routing needs fixes)
  - moblyze-web: Existing React web app for recruiter/agency portal (separate from this project)

**Job Data Structure:**
- Jobs stored in PostgreSQL, accessible via GraphQL API
- Jobs likely have industry sector, location, and role type fields (needs verification)
- Need to confirm exact GraphQL schema and available fields

**Deep Linking Requirements:**
- Deferred deep links must pass job context (job ID, title, etc.)
- Flow: Web CTA → App Store (if not installed) → Install → Open app with job context → Account creation → Job details
- Branch.io branded links not yet configured (parallel work)
- Deep link routing needs fixes (parallel work, but this project defines requirements)

**SEO Strategy:**
- Target long-tail job search queries (e.g., "welder jobs Houston", "offshore pipeline jobs Gulf Coast")
- Each job gets unique URL with optimized title, description, structured data
- Category pages target broader searches (e.g., "energy jobs Texas", "skilled trades Houston")
- Server-side rendering critical for Google indexing

**Success Metrics:**
- **Primary:** Organic search traffic growth (impressions, clicks from Google Search Console)
- **Secondary:** Web-to-app conversion rate (clicks on app CTAs → app installs → account creations)

## Constraints

- **Tech Stack:** Pending CTO approval — will research and recommend SSR framework optimized for SEO (likely Next.js, Remix, or Astro)
- **Deployment:** Must be separate from existing moblyze-web (different domain or subdomain)
- **API Access:** Must use existing GraphQL API without modifications (read-only consumer)
- **Timeline:** Important but measured — get it right, ship in weeks not months
- **V1 Scope:** Read-only job content only, no user accounts or applications on web
- **Dependency:** Branch.io deep linking improvements happening in parallel (this project defines requirements)
- **Mobile-first users:** Many skilled trades workers browse on mobile, must be responsive
- **SEO Requirements:** Server-side rendering, semantic HTML, structured data, fast performance

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Read-only web, applications in app only | V1 focus on discovery and conversion, not full job board functionality | — Pending |
| Server-side rendering required | SEO discoverability is core value, Google must index job content | — Pending |
| Tech stack pending CTO input | Infrastructure decision requires engineering leadership approval | — Pending |
| Branch.io as deep linking solution | Already integrated in mobile app, just needs routing fixes | — Pending |
| Three discovery dimensions: industry, location, role | Based on user search patterns and job seeker priorities | — Pending |
| Separate project from moblyze-web | Recruiter portal vs public job site have different audiences and requirements | — Pending |

---
*Last updated: 2026-02-06 after initialization*
