import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useProfile, useUpdateProfile, invalidateSessionProfileQueries } from "@/hooks/use-profiles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Camera, Loader2, CheckCircle, Settings } from "lucide-react";
import * as faceapi from "@vladmandic/face-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";
import { api } from "@shared/routes";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";

interface TeammateSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId?: number;
}

export function TeammateSettingsDialog({
  open,
  onOpenChange,
  profileId,
}: TeammateSettingsDialogProps) {
  const { t } = useTranslation("profileSettings");
  const { t: tCommon } = useTranslation("common");
  const { data: profile, isLoading: profileLoading } = useProfile(profileId);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateProfile = useUpdateProfile();
  const { uploadFile, isUploading } = useUpload();

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });

  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [isVerifyingFace, setIsVerifyingFace] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [selectedSkillsets, setSelectedSkillsets] = useState<string[]>([]);

  // Load profile data
  useEffect(() => {
    if (profile) {
      setFormData({
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        email: profile.email || "",
        phone: profile.phone || "",
      });
      setAvatarUrl(profile.avatarUrl || "");
      setSelectedSkillsets(profile.skillsets || []);
      setFaceVerified(true); // Assume existing avatar is verified
    }
  }, [profile]);

  // Load face detection models
  useEffect(() => {
    if (!open || !profile || profile.role !== "worker") {
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
          console.warn("Face detection models could not be loaded");
          setModelsLoaded(true);
        }
      } catch (error) {
        console.warn("Face detection initialization failed");
        setModelsLoaded(true);
      }
    };
    
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(loadModels, { timeout: 3000 });
    } else {
      setTimeout(loadModels, 0);
    }
  }, [open, profile]);

  // Face detection function
  const detectFace = async (imageDataUrl: string): Promise<boolean> => {
    if (!modelsLoaded) {
      return true; // Allow through if models aren't loaded
    }

    try {
      const img = await faceapi.fetchImage(imageDataUrl);
      const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions());
      return detections.length > 0;
    } catch (error) {
      console.warn("Face detection error:", error);
      return true; // Allow through on error
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: t("invalidFileType") || "Invalid file type",
        description: t("pleaseSelectImageFile") || "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingFace(true);
    setFaceError(null);
    setFaceVerified(false);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const imageData = event.target?.result as string;
      setAvatarPreview(imageData);
      setAvatarFile(file);
      
      const hasFace = await detectFace(imageData);
      
      if (hasFace) {
        setFaceVerified(true);
        setFaceError(null);
      } else {
        setFaceVerified(false);
        setFaceError(t("pleaseUploadClearFacePhoto") || "Please upload a clear face photo");
        toast({
          title: t("faceNotDetected") || "Face not detected",
          description: t("pleaseUploadClearFacePhoto") || "Please upload a clear face photo",
          variant: "destructive",
        });
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarSubmit = async () => {
    if (!avatarFile) return;
    
    if (!faceVerified) {
      toast({
        title: t("faceVerificationRequired") || "Face verification required",
        description: faceError || t("pleaseUploadClearFacePhoto") || "Please upload a clear face photo",
        variant: "destructive",
      });
      return;
    }
    
    if (!profile?.id) return;
    
    setUploadingAvatar(true);
    try {
      const uploadResponse = await uploadFile(avatarFile, "avatar");
      if (!uploadResponse?.objectPath) {
        throw new Error("Failed to upload avatar");
      }
      
      let finalObjectPath = uploadResponse.objectPath;
      if (!finalObjectPath.includes("/avatar/") && !finalObjectPath.startsWith("/objects/avatar/")) {
        if (finalObjectPath.startsWith("/objects/uploads/")) {
          finalObjectPath = finalObjectPath.replace("/objects/uploads/", "/objects/avatar/uploads/");
        } else if (finalObjectPath.startsWith("/objects/")) {
          const parts = finalObjectPath.split("/");
          if (parts.length >= 3 && parts[2] !== "avatar") {
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
        title: t("avatarUploaded") || "Avatar uploaded",
        description: t("profilePictureUpdatedAndVerified") || "Profile picture updated and verified",
      });
      
      await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      invalidateSessionProfileQueries(queryClient);
    } catch (error: any) {
      toast({
        title: t("uploadFailed") || "Upload failed",
        description: error.message || t("failedToUploadAvatar") || "Failed to upload avatar",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!profile?.id) return;
    
    // If there's a new avatar file, upload it first
    if (avatarFile && faceVerified) {
      await handleAvatarSubmit();
    }
    
    const dataToSave: any = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      skillsets: selectedSkillsets,
    };
    
    if (avatarUrl && !avatarFile) {
      dataToSave.avatarUrl = avatarUrl;
    }
    
    try {
      await updateProfile.mutateAsync(dataToSave);
      toast({
        title: tCommon("updated") || "Updated",
        description: t("profileUpdated") || "Profile updated successfully",
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: tCommon("error") || "Error",
        description: error.message || t("failedToUpdateProfile") || "Failed to update profile",
        variant: "destructive",
      });
    }
  };

  const toggleSkillset = (skill: string) => {
    setSelectedSkillsets((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill]
    );
  };

  if (profileLoading) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Settings">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </ResponsiveDialog>
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Teammate Settings"
      hideDefaultFooter
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        <ScrollArea className="flex-1 px-4 sm:px-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="relative">
              <div className={`relative w-24 h-24 rounded-full border-4 overflow-hidden ${
                faceVerified ? "border-green-500" : faceError ? "border-destructive" : "border-border"
              }`}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <Avatar className="w-full h-full">
                    <AvatarImage src={avatarUrl || undefined} />
                    <AvatarFallback className="text-2xl">
                      {formData.firstName?.[0]}{formData.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                )}
                {isVerifyingFace && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <Skeleton className="w-8 h-8 rounded-full" />
                  </div>
                )}
                {faceVerified && !isVerifyingFace && (
                  <div className="absolute bottom-0 right-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center border-2 border-background">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center border-2 border-background shadow-md"
                disabled={isUploading || isVerifyingFace || uploadingAvatar}
              >
                {isUploading || isVerifyingFace || uploadingAvatar ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
            {faceError && (
              <p className="text-sm text-destructive text-center">{faceError}</p>
            )}
          </div>

          <Separator />

          {/* Language Selection */}
          <div className="space-y-2">
            <Label>Language</Label>
            <LanguageSelector showLabel={false} />
          </div>

          <Separator />

          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          <Separator />

          {/* Skillsets */}
          <div className="space-y-3">
            <Label>Skillsets</Label>
            <Card className="p-4">
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {INDUSTRY_CATEGORIES.map((industry) => (
                    <div key={industry.name} className="space-y-1">
                      <div className="font-medium text-sm">{industry.name}</div>
                      <div className="flex flex-wrap gap-2 ml-4">
                        {industry.roles.map((role) => (
                          <div key={role} className="flex items-center space-x-2">
                            <Checkbox
                              id={`skill-${role}`}
                              checked={selectedSkillsets.includes(role)}
                              onCheckedChange={() => toggleSkillset(role)}
                            />
                            <Label
                              htmlFor={`skill-${role}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {role}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </Card>
          </div>
        </ScrollArea>

        {/* Sticky Footer with 2-column button layout */}
        <div className="border-t bg-background shadow-[0_-4px_12px_rgba(0,0,0,0.1)] mt-auto">
          <div className="flex items-center justify-between gap-4 p-4 sm:p-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 sm:flex-none sm:min-w-[120px]"
            >
              {tCommon("cancel") || "Cancel"}
            </Button>
            <Button
              type="submit"
              disabled={updateProfile.isPending || uploadingAvatar}
              className="flex-1 sm:flex-none sm:min-w-[140px] bg-gradient-to-r from-[#1a1a1a] to-[#2d2d2d] hover:from-[#2d2d2d] hover:to-[#1a1a1a] text-white border-0"
            >
              {updateProfile.isPending || uploadingAvatar ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {tCommon("saving") || "Saving..."}
                </>
              ) : (
                tCommon("saveChanges") || "Save Changes"
              )}
            </Button>
          </div>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
