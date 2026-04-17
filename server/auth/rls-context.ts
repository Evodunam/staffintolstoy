import type { RequestHandler } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { runWithDbRequestClient } from "../db-request-context";

async function clearRlsContext(client: PoolClient): Promise<void> {
  await client.query(
    "select set_config('app.user_id', '', false), set_config('app.profile_id', '', false), set_config('app.profile_role', '', false)",
  );
}

export const attachRlsDbContext: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  const userId = user?.claims?.sub as string | undefined;
  const profileId = req.profile?.id;
  const profileRole = req.profile?.role;

  if (!req.isAuthenticated() || !userId || !profileId) {
    return next();
  }

  const client = await pool.connect();
  let released = false;

  const cleanup = async () => {
    if (released) return;
    released = true;
    try {
      await clearRlsContext(client);
    } catch {
      // Best-effort cleanup. Connection gets released either way.
    } finally {
      client.release();
    }
  };

  res.on("finish", () => {
    void cleanup();
  });
  res.on("close", () => {
    void cleanup();
  });

  try {
    await client.query(
      "select set_config('app.user_id', $1, false), set_config('app.profile_id', $2, false), set_config('app.profile_role', $3, false)",
      [userId, String(profileId), String(profileRole ?? "")],
    );

    return runWithDbRequestClient(client, () => next());
  } catch (error) {
    await cleanup();
    return next(error);
  }
};
