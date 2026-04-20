import { log } from "../index";
import { secretsManager } from "./secretsManager";

// Mercury API Configuration
interface MercuryConfig {
  apiToken: string;
  baseUrl: string;
  environment: 'sandbox' | 'production';
}

// Cache for API config
let cachedConfig: MercuryConfig | null = null;

// Cache for default account ID (avoids GET /accounts on every sendPayment)
let cachedDefaultAccountId: string | null = null;

/** Normalize Mercury API key: trim whitespace, strip "secret-token:" prefix if present. Header value must be key only. */
function normalizeMercuryToken(raw: string): string {
  let s = (raw || "").trim();
  if (s.toLowerCase().startsWith("secret-token:")) {
    s = s.slice("secret-token:".length).trim();
  }
  return s;
}

// Get Mercury API configuration with token from environment or GCP Secrets
async function getMercuryConfig(): Promise<MercuryConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const isDev = process.env.NODE_ENV === "development";
  
  if (isDev) {
    // Development: Use sandbox token from .env (either name; isConfigured() allows both)
    const raw = process.env.Mercury_Sandbox || process.env.MERCURY_SANDBOX_API_TOKEN;
    if (!raw) {
      throw new Error("Mercury_Sandbox or MERCURY_SANDBOX_API_TOKEN not configured in .env.development");
    }
    const apiToken = normalizeMercuryToken(raw);
    if (!apiToken) {
      throw new Error("Mercury_Sandbox is empty after normalizing");
    }
    cachedConfig = {
      apiToken,
      baseUrl: "https://api-sandbox.mercury.com/api/v1",
      environment: 'sandbox',
    };
    log("Using Mercury SANDBOX environment", "mercury");
  } else {
    // Production: MERCURY_PRODUCTION_API_TOKEN (env and/or GCP secret of the same name)
    const raw =
      (process.env.MERCURY_PRODUCTION_API_TOKEN || "").trim() ||
      (await secretsManager.getSecret("MERCURY_PRODUCTION_API_TOKEN", "MERCURY_PRODUCTION_API_TOKEN"))?.trim();
    if (!raw) {
      throw new Error(
        "MERCURY_PRODUCTION_API_TOKEN missing: set it on the app host or create GCP secret MERCURY_PRODUCTION_API_TOKEN"
      );
    }
    const apiToken = normalizeMercuryToken(raw);
    if (!apiToken) {
      throw new Error("MERCURY_PRODUCTION_API_TOKEN is empty after normalizing");
    }
    cachedConfig = {
      apiToken,
      baseUrl: "https://api.mercury.com/api/v1",
      environment: 'production',
    };
    log("Using Mercury PRODUCTION environment", "mercury");
  }
  
  return cachedConfig;
}

/** Default ceiling so hung Mercury TCP never blocks Express (e.g. W-9 status polling). Callers may pass `signal` to override or combine. */
const MERCURY_FETCH_TIMEOUT_MS = Number(process.env.MERCURY_FETCH_TIMEOUT_MS) || 45_000;

function defaultMercuryAbortSignal(): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(MERCURY_FETCH_TIMEOUT_MS);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), MERCURY_FETCH_TIMEOUT_MS);
  return c.signal;
}

// Mercury API request wrapper
async function mercuryRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const config = await getMercuryConfig();
  const url = `${config.baseUrl}${endpoint}`;
  
  // Mercury API uses Basic Authentication:
  // - Username: The full token with "secret-token:" prefix (e.g., "secret-token:mercury_sandbox_wma_...")
  // - Password: Empty string
  // We need to reconstruct the full token for Basic Auth
  const fullToken = config.apiToken.startsWith('secret-token:') 
    ? config.apiToken 
    : `secret-token:${config.apiToken}`;
  
  // Create Basic Auth header: base64(username:password)
  const basicAuth = Buffer.from(`${fullToken}:`).toString('base64');
  
  const headers: HeadersInit = {
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
    'User-Agent': 'TolstoyStaffing/1.0 (Server; +https://tolstoystaffing.com)',
    'Accept': 'application/json',
    ...options.headers,
  };

  console.log(`[Mercury] Making ${options.method || 'GET'} request to: ${url}`);
  if (options.body) {
    try {
      const bodyObj = JSON.parse(options.body as string);
      const maskedBody = maskSensitiveData(bodyObj);
      console.log(`[Mercury] Request body:`, JSON.stringify(maskedBody, null, 2));
    } catch (e) {
      console.log(`[Mercury] Request body (raw):`, options.body);
    }
  }

  const signal = options.signal ?? defaultMercuryAbortSignal();

  const response = await fetch(url, {
    ...options,
    headers,
    signal,
  });
  
  console.log(`[Mercury] Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Mercury API error: ${response.status} ${response.statusText}`;
    let errorDetails: any = {};
    
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
      errorDetails = errorJson;
    } catch {
      if (errorText && !errorText.trimStart().startsWith("<") && errorText.length < 500) {
        errorMessage = errorText || errorMessage;
      }
      errorDetails = { raw: errorText?.slice(0, 200) };
    }
    
    console.error(`[Mercury] ❌ API Error (${response.status}):`, {
      url,
      status: response.status,
      statusText: response.statusText,
      error: errorMessage,
      details: errorDetails,
      endpoint: endpoint,
    });
    log(`Mercury API Error: ${errorMessage}`, "mercury");
    log(`Mercury API Error Details: ${JSON.stringify(errorDetails)}`, "mercury");
    
    // Create error with status code for easier handling
    const error: any = new Error(errorMessage);
    error.status = response.status;
    error.statusText = response.statusText;
    error.details = errorDetails;
    error.mercuryHttp = true;
    throw error;
  }

  const responseData = await response.json();
  console.log(`[Mercury] Response data:`, JSON.stringify(responseData, null, 2));
  return responseData;
}

