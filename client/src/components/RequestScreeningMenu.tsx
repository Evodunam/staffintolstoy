import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ScanFace, FlaskConical, Shield, Loader2, Copy, Check, ChevronDown } from "lucide-react";

/**
 * Reusable in-context menu for triggering compliance screenings on a worker.
 * Drop into any company-side surface where a worker is selected (applicant
 * detail panel, hired-team list, etc).
 *
 * Props:
 *   - applicationId: optional. When provided, we'll auto-resolve the worker's
 *     email + name + state from the applicant via /api/company/applicants/:id/email.
 *   - prefilledEmail / prefilledState: skips the lookup if already known.
 *
 * Renders a compact "Request screening ▾" dropdown with two actions. Each
 * action opens its own dialog that posts to the existing
 * /api/company/{background-checks,drug-screens}/request endpoints.
 */

interface Props {
  applicationId?: number;
  prefilledEmail?: string;
  prefilledState?: string;
  workerName?: string;
  /** Render style. "compact" = small icon button; "default" = full text label. */
  variant?: "default" | "compact";
}

export function RequestScreeningMenu({ applicationId, prefilledEmail, prefilledState, workerName, variant = "default" }: Props) {
  const [openType, setOpenType] = useState<"bg" | "drug" | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={variant === "compact" ? "icon" : "sm"} className="gap-1">
            {variant === "compact" ? (
              <Shield className="w-4 h-4" />
            ) : (
              <>
                <Shield className="w-3.5 h-3.5" /> Request screening <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpenType("bg")} className="gap-2">
            <ScanFace className="w-4 h-4" /> Background check (FCRA)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpenType("drug")} className="gap-2">
            <FlaskConical className="w-4 h-4" /> Drug screen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {openType === "bg" && (
        <BackgroundCheckRequestDialog
          open
          onClose={() => setOpenType(null)}
          applicationId={applicationId}
          prefilledEmail={prefilledEmail}
          workerName={workerName}
        />
      )}
      {openType === "drug" && (
        <DrugScreenRequestDialog
          open
          onClose={() => setOpenType(null)}
          applicationId={applicationId}
          prefilledEmail={prefilledEmail}
          prefilledState={prefilledState}
          workerName={workerName}
        />
      )}
    </>
  );
}

/**
 * Resolve worker contact details for an applicant. Defers the API call until
 * the dialog actually opens so we don't hammer the email-lookup endpoint
 * just because the menu rendered.
 */
