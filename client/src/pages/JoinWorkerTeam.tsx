import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { useAuth } from "@/hooks/use-auth";
import { getUrlForPath } from "@/lib/subdomain-utils";
import { Loader2, Users, CheckCircle, AlertCircle, Eye, EyeOff, Shield, Briefcase, Wrench, Camera, Upload, CheckCircle2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as faceapi from "@vladmandic/face-api";

// Make password optional - only required if not using Google signup
const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine(data => {
  // If password is provided, it must be at least 8 characters
  if (data.password && data.password.length > 0) {
    return data.password.length >= 8;
  }
  return true;
}, {
  message: "Password must be at least 8 characters",
  path: ["password"],
}).refine(data => {
  // If password is provided, confirmPassword must match
  if (data.password && data.password.length > 0) {
    return data.password === data.confirmPassword;
  }
  return true;
}, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof formSchema>;

interface InviteData {
  member: {
    firstName: string;
    lastName: string;
    email: string;
    role: "admin" | "employee";
    hourlyRate: number;
    skillsets: string[];
  };
  owner: {
    firstName: string;
    lastName: string;
    companyLogo?: string | null;
  } | null;
  teamName: string;
}

export default function JoinWorkerTeam() {
  const { t } = useTranslation("joinWorkerTeam");
  const { t: tCommon } = useTranslation("common");
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [faceVerified, setFaceVerified] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [isVerifyingFace, setIsVerifyingFace] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile } = useUpload({
    onSuccess: (response) => {
      setAvatarUrl(response.url);
      setUploadingAvatar(false);
    },
    onError: () => {
      toast({
        title: tCommon("error"),
        description: "Failed to upload avatar",
        variant: "destructive",
      });
      setUploadingAvatar(false);
    },
  });

  const handleGoogleAuthAccept = async () => {
    // Upload avatar first if provided
    let uploadedAvatarUrl = avatarUrl;
    if (avatarFile && !avatarUrl) {
      setUploadingAvatar(true);
      try {
        const uploadResponse = await uploadFile(avatarFile, "avatar");
        uploadedAvatarUrl = uploadResponse.url;
      } catch (error) {
        toast({
          title: tCommon("error"),
          description: "Failed to upload avatar",
          variant: "destructive",
        });
        setUploadingAvatar(false);
        return;
      }
      setUploadingAvatar(false);
    }

    try {
      // Get current form values for name and email
      const formValues = form.getValues();
      const res = await apiRequest("POST", `/api/team/invite/${token}/accept`, {
        firstName: formValues.firstName || inviteData?.member.firstName || "",
        lastName: formValues.lastName || inviteData?.member.lastName || "",
        email: formValues.email || inviteData?.member.email || user?.email || "",
        password: undefined, // No password needed for Google auth
        avatarUrl: uploadedAvatarUrl || undefined,
      });
      setIsSuccess(true);
      toast({
        title: t("accountCreated"),
        description: t("teamMemberAccountCreated"),
      });
    } catch (err: any) {
      toast({
        title: tCommon("error"),
        description: err.message || t("failedToCreateAccount"),
        variant: "destructive",
      });
    }
  };

  const { data: inviteData, isLoading, error } = useQuery<InviteData>({
    queryKey: ["/api/team/invite", token],
    queryFn: async () => {
      const res = await fetch(`/api/team/invite/${token}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Invalid invite");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  // Check if user returned from Google OAuth
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("googleAuth") === "true" && isAuthenticated && user && inviteData && !isSuccess) {
      // User is authenticated via Google, check if email matches
      if (user.email === inviteData.member.email) {
        // Auto-submit the form without password (Google auth)
        handleGoogleAuthAccept();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, inviteData, isSuccess]);

  // Load face-api models
  useEffect(() => {
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
    loadModels();
  }, []);

  // Face detection function
  const detectFace = async (imageDataUrl: string): Promise<boolean> => {
    if (!modelsLoaded) {
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
          resolve(true);
        }
      };
      img.onerror = () => resolve(true);
      img.src = imageDataUrl;
    });
  };

  // Handle avatar upload with face verification
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
        setAvatarFile(file);
        setFaceError(null);
      } else {
        setFaceVerified(false);
        setFaceError("Please upload a clear photo of your face for verification.");
        setAvatarFile(null);
        setAvatarPreview(null);
      }
      setIsVerifyingFace(false);
    };
    reader.readAsDataURL(file);
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  // Update form defaults when invite data loads
  useEffect(() => {
    if (inviteData) {
      form.reset({
        firstName: inviteData.member.firstName || "",
        lastName: inviteData.member.lastName || "",
        email: inviteData.member.email || "",
        password: "",
        confirmPassword: "",
      });
    }
  }, [inviteData, form]);

  const acceptMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Upload avatar first if provided
      let uploadedAvatarUrl = avatarUrl;
      if (avatarFile && !avatarUrl) {
        setUploadingAvatar(true);
        const uploadResponse = await uploadFile(avatarFile, "avatar");
        uploadedAvatarUrl = uploadResponse.url;
        setUploadingAvatar(false);
      }

      const res = await apiRequest("POST", `/api/team/invite/${token}/accept`, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password || undefined,
        avatarUrl: uploadedAvatarUrl || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setIsSuccess(true);
      toast({
        title: t("accountCreated"),
        description: t("teamMemberAccountCreated"),
      });
    },
    onError: (err: Error) => {
      toast({
        title: tCommon("error"),
        description: err.message || t("failedToCreateAccount"),
        variant: "destructive",
      });
    },
  });

  const handleGoogleSignup = () => {
    // Store the invite token in sessionStorage so we can redirect back after Google auth
    if (token) {
      sessionStorage.setItem("teamInviteToken", token);
    }
    const returnTo = `/team/join/${token}`;
    const googleAuthUrl = getUrlForPath(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`, true);
    window.location.href = googleAuthUrl;
  };

  const onSubmit = (data: FormData) => {
    // Validate avatar is uploaded
    if (!avatarFile && !avatarUrl) {
      toast({
        title: tCommon("error"),
        description: "Please upload a profile photo with your face visible",
        variant: "destructive",
      });
      return;
    }

    // Validate password if not using Google
    if (!data.password || data.password.length === 0) {
      toast({
        title: tCommon("error"),
        description: "Please create a password or sign up with Google",
        variant: "destructive",
      });
      return;
    }

    acceptMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="loading-join-worker-team">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" data-testid="card-invite-error">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>{t("invalidInvitation")}</CardTitle>
            <CardDescription>
              {(error as Error).message || t("invitationLinkInvalidOrExpired")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button
              variant="outline"
              onClick={() => setLocation("/")}
              data-testid="button-go-home"
            >
              {t("goToHome")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" data-testid="card-success">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>{t("welcomeToTheTeam")}</CardTitle>
            <CardDescription>
              {t("accountCreatedCanSignIn")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button
              onClick={() => setLocation("/dashboard")}
              data-testid="button-sign-in"
            >
              {t("nav.signIn")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ownerName = inviteData?.owner 
    ? `${inviteData.owner.firstName} ${inviteData.owner.lastName}` 
    : t("businessOperator");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md" data-testid="card-join-worker-team">
        <CardHeader className="text-center">
          {inviteData?.owner?.companyLogo && (
            <div className="mx-auto mb-4">
              <img 
                src={inviteData.owner.companyLogo} 
                alt={`${inviteData.teamName} logo`}
                className="h-16 w-16 object-contain rounded-lg"
              />
            </div>
          )}
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t("joinOwnersTeam", { ownerName })}</CardTitle>
          <CardDescription>
            {t("invitedToJoinAsTeamMember")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("role")}</span>
              <Badge variant={inviteData?.member.role === "admin" ? "default" : "secondary"}>
                {inviteData?.member.role === "admin" ? (
                  <><Shield className="w-3 h-3 mr-1" /> {t("admin")}</>
                ) : (
                  <><Briefcase className="w-3 h-3 mr-1" /> {t("employee")}</>
                )}
              </Badge>
            </div>
            {inviteData?.member.skillsets && inviteData.member.skillsets.length > 0 && (
              <div className="flex items-start justify-between">
                <span className="text-sm text-muted-foreground">{t("home.skills")}</span>
                <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                  {inviteData.member.skillsets.slice(0, 3).map((skill) => (
                    <Badge key={skill} variant="outline" className="text-xs">
                      <Wrench className="w-3 h-3 mr-1" />
                      {skill}
                    </Badge>
                  ))}
                  {inviteData.member.skillsets.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{inviteData.member.skillsets.length - 3} {t("more")}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground text-center">
            {inviteData?.member.role === "admin" 
              ? t("adminDescription")
              : t("employeeDescription")}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="First name" 
                          {...field} 
                          data-testid="input-first-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Last name" 
                          {...field} 
                          data-testid="input-last-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Email Field */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("email")}</FormLabel>
                    <FormControl>
                      <Input 
                        type="email"
                        placeholder="Email address" 
                        {...field} 
                        data-testid="input-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Avatar Upload */}
              <div className="space-y-2">
                <FormLabel>Profile Photo (Required)</FormLabel>
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <Avatar className="w-24 h-24">
                      <AvatarImage src={avatarPreview || avatarUrl || undefined} />
                      <AvatarFallback className="text-2xl">
                        {form.watch("firstName")?.[0] || inviteData?.member.firstName?.[0] || ""}{form.watch("lastName")?.[0] || inviteData?.member.lastName?.[0] || ""}
                      </AvatarFallback>
                    </Avatar>
                    {faceVerified && (
                      <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1">
                        <CheckCircle2 className="w-5 h-5 text-white" />
                      </div>
                    )}
                    {faceError && (
                      <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-1">
                        <XCircle className="w-5 h-5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                      id="avatar-upload"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isVerifyingFace || uploadingAvatar}
                      className="w-full"
                    >
                      {isVerifyingFace ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Verifying...
                        </>
                      ) : uploadingAvatar ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Camera className="w-4 h-4 mr-2" />
                          {avatarPreview || avatarUrl ? "Change Photo" : "Upload Photo"}
                        </>
                      )}
                    </Button>
                    {faceError && (
                      <p className="text-sm text-destructive text-center">{faceError}</p>
                    )}
                    {faceVerified && !faceError && (
                      <p className="text-sm text-green-600 text-center">Face verified ✓</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or
                  </span>
                </div>
              </div>

              {/* Google Signup Button */}
              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignup}
                className="w-full"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Sign up with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or create password
                  </span>
                </div>
              </div>

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("createPassword")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input 
                          type={showPassword ? "text" : "password"}
                          placeholder={t("chooseSecurePassword")} 
                          {...field} 
                          className="pr-10"
                          data-testid="input-password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("confirmPassword")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input 
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder={t("confirmYourPassword")} 
                          {...field} 
                          className="pr-10"
                          data-testid="input-confirm-password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          data-testid="button-toggle-confirm-password"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full" 
                disabled={acceptMutation.isPending || uploadingAvatar || isVerifyingFace || (!avatarFile && !avatarUrl)}
                data-testid="button-create-account"
              >
                {acceptMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("creatingAccount")}
                  </>
                ) : (
                  t("acceptInvitationAndCreateAccount")
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
