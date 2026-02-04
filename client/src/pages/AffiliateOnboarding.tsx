import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, fetchAffiliateMe } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronLeft, ChevronDown, Link2, BarChart3, CheckCircle2, Loader2, User, FileText, DollarSign, Shield, TrendingUp, Pen } from "lucide-react";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 3;

const AFFILIATE_AGREEMENT = `AFFILIATE PROGRAM AGREEMENT

This Affiliate Program Agreement ("Agreement") is entered into between you ("Affiliate") and Tolstoy Staffing ("Company") for participation in the Tolstoy Staffing Affiliate Program.

1. COMMISSION
- URL-based and Sales affiliates earn 20% of net profit from company jobs referred by your unique link, and 20% of worker job amounts for the first year such workers do business on Tolstoy Staffing.
- Commission is paid in accordance with Company's then-current affiliate payment schedule.

2. UNIQUE LINKS
- You will receive unique referral links for service professionals (workers) and for companies. Only signups and business generated through these links will be attributed to you.
- You may not use spam, misleading claims, or incentivized traffic that violates our policies.

3. AFFILIATE TYPES
- URL-based: Share your links; track signups and earnings in your dashboard.
- Sales Affiliate: In addition to link sharing, you may receive leads, manage sales, and create accounts via the Sales Affiliate dashboard, subject to Company approval.

4. COMPLIANCE
- You agree to represent Tolstoy Staffing honestly and to comply with all applicable laws and Company policies. Company may terminate your participation at any time for breach.

5. MODIFICATIONS
- Company may modify commission rates or program terms with notice. Continued participation constitutes acceptance.

By signing below, you agree to these terms.`;

