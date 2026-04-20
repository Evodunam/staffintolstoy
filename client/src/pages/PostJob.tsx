import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { Navigation } from "@/components/Navigation";
import { AnimatedNavigationTabs } from "@/components/ui/animated-navigation-tabs";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import confetti from "canvas-confetti";
import type { CompanyLocation } from "@shared/schema";
import { 
  Loader2, ArrowRight, ArrowLeft, MapPin, Plus, Minus, Check, 
  AlertCircle, Sparkles, DollarSign, Image as ImageIcon, Video, Trash2,
  Briefcase, Calendar, X, Mic, Users, User, CreditCard, Building2, Phone, Mail, Send, Star,
  ShieldCheck,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardHat, Wrench, Hammer, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { INDUSTRY_CATEGORIES, getAllRoles, type IndustryRole } from "@shared/industries";
import {
  computeBillableWorkerHours,
  hoursBetweenTimes,
  minimumLaborBudgetCentsForWorkerHours,
} from "@shared/postJobBillableHours";
import { PLATFORM_MIN_JOB_BUDGET_HOURLY_USD } from "@shared/platformPayPolicy";
import {
  computeAppliedSuggestedBudgetUsd,
  suggestPlanningHourlyUsd,
} from "@shared/suggestedBudgetPlanning";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar as DateCalendar } from "@/components/ui/calendar";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { OnDemandScheduleMultiStep } from "@/components/OnDemandScheduleMultiStep";
import { EeocFeedback } from "@/components/EeocFeedback";
import { OneDayScheduleMultiStep } from "@/components/OneDayScheduleMultiStep";
import { RecurringScheduleMultiStep } from "@/components/RecurringScheduleMultiStep";
import { MonthlyScheduleMultiStep } from "@/components/MonthlyScheduleMultiStep";
import { useTranslation } from "react-i18next";
import { cn, parseLocalDate, getTimeSlots, getValidEndTimeSlots, getEarliestEndTime, formatTime12h, isValidScheduleTime } from "@/lib/utils";
import {
  usePostJobDraft,
  clearStoredDraft,
  getStoredDraft,
  type PostJobDraft,
} from "@/hooks/use-post-job-draft";
import {
  isSubstantivePostJobFormState,
  isSubstantiveStoredDraft,
  isDraftLocationAllowedForVisibleLocations,
} from "@/lib/post-job-draft";

// Use shared industries for all skill categories
const allSkillCategories = getAllRoles();
const ROLE_LABEL_BY_ID = new Map(allSkillCategories.map((r) => [r.id, r.label]));

// Keywords for sophisticated skillset matching from description
const SKILLSET_KEYWORDS: Record<string, string[]> = {
  // Construction
  "Laborer": ["labor", "helper", "assist", "move", "lift", "carry", "load", "unload", "organize", "setup", "cleanup", "support", "furniture", "assembly", "demolition", "demo", "moving"],
  "Landscaping": ["landscaping", "lawn", "grass", "tree", "shrub", "mulch", "garden", "irrigation", "sprinkler", "mowing", "trimming", "planting", "outdoor"],
  "Painting": ["paint", "painting", "primer", "coat", "brush", "roller", "spray", "stain", "finish", "interior", "exterior", "sanding", "prep", "touch-up"],
  "Drywall": ["drywall", "sheetrock", "gypsum", "wall", "ceiling", "patch", "tape", "mud", "texture", "finish", "board", "hanging"],
  "Concrete": ["concrete", "cement", "pour", "slab", "foundation", "sidewalk", "driveway", "patio", "rebar", "form", "finish", "masonry", "brick", "block"],
  "Carpentry Lite": ["carpentry", "wood", "trim", "molding", "door", "frame", "framing", "walls", "stairs", "carpenter"],
  "Carpentry Elite": ["carpentry", "structure", "home", "building", "complex", "deck", "fence", "cabinet", "joinery", "woodwork"],
  "Electrical Lite": ["electrical", "outlet", "switch", "ceiling fan", "fixture", "light", "lighting", "receptacle"],
  "Electrical Elite": ["electrical", "wire", "wiring", "circuit", "breaker", "panel", "voltage", "power", "conduit", "electrician", "amperage", "junction", "home wiring"],
  "Plumbing Lite": ["plumbing", "faucet", "toilet", "sink", "repair", "leak", "valve", "plumber"],
  "Plumbing Elite": ["plumbing", "pipe", "drain", "water", "sewage", "plumber", "bathroom", "kitchen", "copper", "pvc", "fitting", "install", "remodel", "remodeling"],
  "HVAC Lite": ["hvac", "repair", "heating", "cooling", "thermostat", "existing"],
  "HVAC Elite": ["hvac", "air conditioning", "ac", "furnace", "duct", "ductwork", "ventilation", "compressor", "refrigerant", "heat pump", "split system", "minisplit", "install"],
  // Manufacturing & Logistics
  "Assembly Line Worker": ["assembly", "production", "line", "manufacturing", "factory", "worker"],
  "Forklift Operator": ["forklift", "operator", "warehouse", "material", "handling", "pallet", "lift"],
  "Warehouse Associate": ["warehouse", "picking", "packing", "inventory", "shipping", "receiving", "stock"],
  "Supply Chain Coordinator": ["supply chain", "logistics", "coordinator", "shipping", "distribution"],
  // Retail
  "Sales Associate": ["sales", "retail", "customer", "service", "cashier", "store", "shop"],
  "Inventory Specialist": ["inventory", "stock", "count", "management", "merchandise"],
  "Store Supervisor": ["supervisor", "manager", "retail", "store", "team", "lead"],
  // Housekeeping
  "Housekeeper": ["housekeeping", "housekeeper", "cleaning", "cleaner", "cleaners", "room", "turnover", "maid", "hotel", "home", "house", "residential"],
  "Laundry Staff": ["laundry", "linen", "wash", "fold", "dry cleaning"],
  "Janitorial Staff": ["janitor", "janitorial", "cleaning", "facility", "maintenance", "custodian"],
  // Event Planning
  "Event Coordinator": ["event", "coordinator", "planner", "planning", "function", "party"],
  "Banquet Server": ["banquet", "server", "catering", "food", "beverage", "waiter", "waitress"],
  "Setup Crew": ["setup", "teardown", "crew", "event", "equipment", "breakdown"],
  "AV Technician": ["av", "audio", "visual", "technician", "sound", "lighting", "projection"],
  // Management & Administration
  "Site Manager": ["manager", "site", "hotel", "facility", "property"],
  "Supervisor": ["supervisor", "team", "lead", "oversee", "manage"],
  "Office Admin": ["admin", "administrative", "office", "secretary", "scheduling", "documentation"],
  "HR Coordinator": ["hr", "human resources", "coordinator", "recruiting", "onboarding"],
};

/** Wizard: 1 job+location, 2 schedule, 3 budget & auto-fulfill, 4 review */
const TOTAL_STEPS = 4;

type ShiftType = "on-demand" | "one-day" | "recurring" | "monthly";

const SHIFT_TYPE_INFO: Record<ShiftType, { title: string; description: string; recommended?: boolean }> = {
  "on-demand": {
    title: "On-Demand (ASAP)",
    description: "Workers arrive within hours and work until the task is complete. Best for urgent needs.",
    recommended: true
  },
  "one-day": {
    title: "One-Day Shift",
    description: "Schedule workers for a specific date and time range. Best for planned single-day projects."
  },
  "recurring": {
    title: "Recurring Shifts",
    description: "Set up a weekly schedule for ongoing projects. Best for multi-week projects."
  },
  "monthly": {
    title: "Monthly",
    description: "Schedule repeats monthly on selected days of the week. Best for ongoing monthly needs (up to 12 months)."
  }
};

const DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const baseHourlyRate = 25;
/** Suggested total budget when entering step 3: schedule floor + 10% (whole dollars). */
const POST_JOB_BUDGET_DEFAULT_BUFFER = 1.1;

interface Location {
  id?: number;
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
  selectedPhoneOption: "company" | "alt" | "custom" | "team";
  paymentMethodId?: number | null;
}

interface MediaPreview {
  url: string; // Preview blob URL for display
  permanentUrl: string; // Permanent object storage URL for saving
  type: "image" | "video";
  file: File;
  uploading?: boolean;
  uploadError?: string;
}

