import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { TimesheetApprovalInvoiceDialog } from "@/components/TimesheetApprovalInvoiceDialog";

type Ctx = {
  openTimesheetApprovalInvoice: (timesheetId: number) => void;
};

const TimesheetApprovalInvoiceContext = createContext<Ctx | null>(null);

export function TimesheetApprovalInvoiceProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [timesheetId, setTimesheetId] = useState<number | null>(null);

  const openTimesheetApprovalInvoice = useCallback((id: number) => {
    if (!Number.isFinite(id) || id <= 0) return;
    setTimesheetId(id);
    setOpen(true);
  }, []);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setTimeout(() => setTimesheetId(null), 280);
    }
  }, []);

  const value = useMemo(() => ({ openTimesheetApprovalInvoice }), [openTimesheetApprovalInvoice]);

  return (
    <TimesheetApprovalInvoiceContext.Provider value={value}>
      {children}
      <TimesheetApprovalInvoiceDialog timesheetId={timesheetId} open={open} onOpenChange={onOpenChange} />
    </TimesheetApprovalInvoiceContext.Provider>
  );
}

export function useTimesheetApprovalInvoice(): Ctx {
  const ctx = useContext(TimesheetApprovalInvoiceContext);
  if (!ctx) {
    throw new Error("useTimesheetApprovalInvoice must be used within TimesheetApprovalInvoiceProvider");
  }
  return ctx;
}
