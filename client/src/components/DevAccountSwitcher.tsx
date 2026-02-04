import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Users, UserCog, ClipboardList, Building2, HardHat, Link2, ChevronRight, LogOut, Shield } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface TestAccount {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export function DevAccountSwitcher() {
  const [testAccounts, setTestAccounts] = useState<TestAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Check if we're on localhost
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.port === '2000'
  );

  useEffect(() => {
    if (isLocalhost) {
      fetch("/api/dev/test-accounts")
        .then((res) => res.json())
        .then((data) => setTestAccounts(data || []))
        .catch(() => setTestAccounts([]));
    }
  }, [isLocalhost]);

  const handleSwitchAccount = async (userId: string) => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/dev/switch-user", { userId });
      const data = await res.json();
      if (data.success) {
        // Check if profile exists
        if (!data.hasProfile) {
          toast({
            title: "Account Switched",
            description: `Logged in as ${data.email}, but profile not found. You may need to complete onboarding.`,
            variant: "default",
          });
        } else {
          toast({
            title: "Switched Account",
            description: `Now logged in as ${data.email} (${data.role})`,
          });
        }
        
        // Invalidate all queries to clear cached data
        queryClient.clear();
        
        // Wait a bit longer to ensure session is saved server-side
        setTimeout(() => {
          // Force a hard reload to ensure fresh session
          window.location.href = window.location.href.split('#')[0];
        }, 300);
      } else {
        throw new Error(data.message || "Failed to switch account");
      }
    } catch (error: any) {
      console.error("Account switch error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to switch account",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleLoginAsTestAffiliate = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/dev/create-test-affiliate", {});
      const data = await res.json();
      if (data.success) {
        toast({
          title: "Test Affiliate",
          description: `Logged in as ${data.email}. Redirecting to Affiliate Dashboard.`,
        });
        queryClient.clear();
        setTimeout(() => {
          window.location.href = "/affiliate-dashboard";
        }, 300);
      } else {
        throw new Error(data.message || "Failed to create test affiliate");
      }
    } catch (error: any) {
      console.error("Create test affiliate error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create test affiliate",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleSwitchBack = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/dev/switch-back", {});
      const data = await res.json();
      if (data.success) {
        toast({
          title: "Logged Out",
          description: "Switched back to main account. Please log in again.",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        setTimeout(() => {
          window.location.href = "/";
        }, 100);
      } else {
        throw new Error(data.message || "Failed to switch back");
      }
    } catch (error: any) {
      console.error("Switch back error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to switch back",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Always show on localhost, even if no accounts yet
  if (!isLocalhost) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-dashed border-orange-500 text-orange-600"
          disabled={isLoading}
          data-testid="button-dev-switcher"
        >
          <UserCog className="h-4 w-4" />
          <span className="hidden sm:inline">Dev Mode</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <Collapsible open={accountsOpen} onOpenChange={setAccountsOpen}>
          <CollapsibleTrigger asChild>
            <div
              className="flex items-center justify-between w-full px-2 py-2 text-sm font-medium cursor-pointer hover-elevate rounded-md"
              data-testid="accordion-test-accounts"
            >
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Switch Test Account
              </div>
              <ChevronRight className={`h-4 w-4 transition-transform ${accountsOpen ? 'rotate-90' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-2">
            {testAccounts.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                No accounts found. Create an account to see it here.
              </div>
            ) : (
              testAccounts.map((account) => (
                <DropdownMenuItem
                  key={account.userId}
                  onClick={() => handleSwitchAccount(account.userId)}
                  data-testid={`menu-item-switch-${account.userId}`}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {account.firstName} {account.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {account.role} - {account.email}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </CollapsibleContent>
        </Collapsible>

        <DropdownMenuSeparator />

        <Collapsible open={onboardingOpen} onOpenChange={setOnboardingOpen}>
          <CollapsibleTrigger asChild>
            <div
              className="flex items-center justify-between w-full px-2 py-2 text-sm font-medium cursor-pointer hover-elevate rounded-md"
              data-testid="accordion-onboarding"
            >
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Test Onboarding Flows
              </div>
              <ChevronRight className={`h-4 w-4 transition-transform ${onboardingOpen ? 'rotate-90' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-2">
            <DropdownMenuItem
              onClick={() => setLocation("/worker-onboarding")}
              data-testid="menu-item-worker-onboarding"
            >
              <HardHat className="h-4 w-4 mr-2" />
              Worker Onboarding
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setLocation("/company-onboarding")}
              data-testid="menu-item-company-onboarding"
            >
              <Building2 className="h-4 w-4 mr-2" />
              Company Onboarding
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setLocation("/affiliate-onboarding")}
              data-testid="menu-item-affiliate-onboarding"
            >
              <Link2 className="h-4 w-4 mr-2" />
              Affiliate Onboarding
            </DropdownMenuItem>
          </CollapsibleContent>
        </Collapsible>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => setLocation("/admin")}
          data-testid="menu-item-admin-panel"
        >
          <Shield className="h-4 w-4 mr-2" />
          Admin Panel
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleLoginAsTestAffiliate}
          data-testid="menu-item-test-affiliate"
        >
          <Link2 className="h-4 w-4 mr-2" />
          Login as test affiliate
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleSwitchBack}
          className="text-muted-foreground"
          data-testid="menu-item-switch-back"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log out & switch back
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
