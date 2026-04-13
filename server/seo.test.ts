import express from "express";
import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerSeoRoutes } from "./seo";

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
  hubPreviewIds?: number[];
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

describe("server/seo routes", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    registerSeoRoutes(app);
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind test server");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("exposes stable SEO stats", async () => {
    const res = await fetch(`${baseUrl}/seo/stats`);
    expect(res.status).toBe(200);
    const stats = (await res.json()) as SeoStats;
    expect(stats.generatedPages).toBe(100000);
    expect(stats.indexablePages).toBeLessThanOrEqual(stats.generatedPages);
    expect(stats.hubLinkedPages).toBeLessThanOrEqual(stats.indexablePages);
    expect(stats.sitemapChunks).toBe(Math.ceil(stats.indexablePages / stats.urlsPerSitemap));
    expect(Array.isArray(stats.indexOrderPreviewIds)).toBe(true);
    expect((stats.indexOrderPreviewIds ?? []).length).toBeGreaterThan(0);
    expect((stats.indexOrderPreviewIds ?? [])[0]).toBe(1);
    expect(Array.isArray(stats.hubPreviewIds)).toBe(true);
    expect((stats.hubPreviewIds ?? []).length).toBeGreaterThan(0);
    expect(stats.cityPagesGenerated).toBeGreaterThan(0);
    expect(stats.cityPagesIndexable).toBeGreaterThan(0);
    expect(stats.citySitemapChunks).toBeGreaterThan(0);
    expect(stats.workerCityPagesGenerated).toBeGreaterThan(0);
    expect(stats.workerCityPagesIndexable).toBeGreaterThan(0);
    expect(stats.workerCitySitemapChunks).toBeGreaterThan(0);
    expect(stats.workerCityTradePagesGenerated).toBeGreaterThan(0);
    expect(stats.workerCityTradePagesIndexable).toBeGreaterThan(0);
    expect(stats.workerCityTradeSitemapChunks).toBeGreaterThan(0);
  });

  it("serves sitemap index and last chunk", async () => {
    const statsRes = await fetch(`${baseUrl}/seo/stats`);
    const stats = (await statsRes.json()) as SeoStats;

    const indexRes = await fetch(`${baseUrl}/sitemap.xml`);
    expect(indexRes.status).toBe(200);
    const indexXml = await indexRes.text();
    expect(indexXml).toContain("<sitemapindex");
    expect(indexXml).toContain("/sitemaps/core.xml");
    expect(indexXml).toContain(`/sitemaps/services-${stats.sitemapChunks}.xml`);

    if (stats.sitemapChunks > 0) {
      const lastChunkRes = await fetch(`${baseUrl}/sitemaps/services-${stats.sitemapChunks}.xml`);
      expect(lastChunkRes.status).toBe(200);
      expect(await lastChunkRes.text()).toContain("<urlset");

      const outOfRangeChunkRes = await fetch(`${baseUrl}/sitemaps/services-${stats.sitemapChunks + 1}.xml`);
      expect(outOfRangeChunkRes.status).toBe(404);
    }
  });

  it("applies expected robots behavior for page bounds", async () => {
    const statsRes = await fetch(`${baseUrl}/seo/stats`);
    const stats = (await statsRes.json()) as SeoStats;

    const inRangeRes = await fetch(`${baseUrl}/services/p/1`);
    expect(inRangeRes.status).toBe(200);
    const inRangeHtml = await inRangeRes.text();
    expect(inRangeHtml).toContain('meta name="robots" content="index,follow');

    if (stats.indexablePages < stats.generatedPages) {
      const noIndexRes = await fetch(`${baseUrl}/services/p/${stats.indexablePages + 1}`);
      expect(noIndexRes.status).toBe(200);
      expect(await noIndexRes.text()).toContain('meta name="robots" content="noindex,follow');
    }

    const outOfRangeRes = await fetch(`${baseUrl}/services/p/${stats.generatedPages + 1}`);
    expect(outOfRangeRes.status).toBe(404);
  });

  it("serves city hiring hub/page with onboarding CTA", async () => {
    const statsRes = await fetch(`${baseUrl}/seo/stats`);
    const stats = (await statsRes.json()) as SeoStats;
    const cityHubRes = await fetch(`${baseUrl}/company-onboarding/cities`);
    expect(cityHubRes.status).toBe(200);
    expect(await cityHubRes.text()).toContain("Hire Staff by US City");

    if ((stats.citySitemapChunks ?? 0) > 0) {
      const cityChunkRes = await fetch(`${baseUrl}/sitemaps/hire-cities-1.xml`);
      expect(cityChunkRes.status).toBe(200);
      const cityChunkXml = await cityChunkRes.text();
      const match = cityChunkXml.match(/<loc>([^<]+)<\/loc>/);
      expect(match?.[1]).toBeTruthy();
      const url = match![1];
      const path = new URL(url).pathname;
      const cityPageRes = await fetch(`${baseUrl}${path}`);
      expect(cityPageRes.status).toBe(200);
      expect(await cityPageRes.text()).toContain("/company-onboarding");
    }
  });

  it("serves worker city hub/page with worker onboarding CTA", async () => {
    const statsRes = await fetch(`${baseUrl}/seo/stats`);
    const stats = (await statsRes.json()) as SeoStats;
    const workerHubRes = await fetch(`${baseUrl}/worker-onboarding/cities`);
    expect(workerHubRes.status).toBe(200);
    expect(await workerHubRes.text()).toContain("Find Service Gig Work by US City");

    if ((stats.workerCitySitemapChunks ?? 0) > 0) {
      const workerChunkRes = await fetch(`${baseUrl}/sitemaps/worker-cities-1.xml`);
      expect(workerChunkRes.status).toBe(200);
      const workerChunkXml = await workerChunkRes.text();
      const match = workerChunkXml.match(/<loc>([^<]+)<\/loc>/);
      expect(match?.[1]).toBeTruthy();
      const url = match![1];
      const path = new URL(url).pathname;
      const workerPageRes = await fetch(`${baseUrl}${path}`);
      expect(workerPageRes.status).toBe(200);
      expect(await workerPageRes.text()).toContain("/worker-onboarding");
    }
  });

  it("serves worker city trade page with worker onboarding CTA", async () => {
    const statsRes = await fetch(`${baseUrl}/seo/stats`);
    const stats = (await statsRes.json()) as SeoStats;
    if ((stats.workerCityTradeSitemapChunks ?? 0) <= 0) return;

    const workerTradeChunkRes = await fetch(`${baseUrl}/sitemaps/worker-city-trades-1.xml`);
    expect(workerTradeChunkRes.status).toBe(200);
    const workerTradeChunkXml = await workerTradeChunkRes.text();
    const match = workerTradeChunkXml.match(/<loc>([^<]+)<\/loc>/);
    expect(match?.[1]).toBeTruthy();
    const url = match![1];
    const path = new URL(url).pathname;
    const workerTradePageRes = await fetch(`${baseUrl}${path}`);
    expect(workerTradePageRes.status).toBe(200);
    const html = await workerTradePageRes.text();
    expect(html).toContain("/worker-onboarding");
    expect(html).toContain("JobPosting");
  });
});

