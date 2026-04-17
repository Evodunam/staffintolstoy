import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const allUsers = await client.query<{ n: number }>(
      "select count(*)::int as n from users",
    );
    const allCompanyTransactions = await client.query<{ n: number }>(
      "select count(*)::int as n from company_transactions",
    );

    const sampleUser = await client.query<{ id: string }>(
      "select id from users order by id limit 1",
    );
    const sampleProfile = await client.query<{ id: number }>(
      "select id from profiles order by id limit 1",
    );

    await client.query(
      "select set_config('app.user_id', $1, false), set_config('app.profile_id', $2, false)",
      [sampleUser.rows[0]?.id ?? "", String(sampleProfile.rows[0]?.id ?? "")],
    );

    const scopedUsers = await client.query<{ n: number }>(
      "select count(*)::int as n from users",
    );
    const scopedCompanyTransactions = await client.query<{ n: number }>(
      "select count(*)::int as n from company_transactions",
    );

    await client.query(
      "select set_config('app.user_id', '', false), set_config('app.profile_id', '', false)",
    );

    console.log({
      allUsers: allUsers.rows[0]?.n ?? 0,
      scopedUsers: scopedUsers.rows[0]?.n ?? 0,
      allCompanyTransactions: allCompanyTransactions.rows[0]?.n ?? 0,
      scopedCompanyTransactions: scopedCompanyTransactions.rows[0]?.n ?? 0,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
