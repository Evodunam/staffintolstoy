/**
 * Vendor-agnostic drug screening interface + Accurate Background stub.
 *
 * Why a vendor-agnostic interface? Drug screening vendors charge per-order
 * with surprisingly different SDKs and lead times. We want to swap vendors
 * without rewriting every caller. This module declares the abstract
 * contract; concrete adapters live behind it.
 *
 * Compliance notes:
 *   - Workers must affirmatively consent before an order is placed (FCRA
 *     §604(b) for "investigative consumer reports" still applies; some
 *     state laws like CA AB 1008 add further restrictions).
 *   - Marijuana testing has been restricted by:
 *       NY Lab. Law §201-d (off-duty), CA AB 2188 (effective 1/1/2024),
 *       NJ Cannabis Reg., Equity & Marketplace Modernization Act,
 *       WA SB 5123 (effective 1/1/2024). Caller must check workplace
 *       jurisdiction before ordering THC panels there.
 *   - DOT-regulated workers (CDL drivers, pipeline ops, etc) have
 *     SEPARATE federal testing rules under 49 CFR Part 40 — those orders
 *     should bypass this module and go through a DOT-certified TPA.
 */

export type DrugTestPanel =
  | "5_panel"             // Amphetamines, Cocaine, Opiates, PCP, THC
  | "5_panel_no_thc"      // Same minus THC for marijuana-restricted jurisdictions
  | "10_panel"            // 5-panel + Barbiturates, Benzodiazepines, Methadone, Methaqualone, Propoxyphene
  | "dot_panel";          // 49 CFR §40.85: should normally bypass this module

export type DrugTestStatus =
  | "pending"             // Order created, awaiting collection
  | "in_progress"         // Specimen collected, lab analyzing
  | "completed_negative"  // Clean result
  | "completed_positive"  // Positive result — triggers MRO review
  | "completed_mro_negative"  // MRO determined positive was due to lawful Rx
  | "cancelled"
  | "expired";            // Worker didn't show up to collection site

export interface DrugScreenOrderInput {
  workerProfileId: number;
  panel: DrugTestPanel;
  /** State where the worker will perform work, used for THC restriction logic. */
  workplaceState: string;
  /** Worker's first/last name + DOB (lab needs to match against ID). */
  workerFirstName: string;
  workerLastName: string;
  workerDateOfBirth: Date;
  workerEmail: string;
  workerPhone?: string;
  /** ZIP for finding nearest collection site. */
  workerZip?: string;
  /** Caller-supplied dedupe key — re-ordering with the same key is a no-op. */
  idempotencyKey?: string;
}

export interface DrugScreenOrderResult {
  /** Vendor's unique reference. Persist this on `drug_screen_orders.vendor_ref`. */
  vendorRef: string;
  status: DrugTestStatus;
  /** Schedulable URL the worker visits to book a collection appointment. */
  schedulingUrl: string | null;
  /** When the order expires if the worker doesn't complete it. */
  expiresAt: Date | null;
}

export interface DrugScreenStatusResult {
  vendorRef: string;
  status: DrugTestStatus;
  resultDetails?: {
    summary: "negative" | "positive" | "negative_dilute" | "inconclusive";
    panel: DrugTestPanel;
    collectedAt?: Date;
    completedAt?: Date;
    /** Substance(s) flagged on a positive result. */
    positiveAnalytes?: string[];
  };
}

export interface DrugScreeningVendor {
  readonly name: string;
  readonly version: string;
  createOrder(input: DrugScreenOrderInput): Promise<DrugScreenOrderResult>;
  getStatus(vendorRef: string): Promise<DrugScreenStatusResult>;
  cancelOrder(vendorRef: string): Promise<void>;
}

/**
 * THC-restricted states where standard 5-panel tests should be swapped to
 * the no-THC variant unless the role qualifies for an exemption (DOT,
 * safety-sensitive defined narrowly per state law). When in doubt, use
 * 5_panel_no_thc and consult counsel.
 */
const THC_RESTRICTED_STATES = new Set(["CA", "NY", "NJ", "WA", "RI", "MN", "DC"]);

export function shouldStripThcForState(state: string): boolean {
  return THC_RESTRICTED_STATES.has((state || "").toUpperCase());
}

