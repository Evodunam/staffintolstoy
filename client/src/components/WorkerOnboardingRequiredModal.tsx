import { useEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useCreateProfile, useUpdateProfile } from "@/hooks/use-profiles";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";
import { fetchAffiliateMe } from "@/lib/queryClient";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, ChevronLeft, ChevronRight, User, Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { z } from "zod";

const WIZARD_STEPS = 5;
const step1Schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(10, "Valid phone number required"),
});
const step3Schema = z.object({
  serviceCategories: z.array(z.string()).min(1, "Select at least one service category"),
});

/**
 * Global lock modal for workers: shown only when the user is logged in as a worker
 * but their profile is missing any of the required onboarding fields (name, email,
 * phone, face photo, at least one skill, hourly rate, bank account). They may
 * already have most of their account info—the lock applies until all global
 * requirements are met. Intro screen + "Complete account setup" opens the in-modal
 * wizard (personal → photo → categories → rate → bank) with no redirect.
 */
export function WorkerOnboardingRequiredModal() {
  const [path, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const { data: affiliate } = useQuery({
    queryKey: ["/api/affiliates/me"],
    queryFn: fetchAffiliateMe,
    retry: false,
    enabled: isAuthenticated && !!user?.id,
  });
  const [wizardOpen, setWizardOpen] = useState(false);

  const isWorkerOnboardingPath =
    path === "/worker-onboarding" || path.startsWith("/worker-onboarding");
  const isAffiliatePath =
    path === "/affiliate-onboarding" ||
    path.startsWith("/affiliate-onboarding") ||
    path === "/affiliate-dashboard";
  const isCompanyPath =
    path === "/company-onboarding" ||
    path.startsWith("/company-onboarding") ||
    path === "/company-dashboard";

  const isAffiliate = affiliate != null && typeof affiliate === "object";
  const isCompany = profile?.role === "company";

  const userType =
    user && "userType" in user
      ? (user as { userType?: string }).userType
      : (user as { user_type?: string } | null)?.user_type;
  const isWorker =
    profile != null ? profile.role === "worker" : userType === "worker";
  const needsOnboarding =
    profile == null || !isWorkerOnboardingComplete(profile);

  // Only when: logged in, profile loaded, is worker, and missing any global requirements
  const show =
    isAuthenticated &&
    !authLoading &&
    !profileLoading &&
    isWorker &&
    needsOnboarding &&
    !isWorkerOnboardingPath &&
    !isAffiliatePath &&
    !isAffiliate &&
    !isCompanyPath &&
    !isCompany;

  if (isWorkerOnboardingPath || !show) {
    return null;
  }

  return (
    <WorkerOnboardingModalPortal
      wizardOpen={wizardOpen}
      onOpenWizard={() => setWizardOpen(true)}
      profile={profile}
      user={user}
    />
  );
}

/** Custom modal content: intro or multi-step wizard. */
function WorkerOnboardingModalPortal({
  wizardOpen,
  onOpenWizard,
  profile,
  user,
}: {
  wizardOpen: boolean;
  onOpenWizard: () => void;
  profile: Record<string, unknown> | null | undefined;
  user: { id: string; email?: string; firstName?: string; lastName?: string } | null;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;
  const container = document.getElementById("dialog-container") ?? document.body;

  const content = wizardOpen ? (
    <WorkerOnboardingWizard profile={profile} user={user} />
  ) : (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertCircle className="h-5 w-5" />
          </div>
          <h2
            id="worker-onboarding-modal-title"
            className="text-lg font-semibold leading-none tracking-tight text-left"
          >
            Complete your account setup
          </h2>
        </div>
        <p
          id="worker-onboarding-modal-desc"
          className="text-sm text-muted-foreground text-left pt-1"
        >
          You need to finish setting up your worker account before you can use the
          app. This includes your name, contact info, photo, skills, pay rate, and
          payout details.
        </p>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4">
        <Button onClick={onOpenWizard} className="w-full sm:w-auto">
          Complete account setup
        </Button>
      </div>
    </div>
  );

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worker-onboarding-modal-title"
      aria-describedby="worker-onboarding-modal-desc"
    >
      <div
        className="fixed inset-0 bg-black/80"
        aria-hidden
        onPointerDown={(e) => e.preventDefault()}
      />
      <div
        className={cn(
          "relative z-[201] grid w-full max-w-lg max-h-[90vh] overflow-y-auto gap-4 border border-border bg-background p-[21pt] shadow-lg rounded-2xl pointer-events-auto",
          "sm:max-w-md"
        )}
      >
        {content}
      </div>
    </div>,
    container
  );
}

/** Multi-step wizard: personal → photo → categories → rate → bank. */
function WorkerOnboardingWizard({
  profile: profileInitial,
  user,
}: {
  profile: Record<string, unknown> | null | undefined;
  user: { id: string; email?: string; firstName?: string; lastName?: string } | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: profileData } = useProfile(user?.id);
  const profile = profileData ?? profileInitial;
  const { mutateAsync: createProfile } = useCreateProfile();
  const { mutateAsync: updateProfile } = useUpdateProfile();
  const { uploadFile } = useUpload();
  const profileId = profile && typeof profile.id === "number" ? profile.id : null;

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState(
    (profile?.firstName as string) || (user?.firstName as string) || ""
  );
  const [lastName, setLastName] = useState(
    (profile?.lastName as string) || (user?.lastName as string) || ""
  );
  const [email, setEmail] = useState(
    (profile?.email as string) || (user?.email as string) || ""
  );
  const [phone, setPhone] = useState((profile?.phone as string) || "");
  const [avatarUrl, setAvatarUrl] = useState((profile?.avatarUrl as string) || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [serviceCategories, setServiceCategories] = useState<string[]>(
    (profile?.serviceCategories as string[]) || []
  );
  const [hourlyRate, setHourlyRate] = useState(
    (profile?.hourlyRate as number) ?? 15
  );
  const [bankAccount, setBankAccount] = useState({
    routingNumber: "",
    accountNumber: "",
    confirmAccountNumber: "",
    accountType: "checking" as "checking" | "savings",
    bankName: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const connectBankMutation = useMutation({
    mutationFn: async (data: {
      routingNumber: string;
      accountNumber: string;
      accountType: string;
      bankName: string;
      recipientType?: string;
      email?: string;
    }) => {
      const response = await apiRequest("POST", "/api/mt/worker/payout-account", data);
      return response.json();
    },
  });

  const handleCategoryToggle = useCallback((roleId: string, checked: boolean) => {
    setServiceCategories((prev) => {
      const baseName = roleId.replace(" Lite", "").replace(" Elite", "");
      const isLite = roleId.includes("Lite");
      const isElite = roleId.includes("Elite");
      if (isLite || isElite) {
        const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
        prev = prev.filter((c) => c !== oppositeId);
      }
      if (checked) return [...prev, roleId];
      return prev.filter((c) => c !== roleId);
    });
  }, []);

  const validateStep1 = () => {
    const result = step1Schema.safeParse({
      firstName,
      lastName,
      email,
      phone,
    });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.flatten().fieldErrors &&
        Object.entries(result.error.flatten().fieldErrors).forEach(([k, v]) => {
          if (v?.[0]) fieldErrors[k] = v[0];
        });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const validateStep3 = () => {
    const result = step3Schema.safeParse({ serviceCategories });
    if (!result.success) {
      toast({ title: "Please select at least one service category", variant: "destructive" });
      return false;
    }
    return true;
  };

  const validateBank = () => {
    const r = bankAccount.routingNumber.replace(/\D/g, "");
    const a = bankAccount.accountNumber.replace(/\D/g, "");
    const c = bankAccount.confirmAccountNumber.replace(/\D/g, "");
    if (r.length !== 9) {
      toast({ title: "Invalid routing number", variant: "destructive" });
      return false;
    }
    if (a.length < 4) {
      toast({ title: "Enter a valid account number", variant: "destructive" });
      return false;
    }
    if (a !== c) {
      toast({ title: "Account numbers do not match", variant: "destructive" });
      return false;
    }
    return true;
  };

  const saveStep1 = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const data = {
        userId: user.id,
        role: "worker" as const,
        firstName,
        lastName,
        email: email.trim().toLowerCase(),
        phone,
        onboardingStep: 2,
        onboardingStatus: "incomplete" as const,
      };
      if (profileId) {
        await updateProfile({ id: profileId, data, skipToast: true });
      } else {
        await createProfile({ ...data, skipToast: true } as Parameters<typeof createProfile>[0]);
      }
      await qc.invalidateQueries({ queryKey: ["/api/profiles", user.id] });
      setStep(2);
    } catch (e: unknown) {
      toast({
        title: profileId ? "Error saving profile" : "Error creating profile",
        description: e instanceof Error ? e.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveStep2 = async () => {
    if (!profileId && !user?.id) return;
    if (!avatarUrl && !avatarPreview) {
      toast({ title: "Please add a photo", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const urlToSave = avatarUrl || avatarPreview || "";
      if (profileId) {
        await updateProfile({
          id: profileId,
          data: { avatarUrl: urlToSave, faceVerified: true },
          skipToast: true,
        });
      }
      await qc.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      setStep(3);
    } catch (e: unknown) {
      toast({
        title: "Error saving photo",
        description: e instanceof Error ? e.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveStep3 = async () => {
    if (!profileId) return;
    setSaving(true);
    try {
      await updateProfile({
        id: profileId,
        data: { serviceCategories },
        skipToast: true,
      });
      await qc.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      setStep(4);
    } catch (e: unknown) {
      toast({
        title: "Error saving categories",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveStep4 = async () => {
    if (!profileId) return;
    if (hourlyRate == null || hourlyRate < 0 || hourlyRate > 60) {
      toast({ title: "Set an hourly rate between $0 and $60", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        id: profileId,
        data: { hourlyRate },
        skipToast: true,
      });
      await qc.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      setStep(5);
    } catch (e: unknown) {
      toast({
        title: "Error saving rate",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveStep5 = async () => {
    if (!profileId || !user?.id) return;
    if (!validateBank()) return;
    setSaving(true);
    try {
      await connectBankMutation.mutateAsync({
        routingNumber: bankAccount.routingNumber.replace(/\D/g, ""),
        accountNumber: bankAccount.accountNumber.replace(/\D/g, ""),
        accountType: bankAccount.accountType,
        bankName: bankAccount.bankName || "Bank",
        recipientType: "business",
        email: email || (user?.email as string),
      });
      await qc.invalidateQueries({ queryKey: ["/api/profiles", user.id] });
      await qc.invalidateQueries({ queryKey: ["/api/mt/worker/payout-accounts"] });
      toast({ title: "Account setup complete", description: "You can now use the app." });
      // Invalidate so parent re-renders and modal closes (isWorkerOnboardingComplete becomes true)
      await qc.invalidateQueries({ queryKey: ["/api/profiles"] });
      await qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (e: unknown) {
      toast({
        title: "Bank connection failed",
        description: e instanceof Error ? e.message : "Try again later.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onNext = () => {
    if (step === 1) {
      if (!validateStep1()) return;
      saveStep1();
    } else if (step === 2) saveStep2();
    else if (step === 3) {
      if (!validateStep3()) return;
      saveStep3();
    } else if (step === 4) saveStep4();
    else if (step === 5) saveStep5();
  };

  const onBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadFile(file as File, "avatar");
      if (res?.objectPath) {
        setAvatarUrl(res.objectPath);
        setAvatarPreview(res.objectPath.startsWith("http") ? res.objectPath : `${window.location.origin}${res.objectPath}`);
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  const progress = (step / WIZARD_STEPS) * 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Account setup</h2>
        <span className="text-sm text-muted-foreground">
          Step {step} of {WIZARD_STEPS}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step 1: Personal info */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Your name and contact details.</p>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="wizard-firstName">First name</Label>
                <Input
                  id="wizard-firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  className={errors.firstName ? "border-destructive" : ""}
                />
                {errors.firstName && (
                  <p className="text-xs text-destructive mt-0.5">{errors.firstName}</p>
                )}
              </div>
              <div>
                <Label htmlFor="wizard-lastName">Last name</Label>
                <Input
                  id="wizard-lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className={errors.lastName ? "border-destructive" : ""}
                />
                {errors.lastName && (
                  <p className="text-xs text-destructive mt-0.5">{errors.lastName}</p>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="wizard-email">Email</Label>
              <Input
                id="wizard-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && (
                <p className="text-xs text-destructive mt-0.5">{errors.email}</p>
              )}
            </div>
            <div>
              <Label htmlFor="wizard-phone">Phone</Label>
              <Input
                id="wizard-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 000-0000"
                className={errors.phone ? "border-destructive" : ""}
              />
              {errors.phone && (
                <p className="text-xs text-destructive mt-0.5">{errors.phone}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Photo */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">A clear photo of your face for verification.</p>
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleAvatarFile}
            />
            {(avatarPreview || avatarUrl) ? (
              <img
                src={avatarPreview || (avatarUrl.startsWith("http") ? avatarUrl : `${window.location.origin}${avatarUrl}`)}
                alt=""
                className="w-24 h-24 rounded-full object-cover"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
                <User className="w-12 h-12 text-muted-foreground" />
              </div>
            )}
            <span className="text-sm font-medium flex items-center gap-1">
              <Upload className="w-4 h-4" />
              {avatarPreview || avatarUrl ? "Change photo" : "Upload photo"}
            </span>
          </label>
        </div>
      )}

      {/* Step 3: Categories */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Select at least one service you offer.</p>
          <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
            {INDUSTRY_CATEGORIES.map((industry) =>
              industry.roles.map((role) => {
                const isSelected = serviceCategories.includes(role.id);
                const RoleIcon = role.icon;
                return (
                  <label
                    key={role.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                      isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(c) => handleCategoryToggle(role.id, !!c)}
                    />
                    <RoleIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{role.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Step 4: Rate */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Your hourly rate ($0–$60).</p>
          <div className="text-center py-2">
            <span className="text-2xl font-bold">${hourlyRate}/hr</span>
          </div>
          <Slider
            value={[hourlyRate]}
            onValueChange={([v]) => setHourlyRate(v ?? 15)}
            min={0}
            max={60}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>$0</span>
            <span>$60</span>
          </div>
        </div>
      )}

      {/* Step 5: Bank */}
      {step === 5 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Connect your bank account for payouts.</p>
          <div className="grid gap-3">
            <div>
              <Label>Routing number</Label>
              <Input
                value={bankAccount.routingNumber}
                onChange={(e) =>
                  setBankAccount((b) => ({ ...b, routingNumber: e.target.value.replace(/\D/g, "").slice(0, 9) }))
                }
                placeholder="9 digits"
                maxLength={9}
              />
            </div>
            <div>
              <Label>Account number</Label>
              <Input
                type="password"
                value={bankAccount.accountNumber}
                onChange={(e) =>
                  setBankAccount((b) => ({ ...b, accountNumber: e.target.value.replace(/\D/g, "") }))
                }
                placeholder="Account number"
              />
            </div>
            <div>
              <Label>Confirm account number</Label>
              <Input
                type="password"
                value={bankAccount.confirmAccountNumber}
                onChange={(e) =>
                  setBankAccount((b) => ({ ...b, confirmAccountNumber: e.target.value.replace(/\D/g, "") }))
                }
                placeholder="Confirm account number"
              />
            </div>
            <div>
              <Label>Bank name (optional)</Label>
              <Input
                value={bankAccount.bankName}
                onChange={(e) => setBankAccount((b) => ({ ...b, bankName: e.target.value }))}
                placeholder="e.g. Chase"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-4">
        {step > 1 && (
          <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        )}
        <Button
          type="button"
          onClick={onNext}
          disabled={saving}
          className={cn(step === 1 ? "w-full" : "flex-1")}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : step === 5 ? (
            "Finish"
          ) : (
            "Next"
          )}
          {!saving && step < 5 && <ChevronRight className="w-4 h-4 ml-1" />}
        </Button>
      </div>
    </div>
  );
}
