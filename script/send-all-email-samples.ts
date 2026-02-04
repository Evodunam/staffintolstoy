/**
 * Send one sample of every Resend email type to a test address.
 * Run: npx dotenv -e .env.development -- tsx script/send-all-email-samples.ts
 * Or:  npx tsx script/send-all-email-samples.ts
 * (Set RESEND_API_KEY in env or .env.development)
 */
import { sendEmail, ALL_EMAIL_TYPES, getSampleDataForType } from "../server/email-service";

const TO = process.env.EMAIL_SAMPLES_TO || "cairlbrandon@gmail.com";

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY is not set. Set it in .env.development or env.");
    process.exit(1);
  }
  // Resend allows 2 requests/sec; wait 600ms between sends to stay under limit
  const delayMs = 600;
  console.log(`Sending ${ALL_EMAIL_TYPES.length} sample emails to ${TO} (${delayMs}ms between each)...\n`);
  let sent = 0;
  let failed = 0;
  for (const type of ALL_EMAIL_TYPES) {
    const result = await sendEmail({
      to: TO,
      type,
      data: getSampleDataForType(type),
    });
    if (result.success) {
      sent++;
      console.log(`  ✓ ${type}`);
    } else {
      failed++;
      console.log(`  ✗ ${type}: ${result.error}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log(`\n✅ Done. Sent ${sent}, failed ${failed}. Check inbox at ${TO}.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
