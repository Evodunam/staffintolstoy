import crypto from "crypto";
import { db } from "../db";
import { and, gte, lte, asc } from "drizzle-orm";
import { adminActivityLog } from "@shared/schema";

/**
 * SOC 2-compliant audit log export.
 *
 * Generates a tamper-evident JSONL stream of audit events for a given date
 * range. Each line contains the event plus the SHA-256 hash of the previous
 * line's payload+hash — i.e. a hash chain. If anyone modifies an entry
 * after export, every subsequent hash breaks, which an auditor verifies
 * with a single recomputation pass.
 *
 * Format per line:
 *   {"seq":1,"prev":"GENESIS","data":{...event fields...},"hash":"<sha256-hex>"}
 *
 * Where hash = sha256(prev + JSON.stringify(data)). The first line uses
 * the literal string "GENESIS" as prev. Receivers verify by recomputing
 * each hash and confirming line N's `prev` equals line N-1's `hash`.
 *
 * Used by:
 *   - Manual SOC 2 evidence collection (admin downloads daily JSONL).
 *   - Future: scheduled push to S3/GCS for immutable archive (out of scope here).
 */

export interface AuditExportOptions {
  startDate: Date;
  endDate: Date;
  /** Maximum rows per export call. Default 100k — fits a year of activity for
   *  most early-stage tenants in a single call. */
  limit?: number;
}

export interface AuditExportResult {
  jsonl: string;
  rowCount: number;
  finalHash: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
}

const GENESIS = "GENESIS";

export async function exportAuditLogJsonl(opts: AuditExportOptions): Promise<AuditExportResult> {
  const limit = Math.min(100_000, opts.limit ?? 100_000);
  // Pull events ascending so hash chain is monotonic in time.
  const rows = await db.select()
    .from(adminActivityLog)
    .where(and(
      gte(adminActivityLog.createdAt, opts.startDate),
      lte(adminActivityLog.createdAt, opts.endDate),
    ))
    .orderBy(asc(adminActivityLog.createdAt))
    .limit(limit);

  let prev = GENESIS;
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i];
    const dataJson = JSON.stringify(data);
    const hash = crypto.createHash("sha256").update(prev + dataJson).digest("hex");
    lines.push(JSON.stringify({ seq: i + 1, prev, data, hash }));
    prev = hash;
  }

  return {
    jsonl: lines.join("\n"),
    rowCount: rows.length,
    finalHash: prev,
    startDate: opts.startDate.toISOString(),
    endDate: opts.endDate.toISOString(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Re-verifies a previously-exported JSONL by recomputing the hash chain.
 * Returns true if the chain is intact; false (with reason) if not.
 * Useful as a cross-check during SOC 2 audit walkthroughs.
 */
export function verifyAuditLogJsonl(jsonl: string): { valid: boolean; reason?: string; brokenAtSeq?: number } {
  const lines = jsonl.split("\n").filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let parsed: any;
    try { parsed = JSON.parse(lines[i]); }
    catch { return { valid: false, reason: `Line ${i + 1} not valid JSON`, brokenAtSeq: i + 1 }; }
    if (parsed.prev !== prev) {
      return { valid: false, reason: `Line ${i + 1} prev mismatch (chain broken)`, brokenAtSeq: parsed.seq };
    }
    const recomputed = crypto.createHash("sha256").update(prev + JSON.stringify(parsed.data)).digest("hex");
    if (recomputed !== parsed.hash) {
      return { valid: false, reason: `Line ${i + 1} hash mismatch (record tampered)`, brokenAtSeq: parsed.seq };
    }
    prev = parsed.hash;
  }
  return { valid: true };
}

