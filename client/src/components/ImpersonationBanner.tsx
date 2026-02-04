import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useAdminStopImpersonate } from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";
import { Shield, X } from "lucide-react";

export function ImpersonationBanner() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const stopImpersonate = useAdminStopImpersonate();

  const isImpersonating = user?.impersonation?.isImpersonating === true;

  if (!isImpersonating) return null;

  const handleStop = async () => {
    try {
      await stopImpersonate.mutateAsync();
      navigate("/admin");
    } catch {
      navigate("/admin");
    }
  };

  return (
    <div className="sticky top-0 z-50 w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-4 shadow-sm">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Shield className="w-4 h-4" />
        Viewing as another user (admin impersonation)
      </span>
      <Button
        variant="outline"
        size="sm"
        className="bg-amber-600/20 border-amber-700 text-amber-950 hover:bg-amber-600/30"
        onClick={handleStop}
        disabled={stopImpersonate.isPending}
      >
        <X className="w-4 h-4 mr-1" />
        Stop & return to Admin
      </Button>
    </div>
  );
}
