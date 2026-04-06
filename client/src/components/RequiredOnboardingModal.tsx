import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MapPin, User, CheckCircle, Loader2, Upload, X, DollarSign, Wrench, ChevronDown, ChevronUp } from "lucide-react";
import { useProfile, useUpdateProfile, invalidateSessionProfileQueries } from "@/hooks/use-profiles";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpload } from "@/hooks/use-upload";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { checkLocationPermission, checkNativePermissions, requestLocationPermissions, openAppSettings, getCurrentPosition } from "@/lib/nativeLocationTracking";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import * as faceapi from "@vladmandic/face-api";
import { useTranslation } from "react-i18next";

interface RequiredOnboardingModalProps {
  profile: any;
  onComplete: () => void;
}

type OnboardingStep = "location" | "locationServices" | "avatar" | "rate" | "skillset";

export function RequiredOnboardingModal({ profile, onComplete }: RequiredOnboardingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation("onboarding");
  const { t: tCommon } = useTranslation("common");
  const queryClient = useQueryClient();
  const updateProfile = useUpdateProfile();
  const { uploadFile } = useUpload();
  
  // Refetch profile after updates
  const { refetch: refetchProfile } = useProfile(user?.id);
  
  // Face verification state
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [faceVerified, setFaceVerified] = useState(false);
  const [isVerifyingFace, setIsVerifyingFace] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  
  // Location services state
  const [locationServicesWorking, setLocationServicesWorking] = useState<boolean | null>(null);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  const [locationServicesError, setLocationServicesError] = useState<string | null>(null);
  
  // Location verification with fallback chain
  const verifyLocationWithFallback = async (): Promise<{ success: boolean; method: string; error?: string }> => {
    // Method 1: Try server-side Google API (IP-based geolocation)
    try {
      const response = await fetch('/api/geolocation/ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.latitude && data.longitude) {
          return { success: true, method: 'Google API (Server-side IP-based)' };
        }
      }
    } catch (error) {
      console.log("Server-side Google API geolocation failed, trying device location...");
    }
    
    // Method 2: Try device location services
    try {
      const permissions = await checkNativePermissions();
      if (permissions.foreground || permissions.background) {
        const position = await getCurrentPosition();
        if (position && position.coords) {
          return { success: true, method: 'Device Location Services' };
        }
      }
    } catch (error: any) {
      console.log("Device location services failed:", error.message);
    }
    
    // Method 3: Alternative method - IP-based geolocation (fallback)
    try {
      // Try a free IP geolocation service as last resort
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://ipapi.co/json/', { 
        signal: controller.signal 
      }).catch(() => null);
      
      clearTimeout(timeoutId);
      
      if (response && response.ok) {
        const data = await response.json();
        if (data.latitude && data.longitude) {
          return { success: true, method: 'IP-based Geolocation (Alternative)' };
        }
      }
    } catch (error) {
      console.log("Alternative IP geolocation failed");
    }
    
    return { success: false, method: 'None', error: 'All location methods failed' };
  };
  
  // Check location services (non-blocking, runs in background)
  useEffect(() => {
    if (profile?.role !== "worker") {
      setLocationServicesWorking(true);
      return;
    }
    
    const checkLocationServices = async () => {
      setIsCheckingLocation(true);
      setLocationServicesError(null);
      
      try {
        const result = await verifyLocationWithFallback();
        
        if (result.success) {
          setLocationServicesWorking(true);
          setLocationServicesError(null);
          console.log(`Location verified using: ${result.method}`);
        } else {
          setLocationServicesWorking(false);
          setLocationServicesError("Location services are not enabled or not working. Please enable location services to use the app.");
        }
      } catch (error: any) {
        console.error("Error checking location services:", error);
        setLocationServicesWorking(false);
        setLocationServicesError("Unable to verify location services. Please enable location services in your device settings.");
      } finally {
        setIsCheckingLocation(false);
      }
    };
    
    // Run check in background (non-blocking)
    const scheduleCheck = (callback: () => void) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 2000 });
      } else {
        setTimeout(callback, 100);
      }
    };
    
    scheduleCheck(checkLocationServices);
  }, [profile?.role]);
  
  // Load face-api models (non-blocking)
  useEffect(() => {
    if (profile?.role !== "worker") {
      setModelsLoaded(true);
      return;
    }
    
    const loadModels = async () => {
      try {
        const modelUrls = [
          "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model",
          "https://unpkg.com/@vladmandic/face-api@1.7.14/model",
        ];
        
        let loaded = false;
        for (const url of modelUrls) {
          try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(url);
            setModelsLoaded(true);
            loaded = true;
            break;
          } catch {
            continue;
          }
        }
        
        if (!loaded) {
          console.warn("Face detection models could not be loaded - using fallback verification");
          setModelsLoaded(true);
        }
      } catch (error) {
        console.warn("Face detection initialization failed - using fallback verification");
        setModelsLoaded(true);
      }
    };
    
    // Load models in background
    const scheduleLoad = (callback: () => void) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 3000 });
      } else {
        setTimeout(callback, 0);
      }
    };
    
    scheduleLoad(loadModels);
  }, [profile?.role]);
  
  // Face detection function
  const detectFace = async (imageDataUrl: string): Promise<boolean> => {
    if (!modelsLoaded) {
      console.warn("Face detection models not loaded");
      return true; // Allow through if models aren't loaded
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
  
  // Determine which steps are missing - only for workers
  // Use useMemo to make it reactive to locationServicesWorking state
  const missingSteps = useMemo<OnboardingStep[]>(() => {
    const steps: OnboardingStep[] = [];
    
    if (profile?.role === "worker") {
      // Check location services - must be working before proceeding
      // Only add if we've checked and it's not working (null means still checking)
      if (locationServicesWorking === false) {
        steps.push("locationServices");
      }
      
      // Check location
      if (!profile?.address || !profile?.city || !profile?.state || !profile?.zipCode) {
        steps.push("location");
      }
      
      // Check avatar with face verification
      if (!profile?.avatarUrl || !profile?.faceVerified) {
        steps.push("avatar");
      }
      
      // Check hourly rate
      if (!profile?.hourlyRate || profile.hourlyRate === 0) {
        steps.push("rate");
      }
      
      // Check skillset
      const hasSkillset = profile?.skillsets && Array.isArray(profile.skillsets) && profile.skillsets.length > 0;
      if (!hasSkillset) {
        steps.push("skillset");
      }
    }
    
    return steps;
  }, [profile?.role, locationServicesWorking, profile?.address, profile?.city, profile?.state, profile?.zipCode, profile?.avatarUrl, profile?.faceVerified, profile?.hourlyRate, profile?.skillsets]);
  
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = missingSteps[currentStepIndex];
  
  // Update step index when missingSteps changes (e.g., when locationServices check completes)
  useEffect(() => {
    // If current step is no longer in missingSteps, move to first step
    if (missingSteps.length > 0 && !missingSteps.includes(currentStep)) {
      setCurrentStepIndex(0);
    }
    // If we're past the last step, reset to last step
    if (currentStepIndex >= missingSteps.length && missingSteps.length > 0) {
      setCurrentStepIndex(missingSteps.length - 1);
    }
    // If we're on locationServices step and it's no longer missing, move to next
    if (currentStep === "locationServices" && !missingSteps.includes("locationServices") && missingSteps.length > 0) {
      setCurrentStepIndex(0);
    }
  }, [missingSteps, currentStep, currentStepIndex]);
  
  // Location form state
  const [locationData, setLocationData] = useState({
    address: profile?.address || "",
    address2: profile?.address2 || "",
    city: profile?.city || "",
    state: profile?.state || "",
    zipCode: profile?.zipCode || "",
    latitude: profile?.latitude || "",
    longitude: profile?.longitude || "",
  });
  
  // Avatar upload state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatarUrl || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  
  // Rate form state
  const [rateValue, setRateValue] = useState<number>(profile?.hourlyRate ? Math.round(profile.hourlyRate / 100) : 25);
  const [submittingRate, setSubmittingRate] = useState(false);
  
  // Skillset form state
  const [selectedSkills, setSelectedSkills] = useState<string[]>(profile?.serviceCategories || []);
  const [submittingSkillset, setSubmittingSkillset] = useState(false);
  
  // If all steps are complete, call onComplete
  useEffect(() => {
    if (missingSteps.length === 0 && profile) {
      // Small delay to ensure all data is synced
      const timer = setTimeout(() => {
        onComplete();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [missingSteps.length, profile, onComplete]);
  
  const handleLocationServicesCheck = async () => {
    setIsCheckingLocation(true);
    setLocationServicesError(null);
    
    try {
      // Request permissions first (for device location)
      try {
        const permissions = await requestLocationPermissions();
        if (permissions.foreground || permissions.background) {
          console.log("Location permissions granted");
        }
      } catch (permError) {
        console.log("Permission request failed, will try other methods:", permError);
      }
      
      // Try location verification with fallback chain
      const result = await verifyLocationWithFallback();
      
      if (result.success) {
        setLocationServicesWorking(true);
        setLocationServicesError(null);
        
        toast({
          title: t("locationServicesVerified"),
          description: t("locationVerifiedUsing", { method: result.method }),
        });
        
        // The useEffect that watches missingSteps will automatically move to next step
        // when locationServicesWorking changes to true
      } else {
        setLocationServicesWorking(false);
        setLocationServicesError(result.error || t("unableToVerifyLocation"));
      }
    } catch (error: any) {
      console.error("Error checking location services:", error);
      setLocationServicesWorking(false);
      setLocationServicesError(error.message || t("unableToVerifyLocationServices"));
    } finally {
      setIsCheckingLocation(false);
    }
  };
  
  const handleOpenSettings = async () => {
    try {
      await openAppSettings();
    } catch (error) {
      console.error("Error opening settings:", error);
      toast({
        title: tCommon("error"),
        description: t("unableToOpenSettings"),
        variant: "destructive",
      });
    }
  };
  
  const handleLocationSubmit = async () => {
    if (!locationData.address || !locationData.city || !locationData.state || !locationData.zipCode) {
      toast({
        title: t("missingInformation"),
        description: t("fillAllLocationFields"),
        variant: "destructive",
      });
      return;
    }
    
    if (!profile?.id) {
      toast({
        title: "Error",
        description: "Profile not found. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await updateProfile.mutateAsync({
        id: profile.id,
        data: {
          address: locationData.address,
          city: locationData.city,
          state: locationData.state,
          zipCode: locationData.zipCode,
          latitude: locationData.latitude || undefined,
          longitude: locationData.longitude || undefined,
        },
      });
      
      toast({
        title: t("locationSaved"),
        description: t("locationUpdated"),
      });
      
      // Invalidate queries (non-blocking)
      queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      
      // Refetch profile in background (non-blocking)
      refetchProfile().catch(() => {
        // Silently handle errors - UI will update when query refetches
      });
      
      // Move to next step immediately (don't wait for refetch)
      if (currentStepIndex < missingSteps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
      }
    } catch (error: any) {
      toast({
        title: tCommon("error"),
        description: error.message || t("failedToSaveLocation"),
        variant: "destructive",
      });
    }
  };
  
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate it's an image
    if (!file.type.startsWith("image/")) {
      toast({
        title: t("invalidFile"),
        description: t("uploadImageFile"),
        variant: "destructive",
      });
      return;
    }
    
    setIsVerifyingFace(true);
    setFaceError(null);
    setFaceVerified(false);
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const imageData = ev.target?.result as string;
      setAvatarPreview(imageData);
      setAvatarFile(file);
      
      const hasFace = await detectFace(imageData);
      
      if (hasFace) {
        setFaceVerified(true);
        setFaceError(null);
      } else {
        setFaceVerified(false);
        setFaceError(t("uploadClearFacePhoto"));
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };
  
  const handleAvatarSubmit = async () => {
    if (!avatarFile) {
      toast({
        title: t("noImageSelected"),
        description: t("selectImageToUpload"),
        variant: "destructive",
      });
      return;
    }
    
    if (!faceVerified) {
      toast({
        title: t("faceVerificationRequired"),
        description: faceError || t("uploadClearFacePhoto"),
        variant: "destructive",
      });
      return;
    }
    
    if (!profile?.id) {
      toast({
        title: "Error",
        description: "Profile not found. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }
    
    setUploadingAvatar(true);
    try {
      const uploadResponse = await uploadFile(avatarFile, "avatar");
      if (!uploadResponse?.objectPath) {
        throw new Error("Failed to upload avatar");
      }
      
      // Ensure objectPath includes bucket name
      let finalObjectPath = uploadResponse.objectPath;
      if (!finalObjectPath.includes("/avatar/") && !finalObjectPath.startsWith("/objects/avatar/")) {
        // If path is missing bucket, add it
        if (finalObjectPath.startsWith("/objects/uploads/")) {
          finalObjectPath = finalObjectPath.replace("/objects/uploads/", "/objects/avatar/uploads/");
        } else if (finalObjectPath.startsWith("/objects/")) {
          // Already has /objects/ but might be missing bucket
          const parts = finalObjectPath.split("/");
          if (parts.length >= 3 && parts[2] !== "avatar" && parts[2] !== "bio" && parts[2] !== "jobs" && parts[2] !== "reviews") {
            finalObjectPath = `/objects/avatar/${parts.slice(2).join("/")}`;
          }
        } else if (!finalObjectPath.startsWith("/")) {
          // Missing /objects/ prefix entirely
          finalObjectPath = `/objects/avatar/uploads/${finalObjectPath}`;
        }
      }
      
      await updateProfile.mutateAsync({
        id: profile.id,
        data: {
          avatarUrl: finalObjectPath,
          faceVerified: true,
          faceVerifiedAt: new Date(),
        },
      });
      
      // Update preview with normalized path
      setAvatarPreview(finalObjectPath);
      
      toast({
        title: t("avatarUploaded"),
        description: t("profilePictureUpdated"),
      });
      
      // Invalidate all profile-related queries to update avatars everywhere (non-blocking)
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      invalidateSessionProfileQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      
      // Refetch profile in background (non-blocking)
      refetchProfile().catch(() => {
        // Silently handle errors - UI will update when query refetches
      });
      
      // Move to next step immediately (don't wait for refetch)
      if (currentStepIndex < missingSteps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
      }
    } catch (error: any) {
      toast({
        title: t("uploadFailed"),
        description: error.message || t("failedToUploadAvatar"),
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };
  
  const handleRateSubmit = async () => {
    if (rateValue === undefined || rateValue === null || rateValue < 0 || rateValue > 200) {
      toast({
        title: t("invalidRate"),
        description: t("rateBetween0And60"),
        variant: "destructive",
      });
      return;
    }
    
    if (!profile?.id) {
      toast({
        title: "Error",
        description: "Profile not found. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }
    
    setSubmittingRate(true);
    try {
      // Convert to cents
      await updateProfile.mutateAsync({
        id: profile.id,
        data: {
          hourlyRate: Math.round(rateValue * 100),
        },
      });
      
      toast({
        title: t("rateSaved"),
        description: t("hourlyRateSet", { rate: rateValue }),
      });
      
      // Invalidate queries (non-blocking)
      queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      
      // Refetch profile in background (non-blocking)
      refetchProfile().catch(() => {
        // Silently handle errors - UI will update when query refetches
      });
      
      // Move to next step immediately (don't wait for refetch)
      if (currentStepIndex < missingSteps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
      }
    } catch (error: any) {
      toast({
        title: tCommon("error"),
        description: error.message || t("failedToSaveRate"),
        variant: "destructive",
      });
    } finally {
      setSubmittingRate(false);
    }
  };
  
  const handleSkillsetSubmit = async () => {
    if (selectedSkills.length === 0) {
      toast({
        title: t("noSkillsSelected"),
        description: t("selectAtLeastOneSkill"),
        variant: "destructive",
      });
      return;
    }
    
    if (!profile?.id) {
      toast({
        title: "Error",
        description: "Profile not found. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }
    
    setSubmittingSkillset(true);
    try {
      await updateProfile.mutateAsync({
        id: profile.id,
        data: {
          serviceCategories: selectedSkills,
        },
      });
      
      toast({
        title: t("skillsSaved"),
        description: t("addedSkills", { count: selectedSkills.length }),
      });
      
      // Invalidate queries (non-blocking)
      queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      
      // Refetch profile in background (non-blocking)
      refetchProfile().catch(() => {
        // Silently handle errors - UI will update when query refetches
      });
      
      // Move to next step immediately (don't wait for refetch)
      if (currentStepIndex < missingSteps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
      }
    } catch (error: any) {
      toast({
        title: tCommon("error"),
        description: error.message || t("failedToSaveSkills"),
        variant: "destructive",
      });
    } finally {
      setSubmittingSkillset(false);
    }
  };
  
  const toggleSkill = (skillId: string) => {
    setSelectedSkills(prev => {
      const isSelected = prev.includes(skillId);
      if (isSelected) {
        return prev.filter(id => id !== skillId);
      } else {
        // Handle Lite/Elite mutual exclusivity
        const baseName = skillId.replace(" Lite", "").replace(" Elite", "");
        const isLite = skillId.includes("Lite");
        const isElite = skillId.includes("Elite");
        
        let updated = [...prev, skillId];
        if (isLite || isElite) {
          const oppositeId = isLite ? `${baseName} Elite` : `${baseName} Lite`;
          updated = updated.filter(id => id !== oppositeId);
        }
        return updated;
      }
    });
  };
  
  // Only show modal for workers with missing required information
  if (profile?.role !== "worker" || missingSteps.length === 0) {
    return null;
  }
  
  const stepTitles: Record<OnboardingStep, string> = {
    locationServices: t("stepTitles.locationServices"),
    location: t("stepTitles.location"),
    avatar: t("stepTitles.avatar"),
    rate: t("stepTitles.rate"),
    skillset: t("stepTitles.skillset"),
  };
  
  const stepDescriptions: Record<OnboardingStep, string> = {
    locationServices: t("stepDescriptions.locationServices"),
    location: t("stepDescriptions.location"),
    avatar: t("stepDescriptions.avatar"),
    rate: t("stepDescriptions.rate"),
    skillset: t("stepDescriptions.skillset"),
  };
  
  const stepIcons: Record<OnboardingStep, React.ReactNode> = {
    locationServices: <MapPin className="w-6 h-6" />,
    location: <MapPin className="w-6 h-6" />,
    avatar: <User className="w-6 h-6" />,
    rate: <DollarSign className="w-6 h-6" />,
    skillset: <Wrench className="w-6 h-6" />,
  };
  
  return (
    <Dialog open={true} modal={true}>
      <DialogContent
        hideCloseButton
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        aria-describedby="required-onboarding-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stepIcons[currentStep]}
            {stepTitles[currentStep]}
            {missingSteps.length > 1 && (
              <span className="text-sm font-normal text-muted-foreground ml-auto">
                {t("step", { current: currentStepIndex + 1, total: missingSteps.length })}
              </span>
            )}
          </DialogTitle>
          <DialogDescription id="required-onboarding-description">
            {stepDescriptions[currentStep]}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {currentStep === "locationServices" && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-4">
                  {t("locationServicesRequired")}
                </p>
                
                {isCheckingLocation ? (
                  <div className="flex flex-col items-center gap-2">
                    <Skeleton className="w-8 h-8 rounded-full" />
                    <p className="text-sm text-muted-foreground">{t("checkingLocationServices")}</p>
                  </div>
                ) : locationServicesWorking === true ? (
                  <div className="flex flex-col items-center gap-2 text-green-600">
                    <CheckCircle className="w-8 h-8" />
                    <p className="text-sm font-medium">{t("locationServicesWorking")}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {locationServicesError && (
                      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                        <p className="text-sm text-destructive">{locationServicesError}</p>
                      </div>
                    )}
                    
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={handleLocationServicesCheck}
                        disabled={isCheckingLocation}
                        className="w-full"
                      >
                        {isCheckingLocation ? (
                          <>
                            <Skeleton className="h-4 w-4 rounded mr-2" />
                            {t("checking")}
                          </>
                        ) : (
                          t("enableLocationServices")
                        )}
                      </Button>
                      
                      <Button
                        onClick={handleOpenSettings}
                        variant="outline"
                        className="w-full"
                      >
                        {t("openDeviceSettings")}
                      </Button>
                    </div>
                    
                    <p className="text-xs text-muted-foreground text-center">
                      {t("afterEnablingLocationServices")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {currentStep === "location" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="address">{t("streetAddress")}</Label>
                <GooglePlacesAutocomplete
                  value={locationData.address}
                  onChange={(address, components) => {
                    setLocationData(prev => ({
                      ...prev,
                      address: address,
                      city: components.city || prev.city,
                      state: components.state || prev.state,
                      zipCode: components.zipCode || prev.zipCode,
                    }));
                  }}
                  placeholder={t("enterStreetAddress")}
                  className="mt-1"
                />
              </div>
              
              <div>
                <Label htmlFor="address2">{t("addressLine2")}</Label>
                <Input
                  id="address2"
                  value={locationData.address2}
                  onChange={(e) => setLocationData(prev => ({ ...prev, address2: e.target.value }))}
                  placeholder={t("addressLine2Placeholder")}
                  className="mt-1"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="city">{t("city")}</Label>
                  <Input
                    id="city"
                    value={locationData.city}
                    onChange={(e) => setLocationData(prev => ({ ...prev, city: e.target.value }))}
                    placeholder={t("city")}
                    className="mt-1"
                    required
                  />
                </div>
                
                <div>
                  <Label htmlFor="state">{t("state")}</Label>
                  <Input
                    id="state"
                    value={locationData.state}
                    onChange={(e) => setLocationData(prev => ({ ...prev, state: e.target.value }))}
                    placeholder={t("state")}
                    className="mt-1"
                    required
                    maxLength={2}
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="zipCode">{t("zipCode")}</Label>
                <Input
                  id="zipCode"
                  value={locationData.zipCode}
                  onChange={(e) => setLocationData(prev => ({ ...prev, zipCode: e.target.value }))}
                  placeholder={t("zipCode")}
                  className="mt-1"
                  required
                />
              </div>
              
              <Button
                onClick={handleLocationSubmit}
                className="w-full"
                disabled={!locationData.address || !locationData.city || !locationData.state || !locationData.zipCode}
              >
                {t("saveLocation")}
              </Button>
            </div>
          )}
          
          {currentStep === "avatar" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-4">
                <Avatar className="w-32 h-32">
                  {avatarPreview ? (
                    <AvatarImage 
                      src={
                        avatarPreview.startsWith("http") || 
                        avatarPreview.startsWith("/") || 
                        avatarPreview.startsWith("data:")
                          ? avatarPreview 
                          : `/objects/avatar/uploads/${avatarPreview}`
                      } 
                      alt="Profile preview" 
                    />
                  ) : (
                    <AvatarFallback className="text-2xl">
                      {profile?.firstName?.[0] || "U"}
                      {profile?.lastName?.[0] || ""}
                    </AvatarFallback>
                  )}
                </Avatar>
                
                <div className="text-center">
                  <Label htmlFor="avatar-upload" className="cursor-pointer">
                    <Button variant="outline" asChild disabled={isVerifyingFace}>
                      <span>
                        {isVerifyingFace ? (
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-20" />
                          </div>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            {avatarFile ? t("changePhoto") : t("uploadPhoto")}
                          </>
                        )}
                      </span>
                    </Button>
                  </Label>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                    disabled={isVerifyingFace}
                  />
                  {avatarFile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAvatarFile(null);
                        setAvatarPreview(profile?.avatarUrl || null);
                        setFaceVerified(false);
                        setFaceError(null);
                      }}
                      className="ml-2"
                      disabled={isVerifyingFace}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                
                {faceVerified && (
                  <div className="flex items-center justify-center gap-2 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <p className="text-sm">{t("faceVerifiedSuccessfully")}</p>
                  </div>
                )}
                
                {faceError && (
                  <p className="text-sm text-destructive text-center">{faceError}</p>
                )}
                
                <p className="text-xs text-muted-foreground text-center">
                  {t("uploadClearFacePhotoHelp")}
                </p>
              </div>
              
              <Button
                onClick={handleAvatarSubmit}
                className="w-full"
                disabled={!avatarFile || !faceVerified || uploadingAvatar || isVerifyingFace}
              >
                {uploadingAvatar ? (
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-20" />
                  </div>
                ) : (
                  t("savePhoto")
                )}
              </Button>
            </div>
          )}
          
          {currentStep === "rate" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="hourlyRate">{t("hourlyRate")}</Label>
                <Input
                  id="hourlyRate"
                  type="number"
                  min={1}
                  max={200}
                  value={rateValue}
                  onChange={(e) => setRateValue(Number(e.target.value))}
                  placeholder={t("hourlyRatePlaceholder")}
                  className="mt-1"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("hourlyRateDescription")}
                </p>
              </div>
              
              <Button
                onClick={handleRateSubmit}
                className="w-full"
                disabled={rateValue === undefined || rateValue === null || rateValue < 1 || rateValue > 200 || submittingRate}
              >
                {submittingRate ? (
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-16" />
                  </div>
                ) : (
                  t("saveRate")
                )}
              </Button>
            </div>
          )}
          
          {currentStep === "skillset" && (
            <div className="space-y-4">
              <div className="max-h-[50vh] overflow-y-auto space-y-2">
                {INDUSTRY_CATEGORIES.map((industry) => (
                  <Collapsible key={industry.id}>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg border hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <industry.icon className="w-5 h-5" />
                        <span className="font-medium">{industry.label}</span>
                        <span className="text-xs text-muted-foreground">
                          ({t("selected", { count: selectedSkills.filter(s => industry.roles.some(r => r.id === s)).length })})
                        </span>
                      </div>
                      <ChevronDown className="w-4 h-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2 space-y-2">
                      {industry.roles.map((role) => (
                        <div key={role.id} className="flex items-start gap-2 p-2 rounded hover:bg-muted/30">
                          <Checkbox
                            id={`skill-${role.id}`}
                            checked={selectedSkills.includes(role.id)}
                            onCheckedChange={() => toggleSkill(role.id)}
                          />
                          <Label
                            htmlFor={`skill-${role.id}`}
                            className="flex-1 cursor-pointer"
                          >
                            <div className="font-medium">{role.label}</div>
                            <div className="text-xs text-muted-foreground">{role.desc}</div>
                          </Label>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
              
              <Button
                onClick={handleSkillsetSubmit}
                className="w-full"
                disabled={selectedSkills.length === 0 || submittingSkillset}
              >
                {submittingSkillset ? (
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-24" />
                  </div>
                ) : (
                  t("saveSkills", { count: selectedSkills.length })
                )}
              </Button>
            </div>
          )}
          
        </div>
        
        {missingSteps.length > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4 border-t">
            {missingSteps.map((step, index) => (
              <div
                key={step}
                className={`w-2 h-2 rounded-full ${
                  index === currentStepIndex
                    ? "bg-primary"
                    : index < currentStepIndex
                    ? "bg-green-500"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
