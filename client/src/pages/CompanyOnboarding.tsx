import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { compressImageIfNeeded, assertMaxUploadSize } from "@/lib/image-compression";
import { COMPANY_AGREEMENT_TEXT } from "@/lib/company-agreement-text";
import { 
  ArrowRight, 
  ArrowLeft, 
  Building2, 
  Users, 
  Briefcase, 
  FileSignature,
  Plus,
  Trash2,
  MapPin,
  Navigation,
  Check,
  Clock,
  DollarSign,
  Upload,
  Image as ImageIcon,
  Video,
  Sparkles,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Send,
  Phone,
  X,
  CreditCard,
  Shield,
  Landmark,
  FileText,
  CheckCircle2,
  Pen,
  Info,
  HelpCircle,
  RefreshCw,
  Banknote,
  Download,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { Profile, CompanyLocation, TeamInvite } from "@shared/schema";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import confetti from "canvas-confetti";
import { SiGoogle } from "react-icons/si";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const TOTAL_STEPS = 5;
const DEPOSIT_AMOUNT = 200000; // Kept for legacy/dead code block
const COMPANY_ONBOARDING_STORAGE_KEY = "companyOnboardingProgress";
const ONBOARDING_PROGRESS_MAX_AGE_DAYS = 7;

interface LocationData {
  id?: number;
  name: string;
  address: string;
  address2?: string;
  city: string;
  state: string;
  zipCode: string;
  isStarred: boolean;
  isPrimary: boolean;
}

interface ScheduleData {
  date: string;
  startTime: string;
  endTime: string;
  workersNeeded: number;
}

type ShiftType = "on-demand" | "one-day" | "recurring";

interface RecurringSchedule {
  days: string[]; // ["monday", "tuesday", etc.]
  startTime: string;
  endTime: string;
  weeks: number;
}

interface MediaPreview {
  file: File;
  url: string;
  type: "image" | "video";
}

const SHIFT_TYPE_INFO = {
  "on-demand": {
    title: "On-Demand",
    description: "Only requires what time you want them to show up - they will start immediately and will continue work till the task is complete.",
    recommended: true,
  },
  "one-day": {
    title: "One-Day",
    description: "The workers will show up for one day. You specify the date and time you want them to show up.",
    recommended: false,
  },
  "recurring": {
    title: "Recurring",
    description: "Select which days (Sunday-Saturday) you want them to show up, what time, and for how many weeks to complete the task.",
    recommended: false,
  },
};

const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const HOURLY_MARKUP = 13; // Hidden $13 added per hour per worker

function getESTTime(): Date {
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = estFormatter.formatToParts(now);
  const getValue = (type: string) => parts.find(p => p.type === type)?.value || "0";
  return new Date(
    parseInt(getValue("year")),
    parseInt(getValue("month")) - 1,
    parseInt(getValue("day")),
    parseInt(getValue("hour")),
    parseInt(getValue("minute")),
    parseInt(getValue("second"))
  );
}

function getMinStartTime(selectedDate: string): string {
  const estNow = getESTTime();
  const today = estNow.toISOString().split("T")[0];
  
  if (selectedDate === today) {
    const minHour = estNow.getHours() + 2;
    if (minHour >= 17) return ""; // Too late for today
    const clampedHour = Math.max(8, minHour);
    return `${String(clampedHour).padStart(2, "0")}:00`;
  }
  return "08:00";
}

function isValidScheduleTime(date: string, startTime: string): { valid: boolean; error?: string } {
  const estNow = getESTTime();
  const today = estNow.toISOString().split("T")[0];
  
  if (date < today) {
    return { valid: false, error: "Cannot schedule for a past date" };
  }
  
  const [hours, minutes] = startTime.split(":").map(Number);
  
  if (date === today) {
    const currentMinutes = estNow.getHours() * 60 + estNow.getMinutes();
    const selectedMinutes = hours * 60 + minutes;
    const minLeadTimeMinutes = 120; // 2 hours = 120 minutes
    
    if (selectedMinutes < currentMinutes + minLeadTimeMinutes) {
      const minHour = Math.ceil((currentMinutes + minLeadTimeMinutes) / 60);
      const displayHour = minHour > 12 ? minHour - 12 : minHour;
      const ampm = minHour >= 12 ? "PM" : "AM";
      return { valid: false, error: `Start time must be at least 2 hours from now (${displayHour}:00 ${ampm} or later)` };
    }
  }
  
  if (hours < 8 || hours >= 17) {
    return { valid: false, error: "Start time must be between 8:00 AM and 5:00 PM" };
  }
  
  return { valid: true };
}

// Stripe Payment Setup Form (SetupIntent + PaymentElement for card/ACH)
function StripePaymentSetupForm({
  clientSecret,
  onSuccess,
  onError,
  onRetryNeeded,
}: {
  clientSecret: string;
  onSuccess: () => void;
  onError: (err: string) => void;
  onRetryNeeded?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) return;
    setIsProcessing(true);
    onError("");
    try {
      const returnUrl = typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}${window.location.search}`
        : undefined;
      const { setupIntent, error } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        ...(returnUrl ? { confirmParams: { return_url: returnUrl } } : {}),
      });
      if (error) {
        const msg = error.message || (error.type ? "Setup failed" : "Setup failed");
        onError(msg);
        setIsProcessing(false);
        onRetryNeeded?.();
        return;
      }
      if (setupIntent?.status === "succeeded" && setupIntent.id) {
        const res = await fetch("/api/stripe/confirm-setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ setupIntentId: setupIntent.id }),
        });
        let data: { message?: string } = {};
        try {
          data = await res.json();
        } catch {
          data = { message: "Could not save payment method" };
        }
        if (!res.ok) {
          const msg = (data.message || "Could not save payment method").trim();
          const msgLower = msg.toLowerCase();
          // Already saved = user has this payment method; treat as success and advance
          const alreadySaved =
            res.status === 400 &&
            (msgLower.includes("already saved") ||
              msgLower.includes("this card is already") ||
              msgLower.includes("this bank account is already") ||
              msgLower.includes("already have"));
          if (alreadySaved) {
            onSuccess(); // auto-advance to next step
            return;
          }
          onError(msg);
          setIsProcessing(false);
          onRetryNeeded?.();
          return;
        }
        onSuccess(); // saved: auto-advance to next step
      }
    } catch (err: any) {
      onError(err?.message || "Something went wrong");
      onRetryNeeded?.();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card", "us_bank_account"],
          // Disable Apple Pay / Google Pay / Link in sandbox to avoid HTTP and domain-verification warnings
          wallets: { applePay: "never", googlePay: "never", link: "never" },
        }}
      />
      <Button type="submit" className="w-full" disabled={!stripe || isProcessing}>
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4 mr-2" />
            Save payment method
          </>
        )}
      </Button>
    </form>
  );
}

// Card Payment Form Component using Stripe Elements (kept for deposit flows)
interface CardPaymentFormProps {
  amount: number;
  cardFeePercentage: number;
  onSuccess: () => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
  promoApplied: boolean;
}

function CardPaymentForm({
  amount,
  cardFeePercentage,
  onSuccess,
  onError,
  isProcessing,
  setIsProcessing,
  promoApplied,
}: CardPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);

  const cardFee = Math.round(amount * (cardFeePercentage / 100));
  const totalAmount = amount + cardFee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!stripe || !elements) {
      return;
    }

    if (promoApplied) {
      onSuccess();
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch("/api/stripe/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount, includeCardFee: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create payment");
      }

      const { clientSecret } = await res.json();

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error("Card element not found");
      }

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      });

      if (stripeError) {
        throw new Error(stripeError.message || "Payment failed");
      }

      if (paymentIntent?.status === "succeeded") {
        const confirmRes = await fetch("/api/stripe/confirm-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
        });

        if (!confirmRes.ok) {
          const data = await confirmRes.json();
          throw new Error(data.message || "Failed to confirm payment");
        }

        onSuccess();
      } else {
        throw new Error("Payment was not successful");
      }
    } catch (err: any) {
      setError(err.message);
      onError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
        <Shield className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-sm mb-1">Secure Card Payment</p>
          <p className="text-xs text-muted-foreground">
            Your card details are encrypted and processed securely via Stripe.
          </p>
        </div>
      </div>

      {!promoApplied && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span>Deposit Amount:</span>
            <span>${(amount / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-amber-700 dark:text-amber-300">
            <span>Card Fee ({cardFeePercentage}%):</span>
            <span>+${(cardFee / 100).toFixed(2)}</span>
          </div>
          <Separator className="my-2" />
          <div className="flex items-center justify-between font-semibold">
            <span>Total Charge:</span>
            <span>${(totalAmount / 100).toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="p-4 border rounded-lg bg-white dark:bg-gray-900">
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

      {error && (
        <div className="p-3 border border-destructive/30 bg-destructive/10 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        className="w-full h-12"
        disabled={!stripe || isProcessing}
        data-testid="button-pay-card"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4 mr-2" />
            {promoApplied ? "Verify Payment Method" : `Pay $${(totalAmount / 100).toFixed(2)}`}
          </>
        )}
      </Button>
    </form>
  );
}

// Step definitions for sidebar and progress (id 1-4; step 0 = welcome)
const COMPANY_STEPS = [
  { id: 1, title: "Industries", subSteps: [{ id: "industries", label: "Select industries" }] },
  { id: 2, title: "Business & Locations", subSteps: [
    { id: "account", label: "Account" },
    { id: "locations", label: "Locations" },
    { id: "teammates", label: "Teammates" },
  ] },
  { id: 3, title: "Payment", subSteps: [
    { id: "overview", label: "How billing works" },
    { id: "payment", label: "Add payment method" },
  ] },
  { id: 4, title: "Agreement", subSteps: [{ id: "agreement", label: "Sign agreement" }] },
];

export default function CompanyOnboarding() {
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(0);

  // Sync URL ?step=N -> step state (direct link or browser back)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get("step");
    if (stepParam !== null) {
      const n = parseInt(stepParam, 10);
      if (!isNaN(n) && n >= 0 && n <= TOTAL_STEPS) setStep(n);
    }
  }, [location]);

  // When step changes, update URL so links and refresh preserve progress
  const setStepAndUrl = (next: number) => {
    setStep(next);
    if (next === 2) setStep2SubStep(0);
    if (next === 3) setStep3SubStep(0);
    const base = "/company-onboarding";
    const path = next === 0 ? base : `${base}?step=${next}`;
    // Update URL immediately so URL-sync effect doesn't overwrite step
    window.history.replaceState(null, "", path);
    setLocation(path);
  };

  // Navigate to a step and optionally a substep (for sidebar clicks)
  const navigateToStepAndSub = (stepId: number, step2Sub?: number, step3Sub?: number) => {
    if (stepId === 0) return;
    setStep(stepId);
    if (stepId === 2 && step2Sub !== undefined) setStep2SubStep(step2Sub);
    if (stepId === 3 && step3Sub !== undefined) setStep3SubStep(step3Sub);
    if (stepId === 2 && step2Sub === undefined) setStep2SubStep(0);
    if (stepId === 3 && step3Sub === undefined) setStep3SubStep(0);
    const base = "/company-onboarding";
    const path = `${base}?step=${stepId}`;
    window.history.replaceState(null, "", path);
    setLocation(path);
    saveCompanyOnboardingProgress({ step: stepId, step2SubStep: stepId === 2 ? (step2Sub ?? 0) : undefined, step3SubStep: stepId === 3 ? (step3Sub ?? 0) : undefined });
  };
  const [hasScrolledContract, setHasScrolledContract] = useState(false);
  
  // Check if user came from Google OAuth
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);
  
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const googleAuth = searchParams.get("googleAuth");
    const onboardingDataParam = searchParams.get("onboardingData");
    
    if (googleAuth === "true") {
      setIsGoogleAuth(true);
      // Restore onboarding data if present
      if (onboardingDataParam) {
        try {
          const data = JSON.parse(decodeURIComponent(onboardingDataParam));
          if (data.firstName) setBusinessInfo(prev => ({ ...prev, firstName: data.firstName || prev.firstName }));
          if (data.lastName) setBusinessInfo(prev => ({ ...prev, lastName: data.lastName || prev.lastName }));
          if (data.companyEmail) setBusinessInfo(prev => ({ ...prev, companyEmail: data.companyEmail || prev.companyEmail }));
          if (data.stepAtAuth !== undefined) {
            setStepAndUrl(data.stepAtAuth + 1);
          }
        } catch (e) {
          console.error("Error parsing onboarding data:", e);
        }
      }
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    } else if (isAuthenticated && user) {
      // Check if user is Google-only (no passwordHash or authProvider is google)
      if (!user.passwordHash || user.authProvider === "google") {
        setIsGoogleAuth(true);
      }
      // If user is authenticated via Google and on step 0, go to step 1
      if (isGoogleAuth && step === 0) {
        setStepAndUrl(1);
      }
    }
  }, [isAuthenticated, user, step, isGoogleAuth]);

  // Form data
  const [businessInfo, setBusinessInfo] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    companyEmail: user?.email || "",
    altEmail: "",
    companyName: "",
    phone: "",
    altPhone: "",
  });

  const [locations, setLocations] = useState<LocationData[]>([{
    name: "Main Office",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    isStarred: true,
    isPrimary: true,
  }]);

  const [teamInvites, setTeamInvites] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    jobPosition: string;
    role: "admin" | "manager" | "viewer";
    locationIds: string[];
  }[]>([]);
  const [inviteWizardStep, setInviteWizardStep] = useState(0); // 0=list, 1=details, 2=role, 3=locations, 4=review
  const [step2SubStep, setStep2SubStep] = useState(0); // 0=account, 1=locations, 2=teammates
  const [step3SubStep, setStep3SubStep] = useState(0); // 0=how billing works, 1=add payment method
  
  // Payment step state (SetupIntent)
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [paymentMethodAdded, setPaymentMethodAdded] = useState(false);
  const [paymentSetupError, setPaymentSetupError] = useState<string | null>(null);
  
  // Hiring preferences - industry verticals
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  
  // Payment info dialog
  const [showPaymentInfoDialog, setShowPaymentInfoDialog] = useState(false);
  
  const [currentInviteData, setCurrentInviteData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    jobPosition: "",
    role: "manager" as "admin" | "manager" | "viewer",
    locationIds: [] as string[],
  });


  // Payment & Agreement
  const [signatureDate, setSignatureDate] = useState(getESTTime().toISOString().split("T")[0]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showLocationPopup, setShowLocationPopup] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [testBypass, setTestBypass] = useState(false);
  
  // Payment method selection
  const [paymentMethod, setPaymentMethod] = useState<"ach" | "card">("ach");
  const [stripeConfig, setStripeConfig] = useState<{
    publishableKey: string | null;
    configured: boolean;
    cardFeePercentage: number;
  } | null>(null);
  const [cardPaymentProcessing, setCardPaymentProcessing] = useState(false);
  const [cardPaymentError, setCardPaymentError] = useState<string | null>(null);
  const [cardPaymentSuccess, setCardPaymentSuccess] = useState(false);
  
  // Bank Account (ACH)
  const [bankAccount, setBankAccount] = useState({
    bankName: "",
    routingNumber: "",
    accountNumber: "",
    confirmAccountNumber: "",
    accountType: "checking" as "checking" | "savings",
  });
  const [bankErrors, setBankErrors] = useState<Record<string, string>>({});
  const [bankConnected, setBankConnected] = useState(false);
  
  // Agreement signing - styled like worker onboarding
  const contractScrollRef = useRef<HTMLDivElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadContainerRef = useRef<HTMLDivElement>(null);
  const [signatureText, setSignatureText] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null); // drawn signature (data URL)
  const [signatureHovered, setSignatureHovered] = useState(false);
  const [isEditingSignature, setIsEditingSignature] = useState(false);
  const [pendingSignatureName, setPendingSignatureName] = useState("");
  const [showSignatureDoneButton, setShowSignatureDoneButton] = useState(false); // show Done/Clear only after user has drawn at least one stroke

  // Business logo (step 2 substep 0)
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Email registration state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isEmailSignupMode, setIsEmailSignupMode] = useState(false);
  // Show password fields if: user clicked email signup AND they haven't registered yet (no user) AND not Google auth
  const isEmailSignup = isEmailSignupMode && !user && !isGoogleAuth;
  const [newLocation, setNewLocation] = useState<LocationData>({
    name: "",
    address: "",
    address2: "",
    city: "",
    state: "",
    zipCode: "",
    isStarred: false,
    isPrimary: false,
  });

  // Fetch existing profile
  const { data: profile } = useQuery<Profile>({
    queryKey: ["/api/profiles", user?.id],
    enabled: !!user?.id,
  });

  // When on payment step, check if company already has payment methods so Continue can be enabled
  const { data: existingPaymentMethods } = useQuery<unknown[]>({
    queryKey: ["/api/company/payment-methods"],
    enabled: !!user?.id && step === 3 && step3SubStep === 1,
  });
  useEffect(() => {
    if (Array.isArray(existingPaymentMethods) && existingPaymentMethods.length > 0) {
      setPaymentMethodAdded(true);
    }
  }, [existingPaymentMethods]);

  // Auto-populate form if profile exists
  useEffect(() => {
    if (profile) {
      setBusinessInfo(prev => ({
        ...prev,
        firstName: profile.firstName || prev.firstName,
        lastName: profile.lastName || prev.lastName,
        companyEmail: profile.email || prev.companyEmail,
        companyName: profile.companyName || prev.companyName,
        phone: profile.phone || prev.phone,
      }));
      if ((profile as { companyLogo?: string }).companyLogo) {
        setCompanyLogoUrl((profile as { companyLogo?: string }).companyLogo);
      }
    }
  }, [profile]);

  // Persist onboarding progress so refresh remembers step and form data
  const saveCompanyOnboardingProgress = useCallback((overrides?: { step?: number; step2SubStep?: number; step3SubStep?: number }) => {
    try {
      const payload = {
        step: overrides?.step ?? step,
        step2SubStep: overrides?.step2SubStep ?? step2SubStep,
        step3SubStep: overrides?.step3SubStep ?? step3SubStep,
        businessInfo,
        locations,
        teamInvites,
        selectedIndustries,
        companyLogoUrl,
        inviteWizardStep,
        hasScrolledContract,
        signatureDate,
        newLocation,
        timestamp: Date.now(),
      };
      localStorage.setItem(COMPANY_ONBOARDING_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error("Error saving company onboarding progress:", e);
    }
  }, [step, step2SubStep, step3SubStep, businessInfo, locations, teamInvites, selectedIndustries, companyLogoUrl, inviteWizardStep, hasScrolledContract, signatureDate, newLocation]);

  const loadCompanyOnboardingProgress = useCallback(() => {
    try {
      const raw = localStorage.getItem(COMPANY_ONBOARDING_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const daysSince = (Date.now() - (data.timestamp || 0)) / (1000 * 60 * 60 * 24);
      if (daysSince > ONBOARDING_PROGRESS_MAX_AGE_DAYS) {
        localStorage.removeItem(COMPANY_ONBOARDING_STORAGE_KEY);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const stepParam = params.get("step");
      if (stepParam === null && data.step !== undefined) {
        const n = Number(data.step);
        if (!isNaN(n) && n >= 0 && n <= TOTAL_STEPS) {
          setStep(n);
          setLocation(n === 0 ? "/company-onboarding" : `/company-onboarding?step=${n}`);
        }
      }
      if (data.step2SubStep !== undefined) setStep2SubStep(Number(data.step2SubStep));
      if (data.step3SubStep !== undefined) setStep3SubStep(Number(data.step3SubStep));
      if (data.businessInfo && typeof data.businessInfo === "object") {
        setBusinessInfo((prev) => ({ ...prev, ...data.businessInfo }));
      }
      if (Array.isArray(data.locations) && data.locations.length > 0) {
        setLocations(data.locations);
      }
      if (Array.isArray(data.teamInvites)) {
        setTeamInvites(data.teamInvites);
      }
      if (Array.isArray(data.selectedIndustries)) {
        setSelectedIndustries(data.selectedIndustries);
      }
      if (data.companyLogoUrl != null) setCompanyLogoUrl(data.companyLogoUrl);
      if (data.inviteWizardStep !== undefined) setInviteWizardStep(Number(data.inviteWizardStep));
      if (data.hasScrolledContract !== undefined) setHasScrolledContract(Boolean(data.hasScrolledContract));
      if (data.signatureDate != null) setSignatureDate(data.signatureDate);
      if (data.newLocation && typeof data.newLocation === "object") {
        setNewLocation((prev) => ({ ...prev, ...data.newLocation }));
      }
    } catch (e) {
      console.error("Error loading company onboarding progress:", e);
    }
  }, []);

  const clearCompanyOnboardingProgress = useCallback(() => {
    localStorage.removeItem(COMPANY_ONBOARDING_STORAGE_KEY);
  }, []);

  // Restore progress from localStorage on mount (step from URL takes precedence)
  useEffect(() => {
    loadCompanyOnboardingProgress();
  }, [loadCompanyOnboardingProgress]);

  // Save progress when step, substeps, or form data changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      saveCompanyOnboardingProgress();
    }, 1000);
    return () => clearTimeout(t);
  }, [step, step2SubStep, step3SubStep, businessInfo, locations, teamInvites, selectedIndustries, companyLogoUrl, inviteWizardStep, hasScrolledContract, signatureDate, newLocation, saveCompanyOnboardingProgress]);

  // Prepopulate from affiliate lead when URL has ref and lead (redeem link from Sales kanban)
  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const ref = params.get("ref");
    const leadToken = params.get("lead");
    if (!ref || !leadToken) return;
    fetch(`/api/affiliates/lead-by-token?ref=${encodeURIComponent(ref)}&lead=${encodeURIComponent(leadToken)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; companyName?: string | null } | null) => {
        if (data)
          setBusinessInfo(prev => ({
            ...prev,
            firstName: data.firstName ?? prev.firstName ?? "",
            lastName: data.lastName ?? prev.lastName ?? "",
            companyEmail: data.email ?? prev.companyEmail ?? "",
            companyName: data.companyName ?? prev.companyName ?? "",
            phone: data.phone ?? prev.phone ?? "",
          }));
      })
      .catch(() => {});
  }, []);

  // Fetch Stripe config on mount
  useEffect(() => {
    const fetchStripeConfig = async () => {
      try {
        const res = await fetch("/api/stripe/config");
        if (res.ok) {
          const config = await res.json();
          setStripeConfig(config);
          if (config.publishableKey) {
            setStripePromise(loadStripe(config.publishableKey));
          }
        }
      } catch (err) {
        console.error("Failed to fetch Stripe config:", err);
      }
    };
    fetchStripeConfig();
  }, []);

  // Create or update profile mutation
  const profileMutation = useMutation({
    mutationFn: async (data: any) => {
      if (profile?.id) {
        return apiRequest("PUT", `/api/profiles/${profile.id}`, data);
      } else {
        const ref = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("ref");
        return apiRequest("POST", "/api/profiles", { ...data, role: "company", ...(ref ? { ref } : {}) });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
    },
  });

  // Save locations mutation
  const locationMutation = useMutation({
    mutationFn: async (locationData: LocationData) => {
      return apiRequest("POST", "/api/locations", locationData);
    },
  });

  // Save team invites mutation
  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequest("POST", "/api/team-invites", { email });
    },
  });

  // Handle logo upload (presigned URL flow - works without profile)
  const handleLogoUpload = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image (PNG, JPG)", variant: "destructive" });
      return;
    }
    setIsUploadingLogo(true);
    try {
      assertMaxUploadSize(file);
      const fileToUpload = await compressImageIfNeeded(file);
      const urlResponse = await apiRequest("POST", "/api/uploads/request-url", {
        name: fileToUpload.name,
        size: fileToUpload.size,
        contentType: fileToUpload.type,
      });
      const { uploadURL, objectPath } = await urlResponse.json();
      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: fileToUpload,
        headers: { "Content-Type": fileToUpload.type },
      });
      if (!uploadResponse.ok) throw new Error("Upload failed");
      setCompanyLogoUrl(objectPath);
    } catch (error) {
      console.error("Logo upload error:", error);
      toast({ title: "Upload failed", description: "Could not upload logo. Please try again.", variant: "destructive" });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  // Contract scroll detection
  const handleContractScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    if (isAtBottom) {
      setHasScrolledContract(true);
    }
  };

  // Scroll contract to bottom and enable signing
  const scrollToBottomOfContract = () => {
    const el = contractScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      // No overflow – already “at bottom”, enable signing
      setHasScrolledContract(true);
      return;
    }
    el.scrollTo({ top: maxScroll, behavior: "smooth" });
    // Ensure signing enables after smooth scroll completes (scroll event may not fire in some cases)
    const done = () => setHasScrolledContract(true);
    el.addEventListener("scroll", function onScroll() {
      if (el.scrollHeight - el.scrollTop <= el.clientHeight + 50) {
        el.removeEventListener("scroll", onScroll);
        done();
      }
    }, { once: true });
    setTimeout(done, 900);
  };

  const clearSignaturePad = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setShowSignatureDoneButton(false);
  };

  const captureSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setSignatureData(dataUrl);
    completeOnboarding(dataUrl);
  };

  // Draw signature pad: canvas and mouse/touch when step 4, scrolled, and no signature yet
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    const container = signaturePadContainerRef.current;
    if (!canvas || !container || step !== 4 || signatureData || signatureText) return;
    if (!hasScrolledContract) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth || 400;
    const height = 100;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let drawing = false;
    const getPos = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    };
    const start = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      drawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!drawing) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };
    const end = () => {
      if (drawing) setShowSignatureDoneButton(true);
      drawing = false;
    };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    return () => {
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseup", end);
      canvas.removeEventListener("mouseleave", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
    };
  }, [step, hasScrolledContract, signatureData, signatureText, setShowSignatureDoneButton]);

  // Bank account validation
  const validateBankAccount = () => {
    const errors: Record<string, string> = {};
    if (bankAccount.routingNumber.length !== 9) {
      errors.routingNumber = "Routing number must be 9 digits";
    }
    if (!bankAccount.accountNumber || bankAccount.accountNumber.length < 4) {
      errors.accountNumber = "Please enter a valid account number";
    }
    if (bankAccount.accountNumber !== bankAccount.confirmAccountNumber) {
      errors.confirmAccountNumber = "Account numbers do not match";
    }
    setBankErrors(errors);
    return Object.keys(errors).length === 0;
  };
  
  const handleConnectBank = () => {
    if (validateBankAccount()) {
      setBankConnected(true);
      toast({ title: "Bank Account Verified", description: "Your bank account has been connected successfully." });
    }
  };
  
  // Auto-sign for agreement (like worker onboarding)
  const handleAutoSign = () => {
    if (hasScrolledContract) {
      // Show edit mode with suggested name
      setPendingSignatureName(`${businessInfo.firstName} ${businessInfo.lastName}`);
      setIsEditingSignature(true);
    }
  };
  
  const confirmSignature = async () => {
    const trimmedName = pendingSignatureName.trim();
    if (trimmedName) {
      setSignatureText(trimmedName);
      setIsEditingSignature(false);
      // Trigger completion with the signature
      await completeOnboarding(trimmedName);
    }
  };



  // Add location
  const addLocation = () => {
    setLocations([...locations, {
      name: `Location ${locations.length + 1}`,
      address: "",
      city: "",
      state: "",
      zipCode: "",
      isStarred: false,
      isPrimary: false,
    }]);
  };

  // Remove location
  const removeLocation = (index: number) => {
    if (locations.length === 1) return;
    setLocations(locations.filter((_, i) => i !== index));
  };

  // Toggle star location
  // Add team invite (with duplicate check)
  const addTeamInvite = () => {
    // Check for duplicate email
    const isDuplicate = teamInvites.some(invite => invite.email.toLowerCase() === currentInviteData.email.toLowerCase());
    if (isDuplicate) {
      toast({ title: "Duplicate Email", description: "This email has already been added to invites", variant: "destructive" });
      return;
    }
    setTeamInvites([...teamInvites, { ...currentInviteData }]);
    setCurrentInviteData({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      jobPosition: "",
      role: "manager",
      locationIds: [],
    });
    setInviteWizardStep(0);
    toast({ title: "Invite Added", description: `${currentInviteData.email} will receive an invitation after you complete onboarding` });
  };

  // Remove team invite
  const removeTeamInvite = (index: number) => {
    setTeamInvites(teamInvites.filter((_, i) => i !== index));
  };
  
  // Reset invite wizard
  const resetInviteWizard = () => {
    setInviteWizardStep(0);
    setCurrentInviteData({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      jobPosition: "",
      role: "manager",
      locationIds: [],
    });
  };


  // Validate password
  const validatePassword = (pwd: string): { valid: boolean; error: string | null } => {
    if (pwd.length < 8) {
      return { valid: false, error: "Password must be at least 8 characters" };
    }
    if (!/[A-Z]/.test(pwd)) {
      return { valid: false, error: "Password must contain an uppercase letter" };
    }
    if (!/[a-z]/.test(pwd)) {
      return { valid: false, error: "Password must contain a lowercase letter" };
    }
    if (!/[0-9]/.test(pwd)) {
      return { valid: false, error: "Password must contain a number" };
    }
    return { valid: true, error: null };
  };

  const step2MaxSubStep = 3;
  const step2OnLastSubStep = step2SubStep === step2MaxSubStep - 1;

  // Fetch Stripe config and create SetupIntent when entering Payment step substep 1
  const initPaymentForm = useCallback(async () => {
    setPaymentSetupError(null);
    setSetupClientSecret(null);
    try {
      const configRes = await fetch("/api/stripe/config", { credentials: "include" });
      if (!configRes.ok) {
        setPaymentSetupError("Could not load Stripe configuration.");
        return;
      }
      let config: { configured?: boolean; publishableKey?: string } = {};
      try {
        config = await configRes.json();
      } catch {
        setPaymentSetupError("Invalid server response.");
        return;
      }
      if (!config?.configured) {
        setPaymentSetupError("Payment is not configured. Please contact support.");
        return;
      }
      if (config.publishableKey) {
        const stripe = await loadStripe(config.publishableKey);
        setStripePromise(stripe);
      }
      const setupRes = await fetch("/api/stripe/create-setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      let setupData: { clientSecret?: string; message?: string } = {};
      try {
        setupData = await setupRes.json();
      } catch {
        setPaymentSetupError(setupRes.ok ? "Could not initialize payment form." : "Server error. Please try again.");
        return;
      }
      if (setupRes.ok && setupData.clientSecret) {
        setSetupClientSecret(setupData.clientSecret);
      } else {
        setPaymentSetupError(setupData?.message || "Could not initialize payment form.");
      }
    } catch (e: any) {
      setPaymentSetupError(e?.message || "Could not load payment form.");
    }
  }, []);

  // Handle return from Stripe redirect (e.g. bank auth): process success in current session without requiring step3SubStep
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectStatus = params.get("redirect_status");
    const setupIntentId = params.get("setup_intent");
    if (redirectStatus === "succeeded" && setupIntentId) {
      (async () => {
        try {
          const res = await fetch("/api/stripe/confirm-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ setupIntentId }),
          });
          if (res.ok) {
            setPaymentMethodAdded(true);
            toast({ title: "Payment method added", description: "Your payment method has been saved." });
            params.delete("setup_intent");
            params.delete("setup_intent_client_secret");
            params.delete("redirect_status");
            params.delete("redirect_pm_type");
            const clean = params.toString();
            window.history.replaceState({}, "", `${window.location.pathname}${clean ? `?${clean}` : ""}`);
            setTimeout(() => setStepAndUrl(4), 0);
          } else {
            let data: { message?: string } = {};
            try {
              data = await res.json();
            } catch {
              data = {};
            }
            const msg = (data.message || "").toLowerCase();
            const alreadySaved =
              res.status === 400 &&
              (msg.includes("already saved") ||
                msg.includes("this card is already") ||
                msg.includes("this bank account is already") ||
                msg.includes("already have"));
            if (alreadySaved) {
              setPaymentMethodAdded(true);
              toast({ title: "Payment method added", description: "This payment method is already saved." });
              params.delete("setup_intent");
              params.delete("setup_intent_client_secret");
              params.delete("redirect_status");
              params.delete("redirect_pm_type");
              const clean = params.toString();
              window.history.replaceState({}, "", `${window.location.pathname}${clean ? `?${clean}` : ""}`);
              setTimeout(() => setStepAndUrl(4), 0);
            } else if (step === 3 && step3SubStep === 1) {
              initPaymentForm();
            }
          }
        } catch {
          if (step === 3 && step3SubStep === 1) initPaymentForm();
        }
      })();
      return;
    }
    if (step === 3 && step3SubStep === 1) initPaymentForm();
  }, [location, step, step3SubStep, initPaymentForm, toast]);

  // Save and continue
  const handleNext = async () => {
    if (step === 2 && !step2OnLastSubStep) {
      if (isEmailSignupMode && step2SubStep === 0) {
        // Validate password
        const pwdValidation = validatePassword(password);
        if (!pwdValidation.valid) {
          setRegistrationError(pwdValidation.error);
          return;
        }
        
        if (password !== confirmPassword) {
          setRegistrationError("Passwords do not match");
          return;
        }

        // Validate required fields
        if (!businessInfo.companyEmail.includes("@")) {
          setRegistrationError("Valid email is required");
          return;
        }

        // Register the user
        setIsRegistering(true);
        try {
          const response = await apiRequest("POST", "/api/auth/register", {
            email: businessInfo.companyEmail,
            password,
            firstName: businessInfo.firstName,
            lastName: businessInfo.lastName,
            userType: "company",
          });
          
          const result = await response.json();
          if (!result.success) {
            setRegistrationError(result.message || "Registration failed");
            setIsRegistering(false);
            return;
          }
          
          // Refresh authentication state
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          
          toast({ title: "Account created!", description: "Welcome to Tolstoy Staffing" });
        } catch (error: any) {
          const errorData = await error?.json?.().catch(() => null);
          setRegistrationError(errorData?.message || "Registration failed. Please try again.");
          setIsRegistering(false);
          return;
        }
        setIsRegistering(false);
      }
      setStep2SubStep(step2SubStep + 1);
      return;
    }
    if (step === 2) {
      try {
        await profileMutation.mutateAsync({
          firstName: businessInfo.firstName,
          lastName: businessInfo.lastName,
          email: businessInfo.companyEmail,
          companyName: businessInfo.companyName,
          phone: businessInfo.phone,
          onboardingStep: 3,
          hiringIndustries: selectedIndustries,
          ...(companyLogoUrl ? { companyLogo: companyLogoUrl } : {}),
        });
      } catch (error) {
        toast({ title: "Error", description: "Failed to save information", variant: "destructive" });
        return;
      }
    }
    
    if (step === 3 && step3SubStep === 0) {
      setStep3SubStep(1);
      return;
    }
    if (step === 3 && step3SubStep === 1) {
      setStepAndUrl(4);
      return;
    }
    
    if (step < TOTAL_STEPS) {
      setStepAndUrl(step + 1);
    }
  };

  const handleBack = () => {
    if (step === 3 && step3SubStep > 0) {
      setStep3SubStep(step3SubStep - 1);
    } else if (step === 2 && step2SubStep > 0) {
      setStep2SubStep(step2SubStep - 1);
    } else if (step > 0) {
      setStepAndUrl(step - 1);
    }
  };

  const completeOnboarding = async (signature: string) => {
    if (testBypass) {
      return;
    }
    if (!signature) {
      toast({ title: "Please sign the agreement to continue", variant: "destructive" });
      return;
    }
    
    try {
      // Save final profile with signature - no deposit during onboarding; payment method saved separately
      await profileMutation.mutateAsync({
        contractSigned: true,
        contractSignedAt: new Date().toISOString(),
        signatureData: signature,
        depositAmount: 0,
        onboardingStatus: "complete",
        onboardingStep: 6,
        hiringIndustries: selectedIndustries,
      });

      // Store signed agreement in company's menu of agreements
      await apiRequest("POST", "/api/company-agreements", {
        agreementType: "hiring_agreement",
        version: "1.0",
        signedName: signature,
        signatureData: signature,
        agreementText: COMPANY_AGREEMENT_TEXT,
      });

      // Save all locations entered during onboarding
      if (locations.length > 0) {
        const locationResults = await Promise.allSettled(
          locations
            .filter(loc => loc.name && loc.address && loc.city && loc.state && loc.zipCode)
            .map((loc, idx) =>
              apiRequest("POST", "/api/locations", {
                name: loc.name,
                address: loc.address,
                city: loc.city,
                state: loc.state,
                zipCode: loc.zipCode,
                isPrimary: idx === 0 || loc.isPrimary,
              })
            )
        );
        const failedLocations = locationResults.filter((r) => r.status === "rejected");
        if (failedLocations.length > 0) {
          console.error("Some locations failed to save:", failedLocations);
        }
      }

      // Create team invites and send invitation emails
      if (teamInvites.length > 0) {
        const results = await Promise.allSettled(
          teamInvites.map((inv) =>
            apiRequest("POST", "/api/team-invites", {
              email: inv.email,
              firstName: inv.firstName || undefined,
              lastName: inv.lastName || undefined,
              phone: inv.phone || undefined,
              jobPosition: inv.jobPosition || undefined,
              role: inv.role || "manager",
              locationIds: inv.locationIds || [],
            })
          )
        );
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          console.error("Some team invite emails failed to send:", failed);
        }
      }
      
      clearCompanyOnboardingProgress();
      // Show success with confetti
      setShowSuccess(true);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      toast({ title: "Welcome to Tolstoy Staffing!", description: "Your account is ready to hire workers." });
      setTimeout(() => {
        setLocation("/company-dashboard");
      }, 3000);
    } catch (error: any) {
      console.error("Onboarding error:", error);
      const errorMessage = error?.message || error?.data?.message || "Failed to complete onboarding";
      const errorField = error?.data?.field;
      toast({ 
        title: "Onboarding Error", 
        description: errorField ? `${errorMessage} (field: ${errorField})` : errorMessage, 
        variant: "destructive" 
      });
    }
  };

  const progress = (step / TOTAL_STEPS) * 100;

  // Two-panel layout (Worker-style): left sidebar desktop, step banner mobile
  return (
    <div className="h-screen flex flex-col bg-white">
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Step Navigation (desktop only) */}
        <aside className="hidden md:block w-80 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-lg">T</span>
              </div>
              <span className="text-lg font-semibold text-gray-900">Company onboarding</span>
            </div>
            <nav className="space-y-6">
              {COMPANY_STEPS.map((s) => {
                const isStepActive = s.id === step;
                const stepCompleted = step > s.id;
                return (
                  <div key={s.id} className="space-y-2">
                    <div className="flex items-center gap-3">
                      {isStepActive ? (
                        <div className="w-8 h-8 rounded-full bg-[#00A86B] flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-bold text-base">{s.id}</span>
                        </div>
                      ) : stepCompleted ? (
                        <div className="w-8 h-8 rounded-full bg-white border border-gray-300 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-gray-800" strokeWidth={2.5} />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-bold text-base">{s.id}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => navigateToStepAndSub(s.id, s.id === 2 ? 0 : undefined, s.id === 3 ? 0 : undefined)}
                        className={`text-sm font-semibold text-left ${isStepActive ? "text-gray-900" : "text-gray-600"} hover:text-gray-900`}
                      >
                        {s.title}
                      </button>
                    </div>
                    <div className="space-y-1 pl-11">
                      {s.subSteps.map((sub, subIdx) => {
                        const isActive = isStepActive && (s.id !== 2 || subIdx === step2SubStep) && (s.id !== 3 || subIdx === step3SubStep);
                        const isCompleted = stepCompleted || (s.id === 2 && isStepActive && subIdx < step2SubStep) || (s.id === 3 && isStepActive && subIdx < step3SubStep);
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => navigateToStepAndSub(s.id, s.id === 2 ? subIdx : undefined, s.id === 3 ? subIdx : undefined)}
                            className={`w-full flex items-center gap-3 py-1.5 px-3 rounded-xl text-left ${
                              isActive ? "bg-green-50 text-[#00A86B] font-medium" : isCompleted ? "bg-white border border-gray-300 text-gray-900 font-medium" : "text-gray-400 hover:text-gray-600"
                            }`}
                          >
                            {isCompleted ? (
                              <div className="w-5 h-5 rounded-full border border-gray-300 bg-white flex items-center justify-center flex-shrink-0">
                                <CheckCircle2 className="w-3 h-3 text-gray-800" strokeWidth={2.5} />
                              </div>
                            ) : isActive ? (
                              <div className="w-5 h-5 rounded-full border-2 border-[#00A86B] bg-green-50 flex items-center justify-center flex-shrink-0">
                                <div className="w-2 h-2 rounded-full bg-[#00A86B]" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300 bg-green-50 flex-shrink-0" />
                            )}
                            <span className="text-sm">{sub.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Right Panel - Content */}
        <main className="flex-1 min-w-0 flex flex-col bg-white relative">
          {/* Mobile: compact header on welcome (step 0) */}
          {isMobile && step === 0 && (
            <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-lg">T</span>
              </div>
              <span className="text-base font-semibold text-gray-900">Company onboarding</span>
            </div>
          )}
          {/* Mobile: step progress banner */}
          {isMobile && step >= 1 && step <= 4 && (
            <div className="border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="px-4 py-3">
                <div className="flex items-center w-full gap-0">
                  {[1, 2, 3, 4, 5].map((stepNum, index) => (
                    <div key={stepNum} className={`flex items-center ${index < 4 ? "flex-1 min-w-0" : "flex-shrink-0"}`}>
                      {stepNum <= step ? (
                        <Link
                          href={`/company-onboarding?step=${stepNum}`}
                          className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                            step === stepNum ? "bg-primary text-primary-foreground" : "bg-white border border-gray-300 text-gray-700"
                          }`}
                          aria-current={step === stepNum ? "step" : undefined}
                        >
                          {step > stepNum ? <Check className="w-4 h-4" strokeWidth={2.5} /> : stepNum}
                        </Link>
                      ) : (
                        <span
                          className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold bg-gray-200 text-gray-500`}
                          aria-current={step === stepNum ? "step" : undefined}
                        >
                          {stepNum}
                        </span>
                      )}
                      {index < 3 && (
                        <div className={`flex-1 h-0.5 min-w-[6px] mx-0.5 rounded-full transition-colors ${step > stepNum ? "bg-primary" : "bg-gray-300"}`} aria-hidden />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Desktop: step header above scroll */}
          {!isMobile && step >= 1 && step <= 4 && (
            <header className="border-b border-gray-200 bg-white shrink-0">
              <div className="max-w-3xl mx-auto px-4 md:px-8 py-4 flex items-start gap-4">
                {step === 1 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Briefcase className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">What industries do you hire for?</h2>
                      <p className="text-sm text-gray-600 mt-1">Select all the industries where you need workers.</p>
                    </div>
                  </>
                )}
                {step === 2 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {step2SubStep === 0 ? <Building2 className="w-6 h-6 text-primary" /> : step2SubStep === 1 ? <MapPin className="w-6 h-6 text-primary" /> : <Users className="w-6 h-6 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {step2SubStep === 0 && <><h2 className="text-xl font-bold text-gray-900">Business details</h2><p className="text-sm text-gray-600 mt-1">Tell us about your company.</p></>}
                      {step2SubStep === 1 && <><h2 className="text-xl font-bold text-gray-900">Company locations</h2><p className="text-sm text-gray-600 mt-1">Add your project sites and where you operate.</p></>}
                      {step2SubStep === 2 && <>
                        <h2 className="text-xl font-bold text-gray-900">
                          {inviteWizardStep === 0 ? "Team access" : inviteWizardStep === 1 ? "Member details" : inviteWizardStep === 2 ? "Select role" : inviteWizardStep === 3 ? "Location access" : "Review invitation"}
                        </h2>
                        <p className="text-sm text-gray-600 mt-1">
                          {inviteWizardStep === 0 ? "Teammates are optional. Your admin account will be associated with your location(s) by default." :
                           inviteWizardStep === 1 ? "Enter the new team member's information." :
                           inviteWizardStep === 2 ? "Choose what this team member can do." :
                           inviteWizardStep === 3 ? "Select which locations they can access." : "Review and add the invitation."}
                        </p>
                      </>}
                    </div>
                  </>
                )}
                {step === 3 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {step3SubStep === 0 ? <DollarSign className="w-6 h-6 text-primary" /> : <CreditCard className="w-6 h-6 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {step3SubStep === 0 ? <><h2 className="text-xl font-bold text-gray-900">How billing works</h2><p className="text-sm text-gray-600 mt-1">Understand how you're charged: hourly, location-verified timesheets, and fees.</p></> : <><h2 className="text-xl font-bold text-gray-900">Add payment method</h2><p className="text-sm text-gray-600 mt-1">Add a card or bank account (ACH) via Stripe. No charge now.</p></>}
                    </div>
                  </>
                )}
                {step === 4 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileSignature className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Hiring agreement</h2>
                      <p className="text-sm text-gray-600 mt-1">Review and sign the agreement to complete onboarding.</p>
                    </div>
                  </>
                )}
              </div>
            </header>
          )}

          <div className={`flex-1 min-h-0 ${step === 4 ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
            <div className={`max-w-3xl mx-auto px-4 md:px-8 py-4 md:py-8 pb-32 ${step === 4 ? "flex-1 flex flex-col min-h-0" : ""}`}>
            {/* Mobile: step header inside scroll */}
            {isMobile && step >= 1 && step <= 4 && (
              <header className="border-b border-gray-200 bg-white shrink-0 mb-4">
                <div className="flex items-start gap-4">
                  {step === 1 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Briefcase className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">What industries do you hire for?</h2>
                        <p className="text-sm text-gray-600 mt-1">Select all the industries where you need workers.</p>
                      </div>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {step2SubStep === 0 ? <Building2 className="w-6 h-6 text-primary" /> : step2SubStep === 1 ? <MapPin className="w-6 h-6 text-primary" /> : <Users className="w-6 h-6 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {step2SubStep === 0 && <><h2 className="text-xl font-bold text-gray-900">Business details</h2><p className="text-sm text-gray-600 mt-1">Tell us about your company.</p></>}
                        {step2SubStep === 1 && <><h2 className="text-xl font-bold text-gray-900">Company locations</h2><p className="text-sm text-gray-600 mt-1">Add your project sites.</p></>}
                        {step2SubStep === 2 && <>
                          <h2 className="text-xl font-bold text-gray-900">
                            {inviteWizardStep === 0 ? "Team access" : inviteWizardStep === 1 ? "Member details" : inviteWizardStep === 2 ? "Select role" : inviteWizardStep === 3 ? "Location access" : "Review invitation"}
                          </h2>
                          <p className="text-sm text-gray-600 mt-1">
                            {inviteWizardStep === 0 ? "Teammates are optional." :
                             inviteWizardStep === 1 ? "Enter the new team member's information." :
                             inviteWizardStep === 2 ? "Choose what this team member can do." :
                             inviteWizardStep === 3 ? "Select which locations they can access." : "Review and add the invitation."}
                          </p>
                        </>}
                      </div>
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {step3SubStep === 0 ? <DollarSign className="w-6 h-6 text-primary" /> : <CreditCard className="w-6 h-6 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {step3SubStep === 0 ? <><h2 className="text-xl font-bold text-gray-900">How billing works</h2><p className="text-sm text-gray-600 mt-1">Understand how you're charged.</p></> : <><h2 className="text-xl font-bold text-gray-900">Add payment method</h2><p className="text-sm text-gray-600 mt-1">Add a card or bank account via Stripe. No charge now.</p></>}
                      </div>
                    </>
                  )}
                  {step === 4 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileSignature className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Hiring agreement</h2>
                        <p className="text-sm text-gray-600 mt-1">Review and sign the agreement to complete onboarding.</p>
                      </div>
                    </>
                  )}
                </div>
              </header>
            )}

        {/* Step 0: Welcome - styled like Worker onboarding */}
        {step === 0 && (
          <>
            <div className="mb-6 md:mb-10">
              <h1 className="text-2xl md:text-3xl font-bold mb-2 md:mb-3 text-gray-900">Start Hiring Workers Today</h1>
              <p className="text-base md:text-lg text-gray-600">Join thousands of construction companies finding skilled workers instantly. Get vetted workers, same-day staffing, and pay only for hours worked.</p>
            </div>

            <div className="mb-6 md:mb-8">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 md:p-6 mb-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-0 md:mb-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-2">Why Hire with Tolstoy Staffing?</h2>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      We connect construction companies with skilled labor contractors. Post jobs, get matched with vetted workers, and manage timesheets and payments in one place.
                    </p>
                  </div>
                  <div className="flex-shrink-0 md:ml-6">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center shadow-lg">
                      <Building2 className="w-8 h-8 md:w-10 md:h-10 text-white" strokeWidth={2.5} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-0">
                <div className="bg-white border-x border-t border-gray-200 first:rounded-t-xl last:rounded-b-xl last:border-b">
                  <div className="flex items-start gap-3 md:gap-4 px-4 md:px-6 py-4 md:py-5">
                    <div className="mt-0.5 flex-shrink-0">
                      <div className="w-6 h-6 rounded bg-[#00A86B] flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 md:gap-3 mb-1">
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                        </div>
                        <h3 className="font-bold text-gray-900 text-sm md:text-base">Set Up Your Company</h3>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">Add your business details and work locations in minutes.</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white border-x border-t border-gray-200">
                  <div className="flex items-start gap-3 md:gap-4 px-4 md:px-6 py-4 md:py-5">
                    <div className="mt-0.5 flex-shrink-0">
                      <div className="w-6 h-6 rounded bg-[#00A86B] flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 md:gap-3 mb-1">
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center flex-shrink-0">
                          <FileSignature className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                        </div>
                        <h3 className="font-bold text-gray-900 text-sm md:text-base">Sign Agreement & Payment</h3>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">Review and sign the hiring agreement, set up your deposit and bank for worker payments.</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white border-x border-t border-gray-200 last:rounded-b-xl last:border-b">
                  <div className="flex items-start gap-3 md:gap-4 px-4 md:px-6 py-4 md:py-5">
                    <div className="mt-0.5 flex-shrink-0">
                      <div className="w-6 h-6 rounded bg-[#00A86B] flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 md:gap-3 mb-1">
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center flex-shrink-0">
                          <Briefcase className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                        </div>
                        <h3 className="font-bold text-gray-900 text-sm md:text-base">Start Hiring</h3>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">Post jobs from your dashboard and get matched with vetted workers. Pay only for hours worked.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-4 md:gap-6 mb-6 text-xs md:text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                </div>
                <span className="font-medium">Vetted Workers</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                </div>
                <span className="font-medium">Same-Day Staffing</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                </div>
                <span className="font-medium">Pay Only for Hours Worked</span>
              </div>
            </div>
          </>
        )}

        {/* Step 1: Hiring Preferences - Select Industries */}
        {step === 1 && (
          <Card className="p-[20pt]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="w-5 h-5" />
                What industries do you hire for?
              </CardTitle>
              <CardDescription>
                Select all the industries where you need workers. This helps us match you with the right talent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              
              {selectedIndustries.length === 0 && (
                <div className="p-3 border border-yellow-500/30 bg-yellow-500/10 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Please select at least one industry to continue.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Business & Locations - substeps: account (0), locations (1); hidden on teammates (2) */}
        {step === 2 && step2SubStep !== 2 && (
          <Card className="p-[20pt]">
            <>
              {step2SubStep === 0 && (
              <>
              {/* Logo upload - styled like workers avatar (no face upload) */}
              <div className="flex flex-col items-center">
                <label htmlFor="company-logo-upload" className="cursor-pointer group block">
                  <div className="w-32 h-32 rounded-full border-4 border-dashed border-border bg-muted/50 flex items-center justify-center overflow-hidden hover:border-primary/50 transition-colors relative">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      id="company-logo-upload"
                      disabled={isUploadingLogo}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(file);
                        e.target.value = "";
                      }}
                      data-testid="input-company-logo"
                    />
                    {isUploadingLogo ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : companyLogoUrl ? (
                      <img src={companyLogoUrl} alt="Company logo" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center text-muted-foreground">
                        <ImageIcon className="w-8 h-8 mb-2" />
                        <span className="text-xs">Upload logo</span>
                      </div>
                    )}
                    {companyLogoUrl && !isUploadingLogo && (
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-white" />
                      </div>
                    )}
                  </div>
                </label>
                <p className="text-xs text-muted-foreground mt-2">Click to upload logo (PNG, JPG up to 5MB)</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={businessInfo.firstName}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, firstName: e.target.value })}
                    data-testid="input-first-name"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={businessInfo.lastName}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, lastName: e.target.value })}
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={businessInfo.companyName}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, companyName: e.target.value })}
                  data-testid="input-company-name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="companyEmail">Company Email</Label>
                  <Input
                    id="companyEmail"
                    type="email"
                    value={businessInfo.companyEmail}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, companyEmail: e.target.value })}
                    data-testid="input-company-email"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={businessInfo.phone}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, phone: e.target.value })}
                    data-testid="input-phone"
                  />
                </div>
              </div>

              {isEmailSignupMode && (
                <div className="border-t pt-6">
                  <h3 className="font-semibold mb-4">Create Your Password</h3>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); setRegistrationError(null); }}
                          placeholder="Create a password"
                          className="pr-10"
                          data-testid="input-password"
                        />
                        <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Must be 8+ characters with uppercase, lowercase, and a number</p>
                    </div>
                    <div>
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => { setConfirmPassword(e.target.value); setRegistrationError(null); }}
                          placeholder="Confirm your password"
                          className="pr-10"
                          data-testid="input-confirm-password"
                        />
                        <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {registrationError && (
                      <div className="p-3 border border-destructive/30 bg-destructive/10 rounded-lg flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                        <p className="text-sm text-destructive">{registrationError}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Separator className="my-4" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="altEmail">Alternate Email (optional)</Label>
                  <Input
                    id="altEmail"
                    type="email"
                    value={businessInfo.altEmail}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, altEmail: e.target.value })}
                    data-testid="input-alt-email"
                  />
                </div>
                <div>
                  <Label htmlFor="altPhone">Alternate Phone (optional)</Label>
                  <Input
                    id="altPhone"
                    type="tel"
                    value={businessInfo.altPhone}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, altPhone: e.target.value })}
                    data-testid="input-alt-phone"
                  />
                </div>
              </div>
              </>
              )}
              {step2SubStep === 1 && (
              <div>
                <div className="mb-4">
                  <h3 className="font-semibold">Company Locations</h3>
                  <p className="text-sm text-muted-foreground">
                    Add your project sites. You can have different jobs at different locations.
                  </p>
                </div>

                <div className="space-y-4">
                  {locations.map((loc, i) => (
                    <div key={i} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Input
                          value={loc.name}
                          onChange={(e) => {
                            const updated = [...locations];
                            updated[i].name = e.target.value;
                            setLocations(updated);
                          }}
                          placeholder="Location name (e.g., Main Office)"
                          className="max-w-xs"
                          data-testid={`input-location-name-${i}`}
                        />
                        {locations.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => removeLocation(i)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>

                      <GooglePlacesAutocomplete
                        id={`location-address-${i}`}
                        label="Address"
                        value={loc.address}
                        onChange={(address, components) => {
                          const updated = [...locations];
                          updated[i].address = address;
                          updated[i].city = components.city || updated[i].city;
                          updated[i].state = components.state || updated[i].state;
                          updated[i].zipCode = components.zipCode || updated[i].zipCode;
                          setLocations(updated);
                        }}
                        placeholder="Start typing an address..."
                        required={false}
                        data-testid={`input-location-address-${i}`}
                      />
                      <div>
                        <Label htmlFor={`location-address2-${i}`}>Address Line 2 (optional)</Label>
                        <Input
                          id={`location-address2-${i}`}
                          value={loc.address2 || ""}
                          onChange={(e) => {
                            const updated = [...locations];
                            updated[i].address2 = e.target.value;
                            setLocations(updated);
                          }}
                          placeholder="Unit, Suite, etc."
                          data-testid={`input-location-address2-${i}`}
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full p-4 border-2 border-dashed rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-muted/50 transition-colors"
                    onClick={addLocation}
                  >
                    <Plus className="w-4 h-4 mr-2" /> Add Location
                  </Button>
                </div>
                {!locations.some(loc => loc.address.trim()) && (
                  <div className="p-3 border border-yellow-500/30 bg-yellow-500/10 rounded-lg flex items-center gap-2 mt-4">
                    <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Please add at least one location with an address to continue.
                    </p>
                  </div>
                )}
              </div>
              )}
            </>
          </Card>
        )}

        {/* Step 2 substep 2: Team - same Card structure when on teammates substep */}
        {step === 2 && step2SubStep === 2 && (
          <Card className="p-[20pt]">
            <>
              {inviteWizardStep === 0 ? (
                <>
                  {/* Current team members list */}
                  <div>
                    <h4 className="font-medium mb-3">Account Owner</h4>
                    <div className="space-y-2">
                      <Card className="p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback>{businessInfo.firstName?.charAt(0)}{businessInfo.lastName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{businessInfo.firstName} {businessInfo.lastName}</p>
                              <p className="text-sm text-muted-foreground">{businessInfo.companyEmail || user?.email}</p>
                            </div>
                          </div>
                          <Badge>Owner</Badge>
                        </div>
                      </Card>
                    </div>
                  </div>

                  {/* Pending invites from wizard */}
                  {teamInvites.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h4 className="font-medium mb-3">Pending Invites ({teamInvites.length})</h4>
                        <div className="space-y-2">
                          {teamInvites.map((invite, index) => (
                            <Card key={index} className="p-3">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-3 min-w-0">
                                  <Avatar>
                                    <AvatarFallback>{invite.firstName?.[0] || invite.email[0].toUpperCase()}{invite.lastName?.[0] || ""}</AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <p className="font-medium text-sm truncate">{invite.firstName ? `${invite.firstName} ${invite.lastName || ""}`.trim() : invite.email}</p>
                                    {invite.jobPosition && <p className="text-xs text-muted-foreground truncate">{invite.jobPosition}</p>}
                                    {invite.firstName && <p className="text-xs text-muted-foreground truncate">{invite.email}</p>}
                                    {invite.locationIds.length > 0 && (
                                      <p className="text-xs text-muted-foreground">{invite.locationIds.length} location{invite.locationIds.length !== 1 ? "s" : ""}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">{invite.role.charAt(0).toUpperCase() + invite.role.slice(1)}</Badge>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-destructive"
                                    onClick={() => removeTeamInvite(index)}
                                    data-testid={`button-remove-invite-${index}`}
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

                  <p className="text-sm text-muted-foreground">
                    Invite coworkers to help manage hiring, view jobs, and communicate with workers.
                    They'll receive an email invitation after you complete onboarding.
                  </p>
                  
                  <Button 
                    variant="outline"
                    className="w-full mt-4"
                    onClick={() => setInviteWizardStep(1)}
                    data-testid="button-start-invite"
                  >
                    <Plus className="w-4 h-4 mr-2" /> Invite Team Member
                  </Button>
                </>
              ) : (
                <>
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-2 text-sm">
                    <button 
                      onClick={() => resetInviteWizard()} 
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Team
                    </button>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    <span className={inviteWizardStep === 1 ? "font-medium" : "text-muted-foreground"}>Details</span>
                    {inviteWizardStep >= 2 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    {inviteWizardStep >= 2 && <span className={inviteWizardStep === 2 ? "font-medium" : "text-muted-foreground"}>Role</span>}
                    {inviteWizardStep >= 3 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    {inviteWizardStep >= 3 && <span className={inviteWizardStep === 3 ? "font-medium" : "text-muted-foreground"}>Locations</span>}
                    {inviteWizardStep >= 4 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    {inviteWizardStep >= 4 && <span className="font-medium">Review</span>}
                  </div>
                  
                  {/* Step 1: Details */}
                  {inviteWizardStep === 1 && (
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="invite-job-position">Role / Job Title</Label>
                        <Input
                          id="invite-job-position"
                          placeholder="e.g. Project Manager, Foreman, Supervisor"
                          value={currentInviteData.jobPosition}
                          onChange={(e) => setCurrentInviteData(prev => ({ ...prev, jobPosition: e.target.value }))}
                          data-testid="input-invite-job-position"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Their employee role (not permissions)</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>First Name</Label>
                          <Input
                            placeholder="John"
                            value={currentInviteData.firstName}
                            onChange={(e) => setCurrentInviteData(prev => ({ ...prev, firstName: e.target.value }))}
                            data-testid="input-invite-firstname"
                          />
                        </div>
                        <div>
                          <Label>Last Name</Label>
                          <Input
                            placeholder="Smith"
                            value={currentInviteData.lastName}
                            onChange={(e) => setCurrentInviteData(prev => ({ ...prev, lastName: e.target.value }))}
                            data-testid="input-invite-lastname"
                          />
                        </div>

                      </div>
                      <div>
                        <Label>Email Address *</Label>
                        <Input
                          type="email"
                          placeholder="john@company.com"
                          value={currentInviteData.email}
                          onChange={(e) => setCurrentInviteData(prev => ({ ...prev, email: e.target.value }))}
                          data-testid="input-invite-email"
                        />
                      </div>
                      <div>
                        <Label>Phone Number</Label>
                        <Input
                          type="tel"
                          placeholder="(555) 123-4567"
                          value={currentInviteData.phone}
                          onChange={(e) => setCurrentInviteData(prev => ({ ...prev, phone: e.target.value }))}
                          data-testid="input-invite-phone"
                        />
                      </div>
                      {/* Email validation hint */}
                      {currentInviteData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentInviteData.email) && (
                        <p className="text-xs text-muted-foreground">Enter a valid email to continue</p>
                      )}
                      <div className="flex gap-3 pt-2">
                        <Button variant="outline" onClick={() => resetInviteWizard()} className="flex-1">Cancel</Button>
                        <Button 
                          onClick={() => setInviteWizardStep(2)} 
                          disabled={!currentInviteData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentInviteData.email)} 
                          className="flex-1" 
                          data-testid="button-next-role"
                        >
                          Next <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Step 2: Role */}
                  {inviteWizardStep === 2 && (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        {[
                          { value: "admin", label: "Admin", desc: "Full access to all features including billing and team management" },
                          { value: "manager", label: "Manager", desc: "Can post jobs, manage applications, and approve timesheets" },
                          { value: "viewer", label: "Viewer", desc: "Can view jobs and timesheets but cannot make changes" },
                        ].map((role) => (
                          <Card 
                            key={role.value}
                            className={`p-4 cursor-pointer transition-colors ${currentInviteData.role === role.value ? "ring-2 ring-primary" : "hover-elevate"}`}
                            onClick={() => setCurrentInviteData(prev => ({ ...prev, role: role.value as any }))}
                            data-testid={`card-role-${role.value}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${currentInviteData.role === role.value ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {currentInviteData.role === role.value && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div>
                                <p className="font-medium">{role.label}</p>
                                <p className="text-sm text-muted-foreground">{role.desc}</p>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                      <div className="flex gap-3 pt-2">
                        <Button variant="outline" onClick={() => setInviteWizardStep(1)} className="flex-1">Back</Button>
                        <Button onClick={() => setInviteWizardStep(3)} className="flex-1" data-testid="button-next-locations">
                          Next <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Step 3: Locations */}
                  {inviteWizardStep === 3 && (
                    <div className="space-y-4">
                      {currentInviteData.role === "admin" ? (
                        <Card className="p-4 bg-muted/50">
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-green-600" />
                            <span>Admins have full access to all locations</span>
                          </div>
                        </Card>
                      ) : (
                        <div className="space-y-2">
                          {locations.filter(loc => loc.address.trim()).length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">No locations added yet</p>
                          ) : (
                            <>
                              <div 
                                className={`p-3 border rounded-lg cursor-pointer transition-colors ${currentInviteData.locationIds.length === 0 ? "ring-2 ring-primary" : "hover-elevate"}`}
                                onClick={() => setCurrentInviteData(prev => ({ ...prev, locationIds: [] }))}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${currentInviteData.locationIds.length === 0 ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                    {currentInviteData.locationIds.length === 0 && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                  </div>
                                  <span className="font-medium">All Locations</span>
                                </div>
                              </div>
                              {locations.filter(loc => loc.address.trim()).map((loc) => {
                                const locId = loc.name; // Use location name as ID since backend IDs don't exist during onboarding
                                const isSelected = currentInviteData.locationIds.includes(locId);
                                return (
                                  <div 
                                    key={loc.name}
                                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : "hover-elevate"}`}
                                    onClick={() => {
                                      if (isSelected) {
                                        setCurrentInviteData(prev => ({ ...prev, locationIds: prev.locationIds.filter(id => id !== locId) }));
                                      } else {
                                        setCurrentInviteData(prev => ({ ...prev, locationIds: [...prev.locationIds, locId] }));
                                      }
                                    }}
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
                      )}
                      <div className="flex gap-3 pt-2">
                        <Button variant="outline" onClick={() => setInviteWizardStep(2)} className="flex-1">Back</Button>
                        <Button onClick={() => setInviteWizardStep(4)} className="flex-1" data-testid="button-next-review">
                          Review <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Step 4: Review */}
                  {inviteWizardStep === 4 && (
                    <div className="space-y-4">
                      <Card className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback>{currentInviteData.firstName?.[0] || currentInviteData.email[0].toUpperCase()}{currentInviteData.lastName?.[0] || ""}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{currentInviteData.firstName ? `${currentInviteData.firstName} ${currentInviteData.lastName}`.trim() : "Team Member"}</p>
                            <p className="text-sm text-muted-foreground">{currentInviteData.email}</p>
                          </div>
                        </div>
                        {currentInviteData.jobPosition && (
                          <div className="text-sm text-muted-foreground">{currentInviteData.jobPosition}</div>
                        )}
                        {currentInviteData.phone && (
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <span>{currentInviteData.phone}</span>
                          </div>
                        )}
                        <Separator />
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Permissions</span>
                          <Badge variant="secondary">{currentInviteData.role.charAt(0).toUpperCase() + currentInviteData.role.slice(1)}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Locations</span>
                          <span>{currentInviteData.role === "admin" || currentInviteData.locationIds.length === 0 ? "All locations" : `${currentInviteData.locationIds.length} selected`}</span>
                        </div>
                      </Card>
                      <Card className="p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground">
                          An email invitation will be sent to {currentInviteData.email} after you complete onboarding.
                        </p>
                      </Card>
                      {/* Email validation error */}
                      {currentInviteData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentInviteData.email) && (
                        <div className="p-3 border border-destructive/30 bg-destructive/10 rounded-lg flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                          <p className="text-sm text-destructive">Please enter a valid email address</p>
                        </div>
                      )}
                      <div className="flex gap-3 pt-2">
                        <Button variant="outline" onClick={() => setInviteWizardStep(3)} className="flex-1">Back</Button>
                        <Button 
                          onClick={() => addTeamInvite()}
                          disabled={!currentInviteData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentInviteData.email)}
                          className="flex-1"
                          data-testid="button-add-invite"
                        >
                          <Send className="w-4 h-4 mr-2" /> Add to Invites
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          </Card>
        )}

        {/* Step 3: Payment - Substep 0: How billing works (prestep) | Substep 1: Add payment method */}
        {step === 3 && step3SubStep === 0 && (
          <div className="mb-6">
            <style>{`
              @keyframes billing-slide-in {
                from { opacity: 0; transform: translateY(12px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes billing-pulse-ring {
                0% { transform: scale(0.9); opacity: 0.8; }
                100% { transform: scale(1.4); opacity: 0; }
              }
              .billing-stage { animation: billing-slide-in 0.45s ease-out forwards; animation-fill-mode: both; }
              .billing-gps-ring { animation: billing-pulse-ring 2s ease-out infinite; }
            `}</style>
            <h1 className="text-xl md:text-2xl font-bold mb-1 text-gray-900">How You'll Be Charged</h1>
            <p className="text-sm text-gray-600 mb-4">
              Hourly billing, location-verified timesheets. Add a payment method on the next step — no charge until workers complete shifts.
            </p>
            <Card className="p-[20pt] overflow-hidden">
              <div className="space-y-3">
                {[
                  {
                    delay: 0,
                    icon: Navigation,
                    title: "Geo-fenced GPS at job site",
                    desc: "Workers clock in only when they arrive at your site. Only on-site hours count — no pay for travel or no-shows.",
                    badge: "Location-verified",
                  },
                  {
                    delay: 80,
                    icon: Clock,
                    title: "Billed by the hour",
                    desc: "You pay for actual hours worked. Clock in at the job, clock out when done. Invoices after each shift.",
                    badge: "No minimums",
                  },
                  {
                    delay: 160,
                    icon: CreditCard,
                    title: "Card 3.5% · ACH 0%",
                    desc: "Credit card has a 3.5% fee. Bank transfer (ACH) is free — we recommend it for lower cost.",
                    badge: "Stripe secure",
                  },
                  {
                    delay: 240,
                    icon: Shield,
                    title: "No charge today",
                    desc: "Payment method is saved securely. We charge only after workers complete their shifts.",
                    badge: "Pay later",
                  },
                ].map((stage, i) => {
                  const Icon = stage.icon;
                  const isGps = i === 0;
                  return (
                    <div
                      key={i}
                      className="billing-stage flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5"
                      style={{ animationDelay: `${stage.delay}ms` }}
                    >
                      <div className="relative mt-0.5 flex-shrink-0">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center">
                          <Icon className="w-4 h-4 text-white" strokeWidth={2.5} />
                        </div>
                        {isGps && (
                          <span className="absolute inset-0 rounded-lg bg-[#00A86B]/30 billing-gps-ring pointer-events-none" aria-hidden />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 text-sm">{stage.title}</h3>
                          <span className="text-[10px] font-medium text-[#00A86B] bg-green-100 px-1.5 py-0.5 rounded">{stage.badge}</span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{stage.desc}</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-[#00A86B] flex-shrink-0 mt-1" />
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t border-gray-200 flex flex-wrap gap-3 text-xs text-gray-600">
                <span className="flex items-center gap-1.5"><Navigation className="w-3.5 h-3.5 text-[#00A86B]" /> Location-verified</span>
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#00A86B]" /> Pay by the hour</span>
                <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-[#00A86B]" /> Stripe secure</span>
              </div>
            </Card>
          </div>
        )}

        {step === 3 && step3SubStep === 1 && (
          <div className="space-y-4">
            <Card className="p-[20pt]">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-4">
                  Add a card, Cash App Pay, or bank account (ACH). Securely powered by Stripe. No charge now.
                </p>
                {paymentMethodAdded ? (
                  <div className="space-y-4">
                    <div className="p-4 border border-green-500/30 bg-green-500/10 rounded-lg flex items-center gap-3">
                      <Check className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="font-medium text-green-700 dark:text-green-300">Payment method added</p>
                        <p className="text-sm text-green-600 dark:text-green-400">You can continue to the agreement.</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => setStepAndUrl(4)}
                      className="w-full h-11 bg-gray-900 text-white hover:bg-gray-800"
                      data-testid="button-continue-to-agreement"
                    >
                      Continue to agreement <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                ) : stripePromise && setupClientSecret ? (
                  <Elements stripe={stripePromise} options={{ clientSecret: setupClientSecret, appearance: { theme: "stripe" } }}>
                    <StripePaymentSetupForm
                      clientSecret={setupClientSecret}
                      onSuccess={() => {
                        setPaymentMethodAdded(true);
                        toast({ title: "Payment method added", description: "Your card or bank account has been saved." });
                        // Defer step/URL update so it isn't overwritten by URL-sync effect; ensures we land on step 4
                        setTimeout(() => setStepAndUrl(4), 0);
                      }}
                      onError={(err) => {
                        setPaymentSetupError(err);
                        toast({ title: "Could not save payment method", description: err, variant: "destructive" });
                      }}
                      onRetryNeeded={() => {
                        setPaymentSetupError(null);
                        setSetupClientSecret(null);
                        initPaymentForm();
                      }}
                    />
                  </Elements>
                ) : paymentSetupError ? (
                  <div className="space-y-3">
                    <div className="p-4 border border-destructive/30 bg-destructive/10 rounded-lg">
                      <p className="text-sm text-destructive">{paymentSetupError}</p>
                    </div>
                    <Button variant="outline" onClick={initPaymentForm}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading payment form...</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Old step 4 payment block removed - now using step 3 payment (SetupIntent) */}
        {false && (
          <div className="space-y-6">
            <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg">
              <h4>Placeholder - old payment removed</h4>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Payment Setup</CardTitle>
                <CardDescription>Old deposit flow - removed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Promo Code Section */}
                <div className="space-y-3">
                  <h4 className="font-semibold">Have a Promo Code?</h4>
                  <div className="flex gap-2">
                    <Input
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value);
                        setPromoApplied(false);
                      }}
                      placeholder="Enter promo code"
                      className="flex-1"
                      data-testid="input-promo-code"
                    />
                    <Button 
                      variant="outline"
                      onClick={() => {
                        if (promoCode.toLowerCase() === "demand") {
                          setPromoApplied(true);
                          toast({ title: "Promo code applied!", description: "No deposit required. Pay only for work performed." });
                        } else if (promoCode === "Test123456") {
                          setTestBypass(true);
                          setPromoApplied(true);
                          toast({ title: "Test Mode Activated!", description: "Bypassing payment - redirecting to dashboard..." });
                          setShowSuccess(true);
                          confetti({
                            particleCount: 100,
                            spread: 70,
                            origin: { y: 0.6 }
                          });
                          setTimeout(() => {
                            setLocation("/company-dashboard");
                          }, 2000);
                        } else if (promoCode.trim()) {
                          toast({ title: "Invalid promo code", description: "Please check the code and try again.", variant: "destructive" });
                        }
                      }}
                      data-testid="button-apply-promo"
                    >
                      Apply
                    </Button>
                  </div>
                  {promoApplied && !testBypass && (
                    <div className="p-3 border border-green-500/30 bg-green-500/10 rounded-lg flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <p className="text-sm text-green-700 dark:text-green-300">
                        Promo code "Demand" applied - No $2,000 deposit required!
                      </p>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Deposit Amount Display */}
                <div className={`p-4 rounded-lg ${promoApplied ? "bg-muted/50" : "bg-primary/10"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{promoApplied ? "Payment Method on File" : "Initial Deposit Required"}</span>
                      {!promoApplied && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Refundable within 30 days if no services used
                        </p>
                      )}
                    </div>
                    <span className={`font-bold ${promoApplied ? "text-lg text-muted-foreground" : "text-2xl"}`}>
                      {promoApplied ? "Required" : `$${(DEPOSIT_AMOUNT / 100).toLocaleString()}`}
                    </span>
                  </div>
                  {promoApplied && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Add a bank account on file to continue. You will only be charged when you hire workers.
                    </p>
                  )}
                </div>

                <Separator />

                {/* Payment Method Selection */}
                {!bankConnected && !cardPaymentSuccess && (
                  <div className="space-y-3">
                    <h4 className="font-semibold">Choose Payment Method</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("ach")}
                        className={`p-4 rounded-lg border-2 transition-all text-left ${
                          paymentMethod === "ach"
                            ? "border-primary bg-primary/5"
                            : "border-border hover-elevate"
                        }`}
                        data-testid="button-payment-ach"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <Landmark className={`w-5 h-5 ${paymentMethod === "ach" ? "text-primary" : "text-muted-foreground"}`} />
                          <span className="font-medium">ACH Bank Transfer</span>
                        </div>
                        <p className="text-xs text-muted-foreground">No fees - Direct bank transfer</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("card")}
                        className={`p-4 rounded-lg border-2 transition-all text-left ${
                          paymentMethod === "card"
                            ? "border-primary bg-primary/5"
                            : "border-border hover-elevate"
                        }`}
                        data-testid="button-payment-card"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <CreditCard className={`w-5 h-5 ${paymentMethod === "card" ? "text-primary" : "text-muted-foreground"}`} />
                          <span className="font-medium">Credit/Debit Card</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {stripeConfig?.cardFeePercentage || 3.5}% convenience fee
                        </p>
                      </button>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Bank Connected Success */}
                {bankConnected && (
                  <div className="p-4 border border-green-500/30 bg-green-500/10 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center">
                        <Check className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-green-700 dark:text-green-300">Bank Account Connected</p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {bankAccount.bankName || "Bank"} ••••{bankAccount.accountNumber.slice(-4)} ({bankAccount.accountType})
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card Payment Success */}
                {cardPaymentSuccess && (
                  <div className="p-4 border border-green-500/30 bg-green-500/10 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center">
                        <Check className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-green-700 dark:text-green-300">Card Payment Successful</p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          Your deposit has been processed
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ACH Bank Account Form */}
                {paymentMethod === "ach" && !bankConnected && !cardPaymentSuccess && (
                  <>
                    <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                      <Shield className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm mb-1">Secure & Encrypted</p>
                        <p className="text-xs text-muted-foreground">
                          Your banking information is encrypted and securely transmitted via Modern Treasury ACH.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="bankName" className="text-sm font-medium">Bank Name <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                        <Input
                          id="bankName"
                          value={bankAccount.bankName}
                          onChange={(e) => setBankAccount({ ...bankAccount, bankName: e.target.value })}
                          placeholder="e.g., Chase, Bank of America"
                          className="mt-1.5"
                          data-testid="input-bank-name"
                        />
                      </div>

                      <div>
                        <Label htmlFor="routingNumber" className="text-sm font-medium">Routing Number</Label>
                        <Input
                          id="routingNumber"
                          value={bankAccount.routingNumber}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "").slice(0, 9);
                            setBankAccount({ ...bankAccount, routingNumber: val });
                          }}
                          placeholder="9 digits"
                          maxLength={9}
                          className={`mt-1.5 ${bankErrors.routingNumber ? "border-destructive" : ""}`}
                          data-testid="input-routing-number"
                        />
                        {bankErrors.routingNumber && (
                          <p className="text-xs text-destructive mt-1">{bankErrors.routingNumber}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">Found at the bottom left of your check</p>
                      </div>

                      <div>
                        <Label htmlFor="accountNumber" className="text-sm font-medium">Account Number</Label>
                        <Input
                          id="accountNumber"
                          type="password"
                          value={bankAccount.accountNumber}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "");
                            setBankAccount({ ...bankAccount, accountNumber: val });
                          }}
                          placeholder="Enter account number"
                          className={`mt-1.5 ${bankErrors.accountNumber ? "border-destructive" : ""}`}
                          data-testid="input-account-number"
                        />
                        {bankErrors.accountNumber && (
                          <p className="text-xs text-destructive mt-1">{bankErrors.accountNumber}</p>
                        )}
                      </div>

                      <div>
                        <Label htmlFor="confirmAccountNumber" className="text-sm font-medium">Confirm Account Number</Label>
                        <Input
                          id="confirmAccountNumber"
                          type="password"
                          value={bankAccount.confirmAccountNumber}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "");
                            setBankAccount({ ...bankAccount, confirmAccountNumber: val });
                          }}
                          placeholder="Re-enter account number"
                          className={`mt-1.5 ${bankErrors.confirmAccountNumber ? "border-destructive" : ""}`}
                          data-testid="input-confirm-account-number"
                        />
                        {bankErrors.confirmAccountNumber && (
                          <p className="text-xs text-destructive mt-1">{bankErrors.confirmAccountNumber}</p>
                        )}
                      </div>

                      <div>
                        <Label className="text-sm font-medium mb-3 block">Account Type</Label>
                        <RadioGroup
                          value={bankAccount.accountType}
                          onValueChange={(val) => setBankAccount({ ...bankAccount, accountType: val as "checking" | "savings" })}
                          className="flex gap-4"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="checking" id="checking" data-testid="radio-checking" />
                            <Label htmlFor="checking" className="cursor-pointer">Checking</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="savings" id="savings" data-testid="radio-savings" />
                            <Label htmlFor="savings" className="cursor-pointer">Savings</Label>
                          </div>
                        </RadioGroup>
                      </div>
                    </div>

                    <Button
                      onClick={handleConnectBank}
                      className="w-full h-12"
                      data-testid="button-connect-bank"
                    >
                      <Landmark className="w-4 h-4 mr-2" />
                      Verify Bank Account
                    </Button>
                  </>
                )}

                {/* Card Payment Form with Stripe */}
                {paymentMethod === "card" && !bankConnected && !cardPaymentSuccess && stripePromise && (
                  <Elements stripe={stripePromise}>
                    <CardPaymentForm
                      amount={promoApplied ? 0 : DEPOSIT_AMOUNT}
                      cardFeePercentage={stripeConfig?.cardFeePercentage || 3.5}
                      onSuccess={() => {
                        setCardPaymentSuccess(true);
                        toast({ title: "Payment successful!", description: "Your deposit has been processed." });
                      }}
                      onError={(error) => {
                        setCardPaymentError(error);
                        toast({ title: "Payment failed", description: error, variant: "destructive" });
                      }}
                      isProcessing={cardPaymentProcessing}
                      setIsProcessing={setCardPaymentProcessing}
                      promoApplied={promoApplied}
                    />
                  </Elements>
                )}

                {paymentMethod === "card" && !stripeConfig?.configured && (
                  <div className="p-4 border border-yellow-500/30 bg-yellow-500/10 rounded-lg">
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Card payments are currently unavailable. Please use ACH bank transfer.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {!bankConnected && !cardPaymentSuccess && (
              <p className="text-sm text-muted-foreground text-center">
                <AlertCircle className="w-4 h-4 inline mr-1" />
                {paymentMethod === "ach" 
                  ? "You must connect a bank account to continue"
                  : "Complete the card payment to continue"}
              </p>
            )}
          </div>
        )}

        {/* Step 4: Hiring Agreement – 1:1 worker agreement style: scroll-to-bottom, draw-to-sign, compact signature, full-height right col */}
        {step === 4 && (
          <div className="flex-1 flex flex-col min-h-0 gap-4">
            {!hasScrolledContract && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 shrink-0">
                <ChevronDown className="w-5 h-5 text-amber-700 shrink-0" />
                <p className="text-sm text-amber-800 font-medium">
                  Please scroll to the bottom of the document to enable signing.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
                  onClick={scrollToBottomOfContract}
                  data-testid="button-scroll-to-bottom"
                >
                  <ChevronDown className="w-4 h-4 mr-1" />
                  Scroll to bottom
                </Button>
              </div>
            )}
            <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-200">
              <div className="h-1.5 bg-gray-800" />
              <div className="relative flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/80 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-stone-600 hover:text-stone-900 hover:bg-stone-100"
                    onClick={scrollToBottomOfContract}
                    data-testid="button-scroll-to-bottom"
                  >
                    <ChevronDown className="w-4 h-4 mr-1" />
                    Scroll to bottom
                  </Button>
                </div>
                <div
                  ref={contractScrollRef}
                  onScroll={handleContractScroll}
                  className="relative p-6 md:p-10 overflow-y-auto flex-1 min-h-0"
                >
                  <div className="max-w-none text-stone-900" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                    <pre className="whitespace-pre-wrap text-xs md:text-sm leading-relaxed" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#1c1917" }}>
                      {COMPANY_AGREEMENT_TEXT}
                    </pre>
                  </div>
                  {!hasScrolledContract && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" aria-hidden />
                  )}
                </div>
                <div className="border-t-2 border-stone-200 bg-stone-50/80 p-2 md:p-3 shrink-0">
                  {!hasScrolledContract && (
                    <p className="text-xs text-stone-600 mb-2 italic">Please scroll through the entire document to enable signing, or use the &quot;Scroll to bottom&quot; button above.</p>
                  )}
                  <div
                    className={`p-2.5 text-center relative transition-all bg-white rounded-lg group ${(signatureText || signatureData) ? "border-2 border-stone-900" : isEditingSignature ? "border-2 border-[#00A86B]" : "border-2 border-dashed border-stone-300"}`}
                    onMouseEnter={() => setSignatureHovered(true)}
                    onMouseLeave={() => setSignatureHovered(false)}
                    onClick={() => !signatureText && !signatureData && !isEditingSignature && hasScrolledContract && handleAutoSign()}
                  >
                    {signatureData ? (
                      <div className="space-y-0.5">
                        <img src={signatureData} alt="Your signature" className="max-h-10 w-auto mx-auto object-contain" />
                        <div className="border-t border-stone-400 pt-0.5 mt-1 mx-auto max-w-[160px]">
                          <p className="text-[10px] text-stone-600">
                            Date: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                          </p>
                        </div>
                        {signatureHovered && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSignatureData(null); }}
                            className="absolute top-1 right-1 text-xs text-stone-500 hover:text-red-600 transition-colors"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    ) : signatureText ? (
                      <div className="space-y-0.5">
                        <p className="text-lg italic text-stone-900" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                          {signatureText}
                        </p>
                        <div className="border-t border-stone-400 pt-0.5 mt-1 mx-auto max-w-[160px]">
                          <p className="text-[10px] text-stone-600">
                            Date: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                          </p>
                        </div>
                        {signatureHovered && (
                          <div className="absolute top-1 right-1 flex gap-1">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setPendingSignatureName(signatureText); setIsEditingSignature(true); setSignatureText(null); }} className="text-xs text-stone-500 hover:text-[#00A86B]">Edit</button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); setSignatureText(null); }} className="text-xs text-stone-500 hover:text-red-600">Clear</button>
                          </div>
                        )}
                      </div>
                    ) : isEditingSignature ? (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[10px] text-stone-600">Confirm or edit your signature name:</p>
                        <Input
                          value={pendingSignatureName}
                          onChange={(e) => setPendingSignatureName(e.target.value)}
                          className="text-center text-base italic max-w-xs mx-auto h-8 text-sm"
                          style={{ fontFamily: "'Brush Script MT', cursive" }}
                          placeholder="Enter your name"
                          autoFocus
                          data-testid="input-signature-name"
                        />
                        <div className="border-t border-stone-300 mx-auto max-w-[160px]" />
                        <div className="flex gap-2 justify-center">
                          <Button variant="outline" size="sm" className="rounded-lg border-stone-300 h-7 text-xs" onClick={() => { setIsEditingSignature(false); setPendingSignatureName(""); }}>Cancel</Button>
                          <Button onClick={confirmSignature} disabled={!pendingSignatureName.trim()} className="gap-1 rounded-lg bg-gray-900 hover:bg-gray-800 text-white h-7 text-xs" data-testid="button-confirm-signature">
                            <Check className="w-3 h-3" /> Confirm
                          </Button>
                        </div>
                      </div>
                    ) : hasScrolledContract ? (
                      <div
                        ref={signaturePadContainerRef}
                        className="relative"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                      >
                        <p className="text-[10px] text-stone-600 mb-1">Draw your signature below</p>
                        <canvas
                          ref={signatureCanvasRef}
                          className="block w-full border border-stone-300 rounded bg-white touch-none cursor-crosshair"
                          style={{ height: 100 }}
                          data-testid="signature-canvas"
                        />
                        {showSignatureDoneButton && signatureHovered && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); clearSignaturePad(); }}
                            className="absolute top-0 right-0 text-xs text-stone-500 hover:text-red-600 transition-colors"
                          >
                            Clear
                          </button>
                        )}
                        {showSignatureDoneButton && (
                          <div className="mt-2 flex flex-col gap-2 w-full">
                            <button type="button" className="w-full text-sm font-medium py-2.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800" onClick={(e) => { e.stopPropagation(); captureSignature(); }} data-testid="button-done-signature">Done</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="text-stone-500 text-sm mb-1">Scroll to bottom first to enable signing</p>
                        <div className="border-t border-stone-300 mx-auto max-w-[180px]" />
                        <p className="text-xs text-stone-400 mt-1">Signature Line</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800" />
            </div>

            {(signatureText || signatureData) && (
              <div className="flex justify-center pt-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-stone-300 text-stone-700 hover:bg-stone-50"
                  onClick={() => {
                    const sigLabel = signatureData ? "[Drawn signature]" : signatureText;
                    const agreementContent = [
                      COMPANY_AGREEMENT_TEXT,
                      "",
                      "---",
                      "SIGNATURE",
                      "",
                      sigLabel,
                      `Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
                      "",
                      `Client: ${businessInfo.companyName}`,
                      `Signatory: ${businessInfo.firstName} ${businessInfo.lastName}`,
                      `Email: ${businessInfo.companyEmail}`,
                    ].join("\n");
                    const blob = new Blob([agreementContent], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Tolstoy_Agreement_${businessInfo.companyName?.replace(/\s+/g, "_") || "Company"}_${new Date().toISOString().split("T")[0]}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast({ title: "Agreement Exported", description: "Your signed agreement has been downloaded." });
                  }}
                  data-testid="button-export-agreement"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Signed Agreement
                </Button>
              </div>
            )}
          </div>
        )}
        
        {/* Success Screen */}
        {showSuccess && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <Card className="max-w-md mx-4 p-[20pt]">
              <CardContent className="pt-8 text-center">
                <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                  <Check className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
                <p className="text-muted-foreground mb-6">
                  Your account is ready! You can now post jobs from your dashboard and 
                  start hiring qualified workers in your area.
                </p>
                <p className="text-sm text-muted-foreground">
                  Redirecting to your dashboard...
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Add Location Popup */}
        {showLocationPopup && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <Card className="max-w-lg mx-4 w-full p-[20pt]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Add New Location
                </CardTitle>
                <CardDescription>
                  Enter the job site address
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="popup-location-name">Location Name</Label>
                  <Input
                    id="popup-location-name"
                    value={newLocation.name}
                    onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                    placeholder="e.g., Downtown Project Site"
                    data-testid="input-popup-location-name"
                  />
                </div>
                <GooglePlacesAutocomplete
                  id="popup-address"
                  label="Street Address"
                  value={newLocation.address}
                  onChange={(address, components) => {
                    setNewLocation({
                      ...newLocation,
                      address: address,
                      city: components.city || newLocation.city,
                      state: components.state || newLocation.state,
                      zipCode: components.zipCode || newLocation.zipCode,
                    });
                  }}
                  placeholder="Start typing an address..."
                  required
                  data-testid="input-popup-address"
                />
                <div>
                  <Label htmlFor="popup-address2">Address Line 2 (Unit, Suite, etc.)</Label>
                  <Input
                    id="popup-address2"
                    value={newLocation.address2 || ""}
                    onChange={(e) => setNewLocation({ ...newLocation, address2: e.target.value })}
                    placeholder="Apt, Unit, Suite, etc. (optional)"
                    data-testid="input-popup-address2"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="popup-city">City</Label>
                    <Input
                      id="popup-city"
                      value={newLocation.city}
                      onChange={(e) => setNewLocation({ ...newLocation, city: e.target.value })}
                      placeholder="City"
                      data-testid="input-popup-city"
                    />
                  </div>
                  <div>
                    <Label htmlFor="popup-state">State</Label>
                    <Input
                      id="popup-state"
                      value={newLocation.state}
                      onChange={(e) => setNewLocation({ ...newLocation, state: e.target.value })}
                      placeholder="State"
                      data-testid="input-popup-state"
                    />
                  </div>
                  <div>
                    <Label htmlFor="popup-zip">ZIP</Label>
                    <Input
                      id="popup-zip"
                      value={newLocation.zipCode}
                      onChange={(e) => setNewLocation({ ...newLocation, zipCode: e.target.value })}
                      placeholder="ZIP"
                      data-testid="input-popup-zip"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setShowLocationPopup(false);
                      setNewLocation({
                        name: "",
                        address: "",
                        address2: "",
                        city: "",
                        state: "",
                        zipCode: "",
                        isStarred: false,
                        isPrimary: false,
                      });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => {
                      if (newLocation.address.trim() && newLocation.city.trim() && newLocation.state.trim() && newLocation.zipCode.trim()) {
                        const newLocationWithName = {
                          ...newLocation,
                          name: newLocation.name || `Location ${locations.length + 1}`,
                        };
                        setLocations([...locations, newLocationWithName]);
                        setShowLocationPopup(false);
                        setNewLocation({
                          name: "",
                          address: "",
                          address2: "",
                          city: "",
                          state: "",
                          zipCode: "",
                          isStarred: false,
                          isPrimary: false,
                        });
                        toast({ title: "Location added", description: "The location has been saved and selected for this job." });
                      } else {
                        toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
                      }
                    }}
                    disabled={!newLocation.address.trim() || !newLocation.city.trim() || !newLocation.state.trim() || !newLocation.zipCode.trim()}
                    className="flex-1"
                    data-testid="button-save-location"
                  >
                    Save & Apply
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        </div>
          </div>

          {/* Navigation Footer - hidden on agreement stage (step 4) */}
          {step !== 4 && (
          <footer className="border-t border-gray-200 bg-white shrink-0 sticky bottom-0 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
            <div className={`max-w-3xl mx-auto px-4 md:px-8 py-4 ${step === 0 ? "md:py-4" : ""} flex ${step === 0 && isMobile ? "flex-col gap-4 py-6" : step === 0 ? "flex-row items-center gap-3" : "block"}`}>
          {step === 0 && (
            <>
              {isMobile ? (
                <>
                  <Button
                    onClick={() => {
                      const onboardingData = JSON.stringify({ ...businessInfo, authProvider: "google", stepAtAuth: 0 });
                      const returnTo = "/company-onboarding";
                      window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}&onboardingData=${encodeURIComponent(onboardingData)}`;
                    }}
                    variant="outline"
                    className="w-full h-12 rounded-xl border-gray-300 text-gray-700 hover:bg-gray-50 text-base font-medium"
                    data-testid="button-google-signup"
                  >
                    <SiGoogle className="w-4 h-4 mr-2" />
                    Continue with Google
                  </Button>
                  <Button
                    onClick={() => { setIsEmailSignupMode(true); setStepAndUrl(1); }}
                    className="w-full h-12 rounded-xl bg-gray-900 text-white hover:bg-gray-800 font-semibold text-base"
                    data-testid="button-begin-signup"
                  >
                    Continue with Email
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full h-12 rounded-xl text-muted-foreground border-0 shadow-none text-base"
                    onClick={() => setLocation("/")}
                    aria-label="Close"
                    type="button"
                  >
                    Exit
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    className="h-10 text-muted-foreground border-0 shadow-none"
                    onClick={() => setLocation("/")}
                    aria-label="Close"
                    type="button"
                  >
                    Exit
                  </Button>
                  <div className="flex gap-3 flex-1 justify-end">
                    <Button
                      onClick={() => {
                        const onboardingData = JSON.stringify({ ...businessInfo, authProvider: "google", stepAtAuth: 0 });
                        const returnTo = "/company-onboarding";
                        window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}&onboardingData=${encodeURIComponent(onboardingData)}`;
                      }}
                      variant="outline"
                      className="h-10 border-gray-300 text-gray-700 hover:bg-gray-50"
                      data-testid="button-google-signup"
                    >
                      <SiGoogle className="w-4 h-4 mr-2" />
                      Continue with Google
                    </Button>
                    <Button
                      onClick={() => { setIsEmailSignupMode(true); setStepAndUrl(1); }}
                      className="h-10 bg-gray-900 text-white hover:bg-gray-800"
                      data-testid="button-begin-signup"
                    >
                      Continue with Email
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
          {step === 1 && (
            <div className="flex items-center justify-between gap-4 w-full">
              <Button variant="ghost" onClick={handleBack} className="h-10 text-muted-foreground border-0 shadow-none shrink-0">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button 
                onClick={handleNext} 
                disabled={selectedIndustries.length === 0}
                className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800 rounded-xl" 
                data-testid="button-continue-step1-footer"
              >
                Continue <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          )}
          {step === 2 && (
            <div className="flex items-center justify-between gap-4 w-full">
              <Button variant="ghost" onClick={handleBack} disabled={isRegistering} className="h-10 text-muted-foreground border-0 shadow-none shrink-0">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button 
                onClick={handleNext} 
                className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800 rounded-xl" 
                disabled={
                  isRegistering ||
                  (step2SubStep === 0 && (
                    !businessInfo.firstName?.trim() ||
                    !businessInfo.lastName?.trim() ||
                    !businessInfo.companyName?.trim() ||
                    !businessInfo.companyEmail?.trim() ||
                    !businessInfo.phone?.trim() ||
                    (isEmailSignupMode && (!password || !confirmPassword))
                  )) ||
                  (step2SubStep === 1 && !locations.some(loc => loc.address.trim()))
                }
                data-testid="button-continue-step2-footer"
              >
                {isRegistering ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating Account...</>
                ) : step2SubStep === 0 ? (
                  <>Continue to Locations <ArrowRight className="w-4 h-4 ml-2" /></>
                ) : step2SubStep === 1 ? (
                  <>Continue to Team <ArrowRight className="w-4 h-4 ml-2" /></>
                ) : (
                  <>Continue to Payment <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className="flex items-center justify-between gap-4 w-full">
              <Button variant="ghost" onClick={handleBack} className="h-10 text-muted-foreground border-0 shadow-none shrink-0">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button 
                onClick={handleNext} 
                disabled={step3SubStep === 1 && !paymentMethodAdded}
                className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800 rounded-xl" 
                data-testid="button-continue-step3-footer"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
          {step === 4 && (
            <div className="flex items-center justify-between gap-4 w-full">
              <Button variant="ghost" onClick={handleBack} className="h-10 text-muted-foreground border-0 shadow-none shrink-0">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              {!signatureText && !signatureData && !isEditingSignature && (
                <Button 
                  onClick={handleAutoSign}
                  disabled={!hasScrolledContract}
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800 rounded-xl"
                  data-testid="button-sign-agreement-footer"
                >
                  {hasScrolledContract ? (
                    <>Sign as {businessInfo.firstName} {businessInfo.lastName}</>
                  ) : (
                    <>Scroll agreement to enable signing</>
                  )}
                </Button>
              )}
              {(signatureText || signatureData) && (
                <Button disabled className="h-11 min-w-64 px-8 rounded-xl bg-gray-300 text-gray-500 cursor-default">
                  <Check className="w-4 h-4 mr-2" /> Signed
                </Button>
              )}
            </div>
          )}
            </div>
          </footer>
          )}
        </main>
      </div>

      {/* Payment & Timekeeping Info Dialog */}
      <Dialog open={showPaymentInfoDialog} onOpenChange={setShowPaymentInfoDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5" />
              How Payment & Timekeeping Works
            </DialogTitle>
            <DialogDescription>
              Understanding Tolstoy's payment system, GPS timekeeping, and timesheet approvals
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-5">
            {/* ACH Only */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0">
                <Landmark className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">ACH Bank Transfers Only</h4>
                <p className="text-sm text-muted-foreground">
                  All payments are processed via ACH (Automated Clearing House) bank transfers through Modern Treasury. 
                  This ensures secure, low-cost transactions with your linked bank account.
                </p>
              </div>
            </div>

            {/* Auto-Withdrawal to Maintain Balance */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Auto-Withdrawal to Maintain $2,000 Balance</h4>
                <p className="text-sm text-muted-foreground">
                  To ensure you always have funds available to pay workers, we automatically withdraw from your bank 
                  account to maintain a $2,000 account balance. This ensures seamless worker payments without 
                  interruption to your ongoing jobs.
                </p>
              </div>
            </div>

            {/* GPS Timekeeping */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">State-of-the-Art GPS Timekeeping</h4>
                <p className="text-sm text-muted-foreground">
                  Our platform features automatic on-site timekeeping using GPS verification. When workers arrive at 
                  the job site, their time is automatically clocked in. When they leave the geofenced area, 
                  their time is automatically clocked out. No manual check-ins required.
                </p>
              </div>
            </div>

            {/* Timesheet Approval Flow */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Timesheet Approval Flow</h4>
                <p className="text-sm text-muted-foreground">
                  After each shift, timesheets are submitted for your review. You can approve timesheets, 
                  request adjustments, or flag entries that don't match your records. Payment is only processed 
                  after your approval.
                </p>
              </div>
            </div>

            {/* Flagging & Performance */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Flagging Invalid Timesheets & Poor Performance</h4>
                <p className="text-sm text-muted-foreground">
                  You can flag timesheets that appear inaccurate or don't match work performed. You can also 
                  report poor worker performance, no-shows, or quality issues. Flagged items are reviewed by 
                  our team and affect worker ratings on the platform.
                </p>
              </div>
            </div>

            {/* Refunds */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Full Refund Policy</h4>
                <p className="text-sm text-muted-foreground">
                  All funds in your account are fully refundable at any time, minus any current job commitments 
                  (funds held in escrow for active or scheduled jobs). Request a refund from your dashboard and 
                  receive your balance within 5-7 business days.
                </p>
              </div>
            </div>

            {/* Summary Box */}
            <div className="p-4 bg-muted/50 rounded-lg border">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Key Points
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• ACH bank transfers only - secure and low-cost</li>
                <li>• Auto-withdrawal maintains $2,000 balance for worker payments</li>
                <li>• GPS-based automatic clock-in/out at job sites</li>
                <li>• Review and approve all timesheets before payment</li>
                <li>• Flag invalid timesheets or report performance issues</li>
                <li>• All funds refundable minus current job commitments</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowPaymentInfoDialog(false)} data-testid="button-close-payment-info">
              Got It
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