export default function PostJob() {
  const { t } = useTranslation("postJob");
  const { t: tNav } = useTranslation();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(isAuthenticated ? user?.id : undefined);
  const { toast } = useToast();

  // Parse query params for direct request mode and new job (start fresh, discard draft)
  const searchParams = new URLSearchParams(window.location.search);
  const isDirectRequest = searchParams.get("directRequest") === "true";
  const isNewJob = searchParams.get("new") === "1";
  const isRepostFromCancellation = searchParams.get("repost") === "1";
  const repostSourceJobId = Number(searchParams.get("sourceJobId") || "");
  const directRequestWorkerId = searchParams.get("workerId");
  const directRequestWorkerName = searchParams.get("workerName");
  const directRequestWorkerRate = searchParams.get("workerRate");
  const fallbackToPublic = searchParams.get("fallback") !== "false"; // Default to true

  const didApplyRepostPrefillRef = useRef(false);

  const { data: repostSourceJob } = useQuery<any>({
    queryKey: ["/api/jobs", repostSourceJobId, "repost-source"],
    enabled: isRepostFromCancellation && Number.isFinite(repostSourceJobId) && repostSourceJobId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${repostSourceJobId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load source job for repost");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: companyLocations = [], isLoading: locationsLoading } = useQuery<CompanyLocation[]>({
    queryKey: ['/api/locations'],
    enabled: !!profile && profile.role === 'company',
  });

  // Fetch payment methods to show which payment method is assigned to each location
  const { data: paymentMethods = [] } = useQuery<any[]>({
    queryKey: ['/api/company/payment-methods'],
    enabled: !!profile && profile.role === 'company',
  });

  // Fetch company's past jobs to infer hiring preferences
  const { data: companyJobs = [] } = useQuery<any[]>({
    queryKey: ['/api/company/jobs'],
    enabled: !!profile && profile.role === 'company',
  });

  const getPaymentMethodForLocation = (locationId: number): { bankName: string; lastFour: string } | null => {
    // First check for a payment method specifically assigned to this location
    const specificMethod = paymentMethods.find(pm => 
      pm.locationIds && pm.locationIds.includes(locationId.toString())
    );
    if (specificMethod) {
      return { bankName: specificMethod.bankName, lastFour: specificMethod.lastFour };
    }
    // Fall back to primary payment method
    const primaryMethod = paymentMethods.find(pm => pm.isPrimary);
    if (primaryMethod) {
      return { bankName: primaryMethod.bankName, lastFour: primaryMethod.lastFour };
    }
    return null;
  };

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [locationListExpanded, setLocationListExpanded] = useState(false);

  // Pre-select location when company has only 1
  useEffect(() => {
    if (companyLocations.length === 1 && selectedLocationId === null) {
      setSelectedLocationId(companyLocations[0].id);
    }
  }, [companyLocations, selectedLocationId]);

  const [showLocationPopup, setShowLocationPopup] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [addLocationStep, setAddLocationStep] = useState(1);
  const [showCustomContactPopup, setShowCustomContactPopup] = useState(false);
  const [showAddTeamMemberPopup, setShowAddTeamMemberPopup] = useState(false);
  const [newTeamMemberData, setNewTeamMemberData] = useState({ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", role: "manager" as "admin" | "manager" | "viewer" });
  const [newLocation, setNewLocation] = useState<Location>({ 
    name: "", address: "", address2: "", city: "", state: "", zipCode: "",
    useCompanyDefault: true, contactName: "", contactPhone: "", contactEmail: "", contactAltPhone: "",
    representativeTeamMemberId: null, selectedPhoneOption: "company", paymentMethodId: null
  });
  
  // Fetch team members for contact representative selection
  const { data: teamMembers = [] } = useQuery<any[]>({
    queryKey: ['/api/company/team'],
    enabled: !!profile && profile.role === 'company',
  });

  const createTeamInvite = useMutation({
    mutationFn: async (data: { email: string; role: string; firstName?: string; lastName?: string; phone?: string; jobPosition?: string }) => {
      const res = await apiRequest("POST", "/api/team-invites", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
      setShowAddTeamMemberPopup(false);
      setNewTeamMemberData({ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", role: "manager" });
      toast({ title: "Success", description: "Invitation sent successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to send invite", variant: "destructive" });
    },
  });
  
  // Extract alternate phones from profile if available
  const alternatePhones = profile?.alternatePhones || [];

  const [jobDescription, setJobDescription] = useState("");
  const [aiCategories, setAiCategories] = useState<string[]>([]);
  const [selectedSkillsets, setSelectedSkillsets] = useState<string[]>([]);
  const [analyzingJob, setAnalyzingJob] = useState(false);
  const [mediaPreviews, setMediaPreviews] = useState<MediaPreview[]>([]);
  const [showSkillsetDropdown, setShowSkillsetDropdown] = useState(false);
  const [showSelectedSkillsetsOnly, setShowSelectedSkillsetsOnly] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);

  // Get company's preferred categories from their profile or job history
  const getCompanyPreferredCategories = (): string[] => {
    if (!profile) return [];
    
    // Get roles from company's selected industries (if stored in profile)
    // For now, we'll check their job history to infer preferences
    // In the future, this could be stored in profile.hiringIndustries or similar
    const preferredCategories: string[] = [];
    
    // If company has posted jobs before, get their commonly used categories
    if (companyJobs && companyJobs.length > 0) {
      const categoryCounts: Record<string, number> = {};
      companyJobs.forEach((job: any) => {
        if (job.trade) {
          categoryCounts[job.trade] = (categoryCounts[job.trade] || 0) + 1;
        }
        if (job.serviceCategory) {
          categoryCounts[job.serviceCategory] = (categoryCounts[job.serviceCategory] || 0) + 1;
        }
      });
      
      // Get top 10 most used categories (more to have better coverage)
      const sortedCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([category]) => category);
      
      preferredCategories.push(...sortedCategories);
    }
    
    return preferredCategories;
  };
  
  // Map industry roles to skill names for better matching
  const getRolesFromIndustries = (industryIds: string[]): string[] => {
    const roles: string[] = [];
    INDUSTRY_CATEGORIES.forEach(industry => {
      if (industryIds.includes(industry.id)) {
        industry.roles.forEach(role => {
          roles.push(role.id);
        });
      }
    });
    return roles;
  };

  // Sophisticated skillset matching from description text with company preference prioritization
  const analyzeDescriptionForSkillsets = (text: string): string[] => {
    const lowerText = text.toLowerCase();
    const matchedSkills: { skill: string; score: number }[] = [];
    const companyPreferredCategories = getCompanyPreferredCategories();
    
    // Get all roles from company's selected industries
    const companyPreferredRoles: string[] = [];
    if (profile) {
      // Check if profile has hiringIndustries or similar field
      // For now, we'll use the preferred categories from job history
      companyPreferredRoles.push(...companyPreferredCategories);
      
      // Also map industry IDs to their roles if we have that data
      // This would require storing selectedIndustries in the profile
      // If profile has a hiringIndustries field, use it:
      // if (profile.hiringIndustries) {
      //   companyPreferredRoles.push(...getRolesFromIndustries(profile.hiringIndustries));
      // }
    }
    
    for (const [skill, keywords] of Object.entries(SKILLSET_KEYWORDS)) {
      let score = 0;
      let hasMatch = false;
      
      for (const keyword of keywords) {
        // Check for exact word match or phrase match
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) {
          score += matches.length;
          hasMatch = true;
        }
      }
      
      // Boost score if this skill matches company's preferred categories
      if (companyPreferredRoles.length > 0 && hasMatch) {
        const skillMatches = companyPreferredRoles.some(pref => {
          const prefLower = pref.toLowerCase();
          const skillLower = skill.toLowerCase();
          return skillLower === prefLower || 
                 skillLower.includes(prefLower) || 
                 prefLower.includes(skillLower) ||
                 // Also check for partial matches (e.g., "Plumbing Elite" matches "Plumbing")
                 skillLower.split(' ').some(word => word === prefLower) ||
                 prefLower.split(' ').some(word => word === skillLower);
        });
        if (skillMatches) {
          score *= 2.5; // Boost preferred categories significantly
        }
      }
      
      if (score > 0) {
        matchedSkills.push({ skill, score });
      }
    }
    
    // Sort by score and return top matches (prioritize company preferences)
    matchedSkills.sort((a, b) => {
      // If scores are close (within 20%), prefer company preferred categories
      if (Math.abs(a.score - b.score) / Math.max(a.score, b.score) < 0.2) {
        const aIsPreferred = companyPreferredRoles.some(pref => 
          a.skill.toLowerCase().includes(pref.toLowerCase()) || 
          pref.toLowerCase().includes(a.skill.toLowerCase())
        );
        const bIsPreferred = companyPreferredRoles.some(pref => 
          b.skill.toLowerCase().includes(pref.toLowerCase()) || 
          pref.toLowerCase().includes(b.skill.toLowerCase())
        );
        if (aIsPreferred && !bIsPreferred) return -1;
        if (!aIsPreferred && bIsPreferred) return 1;
      }
      return b.score - a.score;
    });
    
    return matchedSkills.slice(0, 3).map(m => m.skill);
  };

  /** Infer schedule hints from job description (workers, shift type, start time, recurring days) */
  const analyzeDescriptionForSchedule = (text: string) => {
    const lower = text.toLowerCase();
    const result: {
      shiftType?: "on-demand" | "one-day" | "recurring";
      workers?: number;
      startTime?: string;
      startDate?: string;
      recurringDays?: string[];
      weeks?: number;
    } = {};

    // Workers: "2 workers", "3 people", "crew of 4", "team of 5"
    const workerMatch = lower.match(/\b(\d+)\s*(?:worker|workers|people|person|crew|team)\b/i)
      || lower.match(/\b(?:crew|team)\s+of\s+(\d+)\b/i);
    if (workerMatch) {
      const n = parseInt(workerMatch[1], 10);
      if (n >= 1 && n <= 50) result.workers = n;
    }

    // Shift type: one-day hints
    const oneDayHints = /\b(?:one\s*day|single\s*day|one\s*time|one\s*off|just\s+(?:for\s+)?(?:tomorrow|today)|specific\s+date)\b/i;
    // Recurring hints
    const recurringHints = /\b(?:weekly|recurring|every\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|day)|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|weekends?|ongoing|multi\s*week|several\s*weeks?|for\s+\d+\s*weeks?)\b/i;
    if (recurringHints.test(lower) && !oneDayHints.test(lower)) {
      result.shiftType = "recurring";
      // Extract days
      const days: string[] = [];
      if (/\bmonday|mon\b/i.test(lower)) days.push("monday");
      if (/\btuesday|tue\b/i.test(lower)) days.push("tuesday");
      if (/\bwednesday|wed\b/i.test(lower)) days.push("wednesday");
      if (/\bthursday|thu\b/i.test(lower)) days.push("thursday");
      if (/\bfriday|fri\b/i.test(lower)) days.push("friday");
      if (/\bsaturday|sat\b/i.test(lower)) days.push("saturday");
      if (/\bsunday|sun\b/i.test(lower)) days.push("sunday");
      if (/\bweekdays?\b/i.test(lower) && days.length === 0)
        days.push("monday", "tuesday", "wednesday", "thursday", "friday");
      if (days.length > 0) result.recurringDays = days;
      const weeksMatch = lower.match(/(\d+)\s*weeks?/i);
      if (weeksMatch) result.weeks = Math.min(52, Math.max(1, parseInt(weeksMatch[1], 10)));
    } else if (oneDayHints.test(lower)) {
      result.shiftType = "one-day";
    } else {
      result.shiftType = "on-demand";
    }

    // Start time: 9am, 9:00, morning (9), afternoon (14)
    const time9 = /\b(?:9\s*(?:am|a\.m\.)|9:00|nine\s*am|morning)\b/i;
    const time8 = /\b(?:8\s*(?:am|a\.m\.)|8:00|eight\s*am)\b/i;
    const time14 = /\b(?:2\s*(?:pm|p\.m\.)|14:00|afternoon)\b/i;
    if (time9.test(lower)) result.startTime = "09:00";
    else if (time8.test(lower)) result.startTime = "08:00";
    else if (time14.test(lower)) result.startTime = "14:00";

    // Start date: tomorrow is default (+1 day)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    result.startDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    return result;
  };

  // Auto-generate job titles based on location and skillsets
  const selectedLocation = companyLocations.find(loc => loc.id === selectedLocationId);
  
  // AI-generated title state (must be declared before useMemo that uses it)
  const [aiGeneratedTitle, setAiGeneratedTitle] = useState<string | null>(null);
  
  const generateCompanyTitle = useMemo(() => {
    if (selectedSkillsets.length === 0) return "";
    const skills = selectedSkillsets.slice(0, 2).join(" & ");
    // Use AI-generated title if available, otherwise use a default
    if (aiGeneratedTitle) {
      return `${aiGeneratedTitle}, ${skills}`;
    }
    // Fallback to location-based title
    if (selectedLocation) {
      const locationName = selectedLocation.name || selectedLocation.address;
      return `${locationName}, ${skills}`;
    }
    return `${skills} Work`;
  }, [selectedLocation, selectedSkillsets, aiGeneratedTitle]);

  const [companyJobTitle, setCompanyJobTitle] = useState("");
  useEffect(() => {
    if (generateCompanyTitle && !companyJobTitle) {
      setCompanyJobTitle(generateCompanyTitle);
    }
  }, [generateCompanyTitle, companyJobTitle]);

  // Helper function to format day names
  const formatDayName = (day: string): string => {
    return day.charAt(0).toUpperCase() + day.slice(1);
  };

  // Helper function to format time (HH:MM to 12-hour format)
  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Helper function to get contact person display info
  const getContactPersonInfo = (location: CompanyLocation | undefined) => {
    if (!location) return null;
    
    if (location.useCompanyDefault) {
      return {
        name: `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || 'Company Default',
        phone: profile?.phone || '',
        email: profile?.email || ''
      };
    }
    
    if (location.representativeTeamMemberId) {
      const teamMember = teamMembers.find(m => m.id === location.representativeTeamMemberId);
      if (teamMember) {
        return {
          name: `${teamMember.firstName} ${teamMember.lastName}`.trim(),
          phone: teamMember.phone || '',
          email: teamMember.email || ''
        };
      }
    }
    
    return {
      name: location.contactName || 'Not specified',
      phone: location.contactPhone || '',
      email: location.contactEmail || ''
    };
  };

  // Function to open location pop-up in edit mode
  const handleEditContactPerson = () => {
    if (!selectedLocation) return;
    
    // Populate newLocation with selected location data
    setNewLocation({
      id: selectedLocation.id,
      name: selectedLocation.name || "",
      address: selectedLocation.address || "",
      address2: selectedLocation.address2 || "",
      city: selectedLocation.city || "",
      state: selectedLocation.state || "",
      zipCode: selectedLocation.zipCode || "",
      useCompanyDefault: selectedLocation.useCompanyDefault || false,
      contactName: selectedLocation.contactName || "",
      contactPhone: selectedLocation.contactPhone || "",
      contactEmail: selectedLocation.contactEmail || "",
      contactAltPhone: selectedLocation.contactAltPhone || "",
      representativeTeamMemberId: selectedLocation.representativeTeamMemberId || null,
      selectedPhoneOption: selectedLocation.contactPhone ? "custom" : "company",
      paymentMethodId: (selectedLocation as any).paymentMethodId ?? null
    });
    
    setEditingLocationId(selectedLocation.id || null);
    setShowLocationPopup(true);
  };

  const [workersNeeded, setWorkersNeeded] = useState(1);
  const [shiftType, setShiftType] = useState<ShiftType | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  
  const [onDemandBudget, setOnDemandBudget] = useState<number | null>(null);

  const [jobBudgetDollars, setJobBudgetDollars] = useState<number | null>(null);
  const [autoFulfillEnabled, setAutoFulfillEnabled] = useState(false);
  const [autoFulfillMinWorkerStars, setAutoFulfillMinWorkerStars] = useState(1);

  const getTomorrowStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const [onDemandDate, setOnDemandDate] = useState(getTomorrowStr);
  const [onDemandDoneByDate, setOnDemandDoneByDate] = useState("");
  const [onDemandStartTime, setOnDemandStartTime] = useState("09:00");
  const [showSchedulePopup, setShowSchedulePopup] = useState<ShiftType | null>(null);
  const [onDemandFormStep, setOnDemandFormStep] = useState(1);
  const [oneDayFormStep, setOneDayFormStep] = useState(1);
  const [recurringFormStep, setRecurringFormStep] = useState(1);
  const [datePickerFor, setDatePickerFor] = useState<{ field: "onDemandStart" | "onDemandDoneBy" | "oneDayDate"; minDate: string } | null>(null);

  useEffect(() => {
    if (step !== 2) {
      setShowSchedulePopup(null);
      setDatePickerFor(null);
    }
  }, [step]);

  useEffect(() => {
    if (!showSchedulePopup) setDatePickerFor(null);
  }, [showSchedulePopup]);

  useEffect(() => {
    if (showSchedulePopup === "on-demand") setOnDemandFormStep(1);
  }, [showSchedulePopup]);

  const [oneDaySchedule, setOneDaySchedule] = useState(() => ({
    date: getTomorrowStr(),
    startTime: "09:00",
    endTime: "17:00"
  }));

  const [recurringSchedule, setRecurringSchedule] = useState(() => ({
    days: [] as string[],
    startDate: getTomorrowStr(),
    endDate: "",
    startTime: "09:00",
    endTime: "17:00",
    weeks: 1
  }));

  const [monthlyFormStep, setMonthlyFormStep] = useState(1);
  const [monthlySchedule, setMonthlySchedule] = useState(() => {
    const start = getTomorrowStr();
    const startDate = parseLocalDate(start);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    return {
      startDate: start,
      endDate: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`,
      days: [] as string[],
      startTime: "09:00",
      endTime: "17:00"
    };
  });

  const toDateInput = (value: string | Date | null | undefined): string => {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const toTimeInput = (value: string | null | undefined, fallback = "09:00"): string => {
    if (!value) return fallback;
    const trimmed = String(value).trim();
    if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return fallback;
    let h = Number(m[1]);
    const mm = m[2];
    const ampm = m[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${mm}`;
  };

  useEffect(() => {
    if (!isRepostFromCancellation || !repostSourceJob || didApplyRepostPrefillRef.current) return;

    const source = repostSourceJob;
    const startDate = toDateInput(source.startDate) || getTomorrowStr();
    const endDate = toDateInput(source.endDate);
    const startTime = toTimeInput(source.scheduledTime, "09:00");
    const endTime = toTimeInput(source.endTime, "17:00");
    const days = Array.isArray(source.scheduleDays) ? source.scheduleDays.map((d: string) => String(d).toLowerCase()) : [];
    const recurringWeeks = Number(source.recurringWeeks) > 0 ? Number(source.recurringWeeks) : 1;
    const recurringMonths = Number(source.recurringMonths) > 0 ? Number(source.recurringMonths) : 0;

    setCompanyJobTitle(source.title || "");
    setJobDescription(source.description || "");
    setWorkersNeeded(Math.max(1, Number(source.maxWorkersNeeded) || 1));
    if (source.companyLocationId) setSelectedLocationId(Number(source.companyLocationId));

    if (source.jobType === "on_demand" || source.isOnDemand) {
      setShiftType("on-demand");
      setOnDemandDate(startDate);
      setOnDemandDoneByDate(endDate || "");
      setOnDemandStartTime(startTime);
      setShowSchedulePopup("on-demand");
    } else if (source.jobType === "recurring" && recurringMonths > 0) {
      setShiftType("monthly");
      setMonthlySchedule({
        startDate,
        endDate: endDate || startDate,
        days,
        startTime,
        endTime,
      });
      setShowSchedulePopup("monthly");
    } else if (source.jobType === "recurring") {
      setShiftType("recurring");
      setRecurringSchedule({
        days,
        startDate,
        endDate: endDate || "",
        startTime,
        endTime,
        weeks: recurringWeeks,
      });
      setShowSchedulePopup("recurring");
    } else {
      setShiftType("one-day");
      setOneDaySchedule({
        date: startDate,
        startTime,
        endTime,
      });
      setShowSchedulePopup("one-day");
    }

    setStep(2);
    setScheduleSuggestionApplied(true);
    didApplyRepostPrefillRef.current = true;
  }, [isRepostFromCancellation, repostSourceJob]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/api/login");
    } else if (!authLoading && !profileLoading && profile?.role !== "company") {
      toast({ title: t("accessDenied"), description: t("onlyCompaniesCanPost"), variant: "destructive" });
      setLocation("/");
    }
  }, [authLoading, profileLoading, isAuthenticated, profile, setLocation, toast]);

  // Track last analyzed description to detect meaningful changes
  const [lastAnalyzedDescription, setLastAnalyzedDescription] = useState("");
  const [userModifiedSkills, setUserModifiedSkills] = useState(false);
  const [aiScheduleSuggestion, setAiScheduleSuggestion] = useState<{
    shiftType?: "on-demand" | "one-day" | "recurring";
    workers?: number;
    startTime?: string;
    startDate?: string;
    recurringDays?: string[];
    weeks?: number;
  } | null>(null);
  const [scheduleSuggestionApplied, setScheduleSuggestionApplied] = useState(false);

  // AI-driven scope estimate (workers, total hours, hourly rate, daily pace).
  // Populated by /api/ai/estimate-job after description+skillsets are entered.
  // Drives on-demand budget projection instead of the old blanket 8hrs × $40 default.
  type AiJobEstimate = {
    suggestedWorkers: number;
    suggestedHours: number;            // total hours per worker
    suggestedHourlyRate: number;       // USD/hour
    suggestedHoursPerDay: number;      // realistic daily pace
    estimatedCalendarDays: number;
    suggestedBudget: number;           // workers × hours × rate × buffer
    reasoning: string;
    source: 'ai' | 'rules';
  };
  const [aiJobEstimate, setAiJobEstimate] = useState<AiJobEstimate | null>(null);
  const [aiEstimateLoading, setAiEstimateLoading] = useState(false);
  const [lastEstimateKey, setLastEstimateKey] = useState<string>("");
  const [userOverrodeWorkers, setUserOverrodeWorkers] = useState(false);

  // Persist draft to sessionStorage so refresh/return restores. Clear on submit or ?new=1.
  const draft: PostJobDraft = useMemo(
    () => ({
      step,
      selectedLocationId,
      locationListExpanded,
      jobDescription,
      aiCategories,
      selectedSkillsets,
      lastAnalyzedDescription,
      userModifiedSkills,
      aiGeneratedTitle,
      companyJobTitle,
      mediaPermanentUrls: mediaPreviews
        .filter((p) => p.permanentUrl)
        .map((p) => ({ url: p.permanentUrl, type: p.type })),
      workersNeeded,
      shiftType,
      scheduleError,
      onDemandBudget,
      onDemandDate,
      onDemandDoneByDate,
      onDemandStartTime,
      onDemandFormStep,
      oneDayFormStep,
      recurringFormStep,
      monthlyFormStep,
      oneDaySchedule,
      recurringSchedule,
      monthlySchedule,
      showSchedulePopup,
      datePickerFor,
      showLocationPopup,
      editingLocationId,
      addLocationStep,
      showCustomContactPopup,
      showAddTeamMemberPopup,
      newLocation: { ...newLocation, address2: newLocation.address2 || "" },
      jobBudgetDollars,
      autoFulfillEnabled,
      autoFulfillMinWorkerStars,
      version: 2,
    }),
    [
      step, selectedLocationId, locationListExpanded, jobDescription, aiCategories,
      selectedSkillsets, lastAnalyzedDescription, userModifiedSkills, aiGeneratedTitle,
      companyJobTitle, mediaPreviews, workersNeeded, shiftType, scheduleError, onDemandBudget, onDemandDate,
      onDemandDoneByDate, onDemandStartTime, onDemandFormStep, oneDayFormStep, recurringFormStep, monthlyFormStep, oneDaySchedule, recurringSchedule, monthlySchedule,
      showSchedulePopup, datePickerFor, showLocationPopup, editingLocationId, addLocationStep,
      showCustomContactPopup, showAddTeamMemberPopup, newLocation,
      jobBudgetDollars, autoFulfillEnabled, autoFulfillMinWorkerStars,
    ]
  );

  const onRestoreDraft = useCallback(
    (d: PostJobDraft) => {
      setStep(d.step);
      setSelectedLocationId(d.selectedLocationId);
      setLocationListExpanded(d.locationListExpanded);
      setJobDescription(d.jobDescription);
      setAiCategories(d.aiCategories);
      setSelectedSkillsets(d.selectedSkillsets);
      setLastAnalyzedDescription(d.lastAnalyzedDescription);
      setUserModifiedSkills(d.userModifiedSkills);
      setAiGeneratedTitle(d.aiGeneratedTitle);
      if (d.companyJobTitle != null) setCompanyJobTitle(d.companyJobTitle);
      setWorkersNeeded(d.workersNeeded);
      setShiftType(d.shiftType);
      setScheduleError(d.scheduleError);
      setOnDemandBudget(d.onDemandBudget);
      setOnDemandDate(d.onDemandDate);
      setOnDemandDoneByDate(d.onDemandDoneByDate);
      setOnDemandStartTime(d.onDemandStartTime || "09:00");
      setOnDemandFormStep(d.onDemandFormStep);
      setOneDayFormStep(d.oneDayFormStep ?? 1);
      setRecurringFormStep(d.recurringFormStep ?? 1);
      setMonthlyFormStep(d.monthlyFormStep ?? 1);
      if (d.oneDaySchedule) {
        setOneDaySchedule({
          date: d.oneDaySchedule.date ?? getTomorrowStr(),
          startTime: d.oneDaySchedule.startTime ?? "09:00",
          endTime: d.oneDaySchedule.endTime ?? "17:00",
        });
      }
      if (d.recurringSchedule) {
        const rs = d.recurringSchedule;
        setRecurringSchedule({
          days: rs.days ?? [],
          startDate: rs.startDate ?? getTomorrowStr(),
          endDate: rs.endDate ?? "",
          startTime: rs.startTime ?? "09:00",
          endTime: rs.endTime ?? "17:00",
          weeks: rs.weeks ?? 1,
        });
      }
      if (d.monthlySchedule) {
        const ms = d.monthlySchedule as { startDate: string; endDate?: string; months?: number; days: string[]; startTime: string; endTime: string };
        let endDate = ms.endDate;
        if (!endDate && ms.startDate && typeof (ms as { months?: number }).months === "number") {
          const start = parseLocalDate(ms.startDate);
          const months = (ms as { months?: number }).months ?? 1;
          const end = new Date(start.getFullYear(), start.getMonth() + months, 0);
          endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
        }
        setMonthlySchedule({ startDate: ms.startDate, endDate: endDate || ms.startDate, days: ms.days || [], startTime: ms.startTime || "09:00", endTime: ms.endTime || "17:00" });
      }
      setScheduleSuggestionApplied(true); // Don't overwrite restored schedule with AI suggestion
      setShowSchedulePopup(d.showSchedulePopup);
      setDatePickerFor(d.datePickerFor);
      setShowLocationPopup(d.showLocationPopup);
      setEditingLocationId(d.editingLocationId);
      setAddLocationStep(d.addLocationStep);
      setShowCustomContactPopup(d.showCustomContactPopup);
      setShowAddTeamMemberPopup(d.showAddTeamMemberPopup);
      setNewLocation({
        ...d.newLocation,
        address2: d.newLocation.address2 || "",
        selectedPhoneOption: (d.newLocation.selectedPhoneOption || "company") as Location["selectedPhoneOption"],
      });
      setMediaPreviews((prev) => {
        const restored = d.mediaPermanentUrls.map((m) => ({
          url: m.url,
          permanentUrl: m.url,
          type: m.type,
          file: new File([], ""),
        }));
        return restored.length > 0 ? restored : prev;
      });
      setJobBudgetDollars(
        d.jobBudgetDollars ??
          (typeof d.autoFulfillLaborBudgetDollars === "number" ? d.autoFulfillLaborBudgetDollars : null) ??
          null
      );
      setAutoFulfillEnabled(d.autoFulfillEnabled ?? false);
      {
        let stars = 1;
        if (typeof d.autoFulfillMinWorkerStars === "number" && d.autoFulfillMinWorkerStars >= 1 && d.autoFulfillMinWorkerStars <= 5) {
          stars = Math.round(d.autoFulfillMinWorkerStars);
        } else if (d.autoFulfillMinRating != null && String(d.autoFulfillMinRating).trim() !== "") {
          const n = parseFloat(String(d.autoFulfillMinRating));
          if (Number.isFinite(n)) stars = Math.min(5, Math.max(1, Math.round(n)));
        }
        setAutoFulfillMinWorkerStars(stars);
      }
    },
    []
  );

  const { clearDraft } = usePostJobDraft({
    userId: profile?.id,
    isNewJob,
    isReady: !authLoading && !profileLoading && !!profile && profile.role === "company",
    draft,
    onRestore: onRestoreDraft,
  });

  const showResumeDraftBanner = useMemo(() => {
    if (isNewJob || isDirectRequest || step !== 1) return false;
    if (!profile || profile.role !== "company") return false;
    if (locationsLoading) return false;
    const stored = profile.id != null ? getStoredDraft(profile.id) : null;
    const substantive =
      isSubstantivePostJobFormState({
        step,
        jobDescription,
        selectedSkillsets,
        companyJobTitle,
        selectedLocationId,
        mediaCount: mediaPreviews.length,
        shiftType,
      }) || isSubstantiveStoredDraft(stored);
    if (!substantive) return false;
    const visibleIds = new Set(
      companyLocations.map((l) => l.id).filter((id): id is number => id != null && Number.isFinite(id))
    );
    const locationForAccess = selectedLocationId ?? stored?.selectedLocationId ?? null;
    if (!isDraftLocationAllowedForVisibleLocations(locationForAccess, visibleIds)) return false;
    return true;
  }, [
    isNewJob,
    isDirectRequest,
    step,
    profile,
    locationsLoading,
    companyLocations,
    jobDescription,
    selectedSkillsets,
    companyJobTitle,
    selectedLocationId,
    mediaPreviews.length,
    shiftType,
  ]);

  const resumeBannerTitleText = useMemo(() => {
    const t = companyJobTitle.trim() || aiGeneratedTitle?.trim();
    if (t) return t.length > 48 ? `${t.slice(0, 46)}…` : t;
    const d = jobDescription.trim();
    if (d.length > 0) {
      const one = d.split(/\s+/).slice(0, 8).join(" ");
      return one.length > 48 ? `${one.slice(0, 46)}…` : one;
    }
    return null;
  }, [companyJobTitle, aiGeneratedTitle, jobDescription]);

  const resumeBannerLocationLabel = useMemo(() => {
    if (selectedLocationId == null) return null;
    const loc = companyLocations.find((l) => l.id === selectedLocationId);
    if (!loc) return `Location #${selectedLocationId}`;
    const name = (loc.name || "").trim();
    const cityState = [loc.city, loc.state].filter(Boolean).join(", ");
    if (name && cityState) return `${name} · ${cityState}`;
    return name || cityState || `Location #${selectedLocationId}`;
  }, [selectedLocationId, companyLocations]);

  const handleStartNewJob = useCallback(() => {
    clearStoredDraft(profile?.id);
    setStep(1);
    setSelectedLocationId(null);
    setLocationListExpanded(false);
    setJobDescription("");
    setAiCategories([]);
    setSelectedSkillsets([]);
    setLastAnalyzedDescription("");
    setUserModifiedSkills(false);
    setAiGeneratedTitle(null);
    setMediaPreviews([]);
    setWorkersNeeded(1);
    setShiftType(null);
    setScheduleError(null);
    setOnDemandBudget(null);
    setJobBudgetDollars(null);
    setAutoFulfillEnabled(false);
    setAutoFulfillMinWorkerStars(1);
    setOnDemandDate(getTomorrowStr());
    setOnDemandDoneByDate("");
    setOnDemandStartTime("09:00");
    setOnDemandFormStep(1);
    setOneDaySchedule({ date: getTomorrowStr(), startTime: "09:00", endTime: "17:00" });
    setRecurringSchedule({ days: [], startDate: getTomorrowStr(), endDate: "", startTime: "09:00", endTime: "17:00", weeks: 1 });
    setMonthlySchedule(() => {
      const start = getTomorrowStr();
      const startD = parseLocalDate(start);
      const endD = new Date(startD.getFullYear(), startD.getMonth() + 1, 0);
      return {
        startDate: start,
        endDate: `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`,
        days: [],
        startTime: "09:00",
        endTime: "17:00"
      };
    });
    setOneDayFormStep(1);
    setRecurringFormStep(1);
    setMonthlyFormStep(1);
    setShowSchedulePopup(null);
    setDatePickerFor(null);
    setShowLocationPopup(false);
    setEditingLocationId(null);
    setAddLocationStep(1);
    setShowCustomContactPopup(false);
    setShowAddTeamMemberPopup(false);
    setNewLocation({
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
      representativeTeamMemberId: null,
      selectedPhoneOption: "company",
      paymentMethodId: null,
    });
    setLocation("/post-job?new=1");
  }, [profile?.id, setLocation]);
  
  useEffect(() => {
    // Re-analyze whenever description meaningfully changes (at least 30 chars and different from last analyzed)
    if (jobDescription.length >= 30 && jobDescription !== lastAnalyzedDescription) {
      setAnalyzingJob(true);
      const timer = setTimeout(() => {
        const matchedSkills = analyzeDescriptionForSkillsets(jobDescription);
        // If no skills matched, default to Laborer (exists in industries; "General Labor" does not)
        const skills = matchedSkills.length > 0 ? matchedSkills : ["Laborer"];
        setAiCategories(skills);
        // Only auto-set selectedSkillsets if user hasn't manually modified them
        if (!userModifiedSkills) {
          setSelectedSkillsets(skills);
        } else {
          // Merge: keep user's manual selections but also show new AI suggestions
          setSelectedSkillsets(prev => {
            const merged = new Set([...prev, ...skills]);
            return Array.from(merged);
          });
        }
        // AI schedule suggestion from description (workers, shift type, times)
        const scheduleHint = analyzeDescriptionForSchedule(jobDescription);
        setAiScheduleSuggestion(scheduleHint);
        setScheduleSuggestionApplied(false); // Reset so it can be applied when entering step 2
        setLastAnalyzedDescription(jobDescription);
        setAnalyzingJob(false);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [jobDescription, lastAnalyzedDescription, userModifiedSkills]);

  // Fetch AI scope estimate (workers, hours-to-completion, hourly rate, daily pace).
  // Replaces the old hardcoded "8hrs/day × $40/hr × calendar days" blanket default for on-demand.
  useEffect(() => {
    if (jobDescription.length < 30) return;
    const key = `${jobDescription}|${selectedSkillsets.join(',')}|${shiftType}|${selectedLocation?.state ?? ''}|${selectedLocation?.city ?? ''}`;
    if (key === lastEstimateKey) return;
    setLastEstimateKey(key);
    setAiEstimateLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Calendar deadline window helps the AI bump worker count when the deadline is tight.
        const deadlineDays = (() => {
          if (shiftType !== "on-demand" || !onDemandDate || !onDemandDoneByDate) return undefined;
          const start = parseLocalDate(onDemandDate);
          const end = parseLocalDate(onDemandDoneByDate);
          if (end < start) return undefined;
          return Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1;
        })();
        const res = await apiRequest("POST", "/api/ai/estimate-job", {
          description: jobDescription,
          skillsets: selectedSkillsets,
          shiftType,
          state: selectedLocation?.state,
          city: selectedLocation?.city,
          deadlineDays,
        });
        if (cancelled) return;
        const data = await res.json();
        if (data?.suggestedHours && data?.suggestedHourlyRate) {
          setAiJobEstimate({
            suggestedWorkers: data.suggestedWorkers,
            suggestedHours: data.suggestedHours,
            suggestedHourlyRate: data.suggestedHourlyRate,
            suggestedHoursPerDay: data.suggestedHoursPerDay ?? 8,
            estimatedCalendarDays: data.estimatedCalendarDays ?? Math.ceil(data.suggestedHours / 8),
            suggestedBudget: data.suggestedBudget,
            reasoning: data.reasoning,
            source: data.source ?? 'ai',
          });
          // Auto-apply suggested worker count unless the user has manually changed it.
          if (!userOverrodeWorkers && data.suggestedWorkers >= 1) {
            setWorkersNeeded(Math.min(50, Math.max(1, data.suggestedWorkers)));
          }
        }
      } catch {
        // Silent — fall back to existing hardcoded defaults.
      } finally {
        if (!cancelled) setAiEstimateLoading(false);
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobDescription, selectedSkillsets, shiftType, selectedLocation?.state, selectedLocation?.city, onDemandDate, onDemandDoneByDate, lastEstimateKey, userOverrodeWorkers]);

  // Apply AI schedule suggestion when entering step 2 (once per suggestion). Default to on-demand if no hint.
  useEffect(() => {
    if (step === 2 && !scheduleSuggestionApplied) {
      setScheduleSuggestionApplied(true);
      // If no suggestion from description, default to on-demand
      const suggestion = aiScheduleSuggestion ?? { shiftType: "on-demand" as const, startTime: "09:00", startDate: getTomorrowStr() };
      if (suggestion.workers != null) {
        setWorkersNeeded(Math.max(1, Math.min(50, suggestion.workers)));
      }
      if (suggestion.shiftType) {
        setShiftType(suggestion.shiftType);
      }
      if (suggestion.startTime) {
        setOnDemandStartTime(suggestion.startTime);
        setOneDaySchedule(prev => ({ ...prev, startTime: suggestion.startTime! }));
        setRecurringSchedule(prev => ({ ...prev, startTime: suggestion.startTime! }));
      }
      if (suggestion.startDate) {
        setOnDemandDate(suggestion.startDate);
        setOneDaySchedule(prev => ({ ...prev, date: suggestion.startDate! }));
      }
      if (suggestion.shiftType === "recurring") {
        const startStr = suggestion.startDate || getTomorrowStr();
        const weeks = suggestion.weeks ?? 1;
        const start = new Date(startStr);
        const end = new Date(start);
        end.setDate(end.getDate() + (weeks - 1) * 7);
        const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
        setRecurringSchedule(prev => ({
          ...prev,
          days: suggestion.recurringDays ?? prev.days,
          weeks,
          startDate: startStr,
          endDate: endStr,
          startTime: suggestion.startTime ?? prev.startTime,
        }));
      }
    }
  }, [step, aiScheduleSuggestion, scheduleSuggestionApplied]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'en-US';
        
        recognitionInstance.onresult = (event: any) => {
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            }
          }
          if (finalTranscript) {
            setJobDescription(prev => prev + (prev ? ' ' : '') + finalTranscript);
          }
        };
        
        recognitionInstance.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };
        
        recognitionInstance.onend = () => {
          setIsListening(false);
        };
        
        recognitionRef.current = recognitionInstance;
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);
  
  const toggleSpeechRecognition = () => {
    if (!recognitionRef.current) {
      toast({ title: t("notSupported"), description: t("speechRecognitionNotSupported"), variant: "destructive" });
      return;
    }
    
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };
  
  const handleStep1Continue = () => setStep(2);

  const getESTTime = () => {
    const now = new Date();
    const estOffset = -5 * 60;
    const estTime = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
    return estTime;
  };

  const validateOnDemandTime = (date: string, time: string) => {
    if (!date || !time) return { valid: false, error: "Please select date and time" };
    const selectedDateTime = new Date(`${date}T${time}`);
    const now = new Date();
    if (selectedDateTime < now) {
      return { valid: false, error: "Start date and time cannot be in the past" };
    }
    const minTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    if (selectedDateTime < minTime) {
      return { valid: false, error: "Start time must be at least 2 hours from now" };
    }
    return { valid: true, error: null };
  };

  const validateRecurringStart = () => {
    const startDate = recurringSchedule.startDate || todayStr;
    if (!startDate || !recurringSchedule.startTime) return null;
    const selectedDateTime = new Date(`${startDate}T${recurringSchedule.startTime}`);
    const now = new Date();
    if (selectedDateTime < now) {
      return "Start date and time cannot be in the past";
    }
    return null;
  };

  const recurringStartError = shiftType === "recurring" ? validateRecurringStart() : null;
  const validateMonthlyStart = () => {
    const startDate = monthlySchedule.startDate || todayStr;
    if (!startDate || !monthlySchedule.startTime) return null;
    const selectedDateTime = new Date(`${startDate}T${monthlySchedule.startTime}`);
    const now = new Date();
    if (selectedDateTime < now) {
      return "Start date and time cannot be in the past";
    }
    return null;
  };
  const monthlyStartError = shiftType === "monthly" ? validateMonthlyStart() : null;
  const effectiveScheduleError = scheduleError || recurringStartError || monthlyStartError;

  const monthlyMonthsCount = useMemo(() => {
    const s = monthlySchedule.startDate || todayStr;
    const e = monthlySchedule.endDate || s;
    if (!s || !e) return 0;
    const start = parseLocalDate(s);
    const end = parseLocalDate(e);
    if (end < start) return 0;
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    return Math.max(1, Math.min(12, months));
  }, [monthlySchedule.startDate, monthlySchedule.endDate, todayStr]);

  const isScheduleValid = () => {
    if (!shiftType) return false;
    if (shiftType === "on-demand") {
      return validateOnDemandTime(onDemandDate, onDemandStartTime).valid;
    }
    if (shiftType === "one-day") {
      return isValidScheduleTime(oneDaySchedule.date, oneDaySchedule.startTime, oneDaySchedule.endTime).valid;
    }
    if (shiftType === "recurring") {
      const pastError = validateRecurringStart();
      return recurringSchedule.days.length > 0 && recurringSchedule.weeks > 0 && !pastError;
    }
    if (shiftType === "monthly") {
      const pastError = validateMonthlyStart();
      return monthlySchedule.days.length > 0 && monthlyMonthsCount >= 1 && monthlyMonthsCount <= 12 && !pastError;
    }
    return false;
  };

  const billableScheduleHours = useMemo(() => {
    if (!shiftType) return 0;
    return computeBillableWorkerHours({
      shiftType,
      workersNeeded,
      onDemandDate,
      onDemandDoneByDate,
      oneDaySchedule,
      recurringSchedule,
      monthlySchedule,
      monthlyMonthsCount,
    });
  }, [
    shiftType,
    workersNeeded,
    onDemandDate,
    onDemandDoneByDate,
    oneDaySchedule,
    recurringSchedule,
    monthlySchedule,
    monthlyMonthsCount,
  ]);

  // Fallbacks used when the AI estimate isn't available (description too short, AI off, etc.)
  const ON_DEMAND_FALLBACK_HOURLY = 40;
  const ON_DEMAND_FALLBACK_HOURS_PER_DAY = 8;

  // On-demand budget: prefer AI-estimated total worker-hours × AI-estimated hourly rate.
  // On-demand jobs run "until complete", so total hours (not calendar days × per-day) is the
  // correct budget driver. The calendar window is treated as a deadline, not a multiplier —
  // but if the deadline is tighter than the AI's natural pace we surface the conflict.
  const onDemandBudgetProjection = useMemo(() => {
    const est = aiJobEstimate;
    const hourlyRate = est?.suggestedHourlyRate ?? ON_DEMAND_FALLBACK_HOURLY;
    const hoursPerDay = est?.suggestedHoursPerDay ?? ON_DEMAND_FALLBACK_HOURS_PER_DAY;

    let totalHoursPerWorker: number;
    let basis: 'ai-total' | 'deadline-window' | 'fallback';

    if (est?.suggestedHours) {
      // AI gave us a total scope estimate per worker — that's the budget basis.
      totalHoursPerWorker = est.suggestedHours;
      basis = 'ai-total';
    } else if (onDemandDate && onDemandDoneByDate) {
      // No AI yet — fall back to calendar-window × daily pace.
      const start = parseLocalDate(onDemandDate);
      const end = parseLocalDate(onDemandDoneByDate);
      if (end < start) return null;
      const days = Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1;
      totalHoursPerWorker = days * hoursPerDay;
      basis = 'deadline-window';
    } else {
      return null;
    }

    const totalWorkerHours = totalHoursPerWorker * workersNeeded;
    const budget = Math.ceil(totalWorkerHours * hourlyRate);

    // Deadline tightness check: how many calendar days does the AI think this needs vs. allowed?
    let deadlineWarning: string | null = null;
    if (basis === 'ai-total' && onDemandDate && onDemandDoneByDate) {
      const start = parseLocalDate(onDemandDate);
      const end = parseLocalDate(onDemandDoneByDate);
      if (end >= start) {
        const allowedDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1;
        const naturalDays = Math.max(1, Math.ceil(totalHoursPerWorker / hoursPerDay));
        if (naturalDays > allowedDays) {
          const extraWorkersNeeded = Math.ceil(naturalDays / allowedDays);
          deadlineWarning = `${naturalDays} day${naturalDays === 1 ? '' : 's'} of work compressed into ${allowedDays} day${allowedDays === 1 ? '' : 's'} — consider ${extraWorkersNeeded}× workers or extending the deadline.`;
        }
      }
    }

    return {
      budget,
      totalWorkerHours,
      totalHoursPerWorker,
      hourlyRate,
      hoursPerDay,
      basis,
      deadlineWarning,
      reasoning: est?.reasoning,
      source: est?.source ?? 'fallback',
    };
  }, [aiJobEstimate, workersNeeded, onDemandDate, onDemandDoneByDate]);

  const onDemandCalculatedBudget = onDemandBudgetProjection?.budget ?? null;

  const minimumJobBudgetUsd = useMemo(
    () =>
      billableScheduleHours > 0
        ? minimumLaborBudgetCentsForWorkerHours(billableScheduleHours) / 100
        : 0,
    [billableScheduleHours]
  );

  const planningRateBand = useMemo(
    () =>
      suggestPlanningHourlyUsd({
        selectedRoleIds: selectedSkillsets,
        location: { state: selectedLocation?.state, city: selectedLocation?.city },
      }),
    [selectedSkillsets, selectedLocation?.state, selectedLocation?.city]
  );

  const selectedRoleLabels = useMemo(
    () => selectedSkillsets.map((id) => ROLE_LABEL_BY_ID.get(id) ?? id),
    [selectedSkillsets]
  );

  const appliedSuggestedBudgetUsd = useMemo(
    () =>
      computeAppliedSuggestedBudgetUsd({
        planningMidHourlyUsd: planningRateBand.mid,
        billableWorkerHours: billableScheduleHours,
        buffer: POST_JOB_BUDGET_DEFAULT_BUFFER,
        minimumTotalUsd: minimumJobBudgetUsd,
      }),
    [planningRateBand.mid, billableScheduleHours, minimumJobBudgetUsd]
  );

  /** Rich copy for step-3 “Budget vs. your schedule” (workers, calendar pattern, long-run framing). */
  const scheduleBudgetExplainer = useMemo(() => {
    if (!shiftType || billableScheduleHours <= 0) return null;
    const workers = Math.max(1, workersNeeded);
    let hoursPerShift = 0;
    if (shiftType === "recurring") {
      hoursPerShift = hoursBetweenTimes(recurringSchedule.startTime, recurringSchedule.endTime);
    } else if (shiftType === "monthly") {
      hoursPerShift = hoursBetweenTimes(monthlySchedule.startTime, monthlySchedule.endTime);
    } else if (shiftType === "one-day") {
      hoursPerShift = hoursBetweenTimes(oneDaySchedule.startTime, oneDaySchedule.endTime);
    } else {
      hoursPerShift = 8;
    }
    if (!Number.isFinite(hoursPerShift) || hoursPerShift <= 0) hoursPerShift = 8;
    const hRounded = Math.round(hoursPerShift * 10) / 10;

    type Pattern =
      | { kind: "recurring"; daysPerWeek: number; weeks: number; shiftsPerWorker: number }
      | { kind: "monthly"; daysPerMonth: number; months: number; shiftsPerWorker: number }
      | { kind: "one-day" }
      | { kind: "on-demand"; calendarDays: number }
      | { kind: "none" };

    let pattern: Pattern = { kind: "none" };
    if (shiftType === "recurring" && recurringSchedule.days.length > 0 && recurringSchedule.weeks >= 1) {
      const daysPerWeek = recurringSchedule.days.length;
      const weeks = recurringSchedule.weeks;
      pattern = {
        kind: "recurring",
        daysPerWeek,
        weeks,
        shiftsPerWorker: daysPerWeek * weeks,
      };
    } else if (shiftType === "monthly" && monthlySchedule.days.length > 0 && monthlyMonthsCount >= 1) {
      const daysPerMonth = monthlySchedule.days.length;
      const months = monthlyMonthsCount;
      pattern = {
        kind: "monthly",
        daysPerMonth,
        months,
        shiftsPerWorker: daysPerMonth * months,
      };
    } else if (shiftType === "one-day") {
      pattern = { kind: "one-day" };
    } else if (shiftType === "on-demand" && onDemandDate && onDemandDoneByDate) {
      const start = parseLocalDate(onDemandDate);
      const end = parseLocalDate(onDemandDoneByDate);
      if (end >= start) {
        const calendarDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
        pattern = { kind: "on-demand", calendarDays };
      }
    }

    let scope: "long" | "mid" | null = null;
    if (shiftType === "monthly") {
      if (monthlyMonthsCount >= 4) scope = "long";
      else if (monthlyMonthsCount >= 2) scope = "mid";
    } else if (shiftType === "recurring") {
      if (recurringSchedule.weeks >= 16) scope = "long";
      else if (recurringSchedule.weeks >= 6) scope = "mid";
    }

    return { workers, hoursPerShift: hRounded, pattern, scope };
  }, [
    shiftType,
    billableScheduleHours,
    workersNeeded,
    recurringSchedule.startTime,
    recurringSchedule.endTime,
    recurringSchedule.days.length,
    recurringSchedule.weeks,
    monthlySchedule.startTime,
    monthlySchedule.endTime,
    monthlySchedule.days.length,
    monthlyMonthsCount,
    oneDaySchedule.startTime,
    oneDaySchedule.endTime,
    onDemandDate,
    onDemandDoneByDate,
  ]);

  useEffect(() => {
    if (step !== 3 || isDirectRequest) return;
    setJobBudgetDollars((prev) => {
      if (prev != null && prev > 0) return prev;
      if (onDemandBudget != null && onDemandBudget > 0) return onDemandBudget;
      if (minimumJobBudgetUsd > 0) {
        return Math.ceil(minimumJobBudgetUsd * POST_JOB_BUDGET_DEFAULT_BUFFER);
      }
      return prev;
    });
  }, [step, isDirectRequest, onDemandBudget, minimumJobBudgetUsd]);

  const validateBudgetStep = (): string | null => {
    if (!isDirectRequest) {
      if (jobBudgetDollars == null || jobBudgetDollars <= 0) {
        return "Enter a total budget (USD).";
      }
    }
    if (billableScheduleHours > 0 && jobBudgetDollars != null && jobBudgetDollars > 0) {
      const minCents = minimumLaborBudgetCentsForWorkerHours(billableScheduleHours);
      if (jobBudgetDollars * 100 < minCents - 0.5) {
        return `Your schedule is about ${Math.round(billableScheduleHours * 10) / 10} total worker-hours. At $${PLATFORM_MIN_JOB_BUDGET_HOURLY_USD}/hr minimum for your budget, plan at least $${(minCents / 100).toFixed(2)} for this posting.`;
      }
    }
    if (autoFulfillEnabled && !isDirectRequest) {
      if (billableScheduleHours <= 0 || !Number.isFinite(billableScheduleHours)) {
        return "Complete your schedule before using auto-fulfill.";
      }
    }
    return null;
  };

  const handleContinueFromBudgetStep = () => {
    const err = validateBudgetStep();
    if (err) {
      toast({ title: "Budget & auto-fulfill", description: err, variant: "destructive" });
      return;
    }
    setStep(4);
  };

  const { uploadFile } = useUpload();

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    for (const file of files) {
      const previewUrl = URL.createObjectURL(file);
      const mediaType = (file.type.startsWith("video") ? "video" : "image") as "image" | "video";
      
      // Add preview immediately with uploading state
      const tempPreview: MediaPreview = {
        url: previewUrl,
        permanentUrl: "",
        type: mediaType,
        file,
        uploading: true,
      };
      
      setMediaPreviews(prev => [...prev, tempPreview]);
      
      // Upload to object storage
      try {
        const result = await uploadFile(file, "jobs");
        if (result) {
          // The objectPath already includes the correct route (e.g., /objects/uploads/uuid)
          const permanentUrl = result.objectPath;
          
          // Update the preview with permanent URL
          setMediaPreviews(prev => prev.map(p => 
            p.url === previewUrl 
              ? { ...p, permanentUrl, uploading: false }
              : p
          ));
        } else {
          // Upload failed
          setMediaPreviews(prev => prev.map(p => 
            p.url === previewUrl 
              ? { ...p, uploading: false, uploadError: "Upload failed" }
              : p
          ));
          toast({ title: t("uploadError"), description: t("failedToUpload", { fileName: file.name }), variant: "destructive" });
        }
      } catch (error) {
        setMediaPreviews(prev => prev.map(p => 
          p.url === previewUrl 
            ? { ...p, uploading: false, uploadError: "Upload failed" }
            : p
        ));
        toast({ title: "Upload Error", description: `Failed to upload ${file.name}`, variant: "destructive" });
      }
    }
  };

  const removeMedia = (index: number) => {
    setMediaPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const addLocation = async () => {
    if (newLocation.name && newLocation.address && newLocation.city && newLocation.state && newLocation.zipCode) {
      try {
        const locationData = {
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
        };
        
        const isEditing = editingLocationId !== null;
        const url = isEditing ? `/api/locations/${editingLocationId}` : '/api/locations';
        const method = isEditing ? 'PATCH' : 'POST';
        
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(locationData),
          credentials: 'include',
        });
        if (response.ok) {
          const savedLocation = await response.json();
          await queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
          if (!isEditing) {
            setSelectedLocationId(savedLocation.id);
          }
          setNewLocation({ 
            name: "", address: "", address2: "", city: "", state: "", zipCode: "",
            useCompanyDefault: true, contactName: "", contactPhone: "", contactEmail: "", contactAltPhone: "",
            representativeTeamMemberId: null, selectedPhoneOption: "company", paymentMethodId: null
          });
          setEditingLocationId(null);
          setAddLocationStep(1);
          setShowLocationPopup(false);
          toast({ 
            title: isEditing ? t("locationUpdated") : t("locationAdded"), 
            description: isEditing ? t("yourLocationHasBeenUpdated") : t("yourNewLocationHasBeenSaved") 
          });
        } else {
          toast({ title: t("error"), description: isEditing ? t("failedToUpdateLocation") : t("failedToAddLocation"), variant: "destructive" });
        }
      } catch (error) {
        toast({ title: t("error"), description: editingLocationId ? t("failedToUpdateLocation") : t("failedToAddLocation"), variant: "destructive" });
      }
    }
  };

  const handleSubmit = async (saveAsDraft?: boolean) => {
    if (!selectedLocation || selectedSkillsets.length === 0) {
      toast({ title: t("error"), description: t("pleaseSelectLocationAndSkill"), variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      // Determine the start date based on shift type
      let startDate: Date;
      let endDate: Date | undefined;
      let jobType: "one_time" | "recurring" | "on_demand" = "one_time";

      if (shiftType === "on-demand") {
        startDate = onDemandDate ? new Date(`${onDemandDate}T${onDemandStartTime}:00`) : new Date();
        jobType = "on_demand";
      } else if (shiftType === "one-day") {
        startDate = new Date(`${oneDaySchedule.date}T${oneDaySchedule.startTime}:00`);
        endDate = new Date(`${oneDaySchedule.date}T${oneDaySchedule.endTime}:00`);
        jobType = "one_time";
      } else if (shiftType === "recurring") {
        // For recurring, start from selected date or today with the specified time
        const startDateStr = recurringSchedule.startDate || todayStr;
        const startLocal = parseLocalDate(startDateStr);
        const [sh, sm] = recurringSchedule.startTime.split(":").map(Number);
        startDate = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate(), sh, sm || 0, 0, 0);
        // End date from explicit endDate or derived from weeks
        if (recurringSchedule.endDate) {
          const endLocal = parseLocalDate(recurringSchedule.endDate);
          const [eh, em] = recurringSchedule.endTime.split(":").map(Number);
          endDate = new Date(endLocal.getFullYear(), endLocal.getMonth(), endLocal.getDate(), eh, em || 0, 0, 0);
        } else {
          const endDateObj = new Date(startDate);
          endDateObj.setDate(endDateObj.getDate() + (recurringSchedule.weeks * 7));
          endDate = endDateObj;
        }
        jobType = "recurring";
      } else if (shiftType === "monthly") {
        const startDateStr = monthlySchedule.startDate || todayStr;
        const endDateStr = monthlySchedule.endDate || startDateStr;
        const startLocal = parseLocalDate(startDateStr);
        const endLocal = parseLocalDate(endDateStr);
        const [sh, sm] = monthlySchedule.startTime.split(":").map(Number);
        const [eh, em] = monthlySchedule.endTime.split(":").map(Number);
        startDate = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate(), sh, sm || 0, 0, 0);
        endDate = new Date(endLocal.getFullYear(), endLocal.getMonth(), endLocal.getDate(), eh, em || 0, 0, 0);
        jobType = "recurring";
      } else {
        startDate = new Date();
      }

      const estimatedHours: number | undefined =
        shiftType != null
          ? computeBillableWorkerHours({
              shiftType,
              workersNeeded,
              onDemandDate,
              onDemandDoneByDate,
              oneDaySchedule,
              recurringSchedule,
              monthlySchedule,
              monthlyMonthsCount,
            })
          : undefined;

      // Map first skillset to trade (matching the trades enum)
      const primarySkill = selectedSkillsets[0] || "General Labor";
      const tradeMap: Record<string, string> = {
        "Electrical": "Electrical",
        "Plumbing": "Plumbing",
        "HVAC": "HVAC",
        "Carpentry": "Carpentry",
        "Drywall": "Drywall",
        "Painting": "Painting",
        "Concrete": "Concrete",
        "Demolition": "Demolition",
        "Cleaning": "Cleaning",
        "Landscaping": "General Labor",
        "General Labor": "General Labor"
      };
      const trade = tradeMap[primarySkill] || "General Labor";

      // Build the job title (use editable company title if set, else generated)
      const jobTitle = (companyJobTitle?.trim() || generateCompanyTitle) || `${trade} Work Needed`;

      // Build location string from selected location
      const locationString = `${selectedLocation.address}, ${selectedLocation.city}, ${selectedLocation.state} ${selectedLocation.zipCode}`;

      // Check if any uploads are still in progress
      const uploadsInProgress = mediaPreviews.some(m => m.uploading);
      if (uploadsInProgress) {
        toast({ title: t("pleaseWait"), description: t("mediaStillUploading"), variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      // Separate images and videos from mediaPreviews - use permanentUrl for storage
      const imageUrls = mediaPreviews
        .filter(m => m.type === "image" && m.permanentUrl)
        .map(m => m.permanentUrl);
      const videoUrls = mediaPreviews
        .filter(m => m.type === "video" && m.permanentUrl)
        .map(m => m.permanentUrl);

      const budgetDollarsCombined = jobBudgetDollars ?? onDemandBudget;

      const autoFulfillPayload =
        !isDirectRequest && autoFulfillEnabled
          ? {
              autoFulfillEnabled: true,
              autoFulfillBudgetCents: Math.round((jobBudgetDollars ?? 0) * 100),
              autoFulfillBudgetWindow: "one_day" as const,
              autoFulfillMinWorkerRating: autoFulfillMinWorkerStars,
              autoFulfillMinWorkerReviews: 0,
              autoFulfillPolicy: "first_match" as const,
            }
          : { autoFulfillEnabled: false };

      // Create job payload - link to company location for proper grouping in dashboard
      const jobData = {
        title: jobTitle,
        description: jobDescription,
        location: locationString,
        locationName: selectedLocation.name || selectedLocation.address, // User-friendly location name
        companyLocationId: selectedLocationId,
        address: selectedLocation.address,
        city: selectedLocation.city,
        state: selectedLocation.state,
        zipCode: selectedLocation.zipCode,
        latitude: selectedLocation.latitude || undefined,
        longitude: selectedLocation.longitude || undefined,
        trade: trade as any,
        serviceCategory: primarySkill,
        requiredSkills: selectedSkillsets,
        hourlyRate: baseHourlyRate * 100, // Convert to cents
        maxWorkersNeeded: workersNeeded,
        startDate: startDate.toISOString(),
        endDate: endDate?.toISOString(),
        scheduledTime: shiftType === "on-demand" ? onDemandStartTime : (shiftType === "one-day" ? oneDaySchedule.startTime : shiftType === "monthly" ? monthlySchedule.startTime : recurringSchedule.startTime),
        estimatedHours,
        isOnDemand: shiftType === "on-demand",
        jobType,
        images: imageUrls.length > 0 ? imageUrls : undefined,
        videos: videoUrls.length > 0 ? videoUrls : undefined,
        scheduleDays: shiftType === "recurring" ? recurringSchedule.days : (shiftType === "monthly" ? monthlySchedule.days : undefined),
        endTime: shiftType === "recurring" ? recurringSchedule.endTime : (shiftType === "monthly" ? monthlySchedule.endTime : (shiftType === "one-day" ? oneDaySchedule.endTime : undefined)),
        recurringWeeks: shiftType === "recurring" ? recurringSchedule.weeks : (shiftType === "monthly" ? undefined : undefined),
        recurringMonths: shiftType === "monthly" ? monthlyMonthsCount : undefined,
        budgetCents:
          budgetDollarsCombined != null && budgetDollarsCombined > 0
            ? Math.round(budgetDollarsCombined * 100)
            : undefined,
        ...autoFulfillPayload,
      };

      // For direct requests, create an inquiry instead of a job
      if (isDirectRequest && directRequestWorkerId) {
        const inquiryData = {
          workerId: parseInt(directRequestWorkerId),
          title: jobTitle,
          description: jobDescription,
          location: locationString,
          locationName: selectedLocation.name || selectedLocation.address,
          address: selectedLocation.address,
          city: selectedLocation.city,
          state: selectedLocation.state,
          zipCode: selectedLocation.zipCode,
          latitude: selectedLocation.latitude || undefined,
          longitude: selectedLocation.longitude || undefined,
          trade: trade as any,
          serviceCategory: primarySkill,
          requiredSkills: selectedSkillsets,
          hourlyRate: baseHourlyRate * 100, // Convert to cents
          maxWorkersNeeded: workersNeeded,
          startDate: startDate.toISOString(),
          endDate: endDate?.toISOString(),
          scheduledTime: shiftType === "on-demand" ? onDemandStartTime : (shiftType === "one-day" ? oneDaySchedule.startTime : shiftType === "monthly" ? monthlySchedule.startTime : recurringSchedule.startTime),
          estimatedHours,
          isOnDemand: shiftType === "on-demand",
          jobType,
          images: imageUrls.length > 0 ? imageUrls : undefined,
          videos: videoUrls.length > 0 ? videoUrls : undefined,
          scheduleDays: shiftType === "recurring" ? recurringSchedule.days : (shiftType === "monthly" ? monthlySchedule.days : undefined),
          endTime: shiftType === "recurring" ? recurringSchedule.endTime : (shiftType === "monthly" ? monthlySchedule.endTime : (shiftType === "one-day" ? oneDaySchedule.endTime : undefined)),
          recurringWeeks: shiftType === "recurring" ? recurringSchedule.weeks : undefined,
          recurringMonths: shiftType === "monthly" ? monthlyMonthsCount : undefined,
          budgetCents:
            budgetDollarsCombined != null && budgetDollarsCombined > 0
              ? Math.round(budgetDollarsCombined * 100)
              : undefined,
          fallbackToPublic,
        };
        
        await apiRequest("POST", "/api/direct-inquiries", inquiryData);
        
        // Invalidate inquiries cache for all views
        queryClient.invalidateQueries({ queryKey: ['/api/direct-inquiries'] });
        queryClient.invalidateQueries({ queryKey: ['/api/direct-inquiries/worker'] });
        queryClient.invalidateQueries({ queryKey: ['/api/direct-inquiries/company'] });
        
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
        
        toast({ 
          title: t("jobRequestSent"), 
          description: directRequestWorkerName 
            ? t("jobRequestSentToWorker", { workerName: directRequestWorkerName })
            : t("jobRequestSentToWorkerFallback")
        });
      } else {
        // Regular job posting (or save as draft)
        const payload = {
          ...(saveAsDraft ? { ...jobData, status: "draft" as const } : jobData),
          autoFulfillTermsAcknowledged: !isDirectRequest && autoFulfillEnabled,
        };
        const response = await apiRequest("POST", "/api/jobs", payload);
        const createdJob = await response.json();

        queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
        queryClient.invalidateQueries({ queryKey: ['/api/jobs/find-work'] });
        queryClient.invalidateQueries({ queryKey: ['/api/company/jobs'] });

        if (saveAsDraft) {
          toast({ title: t("draftSaved", "Draft saved"), description: t("draftSavedDesc", "Publish from Your Jobs when you're ready.") });
          setTimeout(() => setLocation("/company-dashboard?tab=jobs"), 1500);
        } else {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          toast({ title: t("jobPostedSuccessfully"), description: t("workersWillBeNotified") });
          setTimeout(() => setLocation("/company-dashboard?tab=team"), 2000);
        }
      }

      clearStoredDraft(profile?.id);
    } catch (error: any) {
      console.error("Failed to post job:", error);
      toast({ 
        title: t("error"), 
        description: error.message || t("failedToPostJob"), 
        variant: "destructive" 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || profile?.role !== "company") {
    return null;
  }

  const hasCompleteLocation = companyLocations.length > 0;
  const scheduleIsValid = isScheduleValid();

  const stepTitles: Record<number, string> = {
    1: "Post a new job",
    2: "Schedule & workers",
    3: "Budget & auto-fulfill",
    4: "Review & confirm",
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {!isMobile && (
      <Navigation
        hidePostJobLink
        tabs={
          <div className="flex items-center gap-3 w-full">
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
              <AnimatedNavigationTabs
                items={[
                  { id: "jobs", label: tNav("nav.jobs"), onClick: () => setLocation("/company-dashboard") },
                  { id: "team", label: tNav("nav.team"), onClick: () => setLocation("/company-dashboard") },
                  { id: "timesheets", label: tNav("company.timesheets"), onClick: () => setLocation("/company-dashboard") },
                  { id: "chats", label: tNav("nav.messages"), onClick: () => setLocation("/company-dashboard/chats") },
                ]}
                value=""
                onValueChange={(id) => id === "chats" ? setLocation("/company-dashboard/chats") : setLocation("/company-dashboard")}
              />
            </div>
            <Button variant="default" size="sm" className="flex-shrink-0" onClick={() => setLocation("/post-job?new=1")}>
              + New Job
            </Button>
          </div>
        }
        sidebarNavItems={[
          { id: "jobs", label: tNav("nav.jobs"), onClick: () => setLocation("/company-dashboard") },
          { id: "team", label: tNav("nav.team"), onClick: () => setLocation("/company-dashboard") },
          { id: "timesheets", label: tNav("company.timesheets"), onClick: () => setLocation("/company-dashboard") },
          { id: "chats", label: tNav("nav.messages"), onClick: () => setLocation("/company-dashboard/chats") },
        ]}
        onSidebarNavSelect={(id) => id === "chats" ? setLocation("/company-dashboard/chats") : setLocation("/company-dashboard")}
      />
      )}

      {/* Mobile: page header with back (step 2+), centered title, X to close */}
      {isMobile && (
        <header className="flex-shrink-0 border-b border-border bg-background px-4 py-3 flex items-center gap-3">
          {step === 1 ? (
            <div className="w-9 flex-shrink-0" aria-hidden />
          ) : (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="flex-1 text-lg font-semibold text-center normal-case">
            {stepTitles[step]}
          </h1>
          <button
            type="button"
            onClick={() => setLocation("/company-dashboard")}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-foreground"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {step === 3 && (
          <div
            className="w-full border-b border-border bg-muted/30 px-4 py-3 sm:px-6 sm:py-3.5"
            role="note"
            aria-label="How verified on-site hours work"
          >
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
              Verified on-site hours only
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed sm:text-xs">
              What you budget here covers workers who are actually on the job and <strong>clock in</strong> through our
              time tracking. Hours are tied to real shifts; our <strong>time-and-location services</strong> help prevent
              time fraud — <strong>nobody is paid for hours they didn&apos;t work.</strong> Your spend stays aligned with
              verified on-site labor.
            </p>
          </div>
        )}
        <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-8">
          {/* Direct Request Banner */}
          {isDirectRequest && directRequestWorkerName && (
            <div className="mb-6 p-4 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 bg-primary/20 rounded-full">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Sending job request to {directRequestWorkerName}</p>
                  <p className="text-sm text-muted-foreground">
                    {directRequestWorkerRate && `Rate: $${(parseFloat(directRequestWorkerRate) / 100).toFixed(0)}/hr`}
                    {fallbackToPublic && " • Will post publicly if not accepted in 24h"}
                  </p>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setLocation("/company-dashboard?tab=team")}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {showResumeDraftBanner && (
            <div className="mb-4 rounded-xl border border-border bg-muted/35 px-4 py-3 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-sm font-medium text-foreground text-center sm:text-left">
                  Continue where you left off
                </p>
                <button
                  type="button"
                  onClick={handleStartNewJob}
                  className="text-sm text-primary hover:underline font-medium text-center sm:text-right shrink-0"
                >
                  Start new job
                </button>
              </div>
              <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                <Badge variant="secondary" className="rounded-full font-normal">
                  Step {step} of {TOTAL_STEPS}
                </Badge>
                {resumeBannerTitleText && (
                  <Badge variant="outline" className="rounded-full font-normal max-w-full truncate">
                    {resumeBannerTitleText}
                  </Badge>
                )}
                {resumeBannerLocationLabel && (
                  <Badge variant="outline" className="rounded-full font-normal gap-1 pl-2 pr-2.5 max-w-full">
                    <MapPin className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                    <span className="truncate">{resumeBannerLocationLabel}</span>
                  </Badge>
                )}
                {shiftType && SHIFT_TYPE_INFO[shiftType] && (
                  <Badge variant="outline" className="rounded-full font-normal">
                    <Calendar className="h-3 w-3 mr-1 inline opacity-70" aria-hidden />
                    {SHIFT_TYPE_INFO[shiftType].title}
                  </Badge>
                )}
                {selectedSkillsets.length > 0 && (
                  <Badge variant="outline" className="rounded-full font-normal max-w-[200px] truncate">
                    {selectedSkillsets.slice(0, 2).join(", ")}
                    {selectedSkillsets.length > 2 ? ` +${selectedSkillsets.length - 2}` : ""}
                  </Badge>
                )}
              </div>
            </div>
          )}
          {step === 1 && (
            <Card>
              {!isMobile && (
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="w-5 h-5" />
                    Post a New Job
                  </CardTitle>
                </CardHeader>
              )}
              <CardContent className="space-y-6">
              {/* 1. Attachments */}
              <div>
                <div className="border-2 border-dashed rounded-lg p-6 text-center hover-elevate cursor-pointer">
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,image/webp"
                    onChange={handleMediaUpload}
                    className="hidden"
                    id="media-upload"
                    data-testid="input-media-upload"
                  />
                  <label htmlFor="media-upload" className="cursor-pointer">
                    <div className="flex justify-center gap-4 mb-2">
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                      <Video className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground">Click to upload photos or videos</p>
                  </label>
                </div>
                {mediaPreviews.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {mediaPreviews.map((preview, i) => (
                      <div key={i} className="relative group">
                        {preview.type === "image" ? (
                          <img 
                            src={preview.url} 
                            alt={`Upload ${i + 1}`}
                            className={`w-full h-24 object-cover rounded-lg border ${preview.uploading ? 'opacity-50' : ''}`}
                          />
                        ) : (
                          <video 
                            src={preview.url}
                            className={`w-full h-24 object-cover rounded-lg border ${preview.uploading ? 'opacity-50' : ''}`}
                          />
                        )}
                        {preview.uploading && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                          </div>
                        )}
                        {preview.uploadError && (
                          <div className="absolute inset-0 flex items-center justify-center bg-destructive/20 rounded-lg">
                            <AlertCircle className="w-6 h-6 text-destructive" />
                          </div>
                        )}
                        {!preview.uploading && preview.permanentUrl && (
                          <div className="absolute bottom-1 left-1">
                            <Check className="w-4 h-4 text-green-500 bg-background rounded-full" />
                          </div>
                        )}
                        <button 
                          onClick={() => removeMedia(i)}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          data-testid={`button-remove-media-${i}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Description */}
              <div>
                <Label htmlFor="jobDescription">Describe the work you need done</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Minimum 30 characters. Our AI will help categorize the skillset needed.
                </p>
                <div className="relative">
                  <Textarea
                    id="jobDescription"
                    value={jobDescription}
                    onChange={(e) => {
                      setJobDescription(e.target.value);
                      if (e.target.value.length < 30) {
                        setAiCategories([]);
                        setSelectedSkillsets([]);
                        setLastAnalyzedDescription("");
                        setUserModifiedSkills(false);
                      }
                    }}
                    placeholder="e.g., Need help installing new electrical outlets in a commercial building. Must run conduit and wire multiple circuits..."
                    className="min-h-[150px] pr-12"
                    data-testid="input-job-description"
                  />
                  <button
                    type="button"
                    onClick={toggleSpeechRecognition}
                    className={`absolute bottom-3 right-3 p-2 rounded-full transition-colors ${
                      isListening 
                        ? "bg-red-500 text-white" 
                        : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                    }`}
                    data-testid="button-speech-to-text"
                    aria-pressed={isListening}
                    aria-label={isListening ? "Stop speech-to-text recording" : "Start speech-to-text recording"}
                  >
                    <Mic className={`w-4 h-4 ${isListening ? "animate-pulse" : ""}`} />
                  </button>
                </div>
                <div className="flex justify-between mt-2">
                  <span className={`text-sm ${jobDescription.length < 30 ? "text-destructive" : "text-green-600"}`}>
                    {jobDescription.length}/30 minimum characters
                  </span>
                  {analyzingJob && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Sparkles className="w-4 h-4 animate-pulse" />
                      Analyzing skillsets...
                    </span>
                  )}
                </div>
                {/* EEOC compliance feedback — surfaced inline so the user can fix wording before submit. */}
                <EeocFeedback text={`${companyJobTitle}\n${jobDescription}`} />
              </div>

              {/* 3. Location */}
              <div>
                <Label>Job Location</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Select where this job will take place
                </p>
                {!hasCompleteLocation ? (
                  <div className="p-4 border border-yellow-500/30 bg-yellow-500/10 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-800 dark:text-yellow-200">No locations added yet</p>
                      <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
                        You need to add at least one location before posting a job.
                      </p>
                      <Button size="sm" onClick={() => setShowLocationPopup(true)} data-testid="button-add-first-location">
                        <Plus className="w-4 h-4 mr-1" /> Add Location
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 min-w-0">
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {companyLocations.length === 1 ? (
                          <div className="p-3 rounded-md border bg-background flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">{companyLocations[0].name || "Location"}</p>
                              <p className="text-sm text-muted-foreground truncate">{companyLocations[0].address}, {companyLocations[0].city}, {companyLocations[0].state} {companyLocations[0].zipCode}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="border rounded-md bg-background overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setLocationListExpanded(prev => !prev)}
                              className="w-full p-3 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors"
                              data-testid="select-job-location"
                            >
                              <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                {selectedLocationId ? (
                                  (() => {
                                    const loc = companyLocations.find(l => l.id === selectedLocationId);
                                    return loc ? (
                                      <>
                                        <p className="font-medium truncate">{loc.name || "Location"}</p>
                                        <p className="text-sm text-muted-foreground truncate">{loc.address}, {loc.city}, {loc.state} {loc.zipCode}</p>
                                      </>
                                    ) : (
                                      <p className="text-muted-foreground">Select a location...</p>
                                    );
                                  })()
                                ) : (
                                  <p className="text-muted-foreground">Select a location...</p>
                                )}
                              </div>
                              <ChevronDown className={cn("w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform", locationListExpanded && "rotate-180")} />
                            </button>
                            {locationListExpanded && (
                              <div className="border-t max-h-[240px] overflow-y-auto">
                                {companyLocations.map((loc) => {
                                  const isSelected = loc.id === selectedLocationId;
                                  return (
                                    <button
                                      key={loc.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedLocationId(loc.id);
                                        setLocationListExpanded(false);
                                      }}
                                      className={cn(
                                        "w-full p-3 flex items-start gap-2 text-left hover:bg-muted/50 transition-colors border-b border-border last:border-b-0",
                                        isSelected && "bg-primary/5 border-primary/20"
                                      )}
                                      data-testid={`option-location-${loc.id}`}
                                    >
                                      <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{loc.name || "Location"}</p>
                                        <p className="text-sm text-muted-foreground truncate">{loc.address}, {loc.city}, {loc.state} {loc.zipCode}</p>
                                        {getPaymentMethodForLocation(loc.id) && (
                                          <p className="text-xs text-muted-foreground mt-0.5">****{getPaymentMethodForLocation(loc.id)!.lastFour}</p>
                                        )}
                                      </div>
                                      {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <Button variant="outline" size="icon" onClick={() => setShowLocationPopup(true)} data-testid="button-add-new-location">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {showSkillsetDropdown && (
                <ResponsiveDialog
                  open={showSkillsetDropdown}
                  onOpenChange={(open) => {
                    setShowSkillsetDropdown(open);
                    if (open) setShowSelectedSkillsetsOnly(true);
                    else setShowSelectedSkillsetsOnly(false);
                  }}
                  title="Add Skillsets"
                  description="Select skills that match this job"
                  contentClassName="max-w-lg"
                  showBackButton
                  onBack={() => setShowSkillsetDropdown(false)}
                  backLabel="Back"
                  footer={
                    <Button
                      className="min-w-[120px] h-9 text-sm font-semibold rounded-lg shadow-md bg-neutral-900 hover:bg-neutral-800 text-white border-0"
                      onClick={() => setShowSkillsetDropdown(false)}
                      data-testid="button-done-skillsets"
                    >
                      Done
                    </Button>
                  }
                >
                  <div className="space-y-3 pr-2 overscroll-contain">
                    <div className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                      <Label className="text-sm font-medium">Selected only</Label>
                      <Switch
                        checked={showSelectedSkillsetsOnly}
                        onCheckedChange={setShowSelectedSkillsetsOnly}
                        data-testid="switch-skillsets-filter"
                      />
                    </div>
                    {INDUSTRY_CATEGORIES.map((industry) => {
                      const IndustryIcon = industry.icon;
                      const availableRoles = industry.roles.filter(r => !selectedSkillsets.includes(r.id) && !aiCategories.includes(r.id));
                      const selectedRoles = industry.roles.filter(r => selectedSkillsets.includes(r.id));
                      const rolesToShow = showSelectedSkillsetsOnly ? selectedRoles : [...selectedRoles, ...availableRoles];
                      const selectedCount = selectedRoles.length;
                      
                      if (showSelectedSkillsetsOnly && selectedCount === 0) return null;
                      if (!showSelectedSkillsetsOnly && availableRoles.length === 0 && selectedCount === 0) return null;
                      
                      return (
                        <Collapsible key={industry.id} defaultOpen={industry.id === "construction" || showSelectedSkillsetsOnly}>
                          <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-lg hover-elevate" data-testid={`accordion-mobile-${industry.id}`}>
                            <div className="flex items-center gap-2">
                              <IndustryIcon className="w-4 h-4 text-primary" />
                              <span className="font-medium text-sm">{industry.label}</span>
                              {selectedCount > 0 && (
                                <Badge variant="secondary" className="text-xs">{selectedCount} selected</Badge>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pl-6 mt-1 space-y-1">
                            {rolesToShow.map((role) => {
                              const isSelected = selectedSkillsets.includes(role.id);
                              return (
                                <div
                                  key={role.id}
                                  className={cn(
                                    "p-2 rounded-lg cursor-pointer hover-elevate border flex items-start gap-2",
                                    isSelected && "bg-primary/10 border-primary/30"
                                  )}
                                  onClick={() => {
                                    setUserModifiedSkills(true);
                                    if (isSelected) {
                                      setSelectedSkillsets(prev => prev.filter(id => id !== role.id));
                                    } else {
                                      setSelectedSkillsets(prev => [...prev, role.id]);
                                    }
                                  }}
                                  data-testid={`option-skill-mobile-${role.id}`}
                                >
                                  {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />}
                                  <div className="flex-1 min-w-0 flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm">{role.label}</span>
                                        {role.isElite && <Badge variant="secondary" className="text-xs">Certified</Badge>}
                                      </div>
                                      <div className="text-xs text-muted-foreground">{role.desc}</div>
                                    </div>
                                    {role.isElite && (
                                      <span className="shrink-0 text-[11px] sm:text-xs font-semibold text-red-600 text-right leading-tight max-w-[7.5rem] sm:max-w-none pt-0.5">
                                        Requires Verification
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                    {showSelectedSkillsetsOnly && selectedSkillsets.length === 0 && (
                      <p className="text-sm text-muted-foreground p-2 text-center">No skillsets selected yet</p>
                    )}
                    {!showSelectedSkillsetsOnly && allSkillCategories.filter(s => !selectedSkillsets.includes(s.id) && !aiCategories.includes(s.id)).length === 0 && (
                      <p className="text-sm text-muted-foreground p-2 text-center">All skillsets selected</p>
                    )}
                  </div>
                </ResponsiveDialog>
              )}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Schedule & Workers
              </CardTitle>
              {aiScheduleSuggestion && scheduleSuggestionApplied && (aiScheduleSuggestion.shiftType || aiScheduleSuggestion.workers != null || aiScheduleSuggestion.startTime) && (
                <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Suggested from your description
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {aiScheduleSuggestion.workers != null && `${aiScheduleSuggestion.workers} worker${aiScheduleSuggestion.workers > 1 ? "s" : ""}`}
                    {aiScheduleSuggestion.workers != null && aiScheduleSuggestion.shiftType && " • "}
                    {aiScheduleSuggestion.shiftType === "on-demand" && "On-demand (ASAP)"}
                    {aiScheduleSuggestion.shiftType === "one-day" && "One-day shift"}
                    {aiScheduleSuggestion.shiftType === "recurring" && (
                      <>Recurring{aiScheduleSuggestion.recurringDays?.length ? ` (${aiScheduleSuggestion.recurringDays.map(d => d.slice(0, 3)).join(", ")})` : ""}</>
                    )}
                    {aiScheduleSuggestion.startTime && ` • Start ${formatTime(aiScheduleSuggestion.startTime)}`}
                  </p>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label>How many workers do you need?</Label>
                <div className="flex items-center justify-center gap-4 mt-4 py-4">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={workersNeeded <= 1}
                    onClick={() => { setUserOverrodeWorkers(true); setWorkersNeeded(prev => Math.max(1, prev - 1)); }}
                    data-testid="button-workers-minus"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <div className="text-center min-w-[100px]">
                    <div className="flex items-center justify-center gap-2">
                      <Users className="w-6 h-6 text-primary" />
                      <span className="text-3xl font-bold">{workersNeeded}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {workersNeeded === 1 ? "worker" : "workers"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={workersNeeded >= 50}
                    onClick={() => { setUserOverrodeWorkers(true); setWorkersNeeded(prev => Math.min(50, prev + 1)); }}
                    data-testid="button-workers-plus"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {aiJobEstimate && shiftType === "on-demand" && (
                  <div className="mt-2 rounded-md bg-primary/5 border border-primary/20 p-2 text-xs text-muted-foreground">
                    <div className="flex items-start gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <span className="font-medium text-foreground">
                          AI suggests {aiJobEstimate.suggestedWorkers} worker{aiJobEstimate.suggestedWorkers === 1 ? '' : 's'}
                        </span>
                        {' · '}
                        ~{aiJobEstimate.suggestedHours}h each at ${aiJobEstimate.suggestedHourlyRate}/hr
                        {' · '}
                        ~{aiJobEstimate.estimatedCalendarDays} day{aiJobEstimate.estimatedCalendarDays === 1 ? '' : 's'} of work
                        {aiJobEstimate.reasoning && <div className="mt-1 italic">{aiJobEstimate.reasoning}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <Label>How do you want to hire?</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Select a shift type before scheduling
                </p>
                
                <div className="space-y-3">
                  {(Object.keys(SHIFT_TYPE_INFO) as ShiftType[]).map((type) => {
                    const info = SHIFT_TYPE_INFO[type];
                    const handleClick = () => {
                      setShiftType(type);
                      setScheduleError(null);
                      setShowSchedulePopup(type);
                    };
                    return (
                      <div
                        key={type}
                        className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                          shiftType === type ? "border-primary bg-primary/5" : "hover:border-primary/50"
                        }`}
                        onClick={handleClick}
                        data-testid={`button-shift-${type}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            shiftType === type ? "border-primary" : "border-muted-foreground"
                          }`}>
                            {shiftType === type && <div className="w-3 h-3 rounded-full bg-primary" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{info.title}</span>
                              {info.recommended && (
                                <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                                  Recommended
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{info.description}</p>
                          </div>
                          {isMobile && <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {effectiveScheduleError && shiftType && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Schedule issue</p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">{effectiveScheduleError}</p>
                  </div>
                </div>
              )}
              {/* Schedule forms (On-Demand, One-Day, Recurring) are only shown in the pop-up when user clicks a shift type — not inline on this card */}
            </CardContent>
          </Card>
        )}

        {showSchedulePopup && (
          <ResponsiveDialog
            open={!!showSchedulePopup}
            onOpenChange={(open) => !open && setShowSchedulePopup(null)}
            title={showSchedulePopup ? SHIFT_TYPE_INFO[showSchedulePopup].title : ""}
            description={showSchedulePopup ? SHIFT_TYPE_INFO[showSchedulePopup].description : ""}
            contentClassName="max-w-2xl"
            showBackButton
            onBack={() => {
              if (showSchedulePopup === "on-demand" && onDemandFormStep > 1)
                setOnDemandFormStep((s) => s - 1);
              else
                setShowSchedulePopup(null);
            }}
            backLabel="Back"
            progressSteps={
              showSchedulePopup === "on-demand"
                ? 2
                : showSchedulePopup === "one-day"
                  ? 0
                  : showSchedulePopup === "recurring"
                    ? 1
                    : showSchedulePopup === "monthly"
                      ? 1
                      : 0
            }
            progressCurrent={
              showSchedulePopup === "on-demand"
                ? onDemandFormStep
                : showSchedulePopup === "one-day"
                  ? oneDayFormStep
                  : showSchedulePopup === "monthly"
                    ? monthlyFormStep
                    : 1
            }
            primaryAction={
              showSchedulePopup === "on-demand"
                ? {
                    label: "Done",
                    onClick: () => {
                      if (!onDemandBudget) {
                        // Prefer AI-derived projection (workers × est total hours × est rate).
                        // Fall back to legacy calendar-window × 8h × $40 if AI estimate not ready.
                        if (onDemandCalculatedBudget) {
                          setOnDemandBudget(onDemandCalculatedBudget);
                        } else {
                          const end = onDemandDoneByDate || onDemandDate;
                          const days = end && onDemandDate
                            ? Math.ceil((new Date(end).getTime() - new Date(onDemandDate).getTime()) / (24 * 60 * 60 * 1000)) + 1
                            : 1;
                          setOnDemandBudget(days * 8 * 40 * workersNeeded);
                        }
                      }
                      setShowSchedulePopup(null);
                      setStep(3);
                    },
                    disabled:
                      !(onDemandDate && onDemandStartTime && validateOnDemandTime(onDemandDate, onDemandStartTime).valid),
                  }
                : showSchedulePopup === "one-day"
                ? {
                    label: "Done",
                    onClick: () => {
                      setShowSchedulePopup(null);
                      setStep(3);
                    },
                    disabled:
                      !oneDaySchedule.date ||
                      !oneDaySchedule.startTime ||
                      !oneDaySchedule.endTime ||
                      !isValidScheduleTime(oneDaySchedule.date, oneDaySchedule.startTime, oneDaySchedule.endTime).valid,
                  }
                : showSchedulePopup === "recurring"
                ? {
                    label: "Done",
                    onClick: () => {
                      const hrs =
                        recurringSchedule.startTime &&
                        recurringSchedule.endTime
                          ? parseInt(recurringSchedule.endTime.split(":")[0]) -
                            parseInt(recurringSchedule.startTime.split(":")[0])
                          : 0;
                      if (
                        (recurringSchedule.startDate || todayStr) &&
                        hrs > 0
                      ) {
                        setShowSchedulePopup(null);
                        setStep(3);
                      }
                    },
                    disabled:
                      recurringSchedule.days.length === 0 ||
                      recurringSchedule.weeks < 1 ||
                      !!recurringStartError ||
                      !(recurringSchedule.startDate || todayStr) ||
                      !recurringSchedule.startTime ||
                      !recurringSchedule.endTime ||
                      !isValidScheduleTime(recurringSchedule.startDate || todayStr, recurringSchedule.startTime, recurringSchedule.endTime).valid,
                  }
                : showSchedulePopup === "monthly"
                ? {
                    label: "Done",
                    onClick: () => {
                      setShowSchedulePopup(null);
                      setStep(3);
                    },
                    disabled:
                      monthlySchedule.days.length === 0 ||
                      monthlyMonthsCount < 1 ||
                      monthlyMonthsCount > 12 ||
                      !!monthlyStartError ||
                      !(monthlySchedule.startDate || todayStr) ||
                      !monthlySchedule.startTime ||
                      !monthlySchedule.endTime ||
                      !isValidScheduleTime(monthlySchedule.startDate || todayStr, monthlySchedule.startTime, monthlySchedule.endTime).valid,
                  }
                : undefined
            }
          >
            <div className="space-y-4 py-2">
              {showSchedulePopup === "on-demand" && (
                <OnDemandScheduleMultiStep
                  date={onDemandDate}
                  onDateChange={setOnDemandDate}
                  time={onDemandStartTime}
                  onTimeChange={setOnDemandStartTime}
                  doneByDate={onDemandDoneByDate}
                  onDoneByDateChange={setOnDemandDoneByDate}
                  budget={onDemandBudget}
                  onBudgetChange={setOnDemandBudget}
                  workersNeeded={workersNeeded}
                  todayStr={todayStr}
                  minDateForStart={new Date(todayStr)}
                  validateTime={validateOnDemandTime}
                  scheduleError={scheduleError}
                  onScheduleErrorChange={setScheduleError}
                  onComplete={() => { setShowSchedulePopup(null); setStep(3); }}
                  step={onDemandFormStep}
                  onStepChange={setOnDemandFormStep}
                  hideFooter
                  aiEstimate={aiJobEstimate ? {
                    hourlyRate: aiJobEstimate.suggestedHourlyRate,
                    hoursPerDay: aiJobEstimate.suggestedHoursPerDay,
                    totalHoursPerWorker: aiJobEstimate.suggestedHours,
                    estimatedCalendarDays: aiJobEstimate.estimatedCalendarDays,
                    reasoning: aiJobEstimate.reasoning,
                    source: aiJobEstimate.source,
                  } : null}
                  aiEstimateLoading={aiEstimateLoading}
                  projectedBudget={onDemandCalculatedBudget}
                  deadlineWarning={onDemandBudgetProjection?.deadlineWarning ?? null}
                />
              )}
              {showSchedulePopup === "one-day" && (
                <OneDayScheduleMultiStep
                  date={oneDaySchedule.date}
                  onDateChange={(d) => setOneDaySchedule({ ...oneDaySchedule, date: d })}
                  startTime={oneDaySchedule.startTime}
                  onStartTimeChange={(t) => setOneDaySchedule({ ...oneDaySchedule, startTime: t })}
                  endTime={oneDaySchedule.endTime}
                  onEndTimeChange={(t) => setOneDaySchedule({ ...oneDaySchedule, endTime: t })}
                  minDate={parseLocalDate(todayStr)}
                  workersNeeded={workersNeeded}
                  scheduleError={scheduleError}
                  onScheduleErrorChange={setScheduleError}
                  validateTime={(date, start, end) => isValidScheduleTime(date, start, end)}
                  step={oneDayFormStep}
                  onStepChange={setOneDayFormStep}
                  hideFooter
                />
              )}
              {showSchedulePopup === "recurring" && (
                <RecurringScheduleMultiStep
                  startDate={recurringSchedule.startDate}
                  onStartDateChange={(d) => setRecurringSchedule((prev) => ({ ...prev, startDate: d }))}
                  endDate={recurringSchedule.endDate}
                  onEndDateChange={(d) => setRecurringSchedule((prev) => ({ ...prev, endDate: d }))}
                  days={recurringSchedule.days}
                  onDaysChange={(days) => setRecurringSchedule((prev) => ({ ...prev, days }))}
                  startTime={recurringSchedule.startTime}
                  onStartTimeChange={(t) => setRecurringSchedule((prev) => ({ ...prev, startTime: t }))}
                  endTime={recurringSchedule.endTime}
                  onEndTimeChange={(t) => setRecurringSchedule((prev) => ({ ...prev, endTime: t }))}
                  weeks={recurringSchedule.weeks}
                  onWeeksChange={(w) => setRecurringSchedule((prev) => ({ ...prev, weeks: w }))}
                  minDate={parseLocalDate(todayStr)}
                  workersNeeded={workersNeeded}
                  todayStr={todayStr}
                  scheduleError={recurringStartError}
                  step={recurringFormStep}
                  onStepChange={setRecurringFormStep}
                  hideFooter
                />
              )}
              {showSchedulePopup === "monthly" && (
                <MonthlyScheduleMultiStep
                  startDate={monthlySchedule.startDate}
                  onStartDateChange={(d) => setMonthlySchedule((prev) => ({ ...prev, startDate: d }))}
                  endDate={monthlySchedule.endDate}
                  onEndDateChange={(d) => setMonthlySchedule((prev) => ({ ...prev, endDate: d }))}
                  minDate={parseLocalDate(todayStr)}
                  todayStr={todayStr}
                  days={monthlySchedule.days}
                  onDaysChange={(days) => setMonthlySchedule((prev) => ({ ...prev, days }))}
                  startTime={monthlySchedule.startTime}
                  onStartTimeChange={(t) => setMonthlySchedule((prev) => ({ ...prev, startTime: t }))}
                  endTime={monthlySchedule.endTime}
                  onEndTimeChange={(t) => setMonthlySchedule((prev) => ({ ...prev, endTime: t }))}
                  workersNeeded={workersNeeded}
                  scheduleError={monthlyStartError}
                  hideFooter
                />
              )}
            </div>
          </ResponsiveDialog>
        )}

        {isMobile && datePickerFor && (
          <ResponsiveDialog
            open={!!datePickerFor}
            onOpenChange={(open) => !open && setDatePickerFor(null)}
            title={
              datePickerFor?.field === "onDemandStart"
                ? "Start Date"
                : datePickerFor?.field === "onDemandDoneBy"
                  ? "Date when work needs to be done by"
                  : "Date"
            }
            description="Select a date. Dates before today are not allowed."
            contentClassName="max-w-sm"
            showBackButton
            onBack={() => setDatePickerFor(null)}
            backLabel="Back"
          >
            <div className="py-4">
              <DateCalendar
                mode="single"
                selected={
                  datePickerFor?.field === "onDemandStart"
                    ? onDemandDate ? new Date(onDemandDate) : undefined
                    : datePickerFor?.field === "onDemandDoneBy"
                      ? onDemandDoneByDate ? new Date(onDemandDoneByDate) : undefined
                      : oneDaySchedule.date ? new Date(oneDaySchedule.date) : undefined
                }
                onSelect={(date) => {
                  if (!date) return;
                  const str = date.toISOString().split("T")[0];
                  if (datePickerFor?.field === "onDemandStart") {
                    setOnDemandDate(str);
                    const validation = validateOnDemandTime(str, onDemandStartTime);
                    setScheduleError(validation.valid ? null : validation.error);
                  } else if (datePickerFor?.field === "onDemandDoneBy") {
                    setOnDemandDoneByDate(str);
                  } else if (datePickerFor?.field === "oneDayDate") {
                    setOneDaySchedule({ ...oneDaySchedule, date: str });
                    const validation = isValidScheduleTime(str, oneDaySchedule.startTime);
                    setScheduleError(validation.valid ? null : validation.error || null);
                  }
                  setDatePickerFor(null);
                }}
                disabled={{ before: parseLocalDate(datePickerFor!.minDate) }}
              />
            </div>
          </ResponsiveDialog>
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Budget &amp; hiring
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-4 sm:pt-[21px] pb-4 sm:pb-[21px]">
              <div className="rounded-xl border border-border p-4 space-y-5">
                {billableScheduleHours > 0 && (
                  <div className="space-y-2 text-sm">
                    <p className="font-medium flex items-center gap-2">
                      <Calendar className="w-4 h-4 shrink-0 text-muted-foreground" />
                      Budget vs. your schedule
                    </p>
                    <div
                      className={cn(
                        "text-muted-foreground leading-relaxed space-y-2",
                        "[&_strong]:rounded-sm [&_strong]:bg-yellow-200/90 [&_strong]:px-0.5 [&_strong]:font-semibold [&_strong]:text-foreground [&_strong]:box-decoration-clone dark:[&_strong]:bg-yellow-500/35 dark:[&_strong]:text-foreground"
                      )}
                    >
                      {scheduleBudgetExplainer && scheduleBudgetExplainer.workers > 1 && (
                        <p>
                          You&apos;re staffing{" "}
                          <strong>
                            {scheduleBudgetExplainer.workers} people on each shift
                          </strong>{" "}
                          (every scheduled day). We multiply shift length × days in your calendar ×{" "}
                          <strong>{scheduleBudgetExplainer.workers}</strong> to reach total worker-hours.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.pattern.kind === "recurring" && (
                        <p>
                          Weekly calendar:{" "}
                          <strong>{scheduleBudgetExplainer.pattern.daysPerWeek}</strong> working day
                          {scheduleBudgetExplainer.pattern.daysPerWeek === 1 ? "" : "s"} per week ×{" "}
                          <strong>{scheduleBudgetExplainer.pattern.weeks}</strong> week
                          {scheduleBudgetExplainer.pattern.weeks === 1 ? "" : "s"} (~
                          <strong>{scheduleBudgetExplainer.pattern.shiftsPerWorker}</strong> shift
                          {scheduleBudgetExplainer.pattern.shiftsPerWorker === 1 ? "" : "s"} per worker in that window),
                          about <strong>{scheduleBudgetExplainer.hoursPerShift}</strong> hours per shift.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.pattern.kind === "monthly" && (
                        <p>
                          Monthly calendar:{" "}
                          <strong>{scheduleBudgetExplainer.pattern.daysPerMonth}</strong> working day
                          {scheduleBudgetExplainer.pattern.daysPerMonth === 1 ? "" : "s"} per month across{" "}
                          <strong>{scheduleBudgetExplainer.pattern.months}</strong> month
                          {scheduleBudgetExplainer.pattern.months === 1 ? "" : "s"} (~
                          <strong>{scheduleBudgetExplainer.pattern.shiftsPerWorker}</strong> shift
                          {scheduleBudgetExplainer.pattern.shiftsPerWorker === 1 ? "" : "s"} per worker in scope), about{" "}
                          <strong>{scheduleBudgetExplainer.hoursPerShift}</strong> hours per shift.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.pattern.kind === "one-day" && (
                        <p>
                          Single scheduled day: about <strong>{scheduleBudgetExplainer.hoursPerShift}</strong> hour
                          {scheduleBudgetExplainer.hoursPerShift === 1 ? "" : "s"} per worker.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.pattern.kind === "on-demand" && (
                        <p>
                          On-demand window: <strong>{scheduleBudgetExplainer.pattern.calendarDays}</strong> calendar day
                          {scheduleBudgetExplainer.pattern.calendarDays === 1 ? "" : "s"} (start through &ldquo;done
                          by&rdquo;), estimated <strong>8</strong> hours/day ×{" "}
                          <strong>{scheduleBudgetExplainer.workers}</strong> worker
                          {scheduleBudgetExplainer.workers === 1 ? "" : "s"}.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.pattern.kind === "none" && (
                        <p>
                          Totals follow shift length × scheduled days in scope × workers from the prior step.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.scope === "long" && scheduleBudgetExplainer.pattern.kind === "monthly" && (
                        <p>
                          Over <strong>several months</strong> of fixed days, labor stacks up — the minimum below is for
                          the <strong>full period</strong> you set in the calendar, not a single week.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.scope === "mid" && scheduleBudgetExplainer.pattern.kind === "monthly" && (
                        <p>
                          Multi-month schedules add more hours than a short posting; the minimum tracks the whole stretch
                          you selected.
                        </p>
                      )}
                      {scheduleBudgetExplainer?.scope === "long" && scheduleBudgetExplainer.pattern.kind === "recurring" && (
                        <p>
                          Many weeks of recurring shifts mean a large total commitment — the floor matches{" "}
                          <strong>the entire weekly pattern</strong> you chose (weeks × days per week × shift length ×
                          workers).
                        </p>
                      )}
                      {scheduleBudgetExplainer?.scope === "mid" && scheduleBudgetExplainer.pattern.kind === "recurring" && (
                        <p>
                          Longer weekly runs accumulate hours quickly; the minimum is sized for the full week count in
                          your schedule, not just the first week.
                        </p>
                      )}
                      <p>
                        In total, about{" "}
                        <strong>
                          {billableScheduleHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} worker-hours
                        </strong>
                        . At <strong>${PLATFORM_MIN_JOB_BUDGET_HOURLY_USD}/hr</strong> minimum for budgeting, that means
                        at least <strong>${minimumJobBudgetUsd.toFixed(2)}</strong> in labor for this posting — budgets
                        below that can&apos;t be posted.
                      </p>
                    </div>
                    {shiftType === "on-demand" &&
                      scheduleBudgetExplainer?.pattern.kind !== "on-demand" && (
                        <p className="text-xs text-muted-foreground">
                          Add start and &ldquo;done by&rdquo; dates to see the day count here. On-demand uses each calendar
                          day in that span × 8 hours × workers.
                        </p>
                      )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="total-job-budget-usd">
                    Total budget (USD){!isDirectRequest ? "" : " (optional)"}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {isDirectRequest
                      ? "If you enter an amount, it must cover your scheduled worker-hours at the minimum rate used for budgets."
                      : `Must cover your scheduled worker-hours at $${PLATFORM_MIN_JOB_BUDGET_HOURLY_USD}/hr minimum for budgeting`}
                    {minimumJobBudgetUsd > 0 ? ` (~$${minimumJobBudgetUsd.toFixed(0)}+)` : ""}
                    {!isDirectRequest &&
                      ". This amount is also used for auto-fulfill when enabled."}
                  </p>
                  <div className="relative max-w-md">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      id="total-job-budget-usd"
                      type="number"
                      min={0}
                      step={1}
                      placeholder={minimumJobBudgetUsd > 0 ? `e.g. ${Math.ceil(minimumJobBudgetUsd)}+` : "e.g. 1200"}
                      className="pl-7"
                      value={jobBudgetDollars ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") setJobBudgetDollars(null);
                        else {
                          const n = Number(v);
                          setJobBudgetDollars(Number.isFinite(n) ? Math.max(0, n) : null);
                        }
                      }}
                      data-testid="input-job-budget"
                    />
                  </div>
                </div>

                {!isDirectRequest &&
                  billableScheduleHours > 0 &&
                  selectedSkillsets.length > 0 && (
                    <div className="flex flex-nowrap items-center gap-2 w-full max-w-md pt-1 min-h-[1.75rem]">
                      <p
                        className="min-w-0 flex-1 truncate text-xs text-muted-foreground leading-tight"
                        title={`Illustrative ~$${planningRateBand.low}–$${planningRateBand.high}/hr for ${selectedRoleLabels.join(", ")}${selectedLocation?.city || selectedLocation?.state ? ` in ${[selectedLocation.city, selectedLocation.state].filter(Boolean).join(", ")}` : ""}. $${PLATFORM_MIN_JOB_BUDGET_HOURLY_USD}/hr posting minimum; ~$${minimumJobBudgetUsd.toFixed(0)}+ for this schedule. Not a wage quote or legal advice.`}
                      >
                        {`~$${planningRateBand.low}–${planningRateBand.high}/hr · ${selectedRoleLabels.join(", ")}${
                          selectedLocation?.city || selectedLocation?.state
                            ? `, ${[selectedLocation.city, selectedLocation.state].filter(Boolean).join(", ")}`
                            : ""
                        } · min ~$${minimumJobBudgetUsd.toFixed(0)}+`}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs whitespace-nowrap"
                        data-testid="button-use-suggested-budget"
                        disabled={
                          appliedSuggestedBudgetUsd <= 0 ||
                          (jobBudgetDollars != null && jobBudgetDollars === appliedSuggestedBudgetUsd)
                        }
                        onClick={() => {
                          setJobBudgetDollars(appliedSuggestedBudgetUsd);
                          toast({
                            title: "Budget updated",
                            description: `Set to $${appliedSuggestedBudgetUsd.toLocaleString()} (planning mid-rate × your hours, plus 10% buffer).`,
                          });
                        }}
                      >
                        Use ${appliedSuggestedBudgetUsd.toLocaleString()}
                      </Button>
                    </div>
                  )}

                {!isDirectRequest && (
                  <>
                    <div className="flex items-start justify-between gap-3 pt-1">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-medium">Auto-fulfill</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Automatically accept the first applicant who meets your budget and minimum star rating. Turning this on is covered by our{" "}
                          <a href="/terms" className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">
                            Terms
                          </a>{" "}
                          and{" "}
                          <a href="/privacy" className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">
                            Privacy Policy
                          </a>
                          .
                        </p>
                      </div>
                      <Switch
                        variant="status"
                        checked={autoFulfillEnabled}
                        onCheckedChange={setAutoFulfillEnabled}
                        data-testid="switch-auto-fulfill"
                      />
                    </div>

                    {autoFulfillEnabled && (
                      <div className="space-y-4 pt-2 border-t border-border">
                        <div className="space-y-2">
                          <Label>Minimum worker rating (out of 5)</Label>
                          <p className="text-xs text-muted-foreground">
                            Nothing is highlighted by default — that still allows new workers with no reviews. Tap stars to
                            require a higher average once someone has reviews.
                          </p>
                          <div
                            className="flex items-center gap-1"
                            role="group"
                            aria-label="Minimum worker stars"
                            aria-valuemin={1}
                            aria-valuemax={5}
                            aria-valuenow={autoFulfillMinWorkerStars > 1 ? autoFulfillMinWorkerStars : undefined}
                            aria-valuetext={
                              autoFulfillMinWorkerStars <= 1
                                ? "Default minimum (no stars shown); workers with no reviews allowed"
                                : `Minimum ${autoFulfillMinWorkerStars} of 5 stars`
                            }
                          >
                            {[1, 2, 3, 4, 5].map((s) => {
                              const filled = autoFulfillMinWorkerStars > 1 && s <= autoFulfillMinWorkerStars;
                              return (
                              <button
                                key={s}
                                type="button"
                                className={cn(
                                  "rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  filled ? "text-amber-500" : "text-muted-foreground/40 hover:text-muted-foreground"
                                )}
                                aria-label={`Set minimum to ${s} of 5 stars`}
                                onClick={() => setAutoFulfillMinWorkerStars(s)}
                              >
                                <Star
                                  className={cn(
                                    "h-8 w-8 shrink-0",
                                    filled
                                      ? "fill-amber-400 text-amber-500"
                                      : "fill-transparent text-muted-foreground/35"
                                  )}
                                />
                              </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {isDirectRequest && (
                  <p className="text-sm text-muted-foreground pt-1">
                    Auto-fulfill applies to public job posts. This direct request uses your budget only.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Check className="w-5 h-5" />
                Review & Confirm
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-secondary/30 rounded-lg space-y-4">
                <h4 className="font-medium mb-2">Job Summary</h4>
                
                <div className="mb-3 p-2 bg-background rounded border">
                  <p className="text-xs text-muted-foreground mb-1">Job Title (Company View)</p>
                  <Input
                    value={companyJobTitle}
                    onChange={(e) => setCompanyJobTitle(e.target.value)}
                    placeholder={generateCompanyTitle || "e.g., Main Office, General Labor"}
                    className="font-semibold h-auto py-2"
                    data-testid="input-company-job-title"
                  />
                </div>
                
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2 py-3">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium">Skillsets: </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedSkillsets.length > 0 ? selectedSkillsets.map(skill => (
                          <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                        )) : <Badge variant="secondary" className="text-xs">General Labor</Badge>}
                      </div>
                    </div>
                  </li>
                  
                  {jobDescription && (
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="font-medium">Description: </span>
                        <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{jobDescription}</p>
                      </div>
                    </li>
                  )}
                  
                  {mediaPreviews.length > 0 && (
                    <li className="flex items-start gap-2 py-3">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="font-medium">Attached Media: </span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {mediaPreviews.map((media, idx) => (
                            <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border">
                              {media.type === "image" ? (
                                <img src={media.url} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-muted flex items-center justify-center">
                                  <Video className="w-6 h-6 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  )}
                  
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span>Workers needed: <strong>{workersNeeded}</strong></span>
                  </li>
                  
                  <li className="flex items-start gap-2 py-3">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium">Shift type: </span>
                      <strong>{shiftType ? SHIFT_TYPE_INFO[shiftType].title : "Not selected"}</strong>
                      {shiftType === "recurring" && (
                        <div className="mt-1 text-muted-foreground">
                          <div>Days: <strong>{recurringSchedule.days.map(formatDayName).join(", ")}</strong></div>
                          <div>Time: <strong>{formatTime(recurringSchedule.startTime)} - {formatTime(recurringSchedule.endTime)}</strong></div>
                          <div>Weeks: <strong>{recurringSchedule.weeks}</strong></div>
                        </div>
                      )}
                      {shiftType === "monthly" && (
                        <div className="mt-1 text-muted-foreground">
                          <div>Days: <strong>{monthlySchedule.days.map(formatDayName).join(", ")}</strong></div>
                          <div>Time: <strong>{formatTime(monthlySchedule.startTime)} - {formatTime(monthlySchedule.endTime)}</strong></div>
                          <div>Months: <strong>{monthlyMonthsCount} month{monthlyMonthsCount > 1 ? "s" : ""}</strong></div>
                        </div>
                      )}
                      {shiftType === "one-day" && (
                        <div className="mt-1 text-muted-foreground">
                          <div>Date: <strong>{oneDaySchedule.date ? new Date(oneDaySchedule.date).toLocaleDateString() : "Not set"}</strong></div>
                          <div>Time: <strong>{formatTime(oneDaySchedule.startTime)} - {formatTime(oneDaySchedule.endTime)}</strong></div>
                        </div>
                      )}
                      {shiftType === "on-demand" && (
                        <div className="mt-1 text-muted-foreground">
                          <div>Start Date: <strong>{onDemandDate ? parseLocalDate(onDemandDate).toLocaleDateString() : "ASAP"}</strong></div>
                          {onDemandStartTime && <div>Preferred time: <strong>{formatTime(onDemandStartTime)}</strong></div>}
                          {onDemandDoneByDate && <div>Done by: <strong>{new Date(onDemandDoneByDate).toLocaleDateString()}</strong></div>}
                        </div>
                      )}
                    </div>
                  </li>

                  {(() => {
                    const b = jobBudgetDollars ?? onDemandBudget;
                    return b != null && b > 0 ? (
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span>
                          Budget: <strong>${b.toLocaleString()}</strong>
                        </span>
                      </li>
                    ) : null;
                  })()}

                  {!isDirectRequest && autoFulfillEnabled && (
                    <li className="flex items-start gap-2 py-3">
                      <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1 space-y-1">
                        <span className="font-medium">Auto-fulfill: On</span>
                        <div className="text-muted-foreground text-xs space-y-0.5">
                          <div>
                            Total budget:{" "}
                            <strong>
                              {jobBudgetDollars != null
                                ? `$${jobBudgetDollars.toLocaleString()}`
                                : "—"}
                            </strong>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                            <span>Minimum rating:</span>
                            {autoFulfillMinWorkerStars <= 1 ? (
                              <span className="text-foreground/90">Any (includes workers with no reviews)</span>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-0.5 text-amber-500" aria-hidden>
                                  {[1, 2, 3, 4, 5].map((s) => (
                                    <Star
                                      key={s}
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        s <= autoFulfillMinWorkerStars ? "fill-current" : "fill-transparent opacity-35"
                                      )}
                                    />
                                  ))}
                                </span>
                                <span className="tabular-nums text-muted-foreground">({autoFulfillMinWorkerStars}/5)</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )}
                  
                  {selectedLocation && (
                    <>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <span className="font-medium">Location: </span>
                          <div className="mt-1 text-muted-foreground">
                            {selectedLocation.name && <div><strong>{selectedLocation.name}</strong></div>}
                            <div>{selectedLocation.address}{selectedLocation.address2 ? `, ${selectedLocation.address2}` : ""}</div>
                            <div>{selectedLocation.city}, {selectedLocation.state} {selectedLocation.zipCode}</div>
                          </div>
                        </div>
                      </li>
                      
                      {(() => {
                        const contactInfo = getContactPersonInfo(selectedLocation);
                        return contactInfo && (
                          <li className="flex items-start gap-2 py-3">
                            <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">Contact Person: </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-primary hover:text-primary"
                                  onClick={handleEditContactPerson}
                                >
                                  <User className="w-3 h-3 mr-1" />
                                  Edit
                                </Button>
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                <div><strong>{contactInfo.name}</strong></div>
                                {contactInfo.phone && <div>Phone: {contactInfo.phone}</div>}
                                {contactInfo.email && <div>Email: {contactInfo.email}</div>}
                              </div>
                            </div>
                          </li>
                        );
                      })()}
                    </>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        </div>
      </div>

      {/* Sticky footer stack: skillsets banner (step 1) + schedule confirmation (step 2) + action bar */}
      <div className="flex-shrink-0 sticky bottom-0 left-0 right-0 z-40 flex flex-col">
        {/* Skillsets banner - stacked above action bar when step 1 */}
        {step === 1 && aiCategories.length > 0 && (
          <div className="border-t border-border bg-primary/5 px-4 py-3 md:px-6 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
            <div className="max-w-2xl mx-auto">
              <p className="text-sm text-muted-foreground mb-2">
                We&apos;re hiring workers with experience in…
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                {aiCategories.map(skill => (
                  <Badge
                    key={skill}
                    variant={selectedSkillsets.includes(skill) ? "default" : "outline"}
                    className="cursor-pointer rounded-full px-3 py-1"
                    onClick={() => {
                      setUserModifiedSkills(true);
                      if (selectedSkillsets.includes(skill)) {
                        setSelectedSkillsets(prev => prev.filter(s => s !== skill));
                      } else {
                        setSelectedSkillsets(prev => [...prev, skill]);
                      }
                    }}
                    data-testid={`badge-skill-${skill}`}
                  >
                    {skill}
                  </Badge>
                ))}
                {selectedSkillsets.filter(s => !aiCategories.includes(s)).map(skill => (
                  <Badge
                    key={skill}
                    variant="default"
                    className="cursor-pointer rounded-full px-3 py-1"
                    onClick={() => {
                      setUserModifiedSkills(true);
                      setSelectedSkillsets(prev => prev.filter(s => s !== skill));
                    }}
                    data-testid={`badge-skill-${skill}`}
                  >
                    {skill}
                  </Badge>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs rounded-full"
                  onClick={() => setShowSkillsetDropdown(true)}
                  data-testid="button-add-skillset"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add More
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule confirmation banner - stacked above action bar when step 2 */}
        {step === 2 && shiftType && (
          <div className="border-t border-border bg-muted/30 px-4 py-3 md:px-6 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
            <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <Calendar className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="font-medium truncate">
                  {shiftType === "on-demand" && (
                    <>On-demand • Start {onDemandDate ? parseLocalDate(onDemandDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} • {formatTime(onDemandStartTime)}</>
                  )}
                  {shiftType === "one-day" && (
                    <>One-day • {oneDaySchedule.date ? new Date(oneDaySchedule.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} • {formatTime(oneDaySchedule.startTime)}–{formatTime(oneDaySchedule.endTime)}</>
                  )}
                  {shiftType === "recurring" && (
                    <>Recurring • {(recurringSchedule.startDate || todayStr) ? parseLocalDate(recurringSchedule.startDate || todayStr).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}–{recurringSchedule.endDate ? parseLocalDate(recurringSchedule.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} • {recurringSchedule.days.length ? recurringSchedule.days.map(d => d.slice(0, 3)).join(", ") : "—"}</>
                  )}
                  {shiftType === "monthly" && (
                    <>Monthly • {(monthlySchedule.startDate || todayStr) ? parseLocalDate(monthlySchedule.startDate || todayStr).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}–{monthlySchedule.endDate ? parseLocalDate(monthlySchedule.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} • {monthlyMonthsCount} mo • {monthlySchedule.days.length ? monthlySchedule.days.map(d => d.slice(0, 3)).join(", ") : "—"}</>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{workersNeeded} {workersNeeded === 1 ? "worker" : "workers"}</span>
              </div>
            </div>
          </div>
        )}

        {/* Main sticky action bar (Back / Continue) */}
        <div className="border-t border-border bg-background shadow-[0_-2px_12px_rgba(0,0,0,0.06)] px-4 py-4 md:px-6 md:py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4">
        <div className={cn("max-w-2xl mx-auto flex items-center gap-3", step === 1 ? "justify-end" : "justify-between")}>
          {step === 1 && (
            <Button
              onClick={handleStep1Continue}
              disabled={jobDescription.length < 30 || selectedLocationId === null || selectedSkillsets.length === 0}
              className="w-full sm:w-auto sm:min-w-[140px]"
              data-testid="button-job-continue"
            >
              Continue <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!shiftType || !scheduleIsValid || !!effectiveScheduleError}
                className="flex-1 sm:flex-none sm:min-w-[140px]"
                data-testid="button-schedule-continue"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="outline" onClick={() => setStep(2)} disabled={isSubmitting}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <Button
                onClick={handleContinueFromBudgetStep}
                disabled={isSubmitting}
                className="flex-1 sm:flex-none sm:min-w-[140px]"
                data-testid="button-budget-continue"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 4 && (
            <>
              <Button variant="outline" onClick={() => setStep(3)} disabled={isSubmitting}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              {!isDirectRequest && (
                <Button
                  variant="outline"
                  onClick={() => handleSubmit(true)}
                  disabled={isSubmitting}
                  data-testid="button-save-draft"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {t("saveAsDraft", "Save as draft")}
                </Button>
              )}
              <Button
                onClick={() => handleSubmit()}
                className="flex-1 sm:flex-none sm:min-w-[140px]"
                disabled={isSubmitting}
                data-testid="button-confirm-job"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isDirectRequest ? "Sending..." : "Posting..."}</>
                ) : isDirectRequest ? (
                  <><User className="w-4 h-4 mr-2" /> Send Request</>
                ) : (
                  <><Briefcase className="w-4 h-4 mr-2" /> Post Job</>
                )}
              </Button>
            </>
          )}
        </div>
        </div>
      </div>

      <ResponsiveDialog
          open={showLocationPopup}
          onOpenChange={(open) => {
            setShowLocationPopup(open);
            if (!open) {
              setEditingLocationId(null);
              setAddLocationStep(1);
              setShowCustomContactPopup(false);
              setNewLocation({ 
                name: "", address: "", address2: "", city: "", state: "", zipCode: "",
                useCompanyDefault: true, contactName: "", contactPhone: "", contactEmail: "", contactAltPhone: "",
                representativeTeamMemberId: null, selectedPhoneOption: "company", paymentMethodId: null
              });
            }
          }}
          title={editingLocationId ? "Edit Location" : addLocationStep === 1 ? "Step 1: Address" : "Step 2: Contact Representative"}
          description={editingLocationId ? "Update job site location and contact information" : addLocationStep === 1 ? "Enter the job site address" : "Who workers contact at this location"}
          contentClassName="max-w-lg"
          progressSteps={editingLocationId ? 0 : 2}
          progressCurrent={addLocationStep}
          secondaryAction={!editingLocationId && addLocationStep > 1 ? { label: "Back", onClick: () => setAddLocationStep(s => s - 1) } : undefined}
          primaryAction={
            editingLocationId
              ? { label: "Update Location", onClick: addLocation, disabled: !newLocation.name || !newLocation.address || !newLocation.city || !newLocation.state || !newLocation.zipCode, testId: "button-save-location" }
              : addLocationStep < 2
                ? { label: "Next", onClick: () => setAddLocationStep(s => s + 1), disabled: addLocationStep === 1 && (!newLocation.name || !newLocation.address), testId: "button-add-location-next" }
                : { label: "Save Location", onClick: addLocation, disabled: !newLocation.name || !newLocation.address || !newLocation.city || !newLocation.state || !newLocation.zipCode || !(newLocation.useCompanyDefault || newLocation.representativeTeamMemberId !== null || (!!newLocation.contactName?.trim() && !!newLocation.contactEmail?.trim())), testId: "button-save-location" }
          }
        >
          {editingLocationId ? (
            <div className="space-y-6 pr-4">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Location Details</h4>
                  <div>
                    <Label>Location Name *</Label>
                    <Input placeholder="e.g., Downtown Office Tower" value={newLocation.name} onChange={(e) => setNewLocation(prev => ({ ...prev, name: e.target.value }))} data-testid="input-location-name" />
                  </div>
                  <GooglePlacesAutocomplete
                    id="postjob-edit-location-address"
                    label="Street Address *"
                    value={newLocation.address}
                    onChange={(address, components) => setNewLocation(prev => ({ ...prev, address, city: components.city || prev.city, state: components.state || prev.state, zipCode: components.zipCode || prev.zipCode }))}
                    placeholder="Start typing an address..."
                    required
                    containerClassName="pt-6 pb-6 px-6"
                    data-testid="input-location-address"
                  />
                  <div>
                    <Label htmlFor="postjob-edit-location-address2">Address Line 2 (Unit, Suite, etc.)</Label>
                    <Input id="postjob-edit-location-address2" placeholder="Unit, Suite, etc." value={newLocation.address2 || ""} onChange={(e) => setNewLocation(prev => ({ ...prev, address2: e.target.value }))} data-testid="input-location-address2" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>City *</Label><Input placeholder="Austin" value={newLocation.city} onChange={(e) => setNewLocation(prev => ({ ...prev, city: e.target.value }))} data-testid="input-location-city" /></div>
                    <div><Label>State *</Label><Input placeholder="TX" maxLength={2} value={newLocation.state} onChange={(e) => setNewLocation(prev => ({ ...prev, state: e.target.value.toUpperCase() }))} data-testid="input-location-state" /></div>
                    <div><Label>ZIP *</Label><Input placeholder="78701" value={newLocation.zipCode} onChange={(e) => setNewLocation(prev => ({ ...prev, zipCode: e.target.value }))} data-testid="input-location-zip" /></div>
                  </div>
                </div>
                <Separator />
                {/* Contact Representative - same structure as add flow */}
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
                          
                          {alternatePhones.length > 0 && alternatePhones.map((altPhone: string, idx: number) => (
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
                                  value={newLocation.representativeTeamMemberId === -1 || newLocation.representativeTeamMemberId === null ? "none" : newLocation.representativeTeamMemberId.toString()}
                                  onValueChange={(v) => {
                                    if (v === "__new__") { setShowAddTeamMemberPopup(true); setNewLocation(prev => ({ ...prev, representativeTeamMemberId: null, contactName: "", contactEmail: "" })); return; }
                                    if (v === "none") {
                                      setNewLocation(prev => ({ ...prev, representativeTeamMemberId: null, contactName: "", contactEmail: "" }));
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
                                    {teamMembers.map((member: any) => (
                                      <SelectItem key={member.id} value={member.id.toString()}>
                                        {member.firstName} {member.lastName} ({member.role})
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="__new__" className="text-primary font-medium">+ New team member</SelectItem>
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
              </div>
          ) : (
            <div className="space-y-6">
              {addLocationStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <Label>Location Name *</Label>
                    <Input placeholder="e.g., Main Office" value={newLocation.name} onChange={(e) => setNewLocation(prev => ({ ...prev, name: e.target.value }))} data-testid="input-location-name" />
                  </div>
                  <GooglePlacesAutocomplete
                    id="postjob-location-address"
                    label="Street Address *"
                    value={newLocation.address}
                    onChange={(address, components) => setNewLocation(prev => ({ ...prev, address, city: components.city || prev.city, state: components.state || prev.state, zipCode: components.zipCode || prev.zipCode }))}
                    placeholder="Start typing an address..."
                    required
                    containerClassName="pt-6 pb-6 px-6"
                    data-testid="input-location-address"
                  />
                  <div>
                    <Label htmlFor="postjob-location-address2">Address Line 2 (Unit, Suite, etc.)</Label>
                    <Input id="postjob-location-address2" placeholder="Unit, Suite, etc." value={newLocation.address2 || ""} onChange={(e) => setNewLocation(prev => ({ ...prev, address2: e.target.value }))} data-testid="input-location-address2" />
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
                    <Switch checked={newLocation.useCompanyDefault} onCheckedChange={(checked) => setNewLocation(prev => ({ ...prev, useCompanyDefault: checked, selectedPhoneOption: checked ? "company" : prev.selectedPhoneOption }))} data-testid="switch-use-company-default" />
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
                      <div className="space-y-2">
                        <Label className="text-sm">Contact Phone</Label>
                        <div className="space-y-2">
                          {profile?.phone && (
                            <div className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.selectedPhoneOption === "company" ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`} onClick={() => setNewLocation(prev => ({ ...prev, selectedPhoneOption: "company", contactPhone: profile?.phone || "" }))}>
                              <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${newLocation.selectedPhoneOption === "company" ? "border-primary bg-primary" : "border-muted-foreground"}`}>{newLocation.selectedPhoneOption === "company" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}</div>
                                <div><p className="font-medium text-sm">Company Phone</p><p className="text-xs text-muted-foreground">{profile.phone}</p></div>
                              </div>
                            </div>
                          )}
                          {alternatePhones.length > 0 && alternatePhones.map((altPhone: string, idx: number) => (
                            <div key={idx} className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.selectedPhoneOption === "alt" && newLocation.contactPhone === altPhone ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`} onClick={() => setNewLocation(prev => ({ ...prev, selectedPhoneOption: "alt", contactPhone: altPhone }))}>
                              <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${newLocation.selectedPhoneOption === "alt" && newLocation.contactPhone === altPhone ? "border-primary bg-primary" : "border-muted-foreground"}`}>{newLocation.selectedPhoneOption === "alt" && newLocation.contactPhone === altPhone && <Check className="w-2.5 h-2.5 text-primary-foreground" />}</div>
                                <div><p className="font-medium text-sm">Alternate Phone #{idx + 1}</p><p className="text-xs text-muted-foreground">{altPhone}</p></div>
                              </div>
                            </div>
                          ))}
                          <div className={`p-3 border rounded-lg cursor-pointer transition-colors ${newLocation.selectedPhoneOption === "custom" ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`} onClick={() => setNewLocation(prev => ({ ...prev, selectedPhoneOption: "custom" }))}>
                            <div className="flex items-center gap-3">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${newLocation.selectedPhoneOption === "custom" ? "border-primary bg-primary" : "border-muted-foreground"}`}>{newLocation.selectedPhoneOption === "custom" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}</div>
                              <div className="flex-1">
                                <p className="font-medium text-sm">Custom Phone Number</p>
                                {newLocation.selectedPhoneOption === "custom" && <Input placeholder="(555) 123-4567" className="mt-2" value={newLocation.contactPhone} onChange={(e) => setNewLocation(prev => ({ ...prev, contactPhone: e.target.value }))} onClick={(e) => e.stopPropagation()} data-testid="input-custom-phone" />}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Contact Representative</Label>
                        <div className="space-y-2">
                          <div className={`p-3 border rounded-lg ${newLocation.representativeTeamMemberId !== null ? "ring-2 ring-primary bg-primary/5" : "hover-elevate"}`}>
                            <div className="flex items-center gap-3">
                              <Users className="w-4 h-4 text-muted-foreground" />
                              <div className="flex-1">
                                <p className="font-medium text-sm">Select from Team</p>
                                <Select value={newLocation.representativeTeamMemberId === -1 || newLocation.representativeTeamMemberId === null ? "none" : newLocation.representativeTeamMemberId.toString()} onValueChange={(v) => {
                                  if (v === "__new__") { setShowAddTeamMemberPopup(true); setNewLocation(prev => ({ ...prev, representativeTeamMemberId: null, contactName: "", contactEmail: "" })); return; }
                                  if (v === "none") setNewLocation(prev => ({ ...prev, representativeTeamMemberId: null, contactName: "", contactEmail: "" }));
                                  else { const member = teamMembers.find((m: any) => m.id.toString() === v); setNewLocation(prev => ({ ...prev, representativeTeamMemberId: Number(v), contactName: member ? `${member.firstName} ${member.lastName}`.trim() : "", contactEmail: member?.email || "", contactPhone: member?.phone || prev.contactPhone, selectedPhoneOption: member?.phone ? "team" : prev.selectedPhoneOption })); }
                                }}>
                                  <SelectTrigger className="mt-1" data-testid="select-team-representative"><SelectValue placeholder="Select a team member..." /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No team member selected</SelectItem>
                                    {teamMembers.map((member: any) => <SelectItem key={member.id} value={member.id.toString()}>{member.firstName} {member.lastName} ({member.role})</SelectItem>)}
                                    <SelectItem value="__new__" className="text-primary font-medium">+ New team member</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                          <div className="text-center text-xs text-muted-foreground py-1">— or add custom contact —</div>
                          {newLocation.contactName?.trim() && newLocation.contactEmail?.trim() ? (
                            <div className="p-3 rounded-lg border bg-muted/30 flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-sm">{newLocation.contactName}</p>
                                <p className="text-xs text-muted-foreground">{newLocation.contactEmail}</p>
                                {newLocation.contactAltPhone && <p className="text-xs text-muted-foreground">{newLocation.contactAltPhone}</p>}
                              </div>
                              <Button type="button" variant="outline" size="sm" onClick={() => setShowCustomContactPopup(true)} data-testid="button-edit-custom-contact">Change</Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setNewLocation(prev => ({ ...prev, representativeTeamMemberId: null })); setShowCustomContactPopup(true); }}
                              className="w-full p-4 rounded-lg border-2 border-dashed border-muted-foreground/40 hover:border-primary/50 hover:bg-muted/30 transition-colors flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                              data-testid="button-add-custom-contact"
                            >
                              <User className="w-4 h-4" />
                              <span className="font-medium text-sm">Add custom contact</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </ResponsiveDialog>

        {/* Custom contact popup (branch from Step 2) — enter details then back to Step 2 */}
        <ResponsiveDialog
          open={showCustomContactPopup}
          onOpenChange={setShowCustomContactPopup}
          title="Custom contact"
          description="Enter contact details for this location"
          contentClassName="max-w-lg"
          primaryAction={{
            label: "Confirm",
            onClick: () => setShowCustomContactPopup(false),
            disabled: !newLocation.contactName?.trim() || !newLocation.contactEmail?.trim(),
            testId: "button-custom-contact-confirm",
          }}
        >
          <div className="space-y-4">
            <div>
              <Label>Contact Name *</Label>
              <Input
                placeholder="John Smith"
                value={newLocation.contactName}
                onChange={(e) => setNewLocation(prev => ({ ...prev, contactName: e.target.value, representativeTeamMemberId: null }))}
                data-testid="input-contact-name"
              />
            </div>
            <div>
              <Label>Contact Email *</Label>
              <Input
                type="email"
                placeholder="john@company.com"
                value={newLocation.contactEmail}
                onChange={(e) => setNewLocation(prev => ({ ...prev, contactEmail: e.target.value }))}
                data-testid="input-contact-email"
              />
            </div>
            <div>
              <Label>Alternate Phone (optional)</Label>
              <Input
                type="tel"
                placeholder="(555) 987-6543"
                value={newLocation.contactAltPhone}
                onChange={(e) => setNewLocation(prev => ({ ...prev, contactAltPhone: e.target.value }))}
                data-testid="input-contact-alt-phone"
              />
            </div>
          </div>
        </ResponsiveDialog>

        {/* Add team member popup (branch from Contact Representative select) */}
        <ResponsiveDialog
          open={showAddTeamMemberPopup}
          onOpenChange={(open) => { setShowAddTeamMemberPopup(open); if (!open) setNewTeamMemberData({ firstName: "", lastName: "", email: "", phone: "", jobPosition: "", role: "manager" }); }}
          title="New team member"
          description="Enter their details and send the invitation"
          contentClassName="max-w-lg"
          primaryAction={{
            label: "Send Invite",
            onClick: () => createTeamInvite.mutate({
              email: newTeamMemberData.email,
              role: newTeamMemberData.role,
              firstName: newTeamMemberData.firstName || undefined,
              lastName: newTeamMemberData.lastName || undefined,
              phone: newTeamMemberData.phone || undefined,
              jobPosition: newTeamMemberData.jobPosition || undefined,
            }),
            disabled: !newTeamMemberData.email?.trim() || createTeamInvite.isPending,
            icon: createTeamInvite.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />,
            testId: "button-send-invite-new-member",
          }}
        >
          <div className="space-y-4">
            <div>
              <Label>Role / Job position</Label>
              <Input
                placeholder="e.g. Project Manager, Foreman"
                value={newTeamMemberData.jobPosition}
                onChange={(e) => setNewTeamMemberData(prev => ({ ...prev, jobPosition: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Their job position or title</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input placeholder="John" value={newTeamMemberData.firstName} onChange={(e) => setNewTeamMemberData(prev => ({ ...prev, firstName: e.target.value }))} />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input placeholder="Smith" value={newTeamMemberData.lastName} onChange={(e) => setNewTeamMemberData(prev => ({ ...prev, lastName: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Email Address *</Label>
              <Input
                type="email"
                placeholder="john@company.com"
                value={newTeamMemberData.email}
                onChange={(e) => setNewTeamMemberData(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input type="tel" placeholder="(555) 123-4567" value={newTeamMemberData.phone} onChange={(e) => setNewTeamMemberData(prev => ({ ...prev, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Permissions</Label>
              <div className="space-y-2 mt-2">
                {[
                  { value: "admin" as const, label: "Admin", desc: "Full access to all features including billing and team management" },
                  { value: "manager" as const, label: "Manager", desc: "Can post jobs, manage applications, and approve timesheets" },
                  { value: "viewer" as const, label: "Viewer", desc: "Can view jobs and timesheets but cannot make changes" },
                ].map((role) => (
                  <div
                    key={role.value}
                    className={`flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors ${newTeamMemberData.role === role.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                    onClick={() => setNewTeamMemberData(prev => ({ ...prev, role: role.value }))}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${newTeamMemberData.role === role.value ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {newTeamMemberData.role === role.value && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ResponsiveDialog>
    </div>
  );
}
