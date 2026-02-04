/**
 * @deprecated ARCHIVED Jan 2026 - Unit payment processing replaced by Mercury + Stripe.
 * This file is no longer imported by any routes. Kept for reference only.
 * See ARCHIVED_UNIT_INTEGRATION.md
 */
import { log } from "../index";

const UNIT_API_URL = process.env.UNIT_API_URL || "https://api.s.unit.sh";
const UNIT_API_TOKEN = process.env.UNIT_API_TOKEN;

interface UnitApiOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  endpoint: string;
  body?: Record<string, any>;
}

async function unitRequest<T = any>(options: UnitApiOptions): Promise<T> {
  const { method, endpoint, body } = options;

  if (!UNIT_API_TOKEN) {
    throw new Error("UNIT_API_TOKEN is not configured");
  }

  const url = `${UNIT_API_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${UNIT_API_TOKEN}`,
    "Content-Type": "application/vnd.api+json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    log(`Unit API error: ${JSON.stringify(data)}`, "unit");
    throw new Error(data.errors?.[0]?.detail || "Unit API request failed");
  }

  return data;
}

export interface UnitAddress {
  street: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface UnitPhone {
  countryCode: string;
  number: string;
}

export interface UnitFullName {
  first: string;
  last: string;
}

export interface CreateBusinessCustomerParams {
  name: string;
  address: UnitAddress;
  phone: UnitPhone;
  stateOfIncorporation: string;
  ein: string;
  entityType: string;
  contact: {
    fullName: UnitFullName;
    email: string;
    phone: UnitPhone;
  };
  tags?: Record<string, string>;
}

export interface CreateIndividualCustomerParams {
  fullName: UnitFullName;
  email: string;
  phone: UnitPhone;
  address: UnitAddress;
  dateOfBirth: string;
  ssn: string;
  tags?: Record<string, string>;
}

export interface CreateDepositAccountParams {
  customerId: string;
  depositProduct?: string;
  tags?: Record<string, string>;
}

export interface CreateCounterpartyParams {
  customerId: string;
  name: string;
  routingNumber: string;
  accountNumber: string;
  accountType: "Checking" | "Savings";
  type: "Business" | "Person";
  tags?: Record<string, string>;
}

export interface CreateACHPaymentParams {
  accountId: string;
  counterpartyId?: string;
  amount: number;
  direction: "Credit" | "Debit";
  description: string;
  addenda?: string;
  tags?: Record<string, string>;
  counterparty?: {
    routingNumber: string;
    accountNumber: string;
    accountType: "Checking" | "Savings";
    name: string;
  };
}

export interface CreateBookPaymentParams {
  accountId: string;
  counterpartyAccountId: string;
  amount: number;
  description: string;
  tags?: Record<string, string>;
}

export const unitService = {
  async createBusinessWalletCustomer(params: {
    bankName: string;
    businessName: string;
    address: UnitAddress;
    ein: string;
    businessVertical: string;
    numberOfEmployees: string;
    tags?: Record<string, string>;
  }) {
    return unitRequest({
      method: "POST",
      endpoint: "/customers",
      body: {
        data: {
          type: "businessWalletCustomer",
          attributes: {
            bankName: params.bankName,
            businessName: params.businessName,
            address: params.address,
            ein: params.ein,
            businessVertical: params.businessVertical,
            numberOfEmployees: params.numberOfEmployees,
            tags: params.tags,
          },
        },
      },
    });
  },

  async getCustomer(customerId: string) {
    return unitRequest({
      method: "GET",
      endpoint: `/customers/${customerId}`,
    });
  },

  async listCustomers(params?: { limit?: number; offset?: number; email?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append("page[limit]", params.limit.toString());
    if (params?.offset) queryParams.append("page[offset]", params.offset.toString());
    if (params?.email) queryParams.append("filter[email]", params.email);

    const queryString = queryParams.toString();
    return unitRequest({
      method: "GET",
      endpoint: `/customers${queryString ? `?${queryString}` : ""}`,
    });
  },

  async createDepositAccount(params: CreateDepositAccountParams) {
    return unitRequest({
      method: "POST",
      endpoint: "/accounts",
      body: {
        data: {
          type: "depositAccount",
          attributes: {
            depositProduct: params.depositProduct || "checking",
            tags: params.tags,
          },
          relationships: {
            customer: {
              data: {
                type: "customer",
                id: params.customerId,
              },
            },
          },
        },
      },
    });
  },

  async getAccount(accountId: string) {
    return unitRequest({
      method: "GET",
      endpoint: `/accounts/${accountId}`,
    });
  },

  async listAccounts(params?: { customerId?: string; limit?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.customerId) queryParams.append("filter[customerId]", params.customerId);
    if (params?.limit) queryParams.append("page[limit]", params.limit.toString());

    const queryString = queryParams.toString();
    return unitRequest({
      method: "GET",
      endpoint: `/accounts${queryString ? `?${queryString}` : ""}`,
    });
  },

  async createCounterparty(params: CreateCounterpartyParams) {
    return unitRequest({
      method: "POST",
      endpoint: "/counterparties",
      body: {
        data: {
          type: "achCounterparty",
          attributes: {
            name: params.name,
            routingNumber: params.routingNumber,
            accountNumber: params.accountNumber,
            accountType: params.accountType,
            type: params.type,
            tags: params.tags,
          },
          relationships: {
            customer: {
              data: {
                type: "customer",
                id: params.customerId,
              },
            },
          },
        },
      },
    });
  },

  async getCounterparty(counterpartyId: string) {
    return unitRequest({
      method: "GET",
      endpoint: `/counterparties/${counterpartyId}`,
    });
  },

  async listCounterparties(params?: { customerId?: string; limit?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.customerId) queryParams.append("filter[customerId]", params.customerId);
    if (params?.limit) queryParams.append("page[limit]", params.limit.toString());

    const queryString = queryParams.toString();
    return unitRequest({
      method: "GET",
      endpoint: `/counterparties${queryString ? `?${queryString}` : ""}`,
    });
  },

  async createACHPayment(params: CreateACHPaymentParams) {
    const relationships: Record<string, any> = {
      account: {
        data: {
          type: "account",
          id: params.accountId,
        },
      },
    };

    if (params.counterpartyId) {
      relationships.counterparty = {
        data: {
          type: "counterparty",
          id: params.counterpartyId,
        },
      };
    }

    const attributes: Record<string, any> = {
      amount: params.amount,
      direction: params.direction,
      description: params.description,
      tags: params.tags,
    };

    if (params.addenda) {
      attributes.addenda = params.addenda;
    }

    if (params.counterparty && !params.counterpartyId) {
      attributes.counterparty = params.counterparty;
    }

    return unitRequest({
      method: "POST",
      endpoint: "/payments",
      body: {
        data: {
          type: "achPayment",
          attributes,
          relationships,
        },
      },
    });
  },

  async createBookPayment(params: CreateBookPaymentParams) {
    return unitRequest({
      method: "POST",
      endpoint: "/payments",
      body: {
        data: {
          type: "bookPayment",
          attributes: {
            amount: params.amount,
            description: params.description,
            tags: params.tags,
          },
          relationships: {
            account: {
              data: {
                type: "depositAccount",
                id: params.accountId,
              },
            },
            counterpartyAccount: {
              data: {
                type: "depositAccount",
                id: params.counterpartyAccountId,
              },
            },
          },
        },
      },
    });
  },

  async getPayment(paymentId: string) {
    return unitRequest({
      method: "GET",
      endpoint: `/payments/${paymentId}`,
    });
  },

  async listPayments(params?: {
    accountId?: string;
    customerId?: string;
    status?: string[];
    limit?: number;
    since?: string;
    until?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.accountId) queryParams.append("filter[accountId]", params.accountId);
    if (params?.customerId) queryParams.append("filter[customerId]", params.customerId);
    if (params?.limit) queryParams.append("page[limit]", params.limit.toString());
    if (params?.since) queryParams.append("filter[since]", params.since);
    if (params?.until) queryParams.append("filter[until]", params.until);
    if (params?.status) {
      params.status.forEach((s, i) => queryParams.append(`filter[status][${i}]`, s));
    }

    const queryString = queryParams.toString();
    return unitRequest({
      method: "GET",
      endpoint: `/payments${queryString ? `?${queryString}` : ""}`,
    });
  },

  async cancelPayment(paymentId: string) {
    return unitRequest({
      method: "POST",
      endpoint: `/payments/${paymentId}/cancel`,
      body: {},
    });
  },

  async listTransactions(params?: {
    accountId?: string;
    customerId?: string;
    limit?: number;
    since?: string;
    until?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.accountId) queryParams.append("filter[accountId]", params.accountId);
    if (params?.customerId) queryParams.append("filter[customerId]", params.customerId);
    if (params?.limit) queryParams.append("page[limit]", params.limit.toString());
    if (params?.since) queryParams.append("filter[since]", params.since);
    if (params?.until) queryParams.append("filter[until]", params.until);

    const queryString = queryParams.toString();
    return unitRequest({
      method: "GET",
      endpoint: `/transactions${queryString ? `?${queryString}` : ""}`,
    });
  },

  async getAccountBalance(accountId: string): Promise<{ available: number; balance: number; hold: number }> {
    const account = await this.getAccount(accountId);
    return {
      available: account.data.attributes.available,
      balance: account.data.attributes.balance,
      hold: account.data.attributes.hold,
    };
  },

  async verifyApiConnection(): Promise<boolean> {
    try {
      const result = await unitRequest({
        method: "GET",
        endpoint: "/identity",
      });
      log(`Unit API connection verified: ${result.data?.attributes?.email || "connected"}`, "unit");
      return true;
    } catch (error) {
      log(`Unit API connection failed: ${error}`, "unit");
      return false;
    }
  },
};

export default unitService;
