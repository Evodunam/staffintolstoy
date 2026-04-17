type DirectInquiryLike = {
  workerId: number;
  convertedJobId: number | null;
  status: string;
  expiresAt?: string | Date | null;
};

type VideoCallMeta = {
  type?: string;
  callStatus?: string;
};

type JobMessageLike = {
  createdAt?: string | Date | null;
  metadata?: VideoCallMeta | null;
};

export function parseWorkerId(rawWorkerId: unknown): number | null {
  const numeric =
    typeof rawWorkerId === "number"
      ? rawWorkerId
      : typeof rawWorkerId === "string" && rawWorkerId.trim()
        ? Number(rawWorkerId)
        : NaN;
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

export function findExistingPendingInquiryForWorkerJob<T extends DirectInquiryLike>(
  inquiries: readonly T[],
  input: { workerId: number; jobId: number; nowMs?: number }
): T | undefined {
  const nowMs = input.nowMs ?? Date.now();
  return inquiries.find((inquiry) => {
    if (inquiry.workerId !== input.workerId) return false;
    if (inquiry.convertedJobId !== input.jobId) return false;
    if (inquiry.status !== "pending") return false;
    if (!inquiry.expiresAt) return true;
    const expiresAtMs = new Date(inquiry.expiresAt).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  });
}

export function resolveCallInviteUrl(
  roomUrl: string,
  input: { peerCallsBaseUrl?: string | null; frontEndUrl?: string | null }
): string | null {
  const trimmed = roomUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const base = (input.peerCallsBaseUrl || input.frontEndUrl || "").trim().replace(/\/$/, "");
  if (!base) return null;
  const combined = `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
  return /^https?:\/\//i.test(combined) ? combined : null;
}

export function getLatestActiveVideoCallMessage<T extends JobMessageLike>(
  messages: readonly T[]
): T | undefined {
  return [...messages]
    .sort((a, b) => {
      const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bMs - aMs;
    })
    .find((message) => {
      const meta = message.metadata;
      return meta?.type === "video_call" && meta.callStatus !== "ended";
    });
}

