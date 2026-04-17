import React, { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useCreateProfile, useProfile, useUpdateProfile, invalidateSessionProfileQueries, profileMeQueryKey } from "@/hooks/use-profiles";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { getUrlForPath } from "@/lib/subdomain-utils";
import { getIdentityVerificationUrl } from "@/lib/identity-verification-urls";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { Progress } from "@/components/ui/progress";
import { useIsMobile } from "@/hooks/use-mobile";
import { Slider } from "@/components/ui/slider";
import { RateSlider } from "@/components/RateSlider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { showClientDevTools } from "@/lib/is-local-dev-host";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import confetti from "canvas-confetti";
import * as faceapi from "@vladmandic/face-api";

// Load face-api models only once per app session (avoids repeated load when component remounts).
let faceApiLoadPromise: Promise<void> | null = null;

import { 
  Loader2, ChevronRight, ChevronLeft, ChevronDown, MapPin, Upload, Camera, 
  CreditCard, Check, CheckCircle2, Zap, Droplets, Wind, Hammer, 
  PaintBucket, Building2, Shovel, HardHat, Clock, TrendingUp, DollarSign,
  Share2, Copy, Gift, Briefcase, Star, Shield, Images, X, FileText, Pen, Globe,
  Rocket, PartyPopper, AlertCircle, Eye, EyeOff, Info,   User, IdCard, ExternalLink, UserPlus
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { useFileUpload, formatBytes } from "@/components/ui/file-upload";
import { useUpload } from "@/hooks/use-upload";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { PayoutAccount } from "@shared/schema";

const TOTAL_STEPS = 7; // Step 1: Account, Step 2: Location, Step 3: Skills & Services, Step 4: Business Operator & Teammates (skippable), Step 5: Payout, Step 6: Documents, Step 7: Contract
const PENDING_W9_STORAGE_KEY = "workerOnboardingPendingW9Document";

// Bio validation - prevent email, phone numbers, and URLs
function validateBio(bio: string): { isValid: boolean; error?: string } {
  if (!bio || bio.trim().length === 0) {
    return { isValid: true }; // Empty bio is allowed (optional field)
  }
  
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const urlRegex = /(https?:\/\/|www\.)[^\s]+/i;
  
  // Check for phone numbers with spaces between digits (3+ consecutive digits regardless of spaces)
  // Remove all spaces and check for 3+ consecutive digits
  const bioWithoutSpaces = bio.replace(/\s+/g, '');
  const consecutiveDigitsRegex = /\d{3,}/;
  if (consecutiveDigitsRegex.test(bioWithoutSpaces)) {
    // Additional check: if it's a valid phone number pattern (even with spaces)
    const spacedPhonePattern = /(\d\s?){3,}/;
    if (spacedPhonePattern.test(bio)) {
      return { isValid: false, error: "Bio cannot contain phone numbers" };
    }
  }
  
  if (emailRegex.test(bio)) {
    return { isValid: false, error: "Bio cannot contain email addresses" };
  }
  if (phoneRegex.test(bio)) {
    return { isValid: false, error: "Bio cannot contain phone numbers" };
  }
  if (urlRegex.test(bio)) {
    return { isValid: false, error: "Bio cannot contain URLs" };
  }
  
  return { isValid: true };
}

/** Parse a US-style full address string into city, state, zipCode when user types/pastes instead of selecting from Places. */
function parseUSAddressLine(address: string): { city: string; state: string; zipCode: string } | null {
  const trimmed = address?.trim();
  if (!trimmed || trimmed.length < 10) return null;
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Last part might be "USA" or country; then expect "ST 12345" or "ST 12345-6789"
  let stateZipPart = parts[parts.length - 1];
  if (stateZipPart === "USA" || stateZipPart === "US" || /^[A-Za-z]{2,}$/.test(stateZipPart) && !/\d/.test(stateZipPart)) {
    parts.pop();
    if (parts.length < 2) return null;
    stateZipPart = parts[parts.length - 1];
  }
  const stateZipMatch = stateZipPart?.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!stateZipMatch) return null;
  const state = stateZipMatch[1].toUpperCase();
  const zipCode = stateZipMatch[2];
  const city = parts.length >= 2 ? parts[parts.length - 2] : "";
  if (!city) return null;
  return { city, state, zipCode };
}

// Step schemas
const step2Schema = z.object({
  businessName: z.string().optional(),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(10, "Valid phone number required"),
  bio: z.string().max(220, "Bio must be under 220 characters").refine(validateBio, "Bio cannot contain emails, phone numbers, or URLs").optional().or(z.literal("")),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zipCode: z.string().min(5, "Valid zip code required"),
  yearsOfExperience: z.number().min(1).optional().or(z.literal(undefined)),
});

const step3Schema = z.object({
  serviceCategories: z.array(z.string()).min(1, "Select at least one service category"),
});

// Time to first job: 1-2 days ends at $20 (suggested rate); higher rates = longer wait. Range $0–$200.
function getJobFindingTime(rate: number): { time: string; days: string; percentile: number } {
  const minRate = 0;
  const maxRate = 200;
  const clampedRate = Math.max(minRate, Math.min(maxRate, rate));
  const percentile = maxRate > minRate
    ? Math.max(0, Math.min(100, ((clampedRate - minRate) / (maxRate - minRate)) * 100))
    : 0;

  if (clampedRate <= 0) {
    return { time: "—", days: "—", percentile: 0 };
  }
  if (clampedRate <= 20) {
    return { time: "1-2 days", days: "1-2 days", percentile };
  } else if (clampedRate <= 28) {
    return { time: "3-5 days", days: "3-5 days", percentile };
  } else if (clampedRate <= 36) {
    return { time: "1-2 weeks", days: "7-14 days", percentile };
  } else if (clampedRate <= 48) {
    return { time: "2-3 weeks", days: "14-21 days", percentile };
  } else {
    return { time: "3-4 weeks", days: "21-28 days", percentile };
  }
}

// Contract text (exported for agreement popup in Account & Documents)
export const CONTRACT_TEXT = `INDEPENDENT CONTRACTOR AGREEMENT

This Independent Contractor Agreement ("Agreement") is entered into as of the date of electronic signature below, by and between the entity doing business as ("DBA") Tolstoy Staffing, registered in the State of Ohio ("Company"), and the undersigned individual ("Contractor"), collectively referred to herein as the "Parties."

WHEREAS, the Company is a non-profit organization prioritizing charitable labor staffing for organizations and operates a digital marketplace platform connecting skilled labor contractors with businesses and organizations seeking temporary or project-based staffing services; and

WHEREAS, the Contractor desires to be listed on said platform and to accept work assignments through the Company's marketplace;

NOW, THEREFORE, in consideration of the mutual covenants and agreements hereinafter set forth and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Parties agree as follows:

ARTICLE 1. INDEPENDENT CONTRACTOR STATUS

1.1 Relationship of Parties. The Contractor expressly acknowledges and agrees that they are an independent contractor and not an employee, agent, joint venturer, or partner of the Company. Nothing contained in this Agreement shall be construed to create an employment relationship, partnership, or joint venture between the Parties.

1.2 Tax Obligations. The Contractor shall be solely responsible for all federal, state, and local taxes arising from compensation received under this Agreement, including but not limited to income taxes, self-employment taxes, Social Security contributions, Medicare contributions, and any other applicable taxes. The Company shall issue Form 1099-NEC to the Contractor as required by law. The Contractor agrees to provide a valid, completed IRS Form W-9 (or equivalent) upon request and to keep such information current. Failure to provide or maintain a valid W-9 may result in backup withholding and/or suspension of payments as permitted by law.

1.3 No Benefits. The Contractor acknowledges that they are not entitled to any employee benefits, including but not limited to health insurance, retirement plans, paid leave, workers' compensation, or unemployment insurance from the Company.

1.4 Business Expenses. The Contractor shall be solely responsible for all business expenses incurred in the performance of services, unless otherwise explicitly agreed upon in writing for a specific job assignment.

ARTICLE 2. SERVICES AND SCOPE OF WORK

2.1 Platform Services. The Contractor agrees to provide skilled labor services to clients matched through the Tolstoy Staffing platform. The specific nature, scope, and duration of services shall be determined by individual job postings accepted by the Contractor at their sole discretion.

2.2 Right to Decline. The Contractor retains the absolute right to accept or decline any work assignment offered through the platform without penalty or adverse consequence to their standing on the platform.

2.3 Subcontracting. The Contractor may not subcontract or delegate any work assignment to a third party without prior written consent from both the Company and the client.

ARTICLE 3. TOOLS, EQUIPMENT, AND MATERIALS

3.1 Contractor-Supplied Tools. Unless otherwise explicitly specified in a job posting, the Contractor shall provide all tools, equipment, supplies, and materials necessary to perform the services at their own expense. This includes but is not limited to:
    (a) Hand tools and power tools appropriate for their trade
    (b) Personal protective equipment (PPE)
    (c) Specialty equipment required for their specific trade
    (d) Transportation to and from job sites
    (e) Communication devices (mobile phone, etc.)

3.2 Client-Supplied Materials. When specified in a job posting, the client may provide certain materials or specialized equipment. The Contractor agrees to use such materials responsibly and return any unused materials to the client upon completion of the work.

3.3 Care of Equipment. The Contractor shall maintain all tools and equipment in safe, working condition and shall be solely responsible for any loss, theft, or damage to their own tools and equipment.

ARTICLE 4. COMPENSATION AND PAYMENT

4.1 Rate Setting. The Contractor shall set their own hourly rate within the parameters established by the platform. The Company does not dictate or control the Contractor's rate, which remains at the Contractor's sole discretion.

4.2 Platform Fee. The Contractor acknowledges that the Company charges a platform service fee to clients, which is separate from the Contractor's hourly rate. The Contractor's rate is paid in full without deduction.

4.3 Payment Processing. All payments for services rendered shall be processed exclusively through the Tolstoy Staffing platform via ACH bank transfer. The Contractor shall maintain a valid bank account on file for payment processing.

4.4 Payment Timing. Payments shall be processed within three (3) to five (5) business days following client approval of submitted timesheets, subject to Section 4.6. The Company shall not be liable for delays caused by banking institutions, federal holidays, or technical issues beyond its reasonable control.

4.5 Disputes. Any disputes regarding hours worked or payment amounts must be raised within ten (10) calendar days of the payment date. The Company will facilitate resolution but is not responsible for payment disputes between the Contractor and client.

4.6 Withholding and Holdback Rights. The Company reserves the right, in its sole discretion, to withhold, hold back, or delay any and all payments to the Contractor until: (a) the Contractor has submitted a valid, completed IRS Form W-9 (or equivalent) and the Company has verified its acceptability for tax reporting; (b) any dispute, chargeback, or claim relating to the Contractor's services has been resolved; (c) the Contractor is in full compliance with this Agreement and all platform policies; or (d) required by applicable law or regulation. No interest or penalty shall accrue to the Contractor on amounts withheld pursuant to this Section. The Contractor acknowledges that failure to provide a valid W-9 may result in indefinite suspension of payouts and/or backup withholding at the rate required by the IRS. The Company may also withhold or set off amounts for chargebacks, refunds, fraud, breach of this Agreement, or other security or compliance reasons as determined by the Company.

ARTICLE 5. QUALITY OF WORK AND PROFESSIONAL STANDARDS

5.1 Workmanship. The Contractor agrees to perform all services in a professional, diligent, and workmanlike manner consistent with industry standards for their trade.

5.2 Compliance. The Contractor shall comply with all applicable federal, state, and local laws, regulations, ordinances, and codes, including but not limited to building codes, OSHA regulations, and licensing requirements.

5.3 Licenses and Certifications. The Contractor represents and warrants that they hold all licenses, certifications, and permits required by law to perform the services in their designated trade areas. The Contractor shall maintain such credentials in good standing throughout the term of this Agreement.

5.4 Communication. The Contractor shall maintain professional communication with clients and respond promptly to work-related inquiries through the platform's messaging system.

ARTICLE 6. INSURANCE AND LIABILITY

6.1 Contractor Insurance. The Contractor is strongly encouraged to maintain, at their own expense, appropriate insurance coverage including:
    (a) General liability insurance
    (b) Professional liability insurance (if applicable)
    (c) Personal injury coverage
    (d) Workers' compensation or occupational accident insurance

6.2 Indemnification. The Contractor agrees to indemnify, defend, and hold harmless the Company, its officers, directors, employees, and agents from and against any and all claims, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to: (a) the Contractor's performance of services; (b) any breach of this Agreement by the Contractor; (c) any negligent or wrongful act or omission of the Contractor; or (d) any claim that the Contractor is an employee of the Company.

6.3 Limitation of Liability. THE COMPANY'S TOTAL LIABILITY TO THE CONTRACTOR FOR ANY AND ALL CLAIMS ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNT PAID TO THE CONTRACTOR THROUGH THE PLATFORM IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.

6.4 No Warranty. THE COMPANY PROVIDES THE PLATFORM "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

ARTICLE 7. CONDUCT AND DISCIPLINE

7.1 Code of Conduct. The Contractor agrees to conduct themselves professionally at all times while representing themselves through the platform, including treating clients, their employees, and their property with respect.

7.2 Three-Strike Policy. The Contractor acknowledges that accumulation of three (3) verified complaints from clients may result in suspension or permanent termination of platform access. The Company reserves sole discretion to investigate complaints and determine appropriate action.

7.3 Immediate Termination. The Company reserves the right to immediately terminate this Agreement and platform access for serious violations including but not limited to: theft, fraud, violence, harassment, discrimination, substance abuse on the job, or material misrepresentation of qualifications.

ARTICLE 8. CONFIDENTIALITY AND DATA PROTECTION

8.1 Client Confidentiality. The Contractor shall maintain strict confidentiality of all client information, including but not limited to: home addresses, business locations, phone numbers, email addresses, financial information, security codes, and any proprietary business information observed during service provision.

8.2 Non-Solicitation. The Contractor shall not solicit clients obtained through the platform for work outside the platform for a period of twelve (12) months following the last job completed for that client through the platform.

8.3 Data Handling. The Contractor shall handle any personal data accessed during the course of work in accordance with applicable privacy laws and shall not retain, copy, or distribute such data except as necessary for the immediate work assignment.

ARTICLE 9. SAFETY REQUIREMENTS

9.1 Safety Compliance. The Contractor agrees to:
    (a) Follow all safety protocols and procedures at job sites
    (b) Use appropriate personal protective equipment at all times
    (c) Report any unsafe conditions immediately to the client and the Company
    (d) Comply with all OSHA regulations and local safety ordinances
    (e) Refuse to perform work that poses an imminent danger to health or safety

9.2 Incident Reporting. The Contractor shall promptly report any accidents, injuries, or property damage occurring during the performance of services to both the client and the Company through the platform's incident reporting system.

ARTICLE 10. TERM AND TERMINATION

10.1 Term. This Agreement shall commence upon electronic execution and shall continue until terminated by either Party.

10.2 Termination at Will. Either Party may terminate this Agreement at any time, with or without cause, by providing notice through the platform.

10.3 Effect of Termination. Upon termination, the Contractor shall: (a) complete any work assignments in progress unless otherwise directed; (b) return any client-provided materials; and (c) submit final timesheets for payment.

10.4 Survival. The provisions of Articles 6, 8, and 12 shall survive termination of this Agreement.

ARTICLE 11. MODIFICATIONS AND AMENDMENTS

11.1 Platform Updates. The Company may modify the terms of this Agreement at any time by posting updated terms on the platform and providing notice to the Contractor.

11.2 Acceptance. Continued use of the platform following notice of modifications constitutes acceptance of the modified terms. If the Contractor does not agree to the modified terms, they must cease using the platform and terminate this Agreement.

ARTICLE 12. DISPUTE RESOLUTION

12.1 Informal Resolution. The Parties agree to attempt to resolve any dispute arising out of this Agreement through good faith negotiation.

12.2 Binding Arbitration. Any dispute that cannot be resolved through negotiation shall be settled by binding arbitration in accordance with the Commercial Arbitration Rules of the American Arbitration Association. The arbitration shall be conducted in English, and judgment on the award may be entered in any court having jurisdiction thereof.

12.3 Class Action Waiver. THE CONTRACTOR AGREES TO RESOLVE DISPUTES WITH THE COMPANY ON AN INDIVIDUAL BASIS AND WAIVES ANY RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE ARBITRATION.

12.4 Governing Law. This Agreement shall be governed by and construed in accordance with the laws of the State of Ohio, without regard to its conflict of laws principles.

ARTICLE 13. GENERAL PROVISIONS

13.1 Entire Agreement. This Agreement constitutes the entire agreement between the Parties and supersedes all prior negotiations, representations, or agreements relating to its subject matter.

13.2 Severability. If any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.

13.3 Waiver. The failure of either Party to enforce any provision of this Agreement shall not constitute a waiver of that Party's right to enforce that provision or any other provision.

13.4 Assignment. The Contractor may not assign this Agreement or any rights hereunder without the prior written consent of the Company.

13.5 Electronic Signatures. The Parties agree that electronic signatures shall have the same legal effect as original signatures.

13.6 Company Rights Cumulative. All rights of the Company to withhold payments, hold back funds, set off amounts, suspend or terminate access, and take any action necessary for tax compliance, security, fraud prevention, or enforcement of this Agreement are in addition to and not in lieu of any rights at law or in equity. No exercise or failure to exercise any such right shall constitute a waiver thereof.

IN WITNESS WHEREOF, the Contractor has executed this Agreement as of the date indicated below.

BY SIGNING BELOW, THE CONTRACTOR ACKNOWLEDGES THAT THEY HAVE READ THIS AGREEMENT IN ITS ENTIRETY, UNDERSTAND ALL OF ITS TERMS AND CONDITIONS, AND VOLUNTARILY AGREE TO BE BOUND BY ITS PROVISIONS.
`;

