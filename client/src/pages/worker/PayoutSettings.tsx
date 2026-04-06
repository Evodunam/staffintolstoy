import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, PROFILE_ME_QUERY_KEY_PREFIX } from "@/hooks/use-profiles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { api } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Building2, Plus, Check, AlertCircle, DollarSign, Zap } from "lucide-react";
import type { PayoutAccount } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useTimesheetApprovalInvoice } from "@/contexts/TimesheetApprovalInvoiceContext";
import { showClientDevTools } from "@/lib/is-local-dev-host";

const BACK_URL = "/dashboard/menu";

/** Embeddable bank/payout content for menu right panel or standalone page. */
export function PayoutSettingsContent({ embedded = false, openBankDialogOnMount = false }: { embedded?: boolean; openBankDialogOnMount?: boolean }) {
  const { t } = useTranslation("payoutSettings");
  const { t: tCommon } = useTranslation("common");
  const { user, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const openedBankFromUrlRef = useRef(false);
  const openedTimesheetFromQueryRef = useRef(false);
  const { openTimesheetApprovalInvoice } = useTimesheetApprovalInvoice();

  const { data: payoutAccounts = [], isLoading: payoutAccountsLoading } = useQuery<PayoutAccount[]>({
    queryKey: ["/api/mt/worker/payout-accounts"],
    enabled: !!profile,
  });

  const [showBankDialog, setShowBankDialog] = useState(false);
  const shouldOpenBankOnMount = embedded ? openBankDialogOnMount : (typeof searchParams === "string" && searchParams.includes("openBank=1"));
  useEffect(() => {
    if (shouldOpenBankOnMount && !openedBankFromUrlRef.current) {
      openedBankFromUrlRef.current = true;
      setShowBankDialog(true);
    }
  }, [shouldOpenBankOnMount]);

  useEffect(() => {
    if (typeof searchParams !== "string" || openedTimesheetFromQueryRef.current) return;
    const raw = searchParams.startsWith("?") ? searchParams.slice(1) : searchParams;
    if (!raw.includes("timesheetId=")) return;
    const params = new URLSearchParams(raw);
    const idStr = params.get("timesheetId");
    const id = idStr ? parseInt(idStr, 10) : NaN;
    if (!Number.isFinite(id) || id <= 0) return;
    openedTimesheetFromQueryRef.current = true;
    openTimesheetApprovalInvoice(id);
    setLocation("/dashboard/settings/payouts");
  }, [searchParams, openTimesheetApprovalInvoice, setLocation]);
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<string>("checking");
  const [recipientType, setRecipientType] = useState<string>("business"); // hidden: "person" or "business", default business
  const [bankName, setBankName] = useState("");
  const [routingNumberError, setRoutingNumberError] = useState<string>("");
  const [accountNumberError, setAccountNumberError] = useState<string>("");
  const [confirmAccountNumberError, setConfirmAccountNumberError] = useState<string>("");

  const connectBankMutation = useMutation({
    mutationFn: async (data: { routingNumber: string; accountNumber: string; accountType: string; bankName: string; recipientType: string; email?: string }) => {
      console.log("[PayoutSettings] Submitting bank account (POST /api/mt/worker/payout-account)", { bankName: data.bankName, accountType: data.accountType, routingLast4: data.routingNumber?.slice(-4) });
      const response = await apiRequest("POST", "/api/mt/worker/payout-account", data);
      const json = await response.json();
      console.log("[PayoutSettings] Payout-account response", { ok: response.ok, mercuryRecipientId: json?.mercuryRecipientId ?? json?.recipientId, bankAccountLinked: json?.bankAccountLinked, profileId: json?.profileId });
      return json;
    },
    onSuccess: (data: { mercuryRecipientId?: string; recipientId?: string; bankAccountLinked?: boolean }) => {
      console.log("[PayoutSettings] Bank connect success – invalidating profile, payout-accounts, w9-status. Response had mercuryRecipientId:", data?.mercuryRecipientId ?? data?.recipientId, "bankAccountLinked:", data?.bankAccountLinked);
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && (key[0] === api.profiles.get.path || key[0] === PROFILE_ME_QUERY_KEY_PREFIX || key[0] === "/api/mt/worker/payout-accounts" || key[0] === "/api/worker/w9-status");
        },
      });
      setShowBankDialog(false);
      setRoutingNumber("");
      setAccountNumber("");
      setConfirmAccountNumber("");
      setBankName("");
      setRoutingNumberError("");
      setAccountNumberError("");
      setConfirmAccountNumberError("");
      toast({ title: t("bankAccountConnected"), description: t("bankAccountLinkedForACH") });
    },
    onError: (error: Error) => {
      console.error("[PayoutSettings] Bank connect error", error?.message ?? error);
      toast({ title: t("connectionFailed"), description: error.message || t("failedToConnectBankAccount"), variant: "destructive" });
    },
  });

  const updateInstantPayoutMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await apiRequest("PUT", api.profiles.update.path.replace(":id", profile!.id.toString()), {
        instantPayoutEnabled: enabled,
      });
      const data = await response.json();
      return { enabled, ...data };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && (key[0] === api.profiles.get.path || key[0] === PROFILE_ME_QUERY_KEY_PREFIX);
        },
      });
      toast({ 
        title: data.enabled ? t("instantPayoutEnabled", "Instant Payouts Enabled") : t("instantPayoutDisabled", "Instant Payouts Disabled"),
        description: data.enabled 
          ? t("instantPayoutEnabledDescription", "Your payments will be processed instantly with a 1% + $0.30 fee per payment.")
          : t("instantPayoutDisabledDescription", "Your payments will use standard ACH timing (1-2 business days) with no fees.")
      });
    },
    onError: (error: Error) => {
      toast({ title: t("updateFailed", "Update Failed"), description: error.message || t("failedToUpdateSettings", "Failed to update settings"), variant: "destructive" });
    },
  });

  const handleInstantPayoutToggle = (enabled: boolean) => {
    updateInstantPayoutMutation.mutate(enabled);
  };

  // Validate US routing number using mod 10 checksum algorithm. Allow 123456789 as dev test route.
  const validateRoutingNumber = (routing: string): { isValid: boolean; error: string } => {
    const digits = routing.replace(/\D/g, "");
    if (digits.length !== 9) {
      return { isValid: false, error: "Routing number must be exactly 9 digits" };
    }
    if (digits === "123456789") return { isValid: true, error: "" }; // Dev test route (skips Mercury in non-production)
    // Mod 10 checksum: (3*d1 + 7*d2 + 1*d3 + 3*d4 + 7*d5 + 1*d6 + 3*d7 + 7*d8 + 1*d9) mod 10 = 0
    const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(digits[i]) * weights[i];
    }
    if (sum % 10 !== 0) {
      return { isValid: false, error: "Invalid routing number. Please check and try again." };
    }
    return { isValid: true, error: "" };
  };

  // Validate account number
  const validateAccountNumber = (account: string): { isValid: boolean; error: string } => {
    const digits = account.replace(/\D/g, "");
    
    if (digits.length < 4) {
      return { isValid: false, error: "Account number must be at least 4 digits" };
    }
    
    if (digits.length > 17) {
      return { isValid: false, error: "Account number must be 17 digits or less" };
    }
    
    // Account numbers typically range from 4-17 digits
    if (digits.length < 4 || digits.length > 17) {
      return { isValid: false, error: "Account number must be between 4 and 17 digits" };
    }
    
    return { isValid: true, error: "" };
  };

  const handleRoutingNumberChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 9);
    setRoutingNumber(digits);
    
    if (digits.length === 9) {
      const validation = validateRoutingNumber(digits);
      setRoutingNumberError(validation.error);
    } else if (digits.length > 0) {
      setRoutingNumberError("Routing number must be exactly 9 digits");
    } else {
      setRoutingNumberError("");
    }
  };

  const handleAccountNumberChange = (value: string) => {
    const digits = value.replace(/\D/g, "");
    setAccountNumber(digits);
    
    if (digits.length > 0) {
      const validation = validateAccountNumber(digits);
      setAccountNumberError(validation.error);
    } else {
      setAccountNumberError("");
    }
    
    // Also validate confirmation if it's already entered
    if (confirmAccountNumber && digits !== confirmAccountNumber.replace(/\D/g, "")) {
      setConfirmAccountNumberError("Account numbers do not match");
    } else if (confirmAccountNumber) {
      setConfirmAccountNumberError("");
    }
  };

  const handleConfirmAccountNumberChange = (value: string) => {
    const digits = value.replace(/\D/g, "");
    setConfirmAccountNumber(digits);
    
    if (digits.length > 0 && accountNumber) {
      const accountDigits = accountNumber.replace(/\D/g, "");
      if (digits !== accountDigits) {
        setConfirmAccountNumberError("Account numbers do not match");
      } else {
        setConfirmAccountNumberError("");
      }
    } else {
      setConfirmAccountNumberError("");
    }
  };

  const handleConnectBank = () => {
    // Clear previous errors
    setRoutingNumberError("");
    setAccountNumberError("");
    setConfirmAccountNumberError("");
    
    // Validate routing number
    const routingValidation = validateRoutingNumber(routingNumber);
    if (!routingValidation.isValid) {
      setRoutingNumberError(routingValidation.error);
      toast({ title: t("invalidRoutingNumber"), description: routingValidation.error, variant: "destructive" });
      return;
    }
    
    // Validate account number
    const accountValidation = validateAccountNumber(accountNumber);
    if (!accountValidation.isValid) {
      setAccountNumberError(accountValidation.error);
      toast({ title: t("invalidAccountNumber", "Invalid Account Number"), description: accountValidation.error, variant: "destructive" });
      return;
    }
    
    // Validate account numbers match
    const accountDigits = accountNumber.replace(/\D/g, "");
    const confirmDigits = confirmAccountNumber.replace(/\D/g, "");
    if (accountDigits !== confirmDigits) {
      setConfirmAccountNumberError("Account numbers do not match");
      toast({ title: t("accountNumbersDontMatch"), description: t("pleaseMakeSureAccountNumbersMatch"), variant: "destructive" });
      return;
    }
    
    // All validations passed
    console.log("[PayoutSettings] Calling connectBankMutation.mutate (bank form submit)");
    connectBankMutation.mutate({ 
      routingNumber, 
      accountNumber, 
      accountType, 
      bankName, 
      recipientType,
      email: profile?.email 
    });
  };

  if (authLoading || profileLoading || payoutAccountsLoading) {
    return (
      <div className={embedded ? "py-8 flex justify-center" : "min-h-screen flex items-center justify-center"}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={embedded ? "space-y-4 py-4" : "min-h-screen bg-background"}>
        {!embedded && (
          <header className="sticky top-0 z-50 bg-background border-b border-border">
            <div className="container mx-auto px-4 py-3 flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-lg font-semibold">{t("title")}</h1>
            </div>
          </header>
        )}
        <div className={embedded ? "" : "container mx-auto px-4 py-6 max-w-lg"}>
          <p className="text-muted-foreground">{t("pleaseCompleteProfileFirst")}</p>
          <Button onClick={() => setLocation("/dashboard/settings/profile")} className="mt-4">
            {t("completeProfile")}
          </Button>
        </div>
      </div>
    );
  }

  const defaultPayoutAccount = payoutAccounts.find((a) => a.isDefault) || payoutAccounts[0];
  const hasBankConnected = profile?.bankAccountLinked || (defaultPayoutAccount && (defaultPayoutAccount.provider === "mercury" || defaultPayoutAccount.provider === "modern_treasury"));
  const hasPendingBankDetails = !hasBankConnected && !!profile?.mtCounterpartyId;

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 max-w-lg space-y-6"}>
      <div>
        <h2 className="text-xl font-semibold mb-2">{t("payoutMethods")}</h2>
        <p className="text-muted-foreground">{t("connectBankAccountDescription")}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-base">{t("bankAccountACH")}</CardTitle>
                <CardDescription>{t("directDeposit1To2Days")}</CardDescription>
              </div>
            </div>
            {hasBankConnected ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <Check className="w-3 h-3 mr-1" /> {t("connected")}
              </Badge>
            ) : hasPendingBankDetails ? (
              <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">
                <AlertCircle className="w-3 h-3 mr-1" /> {t("pending")}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {hasBankConnected ? (
              <>
                <div className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{t("accountType", "Account Type")}</p>
                      <p className="text-base font-medium mt-0.5">{defaultPayoutAccount?.accountType === "savings" ? t("savings") : t("checking")} {t("account")}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowBankDialog(true)}>{t("change")}</Button>
                  </div>
                </div>
                <div className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{t("accountNumber", "Account Number")}</p>
                      <p className="text-base font-medium mt-0.5">****{defaultPayoutAccount?.accountLastFour || "****"}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowBankDialog(true)}>{t("change")}</Button>
                  </div>
                </div>
                {defaultPayoutAccount?.bankName && (
                  <div className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("bankName", "Bank Name")}</p>
                        <p className="text-base font-medium mt-0.5">{defaultPayoutAccount.bankName}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setShowBankDialog(true)}>{t("change")}</Button>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-600" />
                    <span>{t("payoutsWillBeDeposited")}</span>
                  </div>
                </div>
              </>
            ) : hasPendingBankDetails ? (
              <>
                <div className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{t("accountType", "Account Type")}</p>
                      <p className="text-base font-medium mt-0.5">{defaultPayoutAccount?.accountType === "savings" ? t("savings") : t("checking")} {t("account")}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowBankDialog(true)}>{t("update")}</Button>
                  </div>
                </div>
                <div className="p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{t("accountNumber", "Account Number")}</p>
                      <p className="text-base font-medium mt-0.5">****{defaultPayoutAccount?.accountLastFour || "****"}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowBankDialog(true)}>{t("update")}</Button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    <span>{t("bankDetailsSaved")}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4">
                <Button onClick={() => setShowBankDialog(true)} className="w-full" variant="outline" data-testid="button-connect-bank">
                  <Plus className="w-4 h-4 mr-2" />
                  {t("connectBankAccount")}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {hasBankConnected && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">{t("instantPayouts", "Instant Payouts")}</CardTitle>
                <CardDescription>
                  {t("instantPayoutDescription", "Get paid instantly with a small fee, or wait 1-2 business days for free standard transfers.")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
              <div className="flex-1 min-w-0 pr-4">
                <p className="font-medium">{t("enableInstantPayouts", "Enable Instant Payouts")}</p>
                {profile?.instantPayoutEnabled ? (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("instantPayoutFee", "Fee: 1% + $0.30 per payment")}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("standardPayoutTiming", "Standard payouts: 1-2 business days, no fee")}
                  </p>
                )}
              </div>
              <Switch
                checked={profile?.instantPayoutEnabled || false}
                onCheckedChange={handleInstantPayoutToggle}
                disabled={updateInstantPayoutMutation.isPending}
              />
            </div>
            {profile?.instantPayoutEnabled ? (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {t("instantPayoutActive", "Instant payouts are enabled. A fee of 1% + $0.30 will be automatically deducted from each payment.")}
                </p>
              </div>
            ) : (
              <div className="p-3 bg-muted/50 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground">
                  {t("standardPayoutActive", "Standard payouts are active. Payments will arrive in 1-2 business days with no fees.")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <CardTitle className="text-base">{t("howPayoutsWork")}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium flex-shrink-0">1</div>
            <p>{t("step1CompleteJobs")}</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium flex-shrink-0">2</div>
            <p>{t("step2CompanyApproves")}</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium flex-shrink-0">3</div>
            <p>{t("step3PaymentSent")}</p>
          </div>
        </CardContent>
      </Card>

      {!hasBankConnected && (
        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">{t("bankAccountRequired")}</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{t("pleaseConnectBankAccount")}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const handleDialogClose = (open: boolean) => {
    setShowBankDialog(open);
    if (!open) {
      // Reset form and errors when dialog closes
      setRoutingNumber("");
      setAccountNumber("");
      setConfirmAccountNumber("");
      setBankName("");
      setRecipientType("business");
      setRoutingNumberError("");
      setAccountNumberError("");
      setConfirmAccountNumberError("");
    }
  };

  const popup = (
    <MobilePopup
      open={showBankDialog}
      onOpenChange={handleDialogClose}
      title={t("connectBankAccount")}
      description={t("enterBankDetailsForDirectDeposit")}
      primaryAction={{
        label: connectBankMutation.isPending ? t("connecting") : t("connectAccount"),
        onClick: handleConnectBank,
        disabled: connectBankMutation.isPending || 
                 !routingNumber || 
                 !accountNumber || 
                 !confirmAccountNumber || 
                 !bankName ||
                 !recipientType ||
                 !!routingNumberError ||
                 !!accountNumberError ||
                 !!confirmAccountNumberError ||
                 routingNumber.length !== 9 ||
                 accountNumber.length < 4 ||
                 accountNumber.length > 17,
        icon: connectBankMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />,
        testId: "button-submit-bank",
      }}
      secondaryAction={{
        label: tCommon("cancel"),
        onClick: () => handleDialogClose(false),
        testId: "cancel-bank-dialog",
      }}
    >
      <div className="space-y-4">
        <input type="hidden" name="recipientType" value={recipientType} />
        <div className="space-y-2">
          <Label htmlFor="bank-name">{t("bankName")}</Label>
          <Input id="bank-name" placeholder={t("bankNamePlaceholder")} value={bankName} onChange={(e) => setBankName(e.target.value)} data-testid="input-bank-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="routing-number">{t("routingNumber")}</Label>
          <Input 
            id="routing-number" 
            placeholder={t("routingNumberPlaceholder") || "9 digits"} 
            value={routingNumber} 
            onChange={(e) => handleRoutingNumberChange(e.target.value)} 
            maxLength={9} 
            className={routingNumberError ? "border-destructive" : ""}
            data-testid="input-routing-number" 
          />
          {routingNumberError && (
            <p className="text-xs text-destructive mt-1">{routingNumberError}</p>
          )}
          {!routingNumberError && routingNumber.length === 9 && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Valid routing number</p>
          )}
          <p className="text-xs text-muted-foreground">Found at the bottom left of your check</p>
          {showClientDevTools() && (
            <p className="text-xs text-muted-foreground">Dev: use <strong>123456789</strong> to test without Mercury. Sandbox: <strong>021000021</strong> (Chase).</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-number">{t("accountNumber")}</Label>
          <Input 
            id="account-number" 
            placeholder={t("accountNumberPlaceholder") || "4-17 digits"} 
            value={accountNumber} 
            onChange={(e) => handleAccountNumberChange(e.target.value)} 
            maxLength={17}
            className={accountNumberError ? "border-destructive" : ""}
            data-testid="input-account-number" 
          />
          {accountNumberError && (
            <p className="text-xs text-destructive mt-1">{accountNumberError}</p>
          )}
          {!accountNumberError && accountNumber.length >= 4 && accountNumber.length <= 17 && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Valid account number</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-account-number">{t("confirmAccountNumber")}</Label>
          <Input 
            id="confirm-account-number" 
            placeholder={t("confirmAccountNumberPlaceholder") || "Re-enter account number"} 
            value={confirmAccountNumber} 
            onChange={(e) => handleConfirmAccountNumberChange(e.target.value)} 
            maxLength={17}
            className={confirmAccountNumberError ? "border-destructive" : ""}
            data-testid="input-confirm-account-number" 
          />
          {confirmAccountNumberError && (
            <p className="text-xs text-destructive mt-1">{confirmAccountNumberError}</p>
          )}
          {!confirmAccountNumberError && confirmAccountNumber.length > 0 && accountNumber.replace(/\D/g, "") === confirmAccountNumber.replace(/\D/g, "") && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Account numbers match</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-type">{t("accountType")}</Label>
          <Select value={accountType} onValueChange={setAccountType}>
            <SelectTrigger data-testid="select-account-type">
              <SelectValue placeholder={t("selectAccountType")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="checking">{t("checking")}</SelectItem>
              <SelectItem value="savings">{t("savings")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="bg-secondary/30 p-3 rounded-lg text-sm text-muted-foreground">
          <p>{t("bankInformationEncrypted")}</p>
        </div>
      </div>
    </MobilePopup>
  );

  if (embedded) {
    return (
      <>
        <div className="pt-2 pb-4">{main}</div>
        {popup}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
        </div>
      </header>
      <main>{main}</main>
      {popup}
    </div>
  );
}

export default function PayoutSettings() {
  return <PayoutSettingsContent />;
}
