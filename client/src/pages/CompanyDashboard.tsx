import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react";
import { usePersistentFilter } from "@/hooks/use-persistent-filter";
import { useLocation, useRoute } from "wouter";
import { Navigation } from "@/components/Navigation";
import { NotificationPopup } from "@/components/NotificationPopup";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, useUpdateProfile, profileMeQueryKey, invalidateSessionProfileQueries } from "@/hooks/use-profiles";
import { useAdminCheck } from "@/hooks/use-admin";
import { useCompanyTimesheets, useApproveTimesheet, useRejectTimesheet, useBulkApproveTimesheets, type TimesheetWithDetails, type TimesheetApprovalResponse, type BulkApprovalResponse } from "@/hooks/use-timesheets";
import { TimesheetMap } from "@/components/TimesheetMap";
import { RequestScreeningMenu } from "@/components/RequestScreeningMenu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompanyJobs, type CompanyJob } from "@/hooks/use-jobs";
import { Loader2, Briefcase, Users, Clock, Menu, Plus, Minus, ChevronDown, ChevronRight, ChevronLeft, ChevronUp, MapPin, Check, CheckCircle, X, XCircle, AlertCircle, AlertTriangle, DollarSign, Star, Send, Eye, UserPlus, UserMinus, Calendar, CalendarDays, RefreshCw, RotateCcw, Settings, LogOut, LogIn, HelpCircle, FileText, CreditCard, Bell, Building, Building2, Map as MapIcon, MoreVertical, Edit, Flag, Download, Trash2, Globe, Image, Phone, Mail, MapPinned, FileCheck, Landmark, Home, ArrowLeft, ArrowRight, Shield, Zap, User, Monitor, Smartphone, MessageSquare, Webhook } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollHeader } from "@/hooks/use-scroll-header";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { MobilePopup } from "@/components/ui/mobile-popup";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatedNavigationTabs } from "@/components/ui/animated-navigation-tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLoading } from "@/components/AppLoading";
import { useToast } from "@/hooks/use-toast";
import { LoginSecuritySection } from "@/pages/worker/ProfileSettings";
import { humanizePaymentError } from "@/lib/payment-error";
import { format, differenceInMinutes, parseISO, addHours, formatDistanceToNow } from "date-fns";
import InvoicesView from "@/components/InvoicesView";
import ChatsPage from "@/pages/ChatsPage";
import { JobDetailsContent } from "@/components/JobDetailsContent";
import { JobTimeline } from "@/components/ui/job-timeline";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { SUPPORTED_LANGUAGES, changeLanguage, LanguageCode } from "@/lib/i18n";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { api as sharedApi } from "@shared/routes";
import { loadStripe } from "@/lib/stripe";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { Elements, CardElement, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { jsPDF } from "jspdf";
import confetti from "canvas-confetti";
import { compressImageIfNeeded, assertMaxUploadSize } from "@/lib/image-compression";
import { COMPANY_AGREEMENT_TEXT } from "@/lib/company-agreement-text";
import { cn, normalizeAvatarUrl, parseLocalDate, validateOnDemandTime, isValidScheduleTime, SHIFT_TYPE_INFO, type ShiftType, getTimeSlots, getValidEndTimeSlots, getEarliestEndTime, formatTime12h } from "@/lib/utils";
import { showClientDevTools } from "@/lib/is-local-dev-host";
import { RescheduleScheduleFlow, type RescheduleScheduleData } from "@/components/RescheduleScheduleFlow";

// Add Card Form Component for Add Payment Method dialog (saves card without payment)
interface AddCardFormProps {
  onSuccess: () => void;
  onError: (error: string) => void;
}

function AddCardForm({ onSuccess, onError }: AddCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!stripe || !elements) {
      setError("Stripe not loaded");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Create setup intent (no payment, just save card)
      const res = await fetch("/api/stripe/create-setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to set up card");
      }

      const { clientSecret, setupIntentId } = await res.json();

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error("Card element not found");
      }

      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      });

      if (stripeError) {
        throw new Error(stripeError.message || "Failed to save card");
      }

      if (setupIntent?.status === "succeeded") {
        // Confirm and save card on backend
        const confirmRes = await fetch("/api/stripe/confirm-setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ setupIntentId }),
        });

        if (!confirmRes.ok) {
          const data = await confirmRes.json();
          throw new Error(data.message || "Failed to save card");
        }

        const result = await confirmRes.json();
        toast({ 
          title: "Card saved!", 
          description: `${result.cardBrand?.toUpperCase() || "Card"} ending in ${result.lastFour} has been added.` 
        });
        onSuccess();
      }
    } catch (err: any) {
      console.error("Card save error:", err);
      setError(err.message);
      onError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Card Details</Label>
        <div className="mt-1 p-4 border rounded-lg bg-white dark:bg-gray-900">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "#424770",
                  "::placeholder": {
                    color: "#aab7c4",
                  },
                },
                invalid: {
                  color: "#9e2146",
                },
              },
            }}
          />
        </div>
      </div>
      
      <div className="p-3 bg-muted/50 rounded-lg">
        <p className="text-xs text-muted-foreground">
          Card payments incur a 3.5% processing fee when used to add funds. 
          Your card will be saved securely via Stripe for future payments.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          {error}
        </div>
      )}

      <Button 
        className="w-full" 
        onClick={handleSubmit}
        disabled={!stripe || isProcessing}
        data-testid="button-save-card"
      >
        {isProcessing ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
        ) : (
          <><CreditCard className="w-4 h-4 mr-2" /> Save Card</>
        )}
      </Button>
    </div>
  );
}

// Form to verify ACH bank via micro-deposits (amounts in cents or descriptor code)
function VerifyBankMicrodepositsForm({
  stripe,
  clientSecret,
  microdepositType,
  bankLabel,
  onSuccess,
  onError,
  onBack,
  compact,
}: {
  stripe: any;
  clientSecret: string;
  microdepositType: "amounts" | "descriptor_code";
  bankLabel: string;
  onSuccess: (data?: { paymentMethodId?: number }) => void;
  onError: (err: string) => void;
  onBack?: () => void;
  compact?: boolean;
}) {
  const [amount1, setAmount1] = useState("");
  const [amount2, setAmount2] = useState("");
  const [descriptorCode, setDescriptorCode] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !clientSecret) return;
    setIsProcessing(true);
    onError("");
    try {
      const payload: { amounts?: number[]; descriptor_code?: string } =
        microdepositType === "descriptor_code"
          ? { descriptor_code: descriptorCode.trim() }
          : {
              amounts: [
                parseInt(amount1, 10) || 0,
                parseInt(amount2, 10) || 0,
              ],
            };
      const { setupIntent, error } = await stripe.verifyMicrodepositsForSetup(clientSecret, payload);
      if (error) {
        onError(error.message || "Verification failed");
        setIsProcessing(false);
        return;
      }
      if (setupIntent?.status === "succeeded" && setupIntent.id) {
        const res = await fetch("/api/stripe/confirm-setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ setupIntentId: setupIntent.id }),
        });
        const data: { message?: string; paymentMethodId?: number } = await res.json().catch(() => ({}));
        const msg = (data.message || "").trim().toLowerCase();
        const alreadySaved = res.status === 400 && (msg.includes("already saved") || msg.includes("already have"));
        if (res.ok || alreadySaved) {
          onSuccess({ paymentMethodId: data.paymentMethodId });
          return;
        }
        onError(data.message || "Could not save payment method");
      }
    } catch (err: any) {
      onError(err?.message || "Something went wrong");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!compact && (
        <p className="text-sm text-muted-foreground">
          Verify <strong>{bankLabel}</strong> by entering the values from your bank statement.
        </p>
      )}
      {microdepositType === "descriptor_code" ? (
        <div className="space-y-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">What to look for on your bank statement:</p>
            <p>Stripe sent a tiny deposit (about 1¢) with a 6-character code starting with <strong>SM</strong>. Enter that code below.</p>
          </div>
          <Label>Descriptor code (6 characters, e.g. SM11AA)</Label>
          <Input
            placeholder="SM11AA"
            value={descriptorCode}
            onChange={(e) => setDescriptorCode(e.target.value.replace(/\s/g, "").toUpperCase().slice(0, 6))}
            maxLength={6}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">What to look for on your bank statement:</p>
            <p>Stripe sent two small deposits (1–2 business days). They appear as <strong>ACCTVERIFY</strong> or <strong>STRIPE</strong> — usually amounts like <strong>32¢</strong> and <strong>45¢</strong> (or similar). Enter each amount in <strong>cents</strong> below.</p>
          </div>
          <Label>Micro-deposit amounts (in cents, e.g. 32 and 45)</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="text"
              inputMode="numeric"
              placeholder="32"
              value={amount1}
              onChange={(e) => setAmount1(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <Input
              type="text"
              inputMode="numeric"
              placeholder="45"
              value={amount2}
              onChange={(e) => setAmount2(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {onBack && (
          <Button type="button" variant="outline" onClick={onBack} disabled={isProcessing}>
            Back
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={!stripe || isProcessing}>
          {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</> : "Verify bank"}
        </Button>
      </div>
    </form>
  );
}

function VerifyBankMicrodepositsFormWithStripe(props: Omit<Parameters<typeof VerifyBankMicrodepositsForm>[0], "stripe">) {
  const stripe = useStripe();
  if (!stripe) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }
  return <VerifyBankMicrodepositsForm stripe={stripe} {...props} />;
}

// Inline bank verification card — fetches setup intent and shows cents entry form inside the card
function InlineBankVerifyCard({
  paymentMethod,
  stripePromise,
  onSuccess,
  onError,
}: {
  paymentMethod: any;
  stripePromise: ReturnType<typeof loadStripe> | null;
  onSuccess: () => void;
  onError: (err: string) => void;
}) {
  const bankLabel = `${paymentMethod.bankName ?? paymentMethod.bank_name ?? "Bank"} ending in ${paymentMethod.lastFour ?? paymentMethod.last_four ?? "****"}`;
  const pmId = paymentMethod.stripePaymentMethodId ?? paymentMethod.stripe_payment_method_id;
  const [state, setState] = useState<"loading" | "form" | "unavailable">("loading");
  const [verificationData, setVerificationData] = useState<{
    clientSecret: string;
    microdepositType: "amounts" | "descriptor_code";
  } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!pmId) {
      setState("unavailable");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stripe/get-verification-setup-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ stripePaymentMethodId: pmId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.clientSecret) {
          setVerificationData({
            clientSecret: data.clientSecret,
            microdepositType: data.microdepositType === "descriptor_code" ? "descriptor_code" : "amounts",
          });
          setState("form");
        } else if (res.ok && data.alreadyVerified) {
          onSuccess();
        } else {
          const msg = data.message || "Verification not available";
          setFetchError(msg);
          setState("unavailable");
        }
      } catch (e: any) {
        if (!cancelled) {
          setFetchError(e?.message || "Could not load verification");
          setState("unavailable");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pmId]);

  if (state === "loading") {
    return (
      <div className="rounded-lg border p-4 space-y-3">
        <div className="font-medium text-sm">{bankLabel}</div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading verification form...</span>
        </div>
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className="rounded-lg border p-4 space-y-2">
        <div className="font-medium text-sm">{bankLabel}</div>
        <p className="text-xs text-muted-foreground">{fetchError}. Add a card below for instant validation.</p>
      </div>
    );
  }

  if (!verificationData || !stripePromise) return null;

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="font-medium text-sm">{bankLabel}</div>
      <Elements stripe={stripePromise} options={{ clientSecret: verificationData.clientSecret, appearance: { theme: "stripe" } }}>
        <VerifyBankMicrodepositsFormWithStripe
          clientSecret={verificationData.clientSecret}
          microdepositType={verificationData.microdepositType}
          bankLabel={bankLabel}
          onSuccess={onSuccess}
          onError={onError}
          compact
        />
      </Elements>
    </div>
  );
}

// Connect Stripe Bank (ACH) form — SetupIntent + Payment Element for bank/card (Stripe handles verification: instant or micro-deposits)
function ConnectStripeBankForm({
  clientSecret,
  onSuccess,
  onError,
}: {
  clientSecret: string;
  onSuccess: (data?: { paymentMethodId?: number }) => void;
  onError: (err: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [microdepositState, setMicrodepositState] = useState<{
    clientSecret: string;
    setupIntentId: string;
    microdepositType: "amounts" | "descriptor_code";
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) {
      if (import.meta.env.DEV) console.warn("[Stripe] Add payment: missing stripe/elements/clientSecret", { stripe: !!stripe, elements: !!elements, clientSecret: !!clientSecret });
      return;
    }
    setIsProcessing(true);
    onError("");
    if (import.meta.env.DEV) console.log("[Stripe] Add payment: confirming setup with Stripe...");
    try {
      const { setupIntent, error } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (import.meta.env.DEV) console.log("[Stripe] Add payment: confirmSetup result", { status: setupIntent?.status, error: error?.message || null });
      if (error) {
        onError(error.message || "Setup failed");
        setIsProcessing(false);
        return;
      }
      const nextAction = (setupIntent as any)?.next_action;
      if (setupIntent?.status === "requires_action" && nextAction?.type === "verify_with_microdeposits") {
        const vwm = nextAction.verify_with_microdeposits;
        const mdType = (vwm?.microdeposit_type === "descriptor_code" ? "descriptor_code" : "amounts") as "amounts" | "descriptor_code";
        setMicrodepositState({
          clientSecret: (setupIntent as any).client_secret || clientSecret,
          setupIntentId: setupIntent.id,
          microdepositType: mdType,
        });
        setIsProcessing(false);
        return;
      }
      if (setupIntent?.status === "succeeded" && setupIntent.id) {
        if (import.meta.env.DEV) console.log("[Stripe] Add payment: calling /api/stripe/confirm-setup", setupIntent.id);
        const res = await fetch("/api/stripe/confirm-setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ setupIntentId: setupIntent.id }),
        });
        const data: { message?: string; paymentMethodId?: number; alreadySaved?: boolean } = await res.json().catch(() => ({}));
        const msg = (data.message || "").trim().toLowerCase();
        const alreadySavedByStatus = res.status === 400 && (msg.includes("already saved") || msg.includes("this card is already") || msg.includes("this bank account is already") || msg.includes("already have"));
        const alreadySaved = data.alreadySaved === true || alreadySavedByStatus;
        if (import.meta.env.DEV) console.log("[Stripe] Add payment: confirm-setup response", { ok: res.ok, status: res.status, alreadySaved, message: data.message, paymentMethodId: data.paymentMethodId });
        if (res.ok || alreadySavedByStatus) {
          onSuccess(alreadySaved ? (data.paymentMethodId != null ? { paymentMethodId: data.paymentMethodId } : undefined) : { paymentMethodId: data.paymentMethodId });
          return;
        }
        onError(data.message || "Could not save payment method");
      } else if (import.meta.env.DEV) {
        console.warn("[Stripe] Add payment: unexpected setupIntent state", setupIntent?.status);
      }
    } catch (err: any) {
      if (import.meta.env.DEV) console.error("[Stripe] Add payment error:", err?.message || err);
      onError(err?.message || "Something went wrong");
    } finally {
      setIsProcessing(false);
    }
  };

  if (microdepositState) {
    return (
      <VerifyBankMicrodepositsForm
        stripe={stripe}
        clientSecret={microdepositState.clientSecret}
        microdepositType={microdepositState.microdepositType}
        bankLabel="your bank account"
        onSuccess={(d) => onSuccess(d)}
        onError={onError}
        onBack={() => setMicrodepositState(null)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card", "us_bank_account"],
          wallets: { applePay: "never", googlePay: "never", link: "never" },
        }}
      />
      <Button type="submit" className="w-full" disabled={!stripe || isProcessing}>
        {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : <><Landmark className="w-4 h-4 mr-2" /> Save payment method</>}
      </Button>
    </form>
  );
}

// Helper function to format date as "July 5th"
function formatDateFriendly(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" 
               : day % 10 === 2 && day !== 12 ? "nd"
               : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return format(date, "MMMM") + " " + day + suffix;
}

// Convert time to HH:mm for input type="time". Handles both 24h (08:00) and 12h (6:30 AM) formats.
function parseTimeToHHmm(timeStr: string): string {
  if (!timeStr || typeof timeStr !== "string") return "08:00";
  const s = timeStr.trim();
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  const m = s.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i);
  if (!m) return "08:00";
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const isPM = /^PM$/i.test(m[3]);
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(Math.min(59, Math.max(0, min))).padStart(2, "0")}`;
}

// Helper function to format time as "8am" or "10pm"
function formatTimeFriendly(timeString: string): string {
  if (!timeString) return "";
  const [hours, minutes] = timeString.split(":").map(Number);
  const isPM = hours >= 12;
  const hour12 = hours % 12 || 12;
  const period = isPM ? "pm" : "am";
  return minutes > 0 ? `${hour12}:${minutes.toString().padStart(2, "0")}${period}` : `${hour12}${period}`;
}

// Helper function to format time range as "8am - 5pm"
function formatTimeRange(startTime?: string, endTime?: string): string {
  if (!startTime) return "";
  const start = formatTimeFriendly(startTime);
  if (!endTime) return start;
  return `${start} - ${formatTimeFriendly(endTime)}`;
}

// Helper function to format "X days away" or "Today"
function formatDaysAway(dateString: string): string {
  if (!dateString) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateString);
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return ""; // Past date - don't show
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return `${diffDays} days away`;
}

// Helper function to format short date like "Jan 14th"
// Helper function to format creation date (e.g., "Created today", "Created yesterday", "Created 4 days ago")
function formatCreationDate(createdAt?: string): string | null {
  if (!createdAt) return null;
  
  try {
    const createdDate = new Date(createdAt);
    const now = new Date();
    const diffInMs = now.getTime() - createdDate.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 0) {
      // Check if it's today
      const today = new Date();
      if (createdDate.toDateString() === today.toDateString()) {
        return "Created today";
      }
    } else if (diffInDays === 1) {
      return "Created yesterday";
    } else if (diffInDays > 1) {
      return `Created ${diffInDays} days ago`;
    }
    
    // Fallback to relative time
    return `Created ${formatDistanceToNow(createdDate, { addSuffix: true })}`;
  } catch (error) {
    return null;
  }
}

function formatDateShort(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" 
               : day % 10 === 2 && day !== 12 ? "nd"
               : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return format(date, "MMM") + " " + day + suffix;
}

// Helper function to format recurring days as "Mon, Tue, Wed, Thu"
function formatRecurringDays(days?: string[]): string {
  if (!days || days.length === 0) return "";
  const dayMap: Record<string, string> = {
    "mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", 
    "fri": "Fri", "sat": "Sat", "sun": "Sun",
    "Mon": "Mon", "Tue": "Tue", "Wed": "Wed", "Thu": "Thu",
    "Fri": "Fri", "Sat": "Sat", "Sun": "Sun",
    "monday": "Mon", "tuesday": "Tue", "wednesday": "Wed", "thursday": "Thu",
    "friday": "Fri", "saturday": "Sat", "sunday": "Sun",
    "Monday": "Mon", "Tuesday": "Tue", "Wednesday": "Wed", "Thursday": "Thu",
    "Friday": "Fri", "Saturday": "Sat", "Sunday": "Sun"
  };
  return days.map(d => dayMap[d] || d).join(", ");
}

// Helper function to format time range with "to" for schedule display
function formatTimeRangeWithTo(startTime?: string, endTime?: string): string {
  if (!startTime) return "";
  const start = formatTimeFriendly(startTime);
  if (!endTime) return start;
  return `${start} to ${formatTimeFriendly(endTime)}`;
}

// Helper function to format dynamic job schedule based on timeline type (clear labels: on-demand, one-day, recurring; start/end times)
function formatJobSchedule(job: { 
  timelineType: string; 
  startDate: string; 
  startTime?: string; 
  endTime?: string; 
  recurringDays?: string[];
  scheduleDays?: string[] | null;
  recurringWeeks?: number;
}): string {
  const dateStr = formatDateShort(job.startDate);
  const timeRange = formatTimeRangeWithTo(job.startTime, job.endTime);
  const daysAway = formatDaysAway(job.startDate);
  const daysAwayStr = daysAway ? ` (${daysAway})` : "";
  const days = job.recurringDays || job.scheduleDays || [];
  
  switch (job.timelineType) {
    case "one-day": {
      // One-day • Jan 14th • Start 8am – End 5pm (3 days away)
      const label = "One-day";
      if (!timeRange) return `${label} • ${dateStr}${daysAwayStr}`;
      const startF = job.startTime ? formatTimeFriendly(job.startTime) : "";
      const endF = job.endTime ? formatTimeFriendly(job.endTime) : "";
      const timePart = startF && endF ? `Start ${startF} – End ${endF}` : startF ? `Start at ${startF}` : endF ? `End by ${endF}` : timeRange;
      return `${label} • ${dateStr} • ${timePart}${daysAwayStr}`;
    }
    case "on-demand": {
      // On-demand • Jan 14th • Start 10am – End 5pm (or "Start at 10am" / "ASAP")
      const label = "On-demand";
      if (!job.startTime && !job.endTime) return `${label} • ${dateStr} • ASAP${daysAwayStr}`;
      const startF = job.startTime ? formatTimeFriendly(job.startTime) : "";
      const endF = job.endTime ? formatTimeFriendly(job.endTime) : "";
      if (startF && endF) return `${label} • ${dateStr} • Start ${startF} – End ${endF}${daysAwayStr}`;
      if (startF) return `${label} • ${dateStr} • Start at ${startF}${daysAwayStr}`;
      if (endF) return `${label} • ${dateStr} • End by ${endF}${daysAwayStr}`;
      return `${label} • ${dateStr} • ASAP${daysAwayStr}`;
    }
    case "recurring": {
      // Recurring • Jan 14th • 8am to 5pm (Mon, Tue, Wed) x2wks (3 days away)
      const label = "Recurring";
      const recurringStr = formatRecurringDays(days);
      const weekStr = job.recurringWeeks && job.recurringWeeks > 1 ? ` x${job.recurringWeeks}wks` : "";
      const recurringPart = recurringStr ? ` (${recurringStr}${weekStr})` : "";
      if (!timeRange) return `${label} • ${dateStr}${recurringPart}${daysAwayStr}`;
      return `${label} • ${dateStr} • ${timeRange}${recurringPart}${daysAwayStr}`;
    }
    default: {
      if (!timeRange) return `${dateStr}${daysAwayStr}`;
      return `${dateStr} • ${timeRange}${daysAwayStr}`;
    }
  }
}

function calculateHoursFromTimeRange(startTime?: string, endTime?: string): number {
  if (!startTime || !endTime) return 0;
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const startMinutes = startH * 60 + (startM || 0);
  let endMinutes = endH * 60 + (endM || 0);
  // Handle overnight shifts (end time is before start time)
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60; // Add 24 hours
  }
  return (endMinutes - startMinutes) / 60;
}

function formatEstimatedHours(job: { 
  timelineType: string; 
  startTime?: string; 
  endTime?: string; 
  recurringDays?: string[];
  scheduleDays?: string[] | null;
  recurringWeeks?: number;
  maxWorkersNeeded: number;
  estimatedHours?: number;
}, timesheetHours?: number): string {
  const days = job.recurringDays || job.scheduleDays || [];
  const dailyHours = calculateHoursFromTimeRange(job.startTime, job.endTime);
  
  switch (job.timelineType) {
    case "one-day":
      if (dailyHours > 0) {
        if (job.maxWorkersNeeded > 1) {
          return `${dailyHours}h (per worker)`;
        }
        return `${dailyHours}h`;
      }
      return "TBD";
      
    case "recurring":
      if (dailyHours > 0 && days.length > 0) {
        const weeks = job.recurringWeeks || 1;
        const totalHours = dailyHours * days.length * weeks;
        if (job.maxWorkersNeeded > 1) {
          return `${totalHours}h total (per worker)`;
        }
        return `${totalHours}h total`;
      }
      return "TBD";
      
    case "on-demand":
      if (timesheetHours !== undefined && timesheetHours > 0) {
        return `Flexible (${timesheetHours.toFixed(1)}h submitted)`;
      }
      return "Flexible";
      
    default:
      return "TBD";
  }
}

function getEstimatedHoursNumeric(job: { 
  timelineType: string; 
  startTime?: string; 
  endTime?: string; 
  recurringDays?: string[];
  scheduleDays?: string[] | null;
  recurringWeeks?: number;
  estimatedHours?: number;
}): number {
  const days = job.recurringDays || job.scheduleDays || [];
  const dailyHours = calculateHoursFromTimeRange(job.startTime, job.endTime);
  
  switch (job.timelineType) {
    case "one-day":
      return dailyHours > 0 ? dailyHours : (job.estimatedHours || 0);
    case "recurring":
      if (dailyHours > 0 && days.length > 0) {
        const weeks = job.recurringWeeks || 1;
        return dailyHours * days.length * weeks;
      }
      return job.estimatedHours || 0;
    case "on-demand":
      return job.estimatedHours || 0;
    default:
      return job.estimatedHours || 0;
  }
}

const COMPANY_COST_MARKUP = 1.52;

/**
 * Remaining company-facing labor commitment (cents): per accepted worker,
 * hours × (their proposed/agreed rate, else worker profile rate, else job list rate) × markup;
 * then capped by job budget when set.
 */
function getJobCommitmentRemainingCents(
  job: Parameters<typeof getEstimatedHoursNumeric>[0] & {
    applications: {
      status: string;
      proposedRate?: number | null;
      worker?: { hourlyRate?: number | null };
    }[];
    hourlyRate?: number;
    budgetCents?: number | null;
  },
  approvedCompanyCostCentsForJob: number
): number {
  const accepted = job.applications.filter((a) => a.status === "accepted");
  if (accepted.length === 0) return 0;

  let hours = getEstimatedHoursNumeric(job);
  if (hours <= 0) hours = job.estimatedHours ?? 0;
  if (hours <= 0) hours = 8;

  const jobListRateCents = job.hourlyRate ?? 2500;
  let laborEstimateCents = 0;
  for (const app of accepted) {
    const fromProposal =
      app.proposedRate != null && app.proposedRate > 0 ? app.proposedRate : null;
    const fromProfile =
      app.worker?.hourlyRate != null && app.worker.hourlyRate > 0 ? app.worker.hourlyRate : null;
    const workerPayCents = fromProposal ?? fromProfile ?? jobListRateCents;
    laborEstimateCents += Math.round(hours * workerPayCents * COMPANY_COST_MARKUP);
  }

  const cappedEstimateCents =
    job.budgetCents != null && job.budgetCents > 0
      ? Math.min(laborEstimateCents, job.budgetCents)
      : laborEstimateCents;

  return Math.max(0, cappedEstimateCents - approvedCompanyCostCentsForJob);
}

interface SampleWorker {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  bio: string;
  skills: string[];
  hourlyRate: number;
  rating: number;
  completedJobs: number;
  portfolioImages: string[];
  phone?: string;
  identityVerified?: boolean;
  insuranceVerified?: boolean;
  w9DocumentUrl?: string | null;
  strikeCount?: number;
}

interface SampleApplication {
  id: number;
  worker: SampleWorker;
  message: string;
  proposedRate: number;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

interface SampleJobTimesheet {
  workerId: number;
  workerName: string;
  hoursClocked: number;
  hourlyRate: number;
  status: "pending" | "approved" | "rejected";
}

interface SampleJob {
  id: number;
  title: string;
  description: string;
  locationId: number;
  trade: string;
  hourlyRate: number;
  maxWorkersNeeded: number;
  workersHired: number;
  status: "draft" | "open" | "in_progress" | "completed" | "cancelled";
  startDate: string;
  endDate?: string;
  estimatedHours: number;
  /** Mirrors server `budgetCents` when present on company job payload */
  budgetCents?: number | null;
  applications: SampleApplication[];
  timelineType: "on-demand" | "one-day" | "recurring";
  recurringDays?: string[];
  /** Alias for UI/recurring display (falls back to recurringDays in places that expect scheduleDays) */
  scheduleDays?: string[];
  recurringWeeks?: number;
  startTime?: string;
  endTime?: string;
  images?: string[];
  videos?: string[];
  timesheets?: SampleJobTimesheet[];
  createdAt?: string;
  /** Server: last "Send alert to workers" blast; 24h cooldown per job */
  lastWorkerAlertAt?: string | null;
}

const WORKER_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function isWorkerAlertCooldownActive(lastSentAt: string | Date | null | undefined): boolean {
  if (!lastSentAt) return false;
  const t = lastSentAt instanceof Date ? lastSentAt.getTime() : new Date(lastSentAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < WORKER_ALERT_COOLDOWN_MS;
}

interface SampleLocation {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  jobs: SampleJob[];
}

interface SampleTeamMember {
  id: number;
  worker: SampleWorker;
  addedFrom: string;
  notes: string;
  rating: number;
  isFavorite: boolean;
  createdAt: string;
}

interface SampleTimesheet {
  id: number;
  jobId: number;
  jobTitle: string;
  worker: SampleWorker;
  clockInTime: string;
  clockOutTime: string | null;
  totalHours: number;
  adjustedHours: number;
  hourlyRate: number;
  clockInDistance: number;
  clockOutDistance: number | null;
  locationVerified: boolean;
  locationAdjustmentReason: string | null;
  status: "pending" | "approved" | "rejected" | "disputed";
  workerNotes: string | null;
}

interface TimesheetDisplay {
  id: number;
  isRealData: boolean;
  workerId: number;
  workerName: string;
  workerInitials: string;
  workerAvatarUrl: string;
  jobId: number;
  jobTitle: string;
  clockInTime: Date;
  clockOutTime: Date | null;
  totalHours: number;
  adjustedHours: number;
  hourlyRate: number;
  clockInDistanceMeters: number;
  clockOutDistanceMeters: number | null;
  locationVerified: boolean;
  locationAdjustmentReason: string | null;
  status: "pending" | "approved" | "rejected" | "disputed";
  workerNotes: string | null;
  jobSiteLat: number | null;
  jobSiteLng: number | null;
  clockInLat: number | null;
  clockInLng: number | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  autoApprovalAt: Date | null;
  autoApprovalMsRemaining: number;
  budgetCents: number | null;
  rejectionReason?: string | null;
}

function mapSampleTimesheet(sample: SampleTimesheet): TimesheetDisplay {
  const now = Date.now();
  const sampleAutoApprovalAt = new Date(new Date(sample.clockOutTime || sample.clockInTime).getTime() + 48 * 60 * 60 * 1000);
  return {
    id: sample.id,
    isRealData: false,
    workerId: sample.worker.id || 0,
    workerName: `${sample.worker.firstName} ${sample.worker.lastName}`,
    workerInitials: `${sample.worker.firstName[0]}${sample.worker.lastName[0]}`,
    workerAvatarUrl: sample.worker.avatarUrl,
    jobId: sample.jobId,
    jobTitle: sample.jobTitle,
    clockInTime: new Date(sample.clockInTime),
    clockOutTime: sample.clockOutTime ? new Date(sample.clockOutTime) : null,
    totalHours: sample.totalHours,
    adjustedHours: sample.adjustedHours,
    hourlyRate: sample.hourlyRate,
    clockInDistanceMeters: sample.clockInDistance,
    clockOutDistanceMeters: sample.clockOutDistance,
    locationVerified: sample.locationVerified,
    locationAdjustmentReason: sample.locationAdjustmentReason,
    status: sample.status,
    workerNotes: sample.workerNotes,
    jobSiteLat: 30.2672,
    jobSiteLng: -97.7431,
    clockInLat: 30.2680,
    clockInLng: -97.7425,
    clockOutLat: sample.clockOutTime ? 30.2675 : null,
    clockOutLng: sample.clockOutTime ? -97.7428 : null,
    autoApprovalAt: sampleAutoApprovalAt,
    autoApprovalMsRemaining: Math.max(0, sampleAutoApprovalAt.getTime() - now),
    budgetCents: 500000,
    rejectionReason: sample.status === "rejected" ? (sample.workerNotes || "Rejected") : null,
  };
}

function mapRealTimesheet(ts: TimesheetWithDetails): TimesheetDisplay {
  const firstName = ts.worker.firstName || '';
  const lastName = ts.worker.lastName || '';
  const totalHours = typeof ts.totalHours === 'number' ? ts.totalHours : (typeof ts.totalHours === 'string' ? parseFloat(ts.totalHours) : 0);
  const clockInDist = typeof ts.clockInDistanceFromJob === 'number' ? ts.clockInDistanceFromJob : (typeof ts.clockInDistanceFromJob === 'string' ? parseFloat(ts.clockInDistanceFromJob) : 0);
  const clockOutDist = ts.clockOutDistanceFromJob 
    ? (typeof ts.clockOutDistanceFromJob === 'number' ? ts.clockOutDistanceFromJob : parseFloat(ts.clockOutDistanceFromJob)) 
    : null;
  
  const autoApprovalAt = ts.autoApprovalAt ? new Date(ts.autoApprovalAt) : null;
  
  return {
    id: ts.id,
    isRealData: true,
    workerId: ts.workerId || 0,
    workerName: `${firstName} ${lastName}`.trim() || 'Unknown Worker',
    workerInitials: `${firstName[0] || '?'}${lastName[0] || '?'}`,
    workerAvatarUrl: ts.worker.avatarUrl || '',
    jobId: ts.jobId,
    jobTitle: ts.job.title,
    clockInTime: ts.clockInTime instanceof Date ? ts.clockInTime : new Date(ts.clockInTime),
    clockOutTime: ts.clockOutTime ? (ts.clockOutTime instanceof Date ? ts.clockOutTime : new Date(ts.clockOutTime)) : null,
    totalHours,
    adjustedHours: (() => {
      const adj =
        ts.adjustedHours != null && String(ts.adjustedHours).trim() !== ""
          ? parseFloat(String(ts.adjustedHours))
          : NaN;
      return Number.isFinite(adj) ? adj : totalHours;
    })(),
    hourlyRate: ts.hourlyRate,
    clockInDistanceMeters: clockInDist,
    clockOutDistanceMeters: clockOutDist,
    locationVerified: clockInDist <= 500,
    locationAdjustmentReason: clockInDist > 500 ? `Clock-in was ${Math.round(clockInDist)}m from job site.` : null,
    status: (ts.status as any) || 'pending',
    workerNotes: ts.workerNotes || null,
    jobSiteLat: ts.job.latitude ? parseFloat(ts.job.latitude) : null,
    jobSiteLng: ts.job.longitude ? parseFloat(ts.job.longitude) : null,
    clockInLat: ts.clockInLatitude ? parseFloat(ts.clockInLatitude) : null,
    clockInLng: ts.clockInLongitude ? parseFloat(ts.clockInLongitude) : null,
    clockOutLat: ts.clockOutLatitude ? parseFloat(ts.clockOutLatitude) : null,
    clockOutLng: ts.clockOutLongitude ? parseFloat(ts.clockOutLongitude) : null,
    autoApprovalAt,
    autoApprovalMsRemaining: ts.autoApprovalMsRemaining || 0,
    budgetCents: ts.job.budgetCents || null,
    rejectionReason: ts.rejectionReason ?? null,
  };
}

function formatAutoApprovalCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Auto-approving...";
  const hours = Math.floor(msRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h left`;
  }
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

/** Short label for "time until auto-approve" e.g. "24h to respond", "45m to respond". */
function formatResponseDeadline(msRemaining: number): string {
  if (msRemaining <= 0) return "Auto-approving...";
  const hours = Math.floor(msRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days}d to respond`;
    return `${days}d ${remainingHours}h to respond`;
  }
  if (hours > 0) return `${hours}h to respond`;
  return `${minutes}m to respond`;
}

function getCountdownVariant(msRemaining: number): "default" | "secondary" | "destructive" | "outline" {
  const hours = msRemaining / (1000 * 60 * 60);
  if (hours <= 6) return "destructive";
  if (hours <= 24) return "secondary";
  return "outline";
}

interface WorkerDayGroup {
  workerId: number;
  workerName: string;
  workerAvatarUrl: string;
  workerInitials: string;
  date: string; // YYYY-MM-DD format
  displayDate: string; // Formatted date for display
  timesheets: TimesheetDisplay[];
  totalHours: number;
  totalCost: number; // in cents
  earliestAutoApproval: number; // ms remaining for earliest auto-approval
  hasLocationIssues: boolean;
}

interface ProjectGroup {
  jobId: number;
  jobTitle: string;
  budgetCents: number | null;
  workerDayGroups: WorkerDayGroup[]; // Grouped by worker+day
  timesheets: TimesheetDisplay[]; // All timesheets for reference
  totalHours: number;
  totalSpent: number;
}

function groupTimesheetsByProject(timesheets: TimesheetDisplay[]): ProjectGroup[] {
  const groups: Record<number, ProjectGroup> = {};
  const COMPANY_MARKUP = 1.52;
  
  for (const ts of timesheets) {
    if (!groups[ts.jobId]) {
      groups[ts.jobId] = {
        jobId: ts.jobId,
        jobTitle: ts.jobTitle,
        budgetCents: ts.budgetCents,
        workerDayGroups: [],
        timesheets: [],
        totalHours: 0,
        totalSpent: 0,
      };
    }
    groups[ts.jobId].timesheets.push(ts);
    const hoursToUse = ts.adjustedHours || ts.totalHours;
    groups[ts.jobId].totalHours += hoursToUse;
    groups[ts.jobId].totalSpent += Math.round(hoursToUse * ts.hourlyRate * COMPANY_MARKUP);
  }
  
  // Now group each project's timesheets by worker+day
  for (const group of Object.values(groups)) {
    const workerDayMap: Record<string, WorkerDayGroup> = {};
    
    for (const ts of group.timesheets) {
      const dateKey = format(ts.clockInTime, 'yyyy-MM-dd');
      const key = `${ts.workerId}-${dateKey}`;
      
      if (!workerDayMap[key]) {
        workerDayMap[key] = {
          workerId: ts.workerId,
          workerName: ts.workerName,
          workerAvatarUrl: ts.workerAvatarUrl,
          workerInitials: ts.workerInitials,
          date: dateKey,
          displayDate: format(ts.clockInTime, 'MMM d, yyyy'),
          timesheets: [],
          totalHours: 0,
          totalCost: 0,
          earliestAutoApproval: ts.autoApprovalMsRemaining,
          hasLocationIssues: false,
        };
      }
      
      workerDayMap[key].timesheets.push(ts);
      const hours = ts.adjustedHours || ts.totalHours;
      workerDayMap[key].totalHours += hours;
      workerDayMap[key].totalCost += Math.round(hours * ts.hourlyRate * COMPANY_MARKUP);
      
      // Track earliest auto-approval deadline
      if (ts.autoApprovalMsRemaining < workerDayMap[key].earliestAutoApproval) {
        workerDayMap[key].earliestAutoApproval = ts.autoApprovalMsRemaining;
      }
      
      // Track if any timesheet has location issues
      if (!ts.locationVerified) {
        workerDayMap[key].hasLocationIssues = true;
      }
    }
    
    // Sort worker-day groups by earliest auto-approval (most urgent first)
    group.workerDayGroups = Object.values(workerDayMap).sort(
      (a, b) => a.earliestAutoApproval - b.earliestAutoApproval
    );
  }
  
  return Object.values(groups);
}

interface CompletedProject {
  id: number;
  title: string;
  city: string;
  state: string;
  completedDate: string;
  hoursWorked: number;
  rating: number;
  images: string[];
}

const sampleCompletedProjects: Record<number, CompletedProject[]> = {
  1: [
    { id: 1, title: "Office Building Rewiring", city: "Austin", state: "TX", completedDate: "2025-12-15", hoursWorked: 48, rating: 5, images: ["https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=200"] },
    { id: 2, title: "Restaurant Electrical Install", city: "Houston", state: "TX", completedDate: "2025-11-28", hoursWorked: 32, rating: 5, images: [] },
    { id: 3, title: "Warehouse Lighting Upgrade", city: "Dallas", state: "TX", completedDate: "2025-10-12", hoursWorked: 24, rating: 4, images: ["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200"] },
  ],
  2: [
    { id: 4, title: "Commercial Plumbing Repair", city: "San Antonio", state: "TX", completedDate: "2025-12-20", hoursWorked: 16, rating: 5, images: [] },
    { id: 5, title: "Hotel Bathroom Renovation", city: "Austin", state: "TX", completedDate: "2025-11-05", hoursWorked: 40, rating: 5, images: ["https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=200"] },
  ],
  3: [
    { id: 6, title: "Custom Cabinet Installation", city: "Austin", state: "TX", completedDate: "2025-12-18", hoursWorked: 28, rating: 5, images: ["https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=200"] },
    { id: 7, title: "Office Trim Work", city: "Round Rock", state: "TX", completedDate: "2025-10-25", hoursWorked: 20, rating: 4, images: [] },
  ],
  4: [
    { id: 8, title: "Site Cleanup - Commercial", city: "Austin", state: "TX", completedDate: "2025-12-22", hoursWorked: 8, rating: 5, images: [] },
    { id: 9, title: "Demolition Assistance", city: "Pflugerville", state: "TX", completedDate: "2025-12-01", hoursWorked: 16, rating: 5, images: [] },
    { id: 10, title: "Material Transport", city: "Georgetown", state: "TX", completedDate: "2025-11-15", hoursWorked: 12, rating: 4, images: [] },
  ],
  5: [
    { id: 11, title: "Interior Office Painting", city: "Austin", state: "TX", completedDate: "2025-12-10", hoursWorked: 32, rating: 5, images: ["https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=200", "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=200"] },
    { id: 12, title: "Exterior House Paint", city: "Cedar Park", state: "TX", completedDate: "2025-11-20", hoursWorked: 24, rating: 5, images: ["https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=200"] },
  ],
};

const sampleWorkers: SampleWorker[] = [
  {
    id: 1,
    firstName: "Marcus",
    lastName: "Johnson",
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=faces",
    bio: "15+ years experience in commercial electrical work. Licensed and insured. Specialize in new construction and renovations.",
    skills: ["Electrical Elite", "HVAC Lite"],
    hourlyRate: 4500,
    rating: 4.9,
    completedJobs: 87,
    portfolioImages: ["https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=300", "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300", "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=300"],
    phone: "(512) 555-0101"
  },
  {
    id: 2,
    firstName: "Sarah",
    lastName: "Chen",
    avatarUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&h=150&fit=crop&crop=faces",
    bio: "Master plumber with expertise in residential and commercial projects. 10 years experience, excellent references available.",
    skills: ["Plumbing Elite", "General Labor"],
    hourlyRate: 5500,
    rating: 4.8,
    completedJobs: 62,
    portfolioImages: ["https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=300", "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=300"],
    phone: "(512) 555-0102"
  },
  {
    id: 3,
    firstName: "David",
    lastName: "Martinez",
    avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=faces",
    bio: "Skilled carpenter specializing in finish work and custom cabinetry. Attention to detail is my priority.",
    skills: ["Carpentry Elite", "Drywall"],
    hourlyRate: 4000,
    rating: 4.7,
    completedJobs: 45,
    portfolioImages: ["https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300", "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300"],
    phone: "(512) 555-0103"
  },
  {
    id: 4,
    firstName: "James",
    lastName: "Wilson",
    avatarUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=faces",
    bio: "Reliable general laborer with 5 years experience. Strong work ethic and always on time.",
    skills: ["General Labor", "Demolition", "Cleaning"],
    hourlyRate: 2500,
    rating: 4.6,
    completedJobs: 120,
    portfolioImages: [],
    phone: "(512) 555-0104"
  },
  {
    id: 5,
    firstName: "Emily",
    lastName: "Thompson",
    avatarUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=faces",
    bio: "Professional painter with an eye for detail. Interior and exterior, residential and commercial.",
    skills: ["Painting", "Drywall"],
    hourlyRate: 3000,
    rating: 4.9,
    completedJobs: 78,
    portfolioImages: ["https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=300", "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=300", "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=300"],
    phone: "(512) 555-0105"
  }
];

const sampleLocations: SampleLocation[] = [
  {
    id: 1,
    name: "Downtown Office Tower",
    address: "123 Main Street",
    city: "Austin",
    state: "TX",
    zipCode: "78701",
    jobs: [
      {
        id: 1,
        title: "Electrical Wiring - Floor 12",
        description: "Install new electrical wiring for renovated office space. Must have commercial electrical experience.",
        locationId: 1,
        trade: "Electrical",
        hourlyRate: 3800,
        maxWorkersNeeded: 2,
        workersHired: 1,
        status: "in_progress",
        startDate: "2026-01-12",
        endDate: "2026-01-20",
        estimatedHours: 40,
        timelineType: "recurring",
        recurringDays: ["mon", "tue", "wed", "thu", "fri"],
        recurringWeeks: 2,
        startTime: "08:00",
        endTime: "17:00",
        images: ["https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=400", "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400"],
        timesheets: [
          { workerId: 1, workerName: "Marcus Johnson", hoursClocked: 18, hourlyRate: 4500, status: "approved" },
        ],
        applications: [
          {
            id: 1,
            worker: sampleWorkers[0],
            message: "I have extensive experience with commercial electrical work. Available to start immediately.",
            proposedRate: 4500,
            status: "accepted",
            createdAt: "2026-01-08T10:30:00Z"
          },
          {
            id: 2,
            worker: sampleWorkers[3],
            message: "Looking for electrical work opportunities. I can assist with the installation.",
            proposedRate: 2500,
            status: "pending",
            createdAt: "2026-01-09T14:20:00Z"
          }
        ]
      },
      {
        id: 2,
        title: "Plumbing Repair - Restrooms",
        description: "Fix leaking pipes in 3rd floor restrooms. Urgent repair needed.",
        locationId: 1,
        trade: "Plumbing",
        hourlyRate: 4200,
        maxWorkersNeeded: 1,
        workersHired: 0,
        status: "open",
        startDate: "2026-01-15",
        estimatedHours: 8,
        timelineType: "on-demand",
        startTime: "08:00",
        endTime: "17:00",
        images: ["https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=400"],
        timesheets: [],
        applications: [
          {
            id: 3,
            worker: sampleWorkers[1],
            message: "Master plumber here. I can diagnose and fix the issue efficiently. Free to start this week.",
            proposedRate: 5500,
            status: "pending",
            createdAt: "2026-01-10T09:15:00Z"
          }
        ]
      }
    ]
  },
  {
    id: 2,
    name: "Westside Shopping Center",
    address: "456 Commerce Blvd",
    city: "Austin",
    state: "TX",
    zipCode: "78745",
    jobs: [
      {
        id: 3,
        title: "Interior Painting - Suite 200",
        description: "Paint interior walls of newly leased retail space. 2,500 sq ft.",
        locationId: 2,
        trade: "Painting",
        hourlyRate: 2800,
        maxWorkersNeeded: 3,
        workersHired: 2,
        status: "in_progress",
        startDate: "2026-01-11",
        endDate: "2026-01-13",
        estimatedHours: 24,
        timelineType: "one-day",
        startTime: "07:00",
        endTime: "16:00",
        images: ["https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=400", "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=400"],
        timesheets: [
          { workerId: 5, workerName: "Emily Thompson", hoursClocked: 8, hourlyRate: 3000, status: "approved" },
          { workerId: 3, workerName: "David Martinez", hoursClocked: 6, hourlyRate: 4000, status: "pending" },
        ],
        applications: [
          {
            id: 4,
            worker: sampleWorkers[4],
            message: "Professional painter with great references. I can bring my own supplies.",
            proposedRate: 3000,
            status: "accepted",
            createdAt: "2026-01-07T11:00:00Z"
          },
          {
            id: 5,
            worker: sampleWorkers[2],
            message: "I can help with prep work and painting. Very detail-oriented.",
            proposedRate: 4000,
            status: "accepted",
            createdAt: "2026-01-07T13:45:00Z"
          }
        ]
      }
    ]
  },
  {
    id: 3,
    name: "Residential Development - Phase 2",
    address: "789 New Home Lane",
    city: "Round Rock",
    state: "TX",
    zipCode: "78664",
    jobs: [
      {
        id: 4,
        title: "Framing - Lot 15",
        description: "Frame new residential home. Must have framing experience.",
        locationId: 3,
        trade: "Carpentry",
        hourlyRate: 3500,
        maxWorkersNeeded: 4,
        workersHired: 0,
        status: "open",
        startDate: "2026-01-20",
        endDate: "2026-02-15",
        estimatedHours: 80,
        timelineType: "recurring",
        recurringDays: ["mon", "tue", "wed", "thu", "fri"],
        recurringWeeks: 4,
        startTime: "06:00",
        endTime: "15:00",
        images: ["https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400"],
        timesheets: [],
        applications: []
      }
    ]
  }
];

const sampleTeamMembers: SampleTeamMember[] = [
  {
    id: 1,
    worker: sampleWorkers[0],
    addedFrom: "Electrical Wiring - Floor 12",
    notes: "Excellent work on the office tower project. Very professional.",
    rating: 5,
    isFavorite: true,
    createdAt: "2026-01-08T10:30:00Z"
  },
  {
    id: 2,
    worker: sampleWorkers[4],
    addedFrom: "Interior Painting - Suite 200",
    notes: "Great attention to detail. Clean work.",
    rating: 5,
    isFavorite: true,
    createdAt: "2026-01-07T11:00:00Z"
  },
  {
    id: 3,
    worker: sampleWorkers[2],
    addedFrom: "Interior Painting - Suite 200",
    notes: "Reliable and skilled. Good communicator.",
    rating: 4,
    isFavorite: false,
    createdAt: "2026-01-07T13:45:00Z"
  }
];

const sampleTimesheets: SampleTimesheet[] = [
  {
    id: 1,
    jobId: 1,
    jobTitle: "Electrical Wiring - Floor 12",
    worker: sampleWorkers[0],
    clockInTime: "2026-01-10T08:02:00Z",
    clockOutTime: "2026-01-10T17:15:00Z",
    totalHours: 9.22,
    adjustedHours: 9.22,
    hourlyRate: 4500,
    clockInDistance: 45,
    clockOutDistance: 38,
    locationVerified: true,
    locationAdjustmentReason: null,
    status: "pending",
    workerNotes: "Completed wiring for north section of floor 12."
  },
  {
    id: 2,
    jobId: 3,
    jobTitle: "Interior Painting - Suite 200",
    worker: sampleWorkers[4],
    clockInTime: "2026-01-10T07:58:00Z",
    clockOutTime: "2026-01-10T16:30:00Z",
    totalHours: 8.53,
    adjustedHours: 8.53,
    hourlyRate: 3000,
    clockInDistance: 22,
    clockOutDistance: 28,
    locationVerified: true,
    locationAdjustmentReason: null,
    status: "pending",
    workerNotes: "First coat applied to all walls."
  },
  {
    id: 3,
    jobId: 3,
    jobTitle: "Interior Painting - Suite 200",
    worker: sampleWorkers[2],
    clockInTime: "2026-01-10T08:45:00Z",
    clockOutTime: "2026-01-10T17:00:00Z",
    totalHours: 8.25,
    adjustedHours: 7.75,
    hourlyRate: 4000,
    clockInDistance: 850,
    clockOutDistance: 32,
    locationVerified: false,
    locationAdjustmentReason: "Clock-in location was 850m from job site. Adjusted by 30 minutes.",
    status: "pending",
    workerNotes: "Helped with prep work and trim painting."
  },
  {
    id: 4,
    jobId: 1,
    jobTitle: "Electrical Wiring - Floor 12",
    worker: sampleWorkers[0],
    clockInTime: "2026-01-09T08:00:00Z",
    clockOutTime: "2026-01-09T17:00:00Z",
    totalHours: 9.0,
    adjustedHours: 9.0,
    hourlyRate: 4500,
    clockInDistance: 35,
    clockOutDistance: 42,
    locationVerified: true,
    locationAdjustmentReason: null,
    status: "approved",
    workerNotes: "Started wiring installation on floor 12."
  },
  {
    id: 5,
    jobId: 3,
    jobTitle: "Interior Painting - Suite 200",
    worker: sampleWorkers[4],
    clockInTime: "2026-01-09T08:05:00Z",
    clockOutTime: "2026-01-09T16:00:00Z",
    totalHours: 7.92,
    adjustedHours: 7.92,
    hourlyRate: 3000,
    clockInDistance: 18,
    clockOutDistance: 24,
    locationVerified: true,
    locationAdjustmentReason: null,
    status: "approved",
    workerNotes: "Prep work and priming completed."
  }
];

// Stable component so inputs don't remount on parent re-render (fixes "can only type 1 character" focus loss)
function CompanyMenuPanelProfileFormView(props: {
  companyProfileForm: { companyName: string; companyWebsite: string; firstName: string; lastName: string; email: string; phone: string };
  setCompanyProfileForm: React.Dispatch<React.SetStateAction<{ companyName: string; companyWebsite: string; firstName: string; lastName: string; email: string; phone: string }>>;
  profile: any;
  user: any;
  companyLogoUrl: string | null;
  handleLogoUpload: (file: File) => Promise<void>;
  isUploadingLogo: boolean;
  alternateEmails: string[];
  setAlternateEmails: React.Dispatch<React.SetStateAction<string[]>>;
  newAlternateEmail: string;
  setNewAlternateEmail: (v: string) => void;
  alternatePhones: string[];
  setAlternatePhones: React.Dispatch<React.SetStateAction<string[]>>;
  newAlternatePhone: string;
  setNewAlternatePhone: (v: string) => void;
  updateProfile: { isPending: boolean; mutateAsync: (opts: any) => Promise<any> };
  toast: (opts: { title: string; description?: string }) => void;
  t: TFunction;
}) {
  const {
    companyProfileForm,
    setCompanyProfileForm,
    profile,
    user,
    companyLogoUrl,
    handleLogoUpload,
    isUploadingLogo,
    alternateEmails,
    setAlternateEmails,
    newAlternateEmail,
    setNewAlternateEmail,
    alternatePhones,
    setAlternatePhones,
    newAlternatePhone,
    setNewAlternatePhone,
    updateProfile,
    toast,
    t,
  } = props;
  const logoId = "logo-upload-input-panel";
  return (
    <div className="space-y-6 pr-4">
      <div className="flex items-start gap-4">
        <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/30 overflow-hidden">
          {companyLogoUrl ? (
            <img src={companyLogoUrl} alt={t("settings.companyLogo")} className="w-full h-full object-cover" />
          ) : (
            <Image className="w-8 h-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <Label>{t("settings.companyLogo")}</Label>
          <p className="text-sm text-muted-foreground mb-2">{t("settings.uploadLogoDesc")}</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            id={logoId}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLogoUpload(file);
              e.target.value = "";
            }}
            data-testid="input-logo-file-panel"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={isUploadingLogo}
            onClick={() => document.getElementById(logoId)?.click()}
            data-testid="button-upload-logo-panel"
          >
            {isUploadingLogo ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("settings.uploading")}</>
            ) : (
              <><Image className="w-4 h-4 mr-2" /> {companyLogoUrl ? t("settings.changeLogo") : t("settings.uploadLogo")}</>
            )}
          </Button>
        </div>
      </div>
      <Separator />
      <div>
        <Label>{t("settings.companyName")}</Label>
        <Input value={companyProfileForm.companyName} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, companyName: e.target.value }))} data-testid="input-company-name" />
      </div>
      <div>
        <Label>{t("settings.website")}</Label>
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("settings.websitePlaceholder")} value={companyProfileForm.companyWebsite} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, companyWebsite: e.target.value }))} data-testid="input-company-website" />
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("settings.firstName")}</Label>
          <Input value={companyProfileForm.firstName} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, firstName: e.target.value }))} data-testid="input-first-name" />
        </div>
        <div>
          <Label>{t("settings.lastName")}</Label>
          <Input value={companyProfileForm.lastName} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, lastName: e.target.value }))} data-testid="input-last-name" />
        </div>
      </div>
      <div>
        <Label>{t("settings.primaryEmail")}</Label>
        <Input
          type="email"
          readOnly
          className="bg-muted cursor-not-allowed"
          value={profile?.email ?? user?.email ?? companyProfileForm.email}
          data-testid="input-email"
          aria-label="Primary email (login email, cannot be changed here)"
        />
        <p className="text-xs text-muted-foreground mt-1">{t("settings.primaryEmailLoginNote")}</p>
      </div>
      <div>
        <Label>{t("settings.primaryPhone")}</Label>
        <Input type="tel" value={companyProfileForm.phone} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, phone: e.target.value }))} data-testid="input-phone" />
      </div>
      <Separator />
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>{t("settings.alternativeEmails")}</Label>
        </div>
        <div className="space-y-2">
          {alternateEmails.map((email, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={email} readOnly className="flex-1" />
              <Button variant="ghost" size="icon" aria-label="Remove email" onClick={() => setAlternateEmails(prev => prev.filter((_, idx) => idx !== i))}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                type="email"
                placeholder={t("settings.addAlternativeEmail")}
                value={newAlternateEmail}
                onChange={(e) => setNewAlternateEmail(e.target.value)}
                data-testid="input-alternate-email"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (newAlternateEmail && newAlternateEmail.includes("@")) {
                  setAlternateEmails(prev => [...prev, newAlternateEmail]);
                  setNewAlternateEmail("");
                }
              }}
              data-testid="button-add-alternate-email"
            >
              <Plus className="w-4 h-4 mr-1" /> {t("settings.add")}
            </Button>
          </div>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>{t("settings.alternativePhones")}</Label>
        </div>
        <div className="space-y-2">
          {alternatePhones.map((phone, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={phone} readOnly className="flex-1" />
              <Button variant="ghost" size="icon" aria-label="Remove phone" onClick={() => setAlternatePhones(prev => prev.filter((_, idx) => idx !== i))}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                type="tel"
                placeholder={t("settings.addAlternativePhone")}
                value={newAlternatePhone}
                onChange={(e) => setNewAlternatePhone(e.target.value)}
                data-testid="input-alternate-phone"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (newAlternatePhone) {
                  setAlternatePhones(prev => [...prev, newAlternatePhone]);
                  setNewAlternatePhone("");
                }
              }}
              data-testid="button-add-alternate-phone"
            >
              <Plus className="w-4 h-4 mr-1" /> {t("settings.add")}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          data-testid="button-save-profile-panel"
          disabled={updateProfile.isPending}
          onClick={async () => {
            if (!profile) return;
            try {
              await updateProfile.mutateAsync({
                id: profile.id,
                data: {
                  companyName: companyProfileForm.companyName.trim() || undefined,
                  companyWebsite: companyProfileForm.companyWebsite.trim() || undefined,
                  firstName: companyProfileForm.firstName.trim() || undefined,
                  lastName: companyProfileForm.lastName.trim() || undefined,
                  email: (profile?.email ?? user?.email ?? companyProfileForm.email).trim() || undefined,
                  phone: companyProfileForm.phone.trim() || undefined,
                  alternateEmails,
                  alternatePhones,
                },
                skipToast: true,
              });
              toast({ title: t("settings.profileUpdated"), description: t("settings.profileSavedDesc") });
            } catch (e) {
              // Error toast is shown by updateProfile
            }
          }}
        >
          {updateProfile.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {t("settings.saveChanges")}
        </Button>
      </div>

      <div className="pt-6 border-t border-border">
        <LoginSecuritySection embedded />
      </div>
    </div>
  );
}

export default function CompanyDashboard() {
  const [pathname, setLocation] = useLocation();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const { t: tCommon } = useTranslation("common");
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const { data: adminCheck } = useAdminCheck();
  const isAdmin = adminCheck?.isAdmin ?? false;
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isScrolled = useScrollHeader();
  
  const { data: realTimesheets = [], isLoading: timesheetsLoading } = useCompanyTimesheets(profile?.id);
  const approveTimesheet = useApproveTimesheet();
  const rejectTimesheet = useRejectTimesheet();
  const bulkApproveTimesheets = useBulkApproveTimesheets();
  
  const { data: teamInvites = [] } = useQuery<any[]>({
    queryKey: ["/api/team-invites"],
    enabled: !!profile,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
  
  const { data: teamMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/team-members"],
    enabled: !!profile,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
  
  // Saved contractors (your team of workers)
  const { data: savedTeam = [], refetch: refetchSavedTeam } = useQuery<any[]>({
    queryKey: ["/api/saved-team"],
    enabled: !!profile,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Chat jobs for unread counts and active call status on in-progress cards
  const { data: chatJobs = [] } = useQuery<{ job: { id: number }; unreadCount: number; hasActiveCall?: boolean }[]>({
    queryKey: ["/api/chats/jobs"],
    enabled: !!profile,
    staleTime: 30 * 1000,
  });
  const jobUnreadMap = useMemo(() => {
    const map: Record<number, number> = {};
    chatJobs.forEach((cj) => { map[cj.job.id] = cj.unreadCount ?? 0; });
    return map;
  }, [chatJobs]);
  const totalUnreadChats = useMemo(() => chatJobs.reduce((sum, cj) => sum + (cj.unreadCount ?? 0), 0), [chatJobs]);
  const jobHasActiveCallSet = useMemo(() => {
    const set = new Set<number>();
    chatJobs.forEach((cj) => { if (cj.hasActiveCall) set.add(cj.job.id); });
    return set;
  }, [chatJobs]);

  // Team grouped by location (company team + saved workers per location)
  const { data: teamByLocationData, refetch: refetchTeamByLocation } = useQuery<{ locations: Array<{
    id: number | null;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    companyTeamMembers: any[];
    savedWorkers: any[];
  }> }>({
    queryKey: ["/api/team-by-location"],
    enabled: !!profile && profile.role === "company",
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const teamByLocation = teamByLocationData?.locations ?? [];
  
  // Workers with approved jobs who can be added to team
  const { data: potentialTeamMembers = [], refetch: refetchPotentialTeam } = useQuery<any[]>({
    queryKey: ["/api/potential-team-members"],
    enabled: !!profile,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
  
  // Add worker to saved team (optionally for a specific location)
  const addToSavedTeam = useMutation({
    mutationFn: async (data: { workerId: number; jobId?: number; notes?: string; locationId?: number | null; worker?: any }) => {
      const res = await apiRequest("POST", "/api/saved-team", { workerId: data.workerId, jobId: data.jobId, notes: data.notes, locationId: data.locationId });
      return res.json();
    },
    onMutate: async (data: { workerId: number; jobId?: number; notes?: string; worker?: any }) => {
      let worker = data.worker;
      if (!worker) {
        const found = potentialTeamMembers.find((p: any) => (p.worker?.id ?? p.id) === data.workerId || p.workerId === data.workerId);
        worker = found?.worker ?? found;
      }
      if (!worker) return {};
      await queryClient.cancelQueries({ queryKey: ["/api/saved-team"] });
      const previous = queryClient.getQueryData<any[]>(["/api/saved-team"]);
      const optimisticMember = {
        id: -Date.now(),
        workerId: data.workerId,
        addedFromJobId: data.jobId || null,
        notes: data.notes || null,
        worker: typeof worker === "object" ? worker : { id: data.workerId, firstName: "Worker", lastName: "" },
      };
      queryClient.setQueryData<any[]>(["/api/saved-team"], (old) => [...(old || []), optimisticMember]);
      return { previous };
    },
    onError: (error: any, _data, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(["/api/saved-team"], context.previous);
      }
      toast({ title: tCommon("error"), description: error.message || t("company.team.failedToAddWorker"), variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Worker added to your team" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/potential-team-members"] });
    },
  });

  // Remove worker from saved team
  const removeFromSavedTeam = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/saved-team/${id}`);
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/saved-team"] });
      const previous = queryClient.getQueryData<any[]>(["/api/saved-team"]);
      queryClient.setQueryData<any[]>(["/api/saved-team"], (old) => (old || []).filter((m: any) => m.id !== id));
      return { previous };
    },
    onError: (error: any, _id, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(["/api/saved-team"], context.previous);
      }
      toast({ title: tCommon("error"), description: error.message || t("company.team.failedToRemoveWorker"), variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: tCommon("removed") || "Removed", description: t("company.team.workerRemovedFromTeam") });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/potential-team-members"] });
    },
  });

  // Update saved team member
  const updateSavedTeamMember = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/saved-team/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-by-location"] });
      toast({ title: tCommon("updated") || "Updated", description: t("company.team.teamMemberUpdated") });
    },
    onError: (error: any) => {
      toast({ title: tCommon("error"), description: error.message || t("company.team.failedToUpdateTeamMember"), variant: "destructive" });
    },
  });
  
  // Report worker (issue strike)
  const reportWorker = useMutation({
    mutationFn: async (data: { workerId: number; timesheetId?: number; explanation: string; isStrike: boolean; privateNotes?: string }) => {
      const res = await apiRequest("POST", "/api/worker-report", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("company.team.reportSubmitted"), description: t("company.team.workerHasBeenNotified") });
    },
    onError: (error: any) => {
      toast({ title: tCommon("error"), description: error.message || t("company.team.failedToSubmitReport"), variant: "destructive" });
    },
  });
  
  const createTeamInvite = useMutation({
    mutationFn: async (data: { email: string; role: string; firstName?: string; lastName?: string; phone?: string; jobPosition?: string; locationIds?: string[] }) => {
      const res = await apiRequest("POST", "/api/team-invites", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-invites"] });
      setInviteWizardStep(0);
      setInviteData({ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", role: "manager", locationIds: [] });
      toast({ title: tCommon("success"), description: t("company.team.inviteSentSuccessfully") });
    },
    onError: (error: any) => {
      toast({ title: tCommon("error"), description: error.message || "Failed to send invite", variant: "destructive" });
    },
  });
  
  const deleteTeamInvite = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/team-invites/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-invites"] });
    },
  });

  const resendTeamInvite = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/team-invites/${id}/resend`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-invites"] });
      toast({ title: t("company.team.inviteResent"), description: t("company.team.invitationEmailSentAgain") });
    },
    onError: (error: any) => {
      toast({ title: tCommon("error"), description: error.message || t("company.team.failedToResendInvite"), variant: "destructive" });
    },
  });
  
  const deleteTeamMember = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/team-members/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
    },
  });
  
  const updateApplicationStatus = useMutation({
    mutationFn: async ({ id, status, rejectionReason }: { id: number; status: "pending" | "accepted" | "rejected"; rejectionReason?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${id}/status`, { status, rejectionReason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
    },
  });
  
  // URL-based routing for dashboard sections
  const navigate = setLocation;
  const [, params] = useRoute("/company-dashboard/:section?/:subsection?");
  const section = params?.section || "jobs";
  const subsection = params?.subsection || null;
  
  // Map section to tab value for backward compatibility (chats uses same header, no separate Chats title)
  const activeTab = ["jobs", "team", "timesheets", "menu", "chats"].includes(section) ? section : "jobs";
  
  const setActiveTab = (tab: string) => {
    navigate(`/company-dashboard/${tab}`);
  };
  
  // Breadcrumb helper for subsections
  const breadcrumbLabels: Record<string, string> = {
    jobs: t("nav.jobs"),
    team: t("nav.team"),
    timesheets: t("company.timesheets"),
    calendar: "Calendar",
    menu: t("nav.menu"),
    profile: t("menu.profile"),
    "payment-methods": t("payment.method"),
    billing: t("menu.billing"),
    invoices: t("company.invoices"),
    locations: t("company.locations"),
    "team-access": t("menu.team"),
    notifications: t("menu.notifications"),
    "hiring-preferences": t("settings.hiringPreferences"),
    agreements: t("menu.terms"),
    language: t("settings.language"),
    help: t("menu.help"),
  };
  
  const resetTeamRequestData = () => {
    setTeamRequestData({
      jobTitle: "",
      locationId: "",
      shiftType: "" as "on-demand" | "one-day" | "recurring" | "",
      startDate: "",
      startTime: "08:00",
      endTime: "17:00",
      recurringDays: [],
      recurringWeeks: 1,
      estimatedHours: "",
      description: "",
      selectedSkillsets: [],
      fallbackToPublic: true,
    });
    setTeamRequestStep(1);
  };
  
  const getBreadcrumbs = () => {
    const crumbs: { label: string; path: string }[] = [
      { label: breadcrumbLabels[activeTab] || activeTab, path: `/company-dashboard/${activeTab}` }
    ];
    if (subsection) {
      crumbs.push({ label: breadcrumbLabels[subsection] || subsection, path: `/company-dashboard/${activeTab}/${subsection}` });
    }
    return crumbs;
  };
  
  // Sync desktop menu selection from URL subsection (deep links)
  useEffect(() => {
    const sub = subsection as CompanyMenuSelection;
    if (activeTab === "menu" && subsection && !isMobile && ["profile", "locations", "payment-methods", "team-access", "notifications", "hiring-preferences", "billing", "agreements", "language"].includes(sub)) {
      setMenuSelection(sub);
    }
  }, [activeTab, subsection, isMobile]);

  // Handle URL-based subsection popups (mobile + desktop; use global popup style)
  useEffect(() => {
    if (activeTab === "menu" && subsection) {
      const dialogMap: Record<string, (v: boolean) => void> = {
        "profile": setShowCompanyProfile,
        "payment-methods": setShowPaymentMethods,
        "billing": setShowBillingHistory,
        "invoices": setShowInvoices,
        "locations": setShowLocations,
        "team-access": setShowTeamAccess,
        "notifications": setShowNotifications,
        "hiring-preferences": setShowHiringPreferences,
        "agreements": setShowAgreements,
        "language": setShowLanguageMenu,
        "help": setShowHelp,
      };
      const setter = dialogMap[subsection];
      if (setter) setter(true);
    }
  }, [subsection, activeTab]);
  
  // Check for mandatory requirements - agreement and payment method (uses hasSignedAgreement from below)
  
  // Fetch Stripe config for card payments (uses sandbox/test keys in dev)
  useEffect(() => {
    const fetchStripeConfig = async () => {
      try {
        const res = await fetch("/api/stripe/config");
        if (res.ok) {
          const config = await res.json();
          if (config.publishableKey) {
            if (import.meta.env.DEV && config.useSandbox !== false) {
              console.log("[Stripe] Using sandbox/test keys (mode=" + (config.mode || "test") + "). Card data is not charged.");
            }
            setStripePromise(loadStripe(config.publishableKey));
          } else if (import.meta.env.DEV) {
            console.warn("[Stripe] No publishableKey in config – check server STRIPE_TEST_PUBLISHABLE_KEY");
          }
        }
      } catch (err) {
        console.error("Failed to fetch Stripe config:", err);
      }
    };
    fetchStripeConfig();
  }, []);
  
  // Close popup and navigate back to menu
  const closeMenuPopup = () => {
    navigate("/company-dashboard/menu");
  };
  
  const [mobileJobDrawer, setMobileJobDrawer] = useState<{ job: SampleJob; location: SampleLocation } | null>(null);
  const [mobileLocationPopup, setMobileLocationPopup] = useState<SampleLocation | null>(null);
  const [expandedLocations, setExpandedLocations] = useState<number[]>([1, 2]);
  const [expandedJobs, setExpandedJobs] = useState<number[]>([]);
  const [expandedInProgressJobIds, setExpandedInProgressJobIds] = useState<string[]>([]);
  const [selectedApplication, setSelectedApplication] = useState<SampleApplication | null>(null);

  // Reviews for selected applicant (when reviewing application)
  const applicantWorkerId = selectedApplication?.worker?.id;
  const { data: applicantReviewsData, isLoading: applicantReviewsLoading } = useQuery<{ reviews: any[]; averageRating: number; totalReviews: number } | null>({
    queryKey: ["/api/reviews", applicantWorkerId],
    queryFn: async () => {
      if (!applicantWorkerId) return null;
      const res = await fetch(`/api/reviews?revieweeId=${applicantWorkerId}`, { credentials: "include" });
      if (!res.ok) return null; // 403 or other - don't throw, just return null
      return res.json();
    },
    enabled: !!applicantWorkerId,
  });
  const applicantReviews = applicantReviewsData?.reviews || [];

  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const [showWorkerProfileContext, setShowWorkerProfileContext] = useState<{ worker: SampleWorker; manager?: { id: number; firstName: string | null; lastName: string | null } } | null>(null);
  const showWorkerProfile = showWorkerProfileContext?.worker ?? null;
  const [showCompletedProjects, setShowCompletedProjects] = useState<SampleWorker | null>(null);
  const [showDirectRequest, setShowDirectRequest] = useState<SampleTeamMember | null>(null);
  const [timesheetTab, setTimesheetTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [expandedTimesheetMap, setExpandedTimesheetMap] = useState<number | null>(null);
  
  const [showCompanyProfile, setShowCompanyProfile] = useState(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [paymentMethodsView, setPaymentMethodsView] = useState<"list" | "assignLocations">("list");
  const [editPaymentMethodLocations, setEditPaymentMethodLocations] = useState<{ id: number; locationIds: string[] | null } | null>(null);
  const [bankVerificationMethod, setBankVerificationMethod] = useState<any | null>(null);
  const [showTeamAccess, setShowTeamAccess] = useState(false);
  const [inviteWizardStep, setInviteWizardStep] = useState(0); // 0=list (menu only), 1=Details, 2=Permissions, 3=Location (optional)
  const [inviteData, setInviteData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    jobPosition: "",
    role: "manager" as "admin" | "manager" | "viewer",
    locationIds: [] as string[],
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHiringPreferences, setShowHiringPreferences] = useState(false);
  const [showBillingHistory, setShowBillingHistory] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [showAgreements, setShowAgreements] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [addLocationStep, setAddLocationStep] = useState(1);
  const [showAddTeammateFromLocation, setShowAddTeammateFromLocation] = useState(false);
  const [showAddPaymentMethod, setShowAddPaymentMethod] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  
  // Mandatory onboarding popups - cannot be dismissed until completed
  const [showMandatoryAgreement, setShowMandatoryAgreement] = useState(false);
  const [showMandatoryPaymentMethod, setShowMandatoryPaymentMethod] = useState(false);
  const [showBlockingOnboardingPopup, setShowBlockingOnboardingPopup] = useState(false);
  const [mandatorySignatureName, setMandatorySignatureName] = useState("");
  // Auto-fill signature when agreement dialog opens, if profile has name
  useEffect(() => {
    if (showMandatoryAgreement && profile) {
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim()
        || (profile as { companyName?: string }).companyName?.trim()
        || "";
      if (name) setMandatorySignatureName(name);
    }
  }, [showMandatoryAgreement, profile?.id]);
  const [mandatoryAchForm, setMandatoryAchForm] = useState({ routingNumber: "", accountNumber: "", confirmAccountNumber: "", accountType: "Checking", bankName: "" });
  const [mandatoryPaymentType, setMandatoryPaymentType] = useState<"ach" | "card">("ach");
  const [mandatoryAgreementError, setMandatoryAgreementError] = useState<string | null>(null);
  const mandatoryContractRef = useRef<HTMLDivElement>(null);
  const [showPendingRequests, setShowPendingRequests] = useState(false);
  const [actionRequiredItemIndex, setActionRequiredItemIndex] = useState(0);
  const actionRequiredReopenAtRef = useRef<number | null>(null);
  const actionRequiredConfettiFiredRef = useRef(false);
  const [actionHubView, setActionHubView] = useState<"main" | "adjustTimeline" | "rejectReason" | "jobDetails">("main");
  const [actionHubJobForTimeline, setActionHubJobForTimeline] = useState<SampleJob | null>(null);
  const [actionHubJobForDetails, setActionHubJobForDetails] = useState<{ job: SampleJob; location: SampleLocation } | null>(null);
  const [actionHubApplicationToReject, setActionHubApplicationToReject] = useState<{ app: SampleApplication; job: SampleJob } | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [cameFromPendingRequests, setCameFromPendingRequests] = useState(false);
  const [showBalanceDialog, setShowBalanceDialog] = useState(false);
  const [showPendingPaymentsDialog, setShowPendingPaymentsDialog] = useState(false);
  const [showJobCommitmentsDialog, setShowJobCommitmentsDialog] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<number | null>(null);
  const [topUpPaymentError, setTopUpPaymentError] = useState<string | null>(null);
  const [lastFailedPaymentMethodId, setLastFailedPaymentMethodId] = useState<number | null>(null);
  const addPaymentOpenedFromTopUpRef = useRef(false);
  const addPaymentOpenedFromAddLocationRef = useRef(false);
  const previousPaymentMethodIdsRef = useRef<number[]>([]);

  // Calendar view state
  const [calendarViewMode, setCalendarViewMode] = useState<"day" | "week" | "month" | "map">("day");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  const [enabledTeammates, setEnabledTeammates] = useState<Set<number>>(new Set());
  
  const [editTimesheetModal, setEditTimesheetModal] = useState<TimesheetDisplay | null>(null);
  const [editTimesheetStep, setEditTimesheetStep] = useState<"form" | "success">("form");
  const [reportTimesheetModal, setReportTimesheetModal] = useState<TimesheetDisplay | null>(null);
  const [bulkRejectModal, setBulkRejectModal] = useState<TimesheetDisplay[] | null>(null);
  const [rejectTimesheetStep, setRejectTimesheetStep] = useState<"review" | "form" | "success">("review");
  const [mobileWorkerDaySheet, setMobileWorkerDaySheet] = useState<{ workerDay: WorkerDayGroup } | null>(null);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  /** Inline edit/reject panel inside Action Required timesheet card (groupKey + mode + timesheets). When set, Edit/Reject flow runs inside the card below the map. */
  const [actionReqInlinePanel, setActionReqInlinePanel] = useState<{ groupKey: string; mode: "edit" | "reject"; timesheets: TimesheetDisplay[] } | null>(null);
  /** After edit/reject success, card shows this style until cleared (worker will receive email notification from server). */
  const [actionReqProcessedCard, setActionReqProcessedCard] = useState<{ groupKey: string; status: "edited" | "rejected" } | null>(null);
  const [simulatedSampleStatus, setSimulatedSampleStatus] = useState<Record<number, "approved" | "rejected">>({});
  const [showTimesheetSettings, setShowTimesheetSettings] = useState(false);
  const [timesheetSettings, setTimesheetSettings] = useState({
    autoApprove: false,
    autoApproveWindow: "24", // hours
    requireLocationVerification: true,
    maxDailyHours: "12",
    overtimeThreshold: "8",
    breakDeduction: false, // Default to false - not checked
    breakMinutes: "30",
    roundingIncrement: "15", // minutes
    sendApprovalNotifications: true,
    requireNotes: false,
  });
  const [removeWorkerDialog, setRemoveWorkerDialog] = useState<{ application: SampleApplication; job: SampleJob } | null>(null);
  const [rehireAfterRemove, setRehireAfterRemove] = useState(true);
  const [editExplanation, setEditExplanation] = useState("");
  const [editHours, setEditHours] = useState("");
  const [reportExplanation, setReportExplanation] = useState("");
  
  // Potential team members panel (collapsible)
  const [showPotentialTeamPanel, setShowPotentialTeamPanel] = useState(true);
  
  // Report worker modal state
  const [reportWorkerModal, setReportWorkerModal] = useState<{ workerId: number; workerName: string } | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportPrivateNote, setReportPrivateNote] = useState("");
  const [isStrikeReport, setIsStrikeReport] = useState(true);
  
  // Media viewer state
  const [mediaViewer, setMediaViewer] = useState<{ items: { type: 'image' | 'video'; url: string }[]; currentIndex: number } | null>(null);
  
  // Escrow popup state for when worker has no bank account
  const [escrowInfo, setEscrowInfo] = useState<{ workerBankMissing: boolean; workerName: string; amount: number; message: string } | null>(null);
  
  const [billingFilters, setBillingFilters] = useState({
    dateFrom: "",
    dateTo: "",
    type: "all",
    worker: "all",
    category: "all" as "all" | "funding" | "spend", // Funding = deposit, auto_recharge; Spend = charge, refund
  });
  const [composeReceiptItem, setComposeReceiptItem] = useState<{
    id: string; date: string; type: string; amount: number; paymentMethod?: string; method?: string;
    stripePaymentIntentId?: string; mtPaymentOrderId?: string; cardFee?: number; initiatedBy?: string;
    workerName?: string | null; jobTitle?: string | null;
  } | null>(null);
  const [composeReceiptMemo, setComposeReceiptMemo] = useState("");
  
  const [newLocation, setNewLocation] = useState({
    name: "",
    address: "",
    address2: "",
    city: "",
    state: "",
    zipCode: "",
    useCompanyDefault: true,
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    contactAltPhone: "",
    representativeTeamMemberId: null as number | null,
    selectedPhoneOption: "company" as "company" | "alt" | "custom" | "team", // Which phone source is selected
    paymentMethodId: null as number | null, // Payment method to auto-charge for timesheets at this location
  });
  
  const [showEditLocation, setShowEditLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<{
    id: number;
    name: string;
    address: string;
    address2?: string;
    city: string;
    state: string;
    zipCode: string;
    useCompanyDefault: boolean;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    contactAltPhone: string;
    representativeTeamMemberId: number | null;
    assignedTeamMemberIds: number[];
    selectedPhoneOption: "company" | "alt" | "custom" | "team";
    paymentMethodId: number | null;
  } | null>(null);
  
  const [alternateEmails, setAlternateEmails] = useState<string[]>([]);
  const [alternatePhones, setAlternatePhones] = useState<string[]>([]);
  const [newAlternateEmail, setNewAlternateEmail] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [newAlternatePhone, setNewAlternatePhone] = useState("");
  const [companyProfileForm, setCompanyProfileForm] = useState({
    companyName: "",
    companyWebsite: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  
  // Fetch payment methods from database
  const { data: paymentMethods = [], refetch: refetchPaymentMethods, isLoading: paymentMethodsLoading, isFetched: paymentMethodsFetched, isSuccess: paymentMethodsSuccess } = useQuery<Array<{
    id: number;
    profileId: number;
    type: "ach" | "card";
    lastFour: string;
    bankName?: string | null;
    cardBrand?: string | null;
    expiryMonth?: number | null;
    expiryYear?: number | null;
    unitCounterpartyId?: string | null;
    routingNumber?: string | null;
    stripePaymentMethodId?: string | null;
    isPrimary?: boolean | null;
    isVerified?: boolean | null;
    stripeBankStatus?: string | null;
  }>>({
    queryKey: ["/api/company/payment-methods", profile?.id],
    queryFn: async () => {
      const res = await fetch("/api/company/payment-methods", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      return res.json();
    },
    enabled: !!profile && profile.role === "company",
    staleTime: 0, // Always refetch to ensure we have latest (avoids modal reappearing when CC was saved)
    refetchOnWindowFocus: true, // Refetch when user returns to tab so list reflects any server-side removals (e.g. unusable PM removed)
  });

  // When user opens Payment Methods panel, refetch so list reflects current DB (e.g. if server removed an unusable payment method, it disappears here and add-payment popup can trigger)
  useEffect(() => {
    if (showPaymentMethods && profile?.role === "company") {
      refetchPaymentMethods().then(({ data }) => {
        // If server removed the last payment method, list is empty; invalidate profile so primaryPaymentMethodId is cleared and add-payment popup can show
        if (Array.isArray(data) && data.length === 0) {
          queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
        }
      });
    }
  }, [showPaymentMethods, profile?.role, queryClient, refetchPaymentMethods]);

  // Prefer profile cache (primary payment method id + verification status on company record) so we don't fetch payment methods every time
  const profilePrimaryId = (profile as any)?.primaryPaymentMethodId ?? (profile as any)?.primary_payment_method_id;
  const profilePrimaryVerified = (profile as any)?.primaryPaymentMethodVerified ?? (profile as any)?.primary_payment_method_verified;
  const profileLastFailedId = (profile as any)?.lastFailedPaymentMethodId ?? (profile as any)?.last_failed_payment_method_id;
  const paymentMethodsList = paymentMethods || [];
  const hasUsablePaymentMethodFromList = paymentMethodsList.some((m: any) => {
    const type = m.type ?? m.payment_method_type;
    const verified = m.isVerified ?? m.is_verified;
    return type === "card" || (type === "ach" && verified);
  });
  const hasUsablePaymentMethod = profilePrimaryVerified === true ? true : hasUsablePaymentMethodFromList;
  const hasAnyPaymentMethod = profilePrimaryId != null ? true : paymentMethodsList.length > 0;
  const hasPendingBank = paymentMethodsList.some((m: any) => {
    const type = m.type ?? m.payment_method_type;
    const verified = m.isVerified ?? m.is_verified;
    return type === "ach" && !verified;
  });

  // Agreement counts as signed if contractSigned is true OR contractSignedAt is set (server may set only one)
  const hasSignedAgreement = Boolean(
    profile &&
      (profile.contractSigned === true ||
        (profile.contractSignedAt != null && String(profile.contractSignedAt).trim() !== ""))
  );

  // Show mandatory agreement popup when company has not signed (only after profile loaded)
  useEffect(() => {
    if (!profile || profileLoading) return;
    if (profile.role === "company" && !hasSignedAgreement) {
      setShowMandatoryAgreement(true);
    }
  }, [profile, profileLoading, hasSignedAgreement]);

  // Approved timesheets with paymentStatus "failed" (payment was attempted, charge declined/failed)
  const hasUnpaidFailedItems = (realTimesheets || []).some(
    (ts: any) => ts.status === "approved" && (ts.paymentStatus === "failed" || ts.payment_status === "failed")
  );

  // When a payment attempt fails (e.g. top-up), show popup so user can add/fix payment method
  const [paymentFailedTrigger, setPaymentFailedTrigger] = useState(false);
  
  // Check for payment method after agreement is signed - only after query has completed.
  // When server removes a payment method (e.g. Stripe "may not be used again"), refetch returns updated list;
  // if no usable methods remain, show global add-payment popup.
  useEffect(() => {
    if (!profile || profileLoading) return;
    // Don't show popup until payment methods query has completed
    if (!paymentMethodsFetched || paymentMethodsLoading) return;
    
    // User has a usable payment method (card or verified ACH) OR has a positive deposit
    const hasPaymentCapability = hasUsablePaymentMethod || (profile.depositAmount && profile.depositAmount > 0);
    
    // If agreement is signed but no payment method AND no deposit, show payment popup (e.g. after server removed last PM)
    if (profile.role === "company" && hasSignedAgreement && !hasPaymentCapability) {
      setShowMandatoryPaymentMethod(true);
    } else if (hasPaymentCapability) {
      // If they have payment methods or a deposit, ensure popup is closed
      setShowMandatoryPaymentMethod(false);
    }
  }, [profile, profileLoading, hasSignedAgreement, hasUsablePaymentMethod, paymentMethodsFetched, paymentMethodsLoading]);
  
  // Fetch company balance from Modern Treasury
  const { data: balanceData } = useQuery<{
    balanceCents: number;
    hasBankLinked: boolean;
    hasVirtualAccount: boolean;
  }>({
    queryKey: ["/api/mt/company/balance"],
    enabled: !!profile && profile.role === "company",
    refetchInterval: 60000, // Reduced from 30s to 60s - less frequent polling
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
  
  // Fetch company transactions (billing history)
  const { data: transactionsData } = useQuery<{
    transactions: Array<{
      id: number;
      type: string;
      amount: number;
      description: string | null;
      mtPaymentStatus: string | null;
      mtPaymentOrderId: string | null;
      createdAt: string;
    }>;
    pendingCount: number;
    pendingTotal: number;
  }>({
    queryKey: ["/api/mt/company/transactions"],
    enabled: !!profile && profile.role === "company",
    refetchInterval: 60000, // Reduced from 30s to 60s - less frequent polling
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Add new ACH payment method via Modern Treasury
  const addPaymentMethodMutation = useMutation({
    mutationFn: async (data: { routingNumber: string; accountNumber: string; accountType: string; bankName: string }) => {
      const res = await apiRequest("POST", "/api/mt/company/link-bank", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/balance"] });
      toast({ title: "Payment method added", description: "Bank account has been linked for ACH payments." });
      setShowAddPaymentMethod(false);
      setAchForm({ routingNumber: "", accountNumber: "", accountType: "Checking", bankName: "" });
      setNewPaymentMethod({ routingNumber: "", accountNumber: "", accountType: "Checking", bankName: "" });
    },
    onError: (err: any) => {
      toast({ title: t("company.payment.failedToAddPaymentMethod"), description: err.message || tCommon("pleaseTryAgain") || "Please try again", variant: "destructive" });
    },
  });

  // Fund company balance via Modern Treasury ACH debit
  const fundBalanceMutation = useMutation({
    mutationFn: async ({ amountCents, paymentMethodId }: { amountCents: number; paymentMethodId?: number }) => {
      const res = await apiRequest("POST", "/api/mt/company/fund", { amountCents, paymentMethodId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/transactions"] });
      setTopUpPaymentError(null);
      setLastFailedPaymentMethodId(null);
      toast({ 
        title: "Funding Initiated", 
        description: data.message || "Balance will update when ACH clears (1-2 business days)." 
      });
      setTopUpAmount("");
      setShowBalanceDialog(false);
    },
    onError: (err: any, variables: { amountCents: number; paymentMethodId?: number }) => {
      setTopUpPaymentError(err?.message || t("company.payment.fundingFailed") || "Funding failed.");
      setLastFailedPaymentMethodId(variables?.paymentMethodId ?? null);
      toast({ 
        title: t("company.payment.fundingFailed"), 
        description: err.message || "Please try again.", 
        variant: "destructive" 
      });
    },
  });

  // Fund company balance via Stripe card payment
  const cardTopUpMutation = useMutation({
    mutationFn: async ({ amountCents, paymentMethodId, stripePaymentMethodId }: { 
      amountCents: number; 
      paymentMethodId: number;
      stripePaymentMethodId?: string;
    }) => {
      if (!stripePaymentMethodId) {
        throw new Error("No saved card payment method found");
      }
      
      // Step 1: Create a PaymentIntent
      const createRes = await apiRequest("POST", "/api/stripe/create-payment-intent", { 
        amount: amountCents,
        includeCardFee: true,
        savedPaymentMethodId: stripePaymentMethodId
      });
      const intentData = await createRes.json();
      
      if (!intentData.clientSecret) {
        throw new Error("Failed to create payment intent");
      }
      
      // Step 2: Confirm the payment using the saved card
      const confirmRes = await apiRequest("POST", "/api/stripe/charge-saved-card", {
        paymentIntentId: intentData.paymentIntentId,
        stripePaymentMethodId
      });
      const result = await confirmRes.json();
      
      // Step 3: Handle 3D Secure if required
      if (result.requiresAction && result.clientSecret) {
        // Use same key as server (sandbox on localhost/dev) via API so client and server always match
        const configRes = await fetch("/api/stripe/config", { credentials: "include" });
        const config = await configRes.json().catch(() => ({}));
        const stripeKey = config.publishableKey || import.meta.env.VITE_STRIPE_TEST_PUBLISHABLE_KEY || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        if (!stripeKey) throw new Error("Stripe not configured");
        const stripe = await loadStripe(stripeKey);
        if (!stripe) {
          throw new Error("Failed to load Stripe for authentication");
        }
        
        // Use Stripe.js to handle the authentication
        const { error, paymentIntent } = await stripe.confirmCardPayment(result.clientSecret);
        
        if (error) {
          throw new Error(error.message || "Card authentication failed");
        }
        
        if (paymentIntent?.status === "succeeded") {
          // Call backend to finalize the balance update after 3DS
          const finalizeRes = await apiRequest("POST", "/api/stripe/finalize-3ds-payment", {
            paymentIntentId: result.paymentIntentId
          });
          return finalizeRes.json();
        } else {
          throw new Error("Payment was not completed successfully");
        }
      }
      
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
      setTopUpPaymentError(null);
      setLastFailedPaymentMethodId(null);
      toast({ 
        title: t("company.payment.paymentSuccessful"), 
        description: `$${(data.baseAmount / 100).toFixed(2)} has been added to your balance.`
      });
      setTopUpAmount("");
      setShowBalanceDialog(false);
    },
    onError: (err: any, variables: { amountCents: number; paymentMethodId: number; stripePaymentMethodId?: string }) => {
      setTopUpPaymentError(err?.message || t("company.payment.paymentFailed") || "Payment failed.");
      setLastFailedPaymentMethodId(variables?.paymentMethodId ?? null);
      setPaymentFailedTrigger(true);
      toast({ 
        title: t("company.payment.paymentFailed"), 
        description: err.message || "Please try again or use a different payment method.", 
        variant: "destructive" 
      });
    },
  });

  // Delete payment method
  const deletePaymentMethodMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/company/payment-methods/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
      toast({ title: t("company.payment.paymentMethodRemoved"), description: t("company.payment.bankAccountUnlinked") });
    },
    onError: (err: any) => {
      toast({ title: t("company.payment.failedToRemovePaymentMethod"), description: err.message || tCommon("pleaseTryAgain") || "Please try again", variant: "destructive" });
    },
  });

  // Set payment method as primary
  const setPrimaryPaymentMethodMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/company/payment-methods/${id}/primary`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
      toast({ title: t("company.payment.primaryPaymentMethodUpdated") });
    },
  });

  const updatePaymentMethodLocationsMutation = useMutation({
    mutationFn: async ({ id, locationIds }: { id: number; locationIds: string[] | null }) => {
      await apiRequest("PATCH", `/api/company/payment-methods/${id}/locations`, { locationIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
      setEditPaymentMethodLocations(null);
      toast({ title: t("company.locations.locationAssignmentUpdated") });
    },
  });

  // Trigger auto-draft / auto-replenishment (pending + commitments). For debugging Acme / manual run.
  const triggerAutoChargeMutation = useMutation({
    mutationFn: async () => {
      const clientBalanceCents = accountBalance;
      const clientTotalNeededCents = totalPendingPay + totalJobCommitments;
      if (import.meta.env.DEV) {
        console.log("[TriggerAutoCharge] Calling API with", {
          clientBalanceCents,
          clientTotalNeededCents,
          shortfall: Math.max(0, clientTotalNeededCents - clientBalanceCents),
          pending: totalPendingPay,
          commitments: totalJobCommitments,
        });
      }
      const res = await apiRequest("POST", "/api/company/trigger-auto-charge", {
        clientBalanceCents,
        clientTotalNeededCents,
      });
      const data = await res.json().catch(() => ({}));
      if (import.meta.env.DEV) {
        console.log("[TriggerAutoCharge] API response", { ok: res.ok, status: res.status, data });
      }
      if (!res.ok) throw new Error(data.message || "Auto-charge failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mt/company/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
      toast({ title: data.success ? "Auto-charge completed" : "No charge needed", description: data.message || (data.noChargeNeeded ? "Balance is sufficient." : "Check payment methods.") });
    },
    onError: (err: any) => {
      if (import.meta.env.DEV) console.warn("[TriggerAutoCharge] Error", err?.message || err);
      toast({ title: "Auto-charge failed", description: err?.message || "Try again or top up manually.", variant: "destructive" });
    },
  });

  // State for add payment method form (mobile popup)
  const [newPaymentMethod, setNewPaymentMethod] = useState({
    routingNumber: "",
    accountNumber: "",
    accountType: "Checking",
    bankName: "",
  });
  
  // State for add payment method form (desktop dialog)
  const [achForm, setAchForm] = useState({
    routingNumber: "",
    accountNumber: "",
    accountType: "Checking",
    bankName: "",
  });
  const [addPaymentMethodType, setAddPaymentMethodType] = useState<"ach" | "card">("ach");
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);

  // When user just saved a payment method, hide modal immediately and suppress re-open for a short period (avoids popup re-rendering while refetch completes)
  const [justAddedPaymentMethod, setJustAddedPaymentMethod] = useState(false);
  const paymentMethodAddedAtRef = useRef<number>(0);
  useEffect(() => {
    if (hasUsablePaymentMethod) {
      setJustAddedPaymentMethod(false);
      setPaymentFailedTrigger(false);
    }
  }, [hasUsablePaymentMethod]);

  const suppressPaymentModalMs = 15000;
  const isSuppressingPaymentModal = paymentMethodAddedAtRef.current > 0 && (Date.now() - paymentMethodAddedAtRef.current < suppressPaymentModalMs);

  // Use profile cache (primaryPaymentMethodId, primaryPaymentMethodVerified, lastFailedPaymentMethodId) when available so we don't need to fetch payment methods every time. When a charge fails, server sets lastFailedPaymentMethodId → popup shows; when they add a new method or retry, server clears it.
  // Require payment methods to be fetched before showing so we never flash the modal on refresh while data is still loading.
  const profileHasPaymentCache = profilePrimaryId != null || profilePrimaryVerified === true || profilePrimaryVerified === false;
  const paymentDataReady = paymentMethodsFetched && !paymentMethodsLoading;
  const showBankVerificationModal = Boolean(
    profile?.role === "company" &&
    hasSignedAgreement &&
    !justAddedPaymentMethod &&
    !isSuppressingPaymentModal &&
    paymentDataReady &&
    (profileLastFailedId != null || hasUnpaidFailedItems || paymentFailedTrigger || (!hasUsablePaymentMethod && !hasAnyPaymentMethod)) &&
    (profileHasPaymentCache || paymentMethodsSuccess)
  );

  const [showStripeAddPaymentMethod, setShowStripeAddPaymentMethod] = useState(false);
  const [connectStripeClientSecret, setConnectStripeClientSecret] = useState<string | null>(null);
  const [connectStripeError, setConnectStripeError] = useState<string | null>(null);
  const [addPaymentStep, setAddPaymentStep] = useState<1 | 2>(1);
  const [addedPaymentMethodId, setAddedPaymentMethodId] = useState<number | null>(null);
  const [addPaymentLocationIds, setAddPaymentLocationIds] = useState<string[]>([]);

  // Global payment modal: 'embed' = Payment Element to add new, 'verify-list' = pending banks with inline cents entry + Add card
  const [globalPaymentModalView, setGlobalPaymentModalView] = useState<"embed" | "verify-list">("embed");

  useEffect(() => {
    if (showBankVerificationModal) {
      if (hasPendingBank && !hasUsablePaymentMethod) {
        setGlobalPaymentModalView("verify-list");
      } else {
        setGlobalPaymentModalView("embed");
      }
    }
  }, [showBankVerificationModal, hasPendingBank, hasUsablePaymentMethod]);

  const needEmbedClientSecret = (showBankVerificationModal && globalPaymentModalView === "embed") || showStripeAddPaymentMethod;

  // Create SetupIntent for Payment Element only when showing embed (not when in verify-list)
  useEffect(() => {
    if (!needEmbedClientSecret || !profile?.id) return;
    setConnectStripeError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stripe/create-setup-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.clientSecret) {
          setConnectStripeClientSecret(data.clientSecret);
        } else {
          setConnectStripeError(data.message || "Could not load payment form.");
        }
      } catch (e: any) {
        if (!cancelled) setConnectStripeError(e?.message || "Could not load payment form.");
      }
    })();
    return () => { cancelled = true; setConnectStripeClientSecret(null); };
  }, [needEmbedClientSecret, profile?.id]);
  
  // Fetch company locations from API
  const { data: companyLocations = [], refetch: refetchLocations, isFetched: companyLocationsFetched } = useQuery<any[]>({
    queryKey: ["/api/locations"],
    enabled: !!profile,
  });
  
  const createLocation = useMutation({
    mutationFn: async (data: {
      name: string;
      address: string;
      address2?: string;
      city: string;
      state: string;
      zipCode: string;
      isPrimary?: boolean;
      useCompanyDefault?: boolean;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      contactAltPhone?: string;
      representativeTeamMemberId?: number;
      paymentMethodId?: number;
    }) => {
      const res = await apiRequest("POST", "/api/locations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: t("company.locations.locationAdded"), description: t("company.locations.newLocationSaved") });
    },
    onError: (error: any) => {
      if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
        toast({ 
          title: t("company.locations.authenticationRequired"), 
          description: t("company.locations.pleaseLogInAgain"),
          variant: "destructive" 
        });
        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.replace("/login");
        }, 2000);
      } else {
        toast({ 
          title: t("company.locations.failedToAddLocation"), 
          description: error.message || "An error occurred. Please try again.",
          variant: "destructive" 
        });
      }
    },
  });
  
  const updateLocation = useMutation({
    mutationFn: async ({ id, ...data }: { 
      id: number; 
      name?: string; 
      address?: string; 
      city?: string; 
      state?: string; 
      zipCode?: string; 
      isPrimary?: boolean;
      useCompanyDefault?: boolean;
      contactName?: string | null;
      contactPhone?: string | null;
      contactEmail?: string | null;
      contactAltPhone?: string | null;
      representativeTeamMemberId?: number | null;
      assignedTeamMemberIds?: number[];
      paymentMethodId?: number | null;
      address2?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
    },
  });
  
  const deleteLocation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: t("company.locations.locationDeleted"), description: t("company.locations.locationRemoved") });
    },
  });
  
  const [viewingAgreement, setViewingAgreement] = useState(false);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  
  // Sync hiring industries from profile when loaded
  useEffect(() => {
    if (!profile?.id) return;
    const industries = (profile as { hiringIndustries?: string[] | null })?.hiringIndustries;
    setSelectedIndustries(Array.isArray(industries) ? industries : []);
  }, [profile]);
  
  // Compute incomplete onboarding items for blocking popup
  const incompleteOnboardingItems = useMemo(() => {
    if (!profile || profile.role !== "company") return [];
    
    const items: Array<{ id: string; title: string; description: string; action: () => void }> = [];
    
    // Check if agreement is signed
    if (!hasSignedAgreement) {
      items.push({
        id: "agreement",
        title: t("company.onboarding.signPlatformAgreement"),
        description: t("company.onboarding.mustSignServiceAgreement"),
        action: () => setShowMandatoryAgreement(true),
      });
    }
    
    // Check if they have a usable payment method (card or verified ACH)
    const hasPaymentCapability = hasUsablePaymentMethod || (profile.depositAmount && profile.depositAmount > 0);
    if (!hasPaymentCapability) {
      items.push({
        id: "payment",
        title: t("company.onboarding.addPaymentMethod"),
        description: t("company.onboarding.addBankOrCardForDeposits"),
        action: () => setShowMandatoryPaymentMethod(true),
      });
    }
    
    // Check if they have at least one location
    if (companyLocations.length === 0) {
      items.push({
        id: "location",
        title: t("company.onboarding.addLocation"),
        description: t("company.onboarding.addAtLeastOneJobSite"),
        action: () => setShowAddLocation(true),
      });
    }
    
    return items;
  }, [profile, hasSignedAgreement, hasUsablePaymentMethod, companyLocations]);
  
  // Show blocking onboarding popup when there are incomplete items
  // Wait for ALL required data (profile, paymentMethods, companyLocations) before showing to avoid flash on page load
  useEffect(() => {
    if (!profile || profileLoading || !paymentMethodsFetched || !companyLocationsFetched) return;
    
    // If there are incomplete onboarding items, show blocking popup
    if (profile.role === "company" && incompleteOnboardingItems.length > 0) {
      // Only show blocking popup if other modals are not showing
      if (!showMandatoryAgreement && !showMandatoryPaymentMethod) {
        setShowBlockingOnboardingPopup(true);
      }
    } else {
      setShowBlockingOnboardingPopup(false);
    }
  }, [profile, profileLoading, paymentMethodsFetched, companyLocationsFetched, incompleteOnboardingItems, showMandatoryAgreement, showMandatoryPaymentMethod]);
  
  // Popup navigation stack for breadcrumb-style navigation
  type PopupType = "profile" | "locations" | "addLocation" | "paymentMethods" | "addPaymentMethod" | "teamAccess" | "notifications" | "billingHistory" | "invoices" | "agreements" | "viewAgreement" | "help" | "adjustTimeline" | "editJob" | "increaseWorkers" | "jobDetails" | "hiringPreferences";
  const [popupStack, setPopupStack] = useState<PopupType[]>([]);
  
  const openPopup = (popup: PopupType) => {
    setPopupStack(prev => [...prev, popup]);
  };
  
  const closePopup = () => {
    setPopupStack(prev => prev.slice(0, -1));
  };
  
  const closeAllPopups = () => {
    setPopupStack([]);
  };
  
  const currentPopup = popupStack[popupStack.length - 1] || null;
  const hasPreviousPopup = popupStack.length > 1;

  // Desktop menu: selected item for right-panel detail (no dialogs)
  type CompanyMenuSelection = "profile" | "locations" | "payment-methods" | "team-access" | "notifications" | "hiring-preferences" | "billing" | "agreements" | "language";
  const [menuSelection, setMenuSelection] = useState<CompanyMenuSelection>("profile");
  const [showMenuSignOutConfirm, setShowMenuSignOutConfirm] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<{ id: number | null; type: string; version: string; signedName: string; signedAt: string; text: string } | null>(null);

  const { data: companyAgreementsList = [] } = useQuery<Array<{ id: number; agreementType: string; version: string; signedName: string | null; agreementText: string | null; signedAt: string | null }>>({
    queryKey: ["company-agreements"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/company-agreements");
      return res.json();
    },
  });

  const agreementDisplayList: Array<{ id: number | null; type: string; version: string; signedName: string; signedAt: string; text: string }> = companyAgreementsList.length > 0
    ? companyAgreementsList.map((row) => ({
        id: row.id,
        type: row.agreementType === "hiring_agreement" ? "Company Hiring Agreement" : row.agreementType,
        version: row.version,
        signedName: row.signedName ?? "",
        signedAt: row.signedAt ?? "",
        text: row.agreementText ?? COMPANY_AGREEMENT_TEXT,
      }))
    : hasSignedAgreement && profile
      ? [{ id: null, type: "Company Hiring Agreement", version: "1.0", signedName: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Client", signedAt: profile.contractSignedAt ? new Date(profile.contractSignedAt as string | Date).toISOString() : "", text: COMPANY_AGREEMENT_TEXT }]
      : [];

  const displayedAgreement = selectedAgreement ?? agreementDisplayList[0] ?? null;

  // Fetch real billing history from API
  const { data: billingHistoryResponse, isLoading: billingHistoryLoading } = useQuery<{
    items: Array<{
      id: string;
      date: string;
      type: "deposit" | "charge" | "refund" | "auto_recharge";
      amount: number;
      description: string;
      workerName: string | null;
      workerId: number | null;
      jobTitle: string | null;
      jobId: number | null;
      hours: number | null;
      timesheetId: number | null;
      paymentMethod?: string | null;
      cardFee?: number | null;
      stripePaymentIntentId?: string | null;
      mtPaymentOrderId?: string | null;
      initiatedBy?: string | null;
    }>;
    workers: Array<{ id: number; name: string }>;
  }>({
    queryKey: ["/api/company/billing-history"],
    enabled: profile?.role === "company",
  });

  const billingHistoryData = useMemo(() => {
    const items = billingHistoryResponse?.items || [];
    return items.filter(item => {
      if (billingFilters.dateFrom && new Date(item.date) < new Date(billingFilters.dateFrom)) return false;
      if (billingFilters.dateTo && new Date(item.date) > new Date(billingFilters.dateTo)) return false;
      if (billingFilters.type !== "all" && item.type !== billingFilters.type) return false;
      if (billingFilters.worker !== "all") {
        if (!item.workerId || item.workerId.toString() !== billingFilters.worker) return false;
      }
      // Filter by category: funding (deposit, auto_recharge) or spend (charge, refund)
      if (billingFilters.category === "funding") {
        if (item.type !== "deposit" && item.type !== "auto_recharge") return false;
      } else if (billingFilters.category === "spend") {
        if (item.type !== "charge" && item.type !== "refund") return false;
      }
      return true;
    });
  }, [billingHistoryResponse, billingFilters]);

  const billingWorkers = billingHistoryResponse?.workers || [];

  function generateBillingReceiptPdf(
    item: {
      id: string; date: string; type: string; amount: number; paymentMethod?: string; method?: string;
      stripePaymentIntentId?: string; mtPaymentOrderId?: string; cardFee?: number; initiatedBy?: string;
      workerName?: string | null; jobTitle?: string | null;
    },
    options?: { memo?: string }
  ) {
    const typeLabels: Record<string, string> = {
      deposit: "Balance Deposit",
      charge: "Worker Payment",
      auto_recharge: "Auto-Replenishment",
      refund: "Refund",
    };
    let amountInCents = item.amount;
    if ((item.type === "deposit" || item.type === "auto_recharge") && Math.abs(item.amount) > 0) {
      const correctedAmount = Math.round(item.amount * 10);
      if (Math.abs(item.amount) < 10000 && Math.abs(correctedAmount) >= 10000) {
        amountInCents = correctedAmount;
      }
    }
    const baseAmount = Math.abs(amountInCents / 100);
    const cardFeeAmount = ((item.cardFee ?? 0) / 100);
    const totalCharged = baseAmount + cardFeeAmount;
    const paymentMethod = item.paymentMethod ?? item.method;

    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text("TOLSTOY STAFFING", 105, 25, { align: "center" });
    doc.setFontSize(14);
    doc.text("Payment Receipt", 105, 35, { align: "center" });
    doc.setFontSize(10);
    doc.setDrawColor(200);
    doc.line(20, 42, 190, 42);

    let y = 55;
    const lineHeight = 8;

    doc.setFontSize(11);
    doc.text(`Transaction ID: ${item.id}`, 20, y); y += lineHeight;
    doc.text(`Date: ${format(new Date(item.date), "MMMM d, yyyy h:mm a")}`, 20, y); y += lineHeight * 1.5;

    doc.text(`Type: ${typeLabels[item.type] || item.type}`, 20, y); y += lineHeight;
    doc.text(`Payment Method: ${paymentMethod === "card" ? "Credit Card" : paymentMethod === "ach" ? "Bank Transfer (ACH)" : paymentMethod === "platform" ? "Platform Balance" : "N/A"}`, 20, y); y += lineHeight;
    doc.text(`Reference: ${item.stripePaymentIntentId || item.mtPaymentOrderId || "N/A"}`, 20, y); y += lineHeight;
    doc.text(`Initiated By: ${item.initiatedBy ?? "System"}`, 20, y); y += lineHeight * 1.5;

    if (item.workerName) {
      doc.text(`Worker: ${item.workerName}`, 20, y); y += lineHeight;
    }
    if (item.jobTitle) {
      doc.text(`Job: ${item.jobTitle}`, 20, y); y += lineHeight;
    }

    y += lineHeight;
    doc.line(20, y, 190, y); y += lineHeight * 1.5;

    doc.setFontSize(12);
    doc.text(`Amount Added to Balance: $${baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 20, y); y += lineHeight;
    if (paymentMethod === "card" && cardFeeAmount > 0) {
      doc.text(`Card Processing Fee (3.5%): $${cardFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 20, y); y += lineHeight;
      doc.setFontSize(14);
      doc.text(`Total Charged: $${totalCharged.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 20, y); y += lineHeight;
    }

    if (options?.memo?.trim()) {
      y += lineHeight;
      doc.line(20, y, 190, y); y += lineHeight * 1.5;
      doc.setFontSize(11);
      doc.text("Notes:", 20, y); y += lineHeight;
      const memoLines = doc.splitTextToSize(options.memo.trim(), 170);
      doc.setFontSize(10);
      doc.text(memoLines, 20, y); y += lineHeight * memoLines.length;
    }

    y += lineHeight * 2;
    doc.setFontSize(10);
    doc.text("Thank you for your business!", 105, y, { align: "center" });

    doc.save(`receipt-${item.id}-${format(new Date(item.date), "yyyy-MM-dd")}.pdf`);
  }
  
  // Unified notification settings based on profile preferences
  const [notificationSettings, setNotificationSettings] = useState({
    emailNewApplications: profile?.notifyNewJobs ?? true,
    emailTimesheets: profile?.notifyJobUpdates ?? true,
    emailPayments: profile?.notifyPayments ?? true,
    emailMessages: profile?.notifyMessages ?? true,
    smsNewApplications: (profile?.smsNotifications ?? true) && (profile?.notifyNewJobs ?? true),
    smsTimesheets: (profile?.smsNotifications ?? true) && (profile?.notifyJobUpdates ?? true),
    smsPayments: (profile?.smsNotifications ?? true) && (profile?.notifyPayments ?? true),
    smsMessages: (profile?.smsNotifications ?? true) && (profile?.notifyMessages ?? true),
    pushNewApplications: (profile?.pushNotifications ?? true) && (profile?.notifyNewJobs ?? true),
    pushTimesheets: (profile?.pushNotifications ?? true) && (profile?.notifyJobUpdates ?? true),
    pushPayments: (profile?.pushNotifications ?? true) && (profile?.notifyPayments ?? true),
    pushMessages: (profile?.pushNotifications ?? true) && (profile?.notifyMessages ?? true),
    emailNotifications: profile?.emailNotifications ?? true,
    smsNotifications: profile?.smsNotifications ?? true,
    pushNotifications: profile?.pushNotifications ?? true,
  });

  // Update notification settings when profile changes
  useEffect(() => {
    if (profile) {
      setNotificationSettings({
        emailNewApplications: profile.notifyNewJobs ?? true,
        emailTimesheets: profile.notifyJobUpdates ?? true,
        emailPayments: profile.notifyPayments ?? true,
        emailMessages: profile.notifyMessages ?? true,
        smsNewApplications: (profile.smsNotifications ?? true) && (profile.notifyNewJobs ?? true),
        smsTimesheets: (profile.smsNotifications ?? true) && (profile.notifyJobUpdates ?? true),
        smsPayments: (profile.smsNotifications ?? true) && (profile.notifyPayments ?? true),
        smsMessages: (profile.smsNotifications ?? true) && (profile.notifyMessages ?? true),
        pushNewApplications: (profile.pushNotifications ?? true) && (profile.notifyNewJobs ?? true),
        pushTimesheets: (profile.pushNotifications ?? true) && (profile.notifyJobUpdates ?? true),
        pushPayments: (profile.pushNotifications ?? true) && (profile.notifyPayments ?? true),
        pushMessages: (profile.pushNotifications ?? true) && (profile.notifyMessages ?? true),
        emailNotifications: profile.emailNotifications ?? true,
        smsNotifications: profile.smsNotifications ?? true,
        pushNotifications: profile.pushNotifications ?? true,
      });
    }
  }, [profile]);
  
  const [teamInviteEmail, setTeamInviteEmail] = useState("");
  const [teamInviteRole, setTeamInviteRole] = useState<"admin" | "manager" | "viewer">("manager");
  
  const [directRequestData, setDirectRequestData] = useState({
    jobTitle: "",
    locationId: "",
    shiftType: "" as "on-demand" | "one-day" | "recurring" | "",
    startDate: "",
    startTime: "08:00",
    endTime: "17:00",
    recurringDays: [] as string[],
    recurringWeeks: 1,
    estimatedHours: "",
    description: "",
    images: [] as string[],
    fallbackToPublic: false,
  });
  
  const [teamRequestData, setTeamRequestData] = useState({
    jobTitle: "",
    locationId: "",
    shiftType: "" as "on-demand" | "one-day" | "recurring" | "",
    startDate: "",
    startTime: "08:00",
    endTime: "17:00",
    recurringDays: [] as string[],
    recurringWeeks: 1,
    estimatedHours: "",
    description: "",
    selectedSkillsets: [] as string[],
    fallbackToPublic: true,
  });
  const [teamRequestStep, setTeamRequestStep] = useState(1);
  const [showPublicFallbackPopup, setShowPublicFallbackPopup] = useState(false);
  
  const [jobsFilter, setJobsFilter] = usePersistentFilter<"open" | "in_progress" | "done" | "draft">("company_dashboard_jobs_filter", "open");
  const [selectedJobDetails, setSelectedJobDetails] = useState<SampleJob | null>(null);
  const [selectedJobLocation, setSelectedJobLocation] = useState<SampleLocation | null>(null);
  const [showJobDetailsFullView, setShowJobDetailsFullView] = useState(false);
  const [showTeamRequestPanel, setShowTeamRequestPanel] = useState<SampleTeamMember | null>(null);
  
  const [showMarkCompleteDialog, setShowMarkCompleteDialog] = useState<SampleJob | null>(null);
  const [showPendingTimesheetsWarning, setShowPendingTimesheetsWarning] = useState<{ jobId: number; jobTitle: string; pendingCount: number } | null>(null);
  const [pendingApproveAllJobId, setPendingApproveAllJobId] = useState<number | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [howItWorksStep, setHowItWorksStep] = useState(0);
  const [markCompleteStep, setMarkCompleteStep] = useState<"timesheets" | "review">("timesheets");
  type MarkCompleteFlowStep = "intro" | "photos" | "reviews" | "addToTeam" | "success";
  const [markCompleteFlowStep, setMarkCompleteFlowStep] = useState<MarkCompleteFlowStep>("intro");
  const [reviewWorkerIndex, setReviewWorkerIndex] = useState(0);
  const [reviewRatings, setReviewRatings] = useState<{
    timeliness: number;
    effort: number;
    communication: number;
    value: number;
  }>({ timeliness: 0, effort: 0, communication: 0, value: 0 });
  const [reviewPrivateNote, setReviewPrivateNote] = useState("");
  const [completionPhotoUrls, setCompletionPhotoUrls] = useState<string[]>([]);
  const [completionPhotosUploading, setCompletionPhotosUploading] = useState(false);
  const [addToTeamSelectedWorkerIds, setAddToTeamSelectedWorkerIds] = useState<number[]>([]);
  const [addToTeamAdding, setAddToTeamAdding] = useState(false);
  const [handledTimesheetIds, setHandledTimesheetIds] = useState<number[]>([]);
  const [showRemoveJobDialog, setShowRemoveJobDialog] = useState<SampleJob | null>(null);
  const [showAdjustTimelineDialog, setShowAdjustTimelineDialog] = useState<SampleJob | null>(null);
  const [showIncreaseWorkersDialog, setShowIncreaseWorkersDialog] = useState<SampleJob | null>(null);
  const [showEditJobDialog, setShowEditJobDialog] = useState<SampleJob | null>(null);
  const [jobDetailsMediaUploading, setJobDetailsMediaUploading] = useState(false);
  const jobDetailsMediaInputRef = useRef<HTMLInputElement>(null);

  const MAX_JOB_MEDIA = 6;

  const [jobsData, setJobsData] = useState<SampleLocation[]>([]);
  const [hasLoadedJobs, setHasLoadedJobs] = useState(false);
  
  // Fetch real company jobs from API
  const { data: companyJobs, isLoading: isLoadingJobs, isFetching: isFetchingJobs, error: jobsError } = useCompanyJobs();

  const devFillJobWorkerSlots = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await apiRequest("POST", "/api/dev/fill-job-worker-slots", { jobId });
      return (await res.json()) as { hired: number; remainingSlots: number; maxWorkersNeeded: number };
    },
    onSuccess: async (data, jobId) => {
      await queryClient.refetchQueries({ queryKey: ["/api/company/jobs"] });
      const list = queryClient.getQueryData<CompanyJob[]>(["/api/company/jobs"]);
      const cj = list?.find((j) => j.id === jobId);
      setSelectedJobDetails((prev) => {
        if (!prev || prev.id !== jobId || !cj) return prev;
        const applications = (cj.applications || []).map((app) => ({
          id: app.id,
          worker: {
            id: app.worker?.id || 0,
            firstName: app.worker?.firstName || "Unknown",
            lastName: app.worker?.lastName || "",
            avatarUrl: app.worker?.avatarUrl || "",
            bio: app.worker?.bio || "",
            skills: [...(app.worker?.trades || []), ...(app.worker?.serviceCategories || [])],
            hourlyRate: app.worker?.hourlyRate || 0,
            rating: parseFloat(app.worker?.averageRating || "0") || 0,
            completedJobs: app.worker?.completedJobs || 0,
            portfolioImages: [] as string[],
            phone: app.worker?.phone || undefined,
            identityVerified: false,
            insuranceVerified: false,
            w9DocumentUrl: null,
            strikeCount: 0,
          },
          message: app.message || "",
          proposedRate: app.proposedRate || 0,
          status: app.status as "pending" | "accepted" | "rejected",
          createdAt: app.createdAt ? new Date(app.createdAt as Date).toISOString() : new Date().toISOString(),
        }));
        const acceptedN = applications.filter((a) => a.status === "accepted").length;
        return {
          ...prev,
          applications,
          workersHired: Math.max(prev.workersHired ?? 0, acceptedN),
        };
      });
      toast({
        title: "Dev: filled worker slots",
        description:
          data.hired === 0
            ? "No changes (already full or no workers available)."
            : `Accepted ${data.hired}. ${data.remainingSlots} slot(s) still open.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Dev fill failed", description: error.message, variant: "destructive" });
    },
  });
  
  // Initialize company logo from profile
  useEffect(() => {
    if (profile?.companyLogo) {
      setCompanyLogoUrl(profile.companyLogo);
    }
  }, [profile?.companyLogo]);

  // Sync company profile form when dialog or profile panel is shown. Primary email = login email (prefilled, locked).
  useEffect(() => {
    if ((showCompanyProfile || menuSelection === "profile") && profile) {
      const primaryEmail = profile.email || (user?.email ?? "");
      setCompanyProfileForm({
        companyName: (profile as any).companyName || "",
        companyWebsite: (profile as any).companyWebsite || "",
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        email: primaryEmail,
        phone: profile.phone || "",
      });
      setAlternateEmails((profile as any).alternateEmails || []);
      setAlternatePhones((profile as any).alternatePhones || []);
    }
  }, [showCompanyProfile, menuSelection, profile, user?.email]);
  
  // Profile update mutation for logo upload
  const updateProfile = useUpdateProfile();
  
  // Handle logo upload (images compressed globally; max 10 GB)
  const handleLogoUpload = async (file: File) => {
    if (!file || !profile) return;
    
    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file (PNG, JPG)", variant: "destructive" });
      return;
    }
    
    setIsUploadingLogo(true);
    
    try {
      assertMaxUploadSize(file);
      const fileToUpload = await compressImageIfNeeded(file);
      
      // 1. Request presigned URL
      const urlResponse = await apiRequest("POST", "/api/uploads/request-url", {
        name: fileToUpload.name,
        size: fileToUpload.size,
        contentType: fileToUpload.type,
      });
      
      const { uploadURL, objectPath } = await urlResponse.json();
      
      // 2. Upload file directly to presigned URL
      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: fileToUpload,
        headers: {
          "Content-Type": fileToUpload.type,
        },
      });
      
      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file");
      }
      
      // 3. Update profile with logo URL using the existing mutation
      // Note: useUpdateProfile already shows a success toast
      await updateProfile.mutateAsync({ id: profile.id, data: { companyLogo: objectPath } });
      
      // 4. Update local state
      setCompanyLogoUrl(objectPath);
    } catch (error) {
      console.error("Error uploading logo:", error);
      toast({ title: t("company.profile.uploadFailed"), description: t("company.profile.failedToUploadLogo"), variant: "destructive" });
    } finally {
      setIsUploadingLogo(false);
    }
  };
  
  // Transform API jobs to SampleLocation[] format - group by company's actual locations when job has companyLocationId
  useEffect(() => {
    if (companyJobs !== undefined) {
      setHasLoadedJobs(true);
      
      if (companyJobs.length === 0) {
        setJobsData([]);
        return;
      }
      
      // Build lookup of company locations by id
      const companyLocById = new Map<number, SampleLocation>();
      (companyLocations || []).forEach((loc: any) => {
        companyLocById.set(loc.id, {
          id: loc.id,
          name: loc.name || loc.address || "Unknown",
          address: loc.address || "",
          city: loc.city || "",
          state: loc.state || "",
          zipCode: loc.zipCode || "",
          jobs: [],
        });
      });
      
      // For jobs without companyLocationId, group by address (fallback for legacy/unlinked jobs)
      const fallbackMap = new Map<string, SampleLocation>();
      let fallbackIdCounter = -1;
      
      const getOrCreateLocation = (job: CompanyJob): SampleLocation => {
        const locId = (job as any).companyLocationId;
        if (locId != null && companyLocById.has(locId)) {
          return companyLocById.get(locId)!;
        }
        const addressKey = job.address || job.city || "Unknown Location";
        if (!fallbackMap.has(addressKey)) {
          fallbackMap.set(addressKey, {
            id: fallbackIdCounter--,
            name: job.locationName || job.city || addressKey,
            address: job.address || "",
            city: job.city || "",
            state: job.state || "",
            zipCode: job.zipCode || "",
            jobs: [],
          });
        }
        return fallbackMap.get(addressKey)!;
      };
      
      companyJobs.forEach((job: CompanyJob) => {
        const location = getOrCreateLocation(job);
        
        // Safely handle nullable arrays
        const applications = job.applications || [];
        const timesheets = job.timesheets || [];
        
        // Build worker name lookup from applications for timesheet display
        const workerNameMap = new Map<number, string>();
        applications.forEach(app => {
          if (app.worker) {
            workerNameMap.set(app.worker.id, `${app.worker.firstName || ''} ${app.worker.lastName || ''}`.trim() || 'Unknown Worker');
          }
        });
        
        // Transform job to SampleJob format
        const sampleJob: SampleJob = {
          id: job.id,
          title: job.title,
          description: job.description || "",
          locationId: location.id,
          trade: job.trade || "",
          hourlyRate: job.hourlyRate || 0,
          maxWorkersNeeded: job.maxWorkersNeeded || 1,
          workersHired: job.workersHired || 0,
          status: job.status as "draft" | "open" | "in_progress" | "completed" | "cancelled",
          startDate: job.startDate ? new Date(job.startDate).toISOString().split('T')[0] : "",
          endDate: job.endDate ? new Date(job.endDate).toISOString().split('T')[0] : undefined,
          estimatedHours: job.estimatedHours || 8,
          timelineType: job.isOnDemand ? "on-demand" : (job.jobType === "recurring" ? "recurring" : "one-day") as "on-demand" | "one-day" | "recurring",
          startTime: job.scheduledTime?.includes(' - ')
            ? parseTimeToHHmm(job.scheduledTime.split(' - ')[0].trim())
            : parseTimeToHHmm((job as any).startTime || job.scheduledTime || "08:00"),
          endTime: job.scheduledTime?.includes(' - ')
            ? parseTimeToHHmm(job.scheduledTime.split(' - ')[1].trim())
            : parseTimeToHHmm((job as any).endTime || "17:00"),
          recurringDays: job.scheduleDays || [],
          scheduleDays: job.scheduleDays || [],
          budgetCents: (job as { budgetCents?: number | null }).budgetCents ?? null,
          lastWorkerAlertAt: job.lastWorkerAlertAt
            ? new Date(job.lastWorkerAlertAt as string | Date).toISOString()
            : null,
          recurringWeeks: (job as any).recurringWeeks || 1,
          images: job.images || [],
          videos: job.videos || [],
          applications: applications.map(app => ({
            id: app.id,
            worker: {
              id: app.worker?.id || 0,
              firstName: app.worker?.firstName || "Unknown",
              lastName: app.worker?.lastName || "",
              avatarUrl: app.worker?.avatarUrl || "",
              bio: app.worker?.bio || "",
              skills: [...(app.worker?.trades || []), ...(app.worker?.serviceCategories || [])],
              hourlyRate: app.worker?.hourlyRate || 0,
              rating: parseFloat(app.worker?.averageRating || "0") || 0,
              completedJobs: app.worker?.completedJobs || 0,
              portfolioImages: (app.worker as { portfolioImages?: string[] } | null | undefined)?.portfolioImages ?? [],
              phone: app.worker?.phone || undefined,
              identityVerified: (app.worker as { identityVerified?: boolean } | null | undefined)?.identityVerified ?? false,
              insuranceVerified: (app.worker as { insuranceVerified?: boolean } | null | undefined)?.insuranceVerified ?? false,
              w9DocumentUrl: (app.worker as { w9DocumentUrl?: string | null } | null | undefined)?.w9DocumentUrl ?? null,
              strikeCount: (app.worker as { strikeCount?: number } | null | undefined)?.strikeCount ?? 0,
            },
            message: app.message || "",
            proposedRate: app.proposedRate || 0,
            status: app.status as "pending" | "accepted" | "rejected",
            createdAt: app.createdAt ? new Date(app.createdAt).toISOString() : new Date().toISOString(),
          })),
          timesheets: timesheets.map(ts => ({
            workerId: ts.workerId,
            workerName: workerNameMap.get(ts.workerId) || "Worker",
            hoursClocked: parseFloat(ts.totalHours || "0") || 0,
            hourlyRate: ts.hourlyRate,
            status: (ts.status || "pending") as "pending" | "approved" | "rejected",
          })),
        };
        
        location.jobs.push(sampleJob);
      });
      
      // Combine: company locations with jobs first, then fallback (unlinked) locations
      const companyLocsWithJobs = Array.from(companyLocById.values()).filter(loc => loc.jobs.length > 0);
      const fallbackLocs = Array.from(fallbackMap.values());
      const locationsArray = [...companyLocsWithJobs, ...fallbackLocs];
      if (locationsArray.length > 0) {
        setJobsData(locationsArray);
      }
    }
  }, [companyJobs, companyLocations]);
  
  const updateJob = (jobId: number, updates: Partial<SampleJob>) => {
    setJobsData(prev => {
      const currentJob = prev.flatMap(loc => loc.jobs).find(j => j.id === jobId);
      if (!currentJob) return prev;
      
      const newLocationId = updates.locationId;
      const isLocationChange = newLocationId !== undefined && newLocationId !== currentJob.locationId;
      
      if (isLocationChange) {
        const updatedJob = { ...currentJob, ...updates };
        return prev.map(location => {
          if (location.id === currentJob.locationId) {
            return { ...location, jobs: location.jobs.filter(j => j.id !== jobId) };
          }
          if (location.id === newLocationId) {
            return { ...location, jobs: [...location.jobs, updatedJob] };
          }
          return location;
        });
      }
      
      return prev.map(location => ({
        ...location,
        jobs: location.jobs.map(job => 
          job.id === jobId ? { ...job, ...updates } : job
        )
      }));
    });
  };
  
  const removeJob = (jobId: number) => {
    setJobsData(prev => prev.map(location => ({
      ...location,
      jobs: location.jobs.filter(job => job.id !== jobId)
    })));
  };
  
  /** Platform fee added to worker rate for company display (global logic: worker $/hr + $13 = displayed $/hr) */
  const PLATFORM_FEE_CENTS = 1300;
  const formatRateWithMarkup = (workerRateCents: number) => {
    return `$${((workerRateCents + PLATFORM_FEE_CENTS) / 100).toFixed(0)}/hr`;
  };
  
  const getTomorrowStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [adjustTimelineData, setAdjustTimelineData] = useState<RescheduleScheduleData>(() => ({
    timelineType: "",
    onDemandDate: "",
    onDemandStartTime: "09:00",
    onDemandDoneByDate: "",
    onDemandBudget: null,
    oneDayDate: "",
    oneDayStartTime: "09:00",
    oneDayEndTime: "17:00",
    recurringDays: [],
    recurringStartDate: getTomorrowStr(),
    recurringEndDate: "",
    recurringStartTime: "09:00",
    recurringEndTime: "17:00",
    recurringWeeks: 1,
  }));
  const [adjustRescheduleView, setAdjustRescheduleView] = useState<"type-select" | ShiftType>("type-select");
  const [onDemandFormStep, setOnDemandFormStep] = useState(1);
  const [oneDayFormStep, setOneDayFormStep] = useState(1);
  const [recurringFormStep, setRecurringFormStep] = useState(1);
  const [adjustScheduleError, setAdjustScheduleError] = useState<string | null>(null);

  /** Inline reschedule state when Action Required current item is reschedule (suggested prefill: today+2, 9am–5pm, one-day). */
  const getSuggestedRescheduleData = useCallback((): RescheduleScheduleData => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const suggestedStart = new Date(today);
    suggestedStart.setDate(suggestedStart.getDate() + 2);
    const suggestedDateStr = `${suggestedStart.getFullYear()}-${String(suggestedStart.getMonth() + 1).padStart(2, "0")}-${String(suggestedStart.getDate()).padStart(2, "0")}`;
    return {
      timelineType: "one-day",
      onDemandDate: suggestedDateStr,
      onDemandStartTime: "09:00",
      onDemandDoneByDate: "",
      onDemandBudget: null,
      oneDayDate: suggestedDateStr,
      oneDayStartTime: "09:00",
      oneDayEndTime: "17:00",
      recurringDays: [],
      recurringStartDate: suggestedDateStr,
      recurringEndDate: "",
      recurringStartTime: "09:00",
      recurringEndTime: "17:00",
      recurringWeeks: 1,
    };
  }, []);
  const [actionReqRescheduleData, setActionReqRescheduleData] = useState<RescheduleScheduleData>(() => ({
    timelineType: "",
    onDemandDate: "",
    onDemandStartTime: "09:00",
    onDemandDoneByDate: "",
    onDemandBudget: null,
    oneDayDate: "",
    oneDayStartTime: "09:00",
    oneDayEndTime: "17:00",
    recurringDays: [],
    recurringStartDate: getTomorrowStr(),
    recurringEndDate: "",
    recurringStartTime: "09:00",
    recurringEndTime: "17:00",
    recurringWeeks: 1,
  }));
  const [actionReqRescheduleView, setActionReqRescheduleView] = useState<"type-select" | ShiftType>("type-select");
  const [actionReqRescheduleOnDemandStep, setActionReqRescheduleOnDemandStep] = useState(1);
  const [actionReqRescheduleOneDayStep, setActionReqRescheduleOneDayStep] = useState(1);
  const [actionReqRescheduleRecurringStep, setActionReqRescheduleRecurringStep] = useState(1);
  const [actionReqRescheduleError, setActionReqRescheduleError] = useState<string | null>(null);
  const [actionReqRescheduleWorkersNeeded, setActionReqRescheduleWorkersNeeded] = useState(1);

  const handleRescheduleSave = async () => {
    if (!showAdjustTimelineDialog) return;
    const d = adjustTimelineData;
    const startDate = d.timelineType === "on-demand" ? d.onDemandDate : d.timelineType === "recurring" ? d.recurringStartDate : d.oneDayDate;
    const startTime = d.timelineType === "on-demand" ? d.onDemandStartTime : d.timelineType === "recurring" ? d.recurringStartTime : d.oneDayStartTime;
    const endTime = d.timelineType === "recurring" ? d.recurringEndTime : d.oneDayEndTime;
    const payload: Record<string, unknown> = {};
    if (startDate) payload.startDate = startDate;
    if (startTime) payload.startTime = startTime;
    if (endTime) payload.endTime = endTime;
    if (d.timelineType === "recurring") {
      payload.recurringDays = d.recurringDays;
      payload.recurringWeeks = d.recurringWeeks;
    }
    if (d.timelineType === "on-demand" || d.timelineType === "one-day" || d.timelineType === "recurring") {
      payload.timelineType = d.timelineType;
    }
    // Optimistic update for real-time UI
    const optimisticUpdates: Partial<SampleJob> = {
      startDate: startDate || showAdjustTimelineDialog.startDate,
      startTime: startTime || showAdjustTimelineDialog.startTime,
      endTime: endTime || showAdjustTimelineDialog.endTime,
      timelineType: (d.timelineType || showAdjustTimelineDialog.timelineType) as "on-demand" | "one-day" | "recurring",
    };
    if (d.timelineType === "recurring") {
      optimisticUpdates.recurringDays = d.recurringDays;
      optimisticUpdates.recurringWeeks = d.recurringWeeks;
    }
    updateJob(showAdjustTimelineDialog.id, optimisticUpdates);
    setShowAdjustTimelineDialog(null);
    setAdjustRescheduleView("type-select");
    try {
      const patchRes = await apiRequest("PATCH", `/api/company/jobs/${showAdjustTimelineDialog.id}`, payload);
      if (!patchRes.ok) {
        const errData = await patchRes.json().catch(() => ({}));
        toast({ title: "Update failed", description: errData.message || "Could not update job schedule", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
      toast({ title: "Schedule Updated", description: "Job schedule has been updated. Sending alert to workers..." });
      try {
        const alertRes = await fetch(`/api/jobs/${showAdjustTimelineDialog.id}/send-alert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        if (!alertRes.ok) {
          const alertData = await alertRes.json().catch(() => ({}));
          toast({ title: "Alert failed", description: alertData.message || "Schedule updated but could not send notifications", variant: "destructive" });
        }
      } catch (_) {
        toast({ title: "Alert failed", description: "Schedule updated but could not send notifications", variant: "destructive" });
      }
    } catch (_) {
      toast({ title: "Update failed", description: "Could not update job schedule", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
    }
  };

  /** Save reschedule from Action Required inline flow (uses actionReqRescheduleData). */
  const handleActionReqRescheduleSave = async (job: SampleJob) => {
    const d = actionReqRescheduleData;
    const type = d.timelineType || "one-day";
    const startDate = type === "on-demand" ? d.onDemandDate : type === "recurring" ? d.recurringStartDate : d.oneDayDate;
    const startTime = type === "on-demand" ? d.onDemandStartTime : type === "recurring" ? d.recurringStartTime : d.oneDayStartTime;
    const endTime = type === "recurring" ? d.recurringEndTime : d.oneDayEndTime;
    const payload: Record<string, unknown> = {};
    if (startDate) payload.startDate = startDate;
    if (startTime) payload.startTime = startTime;
    if (endTime) payload.endTime = endTime;
    if (type === "recurring") {
      payload.recurringDays = d.recurringDays;
      payload.recurringWeeks = d.recurringWeeks;
    }
    payload.timelineType = type;
    payload.maxWorkersNeeded = actionReqRescheduleWorkersNeeded;
    const optimisticUpdates: Partial<SampleJob> = {
      startDate: startDate || job.startDate,
      startTime: startTime || job.startTime,
      endTime: endTime || job.endTime,
      timelineType: type,
      maxWorkersNeeded: actionReqRescheduleWorkersNeeded,
    };
    if (type === "recurring") {
      optimisticUpdates.recurringDays = d.recurringDays;
      optimisticUpdates.recurringWeeks = d.recurringWeeks;
    }
    updateJob(job.id, optimisticUpdates);
    setActionRequiredItemIndex((i) => Math.min(i + 1, actionRequiredItems.length - 1));
    try {
      const patchRes = await apiRequest("PATCH", `/api/company/jobs/${job.id}`, payload);
      if (!patchRes.ok) {
        const errData = await patchRes.json().catch(() => ({}));
        toast({ title: "Update failed", description: errData.message || "Could not update job schedule", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
      toast({ title: "Schedule Updated", description: "Job schedule has been updated. Sending alert to workers..." });
      try {
        const alertRes = await fetch(`/api/jobs/${job.id}/send-alert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        if (!alertRes.ok) {
          const alertData = await alertRes.json().catch(() => ({}));
          toast({ title: "Alert failed", description: alertData.message || "Schedule updated but could not send notifications", variant: "destructive" });
        }
      } catch (_) {
        toast({ title: "Alert failed", description: "Schedule updated but could not send notifications", variant: "destructive" });
      }
    } catch (_) {
      toast({ title: "Update failed", description: "Could not update job schedule", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
    }
  };
  
  const [workersCount, setWorkersCount] = useState(1);
  
  const [editJobData, setEditJobData] = useState({
    title: "",
    description: "",
    locationId: "",
    images: [] as string[],
    videos: [] as string[],
  });
  
  const accountBalance = balanceData?.balanceCents || 0;
  const pendingStatuses = ["pending", "processing", "sent"];
  const pendingTransactions = transactionsData?.transactions.filter(t => 
    t.mtPaymentStatus && pendingStatuses.includes(t.mtPaymentStatus)
  ) || [];
  
  const toggleLocation = (locationId: number) => {
    setExpandedLocations(prev => 
      prev.includes(locationId) 
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };
  
  const toggleJob = (jobId: number) => {
    setExpandedJobs(prev => 
      prev.includes(jobId) 
        ? prev.filter(id => id !== jobId)
        : [...prev, jobId]
    );
  };
  
  const handleAcceptApplication = (application: SampleApplication, job?: SampleJob) => {
    const targetJob = job || jobsData.flatMap(loc => loc.jobs).find(j => j.applications.some(a => a.id === application.id)) || selectedJobDetails;
    if (targetJob) {
      // Optimistically update: move application to accepted, increment workersHired
      const updateToAccepted = (apps: SampleApplication[]) =>
        apps.map(app => app.id === application.id ? { ...app, status: "accepted" as const } : app);
      setJobsData(prev => prev.map(location => ({
        ...location,
        jobs: location.jobs.map(j => j.id === targetJob.id
          ? { ...j, applications: updateToAccepted(j.applications), workersHired: j.workersHired + 1 }
          : j
        ),
      })));
      setSelectedJobDetails(prev => prev && prev.id === targetJob.id
        ? { ...prev, applications: updateToAccepted(prev.applications), workersHired: prev.workersHired + 1 }
        : prev
      );
    }
    setIsAccepting(true);
    updateApplicationStatus.mutate(
      { id: application.id, status: "accepted" },
      {
        onSuccess: () => {
          toast({
            title: "Worker Approved",
            description: `${application.worker.firstName} ${application.worker.lastName} has been approved for this job. An approval email has been sent.`,
          });
          setIsAccepting(false);
          setSelectedApplication(null);
          if (cameFromPendingRequests) {
            setCameFromPendingRequests(false);
            setSelectedJobDetails(null);
            setSelectedJobLocation(null);
            setShowPendingRequests(true);
          }
        },
        onError: (err: any) => {
          setIsAccepting(false);
          toast({
            title: "Error",
            description: err.message || t("company.jobs.failedToApproveWorker"),
            variant: "destructive",
          });
          if (targetJob) {
            // Revert optimistic update
            const revertToPending = (apps: SampleApplication[]) =>
              apps.map(app => app.id === application.id ? { ...app, status: "pending" as const } : app);
            setJobsData(prev => prev.map(location => ({
              ...location,
              jobs: location.jobs.map(j => j.id === targetJob.id
                ? { ...j, applications: revertToPending(j.applications), workersHired: Math.max(0, j.workersHired - 1) }
                : j
              ),
            })));
            setSelectedJobDetails(prev => prev && prev.id === targetJob.id
              ? { ...prev, applications: revertToPending(prev.applications), workersHired: Math.max(0, prev.workersHired - 1) }
              : prev
            );
          }
        },
      }
    );
  };
  
  const handleShowRejectReason = (application: SampleApplication, job: SampleJob) => {
    setActionHubApplicationToReject({ app: application, job });
    setRejectionReason("");
    setActionHubView("rejectReason");
  };
  
  const handleConfirmRejectWithReason = () => {
    if (!actionHubApplicationToReject) return;
    const { app, job } = actionHubApplicationToReject;
    setIsRejecting(true);
    // Optimistically update: move application to rejected
    const updateToRejected = (apps: SampleApplication[]) =>
      apps.map(a => a.id === app.id ? { ...a, status: "rejected" as const } : a);
    setJobsData(prev => prev.map(location => ({
      ...location,
      jobs: location.jobs.map(j => ({ ...j, applications: updateToRejected(j.applications) })),
    })));
    setSelectedJobDetails(prev => prev && prev.id === job.id
      ? { ...prev, applications: updateToRejected(prev.applications) }
      : prev
    );
    updateApplicationStatus.mutate(
      { id: app.id, status: "rejected", rejectionReason },
      {
        onSuccess: () => {
          toast({
            title: "Application Declined",
            description: `${app.worker.firstName}'s application has been declined. A rejection email has been sent with your feedback.`,
          });
          setIsRejecting(false);
          setActionHubApplicationToReject(null);
          setRejectionReason("");
          setActionHubView("main");
          setSelectedApplication(null);
          if (cameFromPendingRequests) {
            setCameFromPendingRequests(false);
            setSelectedJobDetails(null);
            setSelectedJobLocation(null);
            setShowPendingRequests(true);
          }
        },
        onError: (err: any) => {
          setIsRejecting(false);
          const revertToPending = (apps: SampleApplication[]) =>
            apps.map(a => a.id === app.id ? { ...a, status: "pending" as const } : a);
          setJobsData(prev => prev.map(location => ({
            ...location,
            jobs: location.jobs.map(j => ({ ...j, applications: revertToPending(j.applications) })),
          })));
          setSelectedJobDetails(prev => prev && prev.id === job.id
            ? { ...prev, applications: revertToPending(prev.applications) }
            : prev
          );
          toast({
            title: "Error",
            description: err.message || "Failed to decline application",
            variant: "destructive",
          });
        },
      }
    );
  };
  
  const handleRejectApplication = (application: SampleApplication) => {
    // Optimistically update: move application to rejected
    const updateToRejected = (apps: SampleApplication[]) =>
      apps.map(app => app.id === application.id ? { ...app, status: "rejected" as const } : app);
    setJobsData(prev => prev.map(location => ({
      ...location,
      jobs: location.jobs.map(job => ({
        ...job,
        applications: updateToRejected(job.applications),
      })),
    })));
    setSelectedJobDetails(prev => prev && prev.applications.some(a => a.id === application.id)
      ? { ...prev, applications: updateToRejected(prev.applications) }
      : prev
    );
    updateApplicationStatus.mutate(
      { id: application.id, status: "rejected" },
      {
        onSuccess: () => {
          toast({
            title: "Application Declined",
            description: `${application.worker.firstName}'s application has been declined. They will receive an email notification.`,
          });
          setSelectedApplication(null);
          if (cameFromPendingRequests) {
            setCameFromPendingRequests(false);
            setShowPendingRequests(true);
          }
        },
        onError: (err: any) => {
          // Revert optimistic update
          const revertToPending = (apps: SampleApplication[]) =>
            apps.map(app => app.id === application.id ? { ...app, status: "pending" as const } : app);
          setJobsData(prev => prev.map(location => ({
            ...location,
            jobs: location.jobs.map(job => ({ ...job, applications: revertToPending(job.applications) })),
          })));
          setSelectedJobDetails(prev => prev && prev.applications.some(a => a.id === application.id)
            ? { ...prev, applications: revertToPending(prev.applications) }
            : prev
          );
          toast({
            title: "Error",
            description: err.message || "Failed to decline application",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleReconsiderApplication = (application: SampleApplication) => {
    // Optimistically update local state so UI reflects change immediately
    const updateApplications = (apps: SampleApplication[]) =>
      apps.map(app => app.id === application.id ? { ...app, status: "pending" as const } : app);
    setJobsData(prev => prev.map(location => ({
      ...location,
      jobs: location.jobs.map(job => ({
        ...job,
        applications: updateApplications(job.applications),
      })),
    })));
    setSelectedJobDetails(prev => prev && prev.applications.some(a => a.id === application.id)
      ? { ...prev, applications: updateApplications(prev.applications) }
      : prev);
    updateApplicationStatus.mutate(
      { id: application.id, status: "pending" },
      {
        onSuccess: () => {
          toast({
            title: "Application Reconsidered",
            description: `${application.worker.firstName}'s application has been moved back to pending.`,
          });
        },
        onError: (err: any) => {
          toast({
            title: "Error",
            description: err.message || "Failed to reconsider application",
            variant: "destructive",
          });
          // Revert optimistic update on error
          const revertToRejected = (apps: SampleApplication[]) =>
            apps.map(app => app.id === application.id ? { ...app, status: "rejected" as const } : app);
          setJobsData(prev => prev.map(location => ({
            ...location,
            jobs: location.jobs.map(job => ({ ...job, applications: revertToRejected(job.applications) })),
          })));
          setSelectedJobDetails(prev => prev && prev.applications.some(a => a.id === application.id)
            ? { ...prev, applications: revertToRejected(prev.applications) }
            : prev);
        },
      }
    );
  };
  
  const handleAddToTeam = (worker: SampleWorker) => {
    toast({
      title: "Added to Team",
      description: `${worker.firstName} ${worker.lastName} has been added to your team.`,
    });
  };
  
  const getDisplayStatus = (ts: TimesheetDisplay): "pending" | "approved" | "rejected" | "disputed" =>
    simulatedSampleStatus[ts.id] ?? ts.status;

  const handleApproveTimesheetDisplay = (timesheet: TimesheetDisplay) => {
    if (timesheet.isRealData) {
      approveTimesheet.mutate(
        { id: timesheet.id, adjustedHours: timesheet.adjustedHours },
        {
          onSuccess: (response) => {
            // Check if worker has no bank account - show escrow popup
            if (response.payoutStatus === 'escrow' && response.escrowInfo) {
              setEscrowInfo(response.escrowInfo);
              toast({
                title: "Timesheet Approved",
                description: response.expectedPayTiming ?? `Payment held - worker needs to add bank account.`,
              });
            } else {
              toast({
                title: "Timesheet Approved",
                description: response.expectedPayTiming
                  ? `Timesheet approved. ${response.expectedPayTiming}`
                  : "Timesheet has been approved and payment is being processed.",
              });
            }
          },
          onError: () => {
            toast({
              title: "Error",
              description: "Failed to approve timesheet",
              variant: "destructive",
            });
          },
        }
      );
    } else {
      setSimulatedSampleStatus((prev) => ({ ...prev, [timesheet.id]: "approved" }));
      toast({
        title: "Sample timesheet",
        description: "Approved in UI for testing. Use worker clock-in for real timesheets.",
      });
    }
  };

  const handleRejectTimesheetDisplay = (timesheet: TimesheetDisplay) => {
    if (timesheet.isRealData) {
      setBulkRejectReason("");
      setRejectTimesheetStep("review");
      setBulkRejectModal([timesheet]);
    } else {
      setSimulatedSampleStatus((prev) => ({ ...prev, [timesheet.id]: "rejected" }));
      toast({
        title: "Sample timesheet",
        description: "Rejected in UI for testing. Use worker clock-in for real timesheets.",
        variant: "destructive",
      });
    }
  };
  
  const handleBulkApprove = (timesheets: TimesheetDisplay[]) => {
    const realOnly = timesheets.filter(t => t.isRealData);
    if (realOnly.length === 0) {
      toast({
        title: "Sample data",
        description: "These are test timesheets. Use worker clock-in to create real timesheets for approval.",
      });
      return;
    }
    
    bulkApproveTimesheets.mutate(
      { timesheetIds: realOnly.map(t => t.id) },
      {
        onSuccess: (response) => {
          if (response.escrowCount > 0) {
            toast({
              title: `${response.approved} Timesheets Approved`,
              description: `${response.escrowCount} payment${response.escrowCount > 1 ? 's' : ''} held - worker${response.escrowCount > 1 ? 's' : ''} need${response.escrowCount === 1 ? 's' : ''} to add bank account.`,
            });
          } else {
            toast({
              title: `${response.approved} Timesheets Approved`,
              description: `All payments are being processed.`,
            });
          }
          if (response.failed > 0) {
            toast({
              title: "Some Approvals Failed",
              description: `${response.failed} timesheet${response.failed > 1 ? 's' : ''} could not be approved.`,
              variant: "destructive",
            });
          }
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to approve timesheets",
            variant: "destructive",
          });
        },
      }
    );
  };
  
  const calculateJobCost = (job: SampleJob, workerRate: number) => {
    const markupRate = Math.round(workerRate * 1.52);
    return (markupRate / 100) * job.estimatedHours;
  };

  const exportTimesheetsToCSV = (timesheets: TimesheetDisplay[], filename: string) => {
    const headers = ["Worker Name", "Job Title", "Date", "Clock In", "Clock Out", "Hours", "Hourly Rate", "Total Cost", "Status", "Location Verified", "Notes"];
    const rows = timesheets.map(t => [
      t.workerName,
      t.jobTitle,
      format(t.clockInTime, 'yyyy-MM-dd'),
      format(t.clockInTime, 'HH:mm'),
      t.clockOutTime ? format(t.clockOutTime, 'HH:mm') : '',
      t.adjustedHours.toFixed(2),
      (t.hourlyRate / 100).toFixed(2),
      (Math.round(t.adjustedHours * t.hourlyRate * 1.52) / 100).toFixed(2),
      t.status,
      t.locationVerified ? 'Yes' : 'No',
      t.workerNotes || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    toast({
      title: "Export Complete",
      description: `${timesheets.length} timesheets exported to ${link.download}`,
    });
  };

  const normalizedTimesheets = useMemo(() => {
    const real = realTimesheets.map(mapRealTimesheet);
    const jobsWithRealTimesheets = new Set(real.map(t => t.jobId));
    
    // Generate sample pending timesheets for in-progress jobs with no real timesheets (for testing)
    const useSampleTimesheets = typeof window !== "undefined" && showClientDevTools();
    if (!useSampleTimesheets || !jobsData.length) return real;

    const sample: TimesheetDisplay[] = [];
    let sampleId = -10000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clockIn = new Date(today);
    clockIn.setHours(8, 0, 0, 0);
    const clockOut = new Date(today);
    clockOut.setHours(16, 30, 0, 0);
    const autoApprovalAt = new Date(clockOut.getTime() + 48 * 60 * 60 * 1000);

    const isAcmeConstruction = (profile as { companyName?: string } | null)?.companyName?.trim()?.toLowerCase() === "acme construction";

    jobsData.forEach(location => {
      location.jobs
        .filter(job =>
          job.applications?.some((a: any) => a.status === "accepted") &&
          job.status !== "completed" &&
          !jobsWithRealTimesheets.has(job.id)
        )
        .forEach(job => {
          const accepted = job.applications.filter((a: any) => a.status === "accepted");
          accepted.forEach((app: any, idx: number) => {
            const w = app.worker || app;
            const workerId = w.id ?? app.workerId ?? 0;
            const workerName = [w.firstName, w.lastName].filter(Boolean).join(" ") || w.companyName || "Worker";
            const initials = (w.firstName?.[0] || "") + (w.lastName?.[0] || "") || (w.companyName?.[0] || "?");
            // For Acme Construction test company: first 2 workers get geofence violations so "Apply" banner can be tested
            const hasGeofenceIssue = isAcmeConstruction && idx < 2;
            const clockInDist = hasGeofenceIssue ? 650 + idx * 50 : 45;
            const clockOutDist = hasGeofenceIssue ? 600 + idx * 50 : 38;
            sample.push({
              id: sampleId--,
              isRealData: false,
              workerId,
              workerName,
              workerInitials: initials,
              workerAvatarUrl: w.avatarUrl || "",
              jobId: job.id,
              jobTitle: job.title,
              clockInTime: new Date(clockIn.getTime() + idx * 60000),
              clockOutTime: new Date(clockOut.getTime() + idx * 60000),
              totalHours: 8 + idx * 0.5,
              adjustedHours: 8 + idx * 0.5,
              hourlyRate: job.hourlyRate || 3000,
              clockInDistanceMeters: clockInDist,
              clockOutDistanceMeters: clockOutDist,
              locationVerified: !hasGeofenceIssue,
              locationAdjustmentReason: hasGeofenceIssue ? `Clock-in was ${clockInDist}m from job site.` : null,
              status: "pending",
              workerNotes: isAcmeConstruction ? `Sample timesheet for Acme Construction testing (worker ${idx + 1})` : `Sample timesheet for testing (worker ${idx + 1})`,
              jobSiteLat: 30.2672,
              jobSiteLng: -97.7431,
              clockInLat: 30.268,
              clockInLng: -97.7425,
              clockOutLat: 30.2675,
              clockOutLng: -97.7428,
              autoApprovalAt,
              autoApprovalMsRemaining: Math.max(0, autoApprovalAt.getTime() - Date.now()),
              budgetCents: (job as any).budgetCents || null,
            });
          });
        });
    });

    return [...real, ...sample];
  }, [realTimesheets, jobsData, profile]);
  
  const pendingTimesheets = normalizedTimesheets.filter(t => t.status === "pending");
  /** Real DB ids only — used for bulk approve across all pending (per-job buttons only send that job). */
  const pendingTimesheetRealIds = useMemo(
    () => pendingTimesheets.map((t) => t.id).filter((id) => id > 0),
    [pendingTimesheets]
  );

  /** Worker pay only (matches approve API: hours × hourlyRate). Not platform fee. */
  const pendingLaborPayTotalCents = useMemo(
    () =>
      pendingTimesheets
        .filter((t) => t.isRealData && t.id > 0)
        .reduce((sum, t) => {
          const h = Number(t.adjustedHours ?? t.totalHours ?? 0);
          return sum + Math.round(h * t.hourlyRate);
        }, 0),
    [pendingTimesheets]
  );
  const companyBalanceCentsForPreview = profile?.depositAmount ?? 0;
  const projectedBalanceAfterAllPending = companyBalanceCentsForPreview - pendingLaborPayTotalCents;
  const approvedTimesheets = normalizedTimesheets.filter(t => t.status === "approved");
  const rejectedTimesheets = normalizedTimesheets.filter(t => t.status === "rejected");
  // Pending pay = all timesheets in open status (not approved/rejected): pending + disputed
  const openTimesheetsForPay = normalizedTimesheets.filter(t => t.status === "pending" || t.status === "disputed");
  const totalPendingPay = openTimesheetsForPay.reduce((sum, t) =>
    sum + Math.round(t.adjustedHours * t.hourlyRate * 1.52), 0
  );

  // Get all in-progress jobs (jobs with accepted applications and not completed)
  // These are shown in the pending tab even if they have no pending timesheets
  const inProgressJobsForTimesheets = useMemo(() => {
    const jobs: { job: SampleJob; location: SampleLocation }[] = [];
    jobsData.forEach(location => {
      location.jobs.filter(job => 
        job.applications.some(app => app.status === "accepted") && job.status !== "completed"
      ).forEach(job => {
        jobs.push({ job, location });
      });
    });
    return jobs;
  }, [jobsData]);

  // Group all in-progress jobs with their pending timesheets
  // Jobs with pending timesheets are ordered first
  const pendingTimesheetGroups = useMemo(() => {
    const groups = groupTimesheetsByProject(pendingTimesheets);
    const groupedJobIds = new Set(groups.map(g => g.jobId));
    
    // Add jobs that have no pending timesheets
    const jobsWithoutTimesheets: ProjectGroup[] = inProgressJobsForTimesheets
      .filter(({ job }) => !groupedJobIds.has(job.id))
      .map(({ job }) => ({
        jobId: job.id,
        jobTitle: job.title,
        budgetCents: job.budgetCents || null,
        workerDayGroups: [],
        timesheets: [],
        totalHours: 0,
        totalSpent: 0,
      }));
    
    // Jobs with pending timesheets first, ordered by nearest response deadline (soonest first); then jobs without (sorted by title)
    const groupsWithEarliest = groups.map(g => ({
      ...g,
      earliestAutoApprovalMs: Math.min(...g.timesheets.map(t => t.autoApprovalMsRemaining ?? Infinity)),
    }));
    return [
      ...groupsWithEarliest.sort((a, b) => a.earliestAutoApprovalMs - b.earliestAutoApprovalMs),
      ...jobsWithoutTimesheets.sort((a, b) => a.jobTitle.localeCompare(b.jobTitle))
    ];
  }, [pendingTimesheets, inProgressJobsForTimesheets]);

  const allPendingApplications = useMemo(() => {
    const apps: { job: SampleJob; location: SampleLocation; application: SampleApplication }[] = [];
    jobsData.forEach(location => {
      location.jobs.forEach(job => {
        job.applications.filter(a => a.status === "pending").forEach(app => {
          apps.push({ job, location, application: app });
        });
      });
    });
    return apps;
  }, [jobsData]);

  /** Reject dialog description (computed outside JSX to avoid parser confusion with object literal in attribute). */
  const rejectDialogDescription = useMemo(() => {
    if (rejectTimesheetStep === "success") return t("dashboard.timesheetsHaveBeenRejected", "The selected timesheets have been rejected.");
    if (rejectTimesheetStep === "review" && bulkRejectModal?.length) {
      return t("dashboard.rejectTimesheetsCount", {
        count: bulkRejectModal.length,
        defaultValue: `${bulkRejectModal.length} timesheet(s) will be rejected.`,
      });
    }
    if (rejectTimesheetStep === "form" && bulkRejectModal?.length) return t("dashboard.rejectionReason", "Reason for rejection");
    return undefined;
  }, [rejectTimesheetStep, bulkRejectModal, t]);

  // Geofence: 500m = within job site. Travel time estimate: 25 mph ≈ 11170 m/h for suggested deduction when clock-in/out outside.
  const GEOFENCE_RADIUS_M = 500;
  const METERS_PER_HOUR_TRAVEL = 11170; // ~25 mph
  const getSuggestedDeductionHours = (ts: TimesheetDisplay): number => {
    let hours = 0;
    if (ts.clockInDistanceMeters > GEOFENCE_RADIUS_M) hours += ts.clockInDistanceMeters / METERS_PER_HOUR_TRAVEL;
    if (ts.clockOutDistanceMeters != null && ts.clockOutDistanceMeters > GEOFENCE_RADIUS_M) hours += ts.clockOutDistanceMeters / METERS_PER_HOUR_TRAVEL;
    return hours;
  };

  /** Jobs with pending applications, grouped by job.id (one row per job with applicant count). Exclude jobs that already have workers. */
  const jobsWithPendingApplicants = useMemo(() => {
    const byJob = new Map<number, { job: SampleJob; location: SampleLocation; applications: SampleApplication[] }>();
    allPendingApplications.forEach(({ job, location, application }) => {
      const hasWorkers = job.applications?.some((a: any) => a.status === "accepted") || (job as any).workersHired > 0;
      if (hasWorkers) return;
      const existing = byJob.get(job.id);
      if (existing) {
        existing.applications.push(application);
      } else {
        byJob.set(job.id, { job, location, applications: [application] });
      }
    });
    return Array.from(byJob.values());
  }, [allPendingApplications]);

  /** Jobs past schedule that need reschedule. Excludes jobs that have workers assigned (in progress). */
  const jobsNeedingReschedule = useMemo(() => {
    const jobs: { job: SampleJob; location: SampleLocation }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    jobsData.forEach(location => {
      location.jobs.forEach(job => {
        const hasWorkers = job.applications?.some((a: any) => a.status === "accepted") || ((job as any).workersHired ?? 0) > 0;
        if (hasWorkers) return; // past schedule but with workers = in progress, do not show in reschedule flow
        if ((job.status === "open" || job.status === "in_progress") && job.startDate) {
          const jobDate = new Date(job.startDate);
          jobDate.setHours(0, 0, 0, 0);
          if (jobDate < today) {
            jobs.push({ job, location });
          }
        }
      });
    });
    return jobs;
  }, [jobsData]);

  const hasActionItems = allPendingApplications.length > 0 || jobsNeedingReschedule.length > 0 || pendingTimesheets.length > 0;

  /** Flat list of actions for sequential flow: hire (per job), timesheets (per job with pending), reschedule (per job). */
  const actionRequiredItems = useMemo(() => {
    type Item = 
      | { type: "hire"; job: SampleJob; location: SampleLocation; applications: SampleApplication[] }
      | { type: "timesheets"; projectGroup: ProjectGroup }
      | { type: "reschedule"; job: SampleJob; location: SampleLocation };
    const items: Item[] = [];
    jobsWithPendingApplicants.forEach(({ job, location, applications }) => {
      items.push({ type: "hire", job, location, applications });
    });
    pendingTimesheetGroups
      .filter(pg => pg.timesheets.length > 0)
      .forEach(pg => items.push({ type: "timesheets", projectGroup: pg }));
    jobsNeedingReschedule.forEach(({ job, location }) => {
      items.push({ type: "reschedule", job, location });
    });
    return items;
  }, [jobsWithPendingApplicants, pendingTimesheetGroups, jobsNeedingReschedule]);

  // When Action Required opens: start at 0 or at saved index (after closing job details / reschedule)
  const prevShowPendingRef = useRef(false);
  useEffect(() => {
    const open = showPendingRequests;
    if (open && !prevShowPendingRef.current) {
      const next = actionRequiredReopenAtRef.current;
      actionRequiredReopenAtRef.current = null;
      const len = actionRequiredItems.length;
      setActionRequiredItemIndex(next != null ? Math.min(next, Math.max(0, len - 1)) : 0);
    }
    prevShowPendingRef.current = open;
  }, [showPendingRequests, actionRequiredItems.length]);

  // When all action required items are done (dialog open, 0 items), show success and fire confetti once
  useEffect(() => {
    if (showPendingRequests && actionRequiredItems.length === 0) {
      if (!actionRequiredConfettiFiredRef.current) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        actionRequiredConfettiFiredRef.current = true;
      }
    } else if (!showPendingRequests) {
      actionRequiredConfettiFiredRef.current = false;
    }
  }, [showPendingRequests, actionRequiredItems.length]);

  // Prefill inline reschedule form with suggested (today+2, 9am–5pm, one-day) when current action item is reschedule
  const actionRequiredCurrentItem = actionRequiredItems.length > 0 ? actionRequiredItems[Math.min(actionRequiredItemIndex, actionRequiredItems.length - 1)] : null;
  const actionRequiredRescheduleItem =
    actionRequiredCurrentItem?.type === "reschedule" ? actionRequiredCurrentItem : null;
  useEffect(() => {
    if (!showPendingRequests || !actionRequiredRescheduleItem) return;
    setActionReqRescheduleData(getSuggestedRescheduleData());
    setActionReqRescheduleView("one-day");
    setActionReqRescheduleOnDemandStep(1);
    setActionReqRescheduleOneDayStep(1);
    setActionReqRescheduleRecurringStep(1);
    setActionReqRescheduleError(null);
    setActionReqRescheduleWorkersNeeded(actionRequiredRescheduleItem.job.maxWorkersNeeded ?? 1);
  }, [showPendingRequests, actionRequiredRescheduleItem, getSuggestedRescheduleData]);

  // Calculate job counts for each filter category
  const jobCounts = useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let completed = 0;
    let draft = 0;

    jobsData.forEach(location => {
      location.jobs.forEach(job => {
        if (job.status === "draft") {
          draft++;
          return;
        }
        const hasApprovedWorkers = job.applications.some(app => app.status === "accepted");
        if (job.status === "completed") {
          completed++;
        } else if (hasApprovedWorkers) {
          inProgress++;
        } else if (job.status === "open" && !hasApprovedWorkers) {
          open++;
        }
      });
    });

    return { open, inProgress, completed, draft, total: open + inProgress + completed + draft };
  }, [jobsData]);

  // When there are no open jobs, switch away from "open" filter so user sees content
  useEffect(() => {
    if (jobsFilter === "open" && jobCounts.open === 0) {
      if (jobCounts.inProgress > 0) setJobsFilter("in_progress");
      else if (jobCounts.completed > 0) setJobsFilter("done");
    }
  }, [jobsFilter, jobCounts.open, jobCounts.inProgress, jobCounts.completed, setJobsFilter]);

  // Job commitments = schedule-aware hours × hired workers × rate × markup, capped by budget when set, minus approved pay
  const totalJobCommitments = useMemo(() => {
    let total = 0;
    jobsData.forEach(location => {
      location.jobs.forEach(job => {
        if (job.status === "completed") return;
        const approvedForJob = normalizedTimesheets
          .filter(t => t.jobId === job.id && t.status === "approved")
          .reduce((sum, t) => sum + Math.round(t.adjustedHours * t.hourlyRate * COMPANY_COST_MARKUP), 0);
        total += getJobCommitmentRemainingCents(job, approvedForJob);
      });
    });
    return total;
  }, [jobsData, normalizedTimesheets]);

  const jobsWithCommitments = useMemo(() => {
    return (jobsData || []).flatMap(location =>
      location.jobs
        .filter(job => {
          const hasActiveWorkers = job.applications?.some((app: any) => app.status === "accepted");
          return hasActiveWorkers && job.status !== "completed";
        })
        .map(job => {
          const approvedForJob = normalizedTimesheets
            .filter(t => t.jobId === job.id && t.status === "approved")
            .reduce((sum, t) => sum + Math.round(t.adjustedHours * t.hourlyRate * COMPANY_COST_MARKUP), 0);
          const remainingCents = getJobCommitmentRemainingCents(job, approvedForJob);
          return {
            id: job.id,
            title: job.title,
            amount: remainingCents,
            locationData: location,
            fullJob: job,
          };
        })
    ).filter(j => j.amount > 0);
  }, [jobsData, normalizedTimesheets]);

  const autoRechargeNeeded = useMemo(() => {
    const pendingPayments = totalPendingPay;
    const commitments = totalJobCommitments;
    const totalNeeded = pendingPayments + (commitments * 0.25);
    return totalNeeded > accountBalance;
  }, [totalPendingPay, totalJobCommitments, accountBalance]);

  // Helper function to find job by ID
  const findJobById = (jobId: number): SampleJob | null => {
    for (const location of jobsData) {
      const job = location.jobs.find(j => j.id === jobId);
      if (job) return job;
    }
    return null;
  };

  // Handler for Complete Job button - checks pending timesheets first; if none, open 5-stage mark-complete flow
  const handleCompleteJobClick = (jobId: number, jobTitle: string) => {
    const jobPendingTimesheets = pendingTimesheets.filter(t => t.jobId === jobId);
    const job = findJobById(jobId);
    
    if (jobPendingTimesheets.length > 0) {
      setShowPendingTimesheetsWarning({ jobId, jobTitle, pendingCount: jobPendingTimesheets.length });
    } else if (job) {
      setShowMarkCompleteDialog(job);
      setMarkCompleteFlowStep("intro");
      setCompletionPhotoUrls([]);
      setAddToTeamSelectedWorkerIds([]);
      setReviewWorkerIndex(0);
      setReviewRatings({ timeliness: 0, effort: 0, communication: 0, value: 0 });
      setReviewPrivateNote("");
    }
  };

  // When navigated from ChatsPage JobDetailsPanel "Mark as Complete" (URL ?completeJob=...&jobTitle=...) — open review flow (or pending timesheets) without switching to timesheets tab
  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const completeJobId = params.get("completeJob");
    if (!completeJobId || !jobsData.length) return;
    const jobId = parseInt(completeJobId, 10);
    if (isNaN(jobId)) return;
    const jobTitle = params.get("jobTitle") ? decodeURIComponent(params.get("jobTitle")!) : "";
    // Clear the params from URL; stay on current tab (do not switch to timesheets)
    params.delete("completeJob");
    params.delete("jobTitle");
    const newSearch = params.toString();
    const base = location.pathname || "/company-dashboard";
    const newUrl = `${base}${newSearch ? "?" + newSearch : ""}`;
    window.history.replaceState(null, "", newUrl);
    // Open pending timesheets pop-up or mark-complete review flow
    handleCompleteJobClick(jobId, jobTitle || "Job");
  }, [jobsData.length, activeTab]);

  // When navigated from notification/deep link (URL ?jobId=... or ?applicationId=...) — open job details popup
  useEffect(() => {
    if (!jobsData.length) return;
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const jobIdParam = params.get("jobId");
    const applicationIdParam = params.get("applicationId");
    if (!jobIdParam && !applicationIdParam) return;

    const jobId = jobIdParam ? parseInt(jobIdParam, 10) : null;
    const applicationId = applicationIdParam ? parseInt(applicationIdParam, 10) : null;
    let targetJob: SampleJob | null = null;
    let targetLocation: SampleLocation | null = null;
    let targetApplication: SampleApplication | null = null;

    for (const loc of jobsData) {
      for (const job of loc.jobs) {
        if (jobId && job.id === jobId) {
          targetJob = job;
          targetLocation = loc;
          if (applicationId) {
            targetApplication = job.applications?.find((a: any) => a.id === applicationId) ?? null;
          }
          break;
        }
        if (applicationId && job.applications?.some((a: any) => a.id === applicationId)) {
          targetJob = job;
          targetLocation = loc;
          targetApplication = job.applications?.find((a: any) => a.id === applicationId) ?? null;
          break;
        }
      }
      if (targetJob) break;
    }

    if (targetJob && targetLocation) {
      if (activeTab !== "jobs") navigate("/company-dashboard/jobs");
      setSelectedJobDetails(targetJob);
      setSelectedJobLocation(targetLocation);
      setSelectedApplication(targetApplication);
    }

    // Clear the params from URL
    params.delete("jobId");
    params.delete("applicationId");
    params.delete("tab");
    const newSearch = params.toString();
    const base = typeof window !== "undefined" ? window.location.pathname || "/company-dashboard" : "/company-dashboard";
    const newUrl = `${base}${newSearch ? "?" + newSearch : ""}`;
    if (typeof window !== "undefined") window.history.replaceState(null, "", newUrl);
  }, [activeTab, jobsData, navigate]);


  function CompanyMenuPanelLocations() {
    return (
      <div className="space-y-4 pr-4">
          {companyLocations.map((loc: any) => (
            <Card key={loc.id} className={`p-4 ${loc.isPrimary ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <MapPin className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">{loc.name}</p>
                    <p className="text-sm text-muted-foreground">{loc.address}</p>
                    <p className="text-sm text-muted-foreground">{loc.city}, {loc.state} {loc.zipCode}</p>
                  </div>
                </div>
                {loc.isPrimary && <Badge>{t("settings.primary")}</Badge>}
              </div>
            </Card>
          ))}
          <Button variant="outline" className="w-full border-dashed" onClick={() => setShowAddLocation(true)} data-testid="button-add-location-panel">
            <Plus className="w-4 h-4 mr-2" /> {t("settings.addNewLocation")}
          </Button>
        </div>
    );
  }

  // Card brand to datatrans payment-logos URL (https://github.com/datatrans/payment-logos)
  const CARD_LOGO_BASE = "https://raw.githubusercontent.com/datatrans/payment-logos/master/assets";
  const cardLogoForBrand = (brand: string | null | undefined): string | null => {
    if (!brand) return `${CARD_LOGO_BASE}/generic/card-generic.svg`;
    const b = brand.toLowerCase().replace(/\s+/g, "-");
    const map: Record<string, string> = {
      visa: "cards/visa.svg",
      mastercard: "cards/mastercard.svg",
      amex: "cards/american-express.svg",
      "american-express": "cards/american-express.svg",
      discover: "cards/discover.svg",
      "diners_club": "cards/diners.svg",
      "diners-club": "cards/diners.svg",
      diners: "cards/diners.svg",
      jcb: "cards/jcb.svg",
      unionpay: "cards/unionpay.svg",
      maestro: "cards/maestro.svg",
    };
    return map[b] ? `${CARD_LOGO_BASE}/${map[b]}` : `${CARD_LOGO_BASE}/generic/card-generic.svg`;
  };

  function CompanyMenuPanelPaymentMethods() {
    const methodsWithStripeId = (paymentMethods || []).filter(
      (m: any) => !!(m.stripePaymentMethodId ?? m.stripe_payment_method_id)
    );
    return (
      <div className="flex flex-col min-h-0 pr-4">
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium p-3">{t("settings.paymentMethod", "Payment method")}</th>
                  <th className="text-left font-medium p-3 hidden sm:table-cell">{t("settings.details", "Details")}</th>
                  <th className="w-10 p-3" aria-label={t("common.actions", "Actions")} />
                </tr>
              </thead>
              <tbody>
                {methodsWithStripeId.map((method: any) => {
                  const locationIdSet = new Set((method.locationIds || []).map((id: any) => String(id)));
                  const assignedLocations = locationIdSet.size > 0
                    ? companyLocations.filter((l: any) => locationIdSet.has(String(l.id)))
                    : [];
                  const cardBrandDisplay = method.cardBrand ? method.cardBrand.charAt(0).toUpperCase() + method.cardBrand.slice(1) : t("common.card", "Card");
                  const label = method.type === "card"
                    ? t("settings.cardEndingIn", { brand: cardBrandDisplay, lastFour: method.lastFour })
                    : t("settings.bankEndingIn", { bank: method.bankName || t("settings.bankAccount"), lastFour: method.lastFour });
                  const locationLabel = assignedLocations.length === 0
                    ? (t("settings.primaryAllLocations", "All locations") as string)
                    : assignedLocations.map((l: any) => l.name).join(", ");
                  const isAchUnverified = method.type === "ach" && !(method.isVerified ?? (method as any).is_verified) && (method.stripeBankStatus ?? (method as any).stripe_bank_status) !== "verified";
                  return (
                    <tr
                      key={method.id}
                      className={`border-b last:border-b-0 ${method.isPrimary ? "bg-primary/5" : ""}`}
                    >
                      <td className="p-3 align-middle">
                        <div className="flex items-center gap-2 flex-wrap">
                          {method.type === "card" ? (
                            <img
                              src={cardLogoForBrand(method.cardBrand) ?? ""}
                              alt=""
                              className="w-8 h-5 object-contain shrink-0"
                            />
                          ) : (
                            <Landmark className="w-5 h-5 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-medium">{label}</span>
                          {method.isPrimary && <Badge variant="secondary" className="text-xs">{t("settings.default")}</Badge>}
                          {method.type === "ach" && (() => {
                            const stripeStatus = method.stripeBankStatus ?? (method as any).stripe_bank_status;
                            const verified = method.isVerified ?? (method as any).is_verified;
                            if (verified || stripeStatus === "verified") return null;
                            if (stripeStatus === "verification_failed") return (
                              <Badge variant="outline" className="text-xs text-destructive border-destructive/50">
                                {t("settings.verificationFailed", "Verification failed")}
                              </Badge>
                            );
                            if (stripeStatus === "new" || (!verified && !stripeStatus)) return (
                              <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">
                                {t("settings.pendingVerification", "Pending verification")}
                              </Badge>
                            );
                            return null;
                          })()}
                        </div>
                        {isAchUnverified && (
                          <div className="mt-2 sm:hidden">
                            <Button variant="outline" size="sm" className="text-xs" onClick={() => setBankVerificationMethod(method)} data-testid={`button-verify-bank-mobile-${method.id}`}>
                              {t("settings.verifyBank", "Verify bank")}
                            </Button>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground hidden sm:table-cell align-middle">
                        {isAchUnverified ? (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => setBankVerificationMethod(method)} data-testid={`button-verify-bank-${method.id}`}>
                            {t("settings.verifyBank", "Verify bank")}
                          </Button>
                        ) : assignedLocations.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignedLocations.map((loc: any) => (
                              <Badge key={loc.id} variant="outline" className="text-xs font-normal">
                                <MapPin className="w-3 h-3 mr-0.5" />
                                {loc.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{locationLabel}</span>
                        )}
                      </td>
                      <td className="p-3 align-middle">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`button-payment-menu-${method.id}`}>
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!method.isPrimary && (
                              <DropdownMenuItem
                                onClick={() => setPrimaryPaymentMethodMutation.mutate(method.id)}
                                disabled={setPrimaryPaymentMethodMutation.isPending}
                                data-testid={`menu-set-default-${method.id}`}
                              >
                                {t("settings.setAsDefault")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                setEditPaymentMethodLocations({ id: method.id, locationIds: (method.locationIds || []).map(String) });
                                setPaymentMethodsView("assignLocations");
                                setShowPaymentMethods(true);
                              }}
                              data-testid={`menu-assign-locations-${method.id}`}
                            >
                              {t("settings.assignToLocations")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => deletePaymentMethodMutation.mutate(method.id)}
                              disabled={deletePaymentMethodMutation.isPending || (method.isPrimary && methodsWithStripeId.length === 1)}
                              data-testid={`menu-remove-${method.id}`}
                            >
                              {t("settings.remove")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="sticky bottom-0 left-0 right-0 flex-shrink-0 pt-4 pb-1 bg-background border-t mt-4">
          <Button variant="outline" className="w-full border-dashed" onClick={() => setShowStripeAddPaymentMethod(true)} data-testid="button-add-payment-method-panel">
            <Plus className="w-4 h-4 mr-2" /> {t("settings.addNewPaymentMethod")}
          </Button>
        </div>
      </div>
    );
  }

  function CompanyMenuPanelTeamAccess() {
    const pendingInvites = teamInvites.filter((inv: any) => inv.status === "pending");
    return (
      <div className="space-y-4 pr-4">
          <div>
            <h4 className="font-medium mb-3">{t("company.team.currentMembers", "Current Team")}</h4>
            <div className="space-y-2">
              <Card className="p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{profile?.firstName?.charAt(0)}{profile?.lastName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{profile?.firstName} {profile?.lastName}</p>
                      <p className="text-sm text-muted-foreground">{profile?.email}</p>
                    </div>
                  </div>
                  <Badge>{t("settings.owner")}</Badge>
                </div>
              </Card>
              {teamMembers.map((member: any) => (
                <Card key={member.id} className="p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar>
                        <AvatarFallback>{member.firstName?.charAt(0)}{member.lastName?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{member.firstName} {member.lastName}</p>
                        <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{member.role}</Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteTeamMember.mutate(member.id)}
                            data-testid={`panel-remove-member-${member.id}`}
                          >
                            <UserMinus className="w-4 h-4 mr-2" />
                            {t("company.team.removeTeammate", "Remove")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
          {pendingInvites.length > 0 && (
            <div>
              <h4 className="font-medium mb-3">{t("company.team.pendingInvites", "Pending Invites")}</h4>
              <div className="space-y-2">
                {pendingInvites.map((invite: any) => (
                  <Card key={invite.id} className="p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar>
                          <AvatarFallback>{invite.firstName?.[0] || invite.email?.charAt(0)?.toUpperCase() || "?"}{invite.lastName?.[0] || ""}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{invite.firstName ? `${invite.firstName} ${invite.lastName || ""}`.trim() : invite.email}</p>
                          {invite.firstName && <p className="text-xs text-muted-foreground truncate">{invite.email}</p>}
                          <p className="text-xs text-muted-foreground">
                            {t("company.team.expires", "Expires")} {invite.expiresAt ? format(new Date(invite.expiresAt), "MMM d") : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{invite.role}</Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => resendTeamInvite.mutate(invite.id)}
                              disabled={resendTeamInvite.isPending}
                              data-testid={`panel-resend-invite-${invite.id}`}
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              {t("company.team.resendInvite", "Resend invite")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => deleteTeamInvite.mutate(invite.id)}
                              data-testid={`panel-revoke-invite-${invite.id}`}
                            >
                              <X className="w-4 h-4 mr-2" />
                              {t("company.team.revokeInvite", "Revoke invite")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <Button
            variant="outline"
            className="w-full border-dashed h-12"
            onClick={() => { setInviteWizardStep(1); setShowTeamAccess(true); }}
            data-testid="button-add-teammate-panel"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("company.team.addTeammate", "Add Teammate")}
          </Button>
        </div>
    );
  }

  function CompanyMenuPanelNotifications() {
    return (
      <div className="space-y-4 pr-4">
          <p className="text-sm text-muted-foreground">{t("notifications.routingNote")}</p>
          <div>
            <h4 className="font-medium mb-3">{t("notifications.emailNotifications")}</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("notifications.newWorkerApplications")}</Label>
                <Switch
                  checked={notificationSettings.emailNewApplications}
                  onCheckedChange={(c) => setNotificationSettings(prev => ({ ...prev, emailNewApplications: c }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("notifications.timesheetSubmissions")}</Label>
                <Switch
                  checked={notificationSettings.emailTimesheets}
                  onCheckedChange={(c) => setNotificationSettings(prev => ({ ...prev, emailTimesheets: c }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("notifications.paymentConfirmations")}</Label>
                <Switch
                  checked={notificationSettings.emailPayments}
                  onCheckedChange={(c) => setNotificationSettings(prev => ({ ...prev, emailPayments: c }))}
                />
              </div>
            </div>
          </div>
          <Separator />
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              {t("notifications.smsNotifications")}
              <span className="text-xs font-normal text-muted-foreground">({t("notifications.comingSoon", "coming soon")})</span>
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("notifications.newWorkerApplications")}</Label>
                <Switch
                  checked={notificationSettings.smsNewApplications}
                  onCheckedChange={(c) => setNotificationSettings(prev => ({ ...prev, smsNewApplications: c }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("notifications.timesheetSubmissions")}</Label>
                <Switch
                  checked={notificationSettings.smsTimesheets}
                  onCheckedChange={(c) => setNotificationSettings(prev => ({ ...prev, smsTimesheets: c }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("notifications.paymentConfirmations")}</Label>
                <Switch
                  checked={notificationSettings.smsPayments}
                  onCheckedChange={(c) => setNotificationSettings(prev => ({ ...prev, smsPayments: c }))}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <Button
              onClick={() => {
                if (!profile?.id) return;
                updateProfile.mutate({
                  id: profile.id,
                  data: {
                    emailNotifications: notificationSettings.emailNewApplications || notificationSettings.emailTimesheets || notificationSettings.emailPayments ? true : false,
                    smsNotifications: notificationSettings.smsNewApplications || notificationSettings.smsTimesheets || notificationSettings.smsPayments ? true : false,
                    notifyNewJobs: notificationSettings.emailNewApplications || notificationSettings.smsNewApplications,
                    notifyJobUpdates: notificationSettings.emailTimesheets || notificationSettings.smsTimesheets,
                    notifyPayments: notificationSettings.emailPayments || notificationSettings.smsPayments,
                  },
                  skipToast: true,
                });
                toast({ title: t("notifications.saved") || "Notifications saved" });
              }}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />} {tCommon("save")}
            </Button>
          </div>
        </div>
    );
  }

  function CompanyMenuPanelLanguage() {
    return (
      <div className="space-y-4 pr-4">
        <p className="text-sm text-muted-foreground">{t("settings.selectLanguage")}</p>
        <div className="space-y-2">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const currentLang = (i18n.language?.split("-")[0] || "en") as LanguageCode;
            const isSelected = lang.code === currentLang;
            return (
              <button
                key={lang.code}
                onClick={async () => {
                  await changeLanguage(lang.code, profile?.id);
                  window.location.reload();
                }}
                className={`w-full flex items-center gap-3 p-4 rounded-xl transition-colors text-left border-2 ${isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50 border-transparent"}`}
                data-testid={`select-language-${lang.code}`}
              >
                <span className="text-2xl">{lang.flag}</span>
                <div className="flex-1 text-left">
                  <p className={`font-medium ${isSelected ? "text-primary" : ""}`}>{lang.nativeName}</p>
                  <p className="text-sm text-muted-foreground">{lang.name}</p>
                </div>
                {isSelected && <Check className="w-5 h-5 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function CompanyMenuPanelHiringPreferences() {
    return (
      <div className="space-y-4 pr-4">
        <p className="text-sm text-muted-foreground">
          {t("settings.hiringPreferencesDesc", "Select industries and roles you hire for")}
        </p>
        <div className="space-y-4">
          {INDUSTRY_CATEGORIES.map((industry) => {
            const isSelected = selectedIndustries.includes(industry.id);
            const IconComponent = industry.icon;
            return (
              <Card
                key={industry.id}
                className={`p-4 cursor-pointer hover-elevate transition-colors ${isSelected ? "border-primary bg-primary/5" : ""}`}
                onClick={() => {
                  setSelectedIndustries(prev =>
                    isSelected
                      ? prev.filter(id => id !== industry.id)
                      : [...prev, industry.id]
                  );
                }}
                data-testid={`industry-${industry.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{industry.label}</h4>
                      <Checkbox checked={isSelected} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {industry.roles.map(r => r.label).join(", ")}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        {selectedIndustries.length === 0 && (
          <div className="p-3 border border-yellow-500/30 bg-yellow-500/10 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              {t("industries.selectAtLeastOne", "Please select at least one industry.")}
            </p>
          </div>
        )}
        <div className="pt-4">
          <Button
            onClick={() => {
              if (!profile?.id) return;
              updateProfile.mutate(
                { id: profile.id, data: { hiringIndustries: selectedIndustries }, skipToast: true },
                { onSuccess: () => toast({ title: t("industries.savedPreferences", "Hiring preferences saved") }) }
              );
            }}
            disabled={selectedIndustries.length === 0 || updateProfile.isPending}
            data-testid="button-save-hiring-preferences"
          >
            {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            {tCommon("save")}
          </Button>
        </div>
      </div>
    );
  }

  function CompanyMenuPanelBilling() {
    return (
      <div className="space-y-4 pr-4">
          <div className="flex flex-wrap items-end gap-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <Label className="text-xs">{t("settings.fromDate")}</Label>
              <Input
                type="date"
                value={billingFilters.dateFrom}
                onChange={(e) => setBillingFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                className="w-40"
              />
            </div>
            <div>
              <Label className="text-xs">{t("settings.toDate")}</Label>
              <Input
                type="date"
                value={billingFilters.dateTo}
                onChange={(e) => setBillingFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                className="w-40"
              />
            </div>
            <div>
              <Label className="text-xs">{t("settings.type")}</Label>
              <Select value={billingFilters.type} onValueChange={(v) => setBillingFilters(prev => ({ ...prev, type: v }))}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("settings.allTypes")}</SelectItem>
                  <SelectItem value="charge">{t("settings.workerPayments")}</SelectItem>
                  <SelectItem value="deposit">{t("settings.deposits")}</SelectItem>
                  <SelectItem value="auto_recharge">{t("settings.autoRecharge")}</SelectItem>
                  <SelectItem value="refund">{t("settings.refunds")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setBillingFilters({ dateFrom: "", dateTo: "", type: "all", worker: "all", category: "all" })}>
              {t("settings.clearFilters")}
            </Button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-8 gap-4 p-3 bg-muted text-sm font-medium">
              <div>{t("settings.dateTime")}</div>
              <div>{t("settings.type")}</div>
              <div>{t("settings.method")}</div>
              <div>{t("settings.worker")}</div>
              <div>{t("settings.job")}</div>
              <div className="text-right">{t("settings.hours")}</div>
              <div className="text-right">{t("settings.amount")}</div>
              <div className="text-center">{t("settings.receipt")}</div>
            </div>
            <div>
              {billingHistoryLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : billingHistoryData.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <CreditCard className="w-10 h-10 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">{t("settings.noBillingHistory")}</p>
                </div>
              ) : (
                billingHistoryData.map((item: any) => {
                  let amountInCents = item.amount;
                  if ((item.type === "deposit" || item.type === "auto_recharge") && Math.abs(item.amount) > 0) {
                    const correctedAmount = Math.round(item.amount * 10);
                    if (Math.abs(item.amount) < 10000 && Math.abs(correctedAmount) >= 10000) {
                      amountInCents = correctedAmount;
                    }
                  }
                  const baseAmount = amountInCents != null ? Math.abs(amountInCents / 100) : null;
                  const amountDisplay = baseAmount != null
                    ? (item.amount > 0 ? "+" : "") + "$" + baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "—";
                  return (
                  <div key={item.id} className="grid grid-cols-8 gap-4 p-3 border-t items-center text-sm">
                    <div className="text-muted-foreground">
                      <div>{format(new Date(item.date), "MMM d, yyyy")}</div>
                      <div className="text-xs">{format(new Date(item.date), "h:mm a")}</div>
                    </div>
                    <div>{item.type || "—"}</div>
                    <div>{item.method ?? item.paymentMethod ?? "—"}</div>
                    <div className="truncate">{item.workerName || "—"}</div>
                    <div className="truncate">{item.jobTitle || "—"}</div>
                    <div className="text-right">{item.hours != null ? (typeof item.hours === "number" ? `${item.hours}h` : item.hours) : "—"}</div>
                    <div className={`text-right font-medium ${item.amount > 0 ? "text-green-600" : ""}`}>{amountDisplay}</div>
                    <div className="text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`billing-panel-receipt-${item.id}`}>
                            <FileText className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              generateBillingReceiptPdf(item);
                              toast({ title: t("settings.receiptDownloaded") ?? "Receipt Downloaded", description: t("settings.receiptSavedPdf") ?? "Your receipt has been saved as PDF." });
                            }}
                            data-testid={`billing-panel-download-receipt-${item.id}`}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            {t("settings.downloadReceipt") ?? "Download receipt"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setComposeReceiptItem(item);
                              setComposeReceiptMemo("");
                            }}
                            data-testid={`billing-panel-compose-receipt-${item.id}`}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            {t("settings.composeReceipt") ?? "Compose receipt"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
    );
  }

  function CompanyMenuPanelAgreements() {
    if (agreementDisplayList.length === 0) {
      return (
        <div className="space-y-4 pr-4">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">{t("settings.noAgreements")}</p>
          </Card>
        </div>
      );
    }
    return (
      <div className="space-y-4 pr-4">
          {agreementDisplayList.map((agreement) => (
            <Card key={agreement.id ?? "legacy"} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <FileCheck className="w-5 h-5 text-green-600 mt-1" />
                  <div>
                    <h4 className="font-medium">{agreement.type}</h4>
                    <p className="text-sm text-muted-foreground">{t("settings.version")} {agreement.version}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.signedBy", { name: agreement.signedName, date: agreement.signedAt ? format(new Date(agreement.signedAt), "MMMM d, yyyy") : "—" })}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedAgreement(agreement);
                    setViewingAgreement(true);
                  }}
                  data-testid="button-view-agreement-panel"
                >
                  <Eye className="w-4 h-4 mr-2" /> {t("settings.view")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
    );
  }

  if (profileLoading) {
    return <AppLoading />;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className={`flex flex-col min-h-screen bg-secondary/20 ${!isMobile ? "h-screen" : ""}`}>
      {!isMobile && (
      <div className="flex-shrink-0">
        <Navigation 
          hidePostJobLink
          tabs={
            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
                <AnimatedNavigationTabs
                  aria-label="Company dashboard navigation"
                  items={[
                    { id: "jobs", label: t("nav.jobs") },
                    { id: "team", label: t("nav.team") },
                    { id: "timesheets", label: t("company.timesheets"), badge: pendingTimesheets.length > 0 ? (pendingTimesheets.length > 9 ? "9+" : String(pendingTimesheets.length)) : undefined },
                    { id: "chats", label: t("nav.messages"), onClick: () => navigate("/company-dashboard/chats"), badge: totalUnreadChats > 0 ? (totalUnreadChats > 9 ? "9+" : String(totalUnreadChats)) : undefined },
                  ]}
                  value={["jobs", "team", "timesheets", "chats"].includes(activeTab) ? activeTab : ""}
                  onValueChange={(id) => { if (id === "chats") navigate("/company-dashboard/chats"); else setActiveTab(id); }}
                />
              </div>
              <Button
                variant="default"
                size="sm"
                className="flex-shrink-0"
                onClick={() => {
                  if (!hasSignedAgreement) {
                    setShowMandatoryAgreement(true);
                    toast({ title: t("dashboard.agreementRequired"), description: t("dashboard.pleaseSignAgreementBeforePosting"), variant: "destructive" });
                    return;
                  }
                  const hasPaymentCapability = hasUsablePaymentMethod || (profile?.depositAmount && profile.depositAmount > 0);
                  if (!hasPaymentCapability) {
                    setShowMandatoryPaymentMethod(true);
                    toast({ title: "Payment Method Required", description: "Please add a payment method before posting jobs.", variant: "destructive" });
                    return;
                  }
                  setLocation("/post-job");
                }}
              >
                + New Job
              </Button>
            </div>
          }
          sidebarNavItems={[
            { id: "jobs", label: t("nav.jobs"), onClick: () => setActiveTab("jobs") },
            { id: "team", label: t("nav.team"), onClick: () => setActiveTab("team") },
            { id: "timesheets", label: t("company.timesheets"), onClick: () => setActiveTab("timesheets") },
            { id: "chats", label: t("nav.messages"), onClick: () => navigate("/company-dashboard/chats") },
          ]}
          onSidebarNavSelect={(id) => id !== "chats" && setActiveTab(id)}
        />
      </div>
      )}
      
      {/* Outer wrapper: flex column, header in own container above body */}
      <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Breadcrumb: mobile only, above header */}
        {isMobile && subsection && activeTab !== "chats" && (
          <nav className="flex flex-shrink-0 items-center gap-2 text-sm mb-4 px-4 sm:px-6 lg:px-8" aria-label="Breadcrumb">
            <button 
              onClick={() => navigate("/company-dashboard/menu")} 
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Menu
            </button>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{breadcrumbLabels[subsection] || subsection}</span>
          </nav>
        )}
        {/* Header: own container, full width on mobile, pinned to top */}
        {isMobile && activeTab !== "menu" && !(activeTab === "chats" && subsection) && (
          <div className="flex-shrink-0 w-full sticky top-0 z-40 bg-background/95 backdrop-blur-md shadow-sm border-b border-border mb-4">
          <header className={`flex items-center justify-between transition-all duration-300 ease-in-out w-full px-4 ${
            isMobile 
              ? (isScrolled ? 'pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2' : 'pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3')
              : 'pt-8 pb-6 mb-6'
          }`}>
          <div className="min-w-0 flex-1">
            <h1 className={`font-bold transition-all duration-300 ${isMobile ? (isScrolled ? 'text-base' : 'text-lg') : 'text-2xl'}`}>
              {activeTab === "timesheets" ? "Timesheets" : 
               activeTab === "jobs" || activeTab === "chats" ? t("dashboard.yourJobs") :
               activeTab === "team" ? t("dashboard.team") :
               activeTab === "invoices" ? t("dashboard.invoices") :
               (profile?.companyName || t("settings.yourCompany"))}
            </h1>
            {!isMobile && (
            <p className="text-muted-foreground">
              {activeTab === "timesheets" ? "Review and approve worker hours" : 
               activeTab === "jobs" || activeTab === "chats" ? t("dashboard.manageJobs") :
               activeTab === "team" ? t("dashboard.manageTeam") :
               activeTab === "invoices" ? t("dashboard.viewInvoices") :
               t("dashboard.companyDashboard")}
            </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(activeTab === "jobs" || activeTab === "chats") && (
              <Button 
                variant="outline"
                size="sm"
                onClick={() => {
                  if (profile?.role === "company") {
                    if (!hasSignedAgreement) {
                      setShowMandatoryAgreement(true);
                      toast({
                        title: t("dashboard.agreementRequired"),
                        description: t("dashboard.pleaseSignAgreementBeforePosting"),
                        variant: "destructive"
                      });
                      return;
                    }
                    const hasPaymentCapability = (paymentMethods && paymentMethods.length > 0) || (profile.depositAmount && profile.depositAmount > 0);
                    if (!hasPaymentCapability) {
                      setShowMandatoryPaymentMethod(true);
                      toast({
                        title: "Payment Method Required",
                        description: "Please add a payment method before posting jobs.",
                        variant: "destructive"
                      });
                      return;
                    }
                  }
                  setLocation("/post-job");
                }} 
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-new-job"
              >
                + new job
              </Button>
            )}
            {isMobile && (
              <div className="flex items-center gap-1">
                <NotificationPopup profileId={profile?.id} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/company-dashboard/menu")}
                  className="rounded-full"
                  data-testid="button-mobile-menu"
                  aria-label="Menu"
                >
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-border object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                      {profile?.companyName?.[0] || "C"}
                    </div>
                  )}
                </Button>
              </div>
            )}
            {activeTab !== "timesheets" && activeTab !== "jobs" && activeTab !== "chats" && (
              <Button 
                variant="outline" 
                size={isMobile ? "sm" : "default"}
                className={isMobile ? "text-xs px-2 py-1" : "text-sm py-1.5 px-3"}
                onClick={() => {
                  setShowBalanceDialog(true);
                  setTopUpAmount("250");
                  const primary = paymentMethods.find(m => m.isPrimary);
                  if (primary) setSelectedPaymentMethod(primary.id);
                }}
                data-testid="button-balance"
              >
                <DollarSign className={isMobile ? "w-3 h-3" : "w-4 h-4 mr-1"} />
                {isMobile ? (
                  <>
                    {accountBalance >= 100000 
                      ? `${(accountBalance / 100000).toFixed(1)}k` 
                      : `${(accountBalance / 100).toLocaleString()}`}
                  </>
                ) : (
                  <>{t("dashboard.balance")}: ${(accountBalance / 100).toLocaleString()}</>
                )}
                {autoRechargeNeeded && (
                  <AlertCircle className={isMobile ? "w-3 h-3 ml-0.5 text-yellow-500" : "w-4 h-4 ml-1 text-yellow-500"} />
                )}
              </Button>
            )}
          </div>
          </header>
          </div>
        )}
        
        {/* Content holder: horizontal padding only on mobile (desktop style is full-bleed). No padding on chat details so ChatSection header is full width. */}
        <div className={`w-full flex-1 min-h-0 flex flex-col pb-14 md:pb-0 overflow-hidden ${isMobile && !(activeTab === "chats" && subsection) ? "px-0 sm:px-6 lg:px-8" : ""}`}>
          <ErrorBoundary section={`${activeTab} tab`}>
          {/* Balance banner: own container stacked below header, full width, only on Timesheets tab */}
          {activeTab === "timesheets" && (
            <div className="flex-shrink-0 w-full bg-card border-b border-border shadow-sm p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <span className="text-xs text-muted-foreground">Balance</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold">${(accountBalance / 100).toLocaleString()}</span>
                      {totalPendingPay > 0 && (
                        <span
                          className="text-xs text-yellow-600 dark:text-yellow-400 cursor-pointer hover:underline"
                          onClick={() => setShowPendingPaymentsDialog(true)}
                        >
                          (${(totalPendingPay / 100).toLocaleString()} pending)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-8 w-px bg-border hidden sm:block" />
                  <button
                    className="text-left hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors"
                    onClick={() => setShowJobCommitmentsDialog(true)}
                    data-testid="button-view-job-commitments"
                  >
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      Job Commitments <ChevronRight className="w-3 h-3" />
                    </span>
                    <div className="text-sm font-semibold">${(totalJobCommitments / 100).toLocaleString()}</div>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white border-0"
                    onClick={() => {
                      setShowBalanceDialog(true);
                      setTopUpAmount("250");
                      const primary = paymentMethods.find(m => m.isPrimary);
                      if (primary) setSelectedPaymentMethod(primary.id);
                    }}
                    data-testid="button-top-up"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Top Up
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      if (import.meta.env.DEV) console.log("[TriggerAutoCharge] Button clicked — triggering auto-draft (pending + commitments)");
                      triggerAutoChargeMutation.mutate();
                    }}
                    disabled={triggerAutoChargeMutation.isPending}
                    title="Trigger auto-draft (charge for pending + job commitments if balance is low)"
                    data-testid="button-trigger-auto-charge"
                  >
                    {triggerAutoChargeMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4" />
                    )}
                  </Button>
                  {showClientDevTools() && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      disabled={!profile?.id}
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/timesheets/seed-pending", { method: "POST", credentials: "include" });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(data.message || "Failed to seed");
                          queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                          toast({ title: "Test timesheets created", description: data.message || `Created ${data.created ?? 0} pending timesheet(s). Refresh to see them.` });
                        } catch (e: any) {
                          toast({ title: "Error", description: e.message || "Failed to create test timesheets", variant: "destructive" });
                        }
                      }}
                      data-testid="button-seed-pending-timesheets"
                    >
                      Create 10 test timesheets
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowTimesheetSettings(true)}
                    data-testid="button-timesheet-settings"
                    aria-label="Timesheet settings"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {jobsWithCommitments.length > 0 && (() => {
                const totalCommitments = jobsWithCommitments.reduce((sum, j) => sum + j.amount, 0);
                const colors = ['bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500'];
                const openJobDetails = (job: typeof jobsWithCommitments[0]) => {
                  setSelectedJobDetails(job.fullJob);
                  setSelectedJobLocation(job.locationData);
                  setShowJobDetailsFullView(true);
                };
                return (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-0.5 w-full mb-2">
                      {jobsWithCommitments.slice(0, 5).map((job, idx) => {
                        const percent = (job.amount / totalCommitments) * 100;
                        return (
                          <div
                            key={job.id}
                            className={`${colors[idx % colors.length]} h-1.5 rounded-sm transition-all cursor-pointer hover:opacity-80`}
                            style={{ width: `${percent}%` }}
                            title={`${job.title}: $${(job.amount / 100).toLocaleString()}`}
                            onClick={() => openJobDetails(job)}
                          />
                        );
                      })}
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                      {jobsWithCommitments.map((job, idx) => {
                        const percent = Math.round((job.amount / totalCommitments) * 100);
                        return (
                          <button
                            key={job.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 hover:bg-muted text-xs whitespace-nowrap transition-colors flex-shrink-0"
                            onClick={() => openJobDetails(job)}
                            data-testid={`button-job-commitment-${job.id}`}
                          >
                            <div className={`w-2 h-2 rounded-full ${colors[idx % colors.length]}`} />
                            <span className="text-muted-foreground max-w-[100px] truncate">{job.title}</span>
                            <span className="font-medium">${(job.amount / 100).toLocaleString()}</span>
                            <span className="text-muted-foreground/70">({percent}%)</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <div className={`flex flex-col flex-1 min-h-0 justify-start pt-0 ${activeTab === "chats" ? "px-0" : activeTab === "timesheets" ? "px-0" : !isMobile && activeTab === "menu" ? "px-0" : "px-[23px] md:px-0 lg:px-[23px]"} ${activeTab === "menu" && !isMobile ? "items-stretch w-full overflow-hidden" : activeTab === "chats" ? "items-stretch w-full overflow-hidden" : "items-stretch w-full overflow-y-auto"} ${activeTab !== "menu" ? "space-y-6" : ""}`}>
          <TabsContent
            value="jobs"
            className="w-full max-w-full flex flex-col items-stretch pt-[14px] pb-[14px] md:px-[14px] space-y-6 mt-0 data-[state=inactive]:h-0 data-[state=inactive]:min-h-0 data-[state=inactive]:overflow-hidden data-[state=inactive]:p-0 data-[state=inactive]:m-0 data-[state=inactive]:mt-0 data-[state=inactive]:space-y-0"
          >
            {/* Action Hub - Pending Requests & Jobs Needing Attention */}
            {hasActionItems && (
              <div 
                className="w-full bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 rounded-2xl p-4 shadow-sm border border-orange-100 dark:border-orange-900/50 cursor-pointer hover:shadow-md transition-all duration-300"
                onClick={() => {
                  setActionHubView("main");
                  setActionHubJobForTimeline(null);
                  setShowPendingRequests(true);
                }}
                data-testid="card-action-hub"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-orange-800 dark:text-orange-200">{t("dashboard.actionRequired")}</p>
                      <p className="text-sm text-orange-700/80 dark:text-orange-300/70 mt-0.5">
                        {allPendingApplications.length > 0 && (
                          <span>{allPendingApplications.length} {allPendingApplications.length > 1 ? t("dashboard.workersAwaitingPlural") : t("dashboard.workersAwaiting")}</span>
                        )}
                        {allPendingApplications.length > 0 && (jobsNeedingReschedule.length > 0 || pendingTimesheets.length > 0) && " • "}
                        {jobsNeedingReschedule.length > 0 && (
                          <span>{jobsNeedingReschedule.length} {jobsNeedingReschedule.length > 1 ? t("dashboard.jobsNeedReschedule") : t("dashboard.jobNeedsReschedule")}</span>
                        )}
                        {jobsNeedingReschedule.length > 0 && pendingTimesheets.length > 0 && " • "}
                        {pendingTimesheets.length > 0 && (
                          <span>{pendingTimesheets.length} {pendingTimesheets.length > 1 ? t("dashboard.timesheetsToApprove") : t("dashboard.timesheetToApprove")}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-orange-500 text-white">{allPendingApplications.length + jobsNeedingReschedule.length + pendingTimesheets.length}</Badge>
                    <ChevronRight className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                </div>
              </div>
            )}
            
            {/* Background-refresh indicator */}
            {!isLoadingJobs && isFetchingJobs && (
              <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Refreshing…
              </div>
            )}

            {/* Skeleton loading state - first paint before jobs load */}
            {isLoadingJobs && (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-full bg-card rounded-2xl border border-border/60 shadow-sm p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-4 w-1/3" />
                      </div>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </div>
                    <div className="flex gap-3">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Skeleton className="h-8 w-28 rounded-lg" />
                      <Skeleton className="h-8 w-8 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty State - No Jobs Yet */}
            {!isLoadingJobs && jobCounts.total === 0 && (
              <div className="w-full bg-card rounded-2xl border border-border/60 shadow-sm p-8 md:p-12 text-center">
                <div className="max-w-md mx-auto">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 flex items-center justify-center mx-auto mb-6">
                    <Briefcase className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="font-semibold text-xl mb-2">{t("dashboard.noJobsYet")}</h3>
                  <p className="text-muted-foreground mb-6">
                    {t("dashboard.postFirstJobDesc")}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button 
                      onClick={() => {
                        if (profile?.role === "company") {
                          if (!hasSignedAgreement) {
                            setShowMandatoryAgreement(true);
                            toast({
                              title: "Agreement Required",
                              description: "Please sign the platform agreement before posting jobs.",
                              variant: "destructive"
                            });
                            return;
                          }
                          // Check for payment methods OR positive deposit (from card payment)
                          const hasPaymentCapability = (paymentMethods && paymentMethods.length > 0) || (profile.depositAmount && profile.depositAmount > 0);
                          if (!hasPaymentCapability) {
                            setShowMandatoryPaymentMethod(true);
                            toast({
                              title: t("dashboard.paymentMethodRequired"),
                              description: t("dashboard.pleaseAddPaymentMethodBeforePosting"),
                              variant: "destructive"
                            });
                            return;
                          }
                        }
                        setLocation("/post-job");
                      }}
                      className="gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg hover:shadow-xl transition-all duration-200 text-white font-semibold px-8 py-3 text-lg hover-btn-scale"
                      size="lg"
                      data-testid="button-post-first-job"
                    >
                      <Plus className="w-5 h-5" /> {t("dashboard.postYourFirstJob")}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setHowItWorksStep(0);
                        setShowHowItWorks(true);
                      }}
                      className="gap-2"
                      data-testid="button-how-it-works"
                    >
                      <HelpCircle className="w-4 h-4" /> {t("dashboard.howItWorks")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Full-Width Filter Slider Tabs - Only show when there are jobs */}
            {jobCounts.total > 0 && (
              <div className="flex items-center p-1 bg-muted/50 rounded-2xl w-full sticky top-0 z-10 md:static">
                {jobCounts.open > 0 && (
                  <Button 
                    variant={jobsFilter === "open" ? "default" : "ghost"} 
                    size="sm"
                    className="flex-1 rounded-xl"
                    onClick={() => setJobsFilter("open")}
                    data-testid="button-jobs-open"
                  >
                    {t("dashboard.open")} <Badge variant="secondary" className="ml-1.5 text-xs">{jobCounts.open}</Badge>
                  </Button>
                )}
                {jobCounts.inProgress > 0 && (
                  <Button 
                    variant={jobsFilter === "in_progress" ? "default" : "ghost"} 
                    size="sm"
                    className="flex-1 rounded-xl"
                    onClick={() => setJobsFilter("in_progress")}
                    data-testid="button-jobs-in-progress"
                  >
                    {t("dashboard.inProgress")} <Badge variant="secondary" className="ml-1.5 text-xs">{jobCounts.inProgress}</Badge>
                  </Button>
                )}
                {jobCounts.completed > 0 && (
                  <Button 
                    variant={jobsFilter === "done" ? "default" : "ghost"} 
                    size="sm"
                    className="flex-1 rounded-xl"
                    onClick={() => setJobsFilter("done")}
                    data-testid="button-jobs-done"
                  >
                    {t("dashboard.completed")} <Badge variant="secondary" className="ml-1.5 text-xs">{jobCounts.completed}</Badge>
                  </Button>
                )}
                {jobCounts.draft > 0 && (
                  <Button 
                    variant={jobsFilter === "draft" ? "default" : "ghost"} 
                    size="sm"
                    className="flex-1 rounded-xl"
                    onClick={() => setJobsFilter("draft")}
                    data-testid="button-jobs-draft"
                  >
                    {t("dashboard.draft", "Draft")} <Badge variant="secondary" className="ml-1.5 text-xs">{jobCounts.draft}</Badge>
                  </Button>
                )}
              </div>
            )}

            {/* Draft Tab — list draft jobs with Publish button */}
            {jobsFilter === "draft" && jobCounts.draft > 0 && (() => {
              const draftJobs = jobsData.flatMap(location =>
                location.jobs
                  .filter(job => job.status === "draft")
                  .map(job => ({ job, location }))
              );
              return (
                <div className="w-full space-y-4 mt-4">
                  {draftJobs.map(({ job, location }) => (
                    <div key={job.id} className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{job.title}</h3>
                        <p className="text-sm text-muted-foreground">{location.name} · {job.trade}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await apiRequest("POST", `/api/jobs/${job.id}/publish`, {});
                            toast({ title: t("dashboard.published", "Published"), description: t("dashboard.jobNowVisible", "Job is now visible to workers.") });
                            queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                          } catch (e: any) {
                            toast({ title: t("error"), description: e?.message || "Failed to publish", variant: "destructive" });
                          }
                        }}
                        data-testid={`button-publish-job-${job.id}`}
                      >
                        {t("dashboard.publish", "Publish")}
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })()}
            
            {/* In-Progress Tab — compact list, no accordion */}
            {jobsFilter === "in_progress" && (() => {
              const inProgressJobs = jobsData.flatMap(location =>
                location.jobs
                  .filter(job => job.applications.some(app => app.status === "accepted") && job.status !== "completed")
                  .map(job => ({ job, location }))
              );

              if (inProgressJobs.length === 0) {
                return (
                  <div className="w-full">
                    <div className="bg-card rounded-xl border border-border/40 shadow-sm p-10 text-center">
                      <Briefcase className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
                      <h3 className="font-medium text-base mb-1">{t("dashboard.noJobsInProgress")}</h3>
                      <p className="text-sm text-muted-foreground mb-5">{t("dashboard.jobsWithWorkersAppear")}</p>
                      <Button onClick={() => setShowNewJobModal(true)} size="sm">
                        <Plus className="w-4 h-4 mr-1.5" />
                        {t("dashboard.newJob", "New Job")}
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="w-full space-y-3" id="content-jobs">
                  {inProgressJobs.map(({ job, location }) => {
                    const approvedWorkers = job.applications.filter(app => app.status === "accepted");
                    const pendingApplicants = job.applications.filter(app => app.status === "pending");
                    const jobTimesheets = normalizedTimesheets.filter(t => t.jobId === job.id);
                    const pendingJobTimesheets = jobTimesheets.filter(t => t.status === "pending");
                    const totalSpent = jobTimesheets.reduce((s, t) => s + Math.round(t.adjustedHours * t.hourlyRate * 1.52), 0) / 100;
                    const openJobDetails = () => {
                      setSelectedJobDetails(job);
                      setSelectedJobLocation(location);
                      setShowJobDetailsFullView(true);
                    };
                    const unreadCount = jobUnreadMap[job.id] ?? 0;
                    const scheduleStr = formatJobSchedule(job);
                    const endDateStr = job.endDate && job.endDate !== job.startDate ? ` – ${formatDateShort(job.endDate)}` : "";
                    const pendingLabel = pendingJobTimesheets.length > 0
                      ? ` · ${pendingJobTimesheets.length} ${t("job.pending")}`
                      : "";

                    return (
                      <div
                        key={job.id}
                        className="bg-card rounded-xl border border-border/40 shadow-sm overflow-hidden hover:border-border/70 transition-colors"
                      >
                        <div
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 cursor-pointer"
                          onClick={openJobDetails}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJobDetails(); } }}
                          role="button"
                          tabIndex={0}
                          data-testid={`card-job-${job.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-medium text-foreground truncate">{job.title}</h3>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {((job as any).paymentHoldAt ?? (job as any).payment_hold_at) && (
                                  <span
                                    className="rounded-md bg-destructive/15 text-destructive px-1.5 py-0.5 text-xs font-medium"
                                    title="Funding failed after hire — fix payment in the payment dialog until balance covers this job."
                                  >
                                    Payment hold
                                  </span>
                                )}
                                {jobHasActiveCallSet.has(job.id) && (
                                  <span className="flex items-center gap-1 rounded-md bg-green-500/15 text-green-700 dark:text-green-400 px-1.5 py-0.5 text-xs font-medium" title="Call in progress">
                                    <Phone className="w-3.5 h-3.5" />
                                    Call
                                  </span>
                                )}
                                {pendingApplicants.length > 0 && (
                                  <span className="flex items-center gap-1 rounded-md bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-1.5 py-0.5 text-xs font-medium" title="Pending applicants">
                                    <User className="w-3.5 h-3.5" />
                                    {pendingApplicants.length}
                                  </span>
                                )}
                                {unreadCount > 0 && (
                                  <span className="flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-medium" title="Unread messages">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                  </span>
                                )}
                                <div className="flex -space-x-2">
                                  {approvedWorkers.slice(0, 3).map((app) => (
                                    <Avatar key={app.id} className="h-7 w-7 border-2 border-card">
                                      <AvatarImage src={app.worker?.avatarUrl} />
                                      <AvatarFallback className="text-[10px] bg-muted">
                                        {app.worker?.firstName?.[0]}{app.worker?.lastName?.[0]}
                                      </AvatarFallback>
                                    </Avatar>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                              {location.name} · {location.city}, {location.state}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1.5">
                              {approvedWorkers.length} worker{approvedWorkers.length !== 1 ? "s" : ""}
                              {scheduleStr && ` · ${scheduleStr}${endDateStr}`}
                              {pendingLabel}
                            </p>
                            <p className="text-sm font-medium text-foreground mt-1">
                              {t("dashboard.totalSpent")} ${totalSpent.toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="default"
                              size="sm"
                              className="rounded-lg"
                              onClick={openJobDetails}
                              data-testid={`button-view-job-${job.id}`}
                            >
                              {t("dashboard.view")}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="rounded-lg h-8 w-8" data-testid={`button-job-actions-${job.id}`} aria-label="Job actions">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {job.workersHired >= job.maxWorkersNeeded && pendingJobTimesheets.length === 0 && (
                                  <DropdownMenuItem onClick={() => handleCompleteJobClick(job.id, job.title)}>
                                    <Check className="w-4 h-4 mr-2" /> {t("dashboard.markComplete")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Open and Completed Jobs View */}
            {jobsFilter !== "in_progress" && jobsFilter !== "draft" && (
            <div className="w-full space-y-2 md:space-y-4">
              {[...jobsData]
                .map(location => {
                  const filteredJobs = location.jobs.filter(job => {
                    if (jobsFilter === "open") {
                      return job.status === "open" && !job.applications.some(app => app.status === "accepted");
                    }
                    return job.status === "completed";
                  });
                  const pendingApplicantCount = filteredJobs.reduce(
                    (sum, j) => sum + j.applications.filter((a: any) => a.status === "pending").length,
                    0
                  );
                  return { location, filteredJobs, pendingApplicantCount };
                })
                .filter(({ filteredJobs }) => filteredJobs.length > 0)
                .sort((a, b) => {
                  if (a.pendingApplicantCount > 0 && b.pendingApplicantCount === 0) return -1;
                  if (a.pendingApplicantCount === 0 && b.pendingApplicantCount > 0) return 1;
                  return b.pendingApplicantCount - a.pendingApplicantCount;
                })
                .map(({ location, filteredJobs, pendingApplicantCount }) => {
                const jobsWithApplicantsFirst = [...filteredJobs].sort((a, b) => {
                  const aPending = a.applications.filter((app: any) => app.status === "pending").length;
                  const bPending = b.applications.filter((app: any) => app.status === "pending").length;
                  return bPending - aPending;
                });
                const hasPendingApplicants = pendingApplicantCount > 0;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const delayedJobsCount = filteredJobs.filter((job: SampleJob) => {
                  if (job.status === "completed" || job.status === "cancelled") return false;
                  if (job.workersHired >= job.maxWorkersNeeded) return false;
                  if (!job.startDate) return false;
                  const start = new Date(job.startDate);
                  start.setHours(0, 0, 0, 0);
                  const oneDayMs = 24 * 60 * 60 * 1000;
                  return (today.getTime() - start.getTime()) >= oneDayMs;
                }).length;

                /** Open/completed cards were showing saved site name as the headline; use real job title when one job. */
                const locationRowPrimaryTitle =
                  filteredJobs.length === 1
                    ? (filteredJobs[0].title?.trim() || location.name)
                    : location.name;
                const addressLine = [location.city, location.state, location.zipCode].filter(Boolean).join(", ");
                const locationRowSubtitleSingleJob = [location.name, addressLine].filter(Boolean).join(" · ");

                return (
                <div 
                  key={location.id} 
                  className={cn(
                    "rounded-xl md:rounded-2xl border shadow-sm overflow-hidden transition-colors",
                    hasPendingApplicants 
                      ? "bg-card border-orange-300 dark:border-orange-700 ring-1 ring-orange-200/50 dark:ring-orange-800/50" 
                      : "bg-card border-border/60"
                  )}
                >
                  <div 
                    className={cn(
                      "flex items-center justify-between p-3 md:p-4 cursor-pointer transition-colors",
                      hasPendingApplicants ? "hover:bg-orange-50/50 dark:hover:bg-orange-950/20" : "hover:bg-muted/30"
                    )}
                    onClick={() => {
                      if (isMobile) {
                        setMobileLocationPopup(location);
                      } else {
                        toggleLocation(location.id);
                      }
                    }}
                    data-testid={`location-${location.id}`}
                  >
                    <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                      <div className={cn(
                        "rounded-full flex items-center justify-center flex-shrink-0",
                        "w-8 h-8 md:w-10 md:h-10",
                        hasPendingApplicants ? "bg-orange-100 dark:bg-orange-900/50" : "bg-blue-100 dark:bg-blue-900/50"
                      )}>
                        <Building className={cn(
                          "w-4 h-4 md:w-5 md:h-5",
                          hasPendingApplicants ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"
                        )} />
                      </div>
                      <div className="min-w-0 flex-1">
                        {isMobile ? (
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-sm truncate">{location.name}</h3>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {hasPendingApplicants && (
                                <Badge variant="destructive" className="rounded-lg text-[10px] px-1.5 py-0 whitespace-nowrap">
                                  {pendingApplicantCount} app{pendingApplicantCount !== 1 ? "s" : ""}
                                </Badge>
                              )}
                              {delayedJobsCount > 0 ? (
                                <Badge variant="outline" className="rounded-lg text-[10px] px-1.5 py-0 whitespace-nowrap border-amber-500/60 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-500/50">
                                  {delayedJobsCount} delayed
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="rounded-lg text-[10px] px-1.5 py-0">{filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""}</Badge>
                              )}
                              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            </div>
                          </div>
                        ) : (
                          <>
                            <h3 className="font-semibold">{location.name}</h3>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {[location.city, location.state, location.zipCode].filter(Boolean).join(", ")}
                            </p>
                          </>
                        )}
                        {isMobile && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {[location.city, location.state, location.zipCode].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    {!isMobile && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {hasPendingApplicants && (
                          <Badge variant="destructive" className="rounded-xl">
                            {pendingApplicantCount} applicant{pendingApplicantCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {delayedJobsCount > 0 ? (
                          <Badge variant="outline" className="rounded-xl border-amber-500/60 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-500/50">
                            {delayedJobsCount} delayed job{delayedJobsCount !== 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-xl">{filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''}</Badge>
                        )}
                        {expandedLocations.includes(location.id) ? (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                  
                  {!isMobile && expandedLocations.includes(location.id) && (
                    <div className="border-t p-4">
                      <JobTimeline
                        jobs={jobsWithApplicantsFirst.map(job => ({
                          ...job,
                          timelineType: job.timelineType as "on-demand" | "one-day" | "recurring"
                        }))}
                        onJobClick={(job) => {
                          const fullJob = filteredJobs.find(j => j.id === job.id);
                          if (fullJob) {
                            setSelectedJobDetails(fullJob);
                            setSelectedJobLocation(location);
                            setShowJobDetailsFullView(true);
                            if (isMobile) {
                              setMobileLocationPopup(null);
                              setMobileJobDrawer(null);
                            }
                          }
                        }}
                        onApplicantsClick={(job, e) => {
                          e.stopPropagation();
                          const fullJob = filteredJobs.find(j => j.id === job.id);
                          if (fullJob) {
                            const pendingApps = fullJob.applications.filter(a => a.status === "pending");
                            if (pendingApps.length > 0) {
                              setSelectedApplication(pendingApps[0]);
                            }
                          }
                        }}
                        onAdjustTimeline={(job, e) => {
                          e.stopPropagation();
                          const fullJob = filteredJobs.find(j => j.id === job.id);
                          if (fullJob) {
                            const todayStr = new Date().toISOString().split('T')[0];
                            const weeks = fullJob.recurringWeeks || 1;
                            const startStr = fullJob.startDate || todayStr;
                            const [y, m, d] = startStr.split("-").map(Number);
                            const endDate = new Date(y, m - 1, d);
                            endDate.setDate(endDate.getDate() + Math.max(0, weeks * 7 - 1));
                            const recurringEndDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
                            setAdjustTimelineData({
                              timelineType: fullJob.timelineType,
                              onDemandDate: fullJob.startDate || todayStr,
                              onDemandStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                              onDemandDoneByDate: fullJob.startDate || "",
                              onDemandBudget: null,
                              oneDayDate: fullJob.startDate || todayStr,
                              oneDayStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                              oneDayEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                              recurringDays: fullJob.recurringDays || [],
                              recurringStartDate: fullJob.startDate || todayStr,
                              recurringEndDate: recurringEndDateStr,
                              recurringStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                              recurringEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                              recurringWeeks: weeks,
                            });
                            setAdjustRescheduleView("type-select");
                            setOnDemandFormStep(1);
                            setOneDayFormStep(1);
                            setRecurringFormStep(1);
                            setAdjustScheduleError(null);
                            setShowAdjustTimelineDialog(fullJob);
                          }
                        }}
                        formatRate={formatRateWithMarkup}
                        isMobile={isMobile}
                        renderActions={(job) => {
                          const fullJob = filteredJobs.find(j => j.id === job.id);
                          if (!fullJob) return null;
                          const isJobFilled = job.workersHired >= job.maxWorkersNeeded;
                          const showAlertButton =
                            !isJobFilled && job.status === "open" && !isWorkerAlertCooldownActive(fullJob.lastWorkerAlertAt);
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-job-menu-${job.id}`}>
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {showAlertButton && (
                                  <DropdownMenuItem 
                                    onClick={async () => {
                                      try {
                                        const response = await fetch(`/api/jobs/${job.id}/send-alert`, {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          credentials: "include",
                                        });

                                        const data = await response.json().catch(() => ({}));
                                        if (!response.ok) {
                                          throw new Error(data.message || "Failed to send alert");
                                        }

                                        if (data.lastWorkerAlertAt) {
                                          updateJob(job.id, { lastWorkerAlertAt: data.lastWorkerAlertAt });
                                        }
                                        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                                        toast({
                                          title: "Alert Sent",
                                          description: `Matching workers have been notified${data.emailsSent ? ` (${data.emailsSent} emails sent)` : ""}.`,
                                        });
                                      } catch (error: any) {
                                        console.error("Error sending alert:", error);
                                        toast({
                                          title: "Error",
                                          description: error.message || "Failed to send alert to workers",
                                          variant: "destructive",
                                        });
                                      }
                                    }}
                                    data-testid={`menu-send-alert-${job.id}`}
                                  >
                                    <Bell className="w-4 h-4 mr-2" /> Send Alert to Workers
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem 
                                  onClick={() => {
                                    setEditJobData({
                                      title: fullJob.title,
                                      description: fullJob.description,
                                      locationId: fullJob.locationId.toString(),
                                      images: fullJob.images || [],
                                      videos: fullJob.videos || [],
                                    });
                                    setShowEditJobDialog(fullJob);
                                  }}
                                  data-testid={`menu-edit-job-${job.id}`}
                                >
                                  <Edit className="w-4 h-4 mr-2" /> Edit Job
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => {
                                    setWorkersCount(fullJob.maxWorkersNeeded);
                                    setShowIncreaseWorkersDialog(fullJob);
                                  }}
                                  data-testid={`menu-increase-workers-${job.id}`}
                                >
                                  <UserPlus className="w-4 h-4 mr-2" /> Adjust Workers
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => {
                                    const todayStr = new Date().toISOString().split('T')[0];
                                    const weeks = fullJob.recurringWeeks || 1;
                                    const startStr = fullJob.startDate || todayStr;
                                    const [y, m, d] = startStr.split("-").map(Number);
                                    const endDate = new Date(y, m - 1, d);
                                    endDate.setDate(endDate.getDate() + Math.max(0, weeks * 7 - 1));
                                    const recurringEndDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
                                    setAdjustTimelineData({
                                      timelineType: fullJob.timelineType,
                                      onDemandDate: fullJob.startDate || todayStr,
                                      onDemandStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                                      onDemandDoneByDate: fullJob.startDate || "",
                                      onDemandBudget: null,
                                      oneDayDate: fullJob.startDate || todayStr,
                                      oneDayStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                                      oneDayEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                                      recurringDays: fullJob.recurringDays || [],
                                      recurringStartDate: fullJob.startDate || todayStr,
                                      recurringEndDate: recurringEndDateStr,
                                      recurringStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                                      recurringEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                                      recurringWeeks: weeks,
                                    });
                                    setAdjustRescheduleView("type-select");
                                    setOnDemandFormStep(1);
                                    setOneDayFormStep(1);
                                    setRecurringFormStep(1);
                                    setAdjustScheduleError(null);
                                    setShowAdjustTimelineDialog(fullJob);
                                  }}
                                  data-testid={`menu-adjust-timeline-${job.id}`}
                                >
                                  <Calendar className="w-4 h-4 mr-2" /> Adjust Timeline
                                </DropdownMenuItem>
                                {(() => {
                                  const isJobFilled = fullJob.workersHired >= fullJob.maxWorkersNeeded;
                                  const jobPendingTimesheets = normalizedTimesheets.filter(t => t.jobId === fullJob.id && t.status === "pending");
                                  const hasPendingTimesheets = jobPendingTimesheets.length > 0;
                                  const canComplete = isJobFilled && !hasPendingTimesheets;
                                  
                                  if (!canComplete) return null;
                                  
                                  return (
                                    <DropdownMenuItem 
                                      onClick={() => handleCompleteJobClick(fullJob.id, fullJob.title)}
                                      data-testid={`menu-complete-job-${job.id}`}
                                    >
                                      <Check className="w-4 h-4 mr-2" /> Mark as Complete
                                    </DropdownMenuItem>
                                  );
                                })()}
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => setShowRemoveJobDialog(fullJob)}
                                  data-testid={`menu-remove-job-${job.id}`}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> {t("dashboard.removeJob")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              );
              })}
            </div>
            )}
          </TabsContent>

          <TabsContent value="team" className="w-full max-w-full flex flex-col items-stretch pt-0 space-y-6 mt-0">
            {teamByLocation.filter((l: any) => l.id != null).length === 0 ? (
              <div className="w-full bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{t("dashboard.noTeamMembers")}</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">{t("dashboard.noTeamMembersDesc")}</p>
                <p className="text-sm text-muted-foreground mt-2">Add locations in Settings → Locations to build your team per location.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {teamByLocation.filter((loc: any) => loc.id != null).map((loc: any) => (
                  <div
                    key={loc.id}
                    className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden"
                    data-testid={`location-team-container-${loc.id}`}
                  >
                    {/* Location header */}
                    <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border/60 bg-muted/20">
                      <MapPin className="w-5 h-5 text-muted-foreground shrink-0" />
                      <h3 className="font-semibold text-lg">{loc.name}</h3>
                      {loc.address && (
                        <span className="text-sm text-muted-foreground truncate">— {[loc.address, loc.city, loc.state].filter(Boolean).join(", ")}</span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto shrink-0 rounded-xl"
                        onClick={() => {
                          setInviteData(prev => ({ ...prev, locationIds: [String(loc.id)] }));
                          setInviteWizardStep(1);
                          setShowAddTeammateFromLocation(true);
                        }}
                        data-testid={`button-add-teammate-location-${loc.id}`}
                      >
                        <UserPlus className="w-4 h-4 mr-1" /> {t("company.team.addEmployeeToManageLocation", "Add Employee to manage this location")}
                      </Button>
                    </div>
                    <div className="p-4 space-y-6">
                      {/* Company team assigned to this location */}
                      {loc.companyTeamMembers?.length > 0 ? (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">{t("company.team.companyTeam", "Company team")}</h4>
                          <div className="flex flex-wrap gap-2">
                            {loc.companyTeamMembers.map((m: any) => (
                              <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/60 bg-background text-sm">
                                <Avatar className="w-8 h-8">
                                  <AvatarImage src={m.avatarUrl} />
                                  <AvatarFallback className="text-xs">{(m.firstName?.[0] || "") + (m.lastName?.[0] || "")}</AvatarFallback>
                                </Avatar>
                                <span>{m.firstName} {m.lastName}</span>
                                {m.role && <Badge variant="secondary" className="text-xs">{m.role}</Badge>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {/* Workers on this location's team */}
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">{t("company.team.workersOnLocation", "Workers on this location's team")}</h4>
                        {loc.savedWorkers?.length === 0 ? (
                          <div className="py-6 text-center flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30">
                            <Users className="w-7 h-7 text-muted-foreground" />
                            <p className="text-sm font-medium">No workers on this team yet</p>
                            <p className="text-xs text-muted-foreground max-w-xs">Workers you&apos;ve hired will appear in &ldquo;Workers You&apos;ve Worked With&rdquo; below — add them here to build your team.</p>
                          </div>
                        ) : (
                    <div className="w-full grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(loc.savedWorkers || []).map((member: any) => (
                  <div 
                    key={member.id} 
                    className="group bg-card rounded-2xl border border-border/60 shadow-sm hover:shadow-lg hover:border-border transition-all duration-300 ease-out overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="w-12 h-12 ring-2 ring-border/40">
                          <AvatarImage src={member.worker?.avatarUrl} />
                          <AvatarFallback className="bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900 dark:to-pink-900 text-purple-700 dark:text-purple-300">
                            {member.worker?.firstName?.[0] || "?"}{member.worker?.lastName?.[0] || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{member.worker?.firstName} {member.worker?.lastName}</span>
                              {member.isFavorite && (
                                <div className="w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center">
                                  <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                                </div>
                              )}
                            </div>
                            {/* 3-dot menu */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-team-menu-${member.id}`}>
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => updateSavedTeamMember.mutate({ id: member.id, updates: { isFavorite: !member.isFavorite } })}
                                >
                                  <Star className={`w-4 h-4 mr-2 ${member.isFavorite ? "fill-yellow-500 text-yellow-500" : ""}`} />
                                  {member.isFavorite ? t("dashboard.removeFavorite") : t("dashboard.addToFavorites")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setReportWorkerModal({ 
                                    workerId: member.worker?.id, 
                                    workerName: `${member.worker?.firstName} ${member.worker?.lastName}` 
                                  })}
                                  className="text-destructive"
                                >
                                  <Flag className="w-4 h-4 mr-2" /> {t("dashboard.reportWorker")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => removeFromSavedTeam.mutate(member.id)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> {t("dashboard.removeFromTeam")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                            <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" />
                            <span className="font-medium">{member.worker?.averageRating || "N/A"}</span>
                            <span className="text-muted-foreground/60">•</span>
                            <span>{member.worker?.completedJobs || 0} jobs</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(member.worker?.trades || []).slice(0, 2).map((trade: string) => (
                              <Badge key={trade} variant="secondary" className="text-xs rounded-lg">{trade}</Badge>
                            ))}
                          </div>
                          {member.notes && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2 italic">"{member.notes}"</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 p-3 pt-0 items-center">
                      <RequestScreeningMenu
                        variant="compact"
                        prefilledEmail={String(member.worker?.email || (member.worker as any)?.user_email || "").trim()}
                        prefilledState={String(loc.state || "").trim().slice(0, 2).toUpperCase()}
                        workerName={`${member.worker?.firstName} ${member.worker?.lastName}`}
                      />
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1 rounded-xl" 
                        onClick={() => {
                          // Open worker details pop-up (no route /worker/:id)
                          if (member.worker) {
                            const w = member.worker as any;
                            setShowWorkerProfileContext({
                              worker: {
                                id: w.id,
                                firstName: w.firstName ?? w.first_name ?? "",
                                lastName: w.lastName ?? w.last_name ?? "",
                                avatarUrl: w.avatarUrl ?? w.avatar_url ?? "",
                                rating: w.rating ?? w.averageRating ?? w.average_rating ?? 0,
                                completedJobs: w.completedJobs ?? w.completed_jobs ?? 0,
                                hourlyRate: w.hourlyRate ?? w.hourly_rate ?? 0,
                                bio: w.bio ?? "",
                                skills: Array.isArray(w.skills) ? w.skills : (w.trades ?? []),
                                portfolioImages: w.portfolioImages ?? w.portfolio_images ?? [],
                                phone: w.phone,
                              },
                            });
                          }
                        }}
                        data-testid={`button-view-profile-${member.id}`}
                      >
                        <Eye className="w-3 h-3 mr-1" /> {t("dashboard.profile")}
                      </Button>
                      <Button 
                        size="sm" 
                        className="flex-1 rounded-xl" 
                        onClick={() => {
                          const params = new URLSearchParams({
                            directRequest: "true",
                            workerId: member.worker?.id.toString(),
                            workerName: `${member.worker?.firstName} ${member.worker?.lastName}`,
                            workerRate: (member.worker?.hourlyRate || 25).toString(),
                          });
                          setLocation(`/post-job?${params.toString()}`);
                        }} 
                        data-testid={`button-request-${member.id}`}
                      >
                        <Send className="w-3 h-3 mr-1" /> {t("dashboard.request")}
                      </Button>
                    </div>
                  </div>
                ))}
                    </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Potential Team Members - add to a location */}
            {potentialTeamMembers.length > 0 && (
              <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover-elevate"
                  onClick={() => setShowPotentialTeamPanel(!showPotentialTeamPanel)}
                  data-testid="button-toggle-potential-team"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                      <UserPlus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Workers You&apos;ve Worked With</h3>
                      <p className="text-sm text-muted-foreground">{potentialTeamMembers.length} workers — add to team (they&apos;ll be added to the location they worked at)</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    {showPotentialTeamPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>
                
                {showPotentialTeamPanel && (
                  <div className="border-t divide-y" onClick={(e) => e.stopPropagation()}>
                    {potentialTeamMembers.map((item: any) => {
                      const worker = item.worker ?? item;
                      const firstName = worker.firstName || worker.first_name || "";
                      const lastName = worker.lastName || worker.last_name || "";
                      const avatarUrl = worker.avatarUrl || worker.avatar_url;
                      const averageRating = worker.averageRating || worker.average_rating;
                      const trades = worker.trades || [];
                      const companyLocationId = item.companyLocationId ?? null;
                      return (
                        <div key={worker.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={avatarUrl} />
                              <AvatarFallback className="bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900 dark:to-indigo-900">
                                {firstName[0] || "?"}{lastName[0] || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{firstName} {lastName}</span>
                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" />
                                  <span>{averageRating || "N/A"}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {trades.slice(0, 3).map((trade: string) => (
                                  <Badge key={trade} variant="secondary" className="text-xs">{trade}</Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <RequestScreeningMenu
                              variant="compact"
                              prefilledEmail={String((worker as any).email || "").trim()}
                              workerName={`${firstName} ${lastName}`}
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setReportWorkerModal({ 
                                    workerId: worker.id, 
                                    workerName: `${firstName} ${lastName}` 
                                  })}
                                  className="text-destructive"
                                >
                                  <Flag className="w-4 h-4 mr-2" /> Report Worker
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); addToSavedTeam.mutate({ workerId: worker.id, worker, locationId: companyLocationId ?? undefined }); }}
                              disabled={addToSavedTeam.isPending}
                              data-testid={`button-add-to-team-${worker.id}`}
                            >
                              <Plus className="w-3 h-3 mr-1" /> Add to Team
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="timesheets" className="w-full max-w-full flex flex-col items-stretch pt-0 space-y-0 mt-0 overflow-hidden px-4 sm:px-[23px]">
            {timesheetsLoading && (
              <div className="space-y-4 pt-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-card rounded-xl border border-border/60 shadow-sm p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                      <Skeleton className="h-8 w-24 rounded-lg" />
                      <Skeleton className="h-8 w-8 rounded-lg" />
                    </div>
                    <div className="flex gap-4 pl-13">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!timesheetsLoading && <Tabs value={timesheetTab} onValueChange={(v) => setTimesheetTab(v as "pending" | "approved" | "rejected")} className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
              <div className="sticky top-0 z-10 flex-shrink-0 w-full py-3 flex justify-center sm:justify-start bg-secondary/20 backdrop-blur-sm border-b border-border/60 mb-4">
                <TabsList withScrollControls className="w-full sm:w-fit max-w-full justify-center sm:justify-start">
                  <TabsTrigger value="pending" className="flex-shrink-0 gap-2" data-testid="timesheet-tab-pending">
                    Pending
                    {pendingTimesheets.length > 0 && (
                      <Badge className="bg-orange-500 text-white text-xs">{pendingTimesheets.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="approved" className="flex-shrink-0" data-testid="timesheet-tab-approved">
                    Approved
                  </TabsTrigger>
                  <TabsTrigger value="rejected" className="flex-shrink-0 gap-2" data-testid="timesheet-tab-rejected">
                    Rejected
                    {rejectedTimesheets.length > 0 && (
                      <Badge variant="destructive" className="text-xs">{rejectedTimesheets.length}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>
              
              <TabsContent value="pending" className="w-full space-y-4 mt-0 flex-1 overflow-y-auto">
                {pendingLaborPayTotalCents > 0 && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      projectedBalanceAfterAllPending < 0
                        ? "border-destructive/50 bg-destructive/5"
                        : "border-border bg-muted/30"
                    }`}
                    data-testid="pending-labor-balance-hint"
                  >
                    <p className="text-foreground">
                      {t("dashboard.pendingLaborBalanceHint", {
                        labor: `$${(pendingLaborPayTotalCents / 100).toFixed(2)}`,
                        balance: `$${(companyBalanceCentsForPreview / 100).toFixed(2)}`,
                        after: `$${(projectedBalanceAfterAllPending / 100).toFixed(2)}`,
                      })}
                    </p>
                    {projectedBalanceAfterAllPending < 0 && (
                      <p className="text-destructive text-xs mt-1 font-medium">
                        {t("dashboard.pendingLaborInsufficient")}
                      </p>
                    )}
                  </div>
                )}
                {pendingTimesheets.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">All caught up!</h3>
                    <p className="text-muted-foreground max-w-sm mx-auto mb-4">
                      No pending timesheets to review. New entries appear here when workers clock out.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("jobs")}>
                      View active jobs
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {pendingTimesheetRealIds.length > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
                        <p className="text-sm text-muted-foreground max-w-xl">
                          <span className="font-medium text-foreground">Approve everything:</span> each job card&apos;s{" "}
                          <span className="whitespace-nowrap">Approve for this job</span> only affects that job. Use this
                          button to approve all {pendingTimesheetRealIds.length} pending timesheets in one go (may fail
                          individually if balance is low or a timesheet is disputed).
                        </p>
                        <Button
                          size="sm"
                          className="shrink-0 bg-green-600 hover:bg-green-700 text-white"
                          disabled={bulkApproveTimesheets.isPending || pendingTimesheetRealIds.length === 0}
                          title="Approve every pending timesheet across all jobs"
                          onClick={() => {
                            setPendingApproveAllJobId(-1);
                            bulkApproveTimesheets.mutate(
                              { timesheetIds: pendingTimesheetRealIds },
                              {
                                onSuccess: (res) => {
                                  if (res.approved > 0) {
                                    toast({
                                      title: "Timesheets approved",
                                      description:
                                        res.escrowCount > 0
                                          ? `${res.approved} approved. ${res.escrowCount} payment(s) held until worker adds bank.`
                                          : `${res.approved} timesheet(s) approved.`,
                                    });
                                  }
                                  if (res.failed > 0) {
                                    const hints = res.results
                                      .filter((r) => !r.success)
                                      .slice(0, 4)
                                      .map((r) => r.error || `Timesheet #${r.id}`)
                                      .join(" · ");
                                    toast({
                                      title: `${res.failed} could not be approved`,
                                      description: hints || "Check company balance or dispute status.",
                                      variant: "destructive",
                                    });
                                  }
                                },
                                onSettled: () => setPendingApproveAllJobId(null),
                              }
                            );
                          }}
                          data-testid="button-approve-all-pending-global"
                        >
                          {bulkApproveTimesheets.isPending && pendingApproveAllJobId === -1 ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : (
                            <Check className="w-3.5 h-3.5 mr-1" />
                          )}
                          Approve all pending ({pendingTimesheetRealIds.length})
                        </Button>
                      </div>
                    )}
                    {pendingTimesheetGroups
                      .filter(g => g.timesheets.length > 0)
                      .filter((g, i, arr) => arr.findIndex(x => x.jobId === g.jobId) === i)
                      .map((group) => {
                        const jobIdsForGroup = group.timesheets.map(t => t.id);
                        const realIdsForGroup = jobIdsForGroup.filter(id => id > 0);
                        return (
                      <div key={group.jobId} className="bg-card rounded-xl border border-border/60 shadow-sm overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b border-border/60">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <h3
                              className="font-semibold text-base truncate cursor-pointer hover:text-primary hover:underline"
                              onClick={() => {
                                const job = findJobById(group.jobId);
                                const location = jobsData.find(loc => loc.jobs.some(j => j.id === group.jobId));
                                if (job && location) {
                                  setSelectedJobDetails(job);
                                  setSelectedJobLocation(location);
                                  setShowJobDetailsFullView(true);
                                }
                              }}
                              title="View job details"
                            >
                              {group.jobTitle}
                            </h3>
                            {"earliestAutoApprovalMs" in group && group.timesheets.length > 0 && (
                              <Badge variant={getCountdownVariant((group as { earliestAutoApprovalMs: number }).earliestAutoApprovalMs)} className="shrink-0 text-xs font-normal">
                                {formatResponseDeadline((group as { earliestAutoApprovalMs: number }).earliestAutoApprovalMs)}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {group.timesheets.length} pending · {group.totalHours.toFixed(1)}h · ${(group.totalSpent / 100).toFixed(2)}
                            </span>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              title="Only approves pending timesheets for this job — not other jobs below"
                              onClick={() => {
                                if (realIdsForGroup.length === 0) {
                                  toast({ title: "No timesheets to approve", description: "These are sample timesheets. Use worker clock-in to create real timesheets.", variant: "destructive" });
                                  return;
                                }
                                setPendingApproveAllJobId(group.jobId);
                                bulkApproveTimesheets.mutate(
                                  { timesheetIds: realIdsForGroup },
                                  {
                                    onSuccess: (res) => {
                                      if (res.approved > 0) {
                                        toast({ title: "Timesheets approved", description: res.escrowCount > 0 ? `${res.approved} approved. ${res.escrowCount} payment(s) held until worker adds bank.` : `${res.approved} timesheet(s) approved.` });
                                      }
                                      if (res.failed > 0) {
                                        const hints = res.results
                                          .filter((r) => !r.success)
                                          .slice(0, 3)
                                          .map((r) => r.error || `#${r.id}`)
                                          .join(" · ");
                                        toast({
                                          title: "Some approvals failed",
                                          description: hints || `${res.failed} could not be approved.`,
                                          variant: "destructive",
                                        });
                                      }
                                    },
                                    onSettled: () => setPendingApproveAllJobId(null),
                                  }
                                );
                              }}
                              disabled={bulkApproveTimesheets.isPending || realIdsForGroup.length === 0}
                              data-testid={`button-approve-all-pending-${group.jobId}`}
                            >
                              {bulkApproveTimesheets.isPending && pendingApproveAllJobId === group.jobId ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                              Approve for this job
                            </Button>
                          </div>
                        </div>
                        <div className="divide-y divide-border/50">
                          {group.timesheets.map((timesheet) => (
                            <div key={timesheet.id} className="px-4 py-3 hover:bg-muted/10 transition-colors">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Avatar className="h-8 w-8 shrink-0 ring-1 ring-orange-200 dark:ring-orange-800">
                                    <AvatarImage src={timesheet.workerAvatarUrl} />
                                    <AvatarFallback className="text-xs bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300">
                                      {timesheet.workerInitials || timesheet.workerName?.slice(0, 2) || "—"}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{timesheet.workerName}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {format(timesheet.clockInTime, "MMM d, yyyy")} · {format(timesheet.clockInTime, "h:mm a")}
                                      {timesheet.clockOutTime ? ` – ${format(timesheet.clockOutTime, "h:mm a")}` : ""}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 ml-auto">
                                  <span className="text-sm font-medium tabular-nums">{timesheet.adjustedHours.toFixed(1)}h</span>
                                  <span className="text-sm font-semibold tabular-nums">${(Math.round(timesheet.adjustedHours * timesheet.hourlyRate * 1.52) / 100).toFixed(2)}</span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                                    onClick={() => handleApproveTimesheetDisplay(timesheet)}
                                    disabled={approveTimesheet.isPending}
                                    title="Approve"
                                    data-testid={`button-approve-pending-ts-${timesheet.id}`}
                                  >
                                    {approveTimesheet.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-pending-actions-${timesheet.id}`} aria-label="Timesheet actions">
                                        <MoreVertical className="w-4 h-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setEditTimesheetModal(timesheet);
                                          setEditHours(timesheet.adjustedHours.toString());
                                          setEditExplanation("");
                                          setEditTimesheetStep("form");
                                        }}
                                        data-testid={`button-edit-pending-${timesheet.id}`}
                                      >
                                        <Edit className="w-4 h-4 mr-2" />
                                        Edit Hours
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleRejectTimesheetDisplay(timesheet)}
                                        className="text-destructive focus:text-destructive"
                                        data-testid={`button-reject-pending-ts-${timesheet.id}`}
                                      >
                                        <X className="w-4 h-4 mr-2" />
                                        Reject
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                              {timesheet.workerNotes && (
                                <p className="mt-2 pl-10 text-xs text-muted-foreground italic">"{timesheet.workerNotes}"</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                      })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="approved" className="w-full space-y-4 mt-0 flex-1 overflow-y-auto">
                {approvedTimesheets.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-900/50 flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">No approved timesheets</h3>
                    <p className="text-muted-foreground max-w-sm mx-auto">Approved timesheets will appear here.</p>
                  </div>
                ) : (
                  <div className="bg-card rounded-xl border border-border/60 shadow-sm overflow-hidden">
                    {/* Table Header */}
                    <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-2 bg-muted/30 text-xs font-medium text-muted-foreground border-b">
                      <div className="col-span-3">Worker</div>
                      <div className="col-span-3">Job</div>
                      <div className="col-span-2">Date</div>
                      <div className="col-span-1 text-right">Hours</div>
                      <div className="col-span-2 text-right">Amount</div>
                      <div className="col-span-1 text-right">Status</div>
                    </div>
                    
                    {/* Table Rows */}
                    <div className="divide-y divide-border/50">
                      {approvedTimesheets.map(timesheet => (
                        <div key={timesheet.id}>
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 px-3 py-2 items-center hover:bg-muted/20 transition-colors">
                            {/* Worker */}
                            <div className="col-span-3 flex items-center gap-2">
                              <Avatar className="h-7 w-7 ring-1 ring-green-200 dark:ring-green-800">
                                <AvatarImage src={timesheet.workerAvatarUrl} />
                                <AvatarFallback className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                                  {timesheet.workerInitials}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium truncate">{timesheet.workerName}</span>
                            </div>
                            
                            {/* Job */}
                            <div className="col-span-3 text-sm text-muted-foreground truncate">
                              {timesheet.jobTitle}
                            </div>
                            
                            {/* Date */}
                            <div className="col-span-2 text-sm text-muted-foreground">
                              {format(timesheet.clockInTime, 'MMM d, yyyy')}
                            </div>
                            
                            {/* Hours */}
                            <div className="col-span-1 text-right text-sm font-medium">
                              {timesheet.adjustedHours.toFixed(1)}h
                            </div>
                            
                            {/* Amount */}
                            <div className="col-span-2 text-right text-sm font-semibold">
                              ${(Math.round(timesheet.adjustedHours * timesheet.hourlyRate * 1.52) / 100).toFixed(2)}
                            </div>
                            
                            {/* Status */}
                            <div className="col-span-1 text-right">
                              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-[10px] px-1.5 py-0">
                                <Check className="w-2.5 h-2.5 mr-0.5" /> Paid
                              </Badge>
                            </div>
                          </div>
                          
                          {/* Worker Notes Row */}
                          {timesheet.workerNotes && (
                            <div className="px-3 py-1 bg-muted/20 border-t text-xs text-muted-foreground italic">
                              "{timesheet.workerNotes}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    
                    {/* Table Footer with Totals */}
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/30 border-t text-sm font-medium">
                      <div className="col-span-8 text-muted-foreground">Total ({approvedTimesheets.length} timesheets)</div>
                      <div className="col-span-1 text-right">
                        {approvedTimesheets.reduce((sum, t) => sum + t.adjustedHours, 0).toFixed(1)}h
                      </div>
                      <div className="col-span-2 text-right">
                        ${(approvedTimesheets.reduce((sum, t) => sum + Math.round(t.adjustedHours * t.hourlyRate * 1.52), 0) / 100).toFixed(2)}
                      </div>
                      <div className="col-span-1"></div>
                    </div>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="rejected" className="w-full space-y-4 mt-0 flex-1 overflow-y-auto">
                {rejectedTimesheets.length === 0 ? (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                      <X className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">No rejected timesheets</h3>
                    <p className="text-muted-foreground max-w-sm mx-auto">Rejected timesheets will appear here for review.</p>
                  </div>
                ) : (
                  <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/50 border-b text-xs font-medium text-muted-foreground">
                      <div className="col-span-4">Worker & Job</div>
                      <div className="col-span-2">Date</div>
                      <div className="col-span-2">Hours</div>
                      <div className="col-span-3">Rejection Reason</div>
                      <div className="col-span-1 text-right">Actions</div>
                    </div>
                    
                    {/* Table Rows */}
                    <div className="divide-y">
                      {rejectedTimesheets.map(timesheet => (
                        <div key={timesheet.id} className="grid grid-cols-12 gap-2 px-3 py-3 items-center text-sm hover-elevate">
                          <div className="col-span-4 flex items-center gap-2">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={normalizeAvatarUrl(timesheet.workerAvatarUrl) ?? undefined} />
                              <AvatarFallback>{timesheet.workerName[0]}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{timesheet.workerName}</div>
                              <div className="text-xs text-muted-foreground truncate">{timesheet.jobTitle}</div>
                            </div>
                          </div>
                          <div className="col-span-2 text-muted-foreground">
                            {format(timesheet.clockInTime, "MMM d")}
                          </div>
                          <div className="col-span-2">
                            <div className="font-medium">{timesheet.adjustedHours.toFixed(1)}h</div>
                            <div className="text-xs text-muted-foreground">${(timesheet.hourlyRate / 100).toFixed(0)}/hr</div>
                          </div>
                          <div className="col-span-3">
                            <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1 truncate" title={timesheet.rejectionReason || 'No reason provided'}>
                              {timesheet.rejectionReason || 'No reason provided'}
                            </div>
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-rejected-actions-${timesheet.id}`}>
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem 
                                  onClick={() => {
                                    setEditHours(timesheet.adjustedHours.toString());
                                    setEditExplanation("");
                                    setEditTimesheetStep("form");
                                    setTimeout(() => setEditTimesheetModal(timesheet), 0);
                                  }}
                                  data-testid={`button-edit-rejected-${timesheet.id}`}
                                >
                                  <Edit className="w-4 h-4 mr-2" />
                                  Edit Hours
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleApproveTimesheetDisplay(timesheet)}
                                  className="text-green-600"
                                  data-testid={`button-approve-rejected-${timesheet.id}`}
                                >
                                  <Check className="w-4 h-4 mr-2" />
                                  Approve
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Table Footer with Totals */}
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/30 border-t text-sm font-medium">
                      <div className="col-span-6 text-muted-foreground">Total ({rejectedTimesheets.length} timesheets)</div>
                      <div className="col-span-2">
                        {rejectedTimesheets.reduce((sum, t) => sum + t.adjustedHours, 0).toFixed(1)}h
                      </div>
                      <div className="col-span-4"></div>
                    </div>
                  </div>
                )}
              </TabsContent>
              </Tabs>}
          </TabsContent>

          {activeTab === "chats" && (
            <TabsContent value="chats" className="w-full max-w-full flex flex-col flex-1 min-h-0 overflow-hidden pt-0 mt-0 data-[state=inactive]:!hidden data-[state=inactive]:!min-h-0 data-[state=inactive]:!overflow-hidden">
              <ChatsPage embedInDashboard />
            </TabsContent>
          )}

          {activeTab === "menu" && (
          <TabsContent value="menu" className={isMobile ? "space-y-0" : "flex min-h-0 flex-1 overflow-hidden"}>
            {isMobile ? (
              <>
                <header className="flex items-center gap-3 px-4 py-3 border-b border-border -mx-4 sm:mx-0 mb-4 bg-background/95 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => navigate("/company-dashboard")}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-foreground flex-shrink-0"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h1 className="text-lg font-bold truncate">{t("settings.accountSettingsTitle")}</h1>
                </header>
                <div className="grid grid-cols-1 gap-3 mb-6">
                  <button onClick={() => navigate("/company-dashboard/menu/profile")} className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border shadow-sm hover:bg-muted/30 transition-colors text-left" data-testid="menu-company-profile">
                    <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 border border-border/50">
                      {companyLogoUrl ? (
                        <img src={companyLogoUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Building2 className="w-7 h-7 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm text-muted-foreground">{t("settings.companyProfile")}</p>
                      <p className="font-semibold truncate">{profile?.companyName || "Your Company"}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => navigate("/company-dashboard/menu/team-access")} className="flex flex-col gap-1 p-4 rounded-xl bg-card border border-border shadow-sm hover:bg-muted/30 transition-colors text-left" data-testid="menu-team-members">
                      <Users className="w-6 h-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t("settings.teamAccess")}</p>
                      <p className="text-lg font-semibold">{t("businessOperator.teamMemberCount", { count: teamMembers.length })}</p>
                    </button>
                    <button onClick={() => navigate("/company-dashboard/menu/locations")} className="flex flex-col gap-1 p-4 rounded-xl bg-card border border-border shadow-sm hover:bg-muted/30 transition-colors text-left" data-testid="menu-locations">
                      <MapPinned className="w-6 h-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t("settings.locations")}</p>
                      <p className="text-lg font-semibold">{t("company.locations.locationCount", { count: companyLocations.length })}</p>
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <button onClick={() => navigate("/company-dashboard/menu/payment-methods")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-payment-methods">
                    <CreditCard className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.paymentMethods")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => navigate("/company-dashboard/menu/notifications")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-notifications">
                    <Bell className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.notifications")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => navigate("/company-dashboard/menu/hiring-preferences")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-hiring-preferences">
                    <Briefcase className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.hiringPreferences")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => navigate("/company-dashboard/menu/billing")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-billing-history">
                    <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.billingHistory")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => navigate("/company-dashboard/menu/agreements")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-agreements">
                    <FileCheck className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.agreements")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => navigate("/company-dashboard/menu/help")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-help">
                    <HelpCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.help")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => isMobile ? navigate("/company-dashboard/menu/language") : (setMenuSelection("language"), navigate("/company-dashboard/menu/language"))} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-language">
                    <Globe className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.language")}</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMenuSignOutConfirm(true)}
                    className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-destructive/10 transition-colors text-left text-destructive"
                    data-testid="menu-logout"
                  >
                    <LogOut className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium flex-1">{t("settings.signOut")}</span>
                  </button>
                </div>
                <div className="border-t border-border my-5" />
                <div className="space-y-1">
                  <button onClick={() => setLocation("/company/compliance")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-compliance">
                    <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Compliance &amp; reports</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                  <button onClick={() => setLocation("/company/webhooks")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-webhooks">
                    <Webhook className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium flex-1">Webhooks</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                </div>
                {isAdmin && (
                  <>
                    <div className="border-t border-border my-5" />
                    <div className="space-y-1">
                      <button onClick={() => setLocation("/admin")} className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-admin-tools">
                        <Shield className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <span className="font-medium flex-1">{t("settings.adminTools")}</span>
                        <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      </button>
                    </div>
                  </>
                )}
                <div className="border-t border-border my-5" />
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={profile?.avatarUrl ?? undefined} alt="" />
                    <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                      {profile?.companyName?.[0] || profile?.firstName?.[0] || user?.firstName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{profile?.companyName || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || user?.email || "Account"}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Account options">
                        <MoreVertical className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top" className="min-w-[160px]">
                      <DropdownMenuItem onClick={() => { setShowMenuSignOutConfirm(true); }} className="text-destructive focus:text-destructive" data-testid="button-logout">
                        <LogOut className="w-4 h-4 mr-2" />
                        {t("settings.signOut")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : (
              <>
                <aside className="w-72 flex-shrink-0 flex flex-col h-screen border-r border-border bg-card shadow-sm min-w-0">
                  <div className="flex-1 min-h-0 overflow-y-auto py-5 px-3">
                    <h2 className="text-lg font-semibold px-3 mb-4 text-foreground">{t("settings.accountSettingsTitle")}</h2>
                    {isAdmin ? (
                      <Accordion type="single" collapsible value={menuSelection} onValueChange={(v) => v && setMenuSelection(v as CompanyMenuSelection)} className="border-0">
                        {(["profile", "locations", "payment-methods", "team-access", "notifications", "hiring-preferences", "billing", "agreements"] as CompanyMenuSelection[]).map((key) => {
                          const label = key === "profile" ? t("settings.companyProfile") : key === "locations" ? t("settings.locations") : key === "payment-methods" ? t("settings.paymentMethods") : key === "team-access" ? t("settings.teamAccess") : key === "notifications" ? t("settings.notifications") : key === "hiring-preferences" ? t("settings.hiringPreferences") : key === "billing" ? t("settings.billingHistory") : t("settings.agreements");
                          const Icon = key === "profile" ? Building : key === "locations" ? MapPinned : key === "payment-methods" ? CreditCard : key === "team-access" ? Users : key === "notifications" ? Bell : key === "hiring-preferences" ? Briefcase : key === "billing" ? FileText : FileCheck;
                          const testId = key === "profile" ? "menu-company-profile" : key === "locations" ? "menu-locations" : key === "payment-methods" ? "menu-payment-methods" : key === "team-access" ? "menu-team-members" : key === "billing" ? "menu-billing-history" : `menu-${key}`;
                          return (
                            <AccordionItem key={key} value={key} className="border-0">
                              <AccordionTrigger className="py-3 px-3 rounded-lg hover:bg-muted/50 hover:no-underline [&[data-state=open]]:bg-muted [&[data-state=open]]:font-medium" data-testid={testId}>
                                <div className="flex items-center gap-3 flex-1 text-left">
                                  <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                                  <span>{label}</span>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent className="pb-2 pt-0 px-3">
                                <div className="h-0.5 w-8 rounded-full bg-primary/30" />
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                        <div className="border-t border-border my-3" />
                        <button onClick={() => setLocation("/company/compliance")} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-compliance">
                          <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <span>Compliance &amp; reports</span>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                        </button>
                        <button onClick={() => setLocation("/company/webhooks")} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-webhooks">
                          <Webhook className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <span>Webhooks</span>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                        </button>
                        <button onClick={() => setLocation("/admin")} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-admin-tools">
                          <Shield className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                          <span>{t("settings.adminTools")}</span>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                        </button>
                      </Accordion>
                    ) : (
                      <nav className="space-y-0.5">
                        {(["profile", "locations", "payment-methods", "team-access", "notifications", "hiring-preferences", "billing", "agreements"] as CompanyMenuSelection[]).map((key) => {
                          const label = key === "profile" ? t("settings.companyProfile") : key === "locations" ? t("settings.locations") : key === "payment-methods" ? t("settings.paymentMethods") : key === "team-access" ? t("settings.teamAccess") : key === "notifications" ? t("settings.notifications") : key === "hiring-preferences" ? t("settings.hiringPreferences") : key === "billing" ? t("settings.billingHistory") : t("settings.agreements");
                          const Icon = key === "profile" ? Building : key === "locations" ? MapPinned : key === "payment-methods" ? CreditCard : key === "team-access" ? Users : key === "notifications" ? Bell : key === "hiring-preferences" ? Briefcase : key === "billing" ? FileText : FileCheck;
                          const testId = key === "profile" ? "menu-company-profile" : key === "locations" ? "menu-locations" : key === "payment-methods" ? "menu-payment-methods" : key === "team-access" ? "menu-team-members" : key === "billing" ? "menu-billing-history" : `menu-${key}`;
                          return (
                            <button key={key} onClick={() => setMenuSelection(key)} className={`w-full flex items-center gap-3 py-3 px-3 rounded-lg transition-colors text-left ${menuSelection === key ? "bg-muted font-medium" : "hover:bg-muted/50"}`} data-testid={testId}>
                              <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                              <span>{label}</span>
                              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                            </button>
                          );
                        })}
                      </nav>
                    )}
                    <div className="border-t border-border my-3" />
                    <div className="space-y-0.5">
                      <button onClick={() => setShowHelp(true)} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-help">
                        <HelpCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <span>{t("settings.help")}</span>
                        <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                      </button>
                      <button onClick={() => { setMenuSelection("language"); navigate("/company-dashboard/menu/language"); }} className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left" data-testid="menu-language">
                        <Globe className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <span>{t("settings.language")}</span>
                        <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMenuSignOutConfirm(true)}
                        className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-destructive/10 transition-colors text-left text-destructive"
                        data-testid="menu-logout"
                      >
                        <LogOut className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{t("settings.signOut")}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-shrink-0 border-t border-border bg-muted/30 pb-4">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-background/80 shadow-sm border border-border/50">
                      <Avatar className="h-10 w-10 flex-shrink-0 ring-2 ring-border/50">
                        <AvatarImage src={profile?.avatarUrl ?? undefined} alt="" />
                        <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                          {profile?.companyName?.[0] || profile?.firstName?.[0] || user?.firstName?.[0] || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{profile?.companyName || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || user?.email || "Account"}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" aria-label="Account options">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="top" className="min-w-[160px]">
                          <DropdownMenuItem onClick={() => setShowMenuSignOutConfirm(true)} className="text-destructive focus:text-destructive" data-testid="button-logout">
                            <LogOut className="w-4 h-4 mr-2" />
                            {t("settings.signOut")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </aside>
                <div className="flex-1 min-w-0 w-full h-screen overflow-y-auto py-6 px-6 basis-0">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">
                      {menuSelection === "profile" && t("settings.companyProfile")}
                      {menuSelection === "locations" && t("settings.locations")}
                      {menuSelection === "payment-methods" && t("settings.paymentMethods")}
                      {menuSelection === "team-access" && t("settings.teamAccess")}
                      {menuSelection === "notifications" && t("settings.notifications")}
                      {menuSelection === "hiring-preferences" && t("settings.hiringPreferences")}
                      {menuSelection === "billing" && t("settings.billingHistory")}
                      {menuSelection === "agreements" && t("settings.agreements")}
                      {menuSelection === "language" && t("settings.language")}
                    </h2>
                    {menuSelection === "payment-methods" ? (
                      <button type="button" onClick={() => setShowStripeAddPaymentMethod(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium inline-flex items-center gap-1.5" data-testid="button-payment-methods-new">
                        <Plus className="w-4 h-4" /> {t("settings.addNewPaymentMethodShort", "New")}
                      </button>
                    ) : (
                      <button type="button" onClick={() => navigate("/company-dashboard")} className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium">
                        {t("settings.done")}
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-border">
                    {menuSelection === "profile" && (
                      <CompanyMenuPanelProfileFormView
                        companyProfileForm={companyProfileForm}
                        setCompanyProfileForm={setCompanyProfileForm}
                        profile={profile}
                        user={user}
                        companyLogoUrl={companyLogoUrl}
                        handleLogoUpload={handleLogoUpload}
                        isUploadingLogo={isUploadingLogo}
                        alternateEmails={alternateEmails}
                        setAlternateEmails={setAlternateEmails}
                        newAlternateEmail={newAlternateEmail}
                        setNewAlternateEmail={setNewAlternateEmail}
                        alternatePhones={alternatePhones}
                        setAlternatePhones={setAlternatePhones}
                        newAlternatePhone={newAlternatePhone}
                        setNewAlternatePhone={setNewAlternatePhone}
                        updateProfile={updateProfile}
                        toast={toast}
                        t={t}
                      />
                    )}
                    {menuSelection === "locations" && (
                      <CompanyMenuPanelLocations />
                    )}
                    {menuSelection === "payment-methods" && (
                      <CompanyMenuPanelPaymentMethods />
                    )}
                    {menuSelection === "team-access" && (
                      <CompanyMenuPanelTeamAccess />
                    )}
                    {menuSelection === "notifications" && (
                      <CompanyMenuPanelNotifications />
                    )}
                    {menuSelection === "hiring-preferences" && (
                      <CompanyMenuPanelHiringPreferences />
                    )}
                    {menuSelection === "billing" && (
                      <CompanyMenuPanelBilling />
                    )}
                    {menuSelection === "agreements" && (
                      <CompanyMenuPanelAgreements />
                    )}
                    {menuSelection === "language" && (
                      <CompanyMenuPanelLanguage />
                    )}
                  </div>
                </div>
              </>
            )}
            <ResponsiveDialog open={showLanguageMenu} onOpenChange={(open) => { setShowLanguageMenu(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.language")} description={t("settings.selectLanguage")} contentClassName="max-w-sm" showBackButton onBack={() => { setShowLanguageMenu(false); navigate("/company-dashboard/menu"); }} backLabel="Menu">
                <div className="pt-4 space-y-2">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const currentLang = (i18n.language?.split("-")[0] || "en") as LanguageCode;
                    const isSelected = lang.code === currentLang;
                    return (
                      <button
                        key={lang.code}
                        onClick={async () => {
                          await changeLanguage(lang.code, profile?.id);
                          setShowLanguageMenu(false);
                          navigate("/company-dashboard/menu");
                          window.location.reload();
                        }}
                        className={`w-full flex items-center gap-3 p-4 rounded-xl transition-colors text-left border-2 ${isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50 border-transparent"}`}
                        data-testid={`select-language-${lang.code}`}
                      >
                        <span className="text-2xl">{lang.flag}</span>
                        <div className="flex-1">
                          <p className={`font-medium ${isSelected ? "text-primary" : ""}`}>{lang.nativeName}</p>
                          <p className="text-sm text-muted-foreground">{lang.name}</p>
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
            </ResponsiveDialog>
            <Dialog open={viewingAgreement} onOpenChange={(open) => { if (!open) setViewingAgreement(false); }}>
              <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                  <DialogTitle>{displayedAgreement?.type ?? t("settings.agreement")}</DialogTitle>
                  <DialogDescription>
                    {displayedAgreement && (
                      <>{t("settings.version")} {displayedAgreement.version} · {t("settings.signedBy", { name: displayedAgreement.signedName, date: displayedAgreement.signedAt ? format(new Date(displayedAgreement.signedAt), "MMMM d, yyyy") : "—" })}</>
                    )}
                  </DialogDescription>
                </DialogHeader>
                {displayedAgreement && (
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-4 text-sm" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                    <pre className="whitespace-pre-wrap text-stone-700 dark:text-stone-300 leading-relaxed">
                      {displayedAgreement.text || COMPANY_AGREEMENT_TEXT}
                    </pre>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setViewingAgreement(false)}>{t("settings.close")}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog open={showMenuSignOutConfirm} onOpenChange={setShowMenuSignOutConfirm}>
              <AlertDialogContent className="p-6">
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("settings.signOut")}?</AlertDialogTitle>
                  <AlertDialogDescription>{t("settings.signOutConfirmDesc", "Are you sure you want to sign out?")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setShowMenuSignOutConfirm(false); window.location.href = "/api/logout"; }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {t("settings.signOut")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
          )}
          </div>
          </ErrorBoundary>
        </div>
      </div>

      <ResponsiveDialog
        open={!!selectedApplication}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedApplication(null);
            if (cameFromPendingRequests) {
              setCameFromPendingRequests(false);
              setShowPendingRequests(true);
            }
          }
        }}
        title={t("settings.reviewApplication")}
        description={t("settings.reviewApplicationDesc")}
        contentClassName="max-w-lg"
        showBackButton={!!selectedJobDetails || !!mobileLocationPopup}
        onBack={() => setSelectedApplication(null)}
        backLabel={t("settings.jobDetails")}
        primaryAction={selectedApplication?.status === "pending"
          ? { label: t("settings.hire"), onClick: () => selectedApplication && handleAcceptApplication(selectedApplication, selectedJobDetails ?? undefined), icon: <Check className="w-4 h-4 mr-2" />, testId: "button-accept-application" }
          : selectedApplication?.status === "accepted"
          ? { label: t("settings.addToTeam"), onClick: () => selectedApplication && handleAddToTeam(selectedApplication.worker), icon: <UserPlus className="w-4 h-4 mr-2" />, testId: "button-add-to-team" }
          : undefined}
        secondaryAction={selectedApplication?.status === "pending"
          ? { label: "Skip", onClick: () => selectedApplication && handleRejectApplication(selectedApplication), icon: <X className="w-4 h-4 mr-2" />, testId: "button-reject-application" }
          : undefined}
      >
          {selectedApplication && (
              <>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={selectedApplication.worker.avatarUrl} />
                    <AvatarFallback className="text-xl">{selectedApplication.worker.firstName[0]}{selectedApplication.worker.lastName[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold text-lg">{selectedApplication.worker.firstName} {selectedApplication.worker.lastName}</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                      <span>{selectedApplication.worker.rating}</span>
                      {selectedApplication.worker.identityVerified && (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800"
                          title={tCommon("idVerifiedBadgeTooltip")}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          ID Verified
                        </Badge>
                      )}
                      {selectedApplication.worker.insuranceVerified && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
                          <Shield className="w-3 h-3 mr-1" />
                          Insured
                        </Badge>
                      )}
                      {selectedApplication.worker.w9DocumentUrl && (
                        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800">
                          <FileText className="w-3 h-3 mr-1" />
                          W-9
                        </Badge>
                      )}
                      {selectedApplication.worker.strikeCount === 0 && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Good Standing
                        </Badge>
                      )}
                      {selectedApplication.worker.strikeCount && selectedApplication.worker.strikeCount > 0 && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-300 dark:border-yellow-800">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {selectedApplication.worker.strikeCount} Strike{selectedApplication.worker.strikeCount > 1 ? 's' : ''}
                        </Badge>
                      )}
                      <Button 
                        variant="ghost" 
                        className="h-auto p-0 text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowCompletedProjects(selectedApplication.worker);
                        }}
                        data-testid="link-completed-jobs"
                      >
                        ({selectedApplication.worker.completedJobs} jobs completed)
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 -mt-2">
                  <p className="text-xs text-muted-foreground">
                    Run pre-hire compliance checks (worker signs consent first):
                  </p>
                  <RequestScreeningMenu
                    applicationId={selectedApplication.id}
                    workerName={`${selectedApplication.worker.firstName} ${selectedApplication.worker.lastName}`}
                  />
                </div>

                <div>
                  <Label className="text-muted-foreground">Bio</Label>
                  <p className="text-sm mt-1">{selectedApplication.worker.bio}</p>
                </div>
                
                <div>
                  <Label className="text-muted-foreground">Skills</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {selectedApplication.worker.skills.map(skill => (
                      <Badge key={skill} variant="secondary">{skill}</Badge>
                    ))}
                  </div>
                </div>
                
                {selectedApplication.worker.portfolioImages && selectedApplication.worker.portfolioImages.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Prior Work Gallery</Label>
                    <ScrollArea className="w-full mt-2">
                      <div className="flex gap-2 pb-2">
                        {selectedApplication.worker.portfolioImages.map((img, idx) => (
                          <img 
                            key={idx} 
                            src={img} 
                            alt={`Portfolio ${idx + 1}`} 
                            className="w-24 h-24 object-cover rounded-lg flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                            onClick={() => setMediaViewer({ items: (selectedApplication.worker.portfolioImages || []).map(url => ({ type: 'image' as const, url })), currentIndex: idx })}
                            data-testid={`portfolio-image-${idx}`}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
                
                {selectedApplication.message?.trim() && !/contact\s*removed/i.test(selectedApplication.message) ? (
                  <div>
                    <Label className="text-muted-foreground">Their Message</Label>
                    <p className="text-sm mt-1 p-3 bg-muted rounded-lg">{selectedApplication.message}</p>
                  </div>
                ) : null}
                
                <div>
                  <Label className="text-muted-foreground">Hourly Rate</Label>
                  <p className="font-semibold text-lg">{formatRateWithMarkup(selectedApplication.proposedRate)}</p>
                </div>

                {/* Reviews - from completed jobs or Google import */}
                {applicantReviewsLoading ? (
                  <div>
                    <Label className="text-muted-foreground">Reviews</Label>
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                ) : applicantReviews.length > 0 ? (
                  <div>
                    <Label className="text-muted-foreground">Reviews ({applicantReviewsData?.totalReviews ?? applicantReviews.length})</Label>
                    <div className="mt-2 space-y-3 max-h-48 overflow-y-auto">
                      {applicantReviews.slice(0, 5).map((review: any) => (
                        <Card key={review.id} className="p-3">
                          <div className="flex gap-3">
                            <Avatar className="w-8 h-8 flex-shrink-0">
                              <AvatarImage src={review.reviewer?.avatarUrl || undefined} />
                              <AvatarFallback className="text-[10px]">{review.reviewer?.firstName?.[0]}{review.reviewer?.lastName?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">
                                  {review.reviewer?.firstName} {review.reviewer?.lastName}
                                  {review.isGoogleReview && <Badge variant="outline" className="ml-1 text-[10px]">Google</Badge>}
                                </span>
                                <div className="flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <Star key={star} className={`w-3 h-3 ${star <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                                  ))}
                                </div>
                              </div>
                              {review.comment && <p className="text-xs text-muted-foreground line-clamp-2">{review.comment}</p>}
                            </div>
                          </div>
                        </Card>
                      ))}
                      {applicantReviews.length > 5 && (
                        <p className="text-xs text-muted-foreground">+{applicantReviews.length - 5} more</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              
              {selectedApplication.status === "rejected" && (
                <p className="text-sm text-muted-foreground pt-4">This application was declined.</p>
              )}
            </>
          )}
      </ResponsiveDialog>

      <ResponsiveDialog
        open={!!showWorkerProfileContext}
        onOpenChange={(open) => !open && setShowWorkerProfileContext(null)}
        title={t("settings.workerProfile")}
        contentClassName="max-w-lg"
        showBackButton={!!selectedApplication || !!mobileLocationPopup || !!selectedJobDetails}
        onBack={() => setShowWorkerProfileContext(null)}
        backLabel="Back"
        footer={showWorkerProfileContext ? (
          <div className="w-full px-4 sm:px-6 pb-4 flex flex-col gap-3">
            {showWorkerProfileContext.manager && (
              <p className="text-xs text-muted-foreground">
                Job requests go to this worker&apos;s manager (Business Operator) and any other admin accounts.
              </p>
            )}
            <Button className="w-full sm:w-auto" onClick={() => { setShowDirectRequest({ id: 0, worker: showWorkerProfileContext.worker, addedFrom: "", notes: "", rating: 0, isFavorite: false, createdAt: "" }); }}>
              <Send className="w-4 h-4 mr-2" /> Send Job Request
            </Button>
          </div>
        ) : undefined}
      >
          {showWorkerProfileContext && (
            <div className="space-y-4">
                {showWorkerProfileContext.manager && (
                  <Card className="p-3 bg-muted/50 border-border">
                    <Label className="text-muted-foreground text-xs mb-1 block">Manager (Business Operator)</Label>
                    <p className="font-medium text-sm">
                      {[showWorkerProfileContext.manager.firstName, showWorkerProfileContext.manager.lastName].filter(Boolean).join(" ") || "Business Operator"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">This worker is part of their team. Job requests and reviews go to the manager.</p>
                  </Card>
                )}
                <div className="flex items-start gap-4">
                  <Avatar className="w-20 h-20">
                    <AvatarImage src={showWorkerProfileContext.worker.avatarUrl} />
                    <AvatarFallback className="text-2xl">{showWorkerProfileContext.worker.firstName[0]}{showWorkerProfileContext.worker.lastName[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold text-xl">{showWorkerProfileContext.worker.firstName} {showWorkerProfileContext.worker.lastName}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                      <span className="font-medium">{showWorkerProfileContext.worker.rating}</span>
                      <span className="text-muted-foreground">({showWorkerProfileContext.worker.completedJobs} jobs)</span>
                    </div>
                    <p className="text-lg font-semibold mt-1">{formatRateWithMarkup(showWorkerProfileContext.worker.hourlyRate)}</p>
                  </div>
                </div>

                <div>
                  <Label className="text-muted-foreground">About</Label>
                  <p className="text-sm mt-1">{showWorkerProfileContext.worker.bio ?? ""}</p>
                </div>
                
                <div>
                  <Label className="text-muted-foreground">Skills</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(showWorkerProfileContext.worker.skills ?? []).map(skill => (
                      <Badge key={skill} variant="secondary">{skill}</Badge>
                    ))}
                  </div>
                </div>
            </div>
          )}
      </ResponsiveDialog>

      <ResponsiveDialog
        open={!!showDirectRequest}
        onOpenChange={(open) => {
          if (!open) {
            setShowDirectRequest(null);
            setDirectRequestData({
              jobTitle: "", locationId: "", shiftType: "", startDate: "", startTime: "08:00", endTime: "17:00",
              recurringDays: [], recurringWeeks: 1, estimatedHours: "", description: "", images: [], fallbackToPublic: false,
            });
          }
        }}
        title={t("settings.sendDirectJobRequest")}
        description={showDirectRequest ? `Request ${showDirectRequest.worker.firstName} for a new job` : undefined}
        contentClassName="max-w-lg"
        showBackButton={!!showWorkerProfileContext}
        onBack={() => {
          setShowDirectRequest(null);
          setDirectRequestData({
            jobTitle: "", locationId: "", shiftType: "", startDate: "", startTime: "08:00", endTime: "17:00",
            recurringDays: [], recurringWeeks: 1, estimatedHours: "", description: "", images: [], fallbackToPublic: false,
          });
        }}
        backLabel="Worker Profile"
        footer={showDirectRequest ? (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => {
              setShowDirectRequest(null);
              setDirectRequestData({
                jobTitle: "", locationId: "", shiftType: "", startDate: "", startTime: "08:00", endTime: "17:00",
                recurringDays: [], recurringWeeks: 1, estimatedHours: "", description: "", images: [], fallbackToPublic: false,
              });
            }}>{tCommon("cancel")}</Button>
            <Button onClick={() => {
              if (!directRequestData.shiftType) {
                toast({ title: "Please select a time type", variant: "destructive" });
                return;
              }
              toast({
                title: "Request Sent",
                description: directRequestData.fallbackToPublic
                  ? `Job request sent to ${showDirectRequest.worker.firstName}. Will be posted publicly if not accepted within 24 hours.`
                  : `Job request sent to ${showDirectRequest.worker.firstName}.`
              });
              setShowDirectRequest(null);
              setDirectRequestData({
                jobTitle: "", locationId: "", shiftType: "", startDate: "", startTime: "08:00", endTime: "17:00",
                recurringDays: [], recurringWeeks: 1, estimatedHours: "", description: "", images: [], fallbackToPublic: false,
              });
            }} data-testid="button-send-request">
              <Send className="w-4 h-4 mr-2" /> Send Request
            </Button>
          </div>
        ) : undefined}
      >
          {showDirectRequest && (
            <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4 pr-4">
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <Avatar>
                      <AvatarImage src={showDirectRequest.worker.avatarUrl} />
                      <AvatarFallback>{showDirectRequest.worker.firstName[0]}{showDirectRequest.worker.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <span className="font-medium">{showDirectRequest.worker.firstName} {showDirectRequest.worker.lastName}</span>
                      <p className="text-sm text-muted-foreground">{formatRateWithMarkup(showDirectRequest.worker.hourlyRate)}</p>
                    </div>
                  </div>
                  
      {/* Pending timesheets pop-up (same content/actions as Timesheets page) */}
      <ResponsiveDialog
        open={!!showPendingTimesheetsWarning}
        onOpenChange={(open) => !open && setShowPendingTimesheetsWarning(null)}
        title="Timesheets requiring approval"
        description={showPendingTimesheetsWarning ? `Approve or reject the ${showPendingTimesheetsWarning.pendingCount} pending timesheet(s) for "${showPendingTimesheetsWarning.jobTitle}" before completing the job.` : undefined}
        contentClassName="max-w-3xl max-h-[90vh]"
      >
        {showPendingTimesheetsWarning && (() => {
          const projectGroup = pendingTimesheetGroups.find(g => g.jobId === showPendingTimesheetsWarning!.jobId);
          if (!projectGroup) return <div className="p-6 text-center text-muted-foreground">No pending timesheets for this job.</div>;
          return (
            <ScrollArea className="max-h-[70vh] pr-2">
              {pendingTimesheetGroups.filter(g => g.jobId === showPendingTimesheetsWarning.jobId).map(pg => (
                <div key={pg.jobId} className="bg-card rounded-xl border border-border/60 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{pg.jobTitle}</span>
                      {pg.workerDayGroups.length > 0 ? (
                        <Badge variant="secondary" className="text-xs">
                          {pg.workerDayGroups.length} {pg.workerDayGroups.length === 1 ? 'day' : 'days'} pending
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          No pending timesheets
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {pg.budgetCents && (
                        <span className="text-xs text-muted-foreground">
                          ${(pg.totalSpent / 100).toLocaleString()} / ${(pg.budgetCents / 100).toLocaleString()}
                        </span>
                      )}
                      {pg.timesheets.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const timesheetIds = pg.timesheets.map(t => t.id);
                            bulkApproveTimesheets.mutate({ timesheetIds });
                          }}
                          disabled={bulkApproveTimesheets.isPending}
                          data-testid={`button-approve-all-dialog-${pg.jobId}`}
                        >
                          {bulkApproveTimesheets.isPending ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <CheckCircle className="w-3 h-3 mr-1" />
                          )}
                          Approve All
                        </Button>
                      )}
                      {(() => {
                        const job = jobsData.flatMap(loc => loc.jobs).find(j => j.id === pg.jobId);
                        const isJobFilled = job ? job.workersHired >= job.maxWorkersNeeded : false;
                        const hasPending = pg.timesheets.length > 0;
                        const canComplete = isJobFilled && !hasPending;
                        if (!canComplete) return null;
                        return (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => { setShowPendingTimesheetsWarning(null); handleCompleteJobClick(pg.jobId, pg.jobTitle); }}
                            data-testid={`button-complete-job-dialog-${pg.jobId}`}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Job Complete
                          </Button>
                        );
                      })()}
                    </div>
                  </div>
                  {pg.workerDayGroups.length > 0 ? (
                    <>
                      <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-2 bg-muted/20 text-xs font-medium text-muted-foreground border-b">
                        <div className="col-span-3">Worker</div>
                        <div className="col-span-2">Date</div>
                        <div className="col-span-2">Shifts</div>
                        <div className="col-span-1 text-right">Hours</div>
                        <div className="col-span-2 text-right">Cost</div>
                        <div className="col-span-2 text-right">Actions</div>
                      </div>
                      <div className="divide-y divide-border/50">
                        {pg.workerDayGroups.map(workerDay => {
                          const groupKey = `${workerDay.workerId}-${workerDay.date}`;
                          const first = workerDay.timesheets[0];
                          const formatDist = (m: number) => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
                          const hasCoords = first && (first.jobSiteLat != null && first.jobSiteLng != null) && (first.clockInLat != null && first.clockInLng != null);
                          const mapProps = first && hasCoords ? {
                            jobSite: first.jobSiteLat != null && first.jobSiteLng != null ? { lat: first.jobSiteLat, lng: first.jobSiteLng, title: pg.jobTitle } : undefined,
                            clockIn: first.clockInLat != null && first.clockInLng != null ? { lat: first.clockInLat, lng: first.clockInLng, time: format(first.clockInTime, "HH:mm"), distanceMeters: first.clockInDistanceMeters ?? 0 } : undefined,
                            clockOut: first.clockOutTime && first.clockOutLat != null && first.clockOutLng != null ? { lat: first.clockOutLat, lng: first.clockOutLng, time: format(first.clockOutTime, "HH:mm"), distanceMeters: first.clockOutDistanceMeters ?? 0 } : undefined,
                          } : null;
                          return (
                            <div key={groupKey}>
                              <div
                                className={`grid grid-cols-1 md:grid-cols-12 gap-2 px-3 py-2 items-center hover:bg-muted/30 transition-colors cursor-pointer ${workerDay.hasLocationIssues ? 'bg-yellow-50/50 dark:bg-yellow-950/10' : ''}`}
                                onClick={() => setTimeout(() => setMobileWorkerDaySheet({ workerDay }), 0)}
                                data-testid={`row-worker-day-dialog-${groupKey}`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTimeout(() => setMobileWorkerDaySheet({ workerDay }), 0); } }}
                              >
                                <div className="col-span-3 flex items-center gap-2">
                                  <Avatar className="h-7 w-7">
                                    <AvatarImage src={workerDay.workerAvatarUrl} />
                                    <AvatarFallback className="text-xs">{workerDay.workerInitials}</AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {workerDay.workerName?.split(" ")[0] || workerDay.workerName}
                                      {workerDay.timesheets[0] && (
                                        <span className="text-muted-foreground font-normal"> · {formatRateWithMarkup(workerDay.timesheets[0].hourlyRate)}</span>
                                      )}
                                    </p>
                                    <Badge variant={getCountdownVariant(workerDay.earliestAutoApproval)} className="text-[10px] px-1 py-0 h-4">
                                      <Clock className="w-2.5 h-2.5 mr-0.5" />
                                      {formatAutoApprovalCountdown(workerDay.earliestAutoApproval)}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="col-span-2 text-sm text-muted-foreground">{workerDay.displayDate}</div>
                                <div className="col-span-2 flex items-center gap-1">
                                  <Badge variant="outline" className="text-xs">
                                    {workerDay.timesheets.length} {workerDay.timesheets.length === 1 ? 'shift' : 'shifts'}
                                  </Badge>
                                </div>
                                <div className="col-span-1 text-right"><span className="text-sm font-medium">{workerDay.totalHours.toFixed(1)}h</span></div>
                                <div className="col-span-2 text-right"><span className="text-sm font-semibold">${(workerDay.totalCost / 100).toFixed(2)}</span></div>
                                <div className="col-span-2 flex items-center justify-end gap-1 flex-nowrap overflow-visible" onClick={e => e.stopPropagation()}>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" data-testid={`button-workerday-menu-dialog-${groupKey}`}><MoreVertical className="w-4 h-4" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onSelect={() => { const firstTs = workerDay.timesheets[0]; if (firstTs) { setEditHours(workerDay.totalHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(firstTs), 50); } }} data-testid={`menu-edit-hours-dialog-${groupKey}`}>
                                        <Edit className="w-4 h-4 mr-2" /> Edit Hours
                                      </DropdownMenuItem>
                                      {!savedTeam.some((m: any) => m.workerId === workerDay.workerId) && (
                                        <DropdownMenuItem onSelect={() => addToSavedTeam.mutate({ workerId: workerDay.workerId, worker: { id: workerDay.workerId, firstName: workerDay.workerName?.split(' ')[0] || 'Worker', lastName: workerDay.workerName?.split(' ').slice(1).join(' ') || '', avatarUrl: workerDay.workerAvatarUrl } })} disabled={addToSavedTeam.isPending} data-testid={`menu-add-to-team-dialog-${groupKey}`}>
                                          <UserPlus className="w-4 h-4 mr-2" /> Add to Team
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onSelect={() => { setBulkRejectReason(""); setRejectTimesheetStep("review"); setTimeout(() => setBulkRejectModal(workerDay.timesheets), 50); }} className="text-destructive" data-testid={`menu-reject-workerday-dialog-${groupKey}`}>
                                        <X className="w-4 h-4 mr-2" /> Reject Timesheets
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                  <Button size="sm" onClick={() => { bulkApproveTimesheets.mutate({ timesheetIds: workerDay.timesheets.map(t => t.id) }); }} disabled={bulkApproveTimesheets.isPending} data-testid={`button-approve-workerday-dialog-${groupKey}`}>
                                    {bulkApproveTimesheets.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                                    Approve
                                  </Button>
                                </div>
                              </div>
                              {/* Clock in/out location and map thumbnail */}
                              {first && (
                                <div className="px-3 pb-2 pt-0 border-t border-border/50 bg-muted/10" onClick={e => e.stopPropagation()}>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5 w-full">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <Check className="w-3.5 h-3.5 shrink-0 text-green-600 dark:text-green-400" />
                                      <span className="min-w-0 break-words">Clock-in: {format(first.clockInTime, "h:mm a")}</span>
                                    </div>
                                    {first.clockOutTime ? (
                                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <X className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
                                        <span className="min-w-0 break-words">Clock-out: {format(first.clockOutTime, "h:mm a")}</span>
                                      </div>
                                    ) : (
                                      <div />
                                    )}
                                  </div>
                                  {mapProps && mapProps.jobSite && (
                                    <div className="mt-2 rounded-md overflow-hidden border border-border/50">
                                      <TimesheetMap
                                        jobSite={mapProps.jobSite}
                                        clockIn={mapProps.clockIn}
                                        clockOut={mapProps.clockOut}
                                        height={isMobile ? "120px" : "min(360px, 42vh)"}
                                        showLines={true}
                                        hideLegend={false}
                                        className="w-full"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                              {workerDay.hasLocationIssues && (
                                <div className="px-3 py-1 bg-yellow-50 dark:bg-yellow-950/20 border-t border-yellow-200/50 dark:border-yellow-800/30">
                                  <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-300">
                                    <AlertCircle className="w-3 h-3" />
                                    <span className="font-medium">Some shifts have location adjustments</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/30 border-t text-sm font-medium">
                        <div className="col-span-7 text-muted-foreground">Total</div>
                        <div className="col-span-1 text-right">{pg.totalHours.toFixed(1)}h</div>
                        <div className="col-span-2 text-right">${(pg.totalSpent / 100).toFixed(2)}</div>
                        <div className="col-span-2"></div>
                      </div>
                    </>
                  ) : (
                    <div className="p-6 text-center text-muted-foreground">
                      <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Waiting for worker timesheets</p>
                    </div>
                  )}
                </div>
              ))}
            </ScrollArea>
          );
        })()}
      </ResponsiveDialog>

      {/* Worker-day pop-up: centered dialog on all screen sizes — map, pins, Approve + 3-dot Edit/Reject */}
      <ResponsiveDialog
        open={!!mobileWorkerDaySheet}
        onOpenChange={(open) => { if (!open) setMobileWorkerDaySheet(null); }}
        title={mobileWorkerDaySheet ? mobileWorkerDaySheet.workerDay.workerName : ""}
        description={mobileWorkerDaySheet ? `${mobileWorkerDaySheet.workerDay.displayDate} · ${mobileWorkerDaySheet.workerDay.timesheets.length} ${mobileWorkerDaySheet.workerDay.timesheets.length === 1 ? "shift" : "shifts"} · ${mobileWorkerDaySheet.workerDay.totalHours.toFixed(1)}h · $${(mobileWorkerDaySheet.workerDay.totalCost / 100).toFixed(2)}` : undefined}
        contentClassName="max-w-lg"
        footer={mobileWorkerDaySheet && (() => {
          const { workerDay } = mobileWorkerDaySheet;
          const firstTimesheet = workerDay.timesheets[0];
          return (
            <div className="flex flex-row gap-2 justify-end flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" data-testid="mobile-workerday-sheet-menu">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setMobileWorkerDaySheet(null);
                      if (firstTimesheet) {
                        setEditHours(workerDay.totalHours.toFixed(2));
                        setEditExplanation("");
                        setEditTimesheetStep("form");
                        setTimeout(() => setEditTimesheetModal(firstTimesheet), 50);
                      }
                    }}
                    data-testid="mobile-workerday-sheet-edit"
                  >
                    <Edit className="w-4 h-4 mr-2" /> {t("common.editHours")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setMobileWorkerDaySheet(null);
                      setBulkRejectReason("");
                      setRejectTimesheetStep("review");
                      setTimeout(() => setBulkRejectModal(workerDay.timesheets), 50);
                    }}
                    className="text-destructive"
                    data-testid="mobile-workerday-sheet-reject"
                  >
                    <X className="w-4 h-4 mr-2" /> Reject Timesheets
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="default"
                className="flex-1 sm:flex-initial"
                onClick={() => {
                  bulkApproveTimesheets.mutate({ timesheetIds: workerDay.timesheets.map(t => t.id) });
                  setMobileWorkerDaySheet(null);
                }}
                disabled={bulkApproveTimesheets.isPending}
                data-testid="mobile-workerday-sheet-approve"
              >
                {bulkApproveTimesheets.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                {t("dashboard.approve")}
              </Button>
            </div>
          );
        })()}
      >
        {mobileWorkerDaySheet && (() => {
          const { workerDay } = mobileWorkerDaySheet;
          const firstTimesheet = workerDay.timesheets[0];
          const lastTimesheet = workerDay.timesheets[workerDay.timesheets.length - 1];
          return (
            <>
              <div className="p-3 border-b rounded-t-lg">
                <TimesheetMap
                  jobSite={firstTimesheet?.jobSiteLat && firstTimesheet?.jobSiteLng ? {
                    lat: firstTimesheet.jobSiteLat,
                    lng: firstTimesheet.jobSiteLng,
                    title: firstTimesheet.jobTitle,
                  } : undefined}
                  clockIn={firstTimesheet?.clockInLat && firstTimesheet?.clockInLng ? {
                    lat: firstTimesheet.clockInLat,
                    lng: firstTimesheet.clockInLng,
                    time: format(firstTimesheet.clockInTime, "h:mm a"),
                    distanceMeters: firstTimesheet.clockInDistanceMeters || 0,
                  } : undefined}
                  clockOut={lastTimesheet?.clockOutLat && lastTimesheet?.clockOutLng && lastTimesheet?.clockOutTime ? {
                    lat: lastTimesheet.clockOutLat,
                    lng: lastTimesheet.clockOutLng,
                    time: format(lastTimesheet.clockOutTime, "h:mm a"),
                    distanceMeters: lastTimesheet.clockOutDistanceMeters || 0,
                  } : undefined}
                  className="rounded-lg overflow-hidden"
                  height={isMobile ? "200px" : "min(400px, 50vh)"}
                  showLines={true}
                />
              </div>
              {workerDay.hasLocationIssues && (
                <div className="px-4 py-2 bg-amber-50/50 dark:bg-amber-950/20 border-b flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Some shifts have location adjustments</span>
                </div>
              )}
            </>
          );
        })()}
      </ResponsiveDialog>

      {/* Edit Hours — multi-step pop-up: Step 1 form → Step 2 success (opens from sheet 3-dot or desktop menu) */}
      <ResponsiveDialog
        open={!!editTimesheetModal}
        onOpenChange={(open) => { if (!open) { setEditTimesheetModal(null); setEditTimesheetStep("form"); } }}
        title={editTimesheetStep === "success" ? t("dashboard.timesheetUpdated", "Timesheet updated") : t("common.editHours")}
        description={editTimesheetModal ? (editTimesheetStep === "success" ? t("dashboard.hoursUpdated", "Hours have been updated.") : `${editTimesheetModal.workerName} · ${format(editTimesheetModal.clockInTime, "MMM d, yyyy")}`) : undefined}
        contentClassName="max-w-sm"
        footer={
          editTimesheetStep === "success" ? (
            <div className="flex gap-2 w-full justify-end">
              <Button onClick={() => { setEditTimesheetModal(null); setEditTimesheetStep("form"); }} data-testid="button-edit-hours-done">
                {t("common.done", "Done")}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={() => setEditTimesheetModal(null)}>{tCommon("cancel")}</Button>
              <Button
                disabled={!editHours || parseFloat(editHours) <= 0 || approveTimesheet.isPending}
                onClick={() => {
                  if (!editTimesheetModal) return;
                  const hours = parseFloat(editHours);
                  if (Number.isNaN(hours) || hours <= 0) return;
                  approveTimesheet.mutate(
                    { id: editTimesheetModal.id, adjustedHours: hours, companyNotes: editExplanation.trim() || undefined },
                    {
                      onSuccess: () => {
                        setEditTimesheetStep("success");
                        toast({ title: t("dashboard.timesheetUpdated", "Timesheet updated"), description: t("dashboard.hoursUpdated", "Hours have been updated.") });
                      },
                      onError: () => {
                        toast({ title: t("common.error", "Error"), description: t("dashboard.failedToUpdateTimesheet", "Failed to update timesheet."), variant: "destructive" });
                      },
                    }
                  );
                }}
                data-testid="button-save-edit-hours"
              >
                {approveTimesheet.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t("common.save", "Save")}
              </Button>
            </div>
          )
        }
      >
        {editTimesheetModal && (
          editTimesheetStep === "success" ? (
            <div className="py-4 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-muted-foreground">{t("dashboard.hoursUpdated", "Hours have been updated.")}</p>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="edit-hours-input">{t("timesheet.hours", "Hours")}</Label>
                <Input
                  id="edit-hours-input"
                  type="number"
                  min="0"
                  step="0.25"
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                  data-testid="input-edit-hours"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-explanation-input">{t("dashboard.companyNotes", "Company notes (optional)")}</Label>
                <Textarea
                  id="edit-explanation-input"
                  placeholder={t("dashboard.optionalReason", "Optional reason for change")}
                  value={editExplanation}
                  onChange={(e) => setEditExplanation(e.target.value)}
                  rows={3}
                  className="resize-none"
                  data-testid="input-edit-explanation"
                />
              </div>
            </div>
          )
        )}
      </ResponsiveDialog>

      {/* Reject Timesheets — sequential: review (map + geofence + adjust suggestion) → reason → success */}
      <ResponsiveDialog
        open={bulkRejectModal !== null && bulkRejectModal.length > 0}
        onOpenChange={(open) => { if (!open) { setBulkRejectModal(null); setRejectTimesheetStep("review"); } }}
        title={
          rejectTimesheetStep === "success" ? t("dashboard.timesheetsRejected", "Timesheets Rejected") :
          rejectTimesheetStep === "review" ? t("dashboard.rejectTimesheets", "Reject Timesheets") :
          t("dashboard.rejectionReason", "Reason for rejection")
        }
        description={rejectDialogDescription}
        contentClassName={rejectTimesheetStep === "review" ? "max-w-lg" : "max-w-sm"}
        footer={
          rejectTimesheetStep === "success" ? (
            <div className="flex gap-2 w-full justify-end">
              <Button onClick={() => { setBulkRejectModal(null); setRejectTimesheetStep("review"); setBulkRejectReason(""); }} data-testid="button-reject-timesheets-done">
                {t("common.done", "Done")}
              </Button>
            </div>
          ) : rejectTimesheetStep === "review" ? (
            <div className="flex flex-wrap gap-2 w-full justify-end">
              <Button variant="outline" onClick={() => setBulkRejectModal(null)}>{tCommon("cancel")}</Button>
              {bulkRejectModal?.[0] && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const first = bulkRejectModal[0];
                    setEditHours(first.adjustedHours.toFixed(2));
                    setEditExplanation("");
                    setEditTimesheetStep("form");
                    setEditTimesheetModal(first);
                    setBulkRejectModal(null);
                    setRejectTimesheetStep("review");
                  }}
                  data-testid="button-adjust-instead-reject"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {bulkRejectModal.length === 1 ? t("dashboard.adjustTimesheetInstead", "Adjust timesheet instead") : t("dashboard.adjustFirstTimesheetInstead", "Adjust first timesheet instead")}
                </Button>
              )}
              <Button variant="destructive" onClick={() => setRejectTimesheetStep("form")} data-testid="button-continue-to-reject">
                {t("dashboard.continueToReject", "Continue to Reject")}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={() => setRejectTimesheetStep("review")} data-testid="button-reject-back">{tCommon("back")}</Button>
              <Button variant="outline" onClick={() => setBulkRejectModal(null)}>{tCommon("cancel")}</Button>
              <Button
                variant="destructive"
                disabled={!bulkRejectReason.trim() || rejectTimesheet.isPending}
                onClick={async () => {
                  if (!bulkRejectModal?.length) return;
                  const reason = bulkRejectReason.trim();
                  if (!reason) return;
                  try {
                    for (const t of bulkRejectModal) {
                      if (t.isRealData) await rejectTimesheet.mutateAsync({ id: t.id, rejectionReason: reason });
                    }
                    setRejectTimesheetStep("success");
                    toast({ title: t("dashboard.timesheetsRejected", "Timesheets Rejected"), description: t("dashboard.timesheetsHaveBeenRejected", "The selected timesheets have been rejected."), variant: "destructive" });
                  } catch {
                    toast({ title: t("common.error", "Error"), description: t("dashboard.failedToRejectTimesheets", "Failed to reject some timesheets."), variant: "destructive" });
                  }
                }}
                data-testid="button-confirm-reject-timesheets"
              >
                {rejectTimesheet.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t("dashboard.reject", "Reject")}
              </Button>
            </div>
          )
        }
      >
        {bulkRejectModal && bulkRejectModal.length > 0 && (
          rejectTimesheetStep === "success" ? (
            <div className="py-4 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <X className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <p className="text-sm text-muted-foreground">{t("dashboard.timesheetsHaveBeenRejected", "The selected timesheets have been rejected.")}</p>
            </div>
          ) : rejectTimesheetStep === "review" ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                {t("dashboard.rejectReviewDescription", "Review the clock-in and clock-out locations below. You can adjust hours instead of rejecting, or continue to reject with a reason.")}
              </p>
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {bulkRejectModal.map((ts) => {
                  const hasClockIn = ts.jobSiteLat != null && ts.jobSiteLng != null && ts.clockInLat != null && ts.clockInLng != null;
                  const outsideGeofence = !ts.locationVerified || (ts.clockInDistanceMeters > GEOFENCE_RADIUS_M) || (ts.clockOutDistanceMeters != null && ts.clockOutDistanceMeters > GEOFENCE_RADIUS_M);
                  const suggestedDeduction = getSuggestedDeductionHours(ts);
                  return (
                    <div key={ts.id} className="space-y-2 border rounded-lg p-3 bg-muted/30">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{ts.workerName}</span>
                        <span className="text-xs text-muted-foreground">{format(ts.clockInTime, "MMM d, h:mm a")} · {ts.adjustedHours.toFixed(1)}h</span>
                      </div>
                      {hasClockIn && (
                        <TimesheetMap
                          jobSite={ts.jobSiteLat != null && ts.jobSiteLng != null ? { lat: ts.jobSiteLat, lng: ts.jobSiteLng, title: ts.jobTitle } : undefined}
                          clockIn={ts.clockInLat != null && ts.clockInLng != null ? { lat: ts.clockInLat, lng: ts.clockInLng, time: format(ts.clockInTime, "h:mm a"), distanceMeters: ts.clockInDistanceMeters || 0 } : undefined}
                          clockOut={ts.clockOutLat != null && ts.clockOutLng != null && ts.clockOutTime ? { lat: ts.clockOutLat, lng: ts.clockOutLng, time: format(ts.clockOutTime, "h:mm a"), distanceMeters: ts.clockOutDistanceMeters || 0 } : undefined}
                          height={isMobile ? "200px" : "min(340px, 44vh)"}
                          showLines={true}
                          className="rounded-lg overflow-hidden"
                        />
                      )}
                      {!hasClockIn && <p className="text-xs text-muted-foreground py-2">{t("dashboard.noLocationData", "No location data for this timesheet.")}</p>}
                      {outsideGeofence && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle className="text-sm">{t("dashboard.clockOutsideGeofence", "Clock-in or clock-out outside job site")}</AlertTitle>
                          <AlertDescription className="text-xs mt-1">
                            {ts.clockInDistanceMeters > GEOFENCE_RADIUS_M && (
                              <span>{t("dashboard.clockInDistance", "Clock-in was {{meters}}m from job site (geofence {{radius}}m).", { meters: Math.round(ts.clockInDistanceMeters), radius: GEOFENCE_RADIUS_M })}</span>
                            )}
                            {ts.clockOutDistanceMeters != null && ts.clockOutDistanceMeters > GEOFENCE_RADIUS_M && (
                              <span>{ts.clockInDistanceMeters > GEOFENCE_RADIUS_M ? " " : ""}{t("dashboard.clockOutDistance", "Clock-out was {{meters}}m from job site.", { meters: Math.round(ts.clockOutDistanceMeters) })}</span>
                            )}
                            {suggestedDeduction > 0 && (
                              <p className="mt-2 font-medium">
                                {t("dashboard.suggestedDeduction", "Suggested adjustment: deduct {{hours}}h (estimated travel time to/from site).", { hours: suggestedDeduction.toFixed(2) })}
                              </p>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                      {hasClockIn && ts.locationVerified && ts.clockInDistanceMeters <= GEOFENCE_RADIUS_M && (ts.clockOutDistanceMeters == null || ts.clockOutDistanceMeters <= GEOFENCE_RADIUS_M) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-500/10 text-green-800 dark:text-green-300 rounded-md px-2 py-1.5">
                          <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                          {t("dashboard.clockWithinGeofence", "Clock-in and clock-out within job site area.")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="reject-reason-input">{t("dashboard.rejectionReason", "Reason for rejection")}</Label>
                <Textarea
                  id="reject-reason-input"
                  placeholder={t("dashboard.rejectionReasonPlaceholder", "Provide a reason (required)")}
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  rows={3}
                  className="resize-none"
                  data-testid="input-reject-reason"
                />
              </div>
            </div>
          )
        )}
      </ResponsiveDialog>

      {/* Mark Complete — 5-stage flow: intro → optional photos → reviews → add to team → success. Pending timesheets shown first. */}
      {showMarkCompleteDialog && (() => {
        const job = showMarkCompleteDialog;
        const acceptedApps = (job.applications || []).filter((a: any) => a.status === "accepted");
        const workers = acceptedApps.map((a: any) => ({ app: a, workerId: a.worker?.id ?? a.workerId, name: a.worker ? `${a.worker.firstName || ""} ${a.worker.lastName || ""}`.trim() || "Worker" : "Worker" }));
        const currentWorker = workers[reviewWorkerIndex];
        const isLastWorker = reviewWorkerIndex >= workers.length - 1;
        const canCompleteReviewStep = workers.length === 0 || isLastWorker;
        const jobLocationId = job.locationId != null && job.locationId > 0 ? job.locationId : null;

        const StarRating = ({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) => (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium w-24 shrink-0">{label}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => onChange(n)} className="p-1 rounded hover:bg-muted" aria-label={`${n} stars`}>
                  <Star className={cn("w-6 h-6", value >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                </button>
              ))}
            </div>
          </div>
        );

        const handleContinueFromIntro = () => setMarkCompleteFlowStep("photos");
        const handleContinueFromPhotos = async () => {
          if (completionPhotoUrls.length > 0) {
            try {
              const existing = (job.images || []) as string[];
              await apiRequest("PATCH", `/api/company/jobs/${job.id}`, { images: [...existing, ...completionPhotoUrls] });
              queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
            } catch (e) {
              toast({ title: "Error", description: "Failed to save photos", variant: "destructive" });
              return;
            }
          }
          setMarkCompleteFlowStep("reviews");
        };
        const handleNextOrCompleteReview = async () => {
          if (currentWorker && reviewRatings.timeliness > 0 && reviewRatings.effort > 0 && reviewRatings.communication > 0 && reviewRatings.value > 0) {
            try {
              await fetch("/api/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  jobId: job.id,
                  workerId: currentWorker.workerId,
                  timeliness: reviewRatings.timeliness,
                  effort: reviewRatings.effort,
                  communication: reviewRatings.communication,
                  value: reviewRatings.value,
                  comment: reviewPrivateNote || undefined,
                }),
              });
            } catch (e) {
              console.error("Submit review failed", e);
            }
            setReviewRatings({ timeliness: 0, effort: 0, communication: 0, value: 0 });
            setReviewPrivateNote("");
          }
          if (canCompleteReviewStep) {
            setMarkCompleteFlowStep("addToTeam");
            return;
          }
          setReviewWorkerIndex((i) => i + 1);
        };
        const handleContinueFromAddToTeam = async () => {
          setAddToTeamAdding(true);
          try {
            for (const workerId of addToTeamSelectedWorkerIds) {
              await apiRequest("POST", "/api/saved-team", {
                workerId,
                jobId: job.id,
                locationId: jobLocationId ?? undefined,
              });
            }
            queryClient.invalidateQueries({ queryKey: ["/api/saved-team"] });
            queryClient.invalidateQueries({ queryKey: ["/api/team-by-location"] });
            const res = await apiRequest("PATCH", `/api/company/jobs/${job.id}`, { status: "completed" });
            if (res.ok) {
              queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
              queryClient.invalidateQueries({ queryKey: ["/api/chats/jobs"] });
              setMarkCompleteFlowStep("success");
            } else {
              toast({ title: "Error", description: "Failed to complete job", variant: "destructive" });
            }
          } catch (e) {
            toast({ title: "Error", description: "Failed to complete", variant: "destructive" });
          } finally {
            setAddToTeamAdding(false);
          }
        };
        const handleCloseMarkComplete = () => {
          setShowMarkCompleteDialog(null);
          setMarkCompleteFlowStep("intro");
          setReviewWorkerIndex(0);
          setMarkCompleteStep("timesheets");
          setReviewRatings({ timeliness: 0, effort: 0, communication: 0, value: 0 });
          setReviewPrivateNote("");
          setCompletionPhotoUrls([]);
          setAddToTeamSelectedWorkerIds([]);
        };

        const stepTitles: Record<MarkCompleteFlowStep, string> = {
          intro: "Close out this project",
          photos: "Completed project photos",
          reviews: "Review workers",
          addToTeam: "Add workers to your team",
          success: "Project completed",
        };
        const title = stepTitles[markCompleteFlowStep];
        const description = markCompleteFlowStep === "intro" || markCompleteFlowStep === "success" ? job.title : undefined;

        let footer: React.ReactNode = null;
        if (markCompleteFlowStep === "intro") {
          footer = (
            <div className="flex gap-2 flex-wrap w-full justify-end">
              <Button onClick={handleContinueFromIntro} data-testid="button-mark-complete-continue-intro">Continue</Button>
            </div>
          );
        } else if (markCompleteFlowStep === "photos") {
          footer = (
            <div className="flex gap-2 flex-wrap w-full justify-end">
              <Button variant="outline" onClick={() => setMarkCompleteFlowStep("reviews")} data-testid="button-mark-complete-skip-photos">Skip</Button>
              <Button onClick={handleContinueFromPhotos} data-testid="button-mark-complete-continue-photos">Continue</Button>
            </div>
          );
        } else if (markCompleteFlowStep === "reviews") {
          footer = (
            <div className="flex gap-2 flex-wrap w-full justify-end">
              <Button
                onClick={handleNextOrCompleteReview}
                disabled={workers.length > 0 && !!currentWorker && (reviewRatings.timeliness === 0 || reviewRatings.effort === 0 || reviewRatings.communication === 0 || reviewRatings.value === 0)}
                data-testid="button-next-or-complete-job"
              >
                {canCompleteReviewStep ? "Continue" : "Next worker"}
              </Button>
            </div>
          );
        } else if (markCompleteFlowStep === "addToTeam") {
          footer = (
            <div className="flex gap-2 flex-wrap w-full justify-end">
              <Button onClick={handleContinueFromAddToTeam} disabled={addToTeamAdding} data-testid="button-mark-complete-finish">
                {addToTeamAdding ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Completing…</> : "Complete job"}
              </Button>
            </div>
          );
        } else {
          footer = (
            <div className="flex gap-2 flex-wrap w-full justify-end">
              <Button onClick={handleCloseMarkComplete} data-testid="button-mark-complete-done">Done</Button>
            </div>
          );
        }

        return (
          <ResponsiveDialog
            open={!!showMarkCompleteDialog}
            onOpenChange={(open) => { if (!open) handleCloseMarkComplete(); }}
            title={title}
            description={description}
            contentClassName="max-w-md"
            footer={footer}
          >
            <div className="space-y-4">
              {markCompleteFlowStep === "intro" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    You&apos;re about to close out this project. You&apos;ll confirm completed project photos (optional), leave reviews for each worker, optionally add workers to your team for this location, and then mark the job complete. Once complete, the job will be archived and no further chats, timesheets, or job details will be available.
                  </p>
                </>
              )}

              {markCompleteFlowStep === "photos" && (
                <>
                  <p className="text-sm text-muted-foreground">Add photos of the completed project (optional). These apply to the whole job.</p>
                  <div className="flex flex-wrap gap-2">
                    {completionPhotoUrls.map((url, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border bg-muted">
                        <img src={url.startsWith("http") || url.startsWith("/") ? url : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`} alt="" className="w-full h-full object-cover" />
                        <button type="button" className="absolute top-0 right-0 p-1 bg-black/60 text-white rounded-bl" onClick={() => setCompletionPhotoUrls((u) => u.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    {completionPhotoUrls.length < 5 && (
                      <label className="w-20 h-20 rounded-lg border border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/50">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={completionPhotosUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            e.target.value = "";
                            setCompletionPhotosUploading(true);
                            try {
                              assertMaxUploadSize(file);
                              const fileToUpload = await compressImageIfNeeded(file);
                              const urlResponse = await apiRequest("POST", "/api/uploads/request-url", { name: fileToUpload.name, size: fileToUpload.size, contentType: fileToUpload.type });
                              const { uploadURL, objectPath } = await urlResponse.json();
                              await fetch(uploadURL, { method: "PUT", body: fileToUpload, headers: { "Content-Type": fileToUpload.type } });
                              if (!objectPath) throw new Error("No object path");
                              setCompletionPhotoUrls((u) => [...u, objectPath].slice(0, 5));
                            } catch (err) {
                              toast({ title: "Upload failed", variant: "destructive" });
                            } finally {
                              setCompletionPhotosUploading(false);
                            }
                          }}
                        />
                        {completionPhotosUploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <Image className="w-6 h-6 text-muted-foreground" />}
                      </label>
                    )}
                  </div>
                </>
              )}

              {markCompleteFlowStep === "reviews" && (
                <>
                  {workers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No accepted workers to review. You can continue to the next step.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Rate each worker ({reviewWorkerIndex + 1} of {workers.length}). If a worker is part of a Business Operator&apos;s team, the review and private note go to the Business Operator.
                      </p>
                      {currentWorker && (
                        <>
                          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={currentWorker.app.worker?.avatarUrl} />
                              <AvatarFallback>{currentWorker.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{currentWorker.name}</span>
                            <span className="text-xs text-muted-foreground ml-auto">Worker {reviewWorkerIndex + 1} of {workers.length}</span>
                          </div>
                          <div className="space-y-4 py-2">
                            <StarRating label="Timeliness" value={reviewRatings.timeliness} onChange={(n) => setReviewRatings((r) => ({ ...r, timeliness: n }))} />
                            <StarRating label="Effort" value={reviewRatings.effort} onChange={(n) => setReviewRatings((r) => ({ ...r, effort: n }))} />
                            <StarRating label="Communication" value={reviewRatings.communication} onChange={(n) => setReviewRatings((r) => ({ ...r, communication: n }))} />
                            <StarRating label="Value" value={reviewRatings.value} onChange={(n) => setReviewRatings((r) => ({ ...r, value: n }))} />
                            <Label className="text-sm">Private note (optional)</Label>
                            <Textarea placeholder="Feedback for your records (goes to Business Operator if this is a team member)" value={reviewPrivateNote} onChange={(e) => setReviewPrivateNote(e.target.value)} className="min-h-[60px]" />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {markCompleteFlowStep === "addToTeam" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {jobLocationId
                      ? "Select workers from this job to add to your team for this location. You can invite them to future jobs at this location."
                      : "Select workers from this job to add to your team."}
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {workers.map((w: any) => {
                      const isSelected = addToTeamSelectedWorkerIds.includes(w.workerId);
                      const alreadyOnTeam = savedTeam.some((m: any) => m.workerId === w.workerId && (jobLocationId == null || m.companyLocationId === jobLocationId));
                      return (
                        <div key={w.workerId} className="flex items-center gap-3 p-2 rounded-lg border">
                          <input
                            type="checkbox"
                            id={`add-team-${w.workerId}`}
                            checked={isSelected}
                            disabled={alreadyOnTeam}
                            onChange={() => setAddToTeamSelectedWorkerIds((ids) => (isSelected ? ids.filter((id) => id !== w.workerId) : [...ids, w.workerId]))}
                          />
                          <label htmlFor={`add-team-${w.workerId}`} className="flex items-center gap-2 flex-1 cursor-pointer">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={w.app?.worker?.avatarUrl} />
                              <AvatarFallback>{w.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{w.name}</span>
                            {alreadyOnTeam && <span className="text-xs text-muted-foreground">Already on team</span>}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {markCompleteFlowStep === "success" && (
                <div className="py-4 text-center space-y-2">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                  <p className="font-medium">Project completed</p>
                  <p className="text-sm text-muted-foreground">
                    This job is now closed. No more chats, timesheets, or job details—the project is archived and will appear in your completed filter.
                  </p>
                </div>
              )}
            </div>
          </ResponsiveDialog>
        );
      })()}
                  
                  <div>
                    <Label>Job Title</Label>
                    <Input 
                      placeholder="e.g., Electrical Work - Building A" 
                      value={directRequestData.jobTitle}
                      onChange={(e) => setDirectRequestData(d => ({ ...d, jobTitle: e.target.value }))}
                      data-testid="input-direct-job-title" 
                    />
                  </div>
                  
                  <div>
                    <Label>Location</Label>
                    <Select 
                      value={directRequestData.locationId} 
                      onValueChange={(v) => setDirectRequestData(d => ({ ...d, locationId: v }))}
                    >
                      <SelectTrigger data-testid="select-direct-location">
                        <SelectValue placeholder="Select a location" />
                      </SelectTrigger>
                      <SelectContent>
                        {companyLocations.length === 0 ? (
                          <SelectItem value="no-locations" disabled>No locations - add one first</SelectItem>
                        ) : (
                          companyLocations.map((loc: any) => (
                            <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Time Type</Label>
                    <RadioGroup 
                      value={directRequestData.shiftType} 
                      onValueChange={(v) => setDirectRequestData(d => ({ ...d, shiftType: v as typeof d.shiftType }))}
                      className="space-y-2"
                    >
                      <div className="flex items-start gap-3 p-3 border border-border rounded-lg hover-elevate cursor-pointer">
                        <RadioGroupItem value="on-demand" id="dr-on-demand" className="mt-1" />
                        <label htmlFor="dr-on-demand" className="flex-1 cursor-pointer">
                          <span className="font-medium">On-Demand (ASAP)</span>
                          <p className="text-sm text-muted-foreground">Workers arrive within hours and work until task is complete</p>
                        </label>
                      </div>
                      <div className="flex items-start gap-3 p-3 border border-border rounded-lg hover-elevate cursor-pointer">
                        <RadioGroupItem value="one-day" id="dr-one-day" className="mt-1" />
                        <label htmlFor="dr-one-day" className="flex-1 cursor-pointer">
                          <span className="font-medium">One-Day Shift</span>
                          <Badge variant="secondary" className="ml-2 text-xs">Recommended</Badge>
                          <p className="text-sm text-muted-foreground">Schedule for a specific date and time range</p>
                        </label>
                      </div>
                      <div className="flex items-start gap-3 p-3 border border-border rounded-lg hover-elevate cursor-pointer">
                        <RadioGroupItem value="recurring" id="dr-recurring" className="mt-1" />
                        <label htmlFor="dr-recurring" className="flex-1 cursor-pointer">
                          <span className="font-medium">Recurring Shifts</span>
                          <p className="text-sm text-muted-foreground">Set up a weekly schedule for multi-week projects</p>
                        </label>
                      </div>
                    </RadioGroup>
                  </div>
                  
                  {directRequestData.shiftType === "on-demand" && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Start Date</Label>
                        <Input 
                          type="date" 
                          value={directRequestData.startDate}
                          onChange={(e) => setDirectRequestData(d => ({ ...d, startDate: e.target.value }))}
                          data-testid="input-direct-start-date" 
                        />
                      </div>
                      <div>
                        <Label>Start Time</Label>
                        <Input 
                          type="time" 
                          value={directRequestData.startTime}
                          onChange={(e) => setDirectRequestData(d => ({ ...d, startTime: e.target.value }))}
                          data-testid="input-direct-start-time" 
                        />
                      </div>
                    </div>
                  )}
                  
                  {directRequestData.shiftType === "one-day" && (
                    <div className="space-y-4">
                      <div>
                        <Label>Date</Label>
                        <Input 
                          type="date" 
                          value={directRequestData.startDate}
                          onChange={(e) => setDirectRequestData(d => ({ ...d, startDate: e.target.value }))}
                          data-testid="input-direct-oneday-date" 
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Start Time</Label>
                          <Select
                            value={directRequestData.startTime || "09:00"}
                            onValueChange={(v) => {
                              const validEnds = getValidEndTimeSlots(v);
                              const earliest = getEarliestEndTime(v);
                              setDirectRequestData(d => ({
                                ...d,
                                startTime: v,
                                endTime: (d.endTime && validEnds.includes(d.endTime)) ? d.endTime : earliest,
                              }));
                            }}
                            data-testid="input-direct-oneday-start"
                          >
                            <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                            <SelectContent>
                              {getTimeSlots().map((slot) => (
                                <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>End Time</Label>
                          <Select
                            value={directRequestData.endTime || getEarliestEndTime(directRequestData.startTime || "09:00")}
                            onValueChange={(v) => setDirectRequestData(d => ({ ...d, endTime: v }))}
                            data-testid="input-direct-oneday-end"
                          >
                            <SelectTrigger><SelectValue placeholder="End" /></SelectTrigger>
                            <SelectContent>
                              {getValidEndTimeSlots(directRequestData.startTime || "09:00").map((slot) => (
                                <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {directRequestData.shiftType === "recurring" && (
                    <div className="space-y-4">
                      <div>
                        <Label className="mb-2 block">Select Days</Label>
                        <div className="flex flex-wrap gap-2">
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
                            const dayKey = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][i];
                            const isSelected = directRequestData.recurringDays.includes(dayKey);
                            return (
                              <Button
                                key={day}
                                type="button"
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                onClick={() => setDirectRequestData(d => ({
                                  ...d,
                                  recurringDays: isSelected 
                                    ? d.recurringDays.filter(x => x !== dayKey)
                                    : [...d.recurringDays, dayKey]
                                }))}
                                data-testid={`button-day-${dayKey}`}
                              >
                                {day}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Start Time</Label>
                          <Select
                            value={directRequestData.startTime || "09:00"}
                            onValueChange={(v) => {
                              const validEnds = getValidEndTimeSlots(v);
                              const earliest = getEarliestEndTime(v);
                              setDirectRequestData(d => ({
                                ...d,
                                startTime: v,
                                endTime: (d.endTime && validEnds.includes(d.endTime)) ? d.endTime : earliest,
                              }));
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                            <SelectContent>
                              {getTimeSlots().map((slot) => (
                                <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>End Time</Label>
                          <Select
                            value={directRequestData.endTime || getEarliestEndTime(directRequestData.startTime || "09:00")}
                            onValueChange={(v) => setDirectRequestData(d => ({ ...d, endTime: v }))}
                          >
                            <SelectTrigger><SelectValue placeholder="End" /></SelectTrigger>
                            <SelectContent>
                              {getValidEndTimeSlots(directRequestData.startTime || "09:00").map((slot) => (
                                <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Number of Weeks</Label>
                        <Input 
                          type="number" 
                          min={1}
                          max={12}
                          value={directRequestData.recurringWeeks}
                          onChange={(e) => setDirectRequestData(d => ({ ...d, recurringWeeks: parseInt(e.target.value) || 1 }))}
                        />
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <Label>Job Description</Label>
                    <Textarea 
                      placeholder="Describe the work to be done..." 
                      value={directRequestData.description}
                      onChange={(e) => setDirectRequestData(d => ({ ...d, description: e.target.value }))}
                      data-testid="input-direct-description" 
                    />
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Images (Optional)</Label>
                    <div className="flex flex-wrap gap-2">
                      {directRequestData.images.map((img, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                          <img src={img} alt={`Job image ${i+1}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setDirectRequestData(d => ({ ...d, images: d.images.filter((_, idx) => idx !== i) }))}
                            className="absolute top-0 right-0 p-0.5 bg-destructive text-destructive-foreground rounded-bl"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {directRequestData.images.length < 5 && (
                        <label className="w-16 h-16 border-2 border-dashed border-border rounded-lg flex items-center justify-center cursor-pointer hover-elevate">
                          <Plus className="w-5 h-5 text-muted-foreground" />
                          <input 
                            type="file" 
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                  setDirectRequestData(d => ({ ...d, images: [...d.images, reader.result as string] }));
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            data-testid="input-direct-image"
                          />
                        </label>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Upload up to 5 images of the job site</p>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 border border-border rounded-lg">
                    <Switch 
                      id="fallback-public"
                      checked={directRequestData.fallbackToPublic}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setShowPublicFallbackPopup(true);
                        } else {
                          setDirectRequestData(d => ({ ...d, fallbackToPublic: false }));
                        }
                      }}
                      data-testid="switch-fallback-public"
                    />
                    <label htmlFor="fallback-public" className="flex-1 cursor-pointer">
                      <span className="font-medium">24-Hour Public Fallback</span>
                      <p className="text-sm text-muted-foreground">
                        If worker doesn't accept within 24 hours, automatically post job publicly
                      </p>
                    </label>
                  </div>
                </div>
              </ScrollArea>
            )}
      </ResponsiveDialog>
      
      <Dialog open={showPublicFallbackPopup} onOpenChange={setShowPublicFallbackPopup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enable 24-Hour Public Fallback</DialogTitle>
            <DialogDescription>
              If {showDirectRequest?.worker?.firstName || "the worker"} doesn't accept within 24 hours, this job will automatically be posted publicly for all matching workers to apply.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                <span className="font-medium">How it works:</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 ml-7">
                <li>Worker receives the job request immediately</li>
                <li>They have 24 hours to accept or decline</li>
                <li>If no response, job is automatically posted publicly</li>
                <li>You'll be notified when the job goes public</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublicFallbackPopup(false)}>
              Cancel
            </Button>
            <Button onClick={() => {
              setDirectRequestData(d => ({ ...d, fallbackToPublic: true }));
              setShowPublicFallbackPopup(false);
            }} data-testid="button-confirm-fallback">
              <Globe className="w-4 h-4 mr-2" /> Enable Fallback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResponsiveDialog
        open={!!selectedJobDetails}
        onOpenChange={(open) => {
          if (!open) {
            setShowJobDetailsFullView(false);
            if (cameFromPendingRequests) {
              setShowPendingRequests(true);
              setCameFromPendingRequests(false);
            }
            setSelectedJobDetails(null);
            setSelectedJobLocation(null);
          }
        }}
        showBackButton={showJobDetailsFullView || !!mobileLocationPopup || cameFromPendingRequests}
        onBack={() => {
          if (showJobDetailsFullView) {
            setShowJobDetailsFullView(false);
          } else if (cameFromPendingRequests) {
            setShowPendingRequests(true);
            setCameFromPendingRequests(false);
            setSelectedJobDetails(null);
            setSelectedJobLocation(null);
          } else {
            setSelectedJobDetails(null);
            setSelectedJobLocation(null);
          }
        }}
        backLabel={showJobDetailsFullView ? "Job Summary" : cameFromPendingRequests ? t("dashboard.actionRequired") : "Job List"}
        backButtonVariant="text"
        title={selectedJobDetails && selectedJobLocation ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span>{selectedJobDetails.title}</span>
            {(() => {
              const hasWorkers = selectedJobDetails.workersHired > 0 || selectedJobDetails.applications?.some((a: any) => a.status === "accepted");
              const showInProgress = (selectedJobDetails.status === "open" || selectedJobDetails.status === "in_progress") && hasWorkers;
              const variant = showInProgress ? "secondary" : selectedJobDetails.status === "open" ? "default" : selectedJobDetails.status === "in_progress" ? "secondary" : "outline";
              const label = showInProgress ? "In Progress" : selectedJobDetails.status === "in_progress" ? "In Progress" : selectedJobDetails.status.charAt(0).toUpperCase() + selectedJobDetails.status.slice(1);
              return <Badge variant={variant}>{label}</Badge>;
            })()}
            <Badge variant="outline" className="capitalize">{selectedJobDetails.timelineType.replace("-", " ")}</Badge>
          </div>
        ) : undefined}
        description={selectedJobDetails && selectedJobLocation ? `${selectedJobLocation.name} - ${selectedJobLocation.address}, ${selectedJobLocation.city}` : undefined}
        contentClassName="max-w-2xl w-full max-h-[85vh] sm:max-h-[85vh]"
        footer={selectedJobDetails && selectedJobLocation ? (
          (() => {
            const acceptedCount = selectedJobDetails.applications?.filter((a: any) => a.status === "accepted").length ?? 0;
            const hasAssignedWorkers = acceptedCount > 0;
            const isJobFilled = selectedJobDetails.workersHired >= selectedJobDetails.maxWorkersNeeded;
            const jobPendingTimesheets = normalizedTimesheets.filter(t => t.jobId === selectedJobDetails.id && t.status === "pending");
            const hasPendingTimesheets = jobPendingTimesheets.length > 0;
            const canComplete = (selectedJobDetails.status === "in_progress" || selectedJobDetails.status === "open") && isJobFilled && !hasPendingTimesheets;

            if (hasAssignedWorkers) {
              return (
                <div className="w-full border-t border-border pt-4 px-4 sm:px-6 pb-4 flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowJobDetailsFullView(false);
                      setSelectedJobDetails(null);
                      handleCompleteJobClick(selectedJobDetails.id, selectedJobDetails.title);
                    }}
                    data-testid={`button-complete-job-details-${selectedJobDetails.id}`}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" /> Job Complete
                  </Button>
                  <Button variant="default" onClick={() => { setShowJobDetailsFullView(false); setSelectedJobDetails(null); navigate(`/company-dashboard/chats/${selectedJobDetails.id}`); }} data-testid={`button-job-chats-${selectedJobDetails.id}`}>
                    Messages
                  </Button>
                </div>
              );
            }

            return (
              <div className="w-full border-t border-border pt-4 px-4 sm:px-6 pb-4 flex gap-2 flex-wrap">
                {canComplete && (
                  <Button variant="secondary" onClick={() => { setShowJobDetailsFullView(false); setSelectedJobDetails(null); handleCompleteJobClick(selectedJobDetails.id, selectedJobDetails.title); }} data-testid={`button-complete-job-details-${selectedJobDetails.id}`}>
                    <CheckCircle className="w-4 h-4 mr-2" /> Job Complete
                  </Button>
                )}
                {(() => {
                  const hasSufficientWorkers = Math.max(selectedJobDetails.workersHired ?? 0, acceptedCount) >= selectedJobDetails.maxWorkersNeeded;
                  if (
                    hasSufficientWorkers ||
                    selectedJobDetails.status !== "open" ||
                    isWorkerAlertCooldownActive(selectedJobDetails.lastWorkerAlertAt)
                  )
                    return null;
                  return (
                    <Button onClick={async () => {
                      try {
                        const response = await fetch(`/api/jobs/${selectedJobDetails.id}/send-alert`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(data.message || "Failed to send alert");
                        if (data.lastWorkerAlertAt) {
                          updateJob(selectedJobDetails.id, { lastWorkerAlertAt: data.lastWorkerAlertAt });
                          setSelectedJobDetails((prev) =>
                            prev && prev.id === selectedJobDetails.id ? { ...prev, lastWorkerAlertAt: data.lastWorkerAlertAt } : prev
                          );
                        }
                        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                        toast({ title: "Alert Sent", description: `Matching workers have been notified${data.emailsSent ? ` (${data.emailsSent} emails sent)` : ''}.` });
                      } catch (error: any) {
                        toast({ title: "Error", description: error.message || "Failed to send alert to workers", variant: "destructive" });
                      }
                    }} data-testid={`button-send-alert-${selectedJobDetails.id}`}>
                      <Bell className="w-4 h-4 mr-2" /> Send Alert to Workers
                    </Button>
                  );
                })()}
              </div>
            );
          })()
        ) : undefined}
      >
          {selectedJobDetails && selectedJobLocation && (() => {
            const acceptedWorkers = selectedJobDetails.applications.filter(a => a.status === "accepted");
            const jobTimesheets = normalizedTimesheets.filter(t => t.jobId === selectedJobDetails.id);
            const timesheets = selectedJobDetails.timesheets || [];
            // Cost calculation: 1.52x markup on worker rate (52% covers $13/hr platform fee)
            const markupMultiplier = COMPANY_COST_MARKUP;
            const calculatedHours = getEstimatedHoursNumeric(selectedJobDetails);
            const rawEstimatedTotalCost =
              Math.round(selectedJobDetails.hourlyRate * markupMultiplier * calculatedHours * selectedJobDetails.maxWorkersNeeded) /
              100;
            const estimatedTotalCost =
              selectedJobDetails.budgetCents != null && selectedJobDetails.budgetCents > 0
                ? Math.min(rawEstimatedTotalCost, selectedJobDetails.budgetCents / 100)
                : rawEstimatedTotalCost;
            const hoursClocked = jobTimesheets.reduce((sum, ts) => sum + ts.adjustedHours, 0) || timesheets.reduce((sum, ts) => sum + ts.hoursClocked, 0);
            const hoursRemaining = Math.max(0, (calculatedHours * Math.max(1, acceptedWorkers.length)) - hoursClocked);
            const amountSpent = jobTimesheets.filter(ts => ts.status === "approved").reduce((sum, ts) => sum + Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier), 0) / 100;
            const amountPending = jobTimesheets.filter(ts => ts.status === "pending").reduce((sum, ts) => sum + Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier), 0) / 100;
            const pendingCount = jobTimesheets.filter(ts => ts.status === "pending").length;
            const approvedCount = jobTimesheets.filter(ts => ts.status === "approved").length;
            const pendingApplications = selectedJobDetails.applications.filter(a => a.status === "pending");
            
            if (!showJobDetailsFullView) {
              return (
                <div className="space-y-6">
                  {/* Summary Card - clickable to open full details */}
                  <button
                    type="button"
                    onClick={() => setShowJobDetailsFullView(true)}
                    className="w-full text-left p-4 rounded-xl border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm min-w-0 flex-1">
                        <span className="text-muted-foreground">Workers</span>
                        <span className="font-medium">{acceptedWorkers.length}/{selectedJobDetails.maxWorkersNeeded}</span>
                        <span className="text-muted-foreground">Schedule</span>
                        <span className="font-medium truncate">{formatJobSchedule(selectedJobDetails)}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Tap to view full job details</p>
                  </button>

                  {/* Hired Workers - above pending */}
                  {acceptedWorkers.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3">Hired Workers ({acceptedWorkers.length}/{selectedJobDetails.maxWorkersNeeded})</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {acceptedWorkers.map(app => (
                          <Card key={app.id} className="p-3 flex items-center gap-3">
                            <Avatar className="w-10 h-10 flex-shrink-0">
                              <AvatarImage src={app.worker.avatarUrl} />
                              <AvatarFallback className="text-xs">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">{app.worker.firstName} {app.worker.lastName}</p>
                              <p className="text-xs text-muted-foreground">{formatRateWithMarkup(app.proposedRate)}</p>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timesheets accordion - Pending (default open), Approved, Rejected */}
                  {jobTimesheets.length > 0 && (
                    <div className="px-0">
                      <Accordion type="single" collapsible defaultValue="pending" className="w-full">
                        <AccordionItem value="pending" className="border rounded-lg">
                          <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                            <span className="text-sm font-medium">
                              Pending ({jobTimesheets.filter(t => getDisplayStatus(t) === "pending").length})
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="px-0 pb-2">
                            {jobTimesheets.filter(t => getDisplayStatus(t) === "pending").length === 0 ? (
                              <p className="text-xs text-muted-foreground px-3 py-2">No pending timesheets</p>
                            ) : (
                              <div className="space-y-1 divide-y divide-border/50">
                                {jobTimesheets.filter(t => getDisplayStatus(t) === "pending").map(ts => (
                                  <div key={ts.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/20">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <Avatar className="w-6 h-6 flex-shrink-0">
                                        <AvatarImage src={ts.workerAvatarUrl} />
                                        <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                      </Avatar>
                                      <div className="text-xs min-w-0">
                                        <span className="font-medium">{format(ts.clockInTime, "MMM d")}</span>
                                        <span className="text-muted-foreground"> · {ts.adjustedHours.toFixed(1)}h</span>
                                        <span className="text-green-600 ml-1">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(0)}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-6 text-xs px-2"
                                        onClick={() => handleApproveTimesheetDisplay(ts)}
                                        disabled={approveTimesheet.isPending}
                                        data-testid={`button-approve-ts-summary-${ts.id}`}
                                      >
                                        {approveTimesheet.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs px-2 text-destructive border-destructive/50"
                                        onClick={() => handleRejectTimesheetDisplay(ts)}
                                        disabled={rejectTimesheet.isPending}
                                        data-testid={`button-reject-ts-summary-${ts.id}`}
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6" data-testid={`button-ts-menu-pending-summary-${ts.id}`}>
                                            <MoreVertical className="w-3.5 h-3.5" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => { setEditHours(ts.adjustedHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(ts), 50); }} data-testid={`menu-edit-ts-summary-${ts.id}`}>
                                            <Edit className="w-4 h-4 mr-2" /> Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuItem className="text-destructive" onClick={() => handleRejectTimesheetDisplay(ts)} data-testid={`menu-reject-ts-summary-${ts.id}`}>
                                            <X className="w-4 h-4 mr-2" /> Reject
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="approved" className="border rounded-lg">
                          <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                            <span className="text-sm font-medium">
                              Approved ({jobTimesheets.filter(t => getDisplayStatus(t) === "approved").length})
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="px-0 pb-2">
                            {jobTimesheets.filter(t => getDisplayStatus(t) === "approved").length === 0 ? (
                              <p className="text-xs text-muted-foreground px-3 py-2">No approved timesheets</p>
                            ) : (
                              <div className="space-y-1 divide-y divide-border/50">
                                {jobTimesheets.filter(t => getDisplayStatus(t) === "approved").map(ts => (
                                  <div key={ts.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/20">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <Avatar className="w-6 h-6 flex-shrink-0">
                                        <AvatarImage src={ts.workerAvatarUrl} />
                                        <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                      </Avatar>
                                      <div className="text-xs min-w-0">
                                        <span className="font-medium">{format(ts.clockInTime, "MMM d")}</span>
                                        <span className="text-muted-foreground"> · {ts.adjustedHours.toFixed(1)}h</span>
                                        <span className="text-green-600 ml-1">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(0)}</span>
                                      </div>
                                    </div>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" data-testid={`button-ts-menu-approved-summary-${ts.id}`}>
                                          <MoreVertical className="w-3.5 h-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => { setEditHours(ts.adjustedHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(ts), 50); }} data-testid={`menu-edit-ts-summary-${ts.id}`}>
                                          <Edit className="w-4 h-4 mr-2" /> Edit
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                ))}
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="rejected" className="border rounded-lg">
                          <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                            <span className="text-sm font-medium">
                              Rejected ({jobTimesheets.filter(t => getDisplayStatus(t) === "rejected").length})
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="px-0 pb-2">
                            {jobTimesheets.filter(t => getDisplayStatus(t) === "rejected").length === 0 ? (
                              <p className="text-xs text-muted-foreground px-3 py-2">No rejected timesheets</p>
                            ) : (
                              <div className="space-y-1 divide-y divide-border/50">
                                {jobTimesheets.filter(t => getDisplayStatus(t) === "rejected").map(ts => (
                                  <div key={ts.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/20">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <Avatar className="w-6 h-6 flex-shrink-0">
                                        <AvatarImage src={ts.workerAvatarUrl} />
                                        <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                      </Avatar>
                                      <div className="text-xs min-w-0">
                                        <span className="font-medium">{format(ts.clockInTime, "MMM d")}</span>
                                        <span className="text-muted-foreground"> · {ts.adjustedHours.toFixed(1)}h</span>
                                        <span className="text-muted-foreground ml-1">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(0)}</span>
                                      </div>
                                    </div>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" data-testid={`button-ts-menu-rejected-summary-${ts.id}`}>
                                          <MoreVertical className="w-3.5 h-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => { setEditHours(ts.adjustedHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(ts), 50); }} data-testid={`menu-edit-ts-summary-${ts.id}`}>
                                          <Edit className="w-4 h-4 mr-2" /> Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleApproveTimesheetDisplay(ts)} data-testid={`menu-approve-rejected-ts-summary-${ts.id}`}>
                                          <Check className="w-4 h-4 mr-2" /> Approve
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                ))}
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  )}

                  {/* Pending Applications - 2-col cards, always visible in summary */}
                  {pendingApplications.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3">Pending Applications ({pendingApplications.length})</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {pendingApplications.map(app => (
                          <Card
                            key={app.id}
                            className="p-3 cursor-pointer hover:border-primary/40 transition-colors"
                            onClick={() => setSelectedApplication(app)}
                          >
                            <div className="flex flex-col gap-2">
                              <div className="flex items-start gap-2">
                                <Avatar className="w-10 h-10 flex-shrink-0">
                                  <AvatarImage src={app.worker.avatarUrl} />
                                  <AvatarFallback className="text-xs">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{app.worker.firstName} {app.worker.lastName}</p>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                                    {app.worker.rating} • {app.worker.completedJobs} jobs
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
                                  {app.worker.identityVerified && (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] px-1 py-0 h-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800"
                                      title={tCommon("idVerifiedBadgeTooltip")}
                                    >
                                      <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> ID
                                    </Badge>
                                  )}
                                  {app.worker.insuranceVerified && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
                                      <Shield className="w-2.5 h-2.5 mr-0.5" /> Ins
                                    </Badge>
                                  )}
                                  {app.worker.w9DocumentUrl && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800">
                                      <FileText className="w-2.5 h-2.5 mr-0.5" /> W-9
                                    </Badge>
                                  )}
                                  {app.worker.strikeCount === 0 && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800">
                                      <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> Good
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {app.message?.trim() && !/contact\s*removed/i.test(app.message) && (
                                <p className="text-xs text-muted-foreground line-clamp-2">"{app.message.trim()}"</p>
                              )}
                              <p className="text-xs font-semibold text-primary">{formatRateWithMarkup(app.proposedRate)}</p>
                              <div className="flex gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => handleRejectApplication(app)} data-testid={`button-skip-summary-${app.id}`}>
                                  <X className="w-3 h-3 mr-1" /> Skip
                                </Button>
                                <Button size="sm" className="flex-1 h-7 text-xs bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0" onClick={() => handleAcceptApplication(app, selectedJobDetails)} data-testid={`button-hire-summary-${app.id}`}>
                                  <Check className="w-3 h-3 mr-1" /> Hire
                                </Button>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedJobDetails.applications.filter(a => a.status === "rejected").length > 0 && (
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="rejected" className="border rounded-lg">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <span className="text-sm font-medium text-muted-foreground">
                            Rejected applications ({selectedJobDetails.applications.filter(a => a.status === "rejected").length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <div className="grid grid-cols-2 gap-2">
                            {selectedJobDetails.applications.filter(a => a.status === "rejected").map(app => (
                              <Card key={app.id} className="p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Avatar className="w-8 h-8 flex-shrink-0">
                                      <AvatarImage src={app.worker.avatarUrl} />
                                      <AvatarFallback className="text-[10px]">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium truncate">{app.worker.firstName} {app.worker.lastName}</p>
                                      <p className="text-[10px] text-muted-foreground">{formatRateWithMarkup(app.proposedRate)}</p>
                                    </div>
                                  </div>
                                  <Button size="sm" variant="ghost" className="h-6 text-xs flex-shrink-0" onClick={() => handleReconsiderApplication(app)}>
                                    Reconsider
                                  </Button>
                                </div>
                              </Card>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              );
            }
            
            return (
            <div className="space-y-4">
                <JobDetailsContent
                  showCostSummary={true}
                  estimatedTotalCost={estimatedTotalCost}
                  estTotalSubtext={
                    selectedJobDetails.timelineType === "on-demand"
                      ? "Flexible hours"
                      : `${getEstimatedHoursNumeric(selectedJobDetails)}h × ${selectedJobDetails.maxWorkersNeeded} workers`
                  }
                  amountSpent={amountSpent}
                  approvedCount={approvedCount}
                  amountPending={amountPending}
                  pendingCount={pendingCount}
                  hoursClocked={hoursClocked}
                  hoursRemaining={hoursRemaining}
                  addressLine={
                    selectedJobLocation
                      ? [selectedJobLocation.address, selectedJobLocation.city, selectedJobLocation.state].filter(Boolean).join(", ")
                      : ""
                  }
                  trade={selectedJobDetails.trade ?? ""}
                  rateDisplay={
                    acceptedWorkers.length > 0
                      ? (() => {
                          const rates = acceptedWorkers
                            .map(a => (a.proposedRate ?? (a as any).proposed_rate ?? a.worker?.hourlyRate ?? (a.worker as any)?.hourly_rate) ?? 0)
                            .filter((r: number) => r > 0);
                          const avg = rates.length > 0 ? Math.round(rates.reduce((s: number, r: number) => s + r, 0) / rates.length) : 0;
                          return avg > 0 ? formatRateWithMarkup(avg) : (t("enhancedJobDialog:rateUndetermined") || "Undetermined");
                        })()
                      : (t("enhancedJobDialog:rateUndetermined") || "Undetermined")
                  }
                  estimatedHoursDisplay={formatEstimatedHours(selectedJobDetails, hoursClocked)}
                  workersDisplay={`${acceptedWorkers.length}/${selectedJobDetails.maxWorkersNeeded}`}
                  jobTypeDisplay={selectedJobDetails.timelineType ? selectedJobDetails.timelineType.replace("-", " ") : undefined}
                  timeDisplay={
                    selectedJobDetails.startTime && selectedJobDetails.endTime
                      ? `${formatTimeFriendly(selectedJobDetails.startTime)} – ${formatTimeFriendly(selectedJobDetails.endTime)}`
                      : selectedJobDetails.startTime
                        ? formatTimeFriendly(selectedJobDetails.startTime)
                        : selectedJobDetails.endTime
                          ? formatTimeFriendly(selectedJobDetails.endTime)
                          : undefined
                  }
                  startDateDisplay={selectedJobDetails.startDate ? format(new Date(selectedJobDetails.startDate), "MMM d, yyyy") : undefined}
                  endDateDisplay={selectedJobDetails.endDate ? format(new Date(selectedJobDetails.endDate), "MMM d, yyyy") : undefined}
                  recurringDaysDisplay={(() => {
                    const days = selectedJobDetails.scheduleDays ?? selectedJobDetails.recurringDays;
                    return days && Array.isArray(days) && days.length > 0
                      ? days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ")
                      : undefined;
                  })()}
                  description={selectedJobDetails.description ?? undefined}
                />

                {/* Job Photos & Videos — company can add up to 6 total */}
                {(() => {
                  const allMedia: { type: 'image' | 'video'; url: string }[] = [
                    ...(selectedJobDetails.images || []).map(url => ({ type: 'image' as const, url })),
                    ...(selectedJobDetails.videos || []).map(url => ({ type: 'video' as const, url })),
                  ].slice(0, MAX_JOB_MEDIA);
                  const canAddMore = allMedia.length < MAX_JOB_MEDIA;
                  const handleAddMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
                    const files = e.target.files;
                    e.target.value = "";
                    if (!files?.length || !selectedJobDetails) return;
                    setJobDetailsMediaUploading(true);
                    try {
                      const existingImages = (selectedJobDetails.images || []) as string[];
                      const existingVideos = (selectedJobDetails.videos || []) as string[];
                      let newImages: string[] = [];
                      let newVideos: string[] = [];
                      const remaining = MAX_JOB_MEDIA - allMedia.length;
                      for (let i = 0; i < Math.min(files.length, remaining); i++) {
                        const file = files[i];
                        assertMaxUploadSize(file);
                        const isVideo = (file.type || "").startsWith("video/");
                        const fileToUpload = !isVideo ? await compressImageIfNeeded(file) : file;
                        const urlRes = await apiRequest("POST", "/api/uploads/request-url", { name: fileToUpload.name, size: fileToUpload.size, contentType: fileToUpload.type });
                        const { uploadURL, objectPath } = await urlRes.json();
                        await fetch(uploadURL, { method: "PUT", body: fileToUpload, headers: { "Content-Type": fileToUpload.type } });
                        if (!objectPath) throw new Error("No object path");
                        if (isVideo) newVideos.push(objectPath); else newImages.push(objectPath);
                      }
                      const combinedImages = [...existingImages, ...newImages];
                      const combinedVideos = [...existingVideos, ...newVideos];
                      const withType = [
                        ...combinedImages.map((u: string) => ({ t: "i" as const, u })),
                        ...combinedVideos.map((u: string) => ({ t: "v" as const, u })),
                      ].slice(0, MAX_JOB_MEDIA);
                      const payload = {
                        images: withType.filter((x) => x.t === "i").map((x) => x.u),
                        videos: withType.filter((x) => x.t === "v").map((x) => x.u),
                      };
                      const res = await apiRequest("PATCH", `/api/company/jobs/${selectedJobDetails.id}`, payload);
                      if (res.ok) {
                        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                        setSelectedJobDetails(prev => prev?.id === selectedJobDetails.id ? { ...prev, images: payload.images, videos: payload.videos } : prev);
                        updateJob(selectedJobDetails.id, payload);
                        if (newImages.length + newVideos.length > 0) toast({ title: "Media added", description: `${newImages.length + newVideos.length} file(s) added.` });
                      } else {
                        const data = await res.json().catch(() => ({}));
                        toast({ title: "Error", description: data.message || "Failed to add media", variant: "destructive" });
                      }
                    } catch (err: any) {
                      toast({ title: "Upload failed", description: err.message || "Could not add media", variant: "destructive" });
                    } finally {
                      setJobDetailsMediaUploading(false);
                    }
                  };
                  return (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm">Media ({allMedia.length}/{MAX_JOB_MEDIA})</h3>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {allMedia.map((media, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setMediaViewer({ items: allMedia, currentIndex: idx })}
                          className="relative flex-shrink-0 rounded-lg overflow-hidden border hover:ring-2 hover:ring-primary transition-all cursor-pointer"
                          data-testid={`button-media-${idx}`}
                        >
                          {media.type === 'image' ? (
                            <img src={media.url} alt={`Media ${idx + 1}`} className="w-24 h-20 object-cover" />
                          ) : (
                            <div className="relative w-32 h-20">
                              <video src={media.url} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                                  <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-black border-b-[6px] border-b-transparent ml-1" />
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1 rounded">
                            {`${idx + 1}/${MAX_JOB_MEDIA}`}
                          </div>
                        </button>
                      ))}
                      {canAddMore && (
                        <>
                          <input
                            ref={jobDetailsMediaInputRef}
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            className="hidden"
                            onChange={handleAddMedia}
                            disabled={jobDetailsMediaUploading}
                          />
                          <button
                            type="button"
                            onClick={() => jobDetailsMediaInputRef.current?.click()}
                            disabled={jobDetailsMediaUploading}
                            className="flex-shrink-0 w-24 h-20 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 hover:bg-muted/50 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
                            data-testid="button-add-job-media"
                            aria-label="Add photo or video"
                          >
                            {jobDetailsMediaUploading ? (
                              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            ) : (
                              <>
                                <Plus className="w-6 h-6 text-muted-foreground" />
                                <span className="text-[10px] text-muted-foreground">Add</span>
                              </>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  );
                })()}
                
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Left Column - Contact (Job Details is in shared JobDetailsContent above) */}
                  <div className="space-y-4">
                    {/* Contact Representative - editable */}
                    {selectedJobLocation && selectedJobLocation.id > 0 && (() => {
                      const fullLoc = (companyLocations || []).find((l: any) => Number(l.id) === Number(selectedJobLocation.id));
                      let contactName = "";
                      let contactPhone = "";
                      if (fullLoc) {
                        if (fullLoc.useCompanyDefault === true || fullLoc.useCompanyDefault === null || fullLoc.useCompanyDefault === undefined) {
                          contactName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.companyName || "Company Default";
                          contactPhone = profile?.phone || "";
                        } else if (fullLoc.representativeTeamMemberId && fullLoc.representativeTeamMemberId > 0) {
                          const teamMember = teamMembers.find((m: any) => m.id === fullLoc.representativeTeamMemberId);
                          if (teamMember) {
                            contactName = [teamMember.firstName, teamMember.lastName].filter(Boolean).join(" ") || "Team Member";
                            contactPhone = fullLoc.contactPhone || teamMember.phone || "";
                          }
                        } else {
                          contactName = fullLoc.contactName || "";
                          contactPhone = fullLoc.contactPhone || "";
                        }
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            const loc = fullLoc ?? (companyLocations || []).find((l: any) => String(l.id) === String(selectedJobLocation.id));
                            if (loc) {
                              setEditingLocation({
                                id: loc.id,
                                name: loc.name || selectedJobLocation.name || "",
                                address: loc.address || selectedJobLocation.address || "",
                                city: loc.city || selectedJobLocation.city || "",
                                state: loc.state || selectedJobLocation.state || "",
                                zipCode: loc.zipCode || selectedJobLocation.zipCode || "",
                                address2: loc.address2 || undefined,
                                useCompanyDefault: loc.useCompanyDefault ?? true,
                                contactName: loc.contactName || "",
                                contactPhone: loc.contactPhone || "",
                                contactEmail: loc.contactEmail || "",
                                contactAltPhone: loc.contactAltPhone || "",
                                representativeTeamMemberId: loc.representativeTeamMemberId || null,
                                assignedTeamMemberIds: loc.assignedTeamMemberIds || [],
                                selectedPhoneOption: loc.contactPhone === profile?.phone ? "company" : (loc.contactPhone ? "custom" : "company"),
                                paymentMethodId: loc.paymentMethodId || null,
                              });
                              setShowEditLocation(true);
                            } else {
                              toast({ title: "Cannot edit location", description: "This location could not be found. Try editing from Settings → Locations.", variant: "destructive" });
                            }
                          }}
                          className="w-full text-left"
                        >
                          <Card className="p-2 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs min-w-0">
                                <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="font-medium truncate">{contactName || "Contact Representative"}</span>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {contactPhone && <span className="text-xs text-muted-foreground truncate">{contactPhone}</span>}
                                <Edit className="w-3 h-3 text-muted-foreground" />
                              </div>
                            </div>
                            {!contactName && !contactPhone && (
                              <p className="text-xs text-muted-foreground mt-1">Tap to set contact for this location</p>
                            )}
                          </Card>
                        </button>
                      );
                    })()}
                    {/* Timesheets accordion: Pending (default open), Approved, Rejected — in left column with no horizontal padding */}
                    {jobTimesheets.length > 0 && (
                      <div className="px-0 -mx-1">
                        <Accordion type="single" collapsible defaultValue="pending" className="w-full">
                          <AccordionItem value="pending" className="border rounded-lg">
                            <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                              <span className="text-sm font-medium">
                                Pending ({jobTimesheets.filter(t => getDisplayStatus(t) === "pending").length})
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="px-0 pb-2">
                              {jobTimesheets.filter(t => getDisplayStatus(t) === "pending").length === 0 ? (
                                <p className="text-xs text-muted-foreground px-3 py-2">No pending timesheets</p>
                              ) : (
                                <div className="space-y-1 divide-y divide-border/50">
                                  {jobTimesheets.filter(t => getDisplayStatus(t) === "pending").map(ts => (
                                    <div key={ts.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/20">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <Avatar className="w-6 h-6 flex-shrink-0">
                                          <AvatarImage src={ts.workerAvatarUrl} />
                                          <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                        </Avatar>
                                        <div className="text-xs min-w-0">
                                          <span className="font-medium">{format(ts.clockInTime, "MMM d")}</span>
                                          <span className="text-muted-foreground"> · {ts.adjustedHours.toFixed(1)}h</span>
                                          <span className="text-green-600 ml-1">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(0)}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="h-6 text-xs px-2"
                                          onClick={() => handleApproveTimesheetDisplay(ts)}
                                          disabled={approveTimesheet.isPending}
                                          data-testid={`button-approve-ts-${ts.id}`}
                                        >
                                          {approveTimesheet.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 text-xs px-2 text-destructive border-destructive/50"
                                          onClick={() => handleRejectTimesheetDisplay(ts)}
                                          disabled={rejectTimesheet.isPending}
                                          data-testid={`button-reject-ts-${ts.id}`}
                                        >
                                          <X className="w-3 h-3" />
                                        </Button>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" data-testid={`button-ts-menu-pending-${ts.id}`}>
                                              <MoreVertical className="w-3.5 h-3.5" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => { setEditHours(ts.adjustedHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(ts), 50); }} data-testid={`menu-edit-ts-${ts.id}`}>
                                              <Edit className="w-4 h-4 mr-2" /> Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-destructive" onClick={() => handleRejectTimesheetDisplay(ts)} data-testid={`menu-reject-ts-${ts.id}`}>
                                              <X className="w-4 h-4 mr-2" /> Reject
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="approved" className="border rounded-lg">
                            <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                              <span className="text-sm font-medium">
                                Approved ({jobTimesheets.filter(t => getDisplayStatus(t) === "approved").length})
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="px-0 pb-2">
                              {jobTimesheets.filter(t => getDisplayStatus(t) === "approved").length === 0 ? (
                                <p className="text-xs text-muted-foreground px-3 py-2">No approved timesheets</p>
                              ) : (
                                <div className="space-y-1 divide-y divide-border/50">
                                  {jobTimesheets.filter(t => getDisplayStatus(t) === "approved").map(ts => (
                                    <div key={ts.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/20">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <Avatar className="w-6 h-6 flex-shrink-0">
                                          <AvatarImage src={ts.workerAvatarUrl} />
                                          <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                        </Avatar>
                                        <div className="text-xs min-w-0">
                                          <span className="font-medium">{format(ts.clockInTime, "MMM d")}</span>
                                          <span className="text-muted-foreground"> · {ts.adjustedHours.toFixed(1)}h</span>
                                          <span className="text-green-600 ml-1">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(0)}</span>
                                        </div>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" data-testid={`button-ts-menu-approved-${ts.id}`}>
                                            <MoreVertical className="w-3.5 h-3.5" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => { setEditHours(ts.adjustedHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(ts), 50); }} data-testid={`menu-edit-ts-${ts.id}`}>
                                            <Edit className="w-4 h-4 mr-2" /> Edit
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="rejected" className="border rounded-lg">
                            <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                              <span className="text-sm font-medium">
                                Rejected ({jobTimesheets.filter(t => getDisplayStatus(t) === "rejected").length})
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="px-0 pb-2">
                              {jobTimesheets.filter(t => getDisplayStatus(t) === "rejected").length === 0 ? (
                                <p className="text-xs text-muted-foreground px-3 py-2">No rejected timesheets</p>
                              ) : (
                                <div className="space-y-1 divide-y divide-border/50">
                                  {jobTimesheets.filter(t => getDisplayStatus(t) === "rejected").map(ts => (
                                    <div key={ts.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/20">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <Avatar className="w-6 h-6 flex-shrink-0">
                                          <AvatarImage src={ts.workerAvatarUrl} />
                                          <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                        </Avatar>
                                        <div className="text-xs min-w-0">
                                          <span className="font-medium">{format(ts.clockInTime, "MMM d")}</span>
                                          <span className="text-muted-foreground"> · {ts.adjustedHours.toFixed(1)}h</span>
                                          <span className="text-muted-foreground ml-1">${(Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier) / 100).toFixed(0)}</span>
                                        </div>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" data-testid={`button-ts-menu-rejected-${ts.id}`}>
                                            <MoreVertical className="w-3.5 h-3.5" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => { setEditHours(ts.adjustedHours.toFixed(2)); setEditExplanation(""); setEditTimesheetStep("form"); setTimeout(() => setEditTimesheetModal(ts), 50); }} data-testid={`menu-edit-ts-${ts.id}`}>
                                            <Edit className="w-4 h-4 mr-2" /> Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => handleApproveTimesheetDisplay(ts)} data-testid={`menu-approve-rejected-ts-${ts.id}`}>
                                            <Check className="w-4 h-4 mr-2" /> Approve
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    )}
                  </div>
                  
                  {/* Right Column - Assigned Workers & Chat */}
                  <div className="space-y-4">
                    {/* Assigned Workers - top of right column */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-sm">Assigned Workers ({`${acceptedWorkers.length}/${selectedJobDetails.maxWorkersNeeded}`})</h3>
                        {showClientDevTools() && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            disabled={devFillJobWorkerSlots.isPending}
                            onClick={() => devFillJobWorkerSlots.mutate(selectedJobDetails.id)}
                            data-testid="dev-fill-job-worker-slots"
                          >
                            {devFillJobWorkerSlots.isPending ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Filling…
                              </>
                            ) : (
                              <>
                                <UserPlus className="w-3 h-3 mr-1" /> Dev: fill slots
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      {acceptedWorkers.length === 0 ? (
                        <Card className="p-3 text-center">
                          <Users className="w-6 h-6 mx-auto mb-1 text-muted-foreground/50" />
                          <p className="text-xs text-muted-foreground">No workers assigned yet</p>
                        </Card>
                      ) : (
                        <div className="space-y-2">
                          {acceptedWorkers.map(app => {
                            const workerTimesheets = jobTimesheets.filter(ts => ts.workerId === app.worker.id);
                            const workerHours = workerTimesheets.reduce((sum, ts) => sum + ts.adjustedHours, 0);
                            const workerEarnings = workerTimesheets.reduce((sum, ts) => sum + Math.round(ts.adjustedHours * ts.hourlyRate * markupMultiplier), 0) / 100;
                            const workerRateCents = app.proposedRate ?? (app as any).proposed_rate ?? app.worker?.hourlyRate ?? (app.worker as any)?.hourly_rate ?? 0;
                            return (
                              <Card key={app.id} className="p-2">
                                <div className="flex items-center gap-2">
                                  <Avatar className="w-8 h-8">
                                    <AvatarImage src={app.worker.avatarUrl} />
                                    <AvatarFallback className="text-xs">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{app.worker.firstName} {app.worker.lastName}</span>
                                      <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                                      <span className="text-xs text-muted-foreground">{app.worker.rating}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      {workerRateCents > 0 && (
                                        <span className="font-medium text-foreground">{formatRateWithMarkup(workerRateCents)}</span>
                                      )}
                                      <span>{workerHours.toFixed(1)}h</span>
                                      <span>•</span>
                                      <span className="text-green-600">${workerEarnings.toFixed(0)}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {app.worker.identityVerified && (
                                        <Badge
                                          variant="outline"
                                          className="text-[9px] px-1 py-0 bg-green-50 text-green-700 border-green-200"
                                          title={tCommon("idVerifiedBadgeTooltip")}
                                        >
                                          <CheckCircle className="w-2 h-2 mr-0.5" /> ID
                                        </Badge>
                                      )}
                                      {app.worker.insuranceVerified && (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-200">
                                          <Shield className="w-2 h-2 mr-0.5" /> Ins
                                        </Badge>
                                      )}
                                      {app.worker.w9DocumentUrl && (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200">
                                          <FileText className="w-2 h-2 mr-0.5" /> W-9
                                        </Badge>
                                      )}
                                      {app.worker.strikeCount === 0 && (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-50 text-green-700 border-green-200">
                                          <CheckCircle className="w-2 h-2 mr-0.5" /> Good
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => navigate(`/company-dashboard/chats/${selectedJobDetails.id}`)}
                                      data-testid={`button-message-worker-${app.worker.id}`}
                                    >
                                      <MessageSquare className="w-3.5 h-3.5" />
                                    </Button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-worker-menu-${app.worker.id}`}>
                                          <MoreVertical className="w-3.5 h-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => setShowWorkerProfileContext({ worker: app.worker, manager: (app as any).manager })}>
                                          <Eye className="w-4 h-4 mr-2" /> View Profile
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={() => setRemoveWorkerDialog({ application: app, job: selectedJobDetails })}
                                        >
                                          <UserMinus className="w-4 h-4 mr-2" /> Remove
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* Recent Messages - Chat Style */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-sm">Recent Messages</h3>
                        {acceptedWorkers.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-6"
                            onClick={() => navigate(`/company-dashboard/chats/${selectedJobDetails.id}`)}
                          >
                            View All
                          </Button>
                        )}
                      </div>
                      <Card className="overflow-hidden">
                        <div className="max-h-[140px] overflow-y-auto p-2 space-y-2">
                          {jobTimesheets.filter(ts => ts.workerNotes).length > 0 ? (
                            jobTimesheets.filter(ts => ts.workerNotes).slice(0, 4).map(ts => (
                              <div key={ts.id} className="flex gap-2">
                                <Avatar className="w-5 h-5 flex-shrink-0">
                                  <AvatarImage src={ts.workerAvatarUrl} />
                                  <AvatarFallback className="text-[8px]">{ts.workerInitials}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="bg-muted/50 rounded-lg rounded-tl-none p-2">
                                    <p className="text-xs">{ts.workerNotes}</p>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {ts.workerName} • {format(ts.clockInTime, 'MMM d')}
                                  </p>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-4">
                              <MessageSquare className="w-6 h-6 mx-auto mb-1 text-muted-foreground/40" />
                              <p className="text-xs text-muted-foreground">No messages yet</p>
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>
                    
                    {/* Pending Applications - 2-col cards */}
                    {selectedJobDetails.applications.filter(a => a.status === "pending").length > 0 && (
                      <div>
                        <h3 className="font-semibold text-sm mb-3">Pending Applications ({selectedJobDetails.applications.filter(a => a.status === "pending").length})</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {selectedJobDetails.applications.filter(a => a.status === "pending").map(app => (
                            <Card
                              key={app.id}
                              className="p-3 cursor-pointer hover:border-primary/40 transition-colors"
                              onClick={() => setSelectedApplication(app)}
                            >
                              <div className="flex flex-col gap-2">
                                <div className="flex items-start gap-2">
                                  <Avatar className="w-10 h-10 flex-shrink-0">
                                    <AvatarImage src={app.worker.avatarUrl} />
                                    <AvatarFallback className="text-xs">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{app.worker.firstName} {app.worker.lastName}</p>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                                      {app.worker.rating} • {app.worker.completedJobs} jobs
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
                                    {app.worker.identityVerified && (
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 h-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800"
                                        title={tCommon("idVerifiedBadgeTooltip")}
                                      >
                                        <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> ID
                                      </Badge>
                                    )}
                                    {app.worker.insuranceVerified && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
                                        <Shield className="w-2.5 h-2.5 mr-0.5" /> Ins
                                      </Badge>
                                    )}
                                    {app.worker.w9DocumentUrl && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800">
                                        <FileText className="w-2.5 h-2.5 mr-0.5" /> W-9
                                      </Badge>
                                    )}
                                    {app.worker.strikeCount === 0 && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800">
                                        <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> Good
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                {app.message?.trim() && !/contact\s*removed/i.test(app.message) && (
                                  <p className="text-xs text-muted-foreground line-clamp-2">"{app.message.trim()}"</p>
                                )}
                                <p className="text-xs font-semibold text-primary">{formatRateWithMarkup(app.proposedRate)}</p>
                                <div className="flex gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                                  <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => handleRejectApplication(app)} data-testid={`button-skip-${app.id}`}>
                                    <X className="w-3 h-3 mr-1" /> Skip
                                  </Button>
                                  <Button size="sm" className="flex-1 h-7 text-xs bg-gradient-to-r from-[#00A86B] to-[#008A57] hover:from-[#008A57] hover:to-[#006B44] text-white border-0" onClick={() => handleAcceptApplication(app, selectedJobDetails)} data-testid={`button-hire-${app.id}`}>
                                    <Check className="w-3 h-3 mr-1" /> Hire
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Rejected Applications - collapsed accordion */}
                    {selectedJobDetails.applications.filter(a => a.status === "rejected").length > 0 && (
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="rejected" className="border rounded-lg">
                          <AccordionTrigger className="px-4 py-3 hover:no-underline">
                            <span className="text-sm font-medium text-muted-foreground">
                              Rejected applications ({selectedJobDetails.applications.filter(a => a.status === "rejected").length})
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 pb-4">
                            <div className="grid grid-cols-2 gap-2">
                              {selectedJobDetails.applications.filter(a => a.status === "rejected").map(app => (
                                <Card key={app.id} className="p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Avatar className="w-8 h-8 flex-shrink-0">
                                        <AvatarImage src={app.worker.avatarUrl} />
                                        <AvatarFallback className="text-[10px]">{app.worker.firstName[0]}{app.worker.lastName[0]}</AvatarFallback>
                                      </Avatar>
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium truncate">{app.worker.firstName} {app.worker.lastName}</p>
                                        <p className="text-[10px] text-muted-foreground">{formatRateWithMarkup(app.proposedRate)}</p>
                                      </div>
                                    </div>
                                    <Button size="sm" variant="ghost" className="h-6 text-xs flex-shrink-0" onClick={() => handleReconsiderApplication(app)} data-testid={`button-reconsider-${app.id}`}>
                                      Reconsider
                                    </Button>
                                  </div>
                                </Card>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
      </ResponsiveDialog>

      {/* Action Required — desktop: full-page onboarding-style; mobile: ResponsiveDialog */}
      {showPendingRequests ? (() => {
        const actionReqTitleNode: ReactNode = actionRequiredItems.length === 0 ? t("dashboard.actionRequiredAllDone", "All done!") : actionRequiredItems.length > 0 ? (() => {
          const idx = Math.min(actionRequiredItemIndex, actionRequiredItems.length - 1);
          const item = actionRequiredItems[idx];
          if (!item) return t("dashboard.actionRequired");
          if (item.type === "hire") return (<div className="space-y-0.5"><span className="block">{t("dashboard.workersAwaitingPlural")}</span><p className="text-sm font-normal text-muted-foreground truncate">{item.job.title} · {item.location.name}</p></div>);
          if (item.type === "timesheets") return (<div className="space-y-0.5"><span className="block">{t("dashboard.timesheetsToApprove")}</span><p className="text-sm font-normal text-muted-foreground truncate">{t("dashboard.approveOrRejectTimesheets", "Approve or reject pending timesheets")}</p></div>);
          if (item.type === "reschedule") return (<div className="space-y-0.5"><span className="block">{t("dashboard.jobsNeedReschedule")}</span><p className="text-sm font-normal text-muted-foreground truncate">{item.job.title} · {item.location.name}</p></div>);
          return t("dashboard.actionRequired");
        })() : t("dashboard.actionRequired");
        const actionReqHeaderTrailing = actionRequiredItems.length > 0 ? `${actionRequiredItemIndex + 1} of ${actionRequiredItems.length}` : undefined;
        const actionReqOnOpenChange = (open: boolean) => { setShowPendingRequests(open); if (!open) setActionReqInlinePanel(null); };
        const actionReqFooterNode: ReactNode = actionRequiredItems.length === 0 ? (
          <div className="flex justify-center w-full py-2">
            <Button className="min-w-[120px] h-9 text-sm font-semibold rounded-lg shadow-md bg-neutral-900 hover:bg-neutral-800 text-white border-0" onClick={() => setShowPendingRequests(false)} data-testid="action-required-done">
              {t("common.done", "Done")}
            </Button>
          </div>
        ) : actionRequiredItems.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {(() => {
              const idx = Math.min(actionRequiredItemIndex, actionRequiredItems.length - 1);
              const item = actionRequiredItems[idx];
              if (item?.type === "timesheets") {
                const pg = item.projectGroup;
                return (
                  <div className="w-full px-1 py-2 rounded-lg bg-muted/50 border border-border/50 text-center text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{pg.workerDayGroups.length}</span> worker {pg.workerDayGroups.length === 1 ? "day" : "days"}
                    {" · "}
                    <span className="font-medium text-foreground">{pg.totalHours.toFixed(1)}h</span>
                    {" · "}
                    <span className="font-medium text-foreground">${(pg.totalSpent / 100).toFixed(2)}</span>
                  </div>
                );
              }
              return null;
            })()}
            <div className="flex items-center justify-between gap-4 w-full px-2">
            {actionRequiredItemIndex > 0 ? (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={() => setActionRequiredItemIndex(i => i - 1)} aria-label={t("common.back", "Previous step")} data-testid="action-required-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
            ) : <div className="w-9 shrink-0" />}
            {(() => {
              const idx = Math.min(actionRequiredItemIndex, actionRequiredItems.length - 1);
              const item = actionRequiredItems[idx];
              const actionBtnClass = "flex-1 min-w-0 h-9 text-sm font-semibold rounded-lg shadow-md bg-neutral-900 hover:bg-neutral-800 text-white border-0 px-4";
              if (!item) return (<Button className={actionBtnClass} onClick={() => setShowPendingRequests(false)}>{t("common.done", "Done")}</Button>);
              if (item.type === "hire") return (
                <Button className={actionBtnClass} onClick={() => { actionRequiredReopenAtRef.current = idx + 1; setShowPendingRequests(false); setCameFromPendingRequests(true); setSelectedJobDetails(item.job); setSelectedJobLocation(item.location); }} data-testid="action-required-review-applicants">{t("dashboard.reviewApplicants", "Review applicants")}</Button>
              );
              if (item.type === "timesheets") return (
                <Button className={actionBtnClass} disabled={bulkApproveTimesheets.isPending} onClick={() => { const ids = item.projectGroup.timesheets.map(t => t.id); bulkApproveTimesheets.mutate({ timesheetIds: ids }, { onSuccess: () => { setActionRequiredItemIndex(i => Math.min(i + 1, actionRequiredItems.length - 1)); } }); }} data-testid="action-required-approve-all">{bulkApproveTimesheets.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.approveAll", "Approve all")}</Button>
              );
              if (item.type === "reschedule") {
                const d = actionReqRescheduleData;
                const type = d.timelineType || "one-day";
                const oneDayValid = !!(d.oneDayDate && d.oneDayStartTime && d.oneDayEndTime && isValidScheduleTime(d.oneDayDate, d.oneDayStartTime, d.oneDayEndTime).valid);
                const onDemandValid = type === "on-demand" && !!(d.onDemandDate && d.onDemandStartTime && validateOnDemandTime(d.onDemandDate, d.onDemandStartTime).valid);
                const recurringValid = type === "recurring" && d.recurringDays.length > 0 && d.recurringWeeks >= 1 && !!(d.recurringStartDate && d.recurringStartTime && d.recurringEndTime);
                const canSave = type === "one-day" ? oneDayValid : type === "on-demand" ? onDemandValid : recurringValid;
                return (
                  <Button
                    className={actionBtnClass}
                    disabled={!canSave}
                    onClick={() => handleActionReqRescheduleSave(item.job)}
                    data-testid="action-required-reschedule"
                  >
                    {t("dashboard.saveAndSendAlert", "Save & Send Alert")}
                  </Button>
                );
              }
              return (<Button className={actionBtnClass} onClick={() => setShowPendingRequests(false)}>{t("common.done", "Done")}</Button>);
            })()}
            {actionRequiredItemIndex < actionRequiredItems.length - 1 ? (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={() => setActionRequiredItemIndex(i => Math.min(i + 1, actionRequiredItems.length - 1))} aria-label={t("dashboard.nextStep", { current: actionRequiredItemIndex + 2, total: actionRequiredItems.length })} data-testid="action-required-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            ) : <div className="w-9 shrink-0" />}
            </div>
          </div>
        ) : undefined;
        const actionReqBody: ReactNode = actionRequiredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-1">{t("dashboard.actionRequiredAllDone", "All done!")}</h3>
            <p className="text-sm text-muted-foreground">{t("dashboard.actionRequiredSuccessMessage", "You've completed all action items.")}</p>
          </div>
        ) : actionRequiredItems.length > 0 ? (() => {
          const idx = Math.min(actionRequiredItemIndex, actionRequiredItems.length - 1);
          const item = actionRequiredItems[idx];
          if (!item) return null;
          if (item.type === "hire") {
            return (
              <div className="w-full space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <User className="w-4 h-4 shrink-0" />
                  <span>{t("dashboard.workersAwaitingPlural")}</span>
                </div>
                <div className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{item.job.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.job.trade} • {item.location.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex -space-x-2">
                        {item.applications.slice(0, 5).map((app) => (
                          <Avatar key={app.id} className="w-7 h-7 border-2 border-background">
                            <AvatarImage src={normalizeAvatarUrl(app.worker?.avatarUrl) || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {app.worker?.firstName?.[0]}{app.worker?.lastName?.[0]}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <span className="text-xs font-medium text-primary whitespace-nowrap">
                        {item.applications.length} {item.applications.length === 1 ? "applicant" : "applicants"}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Review and approve or reject applicants for this job.</p>
              </div>
            );
          }
          if (item.type === "timesheets") {
            const pg = item.projectGroup;
            const jobForDetails = findJobById(pg.jobId);
            const locationForJob = jobsData.find(loc => loc.jobs.some(j => j.id === pg.jobId));
            return (
              <div className="w-full space-y-4">
                <Accordion type="single" collapsible className="w-full border rounded-lg overflow-hidden">
                  <AccordionItem value="job-details" className="border-0">
                    <AccordionTrigger className="flex items-center justify-between gap-2 px-3 py-3 hover:no-underline hover:bg-muted/50 [&[data-state=open]]:bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0 text-left">
                        <Briefcase className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="font-semibold text-sm truncate">{pg.jobTitle}</span>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {pg.workerDayGroups.length} {pg.workerDayGroups.length === 1 ? "day" : "days"} pending
                        </Badge>
                      </div>
                      {pg.budgetCents && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          ${(pg.totalSpent / 100).toLocaleString()} / ${(pg.budgetCents / 100).toLocaleString()}
                        </span>
                      )}
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 pt-0">
                      {jobForDetails && locationForJob ? (
                        <div className="text-sm space-y-2 text-muted-foreground border-t pt-3">
                          <p><span className="font-medium text-foreground">{locationForJob.name}</span></p>
                          {(locationForJob.address || locationForJob.city) && (
                            <p className="text-xs">{[locationForJob.address, locationForJob.city, locationForJob.state, locationForJob.zipCode].filter(Boolean).join(", ")}</p>
                          )}
                          {jobForDetails.trade && <p>{jobForDetails.trade}</p>}
                          {jobForDetails.startDate && (
                            <p>{formatJobSchedule({ timelineType: jobForDetails.timelineType || "one-day", startDate: jobForDetails.startDate, startTime: jobForDetails.startTime, endTime: jobForDetails.endTime, recurringDays: jobForDetails.recurringDays, recurringWeeks: jobForDetails.recurringWeeks })}</p>
                          )}
                          {jobForDetails.description && <p className="text-xs pt-1 border-t mt-2">{jobForDetails.description}</p>}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground pt-2">Job details unavailable.</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1 md:max-h-none md:overflow-visible">
                  {pg.workerDayGroups.map(workerDay => {
                    const groupKey = `${workerDay.workerId}-${workerDay.date}`;
                    const first = workerDay.timesheets[0];
                    const hasCoords = first && (first.jobSiteLat != null && first.jobSiteLng != null) && (first.clockInLat != null && first.clockInLng != null);
                    const mapProps = first && hasCoords ? {
                      jobSite: first.jobSiteLat != null && first.jobSiteLng != null ? { lat: first.jobSiteLat, lng: first.jobSiteLng, title: pg.jobTitle } : undefined,
                      clockIn: first.clockInLat != null && first.clockInLng != null ? { lat: first.clockInLat, lng: first.clockInLng, time: format(first.clockInTime, "HH:mm"), distanceMeters: first.clockInDistanceMeters ?? 0 } : undefined,
                      clockOut: first.clockOutTime && first.clockOutLat != null && first.clockOutLng != null ? { lat: first.clockOutLat, lng: first.clockOutLng, time: format(first.clockOutTime, "HH:mm"), distanceMeters: first.clockOutDistanceMeters ?? 0 } : undefined,
                    } : null;
                    const formatDist = (m: number) => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
                    const clockInOutside = first && first.clockInDistanceMeters > GEOFENCE_RADIUS_M;
                    const clockOutOutside = first && first.clockOutDistanceMeters != null && first.clockOutDistanceMeters > GEOFENCE_RADIUS_M;
                    const suggestedDeductionHours = first ? getSuggestedDeductionHours(first) : 0;
                    const adjustedHours = first ? Math.max(0, workerDay.totalHours - suggestedDeductionHours) : workerDay.totalHours;
                    const isPanelOpen = actionReqInlinePanel?.groupKey === groupKey;
                    const processed = actionReqProcessedCard?.groupKey === groupKey ? actionReqProcessedCard.status : null;
                    return (
                      <div
                        key={groupKey}
                        className={cn(
                          "rounded-lg border bg-card text-left overflow-hidden",
                          workerDay.hasLocationIssues && !processed && "border-amber-300/50 bg-amber-50/30 dark:bg-amber-950/20",
                          processed === "edited" && "border-l-4 border-l-green-500 bg-green-50/30 dark:bg-green-950/20",
                          processed === "rejected" && "border-l-4 border-l-destructive bg-destructive/5 dark:bg-destructive/10"
                        )}
                      >
                        {(clockInOutside || clockOutOutside) && first && processed !== "edited" && (() => {
                          const buildGeofenceMessage = (): string => {
                            const inM = Math.round(first.clockInDistanceMeters);
                            const outM = first.clockOutDistanceMeters != null ? Math.round(first.clockOutDistanceMeters) : 0;
                            if (clockInOutside && clockOutOutside) {
                              return `You clocked in at a location that is ${inM}m outside the geofenced area of the project site, and clocked out at a location that is ${outM}m outside the geofence. We've deducted the estimated drive time to reflect time on site and appreciate your understanding.`;
                            }
                            if (clockInOutside) {
                              return `You clocked in at a location that is ${inM}m outside the geofenced area of the project site. We've deducted the estimated drive time to reflect time on site and appreciate your understanding.`;
                            }
                            return `You clocked out at a location that is ${outM}m outside the geofenced area of the project site. We've deducted the estimated drive time to reflect time on site and appreciate your understanding.`;
                          };
                          const handleApply = () => {
                            const message = buildGeofenceMessage();
                            if (message.length < 30) return;
                            const isSample = first.id < 0;
                            if (isSample) {
                              setActionReqProcessedCard({ groupKey, status: "edited" });
                              setActionReqInlinePanel(null);
                              queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                              toast({ title: t("dashboard.timesheetUpdated", "Timesheet updated"), description: t("dashboard.hoursUpdated", "Hours have been updated.") });
                              setTimeout(() => setActionReqProcessedCard(null), 4000);
                              return;
                            }
                            approveTimesheet.mutate(
                              { id: first.id, adjustedHours, companyNotes: message },
                              {
                                onSuccess: () => {
                                  setActionReqProcessedCard({ groupKey, status: "edited" });
                                  setActionReqInlinePanel(null);
                                  queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                                  toast({ title: t("dashboard.timesheetUpdated", "Timesheet updated"), description: t("dashboard.hoursUpdated", "Hours have been updated.") });
                                  setTimeout(() => setActionReqProcessedCard(null), 4000);
                                },
                                onError: () => {
                                  toast({ title: t("common.error", "Error"), description: t("dashboard.failedToUpdateTimesheet", "Failed to update timesheet."), variant: "destructive" });
                                },
                              }
                            );
                          };
                          return (
                            <div className="px-3 py-2 bg-amber-100/80 dark:bg-amber-900/30 border-b border-amber-200/50 dark:border-amber-800/50 flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                                  {clockInOutside && clockOutOutside
                                    ? `Clocked in ${formatDist(first.clockInDistanceMeters)} and out ${formatDist(first.clockOutDistanceMeters!)} outside job area.`
                                    : clockInOutside
                                      ? `Clocked in ${formatDist(first.clockInDistanceMeters)} outside job area.`
                                      : `Clocked out ${formatDist(first.clockOutDistanceMeters!)} outside job area.`}
                                </p>
                                {suggestedDeductionHours > 0 && (
                                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                                    Drive-time adjustment: {suggestedDeductionHours.toFixed(2)}h. Adjusted total: {adjustedHours.toFixed(1)}h.
                                  </p>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white border-0 shrink-0"
                                disabled={approveTimesheet.isPending}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleApply();
                                }}
                                data-testid={`action-req-apply-drive-time-${groupKey}`}
                              >
                                {approveTimesheet.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
                              </Button>
                            </div>
                          );
                        })()}
                        <div className="p-3">
                          <div className="flex items-start gap-2">
                            <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                              <AvatarImage src={workerDay.workerAvatarUrl} />
                              <AvatarFallback className="text-xs">{workerDay.workerInitials}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">
                                {workerDay.workerName?.split(" ")[0] || workerDay.workerName}
                                {first && (
                                  <span className="text-muted-foreground font-normal"> · {formatRateWithMarkup(first.hourlyRate)}</span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {workerDay.displayDate} · {workerDay.totalHours.toFixed(1)}h · ${(workerDay.totalCost / 100).toFixed(2)}
                              </p>
                              {workerDay.hasLocationIssues && (
                                <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                                  <AlertCircle className="w-3 h-3" /> Location adjustment
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`action-req-ts-menu-${groupKey}`}>
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="z-[250]"
                              container={typeof document !== "undefined" ? document.getElementById("dialog-container") ?? undefined : undefined}
                            >
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditHours(workerDay.totalHours.toFixed(2));
                                  setEditExplanation("");
                                  setActionReqInlinePanel({ groupKey, mode: "edit", timesheets: workerDay.timesheets });
                                }}
                                data-testid={`action-req-ts-edit-${groupKey}`}
                              >
                                <Edit className="w-4 h-4 mr-2" /> Edit Hours
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setBulkRejectReason("");
                                  setActionReqInlinePanel({ groupKey, mode: "reject", timesheets: workerDay.timesheets });
                                }}
                                className="text-destructive"
                                data-testid={`action-req-ts-reject-${groupKey}`}
                              >
                                <X className="w-4 h-4 mr-2" /> Reject
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                            <Button
                            size="sm"
                            className="h-8"
                            onClick={() => bulkApproveTimesheets.mutate({ timesheetIds: workerDay.timesheets.map(t => t.id) })}
                            disabled={bulkApproveTimesheets.isPending}
                            data-testid={`action-req-ts-approve-${groupKey}`}
                          >
                            {bulkApproveTimesheets.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                            Approve
                          </Button>
                        </div>
                          </div>
                          {first && (
                            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground w-full">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <Check className="w-3.5 h-3.5 shrink-0 text-green-600 dark:text-green-400" />
                                <span className="min-w-0 break-words">Clock-in: {format(first.clockInTime, "h:mm a")}</span>
                              </div>
                              {first.clockOutTime ? (
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <X className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
                                  <span className="min-w-0 break-words">Clock-out: {format(first.clockOutTime, "h:mm a")}</span>
                                </div>
                              ) : (
                                <div />
                              )}
                            </div>
                          )}
                        </div>
                        {mapProps && mapProps.jobSite && !isPanelOpen && (
                          <div className="border-t bg-muted/20">
                            <TimesheetMap
                              jobSite={mapProps.jobSite}
                              clockIn={mapProps.clockIn}
                              clockOut={mapProps.clockOut}
                              height={isMobile ? "120px" : "min(380px, 45vh)"}
                              showLines={true}
                              hideLegend={false}
                              className="rounded-none w-full"
                            />
                          </div>
                        )}
                        {/* Inline Edit or Reject panel (inside this card; map collapses when panel is open) */}
                        {actionReqInlinePanel && actionReqInlinePanel.groupKey === groupKey && (
                          <div className="border-t bg-muted/30 p-3 space-y-3" onClick={e => e.stopPropagation()}>
                            {actionReqInlinePanel.mode === "edit" ? (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  {t("dashboard.editHoursWorkerSees", "The worker will see the updated hours and any message you enter below.")}
                                </p>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-3 w-full">
                                    <div className="flex-1 min-w-0 space-y-1">
                                      <Label className="text-xs">{t("dashboard.hours", "Hours")}</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        step={0.25}
                                        value={editHours}
                                        onChange={(e) => setEditHours(e.target.value)}
                                        className="h-9"
                                        data-testid={`action-req-inline-edit-hours-${groupKey}`}
                                      />
                                    </div>
                                    <div className="shrink-0 flex flex-col items-end justify-end self-stretch pt-6 pb-0.5">
                                      {workerDay.totalHours > 0 && (() => {
                                        const newH = parseFloat(editHours) || 0;
                                        const newPayoutCents = newH > 0 ? Math.round((newH / workerDay.totalHours) * workerDay.totalCost) : 0;
                                        const originalCents = workerDay.totalCost;
                                        const changed = newPayoutCents !== originalCents;
                                        const diffCents = newPayoutCents - originalCents;
                                        return (
                                          <div className="text-xs text-right">
                                            <span className="text-muted-foreground block">{t("dashboard.changeInPayoutAmount", "Change in payout amount")}</span>
                                            <span className="font-semibold text-foreground">${(newPayoutCents / 100).toFixed(2)}</span>
                                            {changed && (
                                              <>
                                                <span className={cn("block font-medium", diffCents < 0 ? "text-destructive" : "text-muted-foreground")}>
                                                  {diffCents < 0 ? "−" : "+"}${(Math.abs(diffCents) / 100).toFixed(2)}
                                                </span>
                                                <span className="text-muted-foreground block">
                                                  {t("dashboard.wasPayout", "was")} ${(originalCents / 100).toFixed(2)}
                                                </span>
                                              </>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                  <Label className="text-xs">{t("dashboard.reasonForEditing", "Reason for editing")} *</Label>
                                  <p className="text-xs text-muted-foreground">
                                    {t("dashboard.editReasonHint", "The worker will see your message. Required: at least 30 characters.")}
                                  </p>
                                  <Textarea
                                    placeholder={t("dashboard.editReasonPlaceholder", "Required: at least 30 characters. Give a reason why you are editing the timesheet…")}
                                    value={editExplanation}
                                    onChange={(e) => setEditExplanation(e.target.value)}
                                    rows={2}
                                    minLength={30}
                                    className="text-sm resize-none"
                                    data-testid={`action-req-inline-edit-notes-${groupKey}`}
                                  />
                                  {editExplanation.trim().length > 0 && editExplanation.trim().length < 30 && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">
                                      {t("dashboard.rejectionMinChars", "{{count}}/30 characters (minimum 30)", { count: editExplanation.trim().length })}
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <Button variant="outline" size="sm" onClick={() => setActionReqInlinePanel(null)} data-testid={`action-req-inline-edit-cancel-${groupKey}`}>{tCommon("cancel")}</Button>
                                  <Button
                                    size="sm"
                                    disabled={!editHours || parseFloat(editHours) <= 0 || editExplanation.trim().length < 30 || approveTimesheet.isPending}
                                    onClick={() => {
                                      const first = actionReqInlinePanel.timesheets[0];
                                      if (!first) return;
                                      const hours = parseFloat(editHours);
                                      if (Number.isNaN(hours) || hours <= 0) return;
                                      const reason = editExplanation.trim();
                                      if (reason.length < 30) return;
                                      approveTimesheet.mutate(
                                        { id: first.id, adjustedHours: hours, companyNotes: reason },
                                        {
                                          onSuccess: () => {
                                            setActionReqProcessedCard({ groupKey, status: "edited" });
                                            setActionReqInlinePanel(null);
                                            queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                                            toast({ title: t("dashboard.timesheetUpdated", "Timesheet updated"), description: t("dashboard.hoursUpdated", "Hours have been updated.") });
                                            setTimeout(() => setActionReqProcessedCard(null), 4000);
                                          },
                                          onError: () => {
                                            toast({ title: t("common.error", "Error"), description: t("dashboard.failedToUpdateTimesheet", "Failed to update timesheet."), variant: "destructive" });
                                          },
                                        }
                                      );
                                    }}
                                    data-testid={`action-req-inline-edit-save-${groupKey}`}
                                  >
                                    {approveTimesheet.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                                    {t("common.save", "Save")}
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="space-y-2">
                                  <Label className="text-xs">{t("dashboard.rejectionReason", "Reason for rejection")} *</Label>
                                  <p className="text-xs text-muted-foreground">
                                    {t("dashboard.rejectionReasonHint", "The worker will see your message.")}
                                  </p>
                                  <Textarea
                                    placeholder={t("dashboard.rejectionReasonPlaceholderRequired", "Required: at least 30 characters. Enter reason for rejection…")}
                                    value={bulkRejectReason}
                                    onChange={(e) => setBulkRejectReason(e.target.value)}
                                    rows={3}
                                    minLength={30}
                                    className="text-sm resize-none"
                                    data-testid={`action-req-inline-reject-reason-${groupKey}`}
                                  />
                                  {bulkRejectReason.trim().length > 0 && bulkRejectReason.trim().length < 30 && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">
                                      {t("dashboard.rejectionMinChars", "{{count}}/30 characters (minimum 30)", { count: bulkRejectReason.trim().length })}
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <Button variant="outline" size="sm" onClick={() => setActionReqInlinePanel(null)} data-testid={`action-req-inline-reject-cancel-${groupKey}`}>{tCommon("cancel")}</Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={bulkRejectReason.trim().length < 30 || rejectTimesheet.isPending}
                                    onClick={async () => {
                                      if (!actionReqInlinePanel?.timesheets.length) return;
                                      const reason = bulkRejectReason.trim();
                                      if (reason.length < 30) return;
                                      try {
                                        for (const t of actionReqInlinePanel.timesheets) {
                                          if (t.isRealData) await rejectTimesheet.mutateAsync({ id: t.id, rejectionReason: reason });
                                        }
                                        setActionReqProcessedCard({ groupKey, status: "rejected" });
                                        setActionReqInlinePanel(null);
                                        setBulkRejectReason("");
                                        queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                                        toast({ title: t("dashboard.timesheetsRejected", "Timesheets Rejected"), description: t("dashboard.timesheetsHaveBeenRejected", "The selected timesheets have been rejected."), variant: "destructive" });
                                        setTimeout(() => setActionReqProcessedCard(null), 4000);
                                      } catch {
                                        toast({ title: t("common.error", "Error"), description: t("dashboard.failedToRejectTimesheets", "Failed to reject some timesheets."), variant: "destructive" });
                                      }
                                    }}
                                    data-testid={`action-req-inline-reject-confirm-${groupKey}`}
                                  >
                                    {rejectTimesheet.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3 mr-1" />}
                                    {t("dashboard.reject", "Reject")}
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
          if (item.type === "reschedule") {
            const jobDate = item.job.startDate ? new Date(item.job.startDate) : null;
            const todayForLate = new Date();
            todayForLate.setHours(0, 0, 0, 0);
            const scheduledLabel = jobDate
              ? format(jobDate, "MMM d, yyyy") + (item.job.startTime ? ` ${parseTimeToHHmm(item.job.startTime)}` : "")
              : "";
            const daysLate = jobDate ? Math.max(0, Math.floor((todayForLate.getTime() - jobDate.getTime()) / (24 * 60 * 60 * 1000))) : 0;
            const lateLabel = daysLate > 0 ? t("dashboard.daysLate", { count: daysLate }) : t("dashboard.pastDue");
            const rescheduleIdx = Math.min(actionRequiredItemIndex, actionRequiredItems.length - 1);
            const todayStr = new Date().toISOString().split("T")[0];
            return (
              <div className="w-full space-y-4">
                <Accordion type="single" collapsible defaultValue="job-details" className="w-full border rounded-lg overflow-hidden">
                  <AccordionItem value="job-details" className="border-0">
                    <AccordionTrigger className="flex items-center justify-between gap-2 px-3 py-3 hover:no-underline hover:bg-muted/50 [&[data-state=open]]:bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0 text-left">
                        <Briefcase className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="font-semibold text-sm truncate">{item.job.title}</span>
                        <span className="text-xs text-muted-foreground shrink-0">· {item.location.name}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 pt-0">
                      <div className="text-sm space-y-2 text-muted-foreground border-t pt-3">
                        <p><span className="font-medium text-foreground">{item.location.name}</span></p>
                        {(item.location.address || item.location.city) && (
                          <p className="text-xs">{[item.location.address, item.location.city, item.location.state, item.location.zipCode].filter(Boolean).join(", ")}</p>
                        )}
                        {item.job.trade && <p>{item.job.trade}</p>}
                        {scheduledLabel && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {t("dashboard.scheduledReschedule")}: {scheduledLabel} · {lateLabel}
                          </p>
                        )}
                        {item.job.description && <p className="text-xs pt-1 border-t mt-2">{item.job.description}</p>}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
                    <Label className="text-sm font-medium shrink-0">{t("dashboard.workersNeeded", "Workers needed")}</Label>
                    <div className="flex items-center gap-0 rounded-lg border border-border bg-background overflow-hidden">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-none border-0 border-r border-border"
                        onClick={() => setActionReqRescheduleWorkersNeeded((n) => Math.max(1, n - 1))}
                        disabled={actionReqRescheduleWorkersNeeded <= 1}
                        aria-label={t("common.decrease", "Decrease")}
                      >
                        −
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={actionReqRescheduleWorkersNeeded}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v)) setActionReqRescheduleWorkersNeeded(Math.max(1, Math.min(50, v)));
                        }}
                        className="h-9 w-12 rounded-none border-0 text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-none border-0 border-l border-border"
                        onClick={() => setActionReqRescheduleWorkersNeeded((n) => Math.min(50, n + 1))}
                        disabled={actionReqRescheduleWorkersNeeded >= 50}
                        aria-label={t("common.increase", "Increase")}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <RescheduleScheduleFlow
                    data={actionReqRescheduleData}
                    onChange={setActionReqRescheduleData}
                    currentView={actionReqRescheduleView}
                    onViewChange={setActionReqRescheduleView}
                    onDemandFormStep={actionReqRescheduleOnDemandStep}
                    onDemandFormStepChange={setActionReqRescheduleOnDemandStep}
                    oneDayFormStep={actionReqRescheduleOneDayStep}
                    oneDayFormStepChange={setActionReqRescheduleOneDayStep}
                    recurringFormStep={actionReqRescheduleRecurringStep}
                    recurringFormStepChange={setActionReqRescheduleRecurringStep}
                    scheduleError={actionReqRescheduleError}
                    onScheduleErrorChange={setActionReqRescheduleError}
                    workersNeeded={actionReqRescheduleWorkersNeeded}
                    todayStr={todayStr}
                    validateOnDemandTime={validateOnDemandTime}
                    isValidScheduleTime={isValidScheduleTime}
                    showTypePills
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-destructive hover:text-destructive"
                    onClick={() => {
                      actionRequiredReopenAtRef.current = rescheduleIdx + 1;
                      setShowRemoveJobDialog(item.job);
                    }}
                    data-testid="action-req-reschedule-cancel-job"
                  >
                    <X className="w-3 h-3 mr-1" />
                    {t("dashboard.cancelJob", "Cancel job")}
                  </Button>
                </div>
              </div>
            );
          }
          return null;
        })() : null;
        return (
          <>
            {!isMobile && (
              <div
                className="fixed inset-0 z-[220] flex flex-col bg-white dark:bg-background"
                role="dialog"
                aria-modal="true"
                aria-labelledby="action-required-desktop-title"
                data-testid="action-required-desktop-fullpage"
              >
                <div className="flex flex-1 min-h-0">
                  {actionRequiredItems.length > 0 ? (
                  <aside className="w-80 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto scrollbar-pill-on-scroll dark:bg-muted/30 dark:border-border">
                    <div className="p-6">
                      <div className="flex items-center gap-2 mb-6">
                        <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0 dark:bg-primary">
                          <span className="text-white font-bold text-lg">T</span>
                        </div>
                        <span className="text-lg font-semibold text-gray-900 dark:text-foreground">{t("dashboard.actionRequired", "Action required")}</span>
                      </div>
                      <nav className="space-y-1" aria-label={t("dashboard.actionRequired", "Action required")}>
                        {actionRequiredItems.map((arItem, i) => {
                          const isActive = i === actionRequiredItemIndex;
                          const stepDone = i < actionRequiredItemIndex;
                          const sideTitle =
                            arItem.type === "hire"
                              ? t("dashboard.workersAwaitingPlural")
                              : arItem.type === "timesheets"
                                ? t("dashboard.timesheetsToApprove")
                                : t("dashboard.jobsNeedReschedule");
                          const sideSub =
                            arItem.type === "hire"
                              ? `${arItem.job.title} · ${arItem.location.name}`
                              : arItem.type === "timesheets"
                                ? arItem.projectGroup.jobTitle
                                : `${arItem.job.title} · ${arItem.location.name}`;
                          return (
                            <button
                              key={`action-req-${i}-${arItem.type}`}
                              type="button"
                              onClick={() => setActionRequiredItemIndex(i)}
                              className={cn(
                                "w-full flex items-center gap-3 py-2.5 px-3 rounded-xl text-left transition-colors",
                                isActive
                                  ? "bg-green-50 text-[#00A86B] font-medium dark:bg-green-950/40 dark:text-green-400"
                                  : stepDone
                                    ? "bg-white border border-gray-300 text-gray-900 font-medium dark:bg-card dark:border-border dark:text-foreground"
                                    : "text-gray-400 hover:text-gray-600 dark:text-muted-foreground dark:hover:text-foreground"
                              )}
                            >
                              {stepDone ? (
                                <div className="w-8 h-8 rounded-full border border-gray-300 bg-white flex items-center justify-center flex-shrink-0 dark:bg-card dark:border-border">
                                  <Check className="w-4 h-4 text-gray-800 dark:text-foreground" strokeWidth={2.5} />
                                </div>
                              ) : isActive ? (
                                <div className="w-8 h-8 rounded-full bg-[#00A86B] flex items-center justify-center flex-shrink-0">
                                  <span className="text-white font-bold text-sm">{i + 1}</span>
                                </div>
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0 dark:bg-muted">
                                  <span className="text-white font-bold text-sm">{i + 1}</span>
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <span className="text-sm block truncate">{sideTitle}</span>
                                <span className="text-xs text-muted-foreground block truncate mt-0.5">{sideSub}</span>
                              </div>
                            </button>
                          );
                        })}
                      </nav>
                    </div>
                  </aside>
                  ) : (
                  <aside className="w-80 flex-shrink-0 border-r border-gray-200 bg-gray-50 dark:bg-muted/30 dark:border-border flex flex-col items-center justify-center p-6">
                    <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center mb-4">
                      <span className="text-white font-bold text-lg">T</span>
                    </div>
                    <p className="text-sm font-medium text-center text-gray-900 dark:text-foreground">{t("dashboard.actionRequiredAllDone", "All done!")}</p>
                  </aside>
                  )}
                  <main className="flex-1 min-w-0 flex flex-col min-h-0 bg-white dark:bg-background">
                    <header className="border-b border-gray-200 dark:border-border shrink-0 bg-white dark:bg-background">
                      <div className="max-w-4xl mx-auto px-6 md:px-8 py-4 flex items-start gap-4 justify-between w-full">
                        <div id="action-required-desktop-title" className="flex-1 min-w-0 text-lg font-semibold text-gray-900 dark:text-foreground [&_span]:text-lg [&_p]:text-sm">
                          {actionReqTitleNode}
                        </div>
                        {actionReqHeaderTrailing ? (
                          <span className="text-sm text-muted-foreground shrink-0 pt-1 whitespace-nowrap">{actionReqHeaderTrailing}</span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 rounded-full h-9 w-9"
                          onClick={() => actionReqOnOpenChange(false)}
                          aria-label={tCommon("close", "Close")}
                          data-testid="action-required-desktop-close"
                        >
                          <X className="w-5 h-5" />
                        </Button>
                      </div>
                    </header>
                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll">
                      <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-6">{actionReqBody}</div>
                    </div>
                    <footer className="border-t border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/20 shrink-0 px-6 md:px-8 py-4">
                      <div className="max-w-4xl mx-auto w-full">{actionReqFooterNode}</div>
                    </footer>
                  </main>
                </div>
              </div>
            )}
            {isMobile ? (
              <ResponsiveDialog
                open
                onOpenChange={actionReqOnOpenChange}
                title={actionReqTitleNode}
                headerTrailing={actionReqHeaderTrailing}
                contentClassName="max-w-md"
                progressSteps={actionRequiredItems.length}
                progressCurrent={actionRequiredItemIndex + 1}
                footer={actionReqFooterNode}
              >
                {actionReqBody}
              </ResponsiveDialog>
            ) : null}
          </>
        );
      })() : null}

      {/* Mobile: Location job list bottom-up popup (when accordion item tapped) */}
      {mobileLocationPopup && (
        <MobilePopup
          open={!!mobileLocationPopup}
          onOpenChange={(open) => !open && setMobileLocationPopup(null)}
          title={mobileLocationPopup.name}
          description={`${mobileLocationPopup.address}, ${mobileLocationPopup.city}, ${mobileLocationPopup.state} ${mobileLocationPopup.zipCode}`}
          maxWidth="lg"
        >
          {(() => {
            const filteredJobs = mobileLocationPopup.jobs.filter(job => {
              if (jobsFilter === "open") {
                return job.status === "open" && !job.applications.some(app => app.status === "accepted");
              }
              return job.status === "completed";
            });
            const jobsWithApplicantsFirst = [...filteredJobs].sort((a, b) => {
              const aPending = a.applications.filter((app: any) => app.status === "pending").length;
              const bPending = b.applications.filter((app: any) => app.status === "pending").length;
              return bPending - aPending;
            });
            const jobsWithPendingApps = filteredJobs.filter(j => j.applications.some((a: any) => a.status === "pending"));
            return (
              <div className="space-y-4">
                {jobsFilter === "open" && jobsWithPendingApps.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2 flex items-center gap-2 text-orange-700 dark:text-orange-300">
                      <User className="w-4 h-4" />
                      Applications awaiting your response
                    </h3>
                    <div className="space-y-2">
                      {jobsWithPendingApps.map(job => {
                        const pendingCount = job.applications.filter((a: any) => a.status === "pending").length;
                        return (
                          <button
                            key={job.id}
                            onClick={() => {
                              setSelectedJobDetails(job);
                              setSelectedJobLocation(mobileLocationPopup);
                              setMobileLocationPopup(null);
                            }}
                            className="w-full text-left p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm">{job.title}</p>
                                <p className="text-xs text-muted-foreground">{job.trade}</p>
                              </div>
                              <span className="flex-shrink-0 text-xs font-semibold text-orange-600 dark:text-orange-400 whitespace-nowrap">
                                {pendingCount} applicant{pendingCount !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              <JobTimeline
                jobs={jobsWithApplicantsFirst.map(job => ({
                  ...job,
                  timelineType: job.timelineType as "on-demand" | "one-day" | "recurring"
                }))}
                onJobClick={(job) => {
                  const fullJob = filteredJobs.find(j => j.id === job.id);
                  if (fullJob) {
                    setSelectedJobDetails(fullJob);
                    setSelectedJobLocation(mobileLocationPopup);
                  }
                }}
                onApplicantsClick={(job, e) => {
                  e.stopPropagation();
                  const fullJob = filteredJobs.find(j => j.id === job.id);
                  if (fullJob) {
                    const pendingApps = fullJob.applications.filter(a => a.status === "pending");
                    if (pendingApps.length > 0) {
                      setSelectedApplication(pendingApps[0]);
                    }
                  }
                }}
                onAdjustTimeline={(job, e) => {
                  e.stopPropagation();
                  const fullJob = filteredJobs.find(j => j.id === job.id);
                  if (fullJob) {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const weeks = fullJob.recurringWeeks || 1;
                    const startStr = fullJob.startDate || todayStr;
                    const [y, m, d] = startStr.split("-").map(Number);
                    const endDate = new Date(y, m - 1, d);
                    endDate.setDate(endDate.getDate() + Math.max(0, weeks * 7 - 1));
                    const recurringEndDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
                    setAdjustTimelineData({
                      timelineType: fullJob.timelineType,
                      onDemandDate: fullJob.startDate || todayStr,
                      onDemandStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                      onDemandDoneByDate: fullJob.startDate || "",
                      onDemandBudget: null,
                      oneDayDate: fullJob.startDate || todayStr,
                      oneDayStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                      oneDayEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                      recurringDays: fullJob.recurringDays || [],
                      recurringStartDate: fullJob.startDate || todayStr,
                      recurringEndDate: recurringEndDateStr,
                      recurringStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                      recurringEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                      recurringWeeks: weeks,
                    });
                    setAdjustRescheduleView("type-select");
                    setOnDemandFormStep(1);
                    setOneDayFormStep(1);
                    setRecurringFormStep(1);
                    setAdjustScheduleError(null);
                    setShowAdjustTimelineDialog(fullJob);
                  }
                }}
                formatRate={formatRateWithMarkup}
                isMobile={true}
                renderActions={(job) => {
                  const fullJob = filteredJobs.find(j => j.id === job.id);
                  if (!fullJob) return null;
                  const isJobFilled = job.workersHired >= job.maxWorkersNeeded;
                  const showAlertButton =
                    !isJobFilled && job.status === "open" && !isWorkerAlertCooldownActive(fullJob.lastWorkerAlertAt);
                  return (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-job-menu-${job.id}`}>
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {showAlertButton && (
                          <DropdownMenuItem
                            onClick={async () => {
                              try {
                                const response = await fetch(`/api/jobs/${job.id}/send-alert`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  credentials: "include",
                                });
                                const data = await response.json().catch(() => ({}));
                                if (!response.ok) throw new Error(data.message || "Failed to send alert");
                                if (data.lastWorkerAlertAt) updateJob(job.id, { lastWorkerAlertAt: data.lastWorkerAlertAt });
                                queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                                toast({ title: "Alert Sent", description: `Matching workers have been notified${data.emailsSent ? ` (${data.emailsSent} emails sent)` : ''}.` });
                              } catch (error: any) {
                                toast({ title: "Error", description: error.message || "Failed to send alert to workers", variant: "destructive" });
                              }
                            }}
                          >
                            <Bell className="w-4 h-4 mr-2" /> Send Alert to Workers
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => { setEditJobData({ title: fullJob.title, description: fullJob.description, locationId: fullJob.locationId.toString(), images: fullJob.images || [], videos: fullJob.videos || [] }); setShowEditJobDialog(fullJob); }}>
                          <Edit className="w-4 h-4 mr-2" /> Edit Job
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setWorkersCount(fullJob.maxWorkersNeeded); setShowIncreaseWorkersDialog(fullJob); }}>
                          <UserPlus className="w-4 h-4 mr-2" /> Adjust Workers
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          const todayStr = new Date().toISOString().split('T')[0];
                          const weeks = fullJob.recurringWeeks || 1;
                          const startStr = fullJob.startDate || todayStr;
                          const [y, m, d] = startStr.split("-").map(Number);
                          const endDate = new Date(y, m - 1, d);
                          endDate.setDate(endDate.getDate() + Math.max(0, weeks * 7 - 1));
                          const recurringEndDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
                          setAdjustTimelineData({
                            timelineType: fullJob.timelineType,
                            onDemandDate: fullJob.startDate || todayStr,
                            onDemandStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                            onDemandDoneByDate: fullJob.startDate || "",
                            onDemandBudget: null,
                            oneDayDate: fullJob.startDate || todayStr,
                            oneDayStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                            oneDayEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                            recurringDays: fullJob.recurringDays || [],
                            recurringStartDate: fullJob.startDate || todayStr,
                            recurringEndDate: recurringEndDateStr,
                            recurringStartTime: parseTimeToHHmm(fullJob.startTime || "08:00"),
                            recurringEndTime: parseTimeToHHmm(fullJob.endTime || "17:00"),
                            recurringWeeks: weeks,
                          });
                          setAdjustRescheduleView("type-select");
                          setOnDemandFormStep(1);
                          setOneDayFormStep(1);
                          setRecurringFormStep(1);
                          setAdjustScheduleError(null);
                          setShowAdjustTimelineDialog(fullJob);
                        }}>
                          <Calendar className="w-4 h-4 mr-2" /> Adjust Timeline
                        </DropdownMenuItem>
                        {(() => {
                          const isJobFilled = fullJob.workersHired >= fullJob.maxWorkersNeeded;
                          const jobPendingTimesheets = normalizedTimesheets.filter(t => t.jobId === fullJob.id && t.status === "pending");
                          const hasPendingTimesheets = jobPendingTimesheets.length > 0;
                          const canComplete = isJobFilled && !hasPendingTimesheets;
                          if (!canComplete) return null;
                          return (
                            <DropdownMenuItem onClick={() => { setMobileLocationPopup(null); handleCompleteJobClick(fullJob.id, fullJob.title); }}>
                              <Check className="w-4 h-4 mr-2" /> Mark as Complete
                            </DropdownMenuItem>
                          );
                        })()}
                        <DropdownMenuItem className="text-destructive" onClick={() => { setMobileLocationPopup(null); setShowRemoveJobDialog(fullJob); }}>
                          <Trash2 className="w-4 h-4 mr-2" /> {t("dashboard.removeJob")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }}
              />
              </div>
            );
          })()}
        </MobilePopup>
      )}

      {/* Adjust Timeline Dialog — 1:1 flow with PostJob: time type selection → multi-step popup */}
      <ResponsiveDialog
        open={!!showAdjustTimelineDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowAdjustTimelineDialog(null);
            setAdjustRescheduleView("type-select");
            if (actionRequiredReopenAtRef.current != null) {
              setActionRequiredItemIndex(actionRequiredReopenAtRef.current);
              actionRequiredReopenAtRef.current = null;
              setShowPendingRequests(true);
            }
          }
        }}
        title={adjustRescheduleView === "type-select"
          ? t("settings.rescheduleJob")
          : showAdjustTimelineDialog
            ? SHIFT_TYPE_INFO[adjustRescheduleView as ShiftType]?.title ?? t("settings.rescheduleJob")
            : t("settings.rescheduleJob")}
        description={adjustRescheduleView === "type-select"
          ? (showAdjustTimelineDialog ? `Update the schedule for ${showAdjustTimelineDialog.title}. Workers will be notified of the new time.` : undefined)
          : SHIFT_TYPE_INFO[adjustRescheduleView as ShiftType]?.description}
        contentClassName="max-w-2xl"
        showBackButton
        footerButtonOrder="primaryRight"
        onBack={() => {
          if (adjustRescheduleView === "type-select") {
            setShowAdjustTimelineDialog(null);
          } else {
            setAdjustRescheduleView("type-select");
            setOnDemandFormStep(1);
            setOneDayFormStep(1);
            setRecurringFormStep(1);
          }
        }}
        backLabel="Back"
        progressSteps={
          adjustRescheduleView === "on-demand" ? 2
            : adjustRescheduleView === "one-day" ? 0
              : adjustRescheduleView === "recurring" ? 2
                : 0
        }
        progressCurrent={
          adjustRescheduleView === "on-demand" ? onDemandFormStep
            : adjustRescheduleView === "one-day" ? 1
              : adjustRescheduleView === "recurring" ? recurringFormStep
                : 1
        }
        secondaryAction={
          adjustRescheduleView !== "type-select"
            ? {
                label: "Back",
                onClick: () => {
                  setAdjustRescheduleView("type-select");
                  setOnDemandFormStep(1);
                  setOneDayFormStep(1);
                  setRecurringFormStep(1);
                },
              }
            : undefined
        }
        primaryAction={
          adjustRescheduleView === "type-select"
            ? undefined
            : adjustRescheduleView === "on-demand"
              ? {
                  label: "Save & Send Alert",
                  onClick: handleRescheduleSave,
                  disabled: !(adjustTimelineData.onDemandDate && adjustTimelineData.onDemandStartTime && validateOnDemandTime(adjustTimelineData.onDemandDate, adjustTimelineData.onDemandStartTime).valid),
                }
              : adjustRescheduleView === "one-day"
                ? {
                    label: "Save & Send Alert",
                    onClick: handleRescheduleSave,
                    disabled:
                      !adjustTimelineData.oneDayDate ||
                      !adjustTimelineData.oneDayStartTime ||
                      !adjustTimelineData.oneDayEndTime ||
                      !isValidScheduleTime(adjustTimelineData.oneDayDate, adjustTimelineData.oneDayStartTime, adjustTimelineData.oneDayEndTime).valid,
                  }
                : adjustRescheduleView === "recurring"
                  ? (() => {
                      const todayStr = new Date().toISOString().split("T")[0];
                      const startStr = adjustTimelineData.recurringStartDate || todayStr;
                      const pastError = startStr && adjustTimelineData.recurringStartTime
                        ? (new Date(`${startStr}T${adjustTimelineData.recurringStartTime}`) < new Date() ? true : false)
                        : false;
                      const hrs = adjustTimelineData.recurringStartTime && adjustTimelineData.recurringEndTime
                        ? parseInt(adjustTimelineData.recurringEndTime.split(":")[0]) - parseInt(adjustTimelineData.recurringStartTime.split(":")[0])
                        : 0;
                      const recurringInvalid = pastError || !startStr || !adjustTimelineData.recurringStartTime || !adjustTimelineData.recurringEndTime || hrs <= 0
                        || adjustTimelineData.recurringDays.length === 0 || adjustTimelineData.recurringWeeks < 1;
                      return {
                        label: "Save & Send Alert",
                        onClick: async () => {
                          if (!recurringInvalid) await handleRescheduleSave();
                        },
                        disabled: recurringInvalid,
                      };
                    })()
                  : undefined
        }
      >
        {showAdjustTimelineDialog && (
          <RescheduleScheduleFlow
            data={adjustTimelineData}
            onChange={setAdjustTimelineData}
            currentView={adjustRescheduleView}
            onViewChange={(v) => setAdjustRescheduleView(v)}
            onDemandFormStep={onDemandFormStep}
            onDemandFormStepChange={setOnDemandFormStep}
            oneDayFormStep={oneDayFormStep}
            oneDayFormStepChange={setOneDayFormStep}
            recurringFormStep={recurringFormStep}
            recurringFormStepChange={setRecurringFormStep}
            scheduleError={adjustScheduleError}
            onScheduleErrorChange={setAdjustScheduleError}
            workersNeeded={showAdjustTimelineDialog.maxWorkersNeeded ?? 1}
            todayStr={new Date().toISOString().split("T")[0]}
            validateOnDemandTime={validateOnDemandTime}
            isValidScheduleTime={isValidScheduleTime}
          />
        )}
      </ResponsiveDialog>

      {/* Edit Job Dialog — ResponsiveDialog for breadcrumbed mobile popup */}
      <ResponsiveDialog
        open={!!showEditJobDialog}
        onOpenChange={(open) => !open && setShowEditJobDialog(null)}
        title={t("settings.editJob")}
        description={showEditJobDialog ? `Update job title and description for ${showEditJobDialog.title}` : undefined}
        contentClassName="max-w-lg"
        showBackButton
        onBack={() => setShowEditJobDialog(null)}
        backLabel="Back"
        footer={showEditJobDialog ? (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowEditJobDialog(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!showEditJobDialog || !editJobData.title?.trim()) return;
                const payload = { title: editJobData.title.trim(), description: editJobData.description || "" };
                const previous = { title: showEditJobDialog.title, description: showEditJobDialog.description || "" };
                updateJob(showEditJobDialog.id, payload);
                setSelectedJobDetails(prev => prev?.id === showEditJobDialog.id ? { ...prev, ...payload } : prev);
                try {
                  const res = await apiRequest("PATCH", `/api/company/jobs/${showEditJobDialog.id}`, payload);
                  if (res.ok) {
                    queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                    setShowEditJobDialog(null);
                    toast({ title: "Job Updated", description: "Job details have been updated." });
                  } else {
                    const data = await res.json().catch(() => ({}));
                    updateJob(showEditJobDialog.id, previous);
                    setSelectedJobDetails(prev => prev?.id === showEditJobDialog.id ? { ...prev, ...previous } : prev);
                    toast({ title: "Error", description: data.message || "Failed to update job", variant: "destructive" });
                  }
                } catch (err: any) {
                  updateJob(showEditJobDialog.id, previous);
                  setSelectedJobDetails(prev => prev?.id === showEditJobDialog.id ? { ...prev, ...previous } : prev);
                  toast({ title: "Error", description: err.message || "Failed to update job", variant: "destructive" });
                }
              }}
              disabled={!editJobData.title?.trim()}
              data-testid="button-save-edit-job"
            >
              Save Changes
            </Button>
          </div>
        ) : undefined}
      >
          {showEditJobDialog && (
            <div className="space-y-4">
                <div>
                  <Label>Job Title</Label>
                  <Input
                    value={editJobData.title}
                    onChange={(e) => setEditJobData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g., Kitchen Renovation"
                    data-testid="input-edit-job-title"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={editJobData.description}
                    onChange={(e) => setEditJobData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe the job..."
                    rows={4}
                    data-testid="input-edit-job-description"
                  />
                </div>
            </div>
          )}
      </ResponsiveDialog>

      {/* Adjust Workers Dialog — ResponsiveDialog for breadcrumbed mobile popup */}
      <ResponsiveDialog
        open={!!showIncreaseWorkersDialog}
        onOpenChange={(open) => !open && setShowIncreaseWorkersDialog(null)}
        title={t("settings.adjustWorkers")}
        description={showIncreaseWorkersDialog ? `Change the number of workers needed for ${showIncreaseWorkersDialog.title}. Current: ${showIncreaseWorkersDialog.workersHired} hired of ${showIncreaseWorkersDialog.maxWorkersNeeded} needed.` : undefined}
        contentClassName="max-w-md"
        showBackButton
        onBack={() => setShowIncreaseWorkersDialog(null)}
        backLabel="Back"
        footer={showIncreaseWorkersDialog ? (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowIncreaseWorkersDialog(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!showIncreaseWorkersDialog) return;
                const previousMax = showIncreaseWorkersDialog.maxWorkersNeeded;
                updateJob(showIncreaseWorkersDialog.id, { maxWorkersNeeded: workersCount });
                setSelectedJobDetails(prev => prev?.id === showIncreaseWorkersDialog.id ? { ...prev, maxWorkersNeeded: workersCount } : prev);
                try {
                  const res = await apiRequest("PATCH", `/api/company/jobs/${showIncreaseWorkersDialog.id}`, {
                    maxWorkersNeeded: workersCount,
                  });
                  if (res.ok) {
                    queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                    setShowIncreaseWorkersDialog(null);
                    toast({ title: "Workers Updated", description: `Job now requires ${workersCount} worker(s).` });
                  } else {
                    const data = await res.json().catch(() => ({}));
                    updateJob(showIncreaseWorkersDialog.id, { maxWorkersNeeded: previousMax });
                    setSelectedJobDetails(prev => prev?.id === showIncreaseWorkersDialog.id ? { ...prev, maxWorkersNeeded: previousMax } : prev);
                    toast({ title: "Error", description: data.message || "Failed to update", variant: "destructive" });
                  }
                } catch (err: any) {
                  updateJob(showIncreaseWorkersDialog.id, { maxWorkersNeeded: previousMax });
                  setSelectedJobDetails(prev => prev?.id === showIncreaseWorkersDialog.id ? { ...prev, maxWorkersNeeded: previousMax } : prev);
                  toast({ title: "Error", description: err.message || "Failed to update", variant: "destructive" });
                }
              }}
              data-testid="button-save-workers"
            >
              Save
            </Button>
          </div>
        ) : undefined}
      >
          {showIncreaseWorkersDialog && (
            <div className="space-y-4">
                <div>
                  <Label>Workers Needed</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setWorkersCount(c => Math.max(1, c - 1))}
                      disabled={workersCount <= 1}
                      data-testid="button-decrease-workers"
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="font-medium min-w-[2rem] text-center">{workersCount}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setWorkersCount(c => Math.min(20, c + 1))}
                      disabled={workersCount >= 20}
                      data-testid="button-increase-workers"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
            </div>
          )}
      </ResponsiveDialog>

      {/* Remove Job Confirmation */}
      <AlertDialog open={!!showRemoveJobDialog} onOpenChange={(open) => !open && setShowRemoveJobDialog(null)}>
        <AlertDialogContent>
          {showRemoveJobDialog && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Job</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to remove "{showRemoveJobDialog.title}"? This will cancel the job and notify any accepted workers. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    if (!showRemoveJobDialog) return;
                    const jobToRemove = showRemoveJobDialog;
                    const nextActionIndex = actionRequiredReopenAtRef.current;
                    removeJob(jobToRemove.id);
                    setShowRemoveJobDialog(null);
                    setShowJobDetailsFullView(false);
                    setSelectedJobDetails(null);
                    setSelectedJobLocation(null);
                    setMobileLocationPopup(null);
                    try {
                      const res = await apiRequest("PATCH", `/api/company/jobs/${jobToRemove.id}`, { status: "cancelled" });
                      if (res.ok) {
                        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                        toast({ title: "Job Removed", description: "The job has been cancelled." });
                        if (nextActionIndex != null) {
                          setActionRequiredItemIndex(nextActionIndex);
                          setShowPendingRequests(true);
                          actionRequiredReopenAtRef.current = null;
                        }
                      } else {
                        const data = await res.json().catch(() => ({}));
                        queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                        toast({ title: "Error", description: data.message || "Failed to remove job", variant: "destructive" });
                      }
                    } catch (err: any) {
                      queryClient.invalidateQueries({ queryKey: ["/api/company/jobs"] });
                      toast({ title: "Error", description: err.message || "Failed to remove job", variant: "destructive" });
                    }
                  }}
                  data-testid="button-confirm-remove-job"
                >
                  Remove Job
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!showTeamRequestPanel} onOpenChange={(open) => { if (!open) { setShowTeamRequestPanel(null); resetTeamRequestData(); } }}>
        <DialogContent className="max-w-full sm:max-w-lg md:max-w-2xl h-screen sm:h-auto sm:max-h-[90vh] m-0 sm:m-auto rounded-none sm:rounded-lg" aria-describedby="team-request-panel-desc">
          <DialogDescription id="team-request-panel-desc" className="sr-only">Step-by-step form to send a job request to worker</DialogDescription>
          {showTeamRequestPanel && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {teamRequestStep === 1 && "Step 1: Job Details"}
                  {teamRequestStep === 2 && "Step 2: Location & Schedule"}
                  {teamRequestStep === 3 && "Step 3: Review & Confirm"}
                </DialogTitle>
                <DialogDescription>
                  Send job request to {showTeamRequestPanel.worker.firstName} {showTeamRequestPanel.worker.lastName}
                </DialogDescription>
                <div className="flex items-center gap-2 mt-2">
                  {[1, 2, 3].map((step) => (
                    <div key={step} className={`h-2 flex-1 rounded-full transition-colors ${teamRequestStep >= step ? "bg-primary" : "bg-muted"}`} />
                  ))}
                </div>
              </DialogHeader>
              
              <ScrollArea className="flex-1 max-h-[60vh]">
                <div className="space-y-4 pr-4">
                  {/* Worker Info Card - shown on all steps */}
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <Avatar className="w-12 h-12">
                      <AvatarImage src={showTeamRequestPanel.worker.avatarUrl} />
                      <AvatarFallback>{showTeamRequestPanel.worker.firstName[0]}{showTeamRequestPanel.worker.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h3 className="font-semibold">{showTeamRequestPanel.worker.firstName} {showTeamRequestPanel.worker.lastName}</h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                        <span>{showTeamRequestPanel.worker.rating}</span>
                        <span>({showTeamRequestPanel.worker.completedJobs} jobs)</span>
                        <span className="font-medium">{formatRateWithMarkup(showTeamRequestPanel.worker.hourlyRate)}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Step 1: Job Details */}
                  {teamRequestStep === 1 && (
                    <div className="space-y-4">
                      <div>
                        <Label>Job Title <span className="text-destructive">*</span></Label>
                        <Input 
                          placeholder="e.g., Electrical Work - Building A" 
                          value={teamRequestData.jobTitle}
                          onChange={(e) => setTeamRequestData(prev => ({ ...prev, jobTitle: e.target.value }))}
                          data-testid="input-team-job-title" 
                        />
                      </div>
                      
                      <div>
                        <Label>Job Description <span className="text-destructive">*</span></Label>
                        <p className="text-sm text-muted-foreground mb-2">Describe the work you need done (minimum 30 characters)</p>
                        <Textarea 
                          placeholder="e.g., Need help installing new electrical outlets in a commercial building. Must run conduit and wire multiple circuits..." 
                          className="min-h-[120px]" 
                          value={teamRequestData.description}
                          onChange={(e) => setTeamRequestData(prev => ({ ...prev, description: e.target.value }))}
                          data-testid="input-team-job-description"
                        />
                        <div className="flex justify-between mt-2">
                          <span className={`text-sm ${teamRequestData.description.length < 30 ? "text-destructive" : "text-green-600"}`}>
                            {`${teamRequestData.description.length}/30`} minimum characters
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <Label>Skillsets Required</Label>
                        <p className="text-sm text-muted-foreground mb-2">Select the skills needed for this job</p>
                        <div className="flex flex-wrap gap-2 p-3 border rounded-lg">
                          {["Electrical", "Plumbing", "HVAC", "Carpentry", "Drywall", "Painting", "Concrete", "Demolition", "Cleaning", "Landscaping", "General Labor"].map(skill => (
                            <Badge
                              key={skill}
                              variant={teamRequestData.selectedSkillsets.includes(skill) ? "default" : "outline"}
                              className="cursor-pointer"
                              onClick={() => {
                                setTeamRequestData(prev => ({
                                  ...prev,
                                  selectedSkillsets: prev.selectedSkillsets.includes(skill)
                                    ? prev.selectedSkillsets.filter(s => s !== skill)
                                    : [...prev.selectedSkillsets, skill]
                                }));
                              }}
                              data-testid={`badge-team-skill-${skill}`}
                            >
                              {teamRequestData.selectedSkillsets.includes(skill) && <Check className="w-3 h-3 mr-1" />}
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Step 2: Location & Schedule */}
                  {teamRequestStep === 2 && (
                    <div className="space-y-4">
                      <div>
                        <Label>Location <span className="text-destructive">*</span></Label>
                        <Select 
                          value={teamRequestData.locationId}
                          onValueChange={(value) => {
                            if (value === "new") {
                              setShowLocations(true);
                            } else {
                              setTeamRequestData(prev => ({ ...prev, locationId: value }));
                            }
                          }}
                        >
                          <SelectTrigger data-testid="select-team-location">
                            <SelectValue placeholder="Select a location" />
                          </SelectTrigger>
                          <SelectContent>
                            {companyLocations.map((loc: any) => (
                              <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                            ))}
                            <SelectItem value="new">+ Add New Location</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label className="mb-2 block">Time Type <span className="text-destructive">*</span></Label>
                        <RadioGroup 
                          value={teamRequestData.shiftType} 
                          onValueChange={(value: "on-demand" | "one-day" | "recurring") => setTeamRequestData(prev => ({ ...prev, shiftType: value }))}
                          className="space-y-2"
                        >
                          <div className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${teamRequestData.shiftType === "on-demand" ? "border-primary bg-primary/5" : "border-border"}`}>
                            <RadioGroupItem value="on-demand" id="team-on-demand" className="mt-1" />
                            <label htmlFor="team-on-demand" className="flex-1 cursor-pointer">
                              <span className="font-medium">On-Demand (ASAP)</span>
                              <Badge variant="secondary" className="ml-2 text-xs">Recommended</Badge>
                              <p className="text-sm text-muted-foreground">Workers arrive within hours</p>
                            </label>
                          </div>
                          <div className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${teamRequestData.shiftType === "one-day" ? "border-primary bg-primary/5" : "border-border"}`}>
                            <RadioGroupItem value="one-day" id="team-one-day" className="mt-1" />
                            <label htmlFor="team-one-day" className="flex-1 cursor-pointer">
                              <span className="font-medium">One-Day Shift</span>
                              <p className="text-sm text-muted-foreground">Schedule for a specific date</p>
                            </label>
                          </div>
                          <div className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${teamRequestData.shiftType === "recurring" ? "border-primary bg-primary/5" : "border-border"}`}>
                            <RadioGroupItem value="recurring" id="team-recurring" className="mt-1" />
                            <label htmlFor="team-recurring" className="flex-1 cursor-pointer">
                              <span className="font-medium">Recurring Shifts</span>
                              <p className="text-sm text-muted-foreground">Set up a weekly schedule</p>
                            </label>
                          </div>
                        </RadioGroup>
                      </div>
                      
                      {(teamRequestData.shiftType === "one-day" || teamRequestData.shiftType === "recurring") && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Start Date</Label>
                            <Input 
                              type="date" 
                              value={teamRequestData.startDate}
                              onChange={(e) => setTeamRequestData(prev => ({ ...prev, startDate: e.target.value }))}
                            />
                          </div>
                          <div>
                            <Label>Estimated Hours</Label>
                            <Input 
                              type="number" 
                              placeholder="8" 
                              value={teamRequestData.estimatedHours}
                              onChange={(e) => setTeamRequestData(prev => ({ ...prev, estimatedHours: e.target.value }))}
                            />
                          </div>
                        </div>
                      )}
                      
                      {teamRequestData.shiftType === "one-day" && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Start Time</Label>
                            <Select
                              value={teamRequestData.startTime || "09:00"}
                              onValueChange={(v) => {
                                const validEnds = getValidEndTimeSlots(v);
                                const earliest = getEarliestEndTime(v);
                                setTeamRequestData(prev => ({
                                  ...prev,
                                  startTime: v,
                                  endTime: (prev.endTime && validEnds.includes(prev.endTime)) ? prev.endTime : earliest,
                                }));
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                              <SelectContent>
                                {getTimeSlots().map((slot) => (
                                  <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>End Time</Label>
                            <Select
                              value={teamRequestData.endTime || getEarliestEndTime(teamRequestData.startTime || "09:00")}
                              onValueChange={(v) => setTeamRequestData(prev => ({ ...prev, endTime: v }))}
                            >
                              <SelectTrigger><SelectValue placeholder="End" /></SelectTrigger>
                              <SelectContent>
                                {getValidEndTimeSlots(teamRequestData.startTime || "09:00").map((slot) => (
                                  <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                      
                      {teamRequestData.shiftType === "recurring" && (
                        <div className="space-y-4">
                          <div>
                            <Label className="mb-2 block">Recurring Days</Label>
                            <div className="flex flex-wrap gap-2">
                              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                                <Button
                                  key={day}
                                  type="button"
                                  size="sm"
                                  variant={teamRequestData.recurringDays.includes(day) ? "default" : "outline"}
                                  onClick={() => {
                                    setTeamRequestData(prev => ({
                                      ...prev,
                                      recurringDays: prev.recurringDays.includes(day) 
                                        ? prev.recurringDays.filter(d => d !== day)
                                        : [...prev.recurringDays, day]
                                    }));
                                  }}
                                >
                                  {day}
                                </Button>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Start Time</Label>
                              <Select
                                value={teamRequestData.startTime || "09:00"}
                                onValueChange={(v) => {
                                  const validEnds = getValidEndTimeSlots(v);
                                  const earliest = getEarliestEndTime(v);
                                  setTeamRequestData(prev => ({
                                    ...prev,
                                    startTime: v,
                                    endTime: (prev.endTime && validEnds.includes(prev.endTime)) ? prev.endTime : earliest,
                                  }));
                                }}
                              >
                                <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                                <SelectContent>
                                  {getTimeSlots().map((slot) => (
                                    <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>End Time</Label>
                              <Select
                                value={teamRequestData.endTime || getEarliestEndTime(teamRequestData.startTime || "09:00")}
                                onValueChange={(v) => setTeamRequestData(prev => ({ ...prev, endTime: v }))}
                              >
                                <SelectTrigger><SelectValue placeholder="End" /></SelectTrigger>
                                <SelectContent>
                                  {getValidEndTimeSlots(teamRequestData.startTime || "09:00").map((slot) => (
                                    <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div>
                            <Label>Number of Weeks</Label>
                            <Select 
                              value={teamRequestData.recurringWeeks.toString()} 
                              onValueChange={(value) => setTeamRequestData(prev => ({ ...prev, recurringWeeks: parseInt(value) }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                  <SelectItem key={n} value={n.toString()}>{n} week{n > 1 ? "s" : ""}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                      
                      {teamRequestData.shiftType === "on-demand" && (
                        <div>
                          <Label>Estimated Hours</Label>
                          <Input 
                            type="number" 
                            placeholder="8" 
                            value={teamRequestData.estimatedHours}
                            onChange={(e) => setTeamRequestData(prev => ({ ...prev, estimatedHours: e.target.value }))}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Step 3: Review & Confirm */}
                  {teamRequestStep === 3 && (
                    <div className="space-y-4">
                      <div className="p-4 bg-secondary/30 rounded-lg">
                        <h4 className="font-medium mb-3">Job Summary</h4>
                        
                        {/* Job title */}
                        {teamRequestData.jobTitle && (
                          <div className="mb-3 p-2 bg-primary/5 rounded border border-primary/20">
                            <p className="text-xs text-muted-foreground">Job Title</p>
                            <p className="font-semibold text-primary">{teamRequestData.jobTitle}</p>
                          </div>
                        )}
                        
                        <ul className="space-y-2 text-sm">
                          <li className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-green-500 mt-0.5" />
                            <div>
                              <span>Skillsets: </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {teamRequestData.selectedSkillsets.length > 0 ? teamRequestData.selectedSkillsets.map(skill => (
                                  <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                                )) : <Badge variant="secondary" className="text-xs">General Labor</Badge>}
                              </div>
                            </div>
                          </li>
                          <li className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-green-500" />
                            Location: <strong>{companyLocations.find((l: any) => l.id.toString() === teamRequestData.locationId)?.name || "Not selected"}</strong>
                          </li>
                          <li className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-green-500" />
                            Time Type: <strong>
                              {teamRequestData.shiftType === "on-demand" && "On-Demand (ASAP)"}
                              {teamRequestData.shiftType === "one-day" && "One-Day Shift"}
                              {teamRequestData.shiftType === "recurring" && "Recurring Shifts"}
                            </strong>
                          </li>
                          {teamRequestData.shiftType === "one-day" && teamRequestData.startDate && (
                            <li className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              Date: <strong>{new Date(teamRequestData.startDate).toLocaleDateString()}</strong>
                            </li>
                          )}
                          {teamRequestData.estimatedHours && (
                            <li className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              Estimated Hours: <strong>{teamRequestData.estimatedHours} hours</strong>
                            </li>
                          )}
                        </ul>
                      </div>
                      
                      {teamRequestData.description && (
                        <div className="p-3 border rounded-lg">
                          <Label className="text-sm text-muted-foreground">Job Description</Label>
                          <p className="text-sm mt-1">{teamRequestData.description}</p>
                        </div>
                      )}
                      
                      {/* 24-Hour Public Fallback - the key caveat */}
                      <div className="p-4 border-2 border-primary/30 rounded-lg bg-primary/5">
                        <div className="flex items-start gap-3">
                          <Checkbox 
                            id="team-fallback-checkbox" 
                            checked={teamRequestData.fallbackToPublic}
                            onCheckedChange={(checked) => setTeamRequestData(prev => ({ ...prev, fallbackToPublic: checked as boolean }))}
                            data-testid="checkbox-24hr-fallback"
                          />
                          <label htmlFor="team-fallback-checkbox" className="flex-1 cursor-pointer">
                            <span className="font-medium flex items-center gap-2">
                              <Clock className="w-4 h-4" />
                              24-Hour Public Fallback
                            </span>
                            <p className="text-sm text-muted-foreground mt-1">
                              If {showTeamRequestPanel.worker.firstName} doesn't accept within 24 hours, automatically post this job publicly so other qualified workers can apply.
                            </p>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              
              <DialogFooter className="flex gap-2">
                {teamRequestStep === 1 && (
                  <>
                    <Button variant="outline" onClick={() => { setShowTeamRequestPanel(null); resetTeamRequestData(); }}>{tCommon("cancel")}</Button>
                    <Button 
                      onClick={() => setTeamRequestStep(2)}
                      disabled={!teamRequestData.jobTitle.trim() || teamRequestData.description.length < 30}
                      data-testid="button-team-request-next-1"
                    >
                      Next <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </>
                )}
                {teamRequestStep === 2 && (
                  <>
                    <Button variant="outline" onClick={() => setTeamRequestStep(1)}>
                      <ArrowLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <Button 
                      onClick={() => setTeamRequestStep(3)}
                      disabled={!teamRequestData.locationId || !teamRequestData.shiftType}
                      data-testid="button-team-request-next-2"
                    >
                      Review <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </>
                )}
                {teamRequestStep === 3 && (
                  <>
                    <Button variant="outline" onClick={() => setTeamRequestStep(2)}>
                      <ArrowLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <Button 
                      onClick={() => {
                        toast({ title: "Request Sent", description: `Job request sent to ${showTeamRequestPanel.worker.firstName}.` });
                        setShowTeamRequestPanel(null);
                        resetTeamRequestData();
                      }}
                      data-testid="button-team-request-send"
                    >
                      <Send className="w-4 h-4 mr-2" /> Send Request
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNewJobModal} onOpenChange={setShowNewJobModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Post New Job</DialogTitle>
            <DialogDescription>Create a new job posting for your workers</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label>Job Title</Label>
              <Input placeholder="e.g., Plumbing Repair - Building A" data-testid="input-new-job-title" />
            </div>
            
            <div>
              <Label>Location</Label>
              <Select>
                <SelectTrigger data-testid="select-new-job-location">
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {companyLocations.length === 0 ? (
                    <SelectItem value="no-locations" disabled>No locations - add one first</SelectItem>
                  ) : (
                    companyLocations.map((loc: any) => (
                      <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                    ))
                  )}
                  <SelectItem value="new">+ Add New Location</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Trade/Skill Required</Label>
              <Select>
                <SelectTrigger data-testid="select-new-job-trade">
                  <SelectValue placeholder="Select trade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Electrical">Electrical</SelectItem>
                  <SelectItem value="Plumbing">Plumbing</SelectItem>
                  <SelectItem value="HVAC">HVAC</SelectItem>
                  <SelectItem value="Carpentry">Carpentry</SelectItem>
                  <SelectItem value="Painting">Painting</SelectItem>
                  <SelectItem value="Drywall">Drywall</SelectItem>
                  <SelectItem value="General Labor">General Labor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input type="date" data-testid="input-new-job-date" />
              </div>
              <div>
                <Label>Workers Needed</Label>
                <Input type="number" placeholder="1" min="1" data-testid="input-new-job-workers" />
              </div>
            </div>
            
            <div>
              <Label>Estimated Hours</Label>
              <Input type="number" placeholder="8" data-testid="input-new-job-hours" />
            </div>
            
            <div>
              <Label>Job Description</Label>
              <Textarea placeholder="Describe the work requirements..." className="min-h-[100px]" data-testid="input-new-job-description" />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewJobModal(false)}>Cancel</Button>
            <Button onClick={() => {
              toast({ title: "Job Posted", description: "Your job has been posted and workers will be notified." });
              setShowNewJobModal(false);
            }} data-testid="button-post-job">
              <Briefcase className="w-4 h-4 mr-2" /> Post Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResponsiveDialog open={showCompanyProfile} onOpenChange={(open) => { setShowCompanyProfile(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.companyProfileTitle")} description={t("settings.companyProfileDesc")} contentClassName="max-w-2xl max-h-[90vh]" showBackButton onBack={() => { setShowCompanyProfile(false); navigate("/company-dashboard/menu"); }} backLabel={t("settings.menu")} footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => { setShowCompanyProfile(false); navigate("/company-dashboard/menu"); }}>{tCommon("cancel")}</Button>
          <Button
            data-testid="button-save-profile"
            disabled={updateProfile.isPending}
            onClick={async () => {
              if (!profile) return;
              try {
                await updateProfile.mutateAsync({
                  id: profile.id,
                  data: {
                    companyName: companyProfileForm.companyName.trim() || undefined,
                    companyWebsite: companyProfileForm.companyWebsite.trim() || undefined,
                    firstName: companyProfileForm.firstName.trim() || undefined,
                    lastName: companyProfileForm.lastName.trim() || undefined,
                    email: (profile?.email ?? user?.email ?? companyProfileForm.email).trim() || undefined,
                    phone: companyProfileForm.phone.trim() || undefined,
                    alternateEmails,
                    alternatePhones,
                  },
                });
                setShowCompanyProfile(false);
                navigate("/company-dashboard/menu");
              } catch (e) {
                // Error toast is shown by updateProfile
              }
            }}
          >
            {updateProfile.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {t("settings.saveChanges")}
          </Button>
        </div>
      }>
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/30 overflow-hidden">
                {companyLogoUrl ? (
                  <img 
                    src={companyLogoUrl} 
                    alt="Company logo" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Image className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <Label>Company Logo</Label>
                <p className="text-sm text-muted-foreground mb-2">Upload your company logo (PNG, JPG up to 5MB)</p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  className="hidden"
                  id="logo-upload-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoUpload(file);
                    e.target.value = "";
                  }}
                  data-testid="input-logo-file"
                />
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={isUploadingLogo}
                  onClick={() => document.getElementById("logo-upload-input")?.click()}
                  data-testid="button-upload-logo"
                >
                  {isUploadingLogo ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
                  ) : (
                    <><Image className="w-4 h-4 mr-2" /> {companyLogoUrl ? "Change Logo" : "Upload Logo"}</>
                  )}
                </Button>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <Label>Company Name</Label>
              <Input value={companyProfileForm.companyName} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, companyName: e.target.value }))} data-testid="input-company-name" />
            </div>
            
            <div>
              <Label>Website</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="https://www.yourcompany.com" value={companyProfileForm.companyWebsite} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, companyWebsite: e.target.value }))} data-testid="input-company-website" />
              </div>
            </div>
            
            <Separator />
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name</Label>
                <Input value={companyProfileForm.firstName} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, firstName: e.target.value }))} data-testid="input-first-name" />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={companyProfileForm.lastName} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, lastName: e.target.value }))} data-testid="input-last-name" />
              </div>
            </div>
            
            <div>
              <Label>Primary Email</Label>
              <Input
                type="email"
                readOnly
                className="bg-muted cursor-not-allowed"
                value={profile?.email ?? user?.email ?? companyProfileForm.email}
                data-testid="input-email"
                aria-label="Primary email (login email, cannot be changed here)"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("settings.primaryEmailLoginNote")}</p>
            </div>
            
            <div>
              <Label>Primary Phone</Label>
              <Input type="tel" value={companyProfileForm.phone} onChange={(e) => setCompanyProfileForm(prev => ({ ...prev, phone: e.target.value }))} data-testid="input-phone" />
            </div>
            
            <Separator />
            
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Alternative Emails</Label>
              </div>
              <div className="space-y-2">
                {alternateEmails.map((email, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={email} readOnly className="flex-1" />
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => setAlternateEmails(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      className="pl-9"
                      type="email"
                      placeholder="Add alternative email"
                      value={newAlternateEmail}
                      onChange={(e) => setNewAlternateEmail(e.target.value)}
                      data-testid="input-alternate-email"
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      if (newAlternateEmail && newAlternateEmail.includes("@")) {
                        setAlternateEmails(prev => [...prev, newAlternateEmail]);
                        setNewAlternateEmail("");
                      }
                    }}
                    data-testid="button-add-alternate-email"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Alternative Phones</Label>
              </div>
              <div className="space-y-2">
                {alternatePhones.map((phone, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={phone} readOnly className="flex-1" />
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => setAlternatePhones(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      className="pl-9"
                      type="tel"
                      placeholder="Add alternative phone"
                      value={newAlternatePhone}
                      onChange={(e) => setNewAlternatePhone(e.target.value)}
                      data-testid="input-alternate-phone"
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      if (newAlternatePhone) {
                        setAlternatePhones(prev => [...prev, newAlternatePhone]);
                        setNewAlternatePhone("");
                      }
                    }}
                    data-testid="button-add-alternate-phone"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={showPaymentMethods}
        onOpenChange={(open) => {
          setShowPaymentMethods(open);
          if (!open) {
            navigate("/company-dashboard/menu");
            setPaymentMethodsView("list");
            setEditPaymentMethodLocations(null);
          }
        }}
        title={paymentMethodsView === "assignLocations" ? t("settings.assignLocations", "Assign Locations") : t("settings.paymentMethodsTitle")}
        description={paymentMethodsView === "assignLocations" ? "Choose which locations use this payment method for billing. If a location's payment method fails, we'll retry with your default (primary) method. You must have a default payment method." : t("settings.paymentMethodsDescription")}
        contentClassName="max-w-lg"
        showBackButton
        onBack={paymentMethodsView === "assignLocations" ? () => { setPaymentMethodsView("list"); setEditPaymentMethodLocations(null); } : () => { setShowPaymentMethods(false); navigate("/company-dashboard/menu"); }}
        backLabel={paymentMethodsView === "assignLocations" ? t("settings.paymentMethodsTitle") : t("settings.menu")}
        footer={paymentMethodsView === "assignLocations" ? (
          <div className="flex gap-2 w-full sm:justify-end">
            <Button variant="outline" onClick={() => { setPaymentMethodsView("list"); setEditPaymentMethodLocations(null); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (editPaymentMethodLocations) {
                  updatePaymentMethodLocationsMutation.mutate({
                    id: editPaymentMethodLocations.id,
                    locationIds: editPaymentMethodLocations.locationIds?.length ? editPaymentMethodLocations.locationIds : null,
                  });
                  setPaymentMethodsView("list");
                  setEditPaymentMethodLocations(null);
                }
              }}
              disabled={updatePaymentMethodLocationsMutation.isPending}
              data-testid="button-save-location-assignment"
            >
              {updatePaymentMethodLocationsMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
            </Button>
          </div>
        ) : <Button variant="outline" onClick={() => { setShowPaymentMethods(false); navigate("/company-dashboard/menu"); }}>{t("settings.close")}</Button>}
      >
        {paymentMethodsView === "assignLocations" && editPaymentMethodLocations ? (
          <div className="space-y-4">
            <ScrollArea className="max-h-[50vh]">
              <div className="space-y-2 p-1">
                <div
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${!editPaymentMethodLocations?.locationIds?.length ? "ring-2 ring-primary" : "hover-elevate"}`}
                  onClick={() => setEditPaymentMethodLocations(prev => prev ? { ...prev, locationIds: [] } : null)}
                  data-testid="option-all-locations"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${!editPaymentMethodLocations?.locationIds?.length ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {!editPaymentMethodLocations?.locationIds?.length && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                    </div>
                    <div>
                      <p className="font-medium">Use Primary Method</p>
                      <p className="text-xs text-muted-foreground">Bills from the primary payment method</p>
                    </div>
                  </div>
                </div>
                {companyLocations.length > 0 && (
                  <>
                    <div className="pt-2 pb-1">
                      <p className="text-xs font-medium text-muted-foreground">Or assign to specific locations:</p>
                    </div>
                    {companyLocations.map((loc: any) => {
                      const isSelected = editPaymentMethodLocations?.locationIds?.includes(loc.id.toString()) || false;
                      return (
                        <div
                          key={loc.id}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : "hover-elevate"}`}
                          onClick={() => {
                            setEditPaymentMethodLocations(prev => {
                              if (!prev) return null;
                              const currentIds = prev.locationIds || [];
                              if (isSelected) {
                                return { ...prev, locationIds: currentIds.filter(id => id !== loc.id.toString()) };
                              } else {
                                return { ...prev, locationIds: [...currentIds, loc.id.toString()] };
                              }
                            });
                          }}
                          data-testid={`option-location-${loc.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                            </div>
                            <div>
                              <p className="font-medium">{loc.name}</p>
                              <p className="text-xs text-muted-foreground">{loc.address}, {loc.city}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
            </div>
          </ScrollArea>
          <Button variant="outline" className="w-full border-dashed mt-4" onClick={() => { setPaymentMethodsView("list"); setEditPaymentMethodLocations(null); setShowPaymentMethods(false); setShowAddLocation(true); }}>
            <Plus className="w-4 h-4 mr-2" /> {t("settings.addNewLocation")}
          </Button>
        </div>
        ) : (
        <div className="space-y-4">
            <div className="space-y-3">
              {(() => {
                const paymentMethodsWithStripeId = (paymentMethods || []).filter((m: any) => !!(m.stripePaymentMethodId ?? m.stripe_payment_method_id));
                return paymentMethodsWithStripeId.map((method: any) => {
                const locationIdSet = new Set((method.locationIds || []).map((id: any) => String(id)));
                const assignedLocations = locationIdSet.size > 0
                  ? companyLocations.filter((loc: any) => locationIdSet.has(String(loc.id)))
                  : [];
                const cardBrandDisplay = method.cardBrand 
                  ? method.cardBrand.charAt(0).toUpperCase() + method.cardBrand.slice(1)
                  : "Card";
                return (
                  <Card key={method.id} className={`p-4 ${method.isPrimary ? 'ring-2 ring-primary' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {method.type === "card" ? (
                          <CreditCard className="w-8 h-8 text-muted-foreground shrink-0 mt-0.5" />
                        ) : (
                          <Landmark className="w-8 h-8 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">
                              {method.type === "card" 
                                ? `${cardBrandDisplay} ending in ${method.lastFour}`
                                : `${method.bankName || "Bank Account"} ending in ${method.lastFour}`
                              }
                            </p>
                            {method.isPrimary && <Badge variant="secondary" className="text-xs">Default</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {method.type === "card" 
                              ? "Credit/Debit Card (3.5% fee)"
                              : "ACH Bank Account (No fee)"
                            }
                          </p>
                          {assignedLocations.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {assignedLocations.map((loc: any) => (
                                <Badge key={loc.id} variant="outline" className="text-xs font-normal">
                                  <MapPin className="w-3 h-3 mr-0.5" />
                                  {loc.name}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`button-edit-payment-${method.id}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          container={typeof document !== "undefined" ? document.getElementById("dialog-container") ?? undefined : undefined}
                          onFocusOutside={(e) => {
                            const dialogEl = document.getElementById("dialog-container");
                            if (dialogEl && e.target && dialogEl.contains(e.target as Node)) e.preventDefault();
                          }}
                        >
                          {!method.isPrimary && (
                            <DropdownMenuItem
                              onClick={() => setPrimaryPaymentMethodMutation.mutate(method.id)}
                              disabled={setPrimaryPaymentMethodMutation.isPending}
                              data-testid={`menu-set-primary-${method.id}`}
                            >
                              Set as Default
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              setEditPaymentMethodLocations({ id: method.id, locationIds: (method.locationIds || []).map((id: any) => String(id)) });
                              setPaymentMethodsView("assignLocations");
                            }}
                            data-testid={`menu-assign-locations-${method.id}`}
                          >
                            Assign to Locations
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deletePaymentMethodMutation.mutate(method.id)}
                            disabled={deletePaymentMethodMutation.isPending || (!!method.isPrimary && paymentMethodsWithStripeId.length === 1)}
                            data-testid={`button-remove-payment-${method.id}`}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                );
              });
              })()}
            </div>
            
            <Button variant="outline" className="w-full border-dashed" onClick={() => setShowStripeAddPaymentMethod(true)} data-testid="button-add-payment-method">
              <Plus className="w-4 h-4 mr-2" /> Add New Payment Method
            </Button>
          </div>
        )}
      </ResponsiveDialog>

      {/* Global pop-up: sign company agreement (styled like company onboarding). Blocking — must sign to continue. */}
      <Dialog
        open={showMandatoryAgreement}
        onOpenChange={() => {}}
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden px-[14px]"
          hideCloseButton
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>{t("company.onboarding.signPlatformAgreement")}</DialogTitle>
            <DialogDescription>
              {t("company.onboarding.mustSignServiceAgreement")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col gap-4 px-6 pb-6 overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-stone-950 rounded-2xl shadow-lg overflow-hidden border border-gray-200 dark:border-stone-700">
              <div className="h-1.5 bg-gray-800 dark:bg-stone-600" />
              <div className="relative flex-1 min-h-0 flex flex-col">
                <div
                  ref={mandatoryContractRef}
                  className="relative p-6 md:p-10 overflow-y-auto flex-1 min-h-0"
                >
                  <div className="max-w-none text-stone-900 dark:text-stone-100" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                    <pre className="whitespace-pre-wrap text-xs md:text-sm leading-relaxed" style={{ fontFamily: "'Times New Roman', Times, serif", color: "inherit" }}>
                      {COMPANY_AGREEMENT_TEXT}
                    </pre>
                  </div>
                </div>
                <div className="border-t-2 border-stone-200 dark:border-stone-700 bg-stone-50/80 dark:bg-stone-900/80 p-2 md:p-3 shrink-0">
                  <div
                    className={`p-2.5 text-center relative transition-all bg-white dark:bg-stone-900 rounded-lg ${
                      mandatorySignatureName.trim()
                        ? "border-2 border-stone-900 dark:border-stone-100"
                        : "border-2 border-dashed border-stone-300 dark:border-stone-600"
                    }`}
                  >
                    {mandatorySignatureName.trim() ? (
                      <div className="space-y-0.5">
                        <p className="text-lg italic text-stone-900 dark:text-stone-100" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                          {mandatorySignatureName.trim()}
                        </p>
                        <div className="border-t border-stone-400 dark:border-stone-500 pt-0.5 mt-1 mx-auto max-w-[160px]">
                          <p className="text-[10px] text-stone-600 dark:text-stone-400">
                            Date: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMandatorySignatureName("")}
                          className="absolute top-1 right-1 text-xs text-stone-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[10px] text-stone-600 dark:text-stone-400">{t("company.agreement.typeFullLegalName")}</p>
                        <Input
                          value={mandatorySignatureName}
                          onChange={(e) => setMandatorySignatureName(e.target.value)}
                          className="text-center text-base italic max-w-xs mx-auto h-8 text-sm"
                          style={{ fontFamily: "'Brush Script MT', cursive" }}
                          placeholder={[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || (profile as any)?.companyName || "Your full name"}
                          data-testid="input-mandatory-signature"
                        />
                        <div className="border-t border-stone-300 dark:border-stone-600 mx-auto max-w-[160px]" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800 dark:bg-stone-600" />
            </div>
            {mandatoryAgreementError && (
              <p className="text-sm text-destructive">{mandatoryAgreementError}</p>
            )}
          </div>
          <DialogFooter className="px-6 pb-6 pt-0 shrink-0">
            <Button
              className="px-[14px]"
              disabled={!mandatorySignatureName.trim()}
              onClick={async () => {
                setMandatoryAgreementError(null);
                try {
                  // 1. Update profile so company is marked as having signed (persisted to DB)
                  await apiRequest("PUT", `/api/profiles/${profile!.id}`, {
                    contractSigned: true,
                    contractSignedAt: new Date().toISOString(),
                    signatureData: mandatorySignatureName.trim(),
                  });
                  // 2. Store the signed agreement in company_agreements (Menu → Agreements can show it)
                  await apiRequest("POST", "/api/company-agreements", {
                    agreementType: "hiring_agreement",
                    version: "1.0",
                    signedName: mandatorySignatureName.trim(),
                    signatureData: mandatorySignatureName.trim(),
                    agreementText: COMPANY_AGREEMENT_TEXT,
                  });
                  // 3. Refresh profile in cache so hasSignedAgreement is true and popup never shows again
                  const profileQueryKey = profileMeQueryKey(user?.id);
                  queryClient.invalidateQueries({ queryKey: profileQueryKey });
                  queryClient.setQueryData(profileQueryKey, (prev: unknown) => {
                    if (prev && typeof prev === "object" && "contractSigned" in prev) {
                      return { ...prev, contractSigned: true, contractSignedAt: new Date().toISOString() };
                    }
                    return prev;
                  });
                  queryClient.invalidateQueries({ queryKey: ["company-agreements"] });
                  setShowMandatoryAgreement(false);
                  setMandatorySignatureName("");
                  toast({ title: t("company.agreement.agreementSigned"), description: t("company.agreement.thankYouForSigning") });
                } catch (err: any) {
                  setMandatoryAgreementError(err?.message || "Failed to save. Please try again.");
                }
              }}
            >
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top Up Balance dialog - select payment method and amount to charge */}
      <Dialog open={showBalanceDialog} onOpenChange={(open) => {
          setShowBalanceDialog(open);
          if (open) {
            setTopUpAmount("250");
            setTopUpPaymentError(null);
            setLastFailedPaymentMethodId(null);
          } else {
            setTopUpAmount("");
            setTopUpPaymentError(null);
            setLastFailedPaymentMethodId(null);
          }
        }}>
        <DialogContent className="max-w-md flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>{t("company.payment.topUpTitle")}</DialogTitle>
            <DialogDescription>{t("company.payment.topUpDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            {topUpPaymentError && (
              <Alert variant="destructive" className="mb-2">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Payment failed</AlertTitle>
                <AlertDescription>
                  <span className="block mb-2">{topUpPaymentError}</span>
                  <span className="block text-sm">You can:</span>
                  <ul className="list-disc list-inside mt-1 text-sm space-y-0.5">
                    <li>Select another payment method above and click Add Funds</li>
                    <li>Add a new payment method (choose &quot;+ New payment method&quot; above)</li>
                    <li>Click Retry to try again with the same method</li>
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="top-up-amount">{t("company.payment.amountToCharge")}</Label>
              <div className="flex flex-wrap gap-2 mt-1.5 mb-2">
                {[250, 750, 1500, 3000].map((amt) => (
                  <Button
                    key={amt}
                    type="button"
                    variant={topUpAmount === String(amt) ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTopUpAmount(String(amt))}
                    data-testid={`button-top-up-amount-${amt}`}
                  >
                    ${amt}
                  </Button>
                ))}
              </div>
              <Input
                id="top-up-amount"
                type="number"
                min="100"
                step="1"
                placeholder="250"
                value={topUpAmount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                  setTopUpAmount(v);
                  setTopUpPaymentError(null);
                }}
                data-testid="input-top-up-amount"
              />
              {topUpAmount && parseFloat(topUpAmount) < 100 && (
                <p className="text-xs text-muted-foreground mt-1">{t("company.payment.minAmount")}</p>
              )}
            </div>
            <div>
              <Label>{t("company.payment.selectPaymentMethod")}</Label>
              {(() => {
                const usableMethods = (paymentMethods || []).filter((m: any) => {
                  const type = m.type ?? m.payment_method_type;
                  const verified = m.isVerified ?? m.is_verified;
                  return type === "card" || (type === "ach" && verified);
                });
                const handlePaymentMethodChange = (v: string) => {
                  setTopUpPaymentError(null);
                  setLastFailedPaymentMethodId(null);
                  if (v === "__new__") {
                    setSelectedPaymentMethod(null);
                    previousPaymentMethodIdsRef.current = (paymentMethods || []).map((m: any) => m.id);
                    addPaymentOpenedFromTopUpRef.current = true;
                    // Defer opening the dialog so the Select can close first and avoid Radix focus loop (stack overflow)
                    setTimeout(() => setShowStripeAddPaymentMethod(true), 0);
                    return;
                  }
                  setSelectedPaymentMethod(v ? parseInt(v, 10) : null);
                };
                return (
              <Select
                value={selectedPaymentMethod?.toString() ?? ""}
                onValueChange={handlePaymentMethodChange}
              >
                <SelectTrigger data-testid="select-top-up-payment-method">
                  <SelectValue placeholder={t("company.payment.selectPaymentMethod")} />
                </SelectTrigger>
                <SelectContent>
                  {usableMethods.map((method: any) => {
                    const cardBrandDisplay = method.cardBrand ? method.cardBrand.charAt(0).toUpperCase() + method.cardBrand.slice(1) : t("common.card", "Card");
                    const label = method.type === "card"
                      ? t("settings.cardEndingIn", { brand: cardBrandDisplay, lastFour: method.lastFour })
                      : t("settings.bankEndingIn", { bank: method.bankName || t("settings.bankAccount"), lastFour: method.lastFour });
                    return (
                      <SelectItem key={method.id} value={method.id.toString()}>
                        {label}
                      </SelectItem>
                    );
                  })}
                  <SelectItem value="__new__" data-testid="option-top-up-new-payment-method">
                    + New payment method
                  </SelectItem>
                </SelectContent>
              </Select>
                );
              })()}
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 pt-0 shrink-0">
            <Button variant="outline" onClick={() => { setShowBalanceDialog(false); setTopUpAmount(""); setTopUpPaymentError(null); setLastFailedPaymentMethodId(null); }}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={
                !topUpAmount ||
                parseFloat(topUpAmount) < 100 ||
                !selectedPaymentMethod ||
                (fundBalanceMutation.isPending || cardTopUpMutation.isPending)
              }
              onClick={() => {
                const amountCents = Math.round(parseFloat(topUpAmount) * 100);
                if (isNaN(amountCents) || amountCents < 10000) return;
                const method = paymentMethods.find((m: any) => m.id === selectedPaymentMethod) as any;
                if (!method) return;
                const type = method.type ?? method.payment_method_type;
                const stripePmId = method.stripePaymentMethodId ?? method.stripe_payment_method_id;
                if (type === "card" && stripePmId) {
                  cardTopUpMutation.mutate({
                    amountCents,
                    paymentMethodId: method.id,
                    stripePaymentMethodId: stripePmId,
                  });
                } else if (type === "ach") {
                  fundBalanceMutation.mutate({ amountCents, paymentMethodId: method.id });
                } else {
                  toast({ title: t("company.payment.paymentFailed"), description: "No valid payment method. Add a card or verified bank account.", variant: "destructive" });
                }
              }}
              data-testid="button-top-up-submit"
            >
              {(fundBalanceMutation.isPending || cardTopUpMutation.isPending) ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
              ) : topUpPaymentError && selectedPaymentMethod === lastFailedPaymentMethodId ? (
                t("company.payment.retry", "Retry")
              ) : (
                t("company.deposit")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Global pop-up: add a payment method. Shown only when: no stored payment methods at all, or unpaid/failed payment. If company has a valid card (or any verified method), we do not show—they can verify banks in Menu → Payment settings. Not exitable — only closes after adding a valid payment method. */}
      <Dialog open={showBankVerificationModal} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-md px-[14px]"
          hideCloseButton
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              Add a payment method
            </DialogTitle>
            <DialogDescription>
              {hasUnpaidFailedItems || paymentFailedTrigger ? (
                <>A payment was attempted and failed. Add a new payment method or update your existing one. Once added, we will retry your unpaid items.</>
              ) : globalPaymentModalView === "verify-list" ? (
                <>Your bank account(s) need verification. Enter the micro-deposit amounts (in cents) shown on your bank statement, or add a credit card for instant validation.</>
              ) : (
                <>Add a credit card to get started right away, or link a bank account. Bank accounts can be used once Stripe verifies them. You need at least one valid payment method to continue.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {connectStripeError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{connectStripeError}</div>
            )}
            {globalPaymentModalView === "verify-list" && (
              <>
                <div className="space-y-3">
                  {(paymentMethods || []).filter((m: any) => (m.type ?? m.payment_method_type) === "ach" && !(m.isVerified ?? m.is_verified)).map((m: any) => (
                    <InlineBankVerifyCard
                      key={m.id}
                      paymentMethod={m}
                      stripePromise={stripePromise}
                      onSuccess={async () => {
                        setJustAddedPaymentMethod(true);
                        setPaymentFailedTrigger(false);
                        setConnectStripeError(null);
                        queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                        await refetchPaymentMethods();
                        invalidateSessionProfileQueries(queryClient);
                        await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                        toast({ title: "Bank verified", description: "Your bank account is now ready to use." });
                      }}
                      onError={(err) => setConnectStripeError(err)}
                    />
                  ))}
                </div>
                <div className="pt-2 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => {
                      setConnectStripeError(null);
                      setGlobalPaymentModalView("embed");
                    }}
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Add card for instant validation
                  </Button>
                </div>
              </>
            )}
            {globalPaymentModalView === "embed" && stripePromise && connectStripeClientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret: connectStripeClientSecret, appearance: { theme: "stripe" } }}>
                <ConnectStripeBankForm
                  clientSecret={connectStripeClientSecret}
                  onSuccess={async () => {
                    paymentMethodAddedAtRef.current = Date.now();
                    setJustAddedPaymentMethod(true);
                    setPaymentFailedTrigger(false);
                    setConnectStripeClientSecret(null);
                    setConnectStripeError(null);
                    // Refetch so payment methods tab and list show the new method; server already set it as primary
                    queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                    await refetchPaymentMethods();
                    invalidateSessionProfileQueries(queryClient);
                    await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                    const hadFailed = (realTimesheets || []).some((ts: any) => ts.status === "approved" && (ts.paymentStatus === "failed" || ts.payment_status === "failed"));
                    if (hadFailed) {
                      try {
                        const res = await apiRequest("POST", "/api/timesheets/retry-failed-payments", {});
                        const data = await res.json().catch(() => ({}));
                        if (res.ok && data?.retried > 0) {
                          queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                          toast({ title: "Payment method added", description: `Retrying ${data.retried} failed payment(s). Workers will be paid once the charge completes.` });
                        } else {
                          toast({ title: "Payment method added", description: "Your bank or card has been saved. Go to Timesheets to retry any failed payments." });
                        }
                      } catch {
                        toast({ title: "Payment method added", description: "Your bank or card has been saved. Banks can be used once Stripe verifies them." });
                      }
                    } else {
                      toast({ title: "Payment method added", description: "Your bank or card has been saved. Banks can be used once Stripe verifies them." });
                    }
                  }}
                  onError={(err) => setConnectStripeError(err)}
                />
              </Elements>
            ) : globalPaymentModalView === "embed" && !connectStripeError ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading payment form...</span>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <ResponsiveDialog
        open={showStripeAddPaymentMethod}
        onOpenChange={(open) => {
          setShowStripeAddPaymentMethod(open);
          if (open) {
            setAddPaymentStep(1);
            setAddedPaymentMethodId(null);
            setAddPaymentLocationIds([]);
          } else {
            setConnectStripeClientSecret(null);
            setConnectStripeError(null);
            setAddPaymentStep(1);
            setAddedPaymentMethodId(null);
            setAddPaymentLocationIds([]);
          }
        }}
        title={addPaymentStep === 2 ? (t("company.locations.assignToLocations") || "Assign to locations") : t("settings.addPaymentMethodTitle")}
        description={addPaymentStep === 2 ? "Optionally assign this payment method to specific locations. Leave unassigned to use as primary for all locations." : "Add a bank account or card. Banks can be used once Stripe verifies them. Securely powered by Stripe."}
        contentClassName="max-w-md min-h-[90dvh] sm:min-h-0"
        showBackButton
        onBack={() => {
          if (addPaymentStep === 2) {
            setAddPaymentStep(1);
            setAddedPaymentMethodId(null);
            setAddPaymentLocationIds([]);
          } else {
            setShowStripeAddPaymentMethod(false);
            setConnectStripeClientSecret(null);
            setConnectStripeError(null);
          }
        }}
        backLabel="Back"
      >
        <div className="space-y-4">
          {addPaymentStep === 2 ? (
            <>
              <p className="text-sm text-muted-foreground">Choose which locations use this payment method for billing. Locations not assigned use the primary method.</p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
                <div
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${addPaymentLocationIds.length === 0 ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
                  onClick={() => setAddPaymentLocationIds([])}
                  data-testid="option-all-locations-new-pm"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${addPaymentLocationIds.length === 0 ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {addPaymentLocationIds.length === 0 && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                    </div>
                    <div>
                      <p className="font-medium">Use as primary (all locations)</p>
                      <p className="text-xs text-muted-foreground">No specific location assignment</p>
                    </div>
                  </div>
                </div>
                {companyLocations.length > 0 && (
                  <>
                    <div className="pt-2 pb-1">
                      <p className="text-xs font-medium text-muted-foreground">Or assign to specific locations:</p>
                    </div>
                    {companyLocations.map((loc: any) => {
                      const isSelected = addPaymentLocationIds.includes(loc.id.toString());
                      return (
                        <div
                          key={loc.id}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
                          onClick={() => {
                            setAddPaymentLocationIds((prev) =>
                              isSelected ? prev.filter((id) => id !== loc.id.toString()) : [...prev, loc.id.toString()]
                            );
                          }}
                          data-testid={`option-location-new-pm-${loc.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                            </div>
                            <div>
                              <p className="font-medium">{loc.name}</p>
                              <p className="text-xs text-muted-foreground">{loc.address}, {loc.city}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={async () => {
                    setJustAddedPaymentMethod(true);
                    setPaymentFailedTrigger(false);
                    queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                    await refetchPaymentMethods();
                    queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
                    await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                    setShowStripeAddPaymentMethod(false);
                    setAddPaymentStep(1);
                    setAddedPaymentMethodId(null);
                    setAddPaymentLocationIds([]);
                    toast({ title: "Payment method added", description: "Your bank or card has been saved. Banks can be used once Stripe verifies them." });
                  }}
                >
                  Skip
                </Button>
                <Button
                  className="flex-1"
                  disabled={updatePaymentMethodLocationsMutation.isPending || addedPaymentMethodId == null}
                  onClick={async () => {
                    if (addedPaymentMethodId == null) return;
                    updatePaymentMethodLocationsMutation.mutate(
                      { id: addedPaymentMethodId, locationIds: addPaymentLocationIds.length > 0 ? addPaymentLocationIds : null },
                      {
                        onSuccess: async () => {
                          setJustAddedPaymentMethod(true);
                          setPaymentFailedTrigger(false);
                          queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                          await refetchPaymentMethods();
                          queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
                          await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                          setShowStripeAddPaymentMethod(false);
                          setAddPaymentStep(1);
                          setAddedPaymentMethodId(null);
                          setAddPaymentLocationIds([]);
                          toast({ title: "Payment method added", description: "Your payment method has been saved and assigned to the selected locations." });
                        },
                      }
                    );
                  }}
                  data-testid="button-done-assign-locations"
                >
                  {updatePaymentMethodLocationsMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Done"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {connectStripeError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{connectStripeError}</div>
              )}
              {stripePromise && connectStripeClientSecret ? (
                <Elements stripe={stripePromise} options={{ clientSecret: connectStripeClientSecret, appearance: { theme: "stripe" } }}>
                  <ConnectStripeBankForm
                    clientSecret={connectStripeClientSecret}
                    onSuccess={async (data) => {
                      // Clear Stripe client secret immediately so Elements don't reuse consumed SetupIntent (avoids 400 from Stripe)
                      setConnectStripeClientSecret(null);
                      if (data?.paymentMethodId != null) {
                        setConnectStripeError(null);
                        queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                        const { data: listAfterRefetch } = await refetchPaymentMethods();
                        queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
                        await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                        // If GET filtered out the new method (e.g. transient Stripe/customer mismatch), retry once so menu panel shows it
                        const list = Array.isArray(listAfterRefetch) ? listAfterRefetch : [];
                        const hasNew = list.some((m: any) => Number(m.id) === Number(data.paymentMethodId));
                        if (!hasNew && list.length >= 0) {
                          setTimeout(async () => {
                            const { data: listRetry } = await refetchPaymentMethods();
                            const retryList = Array.isArray(listRetry) ? listRetry : [];
                            if (!retryList.some((m: any) => Number(m.id) === Number(data.paymentMethodId))) {
                              queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                              await refetchPaymentMethods();
                            }
                          }, 1200);
                        }
                        setAddPaymentStep(2);
                        setAddedPaymentMethodId(data.paymentMethodId);
                        setAddPaymentLocationIds([]);
                        return;
                      }
                      setJustAddedPaymentMethod(true);
                      setPaymentFailedTrigger(false);
                      setConnectStripeClientSecret(null);
                      setConnectStripeError(null);
                      queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                      await refetchPaymentMethods();
                      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
                      await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                      setShowStripeAddPaymentMethod(false);
                      if (addPaymentOpenedFromTopUpRef.current) {
                        addPaymentOpenedFromTopUpRef.current = false;
                        const prevSet = new Set(previousPaymentMethodIdsRef.current.map((id) => Number(id)));
                        const newList = (queryClient.getQueryData(["/api/company/payment-methods"]) as any[]) || [];
                        const addedList = newList.filter((m: any) => !prevSet.has(Number(m.id)));
                        const added = addedList.length > 0 ? addedList.sort((a: any, b: any) => (b.id ?? 0) - (a.id ?? 0))[0] : null;
                        if (added) setTimeout(() => setSelectedPaymentMethod(Number(added.id)), 0);
                      }
                      if (addPaymentOpenedFromAddLocationRef.current) {
                        addPaymentOpenedFromAddLocationRef.current = false;
                        const prevSet = new Set(previousPaymentMethodIdsRef.current.map((id) => Number(id)));
                        const newList = (queryClient.getQueryData(["/api/company/payment-methods"]) as any[]) || [];
                        const addedList = newList.filter((m: any) => !prevSet.has(Number(m.id)));
                        const added = addedList.length > 0 ? addedList.sort((a: any, b: any) => (b.id ?? 0) - (a.id ?? 0))[0] : null;
                        if (added) setTimeout(() => setNewLocation(prev => ({ ...prev, paymentMethodId: Number(added.id) })), 0);
                      }
                      const hadFailed = (realTimesheets || []).some((ts: any) => ts.status === "approved" && (ts.paymentStatus === "failed" || ts.payment_status === "failed"));
                      if (hadFailed) {
                        try {
                          const res = await apiRequest("POST", "/api/timesheets/retry-failed-payments", {});
                          const dataRes = await res.json().catch(() => ({}));
                          if (res.ok && dataRes?.retried > 0) {
                            queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                            toast({ title: "Payment method added", description: `Retrying ${dataRes.retried} failed payment(s). Workers will be paid once the charge completes.` });
                          } else {
                            toast({ title: "Payment method added", description: "Your bank or card has been saved. Go to Timesheets to retry any failed payments." });
                          }
                        } catch {
                          toast({ title: "Payment method added", description: "Your bank or card has been saved. Banks can be used once Stripe verifies them." });
                        }
                      } else {
                        toast({ title: "Payment method added", description: "Your bank or card has been saved. Banks can be used once Stripe verifies them." });
                      }
                    }}
                    onError={(err) => setConnectStripeError(err)}
                  />
                </Elements>
              ) : !connectStripeError ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Loading payment form...</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ResponsiveDialog>

      <Dialog open={!!bankVerificationMethod} onOpenChange={(open) => { if (!open) setBankVerificationMethod(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.verifyBankAccount", "Verify bank account")}</DialogTitle>
            <DialogDescription>
              {t("settings.verifyBankDescription", "Enter the micro-deposit amounts (in cents) shown on your bank statement to verify this account.")}
            </DialogDescription>
          </DialogHeader>
          {bankVerificationMethod && stripePromise && (
            <InlineBankVerifyCard
              paymentMethod={bankVerificationMethod}
              stripePromise={stripePromise}
              onSuccess={async () => {
                setBankVerificationMethod(null);
                queryClient.invalidateQueries({ queryKey: ["/api/company/payment-methods"] });
                await refetchPaymentMethods();
                queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
                await queryClient.refetchQueries({ queryKey: ["/api/profile"] });
                toast({ title: t("settings.bankVerified", "Bank verified"), description: t("settings.bankVerifiedDescription", "Your bank account is now ready to use.") });
              }}
              onError={(err) => {
                if (!err) return;
                const { title, description } = humanizePaymentError(err);
                toast({ title, description, variant: "destructive" });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Locations is now a breadcrumb view inside Payment Methods ResponsiveDialog — this Dialog is no longer used */}
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Locations</DialogTitle>
            <DialogDescription>
              Choose which locations use this payment method for billing. Locations not assigned to any method use the default payment method.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2 p-1">
              <div 
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${!editPaymentMethodLocations?.locationIds?.length ? "ring-2 ring-primary" : "hover-elevate"}`}
                onClick={() => setEditPaymentMethodLocations(prev => prev ? { ...prev, locationIds: [] } : null)}
                data-testid="option-all-locations"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${!editPaymentMethodLocations?.locationIds?.length ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                    {!editPaymentMethodLocations?.locationIds?.length && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </div>
                  <div>
                    <p className="font-medium">Use Primary Method</p>
                    <p className="text-xs text-muted-foreground">Bills from the primary payment method</p>
                  </div>
                </div>
              </div>
              
              {companyLocations.length > 0 && (
                <>
                  <div className="pt-2 pb-1">
                    <p className="text-xs font-medium text-muted-foreground">Or assign to specific locations:</p>
                  </div>
                  {companyLocations.map((loc: any) => {
                    const isSelected = editPaymentMethodLocations?.locationIds?.includes(loc.id.toString()) || false;
                    return (
                      <div 
                        key={loc.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : "hover-elevate"}`}
                        onClick={() => {
                          setEditPaymentMethodLocations(prev => {
                            if (!prev) return null;
                            const currentIds = prev.locationIds || [];
                            if (isSelected) {
                              return { ...prev, locationIds: currentIds.filter(id => id !== loc.id.toString()) };
                            } else {
                              return { ...prev, locationIds: [...currentIds, loc.id.toString()] };
                            }
                          });
                        }}
                        data-testid={`option-location-${loc.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                          </div>
                          <div>
                            <p className="font-medium">{loc.name}</p>
                            <p className="text-xs text-muted-foreground">{loc.address}, {loc.city}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPaymentMethodLocations(null)}>Cancel</Button>
            <Button 
              onClick={() => {
                if (editPaymentMethodLocations) {
                  updatePaymentMethodLocationsMutation.mutate({
                    id: editPaymentMethodLocations.id,
                    locationIds: editPaymentMethodLocations.locationIds?.length ? editPaymentMethodLocations.locationIds : null,
                  });
                }
              }}
              disabled={updatePaymentMethodLocationsMutation.isPending}
              data-testid="button-save-location-assignment"
            >
              {updatePaymentMethodLocationsMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showAddPaymentMethod} onOpenChange={(open) => {
        setShowAddPaymentMethod(open);
        if (!open) {
          setAchForm({ routingNumber: "", accountNumber: "", accountType: "Checking", bankName: "" });
          setAddPaymentMethodType("ach");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Payment Method</DialogTitle>
            <DialogDescription>Choose how you'd like to fund your account</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Payment Method Toggle */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAddPaymentMethodType("ach")}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  addPaymentMethodType === "ach"
                    ? "border-primary bg-primary/5"
                    : "border-border hover-elevate"
                }`}
                data-testid="button-add-payment-ach"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Landmark className={`w-4 h-4 ${addPaymentMethodType === "ach" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="font-medium text-sm">ACH Bank Transfer</span>
                </div>
                <p className="text-xs text-muted-foreground">No fees</p>
              </button>
              <button
                type="button"
                onClick={() => setAddPaymentMethodType("card")}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  addPaymentMethodType === "card"
                    ? "border-primary bg-primary/5"
                    : "border-border hover-elevate"
                }`}
                data-testid="button-add-payment-card"
              >
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className={`w-4 h-4 ${addPaymentMethodType === "card" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="font-medium text-sm">Credit/Debit Card</span>
                </div>
                <p className="text-xs text-muted-foreground">3.5% surcharge</p>
              </button>
            </div>
            
            {addPaymentMethodType === "ach" && (
              <>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input 
                      id="bankName"
                      placeholder="e.g., Chase, Bank of America"
                      value={achForm.bankName}
                      onChange={(e) => setAchForm(prev => ({ ...prev, bankName: e.target.value }))}
                      data-testid="input-bank-name"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="routingNumber">Routing Number</Label>
                    <Input 
                      id="routingNumber"
                      placeholder="9 digits"
                      maxLength={9}
                      value={achForm.routingNumber}
                      onChange={(e) => setAchForm(prev => ({ ...prev, routingNumber: e.target.value.replace(/\D/g, '') }))}
                      data-testid="input-routing-number"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="accountNumber">Account Number</Label>
                    <Input 
                      id="accountNumber"
                      placeholder="Your bank account number"
                      value={achForm.accountNumber}
                      onChange={(e) => setAchForm(prev => ({ ...prev, accountNumber: e.target.value.replace(/\D/g, '') }))}
                      data-testid="input-account-number"
                    />
                  </div>
                  
                  <div>
                    <Label>Account Type</Label>
                    <RadioGroup 
                      value={achForm.accountType} 
                      onValueChange={(value) => setAchForm(prev => ({ ...prev, accountType: value }))}
                      className="flex gap-4 mt-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="Checking" id="checking" />
                        <Label htmlFor="checking" className="cursor-pointer">Checking</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="Savings" id="savings" />
                        <Label htmlFor="savings" className="cursor-pointer">Savings</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
                
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    Your bank account information is securely transmitted via Modern Treasury's ACH platform. 
                    We never store your full account number.
                  </p>
                </div>
              </>
            )}
            
            {addPaymentMethodType === "card" && (
              <>
                {stripePromise && profile?.id ? (
                  <Elements stripe={stripePromise}>
                    <AddCardForm
                      onSuccess={async () => {
                        setJustAddedPaymentMethod(true);
                        setPaymentFailedTrigger(false);
                        setShowAddPaymentMethod(false);
                        setAddPaymentMethodType("ach");
                        await queryClient.refetchQueries({ queryKey: ["/api/company/payment-methods"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                        const hadFailed = (realTimesheets || []).some((ts: any) => ts.status === "approved" && (ts.paymentStatus === "failed" || ts.payment_status === "failed"));
                        if (hadFailed) {
                          try {
                            const res = await apiRequest("POST", "/api/timesheets/retry-failed-payments", {});
                            const data = await res.json().catch(() => ({}));
                            if (res.ok && data?.retried > 0) {
                              queryClient.invalidateQueries({ queryKey: ["/api/timesheets/company"] });
                              toast({ title: "Card saved", description: `Retrying ${data.retried} failed payment(s).` });
                            } else {
                              toast({ title: "Card saved", description: "Go to Timesheets to retry any failed payments." });
                            }
                          } catch {
                            toast({ title: "Card saved", description: "Your card has been added." });
                          }
                        } else {
                          toast({ title: "Card saved", description: "Your card has been added." });
                        }
                      }}
                      onError={(error) => {
                        if (!error) return;
                        const { title, description } = humanizePaymentError(error);
                        toast({ title, description, variant: "destructive" });
                      }}
                    />
                  </Elements>
                ) : (
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <Loader2 className="w-8 h-8 text-muted-foreground mx-auto mb-3 animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading card form...</p>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPaymentMethod(false)}>Cancel</Button>
            {addPaymentMethodType === "ach" && (
              <Button 
                disabled={!achForm.routingNumber || achForm.routingNumber.length !== 9 || !achForm.accountNumber || addPaymentMethodMutation.isPending}
                onClick={() => addPaymentMethodMutation.mutate(achForm)}
                data-testid="button-add-bank-account"
              >
                {addPaymentMethodMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Adding...</>
                ) : (
                  <><Plus className="w-4 h-4 mr-2" /> Add Bank Account</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite teammate: global ResponsiveDialog (bottom-up on mobile). Multi-step: 0=list, 1=Details, 2=Permissions, 3=Location (optional). */}
      <ResponsiveDialog
        open={showTeamAccess || showAddTeammateFromLocation}
        onOpenChange={(open) => {
          if (!open) {
            const wasFromLocation = showAddTeammateFromLocation;
            setShowTeamAccess(false);
            setShowAddTeammateFromLocation(false);
            setInviteWizardStep(0);
            setInviteData({ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", role: "manager", locationIds: [] });
            if (!wasFromLocation) navigate("/company-dashboard/menu");
          }
        }}
        title={
          inviteWizardStep === 0 ? t("company.team.teamAccess", "Team Access") :
          inviteWizardStep === 1 ? t("company.team.inviteTeamMember", "Invite Team Member") + " — " + (t("company.team.details", "Details") || "Details") :
          inviteWizardStep === 2 ? t("company.team.inviteTeamMember", "Invite Team Member") + " — " + (t("company.team.permissions", "Permissions") || "Permissions") :
          t("company.team.inviteTeamMember", "Invite Team Member") + " — " + (t("company.team.locationOptional", "Location (optional)") || "Location (optional)")
        }
        description={
          inviteWizardStep === 0 ? undefined :
          inviteWizardStep === 1 ? t("company.team.enterDetailsToInvite", "Enter their details") :
          inviteWizardStep === 2 ? (t("company.team.choosePermissions", "Choose their access level") || "Choose their access level") :
          (t("company.team.attachToLocations", "Optionally attach them to company locations") || "Optionally attach them to company locations")
        }
        contentClassName={`max-w-lg ${inviteWizardStep >= 1 ? "max-h-[85vh]" : ""}`}
        showBackButton
        onBack={
          inviteWizardStep === 0 ? () => { setShowTeamAccess(false); setShowAddTeammateFromLocation(false); setInviteWizardStep(0); navigate("/company-dashboard/menu"); } :
          inviteWizardStep === 1 ? () => { if (showAddTeammateFromLocation) { setShowAddTeammateFromLocation(false); setInviteWizardStep(0); } else setInviteWizardStep(0); } :
          inviteWizardStep === 2 ? () => setInviteWizardStep(1) :
          () => setInviteWizardStep(2)
        }
        backLabel={
          inviteWizardStep === 0 ? "Menu" :
          inviteWizardStep === 1 ? (showAddTeammateFromLocation ? tCommon("cancel") : "Team") : tCommon("back")
        }
        footer={
          inviteWizardStep === 1 ? (
            <div className="flex gap-3 w-full px-[22px]">
              <Button variant="outline" onClick={() => { if (showAddTeammateFromLocation) { setShowAddTeammateFromLocation(false); setInviteWizardStep(0); } else setInviteWizardStep(0); }} className="flex-1">{showAddTeammateFromLocation ? tCommon("cancel") : tCommon("back")}</Button>
              <Button onClick={() => setInviteWizardStep(2)} disabled={!inviteData.email} className="flex-1">{tCommon("next")}</Button>
            </div>
          ) : inviteWizardStep === 2 ? (
            <div className="flex gap-3 w-full px-[22px]">
              <Button variant="outline" onClick={() => setInviteWizardStep(1)} className="flex-1">{tCommon("back")}</Button>
              <Button onClick={() => setInviteWizardStep(3)} className="flex-1">{tCommon("next")}</Button>
            </div>
          ) : inviteWizardStep === 3 ? (
            <div className="flex gap-3 w-full px-[22px]">
              <Button variant="outline" onClick={() => setInviteWizardStep(2)} className="flex-1">{tCommon("back")}</Button>
              <Button
                onClick={() => createTeamInvite.mutate(
                  { email: inviteData.email, role: inviteData.role, firstName: inviteData.firstName || undefined, lastName: inviteData.lastName || undefined, phone: inviteData.phone || undefined, jobPosition: inviteData.jobPosition || undefined, locationIds: inviteData.locationIds?.length ? inviteData.locationIds : undefined },
                  { onSuccess: () => { setInviteWizardStep(0); setInviteData({ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", role: "manager", locationIds: [] }); setShowTeamAccess(false); setShowAddTeammateFromLocation(false); queryClient.invalidateQueries({ queryKey: ["/api/team-members"] }); queryClient.invalidateQueries({ queryKey: ["/api/team-by-location"] }); navigate("/company-dashboard/menu"); } }
                )}
                disabled={!inviteData.email || createTeamInvite.isPending}
                className="flex-1"
                data-testid="button-dialog-send-invite"
              >
                {createTeamInvite.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> {t("company.team.sendInvite", "Send Invite")}</>}
              </Button>
            </div>
          ) : undefined
        }
      >
          <div className="space-y-4 py-1">
              {inviteWizardStep === 0 ? (
                <>
                  <div>
                    <h4 className="font-medium mb-3">Current Team Members</h4>
                    <div className="space-y-2">
                      <Card className="p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback>{profile?.firstName?.charAt(0)}{profile?.lastName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{profile?.firstName} {profile?.lastName}</p>
                              <p className="text-sm text-muted-foreground">{profile?.email}</p>
                            </div>
                          </div>
                          <Badge>{t("settings.owner")}</Badge>
                        </div>
                      </Card>
                      
                      {teamMembers.map((member: any) => (
                        <Card key={member.id} className="p-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar>
                                <AvatarFallback>{member.firstName?.charAt(0)}{member.lastName?.charAt(0)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="font-medium truncate">{member.firstName} {member.lastName}</p>
                                <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                                {member.locationIds?.length > 0 && (
                                  <p className="text-xs text-muted-foreground">{member.locationIds.length} location{member.locationIds.length !== 1 ? "s" : ""}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{member.role}</Badge>
                              {member.role !== "owner" && (
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  className="text-destructive"
                                  onClick={() => deleteTeamMember.mutate(member.id)}
                                  data-testid={`button-remove-member-${member.id}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                  
                  {teamInvites.filter((inv: any) => inv.status === "pending").length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h4 className="font-medium mb-3">Pending Invites</h4>
                        <div className="space-y-2">
                          {teamInvites.filter((inv: any) => inv.status === "pending").map((invite: any) => (
                            <Card key={invite.id} className="p-3">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-3 min-w-0">
                                  <Avatar>
                                    <AvatarFallback>{invite.firstName?.[0] || invite.email.charAt(0).toUpperCase()}{invite.lastName?.[0] || ""}</AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <p className="font-medium text-sm truncate">{invite.firstName ? `${invite.firstName} ${invite.lastName || ""}`.trim() : invite.email}</p>
                                    {invite.firstName && <p className="text-xs text-muted-foreground truncate">{invite.email}</p>}
                                    <p className="text-xs text-muted-foreground">
                                      Expires {invite.expiresAt ? format(new Date(invite.expiresAt), "MMM d") : "in 7 days"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">{invite.role}</Badge>
                                  <Button 
                                    size="icon" 
                                    variant="ghost"
                                    disabled={resendTeamInvite.isPending}
                                    onClick={() => resendTeamInvite.mutate(invite.id)}
                                    data-testid={`button-resend-invite-${invite.id}`}
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-destructive"
                                    onClick={() => deleteTeamInvite.mutate(invite.id)}
                                    data-testid={`button-revoke-invite-${invite.id}`}
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                  
                  <Button 
                    className="w-full"
                    onClick={() => setInviteWizardStep(1)}
                    data-testid="button-start-invite"
                  >
                    <Plus className="w-4 h-4 mr-2" /> Invite Team Member
                  </Button>
                </>
              ) : (
                <>
                  {/* Step 1: Details */}
                  {inviteWizardStep === 1 && (
                    <div className="space-y-4">
                      <div>
                        <Label>{t("company.team.role", "Role")}</Label>
                        <Input
                          placeholder="e.g. Project Manager, Foreman"
                          value={inviteData.jobPosition}
                          onChange={(e) => setInviteData(prev => ({ ...prev, jobPosition: e.target.value }))}
                          data-testid="input-dialog-jobposition"
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("company.team.theirJobPosition", "Their job position or title")}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{t("common.firstName", "First Name")}</Label>
                          <Input
                            placeholder="John"
                            value={inviteData.firstName}
                            onChange={(e) => setInviteData(prev => ({ ...prev, firstName: e.target.value }))}
                            data-testid="input-dialog-firstname"
                          />
                        </div>
                        <div>
                          <Label>{t("common.lastName", "Last Name")}</Label>
                          <Input
                            placeholder="Smith"
                            value={inviteData.lastName}
                            onChange={(e) => setInviteData(prev => ({ ...prev, lastName: e.target.value }))}
                            data-testid="input-dialog-lastname"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>{t("common.email", "Email")} *</Label>
                        <Input
                          type="email"
                          placeholder="john@company.com"
                          value={inviteData.email}
                          onChange={(e) => setInviteData(prev => ({ ...prev, email: e.target.value }))}
                          data-testid="input-dialog-email"
                        />
                      </div>
                      <div>
                        <Label>{t("common.phone", "Phone")}</Label>
                        <Input
                          type="tel"
                          placeholder="(555) 123-4567"
                          value={inviteData.phone}
                          onChange={(e) => setInviteData(prev => ({ ...prev, phone: e.target.value }))}
                          data-testid="input-dialog-phone"
                        />
                      </div>
                    </div>
                  )}
                  {/* Step 2: Permissions */}
                  {inviteWizardStep === 2 && (
                    <div className="space-y-4">
                      <Label>{t("company.team.permissions", "Permissions")}</Label>
                      <div className="space-y-2 mt-2">
                        {[
                          { value: "admin", label: "Admin", desc: "Full access to all features including billing and team management" },
                          { value: "manager", label: "Manager", desc: "Can post jobs, manage applications, and approve timesheets" },
                          { value: "viewer", label: "Viewer", desc: "Can view jobs and timesheets but cannot make changes" },
                        ].map((role) => (
                          <div
                            key={role.value}
                            className={`flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors ${inviteData.role === role.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                            onClick={() => setInviteData(prev => ({ ...prev, role: role.value as "admin" | "manager" | "viewer" }))}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${inviteData.role === role.value ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                              {inviteData.role === role.value && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{role.label}</p>
                              <p className="text-xs text-muted-foreground">{role.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Step 3: Location selection (optional) */}
                  {inviteWizardStep === 3 && (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">{t("company.team.attachToLocationsDesc", "Optionally attach this teammate to one or more company locations. They will only see jobs and data for selected locations.")}</p>
                      {teamByLocation.filter((l: { id: number | null }) => l.id != null).length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("company.team.noLocationsYet", "No locations yet. You can add locations from the Locations menu.")}</p>
                      ) : (
                        <div className="space-y-2">
                          {teamByLocation.filter((loc: { id: number | null }) => loc.id != null).map((loc) => (
                            <div
                              key={loc.id}
                              className={`flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors ${inviteData.locationIds?.includes(String(loc.id)) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                              onClick={() => setInviteData(prev => ({
                                ...prev,
                                locationIds: prev.locationIds?.includes(String(loc.id))
                                  ? (prev.locationIds ?? []).filter((id) => id !== String(loc.id))
                                  : [...(prev.locationIds ?? []), String(loc.id)],
                              }))}
                            >
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${inviteData.locationIds?.includes(String(loc.id)) ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {inviteData.locationIds?.includes(String(loc.id)) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm">{loc.name || loc.address || String(loc.id)}</p>
                                {(loc.address || loc.city || loc.state) && (
                                  <p className="text-xs text-muted-foreground truncate">{[loc.address, loc.city, loc.state].filter(Boolean).join(", ")}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
      </ResponsiveDialog>

      <ResponsiveDialog open={showNotifications} onOpenChange={(open) => { setShowNotifications(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("notifications.settings")} description={t("notifications.chooseHow")} contentClassName="max-w-lg max-h-[90vh]" showBackButton onBack={() => { setShowNotifications(false); navigate("/company-dashboard/menu"); }} backLabel="Menu" footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => { setShowNotifications(false); navigate("/company-dashboard/menu"); }}>{t("notifications.cancel")}</Button>
          <Button onClick={async () => {
            if (profile) {
              try {
                await updateProfile.mutateAsync({
                  id: profile.id,
                  data: {
                    emailNotifications: notificationSettings.emailNotifications,
                    smsNotifications: notificationSettings.smsNotifications,
                    pushNotifications: notificationSettings.pushNotifications,
                    notifyNewJobs: notificationSettings.emailNewApplications || notificationSettings.smsNewApplications || notificationSettings.pushNewApplications,
                    notifyJobUpdates: notificationSettings.emailTimesheets || notificationSettings.smsTimesheets || notificationSettings.pushTimesheets,
                    notifyPayments: notificationSettings.emailPayments || notificationSettings.smsPayments || notificationSettings.pushPayments,
                    notifyMessages: notificationSettings.emailMessages || notificationSettings.smsMessages || notificationSettings.pushMessages,
                  },
                });
                toast({ title: t("notifications.updated"), description: t("notifications.updatedDesc") });
                setShowNotifications(false);
                navigate("/company-dashboard/menu");
              } catch (error: any) {
                toast({ title: "Error", description: error.message || "Failed to save notification settings", variant: "destructive" });
              }
            }
          }} data-testid="button-save-notifications">{t("notifications.saveChanges")}</Button>
        </div>
      }>
        <div className="space-y-6">
            <div>
              <h4 className="font-medium mb-3">{t("notifications.emailNotifications")}</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.newWorkerApplications")}</Label>
                  <Switch 
                    checked={notificationSettings.emailNewApplications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, emailNewApplications: checked }))}
                    data-testid="switch-email-applications"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.timesheetSubmissions")}</Label>
                  <Switch 
                    checked={notificationSettings.emailTimesheets}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, emailTimesheets: checked }))}
                    data-testid="switch-email-timesheets"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.paymentConfirmations")}</Label>
                  <Switch 
                    checked={notificationSettings.emailPayments}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, emailPayments: checked }))}
                    data-testid="switch-email-payments"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium mb-3">{t("notifications.smsNotifications")}</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.newWorkerApplications")}</Label>
                  <Switch 
                    checked={notificationSettings.smsNewApplications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, smsNewApplications: checked }))}
                    data-testid="switch-sms-applications"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.timesheetSubmissions")}</Label>
                  <Switch 
                    checked={notificationSettings.smsTimesheets}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, smsTimesheets: checked }))}
                    data-testid="switch-sms-timesheets"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.paymentConfirmations")}</Label>
                  <Switch 
                    checked={notificationSettings.smsPayments}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, smsPayments: checked }))}
                    data-testid="switch-sms-payments"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium mb-3">{t("notifications.pushNotifications")}</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.newWorkerApplications")}</Label>
                  <Switch 
                    checked={notificationSettings.pushNewApplications && notificationSettings.pushNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, pushNewApplications: checked }))}
                    disabled={!notificationSettings.pushNotifications}
                    data-testid="switch-push-applications"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.timesheetSubmissions")}</Label>
                  <Switch 
                    checked={notificationSettings.pushTimesheets && notificationSettings.pushNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, pushTimesheets: checked }))}
                    disabled={!notificationSettings.pushNotifications}
                    data-testid="switch-push-timesheets"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.paymentConfirmations")}</Label>
                  <Switch 
                    checked={notificationSettings.pushPayments && notificationSettings.pushNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, pushPayments: checked }))}
                    disabled={!notificationSettings.pushNotifications}
                    data-testid="switch-push-payments"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium mb-3">{t("notifications.messages")}</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.messages")}</Label>
                  <Switch 
                    checked={notificationSettings.emailMessages && notificationSettings.emailNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, emailMessages: checked }))}
                    disabled={!notificationSettings.emailNotifications}
                    data-testid="switch-email-messages"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.messages")}</Label>
                  <Switch 
                    checked={notificationSettings.smsMessages && notificationSettings.smsNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, smsMessages: checked }))}
                    disabled={!notificationSettings.smsNotifications}
                    data-testid="switch-sms-messages"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t("notifications.messages")}</Label>
                  <Switch 
                    checked={notificationSettings.pushMessages && notificationSettings.pushNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, pushMessages: checked }))}
                    disabled={!notificationSettings.pushNotifications}
                    data-testid="switch-push-messages"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <Label className="text-sm font-medium">{t("notifications.enableAllEmail")}</Label>
                <p className="text-xs text-muted-foreground">{t("notifications.masterToggleEmail")}</p>
              </div>
              <Switch 
                checked={notificationSettings.emailNotifications}
                onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, emailNotifications: checked }))}
                data-testid="switch-email-all"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <Label className="text-sm font-medium">{t("notifications.enableAllSMS")}</Label>
                <p className="text-xs text-muted-foreground">{t("notifications.masterToggleSMS")}</p>
              </div>
              <Switch 
                checked={notificationSettings.smsNotifications}
                onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, smsNotifications: checked }))}
                data-testid="switch-sms-all"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <Label className="text-sm font-medium">{t("notifications.enableAllPush")}</Label>
                <p className="text-xs text-muted-foreground">{t("notifications.masterTogglePush")}</p>
              </div>
              <Switch 
                checked={notificationSettings.pushNotifications}
                onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, pushNotifications: checked }))}
                data-testid="switch-push-all"
              />
            </div>
            <Separator />
            <div>
              <h4 className="font-medium mb-2">{t("notifications.connectedDevices")}</h4>
              <p className="text-sm text-muted-foreground mb-3">{t("notifications.connectedDevicesDesc")}</p>
              <div className="space-y-2">
                {/* Mock connected devices - in production this would come from an API */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Monitor className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Chrome - Windows</p>
                      <p className="text-xs text-muted-foreground">{t("notifications.thisDevice")} • {t("notifications.lastActive")}: {format(new Date(), 'MMM d, h:mm a')}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">Active</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">iPhone 14 Pro</p>
                      <p className="text-xs text-muted-foreground">{t("notifications.lastActive")}: Jan 15, 2:30 PM</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid="button-remove-device-1">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog open={showHiringPreferences} onOpenChange={(open) => { setShowHiringPreferences(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.hiringPreferences")} description={t("industries.selectIndustries")} contentClassName="max-w-lg max-h-[90vh]" showBackButton onBack={() => { setShowHiringPreferences(false); navigate("/company-dashboard/menu"); }} backLabel="Menu" footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => { setShowHiringPreferences(false); navigate("/company-dashboard/menu"); }}>{tCommon("cancel")}</Button>
          <Button onClick={() => { if (!profile) return; updateProfile.mutate({ id: profile.id, data: { hiringIndustries: selectedIndustries } }, { onSuccess: () => { setShowHiringPreferences(false); navigate("/company-dashboard/menu"); toast({ title: t("industries.savedPreferences", "Hiring preferences saved") }); } }); }} disabled={updateProfile.isPending || !profile} data-testid="button-save-hiring-prefs">{tCommon("save")}</Button>
        </div>
      }>
        <div className="space-y-4">
          {INDUSTRY_CATEGORIES.map((industry) => {
              const isSelected = selectedIndustries.includes(industry.id);
              const IconComponent = industry.icon;
              return (
                <Card 
                  key={industry.id}
                  className={`p-4 cursor-pointer hover-elevate transition-colors ${isSelected ? "border-primary bg-primary/5" : ""}`}
                  onClick={() => {
                    setSelectedIndustries(prev => 
                      isSelected 
                        ? prev.filter(id => id !== industry.id)
                        : [...prev, industry.id]
                    );
                  }}
                  data-testid={`dialog-industry-${industry.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{industry.label}</h4>
                        <Checkbox checked={isSelected} />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {industry.roles.map(r => r.label).join(", ")}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog open={showBillingHistory} onOpenChange={(open) => { setShowBillingHistory(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.billingHistoryTitle")} description={t("settings.billingHistoryDescription")} contentClassName="max-w-4xl max-h-[90vh]" showBackButton onBack={() => { setShowBillingHistory(false); navigate("/company-dashboard/menu"); }} backLabel={t("settings.menu")} footer={<Button variant="outline" onClick={() => { setShowBillingHistory(false); navigate("/company-dashboard/menu"); }}>{t("settings.close")}</Button>}>
          <div className="space-y-4">
            {/* Funding/Spend tabs */}
            <Tabs value={billingFilters.category} onValueChange={(v) => setBillingFilters(prev => ({ ...prev, category: v as "all" | "funding" | "spend" }))}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="funding">Funding</TabsTrigger>
                <TabsTrigger value="spend">Spend</TabsTrigger>
              </TabsList>
            </Tabs>
            
            <div className="flex flex-wrap items-end gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <Label className="text-xs">From Date</Label>
                <Input 
                  type="date" 
                  value={billingFilters.dateFrom}
                  onChange={(e) => setBillingFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                  className="w-40"
                  data-testid="input-billing-date-from"
                />
              </div>
              <div>
                <Label className="text-xs">To Date</Label>
                <Input 
                  type="date" 
                  value={billingFilters.dateTo}
                  onChange={(e) => setBillingFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                  className="w-40"
                  data-testid="input-billing-date-to"
                />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={billingFilters.type} onValueChange={(v) => setBillingFilters(prev => ({ ...prev, type: v }))}>
                  <SelectTrigger className="w-40" data-testid="select-billing-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="charge">Worker Payments</SelectItem>
                    <SelectItem value="deposit">Deposits</SelectItem>
                    <SelectItem value="auto_recharge">Auto-Recharge</SelectItem>
                    <SelectItem value="refund">Refunds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Worker</Label>
                <Select value={billingFilters.worker} onValueChange={(v) => setBillingFilters(prev => ({ ...prev, worker: v }))}>
                  <SelectTrigger className="w-40" data-testid="select-billing-worker">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Workers</SelectItem>
                    {billingWorkers.map((worker) => (
                      <SelectItem key={worker.id} value={worker.id.toString()}>{worker.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                variant="outline" 
                onClick={() => setBillingFilters({ dateFrom: "", dateTo: "", type: "all", worker: "all", category: "all" })}
                data-testid="button-billing-clear-filters"
              >
                Clear Filters
              </Button>
            </div>
            
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-8 gap-4 p-3 bg-muted text-sm font-medium">
                <div>Date & Time</div>
                <div>Type</div>
                <div>Method</div>
                <div>Worker</div>
                <div>Job</div>
                <div className="text-right">Hours</div>
                <div className="text-right">Amount</div>
                <div className="text-center">Receipt</div>
              </div>
              <ScrollArea className="h-[400px]">
                {billingHistoryLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : billingHistoryData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <CreditCard className="w-10 h-10 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No billing history yet</p>
                    <p className="text-sm text-muted-foreground">Transactions will appear here after workers complete jobs</p>
                  </div>
                ) : (
                  billingHistoryData.map((item) => (
                    <div key={item.id} className="grid grid-cols-8 gap-4 p-3 border-t items-center text-sm">
                      <div className="text-muted-foreground">
                        <div>{format(new Date(item.date), 'MMM d, yyyy')}</div>
                        <div className="text-xs">{format(new Date(item.date), 'h:mm a')}</div>
                      </div>
                      <div>
                        <Badge variant={item.type === "charge" ? "secondary" : item.type === "deposit" ? "default" : "outline"}>
                          {item.type === "charge" ? "Payment" : item.type === "auto_recharge" ? "Auto-Recharge" : item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                        </Badge>
                      </div>
                      <div>
                        {item.paymentMethod === "card" ? (
                          <Badge variant="outline" className="gap-1">
                            <CreditCard className="w-3 h-3" /> Card
                          </Badge>
                        ) : item.paymentMethod === "ach" ? (
                          <Badge variant="outline" className="gap-1">
                            <Building2 className="w-3 h-3" /> ACH
                          </Badge>
                        ) : item.paymentMethod === "platform" ? (
                          <span className="text-xs text-muted-foreground">Platform</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </div>
                      <div>
                        {item.workerName ? (
                          item.timesheetId ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-0 h-auto font-normal text-primary hover:underline"
                              onClick={() => {
                                setShowBillingHistory(false);
                                setActiveTab("timesheets");
                              }}
                              data-testid={`button-billing-worker-${item.workerId}`}
                            >
                              {item.workerName}
                            </Button>
                          ) : (
                            <span>{item.workerName}</span>
                          )
                        ) : "-"}
                      </div>
                      <div className="truncate">
                        {item.jobTitle ? (
                          item.jobId ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-0 h-auto font-normal text-left truncate block max-w-full text-primary hover:underline"
                              onClick={() => {
                                setShowBillingHistory(false);
                                setActiveTab("jobs");
                              }}
                              data-testid={`button-billing-job-${item.jobId}`}
                            >
                              {item.jobTitle}
                            </Button>
                          ) : (
                            <span className="truncate">{item.jobTitle}</span>
                          )
                        ) : "-"}
                      </div>
                      <div className="text-right">
                        {item.hours ? (
                          item.timesheetId ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-0 h-auto font-normal text-primary hover:underline"
                              onClick={() => {
                                setShowBillingHistory(false);
                                setActiveTab("timesheets");
                              }}
                              data-testid={`button-billing-timesheet-${item.timesheetId}`}
                            >
                              {item.hours}h
                            </Button>
                          ) : (
                            `${item.hours}h`
                          )
                        ) : "-"}
                      </div>
                      <div className={`text-right font-medium ${item.amount > 0 ? "text-green-600" : ""}`}>
                        {(() => {
                          // Fix for amounts stored incorrectly (divided by 10)
                          // If it's a deposit/auto_recharge and the amount seems too small, try multiplying by 10
                          let amountInCents = item.amount;
                          if ((item.type === "deposit" || item.type === "auto_recharge") && Math.abs(item.amount) > 0) {
                            // Check if amount seems too small (less than $100 for deposits, which is unusual)
                            // If multiplying by 10 gives a more reasonable amount, use that
                            const correctedAmount = Math.round(item.amount * 10);
                            // Only apply correction if original amount is suspiciously small (< $100) 
                            // and corrected amount is more reasonable (>= $100)
                            if (Math.abs(item.amount) < 10000 && Math.abs(correctedAmount) >= 10000) {
                              amountInCents = correctedAmount;
                            }
                          }
                          
                          const baseAmount = Math.abs(amountInCents / 100);
                          const cardFeeAmount = ((item.cardFee || 0) / 100);
                          const totalCharged = baseAmount + cardFeeAmount;
                          
                          if (item.paymentMethod === "card" && cardFeeAmount > 0) {
                            return (
                              <div>
                                <div>{item.amount > 0 ? "+" : ""}${baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                <div className="text-xs text-muted-foreground">
                                  (${totalCharged.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} charged)
                                </div>
                              </div>
                            );
                          }
                          return <>{item.amount > 0 ? "+" : ""}${baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
                        })()}
                      </div>
                      <div className="text-center">
                        {(item.stripePaymentIntentId || item.mtPaymentOrderId) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              const typeLabels: Record<string, string> = {
                                deposit: "Balance Deposit",
                                charge: "Worker Payment",
                                auto_recharge: "Auto-Replenishment",
                                refund: "Refund",
                              };
                              // Fix for amounts stored incorrectly (divided by 10)
                              let amountInCents = item.amount;
                              if ((item.type === "deposit" || item.type === "auto_recharge") && Math.abs(item.amount) > 0) {
                                const correctedAmount = Math.round(item.amount * 10);
                                if (Math.abs(item.amount) < 10000 && Math.abs(correctedAmount) >= 10000) {
                                  amountInCents = correctedAmount;
                                }
                              }
                              
                              const baseAmount = Math.abs(amountInCents / 100);
                              const cardFeeAmount = ((item.cardFee || 0) / 100);
                              const totalCharged = baseAmount + cardFeeAmount;
                              
                              const doc = new jsPDF();
                              doc.setFontSize(20);
                              doc.text("TOLSTOY STAFFING", 105, 25, { align: "center" });
                              doc.setFontSize(14);
                              doc.text("Payment Receipt", 105, 35, { align: "center" });
                              doc.setFontSize(10);
                              doc.setDrawColor(200);
                              doc.line(20, 42, 190, 42);
                              
                              let y = 55;
                              const lineHeight = 8;
                              
                              doc.setFontSize(11);
                              doc.text(`Transaction ID: ${item.id}`, 20, y); y += lineHeight;
                              doc.text(`Date: ${format(new Date(item.date), 'MMMM d, yyyy h:mm a')}`, 20, y); y += lineHeight * 1.5;
                              
                              doc.text(`Type: ${typeLabels[item.type] || item.type}`, 20, y); y += lineHeight;
                              doc.text(`Payment Method: ${item.paymentMethod === "card" ? "Credit Card" : item.paymentMethod === "ach" ? "Bank Transfer (ACH)" : item.paymentMethod === "platform" ? "Platform Balance" : "N/A"}`, 20, y); y += lineHeight;
                              doc.text(`Reference: ${item.stripePaymentIntentId || item.mtPaymentOrderId || 'N/A'}`, 20, y); y += lineHeight;
                              doc.text(`Initiated By: ${item.initiatedBy || "System"}`, 20, y); y += lineHeight * 1.5;
                              
                              if (item.workerName) {
                                doc.text(`Worker: ${item.workerName}`, 20, y); y += lineHeight;
                              }
                              if (item.jobTitle) {
                                doc.text(`Job: ${item.jobTitle}`, 20, y); y += lineHeight;
                              }
                              
                              y += lineHeight;
                              doc.line(20, y, 190, y); y += lineHeight * 1.5;
                              
                              doc.setFontSize(12);
                              doc.text(`Amount Added to Balance: $${baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 20, y); y += lineHeight;
                              if (item.paymentMethod === "card" && cardFeeAmount > 0) {
                                doc.text(`Card Processing Fee (3.5%): $${cardFeeAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 20, y); y += lineHeight;
                                doc.setFontSize(14);
                                doc.text(`Total Charged: $${totalCharged.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 20, y); y += lineHeight;
                              }
                              
                              y += lineHeight * 2;
                              doc.setFontSize(10);
                              doc.text("Thank you for your business!", 105, y, { align: "center" });
                              
                              doc.save(`receipt-${item.id}-${format(new Date(item.date), 'yyyy-MM-dd')}.pdf`);
                              toast({ title: "Receipt Downloaded", description: "Your payment receipt has been saved as PDF." });
                            }}
                            data-testid={`button-download-receipt-${item.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </ScrollArea>
            </div>
            
            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-muted-foreground">
                Showing {billingHistoryData.length} transactions
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {
                  const csv = [
                    ['Date', 'Time', 'Type', 'Payment Method', 'Worker', 'Job', 'Hours', 'Amount', 'Initiated By', 'Payment Reference'],
                    ...billingHistoryData.map(item => {
                      // Fix for amounts stored incorrectly (divided by 10)
                      let amountInCents = item.amount;
                      if ((item.type === "deposit" || item.type === "auto_recharge") && Math.abs(item.amount) > 0) {
                        const correctedAmount = Math.round(item.amount * 10);
                        if (Math.abs(item.amount) < 10000 && Math.abs(correctedAmount) >= 10000) {
                          amountInCents = correctedAmount;
                        }
                      }
                      return [
                        format(new Date(item.date), 'yyyy-MM-dd'),
                        format(new Date(item.date), 'HH:mm:ss'),
                        item.type,
                        item.paymentMethod || '',
                        item.workerName || '',
                        item.jobTitle || '',
                        item.hours?.toString() || '',
                        (amountInCents / 100).toFixed(2),
                        item.initiatedBy || '',
                        item.stripePaymentIntentId || item.mtPaymentOrderId || ''
                      ];
                    })
                  ].map(row => row.join(',')).join('\n');
                  
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `billing-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: "Export Complete", description: "Your billing history has been downloaded." });
                }} data-testid="button-export-csv">
                  <Download className="w-4 h-4 mr-2" /> Export CSV
                </Button>
              </div>
            </div>
          </div>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={!!composeReceiptItem}
        onOpenChange={(open) => { if (!open) { setComposeReceiptItem(null); setComposeReceiptMemo(""); } }}
        title={t("settings.composeReceipt") ?? "Compose receipt"}
        description={t("settings.composeReceiptDescription") ?? "Add optional notes and generate a PDF receipt."}
        contentClassName="max-w-md"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setComposeReceiptItem(null); setComposeReceiptMemo(""); }}>
              {t("settings.cancel") ?? "Cancel"}
            </Button>
            <Button
              onClick={() => {
                if (composeReceiptItem) {
                  generateBillingReceiptPdf(composeReceiptItem, { memo: composeReceiptMemo });
                  toast({ title: t("settings.receiptDownloaded") ?? "Receipt Downloaded", description: t("settings.receiptSavedPdf") ?? "Your receipt has been saved as PDF." });
                  setComposeReceiptItem(null);
                  setComposeReceiptMemo("");
                }
              }}
              data-testid="button-generate-receipt"
            >
              <Download className="w-4 h-4 mr-2" />
              {t("settings.generateReceipt") ?? "Generate receipt"}
            </Button>
          </div>
        }
      >
        {composeReceiptItem && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {format(new Date(composeReceiptItem.date), "MMM d, yyyy h:mm a")} · {composeReceiptItem.type}
            </div>
            <div>
              <Label htmlFor="compose-receipt-memo">{t("settings.receiptNotes") ?? "Notes (optional)"}</Label>
              <Textarea
                id="compose-receipt-memo"
                value={composeReceiptMemo}
                onChange={(e) => setComposeReceiptMemo(e.target.value)}
                placeholder={t("settings.receiptNotesPlaceholder") ?? "Add a note to include on the receipt..."}
                className="mt-2 min-h-[100px]"
                data-testid="textarea-compose-receipt-memo"
              />
            </div>
          </div>
        )}
      </ResponsiveDialog>

      <ResponsiveDialog open={showInvoices} onOpenChange={(open) => { setShowInvoices(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.invoicesTitle")} description={t("settings.invoicesDescription")} contentClassName="max-w-2xl max-h-[90vh]" showBackButton onBack={() => { setShowInvoices(false); navigate("/company-dashboard/menu"); }} backLabel={t("settings.menu")} footer={<Button variant="outline" onClick={() => { setShowInvoices(false); navigate("/company-dashboard/menu"); }}>{t("settings.close")}</Button>}>
        <InvoicesView />
      </ResponsiveDialog>

      <ResponsiveDialog open={showHelp} onOpenChange={(open) => { setShowHelp(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.helpTitle")} description={t("settings.helpDescription")} contentClassName="max-w-lg" showBackButton onBack={() => { setShowHelp(false); navigate("/company-dashboard/menu"); }} backLabel={t("settings.menu")} footer={<Button variant="outline" onClick={() => { setShowHelp(false); navigate("/company-dashboard/menu"); }}>{t("settings.close")}</Button>}>
        <div className="space-y-4">
            <Card className="p-4 hover-elevate cursor-pointer" onClick={() => window.open("mailto:support@tolstoystaffing.com")}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Send className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Email Support</h3>
                  <p className="text-sm text-muted-foreground">support@tolstoystaffing.com</p>
                </div>
              </div>
            </Card>
            <Card className="p-4 hover-elevate cursor-pointer" onClick={() => window.open("tel:+18005551234")}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <HelpCircle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Phone Support</h3>
                  <p className="text-sm text-muted-foreground">1-800-555-1234 (Mon-Fri 9am-5pm EST)</p>
                </div>
              </div>
            </Card>
            <Separator />
            <div>
              <h4 className="font-medium mb-2">Frequently Asked Questions</h4>
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">How do I post a new job?</p>
                <p className="text-muted-foreground">How does worker verification work?</p>
                <p className="text-muted-foreground">What happens if a worker doesn't show up?</p>
                <p className="text-muted-foreground">How do refunds work?</p>
              </div>
            </div>
          </div>
      </ResponsiveDialog>

      <ResponsiveDialog open={showAgreements} onOpenChange={(open) => { setShowAgreements(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.agreements")} description="View your signed agreements" contentClassName="max-w-lg" showBackButton onBack={() => { setShowAgreements(false); navigate("/company-dashboard/menu"); }} backLabel="Menu">
        <CompanyMenuPanelAgreements />
      </ResponsiveDialog>

      {/* How It Works Multi-Step Dialog */}
      <Dialog open={showHowItWorks} onOpenChange={(open) => { setShowHowItWorks(open); if (!open) setHowItWorksStep(0); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-center">{t("dashboard.howItWorksTitle")}</DialogTitle>
            <DialogDescription className="text-center">{t("dashboard.howItWorksSubtitle")}</DialogDescription>
          </DialogHeader>
          
          <div className="py-6">
            {/* Step Indicators */}
            <div className="flex justify-center gap-2 mb-8">
              {[0, 1, 2, 3].map((step) => (
                <button
                  key={step}
                  onClick={() => setHowItWorksStep(step)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${howItWorksStep === step ? 'bg-primary w-6' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'}`}
                  data-testid={`button-how-it-works-step-${step}`}
                />
              ))}
            </div>
            
            {/* Step 1: Post a Job */}
            {howItWorksStep === 0 && (
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 flex items-center justify-center mx-auto">
                  <FileText className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <Badge className="mb-2">Step 1</Badge>
                  <h3 className="text-xl font-semibold">{t("dashboard.stepPostJob")}</h3>
                  <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                    {t("dashboard.stepPostJobDesc")}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                      <MapPinned className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">Set location, timeline, and rate</p>
                      <p className="text-muted-foreground text-xs">Workers nearby will be notified</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Step 2: Review & Accept Workers */}
            {howItWorksStep === 1 && (
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/50 dark:to-emerald-900/50 flex items-center justify-center mx-auto">
                  <Users className="w-10 h-10 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <Badge variant="secondary" className="mb-2">Step 2</Badge>
                  <h3 className="text-xl font-semibold">{t("dashboard.stepReviewApply")}</h3>
                  <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                    {t("dashboard.stepReviewApplyDesc")}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                      <Star className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">View ratings, skills & past work</p>
                      <p className="text-muted-foreground text-xs">All workers are verified with ID & face check</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Step 3: Track Work & Timesheets */}
            {howItWorksStep === 2 && (
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/50 dark:to-amber-900/50 flex items-center justify-center mx-auto">
                  <Clock className="w-10 h-10 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <Badge variant="outline" className="mb-2">Step 3</Badge>
                  <h3 className="text-xl font-semibold">{t("dashboard.stepTrackWork")}</h3>
                  <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                    {t("dashboard.stepTrackWorkDesc")}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">GPS-verified clock in/out</p>
                      <p className="text-muted-foreground text-xs">Review and approve timesheets in real-time</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Step 4: Pay Securely */}
            {howItWorksStep === 3 && (
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-violet-100 dark:from-purple-900/50 dark:to-violet-900/50 flex items-center justify-center mx-auto">
                  <DollarSign className="w-10 h-10 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <Badge className="mb-2 bg-purple-500">Step 4</Badge>
                  <h3 className="text-xl font-semibold">{t("dashboard.stepPaySecurely")}</h3>
                  <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                    {t("dashboard.stepPaySecurelyDesc")}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">Automatic ACH payments</p>
                      <p className="text-muted-foreground text-xs">Workers paid directly, you pay a simple platform fee</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {howItWorksStep > 0 && (
              <Button variant="outline" onClick={() => setHowItWorksStep(howItWorksStep - 1)} data-testid="button-how-it-works-back">
                <ChevronLeft className="w-4 h-4 mr-1" /> {tCommon("back")}
              </Button>
            )}
            {howItWorksStep < 3 ? (
              <Button onClick={() => setHowItWorksStep(howItWorksStep + 1)} className="flex-1 sm:flex-none" data-testid="button-how-it-works-next">
                {tCommon("next")} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button 
                onClick={() => {
                  setShowHowItWorks(false);
                  setHowItWorksStep(0);
                }} 
                className="flex-1 sm:flex-none"
                data-testid="button-how-it-works-done"
              >
                {t("dashboard.gotIt")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Timesheet Settings Dialog */}
      <Dialog open={showTimesheetSettings} onOpenChange={(open) => {
        setShowTimesheetSettings(open);
        // Load settings when dialog opens
        if (open && profile) {
          fetch('/api/company/timesheet-settings', {
            credentials: 'include',
          })
            .then(res => res.json())
            .then(data => {
              if (data.settings) {
                setTimesheetSettings(data.settings);
              }
            })
            .catch(err => {
              console.error("Error loading timesheet settings:", err);
              // Keep default settings if load fails
            });
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" /> Timesheet Settings
            </DialogTitle>
            <DialogDescription>Configure how timesheets are processed and approved</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Auto-Approve Section */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm">Approval Settings</h3>
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border">
                <div className="space-y-1">
                  <Label className="font-medium">Auto-Approve Timesheets</Label>
                  <p className="text-xs text-muted-foreground">Automatically approve all timesheets and process payment to workers</p>
                </div>
                <Switch 
                  checked={timesheetSettings.autoApprove} 
                  onCheckedChange={(checked) => setTimesheetSettings(prev => ({ ...prev, autoApprove: checked }))}
                  data-testid="switch-auto-approve"
                />
              </div>
              
              {timesheetSettings.autoApprove && (
                <div className="pl-4 border-l-2 border-primary/30 space-y-3">
                  <div className="space-y-2">
                    <Label className="text-sm">Auto-Approve Window</Label>
                    <Select 
                      value={timesheetSettings.autoApproveWindow} 
                      onValueChange={(v) => setTimesheetSettings(prev => ({ ...prev, autoApproveWindow: v }))}
                    >
                      <SelectTrigger data-testid="select-auto-approve-window">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 hour after submission</SelectItem>
                        <SelectItem value="4">4 hours after submission</SelectItem>
                        <SelectItem value="12">12 hours after submission</SelectItem>
                        <SelectItem value="24">24 hours after submission</SelectItem>
                        <SelectItem value="48">48 hours after submission</SelectItem>
                        <SelectItem value="0">Immediately</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <Label className="text-sm">Require Location Verification</Label>
                  <p className="text-xs text-muted-foreground">Flag timesheets where worker is not on-site</p>
                </div>
                <Switch 
                  checked={timesheetSettings.requireLocationVerification} 
                  onCheckedChange={(checked) => setTimesheetSettings(prev => ({ ...prev, requireLocationVerification: checked }))}
                  data-testid="switch-location-verification"
                />
              </div>
              
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <Label className="text-sm">Send Approval Notifications</Label>
                  <p className="text-xs text-muted-foreground">Notify workers when timesheets are approved</p>
                </div>
                <Switch 
                  checked={timesheetSettings.sendApprovalNotifications} 
                  onCheckedChange={(checked) => setTimesheetSettings(prev => ({ ...prev, sendApprovalNotifications: checked }))}
                  data-testid="switch-approval-notifications"
                />
              </div>
            </div>
            
            <Separator />
            
            {/* Hours & Breaks Section */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm">Hours & Breaks</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Max Daily Hours</Label>
                  <Select 
                    value={timesheetSettings.maxDailyHours} 
                    onValueChange={(v) => setTimesheetSettings(prev => ({ ...prev, maxDailyHours: v }))}
                  >
                    <SelectTrigger data-testid="select-max-daily-hours">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="8">8 hours</SelectItem>
                      <SelectItem value="10">10 hours</SelectItem>
                      <SelectItem value="12">12 hours</SelectItem>
                      <SelectItem value="14">14 hours</SelectItem>
                      <SelectItem value="16">16 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm">Overtime After</Label>
                  <Select 
                    value={timesheetSettings.overtimeThreshold} 
                    onValueChange={(v) => setTimesheetSettings(prev => ({ ...prev, overtimeThreshold: v }))}
                  >
                    <SelectTrigger data-testid="select-overtime-threshold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="8">8 hours</SelectItem>
                      <SelectItem value="10">10 hours</SelectItem>
                      <SelectItem value="12">12 hours</SelectItem>
                      <SelectItem value="none">No overtime</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <Label className="text-sm">Auto-Deduct Breaks</Label>
                  <p className="text-xs text-muted-foreground">Automatically deduct break time from shifts</p>
                </div>
                <Switch 
                  checked={timesheetSettings.breakDeduction} 
                  onCheckedChange={(checked) => setTimesheetSettings(prev => ({ ...prev, breakDeduction: checked }))}
                  data-testid="switch-break-deduction"
                />
              </div>
              
              {timesheetSettings.breakDeduction && (
                <div className="pl-4 border-l-2 border-primary/30">
                  <div className="space-y-2">
                    <Label className="text-sm">Break Duration</Label>
                    <Select 
                      value={timesheetSettings.breakMinutes} 
                      onValueChange={(v) => setTimesheetSettings(prev => ({ ...prev, breakMinutes: v }))}
                    >
                      <SelectTrigger data-testid="select-break-duration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="45">45 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <Label className="text-sm">Time Rounding</Label>
                <Select 
                  value={timesheetSettings.roundingIncrement} 
                  onValueChange={(v) => setTimesheetSettings(prev => ({ ...prev, roundingIncrement: v }))}
                >
                  <SelectTrigger data-testid="select-rounding">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">No rounding (exact)</SelectItem>
                    <SelectItem value="5">Round to 5 minutes</SelectItem>
                    <SelectItem value="6">Round to 6 minutes (1/10th hour)</SelectItem>
                    <SelectItem value="15">Round to 15 minutes (1/4 hour)</SelectItem>
                    <SelectItem value="30">Round to 30 minutes (1/2 hour)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <Separator />
            
            {/* Worker Requirements */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm">Worker Requirements</h3>
              
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <Label className="text-sm">Require Work Notes</Label>
                  <p className="text-xs text-muted-foreground">Workers must add notes when clocking out</p>
                </div>
                <Switch 
                  checked={timesheetSettings.requireNotes} 
                  onCheckedChange={(checked) => setTimesheetSettings(prev => ({ ...prev, requireNotes: checked }))}
                  data-testid="switch-require-notes"
                />
              </div>
            </div>
            
            <Separator />
            
            {/* Export Section */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm">Export Data</h3>
              <div className="flex flex-col gap-2">
                <Button 
                  variant="outline" 
                  className="justify-start"
                  onClick={() => {
                    exportTimesheetsToCSV(pendingTimesheets, 'pending_timesheets');
                    setShowTimesheetSettings(false);
                  }}
                  disabled={pendingTimesheets.length === 0}
                  data-testid="button-export-pending"
                >
                  <Download className="w-4 h-4 mr-2" /> 
                  Export Pending Timesheets ({pendingTimesheets.length})
                </Button>
                <Button 
                  variant="outline" 
                  className="justify-start"
                  onClick={() => {
                    exportTimesheetsToCSV(approvedTimesheets, 'approved_timesheets');
                    setShowTimesheetSettings(false);
                  }}
                  disabled={approvedTimesheets.length === 0}
                  data-testid="button-export-approved"
                >
                  <Download className="w-4 h-4 mr-2" /> 
                  Export Approved Timesheets ({approvedTimesheets.length})
                </Button>
                <Button 
                  variant="outline" 
                  className="justify-start"
                  onClick={() => {
                    exportTimesheetsToCSV(normalizedTimesheets, 'all_timesheets');
                    setShowTimesheetSettings(false);
                  }}
                  disabled={normalizedTimesheets.length === 0}
                  data-testid="button-export-all"
                >
                  <Download className="w-4 h-4 mr-2" /> 
                  Export All Timesheets ({normalizedTimesheets.length})
                </Button>
              </div>
            </div>
          </div>
          
          <DialogFooter className="flex gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowTimesheetSettings(false)}>Cancel</Button>
            <Button onClick={async () => {
              try {
                // Save settings to backend
                const response = await fetch('/api/company/timesheet-settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify(timesheetSettings),
                });
                
                if (response.ok) {
                  toast({
                    title: "Settings Saved",
                    description: "Your timesheet settings have been updated.",
                  });
                  setShowTimesheetSettings(false);
                } else {
                  const errorData = await response.json().catch(() => ({}));
                  throw new Error(errorData.message || "Failed to save settings");
                }
              } catch (error: any) {
                console.error("Error saving timesheet settings:", error);
                toast({
                  title: "Error",
                  description: error.message || "Failed to save timesheet settings. Please try again.",
                  variant: "destructive",
                });
              }
            }} data-testid="button-save-timesheet-settings">
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResponsiveDialog
        open={showJobCommitmentsDialog}
        onOpenChange={setShowJobCommitmentsDialog}
        title={t("settings.jobCommitments")}
        description="Active jobs with hired workers"
        contentClassName="max-w-lg max-h-[85vh]"
        footer={<Button variant="outline" onClick={() => setShowJobCommitmentsDialog(false)}>{t("settings.close")}</Button>}
      >
        <div className="space-y-2">
          {jobsWithCommitments.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No active job commitments</p>
              <p className="text-xs mt-1">Commitments appear when workers are hired for open jobs</p>
            </div>
          ) : (
            jobsWithCommitments.map((job) => (
              <button
                key={job.id}
                onClick={() => {
                  setSelectedJobDetails(job.fullJob);
                  setSelectedJobLocation(job.locationData);
                  setShowJobCommitmentsDialog(false);
                }}
                className="w-full text-left p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
                data-testid={`button-job-commitment-dialog-${job.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{job.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{job.locationData?.name || job.locationData?.address}</p>
                </div>
                <span className="font-semibold text-primary flex-shrink-0">${(job.amount / 100).toLocaleString()}</span>
              </button>
            ))
          )}
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog open={showLocations} onOpenChange={(open) => { setShowLocations(open); if (!open) navigate("/company-dashboard/menu"); }} title={t("settings.companyLocationsTitle")} description={t("settings.companyLocationsDesc")} contentClassName="max-w-2xl max-h-[90vh]" showBackButton onBack={() => { setShowLocations(false); navigate("/company-dashboard/menu"); }} backLabel={t("settings.menu")} footer={<Button variant="outline" onClick={() => { setShowLocations(false); navigate("/company-dashboard/menu"); }}>{t("settings.close")}</Button>}>
          <div className="space-y-4">
            {companyLocations.map((location) => (
              <Card key={location.id} className={`p-4 ${location.isPrimary ? 'ring-2 ring-primary' : ''}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <MapPin className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium">{location.name}</h4>
                        {location.isPrimary && <Badge variant="secondary">Primary</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{location.address}</p>
                      <p className="text-sm text-muted-foreground">{location.city}, {location.state} {location.zipCode}</p>
                      
                      {/* Contact Representative Info */}
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs text-muted-foreground mb-1">Contact Representative</p>
                        {/* Use company default if useCompanyDefault is true, null, or undefined */}
                        {location.useCompanyDefault === true || location.useCompanyDefault === null || location.useCompanyDefault === undefined ? (
                          <div className="flex items-center gap-2 text-sm flex-wrap">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                            <span>{profile?.firstName || "Company"} {profile?.lastName || "Admin"} (Default)</span>
                            {profile?.phone && (
                              <>
                                <Phone className="w-3.5 h-3.5 text-muted-foreground ml-2" />
                                <span>{profile.phone}</span>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {location.contactName ? (
                              <div className="flex items-center gap-2 text-sm">
                                <User className="w-3.5 h-3.5 text-muted-foreground" />
                                <span>{location.contactName}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <User className="w-3.5 h-3.5" />
                                <span>No name specified</span>
                              </div>
                            )}
                            {location.contactPhone ? (
                              <div className="flex items-center gap-2 text-sm">
                                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                                <span>{location.contactPhone}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Phone className="w-3.5 h-3.5" />
                                <span>No phone specified</span>
                              </div>
                            )}
                            {location.contactEmail && (
                              <div className="flex items-center gap-2 text-sm">
                                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="truncate">{location.contactEmail}</span>
                              </div>
                            )}
                            {location.contactAltPhone && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Phone className="w-3.5 h-3.5" />
                                <span>{location.contactAltPhone} (Alt)</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!location.isPrimary && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        disabled={updateLocation.isPending}
                        onClick={() => {
                          companyLocations.forEach((loc: any) => {
                            if (loc.isPrimary) {
                              updateLocation.mutate({ id: loc.id, isPrimary: false });
                            }
                          });
                          updateLocation.mutate({ id: location.id, isPrimary: true }, {
                            onSuccess: () => {
                              toast({ title: "Primary Updated", description: `${location.name} is now your primary location.` });
                            }
                          });
                        }}
                        data-testid={`button-set-primary-location-${location.id}`}
                      >
                        Set Primary
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => {
                        setEditingLocation({
                          id: location.id,
                          name: location.name,
                          address: location.address,
                          city: location.city,
                          state: location.state,
                          zipCode: location.zipCode,
                          useCompanyDefault: location.useCompanyDefault ?? true,
                          contactName: location.contactName || "",
                          contactPhone: location.contactPhone || "",
                          contactEmail: location.contactEmail || "",
                          contactAltPhone: location.contactAltPhone || "",
                          representativeTeamMemberId: location.representativeTeamMemberId || null,
                          assignedTeamMemberIds: location.assignedTeamMemberIds || [],
                          selectedPhoneOption: location.contactPhone ? (location.contactPhone === profile?.phone ? "company" : "custom") : "company",
                          paymentMethodId: location.paymentMethodId || null,
                        });
                        setShowEditLocation(true);
                      }}
                      data-testid={`button-edit-location-${location.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      disabled={deleteLocation.isPending}
                      onClick={() => {
                        if (location.isPrimary) {
                          toast({ title: "Cannot Delete", description: "You cannot delete your primary location.", variant: "destructive" });
                        } else {
                          deleteLocation.mutate(location.id);
                        }
                      }}
                      data-testid={`button-delete-location-${location.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            
            <Button variant="outline" className="w-full border-dashed" onClick={() => setShowAddLocation(true)} data-testid="button-add-location">
              <Plus className="w-4 h-4 mr-2" /> Add New Location
            </Button>
          </div>
      </ResponsiveDialog>
      
      <ResponsiveDialog
        open={showAddLocation}
        onOpenChange={(open) => {
          setShowAddLocation(open);
          if (!open) {
            setAddLocationStep(1);
            setNewLocation({ 
              name: "", address: "", address2: "", city: "", state: "", zipCode: "",
              useCompanyDefault: true, contactName: "", contactPhone: "", contactEmail: "", contactAltPhone: "",
              representativeTeamMemberId: null, selectedPhoneOption: "company", paymentMethodId: null
            });
          }
        }}
        title={addLocationStep === 1 ? "Step 1: Address" : addLocationStep === 2 ? "Step 2: Contact Representative" : "Step 3: Payment Method"}
        description={addLocationStep === 1 ? "Enter the job site address" : addLocationStep === 2 ? "Who workers contact at this location" : "Payment method for this location"}
        contentClassName="max-w-lg"
        progressSteps={3}
        progressCurrent={addLocationStep}
        secondaryAction={addLocationStep > 1 ? { label: "Back", onClick: () => setAddLocationStep(s => s - 1) } : undefined}
        primaryAction={
          addLocationStep < 3
            ? { label: "Next", onClick: () => setAddLocationStep(s => s + 1), disabled: addLocationStep === 1 && (!newLocation.name || !newLocation.address), testId: "button-add-location-next" }
            : {
                label: createLocation.isPending ? "" : "Save Location",
                onClick: () => {
                  createLocation.mutate({
                    name: newLocation.name,
                    address: newLocation.address,
                    address2: newLocation.address2 || undefined,
                    city: newLocation.city,
                    state: newLocation.state,
                    zipCode: newLocation.zipCode,
                    isPrimary: companyLocations.length === 0,
                    useCompanyDefault: newLocation.useCompanyDefault,
                    contactName: newLocation.useCompanyDefault ? undefined : newLocation.contactName || undefined,
                    contactPhone: newLocation.useCompanyDefault ? undefined : newLocation.contactPhone || undefined,
                    contactEmail: newLocation.useCompanyDefault ? undefined : newLocation.contactEmail || undefined,
                    contactAltPhone: newLocation.useCompanyDefault ? undefined : newLocation.contactAltPhone || undefined,
                    representativeTeamMemberId: newLocation.useCompanyDefault ? undefined : (newLocation.representativeTeamMemberId && newLocation.representativeTeamMemberId > 0 ? newLocation.representativeTeamMemberId : undefined),
                    paymentMethodId: newLocation.paymentMethodId || undefined,
                  }, {
                    onSuccess: () => {
                      setAddLocationStep(1);
                      setNewLocation({ name: "", address: "", address2: "", city: "", state: "", zipCode: "", useCompanyDefault: true, contactName: "", contactPhone: "", contactEmail: "", contactAltPhone: "", representativeTeamMemberId: null, selectedPhoneOption: "company", paymentMethodId: null });
                      setShowAddLocation(false);
                    }
                  });
                },
                disabled: !newLocation.name || !newLocation.address || !newLocation.city || !newLocation.state || !newLocation.zipCode || createLocation.isPending,
                loading: createLocation.isPending,
                icon: createLocation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined,
                testId: "button-save-location",
              }
        }
      >
        <div className="space-y-6">
          {addLocationStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Location Name *</Label>
                <Input placeholder="e.g., Main Office" value={newLocation.name} onChange={(e) => setNewLocation(prev => ({ ...prev, name: e.target.value }))} data-testid="input-location-name" />
              </div>
              <GooglePlacesAutocomplete
                id="companydashboard-location-address"
                label="Street Address *"
                value={newLocation.address}
                onChange={(address, components) => setNewLocation(prev => ({ ...prev, address, city: components.city || prev.city, state: components.state || prev.state, zipCode: components.zipCode || prev.zipCode }))}
                placeholder="Start typing an address..."
                required
                containerClassName="pt-6 pb-6 px-6"
                data-testid="input-location-address"
              />
              <div>
                <Label htmlFor="companydashboard-location-address2">Address Line 2 (Unit, Suite, etc.)</Label>
                <Input id="companydashboard-location-address2" placeholder="Unit, Suite, etc." value={newLocation.address2 || ""} onChange={(e) => setNewLocation(prev => ({ ...prev, address2: e.target.value }))} data-testid="input-location-address2" />
              </div>
            </div>
          )}
          {addLocationStep === 2 && (
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Contact Representative</h4>
              <p className="text-xs text-muted-foreground">This contact will be shown to approved workers for this location</p>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Use Company Default</Label>
                    <p className="text-xs text-muted-foreground">Use your company phone and admin as contact</p>
                  </div>
                  <Switch 
                    checked={newLocation.useCompanyDefault}
                    onCheckedChange={(checked) => setNewLocation(prev => ({ 
                      ...prev, 
                      useCompanyDefault: checked,
                      selectedPhoneOption: checked ? "company" : prev.selectedPhoneOption 
                    }))}
                    data-testid="switch-use-company-default"
                  />
                </div>
                
                {newLocation.useCompanyDefault ? (
                  <Card className="p-4 border-primary/20 bg-primary/5">
                    <p className="text-xs text-muted-foreground mb-3">Messages and calls for this location will go to:</p>
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12 ring-2 ring-border">
                        <AvatarImage src={profile?.avatarUrl ?? undefined} alt="" />
                        <AvatarFallback className="bg-primary/10 text-primary font-medium">
                          {profile?.firstName?.[0] || profile?.companyName?.[0] || "?"}{profile?.lastName?.[0] || profile?.companyName?.[1] || ""}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.companyName || "Company Admin"}
                        </p>
                        {profile?.phone && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <Phone className="w-3.5 h-3.5" />
                            {profile.phone}
                          </p>
                        )}
                        {profile?.email && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 truncate">
                            <Mail className="w-3 h-3" />
                            {profile.email}
                          </p>
                        )}
                        {!profile?.phone && !profile?.email && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Add phone/email in profile settings</p>
                        )}
                      </div>
                      <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* Phone Number Selection */}
                    <div className="space-y-2">
                      <Label className="text-sm">Contact Phone</Label>
                      <div className="space-y-2">
                        {/* Existing Phone Checkboxes */}
                        {profile?.phone && (
                          <div 
                            className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.selectedPhoneOption === "company" ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                            onClick={() => setNewLocation(prev => ({ 
                              ...prev, 
                              selectedPhoneOption: "company",
                              contactPhone: profile?.phone || "",
                            }))}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${newLocation.selectedPhoneOption === "company" ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {newLocation.selectedPhoneOption === "company" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div>
                                <p className="font-medium text-sm">Company Phone</p>
                                <p className="text-xs text-muted-foreground">{profile.phone}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {alternatePhones.length > 0 && alternatePhones.map((altPhone, idx) => (
                          <div 
                            key={idx}
                            className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.selectedPhoneOption === "alt" && newLocation.contactPhone === altPhone ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                            onClick={() => setNewLocation(prev => ({ 
                              ...prev, 
                              selectedPhoneOption: "alt",
                              contactPhone: altPhone,
                            }))}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${newLocation.selectedPhoneOption === "alt" && newLocation.contactPhone === altPhone ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {newLocation.selectedPhoneOption === "alt" && newLocation.contactPhone === altPhone && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div>
                                <p className="font-medium text-sm">Alternate Phone #{idx + 1}</p>
                                <p className="text-xs text-muted-foreground">{altPhone}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                        
                        {/* Custom Phone Option */}
                        <div 
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.selectedPhoneOption === "custom" ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                          onClick={() => setNewLocation(prev => ({ ...prev, selectedPhoneOption: "custom" }))}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${newLocation.selectedPhoneOption === "custom" ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                              {newLocation.selectedPhoneOption === "custom" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-sm">Custom Phone Number</p>
                              {newLocation.selectedPhoneOption === "custom" && (
                                <Input 
                                  placeholder="(555) 123-4567"
                                  className="mt-2"
                                  value={newLocation.contactPhone}
                                  onChange={(e) => setNewLocation(prev => ({ ...prev, contactPhone: e.target.value }))}
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid="input-custom-phone"
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Representative Selection */}
                    <div className="space-y-2">
                      <Label className="text-sm">Contact Representative</Label>
                      <div className="space-y-2">
                        {/* Team Member Dropdown */}
                        <div 
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.representativeTeamMemberId !== null ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                          onClick={() => {}}
                        >
                          <div className="flex items-center gap-3">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            <div className="flex-1">
                              <p className="font-medium text-sm">Select from Team</p>
                              <Select 
                                value={newLocation.representativeTeamMemberId === -1 ? "owner" : newLocation.representativeTeamMemberId?.toString() || "none"}
                                onValueChange={(v) => {
                                  if (v === "__add_new__") {
                                    setInviteWizardStep(1);
                                    setShowAddTeammateFromLocation(true);
                                    return;
                                  }
                                  if (v === "none") {
                                    setNewLocation(prev => ({ ...prev, representativeTeamMemberId: null, contactName: "", contactEmail: "" }));
                                  } else if (v === "owner") {
                                    setNewLocation(prev => ({ 
                                      ...prev, 
                                      representativeTeamMemberId: -1, // Special value for owner
                                      contactName: `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim(),
                                      contactEmail: profile?.email || "",
                                      contactPhone: profile?.phone || prev.contactPhone,
                                      selectedPhoneOption: profile?.phone ? "company" : prev.selectedPhoneOption,
                                    }));
                                  } else {
                                    const member = teamMembers.find((m: any) => m.id.toString() === v);
                                    setNewLocation(prev => ({ 
                                      ...prev, 
                                      representativeTeamMemberId: Number(v),
                                      contactName: member ? `${member.firstName} ${member.lastName}`.trim() : "",
                                      contactEmail: member?.email || "",
                                      contactPhone: member?.phone || prev.contactPhone,
                                      selectedPhoneOption: member?.phone ? "team" : prev.selectedPhoneOption,
                                    }));
                                  }
                                }}
                              >
                                <SelectTrigger className="mt-1" data-testid="select-team-representative">
                                  <SelectValue placeholder="Select a team member..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No team member selected</SelectItem>
                                  <SelectItem value="owner">{profile?.firstName} {profile?.lastName} (Owner)</SelectItem>
                                  {teamMembers.map((member: any) => (
                                    <SelectItem key={member.id} value={member.id.toString()}>
                                      {member.firstName} {member.lastName} ({member.role})
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="__add_new__" className="text-primary font-medium">
                                    <Plus className="w-3.5 h-3.5 inline mr-1.5" />
                                    {t("company.team.newTeammate", "New Teammate")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                        
                        {/* Or Add Custom Contact */}
                        <div className="text-center text-xs text-muted-foreground py-1">— or add custom contact —</div>
                        
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Contact Name</Label>
                            <Input 
                              placeholder="John Smith"
                              value={newLocation.contactName}
                              onChange={(e) => setNewLocation(prev => ({ ...prev, contactName: e.target.value, representativeTeamMemberId: null }))}
                              data-testid="input-contact-name"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Contact Email</Label>
                            <Input 
                              type="email"
                              placeholder="john@company.com"
                              value={newLocation.contactEmail}
                              onChange={(e) => setNewLocation(prev => ({ ...prev, contactEmail: e.target.value }))}
                              data-testid="input-contact-email"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Alternate Phone (optional)</Label>
                            <Input 
                              type="tel"
                              placeholder="(555) 987-6543"
                              value={newLocation.contactAltPhone}
                              onChange={(e) => setNewLocation(prev => ({ ...prev, contactAltPhone: e.target.value }))}
                              data-testid="input-contact-alt-phone"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
          )}
          {addLocationStep === 3 && (
            <div className="space-y-4">
              <Label className="text-sm">Payment Method for Location</Label>
              <Select 
                value={newLocation.paymentMethodId?.toString() || "none"}
                onValueChange={(v) => {
                  if (v === "__new__") {
                    previousPaymentMethodIdsRef.current = (paymentMethods || []).map((m: any) => m.id);
                    addPaymentOpenedFromAddLocationRef.current = true;
                    setTimeout(() => setShowStripeAddPaymentMethod(true), 0);
                    return;
                  }
                  setNewLocation(prev => ({ ...prev, paymentMethodId: v === "none" ? null : Number(v) }));
                }}
              >
                <SelectTrigger data-testid="select-location-payment-method">
                  <SelectValue placeholder="Select payment method..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use company balance (default)</SelectItem>
                  {(paymentMethods || []).filter((pm: any) => {
                    const type = pm.type ?? pm.payment_method_type;
                    const verified = pm.isVerified ?? pm.is_verified;
                    return type === "card" || (type === "ach" && verified);
                  }).map((pm: any) => (
                    <SelectItem key={pm.id} value={pm.id.toString()}>
                      <div className="flex items-center gap-2">
                        {pm.type === "card" ? (
                          <>
                            <CreditCard className="w-4 h-4" />
                            <span className="capitalize">{pm.cardBrand || "Card"}</span> ending in {pm.lastFour}
                          </>
                        ) : (
                          <>
                            <Building2 className="w-4 h-4" />
                            <span>{pm.bankName || "Bank"}</span> ending in {pm.lastFour}
                          </>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__" data-testid="option-add-location-new-payment-method">
                    <Plus className="w-4 h-4 inline mr-2" />
                    Add New Payment Method
                  </SelectItem>
                </SelectContent>
              </Select>
              {(paymentMethods || []).filter((pm: any) => {
                const type = pm.type ?? pm.payment_method_type;
                const verified = pm.isVerified ?? pm.is_verified;
                return type === "card" || (type === "ach" && verified);
              }).length === 0 && (
                <p className="text-xs text-muted-foreground">No payment methods saved. Add a card or verified bank account (ACH) above.</p>
              )}
            </div>
          )}
        </div>
      </ResponsiveDialog>


      {/* Edit Location Dialog */}
      <Dialog open={showEditLocation} onOpenChange={(open) => {
        setShowEditLocation(open);
        if (!open) setEditingLocation(null);
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
            <DialogDescription>Update location details and contact information</DialogDescription>
          </DialogHeader>
          {editingLocation && (
            <>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-6 pr-4">
                {/* Location Details */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Location Details</h4>
                  <div>
                    <Label>Location Name *</Label>
                    <Input 
                      placeholder="e.g., Downtown Office Tower" 
                      value={editingLocation.name}
                      onChange={(e) => setEditingLocation(prev => prev ? { ...prev, name: e.target.value } : null)}
                      data-testid="input-edit-location-name" 
                    />
                  </div>
                  <GooglePlacesAutocomplete
                    id="edit-location-address"
                    label="Street Address"
                    value={editingLocation.address}
                    onChange={(address, components) => {
                      setEditingLocation(prev => prev ? {
                        ...prev,
                        address: address,
                        city: components.city || prev.city,
                        state: components.state || prev.state,
                        zipCode: components.zipCode || prev.zipCode,
                      } : null);
                    }}
                    placeholder="Start typing an address..."
                    required
                    containerClassName="pt-6 pb-6 px-6"
                    data-testid="input-edit-location-address"
                  />
                  <div>
                    <Label htmlFor="edit-location-address2">Address Line 2 (optional)</Label>
                    <Input 
                      id="edit-location-address2"
                      placeholder="Unit, Suite, etc." 
                      value={editingLocation.address2 || ""}
                      onChange={(e) => setEditingLocation(prev => prev ? { ...prev, address2: e.target.value } : null)}
                      data-testid="input-edit-location-address2" 
                    />
                  </div>
                </div>
                
                <Separator />
                
                {/* Contact Representative Section */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Contact Representative</h4>
                  <p className="text-xs text-muted-foreground">This contact will be shown to approved workers for this location</p>
                  
                  {/* Use Company Default Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Use Company Default</Label>
                      <p className="text-xs text-muted-foreground">Use your company phone and admin as contact</p>
                    </div>
                    <Switch 
                      checked={editingLocation.useCompanyDefault}
                      onCheckedChange={(checked) => setEditingLocation(prev => prev ? { 
                        ...prev, 
                        useCompanyDefault: checked,
                        selectedPhoneOption: checked ? "company" : prev.selectedPhoneOption 
                      } : null)}
                      data-testid="switch-edit-use-company-default"
                    />
                  </div>
                  
                  {editingLocation.useCompanyDefault ? (
                    <Card className="p-4 border-primary/20 bg-primary/5">
                      <p className="text-xs text-muted-foreground mb-3">Messages and calls for this location will go to:</p>
                      <div className="flex items-center gap-4">
                        <Avatar className="h-12 w-12 ring-2 ring-border">
                          <AvatarImage src={profile?.avatarUrl ?? undefined} alt="" />
                          <AvatarFallback className="bg-primary/10 text-primary font-medium">
                            {profile?.firstName?.[0] || profile?.companyName?.[0] || "?"}{profile?.lastName?.[0] || profile?.companyName?.[1] || ""}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.companyName || "Company Admin"}
                          </p>
                          {profile?.phone && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                              <Phone className="w-3.5 h-3.5" />
                              {profile.phone}
                            </p>
                          )}
                          {profile?.email && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 truncate">
                              <Mail className="w-3 h-3" />
                              {profile.email}
                            </p>
                          )}
                          {!profile?.phone && !profile?.email && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Add phone/email in profile settings</p>
                          )}
                        </div>
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                      </div>
                    </Card>
                  ) : (
                    <>
                    <div className="space-y-4">
                      {/* Phone Number Selection */}
                      <div className="space-y-2">
                        <Label className="text-sm">Contact Phone</Label>
                        <div className="space-y-2">
                          {/* Existing Phone Checkboxes */}
                          {profile?.phone && (
                            <div 
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${editingLocation.selectedPhoneOption === "company" ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                              onClick={() => setEditingLocation(prev => prev ? { 
                                ...prev, 
                                selectedPhoneOption: "company",
                                contactPhone: profile?.phone || "",
                              } : null)}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${editingLocation.selectedPhoneOption === "company" ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                  {editingLocation.selectedPhoneOption === "company" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">Company Phone</p>
                                  <p className="text-xs text-muted-foreground">{profile.phone}</p>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {alternatePhones.length > 0 && alternatePhones.map((altPhone, idx) => (
                            <div 
                              key={idx}
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${editingLocation.selectedPhoneOption === "alt" && editingLocation.contactPhone === altPhone ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                              onClick={() => setEditingLocation(prev => prev ? { 
                                ...prev, 
                                selectedPhoneOption: "alt",
                                contactPhone: altPhone,
                              } : null)}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${editingLocation.selectedPhoneOption === "alt" && editingLocation.contactPhone === altPhone ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                  {editingLocation.selectedPhoneOption === "alt" && editingLocation.contactPhone === altPhone && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">Alternate Phone</p>
                                  <p className="text-xs text-muted-foreground">{altPhone}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                          
                          {/* Custom Phone Option */}
                          <div 
                            className={`p-3 border rounded-lg cursor-pointer transition-colors ${editingLocation.selectedPhoneOption === "custom" ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}
                            onClick={() => setEditingLocation(prev => prev ? { ...prev, selectedPhoneOption: "custom" } : null)}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${editingLocation.selectedPhoneOption === "custom" ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {editingLocation.selectedPhoneOption === "custom" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div className="flex-1">
                                <p className="font-medium text-sm">Custom Phone Number</p>
                                {editingLocation.selectedPhoneOption === "custom" && (
                                  <Input 
                                    placeholder="(555) 123-4567"
                                    className="mt-2"
                                    value={editingLocation.contactPhone}
                                    onChange={(e) => setEditingLocation(prev => prev ? { ...prev, contactPhone: e.target.value } : null)}
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid="input-edit-custom-phone"
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Contact Info (when not using company default) */}
                    {!editingLocation.useCompanyDefault && (
                      <div className="space-y-4">
                        <div>
                          <Label className="text-sm">Contact Name</Label>
                          <Input 
                            placeholder="John Smith"
                            value={editingLocation.contactName || ""}
                            onChange={(e) => setEditingLocation(prev => prev ? { ...prev, contactName: e.target.value } : null)}
                            data-testid="input-edit-contact-name"
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Contact Email</Label>
                          <Input 
                            type="email"
                            placeholder="john@example.com"
                            value={editingLocation.contactEmail || ""}
                            onChange={(e) => setEditingLocation(prev => prev ? { ...prev, contactEmail: e.target.value } : null)}
                            data-testid="input-edit-contact-email"
                          />
                        </div>
                      </div>
                    )}
                    </>
                  )}
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditLocation(false)}>Cancel</Button>
              <Button 
                data-testid="button-save-edit-location"
                disabled={updateLocation.isPending}
                onClick={() => {
                  if (!editingLocation) return;
                  updateLocation.mutate({
                    id: editingLocation.id,
                    name: editingLocation.name,
                    address: editingLocation.address,
                    city: editingLocation.city,
                    state: editingLocation.state,
                    zipCode: editingLocation.zipCode,
                    address2: editingLocation.address2 || undefined,
                    useCompanyDefault: editingLocation.useCompanyDefault,
                    contactName: editingLocation.useCompanyDefault ? null : editingLocation.contactName || null,
                    contactPhone: editingLocation.useCompanyDefault ? null : editingLocation.contactPhone || null,
                    contactEmail: editingLocation.useCompanyDefault ? null : editingLocation.contactEmail || null,
                  }, {
                    onSuccess: () => {
                      setShowEditLocation(false);
                      setEditingLocation(null);
                      toast({ title: "Location Updated", description: "Location details have been saved." });
                    },
                  });
                }}
              >
                    {updateLocation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Changes"}
              </Button>
            </DialogFooter>
          </>
          )}
        </DialogContent>
      </Dialog>

      {/* Mobile Bottom Navigation - same breakpoint as WorkerDashboard (md:hidden). Hidden when viewing a specific chat (chat details). */}
      {!(isMobile && activeTab === "chats" && subsection) && (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 h-14" aria-label="Company dashboard navigation" data-testid="mobile-footer-nav">
        <div className="flex items-center justify-around h-full">
          <button
            onClick={() => setActiveTab("jobs")}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
              activeTab === "jobs" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-jobs"
          >
            <Briefcase className="w-5 h-5 shrink-0" />
            <span className="text-[11px] font-medium truncate">{t("nav.jobs")}</span>
          </button>
          <button
            onClick={() => setActiveTab("team")}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
              activeTab === "team" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-team"
          >
            <Users className="w-5 h-5 shrink-0" />
            <span className="text-[11px] font-medium truncate">{t("nav.team")}</span>
          </button>
          <button
            onClick={() => setActiveTab("timesheets")}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
              activeTab === "timesheets" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-timesheets"
          >
            <div className="relative">
              <Clock className="w-5 h-5 shrink-0" />
              {pendingTimesheets.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {pendingTimesheets.length > 9 ? "9+" : pendingTimesheets.length}
                </span>
              )}
            </div>
            <span className="text-[11px] font-medium truncate">{t("company.timesheets")}</span>
          </button>
          <button
            onClick={() => navigate("/company-dashboard/chats")}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 min-w-0 flex-1 h-full transition-colors ${
              pathname === "/company-dashboard/chats" ? "text-primary" : "text-muted-foreground"
            }`}
            data-testid="mobile-nav-chats"
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5 shrink-0" />
              {totalUnreadChats > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {totalUnreadChats > 9 ? "9+" : totalUnreadChats}
                </span>
              )}
            </div>
            <span className="text-[11px] font-medium truncate">{t("nav.messages")}</span>
          </button>
        </div>
      </nav>
      )}

      {/* Mobile FAB: Post a Job — always visible on Jobs tab on mobile */}
      {isMobile && activeTab === "jobs" && !(section === "chats" && subsection) && (
        <button
          className="md:hidden fixed bottom-16 right-4 z-50 flex items-center gap-2 bg-primary text-primary-foreground rounded-full shadow-lg px-4 py-3 text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all"
          onClick={() => {
            if (!hasSignedAgreement) {
              setShowMandatoryAgreement(true);
              toast({ title: t("dashboard.agreementRequired"), description: t("dashboard.pleaseSignAgreementBeforePosting"), variant: "destructive" });
              return;
            }
            const hasPaymentCapability = hasUsablePaymentMethod || (profile?.depositAmount && profile.depositAmount > 0);
            if (!hasPaymentCapability) {
              setShowMandatoryPaymentMethod(true);
              toast({ title: "Payment Method Required", description: "Please add a payment method before posting jobs.", variant: "destructive" });
              return;
            }
            setLocation("/post-job");
          }}
          data-testid="fab-post-job"
          aria-label="Post a new job"
        >
          <Plus className="w-4 h-4" />
          Post a Job
        </button>
      )}
    </Tabs>
  );
}
