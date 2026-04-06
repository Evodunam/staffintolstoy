import { describe, expect, it } from "vitest";
import { parseReplayUrlState, writeReplayUrlState } from "./replay-url";

describe("replay-url", () => {
  it("parses replay params and clamps minute", () => {
    const params = new URLSearchParams(
      "replayMinute=1800&replayKinds=start,ping&replayWorkers=2,3,2,abc&replayRail=1"
    );
    const parsed = parseReplayUrlState(params);
    expect(parsed.replayMinute).toBe(1439);
    expect(parsed.showReplayJobStarts).toBe(true);
    expect(parsed.showReplayJobEnds).toBe(false);
    expect(parsed.showReplayPings).toBe(true);
    expect(parsed.replayTeammateFilterIds).toEqual([2, 3]);
    expect(parsed.replayRailOpen).toBe(true);
  });

  it("filters replay workers against valid worker ids", () => {
    const params = new URLSearchParams("replayWorkers=2,3,4");
    const parsed = parseReplayUrlState(params, new Set([2, 4]));
    expect(parsed.replayTeammateFilterIds).toEqual([2, 4]);
  });

  it("writes replay params and removes empty worker/rail", () => {
    const params = new URLSearchParams("foo=bar&replayWorkers=999&replayRail=1");
    const changed = writeReplayUrlState(params, {
      replayMinute: -10,
      showReplayJobStarts: true,
      showReplayJobEnds: true,
      showReplayPings: false,
      replayTeammateFilterIds: [],
      replayRailOpen: false,
    });
    expect(changed).toBe(true);
    expect(params.get("foo")).toBe("bar");
    expect(params.get("replayMinute")).toBe("0");
    expect(params.get("replayKinds")).toBe("start,end");
    expect(params.get("replayWorkers")).toBeNull();
    expect(params.get("replayRail")).toBeNull();
  });

  it("returns unchanged when params already match", () => {
    const params = new URLSearchParams("replayMinute=15&replayKinds=start,end,ping&replayWorkers=1,4&replayRail=1");
    const changed = writeReplayUrlState(params, {
      replayMinute: 15,
      showReplayJobStarts: true,
      showReplayJobEnds: true,
      showReplayPings: true,
      replayTeammateFilterIds: [4, 1],
      replayRailOpen: true,
    });
    expect(changed).toBe(false);
    expect(params.toString()).toBe("replayMinute=15&replayKinds=start%2Cend%2Cping&replayWorkers=1%2C4&replayRail=1");
  });
});

