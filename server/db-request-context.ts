import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";

type DbRequestContext = {
  client: PoolClient;
};

const dbRequestContext = new AsyncLocalStorage<DbRequestContext>();

export function runWithDbRequestClient<T>(client: PoolClient, fn: () => T): T {
  return dbRequestContext.run({ client }, fn);
}

export function getDbRequestClient(): PoolClient | null {
  return dbRequestContext.getStore()?.client ?? null;
}
