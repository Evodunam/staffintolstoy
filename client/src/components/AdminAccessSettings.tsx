import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldCheck, Crown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AdminGrant {
  id: number;
  email: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  notes: string | null;
}
interface AdminListResponse {
  envAdmins: string[];
  grants: AdminGrant[];
  superAdmins: string[];
}

/**
 * Super-admin only panel for granting/revoking admin access via email.
 * Surfaced inside Account Settings → Admin Access tab. The parent component
 * controls visibility based on `useAdminStatus().isSuperAdmin`.
 *
 * Two sources of admin access shown side by side:
 *   1. Env admins (process.env.ADMIN_EMAILS) — read-only, requires deploy.
 *   2. DB grants — manageable here.
 */
export function AdminAccessSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useQuery<AdminListResponse>({
    queryKey: ["/api/super-admin/admins"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/admins", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load admins");
      return res.json();
    },
  });

  const revoke = async (id: number) => {
    if (!confirm("Revoke this admin's access? They'll lose access immediately.")) return;
    try {
      await apiRequest("DELETE", `/api/super-admin/admins/${id}`, undefined);
      toast({ title: "Revoked" });
      qc.invalidateQueries({ queryKey: ["/api/super-admin/admins"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    }
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data) return null;

  const activeGrants = data.grants.filter((g) => !g.revokedAt);
  const revokedGrants = data.grants.filter((g) => g.revokedAt);

  return (
    <div className="space-y-6">
      {/* Super-admins (read-only) */}
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Crown className="w-4 h-4 text-amber-600" /> Super-admins</h3>
          <span className="text-xs text-muted-foreground">Configured via SUPER_ADMIN_EMAILS env var</span>
        </header>
        <div className="space-y-1">
          {data.superAdmins.map((email) => (
            <Card key={email}><CardContent className="p-2.5 flex items-center gap-2 text-sm">
              <Crown className="w-3.5 h-3.5 text-amber-600" />
              <span className="font-mono">{email}</span>
              <Badge variant="outline" className="ml-auto">env</Badge>
            </CardContent></Card>
          ))}
        </div>
      </section>

      {/* Env admins (read-only) */}
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Environment admins</h3>
          <span className="text-xs text-muted-foreground">Set via ADMIN_EMAILS env var; requires redeploy to change</span>
        </header>
        <div className="space-y-1">
          {data.envAdmins.length === 0
            ? <p className="text-xs text-muted-foreground">None.</p>
            : data.envAdmins.map((email) => (
              <Card key={email}><CardContent className="p-2.5 flex items-center gap-2 text-sm">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="font-mono">{email}</span>
                <Badge variant="outline" className="ml-auto">env</Badge>
              </CardContent></Card>
            ))}
        </div>
      </section>

      {/* Admin grants (managed here) */}
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Granted admins</h3>
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1"><Plus className="w-3.5 h-3.5" /> Grant access</Button>
        </header>
        {activeGrants.length === 0 ? (
          <p className="text-xs text-muted-foreground">No admin grants yet.</p>
        ) : (
          <div className="space-y-1">
            {activeGrants.map((g) => (
              <Card key={g.id}><CardContent className="p-2.5 flex items-center gap-2 text-sm">
                <ShieldCheck className="w-3.5 h-3.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono">{g.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Granted {new Date(g.grantedAt).toLocaleDateString()} by {g.grantedBy}
                    {g.notes && ` · ${g.notes}`}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revoke(g.id)} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </CardContent></Card>
            ))}
          </div>
        )}
      </section>

      {revokedGrants.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2 text-muted-foreground">Revoked</h3>
          <div className="space-y-1">
            {revokedGrants.slice(0, 10).map((g) => (
              <Card key={g.id} className="opacity-60"><CardContent className="p-2.5 flex items-center gap-2 text-sm">
                <span className="font-mono line-through">{g.email}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  Revoked {g.revokedAt && new Date(g.revokedAt).toLocaleDateString()} by {g.revokedBy}
                </span>
              </CardContent></Card>
            ))}
          </div>
        </section>
      )}

      <GrantDialog open={showAdd} onClose={() => setShowAdd(false)} onGranted={() => qc.invalidateQueries({ queryKey: ["/api/super-admin/admins"] })} />
    </div>
  );
}

function GrantDialog({ open, onClose, onGranted }: { open: boolean; onClose: () => void; onGranted: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim()) { toast({ title: "Email required", variant: "destructive" }); return; }
    try {
      setSubmitting(true);
      await apiRequest("POST", "/api/super-admin/admins", { email: email.trim(), notes: notes.trim() || undefined });
      toast({ title: "Admin granted", description: `Welcome email sent to ${email}.` });
      onGranted(); onClose();
      setEmail(""); setNotes("");
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant admin access</DialogTitle>
          <DialogDescription>The recipient will get a welcome email and 7-day MFA grace period.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="g-email">Email</Label>
            <Input id="g-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="newadmin@example.com" />
          </div>
          <div>
            <Label htmlFor="g-notes">Notes (optional)</Label>
            <Input id="g-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ops lead, contractor" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Granting…" : "Grant access"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