/** Multipart request for file uploads (e.g. recipient W-9 attachment). Does not set Content-Type so fetch sets multipart boundary. */
async function mercuryMultipartRequest<T>(
  endpoint: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  const config = await getMercuryConfig();
  const url = `${config.baseUrl}${endpoint}`;
  const fullToken = config.apiToken.startsWith('secret-token:')
    ? config.apiToken
    : `secret-token:${config.apiToken}`;
  const basicAuth = Buffer.from(`${fullToken}:`).toString('base64');
  const headers: HeadersInit = {
    Authorization: `Basic ${basicAuth}`,
    'User-Agent': 'TolstoyStaffing/1.0 (Server; +https://tolstoystaffing.com)',
    'Accept': 'application/json',
    ...options.headers,
  };
  // Do NOT set Content-Type - fetch will set multipart/form-data with boundary
  console.log(`[Mercury] Making ${options.method || 'POST'} multipart request to: ${url}`);
  const response = await fetch(url, {
    ...options,
    method: options.method || 'POST',
    headers,
    body: formData,
  });
  console.log(`[Mercury] Response status: ${response.status} ${response.statusText}`);
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Mercury API error: ${response.status} ${response.statusText}`;
    let errorDetails: any = { raw: errorText?.slice(0, 200) };
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorMessage;
      errorDetails = errorJson;
    } catch {
      if (errorText && !errorText.trimStart().startsWith("<") && errorText.length < 500) {
        errorMessage = errorText || errorMessage;
      }
    }
    console.error(`[Mercury] ❌ API Error (${response.status}):`, { url, errorMessage, details: errorDetails });
    log(`Mercury API Error: ${errorMessage}`, "mercury");
    const error: any = new Error(errorMessage);
    error.status = response.status;
    error.statusText = response.statusText;
    error.details = errorDetails;
    error.mercuryHttp = true;
    throw error;
  }
  const responseData = await response.json();
  console.log(`[Mercury] Response data:`, JSON.stringify(responseData, null, 2));
  return responseData;
}

// Helper function to mask sensitive data in logs
function maskSensitiveData(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  
  const masked = { ...obj };
  const sensitiveKeys = ['accountNumber', 'routingNumber', 'account_number', 'routing_number'];
  
  for (const key in masked) {
    if (sensitiveKeys.includes(key) && typeof masked[key] === 'string') {
      masked[key] = '***' + masked[key].slice(-4);
    } else if (key === 'electronicRoutingInfo' && typeof masked[key] === 'object') {
      masked[key] = maskSensitiveData(masked[key]);
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskSensitiveData(masked[key]);
    }
  }
  
  return masked;
}

// Mercury Types
export interface MercuryAccount {
  id: string;
  name: string;
  accountNumber: string;
  routingNumber: string;
  availableBalance: number; // in cents
  currentBalance: number; // in cents
  status: string;
  type: string;
}

/** Mercury recipient attachment (tax document) - returned with getRecipient */
export interface MercuryRecipientAttachment {
  id?: string;
  taxFormType?: string;
  fileName?: string;
  dateTime?: string;
  url?: string;
}

export interface MercuryRecipient {
  id: string;
  name: string;
  emails?: string[];
  accountNumber?: string;
  routingNumber?: string;
  accountType?: 'checking' | 'savings';
  status: 'pending' | 'active' | 'inactive';
  createdAt: string;
  /** Associated tax document attachments (W-9, etc.) - present when API returns them */
  attachments?: MercuryRecipientAttachment[];
}

export interface MercuryPayment {
  id: string;
  amount: number; // in cents
  status: 'pending' | 'sent' | 'completed' | 'failed' | 'cancelled';
  recipientId: string;
  description?: string;
  estimatedDelivery?: string;
  createdAt: string;
  failureReason?: string;
}

export interface MercuryTransaction {
  id: string;
  amount: number; // in cents
  createdAt: string;
  status: string;
  counterpartyName?: string;
  description?: string;
  kind: 'debit' | 'credit' | 'fee' | 'other';
}

/** Mercury AR (Accounts Receivable) customer - for invoicing. See https://docs.mercury.com/reference/createcustomer */
export interface MercuryArCustomer {
  id: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface CreateArCustomerParams {
  name: string;
  email?: string;
  /** Optional external ID to link to our profile (e.g. profile id) */
  externalId?: string;
}

/** Mercury AR Invoice - https://docs.mercury.com/reference/createinvoice */
export interface MercuryArInvoice {
  id: string;
  customerId?: string;
  amount?: number;
  status?: string;
  [key: string]: unknown;
}

export interface CreateArInvoiceParams {
  customerId: string;
  amountCents: number;
  description: string;
  /** Optional reference (e.g. Stripe payment intent id) */
  externalId?: string;
}

export interface CreateRecipientParams {
  name: string;
  email?: string;
  emails?: string[];
  /** Primary contact email (for payment receipts); per Mercury UI "Email (optional) For payment receipts" */
  contactEmail?: string;
  /** Recipient phone number */
  phoneNumber?: string;
  /** True = business recipient, false = person; per Mercury "This recipient is a" */
  isBusiness?: boolean;
  nickname?: string;
  routingNumber: string;
  accountNumber: string;
  accountType: 'checking' | 'savings' | 'businessChecking' | 'businessSavings' | 'personalChecking' | 'personalSavings';
  // Address fields
  address1?: string;
  address2?: string;
  city?: string;
  region?: string; // State
  postalCode?: string;
  country?: string; // ISO 3166 Alpha-2 format (e.g., "US")
  note?: string;
  paymentMethod?: 'ach';
}

export interface CreatePaymentParams {
  recipientId: string;
  amount: number; // in cents
  description?: string;
  idempotencyKey?: string;
  note?: string;
  /**
   * Worker profile id of the payee — used by OFAC pre-payout screening.
   * If omitted, sendPayment will look it up from profiles.mercuryRecipientId.
   * Pass directly when you already have it for a small perf win.
   */
  workerProfileId?: number;
  /**
   * Email of the operator initiating this payment. Recorded in admin
   * activity log on screening events. Use "system" for autoApproval.
   */
  actor?: string;
  /**
   * Skip OFAC screening (admin override / bypass). Caller MUST log a
   * justification — the bypass itself shows up in the audit log.
   */
  bypassOfacScreening?: boolean;
}

export interface CreateDebitParams {
  recipientId?: string;
  externalAccountId?: string;
  /** Display / logging name for placeholder debit API */
  counterpartyName?: string;
  amount: number; // in cents
  description?: string;
  idempotencyKey?: string;
  note?: string;
  // Note: ACH debits in Mercury require prior authorization/setup
  // This is typically done via Plaid Link or manual verification
}

// Mercury Service
export const mercuryService = {
  /**
   * Check if Mercury API is configured and accessible
   */
  isConfigured(): boolean {
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      return !!(process.env.Mercury_Sandbox || process.env.MERCURY_SANDBOX_API_TOKEN);
    }
    return !!process.env.MERCURY_PRODUCTION_API_TOKEN;
  },

  /**
   * Verify Mercury API connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.getAccounts();
      log("Mercury API connection verified", "mercury");
      return true;
    } catch (error: any) {
      log(`Mercury API connection failed: ${error.message}`, "mercury");
      return false;
    }
  },

  /**
   * Get all Mercury accounts (platform accounts)
   */
  async getAccounts(): Promise<MercuryAccount[]> {
    try {
      const response = await mercuryRequest<{ accounts: MercuryAccount[] }>('/accounts');
      log(`Retrieved ${response.accounts.length} Mercury accounts`, "mercury");
      return response.accounts;
    } catch (error: any) {
      log(`Error getting accounts: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Get specific Mercury account by ID
   */
  async getAccount(accountId: string): Promise<MercuryAccount> {
    try {
      const account = await mercuryRequest<MercuryAccount>(`/account/${accountId}`);
      log(`Retrieved Mercury account: ${accountId}`, "mercury");
      return account;
    } catch (error: any) {
      log(`Error getting account ${accountId}: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Get platform account balance
   */
  async getBalance(accountId: string): Promise<{ available: number; current: number }> {
    try {
      const account = await this.getAccount(accountId);
      return {
        available: account.availableBalance,
        current: account.currentBalance,
      };
    } catch (error: any) {
      log(`Error getting balance: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Create an AR (Accounts Receivable) customer for the organization.
   * Used when a company completes onboarding so they can be invoiced in Mercury.
   * See https://docs.mercury.com/reference/createcustomer
   */
  async createArCustomer(params: CreateArCustomerParams): Promise<MercuryArCustomer> {
    try {
      const email =
        params.email?.trim() ||
        (params.externalId != null
          ? `mercury-ar-company-${params.externalId}@tolstoystaffing.invalid`
          : "mercury-ar-unknown@tolstoystaffing.invalid");
      const payload: Record<string, unknown> = {
        name: params.name.trim(),
        email,
      };
      if (params.externalId) payload.externalId = String(params.externalId);

      const customer = await mercuryRequest<MercuryArCustomer>('/ar/customers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      log(`Created Mercury AR customer: ${(customer as any).id} (${params.name})`, "mercury");
      return customer;
    } catch (error: any) {
      log(`Error creating Mercury AR customer: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Create an AR invoice for a customer, then mark it paid.
   * Used when a company makes a top-up or we auto-draw payment via Stripe/Mercury so Mercury has a record.
   * See https://docs.mercury.com/reference/createinvoice and updateinvoice.
   */
  async createArInvoice(params: CreateArInvoiceParams): Promise<MercuryArInvoice> {
    try {
      // Mercury API: POST /ar/invoices - customerId and lineItems (description, quantity, unitAmount in cents)
      const payload: Record<string, unknown> = {
        customerId: params.customerId,
        lineItems: [
          {
            description: params.description,
            quantity: 1,
            unitAmount: params.amountCents,
          },
        ],
      };
      if (params.externalId) payload.externalId = params.externalId;

      const invoice = await mercuryRequest<MercuryArInvoice>('/ar/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      log(`Created Mercury AR invoice: ${(invoice as any).id} ($${(params.amountCents / 100).toFixed(2)})`, "mercury");
      return invoice;
    } catch (error: any) {
      log(`Error creating Mercury AR invoice: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Update an AR invoice status (e.g. mark as paid).
   * See https://docs.mercury.com/reference/updateinvoice
   */
  async updateArInvoice(invoiceId: string, updates: { status?: string }): Promise<MercuryArInvoice> {
    try {
      const invoice = await mercuryRequest<MercuryArInvoice>(`/ar/invoices/${invoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      log(`Updated Mercury AR invoice: ${invoiceId} status=${updates.status}`, "mercury");
      return invoice;
    } catch (error: any) {
      log(`Error updating Mercury AR invoice: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Ensure the company has a Mercury AR customer for invoicing. Creates one if missing and saves to profile.
   * Call during onboarding or whenever we need the company in Mercury (e.g. with ensureCompanyStripeCustomer).
   * See https://docs.mercury.com/reference/createcustomer
   * Does not throw - logs errors so callers are not blocked.
   */
  async ensureMercuryArCustomerForCompany(
    profile: { id: number; companyName?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; mercuryArCustomerId?: string | null }
  ): Promise<string | null> {
    if (!this.isConfigured()) {
      log("Mercury not configured; skipping ensure AR customer", "mercury");
      return null;
    }
    try {
      const { storage } = await import("../storage");
      const fresh = await storage.getProfile(profile.id);
      const customerId = fresh?.mercuryArCustomerId ?? profile.mercuryArCustomerId;
      if (customerId) return customerId;
      const customerName = (
        profile.companyName ||
        [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
        fresh?.email ||
        profile.email ||
        `Company ${profile.id}`
      ).trim();
      const customerEmail = (fresh?.email || profile.email)?.trim() || undefined;
      const customer = await this.createArCustomer({
        name: customerName,
        email: customerEmail,
        externalId: String(profile.id),
      });
      await storage.updateProfile(profile.id, { mercuryArCustomerId: customer.id });
      log(`Created Mercury AR customer: ${customer.id} for company ${profile.id} (${customerName})`, "mercury");
      return customer.id;
    } catch (err: any) {
      console.warn("[Mercury] ensureMercuryArCustomerForCompany failed (non-blocking):", err?.message ?? err);
      log(`Mercury AR ensure customer failed: ${err?.message}`, "mercury");
      return null;
    }
  },

  /**
   * Create an AR invoice for a company payment and mark it paid.
   * Call after any company payment (top-up or auto-draw) so Mercury has the record.
   * If the company has no Mercury AR customer yet: create one on the spot, store it for the company,
   * then create the invoice and mark it paid. This avoids missing invoices when a company pays before
   * we had a chance to create their Mercury customer (e.g. at onboarding completion).
   * Dev: uses Mercury Sandbox; Production: uses Mercury Production (Secrets Manager).
   * Does not throw - logs errors so payment flow is not blocked.
   */
  async recordCompanyPaymentAsMercuryInvoice(
    profile: { id: number; companyName?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; mercuryArCustomerId?: string | null },
    amountCents: number,
    description: string,
    paymentReference?: string
  ): Promise<void> {
    if (!this.isConfigured()) {
      log("Mercury not configured; skipping AR invoice for company payment", "mercury");
      return;
    }
    try {
      const { storage } = await import("../storage");
      // Use latest profile from DB so we don't create duplicate Mercury customers if one was just set (e.g. by onboarding)
      const fresh = await storage.getProfile(profile.id);
      let customerId: string | null = (fresh?.mercuryArCustomerId ?? profile.mercuryArCustomerId) ?? null;
      if (!customerId) {
        const customerName = (profile.companyName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim()) || `Company ${profile.id}`;
        const customer = await this.createArCustomer({
          name: customerName,
          email: profile.email || undefined,
          externalId: String(profile.id),
        });
        customerId = customer.id;
        await storage.updateProfile(profile.id, { mercuryArCustomerId: customerId });
        log(`Created Mercury AR customer on payment: ${customerId} for company ${profile.id}`, "mercury");
      }
      const invoice = await this.createArInvoice({
        customerId,
        amountCents,
        description,
        externalId: paymentReference,
      });
      const invoiceId = invoice.id;
      if (invoiceId) {
        await this.updateArInvoice(invoiceId, { status: "paid" });
        log(`Mercury invoice ${invoiceId} created and marked paid for company ${profile.id} ($${(amountCents / 100).toFixed(2)})`, "mercury");
      }
    } catch (err: any) {
      console.error("[Mercury] Failed to record company payment as invoice (non-blocking):", err?.message ?? err);
      log(`Mercury AR invoice failed (non-blocking): ${err?.message}`, "mercury");
    }
  },

  /**
   * Create a recipient (for companies or workers)
   */
  async createRecipient(params: CreateRecipientParams): Promise<MercuryRecipient> {
    try {
      // Handle both email (string) and emails (array) parameters
      // Filter out empty strings
      let emails: string[] = [];
      if (params.emails && params.emails.length > 0) {
        emails = params.emails.filter(e => e && e.trim().length > 0);
      } else if (params.email && params.email.trim().length > 0) {
        emails = [params.email.trim()];
      }

      if (emails.length === 0) {
        const err: any = new Error(
          "Mercury requires at least one recipient email (AddRecipientRequest.emails). Add an email to the profile and retry."
        );
        err.status = 400;
        err.localValidation = true;
        throw err;
      }

      // Map accountType to Mercury's electronicAccountType format
      // Convert "checking"/"savings" to "businessChecking"/"businessSavings" if not already specified
      let electronicAccountType: string = params.accountType;
      if (electronicAccountType === 'checking') {
        electronicAccountType = 'businessChecking';
      } else if (electronicAccountType === 'savings') {
        electronicAccountType = 'businessSavings';
      }

      // Build address object if address fields are provided
      const address: any = {};
      if (params.address1) address.address1 = params.address1;
      if (params.address2) address.address2 = params.address2;
      if (params.city) address.city = params.city;
      if (params.region) address.region = params.region;
      if (params.postalCode) address.postalCode = params.postalCode;
      // Country defaults to US if not provided
      address.country = params.country || 'US';

      // Build electronicRoutingInfo with address
      const electronicRoutingInfo: any = {
        accountNumber: params.accountNumber,
        routingNumber: params.routingNumber,
        electronicAccountType: electronicAccountType,
      };
      // Include address if we have at least address1 (required by Mercury)
      if (address.address1) {
        electronicRoutingInfo.address = address;
      } else if (Object.keys(address).length > 0) {
        // If we have other address fields but not address1, still include them
        // (Mercury may handle this, or we'll get a validation error)
        electronicRoutingInfo.address = address;
        log(`Warning: Creating recipient without address1, only partial address provided`, "mercury");
      }

      const payload: any = {
        name: params.name,
        emails, // required by Mercury; non-empty guaranteed above
        electronicRoutingInfo: electronicRoutingInfo,
        paymentMethod: params.paymentMethod || 'ach',
      };

      if (params.nickname) payload.nickname = params.nickname;
      if (params.contactEmail?.trim()) payload.contactEmail = params.contactEmail.trim();
      if (params.phoneNumber?.trim()) payload.phoneNumber = params.phoneNumber.trim();
      if (params.isBusiness !== undefined) payload.isBusiness = Boolean(params.isBusiness);
      
      // Remove undefined fields to avoid sending them (but keep empty arrays)
      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });

      // Log full payload structure (with sensitive data masked)
      const logPayload = {
        ...payload,
        electronicRoutingInfo: {
          ...electronicRoutingInfo,
          accountNumber: '***' + (params.accountNumber?.slice(-4) || ''),
          routingNumber: '***' + (params.routingNumber?.slice(-4) || ''),
        }
      };
      console.log(`[Mercury] Creating recipient - Full payload structure:`, JSON.stringify(logPayload, null, 2));
      console.log(`[Mercury] Address object:`, JSON.stringify(address, null, 2));
      console.log(`[Mercury] ElectronicRoutingInfo:`, JSON.stringify({ ...electronicRoutingInfo, accountNumber: '***', routingNumber: '***' }, null, 2));

      console.log(`[Mercury] Sending POST request to /recipients`);
      console.log(`[Mercury] Request payload (final, before sending):`, JSON.stringify(payload, null, 2));
      
      const recipient = await mercuryRequest<MercuryRecipient>('/recipients', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      console.log(`[Mercury] ✅ Successfully created recipient:`, {
        id: recipient.id,
        name: recipient.name,
        status: recipient.status,
        hasAccountNumber: !!recipient.accountNumber,
        hasRoutingNumber: !!recipient.routingNumber,
        accountType: recipient.accountType,
        emails: recipient.emails,
      });
      console.log(`[Mercury] Full recipient response:`, JSON.stringify(recipient, null, 2));
      log(`Created Mercury recipient: ${recipient.id} (${params.name})`, "mercury");
      return recipient;
    } catch (error: any) {
      log(`Error creating recipient: ${error.message}`, "mercury");
      log(`Error stack: ${error.stack}`, "mercury");
      if (error.response) {
        log(`Error response: ${JSON.stringify(error.response)}`, "mercury");
      }
      throw error;
    }
  },

  /**
   * Get recipient by ID
   */
  async getRecipient(recipientId: string): Promise<MercuryRecipient> {
    try {
      // Mercury API uses singular /recipient/{id} for single-recipient operations (docs.mercury.com/reference/getrecipient)
      const recipient = await mercuryRequest<MercuryRecipient>(`/recipient/${recipientId}`);
      return recipient;
    } catch (error: any) {
      log(`Error getting recipient ${recipientId}: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Check if a recipient has a W-9 (or equivalent tax form) attached in Mercury.
   * Uses getRecipient; Mercury returns attachments with taxFormType, fileName, dateTime.
   */
  async recipientHasW9Attachment(recipientId: string): Promise<boolean> {
    try {
      const recipient = await this.getRecipient(recipientId);
      const attachments = (recipient as any).attachments ?? (recipient as any).taxDocuments ?? [];
      const hasW9 = Array.isArray(attachments) && attachments.some(
        (a: any) => (a?.taxFormType ?? a?.tax_form_type ?? "").toLowerCase().includes("w9") || (a?.taxFormType ?? "") === "w9"
      );
      console.log(`[Mercury] recipientHasW9Attachment(${recipientId}): ${hasW9} (attachments: ${attachments?.length ?? 0})`);
      return hasW9;
    } catch (error: any) {
      console.error(`[Mercury] recipientHasW9Attachment(${recipientId}) error:`, error?.message ?? error);
      log(`Error checking W-9 for recipient ${recipientId}: ${error.message}`, "mercury");
      return false;
    }
  },

  /**
   * List all recipients
   */
  async listRecipients(): Promise<MercuryRecipient[]> {
    try {
      const response = await mercuryRequest<{ recipients: MercuryRecipient[] }>('/recipients');
      log(`Retrieved ${response.recipients.length} recipients`, "mercury");
      return response.recipients;
    } catch (error: any) {
      log(`Error listing recipients: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Update recipient information
   * @throws {Error} If recipient not found (404), throws error with status 404
   */
  async updateRecipient(recipientId: string, updates: Partial<CreateRecipientParams>): Promise<MercuryRecipient> {
    try {
      // First, verify the recipient exists
      try {
        await this.getRecipient(recipientId);
      } catch (checkError: any) {
        if (checkError.status === 404) {
          console.log(`[Mercury] Recipient ${recipientId} not found (404) - was likely deleted`);
          const error: any = new Error(`Recipient ${recipientId} not found. It may have been deleted.`);
          error.status = 404;
          error.recipientNotFound = true;
          throw error;
        }
        // Re-throw other errors
        throw checkError;
      }
      // Handle email conversion
      let emails: string[] = [];
      if (updates.emails && updates.emails.length > 0) {
        emails = updates.emails.filter(e => e && e.trim().length > 0);
      } else if (updates.email && updates.email.trim().length > 0) {
        emails = [updates.email.trim()];
      }

      // Build payload with only provided fields
      const payload: any = {};
      
      if (updates.name) payload.name = updates.name;
      if (emails.length > 0) payload.emails = emails;
      if (updates.nickname !== undefined) payload.nickname = updates.nickname;
      if (updates.contactEmail !== undefined) payload.contactEmail = updates.contactEmail?.trim() || undefined;
      if (updates.phoneNumber !== undefined) payload.phoneNumber = updates.phoneNumber?.trim() || undefined;
      if (updates.isBusiness !== undefined) payload.isBusiness = Boolean(updates.isBusiness);

      // Build electronicRoutingInfo if routing/account info is provided
      if (updates.routingNumber || updates.accountNumber || updates.accountType) {
        const electronicRoutingInfo: any = {};
        
        if (updates.accountNumber) electronicRoutingInfo.accountNumber = updates.accountNumber;
        if (updates.routingNumber) electronicRoutingInfo.routingNumber = updates.routingNumber;
        
        // Map accountType to Mercury's electronicAccountType format
        if (updates.accountType) {
          let electronicAccountType: string = updates.accountType;
          if (electronicAccountType === 'checking') {
            electronicAccountType = 'businessChecking';
          } else if (electronicAccountType === 'savings') {
            electronicAccountType = 'businessSavings';
          }
          electronicRoutingInfo.electronicAccountType = electronicAccountType;
        }

        // Build address object if address fields are provided
        const address: any = {};
        if (updates.address1) address.address1 = updates.address1;
        if (updates.address2 !== undefined) address.address2 = updates.address2;
        if (updates.city) address.city = updates.city;
        if (updates.region) address.region = updates.region;
        if (updates.postalCode) address.postalCode = updates.postalCode;
        address.country = updates.country || 'US';
        
        // When updating routing info, address is REQUIRED with ALL fields (address1, city, region, postalCode, country)
        console.log(`[Mercury] Checking address fields for routing info update:`, {
          hasAddress1: !!address.address1,
          hasCity: !!address.city,
          hasRegion: !!address.region,
          hasPostalCode: !!address.postalCode,
          hasCountry: !!address.country,
        });
        
        // Try to construct address1 if missing
        if (!address.address1 && (address.city || address.region)) {
          const addressParts = [];
          if (address.city) addressParts.push(address.city);
          if (address.region) addressParts.push(address.region);
          if (addressParts.length > 0) {
            address.address1 = addressParts.join(', ');
            console.log(`[Mercury] Constructed address1: ${address.address1}`);
          }
        }
        
        // Validate all required fields are present
        if (address.address1 && address.city && address.region && address.postalCode) {
          // We have all required address fields
          electronicRoutingInfo.address = address;
          console.log(`[Mercury] ✅ Including complete address in electronicRoutingInfo`);
        } else {
          // Missing required fields - this should not happen if validation is correct
          const missing = [];
          if (!address.address1) missing.push('address1');
          if (!address.city) missing.push('city');
          if (!address.region) missing.push('region');
          if (!address.postalCode) missing.push('postalCode');
          console.error(`[Mercury] ❌ Cannot update routing info - missing required address fields:`, missing);
          throw new Error(`All address fields (address1, city, region, postalCode) are required when updating bank account details. Missing: ${missing.join(', ')}`);
        }

        payload.electronicRoutingInfo = electronicRoutingInfo;
      } else if (updates.address1 || updates.city || updates.region || updates.postalCode) {
        // If only address fields are being updated, we still need to include electronicRoutingInfo
        // Get existing recipient to preserve routing info
        try {
          const existing = await this.getRecipient(recipientId);
          const electronicRoutingInfo: Record<string, unknown> = {};
          
          // Preserve existing routing info if available
          if (existing.accountNumber) electronicRoutingInfo.accountNumber = existing.accountNumber;
          if (existing.routingNumber) electronicRoutingInfo.routingNumber = existing.routingNumber;
          if (existing.accountType) {
            let electronicAccountType: string = existing.accountType;
            if (electronicAccountType === "checking") electronicAccountType = "businessChecking";
            else if (electronicAccountType === "savings") electronicAccountType = "businessSavings";
            electronicRoutingInfo.electronicAccountType = electronicAccountType;
          } else {
            electronicRoutingInfo.electronicAccountType = "businessChecking"; // Default
          }

          // Build address object with updates
          const address: any = {};
          if (updates.address1) address.address1 = updates.address1;
          if (updates.address2 !== undefined) address.address2 = updates.address2;
          if (updates.city) address.city = updates.city;
          if (updates.region) address.region = updates.region;
          if (updates.postalCode) address.postalCode = updates.postalCode;
          address.country = updates.country || 'US';

          // Only include address if we have at least address1
          if (address.address1) {
            electronicRoutingInfo.address = address;
          }

          payload.electronicRoutingInfo = electronicRoutingInfo;
        } catch (err) {
          log(`Warning: Could not fetch existing recipient to preserve routing info: ${err}`, "mercury");
        }
      }

      // Remove undefined fields to avoid sending them
      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
          delete payload[key];
        }
      });
      
      if (payload.electronicRoutingInfo) {
        Object.keys(payload.electronicRoutingInfo).forEach(key => {
          if (payload.electronicRoutingInfo[key] === undefined) {
            delete payload.electronicRoutingInfo[key];
          }
        });
        if (payload.electronicRoutingInfo.address) {
          Object.keys(payload.electronicRoutingInfo.address).forEach(key => {
            if (payload.electronicRoutingInfo.address[key] === undefined) {
              delete payload.electronicRoutingInfo.address[key];
            }
          });
        }
      }

      // Log full payload structure (with sensitive data masked)
      const logPayload = {
        ...payload,
        electronicRoutingInfo: payload.electronicRoutingInfo ? {
          ...payload.electronicRoutingInfo,
          accountNumber: payload.electronicRoutingInfo.accountNumber ? '***' + String(payload.electronicRoutingInfo.accountNumber).slice(-4) : undefined,
          routingNumber: payload.electronicRoutingInfo.routingNumber ? '***' + String(payload.electronicRoutingInfo.routingNumber).slice(-4) : undefined,
        } : undefined
      };
      console.log(`[Mercury] Updating recipient ${recipientId} - Full payload structure:`, JSON.stringify(logPayload, null, 2));
      if (payload.electronicRoutingInfo?.address) {
        console.log(`[Mercury] Address in update:`, JSON.stringify(payload.electronicRoutingInfo.address, null, 2));
      }

      // Mercury API: Edit recipient = POST /recipient/{recipientId} (singular; docs.mercury.com/reference/updaterecipient)
      console.log(`[Mercury] Sending POST request to /recipient/${recipientId}`);
      console.log(`[Mercury] Request payload (final, before sending):`, JSON.stringify(payload, null, 2));
      
      try {
        const recipient = await mercuryRequest<MercuryRecipient>(`/recipient/${recipientId}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        
        console.log(`[Mercury] ✅ Successfully updated recipient:`, {
          id: recipient.id,
          name: recipient.name,
          status: recipient.status,
          hasAccountNumber: !!recipient.accountNumber,
          hasRoutingNumber: !!recipient.routingNumber,
          accountType: recipient.accountType,
          emails: recipient.emails,
        });
        console.log(`[Mercury] Full recipient response:`, JSON.stringify(recipient, null, 2));
        log(`Updated Mercury recipient: ${recipientId}`, "mercury");
        return recipient;
      } catch (updateRequestError: any) {
        // If the update request itself returns 404, the recipient was deleted
        if (updateRequestError.status === 404) {
          console.log(`[Mercury] Update request returned 404 - recipient ${recipientId} was deleted`);
          const error: any = new Error(`Recipient ${recipientId} not found. It may have been deleted.`);
          error.status = 404;
          error.recipientNotFound = true;
          throw error;
        }
        // Re-throw other errors
        throw updateRequestError;
      }
    } catch (error: any) {
      // If error already has recipientNotFound flag, just re-throw it
      if (error.recipientNotFound) {
        throw error;
      }
      log(`Error updating recipient ${recipientId}: ${error.message}`, "mercury");
      log(`Error stack: ${error.stack}`, "mercury");
      throw error;
    }
  },

  /**
   * Upload an attachment to a recipient (e.g. W-9). Document is sent to Mercury only; we do not store it.
   * @returns Attachment metadata from Mercury (id, fileName, etc.)
   */
  async uploadRecipientAttachment(
    recipientId: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<{ id: string; fileName?: string; [k: string]: unknown }> {
    try {
      console.log(`[Mercury] Uploading W-9 attachment to recipient ${recipientId} (${fileName}, ${fileBuffer.length} bytes, ${mimeType})`);
      const blob = new Blob([fileBuffer], { type: mimeType });
      const form = new FormData();
      form.append("file", blob, fileName);
      form.append("taxFormType", "w9");
      // Mercury API uses singular "recipient" for update/attachments: POST /recipient/{id}/attachments (see docs.mercury.com/reference/updaterecipient)
      const result = await mercuryMultipartRequest<{ id: string; fileName?: string; [k: string]: unknown }>(
        `/recipient/${recipientId}/attachments`,
        form,
        { method: "POST" }
      );
      console.log(`[Mercury] ✅ W-9 attachment uploaded for recipient ${recipientId}:`, (result as any)?.id ?? result);
      log(`Uploaded recipient attachment for ${recipientId}: ${(result as any)?.id ?? "ok"}`, "mercury");
      return result;
    } catch (error: any) {
      console.error(`[Mercury] ❌ W-9 attachment upload failed for recipient ${recipientId}:`, error?.message ?? error);
      log(`Error uploading recipient attachment for ${recipientId}: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Send payment to recipient (ACH credit - paying workers or vendors).
   * Tries Create a transaction first (immediate processing); falls back to request-send-money (requires approval in Mercury).
   * See: https://docs.mercury.com/reference/createtransaction and https://docs.mercury.com/reference/requestsendmoney
   */
  async sendPayment(params: CreatePaymentParams): Promise<MercuryPayment> {
    // === OFAC pre-payout sanctions screening ===
    // Fail closed: throws OfacBlockedError if not cleared. Admin can override
    // a "review" status via /api/admin/payout-screening/clear after manual
    // review of the false-positive match.
    try {
      const { ensureClearedForPayout } = await import("./payoutScreening");
      let workerProfileId = params.workerProfileId;
      // Resolve from mercury_recipient_id column when caller didn't pass it.
      if (!workerProfileId) {
        try {
          const { db } = await import("../db");
          const { profiles } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const [match] = await db.select({ id: profiles.id })
            .from(profiles).where(eq(profiles.mercuryRecipientId, params.recipientId)).limit(1);
          if (match) workerProfileId = match.id;
        } catch (lookupErr) {
          console.warn("[Mercury/sendPayment] profile lookup for OFAC screen failed:", lookupErr);
        }
      }
      if (workerProfileId) {
        await ensureClearedForPayout(
          { workerProfileId },
          { bypass: params.bypassOfacScreening, actor: params.actor },
        );
      } else {
        // No profile id — fall back to fetching the recipient name from Mercury.
        try {
          const recipient = await this.getRecipient(params.recipientId);
          await ensureClearedForPayout(
            { rawName: recipient?.name },
            { bypass: params.bypassOfacScreening, actor: params.actor },
          );
        } catch (recipErr) {
          if ((recipErr as any)?.name === "OfacBlockedError") throw recipErr;
          console.warn("[Mercury/sendPayment] recipient lookup for OFAC fallback failed:", recipErr);
          // If we genuinely can't determine a name and screening wasn't bypassed,
          // refuse rather than disburse.
          if (!params.bypassOfacScreening) {
            throw new Error(`OFAC screening required but recipient name could not be resolved (${params.recipientId})`);
          }
        }
      }
    } catch (screenErr: any) {
      if (screenErr?.name === "OfacBlockedError") {
        log(`[Mercury] Payment BLOCKED by OFAC screening: ${screenErr.message}`, "mercury");
        throw screenErr;
      }
      // Other unexpected errors during screening setup — fail closed.
      log(`[Mercury] OFAC screening errored, blocking payment: ${screenErr?.message || screenErr}`, "mercury");
      throw screenErr;
    }

    try {
      let accountId = process.env.MERCURY_ACCOUNT_ID || process.env.Mercury_Account_Id || cachedDefaultAccountId;
      if (!accountId) {
        const accounts = await this.getAccounts();
        if (!accounts.length) throw new Error("No Mercury accounts found. Configure MERCURY_ACCOUNT_ID in .env or ensure your Mercury org has at least one account.");
        accountId = accounts[0].id;
        cachedDefaultAccountId = accountId;
        if (process.env.NODE_ENV !== "production") {
          console.log(`[Mercury] Using first account ${accountId} (set MERCURY_ACCOUNT_ID to override)`);
        }
      }

      const idempotencyKey = params.idempotencyKey || `payment-${params.recipientId}-${params.amount}-${Date.now()}`;
      const amountInDollars = params.amount / 100;
      const payload: any = {
        recipientId: params.recipientId,
        amount: amountInDollars,
        paymentMethod: 'ach',
        idempotencyKey,
      };
      const memo = params.description || params.note;
      if (memo) payload.memo = memo;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      };

      let raw: any;
      try {
        raw = await mercuryRequest<any>(`/account/${accountId}/transactions`, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers,
        });
        log(`[Mercury] Create transaction succeeded (immediate processing)`, "mercury");
      } catch (txErr: any) {
        const status = txErr?.status ?? txErr?.statusCode;
        const msg = (txErr?.message ?? "").toLowerCase();
        if (status === 403 || status === 401 || msg.includes("whitelist") || msg.includes("scope") || msg.includes("permission")) {
          log(`[Mercury] Create transaction not allowed, using request-send-money (requires approval in Mercury dashboard)`, "mercury");
          raw = await mercuryRequest<any>(`/account/${accountId}/request-send-money`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers,
          });
        } else {
          throw txErr;
        }
      }

      const paymentId = raw.requestId || raw.id || raw.transactionId;
      const status = raw.status === "approved" ? "completed" : raw.status === "pendingApproval" ? "processing" : (raw.status || "processing");
      log(`Sent payment: ${paymentId} ($${(params.amount / 100).toFixed(2)} to recipient ${params.recipientId})`, "mercury");
      return { id: paymentId, requestId: raw.requestId, status, ...raw } as MercuryPayment;
    } catch (error: any) {
      log(`Error sending payment: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Get payment status by ID
   */
  async getPayment(paymentId: string): Promise<MercuryPayment> {
    try {
      // Note: Mercury's exact endpoint for getting a specific payment may vary
      // This is a common pattern - adjust based on actual API docs
      const payment = await mercuryRequest<MercuryPayment>(`/payments/${paymentId}`);
      return payment;
    } catch (error: any) {
      log(`Error getting payment ${paymentId}: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * List account transactions
   */
  async listTransactions(params?: {
    accountId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<MercuryTransaction[]> {
    try {
      const queryParams = new URLSearchParams();
      
      if (params?.startDate) queryParams.set('start', params.startDate);
      if (params?.endDate) queryParams.set('end', params.endDate);
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.offset) queryParams.set('offset', params.offset.toString());

      const endpoint = params?.accountId 
        ? `/account/${params.accountId}/transactions${queryParams.toString() ? '?' + queryParams.toString() : ''}`
        : `/transactions${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

      const response = await mercuryRequest<{ transactions: MercuryTransaction[] }>(endpoint);
      log(`Retrieved ${response.transactions.length} transactions`, "mercury");
      return response.transactions;
    } catch (error: any) {
      log(`Error listing transactions: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Get transaction by ID (https://docs.mercury.com/reference/gettransactionbyid)
   */
  async getTransaction(transactionId: string): Promise<MercuryTransaction> {
    try {
      const transaction = await mercuryRequest<MercuryTransaction>(`/transaction/${transactionId}`);
      return transaction;
    } catch (error: any) {
      log(`Error getting transaction ${transactionId}: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Request ACH debit (pull money from company account)
   * Note: This requires the company to have authorized ACH debits via Plaid Link or manual verification
   * Mercury uses the "request to send money" flow for debits
   */
  async requestDebit(params: CreateDebitParams): Promise<any> {
    try {
      // Mercury's ACH debit flow is different from Modern Treasury
      // Companies need to authorize debits first via Plaid or manual verification
      // This endpoint creates a "pull" request that the company can approve
      
      const amountInDollars = params.amount / 100;
      const payload = {
        amount: amountInDollars,
        description: params.description || 'Account top-up',
        counterpartyName: params.counterpartyName,
      };

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
      }

      // Note: Mercury's exact debit endpoint may vary
      // This is a placeholder - adjust based on actual API documentation
      const debit = await mercuryRequest<any>('/account/requestDebit', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers,
      });

      log(`Requested debit: ${debit.id} ($${(params.amount / 100).toFixed(2)} from ${params.counterpartyName})`, "mercury");
      return debit;
    } catch (error: any) {
      log(`Error requesting debit: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Create internal transfer between Mercury accounts (if multiple accounts)
   */
  async createInternalTransfer(params: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    description?: string;
  }): Promise<any> {
    try {
      const amountInDollars = params.amount / 100;
      const payload = {
        fromAccountId: params.fromAccountId,
        toAccountId: params.toAccountId,
        amount: amountInDollars,
        note: params.description,
      };

      const transfer = await mercuryRequest<any>('/account/internalTransfer', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      log(`Created internal transfer: $${(params.amount / 100).toFixed(2)} from ${params.fromAccountId} to ${params.toAccountId}`, "mercury");
      return transfer;
    } catch (error: any) {
      log(`Error creating internal transfer: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Verify webhook signature (for webhook events)
   */
  async verifyWebhookSignature(payload: string, signature: string, secret: string): Promise<boolean> {
    try {
      const crypto = await import("crypto");
      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(payload);
      const expectedSignature = hmac.digest("hex");
      
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error: any) {
      log(`Error verifying webhook signature: ${error.message}`, "mercury");
      return false;
    }
  },

  // ===========================================
  // High-Level Business Operations
  // ===========================================

  /**
   * Process company ACH debit (top-up company balance)
   * Note: In Mercury, this may require prior authorization via Plaid
   */
  async processCompanyTopUp(params: {
    companyName: string;
    amountCents: number;
    description: string;
    metadata?: Record<string, string>;
  }): Promise<any> {
    try {
      const debit = await this.requestDebit({
        counterpartyName: params.companyName,
        amount: params.amountCents,
        description: params.description,
        idempotencyKey: `company-topup-${Date.now()}`,
      });

      log(`Processed company top-up: ${params.companyName} for $${(params.amountCents / 100).toFixed(2)}`, "mercury");
      return debit;
    } catch (error: any) {
      log(`Error processing company top-up: ${error.message}`, "mercury");
      throw error;
    }
  },

  /**
   * Process worker payout (send ACH payment to worker)
   */
  async processWorkerPayout(params: {
    workerRecipientId: string;
    workerName: string;
    payoutAmountCents: number;
    description: string;
    /** When known, skips a DB lookup inside OFAC screening. */
    workerProfileId?: number;
    metadata?: Record<string, string>;
  }): Promise<MercuryPayment> {
    try {
      const payment = await this.sendPayment({
        recipientId: params.workerRecipientId,
        amount: params.payoutAmountCents,
        workerProfileId: params.workerProfileId,
        description: params.description,
        idempotencyKey: `worker-payout-${params.workerRecipientId}-${Date.now()}`,
      });

      log(`Processed worker payout: ${params.workerName} for $${(params.payoutAmountCents / 100).toFixed(2)}`, "mercury");
      return payment;
    } catch (error: any) {
      log(`Error processing worker payout: ${error.message}`, "mercury");
      throw error;
    }
  },
};

export default mercuryService;
