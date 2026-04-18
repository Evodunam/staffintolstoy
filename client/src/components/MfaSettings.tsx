import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";

interface MfaSettingsProps {
  /** Initial MFA-enabled state from the user/profile object. */
  initiallyEnabled: boolean;
  /** Called after a successful enable/disable so parent can refetch profile. */
  onChange?: () => void;
}

type Phase = "idle" | "scanning" | "verifying" | "showingBackup";

/**
 * Self-contained MFA enrollment + management UI.
 *
 * Calls (already-shipped server endpoints):
 *   - POST /api/auth/mfa/setup        → returns QR + secret
 *   - POST /api/auth/mfa/verify       → confirms first OTP, returns backup codes
 *   - POST /api/auth/mfa/disable      → disables (step-up gated)
 *
 * For disable: we ask the user to confirm their password inline → POST
 * /api/auth/step-up { password, reason: "mfa_disable" } → POST /api/auth/mfa/disable.
 */
export function MfaSettings({ initiallyEnabled, onChange }: MfaSettingsProps) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [phase, setPhase] = useState<Phase>("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Disable flow
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  const startSetup = async () => {
    try {
      setSubmitting(true);
      const res = await apiRequest("POST", "/api/auth/mfa/setup", {});
      const data = await res.json();
      setQrDataUrl(data.qrPngDataUrl);
      setOtpauthUrl(data.otpauthUrl);
      setPhase("scanning");
    } catch (err: any) {
      toast({ title: "Could not start MFA setup", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (code.replace(/\s+/g, "").length !== 6) {
      toast({ title: "Enter the 6-digit code", variant: "destructive" });
      return;
    }
    try {
      setSubmitting(true);
      setPhase("verifying");
      const res = await apiRequest("POST", "/api/auth/mfa/verify", { token: code });
      const data = await res.json();
      setBackupCodes(data.backupCodes || []);
      setPhase("showingBackup");
      setEnabled(true);
      toast({ title: "MFA enabled", description: "Save your backup codes now." });
      onChange?.();
    } catch (err: any) {
      setPhase("scanning");
      toast({ title: "Invalid code", description: err.message ?? "Try again with the next 30-second code.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const finishEnrollment = () => {
    setPhase("idle");
    setQrDataUrl(null);
    setOtpauthUrl(null);
    setCode("");
    setBackupCodes([]);
  };

  const disableMfa = async () => {
    if (!disablePassword) {
      toast({ title: "Password required", variant: "destructive" });
      return;
    }
    try {
      setSubmitting(true);
      // 1) Step-up grant
      await apiRequest("POST", "/api/auth/step-up", { password: disablePassword, reason: "mfa_disable" });
      // 2) Disable
      await apiRequest("POST", "/api/auth/mfa/disable", {});
      setEnabled(false);
      setShowDisable(false);
      setDisablePassword("");
      toast({ title: "MFA disabled" });
      onChange?.();
    } catch (err: any) {
      toast({ title: "Could not disable MFA", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copyBackup = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {enabled ? (
          <ShieldCheck className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
        ) : (
          <Shield className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <h3 className="font-semibold">Two-factor authentication (TOTP)</h3>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "MFA is enabled. You'll be prompted for a 6-digit code from your authenticator app at sign-in."
              : "Add a second sign-in step using Google Authenticator, 1Password, Authy, or any TOTP app."}
          </p>
        </div>
        {!enabled && phase === "idle" && (
          <Button onClick={startSetup} disabled={submitting}>Enable MFA</Button>
        )}
        {enabled && !showDisable && (
          <Button variant="outline" onClick={() => setShowDisable(true)}>Disable</Button>
        )}
      </div>

      {phase === "scanning" && qrDataUrl && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img src={qrDataUrl} alt="MFA QR" className="w-44 h-44 border border-border rounded" />
            <div className="flex-1 space-y-2">
              <p className="text-sm">
                <strong>1.</strong> Scan this QR with your authenticator app.
              </p>
              <p className="text-sm">
                <strong>2.</strong> Or paste this URL manually:
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded block break-all">{otpauthUrl}</code>
              <p className="text-sm">
                <strong>3.</strong> Enter the 6-digit code your app shows:
              </p>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123 456"
                  className="max-w-[140px] tracking-widest text-center text-lg"
                  inputMode="numeric"
                />
                <Button onClick={verifyCode} disabled={submitting || code.length !== 6}>
                  {submitting ? "Verifying…" : "Verify"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "showingBackup" && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Save these backup codes NOW</AlertTitle>
          <AlertDescription>
            <p className="mb-3 text-sm">
              Each code can be used <strong>once</strong> if you lose access to your authenticator. They will not be shown again.
            </p>
            <div className="grid grid-cols-2 gap-1 text-sm font-mono bg-muted p-3 rounded">
              {backupCodes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" onClick={copyBackup}>
                {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                {copied ? "Copied" : "Copy all"}
              </Button>
              <Button size="sm" onClick={finishEnrollment}>
                I've saved them — done
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {showDisable && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
          <p className="text-sm">Confirm your password to disable MFA:</p>
          <div>
            <Label htmlFor="disable-pw" className="text-xs">Password</Label>
            <Input
              id="disable-pw"
              type="password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setShowDisable(false); setDisablePassword(""); }} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={disableMfa} disabled={submitting || !disablePassword}>
              {submitting ? "Disabling…" : "Disable MFA"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
