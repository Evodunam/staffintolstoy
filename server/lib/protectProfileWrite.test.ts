import { describe, expect, it, vi, afterEach } from "vitest";
import {
  stripServerControlledProfileFields,
  __SERVER_CONTROLLED_PROFILE_FIELDS_FOR_TEST as SERVER_FIELDS,
} from "./protectProfileWrite";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stripServerControlledProfileFields", () => {
  it("drops every server-controlled field even when present in the input", () => {
    const malicious: Record<string, unknown> = {
      // legitimate user-editable fields
      firstName: "Real",
      lastName: "User",
      bio: "hi",
      city: "SF",
      state: "CA",
      hourlyRate: 5500,
    };
    // Plant every server-controlled key with an obvious sentinel
    for (const key of SERVER_FIELDS) {
      malicious[key] = "ATTACKER_VALUE";
    }

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = stripServerControlledProfileFields(malicious, {
      profileId: 42,
      userId: "u_attacker",
    });

    for (const key of SERVER_FIELDS) {
      expect(out, `leak for "${key}"`).not.toHaveProperty(key);
    }
    // legitimate fields preserved
    expect(out.firstName).toBe("Real");
    expect(out.bio).toBe("hi");
    expect(out.city).toBe("SF");
    expect(out.hourlyRate).toBe(5500);
  });

  it("logs a warning naming the dropped fields and the route context", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripServerControlledProfileFields(
      { firstName: "ok", depositAmount: 1_000_000_000, faceVerified: true, identityVerified: true },
      { profileId: 7, userId: "u_x", route: "PUT /api/profiles/:id" },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const [msg, payload] = warn.mock.calls[0] as [string, { droppedFields: string[]; route?: string; profileId?: number; userId?: string }];
    expect(msg).toContain("ProfileWriteGuard");
    expect(payload.droppedFields).toEqual(
      expect.arrayContaining(["depositAmount", "faceVerified", "identityVerified"]),
    );
    expect(payload.route).toBe("PUT /api/profiles/:id");
    expect(payload.profileId).toBe(7);
    expect(payload.userId).toBe("u_x");
  });

  it("does not log when no server-controlled fields are present", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = stripServerControlledProfileFields(
      { firstName: "ok", bio: "hello" },
      { profileId: 1 },
    );
    expect(warn).not.toHaveBeenCalled();
    expect(out).toEqual({ firstName: "ok", bio: "hello" });
  });

  it("returns the input unchanged for non-objects", () => {
    expect(stripServerControlledProfileFields(null as any)).toBe(null);
    expect(stripServerControlledProfileFields(undefined as any)).toBe(undefined);
  });

  it("does not mutate the input object", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = { firstName: "ok", depositAmount: 999, stripeCustomerId: "cus_x" };
    const before = JSON.stringify(input);
    stripServerControlledProfileFields(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
