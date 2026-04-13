/**
 * SEO smoke test for programmatic SEO endpoints.
 *
 * Usage:
 *   tsx script/seo-smoke-test.ts
 *   tsx script/seo-smoke-test.ts http://127.0.0.1:5000
 */

import express from "express";
import { createServer, type Server } from "http";
import { registerSeoRoutes } from "../server/seo";

type SeoStats = {
  generatedPages: number;
  indexablePages: number;
  hubLinkedPages: number;
  urlsPerSitemap: number;
  sitemapChunks: number;
  seoLastmodIso: string;
  seoLastmodUtc: string;
  indexOrderMode?: "sequential" | "shuffled";
  indexOrderStride?: number;
  indexOrderPreviewIds?: number[];
  effectiveIndexPreviewIds?: number[];
  hubPreviewIds?: number[];
  nonIndexablePreviewId?: number | null;
  cityPagesGenerated?: number;
  cityPagesIndexable?: number;
  cityPagesHubLinked?: number;
  citySitemapChunks?: number;
  workerCityPagesGenerated?: number;
  workerCityPagesIndexable?: number;
  workerCityPagesHubLinked?: number;
  workerCitySitemapChunks?: number;
  workerCityTradePagesGenerated?: number;
  workerCityTradePagesIndexable?: number;
  workerCityTradeSitemapChunks?: number;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:5000";
const cliBaseUrl = process.argv[2];
const envBaseUrl = process.env.SEO_TEST_BASE_URL;
const requireExplicitBaseUrl =
  process.env.SEO_TEST_REQUIRE_BASE_URL === "1" ||
  process.env.SEO_TEST_REQUIRE_BASE_URL === "true";
const selfHost =
  process.env.SEO_TEST_SELF_HOST === "1" ||
  process.env.SEO_TEST_SELF_HOST === "true";
const selfHostPort = Number(process.env.SEO_TEST_PORT ?? "5055");

if (requireExplicitBaseUrl && !selfHost && !cliBaseUrl && !envBaseUrl) {
  console.error("SEO smoke test requires an explicit base URL. Set SEO_TEST_BASE_URL or pass it as the first arg.");
  process.exit(1);
}

let baseUrl = (cliBaseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseExpectedInt(name: string): number | null {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  assert(Number.isInteger(parsed), `${name} must be an integer when provided`);
  return parsed;
}

function parseExpectedMode(name: string): "sequential" | "shuffled" | null {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return null;
  const normalized = raw.trim().toLowerCase();
  assert(
    normalized === "sequential" || normalized === "shuffled",
    `${name} must be "sequential" or "shuffled"`,
  );
  return normalized as "sequential" | "shuffled";
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function idFromIndexPosition(stats: SeoStats, positionZeroBased: number): number {
  const mode = stats.indexOrderMode ?? "sequential";
  if (mode === "sequential") return positionZeroBased + 1;
  const stride = stats.indexOrderStride ?? 1;
  return mod(positionZeroBased * stride, stats.generatedPages) + 1;
}

async function fetchText(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const body = await res.text();
  return { res, body };
}

async function fetchJson<T>(path: string): Promise<T> {
  const { res, body } = await fetchText(path);
  assert(res.ok, `Expected 2xx from ${path}, got ${res.status}`);
  return JSON.parse(body) as T;
}

function logCheck(ok: boolean, label: string, detail?: string) {
  const icon = ok ? "PASS" : "FAIL";
  console.log(`[${icon}] ${label}${detail ? ` :: ${detail}` : ""}`);
}

async function run() {
  let server: Server | null = null;
  if (selfHost) {
    const app = express();
    registerSeoRoutes(app);
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(selfHostPort, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${selfHostPort}`;
  }

  console.log(`Running SEO smoke test against ${baseUrl}`);
  try {
    const stats = await fetchJson<SeoStats>("/seo/stats");
    assert(stats.generatedPages > 0, "generatedPages should be > 0");
    assert(stats.indexablePages >= 0, "indexablePages should be >= 0");
    assert(stats.indexablePages <= stats.generatedPages, "indexablePages should be <= generatedPages");
    assert(stats.sitemapChunks === Math.ceil(stats.indexablePages / stats.urlsPerSitemap), "sitemapChunks mismatch");
    if (typeof stats.cityPagesGenerated === "number") {
      assert(stats.cityPagesGenerated > 0, "cityPagesGenerated should be > 0");
      assert((stats.cityPagesIndexable ?? 0) <= stats.cityPagesGenerated, "cityPagesIndexable should be <= cityPagesGenerated");
      assert((stats.cityPagesHubLinked ?? 0) <= (stats.cityPagesIndexable ?? 0), "cityPagesHubLinked should be <= cityPagesIndexable");
    }
    if (typeof stats.workerCityPagesGenerated === "number") {
      assert(stats.workerCityPagesGenerated > 0, "workerCityPagesGenerated should be > 0");
      assert((stats.workerCityPagesIndexable ?? 0) <= stats.workerCityPagesGenerated, "workerCityPagesIndexable should be <= workerCityPagesGenerated");
      assert((stats.workerCityPagesHubLinked ?? 0) <= (stats.workerCityPagesIndexable ?? 0), "workerCityPagesHubLinked should be <= workerCityPagesIndexable");
    }
    if (typeof stats.workerCityTradePagesGenerated === "number") {
      assert(stats.workerCityTradePagesGenerated > 0, "workerCityTradePagesGenerated should be > 0");
      assert(
        (stats.workerCityTradePagesIndexable ?? 0) <= stats.workerCityTradePagesGenerated,
        "workerCityTradePagesIndexable should be <= workerCityTradePagesGenerated",
      );
    }

    const expectedGenerated = parseExpectedInt("SEO_TEST_EXPECT_GENERATED");
    const expectedIndexable = parseExpectedInt("SEO_TEST_EXPECT_INDEXABLE");
    const expectedHubLinked = parseExpectedInt("SEO_TEST_EXPECT_HUB_LINKED");
    const expectedSitemapChunks = parseExpectedInt("SEO_TEST_EXPECT_SITEMAP_CHUNKS");
    const expectedIndexOrderMode = parseExpectedMode("SEO_TEST_EXPECT_INDEX_ORDER_MODE");

    if (expectedGenerated != null) {
      assert(
        stats.generatedPages === expectedGenerated,
        `generatedPages mismatch: expected ${expectedGenerated}, got ${stats.generatedPages}`,
      );
    }
    if (expectedIndexable != null) {
      assert(
        stats.indexablePages === expectedIndexable,
        `indexablePages mismatch: expected ${expectedIndexable}, got ${stats.indexablePages}`,
      );
    }
    if (expectedHubLinked != null) {
      assert(
        stats.hubLinkedPages === expectedHubLinked,
        `hubLinkedPages mismatch: expected ${expectedHubLinked}, got ${stats.hubLinkedPages}`,
      );
    }
    if (expectedSitemapChunks != null) {
      assert(
        stats.sitemapChunks === expectedSitemapChunks,
        `sitemapChunks mismatch: expected ${expectedSitemapChunks}, got ${stats.sitemapChunks}`,
      );
    }
    if (expectedIndexOrderMode != null) {
      const actualMode = stats.indexOrderMode ?? "sequential";
      assert(
        actualMode === expectedIndexOrderMode,
        `indexOrderMode mismatch: expected ${expectedIndexOrderMode}, got ${actualMode}`,
      );
    }
    const indexPreview = stats.indexOrderPreviewIds ?? [];
    const effectiveIndexPreview = stats.effectiveIndexPreviewIds ?? [];
    const hubPreview = stats.hubPreviewIds ?? [];
    assert(indexPreview.length > 0, "indexOrderPreviewIds should be present");
    assert(effectiveIndexPreview.length > 0, "effectiveIndexPreviewIds should be present");
    assert(
      new Set(indexPreview).size === indexPreview.length,
      "indexOrderPreviewIds should be unique",
    );
    assert(
      hubPreview.length <= stats.hubLinkedPages,
      "hubPreviewIds should not exceed hubLinkedPages",
    );
    if ((stats.indexOrderMode ?? "sequential") === "sequential") {
      assert(
        indexPreview[0] === 1 && indexPreview[1] === 2,
        "sequential mode preview should start at [1,2,...]",
      );
    } else {
      assert(
        indexPreview.length >= 2 && indexPreview[0] === 1 && indexPreview[1] !== 2,
        "shuffled mode preview should differ from sequential order",
      );
    }

    logCheck(true, "/seo/stats shape valid", JSON.stringify(stats));

    const { res: hubRes, body: hubBody } = await fetchText("/services");
    assert(hubRes.ok, `/services should return 200 (got ${hubRes.status})`);
    assert(hubBody.includes("Service Area Pages"), "/services body missing expected heading");
    logCheck(true, "/services returns HTML");

    const { res: sitemapIndexRes, body: sitemapIndexBody } = await fetchText("/sitemap.xml");
    assert(sitemapIndexRes.ok, `/sitemap.xml should return 200 (got ${sitemapIndexRes.status})`);
    assert(
      sitemapIndexBody.includes("<sitemapindex"),
      "/sitemap.xml should return sitemapindex",
    );
    assert(
      sitemapIndexBody.includes("/sitemaps/core.xml"),
      "sitemap index missing core sitemap",
    );
    logCheck(true, "/sitemap.xml returns sitemap index");

    const { res: coreSitemapRes, body: coreSitemapBody } = await fetchText("/sitemaps/core.xml");
    assert(coreSitemapRes.ok, `/sitemaps/core.xml should return 200 (got ${coreSitemapRes.status})`);
    assert(coreSitemapBody.includes("<urlset"), "core sitemap missing <urlset>");
    logCheck(true, "/sitemaps/core.xml returns urlset");

    const { res: cityHubRes, body: cityHubBody } = await fetchText("/company-onboarding/cities");
    assert(cityHubRes.ok, `/company-onboarding/cities should return 200 (got ${cityHubRes.status})`);
    assert(cityHubBody.includes("Hire Staff by US City"), "/company-onboarding/cities body missing expected heading");
    logCheck(true, "/company-onboarding/cities returns HTML");

    const { res: workerHubRes, body: workerHubBody } = await fetchText("/worker-onboarding/cities");
    assert(workerHubRes.ok, `/worker-onboarding/cities should return 200 (got ${workerHubRes.status})`);
    assert(workerHubBody.includes("Find Service Gig Work by US City"), "/worker-onboarding/cities body missing expected heading");
    logCheck(true, "/worker-onboarding/cities returns HTML");

    if (stats.sitemapChunks > 0) {
      const firstChunkPath = "/sitemaps/services-1.xml";
      const lastChunkPath = `/sitemaps/services-${stats.sitemapChunks}.xml`;
      const { res: firstChunkRes, body: firstChunkBody } = await fetchText(firstChunkPath);
      assert(firstChunkRes.ok, `${firstChunkPath} should return 200 (got ${firstChunkRes.status})`);
      assert(firstChunkBody.includes("<urlset"), `${firstChunkPath} missing <urlset>`);
      logCheck(true, `${firstChunkPath} returns urlset`);

      const { res: lastChunkRes, body: lastChunkBody } = await fetchText(lastChunkPath);
      assert(lastChunkRes.ok, `${lastChunkPath} should return 200 (got ${lastChunkRes.status})`);
      assert(lastChunkBody.includes("<urlset"), `${lastChunkPath} missing <urlset>`);
      logCheck(true, `${lastChunkPath} returns urlset`);
    }

    if ((stats.citySitemapChunks ?? 0) > 0) {
      const firstCityChunkPath = "/sitemaps/hire-cities-1.xml";
      const { res: firstCityChunkRes, body: firstCityChunkBody } = await fetchText(firstCityChunkPath);
      assert(firstCityChunkRes.ok, `${firstCityChunkPath} should return 200 (got ${firstCityChunkRes.status})`);
      assert(firstCityChunkBody.includes("<urlset"), `${firstCityChunkPath} missing <urlset>`);
      const firstLocMatch = firstCityChunkBody.match(/<loc>([^<]+)<\/loc>/);
      assert(!!firstLocMatch?.[1], "city sitemap chunk missing first <loc>");
      const cityPath = firstLocMatch![1].replace(baseUrl, "");
      const { res: cityPageRes, body: cityPageBody } = await fetchText(cityPath);
      assert(cityPageRes.ok, `city page ${cityPath} should return 200 (got ${cityPageRes.status})`);
      assert(cityPageBody.includes("/company-onboarding"), `city page ${cityPath} should include CTA to /company-onboarding`);
      logCheck(true, "City page includes company onboarding CTA");
    }

    if ((stats.workerCitySitemapChunks ?? 0) > 0) {
      const firstWorkerChunkPath = "/sitemaps/worker-cities-1.xml";
      const { res: firstWorkerChunkRes, body: firstWorkerChunkBody } = await fetchText(firstWorkerChunkPath);
      assert(firstWorkerChunkRes.ok, `${firstWorkerChunkPath} should return 200 (got ${firstWorkerChunkRes.status})`);
      assert(firstWorkerChunkBody.includes("<urlset"), `${firstWorkerChunkPath} missing <urlset>`);
      const firstLocMatch = firstWorkerChunkBody.match(/<loc>([^<]+)<\/loc>/);
      assert(!!firstLocMatch?.[1], "worker city sitemap chunk missing first <loc>");
      const workerCityPath = firstLocMatch![1].replace(baseUrl, "");
      const { res: workerCityPageRes, body: workerCityPageBody } = await fetchText(workerCityPath);
      assert(workerCityPageRes.ok, `worker city page ${workerCityPath} should return 200 (got ${workerCityPageRes.status})`);
      assert(workerCityPageBody.includes("/worker-onboarding"), `worker city page ${workerCityPath} should include CTA to /worker-onboarding`);
      logCheck(true, "Worker city page includes worker onboarding CTA");
    }
    if ((stats.workerCityTradeSitemapChunks ?? 0) > 0) {
      const firstWorkerTradeChunkPath = "/sitemaps/worker-city-trades-1.xml";
      const { res: firstWorkerTradeChunkRes, body: firstWorkerTradeChunkBody } = await fetchText(firstWorkerTradeChunkPath);
      assert(
        firstWorkerTradeChunkRes.ok,
        `${firstWorkerTradeChunkPath} should return 200 (got ${firstWorkerTradeChunkRes.status})`,
      );
      assert(firstWorkerTradeChunkBody.includes("<urlset"), `${firstWorkerTradeChunkPath} missing <urlset>`);
      const firstLocMatch = firstWorkerTradeChunkBody.match(/<loc>([^<]+)<\/loc>/);
      assert(!!firstLocMatch?.[1], "worker city trade sitemap chunk missing first <loc>");
      const workerCityTradePath = firstLocMatch![1].replace(baseUrl, "");
      const { res: workerCityTradePageRes, body: workerCityTradePageBody } = await fetchText(workerCityTradePath);
      assert(
        workerCityTradePageRes.ok,
        `worker city trade page ${workerCityTradePath} should return 200 (got ${workerCityTradePageRes.status})`,
      );
      assert(
        workerCityTradePageBody.includes("/worker-onboarding"),
        `worker city trade page ${workerCityTradePath} should include CTA to /worker-onboarding`,
      );
      logCheck(true, "Worker city trade page includes worker onboarding CTA");
    }

    if (stats.indexablePages > 0) {
      const indexableId =
        effectiveIndexPreview[0] ?? idFromIndexPosition(stats, Math.min(stats.indexablePages - 1, 6));
      const { res: indexedPageRes, body: indexedPageBody } = await fetchText(`/services/p/${indexableId}`);
      assert(indexedPageRes.ok, `indexable page should return 200 (got ${indexedPageRes.status})`);
      assert(
        indexedPageBody.includes('meta name="robots" content="index,follow'),
        "indexable page should include index,follow meta robots",
      );
      logCheck(true, "Indexable page has index,follow");
    }

    if (stats.indexablePages < stats.generatedPages) {
      const nonIndexableId = stats.nonIndexablePreviewId ?? idFromIndexPosition(stats, stats.indexablePages);
      const { res: nonIndexedPageRes, body: nonIndexedPageBody } = await fetchText(`/services/p/${nonIndexableId}`);
      assert(nonIndexedPageRes.ok, `non-indexable page should return 200 (got ${nonIndexedPageRes.status})`);
      assert(
        nonIndexedPageBody.includes('meta name="robots" content="noindex,follow'),
        "non-indexable page should include noindex,follow meta robots",
      );
      logCheck(true, "Non-indexable page has noindex,follow");
    }

    const outOfRangeId = stats.generatedPages + 1;
    const { res: outOfRangeRes } = await fetchText(`/services/p/${outOfRangeId}`);
    assert(outOfRangeRes.status === 404, `out-of-range page should 404 (got ${outOfRangeRes.status})`);
    logCheck(true, "Out-of-range page returns 404");

    const { res: llmsRes, body: llmsBody } = await fetchText("/llms.txt");
    assert(llmsRes.ok, `/llms.txt should return 200 (got ${llmsRes.status})`);
    assert(llmsBody.includes("Programmatic SEO pages generated"), "llms.txt missing expected stats section");
    logCheck(true, "/llms.txt returns expected content");

    const lastModified = llmsRes.headers.get("last-modified");
    assert(!!lastModified, "llms.txt missing Last-Modified header");
    const { res: llms304Res } = await fetchText("/llms.txt", { "If-Modified-Since": lastModified as string });
    assert(llms304Res.status === 304, `llms.txt conditional request should return 304 (got ${llms304Res.status})`);
    logCheck(true, "Conditional GET returns 304");

    console.log("SEO smoke test passed.");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }
}

run().catch((error) => {
  console.error("SEO smoke test failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