function stubOrder(): DrugScreenOrderResult {
  return {
    vendorRef: `stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    schedulingUrl: null,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  };
}

/**
 * Accurate Background drug / occupational health API (v3).
 *
 * - **No `ACCURATE_API_KEY`**: returns a deterministic stub so dev flows work.
 * - **Key present, `ACCURATE_INTEGRATION` ≠ `live`**: stub + console warning
 *   (avoids throwing in staging when someone drops a key before go-live).
 * - **`ACCURATE_INTEGRATION=live`**: POST `/order` per Accurate docs
 *   (INTERACTIVE workflow). Tune package + drug add-ons via env vars below.
 *
 * Env (live):
 *   - `ACCURATE_BASE_URL` (default `https://api.accuratebackground.com/v3`)
 *   - `ACCURATE_HTTP_USER` / `ACCURATE_HTTP_PASSWORD` — HTTP Basic (defaults:
 *     user=`ACCURATE_API_KEY`, password=`ACCURATE_API_SECRET` or empty)
 *   - `ACCURATE_PACKAGE_TYPE` (default `PKG_EMPTY`)
 *   - `ACCURATE_DRUG_ADDITIONAL_PRODUCTS` — JSON array for `additionalProductTypes`
 */
export class AccurateAdapter implements DrugScreeningVendor {
  readonly name = "Accurate Background";
  readonly version = "v3";
  private apiKey: string | null;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.ACCURATE_API_KEY ?? null;
    this.baseUrl = (process.env.ACCURATE_BASE_URL ?? "https://api.accuratebackground.com/v3").replace(/\/$/, "");
  }

  private isLive(): boolean {
    return process.env.ACCURATE_INTEGRATION === "live";
  }

  private authHeader(): string {
    const user = process.env.ACCURATE_HTTP_USER || this.apiKey || "";
    const pass = process.env.ACCURATE_HTTP_PASSWORD || process.env.ACCURATE_API_SECRET || "";
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  private parseAdditionalProducts(): unknown[] {
    const raw = process.env.ACCURATE_DRUG_ADDITIONAL_PRODUCTS;
    if (!raw?.trim()) return [];
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v : [];
    } catch {
      console.warn("[Drug/Accurate] ACCURATE_DRUG_ADDITIONAL_PRODUCTS is not valid JSON — ignoring");
      return [];
    }
  }

  private async accuratePostJson(path: string, body: unknown): Promise<any> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`Accurate ${path} ${res.status}: ${text.slice(0, 500)}`);
    }
    return json;
  }

  private async accurateGetJson(path: string): Promise<any> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: this.authHeader(), Accept: "application/json" },
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`Accurate GET ${path} ${res.status}: ${text.slice(0, 500)}`);
    }
    return json;
  }

  async createOrder(input: DrugScreenOrderInput): Promise<DrugScreenOrderResult> {
    if (!this.apiKey) {
      console.warn("[Drug/Accurate] ACCURATE_API_KEY missing — returning stub order");
      return stubOrder();
    }
    if (!this.isLive()) {
      console.warn(
        "[Drug/Accurate] ACCURATE_API_KEY is set but ACCURATE_INTEGRATION is not 'live' — returning stub order (set ACCURATE_INTEGRATION=live to call Accurate)",
      );
      return stubOrder();
    }

    const packageType = process.env.ACCURATE_PACKAGE_TYPE || "PKG_EMPTY";
    const region = (input.workplaceState || "CA").toUpperCase().slice(0, 2);
    const body: Record<string, unknown> = {
      workflow: "INTERACTIVE",
      packageType,
      candidate: {
        firstName: input.workerFirstName,
        lastName: input.workerLastName,
        email: input.workerEmail,
        dateOfBirth: input.workerDateOfBirth.toISOString().slice(0, 10),
        phone: input.workerPhone,
        postalCode: input.workerZip,
        country: "US",
        region: region.length === 2 ? region : undefined,
      },
      jobLocation: {
        city: "_",
        region: region.length === 2 ? region : "CA",
        country: "US",
        region2: "",
      },
      copyOfReport: false,
      additionalProductTypes: this.parseAdditionalProducts(),
    };

    const json = await this.accuratePostJson("/order", body);
    const vendorRef = String(json.orderId ?? json.id ?? json.candidateOrderId ?? json.requestId ?? "");
    if (!vendorRef) {
      throw new Error("AccurateAdapter.createOrder: response missing order id");
    }
    const schedulingUrl =
      json.schedulingUrl ?? json.scheduleUrl ?? json.invitationUrl ?? json.interactiveUrl ?? null;
    return {
      vendorRef,
      status: "pending",
      schedulingUrl: schedulingUrl ? String(schedulingUrl) : null,
      expiresAt: json.expiresAt ? new Date(json.expiresAt) : new Date(Date.now() + 7 * 86_400_000),
    };
  }

  async getStatus(vendorRef: string): Promise<DrugScreenStatusResult> {
    if (!this.apiKey || !this.isLive() || vendorRef.startsWith("stub_")) {
      return { vendorRef, status: "pending" };
    }
    try {
      const json = await this.accurateGetJson(`/order/${encodeURIComponent(vendorRef)}`);
      const statusRaw = String(json.status ?? json.orderStatus ?? "pending").toLowerCase();
      let status: DrugTestStatus = "pending";
      if (statusRaw.includes("complete") && statusRaw.includes("neg")) status = "completed_negative";
      else if (statusRaw.includes("progress") || statusRaw.includes("collect")) status = "in_progress";
      else if (statusRaw.includes("cancel")) status = "cancelled";
      else if (statusRaw.includes("expire")) status = "expired";
      return { vendorRef, status };
    } catch (e) {
      console.warn("[Drug/Accurate] getStatus failed:", (e as Error).message);
      return { vendorRef, status: "pending" };
    }
  }

  async cancelOrder(vendorRef: string): Promise<void> {
    if (!this.apiKey || vendorRef.startsWith("stub_")) return;
    if (!this.isLive()) return;
    try {
      await fetch(`${this.baseUrl}/order/${encodeURIComponent(vendorRef)}`, {
        method: "DELETE",
        headers: { Authorization: this.authHeader(), Accept: "application/json" },
      });
    } catch (e) {
      console.warn("[Drug/Accurate] cancelOrder failed:", (e as Error).message);
    }
  }
}

/** Default vendor instance used by callers that don't need to pick. */
export const drugScreeningVendor: DrugScreeningVendor = new AccurateAdapter();
