import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DevServerStatus() {
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Only show in development
    if (import.meta.env.PROD) {
      setServerOnline(true);
      setChecking(false);
      return;
    }

    let pollMs = 5000;
    let timeoutId: ReturnType<typeof setTimeout>;
    const cancelledRef = { current: false };

    // Check if dev server is running by trying to fetch a public health endpoint
    const checkServer = async () => {
      try {
        const response = await fetch("/api/health", {
          method: "GET",
          credentials: "include",
          signal: AbortSignal.timeout(2000),
        });
        if (cancelledRef.current) return;
        setServerOnline(true);
        pollMs = 5000; // reset to normal when online
      } catch (error: any) {
        if (cancelledRef.current) return;
        if (
          error.name === "AbortError" ||
          error.message?.includes("fetch") ||
          error.message?.includes("Failed to fetch") ||
          error.message?.includes("Connection refused") ||
          error.message?.includes("NetworkError")
        ) {
          setServerOnline(false);
          // When server is down (e.g. restart), poll less often to avoid console spam
          pollMs = 15000;
        } else {
          setServerOnline(true);
        }
      } finally {
        if (!cancelledRef.current) setChecking(false);
      }
    };

    const scheduleNext = () => {
      if (cancelledRef.current) return;
      timeoutId = setTimeout(async () => {
        await checkServer();
        scheduleNext();
      }, pollMs);
    };

    // Initial check after a short delay (gives server time to come back after restart)
    timeoutId = setTimeout(() => {
      if (cancelledRef.current) return;
      checkServer();
      scheduleNext();
    }, 2000);

    return () => {
      cancelledRef.current = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // Don't show anything if server is online or we're still checking
  if (checking || serverOnline) {
    return null;
  }

  // Show error banner if server is offline
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-destructive text-destructive-foreground p-4 shadow-lg">
      <Card className="border-destructive bg-destructive text-destructive-foreground">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <CardTitle className="text-lg">Development Server Not Running</CardTitle>
          </div>
          <CardDescription className="text-destructive-foreground/80">
            The Vite development server is not running. Please start it to use the application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm">
              To start the development server, run:
            </p>
            <code className="block bg-destructive-foreground/20 p-2 rounded text-sm font-mono">
              npm run dev
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.location.reload()}
              className="mt-2"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
