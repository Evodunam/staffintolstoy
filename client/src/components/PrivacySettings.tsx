import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Download, Trash2, Cookie, Loader2 } from "lucide-react";
import { Link } from "wouter";

/**
 * Privacy & data-rights settings — surfaces the CCPA/CPRA + GDPR controls the
 * server already exposes:
 *   - GET  /api/privacy/export   → downloads JSON of all your data
 *   - POST /api/privacy/delete   → schedules account deletion (step-up gated)
 *   - POST /api/privacy/do-not-sell → CCPA opt-out acknowledgment
 *   - + cookie consent reset (clears localStorage banner state)
 */
export function PrivacySettings() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    try {
      setExporting(true);
      const res = await fetch("/api/privacy/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tolstoy-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded", description: "Your data has been saved." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const requestDelete = async () => {
    if (confirm.toLowerCase() !== "delete my account") {
      toast({ title: 'Type "delete my account" to confirm', variant: "destructive" });
      return;
    }
    if (!deletePassword) {
      toast({ title: "Password required", variant: "destructive" });
      return;
    }
    try {
      setDeleting(true);
      await apiRequest("POST", "/api/auth/step-up", { password: deletePassword, reason: "account_delete" });
      const res = await apiRequest("POST", "/api/privacy/delete", {});
      const data = await res.json();
      toast({
        title: "Deletion scheduled",
        description: `Your account will be hard-deleted on ${new Date(data.scheduledHardDeleteAt).toLocaleDateString()}. Sign in within 30 days to cancel.`,
      });
      setShowDelete(false);
      setDeletePassword("");
      setConfirm("");
    } catch (err: any) {
      toast({ title: "Could not schedule deletion", description: err.message ?? "", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const resetCookieConsent = () => {
    try {
      window.localStorage.removeItem("cookie-consent.v1");
      toast({ title: "Cookie preferences cleared", description: "Reload the page to choose again." });
    } catch {
      /* ignore */
    }
  };

  const optOutOfSale = async () => {
    try {
      await apiRequest("POST", "/api/privacy/do-not-sell", {});
      toast({ title: "Recorded", description: "We do not sell or share your personal information for cross-context behavioral advertising." });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Export */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <Download className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold">Download my data</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Get a JSON file with everything we hold about you (CCPA §1798.110 / GDPR Art. 15).
            </p>
            <Button onClick={exportData} disabled={exporting} variant="outline" size="sm">
              {exporting ? (<><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Preparing…</>) : "Download export"}
            </Button>
          </div>
        </div>
      </div>

      {/* Do Not Sell */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <Cookie className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold">Do Not Sell or Share My Personal Information</h3>
            <p className="text-sm text-muted-foreground mb-3">
              We do not sell or share your personal information for cross-context behavioral advertising.
              You can record your preference here for our records.
            </p>
            <div className="flex gap-2">
              <Button onClick={optOutOfSale} variant="outline" size="sm">Record opt-out</Button>
              <Button onClick={resetCookieConsent} variant="ghost" size="sm">Reset cookie banner</Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              See our <Link href="/legal/subprocessors" className="text-primary underline">Subprocessor list</Link> for
              the third parties that process data on our behalf.
            </p>
          </div>
        </div>
      </div>

      {/* Delete account */}
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <Trash2 className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold">Delete my account</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Schedules hard-delete in 30 days. Tax records and active disputes are retained per CCPA §1798.105(d) exemptions.
            </p>
            {!showDelete ? (
              <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
                Start deletion
              </Button>
            ) : (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertTitle>This is irreversible after 30 days</AlertTitle>
                  <AlertDescription className="text-xs">
                    During the 30-day grace period you can cancel by signing in. After that, only data we are required
                    to retain (1099-NEC tax records, active disputes, anti-fraud signals) survives.
                  </AlertDescription>
                </Alert>
                <div>
                  <Label htmlFor="del-pw" className="text-xs">Confirm password</Label>
                  <Input id="del-pw" type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="del-confirm" className="text-xs">Type <code className="bg-muted px-1">delete my account</code> to confirm</Label>
                  <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="delete my account" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowDelete(false); setDeletePassword(""); setConfirm(""); }} disabled={deleting}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={requestDelete} disabled={deleting || !deletePassword || confirm.toLowerCase() !== "delete my account"}>
                    {deleting ? "Scheduling…" : "Schedule deletion"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