export default function AffiliateOnboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    type: "url" as "url" | "sales",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    address: "",
    experienceBlurb: "",
    agreed: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signatureHovered, setSignatureHovered] = useState(false);
  const contractScrollRef = useRef<HTMLDivElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadContainerRef = useRef<HTMLDivElement>(null);
  const pendingStep4AfterCreate = React.useRef(false);
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const { data: affiliate, isLoading: affiliateLoading } = useQuery({
    queryKey: ["/api/affiliates/me"],
    queryFn: fetchAffiliateMe,
    retry: false,
    enabled: isAuthenticated && !!user?.id,
  });

  useEffect(() => {
    if (authLoading || !isAuthenticated || !user) return;
    const u = user as any;
    setFormData((p) => ({
      ...p,
      firstName: u.claims?.first_name ?? p.firstName,
      lastName: u.claims?.last_name ?? p.lastName,
      email: u.claims?.email ?? p.email,
    }));
  }, [authLoading, isAuthenticated, user]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated && affiliate) return;
    if (affiliate?.onboardingComplete) {
      setLocation("/affiliate-dashboard");
      return;
    }
    if (affiliate) {
      setFormData((p) => ({
        ...p,
        type: (affiliate as any).type === "sales" ? "sales" : "url",
        firstName: (affiliate as any).firstName ?? p.firstName,
        lastName: (affiliate as any).lastName ?? p.lastName,
        email: (affiliate as any).email ?? p.email,
        phone: (affiliate as any).phone ?? "",
        address: (affiliate as any).address ?? "",
        experienceBlurb: (affiliate as any).experienceBlurb ?? "",
      }));
      const step = (affiliate as any).onboardingStep ?? 2;
      // Map old 4-step flow: step 4 -> 3, step 3 -> 2 (step 3 was removed, merged into step 1)
      const mappedStep = step <= 0 ? 1 : step === 4 ? 3 : Math.min(step, TOTAL_STEPS);
      setCurrentStep(mappedStep);
    }
  }, [affiliate, authLoading, isAuthenticated, setLocation]);

  const registerMutation = useMutation({
    mutationFn: async (body: { email: string; password: string; firstName: string; lastName: string }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...body, userType: "worker" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Registration failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Account created" });
      setCurrentStep(2);
    },
    onError: (e: any) => {
      toast({ title: e?.message || "Sign up failed", variant: "destructive" });
    },
  });

  const createAffiliate = useMutation({
    mutationFn: async (body: {
      type: "url" | "sales";
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      address?: string;
      experienceBlurb?: string;
    }) => apiRequest("POST", "/api/affiliates", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
      if (pendingStep4AfterCreate.current) {
        pendingStep4AfterCreate.current = false;
        setCurrentStep(3);
      }
      // Redirect and toast are handled in handleNext after mutateAsync for step-3 submit
    },
    onError: (e: any) => {
      toast({ title: e?.message || "Failed to create affiliate", variant: "destructive" });
    },
  });

  const updateAffiliate = useMutation({
    mutationFn: async (
      body: Partial<{
        type: "url" | "sales";
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        address: string;
        experienceBlurb: string;
        onboardingStep: number;
        onboardingComplete: boolean;
        agreementSigned: boolean;
        agreementSignedAt: string;
      }>
    ) => apiRequest("PATCH", "/api/affiliates/me", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
    },
    onError: (e: any) => {
      toast({ title: e?.message || "Update failed", variant: "destructive" });
    },
  });

  const validateStep = (step: number): boolean => {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!formData.firstName?.trim()) e.firstName = "First name is required";
      if (!formData.lastName?.trim()) e.lastName = "Last name is required";
      if (!formData.email?.trim()) e.email = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = "Valid email required";
      if (!formData.phone?.trim()) e.phone = "Phone is required";
      if (!isAuthenticated) {
        if (!formData.password) e.password = "Password is required";
        else if (formData.password.length < 8) e.password = "Password must be at least 8 characters";
        if (!formData.confirmPassword) e.confirmPassword = "Please confirm your password";
        else if (formData.password !== formData.confirmPassword) e.confirmPassword = "Passwords do not match";
      }
    }
    if (step === 3) {
      if (!signatureData) e.agreed = "Please scroll through the agreement and sign below";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = async () => {
    if (currentStep === 1 && !isAuthenticated) {
      if (!validateStep(1)) return;
      registerMutation.mutate({
        email: formData.email.trim(),
        password: formData.password,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
      });
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      if (!validateStep(currentStep)) return;
      setCurrentStep((s) => s + 1);
    } else {
      if (!validateStep(3)) return;
      if (affiliate) {
        await updateAffiliate.mutateAsync({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          address: formData.address || undefined,
          experienceBlurb: formData.experienceBlurb || undefined,
          onboardingComplete: true,
          onboardingStep: TOTAL_STEPS,
          agreementSigned: true,
          agreementSignedAt: new Date().toISOString(),
        });
        setLocation("/affiliate-dashboard");
      } else {
        try {
          await createAffiliate.mutateAsync({
            type: formData.type,
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            phone: formData.phone,
            address: formData.address || undefined,
            experienceBlurb: formData.experienceBlurb || undefined,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
          toast({ title: "Welcome to the affiliate program" });
          setLocation("/affiliate-dashboard");
        } catch (e: any) {
          if (e?.message === "Affiliate already exists") {
            queryClient.invalidateQueries({ queryKey: ["/api/affiliates/me"] });
            setLocation("/affiliate-dashboard");
            toast({ title: "You're already set up. Taking you to your dashboard." });
          } else {
            toast({ title: e?.message || "Failed to create affiliate", variant: "destructive" });
          }
        }
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep((s) => s - 1);
  };

  // Contract scroll detection (step 3)
  const handleContractScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    if (isAtBottom) setHasScrolledToBottom(true);
  }, []);

  const scrollToBottomOfContract = useCallback(() => {
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
  }, []);

  const clearSignaturePad = useCallback(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const captureSignature = useCallback(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setSignatureData(dataUrl);
    setFormData((p) => ({ ...p, agreed: true }));
  }, []);

  // Signature canvas: draw when step 3, hasScrolledToBottom, and no signature yet
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    const container = signaturePadContainerRef.current;
    if (!canvas || !container || currentStep !== 3 || signatureData) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth || 400;
    const height = 120;
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

  if (authLoading || (isAuthenticated && affiliateLoading && !affiliate && currentStep > 1)) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (affiliate?.onboardingComplete) return null;

  const showAccountStep = currentStep === 1 && !isAuthenticated;

  // Steps for sidebar (3 steps: account+experience, tier, agreement)
  const steps = [
    {
      id: 1,
      title: "Create account",
      subSteps: [
        {
          id: "account",
          label: "Account & experience",
          completed: !!(formData.firstName?.trim() && formData.phone?.trim() && (isAuthenticated || formData.password)),
        },
      ],
    },
    {
      id: 2,
      title: "Choose tier",
      subSteps: [{ id: "tier", label: "Tier", completed: !!formData.type }],
    },
    {
      id: 3,
      title: "Agreement",
      subSteps: [{ id: "agreement", label: "Sign", completed: !!signatureData }],
    },
  ];

  const getStepStatus = (stepId: number, subStepId: string) => {
    if (stepId < currentStep) return "completed";
    if (stepId === currentStep) return "active";
    return "pending";
  };

  const getActiveSubStep = (stepId: number) => {
    if (stepId !== currentStep) return null;
    const step = steps.find((s) => s.id === stepId);
    return step?.subSteps[0] ?? null;
  };

  const onboardingProgressPercent = currentStep === 0 ? 0 : (currentStep / TOTAL_STEPS) * 100;

  // Prescreen (step 0) - welcome and benefits, like worker onboarding
  if (currentStep === 0) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <div className="flex-1 flex min-h-0">
          <aside className="hidden md:block w-80 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-lg">T</span>
                </div>
                <span className="text-lg font-semibold text-gray-900">Become an affiliate</span>
              </div>
              <nav className="space-y-6">
                {steps.map((step) => (
                  <div key={step.id} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                        <span className="text-white font-bold text-base">{step.id}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCurrentStep(step.id)}
                        className="text-sm font-semibold text-left text-gray-600 hover:text-gray-900"
                      >
                        {step.title}
                      </button>
                    </div>
                    <div className="space-y-1 pl-11">
                      {step.subSteps.map((subStep) => (
                        <button
                          key={subStep.id}
                          type="button"
                          onClick={() => setCurrentStep(step.id)}
                          className="w-full flex items-center gap-3 py-1.5 px-3 rounded-xl text-left text-gray-400 hover:text-gray-600"
                        >
                          <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300 bg-green-50 flex-shrink-0" />
                          <span className="text-sm">{subStep.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            </div>
          </aside>
          <main className="flex-1 min-w-0 flex flex-col bg-white relative">
            {isMobile && (
              <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-lg">T</span>
                </div>
                <span className="text-base font-semibold text-gray-900">Become an affiliate</span>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-12 pb-6 md:pb-8">
                <div className="mb-6 md:mb-10">
                  <h1 className="text-2xl md:text-3xl font-bold mb-2 md:mb-3 text-gray-900">Join the Affiliate Program</h1>
                  <p className="text-base md:text-lg text-gray-600">Earn 20% commission by referring workers and companies to Tolstoy Staffing. Share your unique links and track signups in your dashboard.</p>
                </div>
                <div className="mb-6 md:mb-8">
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 md:p-6 mb-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-0 md:mb-4">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-2">Why become an affiliate?</h2>
                        <p className="text-sm text-gray-600 leading-relaxed">
                          Get unique referral links for workers and companies. Earn 20% of net profit from company jobs and worker job amounts for the first year. No cap on earnings.
                        </p>
                      </div>
                      <div className="flex-shrink-0 md:ml-6">
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-[#00A86B] to-[#008A57] flex items-center justify-center shadow-lg">
                          <DollarSign className="w-8 h-8 md:w-10 md:h-10 text-white" strokeWidth={2.5} />
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
                              <Link2 className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                            </div>
                            <h3 className="font-bold text-gray-900 text-sm md:text-base">Unique referral links</h3>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                            Share links for workers and for companies. Only signups through your links count toward your commission.
                          </p>
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
                              <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                            </div>
                            <h3 className="font-bold text-gray-900 text-sm md:text-base">20% commission</h3>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                            Earn on company jobs you refer and on worker job amounts for their first year on the platform.
                          </p>
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
                              <BarChart3 className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={2.5} />
                            </div>
                            <h3 className="font-bold text-gray-900 text-sm md:text-base">Dashboard & tracking</h3>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed ml-0 sm:ml-[52px] md:ml-[58px]">
                            Track referrals, signups, and earnings. Upgrade to Sales Affiliate for full CRM-style tracking.
                          </p>
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
                    <span className="font-medium">Trusted program</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#00A86B]" />
                    </div>
                    <span className="font-medium">No fees to join</span>
                  </div>
                </div>
              </div>
            </div>
            <footer className="border-t border-gray-200 bg-white shrink-0 sticky bottom-0 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
              <div className={cn("max-w-3xl mx-auto px-4 md:px-8 py-4 md:py-4 flex", isMobile ? "flex-col gap-4 py-6" : "flex-row items-center gap-3")}>
                {isMobile ? (
                  <>
                    <Button
                      onClick={() => setCurrentStep(isAuthenticated ? 2 : 1)}
                      className="w-full h-12 rounded-xl bg-gray-900 text-white hover:bg-gray-800 font-semibold text-base"
                      data-testid="button-begin-affiliate"
                    >
                      Get started
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full h-12 rounded-xl text-muted-foreground border-0 shadow-none text-base"
                      onClick={() => setLocation("/")}
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
                      type="button"
                    >
                      Exit
                    </Button>
                    <div className="flex gap-3 flex-1 justify-end">
                      <Button
                        onClick={() => setCurrentStep(isAuthenticated ? 2 : 1)}
                        className="h-10 bg-gray-900 text-white hover:bg-gray-800"
                        data-testid="button-begin-affiliate"
                      >
                        Get started
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
              <span className="text-lg font-semibold text-gray-900">Become an affiliate</span>
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
                        onClick={() => setCurrentStep(step.id)}
                        className={cn(
                          "text-sm font-semibold text-left",
                          isStepActive ? "text-gray-900" : "text-gray-600",
                          "hover:text-gray-900"
                        )}
                      >
                        {step.title}
                      </button>
                    </div>
                    <div className="space-y-1 pl-11">
                      {step.subSteps.map((subStep) => {
                        const status = getStepStatus(step.id, subStep.id);
                        const activeSubStep = getActiveSubStep(step.id);
                        const isActive =
                          status === "active" ||
                          (status === "pending" &&
                            subStep.id === activeSubStep?.id &&
                            isStepActive);
                        const isCompleted = status === "completed";
                        return (
                          <button
                            key={subStep.id}
                            type="button"
                            onClick={() => setCurrentStep(step.id)}
                            className={cn(
                              "w-full flex items-center gap-3 py-1.5 px-3 rounded-xl text-left",
                              isActive && "bg-green-50 text-[#00A86B] font-medium",
                              isCompleted && "bg-white border border-gray-300 text-gray-900 font-medium",
                              isStepActive && !isActive && !isCompleted && "bg-green-50 text-gray-700",
                              !isStepActive && !isActive && "text-gray-400 hover:text-gray-600"
                            )}
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

        {/* Right Panel - Content */}
        <main className="flex-1 min-w-0 flex flex-col bg-white relative">
          {/* Mobile: step progress banner */}
          {isMobile && currentStep >= 1 && currentStep <= TOTAL_STEPS && (
            <div className="border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="px-4 py-3">
                <div className="flex items-center w-full gap-0">
                  {[1, 2, 3].map((stepNum, index) => (
                    <div
                      key={stepNum}
                      className={cn(
                        "flex items-center",
                        index < 2 ? "flex-1 min-w-0" : "flex-shrink-0"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => stepNum <= currentStep && setCurrentStep(stepNum)}
                        className={cn(
                          "flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors",
                          currentStep === stepNum
                            ? "bg-primary text-primary-foreground"
                            : "bg-white border border-gray-300 text-gray-700"
                        )}
                      >
                        {currentStep > stepNum ? (
                          <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
                        ) : (
                          stepNum
                        )}
                      </button>
                      {index < 2 && (
                        <div
                          className={cn(
                            "flex-1 h-0.5 min-w-[6px] mx-0.5 rounded-full transition-colors",
                            currentStep > stepNum ? "bg-primary" : "bg-gray-300"
                          )}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step header - desktop above scroll, mobile inside scroll */}
          {!isMobile && currentStep >= 1 && currentStep <= TOTAL_STEPS && (
            <header className="border-b border-gray-200 bg-white shrink-0">
              <div className="max-w-3xl mx-auto px-4 md:px-8 py-4 flex flex-col gap-1">
                <div className="flex items-start gap-4">
                  {showAccountStep && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Create your account</h2>
                        <p className="text-sm text-gray-600 mt-1">Sign up to get your referral links.</p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Already an affiliate?{" "}
                          <Link href="/affiliate-dashboard" className="text-primary font-medium hover:underline">Go to dashboard</Link>
                          {!isAuthenticated && (
                            <> · Already have an account?{" "}
                              <Link href={`/login?returnTo=${encodeURIComponent("/affiliate-onboarding")}`} className="text-primary font-medium hover:underline">Log in</Link>
                            </>
                          )}
                        </p>
                      </div>
                    </>
                  )}
                  {currentStep === 1 && isAuthenticated && (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-gray-900">Your details & experience</h2>
                        <p className="text-sm text-gray-600 mt-1">Confirm your info and tell us about your background.</p>
                      </div>
                    </>
                  )}
                  {currentStep === 2 && (
                        <>
                          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Link2 className="w-6 h-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-gray-900">Choose your tier</h2>
                            <p className="text-sm text-gray-600 mt-1">URL only or Sales tracker + links.</p>
                          </div>
                        </>
                      )}
                      {currentStep === 3 && (
                        <>
                          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-6 h-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-gray-900">Affiliate agreement</h2>
                            <p className="text-sm text-gray-600 mt-1">Review and agree to the terms.</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </header>
              )}

          <div className={cn("flex-1 overflow-y-auto", currentStep === 3 && "flex flex-col min-h-0")}>
            <div className={cn("max-w-3xl mx-auto px-4 md:px-8 py-4 md:py-8 w-full", currentStep === 3 && "flex-1 flex flex-col min-h-0")}>
              {/* Mobile step header inside scroll */}
              {isMobile && currentStep >= 1 && currentStep <= TOTAL_STEPS && (
                <header className="border-b border-gray-200 bg-white shrink-0 mb-4 md:mb-0">
                  <div className="max-w-3xl mx-auto px-4 md:px-8 py-4 flex flex-col gap-1">
                    <div className="flex items-start gap-4">
                      {showAccountStep && (
                        <>
                          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <User className="w-6 h-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-gray-900">Create your account</h2>
                            <p className="text-sm text-gray-600 mt-1">Sign up to get your referral links.</p>
                            <p className="text-sm text-muted-foreground mt-2">
                              Already an affiliate?{" "}
                              <Link href="/affiliate-dashboard" className="text-primary font-medium hover:underline">Go to dashboard</Link>
                              {!isAuthenticated && (
                                <> · Already have an account?{" "}
                                  <Link href={`/login?returnTo=${encodeURIComponent("/affiliate-onboarding")}`} className="text-primary font-medium hover:underline">Log in</Link>
                                </>
                              )}
                            </p>
                          </div>
                        </>
                      )}
                      {currentStep === 2 && (
                        <>
                          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Link2 className="w-6 h-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-gray-900">Choose your tier</h2>
                            <p className="text-sm text-gray-600 mt-1">URL only or Sales tracker + links.</p>
                          </div>
                        </>
                      )}
                      {currentStep === 3 && (
                        <>
                          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-6 h-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-gray-900">Affiliate agreement</h2>
                            <p className="text-sm text-gray-600 mt-1">Review and agree to the terms.</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </header>
              )}

              {/* Step 1: Create account + experience (or your details when already logged in) */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold mb-4 text-gray-900 uppercase tracking-wide">
                      {isAuthenticated ? "Your details & experience" : "Your details"}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700">
                          First name <span className="text-red-500">*</span>
                        </label>
                        <Input
                          value={formData.firstName}
                          onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))}
                          placeholder="John"
                          className={cn(
                            "bg-white border border-gray-300 rounded-md",
                            errors.firstName && "border-red-500"
                          )}
                        />
                        {errors.firstName && (
                          <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700">
                          Last name <span className="text-red-500">*</span>
                        </label>
                        <Input
                          value={formData.lastName}
                          onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))}
                          placeholder="Doe"
                          className={cn(
                            "bg-white border border-gray-300 rounded-md",
                            errors.lastName && "border-red-500"
                          )}
                        />
                        {errors.lastName && (
                          <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-gray-700">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                        placeholder="john@example.com"
                        className={cn(
                          "bg-white border border-gray-300 rounded-md",
                          errors.email && "border-red-500"
                        )}
                      />
                      {errors.email && (
                        <p className="text-xs text-red-500 mt-1">{errors.email}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-gray-700">
                        Phone <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="(555) 123-4567"
                        className={cn(
                          "bg-white border border-gray-300 rounded-md",
                          errors.phone && "border-red-500"
                        )}
                      />
                      {errors.phone && (
                        <p className="text-xs text-red-500 mt-1">{errors.phone}</p>
                      )}
                    </div>
                    <div>
                      <GooglePlacesAutocomplete
                        id="affiliate-address-step1"
                        label="Address"
                        value={formData.address}
                        onChange={(address) => {
                          setFormData((p) => ({ ...p, address }));
                          if (errors.address) {
                            setErrors((e) => {
                              const next = { ...e };
                              delete next.address;
                              return next;
                            });
                          }
                        }}
                        placeholder="Start typing your address (global)"
                        className={cn(
                          "bg-white border border-gray-300 rounded-md",
                          errors.address && "border-red-500"
                        )}
                        global
                      />
                      {errors.address && (
                        <p className="text-xs text-red-500 mt-1">{errors.address}</p>
                      )}
                    </div>
                    {!isAuthenticated && (
                      <>
                        <div>
                          <label className="block text-sm font-medium mb-2 text-gray-700">
                            Password <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                            placeholder="At least 8 characters"
                            className={cn(
                              "bg-white border border-gray-300 rounded-md",
                              errors.password && "border-red-500"
                            )}
                          />
                          {errors.password && (
                            <p className="text-xs text-red-500 mt-1">{errors.password}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2 text-gray-700">
                            Confirm password <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="password"
                            value={formData.confirmPassword}
                            onChange={(e) => setFormData((p) => ({ ...p, confirmPassword: e.target.value }))}
                            placeholder="Re-enter your password"
                            className={cn(
                              "bg-white border border-gray-300 rounded-md",
                              errors.confirmPassword && "border-red-500"
                            )}
                          />
                          {errors.confirmPassword && (
                            <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>
                          )}
                        </div>
                      </>
                    )}
                    <div>
                      <label className="block text-sm font-medium mb-2 text-gray-700">
                        Experience / background <span className="text-gray-400 text-xs">(optional)</span>
                      </label>
                      <Textarea
                        value={formData.experienceBlurb}
                        onChange={(e) =>
                          setFormData((p) => ({ ...p, experienceBlurb: e.target.value }))
                        }
                        placeholder="Tell us about your experience, why you want to refer workers and companies, or relevant sales/marketing background..."
                        className={cn(
                          "min-h-[120px] resize-none bg-white border border-gray-300 rounded-md",
                          errors.experienceBlurb && "border-red-500"
                        )}
                      />
                      {errors.experienceBlurb && (
                        <p className="text-xs text-red-500 mt-1">{errors.experienceBlurb}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Choose tier */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <p className="text-sm text-gray-600">
                    Choose how you want to refer workers and companies. You can share links only, or get full sales tools if you do direct outreach.
                  </p>
                  <RadioGroup
                    value={formData.type}
                    onValueChange={(v: "url" | "sales") =>
                      setFormData((p) => ({ ...p, type: v }))
                    }
                    className="grid gap-4"
                  >
                    <Label
                      htmlFor="url"
                      className={cn(
                        "flex items-start gap-4 rounded-xl border-2 p-5 cursor-pointer transition-colors",
                        formData.type === "url"
                          ? "border-[#00A86B] bg-green-50"
                          : "border-gray-200 hover:border-[#00A86B]/50"
                      )}
                    >
                      <RadioGroupItem value="url" id="url" className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 font-semibold text-gray-900">
                          <Link2 className="w-5 h-5 text-[#00A86B] flex-shrink-0" />
                          URL only
                        </div>
                        <p className="text-xs font-medium text-[#00A86B] mt-1">For link sharing</p>
                        <p className="text-sm text-gray-600 mt-2">
                          Share your unique referral links on social, email, or your website. Track signups—no cold calling or direct sales required.
                        </p>
                        <p className="text-xs text-gray-500 mt-2 italic">
                          Best for: influencers, content creators, and anyone who prefers passive link sharing.
                        </p>
                      </div>
                    </Label>
                    <Label
                      htmlFor="sales"
                      className={cn(
                        "flex items-start gap-4 rounded-xl border-2 p-5 cursor-pointer transition-colors",
                        formData.type === "sales"
                          ? "border-[#00A86B] bg-green-50"
                          : "border-gray-200 hover:border-[#00A86B]/50"
                      )}
                    >
                      <RadioGroupItem value="sales" id="sales" className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 font-semibold text-gray-900">
                          <BarChart3 className="w-5 h-5 text-[#00A86B] flex-shrink-0" />
                          Sales tracker + URL
                        </div>
                        <p className="text-xs font-medium text-[#00A86B] mt-1">For direct sales & cold calling</p>
                        <p className="text-sm text-gray-600 mt-2">
                          Everything in URL-only, plus a full dashboard, leads list, and the ability to create accounts for prospects. For people comfortable with cold calling and direct outreach to businesses or workers.
                        </p>
                        <p className="text-xs text-gray-500 mt-2 italic">
                          Best for: sales reps, recruiters, and anyone who actively reaches out to companies or workers.
                        </p>
                      </div>
                    </Label>
                  </RadioGroup>
                </div>
              )}

              {/* Step 3: Agreement - fills right column, contract scrolls inside card */}
              {currentStep === 3 && (
                <div className="flex-1 flex flex-col min-h-0 gap-4">
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white rounded-2xl shadow-lg border border-gray-200">
                    <div className="h-1.5 bg-gray-800 shrink-0" />
                    <div className="relative flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/80 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-stone-600 hover:text-stone-900 hover:bg-stone-100"
                          onClick={scrollToBottomOfContract}
                        >
                          <ChevronDown className="w-4 h-4 mr-1" />
                          Scroll to bottom
                        </Button>
                      </div>
                      <div
                        ref={contractScrollRef}
                        onScroll={handleContractScroll}
                        className="flex-1 min-h-0 overflow-y-auto p-8 md:p-12"
                      >
                        <div className="max-w-none text-stone-900" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                          <pre className="whitespace-pre-wrap text-sm md:text-base leading-relaxed" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#1c1917" }}>
                            {AFFILIATE_AGREEMENT}
                          </pre>
                        </div>
                      </div>
                      {!hasScrolledToBottom && (
                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" aria-hidden />
                      )}
                    </div>
                    <div className="border-t-2 border-stone-200 bg-stone-50/80 p-4 md:p-5 shrink-0">
                      <h3 className="font-semibold mb-2 flex items-center gap-2 text-stone-900 text-sm" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                        <Pen className="w-4 h-4" /> Affiliate Signature
                      </h3>
                      {!hasScrolledToBottom && (
                        <p className="text-xs text-stone-600 mb-2 italic">Please scroll through the entire document to enable signing, or use the &quot;Scroll to bottom&quot; button above.</p>
                      )}
                      <div
                        className={cn(
                          "p-4 text-center relative transition-all bg-white rounded-lg",
                          signatureData ? "border-2 border-stone-900" : "border-2 border-dashed border-stone-300"
                        )}
                        onMouseEnter={() => setSignatureHovered(true)}
                        onMouseLeave={() => setSignatureHovered(false)}
                      >
                        {signatureData ? (
                          <div className="space-y-1">
                            {signatureData.startsWith("data:") ? (
                              <img src={signatureData} alt="Your signature" className="max-h-14 w-auto mx-auto object-contain" />
                            ) : (
                              <p className="text-xl italic text-stone-900" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                                {signatureData}
                              </p>
                            )}
                            <div className="border-t border-stone-400 pt-1.5 mt-2 mx-auto max-w-[200px]">
                              <p className="text-xs text-stone-600">
                                Date: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                              </p>
                            </div>
                            {signatureHovered && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSignatureData(null);
                                  setFormData((p) => ({ ...p, agreed: false }));
                                }}
                                className="absolute top-2 right-2 text-xs text-stone-500 hover:text-red-600 transition-colors"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        ) : hasScrolledToBottom ? (
                          <div ref={signaturePadContainerRef} className="space-y-2">
                            <p className="text-xs text-stone-600">Draw your signature below</p>
                            <canvas
                              ref={signatureCanvasRef}
                              className="block w-full border border-stone-300 rounded-lg bg-white touch-none cursor-crosshair"
                              style={{ height: 120 }}
                            />
                            <div className="flex items-center justify-center gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={clearSignaturePad}>
                                Clear
                              </Button>
                              <Button type="button" size="sm" className="bg-gray-900 hover:bg-gray-800 text-white" onClick={captureSignature}>
                                Done
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="py-2">
                            <p className="text-stone-500 text-xs mb-1">Scroll to bottom first to enable signing</p>
                            <div className="border-t border-stone-300 mx-auto max-w-[200px]" />
                            <p className="text-xs text-stone-400 mt-1">Signature Line</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-800 shrink-0" />
                  </div>
                  {errors.agreed && (
                    <p className="text-xs text-red-500">{errors.agreed}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer - match worker onboarding: sticky, shadow, progress bar on mobile */}
          <footer
            className={cn(
              "border-t border-gray-200 shrink-0 flex flex-col bg-white pb-6 md:pb-4",
              isMobile && currentStep >= 1 && currentStep <= TOTAL_STEPS
                ? "sticky bottom-0 left-0 right-0 z-40 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pt-0"
                : "pt-4 md:pt-6 px-4 md:px-8"
            )}
          >
            {isMobile && currentStep >= 1 && currentStep <= TOTAL_STEPS && (
              <div className="flex h-1 w-full bg-muted overflow-hidden rounded-none shrink-0" aria-hidden>
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${onboardingProgressPercent}%` }}
                />
              </div>
            )}
            <div className={cn("max-w-3xl mx-auto w-full", isMobile && currentStep >= 1 && currentStep <= TOTAL_STEPS ? "px-4 md:px-8 pt-4" : "")}>
              <div className={cn("flex items-center gap-2", isMobile ? "flex-row" : "justify-end gap-4")}>
                {isMobile ? (
                  <>
                    <Button
                      variant="ghost"
                      className="h-12 text-muted-foreground rounded-xl border-0 shadow-none"
                      style={{ width: "35%", flexShrink: 0 }}
                      onClick={handleBack}
                      type="button"
                      disabled={currentStep === 1}
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Back
                    </Button>
                    <Button
                      onClick={handleNext}
                      className="h-12 text-base font-semibold rounded-xl shadow-lg flex-1 min-w-0 bg-gray-900 text-white hover:bg-gray-800"
                      style={{ width: "65%", flexShrink: 0 }}
                      disabled={
                        createAffiliate.isPending ||
                        registerMutation.isPending ||
                        (currentStep === 3 && !signatureData)
                      }
                    >
                      {createAffiliate.isPending || registerMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : showAccountStep ? (
                        "Create account"
                      ) : currentStep === TOTAL_STEPS ? (
                        "Complete"
                      ) : (
                        "Next"
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    {currentStep >= 1 && (
                      <Button
                        variant="ghost"
                        onClick={handleBack}
                        className="h-10 text-muted-foreground border-0 shadow-none"
                        disabled={currentStep === 1}
                      >
                        Back
                      </Button>
                    )}
                    <Button
                      onClick={handleNext}
                      className="h-10 bg-gray-900 text-white hover:bg-gray-800"
                      disabled={
                        createAffiliate.isPending ||
                        registerMutation.isPending ||
                        (currentStep === 3 && !signatureData)
                      }
                    >
                      {createAffiliate.isPending || registerMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : showAccountStep ? (
                        "Create account"
                      ) : currentStep === TOTAL_STEPS ? (
                        "Complete"
                      ) : (
                        "Next"
                      )}
                    </Button>
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
