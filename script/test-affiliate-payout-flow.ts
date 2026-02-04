/**
 * Test affiliate payout flow: create sample data, run auto-approval, verify commissions.
 *
 * Prerequisites:
 * - Server running (e.g. npm run dev) with NODE_ENV=development (restart server after adding dev routes)
 * - An affiliate exists with code "test-make" (or set AFFILIATE_CODE)
 *
 * Usage:
 *   # With server already running (default port 5000):
 *   npx tsx script/test-affiliate-payout-flow.ts
 *
 *   # Custom base URL / affiliate code:
 *   BASE_URL=http://localhost:5000 AFFILIATE_CODE=test-make npx tsx script/test-affiliate-payout-flow.ts
 *
 *   # With .env.development loaded:
 *   npx dotenv -e .env.development -- npx tsx script/test-affiliate-payout-flow.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const AFFILIATE_CODE = process.env.AFFILIATE_CODE ?? "test-make";

async function main() {
  console.log("=== Affiliate payout flow test ===\n");
  console.log("BASE_URL:", BASE_URL);
  console.log("AFFILIATE_CODE:", AFFILIATE_CODE);

  // 1) Create sample data: referred worker + company, job, pending timesheet (expired for auto-approve)
  console.log("\n1) Creating sample data (POST /api/dev/affiliate-payout-flow-test)...");
  const setupRes = await fetch(`${BASE_URL}/api/dev/affiliate-payout-flow-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: AFFILIATE_CODE }),
  });
  if (!setupRes.ok) {
    const text = await setupRes.text();
    if (setupRes.status === 404 && text.includes("Cannot POST")) {
      console.error("\n   The server returned 404 — the dev route is not registered.");
      console.error("   Restart the server (stop and run 'npm run dev' again) so it loads the new dev routes, then run this script again.");
    }
    throw new Error(`Setup failed: ${setupRes.status} ${text}`);
  }
  const setup = (await setupRes.json()) as {
    success: boolean;
    affiliateId?: number;
    timesheetId?: number;
    message?: string;
    error?: string;
  };
  if (!setup.success || setup.affiliateId == null) {
    throw new Error(setup.message ?? setup.error ?? "Setup did not return success");
  }
  console.log("   OK — affiliateId:", setup.affiliateId, "timesheetId:", setup.timesheetId);

  // 2) Run auto-approval (processes pending timesheets older than 48h and creates affiliate commissions)
  console.log("\n2) Running auto-approval (POST /api/timesheets/process-auto-approvals)...");
  const autoRes = await fetch(`${BASE_URL}/api/timesheets/process-auto-approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!autoRes.ok) {
    const text = await autoRes.text();
    throw new Error(`Auto-approval failed: ${autoRes.status} ${text}`);
  }
  const auto = (await autoRes.json()) as { processed?: number; paid?: number; failed?: number; message?: string };
  console.log("   OK —", auto.message ?? `processed: ${auto.processed}, paid: ${auto.paid}, failed: ${auto.failed}`);

  // 3) Verify affiliate commissions were created
  console.log("\n3) Checking affiliate commissions (GET /api/dev/affiliate-commissions)...");
  const commissionsRes = await fetch(`${BASE_URL}/api/dev/affiliate-commissions?affiliateId=${setup.affiliateId}`);
  if (!commissionsRes.ok) {
    const text = await commissionsRes.text();
    throw new Error(`Commissions fetch failed: ${commissionsRes.status} ${text}`);
  }
  const commissions = (await commissionsRes.json()) as Array<{ id: number; timesheetId: number; amountCents: number; status: string }>;
  const forThisTimesheet = commissions.filter((c) => c.timesheetId === setup.timesheetId);

  console.log("   Total commissions for affiliate:", commissions.length);
  console.log("   Commissions for this timesheet:", forThisTimesheet.length);
  forThisTimesheet.forEach((c) => console.log("     -", c.id, "amount:", (c.amountCents / 100).toFixed(2), "status:", c.status));

  if (forThisTimesheet.length === 0) {
    console.error("\n❌ No affiliate commissions found for the test timesheet. Expected at least one (worker-referred or company-referred).");
    process.exit(1);
  }
  console.log("\n✅ Affiliate payout flow test passed: commissions created for approved timesheet.");
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
