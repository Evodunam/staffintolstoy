import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { getDbRequestClient } from "./db-request-context";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const queryRouter = {
  query: (...args: Parameters<typeof pool.query>) => {
    const requestClient = getDbRequestClient();
    if (requestClient) {
      return requestClient.query(...args);
    }
    return pool.query(...args);
  },
};

export const db = drizzle(queryRouter as any, { schema });
