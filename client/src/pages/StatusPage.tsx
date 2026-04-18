import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface StatusResponse {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  version: string;
  checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}

const PRETTY: Record<string, string> = {
  database: "Database (Postgres)",
  secretsManager: "Secret Manager",
  stripe: "Stripe (payments)",
  email: "Email (Resend)",
  objectStorage: "Object storage (IDrive E2)",
  mercury: "Mercury (worker payouts)",
};

export default function StatusPage() {
  const { data, isLoading, refetch } = useQuery<StatusResponse>({
    queryKey: ["/api/status"],
    queryFn: async () => {
      const res = await fetch("/api/status");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="text-sm text-primary hover:underline">← Back to home</Link>
        <h1 className="text-3xl font-bold mt-3 mb-1">Tolstoy Staffing — System Status</h1>
        <p className="text-sm text-muted-foreground mb-6">Live read-out of platform health. Refreshes every 30 seconds.</p>

        <div className="mb-6">
          {isLoading ? (
            <Card><CardContent className="p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking status…</CardContent></Card>
          ) : data ? (
            <Card className={
              data.status === "ok" ? "border-green-500/50 bg-green-500/5" :
              data.status === "degraded" ? "border-amber-500/50 bg-amber-500/5" :
              "border-destructive/50 bg-destructive/5"
            }>
              <CardContent className="p-4 flex items-center gap-3">
                {data.status === "ok"
                  ? <CheckCircle className="w-6 h-6 text-green-600" />
                  : <XCircle className="w-6 h-6 text-amber-600" />}
                <div className="flex-1">
                  <p className="font-semibold">
                    {data.status === "ok" ? "All systems operational" : data.status === "degraded" ? "Some systems degraded" : "Major outage"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last updated {new Date(data.timestamp).toLocaleTimeString()}{data.version !== "dev" ? ` · build ${data.version.slice(0, 7)}` : ""}
                  </p>
                </div>
                <button onClick={() => refetch()} className="text-xs text-primary hover:underline">Refresh</button>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {data && (
          <div className="space-y-2">
            {Object.entries(data.checks).map(([key, check]) => (
              <Card key={key}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {check.ok ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-destructive" />}
                    <span className="text-sm font-medium">{PRETTY[key] ?? key}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {check.latencyMs != null && <span className="text-xs text-muted-foreground tabular-nums">{check.latencyMs}ms</span>}
                    <Badge variant={check.ok ? "default" : "destructive"}>{check.ok ? "Operational" : "Down"}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-8">
          Looking for incident history or subscribe-to-updates?{" "}
          <a className="underline" href="mailto:support@tolstoystaffing.com">Email support</a> or follow us at{" "}
          <a className="underline" href="https://twitter.com/tolstoystaffing">@tolstoystaffing</a>.
        </p>
      </div>
    </div>
  );
}