export default function WorkerOnboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);
  const unauthStepRedirectedRef = useRef(false);
  const [formData, setFormData] = useState<any>({
    businessName: "",
    serviceCategories: [],
    hourlyRate: 18,
    portfolioImages: [],
    password: "",
    confirmPassword: "",
    yearsOfExperience: 1,
  });
  const [step3SubStep, setStep3SubStep] = useState<"rate" | "categories" | "portfolio">("rate");
  const [inviteSending, setInviteSending] = useState(false);
  /** Step 4: null = show qualifying question; "doing_work" = skip to next; "managing_team" = show add-teammate flow */
  const [step4RoleChoice, setStep4RoleChoice] = useState<null | "doing_work" | "managing_team">(null);
  /** Worker add-teammate wizard: 0 = list, 1 = details (1-for-1 like company add teammate) */
  const [workerInviteStep, setWorkerInviteStep] = useState(0);
  const [workerInviteData, setWorkerInviteData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
    avatarUrl: "",
  });
  const [portfolioTags, setPortfolioTags] = useState<string[]>([]);
  // Prior work photos: id, url (objectPath), name, size, optional tag
  const [portfolioItems, setPortfolioItems] = useState<Array<{ id: string; url: string; name: string; size: number; tag?: string }>>([]);
  /** Draft text for tag input; committed to item.tag only on Enter/Return */
  const [portfolioTagDrafts, setPortfolioTagDrafts] = useState<Record<string, string>>({});
  const [isPortfolioUploading, setIsPortfolioUploading] = useState(false);
  const [portfolioUploadProgress, setPortfolioUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncingGoogleReviews, setSyncingGoogleReviews] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [isVerifyingFace, setIsVerifyingFace] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signatureHovered, setSignatureHovered] = useState(false);
  const contractScrollRef = useRef<HTMLDivElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadContainerRef = useRef<HTMLDivElement>(null);
  const acknowledgedSignatureRef = useRef<string | null>(null);
  const portfolioInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const teammateAvatarInputRef = useRef<HTMLInputElement>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  
  // Bank account state
  const [bankAccount, setBankAccount] = useState({
    routingNumber: "",
    accountNumber: "",
    confirmAccountNumber: "",
    accountType: "checking" as "checking" | "savings",
    bankName: "",
    recipientType: "business" as "person" | "business", // Always business; UI hidden
  });
  const [bankErrors, setBankErrors] = useState<Record<string, string>>({});
  const [bankConnected, setBankConnected] = useState(false);
  const [bankLastFour, setBankLastFour] = useState<string | null>(null);
  
  // Insurance state
  const [insuranceData, setInsuranceData] = useState<{
    documentUrl: string | null;
    policyNumber: string;
    issuer: string;
    startDate: string;
    endDate: string;
    coverageType: string;
    coverageAmount: number;
  }>({
    documentUrl: null,
    policyNumber: "",
    issuer: "",
    startDate: "",
    endDate: "",
    coverageType: "",
    coverageAmount: 0,
  });
  const [isExtractingInsurance, setIsExtractingInsurance] = useState(false);
  const [insuranceSkipped, setInsuranceSkipped] = useState(false);
  const insuranceInputRef = useRef<HTMLInputElement>(null);
  const restoredFromSessionRef = useRef(false);
  const [payoutInfoOpen, setPayoutInfoOpen] = useState(false);
  const [instantPayoutPreferred, setInstantPayoutPreferred] = useState(false);
  const [showIdVerificationMiniStep, setShowIdVerificationMiniStep] = useState(false);
  const [pendingProfileAfterStep1, setPendingProfileAfterStep1] = useState(false);
  const identityReturnPendingSuccess = useRef(false);

  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { mutate: createProfile, isPending: isCreating } = useCreateProfile();
  const { mutate: updateProfile, isPending: isUpdating } = useUpdateProfile();
  const { data: existingProfile, isLoading: profileLoading } = useProfile(user?.id);
  const [location, setLocation] = useLocation();
  const continueWithGoogle = useCallback((stepAtAuth: number) => {
    const onboardingData = JSON.stringify({
      ...formData,
      authProvider: "google",
      stepAtAuth,
    });
    const returnTo = stepAtAuth === 0 ? "/worker-onboarding" : `/worker-onboarding?step=${stepAtAuth}`;
    window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}&onboardingData=${encodeURIComponent(onboardingData)}`;
  }, [formData]);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  // No toasts on mobile for worker onboarding (avoids overlay clutter). useCallback keeps ref stable so effects depending on safeToast don't re-run every render (avoids "Maximum update depth exceeded" with Radix Toast).
  const safeToast = useCallback(
    (params: Parameters<typeof toast>[0]) => {
      if (isMobile) return;
      toast(params);
    },
    [isMobile, toast]
  );

  // Check if user is a team member (employee) - they should not see/edit hourly rate
  const isTeamMember = existingProfile?.teamId !== null && existingProfile?.teamId !== undefined;

  const handleInstantPayoutToggle = (enabled: boolean) => {
    if (!existingProfile?.id) return;
    updateProfile({ id: existingProfile.id, data: { instantPayoutEnabled: enabled }, skipToast: true });
  };

  const instantPayoutChecked = existingProfile?.id != null
    ? (existingProfile.instantPayoutEnabled ?? false)
    : instantPayoutPreferred;

  // Full address (street, city, state, zip) required for payout-account API — from Location step; select from dropdown to fill city/state/zip
  const hasFullAddress = !!(formData.address && formData.city && formData.state && formData.zipCode);

  // W-9 status from Mercury (only show "W-9 on File" when Mercury has the attachment)
  const { data: w9Status, isLoading: w9StatusLoading, isError: w9StatusError, refetch: refetchW9Status } = useQuery({
    queryKey: ["/api/worker/w9-status"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/worker/w9-status", { credentials: "include", signal });
      if (res.status === 404) return { attached: false, recipientId: null };
      if (!res.ok) throw new Error("Failed to fetch W-9 status");
      return res.json() as Promise<{ attached: boolean; recipientId: string | null }>;
    },
    enabled: !!user && currentStep === 6 && existingProfile?.role === "worker",
    retry: 1,
    retryDelay: 2500,
  });

  // Worker team + members (for step 4 managing_team add-teammate flow, 1-for-1 like company)
  const { data: workerTeam } = useQuery<{ id: number } | null>({
    queryKey: ["/api/worker-team"],
    enabled: step4RoleChoice === "managing_team",
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/worker-team");
      if (!res.ok) return null;
      return res.json();
    },
  });
  const { data: workerTeamMembers = [] } = useQuery<Array<{ id: number; firstName?: string | null; lastName?: string | null; email?: string | null; status?: string }>>({
    queryKey: ["/api/worker-team", workerTeam?.id, "members"],
    enabled: !!workerTeam?.id,
    queryFn: async () => {
      if (!workerTeam?.id) return [];
      const res = await apiRequest("GET", `/api/worker-team/${workerTeam.id}/members`);
      return res.json();
    },
  });

  // Payout accounts (for verified bank card when bank already connected)
  const { data: payoutAccounts = [] } = useQuery<PayoutAccount[]>({
    queryKey: ["/api/mt/worker/payout-accounts"],
    enabled: !!existingProfile && currentStep === 4,
  });
  const defaultPayoutAccount = payoutAccounts.find((a) => a.isDefault) || payoutAccounts[0];
  const payoutProvOnboarding = defaultPayoutAccount?.provider as string | undefined;
  const hasBankVerified =
    bankConnected ||
    !!(existingProfile as { bankAccountLinked?: boolean } | null)?.bankAccountLinked ||
    (!!defaultPayoutAccount && (payoutProvOnboarding === "mercury" || payoutProvOnboarding === "modern_treasury"));

  // Sync bankConnected when profile or payout accounts indicate bank is verified
  useEffect(() => {
    if (hasBankVerified && !bankConnected) {
      setBankConnected(true);
      if (defaultPayoutAccount?.accountLastFour) {
        setBankLastFour(defaultPayoutAccount.accountLastFour);
      }
    }
  }, [hasBankVerified, bankConnected, defaultPayoutAccount?.accountLastFour]);

  // Bank account setup mutation - connects to Mercury
  const connectBankMutation = useMutation({
    mutationFn: async (data: { routingNumber: string; accountNumber: string; accountType: string; bankName: string; recipientType?: string; email?: string; address?: string; city?: string; state?: string; zipCode?: string }) => {
      const response = await apiRequest("POST", "/api/mt/worker/payout-account", data);
      return response.json();
    },
  });

  const { uploadFile: uploadFileToS3 } = useUpload({ onboardingUpload: true });
  const [portfolioFileState, portfolioFileActions] = useFileUpload({
    maxFiles: 12,
    maxSize: 10 * 1024 * 1024,
    accept: "image/*",
    multiple: true,
    onFilesAdded: async (added) => {
      if (added.length === 0) return;
      setIsPortfolioUploading(true);
      setPortfolioUploadProgress({ current: 0, total: added.length });
      try {
        for (let i = 0; i < added.length; i++) {
          setPortfolioUploadProgress((p) => p ? { ...p, current: i + 1 } : null);
          const f = added[i];
          const res = await uploadFileToS3(f.file as File, "reviews");
          if (!res) continue;
          const newItem = {
            id: f.id,
            url: res.objectPath,
            name: (f.file as File).name,
            size: (f.file as File).size,
            tag: "",
          };
          setPortfolioItems((prev: Array<{ id: string; url: string; name: string; size: number; tag?: string }>) => (prev.length >= 12 ? prev : [...prev, newItem].slice(0, 12)));
          setFormData((prev: any) => ({
            ...prev,
            portfolioImages: [...(prev.portfolioImages || []), res.objectPath].slice(0, 12),
          }));
          portfolioFileActions.removeFile(f.id);
        }
      } finally {
        setIsPortfolioUploading(false);
        setPortfolioUploadProgress(null);
      }
    },
  });

  const handleSyncGoogleReviews = async () => {
    setSyncingGoogleReviews(true);
    try {
      const response = await fetch("/api/reviews/sync-google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to sync Google reviews");
      }
      safeToast({
        title: "Reviews synced",
        description: data.syncedCount != null
          ? `Imported ${data.syncedCount} Google review${data.syncedCount === 1 ? "" : "s"}. Your profile now shows ${data.totalReviews ?? 0} total reviews.`
          : "Your Google reviews have been synced.",
      });
      if (existingProfile?.id) {
        invalidateSessionProfileQueries(queryClient);
      }
    } catch (err: unknown) {
      safeToast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Could not sync Google reviews.",
        variant: "destructive",
      });
    } finally {
      setSyncingGoogleReviews(false);
    }
  };

  const isGoogleReviewsConnected = !!(existingProfile as any)?.googleBusinessLocationId;

  // After OAuth return: sync reviews and clean URL
  useEffect(() => {
    if (currentStep !== 3 || step3SubStep !== "portfolio") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") !== "true") return;
    params.delete("google_connected");
    const newSearch = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    (async () => {
      setSyncingGoogleReviews(true);
      try {
        const response = await fetch("/api/reviews/sync-google", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: "{}" });
        const data = await response.json();
        if (response.ok) {
          safeToast({ title: "Reviews synced", description: data.syncedCount != null ? `Imported ${data.syncedCount} Google review(s).` : "Your Google reviews have been synced." });
        }
      } finally {
        setSyncingGoogleReviews(false);
        if (existingProfile?.id) invalidateSessionProfileQueries(queryClient);
      }
    })();
  }, [currentStep, step3SubStep]);

  // Handle redirect when connect-google was hit without a profile (complete profile first)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connect") !== "no_profile") return;
    params.delete("google_connect");
    window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params.toString()}` : ""));
    safeToast({ title: "Complete your profile first", description: "Save your profile, then connect Google to sync reviews.", variant: "destructive" });
  }, []);

  // Validate US routing number using mod 10 checksum (same as worker PayoutSettings page). Allow 123456789 as dev test route.
  const validateRoutingNumber = (routing: string): { isValid: boolean; error: string } => {
    const digits = routing.replace(/\D/g, "");
    if (digits.length !== 9) return { isValid: false, error: "Routing number must be exactly 9 digits" };
    if (digits === "123456789") return { isValid: true, error: "" }; // Dev test route (skips Mercury in non-production)
    const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * weights[i];
    if (sum % 10 !== 0) return { isValid: false, error: "Invalid routing number. Please check and try again." };
    return { isValid: true, error: "" };
  };

  // Validate bank account form (same validation as worker PayoutSettings)
  const validateBankAccount = (): boolean => {
    const newErrors: Record<string, string> = {};
    const routing = (bankAccount.routingNumber || "").replace(/\D/g, "");
    const account = (bankAccount.accountNumber || "").replace(/\D/g, "");

    if (routing.length !== 9) {
      newErrors.routingNumber = "Routing number must be exactly 9 digits";
    } else {
      const routingValidation = validateRoutingNumber(bankAccount.routingNumber);
      if (!routingValidation.isValid) newErrors.routingNumber = routingValidation.error;
    }

    if (account.length < 4 || account.length > 17) {
      newErrors.accountNumber = "Account number must be between 4 and 17 digits";
    }

    const confirmDigits = (bankAccount.confirmAccountNumber || "").replace(/\D/g, "");
    if (account !== confirmDigits) {
      newErrors.confirmAccountNumber = "Account numbers do not match";
    }

    setBankErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle bank account connection to Mercury
  const handleConnectBank = async () => {
    if (!validateBankAccount()) return;
    
    if (!user || !existingProfile) {
      safeToast({
        title: "Bank details saved",
        description: "We'll connect your bank account automatically after your profile is created.",
      });
      nextStep();
      return;
    }
    
    try {
      // Connect bank account to Mercury (send email + business + address so recipient has them)
      const result = await connectBankMutation.mutateAsync({
        routingNumber: bankAccount.routingNumber,
        accountNumber: bankAccount.accountNumber,
        accountType: bankAccount.accountType,
        bankName: bankAccount.bankName,
        recipientType: "business",
        email: formData.email || existingProfile?.email || (user as any)?.claims?.email || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        state: formData.state || undefined,
        zipCode: formData.zipCode || undefined,
      });
      
      const lastFour = bankAccount.accountNumber.slice(-4);
      setBankConnected(true);
      setBankLastFour(lastFour);
      safeToast({ title: "Bank account connected", description: `Account ending in ${lastFour} connected.` });
      nextStep(); // Go to next stage on success; only toast for success or fail on this step
    } catch (error: any) {
      safeToast({
        title: "Bank connection failed",
        description: error?.message || "Could not connect your bank account. Try again later.",
        variant: "destructive"
      });
    }
  };

  /** Continue from step 4 (list view): advance to next onboarding step */
  const handleSendTeammateInvites = async () => {
    nextStep();
  };

  /** Send one teammate invite from details form (1-for-1 like company add teammate) */
  const handleSendOneTeammateInvite = async () => {
    const email = workerInviteData.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      safeToast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setInviteSending(true);
    try {
      let team = workerTeam;
      if (!team?.id) {
        const createRes = await apiRequest("POST", "/api/worker-team", {});
        if (!createRes.ok) throw new Error("Failed to create team");
        team = await createRes.json();
      }
      const teamId = team?.id;
      if (!teamId) {
        safeToast({ title: "Could not load team", variant: "destructive" });
        setInviteSending(false);
        return;
      }
      const hasTeammateAddress = !!(
        workerInviteData.address?.trim() &&
        workerInviteData.city?.trim() &&
        workerInviteData.state?.trim() &&
        workerInviteData.zipCode?.trim()
      );
      if (!hasTeammateAddress) {
        safeToast({ title: "Enter the worker's address", description: "Address, city, state, and zip are required.", variant: "destructive" });
        setInviteSending(false);
        return;
      }
      const lat = typeof workerInviteData.latitude === "number" && Number.isFinite(workerInviteData.latitude) ? workerInviteData.latitude : undefined;
      const lng = typeof workerInviteData.longitude === "number" && Number.isFinite(workerInviteData.longitude) ? workerInviteData.longitude : undefined;
      const addRes = await apiRequest("POST", `/api/worker-team/${teamId}/members`, {
        firstName: workerInviteData.firstName?.trim() || "Teammate",
        lastName: workerInviteData.lastName?.trim() || "—",
        email,
        phone: workerInviteData.phone?.trim() || undefined,
        address: workerInviteData.address?.trim() || undefined,
        city: workerInviteData.city?.trim() || undefined,
        state: workerInviteData.state?.trim() || undefined,
        zipCode: workerInviteData.zipCode?.trim() || undefined,
        ...(lat != null && lng != null ? { latitude: String(lat), longitude: String(lng) } : {}),
        avatarUrl: workerInviteData.avatarUrl?.trim() || undefined,
        role: "employee",
        hourlyRate: 20,
      });
      if (!addRes.ok) {
        const err = await addRes.json().catch(() => ({}));
        throw new Error(err?.message || "Failed to send invite");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/worker-team"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/worker-team", teamId, "members"] });
      safeToast({ title: "Invitation sent", description: "They can join from the link in their email." });
      setWorkerInviteStep(0);
      setWorkerInviteData({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", zipCode: "", latitude: undefined, longitude: undefined, avatarUrl: "" });
    } catch (e: any) {
      safeToast({ title: "Could not send invite", description: e?.message || "Please try again later.", variant: "destructive" });
    } finally {
      setInviteSending(false);
    }
  };

  // Start Stripe Identity verification: open external verify page in a new tab (sandbox or live URL)
  const handleStartIdVerification = () => {
    const url = getIdentityVerificationUrl("onboarding");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Load face-api models once per app session (shared promise so remounts don't reload)
  useEffect(() => {
    if (faceApiLoadPromise == null) {
      faceApiLoadPromise = (async () => {
        const modelUrls = [
          "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model",
          "https://unpkg.com/@vladmandic/face-api@1.7.14/model",
          "/face-api-models"
        ];
        for (const url of modelUrls) {
          try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(url);
            console.log("Face detection models loaded from:", url);
            return;
          } catch {
            continue;
          }
        }
        console.warn("Face detection models could not be loaded - using fallback verification");
      })();
    }
    faceApiLoadPromise.then(
      () => setModelsLoaded(true),
      () => setModelsLoaded(true)
    );
  }, []);

  // Face detection function
  const detectFace = async (imageDataUrl: string): Promise<boolean> => {
    if (!modelsLoaded) {
      // If models aren't loaded, allow through but log warning
      console.warn("Face detection models not loaded");
      return true;
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions());
          resolve(detections.length > 0);
        } catch (error) {
          console.error("Face detection error:", error);
          resolve(true); // Allow through on error
        }
      };
      img.onerror = () => resolve(true);
      img.src = imageDataUrl;
    });
  };

  // Handle avatar upload with face verification
  const handleAvatarUpload = async (file: File) => {
    if (!file) return;

    setIsVerifyingFace(true);
    setFaceError(null);
    setFaceVerified(false);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const imageData = ev.target?.result as string;
      setAvatarPreview(imageData);
      
      const hasFace = await detectFace(imageData);
      
      if (hasFace) {
        setFaceVerified(true);
        setFormData({ ...formData, avatarUrl: imageData });
        setFaceError(null);
      } else {
        setFaceVerified(false);
        setFaceError("Please upload a clear photo of your face for verification.");
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };

  // Handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleAvatarUpload(file);
    }
  };

  // Optional teammate avatar (no face verification)
  const handleTeammateAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) setWorkerInviteData((p) => ({ ...p, avatarUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Handle camera capture
  const handleCameraCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      // Create a modal/dialog for camera preview
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;';
      
      const videoContainer = document.createElement('div');
      videoContainer.style.cssText = 'position: relative; max-width: 90vw; max-height: 80vh;';
      
      video.style.cssText = 'width: 100%; height: auto; border-radius: 12px;';
      videoContainer.appendChild(video);
      
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'display: flex; gap: 12px;';
      
      const captureButton = document.createElement('button');
      captureButton.textContent = 'Capture Photo';
      captureButton.style.cssText = 'padding: 12px 24px; background: #00A86B; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;';
      
      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancel';
      cancelButton.style.cssText = 'padding: 12px 24px; background: #6b7280; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;';
      
      buttonContainer.appendChild(captureButton);
      buttonContainer.appendChild(cancelButton);
      overlay.appendChild(videoContainer);
      overlay.appendChild(buttonContainer);
      document.body.appendChild(overlay);
      
      const cleanup = () => {
        stream.getTracks().forEach(track => track.stop());
        document.body.removeChild(overlay);
      };
      
      cancelButton.onclick = cleanup;
      
      captureButton.onclick = () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context?.drawImage(video, 0, 0);
        
        canvas.toBlob(async (blob) => {
          if (blob) {
            cleanup();
            const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
            await handleAvatarUpload(file);
          }
        }, 'image/jpeg', 0.9);
      };
      
    } catch (error) {
      console.error('Error accessing camera:', error);
      setFaceError("Unable to access camera. Please use the upload option instead.");
    }
  };

  // Pre-fill from auth and restore onboarding data from sessionStorage
  // Detect Google auth from URL params
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const googleAuth = searchParams.get("googleAuth");
    if (googleAuth === "true") {
      setIsGoogleAuth(true);
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    } else if (isAuthenticated && user) {
      // Check if user is Google-only (no passwordHash or authProvider is google)
      if (!user.passwordHash || user.authProvider === "google") {
        setIsGoogleAuth(true);
      }
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (user && isAuthenticated) {
      // Check if there's saved onboarding data from sessionStorage (after sign-in redirect)
      const savedData = sessionStorage.getItem("onboardingData");
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          // Restore all the saved state
          if (parsed.formData) {
            setFormData((prev: any) => ({ ...prev, ...parsed.formData }));
          }
          if (parsed.avatarPreview) {
            setAvatarPreview(parsed.avatarPreview);
            setFaceVerified(true);
          }
          if (parsed.bankAccount) {
            setBankAccount(parsed.bankAccount);
            setBankConnected(true);
            if (parsed.bankAccount.accountNumber) {
              setBankLastFour(parsed.bankAccount.accountNumber.slice(-4));
            }
          }
          if (parsed.insuranceData) {
            setInsuranceData(parsed.insuranceData);
          }
          if (parsed.signatureData) {
            setSignatureData(parsed.signatureData);
            setHasScrolledToBottom(true);
          }
          // Clear sessionStorage and go to completion step
          sessionStorage.removeItem("onboardingData");
          restoredFromSessionRef.current = true;
          // Profile will be created after stage 2
        } catch (e) {
          console.error("Error restoring onboarding data:", e);
        }
      } else {
        // Load saved progress from localStorage
        loadOnboardingProgress();
        
        // Normal auth flow - just pre-fill user data if not already loaded
        setFormData((prev: any) => ({
          ...prev,
          firstName: user.firstName || prev.firstName || "",
          lastName: user.lastName || prev.lastName || "",
          email: user.email || prev.email || "",
        }));
        // Don't auto-advance from step 0 - let user click "Let's get started"
      }
    } else if (!user && !isAuthenticated) {
      // If not authenticated, try to load saved progress anyway
      loadOnboardingProgress();
    }
  }, [user, isAuthenticated]);

  // Account must exist before progressing beyond Step 1.
  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      unauthStepRedirectedRef.current = false;
      return;
    }
    if (currentStep <= 1) return;
    setCurrentStep(1);
    setLocation("/worker-onboarding?step=1");
    if (!unauthStepRedirectedRef.current) {
      unauthStepRedirectedRef.current = true;
      safeToast({
        title: "Complete account setup first",
        description: "Create your account on Step 1 before continuing onboarding.",
        variant: "destructive",
      });
    }
  }, [authLoading, isAuthenticated, currentStep, setLocation, safeToast]);

  // If W-9 was uploaded before account/profile existed, attach it once profile is available.
  useEffect(() => {
    if (!user?.id || !existingProfile?.id) return;
    const pendingW9 = localStorage.getItem(PENDING_W9_STORAGE_KEY);
    if (!pendingW9) return;

    (async () => {
      try {
        await updateProfile({
          id: existingProfile.id,
          data: { w9DocumentUrl: pendingW9, w9UploadedAt: new Date() },
          skipToast: true,
        });
        localStorage.removeItem(PENDING_W9_STORAGE_KEY);
        invalidateSessionProfileQueries(queryClient);
        await queryClient.invalidateQueries({ queryKey: ["/api/worker/w9-status"] });
        safeToast({
          title: "W-9 attached",
          description: "Your previously uploaded W-9 has been attached to your profile.",
        });
      } catch (error) {
        console.error("Deferred W-9 attach failed:", error);
      }
    })();
  }, [user?.id, existingProfile?.id]);

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
          setFormData((prev: any) => ({
            ...prev,
            firstName: data.firstName ?? prev.firstName ?? "",
            lastName: data.lastName ?? prev.lastName ?? "",
            email: data.email ?? prev.email ?? "",
            phone: data.phone ?? prev.phone ?? "",
            businessName: data.companyName ?? prev.businessName ?? "",
          }));
      })
      .catch(() => {});
  }, []);

  // Pre-fill from existing profile when user is redirected here with incomplete onboarding (so they only complete missing items; every save persists to account)
  const profilePreFillDoneRef = useRef<number | null>(null);
  useEffect(() => {
    const p = existingProfile as Record<string, unknown> | null | undefined;
    if (!p?.id || profilePreFillDoneRef.current === p.id) return;
    profilePreFillDoneRef.current = p.id as number;
    const rate = p.hourlyRate ?? p.hourly_rate;
    const rateNum = typeof rate === "number" ? rate : undefined;
    const hourlyRateDollars = rateNum != null && rateNum > 100 ? rateNum / 100 : rateNum ?? 18;
    setFormData((prev: any) => ({
      ...prev,
      firstName: (p.firstName ?? p.first_name ?? prev.firstName ?? "") as string,
      lastName: (p.lastName ?? p.last_name ?? prev.lastName ?? "") as string,
      email: (p.email ?? prev.email ?? "") as string,
      phone: (p.phone ?? prev.phone ?? "") as string,
      address: (p.address ?? prev.address ?? "") as string,
      city: (p.city ?? prev.city ?? "") as string,
      state: (p.state ?? prev.state ?? "") as string,
      zipCode: (p.zipCode ?? p.zip_code ?? prev.zipCode ?? "") as string,
      latitude: (() => { const v = (p as Record<string, unknown>).latitude; if (typeof v === "number" && Number.isFinite(v)) return v; if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; } return undefined; })(),
      longitude: (() => { const v = (p as Record<string, unknown>).longitude; if (typeof v === "number" && Number.isFinite(v)) return v; if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; } return undefined; })(),
      avatarUrl: (p.avatarUrl ?? p.avatar_url ?? prev.avatarUrl ?? "") as string,
      serviceCategories: Array.isArray(p.serviceCategories) ? p.serviceCategories : (Array.isArray(p.service_categories) ? p.service_categories : prev.serviceCategories ?? []),
      hourlyRate: hourlyRateDollars,
      businessName: (p.businessName ?? p.companyName ?? prev.businessName ?? "") as string,
      bio: (p.bio ?? prev.bio ?? "") as string,
    }));
    if (p.avatarUrl ?? p.avatar_url) {
      setAvatarPreview((p.avatarUrl ?? p.avatar_url) as string);
      if (p.faceVerified === true || p.face_verified === true) setFaceVerified(true);
    }
    if ((p as { bankAccountLinked?: boolean }).bankAccountLinked === true || (p as { mercuryRecipientId?: string }).mercuryRecipientId) {
      setBankConnected(true);
    }
    if ((p as { contractSigned?: boolean }).contractSigned === true && !signatureData) {
      setHasScrolledToBottom(true);
    }
  }, [existingProfile]);

  // Sync URL ?step=N and ?sub= (step 3: rate|categories|portfolio) to state (direct link or browser back)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get("step");
    const subParam = params.get("sub");
    if (stepParam !== null) {
      const n = parseInt(stepParam, 10);
      if (!isNaN(n) && n >= 1 && n <= TOTAL_STEPS) {
        setCurrentStep(n);
        if (n === 3) {
          if (subParam === "categories" || subParam === "portfolio") setStep3SubStep(subParam);
          else setStep3SubStep("rate");
        }
      }
    }
  }, [location]);

  // Redirect if profile exists (but not if we just restored from sessionStorage or dev mode)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isDevMode = urlParams.get('dev') === 'true';
    const hasStepParam = urlParams.get("step") !== null;

    if (isDevMode || restoredFromSessionRef.current) {
      return;
    }
    if (existingProfile && existingProfile.onboardingStatus === "complete") {
      setLocation("/dashboard");
    } else if (!hasStepParam && existingProfile && existingProfile.onboardingStep) {
      // Only restore from profile/localStorage when URL has no ?step= (so direct links take precedence)
      const saved = localStorage.getItem("onboardingProgress");
      if (saved) {
        try {
          const progress = JSON.parse(saved);
          if (progress.currentStep !== undefined) {
            setCurrentStep(progress.currentStep);
            if (progress.step3SubStep) setStep3SubStep(progress.step3SubStep);
            return;
          }
        } catch (e) {
          // Fall through
        }
      }
      const step = Math.max(1, Math.min(TOTAL_STEPS, existingProfile.onboardingStep));
      setCurrentStep(step);
    }
  }, [existingProfile, setLocation, isTeamMember]);

  // Refetch profile when returning from Stripe Identity verification; show success toast if verified
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("identity") === "return") {
      identityReturnPendingSuccess.current = true;
      setShowIdVerificationMiniStep(false);
      invalidateSessionProfileQueries(queryClient);
      const clean = new URLSearchParams(window.location.search);
      clean.delete("identity");
      const newSearch = clean.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    }
  }, [user?.id]);

  // Show success toast when profile refetches after identity return and ID is verified. Defer toast so it doesn't run during React commit (avoids Radix Toast setRef update loop).
  useEffect(() => {
    const profile = existingProfile as { identityVerified?: boolean } | null | undefined;
    if (identityReturnPendingSuccess.current && profile?.identityVerified) {
      identityReturnPendingSuccess.current = false;
      const timer = setTimeout(() => {
        safeToast({
          title: "Identity verified",
          description: "Your ID has been verified successfully.",
          variant: "default",
        });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [existingProfile, safeToast]);

  // Auto-save progress when form data or bank account changes (debounced)
  useEffect(() => {
    if (currentStep > 0) {
      const timeoutId = setTimeout(() => {
        saveOnboardingProgress();
      }, 1000); // Debounce by 1 second
      
      return () => clearTimeout(timeoutId);
    }
  }, [formData, bankAccount, currentStep, step3SubStep, bankConnected, avatarPreview, faceVerified, signatureData, insuranceData]);

  // Confetti effect removed - no completion step needed

  // Handle Lite/Elite mutual exclusivity
  const handleCategoryToggle = (categoryId: string, checked: boolean) => {
    let newCategories = [...(formData.serviceCategories || [])];
    
    if (checked) {
      const baseName = categoryId.replace(" Lite", "").replace(" Elite", "");
      const isLite = categoryId.includes("Lite");
      const isElite = categoryId.includes("Elite");
      
      if (isLite || isElite) {
        const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
        newCategories = newCategories.filter(c => c !== oppositeId);
      }
      newCategories.push(categoryId);
    } else {
      newCategories = newCategories.filter(c => c !== categoryId);
    }
    
    setFormData({ ...formData, serviceCategories: newCategories });
  };

  // Portfolio handling
  const handlePortfolioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const currentImages = formData.portfolioImages || [];
    const remainingSlots = 12 - currentImages.length;
    const filesToProcess = files.slice(0, remainingSlots);
    
    filesToProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFormData((prev: any) => ({
          ...prev,
          portfolioImages: [...(prev.portfolioImages || []), ev.target?.result as string].slice(0, 12)
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const removePortfolioImage = (index: number) => {
    setFormData((prev: any) => ({
      ...prev,
      portfolioImages: prev.portfolioImages.filter((_: any, i: number) => i !== index)
    }));
  };

  // Contract scroll detection
  const handleContractScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    if (isAtBottom) {
      setHasScrolledToBottom(true);
    }
  };

  // Scroll contract content to bottom (button) – animated at medium speed so user sees the scroll
  const scrollToBottomOfContract = () => {
    const el = contractScrollRef.current;
    if (!el) return;
    const start = el.scrollTop;
    const end = el.scrollHeight - el.clientHeight;
    if (end <= start) return;
    const durationMs = 600;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startTime) / durationMs, 1);
      const eased = 1 - (1 - t) * (1 - t);
      el.scrollTop = start + (end - start) * eased;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Draw signature pad: set up canvas and mouse/touch drawing when step 6 and pad is visible
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    const container = signaturePadContainerRef.current;
    if (!canvas || !container || currentStep !== 6 || signatureData) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth || 400;
    const height = 200;
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
    const end = () => { drawing = false; };

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
  }, [currentStep, signatureData, hasScrolledToBottom]);

  const clearSignaturePad = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const captureSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setSignatureData(dataUrl);
  };

  const actualSteps = TOTAL_STEPS;
  const progress = currentStep === 0 ? 0 : (currentStep / actualSteps) * 100;

  const validateStep = (step: number): boolean => {
    setErrors({});
    
    if (step === 1) {
      // Check face verification
      if (!faceVerified || !avatarPreview) {
        setFaceError("Please upload a clear photo of your face to continue.");
        return false;
      }
      
      // Password validation for email registration (not Google auth)
      if (!isAuthenticated && !isGoogleAuth) {
        const newErrors: Record<string, string> = {};
        
        if (!formData.password) {
          newErrors.password = "Password is required";
        } else if (formData.password.length < 8) {
          newErrors.password = "Password must be at least 8 characters";
        } else if (!/[A-Z]/.test(formData.password)) {
          newErrors.password = "Password must contain at least one uppercase letter";
        } else if (!/[a-z]/.test(formData.password)) {
          newErrors.password = "Password must contain at least one lowercase letter";
        } else if (!/[0-9]/.test(formData.password)) {
          newErrors.password = "Password must contain at least one number";
        }
        
        if (!formData.confirmPassword) {
          newErrors.confirmPassword = "Please confirm your password";
        } else if (formData.password !== formData.confirmPassword) {
          newErrors.confirmPassword = "Passwords do not match";
        }
        
        if (Object.keys(newErrors).length > 0) {
          setErrors(newErrors);
          return false;
        }
      }
    }
    
    if (step === 2) {
      const result = step2Schema.safeParse(formData);
      if (!result.success) {
        const newErrors: Record<string, string> = {};
        result.error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
        return false;
      }
      
      // Validate bio if provided
      if (formData.bio) {
        const bioValidation = validateBio(formData.bio);
        if (!bioValidation.isValid) {
          setErrors({ ...errors, bio: bioValidation.error || "Invalid bio content" });
          return false;
        }
      }
    }
    
    if (step === 3) {
      // Step 3a: Validate hourly rate
      if (step3SubStep === "rate") {
        if (formData.hourlyRate == null || formData.hourlyRate < 1 || formData.hourlyRate > 200) {
          safeToast({ title: "Please set a valid hourly rate between $1 and $200", variant: "destructive" });
          return false;
        }
      }
      // Step 3b: Validate service categories
      if (step3SubStep === "categories") {
        const result = step3Schema.safeParse(formData);
        if (!result.success) {
          safeToast({ title: "Please select at least one service category", variant: "destructive" });
          return false;
        }
      }
    }
    
    if (step === 4) {
      // Business Operator & Teammates: skippable, no validation
      return true;
    }
    if (step === 5) {
      if (!hasBankVerified && (!bankAccount.routingNumber || !bankAccount.accountNumber)) {
        safeToast({ title: "Please connect your bank account", variant: "destructive" });
        return false;
      }
    }
    if (step === 6 || step === 7) {
      // Documents and Contract: optional/skip or complete
    }
    
    return true;
  };

  const nextStep = () => {
    if (currentStep > 1 && !isAuthenticated) {
      setCurrentStep(1);
      setLocation("/worker-onboarding?step=1");
      safeToast({
        title: "Complete account setup first",
        description: "Create your account on Step 1 before continuing onboarding.",
        variant: "destructive",
      });
      return;
    }
    if (currentStep > 0 && !validateStep(currentStep)) {
      return;
    }

    // When leaving step 2 (Location), persist address to profile so payout-account API has it
    if (currentStep === 2 && existingProfile?.id && formData.address) {
      const next = 3;
      const lat = typeof formData.latitude === "number" && !Number.isNaN(formData.latitude) ? formData.latitude : undefined;
      const lng = typeof formData.longitude === "number" && !Number.isNaN(formData.longitude) ? formData.longitude : undefined;
      updateProfile({
        id: existingProfile.id,
        data: {
          address: formData.address,
          city: formData.city || undefined,
          state: formData.state || undefined,
          zipCode: formData.zipCode || undefined,
          ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
          onboardingStep: next,
        },
        skipToast: true,
      }, {
        onSuccess: () => {
          setCurrentStep(next);
          setStep3SubStep("rate");
          saveOnboardingProgress({ currentStep: next, step3SubStep: "rate" });
          setLocation("/worker-onboarding?step=" + next);
        },
        onError: () => safeToast({ title: "Error saving address", variant: "destructive" }),
      });
      return;
    }

    // Handle Step 3 sub-steps (rate -> categories -> portfolio)
    if (currentStep === 3 && step3SubStep === "rate") {
      setStep3SubStep("categories");
      setLocation("/worker-onboarding?step=3&sub=categories");
      return;
    }
    if (currentStep === 3 && step3SubStep === "categories") {
      setStep3SubStep("portfolio");
      saveOnboardingProgress({ currentStep: 3, step3SubStep: "portfolio" });
      setLocation("/worker-onboarding?step=3&sub=portfolio");
      return;
    }
    if (currentStep === 3 && step3SubStep === "portfolio") {
      setCurrentStep(4);
      setStep3SubStep("rate");
      saveOnboardingProgress({ currentStep: 4, step3SubStep: "rate" });
      setLocation("/worker-onboarding?step=4");
      if (user && existingProfile) {
        updateProfile({ id: existingProfile.id, data: { onboardingStep: 4 }, skipToast: true }, { onError: () => {} });
      }
      return;
    }

    if (currentStep === 4) {
      setCurrentStep(5);
      saveOnboardingProgress({ currentStep: 5 });
      setLocation("/worker-onboarding?step=5");
      if (user && existingProfile) {
        updateProfile({ id: existingProfile.id, data: { onboardingStep: 5 }, skipToast: true }, { onError: () => {} });
      }
      return;
    }

    if (currentStep < TOTAL_STEPS) {
      const next = currentStep + 1;
      const nextStep3SubStep = next !== 3 ? "rate" : step3SubStep;
      setCurrentStep(next);
      if (next !== 3) {
        setStep3SubStep("rate");
      }
      const url = next === 3 ? `/worker-onboarding?step=3&sub=${nextStep3SubStep}` : `/worker-onboarding?step=${next}`;
      setLocation(url);
      saveOnboardingProgress({ currentStep: next, step3SubStep: nextStep3SubStep });
      if (user && existingProfile) {
        updateProfile({
          id: existingProfile.id,
          data: { onboardingStep: next },
          skipToast: true,
        }, { onError: () => {} });
      }
    } else if (currentStep === TOTAL_STEPS) {
      // After final step, handle authentication and profile creation
      handleCompleteOnboarding();
    }
  };

  // Step 1 complete: create/update profile then show ID verification mini step (skippable) before Location
  const buildStep1ProfileData = (userId: string) => ({
    userId,
    role: "worker" as const,
    businessName: formData.businessName || null,
    firstName: formData.firstName,
    lastName: formData.lastName,
    email: formData.email,
    phone: formData.phone,
    avatarUrl: formData.avatarUrl || null,
    onboardingStep: 2,
    onboardingStatus: "incomplete" as const,
  });

  const handleStep1Next = async () => {
    if (!validateStep(1)) return;
    if (!user) {
      // Email flow: register first, then create profile in useEffect when user appears
      if (!isGoogleAuth && formData.email && formData.password) {
        setIsRegistering(true);
        try {
          const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              email: formData.email?.toLowerCase().trim(),
              password: formData.password,
              firstName: formData.firstName,
              lastName: formData.lastName,
            }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data?.message || "Registration failed");
          }
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          saveOnboardingProgress();
          setPendingProfileAfterStep1(true);
        } catch (error: any) {
          safeToast({ title: "Registration failed", description: error?.message, variant: "destructive" });
        } finally {
          setIsRegistering(false);
        }
        return;
      }
      safeToast({ title: "Sign in to continue", variant: "destructive" });
      return;
    }
    // User exists: if profile already saved with step 1 data (onboardingStep 2), just continue to ID verify mini step
    if (existingProfile?.id && existingProfile.onboardingStep === 2) {
      saveOnboardingProgress();
      setCurrentStep(2);
      setLocation("/worker-onboarding?step=2");
      setShowIdVerificationMiniStep(true);
      return;
    }
    // Create or update profile with step 1 data, then show ID verify mini step (no toast on success)
    const step1Data = buildStep1ProfileData(user.id);
    if (existingProfile?.id) {
      saveOnboardingProgress({ currentStep: 2 });
      setCurrentStep(2);
      setLocation("/worker-onboarding?step=2");
      setShowIdVerificationMiniStep(true);
      updateProfile(
        { id: existingProfile.id, data: step1Data, skipToast: true },
        {
          onSuccess: () => saveOnboardingProgress({ currentStep: 2 }),
          onError: () => safeToast({ title: "Error saving profile", variant: "destructive" }),
        }
      );
    } else {
      saveOnboardingProgress({ currentStep: 2 });
      setCurrentStep(2);
      setLocation("/worker-onboarding?step=2");
      setShowIdVerificationMiniStep(true);
      const ref = new URLSearchParams(window.location.search).get("ref");
      createProfile({ ...step1Data, ...(ref ? { ref } : {}), skipToast: true } as Parameters<typeof createProfile>[0], {
        onSuccess: () => saveOnboardingProgress({ currentStep: 2 }),
        onError: () => safeToast({ title: "Error creating profile", variant: "destructive" }),
      });
    }
  };

  // After email registration, create profile and advance to ID verify mini step
  useEffect(() => {
    if (!user?.id || !pendingProfileAfterStep1) return;
    setPendingProfileAfterStep1(false);
    saveOnboardingProgress({ currentStep: 2 });
    setCurrentStep(2);
    setLocation("/worker-onboarding?step=2");
    setShowIdVerificationMiniStep(true);
    const step1Data = buildStep1ProfileData(user.id);
    const ref = new URLSearchParams(window.location.search).get("ref");
    createProfile({ ...step1Data, ...(ref ? { ref } : {}), skipToast: true } as Parameters<typeof createProfile>[0], {
      onSuccess: () => {
        invalidateSessionProfileQueries(queryClient);
      },
      onError: () => safeToast({ title: "Error creating profile", variant: "destructive" }),
    });
  }, [user?.id, pendingProfileAfterStep1]);

  const prevStep = () => {
    // Handle Step 3 sub-steps (portfolio -> categories -> rate)
    if (currentStep === 3 && step3SubStep === "portfolio") {
      setStep3SubStep("categories");
      saveOnboardingProgress({ currentStep: 3, step3SubStep: "categories" });
      setLocation("/worker-onboarding?step=3&sub=categories");
      return;
    }
    if (currentStep === 3 && step3SubStep === "categories") {
      setStep3SubStep("rate");
      saveOnboardingProgress();
      setLocation("/worker-onboarding?step=3&sub=rate");
      return;
    }
    if (currentStep === 4) {
      setStep4RoleChoice(null);
      setWorkerInviteStep(0);
      setWorkerInviteData({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", zipCode: "", latitude: undefined, longitude: undefined, avatarUrl: "" });
      setCurrentStep(3);
      setStep3SubStep("portfolio");
      saveOnboardingProgress({ currentStep: 3, step3SubStep: "portfolio" });
      setLocation("/worker-onboarding?step=3&sub=portfolio");
      return;
    }
    if (currentStep === 2) {
      setShowIdVerificationMiniStep(false);
    }
    // Allow going back to prescreen (step 0) from step 1
    if (currentStep >= 1) {
      const prev = currentStep - 1;
      if (prev === 4) setStep4RoleChoice(null);
      setCurrentStep(prev);
      setLocation(prev === 0 ? "/worker-onboarding" : "/worker-onboarding?step=" + prev);
      if (prev !== 3) {
        setStep3SubStep("rate");
      }
      saveOnboardingProgress();
    }
  };

  // Save onboarding progress to localStorage. Pass overrides (e.g. { currentStep: 2 }) when advancing so refetch doesn't overwrite with stale step.
  const saveOnboardingProgress = (overrides?: Partial<{ currentStep: number; step3SubStep: string }>) => {
    try {
      const progress = {
        currentStep: overrides?.currentStep ?? currentStep,
        step3SubStep: overrides?.step3SubStep ?? step3SubStep,
        formData,
        bankAccount,
        bankConnected,
        avatarPreview,
        faceVerified,
        signatureData,
        hasScrolledToBottom,
        insuranceData,
        insuranceSkipped,
        instantPayoutPreferred,
        timestamp: Date.now(),
      };
      localStorage.setItem("onboardingProgress", JSON.stringify(progress));
    } catch (error) {
      console.error("Error saving onboarding progress:", error);
    }
  };

  // Load onboarding progress from localStorage
  const loadOnboardingProgress = () => {
    try {
      const saved = localStorage.getItem("onboardingProgress");
      if (saved) {
        const progress = JSON.parse(saved);
        
        // Only restore if it's recent (within 7 days)
        const daysSinceSaved = (Date.now() - (progress.timestamp || 0)) / (1000 * 60 * 60 * 24);
        if (daysSinceSaved > 7) {
          localStorage.removeItem("onboardingProgress");
          return;
        }
        
        if (progress.currentStep !== undefined) {
          setCurrentStep(progress.currentStep);
        }
        if (progress.step3SubStep) {
          setStep3SubStep(progress.step3SubStep);
        }
        if (progress.formData) {
          setFormData((prev: any) => ({ ...prev, ...progress.formData }));
          const images = progress.formData?.portfolioImages;
          if (Array.isArray(images) && images.length > 0) {
            setPortfolioItems(images.map((url: string, i: number) => ({
              id: `saved-${i}-${url}`,
              url,
              name: url.split("/").pop() || `Photo ${i + 1}`,
              size: 0,
              tag: "",
            })));
          }
        }
        if (progress.bankAccount) {
          setBankAccount({ ...progress.bankAccount, recipientType: "business" });
        }
        if (progress.bankConnected !== undefined) {
          setBankConnected(progress.bankConnected);
        }
        if (progress.avatarPreview) {
          setAvatarPreview(progress.avatarPreview);
        }
        if (progress.faceVerified !== undefined) {
          setFaceVerified(progress.faceVerified);
        }
        if (progress.signatureData) {
          setSignatureData(progress.signatureData);
        }
        if (progress.hasScrolledToBottom !== undefined) {
          setHasScrolledToBottom(progress.hasScrolledToBottom);
        }
        if (progress.insuranceData) {
          setInsuranceData(progress.insuranceData);
        }
        if (progress.insuranceSkipped !== undefined) {
          setInsuranceSkipped(progress.insuranceSkipped);
        }
        if (progress.instantPayoutPreferred !== undefined) {
          setInstantPayoutPreferred(progress.instantPayoutPreferred);
        }
      }
    } catch (error) {
      console.error("Error loading onboarding progress:", error);
    }
  };

  // Clear onboarding progress (called when onboarding is complete)
  const clearOnboardingProgress = () => {
    localStorage.removeItem("onboardingProgress");
  };

  // Share functionality
  const affiliateLink = `${window.location.origin}/find-work?ref=${user?.id || 'guest'}`;
  
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join me on Tolstoy Staffing!",
          text: "I'm finding great construction work on Tolstoy Staffing. Join up and when you make your first $100, we BOTH get a $100 bonus!",
          url: affiliateLink,
        });
        safeToast({ title: "Shared successfully!" });
      } catch (err) {
        copyToClipboard();
      }
    } else {
      copyToClipboard();
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(affiliateLink);
    safeToast({ title: "Link copied!", description: "Share it with your friends to earn $100!" });
  };

  // Handle completion after stage 2. Pass acknowledgedName when user clicks Acknowledge (name used as signature, no draw/scroll).
  const handleCompleteOnboarding = async (acknowledgedName?: string) => {
    acknowledgedSignatureRef.current = acknowledgedName ?? null;
    // First, handle authentication if needed
    if (!user) {
      // If user provided password, register them
      if (!isGoogleAuth && formData.password) {
        setIsRegistering(true);
        try {
          const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              email: formData.email?.toLowerCase().trim(),
              password: formData.password,
              firstName: formData.firstName,
              lastName: formData.lastName,
            }),
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.message || "Registration failed");
          }
          
          // Invalidate auth cache to refresh authentication state without reloading
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          
          // Save onboarding progress before auth state updates
          saveOnboardingProgress();
          
          safeToast({ title: "Account created successfully!" });
          // Don't reload - let React Query update the auth state
          // The useEffect will handle restoring state when user becomes available
          setIsRegistering(false);
          return;
        } catch (error: any) {
          safeToast({ 
            title: "Registration Error",
            description: error.message || "Failed to create account. Please try again.",
            variant: "destructive"
          });
          setIsRegistering(false);
          return;
        }
      } else {
        // Save data to sessionStorage before redirecting to Google auth
        sessionStorage.setItem("onboardingData", JSON.stringify({
          formData,
          avatarPreview,
        }));
        safeToast({ title: "Please sign in with Google to continue", description: "You'll be redirected to complete your profile." });
        const loginUrl = getUrlForPath("/api/login?returnTo=/worker-onboarding", true);
        window.location.href = loginUrl;
        return;
      }
    }

    // Create or update profile
    const profileData = {
      userId: user.id,
      role: "worker" as const,
      businessName: formData.businessName || null,
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      bio: formData.bio,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      zipCode: formData.zipCode,
      ...(typeof formData.latitude === "number" && !Number.isNaN(formData.latitude) && typeof formData.longitude === "number" && !Number.isNaN(formData.longitude)
        ? { latitude: formData.latitude, longitude: formData.longitude }
        : {}),
      avatarUrl: formData.avatarUrl,
      hourlyRate: formData.hourlyRate,
      serviceCategories: formData.serviceCategories,
      portfolioImages: formData.portfolioImages ?? [],
      yearsOfExperience: formData.yearsOfExperience || null,
      onboardingStatus: "complete" as const,
      onboardingStep: 6,
      instantPayoutEnabled: existingProfile?.instantPayoutEnabled ?? instantPayoutPreferred,
    };
    
    // Connect bank account to Mercury if provided
    if (bankAccount.routingNumber && bankAccount.accountNumber && !bankConnected) {
      try {
        await connectBankMutation.mutateAsync({
          routingNumber: bankAccount.routingNumber,
          accountNumber: bankAccount.accountNumber,
          accountType: bankAccount.accountType,
          bankName: bankAccount.bankName,
          recipientType: "business",
          address: formData.address || undefined,
          city: formData.city || undefined,
          state: formData.state || undefined,
          zipCode: formData.zipCode || undefined,
        });
        setBankConnected(true);
      } catch (error: any) {
        console.error("Failed to connect bank account:", error);
        // Don't block onboarding if bank connection fails
        safeToast({
          title: "Bank connection pending",
          description: "Your profile was saved. You can connect your bank account later.",
          variant: "default"
        });
      }
    }

    // Helper function to save digital signature (signatureOverride: acknowledged name or drawn image data)
    const saveDigitalSignature = async (profileId: number, signatureOverride?: string | null) => {
      const data = signatureOverride ?? signatureData;
      if (!data) return;
      const signedName = formData.firstName && formData.lastName ? `${formData.firstName} ${formData.lastName}` : "Contractor";
      try {
        await apiRequest("POST", "/api/signatures", {
          profileId,
          documentType: "contractor_agreement",
          documentVersion: "1.0",
          signedName,
          signatureData: data,
          ipAddress: "", // Will be captured server-side
          signedAt: new Date(),
        });
      } catch (error) {
        console.error("Failed to save digital signature:", error);
        // Don't block onboarding if signature save fails
      }
    };

    if (existingProfile) {
      updateProfile({ id: existingProfile.id, data: profileData, skipToast: true }, {
        onSuccess: async (updatedProfile) => {
          const sig = acknowledgedSignatureRef.current ?? signatureData;
          if (sig && existingProfile.id) {
            await saveDigitalSignature(existingProfile.id, sig);
            acknowledgedSignatureRef.current = null;
          }
          clearOnboardingProgress();
          await queryClient.invalidateQueries({ queryKey: ["/api/signatures"] });
          invalidateSessionProfileQueries(queryClient);
          const isEmployee = existingProfile.teamId !== null && existingProfile.teamId !== undefined;
          const target = isEmployee ? "/dashboard/today" : "/dashboard";
          // Defer to escape React Query's callback flow; skip toast (triggers Radix setRef bug).
          setTimeout(() => {
            if (updatedProfile && user?.id) {
              queryClient.setQueryData(profileMeQueryKey(user.id), updatedProfile);
            }
            setLocation(target);
          }, 0);
        },
        onError: () => {
          safeToast({ title: "Error saving profile", variant: "destructive" });
        }
      });
    } else {
      const ref = new URLSearchParams(window.location.search).get("ref");
      createProfile({ ...profileData, ...(ref ? { ref } : {}), skipToast: true } as Parameters<typeof createProfile>[0], {
        onSuccess: async () => {
          try {
            const res = await apiRequest("GET", `/api/profiles?userId=${user?.id}`);
            const profiles = await res.json();
            const newProfile = Array.isArray(profiles) ? profiles[0] : profiles;
            const sig = acknowledgedSignatureRef.current ?? signatureData;
            if (sig && newProfile?.id) {
              await saveDigitalSignature(newProfile.id, sig);
              acknowledgedSignatureRef.current = null;
            }
            clearOnboardingProgress();
            await queryClient.invalidateQueries({ queryKey: ["/api/signatures"] });
            invalidateSessionProfileQueries(queryClient);
            if (newProfile && user?.id) {
              queryClient.setQueryData(profileMeQueryKey(user.id), newProfile);
            }
            const isEmployee = !!newProfile?.teamId;
            const target = isEmployee ? "/dashboard/today" : "/dashboard";
            // Defer to escape React Query's callback flow; skip toast (triggers Radix setRef bug).
            setTimeout(() => setLocation(target), 0);
          } catch (error) {
            console.error("Error fetching profile after creation:", error);
            setTimeout(() => setLocation("/dashboard"), 0);
          }
        },
        onError: () => {
          safeToast({ title: "Error creating profile", variant: "destructive" });
        }
      });
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-gray-600" />
      </div>
    );
  }

  // Define steps structure for navigation - comprehensive onboarding
  const steps = [
    {
      id: 1,
      title: "Account Setup",
      subSteps: [
        { id: "face-verification", label: "Face Verification", completed: faceVerified },
        { id: "your-details", label: "Your details", completed: !!(formData.firstName && formData.lastName && formData.email && formData.phone) },
        { id: "password", label: "Account Setup", completed: isAuthenticated || (isGoogleAuth && faceVerified) || (!isGoogleAuth && formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && faceVerified) },
      ]
    },
    {
      id: 2,
      title: "Location",
      subSteps: [
        { id: "location", label: "Location", completed: !!(formData.address) },
      ]
    },
    {
      id: 3,
      title: "Skills & Services",
      subSteps: [
        { id: "hourly-rate", label: "Hourly Rate", completed: formData.hourlyRate != null && formData.hourlyRate >= 1 },
        { id: "categories", label: "Service Categories", completed: !!(formData.serviceCategories && formData.serviceCategories.length > 0) },
        { id: "portfolio", label: "Prior Work Photos", completed: !!(formData.portfolioImages && formData.portfolioImages.length > 0) },
      ]
    },
    {
      id: 4,
      title: "Business Operator & Teammates",
      subSteps: [
        { id: "teammates", label: "Invite Teammates", completed: true },
      ]
    },
    {
      id: 5,
      title: "Payout Setup",
      subSteps: [
        { id: "bank-account", label: "Bank Account", completed: hasBankVerified || !!(bankAccount.routingNumber && bankAccount.accountNumber) },
      ]
    },
    {
      id: 6,
      title: "Documents",
      subSteps: [
        { id: "w9", label: "W-9 Form", completed: !!(existingProfile?.w9UploadedAt) },
        { id: "insurance", label: "Insurance", completed: !!(insuranceData.documentUrl || insuranceSkipped) },
      ]
    },
    {
      id: 7,
      title: "Contract & Agreement",
      subSteps: [
        { id: "contract", label: "Contract Review", completed: !!(signatureData || existingProfile?.contractSigned) },
      ]
    },
  ];

  // Get current step info
  const currentStepInfo = steps.find(s => s.id === currentStep);
  // Sub-step is "completed" only when user has moved past this step (next step or later). Current step is never completed until they advance.
  const getStepStatus = (stepId: number, subStepId: string) => {
    if (stepId < currentStep) return "completed";
    if (stepId === currentStep) {
      const step = steps.find(s => s.id === stepId);
      const firstIncomplete = step?.subSteps.find(s => !s.completed);
      const subStep = step?.subSteps.find(s => s.id === subStepId);
      return subStep?.id === (firstIncomplete?.id ?? step?.subSteps[0]?.id) ? "active" : "pending";
    }
    return "pending";
  };

  // Get active sub-step for current step
  const getActiveSubStep = (stepId: number) => {
    if (stepId !== currentStep) return null;
    const step = steps.find(s => s.id === stepId);
    return step?.subSteps.find(s => !s.completed) || step?.subSteps[0] || null;
  };

  // Progress: 9 segments (step1, step2, step3-rate, step3-cat, step3-portfolio, step4-teammates, step5, step6, step7)
  const getOnboardingSegmentIndex = () => {
    if (currentStep <= 1) return 0;
    if (currentStep === 2) return 1;
    if (currentStep === 3 && step3SubStep === "rate") return 2;
    if (currentStep === 3 && step3SubStep === "categories") return 3;
    if (currentStep === 3 && step3SubStep === "portfolio") return 4;
    if (currentStep === 4) return 5;
    if (currentStep === 5) return 6;
    if (currentStep === 6) return 7;
    return 8;
  };
  const TOTAL_SEGMENTS = 9;
  const onboardingProgressPercent = ((getOnboardingSegmentIndex() + 1) / TOTAL_SEGMENTS) * 100;

  // Navigate to a step and optionally substep (for sidebar clicks)
  const goToStep = (stepId: number, subStepId?: string) => {
    setCurrentStep(stepId);
    if (stepId === 3) {
      const sub = subStepId === "categories" || subStepId === "portfolio" ? subStepId : "rate";
      setStep3SubStep(sub);
      saveOnboardingProgress({ currentStep: stepId, step3SubStep: sub });
      window.history.replaceState(null, "", `/worker-onboarding?step=3&sub=${sub}`);
      setLocation(`/worker-onboarding?step=3&sub=${sub}`);
    } else {
      saveOnboardingProgress({ currentStep: stepId });
      window.history.replaceState(null, "", `/worker-onboarding?step=${stepId}`);
      setLocation(`/worker-onboarding?step=${stepId}`);
    }
  };

  // Pre-stage (Step 0) - Welcome page (no sign-in required)
  if (currentStep === 0) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <div className="flex-1 flex min-h-0">
          {/* Left Panel - Step Navigation (hidden on mobile, same as steps 1+) */}
          <aside className="hidden md:block w-80 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-lg">T</span>
                </div>
                <span className="text-lg font-semibold text-gray-900">Request access</span>
              </div>
              <nav className="space-y-6">
                {steps.map((step) => {
                  const isStepActive = step.id === currentStep;
                  const stepCompleted = currentStep > step.id;
                  return (
                    <div key={step.id} className="space-y-2">
                      <div className="flex items-center gap-3">
                        {isStepActive ? (
                          <div className="w-8 h-8 rounded-full bg-[#00A86B] flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold text-base">{step.id}</span>
                          </div>
                        ) : stepCompleted ? (
                          <div className="w-8 h-8 rounded-full border-2 border-gray-300 bg-white flex items-center justify-center flex-shrink-0">
                            <Check className="w-4 h-4 text-gray-800" strokeWidth={3} />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold text-base">{step.id}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => goToStep(step.id)}
                          className={`text-sm font-semibold text-left ${isStepActive ? "text-gray-900" : "text-gray-600"} hover:text-gray-900`}
                        >
                          {step.title}
                        </button>
                      </div>
                    <div className="space-y-1 pl-11">
                      {step.subSteps.map((subStep) => {
                        const status = getStepStatus(step.id, subStep.id);
                        const activeSubStep = getActiveSubStep(step.id);
                        const isActive = status === "active" || (status === "pending" && subStep.id === activeSubStep?.id && isStepActive);
                        const isCompleted = status === "completed";
                        return (
                          <button
                            key={subStep.id}
                            type="button"
                            onClick={() => goToStep(step.id, step.id === 3 ? subStep.id : undefined)}
                            className={`w-full flex items-center gap-3 py-1.5 px-3 rounded-xl text-left ${
                              isActive
                                ? "bg-green-50 text-[#00A86B] font-medium"
                                : isCompleted
                                ? "bg-white border border-gray-300 text-gray-900 font-medium"
                                : isStepActive
                                ? "bg-green-50 text-gray-700"
                                : "text-gray-400 hover:text-gray-600"
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
                            <span className="text-sm">{subStep.label}</span>
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

          {/* Right Panel - Welcome Content (full width on mobile) */}
          <main className="flex-1 min-w-0 flex flex-col bg-white relative">
            {/* Mobile: compact header (matches steps 1+ feel) */}
            {isMobile && (
              <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-lg">T</span>
                </div>
                <span className="text-base font-semibold text-gray-900">Request access</span>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-12 pb-6 md:pb-8">
              <div className="mb-6 md:mb-10">
                <h1 className="text-2xl md:text-3xl font-bold mb-2 md:mb-3 text-gray-900">Join Tolstoy Staffing</h1>
                <p className="text-base md:text-lg text-gray-600">The platform that connects skilled workers with construction companies. Work on your terms, get paid fast, and build your reputation.</p>
              </div>

              {/* Main Benefits Container */}
              <div className="mb-6 md:mb-8">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 md:p-6 mb-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-0 md:mb-4">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-2">Why Choose Tolstoy Staffing?</h2>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        We're a digital marketplace connecting skilled labor contractors with businesses seeking temporary or project-based staffing services. Set your own rate, work when you want, and get paid directly to your bank.
                      </p>
                    </div>
                    {/* Graphical Icon - Money Bag with Gears */}
                    <div className="flex-shrink-0 md:ml-6">
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center shadow-lg">
                        <div className="relative">
                          <DollarSign className="w-8 h-8 md:w-10 md:h-10 text-white" strokeWidth={2.5} />
                          <div className="absolute -top-1 -right-1 w-3 h-3 md:w-4 md:h-4 bg-white/30 rounded-full flex items-center justify-center">
                            <Zap className="w-2 h-2 md:w-2.5 md:h-2.5 text-white" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub-Items - Key Benefits */}
                <div className="space-y-0">
                  {/* Benefit 1: Set Your Own Rate */}
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
                            <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                          </div>
                          <h3 className="font-bold text-gray-900 text-sm md:text-base">Set Your Own Rate</h3>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                          You control your hourly rate. No platform fees deducted from your pay. Your rate is paid in full without any deductions.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Benefit 2: Fast Payments */}
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
                            <Clock className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                          </div>
                          <h3 className="font-bold text-gray-900 text-sm md:text-base">Instant Payments</h3>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                          Get paid instantly with Mercury InstaPay, or within 3-5 business days via standard ACH. Direct bank transfers - no waiting, no chasing payments.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Benefit 3: Work on Your Terms */}
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
                            <Briefcase className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                          </div>
                          <h3 className="font-bold text-gray-900 text-sm md:text-base">Work on Your Terms</h3>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                          Accept or decline any job without penalty. You're an independent contractor with full control over your schedule and work choices.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Benefit 4: Verified Companies */}
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
                            <Shield className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                          </div>
                          <h3 className="font-bold text-gray-900 text-sm md:text-base">Verified Companies</h3>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                          All companies are verified before posting jobs. Work with legitimate businesses that value quality work and fair treatment.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Benefit 5: Multiple Trade Categories */}
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
                            <Hammer className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                          </div>
                          <h3 className="font-bold text-gray-900 text-sm md:text-base">Multiple Trade Categories</h3>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                          From construction and electrical to plumbing, HVAC, and more. Select your skills and get matched with relevant jobs in your area.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Trust Indicators */}
              <div className="flex flex-wrap justify-center gap-4 md:gap-6 mb-6 text-xs md:text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                  </div>
                  <span className="font-medium">Verified Companies</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                  </div>
                  <span className="font-medium">No Fees Ever</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                  </div>
                  <span className="font-medium">Instant Payments Available</span>
                </div>
              </div>
              </div>
            </div>

            {/* Bottom Navigation Bar - mobile: stacked (Google, Email, Exit); desktop: row with Exit left */}
            <footer className="border-t border-gray-200 bg-white shrink-0 sticky bottom-0 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
              <div className={`max-w-3xl mx-auto px-4 md:px-8 py-4 md:py-4 flex ${isMobile ? "flex-col gap-4 py-6" : "flex-row items-center gap-3"}`}>
                {isMobile ? (
                  <>
                    <Button
                      onClick={() => continueWithGoogle(0)}
                      variant="outline"
                      className="w-full h-12 rounded-xl border-gray-300 text-gray-700 hover:bg-gray-50 text-base font-medium"
                      data-testid="button-google-signup"
                    >
                      <SiGoogle className="w-4 h-4 mr-2" />
                      Continue with Google
                    </Button>
                    <Button
                      onClick={nextStep}
                      className="w-full h-12 rounded-xl bg-gray-900 text-white hover:bg-gray-800 font-semibold text-base"
                      data-testid="button-begin-signup"
                    >
                      Continue with Email
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full h-12 rounded-xl text-muted-foreground border-0 shadow-none text-base"
                      onClick={() => setLocation("/")}
                      data-testid="button-close-onboarding"
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
                      data-testid="button-close-onboarding"
                      aria-label="Close"
                      type="button"
                    >
                      Exit
                    </Button>
                    <div className="flex gap-3 flex-1 justify-end">
                      <Button
                        onClick={() => continueWithGoogle(0)}
                        variant="outline"
                        className="h-10 border-gray-300 text-gray-700 hover:bg-gray-50"
                        data-testid="button-google-signup"
                      >
                        <SiGoogle className="w-4 h-4 mr-2" />
                        Continue with Google
                      </Button>
                      <Button
                        onClick={nextStep}
                        className="h-10 bg-gray-900 text-white hover:bg-gray-800"
                        data-testid="button-begin-signup"
                      >
                        Continue with Email
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </footer>
          </main>
        </div>
      </div>
    );
  }

  // Steps 3-10 removed - simplified to 2 stages
  // Step 7: Insurance Upload - REMOVED (kept behind flag so TS still type-checks the block)
  const insuranceStepEnabled = false;
  if (insuranceStepEnabled && currentStep === 7) {
    const handleInsuranceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setIsExtractingInsurance(true);
      
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64Data = ev.target?.result as string;
        setInsuranceData(prev => ({ ...prev, documentUrl: base64Data }));
        
        try {
          // Call AI to extract fields
          const response = await apiRequest("POST", "/api/ai/extract-insurance", {
            document: base64Data,
          });
          const result = await response.json();
          
          if (result.success && result.data) {
            setInsuranceData(prev => ({
              ...prev,
              policyNumber: result.data.policyNumber || "",
              issuer: result.data.issuer || "",
              startDate: result.data.startDate || "",
              endDate: result.data.endDate || "",
              coverageType: result.data.coverageType || "",
              coverageAmount: result.data.coverageAmount || 0,
            }));
            safeToast({
              title: "Insurance verified!",
              description: "We've extracted your policy information.",
            });
          } else {
            safeToast({
              title: "Extraction incomplete",
              description: "Some fields couldn't be extracted. Please contact support if needed.",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error("Insurance extraction error:", error);
          safeToast({
            title: "Processing error",
            description: "Unable to process the insurance document. Please try again.",
            variant: "destructive",
          });
        } finally {
          setIsExtractingInsurance(false);
        }
      };
      reader.readAsDataURL(file);
    };

    const handleSkipInsurance = () => {
      setInsuranceSkipped(true);
      nextStep();
    };

    // Parse dates and check insurance validity
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr) return null;
      // Handle MM/DD/YYYY format
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const [month, day, year] = parts;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
      // Try ISO format
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startDateParsed = parseDate(insuranceData.startDate);
    const endDateParsed = parseDate(insuranceData.endDate);
    
    const isInsuranceActive =
      startDateParsed !== null &&
      endDateParsed !== null &&
      today >= startDateParsed &&
      today <= endDateParsed;

    const isInsuranceExpired = endDateParsed !== null && today > endDateParsed;

    // Check if insurance expires within 1-4 months
    const monthsUntilExpiry =
      endDateParsed !== null
        ? Math.ceil((endDateParsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30))
        : null;
    const isExpiringSoon =
      monthsUntilExpiry !== null && monthsUntilExpiry >= 0 && monthsUntilExpiry <= 4;
    
    // Can proceed if document uploaded AND dates are valid (active coverage)
    const canProceed = insuranceData.documentUrl && isInsuranceActive;
    
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Warning Banner */}
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Insurance Verification (Optional)
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Skipping this step means companies will see "Insurance not validated" on your profile. 
                You won't be covered for job site liability and may be passed over for certain jobs.
              </p>
            </div>
          </div>
        </div>

        {/* Header - not sticky */}
        <div className="bg-background border-b border-border">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-primary" />
              <div>
                <h1 className="text-lg font-semibold">Insurance Verification</h1>
                <p className="text-xs text-muted-foreground">Step {currentStep} of {TOTAL_STEPS}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-4 md:p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Upload Section */}
            <Card>
              <CardContent className="p-6">
                <h2 className="font-semibold mb-4">Upload Your Insurance Certificate</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload a copy of your general liability insurance certificate. 
                  We'll automatically extract the policy details.
                </p>
                
                <input
                  ref={insuranceInputRef}
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  className="hidden"
                  onChange={handleInsuranceUpload}
                  data-testid="input-insurance-upload"
                />
                
                {!insuranceData.documentUrl ? (
                  <div 
                    onClick={() => insuranceInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    data-testid="dropzone-insurance-upload"
                  >
                    <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium">Click to upload insurance document</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, or PNG accepted</p>
                  </div>
                ) : (
                  <div className="border border-border rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">Insurance Document Uploaded</p>
                        <p className="text-xs text-muted-foreground">Ready for verification</p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setInsuranceData({
                            documentUrl: null,
                            policyNumber: "",
                            issuer: "",
                            startDate: "",
                            endDate: "",
                            coverageType: "",
                            coverageAmount: 0,
                          });
                        }}
                        data-testid="button-remove-insurance"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
                
                {isExtractingInsurance && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing document with AI...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Extracted Fields */}
            {insuranceData.documentUrl && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="font-semibold mb-4">Policy Information</h2>
                  <p className="text-xs text-muted-foreground mb-4">
                    These fields are automatically extracted and cannot be edited.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Policy Number</Label>
                      <Input 
                        value={insuranceData.policyNumber}
                        disabled
                        className="mt-1 bg-muted"
                        placeholder={isExtractingInsurance ? "Extracting..." : "Not detected"}
                        data-testid="input-policy-number"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground">Insurance Company (Issuer)</Label>
                      <Input 
                        value={insuranceData.issuer}
                        disabled
                        className="mt-1 bg-muted"
                        placeholder={isExtractingInsurance ? "Extracting..." : "Not detected"}
                        data-testid="input-issuer"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground">Coverage Start Date</Label>
                      <Input 
                        value={insuranceData.startDate}
                        disabled
                        className="mt-1 bg-muted"
                        placeholder={isExtractingInsurance ? "Extracting..." : "Not detected"}
                        data-testid="input-start-date"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground">Coverage End Date</Label>
                      <Input 
                        value={insuranceData.endDate}
                        disabled
                        className="mt-1 bg-muted"
                        placeholder={isExtractingInsurance ? "Extracting..." : "Not detected"}
                        data-testid="input-end-date"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground">Coverage Type</Label>
                      <Input 
                        value={insuranceData.coverageType}
                        disabled
                        className="mt-1 bg-muted"
                        placeholder={isExtractingInsurance ? "Extracting..." : "Not detected"}
                        data-testid="input-coverage-type"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground">Coverage Amount</Label>
                      <Input 
                        value={insuranceData.coverageAmount ? `$${(insuranceData.coverageAmount / 100).toLocaleString()}` : ""}
                        disabled
                        className="mt-1 bg-muted"
                        placeholder={isExtractingInsurance ? "Extracting..." : "Not detected"}
                        data-testid="input-coverage-amount"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Insurance Expiry Notices */}
            {insuranceData.documentUrl && isInsuranceExpired && (
              <Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-800 dark:text-red-400">Insurance Expired</p>
                      <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                        Your insurance policy has expired. Please upload a current insurance certificate to continue with verified insurance status.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {insuranceData.documentUrl && isExpiringSoon && !isInsuranceExpired && (
              <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-800 dark:text-amber-400">Insurance Expiring Soon</p>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                        Your insurance expires in {monthsUntilExpiry} month{monthsUntilExpiry !== 1 ? 's' : ''}. 
                        You can continue now, but remember to upload renewed insurance before it expires.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <Button 
                onClick={nextStep}
                disabled={!canProceed || isExtractingInsurance}
                className={`w-full h-12 gap-2 ${canProceed && !isExtractingInsurance ? 'bg-primary hover:bg-primary/90' : ''}`}
                data-testid="button-continue-with-insurance"
              >
                {isExtractingInsurance ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Continue with Insurance
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
              
              <Button 
                variant="outline"
                onClick={handleSkipInsurance}
                className="w-full h-12 gap-2"
                data-testid="button-skip-insurance"
              >
                Skip for Now
              </Button>
              
              <Button variant="ghost" onClick={prevStep} className="gap-2">
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 6 is rendered inside the main two-column layout below (no early return).

  // Step 9: Google Sign-in - REMOVED (handled in handleCompleteOnboarding)
  if (false && currentStep === 9) {
    // Handle email registration
    const handleEmailRegistration = async () => {
      setIsRegistering(true);
      try {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email: formData.email?.toLowerCase().trim(),
            password: formData.password,
            firstName: formData.firstName,
            lastName: formData.lastName,
          }),
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.message || "Registration failed");
        }
        
        // Invalidate auth cache to refresh authentication state
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        
        safeToast({ title: "Account created successfully!" });
        // Move to completion step - the profile will be created there
        setCurrentStep(10);
      } catch (error: any) {
        safeToast({ 
          title: "Registration Error",
          description: error.message || "Failed to create account. Please try again.",
          variant: "destructive"
        });
      } finally {
        setIsRegistering(false);
      }
    };

    // Check if user provided password (email registration) vs needs Google
    // If user is authenticated via Google, skip password registration
    const hasPassword = !isGoogleAuth && formData.password && formData.password.length > 0;
    const needsGoogleAuth = !isAuthenticated && !hasPassword;

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="text-center mb-12">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold mb-4">Almost There!</h1>
            <p className="text-xl text-muted-foreground">
              {hasPassword 
                ? "You've completed all the steps. Create your account to save your profile."
                : "You've completed all the steps. Sign in with Google to save your profile and start getting matched with jobs."}
            </p>
          </div>

          <div className="space-y-6 mb-12">
            <div className="p-6 bg-card border border-border rounded-2xl">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-5 h-5 text-green-500" />
                Your information is ready to save
              </h3>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  Personal details & photo verified
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  {formData.serviceCategories?.length || 0} skills selected
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  Bank account connected
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  Contract signed
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            {isAuthenticated && isGoogleAuth ? (
              // User is authenticated via Google, skip to completion
              <Button 
                onClick={() => setCurrentStep(10)}
                className="w-full h-14 text-lg gap-3"
                data-testid="button-continue-google"
              >
                <CheckCircle2 className="w-5 h-5" />
                Continue to Complete Profile
              </Button>
            ) : hasPassword ? (
              <Button 
                onClick={handleEmailRegistration}
                disabled={isRegistering}
                className="w-full h-14 text-lg gap-3"
                data-testid="button-create-account"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    <Shield className="w-5 h-5" />
                    Create My Account
                  </>
                )}
              </Button>
            ) : (
              <Button 
                onClick={() => {
                  const onboardingData = JSON.stringify({
                    formData,
                    avatarPreview,
                    bankAccount,
                    insuranceData,
                    signatureData,
                    stepAtAuth: 9,
                  });
                  const returnTo = "/worker-onboarding";
                  window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}&onboardingData=${encodeURIComponent(onboardingData)}`;
                }} 
                className="w-full h-14 text-lg gap-3"
                data-testid="button-google-signin"
              >
                <SiGoogle className="w-5 h-5" />
                Sign in with Google
              </Button>
            )}
            
            <p className="text-center text-sm text-muted-foreground">
              {hasPassword 
                ? `Your account will be created with ${formData.email}`
                : "We use Google for secure sign-in. We'll never post anything without your permission."}
            </p>
            
            <Button variant="ghost" onClick={prevStep} className="w-full gap-2">
              <ChevronLeft className="w-4 h-4" /> Back to Contract
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Step 10: Completion - REMOVED (handled in handleCompleteOnboarding)
  if (false && currentStep === 10) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-lg">
          {/* Success Icon */}
          <div className="relative mb-8">
            <div className="w-32 h-32 mx-auto rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center animate-pulse">
              <DollarSign className="w-16 h-16 text-white" />
            </div>
            <div className="absolute -top-2 -right-2 w-12 h-12 bg-yellow-400 rounded-full flex items-center justify-center animate-bounce">
              <PartyPopper className="w-6 h-6 text-yellow-900" />
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Ready to Make Some Money!
          </h1>
          
          <p className="text-xl text-muted-foreground mb-8">
            Your profile is live. Companies can now find and hire you!
          </p>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="p-4 bg-card rounded-xl border border-border">
              <p className="text-3xl font-bold text-green-500">${formData.hourlyRate}</p>
              <p className="text-sm text-muted-foreground">per hour</p>
            </div>
            <div className="p-4 bg-card rounded-xl border border-border">
              <p className="text-3xl font-bold">{formData.serviceCategories?.length}</p>
              <p className="text-sm text-muted-foreground">skills listed</p>
            </div>
          </div>

          {/* CTA Button */}
          <Button 
            onClick={() => void handleCompleteOnboarding()}
            disabled={isCreating || isUpdating}
            size="lg"
            className="h-16 px-12 text-xl gap-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
            data-testid="button-complete-onboarding"
          >
            {(isCreating || isUpdating) ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Rocket className="w-6 h-6" />
            )}
            Let's Get to Work
            <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-medium">
              Dashboard
            </span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Two-Panel Layout: left sidebar hidden on mobile, replaced by step banner */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Step Navigation (desktop only) */}
        <aside className="hidden md:block w-80 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-lg">T</span>
              </div>
              <span className="text-lg font-semibold text-gray-900">Request access</span>
            </div>
            <nav className="space-y-6">
              {steps.map((step) => {
                const isStepActive = step.id === currentStep;
                const stepCompleted = currentStep > step.id;
                return (
                  <div key={step.id} className="space-y-2">
                    <div className="flex items-center gap-3">
                      {isStepActive ? (
                        <div className="w-8 h-8 rounded-full bg-[#00A86B] flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-bold text-base">{step.id}</span>
                        </div>
                      ) : stepCompleted ? (
                        <div className="w-8 h-8 rounded-full bg-white border border-gray-300 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-gray-800" strokeWidth={2.5} />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-bold text-base">{step.id}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => goToStep(step.id)}
                        className={`text-sm font-semibold text-left ${isStepActive ? "text-gray-900" : "text-gray-600"} hover:text-gray-900`}
                      >
                        {step.title}
                      </button>
                    </div>
                    <div className="space-y-1 pl-11">
                      {step.subSteps.map((subStep) => {
                        const status = getStepStatus(step.id, subStep.id);
                        const activeSubStep = getActiveSubStep(step.id);
                        const isActive = status === "active" || (status === "pending" && subStep.id === activeSubStep?.id && isStepActive);
                        const isCompleted = status === "completed";
                        return (
                          <button
                            key={subStep.id}
                            type="button"
                            onClick={() => goToStep(step.id, step.id === 3 ? subStep.id : undefined)}
                            className={`w-full flex items-center gap-3 py-1.5 px-3 rounded-xl text-left ${
                              isActive
                                ? "bg-green-50 text-[#00A86B] font-medium"
                                : isCompleted
                                ? "bg-white border border-gray-300 text-gray-900 font-medium"
                                : isStepActive
                                ? "bg-green-50 text-gray-700"
                                : "text-gray-400 hover:text-gray-600"
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
                            <span className="text-sm">{subStep.label}</span>
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

        {/* Right Panel - Current Step Content */}
        <main className="flex-1 min-w-0 flex flex-col bg-white relative">
          {/* Mobile: step progress banner with connector lines (light gray until that segment complete, then highlighted) */}
          {isMobile && currentStep >= 1 && currentStep <= 7 && (
            <div className="border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="px-4 py-3">
                <div className="flex items-center w-full gap-0">
                  {[1, 2, 3, 4, 5, 6, 7].map((stepNum, index) => (
                    <div key={stepNum} className={`flex items-center ${index < 6 ? "flex-1 min-w-0" : "flex-shrink-0"}`}>
                      {stepNum <= currentStep ? (
                        <Link
                          href={stepNum === 3 ? "/worker-onboarding?step=3&sub=rate" : `/worker-onboarding?step=${stepNum}`}
                          className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                            currentStep === stepNum
                              ? "bg-primary text-primary-foreground"
                              : "bg-white border border-gray-300 text-gray-700"
                          }`}
                          aria-current={currentStep === stepNum ? "step" : undefined}
                        >
                          {currentStep > stepNum ? <Check className="w-4 h-4" strokeWidth={2.5} /> : stepNum}
                        </Link>
                      ) : (
                        <span
                          className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold bg-gray-200 text-gray-500"
                          aria-current={currentStep === stepNum ? "step" : undefined}
                        >
                          {stepNum}
                        </span>
                      )}
                      {index < 6 && (
                        <div
                          className={`flex-1 h-0.5 min-w-[6px] mx-0.5 rounded-full transition-colors ${
                            currentStep > stepNum ? "bg-primary" : "bg-gray-300"
                          }`}
                          aria-hidden
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step header banner - desktop: above scroll; mobile: inside scroll so it is not sticky and scrolls with content */}
          {!isMobile && (currentStep >= 1 && currentStep <= 7) && (
            <header className="border-b border-gray-200 bg-white shrink-0">
              <div className="max-w-3xl mx-auto px-[33px] py-[11px] flex items-start gap-4">
                {currentStep === 1 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Camera className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Verify your identity</h2>
                      <p className="text-sm text-gray-600 mt-1">Upload a clear photo of your face to get started.</p>
                    </div>
                  </>
                )}
                {currentStep === 2 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Tell us about yourself</h2>
                      <p className="text-sm text-gray-600 mt-1">Complete your personal information to get started.</p>
                    </div>
                  </>
                )}
                {currentStep === 3 && step3SubStep === "rate" && !isTeamMember && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <DollarSign className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Set your hourly rate</h2>
                      <p className="text-sm text-gray-600 mt-1">Balance earnings with job availability.</p>
                    </div>
                  </>
                )}
                {currentStep === 3 && step3SubStep === "categories" && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Briefcase className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Tell us about your Industry</h2>
                      <p className="text-sm text-gray-600 mt-1">Select the industry that best describes your business.</p>
                    </div>
                  </>
                )}
                {currentStep === 3 && step3SubStep === "portfolio" && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Images className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Upload your prior work photos</h2>
                      <p className="text-sm text-gray-600 mt-1">Add up to 12 photos of completed work. Tag each to categorize.</p>
                    </div>
                  </>
                )}
                {currentStep === 4 && null}
                {currentStep === 5 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Set up your payout</h2>
                      <p className="text-sm text-gray-600 mt-1">Connect your bank account to receive fast ACH payouts.</p>
                    </div>
                  </>
                )}
                {currentStep === 6 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Tax Information</h2>
                      <p className="text-sm text-gray-600 mt-1">Upload your W-9 for tax purposes. Companies need it to report payments to the IRS and to pay you without backup withholding.</p>
                    </div>
                  </>
                )}
                {currentStep === 7 && (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-bold text-gray-900">Independent Contractor Agreement</h2>
                      <p className="text-sm text-gray-600 mt-1">Review and sign the agreement below.</p>
                    </div>
                  </>
                )}
              </div>
            </header>
          )}

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 md:px-8 py-4 md:py-8">
            {/* Mobile: step header inside scroll area so it is not sticky and scrolls with content */}
            {isMobile && (currentStep >= 1 && currentStep <= 7) && (
              <header className="border-b border-gray-200 bg-white shrink-0 mb-4 md:mb-0">
                <div className="max-w-3xl mx-auto px-4 md:px-8 py-4 flex items-start gap-4">
                  {currentStep === 1 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Camera className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Verify your identity</h2>
                        <p className="text-sm text-gray-600 mt-1">Upload a clear photo of your face to get started.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 2 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Tell us about yourself</h2>
                        <p className="text-sm text-gray-600 mt-1">Complete your personal information to get started.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 3 && step3SubStep === "rate" && !isTeamMember && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <DollarSign className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Set your hourly rate</h2>
                        <p className="text-sm text-gray-600 mt-1">Balance earnings with job availability.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 3 && step3SubStep === "categories" && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Briefcase className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Tell us about your Industry</h2>
                        <p className="text-sm text-gray-600 mt-1">Select the industry that best describes your business.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 4 && null}
                  {currentStep === 5 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <CreditCard className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Set up your payout</h2>
                        <p className="text-sm text-gray-600 mt-1">Connect your bank account to receive fast ACH payouts.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 6 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Tax Information</h2>
                        <p className="text-sm text-gray-600 mt-1">Upload your W-9 for tax purposes. Companies need it to report payments to the IRS and to pay you without backup withholding.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 7 && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Independent Contractor Agreement</h2>
                        <p className="text-sm text-gray-600 mt-1">Review and sign the agreement below.</p>
                      </div>
                    </>
                  )}
                </div>
              </header>
            )}
        {/* Step 1: Account Setup - Face Verification + Password (if email) */}
        {currentStep === 1 && (
          <div className="space-y-6">

            {/* Avatar Upload with Face Verification */}
            <div className="flex flex-col items-center mb-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer group"
                    disabled={isVerifyingFace}
                  >
                    <div className={`w-32 h-32 rounded-full border-4 ${
                      faceVerified ? 'border-green-500' : faceError ? 'border-destructive' : 'border-dashed border-border'
                    } bg-muted/50 flex items-center justify-center overflow-hidden hover:border-primary/50 transition-colors relative`}>
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center text-muted-foreground">
                          <Camera className="w-8 h-8 mb-2" />
                          <span className="text-xs">Add Photo</span>
                        </div>
                      )}
                      {isVerifyingFace && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>
                      )}
                      {avatarPreview && !isVerifyingFace && (
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Camera className="w-8 h-8 text-white" />
                        </div>
                      )}
                      {faceVerified && (
                        <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-48">
                  <DropdownMenuItem
                    onClick={() => avatarInputRef.current?.click()}
                    className="cursor-pointer"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Photo
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleCameraCapture}
                    className="cursor-pointer"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Take Photo
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input 
                ref={avatarInputRef}
                type="file" 
                accept="image/*" 
                className="hidden"
                onChange={handleFileInputChange}
                data-testid="input-avatar-upload"
              />
              {faceError && (
                <div className="flex items-center gap-2 mt-3 text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  <p className="text-sm">{faceError}</p>
                </div>
              )}
              {faceVerified && (
                <p className="text-sm text-green-600 mt-3">Face verified successfully!</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">Face photo required. Click to upload or take a photo</p>
            </div>

            {/* User details: first name, last name, email, phone (and optional business name) */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold mb-4 text-gray-900 uppercase tracking-wide">Your details</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700">
                    Business Name <span className="text-gray-500 font-normal">(Optional)</span>
                  </label>
                  <Input 
                    value={formData.businessName || ""} 
                    onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                    placeholder="Your business or company name"
                    className="bg-white border border-gray-300 rounded-md"
                    data-testid="input-business-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700">
                      First name <span className="text-red-500">*</span>
                    </label>
                    <Input 
                      value={formData.firstName || ""} 
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      placeholder="John"
                      className={`bg-white border border-gray-300 rounded-md ${errors.firstName ? "border-red-500" : ""}`}
                      data-testid="input-first-name"
                    />
                    {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700">
                      Last name <span className="text-red-500">*</span>
                    </label>
                    <Input 
                      value={formData.lastName || ""} 
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      placeholder="Doe"
                      className={`bg-white border border-gray-300 rounded-md ${errors.lastName ? "border-red-500" : ""}`}
                      data-testid="input-last-name"
                    />
                    {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <Input 
                    type="email"
                    value={formData.email || ""} 
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                    className={`bg-white border border-gray-300 rounded-md ${errors.email ? "border-red-500" : ""}`}
                    data-testid="input-email"
                  />
                  {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700">
                    Phone number <span className="text-red-500">*</span>
                  </label>
                  <Input 
                    type="tel"
                    value={formData.phone || ""} 
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                    className={`bg-white border border-gray-300 rounded-md ${errors.phone ? "border-red-500" : ""}`}
                    data-testid="input-phone"
                  />
                  {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
                </div>
              </div>
            </div>

            {!isAuthenticated && !isGoogleAuth && (
              <div className="space-y-3 border-t pt-6">
                <p className="text-sm text-muted-foreground">
                  Continue with Google to auto-fill this step, or create a password below.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => continueWithGoogle(1)}
                  data-testid="button-google-signup-step1"
                >
                  <SiGoogle className="w-4 h-4 mr-2" />
                  Continue with Google
                </Button>
              </div>
            )}

            {/* Password Fields - Only shown for email registration (not Google) */}
            {!isAuthenticated && !isGoogleAuth && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-4 text-gray-900 uppercase tracking-wide">Account Setup</h3>
                  <div className="space-y-4">
                    <div className="relative">
                      <label className="block text-sm font-medium mb-2 text-gray-700">
                        Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Input 
                          type={showPassword ? "text" : "password"}
                          value={formData.password || ""} 
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          placeholder="Create a secure password"
                          className={`bg-white border border-gray-300 rounded-md pr-10 ${errors.password ? "border-red-500" : ""}`}
                          data-testid="input-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
                      <p className="text-xs text-gray-500 mt-1">Must be at least 8 characters with uppercase, lowercase, and a number</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2 text-gray-700">
                        Confirm Password <span className="text-red-500">*</span>
                      </label>
                      <Input 
                        type={showPassword ? "text" : "password"}
                        value={formData.confirmPassword || ""} 
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        placeholder="Confirm your password"
                        className={`bg-white border border-gray-300 rounded-md ${errors.confirmPassword ? "border-red-500" : ""}`}
                        data-testid="input-confirm-password"
                      />
                      {errors.confirmPassword && <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: ID verification mini step (skippable) then Location */}
        {currentStep === 2 && showIdVerificationMiniStep && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-muted/30 p-6 md:p-8 space-y-5">
              <h2 className="text-lg font-semibold text-foreground text-center">Verify your ID (optional)</h2>
              <p className="text-sm text-muted-foreground text-center max-w-md mx-auto">
                Verified ID increases your chance of winning gigs. You can do this now or later in Account & Documents.
              </p>
              {/* Sample ID card (driver's license style): full-width, dashed border, whole card clickable → Start Identity Verification */}
              <div className="w-full">
                <button
                  type="button"
                  onClick={(existingProfile as { identityVerified?: boolean } | null)?.identityVerified ? undefined : handleStartIdVerification}
                  disabled={(existingProfile as { identityVerified?: boolean } | null)?.identityVerified}
                  className="relative w-full rounded-2xl border-2 border-dashed border-primary/30 bg-white overflow-hidden flex flex-col text-left shadow-sm hover:border-primary/50 hover:shadow-md hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70 disabled:pointer-events-none cursor-pointer transition-all aspect-[85/54] max-h-44 min-h-[152px] group"
                >
                  <Skeleton className="absolute inset-0 animate-pulse bg-muted/80 pointer-events-none" />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent bg-[length:200%_100%] animate-shimmer opacity-60 pointer-events-none" />
                  {/* Hover overlay for whole card → identity verification */}
                  {!(existingProfile as { identityVerified?: boolean } | null)?.identityVerified && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <span className="rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 shadow-lg">
                        Start Identity Verification
                      </span>
                    </div>
                  )}
                  {/* Blue header (like "DRIVER LICENSE") */}
                  <div className="relative z-10 bg-primary text-primary-foreground py-1.5 px-3 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold tracking-wider uppercase">ID Verification</span>
                  </div>
                  {/* Card body: left = compact photo + signature, right = sample fields */}
                  <div className="relative z-10 flex flex-1 min-h-0">
                    {/* Left: compact photo + sample signature (driver's license style) */}
                    <div className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 bg-primary/5 border-r border-dashed border-primary/20 p-1.5">
                      <div className="aspect-[3/4] w-full max-h-[72px] rounded overflow-hidden bg-muted/50 flex items-center justify-center shrink-0">
                        {avatarPreview || (existingProfile as { avatarUrl?: string | null } | null)?.avatarUrl || formData.avatarUrl ? (
                          <img
                            src={avatarPreview || (existingProfile as { avatarUrl?: string | null })?.avatarUrl || formData.avatarUrl || ""}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <User className="w-5 h-5 text-primary/50" strokeWidth={1.5} />
                          </div>
                        )}
                      </div>
                      <span className="text-[9px] font-serif italic text-foreground/80 truncate w-full text-center" style={{ fontFamily: "ui-serif, Georgia, serif" }}>
                        {formData.firstName || "Name"} {formData.lastName || "Surname"}
                      </span>
                    </div>
                    {/* Right: sample ID fields (driver's license style) */}
                    <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5 px-2.5 py-1.5 text-[10px] sm:text-xs">
                      <div className="text-muted-foreground/80 font-medium">ID: 000000-000</div>
                      <div className="font-semibold text-foreground uppercase truncate">{formData.firstName || "NAME"} {formData.lastName || "SURNAME"}</div>
                      <div className="flex gap-3 text-muted-foreground">
                        <span>DOB —.—.——</span>
                        <span>SEX —</span>
                      </div>
                      <div className="flex gap-3 text-muted-foreground">
                        <span>ISS —.—.——</span>
                        <span>EXP —.—.——</span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">Document + Face verification</div>
                    </div>
                  </div>
                  {/* Bottom: decorative barcode strip (sample ID look) */}
                  <div className="relative z-10 h-2 bg-muted/60 border-t border-dashed border-primary/20 flex items-center justify-center shrink-0">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} className="w-0.5 sm:w-1 bg-foreground/30 rounded-sm" style={{ height: i % 3 === 0 ? 4 : 6 }} />
                      ))}
                    </div>
                  </div>
                </button>
                <p className="text-xs text-muted-foreground text-center mt-2 max-w-md mx-auto align-middle">
                  Tap the card to start verification. This is what Companies will see when you submit gig applications.
                </p>
              </div>
              {/* CTA: card is primary; button below for clarity */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                {(existingProfile as { identityVerified?: boolean } | null)?.identityVerified ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-medium">Identity verified</span>
                  </div>
                ) : (
                  <Button
                    type="button"
                    onClick={handleStartIdVerification}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Start Identity Verification
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Location (after ID verify mini step or Skip) - list style with line separators */}
        {currentStep === 2 && !showIdVerificationMiniStep && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Location</h3>
              <p className="text-sm text-gray-600 mt-1">
                Your location helps us show you relevant job opportunities in your area. This applies to all jobs you'll see on the platform.
              </p>
            </div>

            {/* Address row */}
            <div className="px-4 py-4 border-b border-gray-200">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Address <span className="text-red-500">*</span>
              </label>
              <div className="relative mt-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 z-10 pointer-events-none">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="pl-10">
                  <GooglePlacesAutocomplete
                    id="worker-address-step2"
                    label=""
                    value={formData.address || ""}
                    onChange={(address, components) => {
                      const fromComponents = {
                        city: components.city || formData.city || "",
                        state: components.state || formData.state || "",
                        zipCode: components.zipCode || formData.zipCode || "",
                      };
                      const hasFromPlaces = !!(fromComponents.city && fromComponents.state && fromComponents.zipCode);
                      const parsed = !hasFromPlaces && address ? parseUSAddressLine(address) : null;
                      const city = fromComponents.city || parsed?.city || "";
                      const state = fromComponents.state || parsed?.state || "";
                      const zipCode = fromComponents.zipCode || parsed?.zipCode || "";
                      const lat = typeof components.latitude === "number" ? components.latitude : undefined;
                      const lng = typeof components.longitude === "number" ? components.longitude : undefined;
                      setFormData({
                        ...formData,
                        address: address,
                        city,
                        state,
                        zipCode,
                        ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
                      });
                      if (errors.address) {
                        const newErrors = { ...errors };
                        delete newErrors.address;
                        setErrors(newErrors);
                      }
                    }}
                    placeholder="Enter your address"
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">Select your address from the dropdown so we save your city, state, and zip—required for payouts.</p>
              {errors.address && <p className="text-xs text-red-500 mt-1">{errors.address}</p>}
            </div>

            {/* Short Bio row */}
            <div className="px-4 py-4 border-b border-gray-200">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Short Bio <span className="text-gray-500 font-normal">(Optional)</span>
              </label>
              <Textarea 
                value={formData.bio || ""} 
                onChange={(e) => {
                  const newBio = e.target.value;
                  const validation = validateBio(newBio);
                  if (validation.isValid || !newBio) {
                    setFormData({ ...formData, bio: newBio });
                    if (errors.bio) {
                      const newErrors = { ...errors };
                      delete newErrors.bio;
                      setErrors(newErrors);
                    }
                  } else {
                    setErrors({ ...errors, bio: validation.error || "Invalid bio content" });
                  }
                }}
                placeholder="Describe your expertise and experience level..."
                maxLength={220}
                className={`mt-1 resize-none bg-white border border-gray-300 rounded-md ${errors.bio ? "border-red-500" : ""}`}
                data-testid="input-bio"
              />
              <div className="flex justify-between mt-1">
                {errors.bio ? <p className="text-xs text-red-500">{errors.bio}</p> : <span />}
                <p className="text-xs text-gray-500">{(formData.bio?.length || 0)}/220 characters</p>
              </div>
              <p className="text-xs text-gray-500 mt-1">Do not include email addresses, phone numbers, or URLs</p>
            </div>

            {/* Years of Experience row */}
            <div className="px-4 py-4">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Years of Experience <span className="text-gray-500 font-normal">(Optional)</span>
              </label>
              <div className="space-y-2 mt-1">
                <Slider
                  value={[formData.yearsOfExperience || 1]}
                  onValueChange={(value) => setFormData({ ...formData, yearsOfExperience: value[0] })}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>1 year</span>
                  <span className="font-medium text-gray-900">{formData.yearsOfExperience || 1} {formData.yearsOfExperience === 1 ? 'year' : 'years'}</span>
                  <span>20 years</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Hourly Rate - full-width card, banner above amount, Use suggested below amount */}
        {currentStep === 3 && step3SubStep === "rate" && !isTeamMember && (
          <div className="space-y-6 -mx-4 md:-mx-8">
            <Card className="rounded-xl">
              <CardContent className="p-0">
                {/* Banner first (Pro Tip or warning) - full width, no horizontal padding */}
                {formData.hourlyRate <= 25 ? (
                  <div className="flex items-start gap-3 p-4 md:p-5 bg-green-50 rounded-t-xl border-b border-green-200">
                    <TrendingUp className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-green-800">Pro tip: Start low, get the work, then bump it.</p>
                      <p className="text-sm text-green-700 mt-1">Guys at $15–20/hr get on the board fast and fill their calendar. No one’s gonna argue with a raise once you’ve got reviews. Don’t price yourself out before you’ve even clocked in.</p>
                    </div>
                  </div>
                ) : formData.hourlyRate <= 35 ? (
                  <div className="flex items-start gap-3 p-4 md:p-5 bg-amber-50 rounded-t-xl border-b border-amber-200">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-amber-800">Slow down, hotshot.</p>
                      <p className="text-sm text-amber-700 mt-1">This rate doesn’t get many bites. Drop to $15–20, get the jobs, then raise it. Or hit “Use suggested rate” below and we’ll stop nagging.</p>
                    </div>
                  </div>
                ) : formData.hourlyRate <= 45 ? (
                  <div className="flex items-start gap-3 p-4 md:p-5 bg-orange-50 rounded-t-xl border-b border-orange-200">
                    <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-orange-800">Boss rate, zero calls.</p>
                      <p className="text-sm text-orange-700 mt-1">Most work on here is $15–28/hr. At this number you’re gonna be waiting a while. Use the suggested rate button—your future self will thank you.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-4 md:p-5 bg-red-50 rounded-t-xl border-b border-red-200">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-red-800">Yeah, good luck with that.</p>
                      <p className="text-sm text-red-700 mt-1">Rates this high almost never get matched. Seriously—click “Use suggested rate” and get back to getting work instead of staring at an empty inbox.</p>
                    </div>
                  </div>
                )}

                {/* Amount + Use suggested rate - padded content */}
                <div className="px-4 md:px-6 pt-6 pb-6">
                  <div className="text-center mb-2">
                    <span className="text-6xl font-bold">${formData.hourlyRate}</span>
                    <span className="text-2xl text-gray-600">/hr</span>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full mt-2 mb-6 border-green-300 text-green-800 hover:bg-green-50 hover:border-green-400"
                    onClick={() => {
                      setFormData({ ...formData, hourlyRate: 20 });
                      setStep3SubStep("categories");
                    }}
                    data-testid="button-use-suggested-rate"
                  >
                    Use suggested rate ($20/hr)
                  </Button>

                  {/* Time to First Job */}
                  <div className="text-center mb-6">
                    <p className="text-sm text-gray-600">Time to first job</p>
                    <p className="text-xl font-semibold">{getJobFindingTime(formData.hourlyRate).days}</p>
                  </div>

                  {/* Slider - neutral track */}
                  <div className="mb-4">
                    <RateSlider
                      value={formData.hourlyRate}
                      onValueChange={(value) => setFormData({ ...formData, hourlyRate: value })}
                      className="w-full [&_[role=slider]]:h-5 [&_[role=slider]]:w-5"
                    />
                  </div>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>$1/hr</span>
                    <span>$200/hr</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 3b: Service Categories - full-width accordions (0 horizontal gap) */}
        {currentStep === 3 && step3SubStep === "categories" && (
          <div className="space-y-4">
            <div className="-mx-4 md:-mx-8 space-y-3">
            {INDUSTRY_CATEGORIES.map((industry) => {
              const IndustryIcon = industry.icon;
              const selectedCount = industry.roles.filter(r => formData.serviceCategories?.includes(r.id)).length;
              const allSelected = industry.roles.length > 0 && industry.roles.every(r => formData.serviceCategories?.includes(r.id));
              return (
                <div key={industry.id} className="shadow-sm overflow-visible">
                  {/* Category Header - sticky when accordion is open so it stays visible while scrolling roles */}
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <div 
                        className="sticky top-0 z-20 flex items-center justify-between w-full px-4 py-3 cursor-pointer bg-gray-50 border border-gray-200 rounded-t-xl hover:bg-gray-100 transition-colors shadow-sm"
                        data-testid={`accordion-${industry.id}`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Industry icon */}
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center flex-shrink-0 shadow-sm">
                            <IndustryIcon className="w-5 h-5 text-white" strokeWidth={2.5} />
                          </div>
                          <div className="flex flex-col">
                            <h3 className="font-semibold text-gray-900 text-sm">{industry.label}</h3>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {selectedCount > 0 
                                ? `${selectedCount} of ${industry.roles.length} selected`
                                : `Select from ${industry.roles.length} roles`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {allSelected && (
                            <span className="text-xs font-medium text-[#00A86B] px-2 py-1 rounded">All selected</span>
                          )}
                          <ChevronDown className="w-5 h-5 text-gray-500 transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {/* Individual Role Containers - White Cards */}
                      <div className="bg-white border-x border-b border-gray-200 rounded-b-xl px-0">
                        {industry.roles.map((role, index) => {
                          const RoleIcon = role.icon;
                          const isSelected = formData.serviceCategories?.includes(role.id);
                          const isLast = index === industry.roles.length - 1;
                          return (
                            <label 
                              key={role.id} 
                              className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b ${
                                isLast ? 'border-b-0' : 'border-gray-200'
                              } ${
                                isSelected 
                                  ? "bg-green-50/30" 
                                  : "bg-white hover:bg-gray-50"
                              }`}
                              data-testid={`role-${role.id.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              <div className="mt-0.5 flex-shrink-0">
                                <Checkbox 
                                  checked={isSelected}
                                  onCheckedChange={(checked) => handleCategoryToggle(role.id, !!checked)}
                                  className="data-[state=checked]:bg-[#00A86B] data-[state=checked]:border-[#00A86B]"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  {/* Role icon */}
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                                    isSelected 
                                      ? 'bg-gradient-to-br from-[#00A86B] to-[#008A57] shadow-sm' 
                                      : 'bg-gray-100 hover:bg-gray-200'
                                  }`}>
                                    <RoleIcon className={`${
                                      isSelected ? 'text-white w-4 h-4' : 'text-gray-600 w-3 h-3'
                                    }`} strokeWidth={isSelected ? 2.5 : 2} />
                                  </div>
                                  <span className="font-semibold text-gray-900 text-sm">{role.label}</span>
                                  {role.isElite && (
                                    <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200">
                                      ELITE
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-600 leading-snug">{role.desc}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {/* Step 3c: Prior Work Photos - upload up to 12 images to reviews bucket, with Tags */}
        {currentStep === 3 && step3SubStep === "portfolio" && (
          <div className="space-y-4">
            {/* OAuth sync: compact 2-row block */}
            <div className="flex flex-col gap-1.5 rounded-lg border border-green-200 bg-green-50/40 dark:border-green-800 dark:bg-green-950/20 px-3 py-2">
              <p className="text-sm text-green-800 dark:text-green-200">
                Sync your Google reviews from your Google account.
              </p>
              <div className="flex items-center gap-2">
                {isGoogleReviewsConnected ? (
                  <Button
                    onClick={handleSyncGoogleReviews}
                    disabled={syncingGoogleReviews}
                    size="sm"
                    variant="secondary"
                    className="h-8 bg-green-700/90 hover:bg-green-800 text-white text-xs"
                  >
                    {syncingGoogleReviews ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <SiGoogle className="w-3.5 h-3.5 mr-1.5" />
                        Sync from Google
                      </>
                    )}
                  </Button>
                ) : (
                  <a
                    href={"/api/reviews/connect-google?returnUrl=" + encodeURIComponent("/worker-onboarding")}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md h-8 px-3 text-xs font-medium bg-green-700/90 hover:bg-green-800 text-white transition-colors"
                  >
                    <SiGoogle className="w-3.5 h-3.5" />
                    Connect & sync from Google
                  </a>
                )}
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => !isPortfolioUploading && portfolioFileActions.openFileDialog()}
              onKeyDown={(e) => { if (!isPortfolioUploading && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); portfolioFileActions.openFileDialog(); } }}
              className={cn(
                "relative rounded-lg border-2 border-dashed p-6 text-center transition-all duration-200",
                isPortfolioUploading ? "cursor-wait" : "cursor-pointer",
                portfolioFileState.isDragging
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : "border-muted-foreground/25 hover:border-green-400/70 hover:bg-green-50/50 dark:hover:bg-green-950/20"
              )}
              onDragEnter={isPortfolioUploading ? undefined : portfolioFileActions.handleDragEnter}
              onDragLeave={portfolioFileActions.handleDragLeave}
              onDragOver={portfolioFileActions.handleDragOver}
              onDrop={isPortfolioUploading ? undefined : portfolioFileActions.handleDrop}
            >
              <input {...(portfolioFileActions.getInputProps() as React.ComponentProps<"input">)} className="sr-only" disabled={isPortfolioUploading} />
              {isPortfolioUploading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-background/80 backdrop-blur-[1px]">
                  <Loader2 className="h-10 w-10 animate-spin text-green-600 dark:text-green-400 mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    {portfolioUploadProgress
                      ? `Uploading ${portfolioUploadProgress.current} of ${portfolioUploadProgress.total}…`
                      : "Uploading…"}
                  </p>
                </div>
              )}
              <div className="flex flex-col items-center gap-3 pointer-events-none">
                <div className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full bg-muted transition-colors",
                  portfolioFileState.isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/25"
                )}>
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Drop photos here or browse files
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Max 12 images • {formatBytes(10 * 1024 * 1024)} per file • JPG, PNG
                  </p>
                </div>
              </div>
            </div>

            {portfolioItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Photos ({portfolioItems.length}/12)</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPortfolioItems([]);
                      setFormData((prev: any) => ({ ...prev, portfolioImages: [] }));
                      portfolioFileActions.clearFiles();
                    }}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Remove all
                  </Button>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="h-9">Name</TableHead>
                        <TableHead className="h-9 min-w-[180px] w-[42%]">Tags</TableHead>
                        <TableHead className="h-9 w-[80px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolioItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="py-2 ps-2">
                            <div className="flex items-center gap-2">
                              <div className="size-10 shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center">
                                <img
                                  src={item.url.startsWith("http") ? item.url : `${window.location.origin}${item.url}`}
                                  alt=""
                                  className="size-10 object-cover"
                                />
                              </div>
                              <span className="md:hidden text-sm font-medium">
                                {item.name.length > 6 ? `${item.name.slice(0, 6)}...` : item.name}
                              </span>
                              <span className="hidden md:inline text-sm font-medium truncate">{item.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            {item.tag?.trim() ? (
                              <div className="flex items-center gap-1 w-full max-w-[160px]">
                                <Badge variant="secondary" className="text-xs font-medium">
                                  {item.tag.trim()}
                                </Badge>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setPortfolioItems((prev) =>
                                      prev.map((p) => (p.id === item.id ? { ...p, tag: "" } : p))
                                    );
                                    setPortfolioTagDrafts((prev) => ({ ...prev, [item.id]: "" }));
                                  }}
                                  aria-label="Remove tag"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <input
                                type="text"
                                placeholder="e.g. Landscaping (press Enter)"
                                value={portfolioTagDrafts[item.id] ?? ""}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setPortfolioTagDrafts((prev) => ({ ...prev, [item.id]: value }));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const value = (portfolioTagDrafts[item.id] ?? "").trim();
                                    if (value) {
                                      setPortfolioItems((prev) =>
                                        prev.map((p) => (p.id === item.id ? { ...p, tag: value } : p))
                                      );
                                      setPortfolioTagDrafts((prev) => ({ ...prev, [item.id]: "" }));
                                    }
                                  }
                                }}
                                className="h-8 w-full max-w-[140px] rounded-md border border-input bg-background px-2 text-xs"
                              />
                            )}
                          </TableCell>
                          <TableCell className="py-2 pe-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setPortfolioItems((prev) => prev.filter((p) => p.id !== item.id));
                                setFormData((prev: any) => ({
                                  ...prev,
                                  portfolioImages: (prev.portfolioImages || []).filter((u: string) => u !== item.url),
                                }));
                              }}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {portfolioFileState.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {portfolioFileState.errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Hourly Rate - REMOVED */}
        {false && currentStep === 3 && !isTeamMember && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold mb-2">Set your hourly rate</h1>
              <p className="text-muted-foreground">Balance earnings with job availability.</p>
            </div>

            <Card>
              <CardContent className="pt-8 pb-6">
                {/* Large Rate Display */}
                <div className="text-center mb-2">
                  <span className="text-6xl font-bold">${formData.hourlyRate}</span>
                  <span className="text-2xl text-muted-foreground">/hr</span>
                </div>

                {/* Time to First Job - Clean Display */}
                <div className="text-center mb-8">
                  <p className="text-sm text-muted-foreground">Time to first job</p>
                  <p className="text-xl font-semibold">—</p>
                </div>

                {/* Thick Color-Coded Slider with Emojis */}
                <div className="relative mb-4">
                  {/* Slider Track Background with Gradient */}
                  <div 
                    className="h-12 rounded-full relative overflow-hidden"
                    style={{ 
                      background: "linear-gradient(to right, #166534 0%, #22c55e 20%, #84cc16 35%, #eab308 50%, #f97316 70%, #dc2626 85%, #991b1b 100%)" 
                    }}
                  >
                    {/* Emoji indicators inside the track */}
                    <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
                      <span className="text-2xl drop-shadow-lg">💵</span>
                      <span className="text-xl drop-shadow-lg">💰</span>
                      <span className="text-xl drop-shadow-lg">💸</span>
                      <span className="text-2xl drop-shadow-lg">⏳</span>
                    </div>
                  </div>
                  
                  {/* Custom Slider Overlay */}
                  <div className="absolute inset-0">
                    <RateSlider
                      value={formData.hourlyRate}
                      onValueChange={(value) => setFormData({ ...formData, hourlyRate: value })}
                      className="h-12 [&_[role=slider]]:h-10 [&_[role=slider]]:w-10 [&_[role=slider]]:border-4 [&_[role=slider]]:border-white [&_[role=slider]]:shadow-xl [&_[role=slider]]:bg-primary [&>span:first-child]:bg-transparent [&>span:first-child]:h-12"
                    />
                  </div>
                </div>

                {/* Rate Labels */}
                <div className="flex justify-between text-sm font-medium mb-8">
                  <span className="text-green-600">$1/hr</span>
                  <span className="text-red-600">$200/hr</span>
                </div>

                {/* Pro Tip - Start Lower */}
                <div className="flex items-start gap-3 p-4 bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-200 dark:border-green-900">
                  <TrendingUp className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm text-green-800 dark:text-green-300">Pro Tip: Start Lower, Build Your Rep</p>
                    <p className="text-sm text-green-700 dark:text-green-400">Workers who start at $18-22/hr get more jobs, build reviews faster, and earn more overall. You can always raise your rate later!</p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        )}

        {/* Step 4: Invite Friends - REMOVED */}
        {false && currentStep === 4 && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
                <Gift className="w-10 h-10 text-primary" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Earn $100 Per Friend!</h1>
              <p className="text-lg text-muted-foreground">When your buddy makes their first $100 with Tolstoy Staffing, you get a $100 one-time bonus for finding us reliable guys!</p>
            </div>

            {/* Bonus Display */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="text-center mb-4">
                  <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 px-4 py-2 rounded-full mb-4">
                    <DollarSign className="w-5 h-5" />
                    <span className="font-bold text-xl">$100 Bonus</span>
                  </div>
                  <p className="text-sm text-muted-foreground">When they earn their first $100</p>
                </div>
                
                <div className="text-center text-sm text-muted-foreground">
                  <p>No limit! Invite 10 friends = earn up to $1,000</p>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="space-y-4">
              <Button 
                onClick={handleShare}
                className="w-full h-14 text-lg gap-3"
                data-testid="button-share-invite"
              >
                <Share2 className="w-5 h-5" />
                Share with Friends
              </Button>

              <Button 
                variant="outline"
                onClick={copyToClipboard}
                className="w-full h-12 gap-3"
                data-testid="button-copy-link"
              >
                <Copy className="w-5 h-5" />
                Copy Invite Link
              </Button>
            </div>

            {/* How it Works */}
            <div className="space-y-3 pt-4">
              <p className="font-medium text-center">How it works:</p>
              <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">1</div>
                <p className="text-sm">Share your link with friends who do construction work</p>
              </div>
              <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">2</div>
                <p className="text-sm">They sign up and complete jobs</p>
              </div>
              <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">3</div>
                <p className="text-sm">When they hit $100 in earnings, you get $100!</p>
              </div>
            </div>

          </div>
        )}

        {/* Step 5: Portfolio - REMOVED */}
        {false && currentStep === 5 && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
                <Images className="w-10 h-10 text-primary" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Show off your work!</h1>
              <p className="text-muted-foreground">Upload photos of your best projects to attract more clients.</p>
            </div>

            <Card>
              <CardContent className="pt-6">
                <label 
                  className="block border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="font-medium mb-2">Click or drag to upload photos</p>
                  <p className="text-sm text-muted-foreground">Upload up to 12 images (JPG, PNG)</p>
                  <input 
                    ref={portfolioInputRef}
                    type="file" 
                    accept="image/*" 
                    multiple
                    className="hidden"
                    onChange={handlePortfolioUpload}
                  />
                </label>

                {formData.portfolioImages?.length > 0 && (
                  <div className="mt-6">
                    <p className="text-sm font-medium mb-3">{formData.portfolioImages.length}/12 photos uploaded</p>
                    <div className="grid grid-cols-4 gap-3">
                      {formData.portfolioImages.map((img: string, i: number) => (
                        <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={() => removePortfolioImage(i)}
                            className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 p-4 bg-secondary/30 rounded-xl">
                  <p className="text-sm font-medium mb-2">Tips for great photos:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>Show before & after shots</li>
                    <li>Include variety of project types</li>
                    <li>Make sure photos are well-lit</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

          </div>
        )}

        {/* Step 4: Business Operator & Teammates (skippable) */}
        {currentStep === 4 && (
          <div className="space-y-6">
            {step4RoleChoice === null && (
              <>
                <p className="text-base text-gray-900 font-medium text-center">
                  Are you the one doing the work or are you managing a team that does the work?
                </p>
                <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 max-w-2xl mx-auto justify-items-center">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-[200px] w-full max-w-sm p-0 flex flex-col items-stretch text-center rounded-xl border-2 hover:border-primary/50 hover:bg-primary/5 transition-colors overflow-hidden"
                    onClick={() => {
                      setStep4RoleChoice("doing_work");
                      nextStep();
                    }}
                    data-testid="button-doing-work"
                  >
                    <div className="w-full h-24 sm:h-28 flex-shrink-0 bg-muted">
                      <img
                        src="https://corporateweb-v3-corporatewebv3damstrawebassetbuck-1lruglqypgb84.s3-ap-southeast-2.amazonaws.com/public/products-solo-body-2.jpg"
                        alt=""
                        className="w-full h-full object-cover object-center"
                      />
                    </div>
                    <div className="py-4 px-4 flex flex-col gap-1">
                      <span className="font-semibold text-lg">I'm doing the work</span>
                      <span className="text-sm text-muted-foreground">Solo or primary worker</span>
                    </div>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-[200px] w-full max-w-sm p-0 flex flex-col items-stretch text-center rounded-xl border-2 hover:border-primary/50 hover:bg-primary/5 transition-colors overflow-hidden"
                    onClick={() => setStep4RoleChoice("managing_team")}
                    data-testid="button-managing-team"
                  >
                    <div className="w-full h-24 sm:h-28 flex-shrink-0 bg-muted">
                      <img
                        src="https://www.zuper.co/wp-content/uploads/2023/02/63ff262d802b18a12b123490_How-to-Build-and-Maintain-a-Solid-Field-Service-Team-01-2.jpg"
                        alt=""
                        className="w-full h-full object-cover object-center"
                      />
                    </div>
                    <div className="py-4 px-4 flex flex-col gap-1">
                      <span className="font-semibold text-lg">I'm managing a team</span>
                      <span className="text-sm text-muted-foreground">Invite teammates to join</span>
                    </div>
                  </Button>
                </div>
              </>
            )}
            {step4RoleChoice === "managing_team" && (
            <>
            <Card>
              <CardContent className="pt-6">
                {workerInviteStep === 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-medium">Team members</h4>
                      <Button
                        type="button"
                        onClick={() => setWorkerInviteStep(1)}
                        className="shrink-0"
                        data-testid="button-add-teammate"
                      >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Teammate
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Invite teammates one at a time. They'll get an email to join and complete their own profile.</p>
                    <div className="space-y-2">
                      {/* Owner (you) */}
                      {(() => {
                        const ownerFirst = (existingProfile?.firstName ?? formData.firstName ?? (user as { firstName?: string })?.firstName ?? "")?.toString().trim();
                        const ownerLast = (existingProfile?.lastName ?? formData.lastName ?? (user as { lastName?: string })?.lastName ?? "")?.toString().trim();
                        const ownerEmail = (existingProfile?.email ?? formData.email ?? (user as { email?: string })?.email ?? "")?.toString().trim();
                        const ownerInitials = [ownerFirst?.charAt(0), ownerLast?.charAt(0)].filter(Boolean).join("").toUpperCase() || ownerEmail?.charAt(0)?.toUpperCase() || "Y";
                        const ownerAvatarUrl = (existingProfile as { avatarUrl?: string | null })?.avatarUrl ?? formData.avatarUrl ?? avatarPreview;
                        const ownerAvatarSrc = ownerAvatarUrl
                          ? (ownerAvatarUrl.startsWith("data:") || ownerAvatarUrl.startsWith("http"))
                            ? ownerAvatarUrl
                            : `${typeof window !== "undefined" ? window.location.origin : ""}${ownerAvatarUrl}`
                          : null;
                        const ownerDisplayName = [ownerFirst, ownerLast].filter(Boolean).join(" ") || "You";
                        return (
                          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                            <Avatar className="h-9 w-9">
                              {ownerAvatarSrc && <AvatarImage src={ownerAvatarSrc} alt="" />}
                              <AvatarFallback>{ownerInitials}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">{ownerDisplayName}</p>
                              <p className="text-xs text-muted-foreground truncate">{ownerEmail || "—"}</p>
                            </div>
                            <Badge variant="secondary">You</Badge>
                          </div>
                        );
                      })()}
                      {workerTeamMembers.map((member) => (
                        <div key={member.id} className="flex items-center gap-3 p-3 rounded-lg border">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback>{(member.firstName ?? "?").charAt(0)}{(member.lastName ?? "?").charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{member.firstName ?? "—"} {member.lastName ?? "—"}</p>
                            <p className="text-xs text-muted-foreground truncate">{member.email ?? "—"}</p>
                          </div>
                          <Badge variant="outline">{member.status === "pending" ? "Pending" : "Member"}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-medium">Invite team member</h4>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setWorkerInviteStep(0); setWorkerInviteData({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", zipCode: "", latitude: undefined, longitude: undefined, avatarUrl: "" }); }}>Back</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Enter their details. We'll send an invitation email.</p>
                    <div>
                      <Label className="text-muted-foreground">Photo (optional)</Label>
                      <div className="flex items-center gap-3 mt-1.5">
                        <button
                          type="button"
                          onClick={() => teammateAvatarInputRef.current?.click()}
                          className="rounded-full border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/50 transition-colors p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Avatar className="h-14 w-14">
                            {workerInviteData.avatarUrl && <AvatarImage src={workerInviteData.avatarUrl} alt="" />}
                            <AvatarFallback className="text-lg bg-muted">
                              {(workerInviteData.firstName || workerInviteData.lastName)
                                ? `${(workerInviteData.firstName || "?").charAt(0)}${(workerInviteData.lastName || "?").charAt(0)}`.toUpperCase() || "?"
                                : <Camera className="w-6 h-6 text-muted-foreground" />}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                        <div className="text-sm text-muted-foreground">
                          {workerInviteData.avatarUrl ? "Change photo" : "Click to add a face photo"}
                        </div>
                      </div>
                      <input
                        ref={teammateAvatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleTeammateAvatarChange}
                        data-testid="input-teammate-avatar"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>First name</Label>
                        <Input
                          placeholder="John"
                          value={workerInviteData.firstName}
                          onChange={(e) => setWorkerInviteData((p) => ({ ...p, firstName: e.target.value }))}
                          data-testid="input-teammate-firstname"
                        />
                      </div>
                      <div>
                        <Label>Last name</Label>
                        <Input
                          placeholder="Smith"
                          value={workerInviteData.lastName}
                          onChange={(e) => setWorkerInviteData((p) => ({ ...p, lastName: e.target.value }))}
                          data-testid="input-teammate-lastname"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        placeholder="teammate@example.com"
                        value={workerInviteData.email}
                        onChange={(e) => setWorkerInviteData((p) => ({ ...p, email: e.target.value }))}
                        data-testid="input-teammate-email"
                      />
                    </div>
                    <div>
                      <Label>Phone</Label>
                      <Input
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={workerInviteData.phone}
                        onChange={(e) => setWorkerInviteData((p) => ({ ...p, phone: e.target.value }))}
                        data-testid="input-teammate-phone"
                      />
                    </div>
                    <div>
                      <Label>Worker address *</Label>
                      <div className="relative mt-1">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 z-10 pointer-events-none">
                          <MapPin className="w-4 h-4" />
                        </div>
                        <div className="pl-10">
                          <GooglePlacesAutocomplete
                            id="teammate-address-onboarding"
                            label=""
                            value={workerInviteData.address || ""}
                            onChange={(address, components) => {
                              const fromComponents = {
                                city: components.city || workerInviteData.city || "",
                                state: components.state || workerInviteData.state || "",
                                zipCode: components.zipCode || workerInviteData.zipCode || "",
                              };
                              const hasFromPlaces = !!(fromComponents.city && fromComponents.state && fromComponents.zipCode);
                              const parsed = !hasFromPlaces && address ? parseUSAddressLine(address) : null;
                              const lat = typeof components.latitude === "number" ? components.latitude : undefined;
                              const lng = typeof components.longitude === "number" ? components.longitude : undefined;
                              setWorkerInviteData((p) => ({
                                ...p,
                                address: address,
                                city: fromComponents.city || parsed?.city || "",
                                state: fromComponents.state || parsed?.state || "",
                                zipCode: fromComponents.zipCode || parsed?.zipCode || "",
                                ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
                              }));
                            }}
                            placeholder="Enter worker's address (city, state, zip required)"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">Select from the dropdown so we save city, state, and zip.</p>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={() => { setWorkerInviteStep(0); setWorkerInviteData({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", zipCode: "", latitude: undefined, longitude: undefined, avatarUrl: "" }); }} className="flex-1">Cancel</Button>
                      <Button type="button" onClick={handleSendOneTeammateInvite} disabled={inviteSending || !workerInviteData.email?.trim() || !workerInviteData.address?.trim() || !workerInviteData.city?.trim() || !workerInviteData.state?.trim() || !workerInviteData.zipCode?.trim()} className="flex-1" data-testid="button-send-teammate-invite">
                        {inviteSending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : "Send invite"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            </>
            )}
          </div>
        )}

        {/* Step 5: Payout Setup - Bank Account Connected to Mercury */}
        {currentStep === 5 && (
          <div className="space-y-6">
            {!hasFullAddress && !hasBankVerified && (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900">Complete your address first</p>
                  <p className="text-sm text-amber-800 mt-1">Go back to the Location step and select your address from the dropdown so we have your city, state, and zip. Then you can connect your bank here.</p>
                </div>
              </div>
            )}
            {/* Light green clickable banner - How you get paid */}
            <button
              type="button"
              onClick={() => setPayoutInfoOpen(true)}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-green-200 bg-green-50 hover:bg-green-100/80 transition-colors text-left"
              data-testid="button-payout-info-banner"
            >
              <div className="w-10 h-10 rounded-full bg-green-200/80 flex items-center justify-center flex-shrink-0">
                <Info className="w-5 h-5 text-green-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-green-900">How do I get paid?</p>
                <p className="text-sm text-green-800/90">Timesheets, standard vs instant payouts, and fees — learn how payouts work.</p>
              </div>
              <ChevronRight className="w-5 h-5 text-green-700 flex-shrink-0" />
            </button>

            <ResponsiveDialog
              open={payoutInfoOpen}
              onOpenChange={setPayoutInfoOpen}
              title="How you get paid"
              description="Understanding payouts and fees."
              hideDefaultFooter
            >
              <div className="space-y-4">
                    <div className="p-4 rounded-xl border border-green-200 bg-green-50/80 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-200/80 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-green-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-green-900 mb-2">Timesheets</p>
                        <p className="text-sm text-green-800/90 mb-2">Your work turns into pay—here’s the path.</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-green-800/90">
                          <li>You (or your business operator) log your hours in a timesheet after the job.</li>
                          <li>The client reviews and approves it.</li>
                          <li>Once approved, the amount is released and sent to your bank.</li>
                        </ol>
                      </div>
                    </div>
                    <div className="p-4 rounded-xl border border-green-200 bg-green-50/80 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-200/80 flex items-center justify-center flex-shrink-0">
                        <Briefcase className="w-4 h-4 text-green-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-green-900 mb-2">Business operator</p>
                        <p className="text-sm text-green-800/90 mb-2">When you’re on a team, one person runs the money side.</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-green-800/90">
                          <li>The business operator is the team owner who puts the crew on jobs and gets paid by the client.</li>
                          <li>They collect all payments and handle paying teammates.</li>
                          <li>Your payouts flow through them—check the Business operator tab in settings if you’re on a team.</li>
                        </ol>
                      </div>
                    </div>
                    <div className="p-4 rounded-xl border border-green-200 bg-green-50/80 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-200/80 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 text-green-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-green-900 mb-2">Standard payouts</p>
                        <p className="text-sm text-green-800/90 mb-2">Free and steady—no rush, no fee.</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-green-800/90">
                          <li>Standard payouts use free ACH transfers to your bank.</li>
                          <li>Funds usually land in 1–2 business days after the timesheet is approved.</li>
                          <li>Zero fee. Just set it and forget it.</li>
                        </ol>
                      </div>
                    </div>
                    <div className="p-4 rounded-xl border border-green-200 bg-green-50/80 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-200/80 flex items-center justify-center flex-shrink-0">
                        <Zap className="w-4 h-4 text-green-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-green-900 mb-2">Instant payouts</p>
                        <p className="text-sm text-green-800/90 mb-2">Need it now? Turn on instant and get paid same day.</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-green-800/90">
                          <li>Turn on instant payouts in settings or in the options below.</li>
                          <li>Each instant payout has a small fee: 1% of the amount + $0.30.</li>
                          <li>Money hits your bank right away—no waiting 1–2 days.</li>
                        </ol>
                      </div>
                    </div>
              </div>
            </ResponsiveDialog>

            <Card className="mt-0">
              <>
                <div className="p-4 bg-secondary/30 rounded-xl flex items-start gap-3">
                  <Shield className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm mb-1">Secure & Encrypted</p>
                    <p className="text-xs text-muted-foreground">
                      Your banking information is encrypted and securely transmitted. We never store your full account number.
                    </p>
                  </div>
                </div>

                {hasBankVerified ? (
                  <div className="divide-y divide-border p-4 md:p-6">
                    <div className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Account Type</p>
                          <p className="text-base font-medium mt-0.5">
                            {(defaultPayoutAccount?.accountType === "savings" ? "Savings" : "Checking")} account
                          </p>
                        </div>
                      </div>
                      <Badge className="bg-green-100 text-green-700 border-green-200">
                        <Check className="w-3 h-3 mr-1" /> Connected
                      </Badge>
                    </div>
                    <div className="py-4">
                      <p className="text-sm font-medium text-muted-foreground">Account Number</p>
                      <p className="text-base font-medium mt-0.5">****{defaultPayoutAccount?.accountLastFour || bankLastFour || "****"}</p>
                    </div>
                    {defaultPayoutAccount?.bankName && (
                      <div className="py-4">
                        <p className="text-sm font-medium text-muted-foreground">Bank Name</p>
                        <p className="text-base font-medium mt-0.5">{defaultPayoutAccount.bankName}</p>
                      </div>
                    )}
                    <div className="py-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="w-4 h-4 text-green-600" />
                        <span>Payouts will be deposited to this account.</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground pt-2">
                      To update your bank account, go to Account Settings → Bank Account after completing onboarding.
                    </p>
                    {/* Instant payouts - same as PayoutSettings */}
                    <div className="pt-4 mt-4 border-t">
                      <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="font-medium">Instant payouts</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {instantPayoutChecked
                              ? "Fee: 1% + $0.30 per payment"
                              : "Standard: 1–2 business days, no fee"}
                          </p>
                        </div>
                        <Switch
                          checked={instantPayoutChecked}
                          onCheckedChange={(enabled) => {
                            if (existingProfile?.id) {
                              handleInstantPayoutToggle(enabled);
                            } else {
                              setInstantPayoutPreferred(enabled);
                            }
                          }}
                          disabled={existingProfile?.id != null && isUpdating}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                <div className="space-y-4 p-4 md:p-6">
                  <div>
                    <Label htmlFor="bankName" className="text-sm font-medium">Bank Name <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                    <Input
                      id="bankName"
                      value={bankAccount.bankName}
                      onChange={(e) => setBankAccount({ ...bankAccount, bankName: e.target.value })}
                      placeholder="e.g., Chase, Bank of America"
                      className="mt-1.5"
                      disabled={bankConnected}
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
                      disabled={bankConnected}
                      className={`mt-1.5 ${bankErrors.routingNumber ? "border-destructive" : ""}`}
                      data-testid="input-routing-number"
                    />
                    {bankErrors.routingNumber && (
                      <p className="text-xs text-destructive mt-1">{bankErrors.routingNumber}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">Found at the bottom left of your check</p>
                    {showClientDevTools() && (
                      <p className="text-xs text-muted-foreground mt-0.5">Dev: use <strong>123456789</strong> to test without Mercury. Sandbox: <strong>021000021</strong> (Chase).</p>
                    )}
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
                      disabled={bankConnected}
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
                      disabled={bankConnected}
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
                      disabled={bankConnected}
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="checking" id="checking" data-testid="radio-checking" disabled={bankConnected} />
                        <Label htmlFor="checking" className="cursor-pointer">Checking</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="savings" id="savings" data-testid="radio-savings" disabled={bankConnected} />
                        <Label htmlFor="savings" className="cursor-pointer">Savings</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  {/* Recipient type is always "business"; selector hidden per product */}

                  {/* Instant payouts toggle - always visible; uses profile when saved, else local state */}
                  <div className="space-y-3 pt-2 border-t">
                    <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="font-medium">Instant payouts</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {instantPayoutChecked
                            ? "Fee: 1% + $0.30 per payment"
                            : "Standard: 1–2 business days, no fee"}
                        </p>
                      </div>
                      <Switch
                        checked={instantPayoutChecked}
                        onCheckedChange={(enabled) => {
                          if (existingProfile?.id) {
                            handleInstantPayoutToggle(enabled);
                          } else {
                            setInstantPayoutPreferred(enabled);
                          }
                        }}
                        disabled={existingProfile?.id != null && isUpdating}
                      />
                    </div>
                    {instantPayoutChecked && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-sm text-blue-800">
                          Instant payouts are on. A fee of 1% + $0.30 will be deducted from each instant payment.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                )}
              </>
            </Card>

            {!hasBankVerified && (
              <p className="text-sm text-muted-foreground text-center">
                <AlertCircle className="w-4 h-4 inline mr-1" />
                You must verify a bank account to receive payouts
              </p>
            )}
          </div>
        )}

        {/* Step 6: W-9 Form Upload */}
        {currentStep === 6 && (
          <div className="space-y-6">
            <Card>
              <>
                <div className="p-4 bg-secondary/30 rounded-xl flex items-start gap-3">
                  <Shield className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm mb-1">About your W-9</p>
                    <p className="text-xs text-muted-foreground">
                      W-9 is optional for onboarding. You can add it later in Account Settings. It helps report earnings to the IRS and avoid backup withholding.
                    </p>
                  </div>
                </div>

                {w9StatusLoading ? (
                  <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Checking W-9 status with Mercury…</p>
                  </div>
                ) : w9StatusError ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Couldn’t verify W-9 with Mercury</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Check timed out or network error. You can still upload your W-9; use Retry to check again.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => refetchW9Status()}>
                      Retry
                    </Button>
                  </div>
                ) : w9Status?.attached ? (
                  <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <div className="flex-1">
                      <p className="font-medium text-green-900">W-9 on File</p>
                      <p className="text-sm text-green-700">Your W-9 is verified with your Mercury account and will be used for tax reporting and payouts.</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 md:p-6">
                    {existingProfile?.w9UploadedAt && !w9Status?.attached && (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                        Your W-9 is not yet attached to your Mercury account. Upload again to attach it for tax reporting and payouts.
                      </p>
                    )}
                    <Label htmlFor="w9-upload" className="text-sm font-medium mb-3 block">
                      W-9 Form <span className="text-muted-foreground font-normal">(Optional)</span>
                    </Label>
                    <input
                      id="w9-upload"
                      type="file"
                      accept=".pdf,image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                          const base64Data = ev.target?.result as string;
                          if (!base64Data) return;

                          if (!user || !existingProfile) {
                            localStorage.setItem(PENDING_W9_STORAGE_KEY, base64Data);
                            safeToast({
                              title: "W-9 saved",
                              description: "We'll attach it automatically once your profile is created.",
                            });
                            nextStep();
                            return;
                          }
                          
                          try {
                            await updateProfile({
                              id: existingProfile.id,
                              data: { w9DocumentUrl: base64Data, w9UploadedAt: new Date() },
                              skipToast: true,
                            });
                            invalidateSessionProfileQueries(queryClient);
                            await queryClient.invalidateQueries({ queryKey: ["/api/worker/w9-status"] });
                            safeToast({
                              title: "W-9 uploaded",
                              description: "Your W-9 was attached to Mercury successfully. Proceeding to next step.",
                            });
                            nextStep();
                          } catch (error: any) {
                            safeToast({
                              title: "Upload failed",
                              description: error?.message || "Failed to attach W-9 to Mercury. Please try again.",
                              variant: "destructive"
                            });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                      data-testid="input-w9-upload"
                    />
                    <label htmlFor="w9-upload">
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                        <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                        <p className="font-medium mb-1">Click to upload W-9</p>
                        <p className="text-xs text-muted-foreground">PDF or image file</p>
                      </div>
                    </label>
                  </div>
                )}
              </>
            </Card>
          </div>
        )}

        {/* Step 7: Contract - uses full main scroll area (one scroll, no inner max-height) */}
        {currentStep === 7 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-200">
              <div className="h-1.5 bg-gray-800" />
              <div className="p-6 md:p-8">
                <div className="max-w-none text-stone-900" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                  <pre className="whitespace-pre-wrap text-sm md:text-base leading-relaxed" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#1c1917" }}>
                    {CONTRACT_TEXT}
                  </pre>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800" />
            </div>
          </div>
        )}

            </div>
          </div>

          {/* Bottom Navigation Bar - progress bar at absolute top of footer (container outline), then 35/65 back/next */}
          <footer className={`border-t border-gray-200 shrink-0 flex flex-col ${currentStep === 7 ? "bg-transparent" : "bg-white"} ${isMobile && currentStep >= 1 && currentStep <= 7 ? "sticky bottom-0 left-0 right-0 z-40 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pt-0" : "pt-4 md:pt-6"} pb-6 md:pb-4 ${isMobile && currentStep >= 1 && currentStep <= 7 ? "" : "px-4 md:px-6"}`}>
            {isMobile && currentStep >= 1 && currentStep <= 7 && (
              <div className="flex h-1 w-full bg-muted overflow-hidden rounded-none shrink-0" aria-hidden>
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${onboardingProgressPercent}%` }}
                />
              </div>
            )}
            <div className={`max-w-3xl mx-auto w-full flex flex-col gap-0 ${isMobile && currentStep >= 1 && currentStep <= 7 ? "px-4 md:px-6 pt-4" : ""} ${isMobile && currentStep >= 1 && currentStep <= 7 ? "" : "md:pt-0"}`}>
              <div className={`flex items-center gap-2 w-full ${isMobile ? "flex-row" : "flex-row justify-between gap-4"}`}>
                {isMobile ? (
                  <>
                    <Button
                      variant="ghost"
                      className="h-12 text-muted-foreground rounded-xl border-0 shadow-none"
                      style={{ width: "35%", flexShrink: 0 }}
                      onClick={prevStep}
                      type="button"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Back
                    </Button>
                    {currentStep === 1 && (
                      <Button
                        onClick={handleStep1Next}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0 bg-gray-900 text-white hover:bg-gray-800"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={
                          !faceVerified ||
                          !formData.firstName ||
                          !formData.lastName ||
                          !formData.email ||
                          !formData.phone ||
                          (!isAuthenticated && !isGoogleAuth && (!formData.password || !formData.confirmPassword)) ||
                          isCreating ||
                          isUpdating ||
                          isRegistering
                        }
                        data-testid="button-next-step-footer"
                      >
                        {isCreating || isUpdating || isRegistering ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                        ) : (
                          "Next"
                        )}
                      </Button>
                    )}
                    {currentStep === 2 && showIdVerificationMiniStep && (
                      <Button
                        onClick={() => setShowIdVerificationMiniStep(false)}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0"
                        style={{ width: "65%", flexShrink: 0 }}
                        data-testid="button-skip-id-verification"
                      >
                        Skip
                      </Button>
                    )}
                    {currentStep === 2 && !showIdVerificationMiniStep && (
                      <Button
                        onClick={nextStep}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={!formData.address?.trim()}
                        data-testid="button-next-step-footer"
                      >
                        Next
                      </Button>
                    )}
                    {currentStep === 3 && step3SubStep === "rate" && (
                      <Button
                        onClick={nextStep}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0 bg-gray-900 text-white hover:bg-gray-800"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={formData.hourlyRate == null || formData.hourlyRate < 1 || formData.hourlyRate > 200}
                        data-testid="button-next-step-footer"
                      >
                        Next
                      </Button>
                    )}
                    {currentStep === 3 && step3SubStep === "categories" && (
                      <Button
                        onClick={nextStep}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={!formData.serviceCategories?.length || formData.serviceCategories.length === 0}
                        data-testid="button-next-step-footer"
                      >
                        Next
                      </Button>
                    )}
                    {currentStep === 3 && step3SubStep === "portfolio" && (
                      <Button
                        onClick={nextStep}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0"
                        style={{ width: "65%", flexShrink: 0 }}
                        data-testid="button-next-step-footer"
                      >
                        {portfolioItems.length > 0 ? "Continue" : "Skip"}
                      </Button>
                    )}
                    {currentStep === 4 && step4RoleChoice === "managing_team" && (
                      <Button
                        onClick={handleSendTeammateInvites}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0 bg-gray-900 text-white hover:bg-gray-800"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={inviteSending}
                        data-testid="button-next-step-footer"
                      >
                        {inviteSending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                        ) : workerTeamMembers.length > 0 ? (
                          "Continue"
                        ) : (
                          "Skip"
                        )}
                      </Button>
                    )}
                    {currentStep === 5 && (
                      <Button
                        onClick={hasBankVerified ? nextStep : handleConnectBank}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0 bg-gray-900 text-white hover:bg-gray-800"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={hasBankVerified ? false : !hasFullAddress || connectBankMutation.isPending}
                        data-testid={hasBankVerified ? "button-next-step-footer" : "button-connect-bank"}
                      >
                        {connectBankMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</>
                        ) : hasBankVerified ? (
                          "Next"
                        ) : (
                          <><CreditCard className="w-4 h-4 mr-2" />Verify Bank Account</>
                        )}
                      </Button>
                    )}
                    {currentStep === 6 && (
                      <Button
                        onClick={nextStep}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0"
                        style={{ width: "65%", flexShrink: 0 }}
                        data-testid="button-next-step-footer"
                      >
                        {w9Status?.attached ? "Continue" : "Skip"}
                      </Button>
                    )}
                    {currentStep === 7 && (
                      <Button
                        onClick={() => handleCompleteOnboarding([formData.firstName, formData.lastName].filter(Boolean).join(" ") || undefined)}
                        className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0 bg-gray-900 text-white hover:bg-gray-800"
                        style={{ width: "65%", flexShrink: 0 }}
                        disabled={isCreating || isUpdating || isRegistering || !formData.firstName?.trim() || !formData.lastName?.trim()}
                        data-testid="button-complete-onboarding"
                      >
                        {isRegistering || isCreating || isUpdating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {isRegistering ? "Creating Account..." : "Saving..."}
                          </>
                        ) : (
                          "Acknowledge"
                        )}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                {currentStep >= 1 && (
                  <Button
                    variant="ghost"
                    onClick={prevStep}
                    className="h-10 text-muted-foreground border-0 shadow-none shrink-0"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Back
                  </Button>
                )}
              {currentStep === 1 && (
                <Button 
                  onClick={handleStep1Next} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={
                    !faceVerified ||
                    !formData.firstName ||
                    !formData.lastName ||
                    !formData.email ||
                    !formData.phone ||
                    (!isAuthenticated && !isGoogleAuth && (!formData.password || !formData.confirmPassword)) ||
                    isCreating ||
                    isUpdating ||
                    isRegistering
                  }
                  data-testid="button-next-step-footer"
                >
                  {isCreating || isUpdating || isRegistering ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                  ) : (
                    "Next"
                  )}
                </Button>
              )}
              {currentStep === 2 && showIdVerificationMiniStep && (
                <Button 
                  onClick={() => setShowIdVerificationMiniStep(false)} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  data-testid="button-skip-id-verification"
                >
                  Skip
                </Button>
              )}
              {currentStep === 2 && !showIdVerificationMiniStep && (
                <Button 
                  onClick={nextStep} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={!formData.address?.trim()}
                  data-testid="button-next-step-footer"
                >
                  Next
                </Button>
              )}
              {currentStep === 3 && step3SubStep === "rate" && (
                <Button 
                  onClick={nextStep} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={formData.hourlyRate == null || formData.hourlyRate < 1 || formData.hourlyRate > 200}
                  data-testid="button-next-step-footer"
                >
                  Next
                </Button>
              )}
              {currentStep === 3 && step3SubStep === "categories" && (
                <Button 
                  onClick={nextStep} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={!formData.serviceCategories?.length || formData.serviceCategories.length === 0}
                  data-testid="button-next-step-footer"
                >
                  Next
                </Button>
              )}
              {currentStep === 3 && step3SubStep === "portfolio" && (
                <Button 
                  onClick={nextStep} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  data-testid="button-next-step-footer"
                >
                  {portfolioItems.length > 0 ? "Continue" : "Skip"}
                </Button>
              )}
              {currentStep === 4 && step4RoleChoice === "managing_team" && (
                <Button 
                  onClick={handleSendTeammateInvites} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={inviteSending}
                  data-testid="button-next-step-footer"
                >
                  {inviteSending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                  ) : workerTeamMembers.length > 0 ? (
                    "Continue"
                  ) : (
                    "Skip"
                  )}
                </Button>
              )}
              {currentStep === 5 && (
                <Button 
                  onClick={hasBankVerified ? nextStep : handleConnectBank} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={hasBankVerified ? false : !hasFullAddress || connectBankMutation.isPending}
                  data-testid={hasBankVerified ? "button-next-step-footer" : "button-connect-bank"}
                >
                  {connectBankMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</>
                  ) : hasBankVerified ? (
                    "Next"
                  ) : (
                    <><CreditCard className="w-4 h-4 mr-2" />Verify Bank Account</>
                  )}
                </Button>
              )}
              {currentStep === 6 && (
                <Button 
                  onClick={nextStep} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  data-testid="button-next-step-footer"
                >
                  {w9Status?.attached ? "Continue" : "Skip"}
                </Button>
              )}
              {currentStep === 7 && (
                <Button 
                  onClick={() => handleCompleteOnboarding([formData.firstName, formData.lastName].filter(Boolean).join(" ") || undefined)} 
                  className="h-11 min-w-64 px-8 bg-gray-900 text-white hover:bg-gray-800"
                  disabled={isCreating || isUpdating || isRegistering || !formData.firstName?.trim() || !formData.lastName?.trim()}
                  data-testid="button-complete-onboarding"
                >
                  {isRegistering || isCreating || isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isRegistering ? "Creating Account..." : "Saving..."}
                    </>
                  ) : (
                    "Acknowledge"
                  )}
                </Button>
              )}
                  </>
                )}
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
