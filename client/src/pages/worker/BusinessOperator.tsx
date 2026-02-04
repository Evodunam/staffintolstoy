import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MobilePopup, MobilePopupFooter } from "@/components/ui/mobile-popup";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import * as faceapi from "@vladmandic/face-api";
import { useTranslation } from "react-i18next";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { 
  ArrowLeft, Users, DollarSign, Briefcase, Plus, Edit2, Trash2, 
  ChevronRight, ChevronLeft, MapPin, Phone, Mail, Wrench, Shield, User as UserIcon,
  Send, Clock, CheckCircle, XCircle, Camera, Upload, Loader2, Zap, Droplets, 
  Wind, Hammer, PaintBucket, Building2, Shovel, HardHat, AlertCircle, MoreVertical,
  Copy, Link, RefreshCw, UserCog, Info, Share2
} from "lucide-react";

const SERVICE_CATEGORIES = {
  general: [
    { id: "Laborer", label: "Laborer", desc: "Furniture assembly, demolition, moving, general labor", icon: HardHat },
    { id: "Landscaping", label: "Landscaping", desc: "Lawn care, gardening, outdoor work", icon: Shovel },
    { id: "Painting", label: "Painting", desc: "Interior and exterior painting", icon: PaintBucket },
    { id: "Drywall", label: "Drywall", desc: "Hanging, mudding, and taping", icon: Building2 },
    { id: "Concrete", label: "Concrete", desc: "Pouring, finishing, repairs", icon: Building2 },
  ],
  carpentry: [
    { id: "Carpentry Lite", label: "Carpentry Lite", desc: "Trim, tools, framing walls, small stairs", icon: Hammer },
    { id: "Carpentry Elite", label: "Carpentry Elite", desc: "Full structures, homes, complex builds", icon: Hammer, isElite: true },
  ],
  electrical: [
    { id: "Electrical Lite", label: "Electrical Lite", desc: "Outlets, ceiling fans, replacing fixtures", icon: Zap },
    { id: "Electrical Elite", label: "Electrical Elite", desc: "Full home wiring, new installations", icon: Zap, isElite: true },
  ],
  plumbing: [
    { id: "Plumbing Lite", label: "Plumbing Lite", desc: "Faucets, toilets, repairs", icon: Droplets },
    { id: "Plumbing Elite", label: "Plumbing Elite", desc: "Full installs from scratch", icon: Droplets, isElite: true },
  ],
  hvac: [
    { id: "HVAC Lite", label: "HVAC Lite", desc: "Repairs, existing systems", icon: Wind },
    { id: "HVAC Elite", label: "HVAC Elite", desc: "Full installs, ducting, minisplits, AC units", icon: Wind, isElite: true },
  ],
};

const SKILL_OPTIONS = [
  { id: "electrical", label: "Electrical", tier: "elite" },
  { id: "plumbing", label: "Plumbing", tier: "elite" },
  { id: "hvac", label: "HVAC", tier: "elite" },
  { id: "carpentry", label: "Carpentry", tier: "lite" },
  { id: "drywall", label: "Drywall", tier: "lite" },
  { id: "painting", label: "Painting", tier: "lite" },
  { id: "demolition", label: "Demolition", tier: "lite" },
  { id: "cleaning", label: "Cleaning", tier: "lite" },
  { id: "concrete", label: "Concrete", tier: "lite" },
  { id: "general_labor", label: "General Labor", tier: "lite" },
];

interface TeamMember {
  id: number;
  teamId: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  avatarUrl: string | null;
  role: "admin" | "employee";
  hourlyRate: number;
  skillsets: string[];
  status: "active" | "inactive" | "pending";
  inviteToken: string | null;
  createdAt: string;
  /** Work/home base from DB */
  latitude?: string | null;
  longitude?: string | null;
  /** Live GPS from location pings (when location services on) */
  liveLocationLat?: number | null;
  liveLocationLng?: number | null;
  liveLocationTimestamp?: string | null;
}

interface WorkerTeam {
  id: number;
  name: string;
  ownerId: number;
  description: string | null;
  createdAt: string;
}

