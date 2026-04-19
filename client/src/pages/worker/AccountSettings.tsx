import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, invalidateSessionProfileQueries } from "@/hooks/use-profiles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MfaSettings } from "@/components/MfaSettings";
import { PrivacySettings } from "@/components/PrivacySettings";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { AdminAccessSettings } from "@/components/AdminAccessSettings";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { ScanFace, ChevronRight, FlaskConical } from "lucide-react";

const serviceCategories = [
  { id: "laborer", name: "Laborer", hasLevels: false },
  { id: "landscaping", name: "Landscaping", hasLevels: false },
  { id: "painting", name: "Painting", hasLevels: false },
  { id: "drywall", name: "Drywall", hasLevels: false },
  { id: "concrete", name: "Concrete", hasLevels: false },
  { id: "carpentry", name: "Carpentry", hasLevels: true },
  { id: "electrical", name: "Electrical", hasLevels: true },
  { id: "plumbing", name: "Plumbing", hasLevels: true },
  { id: "hvac", name: "HVAC", hasLevels: true },
];

export default function AccountSettings() {
  const { t } = useTranslation("accountSettings");
  const { t: tCommon } = useTranslation("common");
  const { user, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const { data: adminStatus } = useAdminStatus();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  useEffect(() => {
    if (profile?.serviceCategories) {
      setSelectedCategories(profile.serviceCategories);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (data: { serviceCategories: string[] }) => {
      return apiRequest("PUT", `/api/profiles/${profile?.id}`, data);
    },
    onSuccess: () => {
      toast({ title: t("skillsUpdated"), description: t("skillSetsSaved") });
      invalidateSessionProfileQueries(queryClient);
    },
    onError: () => {
      toast({ title: tCommon("error"), description: t("couldNotSaveChanges"), variant: "destructive" });
    },
  });

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({ serviceCategories: selectedCategories });
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard?tab=menu")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">{t("yourSkills")}</h2>
            <p className="text-muted-foreground mb-6">
              {t("selectAllServices")}
            </p>
          </div>

          <div className="space-y-4">
            {serviceCategories.map((category) => (
              <div key={category.id} className="space-y-3">
                {category.hasLevels ? (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-3 p-3 rounded-lg border border-border">
                      <Checkbox
                        id={`${category.id}-lite`}
                        checked={selectedCategories.includes(`${category.name} Lite`)}
                        onCheckedChange={() => toggleCategory(`${category.name} Lite`)}
                      />
                      <Label htmlFor={`${category.id}-lite`} className="flex-1 cursor-pointer">
                        <span className="font-medium">{category.name} {t("lite")}</span>
                        <span className="text-sm text-muted-foreground block">{t("upTo30hr")}</span>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 p-3 rounded-lg border border-border">
                      <Checkbox
                        id={`${category.id}-elite`}
                        checked={selectedCategories.includes(`${category.name} Elite`)}
                        onCheckedChange={() => toggleCategory(`${category.name} Elite`)}
                      />
                      <Label htmlFor={`${category.id}-elite`} className="flex-1 cursor-pointer">
                        <span className="font-medium">{category.name} {t("elite")}</span>
                        <span className="text-sm text-muted-foreground block">{t("upTo60hrCertified")}</span>
                      </Label>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center space-x-3 p-3 rounded-lg border border-border">
                    <Checkbox
                      id={category.id}
                      checked={selectedCategories.includes(category.name)}
                      onCheckedChange={() => toggleCategory(category.name)}
                    />
                    <Label htmlFor={category.id} className="flex-1 cursor-pointer">
                      <span className="font-medium">{category.name}</span>
                      <span className="text-sm text-muted-foreground block">{t("upTo30hr")}</span>
                    </Label>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={updateMutation.isPending}
            data-testid="button-save-skills"
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" /> {t("saveSkills")}
              </>
            )}
          </Button>
        </form>

        <div className="mt-10 pt-6 border-t border-border">
          <h2 className="text-xl font-semibold mb-2">Availability</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Tell us when you're available so companies don't offer you shifts you can't work.
          </p>
          <AvailabilityCalendar />
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <h2 className="text-xl font-semibold mb-4">Security</h2>
          <MfaSettings initiallyEnabled={(user as any)?.mfaEnabled === "true"} />
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <h2 className="text-xl font-semibold mb-4">Compliance &amp; consent</h2>
          <div className="space-y-2">
            <button
              onClick={() => setLocation("/account/background-check")}
              className="w-full flex items-center gap-3 py-3 px-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
              data-testid="link-background-check"
            >
              <ScanFace className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Background check (FCRA disclosure &amp; consent)</p>
                <p className="text-xs text-muted-foreground">Sign the disclosure to allow companies to order a background check.</p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </button>

            <DrugScreensLink />
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <h2 className="text-xl font-semibold mb-4">Privacy &amp; Data</h2>
          <PrivacySettings />
        </div>

        {adminStatus?.isSuperAdmin && (
          <div className="mt-10 pt-6 border-t border-border">
            <h2 className="text-xl font-semibold mb-2">Admin Access</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Visible only to super-admins. Grant or revoke admin access for other users.
            </p>
            <AdminAccessSettings />
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Self-attest drug screen entry. Polls /api/worker/drug-screens for an
 * unread-style count badge so the worker sees pending orders without
 * navigating in. We don't render a dedicated worker-side drug screen page
 * yet — clicking takes them to a placeholder that lists statuses.
 */
function DrugScreensLink() {
  const [, setLocation] = useLocation();
  const { data } = useQuery<any[]>({
    queryKey: ["/api/worker/drug-screens"],
    queryFn: async () => {
      const res = await fetch("/api/worker/drug-screens", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const pendingCount = (data ?? []).filter((d) => d.status === "pending" || d.status === "in_progress").length;
  const completedCount = (data ?? []).filter((d) => String(d.status).startsWith("completed")).length;
  const description = !data || data.length === 0
    ? "No drug screens on file. Companies can request one — you'll get an email."
    : `${pendingCount} active · ${completedCount} completed`;

  return (
    <button
      onClick={() => setLocation("/dashboard/settings/drug-screens")}
      className="w-full flex items-center gap-3 py-3 px-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
      data-testid="link-drug-screens"
    >
      <FlaskConical className="w-5 h-5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Drug screens</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

