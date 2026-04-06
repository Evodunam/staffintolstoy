/**
 * Upsert job_assignments for every accepted application that is missing a row
 * or has a stale assignment (same as storage.syncJobAssignmentForAcceptedApplication).
 *
 * Run: npx dotenv -e .env.development -- tsx script/backfill-job-assignments.ts
 * Prod:  npx dotenv -e .env.production -- tsx script/backfill-job-assignments.ts
 */
import { db } from "../server/db";
import { applications, jobs, jobAssignments } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const accepted = await db.select().from(applications).where(eq(applications.status, "accepted"));
  let upserted = 0;
  let skippedNoJob = 0;

  for (const app of accepted) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
    if (!job) {
      skippedNoJob++;
      continue;
    }
    const agreedRate =
      app.proposedRate != null && app.proposedRate > 0 ? app.proposedRate : job.hourlyRate ?? 0;

    await db
      .insert(jobAssignments)
      .values({
        jobId: app.jobId,
        workerId: app.workerId,
        applicationId: app.id,
        agreedRate,
        status: "assigned",
      })
      .onConflictDoUpdate({
        target: [jobAssignments.jobId, jobAssignments.workerId],
        set: {
          applicationId: app.id,
          agreedRate,
          status: "assigned",
        },
      });
    upserted++;
  }

  console.log(
    `[backfill-job-assignments] Accepted applications: ${accepted.length}. Upserted assignments: ${upserted}. Skipped (missing job): ${skippedNoJob}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
