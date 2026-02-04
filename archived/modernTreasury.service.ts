import ModernTreasury from 'modern-treasury';
import { log } from "../index";

// Platform account ID - this is where all company top-ups go and worker payouts come from
// This can be configured via environment variable, or we'll query MT for available internal accounts
// Sandbox counterparty reference: 5f4c591b-f930-445f-a9ee-3dfb661f27d0
export const PLATFORM_INTERNAL_ACCOUNT_ID = process.env.MT_PLATFORM_INTERNAL_ACCOUNT_ID || null;

// Cache for the platform internal account ID (discovered from MT)
let cachedPlatformAccountId: string | null = null;

// Get the platform internal account ID, discovering from MT if needed
export async function getPlatformInternalAccountId(): Promise<string> {
  // First, check if configured via environment variable
  if (PLATFORM_INTERNAL_ACCOUNT_ID) {
    return PLATFORM_INTERNAL_ACCOUNT_ID;
  }
  
  // Use cached value if available
  if (cachedPlatformAccountId) {
    return cachedPlatformAccountId;
  }
  
  // Query MT for internal accounts
  try {
    const client = getClient();
    const internalAccounts = await client.internalAccounts.list();
    const accountsArray: any[] = [];
    for await (const account of internalAccounts) {
      accountsArray.push(account);
    }
    
    if (accountsArray.length === 0) {
      throw new Error("No internal accounts found in Modern Treasury. Please configure MT_PLATFORM_INTERNAL_ACCOUNT_ID.");
    }
    
    // Prefer an account that supports ACH
    let platformAccount = accountsArray.find((acc: any) => 
      acc.payment_type === 'ach' || 
      (acc.connection && acc.connection.supported_payment_types?.includes('ach'))
    );
    
    // Fallback to first account
    if (!platformAccount) {
      platformAccount = accountsArray[0];
    }
    
    cachedPlatformAccountId = platformAccount.id;
    log(`Discovered platform internal account: ${cachedPlatformAccountId}`, "modern-treasury");
    return cachedPlatformAccountId;
  } catch (error: any) {
    log(`Error discovering platform internal account: ${error.message}`, "modern-treasury");
    throw new Error(`Cannot determine platform internal account: ${error.message}`);
  }
}

// Get API credentials from environment
// In development, use sandbox keys; in production, use live keys
function getApiCredentials(): { apiKey: string; orgId: string; isSandbox: boolean } {
  const isDev = process.env.NODE_ENV === "development";
  
  // In development, prefer sandbox keys if available
  let apiKey: string | undefined;
  let orgId: string | undefined;
  let isSandbox = false;
  
  if (isDev && process.env.MODERN_TREASURY_SANDBOX_API_KEY && process.env.MODERN_TREASURY_SANDBOX_ORG_ID) {
    apiKey = process.env.MODERN_TREASURY_SANDBOX_API_KEY;
    orgId = process.env.MODERN_TREASURY_SANDBOX_ORG_ID;
    isSandbox = true;
    log("Using Modern Treasury SANDBOX keys (development mode)", "modern-treasury");
  } else {
    apiKey = process.env.MODERN_TREASURY_API_KEY;
    orgId = process.env.MODERN_TREASURY_ORG_ID;
    const keyIsSandbox = apiKey?.startsWith("test-") || apiKey?.startsWith("test_") || apiKey?.startsWith("sandbox_");
    isSandbox = !!keyIsSandbox;
    log(`Using Modern Treasury ${isSandbox ? "SANDBOX" : "LIVE"} keys`, "modern-treasury");
  }
  
  if (!apiKey || !orgId) {
    throw new Error("Modern Treasury credentials not configured. Please set MODERN_TREASURY_API_KEY and MODERN_TREASURY_ORG_ID environment variables.");
  }
  
  return { apiKey, orgId, isSandbox };
}

let client: ModernTreasury | null = null;

function getClient(): ModernTreasury {
  if (!client) {
    const { apiKey, orgId } = getApiCredentials();
    client = new ModernTreasury({
      apiKey: apiKey,
      organizationID: orgId,
    });
  }
  return client;
}

export interface CreateCounterpartyParams {
  name: string;
  email?: string;
  metadata?: Record<string, string>;
  accounts?: {
    accountType?: "checking" | "savings";
    routingNumber: string;
    accountNumber: string;
  }[];
}

export interface CreateExternalAccountParams {
  counterpartyId: string;
  accountType: "checking" | "savings";
  routingNumber: string;
  accountNumber: string;
  name?: string;
}

