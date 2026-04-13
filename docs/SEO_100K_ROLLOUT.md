# SEO 100K Rollout

This app supports a 100,000-page programmatic SEO system with staged indexing controls.

## Core controls

- `SEO_INDEXABLE_PAGE_LIMIT`
  - Number of pages allowed to be indexed and included in sitemap chunks.
- `SEO_HUB_LINK_LIMIT`
  - Number of pages linked from `/services`.
- `SEO_INDEX_ORDER_MODE`
  - `shuffled` (default) or `sequential`.
- `SEO_INDEX_ORDER_STRIDE`
  - Only used in `shuffled` mode. Must be coprime with `100000`.
- `SEO_ENFORCE_RELEVANCE_FILTER`
  - `true`/`1` enables business relevance filtering for indexable pages.
- `SEO_SERVICE_BUYER_COMPATIBILITY_JSON`
  - Optional JSON object override for service -> allowed buyer labels.
- `SEO_INTENT_BUYER_COMPATIBILITY_JSON`
  - Optional JSON object override for intent -> allowed buyer labels.
- `SEO_LASTMOD_DATE`
  - Optional fixed date (ISO) for deterministic sitemap `lastmod`.
- `SEO_CITY_MIN_POPULATION`
  - Minimum city population for generating city hiring pages (default `1000`, effectively nationwide city coverage in the source dataset).
- `SEO_CITY_INDEXABLE_LIMIT`
  - Max indexable city hiring pages.
- `SEO_CITY_HUB_LINK_LIMIT`
  - Max city hiring pages linked from `/company-onboarding/cities`.
- `SEO_WORKER_CITY_INDEXABLE_LIMIT`
  - Max indexable worker city pages under `/worker-onboarding/:state/:city`.
- `SEO_WORKER_CITY_HUB_LINK_LIMIT`
  - Max worker city pages linked from `/worker-onboarding/cities`.
- `SEO_WORKER_CITY_TRADE_INDEXABLE_LIMIT`
  - Max indexable worker city+trade pages under `/worker-onboarding/:state/:city/:trade`.

Example override payload:

```json
{
  "General Labor": ["construction companies", "facility operators"],
  "Warehouse Staffing": ["warehouse operators", "manufacturing teams"]
}
```

Validation helpers:

- Validate default config:
  - `npm run seo:compat:validate:default`
- Validate a custom file:
  - `npm run seo:compat:validate -- path/to/file.json`

## Routes

- `/services` paginated hub
- `/services/p/:id/:slug?` landing pages
- `/sitemap.xml` sitemap index
- `/sitemaps/core.xml`
- `/sitemaps/services-:chunk.xml`
- `/company-onboarding/cities` city hiring hub
- `/company-onboarding/:state/:city` city hiring onboarding landing page (CTA to `/company-onboarding`)
- `/worker-onboarding/cities` worker gig-work hub
- `/worker-onboarding/:state/:city` worker onboarding landing page (CTA to `/worker-onboarding`)
- `/worker-onboarding/:state/:city/:trade` worker onboarding landing page segmented by trade
- `/sitemaps/hire-cities-:chunk.xml`
- `/sitemaps/worker-cities-:chunk.xml`
- `/sitemaps/worker-city-trades-:chunk.xml`
- `/robots.txt`
- `/llms.txt`
- `/seo/stats` runtime diagnostics

## Recommended phased rollout

1. Phase 1:
   - `SEO_INDEXABLE_PAGE_LIMIT=5000`
   - `SEO_HUB_LINK_LIMIT=1000`
2. Phase 2:
   - `SEO_INDEXABLE_PAGE_LIMIT=15000`
   - `SEO_HUB_LINK_LIMIT=3000`
3. Phase 3:
   - `SEO_INDEXABLE_PAGE_LIMIT=50000`
   - `SEO_HUB_LINK_LIMIT=10000`
4. Phase 4:
   - `SEO_INDEXABLE_PAGE_LIMIT=100000`
   - `SEO_HUB_LINK_LIMIT=100000`

Use `SEO_INDEX_ORDER_MODE=shuffled` for diverse sampling during partial rollouts.

## Smoke test commands

- Local default:
  - `npm run seo:smoke`
- CI self-hosted:
  - `npm run seo:smoke:ci`
  - `npm run seo:smoke:all-modes`
- Strict prod:
  - `SEO_TEST_BASE_URL=https://your-domain.com npm run seo:smoke:prod`
- Phase presets:
  - `npm run seo:smoke:phase:5k`
  - `npm run seo:smoke:phase:15k`
  - `npm run seo:smoke:phase:50k`
  - `npm run seo:smoke:phase:100k`
  - `npm run seo:smoke:relevance:on`
  - `npm run seo:smoke:all-phases`

## Fast validation checklist

1. `GET /seo/stats` matches expected limits/chunks.
2. `GET /sitemap.xml` references expected sitemap chunk count.
3. Random indexed page has `index,follow`.
4. If capped, page above cap has `noindex,follow`.
5. Out-of-range page id returns `404`.
