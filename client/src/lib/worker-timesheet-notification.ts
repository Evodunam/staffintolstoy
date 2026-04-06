/** Parse timesheet id from persisted / websocket notification payload. */
export function getTimesheetIdFromNotificationData(data: Record<string, unknown> | undefined | null): number | null {
  if (!data) return null;
  const raw = data.timesheetId;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Worker notifications that should open the earnings / approval invoice popup when we have a timesheet id. */
export function shouldOpenTimesheetApprovalInvoice(
  type: string | undefined,
  timesheetId: number | null
): boolean {
  if (timesheetId == null) return false;
  return (
    type === "timesheet_approved" ||
    type === "timesheet_auto_approved" ||
    type === "payment_received"
  );
}

/** If this notification should show the earnings invoice popup, opens it and returns true. */
export function tryOpenTimesheetApprovalInvoiceFromNotification(
  notif: { type?: string; data?: Record<string, unknown> | null },
  openInvoice: (timesheetId: number) => void
): boolean {
  const tsId = getTimesheetIdFromNotificationData(notif.data ?? undefined);
  if (!shouldOpenTimesheetApprovalInvoice(notif.type, tsId)) return false;
  openInvoice(tsId!);
  return true;
}