export interface CreatePaymentOrderParams {
  type: "ach";
  amount: number;
  direction: "credit" | "debit";
  originatingAccountId: string;
  receivingAccountId?: string;
  counterpartyId?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export const modernTreasuryService = {
  isConfigured(): boolean {
    const hasSandbox = !!(process.env.MODERN_TREASURY_SANDBOX_API_KEY && process.env.MODERN_TREASURY_SANDBOX_ORG_ID);
    const hasLive = !!(process.env.MODERN_TREASURY_API_KEY && process.env.MODERN_TREASURY_ORG_ID);
    return hasSandbox || hasLive;
  },

  async createCounterparty(params: CreateCounterpartyParams) {
    try {
      const client = getClient();
      const counterparty = await client.counterparties.create({
        name: params.name,
        email: params.email,
        metadata: params.metadata,
        accounts: params.accounts?.map(acc => ({
          account_type: acc.accountType,
          routing_details: [{
            routing_number: acc.routingNumber,
            routing_number_type: "aba" as const,
          }],
          account_details: [{
            account_number: acc.accountNumber,
            account_number_type: "other" as const,
          }],
        })),
      });
      log(`Created counterparty: ${counterparty.id}`, "modern-treasury");
      return counterparty;
    } catch (error: any) {
      log(`Error creating counterparty: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getCounterparty(counterpartyId: string) {
    try {
      const client = getClient();
      return await client.counterparties.retrieve(counterpartyId);
    } catch (error: any) {
      log(`Error getting counterparty: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async listCounterparties(metadata?: Record<string, string>) {
    try {
      const client = getClient();
      const counterparties = await client.counterparties.list({ metadata });
      return counterparties;
    } catch (error: any) {
      log(`Error listing counterparties: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async createExternalAccount(params: CreateExternalAccountParams) {
    try {
      const client = getClient();
      const externalAccount = await client.externalAccounts.create({
        counterparty_id: params.counterpartyId,
        account_type: params.accountType,
        routing_details: [{
          routing_number: params.routingNumber,
          routing_number_type: "aba",
        }],
        account_details: [{
          account_number: params.accountNumber,
        }],
        name: params.name,
      });
      log(`Created external account: ${externalAccount.id}`, "modern-treasury");
      return externalAccount;
    } catch (error: any) {
      log(`Error creating external account: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getInternalAccounts() {
    try {
      const client = getClient();
      const accounts = await client.internalAccounts.list();
      return accounts;
    } catch (error: any) {
      log(`Error listing internal accounts: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async createPaymentOrder(params: CreatePaymentOrderParams) {
    try {
      const client = getClient();
      
      const paymentOrderParams: any = {
        type: params.type,
        amount: params.amount,
        direction: params.direction,
        originating_account_id: params.originatingAccountId,
        description: params.description,
        metadata: params.metadata,
      };

      if (params.receivingAccountId) {
        paymentOrderParams.receiving_account_id = params.receivingAccountId;
      }
      if (params.counterpartyId) {
        paymentOrderParams.counterparty_id = params.counterpartyId;
      }

      const paymentOrder = await client.paymentOrders.create(paymentOrderParams);
      log(`Created payment order: ${paymentOrder.id}`, "modern-treasury");
      return paymentOrder;
    } catch (error: any) {
      log(`Error creating payment order: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getPaymentOrder(paymentOrderId: string) {
    try {
      const client = getClient();
      return await client.paymentOrders.retrieve(paymentOrderId);
    } catch (error: any) {
      log(`Error getting payment order: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async listPaymentOrders(metadata?: Record<string, string>) {
    try {
      const client = getClient();
      return await client.paymentOrders.list({ metadata });
    } catch (error: any) {
      log(`Error listing payment orders: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async createACHDebit(params: {
    originatingAccountId: string;
    counterpartyId: string;
    receivingAccountId?: string;
    amount: number;
    description: string;
    metadata?: Record<string, string>;
  }) {
    // For ACH debits (pulling money FROM counterparty TO platform):
    // - originating_account_id = platform internal account (where money goes)
    // - counterparty_id = the counterparty to debit (required)
    // - receiving_account_id = optional, specific external account to debit from
    //   (if not provided, MT uses counterparty's default account)
    return this.createPaymentOrder({
      type: "ach",
      amount: params.amount,
      direction: "debit",
      originatingAccountId: params.originatingAccountId,
      counterpartyId: params.counterpartyId,
      // Only include receiving_account_id if specifically needed
      // For counterparty debits, MT can infer from counterparty_id
      receivingAccountId: params.receivingAccountId,
      description: params.description,
      metadata: params.metadata,
    });
  },

  async createACHCredit(params: {
    originatingAccountId: string;
    counterpartyId: string;
    receivingAccountId: string;
    amount: number;
    description: string;
    metadata?: Record<string, string>;
  }) {
    return this.createPaymentOrder({
      type: "ach",
      amount: params.amount,
      direction: "credit",
      originatingAccountId: params.originatingAccountId,
      counterpartyId: params.counterpartyId,
      receivingAccountId: params.receivingAccountId,
      description: params.description,
      metadata: params.metadata,
    });
  },

  async verifyWebhookSignature(payload: string, signature: string, webhookKey: string): Promise<boolean> {
    const crypto = await import("crypto");
    const hmac = crypto.createHmac("sha256", webhookKey);
    hmac.update(payload);
    const expectedSignature = hmac.digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  },

  // ==========================================
  // Virtual Accounts - For company prepaid balances
  // ==========================================

  async createVirtualAccount(params: {
    internalAccountId: string;
    name: string;
    metadata?: Record<string, string>;
  }) {
    try {
      const client = getClient();
      const virtualAccount = await client.virtualAccounts.create({
        internal_account_id: params.internalAccountId,
        name: params.name,
        metadata: params.metadata,
      });
      log(`Created virtual account: ${virtualAccount.id}`, "modern-treasury");
      return virtualAccount;
    } catch (error: any) {
      log(`Error creating virtual account: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getVirtualAccount(virtualAccountId: string) {
    try {
      const client = getClient();
      return await client.virtualAccounts.retrieve(virtualAccountId);
    } catch (error: any) {
      log(`Error getting virtual account: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async listVirtualAccounts(metadata?: Record<string, string>) {
    try {
      const client = getClient();
      return await client.virtualAccounts.list({ metadata });
    } catch (error: any) {
      log(`Error listing virtual accounts: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  // ==========================================
  // Ledger Accounts - For balance tracking
  // ==========================================

  async createLedgerAccount(params: {
    ledgerId: string;
    name: string;
    normalBalance: "credit" | "debit";
    currency: string;
    metadata?: Record<string, string>;
  }) {
    try {
      const client = getClient();
      const ledgerAccount = await client.ledgerAccounts.create({
        ledger_id: params.ledgerId,
        name: params.name,
        normal_balance: params.normalBalance,
        currency: params.currency,
        metadata: params.metadata,
      });
      log(`Created ledger account: ${ledgerAccount.id}`, "modern-treasury");
      return ledgerAccount;
    } catch (error: any) {
      log(`Error creating ledger account: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getLedgerAccount(ledgerAccountId: string) {
    try {
      const client = getClient();
      return await client.ledgerAccounts.retrieve(ledgerAccountId);
    } catch (error: any) {
      log(`Error getting ledger account: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async listLedgerAccounts(ledgerId: string) {
    try {
      const client = getClient();
      return await client.ledgerAccounts.list({ ledger_id: ledgerId });
    } catch (error: any) {
      log(`Error listing ledger accounts: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  // ==========================================
  // Ledgers - Container for ledger accounts
  // ==========================================

  async createLedger(params: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }) {
    try {
      const client = getClient();
      const ledger = await client.ledgers.create({
        name: params.name,
        description: params.description,
        metadata: params.metadata,
      });
      log(`Created ledger: ${ledger.id}`, "modern-treasury");
      return ledger;
    } catch (error: any) {
      log(`Error creating ledger: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getLedger(ledgerId: string) {
    try {
      const client = getClient();
      return await client.ledgers.retrieve(ledgerId);
    } catch (error: any) {
      log(`Error getting ledger: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async listLedgers() {
    try {
      const client = getClient();
      return await client.ledgers.list();
    } catch (error: any) {
      log(`Error listing ledgers: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  // ==========================================
  // Ledger Transactions - For balance operations
  // ==========================================

  async createLedgerTransaction(params: {
    description?: string;
    effectiveDate?: string;
    ledgerEntries: {
      ledgerAccountId: string;
      amount: number;
      direction: "credit" | "debit";
    }[];
    metadata?: Record<string, string>;
  }) {
    try {
      const client = getClient();
      const ledgerTransaction = await client.ledgerTransactions.create({
        description: params.description,
        effective_date: params.effectiveDate || new Date().toISOString().split('T')[0],
        ledger_entries: params.ledgerEntries.map(entry => ({
          ledger_account_id: entry.ledgerAccountId,
          amount: entry.amount,
          direction: entry.direction,
        })),
        metadata: params.metadata,
      });
      log(`Created ledger transaction: ${ledgerTransaction.id}`, "modern-treasury");
      return ledgerTransaction;
    } catch (error: any) {
      log(`Error creating ledger transaction: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  async getLedgerTransaction(ledgerTransactionId: string) {
    try {
      const client = getClient();
      return await client.ledgerTransactions.retrieve(ledgerTransactionId);
    } catch (error: any) {
      log(`Error getting ledger transaction: ${error.message}`, "modern-treasury");
      throw error;
    }
  },

  // ==========================================
  // High-Level Business Operations
  // ==========================================

  async fundCompanyBalance(params: {
    companyCounterpartyId: string;
    companyExternalAccountId: string;
    platformInternalAccountId: string;
    companyLedgerAccountId: string;
    platformClearingLedgerAccountId: string;
    amountCents: number;
    description: string;
    metadata?: Record<string, string>;
  }) {
    // Step 1: Create ACH debit to pull money from company
    const paymentOrder = await this.createPaymentOrder({
      type: "ach",
      amount: params.amountCents,
      direction: "debit",
      originatingAccountId: params.platformInternalAccountId,
      counterpartyId: params.companyCounterpartyId,
      receivingAccountId: params.companyExternalAccountId,
      description: params.description,
      metadata: { ...params.metadata, type: "company_funding" },
    });

    // Step 2: Create ledger entry to credit company's virtual balance
    const ledgerTransaction = await this.createLedgerTransaction({
      description: params.description,
      ledgerEntries: [
        { ledgerAccountId: params.platformClearingLedgerAccountId, amount: params.amountCents, direction: "debit" },
        { ledgerAccountId: params.companyLedgerAccountId, amount: params.amountCents, direction: "credit" },
      ],
      metadata: { ...params.metadata, paymentOrderId: paymentOrder.id },
    });

    log(`Funded company balance: payment=${paymentOrder.id}, ledger=${ledgerTransaction.id}`, "modern-treasury");
    return { paymentOrder, ledgerTransaction };
  },

  async processWorkerPayout(params: {
    workerCounterpartyId: string;
    workerExternalAccountId: string;
    platformInternalAccountId: string;
    companyLedgerAccountId: string;
    platformRevenueLedgerAccountId: string;
    workerPayableLedgerAccountId: string;
    workerPayAmountCents: number;
    platformFeeAmountCents: number;
    description: string;
    metadata?: Record<string, string>;
  }) {
    const totalDeductionCents = params.workerPayAmountCents + params.platformFeeAmountCents;

    // Step 1: Create ledger entries for fee split and worker pay
    const ledgerTransaction = await this.createLedgerTransaction({
      description: params.description,
      ledgerEntries: [
        // Debit company balance for total (worker pay + platform fee)
        { ledgerAccountId: params.companyLedgerAccountId, amount: totalDeductionCents, direction: "debit" },
        // Credit platform revenue for fee
        { ledgerAccountId: params.platformRevenueLedgerAccountId, amount: params.platformFeeAmountCents, direction: "credit" },
        // Credit worker payable for their pay
        { ledgerAccountId: params.workerPayableLedgerAccountId, amount: params.workerPayAmountCents, direction: "credit" },
      ],
      metadata: params.metadata,
    });

    // Step 2: Create ACH credit to pay worker
    const paymentOrder = await this.createPaymentOrder({
      type: "ach",
      amount: params.workerPayAmountCents,
      direction: "credit",
      originatingAccountId: params.platformInternalAccountId,
      counterpartyId: params.workerCounterpartyId,
      receivingAccountId: params.workerExternalAccountId,
      description: params.description,
      metadata: { ...params.metadata, type: "worker_payout", ledgerTransactionId: ledgerTransaction.id },
    });

    log(`Processed worker payout: payment=${paymentOrder.id}, ledger=${ledgerTransaction.id}`, "modern-treasury");
    return { paymentOrder, ledgerTransaction };
  },

  async handleInsufficientBalance(params: {
    companyCounterpartyId: string;
    companyExternalAccountId: string;
    platformInternalAccountId: string;
    companyLedgerAccountId: string;
    shortfallAmountCents: number;
    description: string;
    metadata?: Record<string, string>;
  }) {
    // Pull shortfall directly from company bank
    const paymentOrder = await this.createPaymentOrder({
      type: "ach",
      amount: params.shortfallAmountCents,
      direction: "debit",
      originatingAccountId: params.platformInternalAccountId,
      counterpartyId: params.companyCounterpartyId,
      receivingAccountId: params.companyExternalAccountId,
      description: `Shortfall: ${params.description}`,
      metadata: { ...params.metadata, type: "shortfall_debit" },
    });

    log(`Handled insufficient balance shortfall: ${paymentOrder.id}`, "modern-treasury");
    return paymentOrder;
  },
};

export default modernTreasuryService;
