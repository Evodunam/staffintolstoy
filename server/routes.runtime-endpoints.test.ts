import express from "express";
import { createServer, type Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const storageCore: Record<string, any> = {
    getJob: vi.fn(),
    getProfile: vi.fn(),
    getDirectJobInquiriesForCompany: vi.fn(),
    createDirectJobInquiry: vi.fn(),
    updateDirectJobInquiry: vi.fn(),
    getJobApplications: vi.fn(),
    getJobMessages: vi.fn(),
    getCompanyTeamMemberByUserId: vi.fn(),
    getCompanyLocation: vi.fn(),
  };
  const storage = new Proxy(storageCore, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = vi.fn();
      }
      return target[prop];
    },
  });

  const dbSelectWhere = vi.fn(async () => []);
  const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
  const dbSelect = vi.fn(() => ({ from: dbSelectFrom }));
  const dbInsertValues = vi.fn(async () => []);
  const dbInsert = vi.fn(() => ({ values: dbInsertValues }));
  const db = {
    select: dbSelect,
    insert: dbInsert,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
  };

  const sendEmail = vi.fn(async () => undefined);

  let currentProfile: any = null;
  let currentUser: any = null;

  return {
    storage,
    storageCore,
    db,
    dbSelect,
    dbSelectFrom,
    dbSelectWhere,
    dbInsert,
    dbInsertValues,
    sendEmail,
    getCurrentProfile: () => currentProfile,
    setCurrentProfile: (profile: any) => {
      currentProfile = profile;
    },
    getCurrentUser: () => currentUser,
    setCurrentUser: (user: any) => {
      currentUser = user;
    },
  };
});

vi.mock("./storage", () => ({
  storage: testState.storage,
}));

vi.mock("./db", () => ({
  db: testState.db,
}));

vi.mock("./email-service", () => ({
  sendEmail: testState.sendEmail,
  ALL_EMAIL_TYPES: [],
  getSampleDataForType: () => ({}),
}));

vi.mock("./auth/session", () => ({
  getSession: () => (_req: any, _res: any, next: any) => next(),
  SESSION_TTL_SECONDS: 60,
}));

vi.mock("./auth/routes", () => ({
  registerAuthRoutes: () => undefined,
}));

vi.mock("./auth/storage", () => ({
  authStorage: {},
}));

vi.mock("./auth/middleware", () => ({
  attachProfile: (req: any, _res: any, next: any) => {
    req.profile = testState.getCurrentProfile();
    next();
  },
  clearProfileSnapshot: () => undefined,
}));

vi.mock("./auth/rls-context", () => ({
  attachRlsDbContext: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./websocket", () => ({
  setupWebSocket: () => undefined,
  notifyNewJob: () => undefined,
  notifyApplicationUpdate: () => undefined,
  notifyJobUpdate: () => undefined,
  notifyTimesheetUpdate: () => undefined,
  broadcastPresenceUpdate: () => undefined,
  notifyWorkerTeamPresence: () => undefined,
}));

vi.mock("./auto-replenishment-scheduler", () => ({
  triggerAutoReplenishmentForCompany: vi.fn(async () => undefined),
  afterHireFundingCheck: vi.fn(async () => undefined),
  clearPaymentHoldsForCompanyIfSolvent: vi.fn(async () => undefined),
}));

vi.mock("passport", () => ({
  default: {
    initialize:
      () =>
      (req: any, _res: any, next: any): void => {
        req.isAuthenticated = () => true;
        req.user = testState.getCurrentUser() ?? { id: "test-user-id" };
        next();
      },
    session: () => (_req: any, _res: any, next: any) => next(),
    serializeUser: (_fn: any) => undefined,
    deserializeUser: (_fn: any) => undefined,
  },
}));

describe("runtime endpoint guards", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const { registerRoutes } = await import("./routes");
    const app = express();
    app.use(express.json());
    server = createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind test server");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testState.setCurrentUser({ id: "company-user-id" });
    testState.setCurrentProfile({
      id: 1,
      role: "company",
      userId: null,
      firstName: "Comp",
      lastName: "Any",
      companyName: "ACME",
      email: "owner@example.com",
      emailNotifications: true,
    });
  });

  it("returns 400 for invalid workerId on /api/jobs/:id/request", async () => {
    const job = { id: 11, companyId: 1, title: "Test Job" };
    testState.storageCore.getJob.mockResolvedValue(job);

    const res = await fetch(`${baseUrl}/api/jobs/11/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: "not-a-number" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("workerId");
  });

  it("returns 409 when duplicate pending direct request exists", async () => {
    const nowPlus1Hour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    testState.storageCore.getJob.mockResolvedValue({ id: 11, companyId: 1, title: "Test Job" });
    testState.storageCore.getProfile.mockResolvedValue({ id: 7, role: "worker", email: "worker@example.com", emailNotifications: true });
    testState.storageCore.getDirectJobInquiriesForCompany.mockResolvedValue([
      {
        id: 555,
        workerId: 7,
        convertedJobId: 11,
        status: "pending",
        expiresAt: nowPlus1Hour,
      },
    ]);

    const res = await fetch(`${baseUrl}/api/jobs/11/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: 7 }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.inquiryId).toBe(555);
    expect(testState.storageCore.createDirectJobInquiry).not.toHaveBeenCalled();
  });

  it("returns 400 when call-invite room URL is unresolved relative path", async () => {
    testState.storageCore.getJob.mockResolvedValue({ id: 22, companyId: 1, title: "Call Job", companyLocationId: null });
    testState.storageCore.getJobApplications.mockResolvedValue([
      { id: 1, status: "accepted", workerId: 2, worker: { id: 2, email: "w1@example.com", emailNotifications: true } },
    ]);
    testState.storageCore.getJobMessages.mockResolvedValue([]);

    const priorPeerBase = process.env.PEERCALLS_BASE_URL;
    const priorFrontEnd = process.env.FRONTEND_URL;
    delete process.env.PEERCALLS_BASE_URL;
    delete process.env.FRONTEND_URL;

    try {
      const res = await fetch(`${baseUrl}/api/jobs/22/call-invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomUrl: "/job-22" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("roomUrl");
    } finally {
      if (priorPeerBase === undefined) delete process.env.PEERCALLS_BASE_URL;
      else process.env.PEERCALLS_BASE_URL = priorPeerBase;
      if (priorFrontEnd === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = priorFrontEnd;
    }
  });

  it("returns alreadyInProgress=true and still succeeds for active call", async () => {
    testState.storageCore.getJob.mockResolvedValue({ id: 23, companyId: 1, title: "Call Job", companyLocationId: null });
    testState.storageCore.getJobApplications.mockResolvedValue([
      {
        id: 1,
        status: "accepted",
        workerId: 2,
        worker: { id: 2, email: "worker@example.com", emailNotifications: true },
      },
    ]);
    testState.storageCore.getJobMessages.mockResolvedValue([
      {
        id: 999,
        createdAt: new Date().toISOString(),
        metadata: { type: "video_call", callStatus: "active" },
      },
    ]);
    process.env.PEERCALLS_BASE_URL = "https://calls.example";

    const res = await fetch(`${baseUrl}/api/jobs/23/call-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomUrl: "/job-23" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alreadyInProgress).toBe(true);
    expect(body.activeCallMessageId).toBe(999);
    expect(body.roomUrl).toBe("https://calls.example/job-23");
    expect(testState.sendEmail).toHaveBeenCalled();
  });
});

