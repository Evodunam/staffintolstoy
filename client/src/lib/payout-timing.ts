import { format } from "date-fns";

/** Subset of worker_payouts row returned on timesheet API for UI copy. */
export type PayoutPreview = {
  status: string;
  mercuryPaymentStatus?: string | null;
  mercuryPaymentId?: string | null;
  processedAt?: string | Date | null;
  completedAt?: string | Date | null;
  isInstantPayout?: boolean | null;
  createdAt?: string | Date | null;
  errorMessage?: string | null;
};

function fmt(d: string | Date | null | undefined): string | null {
  if (d == null) return null;
  try {
    return format(new Date(d), "MMM d, yyyy · h:mm a");
  } catch {
    return null;
  }
}

/**
 * Outgoing ACH from Mercury → recipient bank (typical). Paraphrased from Mercury’s
 * “Processing times for payments” help article; not a guarantee.
 */
const MERCURY_OUTGOING_ACH_SUMMARY =
  "Mercury typically delivers outgoing ACH to your bank in about 0–1 business days after Mercury sends the payment (often same-day ACH for eligible transfers initiated before 12pm PT). Weekends and bank holidays delay when Mercury can send.";

/**
 * User-facing copy for how/when Mercury pays the worker.
 * ACH timing is typical industry timing once Mercury marks “sent”; not a legal guarantee.
 */
export function describeWorkerPayoutTiming(args: {
  timesheetStatus?: string | null;
  timesheetPaymentStatus?: string | null;
  paidAt?: string | Date | null;
  payout?: PayoutPreview | null;
}): {
  title: string;
  body: string;
  statusLine?: string;
  mercuryLine?: string;
  /** Mercury-side processing / ACH rail expectations (vs your bank’s posting time). */
  mercuryExpectation?: string;
} {
  const { timesheetStatus, timesheetPaymentStatus, paidAt, payout } = args;
  const approved = timesheetStatus === "approved";
  const mercuryProcessed = fmt(payout?.processedAt);
  const mercuryLine =
    mercuryProcessed && payout
      ? `Mercury last update: ${mercuryProcessed} · internal status: ${payout.status}${
          payout.mercuryPaymentStatus ? ` · Mercury: ${payout.mercuryPaymentStatus}` : ""
        }`
      : payout?.mercuryPaymentStatus
        ? `Mercury payment status: ${payout.mercuryPaymentStatus}`
        : undefined;

  if (timesheetPaymentStatus === "completed" || paidAt) {
    const when = fmt(paidAt ?? payout?.completedAt);
    return {
      title: "Payment completed",
      body: when
        ? `Funds were marked paid ${when}. Your bank’s posting time can still vary by institution.`
        : "This payout is marked completed.",
      statusLine: payout?.mercuryPaymentStatus
        ? `Mercury payment status: ${payout.mercuryPaymentStatus}`
        : undefined,
      mercuryLine: mercuryLine || undefined,
      mercuryExpectation:
        "Mercury has marked this transfer complete on their side. If your balance hasn’t updated yet, your bank may still be posting the incoming ACH.",
    };
  }

  if (timesheetPaymentStatus === "failed" || payout?.status === "failed") {
    return {
      title: "Payment issue",
      body: payout?.errorMessage?.trim() || "This payout didn’t complete. Check payout settings or contact support.",
      statusLine: payout?.mercuryPaymentStatus
        ? `Mercury: ${payout.mercuryPaymentStatus}`
        : undefined,
      mercuryLine: mercuryLine || undefined,
    };
  }

  if (!approved) {
    return {
      title: "After approval",
      body: "Once the company approves this timesheet, we queue your payout through Mercury. After Mercury sends an ACH to your bank, you should usually see it within about 0–1 business days on Mercury’s typical outgoing ACH timeline (your bank may post later the same day or the next business day).",
      mercuryExpectation: MERCURY_OUTGOING_ACH_SUMMARY,
    };
  }

  if (payout?.isInstantPayout) {
    return {
      title: "Instant payout (Mercury)",
      body: `Mercury initiates instant transfers immediately; most banks post within minutes, though some hold up to one business day.${
        mercuryProcessed ? ` Mercury recorded processing at ${mercuryProcessed}.` : ""
      }`,
      statusLine: [payout.status, payout.mercuryPaymentStatus].filter(Boolean).join(" · ") || undefined,
      mercuryLine: mercuryLine || undefined,
      mercuryExpectation:
        "Mercury processes instant payouts as soon as the payment is submitted; funds still depend on your receiving bank’s real-time posting rules.",
    };
  }

  const st = (payout?.status || "").toLowerCase();
  const m = (payout?.mercuryPaymentStatus || "").toLowerCase();

  if (st === "sent" || m === "sent" || timesheetPaymentStatus === "processing") {
    return {
      title: "On the way to your bank",
      body: `Mercury has sent or is sending this transfer${
        mercuryProcessed ? ` (last Mercury activity: ${mercuryProcessed})` : ""
      }. You should typically see it at your bank within about 0–1 business days after Mercury sends outgoing ACH; your bank’s posting time can add a few hours.`,
      statusLine: [payout?.status, payout?.mercuryPaymentStatus].filter(Boolean).join(" · ") || undefined,
      mercuryLine: mercuryLine || undefined,
      mercuryExpectation: MERCURY_OUTGOING_ACH_SUMMARY,
    };
  }

  if (st === "processing" || st === "pending" || st === "pending_bank_setup" || st === "pending_w9" || !payout) {
    return {
      title: "Processing with Mercury",
      body: payout
        ? `Your payout is queued or in flight with Mercury${
            mercuryProcessed ? ` (Mercury activity at ${mercuryProcessed})` : ""
          }. Once Mercury sends an ACH to your account, delivery is usually about 0–1 business days on Mercury’s side.`
        : "We’re creating or queueing your Mercury payout. Once Mercury sends an ACH to your account, delivery is usually about 0–1 business days on Mercury’s side.",
      statusLine: payout ? [payout.status, payout.mercuryPaymentStatus].filter(Boolean).join(" · ") : undefined,
      mercuryLine: mercuryLine || undefined,
      mercuryExpectation: MERCURY_OUTGOING_ACH_SUMMARY,
    };
  }

  return {
    title: "Payout (Mercury ACH)",
    body: `Transfers run through Mercury to your linked account. After Mercury sends the payment, outgoing ACH usually reaches your bank in about 0–1 business days.${
      mercuryProcessed ? ` Mercury processing logged at ${mercuryProcessed}.` : ""
    }`,
    statusLine: [payout?.status, payout?.mercuryPaymentStatus].filter(Boolean).join(" · ") || undefined,
    mercuryLine: mercuryLine || undefined,
    mercuryExpectation: MERCURY_OUTGOING_ACH_SUMMARY,
  };
}