async function resolveApplicantContact(applicationId: number): Promise<{ email: string; state: string | null } | null> {
  try {
    const res = await fetch(`/api/company/applicants/${applicationId}/email`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return { email: data.email, state: data.state ?? null };
  } catch {
    return null;
  }
}

function BackgroundCheckRequestDialog({
  open, onClose, applicationId, prefilledEmail, workerName,
}: { open: boolean; onClose: () => void; applicationId?: number; prefilledEmail?: string; workerName?: string }) {
  const { toast } = useToast();
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [vendor, setVendor] = useState("checkr");
  const [packageCode, setPackageCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Lazy-load the email if we don't have it.
  if (open && !prefilledEmail && applicationId && !email && !resolving) {
    setResolving(true);
    void resolveApplicantContact(applicationId).then((data) => {
      if (data?.email) setEmail(data.email);
      setResolving(false);
    });
  }

  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast({ title: "Invalid email", variant: "destructive" }); return; }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/company/background-checks/request", {
        workerEmail: email, vendor, packageCode: packageCode || undefined,
      });
      const data = await res.json();
      setCreatedUrl(data.consentUrl);
      toast({ title: "Consent invitation sent", description: `Email sent to ${email}.` });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!createdUrl) return;
    try { await navigator.clipboard.writeText(createdUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanFace className="w-5 h-5" /> Request background check{workerName ? ` for ${workerName}` : ""}</DialogTitle>
          <DialogDescription>Worker receives an FCRA disclosure + authorization + Summary of Rights. Order is placed only after they sign.</DialogDescription>
        </DialogHeader>

        {!createdUrl ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="rs-bg-email">Worker email</Label>
                <Input
                  id="rs-bg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={resolving ? "Looking up applicant email…" : "worker@example.com"}
                  disabled={resolving}
                />
              </div>
              <div>
                <Label htmlFor="rs-bg-vendor">Vendor</Label>
                <Select value={vendor} onValueChange={setVendor}>
                  <SelectTrigger id="rs-bg-vendor"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checkr">Checkr</SelectItem>
                    <SelectItem value="goodhire">GoodHire</SelectItem>
                    <SelectItem value="sterling">Sterling</SelectItem>
                    <SelectItem value="manual">Manual / Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rs-bg-pkg">Package code (optional)</Label>
                <Input id="rs-bg-pkg" value={packageCode} onChange={(e) => setPackageCode(e.target.value)} placeholder="e.g. tasker_standard" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !email || resolving}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Send invitation
              </Button>
            </DialogFooter>
          </>
        ) : (
          <SentSuccess url={createdUrl} onCopy={copy} copied={copied} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DrugScreenRequestDialog({
  open, onClose, applicationId, prefilledEmail, prefilledState, workerName,
}: { open: boolean; onClose: () => void; applicationId?: number; prefilledEmail?: string; prefilledState?: string; workerName?: string }) {
  const { toast } = useToast();
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [panel, setPanel] = useState<"5_panel" | "5_panel_no_thc" | "10_panel" | "dot_panel">("5_panel");
  const [workplaceState, setWorkplaceState] = useState(prefilledState ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resolving, setResolving] = useState(false);

  if (open && !prefilledEmail && applicationId && !email && !resolving) {
    setResolving(true);
    void resolveApplicantContact(applicationId).then((data) => {
      if (data?.email) setEmail(data.email);
      if (data?.state && !workplaceState) setWorkplaceState(data.state);
      setResolving(false);
    });
  }

  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast({ title: "Invalid email", variant: "destructive" }); return; }
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/company/drug-screens/request", {
        workerEmail: email, panel, workplaceState: workplaceState || undefined,
      });
      const data = await res.json();
      setCreatedUrl(data.consentUrl);
      toast({ title: "Consent invitation sent", description: `Email sent to ${email}.` });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!createdUrl) return;
    try { await navigator.clipboard.writeText(createdUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Request drug screen{workerName ? ` for ${workerName}` : ""}</DialogTitle>
          <DialogDescription>Worker gets an email with a tokenized consent link. Order is placed only after they sign.</DialogDescription>
        </DialogHeader>

        {!createdUrl ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="rs-ds-email">Worker email</Label>
                <Input
                  id="rs-ds-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={resolving ? "Looking up applicant email…" : "worker@example.com"}
                  disabled={resolving}
                />
              </div>
              <div>
                <Label htmlFor="rs-ds-panel">Panel</Label>
                <Select value={panel} onValueChange={(v: any) => setPanel(v)}>
                  <SelectTrigger id="rs-ds-panel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5_panel">5-panel (standard)</SelectItem>
                    <SelectItem value="5_panel_no_thc">5-panel without THC</SelectItem>
                    <SelectItem value="10_panel">10-panel (extended)</SelectItem>
                    <SelectItem value="dot_panel">DOT panel (49 CFR §40)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  THC is auto-stripped in CA, NY, NJ, WA, RI, MN, DC unless DOT-regulated.
                </p>
              </div>
              <div>
                <Label htmlFor="rs-ds-state">Workplace state (2-letter, optional)</Label>
                <Input id="rs-ds-state" maxLength={2} value={workplaceState} onChange={(e) => setWorkplaceState(e.target.value.toUpperCase())} placeholder="e.g. CA" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !email || resolving}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Send invitation
              </Button>
            </DialogFooter>
          </>
        ) : (
          <SentSuccess url={createdUrl} onCopy={copy} copied={copied} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SentSuccess({ url, onCopy, copied, onClose }: { url: string; onCopy: () => void; copied: boolean; onClose: () => void }) {
  return (
    <>
      <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 mt-3">
        <p className="font-medium text-sm text-green-900 dark:text-green-200 mb-2">Sent</p>
        <p className="text-xs text-green-900/80 dark:text-green-200/80 mb-2">
          Email is on its way. You can also share this link directly:
        </p>
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={onCopy} title="Copy">
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <DialogFooter className="mt-4">
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