/** Embeddable business operator content for menu right panel or standalone page. */
export function BusinessOperatorContent({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation("businessOperator");
  const { t: tCommon } = useTranslation("common");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // Helper function to generate onboarding URL for a team member
  // Only returns a link if the member has inviteToken, role, and hourlyRate set
  const getOnboardingUrl = (member: TeamMember | null) => {
    if (!member) return "";
    // Member must have inviteToken, role, and hourlyRate to share the link
    if (!member.inviteToken || !member.role || !member.hourlyRate) return "";
    return `${window.location.origin}/team/join/${member.inviteToken}`;
  };

  /** Coords when member has location on (live GPS preferred, else work address). */
  const getMemberLocationCoords = (m: TeamMember): { lat: number; lng: number } | null => {
    const lat = m.liveLocationLat ?? (m.latitude != null ? parseFloat(String(m.latitude)) : null);
    const lng = m.liveLocationLng ?? (m.longitude != null ? parseFloat(String(m.longitude)) : null);
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
    return null;
  };
  
  const WIZARD_STEPS = [
    t("wizardSteps.userDetails"),
    t("wizardSteps.address"),
    t("wizardSteps.role"),
    t("wizardSteps.rateAndSkills")
  ];
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [skillsetDialogOpen, setSkillsetDialogOpen] = useState(false);
  const [skillsetMember, setSkillsetMember] = useState<TeamMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "employee">("employee");
  const [inviteStep, setInviteStep] = useState<0 | 1 | 2>(0); // 0: teammate details, 1: review, 2: share link
  const [newInviteMember, setNewInviteMember] = useState({
    firstName: "",
    lastName: "",
    hourlyRate: 15,
    email: "",
    phone: "",
    role: "employee" as "admin" | "employee",
  });
  const [createdInviteMember, setCreatedInviteMember] = useState<TeamMember | null>(null);
  const [paymentFlowInfoOpen, setPaymentFlowInfoOpen] = useState(false);
  const [onboardingLinkInfoOpen, setOnboardingLinkInfoOpen] = useState(false);
  
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [isVerifyingFace, setIsVerifyingFace] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const editAvatarInputRef = useRef<HTMLInputElement>(null);
  
  const [newMember, setNewMember] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    role: "employee" as "admin" | "employee",
    hourlyRate: 25,
    skillsets: [] as string[],
    avatarUrl: "",
  });
  
  // Cleanup effect to ensure no lingering aria-hidden attributes block the page
  useEffect(() => {
    const cleanup = () => {
      // Check if any pop-ups are open
      const hasOpenPopups = addMemberOpen || !!editMember || paymentFlowInfoOpen || 
                           onboardingLinkInfoOpen || skillsetDialogOpen || inviteOpen;
      
      if (!hasOpenPopups) {
        // If no pop-ups are open, ensure root is not aria-hidden
        const root = document.getElementById('root');
        if (root && root.getAttribute('aria-hidden') === 'true') {
          root.removeAttribute('aria-hidden');
        }
      }
    };
    
    // Run cleanup periodically and on unmount
    const interval = setInterval(cleanup, 500);
    return () => {
      clearInterval(interval);
      cleanup();
    };
  }, [addMemberOpen, editMember, paymentFlowInfoOpen, onboardingLinkInfoOpen, skillsetDialogOpen, inviteOpen]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const modelUrls = [
          "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model",
          "https://unpkg.com/@vladmandic/face-api@1.7.14/model",
        ];
        
        for (const url of modelUrls) {
          try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(url);
            setModelsLoaded(true);
            break;
          } catch {
            continue;
          }
        }
        setModelsLoaded(true);
      } catch {
        setModelsLoaded(true);
      }
    };
    loadModels();
  }, []);
  
  const detectFace = async (imageDataUrl: string): Promise<boolean> => {
    if (!modelsLoaded) return true;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions());
          resolve(detections.length > 0);
        } catch {
          resolve(true);
        }
      };
      img.onerror = () => resolve(true);
      img.src = imageDataUrl;
    });
  };
  
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
        setNewMember({ ...newMember, avatarUrl: imageData });
        setFaceError(null);
      } else {
        setFaceVerified(false);
        setFaceError(t("pleaseUploadClearFacePhoto"));
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };

  const handleEditAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editMember) return;
    setIsVerifyingFace(true);
    setFaceError(null);
    setFaceVerified(false);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const imageData = ev.target?.result as string;
      const hasFace = await detectFace(imageData);
      if (hasFace) {
        setFaceVerified(true);
        setFaceError(null);
        setEditMember({ ...editMember, avatarUrl: imageData });
      } else {
        setFaceVerified(false);
        setFaceError(t("pleaseUploadClearFacePhoto"));
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };
  
  const handleServiceToggle = (serviceId: string) => {
    const current = newMember.skillsets;
    const isSelected = current.includes(serviceId);
    
    if (isSelected) {
      // Deselect
      setNewMember({ ...newMember, skillsets: current.filter((s) => s !== serviceId) });
    } else {
      // Select - and handle Lite/Elite mutual exclusivity
      let updated = [...current, serviceId];
      const baseName = serviceId.replace(" Lite", "").replace(" Elite", "");
      const isLite = serviceId.includes("Lite");
      const isElite = serviceId.includes("Elite");
      
      if (isLite || isElite) {
        const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
        updated = updated.filter(s => s !== oppositeId);
      }
      setNewMember({ ...newMember, skillsets: updated });
    }
  };
  
  const minRate = 15;
  const maxRate = 60;

  const { data: team, isLoading: teamLoading } = useQuery<WorkerTeam | null>({
    queryKey: ["/api/worker-team"],
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/worker-team", team?.id, "members"],
    enabled: !!team?.id,
    queryFn: async () => {
      if (!team?.id) return [];
      const res = await apiRequest("GET", `/api/worker-team/${team.id}/members`);
      return res.json();
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/worker-team", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-team"] });
      toast({ title: t("teamCreated"), description: t("businessOperatorTeamReady") });
    },
    onError: (error: any) => {
      console.error("Failed to create team:", error);
      const errorMessage = error?.message || t("failedToCreateTeam");
      let userMessage = t("failedToCreateBusinessOperatorTeam");
      
      // Provide specific error messages for common issues
      if (errorMessage.includes("connect to server") || errorMessage.includes("Connection refused")) {
        userMessage = t("unableToConnectToServer");
      } else if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
        userMessage = t("notAuthorizedToCreateTeam");
      } else if (errorMessage.includes("403") || errorMessage.includes("Forbidden")) {
        userMessage = t("noPermissionToCreateTeam");
      } else if (errorMessage.includes("409") || errorMessage.includes("already exists")) {
        userMessage = t("teamAlreadyExists");
      } else if (errorMessage) {
        userMessage = errorMessage;
      }
      
      toast({ 
        title: t("errorCreatingTeam"), 
        description: userMessage,
        variant: "destructive" 
      });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (data: typeof newMember) => {
      const res = await apiRequest("POST", `/api/worker-team/${team?.id}/members`, data);
      return res.json();
    },
    onSuccess: () => {
      // Only run default success handler for the wizard flow (when addMemberOpen is true)
      // The invite flow handles its own success via mutateAsync
      if (addMemberOpen) {
        queryClient.invalidateQueries({ queryKey: ["/api/worker-team", team?.id, "members"] });
        setAddMemberOpen(false);
        resetNewMember();
        toast({ title: t("teamMemberAdded"), description: t("newTeamMemberAddedSuccessfully") });
      } else {
        // For invite flow, just invalidate queries - the invite flow handles the rest
        queryClient.invalidateQueries({ queryKey: ["/api/worker-team", team?.id, "members"] });
      }
    },
    onError: (error: any) => {
      console.error("Failed to add team member:", error);
      const errorMessage = error?.message || t("failedToAddTeamMember");
      let userMessage = t("failedToAddTeamMemberMessage");
      
      if (errorMessage.includes("connect to server") || errorMessage.includes("Connection refused")) {
        userMessage = t("unableToConnectToServer");
      } else if (errorMessage) {
        userMessage = errorMessage;
      }
      
      toast({ 
        title: tCommon("error"), 
        description: userMessage,
        variant: "destructive" 
      });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TeamMember> }) => {
      return apiRequest("PATCH", `/api/worker-team/members/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-team", team?.id, "members"] });
      setEditMember(null);
      toast({ title: t("updated"), description: t("teamMemberUpdatedSuccessfully") });
    },
    onError: (error: any) => {
      console.error("Failed to update team member:", error);
      const errorMessage = error?.message || t("failedToUpdateTeamMember");
      let userMessage = t("failedToUpdateTeamMemberInformation");
      
      if (errorMessage.includes("connect to server") || errorMessage.includes("Connection refused")) {
        userMessage = t("unableToConnectToServer");
      } else if (errorMessage) {
        userMessage = errorMessage;
      }
      
      toast({ 
        title: tCommon("error"), 
        description: userMessage,
        variant: "destructive" 
      });
    },
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/worker-team/members/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-team", team?.id, "members"] });
      toast({ title: t("removed"), description: t("teamMemberRemoved") });
    },
    onError: (error: any) => {
      console.error("Failed to delete team member:", error);
      const errorMessage = error?.message || t("failedToRemoveTeamMember");
      let userMessage = t("failedToRemoveTeamMemberMessage");
      
      if (errorMessage.includes("connect to server") || errorMessage.includes("Connection refused")) {
        userMessage = t("unableToConnectToServer");
      } else if (errorMessage) {
        userMessage = errorMessage;
      }
      
      toast({ 
        title: tCommon("error"), 
        description: userMessage,
        variant: "destructive" 
      });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (memberId: number) => {
      return apiRequest("POST", `/api/worker-team/members/${memberId}/resend-invite`);
    },
    onSuccess: () => {
      toast({ title: t("invitationResent"), description: t("newInvitationEmailSent") });
    },
    onError: (error: any) => {
      console.error("Failed to resend invite:", error);
      const errorMessage = error?.message || t("failedToResendInvitation");
      let userMessage = t("failedToResendInvitationMessage");
      
      if (errorMessage.includes("connect to server") || errorMessage.includes("Connection refused")) {
        userMessage = t("unableToConnectToServer");
      } else if (errorMessage) {
        userMessage = errorMessage;
      }
      
      toast({ 
        title: tCommon("error"), 
        description: userMessage,
        variant: "destructive" 
      });
    },
  });

  const autoAcceptInviteMutation = useMutation({
    mutationFn: async (memberId: number) => {
      return apiRequest("POST", `/api/worker-team/members/${memberId}/auto-accept`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-team", team?.id, "members"] });
      toast({ title: t("invitationAccepted"), description: t("teamMemberNowActiveDevMode") });
    },
    onError: () => {
      toast({ title: tCommon("error"), description: t("failedToAutoAcceptInvitation"), variant: "destructive" });
    },
  });

  const handleImpersonateTeamMember = async (teamMemberId: number) => {
    try {
      const res = await apiRequest("POST", `/api/dev/impersonate-team-member/${teamMemberId}`);
      if (res.ok) {
        const data = await res.json();
        toast({ title: t("impersonatingTeamMember"), description: t("viewingAs", { name: data.impersonating }) });
        // Invalidate all queries and redirect to dashboard
        queryClient.clear();
        window.location.href = "/dashboard";
      } else {
        const error = await res.json();
        toast({ title: tCommon("error"), description: error.message || t("failedToImpersonateTeamMember"), variant: "destructive" });
      }
    } catch (error) {
      toast({ title: tCommon("error"), description: t("failedToImpersonateTeamMember"), variant: "destructive" });
    }
  };

  const getInviteLink = (member: TeamMember) => {
    if (!member.inviteToken) return null;
    return `${window.location.origin}/team/join/${member.inviteToken}`;
  };

  const copyInviteLink = async (member: TeamMember) => {
    const link = getInviteLink(member);
    if (!link) return;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("joinMembersTeam", { firstName: member.firstName }),
          text: t("invitedToJoinAsTeamMember"),
          url: link,
        });
      } catch (err) {
        // User cancelled or share failed, fall back to copy
        await navigator.clipboard.writeText(link);
        toast({ title: t("linkCopied"), description: t("onboardingLinkCopiedToClipboard") });
      }
    } else {
      await navigator.clipboard.writeText(link);
      toast({ title: t("linkCopied"), description: t("onboardingLinkCopiedToClipboard") });
    }
  };

  const resetNewMember = () => {
    setNewMember({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      role: "employee",
      hourlyRate: 15,
      skillsets: [],
      avatarUrl: "",
    });
    setAvatarPreview(null);
    setFaceVerified(false);
    setFaceError(null);
    setWizardStep(0);
  };
  
  const canProceedStep = (step: number): boolean => {
    switch (step) {
      case 0:
        return !!newMember.firstName && !!newMember.lastName && !!newMember.email && !!newMember.phone && faceVerified;
      case 1:
        return !!newMember.address && !!newMember.city && !!newMember.state && !!newMember.zipCode;
      case 2:
        return true;
      case 3:
        return newMember.skillsets.length > 0;
      default:
        return false;
    }
  };
  
  const nextWizardStep = () => {
    if (wizardStep < WIZARD_STEPS.length - 1) {
      setWizardStep(wizardStep + 1);
    }
  };
  
  const prevWizardStep = () => {
    if (wizardStep > 0) {
      setWizardStep(wizardStep - 1);
    }
  };

  const handleSkillToggle = (skillId: string, isEdit = false) => {
    if (isEdit && editMember) {
      const current = editMember.skillsets || [];
      const updated = current.includes(skillId)
        ? current.filter((s) => s !== skillId)
        : [...current, skillId];
      setEditMember({ ...editMember, skillsets: updated });
    } else {
      const current = newMember.skillsets;
      const updated = current.includes(skillId)
        ? current.filter((s) => s !== skillId)
        : [...current, skillId];
      setNewMember({ ...newMember, skillsets: updated });
    }
  };

  // Toggle skillset with Lite/Elite mutual exclusivity for team member dialog
  const toggleSkillsetCategory = (category: string) => {
    if (!skillsetMember) return;
    
    const current = skillsetMember.skillsets || [];
    
    if (current.includes(category)) {
      setSkillsetMember({ ...skillsetMember, skillsets: current.filter((c) => c !== category) });
      return;
    }
    
    // Handle Lite/Elite mutual exclusivity
    const baseName = category.replace(" Lite", "").replace(" Elite", "");
    const isLite = category.includes("Lite");
    const isElite = category.includes("Elite");
    
    if (isLite || isElite) {
      const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
      setSkillsetMember({ ...skillsetMember, skillsets: [...current.filter((c) => c !== oppositeId), category] });
    } else {
      setSkillsetMember({ ...skillsetMember, skillsets: [...current, category] });
    }
  };

  // Get all skill categories flattened for the skillset dialog
  const allSkillCategories = [
    ...SERVICE_CATEGORIES.general,
    ...SERVICE_CATEGORIES.carpentry,
    ...SERVICE_CATEGORIES.electrical,
    ...SERVICE_CATEGORIES.plumbing,
    ...SERVICE_CATEGORIES.hvac,
  ];

  const isLoading = teamLoading || membersLoading;
  const hasTeam = !!team;
  const hasMembers = members.length > 0;
  const showIntro = !hasTeam;

  if (isLoading) {
    return (
      <div className={embedded ? "py-8 flex justify-center" : "min-h-screen flex items-center justify-center"}>
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const main = (
    <div className={embedded ? "space-y-6" : `p-4 max-w-4xl mx-auto ${isMobile ? 'pb-24' : ''}`}>
        {showIntro ? (
          <div className="space-y-6">
            <div className="text-center space-y-4 py-8">
              <div className="w-20 h-20 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center">
                <Briefcase className="w-10 h-10 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-2xl font-bold">{t("becomeABusinessOperator")}</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                {t("becomeABusinessOperatorDescription")}
              </p>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">{t("buildYourTeam")}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t("buildYourTeamDescription")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <DollarSign className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">{t("setIndividualRates")}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t("setIndividualRatesDescription")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                    <Wrench className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">{t("expandedJobMatching")}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t("expandedJobMatchingDescription")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Briefcase className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">{t("allPaymentsToYou")}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t("allPaymentsToYouDescription")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button 
              className="w-full" 
              size="lg"
              onClick={() => createTeamMutation.mutate()}
              disabled={createTeamMutation.isPending}
              data-testid="button-get-started"
            >
              {createTeamMutation.isPending ? t("creating") : t("getStarted")}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-semibold">{t("yourTeam")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("teamMemberCount", { count: members.length })} - {t("manageYourCrewAndRates")}
                </p>
              </div>
              {!isMobile && (
                <div className="flex items-center gap-3">
                  <Button 
                    onClick={() => {
                      setInviteOpen(true);
                      setInviteStep(0);
                      setNewInviteMember({
                        firstName: "",
                        lastName: "",
                        hourlyRate: 15,
                        email: "",
                        phone: "",
                        role: "employee",
                      });
                      setCreatedInviteMember(null);
                    }} 
                    data-testid="button-send-invite-desktop"
                    variant="outline"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {t("sendInvite") || "Send Invite"}
                  </Button>
                  <Button onClick={() => setAddMemberOpen(true)} data-testid="button-add-member">
                    <Plus className="w-4 h-4 mr-2" />
                    {t("addTeamMember")}
                  </Button>
                </div>
              )}
            </div>


            {members.length > 0 ? (
              <>
                {/* Mobile / narrow view: cards with wrapping (no horizontal scroll) */}
                <div className="lg:hidden space-y-3">
                  {members.map((member) => {
                    const hasLiveLocation = member.liveLocationLat && member.liveLocationLng;
                    const hasStaticLocation = member.latitude && member.longitude;
                    const locationTimestamp = member.liveLocationTimestamp 
                      ? new Date(member.liveLocationTimestamp) 
                      : null;
                    const isLocationRecent = locationTimestamp 
                      ? (new Date().getTime() - locationTimestamp.getTime()) < 5 * 60 * 1000
                      : false;
                    
                    let locationMapUrl = null;
                    let locationColor = null;
                    let locationLabel = "";
                    
                    if (hasLiveLocation && isLocationRecent) {
                      locationColor = "green";
                      locationLabel = "Current location";
                      locationMapUrl = import.meta.env.VITE_GOOGLE_API_KEY
                        ? `https://maps.googleapis.com/maps/api/staticmap?center=${member.liveLocationLat},${member.liveLocationLng}&zoom=14&size=56x56&scale=2&markers=icon:https://chart.googleapis.com/chart?chst=d_map_pin_letter%26chld=%E2%80%A2%7C4CAF50%7C${member.liveLocationLat},${member.liveLocationLng}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
                        : null;
                    } else if (hasStaticLocation) {
                      locationColor = "amber";
                      locationLabel = "Work location";
                      locationMapUrl = import.meta.env.VITE_GOOGLE_API_KEY
                        ? `https://maps.googleapis.com/maps/api/staticmap?center=${member.latitude},${member.longitude}&zoom=13&size=56x56&scale=2&markers=color:orange%7C${member.latitude},${member.longitude}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
                        : null;
                    }
                    
                    return (
                    <Card key={member.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            {/* Location indicator */}
                            {locationMapUrl && (
                              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                <div className={`relative w-12 h-12 rounded-lg overflow-hidden border-2 ${locationColor === "green" ? "border-green-500/50" : "border-amber-500/50"} shadow-sm`}>
                                  <img src={locationMapUrl} alt={locationLabel} className="w-full h-full object-cover" />
                                  <div className={`absolute bottom-0.5 right-0.5 w-2.5 h-2.5 ${locationColor === "green" ? "bg-green-500" : "bg-amber-500"} rounded-full border border-white ${locationColor === "green" ? "animate-pulse" : ""}`} />
                                </div>
                                <span className={`text-[9px] font-medium ${locationColor === "green" ? "text-green-600" : "text-amber-600"}`}>
                                  {locationColor === "green" ? "Live" : "Work"}
                                </span>
                              </div>
                            )}
                            <Avatar className="w-12 h-12 flex-shrink-0">
                              <AvatarImage src={member.avatarUrl || undefined} />
                              <AvatarFallback>
                                {member.firstName?.[0]}{member.lastName?.[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium text-sm">{member.firstName} {member.lastName}</p>
                                {member.status === "pending" && (
                                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {t("pending")}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant={member.role === "admin" ? "default" : "secondary"} className="text-xs">
                                  {member.role === "admin" ? (
                                    <Shield className="w-3 h-3 mr-1" />
                                  ) : (
                                    <UserIcon className="w-3 h-3 mr-1" />
                                  )}
                                  {member.role === "admin" ? t("admin") : t("employee")}
                                </Badge>
                                <span className="text-sm font-medium">${member.hourlyRate}<span className="text-muted-foreground">/hr</span></span>
                              </div>
                              {member.skillsets && member.skillsets.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {member.skillsets.slice(0, 3).map((skill) => (
                                    <Badge key={skill} variant="outline" className="text-xs">
                                      {SKILL_OPTIONS.find((s) => s.id === skill)?.label || skill}
                                    </Badge>
                                  ))}
                                  {member.skillsets.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{member.skillsets.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}
                              <div className="space-y-1 text-xs text-muted-foreground">
                                {(member.city || member.state) && (
                                  <p className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {[member.city, member.state].filter(Boolean).join(", ")}
                                  </p>
                                )}
                                {member.email && (
                                  <p className="flex items-center gap-1">
                                    <Mail className="w-3 h-3" />
                                    {member.email}
                                  </p>
                                )}
                                {member.phone && (
                                  <p className="flex items-center gap-1">
                                    <Phone className="w-3 h-3" />
                                    {member.phone}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="flex-shrink-0" data-testid={`button-member-menu-${member.id}`}>
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={(e) => {
                                e.preventDefault();
                                // Immediately set state without setTimeout for cleaner overlay management
                                setFaceError(null);
                                setFaceVerified(!!member.avatarUrl);
                                setEditMember(member);
                              }} data-testid={`menu-edit-${member.id}`}>
                                <Edit2 className="w-4 h-4 mr-2" />
                                {tCommon("edit")}
                              </DropdownMenuItem>
                              
                              {member.status === "pending" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={() => copyInviteLink(member)}
                                    data-testid={`menu-copy-link-${member.id}`}
                                  >
                                    <Link className="w-4 h-4 mr-2" />
                                    {t("shareOnboardingLink")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => resendInviteMutation.mutate(member.id)}
                                    disabled={resendInviteMutation.isPending}
                                    data-testid={`menu-resend-${member.id}`}
                                  >
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    {t("resendInvitation")}
                                  </DropdownMenuItem>
                                  {import.meta.env.DEV && (
                                    <DropdownMenuItem 
                                      onClick={() => autoAcceptInviteMutation.mutate(member.id)}
                                      disabled={autoAcceptInviteMutation.isPending}
                                      className="text-amber-600"
                                      data-testid={`menu-auto-accept-${member.id}`}
                                    >
                                      <CheckCircle className="w-4 h-4 mr-2" />
                                      {t("autoAcceptDev")}
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                              
                              {import.meta.env.DEV && member.status === "active" && (
                                <DropdownMenuItem 
                                  onClick={() => handleImpersonateTeamMember(member.id)}
                                  className="text-purple-600"
                                  data-testid={`menu-impersonate-${member.id}`}
                                >
                                  <UserCog className="w-4 h-4 mr-2" />
                                  {t("impersonateDev")}
                                </DropdownMenuItem>
                              )}
                              
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => {
                                  if (confirm(t("removeThisTeamMember"))) {
                                    deleteMemberMutation.mutate(member.id);
                                  }
                                }}
                                className="text-destructive focus:text-destructive"
                                data-testid={`menu-delete-${member.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {t("remove")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                </div>

                {/* Desktop Table View: responsive, text wraps to container (no horizontal scroll) */}
                <Card className="hidden lg:block min-w-0">
                  <div className="min-w-0 [&>div]:!overflow-visible [&>div]:!min-w-0">
                    <Table className="table-fixed w-full max-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-0 w-[18%] break-words">{t("member")}</TableHead>
                          <TableHead className="min-w-0 w-[10%] break-words">{t("role")}</TableHead>
                          <TableHead className="min-w-0 w-[10%] break-words">{t("rate")}</TableHead>
                          <TableHead className="min-w-0 w-[20%] break-words">{t("skillsets")}</TableHead>
                          <TableHead className="min-w-0 w-[22%] break-words">{t("locationContact")}</TableHead>
                          <TableHead className="min-w-0 w-[10%] text-right break-words">{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((member) => {
                          const coords = getMemberLocationCoords(member);
                          const staticMapUrl = coords && import.meta.env.VITE_GOOGLE_API_KEY
                            ? `https://maps.googleapis.com/maps/api/staticmap?center=${coords.lat},${coords.lng}&zoom=14&size=48x48&scale=2&markers=color:green%7C${coords.lat},${coords.lng}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
                            : null;
                          return (
                          <TableRow key={member.id}>
                            <TableCell className="min-w-0 break-words align-top">
                              <div className="flex items-center gap-3 min-w-0">
                                {/* Location indicator with map card */}
                                {(() => {
                                  const hasLiveLocation = member.liveLocationLat && member.liveLocationLng;
                                  const hasStaticLocation = member.latitude && member.longitude;
                                  const locationTimestamp = member.liveLocationTimestamp 
                                    ? new Date(member.liveLocationTimestamp) 
                                    : null;
                                  const isLocationRecent = locationTimestamp 
                                    ? (new Date().getTime() - locationTimestamp.getTime()) < 5 * 60 * 1000 // 5 minutes
                                    : false;
                                  
                                  if (hasLiveLocation && isLocationRecent) {
                                    // Green - Live location is on and recent
                                    const mapUrl = import.meta.env.VITE_GOOGLE_API_KEY
                                      ? `https://maps.googleapis.com/maps/api/staticmap?center=${member.liveLocationLat},${member.liveLocationLng}&zoom=14&size=56x56&scale=2&markers=icon:https://chart.googleapis.com/chart?chst=d_map_pin_letter%26chld=%E2%80%A2%7C4CAF50%7C${member.liveLocationLat},${member.liveLocationLng}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
                                      : null;
                                    return (
                                      <div className="flex items-center gap-1.5 flex-shrink-0" title="Location on - Current location">
                                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-green-500/30 animate-pulse" aria-hidden />
                                        {mapUrl ? (
                                          <div className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-green-500/50 shadow-sm">
                                            <img src={mapUrl} alt="Current location" className="w-full h-full object-cover" />
                                            <div className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-green-500 rounded-full border border-white" />
                                          </div>
                                        ) : (
                                          <div className="w-14 h-14 rounded-xl border-2 border-green-500/50 bg-green-50 flex items-center justify-center">
                                            <MapPin className="w-5 h-5 text-green-600" />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  } else if (hasStaticLocation) {
                                    // Yellow - Has static location but no recent live location
                                    const mapUrl = import.meta.env.VITE_GOOGLE_API_KEY
                                      ? `https://maps.googleapis.com/maps/api/staticmap?center=${member.latitude},${member.longitude}&zoom=13&size=56x56&scale=2&markers=color:orange%7C${member.latitude},${member.longitude}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
                                      : null;
                                    return (
                                      <div className="flex items-center gap-1.5 flex-shrink-0" title="Work location - Location services off">
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/30" aria-hidden />
                                        {mapUrl ? (
                                          <div className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-amber-500/50 shadow-sm">
                                            <img src={mapUrl} alt="Work location" className="w-full h-full object-cover" />
                                            <div className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-amber-500 rounded-full border border-white" />
                                          </div>
                                        ) : (
                                          <div className="w-14 h-14 rounded-xl border-2 border-amber-500/50 bg-amber-50 flex items-center justify-center">
                                            <MapPin className="w-5 h-5 text-amber-600" />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                <Avatar className="w-10 h-10">
                                  <AvatarImage src={member.avatarUrl || undefined} />
                                  <AvatarFallback>
                                    {member.firstName?.[0]}{member.lastName?.[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-medium break-words">{member.firstName} {member.lastName}</p>
                                    {member.status === "pending" && (
                                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                                        <Clock className="w-3 h-3 mr-1" />
                                        {t("pending")}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="min-w-0 break-words align-top">
                              <Badge variant={member.role === "admin" ? "default" : "secondary"}>
                                {member.role === "admin" ? (
                                  <Shield className="w-3 h-3 mr-1" />
                                ) : (
                                  <UserIcon className="w-3 h-3 mr-1" />
                                )}
                                {member.role === "admin" ? t("admin") : t("employee")}
                              </Badge>
                            </TableCell>
                            <TableCell className="min-w-0 break-words align-top">
                              <span className="font-medium">${member.hourlyRate}</span>
                              <span className="text-muted-foreground">/hr</span>
                            </TableCell>
                            <TableCell className="min-w-0 break-words align-top">
                              <div className="flex flex-wrap gap-1 min-w-0">
                                {member.skillsets && member.skillsets.length > 0 ? (
                                  member.skillsets.slice(0, 3).map((skill) => (
                                    <Badge key={skill} variant="outline" className="text-xs">
                                      {SKILL_OPTIONS.find((s) => s.id === skill)?.label || skill}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-muted-foreground text-sm">{tCommon("none")}</span>
                                )}
                                {member.skillsets && member.skillsets.length > 3 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{member.skillsets.length - 3}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="min-w-0 break-words align-top">
                              <div className="text-sm space-y-0.5 min-w-0">
                                {(member.city || member.state) && (
                                  <p className="flex items-center gap-1 text-muted-foreground">
                                    <MapPin className="w-3 h-3" />
                                    {[member.city, member.state].filter(Boolean).join(", ")}
                                  </p>
                                )}
                                {member.email && (
                                  <p className="flex items-center gap-1 text-muted-foreground">
                                    <Mail className="w-3 h-3" />
                                    {member.email}
                                  </p>
                                )}
                                {member.phone && (
                                  <p className="flex items-center gap-1 text-muted-foreground">
                                    <Phone className="w-3 h-3" />
                                    {member.phone}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right min-w-0 align-top">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-member-menu-${member.id}`}>
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={(e) => {
                                    e.preventDefault();
                                    // Immediately set state without setTimeout for cleaner overlay management
                                    setFaceError(null);
                                    setFaceVerified(!!member.avatarUrl);
                                    setEditMember(member);
                                  }} data-testid={`menu-edit-${member.id}`}>
                                    <Edit2 className="w-4 h-4 mr-2" />
                                    {tCommon("edit")}
                                  </DropdownMenuItem>
                                  
                                  {member.status === "pending" && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem 
                                        onClick={() => copyInviteLink(member)}
                                        data-testid={`menu-copy-link-${member.id}`}
                                      >
                                        <Link className="w-4 h-4 mr-2" />
                                        {t("shareOnboardingLink")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => resendInviteMutation.mutate(member.id)}
                                        disabled={resendInviteMutation.isPending}
                                        data-testid={`menu-resend-${member.id}`}
                                      >
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        {t("resendInvitation")}
                                      </DropdownMenuItem>
                                      {import.meta.env.DEV && (
                                        <DropdownMenuItem 
                                          onClick={() => autoAcceptInviteMutation.mutate(member.id)}
                                          disabled={autoAcceptInviteMutation.isPending}
                                          className="text-amber-600"
                                          data-testid={`menu-auto-accept-${member.id}`}
                                        >
                                          <CheckCircle className="w-4 h-4 mr-2" />
                                          {t("autoAcceptDev")}
                                        </DropdownMenuItem>
                                      )}
                                    </>
                                  )}
                                  
                                  {import.meta.env.DEV && member.status === "active" && (
                                    <DropdownMenuItem 
                                      onClick={() => handleImpersonateTeamMember(member.id)}
                                      className="text-purple-600"
                                      data-testid={`menu-impersonate-${member.id}`}
                                    >
                                      <UserCog className="w-4 h-4 mr-2" />
                                      {t("impersonateDev")}
                                    </DropdownMenuItem>
                                  )}
                                  
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={() => {
                                      if (confirm(t("removeThisTeamMember"))) {
                                        deleteMemberMutation.mutate(member.id);
                                      }
                                    }}
                                    className="text-destructive focus:text-destructive"
                                    data-testid={`menu-delete-${member.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    {t("remove")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t("noTeamMembersYet")}</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("addFirstTeamMemberDescription")}
                  </p>
                  <Button onClick={() => setAddMemberOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t("addFirstMember")}
                  </Button>
                </CardContent>
              </Card>
            )}

          </div>
        )}
    </div>
  );

  const dialogs = (
    <>
      {/* Payment Flow Info Pop-up */}
      <MobilePopup
        open={paymentFlowInfoOpen}
        onOpenChange={(open) => {
          setPaymentFlowInfoOpen(open);
          // Ensure proper cleanup when closing
          if (!open) {
            setTimeout(() => {
              const root = document.getElementById('root');
              if (root && root.getAttribute('aria-hidden') === 'true') {
                root.removeAttribute('aria-hidden');
              }
            }, 100);
          }
        }}
        title={t("paymentFlow")}
        description={t("paymentFlowDescription")}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                1
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t("paymentFlowStep1Title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("paymentFlowStep1Description")}
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                2
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t("paymentFlowStep2Title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("paymentFlowStep2Description")}
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                3
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t("paymentFlowStep3Title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("paymentFlowStep3Description")}
                </p>
              </div>
            </div>
          </div>
          
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {t("paymentFlowNote")}
            </p>
          </div>
        </div>
      </MobilePopup>

      {/* Onboarding Link Info Pop-up */}
      <MobilePopup
        open={onboardingLinkInfoOpen}
        onOpenChange={(open) => {
          setOnboardingLinkInfoOpen(open);
          // Ensure proper cleanup when closing nested pop-up
          if (!open) {
            // Small delay to ensure Dialog cleanup completes
            setTimeout(() => {
              // Force remove any lingering aria-hidden attributes
              const root = document.getElementById('root');
              if (root && root.getAttribute('aria-hidden') === 'true') {
                root.removeAttribute('aria-hidden');
              }
            }, 100);
          }
        }}
        title={t("shareableOnboardingLink")}
        description={t("onboardingLinkInfoDescription")}
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("onboardingLinkInfoExplanation")}
          </p>
          
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                1
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t("onboardingLinkStep1Title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("onboardingLinkStep1Description")}
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                2
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t("onboardingLinkStep2Title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("onboardingLinkStep2Description")}
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                3
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{t("onboardingLinkStep3Title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("onboardingLinkStep3Description")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </MobilePopup>

      <MobilePopup
        open={addMemberOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetNewMember();
            // Close any nested pop-ups when closing the main pop-up
            setOnboardingLinkInfoOpen(false);
          }
          setAddMemberOpen(open);
          // Ensure proper cleanup when closing
          if (!open) {
            setTimeout(() => {
              const root = document.getElementById('root');
              if (root && root.getAttribute('aria-hidden') === 'true') {
                root.removeAttribute('aria-hidden');
              }
            }, 100);
          }
        }}
        title={t("addTeamMember")}
        description={t("stepOfTotal", { step: wizardStep + 1, total: WIZARD_STEPS.length, stepName: WIZARD_STEPS[wizardStep] })}
        maxWidth="lg"
        headerContent={
          <div>
            <Progress value={((wizardStep + 1) / WIZARD_STEPS.length) * 100} className="h-2" />
            <div className="flex justify-between mt-2">
              {WIZARD_STEPS.map((step, i) => (
                <span 
                  key={step} 
                  className={`text-xs ${i <= wizardStep ? "text-primary font-medium" : "text-muted-foreground"}`}
                >
                  {i + 1}. {step}
                </span>
              ))}
            </div>
          </div>
        }
        footer={
          <>
            {/* Action Buttons Footer */}
            <MobilePopupFooter isMobile={isMobile}>
              <div className="flex justify-between gap-3">
                {wizardStep > 0 ? (
                  <Button variant="outline" onClick={prevWizardStep} data-testid="button-wizard-back" className="h-12 rounded-xl" style={{ width: '35%' }}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> {tCommon("back")}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setAddMemberOpen(false)} className="h-12 rounded-xl text-muted-foreground" style={{ width: '35%' }}>
                    {tCommon("cancel")}
                  </Button>
                )}
                
                {wizardStep < WIZARD_STEPS.length - 1 ? (
                  <Button 
                    onClick={nextWizardStep} 
                    disabled={!canProceedStep(wizardStep)}
                    data-testid="button-wizard-next"
                    className="h-12 text-base font-semibold rounded-xl shadow-lg"
                    style={{ width: '65%' }}
                  >
                    {tCommon("next")} <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => addMemberMutation.mutate(newMember)}
                    disabled={!canProceedStep(wizardStep) || addMemberMutation.isPending}
                    data-testid="button-send-invitation"
                    className="h-12 text-base font-semibold rounded-xl shadow-lg"
                    style={{ width: '65%' }}
                  >
                    {addMemberMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {tCommon("sending") || "Sending..."}
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        {t("sendInvitation")}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </MobilePopupFooter>
          </>
        }
      >
        <div className="space-y-4 pb-24">
              {wizardStep === 0 && (
                <>
                  <div className="flex flex-col items-center mb-6">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                      data-testid="input-avatar-upload"
                    />
                    <div 
                      className={`relative w-32 h-32 rounded-full border-4 cursor-pointer overflow-hidden ${
                        faceVerified ? "border-green-500" : faceError ? "border-red-500" : "border-dashed border-muted-foreground/50"
                      }`}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-muted">
                          <Camera className="w-8 h-8 text-muted-foreground mb-1" />
                          <span className="text-xs text-muted-foreground">{t("uploadPhoto")}</span>
                        </div>
                      )}
                      {isVerifyingFace && (
                        <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                          <Loader2 className="w-8 h-8 animate-spin" />
                        </div>
                      )}
                      {faceVerified && (
                        <div className="absolute bottom-0 right-0 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                          <CheckCircle className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </div>
                    {faceError && (
                      <p className="text-sm text-destructive mt-2 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" /> {faceError}
                      </p>
                    )}
                    {!avatarPreview && (
                      <p className="text-sm text-muted-foreground mt-2 text-center">
                        {t("clearFacePhotoRequired")}
                      </p>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">{t("firstName")} *</Label>
                      <Input
                        id="firstName"
                        value={newMember.firstName}
                        onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
                        placeholder={t("firstNamePlaceholder")}
                        data-testid="input-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">{t("lastName")} *</Label>
                      <Input
                        id="lastName"
                        value={newMember.lastName}
                        onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
                        placeholder={t("lastNamePlaceholder")}
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">{tCommon("email") || "Email"} *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newMember.email}
                      onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                      placeholder={t("emailPlaceholder")}
                      data-testid="input-email"
                    />
                    <p className="text-xs text-muted-foreground">{t("theyWillReceiveInvitation")}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">{tCommon("phone") || "Phone"} *</Label>
                    <Input
                      id="phone"
                      value={newMember.phone}
                      onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                      placeholder={t("phonePlaceholder")}
                      data-testid="input-phone"
                    />
                  </div>
                </>
              )}

              {wizardStep === 1 && (
                <>
                  <div className="space-y-2">
                    <GooglePlacesAutocomplete
                      id="input-address"
                      label={t("streetAddress")}
                      value={newMember.address || ""}
                      onChange={(address, components) => {
                        setNewMember({
                          ...newMember,
                          address: address,
                          city: components.city || newMember.city || "",
                          state: components.state || newMember.state || "",
                          zipCode: components.zipCode || newMember.zipCode || "",
                        });
                      }}
                      placeholder={t("streetAddressPlaceholder")}
                      required
                    />
                    <p className="text-xs text-muted-foreground">{t("whereTeamMemberIsBased")}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">{t("city")} *</Label>
                    <Input
                      id="city"
                      value={newMember.city}
                      onChange={(e) => setNewMember({ ...newMember, city: e.target.value })}
                      placeholder={t("cityPlaceholder")}
                      data-testid="input-city"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="state">{t("state")} *</Label>
                      <Input
                        id="state"
                        value={newMember.state}
                        onChange={(e) => setNewMember({ ...newMember, state: e.target.value })}
                        placeholder={t("statePlaceholder")}
                        data-testid="input-state"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zipCode">{t("zipCode")} *</Label>
                      <Input
                        id="zipCode"
                        value={newMember.zipCode}
                        onChange={(e) => setNewMember({ ...newMember, zipCode: e.target.value })}
                        placeholder={t("zipCodePlaceholder")}
                        data-testid="input-zip"
                      />
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("locationHelpsMatchJobs")}
                  </p>
                </>
              )}

              {wizardStep === 2 && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("chooseAccessLevel")}
                  </p>
                  <div className="space-y-3">
                    <div 
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        newMember.role === "employee" 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => setNewMember({ ...newMember, role: "employee" })}
                      data-testid="role-employee"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          newMember.role === "employee" ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}>
                          <UserIcon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{t("employee")}</h3>
                          <p className="text-sm text-muted-foreground">
                            {t("employeeDescription")}
                          </p>
                        </div>
                        {newMember.role === "employee" && (
                          <CheckCircle className="w-6 h-6 text-primary" />
                        )}
                      </div>
                    </div>

                    <div 
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        newMember.role === "admin" 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => setNewMember({ ...newMember, role: "admin" })}
                      data-testid="role-admin"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          newMember.role === "admin" ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}>
                          <Shield className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{t("admin")}</h3>
                          <p className="text-sm text-muted-foreground">
                            {t("adminDescription")}
                          </p>
                        </div>
                        {newMember.role === "admin" && (
                          <CheckCircle className="w-6 h-6 text-primary" />
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {wizardStep === 3 && (
                <>
                  <div className="text-center mb-6">
                    <span className="text-5xl font-bold">${newMember.hourlyRate}</span>
                    <span className="text-xl text-muted-foreground">/hr</span>
                  </div>
                  
                  <div className="mb-8">
                    <div className="relative h-12 rounded-full overflow-hidden bg-gradient-to-r from-green-500 via-yellow-500 to-red-500">
                      <Slider
                        value={[newMember.hourlyRate]}
                        onValueChange={([value]) => setNewMember({ ...newMember, hourlyRate: value })}
                        min={minRate}
                        max={maxRate}
                        step={1}
                        className="h-12 [&_[role=slider]]:h-10 [&_[role=slider]]:w-10 [&_[role=slider]]:border-4 [&_[role=slider]]:border-white [&_[role=slider]]:shadow-xl [&_[role=slider]]:bg-primary [&>span:first-child]:bg-transparent [&>span:first-child]:h-12"
                        data-testid="slider-hourly-rate"
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>${minRate}/hr</span>
                      <span>${maxRate}/hr</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-base font-semibold">{t("selectSkills")} *</Label>
                    <p className="text-sm text-muted-foreground -mt-2">
                      {t("chooseServicesTeamMemberCanPerform")}
                    </p>
                    
                    {Object.entries(SERVICE_CATEGORIES).map(([category, services]) => (
                      <div key={category} className="space-y-2">
                        <h4 className="text-sm font-medium capitalize text-muted-foreground">{category}</h4>
                        <div className="grid grid-cols-1 gap-2">
                          {services.map((service) => {
                            const Icon = service.icon;
                            const isSelected = newMember.skillsets.includes(service.id);
                            const isElite = (service as any).isElite;
                            return (
                              <div
                                key={service.id}
                                className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                  isSelected 
                                    ? isElite ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : "border-primary bg-primary/5"
                                    : "border-border hover:border-primary/50"
                                }`}
                                onClick={() => handleServiceToggle(service.id)}
                                data-testid={`skill-${service.id}`}
                              >
                                <div className="flex items-center gap-3">
                                  <Icon className={`w-5 h-5 ${isElite ? "text-amber-600" : ""}`} />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">{service.label}</span>
                                      {isElite && (
                                        <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700 border-amber-300">
                                          {t("elite")}
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{service.desc}</p>
                                  </div>
                                  {isSelected && <CheckCircle className="w-5 h-5 text-primary" />}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
        </div>
      </MobilePopup>

      <ResponsiveDialog
        open={!!editMember}
        onOpenChange={(open) => {
          if (!open) {
            setEditMember(null);
            setFaceError(null);
            setFaceVerified(false);
            // Cleanup any lingering overlays
            setTimeout(() => {
              const root = document.getElementById('root');
              if (root && root.getAttribute('aria-hidden') === 'true') {
                root.removeAttribute('aria-hidden');
              }
              // Remove any lingering overlay divs
              document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach(el => {
                if (el.parentElement && !el.querySelector('[data-state="open"]')) {
                  el.parentElement.style.display = 'none';
                }
              });
            }, 150);
          }
        }}
        title={editMember ? `Edit ${editMember.firstName} ${editMember.lastName}` : "Edit Teammate"}
        description={t("editTeamMemberAllFields")}
        contentClassName="sm:max-w-lg"
        primaryAction={{
          label: updateMemberMutation.isPending ? "Saving..." : "Save Changes",
          onClick: () => {
            if (editMember) {
              updateMemberMutation.mutate({
                id: editMember.id,
                data: {
                  firstName: editMember.firstName,
                  lastName: editMember.lastName,
                  email: editMember.email,
                  phone: editMember.phone,
                  address: editMember.address,
                  city: editMember.city,
                  state: editMember.state,
                  zipCode: editMember.zipCode,
                  role: editMember.role,
                  hourlyRate: editMember.hourlyRate,
                  skillsets: editMember.skillsets,
                  avatarUrl: editMember.avatarUrl ?? undefined,
                },
              });
            }
          },
          disabled: updateMemberMutation.isPending || !editMember?.firstName?.trim() || !editMember?.lastName?.trim(),
          icon: updateMemberMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : undefined,
          testId: "button-edit-save"
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => {
            setEditMember(null);
            setFaceError(null);
            setFaceVerified(false);
          },
          testId: "button-edit-cancel"
        }}
      >
        {editMember && (
          <ScrollArea className="max-h-[60vh] pr-4 -mr-4">
            <div className="space-y-5">
              {/* Avatar */}
              <div className="flex flex-col items-center">
                <input
                  ref={editAvatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleEditAvatarUpload}
                  className="hidden"
                  data-testid="input-edit-avatar-upload"
                />
                <div
                  className={`relative w-24 h-24 rounded-full border-4 cursor-pointer overflow-hidden flex-shrink-0 ${
                    faceVerified ? "border-green-500" : faceError ? "border-red-500" : "border-muted"
                  }`}
                  onClick={() => editAvatarInputRef.current?.click()}
                >
                  {editMember.avatarUrl ? (
                    <img src={editMember.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-muted">
                      <Camera className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  {isVerifyingFace && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  )}
                  {faceVerified && (
                    <div className="absolute bottom-0 right-0 w-7 h-7 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t("uploadPhoto")}</p>
                {faceError && (
                  <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> {faceError}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-firstName">{t("firstName")} *</Label>
                  <Input
                    id="edit-firstName"
                    value={editMember.firstName}
                    onChange={(e) => setEditMember({ ...editMember, firstName: e.target.value })}
                    placeholder={t("firstNamePlaceholder")}
                    data-testid="edit-input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-lastName">{t("lastName")} *</Label>
                  <Input
                    id="edit-lastName"
                    value={editMember.lastName}
                    onChange={(e) => setEditMember({ ...editMember, lastName: e.target.value })}
                    placeholder={t("lastNamePlaceholder")}
                    data-testid="edit-input-last-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-email">{tCommon("email")}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editMember.email ?? ""}
                  onChange={(e) => setEditMember({ ...editMember, email: e.target.value || null })}
                  placeholder={t("emailPlaceholder")}
                  data-testid="edit-input-email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-phone">{tCommon("phone")}</Label>
                <Input
                  id="edit-phone"
                  value={editMember.phone ?? ""}
                  onChange={(e) => setEditMember({ ...editMember, phone: e.target.value || null })}
                  placeholder={t("phonePlaceholder")}
                  data-testid="edit-input-phone"
                />
              </div>

              <div className="space-y-2">
                <GooglePlacesAutocomplete
                  id="edit-address"
                  label={t("streetAddress")}
                  value={editMember.address ?? ""}
                  onChange={(address, components) => {
                    setEditMember({
                      ...editMember,
                      address: address || null,
                      city: components.city ?? editMember.city ?? "",
                      state: components.state ?? editMember.state ?? "",
                      zipCode: components.zipCode ?? editMember.zipCode ?? "",
                    });
                  }}
                  placeholder={t("streetAddressPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("whereTeamMemberIsBased")}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-city">{t("city")}</Label>
                  <Input
                    id="edit-city"
                    value={editMember.city ?? ""}
                    onChange={(e) => setEditMember({ ...editMember, city: e.target.value || null })}
                    placeholder={t("cityPlaceholder")}
                    data-testid="edit-input-city"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-state">{t("state")}</Label>
                  <Input
                    id="edit-state"
                    value={editMember.state ?? ""}
                    onChange={(e) => setEditMember({ ...editMember, state: e.target.value || null })}
                    placeholder={t("statePlaceholder")}
                    data-testid="edit-input-state"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-zipCode">{t("zipCode")}</Label>
                <Input
                  id="edit-zipCode"
                  value={editMember.zipCode ?? ""}
                  onChange={(e) => setEditMember({ ...editMember, zipCode: e.target.value || null })}
                  placeholder={t("zipCodePlaceholder")}
                  data-testid="edit-input-zip"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("role")}</Label>
                <Select
                  value={editMember.role}
                  onValueChange={(v) => setEditMember({ ...editMember, role: v as "admin" | "employee" })}
                >
                  <SelectTrigger data-testid="edit-select-role" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">{t("employee")}</SelectItem>
                    <SelectItem value="admin">{t("admin")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {editMember.role === "admin" ? t("adminRoleDescription") : t("employeeRoleDescription")}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("hourlyRate")} *</Label>
                <Input
                  type="number"
                  min={15}
                  max={60}
                  value={editMember.hourlyRate}
                  onChange={(e) => setEditMember({ ...editMember, hourlyRate: Number(e.target.value) || 15 })}
                  data-testid="edit-input-hourly-rate"
                  className="h-11 text-lg"
                />
                <p className="text-xs text-muted-foreground">{t("setHourlyRateForTeamMember")}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">{t("skillsets")}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setSkillsetMember(editMember);
                      setSkillsetDialogOpen(true);
                    }}
                    data-testid="button-edit-skillsets"
                  >
                    <Edit2 className="w-4 h-4 mr-1" />
                    {tCommon("edit")}
                  </Button>
                </div>
                {editMember.skillsets && editMember.skillsets.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {editMember.skillsets.map((skill) => (
                      <Badge key={skill} variant="outline" className="text-xs">
                        {SKILL_OPTIONS.find((s) => s.id === skill)?.label || skill}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{tCommon("none")}</p>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </ResponsiveDialog>

      <MobilePopup
        open={skillsetDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (skillsetMember && editMember) {
              setEditMember({ ...editMember, skillsets: skillsetMember.skillsets });
            }
            setSkillsetDialogOpen(false);
            setSkillsetMember(null);
            // Ensure proper cleanup when closing
            setTimeout(() => {
              const root = document.getElementById('root');
              if (root && root.getAttribute('aria-hidden') === 'true') {
                root.removeAttribute('aria-hidden');
              }
            }, 100);
          }
        }}
        title={t("updateSkillsets")}
        description={t("selectSkillsThatMatchExperience")}
      >
          {skillsetMember && (
            <div className="space-y-4">
              {/* Team Member Avatar Header */}
              <div className="flex flex-col items-center py-4 border-b">
                <Avatar className="w-20 h-20 mb-3">
                  <AvatarImage src={skillsetMember.avatarUrl || undefined} />
                  <AvatarFallback className="text-xl">
                    {skillsetMember.firstName?.[0]}{skillsetMember.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <h3 className="font-semibold text-lg">
                  {skillsetMember.firstName} {skillsetMember.lastName}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("skillsSelected", { count: (skillsetMember.skillsets || []).length })}
                </p>
              </div>

              {/* Skills List */}
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
                {allSkillCategories.map((skill) => (
                  <div 
                    key={skill.id} 
                    className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      (skillsetMember.skillsets || []).includes(skill.id) 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:bg-muted/50'
                    }`}
                    onClick={() => toggleSkillsetCategory(skill.id)}
                    data-testid={`skillset-option-${skill.id}`}
                  >
                    <Checkbox
                      id={`member-skill-${skill.id}`}
                      checked={(skillsetMember.skillsets || []).includes(skill.id)}
                      onCheckedChange={() => toggleSkillsetCategory(skill.id)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={`member-skill-${skill.id}`} className="flex-1 cursor-pointer">
                      <span className="font-medium flex items-center gap-2">
                        {skill.label}
                        {(skill as any).isElite && (
                          <Badge variant="secondary" className="text-xs">{t("certified")}</Badge>
                        )}
                      </span>
                      <span className="text-sm text-muted-foreground block mt-0.5">{skill.desc}</span>
                    </Label>
                  </div>
                ))}
              </div>

              <Button
                className="w-full"
                onClick={() => {
                  if (skillsetMember && editMember) {
                    setEditMember({ ...editMember, skillsets: skillsetMember.skillsets });
                  }
                  setSkillsetDialogOpen(false);
                  setSkillsetMember(null);
                }}
                data-testid="button-save-skillsets"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {t("done")} ({(skillsetMember.skillsets || []).length} {t("selected")})
              </Button>
            </div>
          )}
      </MobilePopup>

      {/* Pinned Footer - Send Invite & Add New Buttons (Mobile Only) */}
      {isMobile && !showIntro && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
          <div className="p-4 max-w-4xl mx-auto">
            <div className="grid grid-cols-2 gap-3">
              <Button 
                onClick={() => {
                  setInviteOpen(true);
                  setInviteStep(0);
                  setNewInviteMember({
                    firstName: "",
                    lastName: "",
                    hourlyRate: 15,
                    email: "",
                    phone: "",
                    role: "employee",
                  });
                  setCreatedInviteMember(null);
                }} 
                data-testid="button-send-invite-mobile-footer"
                variant="outline"
                className="h-12 text-base font-semibold rounded-xl"
              >
                <Send className="w-5 h-5 mr-2" />
                {t("sendInvite")}
              </Button>
              <Button 
                onClick={() => setAddMemberOpen(true)} 
                data-testid="button-add-member-mobile-footer"
                className="h-12 text-base font-semibold rounded-xl shadow-lg"
              >
                <Plus className="w-5 h-5 mr-2" />
                {t("addNew")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Send Invite Dialog - Multi-step flow: Select Member -> Permissions & Rate -> Share Link */}
      <ResponsiveDialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            setInviteStep(0);
            setNewInviteMember({
              firstName: "",
              lastName: "",
              hourlyRate: 15,
              email: "",
              phone: "",
              role: "employee",
            });
            setCreatedInviteMember(null);
            setTimeout(() => {
              const root = document.getElementById('root');
              if (root && root.getAttribute('aria-hidden') === 'true') {
                root.removeAttribute('aria-hidden');
              }
            }, 100);
          }
        }}
        title={
          <div className="w-full">
            <div className="mb-3">
              {inviteStep === 0 ? t("teammateDetails") || "Teammate Details" :
               inviteStep === 1 ? t("reviewAndConfirm") || "Review & Confirm" :
               t("shareInviteLink") || "Share Invite Link"}
            </div>
            <div>
              <Progress value={((inviteStep + 1) / 3) * 100} className="h-2" />
              <div className="flex justify-between mt-2">
                <span className={`text-xs ${inviteStep >= 0 ? "text-primary font-medium" : "text-muted-foreground"}`}>
                  1. {t("teammateDetails") || "Details"}
                </span>
                <span className={`text-xs ${inviteStep >= 1 ? "text-primary font-medium" : "text-muted-foreground"}`}>
                  2. {t("review") || "Review"}
                </span>
                <span className={`text-xs ${inviteStep >= 2 ? "text-primary font-medium" : "text-muted-foreground"}`}>
                  3. {t("shareLink")}
                </span>
              </div>
            </div>
          </div>
        }
        description={
          inviteStep === 0 ? t("enterTeammateDetails") || "Enter your teammate's information" :
          inviteStep === 1 ? t("reviewTeammateDetails") || "Review the details before creating the invite" :
          t("shareInviteLinkDescription") || "Share the onboarding link with your teammate"
        }
        contentClassName="sm:max-w-lg"
        footer={
          inviteStep === 0 ? (
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setInviteOpen(false);
                  setInviteStep(0);
                  setNewInviteMember({
                    firstName: "",
                    lastName: "",
                    hourlyRate: 15,
                    email: "",
                    phone: "",
                    role: "employee",
                  });
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (newInviteMember.firstName && newInviteMember.lastName && newInviteMember.hourlyRate && newInviteMember.email && newInviteMember.phone) {
                    setInviteStep(1);
                  }
                }}
                disabled={!newInviteMember.firstName || !newInviteMember.lastName || !newInviteMember.hourlyRate || !newInviteMember.email || !newInviteMember.phone}
              >
                {tCommon("next")}
              </Button>
            </div>
          ) : inviteStep === 1 ? (
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setInviteStep(0);
                }}
              >
                {tCommon("back")}
              </Button>
              <Button
                onClick={async () => {
                  if (team?.id) {
                    try {
                      const createdMember = await addMemberMutation.mutateAsync({
                        firstName: newInviteMember.firstName,
                        lastName: newInviteMember.lastName,
                        email: newInviteMember.email,
                        phone: newInviteMember.phone,
                        address: "",
                        city: "",
                        state: "",
                        zipCode: "",
                        role: newInviteMember.role,
                        hourlyRate: newInviteMember.hourlyRate,
                        skillsets: [],
                        avatarUrl: "",
                      });
                      
                      // Use the member returned directly from the API response
                      if (createdMember && createdMember.id) {
                        // Invalidate queries to refresh the list
                        queryClient.invalidateQueries({ queryKey: ["/api/worker-team", team.id, "members"] });
                        
                        // Set the created member and move to next step
                        setCreatedInviteMember(createdMember);
                        setInviteStep(2);
                      } else {
                        // If member data is invalid, show error
                        toast({ 
                          title: tCommon("error"), 
                          description: t("failedToCreateTeamMember") || "Failed to create team member - invalid response",
                          variant: "destructive" 
                        });
                      }
                    } catch (error: any) {
                      console.error("Error creating team member:", error);
                      // The mutation's onError handler will show the toast, but we ensure it's displayed
                      const errorMessage = error?.message || t("failedToCreateTeamMember") || "Failed to create team member";
                      toast({ 
                        title: tCommon("error"), 
                        description: errorMessage,
                        variant: "destructive" 
                      });
                    }
                  }
                }}
                disabled={addMemberMutation.isPending}
              >
                {addMemberMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("createAndContinue") || "Create & Continue"}
              </Button>
            </div>
          ) : (
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setInviteStep(1);
                }}
              >
                {tCommon("back")}
              </Button>
              <Button
                onClick={() => {
                  setInviteOpen(false);
                  setInviteStep(0);
                  setNewInviteMember({
                    firstName: "",
                    lastName: "",
                    hourlyRate: 15,
                    email: "",
                    phone: "",
                    role: "employee",
                  });
                  setCreatedInviteMember(null);
                }}
              >
                {tCommon("close")}
              </Button>
            </div>
          )
        }
      >
        <div className="space-y-4">
          {/* Step 0: Teammate Details Form */}
          {inviteStep === 0 && (
            <div className="space-y-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">{t("firstName") || "First Name"} *</Label>
                    <Input
                      type="text"
                      value={newInviteMember.firstName}
                      onChange={(e) => setNewInviteMember({ ...newInviteMember, firstName: e.target.value })}
                      placeholder={t("enterFirstName") || "Enter first name"}
                      className="h-12"
                      data-testid="invite-input-first-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">{t("lastName") || "Last Name"} *</Label>
                    <Input
                      type="text"
                      value={newInviteMember.lastName}
                      onChange={(e) => setNewInviteMember({ ...newInviteMember, lastName: e.target.value })}
                      placeholder={t("enterLastName") || "Enter last name"}
                      className="h-12"
                      data-testid="invite-input-last-name"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("hourlyRate")} *</Label>
                  <Input
                    type="number"
                    min="15"
                    max="60"
                    value={newInviteMember.hourlyRate}
                    onChange={(e) => setNewInviteMember({ ...newInviteMember, hourlyRate: Number(e.target.value) })}
                    placeholder="25"
                    className="h-12 text-lg"
                    data-testid="invite-input-hourly-rate"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("setHourlyRateForTeamMember")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("email") || "Email"} *</Label>
                  <Input
                    type="email"
                    value={newInviteMember.email}
                    onChange={(e) => setNewInviteMember({ ...newInviteMember, email: e.target.value })}
                    placeholder={t("enterEmail") || "Enter email address"}
                    className="h-12"
                    data-testid="invite-input-email"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("setupEmailWillBeSent") || "A setup email will be sent to this address after creating the invite"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("phone") || "Phone"} *</Label>
                  <Input
                    type="tel"
                    value={newInviteMember.phone}
                    onChange={(e) => setNewInviteMember({ ...newInviteMember, phone: e.target.value })}
                    placeholder={t("enterPhone") || "Enter phone number"}
                    className="h-12"
                    data-testid="invite-input-phone"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t("role")} *</Label>
                  <Select
                    value={newInviteMember.role}
                    onValueChange={(v) => setNewInviteMember({ ...newInviteMember, role: v as "admin" | "employee" })}
                  >
                    <SelectTrigger data-testid="invite-select-role" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">{t("employee")}</SelectItem>
                      <SelectItem value="admin">{t("admin")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {newInviteMember.role === "admin" 
                      ? t("adminRoleDescription") 
                      : t("employeeRoleDescription")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Review & Confirm */}
          {inviteStep === 1 && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                  {t("reviewDetails") || "Review the details before creating the invite"}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">{t("name") || "Name"}:</span>
                  <span className="text-sm font-semibold">{newInviteMember.firstName} {newInviteMember.lastName}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">{t("hourlyRate")}:</span>
                  <span className="text-sm font-semibold">${newInviteMember.hourlyRate}/hr</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">{t("email") || "Email"}:</span>
                  <span className="text-sm font-semibold">{newInviteMember.email}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">{t("phone") || "Phone"}:</span>
                  <span className="text-sm font-semibold">{newInviteMember.phone}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-muted-foreground">{t("role")}:</span>
                  <Badge variant={newInviteMember.role === "admin" ? "default" : "secondary"}>
                    {newInviteMember.role === "admin" ? t("admin") : t("employee")}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Share Link */}
          {inviteStep === 2 && createdInviteMember && createdInviteMember.inviteToken && (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm text-green-900 dark:text-green-100">
                      {t("readyToShare")}
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                      {t("teamMemberCreatedSuccessfully") || "Team member created successfully"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pb-4 border-b">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={createdInviteMember.avatarUrl || undefined} />
                  <AvatarFallback>
                    {createdInviteMember.firstName?.[0]}{createdInviteMember.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{createdInviteMember.firstName} {createdInviteMember.lastName}</p>
                  {createdInviteMember.email && (
                    <div className="flex items-center gap-2 mt-1">
                      <Mail className="w-3 h-3 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{createdInviteMember.email}</p>
                    </div>
                  )}
                </div>
                {createdInviteMember.email && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (createdInviteMember.id) {
                        resendInviteMutation.mutate(createdInviteMember.id);
                      }
                    }}
                    disabled={resendInviteMutation.isPending}
                    className="flex-shrink-0"
                    data-testid="button-resend-email-invite"
                  >
                    {resendInviteMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4 mr-2" />
                    )}
                    {t("resendEmail") || "Resend Email"}
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">{t("shareableOnboardingLink")}</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setOnboardingLinkInfoOpen(true)}
                    data-testid="button-onboarding-link-info-invite"
                  >
                    <Info className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  {t("onboardingLinkInfoDescription")}
                </p>
                <div className="flex items-center gap-3 bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/20 dark:to-green-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl px-4 py-4 shadow-sm">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Link className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={getOnboardingUrl(createdInviteMember)}
                    className="flex-1 min-w-0 bg-transparent text-sm font-mono truncate outline-none text-gray-900 dark:text-gray-100"
                    data-testid="input-onboarding-link-invite"
                  />
                  <Button
                    variant="default"
                    size="icon"
                    className="h-10 w-10 flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={async () => {
                      const link = getOnboardingUrl(createdInviteMember);
                      if (link) {
                        try {
                          // Use Web Share API if available (works on both mobile and desktop)
                          if (navigator.share) {
                            await navigator.share({
                              title: t("joinMembersTeam", { firstName: createdInviteMember.firstName }) || `Join ${createdInviteMember.firstName}'s team`,
                              text: t("invitedToJoinAsTeamMember") || "You've been invited to join as a team member",
                              url: link,
                            });
                            toast({ title: t("linkCopied") || "Shared successfully", description: t("onboardingLinkCopiedToClipboard") });
                          } else {
                            // Fall back to clipboard copy
                            await navigator.clipboard.writeText(link);
                            toast({ title: t("linkCopied"), description: t("onboardingLinkCopiedToClipboard") });
                          }
                        } catch (err: any) {
                          // User cancelled share or share failed, fall back to copy
                          if (err.name !== 'AbortError') {
                            try {
                              await navigator.clipboard.writeText(link);
                              toast({ title: t("linkCopied"), description: t("onboardingLinkCopiedToClipboard") });
                            } catch (copyErr) {
                              console.error("Failed to copy link:", copyErr);
                            }
                          }
                        }
                      }
                    }}
                    data-testid="button-share-onboarding-link-invite"
                  >
                    <Share2 className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ResponsiveDialog>
    </>
  );

  if (embedded) {
    return (
      <>
        {main}
        {dialogs}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard?tab=menu")} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-semibold">{t("businessOperator")}</h1>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setPaymentFlowInfoOpen(true)} className="text-muted-foreground hover:text-foreground" data-testid="button-payment-flow-info">
            <Info className="w-5 h-5" />
          </Button>
        </div>
      </header>
      <main>{main}</main>
      {dialogs}
    </div>
  );
}

export default function BusinessOperator() {
  return <BusinessOperatorContent />;
}
