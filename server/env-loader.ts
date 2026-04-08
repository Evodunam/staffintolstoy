/**
 * Load .env before any other server code runs.
 * Import this first in server/index.ts so DATABASE_URL etc. exist when db.ts loads.
 */
import { config } from "dotenv";
import { resolve } from "path";

const isProduction = process.env.NODE_ENV === "production";
const envFile = isProduction ? ".env.production" : ".env.development";
const _env = process.env;
if (!isProduction && !_env.NODE_ENV) {
  _env.NODE_ENV = "development";
}
const path = resolve(process.cwd(), envFile);
config({ path, override: true });
