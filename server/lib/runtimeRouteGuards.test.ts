import { describe, expect, it } from "vitest";
import {
  findExistingPendingInquiryForWorkerJob,
  getLatestActiveVideoCallMessage,
  parseWorkerId,
  resolveCallInviteUrl,
} from "./runtimeRouteGuards";

describe("parseWorkerId", () => {
  it("accepts positive integer number and integer-like string", () => {
    expect(parseWorkerId(42)).toBe(42);
    expect(parseWorkerId("42")).toBe(42);
  });

  it("rejects invalid values", () => {
    expect(parseWorkerId("")).toBeNull();
    expect(parseWorkerId("abc")).toBeNull();
    expect(parseWorkerId(0)).toBeNull();
    expect(parseWorkerId(-1)).toBeNull();
    expect(parseWorkerId(1.25)).toBeNull();
  });
});

describe("findExistingPendingInquiryForWorkerJob", () => {
  it("finds pending unexpired inquiry for same worker+job", () => {
    const now = Date.UTC(2026, 3, 17, 12, 0, 0);
    const inquiries = [
      { id: 1, workerId: 99, convertedJobId: 10, status: "pending", expiresAt: new Date(now + 60_000).toISOString() },
      { id: 2, workerId: 99, convertedJobId: 10, status: "declined", expiresAt: new Date(now + 60_000).toISOString() },
    ];
    const found = findExistingPendingInquiryForWorkerJob(inquiries, { workerId: 99, jobId: 10, nowMs: now });
    expect(found?.id).toBe(1);
  });

  it("ignores expired/non-matching inquiries", () => {
    const now = Date.UTC(2026, 3, 17, 12, 0, 0);
    const inquiries = [
      { id: 1, workerId: 99, convertedJobId: 10, status: "pending", expiresAt: new Date(now - 1).toISOString() },
      { id: 2, workerId: 99, convertedJobId: 11, status: "pending", expiresAt: new Date(now + 60_000).toISOString() },
      { id: 3, workerId: 100, convertedJobId: 10, status: "pending", expiresAt: new Date(now + 60_000).toISOString() },
    ];
    const found = findExistingPendingInquiryForWorkerJob(inquiries, { workerId: 99, jobId: 10, nowMs: now });
    expect(found).toBeUndefined();
  });
});

describe("resolveCallInviteUrl", () => {
  it("keeps absolute URL unchanged", () => {
    const url = resolveCallInviteUrl("https://calls.example/room-1", {
      peerCallsBaseUrl: "https://ignored.example",
      frontEndUrl: "https://ignored-2.example",
    });
    expect(url).toBe("https://calls.example/room-1");
  });

  it("builds absolute URL from base + relative room", () => {
    const url = resolveCallInviteUrl("/job-123", {
      peerCallsBaseUrl: "https://calls.example/",
      frontEndUrl: null,
    });
    expect(url).toBe("https://calls.example/job-123");
  });

  it("returns null when relative room cannot be resolved", () => {
    const url = resolveCallInviteUrl("/job-123", {
      peerCallsBaseUrl: "",
      frontEndUrl: undefined,
    });
    expect(url).toBeNull();
  });
});

describe("getLatestActiveVideoCallMessage", () => {
  it("returns latest non-ended video_call message", () => {
    const messages = [
      {
        id: 1,
        createdAt: "2026-04-17T10:00:00.000Z",
        metadata: { type: "video_call", callStatus: "ended" },
      },
      {
        id: 2,
        createdAt: "2026-04-17T10:05:00.000Z",
        metadata: { type: "video_call", callStatus: "active" },
      },
      {
        id: 3,
        createdAt: "2026-04-17T10:06:00.000Z",
        metadata: { type: "text" },
      },
    ];

    const found = getLatestActiveVideoCallMessage(messages);
    expect(found?.id).toBe(2);
  });

  it("returns undefined when no active video call exists", () => {
    const messages = [
      { id: 1, createdAt: "2026-04-17T10:00:00.000Z", metadata: { type: "video_call", callStatus: "ended" } },
      { id: 2, createdAt: "2026-04-17T10:01:00.000Z", metadata: { type: "text" } },
    ];
    const found = getLatestActiveVideoCallMessage(messages);
    expect(found).toBeUndefined();
  });
});

