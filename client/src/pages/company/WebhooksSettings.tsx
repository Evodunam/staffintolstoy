import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Webhook, Copy, Check, RotateCw, ZapOff, Send, AlertTriangle, Loader2, ChevronRight,
} from "lucide-react";

interface WebhookConfig {
  webhookUrl: string | null;
  webhookSecretSet: boolean;
  webhookSecretLastChars: string | null;
  webhookEventsEnabled: string[] | null;
}

interface WebhookEvent {
  id: number;
  eventType: string;
  idempotencyKey: string;
  url: string;
  payload: any;
  status: "pending" | "delivered" | "failed" | "abandoned";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastResponseStatus: number | null;
  lastResponseBody: string | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/**
 * Company-facing webhooks settings page. Two tabs:
 *   - Configuration: URL + secret + events filter + test ping
 *   - Recent events: delivered/failed/abandoned event log with retry buttons
 *
 * Surfaced from /company-dashboard?tab=settings (or wherever the company
 * dashboard exposes integrations). Independent route at /company/webhooks.
 */
export default function WebhooksSettings() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/company-dashboard")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><Webhook className="w-5 h-5" /> Webhooks</h1>
            <p className="text-xs text-muted-foreground">Receive real-time events from Tolstoy Staffing in your own systems.</p>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Tabs defaultValue="config">
          <TabsList>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="events">Recent events</TabsTrigger>
          </TabsList>
          <TabsContent value="config" className="mt-4"><ConfigTab /></TabsContent>
          <TabsContent value="events" className="mt-4"><EventsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ConfigTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<WebhookConfig>({
    queryKey: ["/api/company/webhook-config"],
    queryFn: async () => {
      const res = await fetch("/api/company/webhook-config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const [url, setUrl] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [shownSecret, setShownSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep local state in sync when first loaded.
  if (!isLoading && url === "" && data?.webhookUrl) {
    setUrl(data.webhookUrl);
  }

  const saveUrl = async () => {
    if (!url.startsWith("https://")) { toast({ title: "URL must start with https://", variant: "destructive" }); return; }
    try {
      setSavingUrl(true);
      await apiRequest("PUT", "/api/company/webhook-config", { webhookUrl: url });
      toast({ title: "Webhook URL saved" });
      qc.invalidateQueries({ queryKey: ["/api/company/webhook-config"] });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setSavingUrl(false);
    }
  };

  const regenerate = async () => {
    if (!confirm("Generate a new signing secret? Your existing endpoint will fail signature verification until you update it.")) return;
    try {
      setRegenerating(true);
      const res = await apiRequest("PUT", "/api/company/webhook-config", { regenerateSecret: true });
      const data = await res.json();
      setShownSecret(data.newSecret);
      qc.invalidateQueries({ queryKey: ["/api/company/webhook-config"] });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  };

  const testPing = async () => {
    try {
      setTesting(true);
      await apiRequest("POST", "/api/company/webhook-config/test", {});
      toast({ title: "Test event queued", description: "Should arrive at your endpoint within 30s. Watch for X-Tolstoy-Event: webhook.test." });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message ?? "", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const copy = async () => {
    if (!shownSecret) return;
    try { await navigator.clipboard.writeText(shownSecret); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;

  return (
    <div className="space-y-6 max-w-2xl">
      <Alert>
        <Webhook className="h-4 w-4" />
        <AlertTitle>Signed event delivery</AlertTitle>
        <AlertDescription className="text-xs">
          We POST JSON to your URL with header <code>Tolstoy-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>.
          Verify by computing <code>HMAC-SHA256(secret, t + "." + raw_body)</code> and comparing.
          Failed deliveries retry up to 8 times with exponential backoff (30s → 12h).
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="webhook-url">Endpoint URL (https only)</Label>
        <div className="flex gap-2 mt-1">
          <Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/tolstoy-webhook" />
          <Button onClick={saveUrl} disabled={savingUrl || !url}>{savingUrl ? "Saving…" : "Save"}</Button>
        </div>
        {data?.webhookUrl && (
          <p className="text-xs text-muted-foreground mt-1">Current: {data.webhookUrl}</p>
        )}
      </div>

      <div>
        <Label>Signing secret</Label>
        <div className="flex items-center gap-2 mt-1">
          {data?.webhookSecretSet ? (
            <Badge variant="default" className="gap-1"><Check className="w-3 h-3" /> Set (…{data.webhookSecretLastChars})</Badge>
          ) : (
            <Badge variant="destructive">Not set</Badge>
          )}
          <Button variant="outline" size="sm" onClick={regenerate} disabled={regenerating} className="gap-1">
            <RotateCw className="w-3.5 h-3.5" /> {data?.webhookSecretSet ? "Regenerate" : "Generate"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          The secret is shown ONCE on regeneration. Store it in your environment / secret manager.
        </p>
      </div>

      <Button variant="outline" onClick={testPing} disabled={testing || !data?.webhookUrl || !data?.webhookSecretSet} className="gap-1">
        <Send className="w-3.5 h-3.5" /> {testing ? "Sending…" : "Send test event"}
      </Button>
      {(!data?.webhookUrl || !data?.webhookSecretSet) && (
        <p className="text-xs text-muted-foreground">Configure URL and generate a secret first to enable test pings.</p>
      )}

      <Dialog open={!!shownSecret} onOpenChange={() => setShownSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Save this secret NOW</DialogTitle>
            <DialogDescription>This is the only time we'll show the full secret. Copy it to your environment, then click Done.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <code className="block w-full bg-muted p-3 rounded font-mono text-xs break-all">{shownSecret}</code>
            <Button onClick={copy} variant="outline" size="sm" className="gap-1">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setShownSecret(null)}>I've saved it — done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "delivered" | "failed" | "abandoned">("all");
  const { data, isLoading } = useQuery<WebhookEvent[]>({
    queryKey: ["/api/company/webhook-events", filter],
    queryFn: async () => {
      const res = await fetch(`/api/company/webhook-events?status=${filter === "all" ? "" : filter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 10_000,
  });
  const [activeEvent, setActiveEvent] = useState<WebhookEvent | null>(null);

  const retry = async (id: number) => {
    try {
      await apiRequest("POST", `/api/company/webhook-events/${id}/retry`, {});
      toast({ title: "Re-queued" });
      qc.invalidateQueries({ queryKey: ["/api/company/webhook-events"] });
    } catch (err: any) {
      toast({ title: "Could not retry", description: err.message ?? "", variant: "destructive" });
    }
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin" />;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">No webhook events yet.</p>;

  return (
    <>
      <div className="flex gap-2 mb-3">
        {(["all", "pending", "delivered", "failed", "abandoned"] as const).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        {data.map((evt) => (
          <Card key={evt.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setActiveEvent(evt)}>
            <CardContent className="p-3 flex items-center gap-3">
              <StatusBadge status={evt.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm">{evt.eventType}</span>
                  <span className="text-xs text-muted-foreground">attempt {evt.attempts}/{evt.maxAttempts}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {evt.idempotencyKey} · {new Date(evt.createdAt).toLocaleString()}
                  {evt.lastError && ` · ${evt.lastError}`}
                </p>
              </div>
              {(evt.status === "failed" || evt.status === "abandoned") && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); retry(evt.id); }} className="gap-1">
                  <ZapOff className="w-3.5 h-3.5" /> Retry
                </Button>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!activeEvent} onOpenChange={() => setActiveEvent(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Event #{activeEvent?.id} — {activeEvent?.eventType}</DialogTitle>
            <DialogDescription className="text-xs">{activeEvent?.idempotencyKey}</DialogDescription>
          </DialogHeader>
          {activeEvent && (
            <div className="space-y-3 text-sm">
              <DetailRow label="Status"><StatusBadge status={activeEvent.status} /></DetailRow>
              <DetailRow label="Attempts">{activeEvent.attempts}/{activeEvent.maxAttempts}</DetailRow>
              <DetailRow label="URL"><code className="text-xs break-all">{activeEvent.url}</code></DetailRow>
              <DetailRow label="Created">{new Date(activeEvent.createdAt).toLocaleString()}</DetailRow>
              {activeEvent.deliveredAt && <DetailRow label="Delivered">{new Date(activeEvent.deliveredAt).toLocaleString()}</DetailRow>}
              {activeEvent.lastResponseStatus != null && <DetailRow label="Last response">HTTP {activeEvent.lastResponseStatus}</DetailRow>}
              {activeEvent.lastError && <DetailRow label="Error"><span className="text-destructive">{activeEvent.lastError}</span></DetailRow>}
              {activeEvent.lastResponseBody && (
                <div>
                  <p className="text-xs font-medium mb-1">Response body (truncated)</p>
                  <pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{activeEvent.lastResponseBody}</pre>
                </div>
              )}
              <div>
                <p className="text-xs font-medium mb-1">Payload</p>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(activeEvent.payload, null, 2)}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "delivered") return <Badge variant="default" className="bg-green-600">Delivered</Badge>;
  if (status === "pending") return <Badge variant="secondary">Pending</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline" className="text-destructive border-destructive">Abandoned</Badge>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

