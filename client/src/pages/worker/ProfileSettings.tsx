import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, invalidateSessionProfileQueries, profileMeQueryKey } from "@/hooks/use-profiles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { ArrowLeft, Camera, Loader2, Check, CheckCircle, X, Upload, ChevronRight, MapPin, Briefcase, Calendar, Mail, Phone, Home, Shield, FileText, Heart, Search, Building2, Key, Eye, EyeOff } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as faceapi from "@vladmandic/face-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const BACK_URL = "/dashboard/menu";

/** Max distance (miles) between device location and saved address to allow save. 20 mi accommodates GPS variance and IP fallback (approximate location when GPS unavailable). */
const ADDRESS_VERIFICATION_MAX_MILES = 20;

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** IP-based fallback for dev (non-HTTPS) where navigator.geolocation is denied or unavailable. */
async function getDeviceLocationViaIp(): Promise<{ lat: number; lng: number }> {
  const res = await fetch("https://ipapi.co/json/", { method: "GET" });
  if (!res.ok) throw new Error("IP location failed");
  const data = await res.json();
  const lat = data.latitude != null ? Number(data.latitude) : NaN;
  const lng = data.longitude != null ? Number(data.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Invalid IP location");
  return { lat, lng };
}

function getDeviceLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      getDeviceLocationViaIp().then(resolve).catch(reject);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        getDeviceLocationViaIp().then(resolve).catch(reject);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

// Bio validation - detect and block personal information
function validateBio(text: string): { isValid: boolean; error: string | null } {
  const lowerText = text.toLowerCase();
  
  // Email patterns
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (emailPattern.test(text)) {
    return { isValid: false, error: "Bio cannot contain email addresses. Please remove any email to continue." };
  }
  
  // Phone number patterns (various formats)
  const phonePatterns = [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // 123-456-7890, 123.456.7890, 123 456 7890
    /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/, // (123) 456-7890
    /\b\d{10}\b/, // 1234567890
    /\b\+?1?\s?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // +1 123-456-7890
  ];
  for (const pattern of phonePatterns) {
    if (pattern.test(text)) {
      return { isValid: false, error: "Bio cannot contain phone numbers. Please remove any phone number to continue." };
    }
  }
  
  // URL/Website patterns
  const urlPatterns = [
    /https?:\/\/[^\s]+/i, // http:// or https://
    /www\.[^\s]+\.[a-z]{2,}/i, // www.example.com
    /[a-zA-Z0-9-]+\.(com|net|org|io|co|us|info|biz|me|dev|app|tech|xyz)[^\w]/i, // example.com, mysite.net, etc.
  ];
  for (const pattern of urlPatterns) {
    if (pattern.test(text)) {
      return { isValid: false, error: "Bio cannot contain websites or URLs. Please remove any links to continue." };
    }
  }
  
  // Contact-related keywords paired with potential contact info
  if (/(call|text|email|contact|reach|dm|message|whatsapp|telegram|instagram|facebook|twitter|snapchat|tiktok)/i.test(lowerText)) {
    // If these keywords exist, be extra vigilant about number-like patterns
    if (/\b\d{7,}\b/.test(text)) { // 7+ consecutive digits
      return { isValid: false, error: "Bio appears to contain contact information. Please remove it to continue." };
    }
  }
  
  return { isValid: true, error: null };
}

// Predefined interests list
const AVAILABLE_INTERESTS = [
  "Adrenaline sports", "American football", "Animals", "Anime", "Archery", "Architecture", "Art", "Artisanal crafts",
  "Aviation", "Badminton", "Baseball", "Basketball", "Basque pelota", "Billiards", "Board games", "Bobsledding",
  "Bocce ball", "Bowling", "Boxing", "Bridge", "Building things", "Camping", "Canoeing", "Card Games", "Cars",
  "Charreria", "Cheerleading", "Chess", "Climbing", "Cocktails", "Coffee", "Comedy", "Content creation", "Cooking",
  "Crafting", "Cricket", "Cultural heritage", "Curling", "Cycling", "Dance", "Darts", "Design", "Diving", "Dodgeball",
  "Equestrian sports", "Fantasy sports", "Fashion", "Fencing", "Field hockey", "Figure skating", "Fishing", "Fitness",
  "Food scenes", "Gardening", "Golf", "Gymnastics", "Hair", "Handball", "Hiking", "History", "Hockey", "Home improvement",
  "Horse racing", "Judo", "Karate", "Kayaking", "Kickboxing", "Kung fu", "Lacrosse", "Live music", "Live sports",
  "Local culture", "Luge", "Makeup", "Meditation", "Motor sports", "Movies", "Museums", "Netball", "Nightlife",
  "Outdoors", "Padel", "Pentathlon", "Photography", "Pickleball", "Plants", "Playing music", "Podcasts", "Poker",
  "Polo", "Puzzles", "Racquetball", "Reading", "Rodeo", "Roller derby", "Roller skating", "Rowing", "Rugby", "Running",
  "Sailing", "Self-care", "Shooting sports", "Shopping", "Singing", "Skateboarding", "Skiing", "Snorkeling",
  "Snowboarding", "Soccer", "Social activism", "Spa", "Squash", "Sumo wrestling", "Surfing", "Sustainability",
  "Swimming", "Table tennis", "Taekwondo", "Tai chi", "Technology", "Tennis", "Theater", "Track & field", "Travel",
  "TV", "Ultimate frisbee", "Video games", "Volleyball", "Volunteering", "Walking", "Water polo", "Water sports",
  "Weight lifting", "Wine", "Wrestling", "Writing", "Yoga"
];

/** Embeddable profile settings content for menu right panel or standalone page. */
export function ProfileSettingsContent({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation("profileSettings");
  const { t: tCommon } = useTranslation("common");
  const { user, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    businessName: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    latitude: "" as string | number | undefined,
    longitude: "" as string | number | undefined,
    companyLogo: "",
    bio: "",
    interests: [] as string[],
  });
  
  const [editingField, setEditingField] = useState<string | null>(null);
  const [interestSearchQuery, setInterestSearchQuery] = useState("");

  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [isVerifyingFace, setIsVerifyingFace] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Load face detection models for workers
  useEffect(() => {
    if (profile?.role !== "worker") {
      setModelsLoaded(true);
      return;
    }

    const loadModels = async () => {
      try {
        const modelUrls = [
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

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => {
      // Don't set avatarUrl here - wait for face verification
    },
    onError: () => {
      toast({ title: t("uploadFailed"), description: t("couldNotUploadPhoto"), variant: "destructive" });
      setUploadingAvatar(false);
    },
  });

  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(null);
  const [uploadingCompanyLogo, setUploadingCompanyLogo] = useState(false);
  const companyLogoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      const addr = profile.address || "";
      const city = profile.city || "";
      const state = profile.state || "";
      const zipCode = profile.zipCode || "";
      const addressLine = addr.includes(",") ? addr : [addr, city, state, zipCode].filter(Boolean).join(", ") || addr;
      setFormData({
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        email: profile.email || "",
        phone: profile.phone || "",
        businessName: profile.companyName || "",
        address: addressLine,
        city,
        state,
        zipCode,
        latitude: (profile as any).latitude ?? "",
        longitude: (profile as any).longitude ?? "",
        companyLogo: profile.companyLogo || "",
        bio: (profile as any).bio || "",
        interests: (profile as any).interests || [],
      });
      setAvatarUrl(profile.avatarUrl || "");
      setAvatarPreview(profile.avatarUrl || null);
      setFaceVerified(profile.faceVerified || false);
      setCompanyLogoUrl(profile.companyLogo || "");
      setCompanyLogoPreview(profile.companyLogo || null);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { avatarUrl?: string }) => {
      // Map businessName to companyName for the API
      const apiData = { ...data };
      if ('businessName' in apiData) {
        (apiData as any).companyName = apiData.businessName;
        delete (apiData as any).businessName;
      }
      if (profile?.id) {
        return apiRequest("PUT", `/api/profiles/${profile.id}`, apiData);
      } else {
        return apiRequest("POST", "/api/profiles", { ...apiData, role: "worker" });
      }
    },
    onSuccess: async () => {
      toast({ title: t("profileSaved"), description: t("changesHaveBeenSaved") });
      // Invalidate all profile-related queries to update avatars everywhere
      await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      invalidateSessionProfileQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      await queryClient.refetchQueries({ queryKey: profileMeQueryKey(user?.id) });
    },
    onError: () => {
      toast({ title: tCommon("error"), description: t("couldNotSaveChanges"), variant: "destructive" });
    },
  });

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate it's an image
    if (!file.type.startsWith("image/")) {
      toast({
        title: t("invalidFile"),
        description: t("pleaseUploadImageFile"),
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
        setFaceError(t("pleaseUploadClearFacePhoto"));
        toast({
          title: t("faceNotDetected"),
          description: t("pleaseUploadClearFacePhoto"),
          variant: "destructive",
        });
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarSubmit = async () => {
    if (!avatarFile) {
      toast({
        title: t("noImageSelected"),
        description: t("pleaseSelectImageToUpload"),
        variant: "destructive",
      });
      return;
    }
    
    if (!faceVerified) {
      toast({
        title: t("faceVerificationRequired"),
        description: faceError || t("pleaseUploadClearFacePhoto"),
        variant: "destructive",
      });
      return;
    }
    
    if (!profile?.id) {
      toast({
        title: tCommon("error"),
        description: t("profileNotFound"),
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
        }
      }
      
      await apiRequest("PUT", `/api/profiles/${profile.id}`, {
        avatarUrl: finalObjectPath,
        faceVerified: true,
        faceVerifiedAt: new Date(),
      });
      
      setAvatarUrl(finalObjectPath);
      setFaceVerified(true);
      
      toast({
        title: t("avatarUploaded"),
        description: t("profilePictureUpdatedAndVerified"),
      });
      
      // Invalidate all profile-related queries to update avatars everywhere
      await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      invalidateSessionProfileQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["/api/today/assignments"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/jobs/find-work"] });
      await queryClient.refetchQueries({ queryKey: profileMeQueryKey(user?.id) });
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // For workers, if there's a new avatar file, require face verification
    if (profile?.role === "worker" && avatarFile && !faceVerified) {
      toast({
        title: t("faceVerificationRequired"),
        description: t("pleaseVerifyFacePhotoBeforeSaving"),
        variant: "destructive",
      });
      return;
    }
    
    // Only include avatarUrl if it's been verified (for workers) or if there's no new file
    const dataToSave: typeof formData & { avatarUrl?: string; companyLogo?: string } = { ...formData };
    if (profile?.role === "worker") {
      // For workers, only save avatar if it's verified or if no new file was selected
      if (!avatarFile || faceVerified) {
        dataToSave.avatarUrl = avatarUrl;
      }
    } else {
      // For non-workers, always save avatarUrl
      dataToSave.avatarUrl = avatarUrl;
    }
    
    // Include company logo if it's been uploaded
    if (companyLogoUrl) {
      dataToSave.companyLogo = companyLogoUrl;
    }
    
    saveMutation.mutate(dataToSave);
  };

  if (authLoading || profileLoading) {
    return (
      <div className={embedded ? "py-8 flex justify-center" : "min-h-screen flex items-center justify-center"}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleFieldSave = async (field: string) => {
    // Validate bio before saving
    if (field === "bio") {
      const validation = validateBio(formData.bio);
      if (!validation.isValid) {
        toast({
          title: "Bio Validation Failed",
          description: validation.error || "Please remove personal information from your bio.",
          variant: "destructive",
        });
        return;
      }
    }

    const payload = { ...formData } as Record<string, unknown>;
    // Never send empty string for numeric DB columns (crashes server)
    if (payload.latitude === "" || payload.latitude == null) delete payload.latitude;
    if (payload.longitude === "" || payload.longitude == null) delete payload.longitude;

    // When saving address: require device location verification (pin) to prevent location fraud
    if (field === "address") {
      let addressLat: number;
      let addressLng: number;
      const hasLatLng = formData.latitude !== "" && formData.latitude != null && formData.longitude !== "" && formData.longitude != null;
      if (hasLatLng) {
        addressLat = typeof formData.latitude === "number" ? formData.latitude : Number(formData.latitude);
        addressLng = typeof formData.longitude === "number" ? formData.longitude : Number(formData.longitude);
      } else {
        const addressQuery = [formData.address, formData.city, formData.state, formData.zipCode].filter(Boolean).join(", ");
        if (!addressQuery || !import.meta.env.VITE_GOOGLE_API_KEY) {
          toast({
            title: "Address required",
            description: "Enter a full address and select it from the dropdown so we can verify your location.",
            variant: "destructive",
          });
          return;
        }
        try {
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressQuery)}&key=${import.meta.env.VITE_GOOGLE_API_KEY}`
          );
          const data = await res.json();
          const loc = data?.results?.[0]?.geometry?.location;
          if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
            toast({
              title: "Address not found",
              description: "We couldn't find that address. Please select it from the dropdown.",
              variant: "destructive",
            });
            return;
          }
          addressLat = loc.lat;
          addressLng = loc.lng;
        } catch {
          toast({
            title: "Address lookup failed",
            description: "Please try again or select the address from the dropdown.",
            variant: "destructive",
          });
          return;
        }
      }

      if (!Number.isFinite(addressLat) || !Number.isFinite(addressLng)) {
        toast({
          title: "Invalid address",
          description: "Select your address from the dropdown to save.",
          variant: "destructive",
        });
        return;
      }

      let deviceLoc: { lat: number; lng: number };
      try {
        deviceLoc = await getDeviceLocation();
      } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        const message = code === 1
          ? "Location access was denied. Please allow location so we can verify you're at this address."
          : code === 2 || code === 3
            ? "We couldn't get your location. Please enable location and try again."
            : "Please enable location access to verify you're at this address.";
        toast({
          title: "Location required",
          description: message,
          variant: "destructive",
        });
        return;
      }

      const miles = distanceMiles(deviceLoc.lat, deviceLoc.lng, addressLat, addressLng);
      if (miles > ADDRESS_VERIFICATION_MAX_MILES) {
        toast({
          title: "Address too far from your location",
          description: `Your device is about ${miles.toFixed(1)} mi away (we allow up to ${ADDRESS_VERIFICATION_MAX_MILES} mi). If you're on Wi‑Fi or dev mode we may be using approximate location—try again at the address or enable GPS.`,
          variant: "destructive",
        });
        return;
      }

      payload.latitude = String(addressLat);
      payload.longitude = String(addressLng);
    }

    saveMutation.mutate(payload as typeof formData & { avatarUrl?: string });
    setEditingField(null);
  };

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 max-w-3xl"}>
      {/* Profile Card */}
      <div className="bg-background rounded-2xl p-6 shadow-sm border border-border">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center md:items-start gap-4">
            <div className="relative">
              <div className={`relative w-32 h-32 rounded-full border-4 overflow-hidden ${
                faceVerified ? "border-green-500" : faceError ? "border-destructive" : "border-border"
              }`}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <Avatar className="w-full h-full">
                    <AvatarImage src={avatarUrl || undefined} />
                    <AvatarFallback className="text-3xl">
                      {formData.firstName?.[0]}{formData.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                )}
                {isVerifyingFace && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                )}
                {faceVerified && !isVerifyingFace && (
                  <div className="absolute bottom-2 right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center border-2 border-background">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center border-2 border-background shadow-lg hover:bg-primary/90 transition-colors"
                disabled={isUploading || isVerifyingFace || uploadingAvatar}
              >
                {isUploading || isVerifyingFace || uploadingAvatar ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Camera className="w-5 h-5" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
                disabled={isVerifyingFace || uploadingAvatar}
              />
            </div>
            
            {profile?.role === "worker" && avatarFile && faceVerified && (
              <Button
                type="button"
                onClick={handleAvatarSubmit}
                disabled={uploadingAvatar}
                size="sm"
                className="w-full"
              >
                {uploadingAvatar ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("uploading")}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {t("savePhoto")}
                  </>
                )}
              </Button>
            )}
            
            {profile?.role === "worker" && (
              <p className="text-xs text-muted-foreground text-center md:text-left">
                {faceVerified 
                  ? t("faceVerified")
                  : faceError 
                  ? faceError
                  : t("uploadClearPhotoOfFace")}
              </p>
            )}
          </div>

          {/* Profile Info */}
          <div className="flex-1 space-y-4">
            <div>
              <h2 className="text-2xl font-bold">{formData.firstName} {formData.lastName}</h2>
              <div className="flex items-center gap-1 text-muted-foreground mt-1">
                <MapPin className="w-4 h-4" />
                <span className="text-sm">
                  {formData.city && formData.state ? `${formData.city}, ${formData.state}` : t("noLocationSet")}
                </span>
              </div>
            </div>

            {profile?.role === "worker" && (
              <div className="flex items-center gap-2">
                {faceVerified && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <Shield className="w-4 h-4 text-green-600" />
                    <span className="font-medium">{t("identityVerified")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Personal Information List */}
      <div className="bg-background rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold">{t("personalInformation")}</h3>
        </div>
        
        <div className="divide-y divide-border">
          {/* First Name */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "firstName" ? (
              <div className="space-y-3">
                <Label htmlFor="firstName" className="text-sm font-medium">{t("firstName")}</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("firstName")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("firstName")}</p>
                  <p className="text-base font-medium mt-0.5">{formData.firstName || t("notProvided")}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("firstName")}>
                  {formData.firstName ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Last Name */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "lastName" ? (
              <div className="space-y-3">
                <Label htmlFor="lastName" className="text-sm font-medium">{t("lastName")}</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("lastName")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("lastName")}</p>
                  <p className="text-base font-medium mt-0.5">{formData.lastName || t("notProvided")}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("lastName")}>
                  {formData.lastName ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "email" ? (
              <div className="space-y-3">
                <Label htmlFor="email" className="text-sm font-medium">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("email")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("email")}</p>
                    <p className="text-base font-medium mt-0.5">{formData.email || t("notProvided")}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("email")}>
                  {formData.email ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Phone */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "phone" ? (
              <div className="space-y-3">
                <Label htmlFor="phone" className="text-sm font-medium">{t("phoneNumber")}</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder={t("phonePlaceholder")}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("phone")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("phoneNumber")}</p>
                    <p className="text-base font-medium mt-0.5">{formData.phone || t("notProvided")}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("phone")}>
                  {formData.phone ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Business Name */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "businessName" ? (
              <div className="space-y-3">
                <Label htmlFor="businessName" className="text-sm font-medium">Business Name</Label>
                <Input
                  id="businessName"
                  value={formData.businessName}
                  onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                  placeholder="Enter your business name"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">This will be used as your Mercury payment nickname</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("businessName")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Business Name</p>
                    <p className="text-base font-medium mt-0.5">{formData.businessName || t("notProvided")}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("businessName")}>
                  {formData.businessName ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Address: single-line Google Places picker (fills address, city, state, zip, lat/lng) */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "address" ? (
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t("address")}</Label>
                <GooglePlacesAutocomplete
                  value={formData.address}
                  onChange={(address, components) => {
                    setFormData({
                      ...formData,
                      address: address || "",
                      city: components.city ?? formData.city,
                      state: components.state ?? formData.state,
                      zipCode: components.zipCode ?? formData.zipCode,
                      ...(components.latitude != null && components.longitude != null && {
                        latitude: components.latitude,
                        longitude: components.longitude,
                      }),
                    });
                  }}
                  placeholder="Search for an address..."
                />
                {(formData.city || formData.state || formData.zipCode) && (
                  <p className="text-xs text-muted-foreground">
                    {[formData.city, formData.state, formData.zipCode].filter(Boolean).join(", ")}
                    {formData.latitude != null && formData.longitude != null && " · lat/lng saved"}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  When you save, we use your device location to confirm you are at or near this address.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("address")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingField(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Home className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t("address")}</p>
                    <p className="text-base font-medium mt-0.5">
                      {formData.address && formData.city && formData.state && formData.zipCode
                        ? `${formData.address}, ${formData.city}, ${formData.state} ${formData.zipCode}`
                        : t("notProvided")}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("address")}>
                  {formData.address ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Bio */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "bio" ? (
              <div className="space-y-3">
                <Label htmlFor="bio" className="text-sm font-medium">Bio</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => {
                    const newBio = e.target.value;
                    // Real-time validation feedback
                    const validation = validateBio(newBio);
                    setFormData({ ...formData, bio: newBio });
                    if (!validation.isValid && newBio.length > 20) {
                      // Only show warning if bio has substantial content
                      setFaceError(validation.error);
                    } else {
                      setFaceError(null);
                    }
                  }}
                  placeholder="Tell us about yourself..."
                  rows={4}
                  className="resize-none"
                  autoFocus
                  maxLength={500}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{formData.bio.length} / 500 characters</p>
                </div>
                {faceError && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                    <p className="text-xs text-destructive font-medium">{faceError}</p>
                  </div>
                )}
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Privacy Note:</strong> Do not include personal contact information (email, phone, websites) in your bio. This information is shared publicly.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFieldSave("bio")} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditingField(null); setFaceError(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">Bio</p>
                    <p className="text-base font-medium mt-0.5 line-clamp-2">
                      {formData.bio || "Tell us about yourself"}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("bio")} className="flex-shrink-0">
                  {formData.bio ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>

          {/* Interests - Inline in Personal Information */}
          <div className="p-4 hover:bg-muted/50 transition-colors">
            {editingField === "interests" ? (
              <div className="space-y-4">
                <Label className="text-sm font-medium">Interests</Label>
                
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search for interests..."
                    value={interestSearchQuery}
                    onChange={(e) => setInterestSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {/* Selected Interests */}
                {formData.interests.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      Your Interests ({formData.interests.length})
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {formData.interests.map((interest) => (
                        <Badge
                          key={interest}
                          variant="secondary"
                          className="pl-3 pr-2 py-1.5 text-sm hover:bg-secondary/80 cursor-pointer"
                          onClick={() => {
                            const newInterests = formData.interests.filter((i) => i !== interest);
                            setFormData({ ...formData, interests: newInterests });
                            saveMutation.mutate({ ...formData, interests: newInterests });
                          }}
                        >
                          {interest}
                          <X className="w-3 h-3 ml-1.5" />
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available Interests */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    {interestSearchQuery ? "Search Results" : "Popular Interests"}
                  </Label>
                  <div className="max-h-48 overflow-y-auto scrollbar-thin-pill border border-border rounded-lg p-3">
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_INTERESTS
                        .filter((interest) => 
                          !formData.interests.includes(interest) &&
                          interest.toLowerCase().includes(interestSearchQuery.toLowerCase())
                        )
                        .slice(0, 40)
                        .map((interest) => (
                          <Badge
                            key={interest}
                            variant="outline"
                            className="pl-2 pr-3 py-1.5 text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                            onClick={() => {
                              const newInterests = [...formData.interests, interest];
                              setFormData({ ...formData, interests: newInterests });
                              saveMutation.mutate({ ...formData, interests: newInterests });
                              setInterestSearchQuery("");
                            }}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {interest}
                          </Badge>
                        ))}
                    </div>
                    {AVAILABLE_INTERESTS.filter((interest) => 
                      !formData.interests.includes(interest) &&
                      interest.toLowerCase().includes(interestSearchQuery.toLowerCase())
                    ).length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-3">
                        {interestSearchQuery ? "No interests found" : "All interests added!"}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setEditingField(null)}>
                    <Check className="w-4 h-4 mr-1" />
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Heart className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">Interests</p>
                    {formData.interests.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {formData.interests.slice(0, 5).map((interest) => (
                          <Badge key={interest} variant="secondary" className="text-xs">
                            {interest}
                          </Badge>
                        ))}
                        {formData.interests.length > 5 ? (
                          <Badge variant="secondary" className="text-xs">
                            +{formData.interests.length - 5} more
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-base font-medium mt-0.5">Add interests to personalize your profile</p>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingField("interests")} className="flex-shrink-0">
                  {formData.interests.length > 0 ? "Edit" : "Add"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Login & Security */}
      <LoginSecuritySection embedded={embedded} />
    </div>
  );

  if (embedded) return <div className="pt-2 pb-4">{main}</div>;

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
    </div>
  );
}

type AuthMethods = { email: string | null; hasPassword: boolean; hasGoogle: boolean };

export function LoginSecuritySection({ embedded = true }: { embedded?: boolean }) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<AuthMethods>({
    queryKey: ["/api/auth/methods"],
    queryFn: async () => {
      const res = await fetch("/api/auth/methods", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load login methods");
      return res.json();
    },
  });

  const [pwOpen, setPwOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // Surface result of Google linking redirect (?googleLinked=success|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("googleLinked");
    if (!linked) return;
    if (linked === "success") {
      toast({ title: "Google connected", description: "You can now sign in with Google." });
      refetch();
    } else {
      const reason = params.get("reason");
      const desc =
        reason === "email_mismatch"
          ? "That Google account doesn't match the email on this account."
          : reason === "no_user"
          ? "We couldn't find your account. Please sign in again."
          : "We couldn't connect your Google account. Try again.";
      toast({ title: "Couldn't connect Google", description: desc, variant: "destructive" });
    }
    params.delete("googleLinked");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [toast, refetch]);

  const hasPassword = !!data?.hasPassword;
  const hasGoogle = !!data?.hasGoogle;

  const submitPassword = async () => {
    setPwError(null);
    if (newPassword.length < 8) return setPwError("Password must be at least 8 characters");
    if (!/[A-Z]/.test(newPassword)) return setPwError("Password must contain an uppercase letter");
    if (!/[a-z]/.test(newPassword)) return setPwError("Password must contain a lowercase letter");
    if (!/[0-9]/.test(newPassword)) return setPwError("Password must contain a number");
    if (newPassword !== confirmNewPassword) return setPwError("Passwords don't match");
    if (hasPassword && !currentPassword) return setPwError("Enter your current password");

    setPwSubmitting(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword,
          ...(hasPassword ? { currentPassword } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(body?.message || "Failed to update password");
        return;
      }
      toast({
        title: hasPassword ? "Password updated" : "Password set",
        description: hasPassword
          ? "Your password has been changed."
          : "You can now sign in with email + password.",
      });
      setPwOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      refetch();
    } catch (e: any) {
      setPwError(e?.message || "Network error");
    } finally {
      setPwSubmitting(false);
    }
  };

  const [confirmRemovePw, setConfirmRemovePw] = useState(false);
  const [confirmDisconnectGoogle, setConfirmDisconnectGoogle] = useState(false);
  const [removingPassword, setRemovingPassword] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);

  const removePassword = async () => {
    setRemovingPassword(true);
    try {
      const res = await fetch("/api/auth/remove-password", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't remove password", description: body?.message || "Try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Password removed", description: body?.message || "You can now only sign in with Google." });
      setConfirmRemovePw(false);
      refetch();
    } finally {
      setRemovingPassword(false);
    }
  };

  const disconnectGoogle = async () => {
    setDisconnectingGoogle(true);
    try {
      const res = await fetch("/api/auth/disconnect-google", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't disconnect Google", description: body?.message || "Try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Google disconnected", description: body?.message || "Sign in with email + password from now on." });
      setConfirmDisconnectGoogle(false);
      refetch();
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const connectGoogle = () => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/api/auth/google?link=true&returnTo=${encodeURIComponent(returnTo)}`;
  };

  return (
    <div className={embedded ? "" : "container mx-auto px-4 max-w-3xl"}>
      <div className="bg-background rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold">Login & Security</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Choose how you sign in. You can use email + password, Google, or both.
          </p>
        </div>

        {isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Password row */}
            <div className="p-4 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">Password login</p>
                  <p className="text-base font-medium mt-0.5 flex items-center gap-2">
                    {hasPassword ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-600" /> Enabled
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPwError(null);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmNewPassword("");
                    setPwOpen(true);
                  }}
                  data-testid={hasPassword ? "button-change-password" : "button-set-password"}
                >
                  {hasPassword ? "Change" : "Set password"}
                </Button>
                {hasPassword && hasGoogle && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmRemovePw(true)}
                    data-testid="button-remove-password"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            {/* Google row */}
            <div className="p-4 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <SiGoogle className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">Google sign-in</p>
                  <p className="text-base font-medium mt-0.5 flex items-center gap-2 truncate">
                    {hasGoogle ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                        <span className="truncate">Connected{data?.email ? ` · ${data.email}` : ""}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not connected</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={connectGoogle}
                  data-testid={hasGoogle ? "button-reconnect-google" : "button-connect-google"}
                >
                  {hasGoogle ? "Reconnect" : "Connect Google"}
                </Button>
                {hasGoogle && hasPassword && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmDisconnectGoogle(true)}
                    data-testid="button-disconnect-google"
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>

            {!hasPassword && !hasGoogle && (
              <div className="px-4 pb-4 text-xs text-muted-foreground">
                You currently have no sign-in method beyond your active session. Set a password or connect Google so you can sign back in later.
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{hasPassword ? "Change password" : "Set a password"}</DialogTitle>
            <DialogDescription>
              {hasPassword
                ? "Enter your current password and a new one."
                : "Add a password so you can sign in with email + password too."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {hasPassword && (
              <div>
                <Label htmlFor="current-password">Current password</Label>
                <div className="relative mt-1">
                  <Input
                    id="current-password"
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    className="pr-10"
                    data-testid="input-current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="new-password">New password</Label>
              <div className="relative mt-1">
                <Input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Min 8 chars, with uppercase, lowercase, and a number.
              </p>
            </div>
            <div>
              <Label htmlFor="confirm-new-password">Confirm new password</Label>
              <Input
                id="confirm-new-password"
                type={showNew ? "text" : "password"}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1"
                data-testid="input-confirm-new-password"
              />
            </div>
            {pwError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2">
                {pwError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)} disabled={pwSubmitting}>
              Cancel
            </Button>
            <Button onClick={submitPassword} disabled={pwSubmitting} data-testid="button-submit-password">
              {pwSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : hasPassword ? "Update password" : "Set password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemovePw} onOpenChange={setConfirmRemovePw}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove password?</DialogTitle>
            <DialogDescription>
              You'll only be able to sign in with Google ({data?.email}). You can set a new password anytime from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemovePw(false)} disabled={removingPassword}>
              Cancel
            </Button>
            <Button
              onClick={removePassword}
              disabled={removingPassword}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-remove-password"
            >
              {removingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDisconnectGoogle} onOpenChange={setConfirmDisconnectGoogle}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect Google?</DialogTitle>
            <DialogDescription>
              You'll only be able to sign in with email + password. You can reconnect Google anytime from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisconnectGoogle(false)} disabled={disconnectingGoogle}>
              Cancel
            </Button>
            <Button
              onClick={disconnectGoogle}
              disabled={disconnectingGoogle}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-disconnect-google"
            >
              {disconnectingGoogle ? <Loader2 className="w-4 h-4 animate-spin" /> : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ProfileSettings() {
  return <ProfileSettingsContent />;
}
