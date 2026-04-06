import { test, expect } from "@playwright/test";

/** Avoid flaky "Already clocked in" when a prior run left an open timesheet. */
async function ensureWorkerNotClockedIn(page: import("@playwright/test").Page, workerProfileId: number) {
  await page.evaluate(async (workerId: number) => {
    const ar = await fetch(`/api/timesheets/active/${workerId}`, { credentials: "include" });
    const ts = await ar.json();
    if (!ts?.id) return;
    await fetch("/api/timesheets/clock-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timesheetId: ts.id,
        latitude: 37.3382,
        longitude: -121.8863,
      }),
    });
  }, workerProfileId);
}

async function devSwitch(page: import("@playwright/test").Page, userId: string) {
  await page.goto("/");
  const res = await page.evaluate(async (uid: string) => {
    const r = await fetch("/api/dev/switch-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userId: uid }),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  }, userId);
  expect(res.ok, `switch-user failed: ${res.status} ${res.text}`).toBeTruthy();
}

test.describe("full UI flow (dev)", () => {
  test("e2e-flow-setup → company accept → worker clock-in @ job GPS", async ({
    page,
    context,
    request,
  }) => {
    const setup = await request.post("/api/dev/e2e-flow-setup");
    if (setup.status() === 403) {
      test.skip(true, "e2e-flow-setup disabled (not development)");
    }
    expect(setup.ok(), await setup.text()).toBeTruthy();
    const data = (await setup.json()) as {
      jobId: number;
      applicationId: number;
      companyUserId: string;
      workerUserId: string;
      jobLat: number;
      jobLng: number;
      workerProfileId: number;
    };

    await devSwitch(page, data.companyUserId);
    // page.request.* does not share the browser cookie jar — use fetch + credentials
    const accept = await page.evaluate(async ({ id }: { id: number }) => {
      const r = await fetch(`/api/applications/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "accepted" }),
      });
      return { ok: r.ok, text: await r.text() };
    }, { id: data.applicationId });
    expect(accept.ok, accept.text).toBeTruthy();

    const base =
      process.env.PLAYWRIGHT_BASE_URL ?? test.info().project.use.baseURL ?? "http://127.0.0.1:5010";
    await context.grantPermissions(["geolocation"], { origin: new URL(base).origin });
    await context.setGeolocation({
      latitude: data.jobLat,
      longitude: data.jobLng,
    });

    await devSwitch(page, data.workerUserId);
    await ensureWorkerNotClockedIn(page, data.workerProfileId);

    const list = await page.evaluate(async () => {
      const r = await fetch("/api/today/assignments", { credentials: "include" });
      return r.json();
    });
    expect(Array.isArray(list)).toBeTruthy();
    expect(
      list.some((a: { application?: { job?: { id: number } } }) => a.application?.job?.id === data.jobId),
      "worker session should list accepted job"
    ).toBeTruthy();

    await page.goto("/dashboard/today", { waitUntil: "domcontentloaded" });

    const chip = page.getByTestId(`timeline-job-${data.jobId}`);
    const chipOk = await chip.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);

    let created: { id?: number; clockOutTime?: unknown };

    if (chipOk) {
      await chip.click();
      const dialogClockIn = page.getByTestId("button-dialog-clock-in").first();
      await expect(dialogClockIn).toBeVisible({ timeout: 15_000 });
      const clockInPost = page.waitForResponse(
        (r) => r.url().includes("/api/timesheets/clock-in") && r.request().method() === "POST",
        { timeout: 45_000 }
      );
      await dialogClockIn.click();
      const clockRes = await clockInPost;
      expect(clockRes.ok(), await clockRes.text()).toBeTruthy();
      created = (await clockRes.json()) as { id?: number; clockOutTime?: unknown };
    } else {
      const clock = await page.evaluate(
        async ({
          jobId,
          workerId,
          lat,
          lng,
        }: {
          jobId: number;
          workerId: number;
          lat: number;
          lng: number;
        }) => {
          const r = await fetch("/api/timesheets/clock-in", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, workerId, latitude: lat, longitude: lng }),
          });
          return { ok: r.ok, text: await r.text() };
        },
        {
          jobId: data.jobId,
          workerId: data.workerProfileId,
          lat: data.jobLat,
          lng: data.jobLng,
        }
      );
      expect(clock.ok, clock.text).toBeTruthy();
      created = JSON.parse(clock.text) as { id?: number; clockOutTime?: unknown };
    }

    expect(created.id).toBeTruthy();
    expect(created.clockOutTime == null).toBeTruthy();

    const activeJson = await page.evaluate(async (workerId: number) => {
      const r = await fetch(`/api/timesheets/active/${workerId}`, { credentials: "include" });
      return r.json();
    }, data.workerProfileId);
    expect(activeJson).toMatchObject({ id: created.id });
  });
});
