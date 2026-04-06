export const REPLAY_QUERY_KEYS = ["replayMinute", "replayKinds", "replayWorkers", "replayRail"] as const;

export interface ReplayUrlState {
  replayMinute: number;
  showReplayJobStarts: boolean;
  showReplayJobEnds: boolean;
  showReplayPings: boolean;
  replayTeammateFilterIds: number[];
  replayRailOpen: boolean;
}

export function parseReplayUrlState(
  params: URLSearchParams,
  validWorkerIds?: Set<number>
): Partial<ReplayUrlState> {
  const parsed: Partial<ReplayUrlState> = {};

  const minuteParam = Number(params.get("replayMinute"));
  if (Number.isFinite(minuteParam)) {
    parsed.replayMinute = Math.max(0, Math.min(1439, Math.floor(minuteParam)));
  }

  const kindsParam = (params.get("replayKinds") || "").trim();
  if (kindsParam) {
    const kinds = new Set(
      kindsParam
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    );
    parsed.showReplayJobStarts = kinds.has("start");
    parsed.showReplayJobEnds = kinds.has("end");
    parsed.showReplayPings = kinds.has("ping");
  }

  const workersParam = (params.get("replayWorkers") || "").trim();
  if (workersParam) {
    const uniqueIds = Array.from(
      new Set(
        workersParam
          .split(",")
          .map((id) => Number(id))
          .filter((id): id is number => Number.isInteger(id) && id > 0)
      )
    );
    parsed.replayTeammateFilterIds = validWorkerIds
      ? uniqueIds.filter((id) => validWorkerIds.has(id))
      : uniqueIds;
  }

  if (params.has("replayRail")) {
    parsed.replayRailOpen = params.get("replayRail") === "1";
  }
  return parsed;
}

export function writeReplayUrlState(params: URLSearchParams, state: ReplayUrlState): boolean {
  let changed = false;
  const upsert = (key: string, value: string | null) => {
    const existing = params.get(key);
    if (!value) {
      if (existing !== null) {
        params.delete(key);
        changed = true;
      }
      return;
    }
    if (existing !== value) {
      params.set(key, value);
      changed = true;
    }
  };

  const kinds = [
    state.showReplayJobStarts ? "start" : null,
    state.showReplayJobEnds ? "end" : null,
    state.showReplayPings ? "ping" : null,
  ]
    .filter(Boolean)
    .join(",");

  const workerIds = state.replayTeammateFilterIds
    .filter((id): id is number => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b)
    .join(",");

  upsert("replayMinute", String(Math.max(0, Math.min(1439, Math.floor(state.replayMinute)))));
  upsert("replayKinds", kinds);
  upsert("replayWorkers", workerIds || null);
  upsert("replayRail", state.replayRailOpen ? "1" : null);
  return changed;
}

