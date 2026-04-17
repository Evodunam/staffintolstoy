import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const roleRes = await client.query<{
      role: string;
      row_security: string;
      users_rls_active: boolean;
      jobs_rls_active: boolean;
    }>(
      `select
        current_user as role,
        current_setting('row_security') as row_security,
        row_security_active('public.users'::regclass) as users_rls_active,
        row_security_active('public.jobs'::regclass) as jobs_rls_active`,
    );

    const usersCountRes = await client.query<{ users: number }>(
      "select count(*)::int as users from users",
    );
    const jobsCountRes = await client.query<{ jobs: number }>(
      "select count(*)::int as jobs from jobs",
    );

    console.log({
      runtime: roleRes.rows[0],
      users: usersCountRes.rows[0].users,
      jobs: jobsCountRes.rows[0].jobs,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
