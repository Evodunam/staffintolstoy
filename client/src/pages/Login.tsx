import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, fetchAffiliateMe } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, ArrowRight, Building2, HardHat, KeyRound, Link as LinkIcon, RefreshCw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { getUrlForPath } from "@/lib/subdomain-utils";
import { useTranslation } from "react-i18next";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"password" | "otp">("otp");
  const [showSignupDialog, setShowSignupDialog] = useState(false);
  const [showPasswordResetDialog, setShowPasswordResetDialog] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const { user, isAuthenticated } = useAuth();
  const { data: profile } = useProfile(isAuthenticated ? user?.id : undefined);
  const { data: affiliate, isLoading: affiliateLoading } = useQuery({
    queryKey: ["/api/affiliates/me"],
    queryFn: fetchAffiliateMe,
    retry: false,
    enabled: isAuthenticated && !!user?.id,
  });
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");

  // Get return URL from query params
  const searchParams = new URLSearchParams(window.location.search);
  const returnTo = searchParams.get("returnTo") || "/";

  // Redirect if already authenticated (affiliate first, then profile role)
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    if (affiliateLoading) return;
    const aff = affiliate as { onboardingComplete?: boolean } | undefined;
    if (aff?.onboardingComplete) {
      setLocation("/affiliate-dashboard");
      return;
    }
    if (profile) {
      if (profile.role === "company") {
        setLocation("/company-dashboard");
      } else if (profile.role === "worker") {
        setLocation("/dashboard");
      } else {
        setLocation(returnTo);
      }
    } else {
      setLocation(returnTo);
    }
  }, [isAuthenticated, user, profile, affiliate, affiliateLoading, setLocation, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Login failed");
      }

      // Invalidate auth query to refresh user data
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });

      toast({
        title: t("welcomeBack"),
        description: t("loginSuccess"),
      });

      // Redirect will happen via useEffect when user state updates
    } catch (error: any) {
      toast({
        title: t("loginFailed"),
        description: error.message || t("invalidEmailOrPassword"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    const returnTo = searchParams.get("returnTo") || "/";
    const googleAuthUrl = getUrlForPath(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`, true);
    window.location.href = googleAuthUrl;
  };

  const handleRequestOtp = async (sendMagicLink: boolean = true) => {
    if (!email) {
      toast({
        title: t("emailRequired"),
        description: t("enterEmailAddress"),
        variant: "destructive",
      });
      return;
    }

    setIsSendingOtp(true);
    try {
      // Always send both OTP and magic link when sendMagicLink is true
      const response = await fetch("/api/auth/login/email-otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          email, 
          method: sendMagicLink ? "magic_link" : "otp",
          sendBoth: sendMagicLink // Flag to send both OTP and magic link
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || `Server error: ${response.status}`);
      }

      // Check if user doesn't exist - show signup dialog
      if (data.userExists === false) {
        setIsSendingOtp(false);
        setShowSignupDialog(true);
        toast({
          title: t("accountNotFound"),
          description: t("noAccountWithEmail"),
          variant: "default",
        });
        return;
      }

      if (data.success && data.userExists !== false) {
        setShowOtpInput(true);
        if (sendMagicLink) {
          toast({
            title: t("loginCodeSent"),
            description: t("checkEmailForCodeAndLink"),
          });
        } else {
          toast({
            title: t("codeSent"),
            description: t("checkEmailForLoginCode"),
          });
        }
      } else {
        throw new Error(data.message || "Failed to send code");
      }
    } catch (error: any) {
      console.error("OTP request error:", error);
      toast({
        title: t("error"),
        description: error.message || t("failedToSendLoginCode"),
        variant: "destructive",
      });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !otpCode) {
      toast({
        title: t("requiredFields"),
        description: t("enterEmailAndOtpCode"),
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login/email-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, otpCode }),
      });

      const data = await response.json();
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
        toast({
          title: t("welcomeBack"),
          description: t("successfullyLoggedIn"),
        });
        // Redirect will happen via useEffect
      } else {
        throw new Error(data.message || "Invalid OTP code");
      }
    } catch (error: any) {
      toast({
        title: t("verificationFailed"),
        description: error.message || t("invalidOtpCode"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({
        title: t("emailRequired"),
        description: t("enterEmailAddress"),
        variant: "destructive",
      });
      return;
    }

    setIsSendingReset(true);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      const data = await response.json();
      if (data.success) {
        toast({
          title: t("resetLinkSent"),
          description: t("checkEmailForReset"),
        });
        setShowPasswordResetDialog(false);
      } else {
        throw new Error(data.message || "Failed to send reset link");
      }
    } catch (error: any) {
      toast({
        title: t("error"),
        description: error.message || t("failedToSendReset"),
        variant: "destructive",
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md hover-shadow-lift">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-display font-bold text-2xl">
              T
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-center">{t("welcomeBack")}</CardTitle>
          <CardDescription className="text-center">
            {t("signInToContinue")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={loginMethod} onValueChange={(v) => {
            setLoginMethod(v as "password" | "otp");
            setShowOtpInput(false);
            setOtpCode("");
          }} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="otp">{t("emailCode")}</TabsTrigger>
              <TabsTrigger value="password">{t("password")}</TabsTrigger>
            </TabsList>

            {/* Password Login */}
            <TabsContent value="password" className="space-y-4 mt-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t("email")}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground hover-icon" />
                    <Input
                      id="email"
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">{t("password")}</Label>
                    <button
                      type="button"
                      onClick={() => {
                        if (!email) {
                          toast({
                            title: t("emailRequired"),
                            description: t("enterEmailAddressFirst"),
                            variant: "destructive",
                          });
                          return;
                        }
                        setShowPasswordResetDialog(true);
                      }}
                      className="text-sm text-primary hover:underline"
                    >
                      {t("forgotPassword")}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground hover-icon" />
                    <Input
                      id="password"
                      type="password"
                      placeholder={t("passwordPlaceholder")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("signingIn")}
                    </>
                  ) : (
                    <>
                      {t("signIn")}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            {/* OTP / Magic Link Login (Combined) */}
            <TabsContent value="otp" className="space-y-4 mt-4">
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp-email">{t("email")}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground hover-icon" />
                    <Input
                      id="otp-email"
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      disabled={isLoading || isSendingOtp}
                    />
                  </div>
                </div>
                {!showOtpInput ? (
                  <Button
                    type="button"
                    onClick={() => handleRequestOtp(true)}
                    className="w-full"
                    disabled={isSendingOtp || !email}
                  >
                    {isSendingOtp ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("sendingCode")}
                      </>
                    ) : (
                      <>
                        <KeyRound className="mr-2 h-4 w-4" />
                        {t("sendLoginCode")}
                      </>
                    )}
                  </Button>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="otp-code">{t("enter6DigitCode")}</Label>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground hover-icon" />
                        <Input
                          id="otp-code"
                          type="text"
                          placeholder={t("otpCodePlaceholder")}
                          value={otpCode}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                            setOtpCode(value);
                          }}
                          className="pl-10 text-center text-2xl tracking-widest font-mono"
                          maxLength={6}
                          required
                          disabled={isLoading}
                          autoFocus
                        />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {t("checkEmailForCode")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("orClickMagicLink")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowOtpInput(false);
                          setOtpCode("");
                          handleRequestOtp(true);
                        }}
                        className="flex-1"
                        disabled={isSendingOtp}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {t("resend")}
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1"
                        disabled={isLoading || otpCode.length !== 6}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t("verifying")}
                          </>
                        ) : (
                          <>
                            {t("verifyCode")}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-4 text-muted-foreground">{t("or")}</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full mt-6"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {t("continueWithGoogle")}
            </Button>
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>
              {t("dontHaveAccount")}{" "}
              <button
                type="button"
                onClick={() => setShowSignupDialog(true)}
                className="text-primary hover:underline font-medium hover-color transition-colors duration-200"
              >
                {t("signUp")}
              </button>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Signup Dialog */}
      <ResponsiveDialog
        open={showSignupDialog}
        onOpenChange={setShowSignupDialog}
        title={t("getStarted")}
        description={t("chooseHowToUse")}
        contentClassName="sm:max-w-lg"
      >
        <div className="grid gap-6 py-6 px-2">
            <Button
              variant="outline"
              className="w-full h-auto p-6 sm:p-8 flex flex-col sm:flex-row items-start gap-4 sm:gap-5 hover:bg-blue-50 hover:border-blue-500 transition-all duration-200 hover:shadow-lg group"
              onClick={() => {
                setShowSignupDialog(false);
                // Pass email as query param if available
                const url = email ? `/company-onboarding?email=${encodeURIComponent(email)}` : "/company-onboarding";
                setLocation(url);
              }}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-lg">
                <Building2 className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              </div>
              <div className="flex-1 text-left min-w-0 w-full">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-700 border border-blue-300">
                    For Businesses
                  </span>
                </div>
                <div className="font-bold text-lg sm:text-xl mb-2 text-gray-900">{t("hireWorkers")}</div>
                <div className="text-sm sm:text-base text-muted-foreground leading-relaxed break-words">
                  {t("postJobsFindWorkers")}
                </div>
              </div>
            </Button>
            
            <Button
              variant="outline"
              className="w-full h-auto p-6 sm:p-8 flex flex-col sm:flex-row items-start gap-4 sm:gap-5 hover:bg-green-50 hover:border-green-500 transition-all duration-200 hover:shadow-lg group"
              onClick={() => {
                setShowSignupDialog(false);
                // Pass email as query param if available
                const url = email ? `/worker-onboarding?email=${encodeURIComponent(email)}` : "/worker-onboarding";
                setLocation(url);
              }}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-lg">
                <HardHat className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              </div>
              <div className="flex-1 text-left min-w-0 w-full">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-green-100 text-green-700 border border-green-300">
                    For Service Workers
                  </span>
                </div>
                <div className="font-bold text-lg sm:text-xl mb-2 text-gray-900">{t("findWork")}</div>
                <div className="text-sm sm:text-base text-muted-foreground leading-relaxed break-words">
                  {t("createProfileGetMatched")}
                </div>
              </div>
            </Button>
          </div>
      </ResponsiveDialog>

      {/* Password Reset Dialog */}
      <ResponsiveDialog
        open={showPasswordResetDialog}
        onOpenChange={setShowPasswordResetDialog}
        title={t("resetPassword")}
        description={t("resetPasswordDescription")}
        contentClassName="sm:max-w-md"
      >
        <form onSubmit={handlePasswordReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">{t("email")}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  disabled={isSendingReset}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowPasswordResetDialog(false);
                }}
                className="flex-1"
                disabled={isSendingReset}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSendingReset || !email}
              >
                {isSendingReset ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("sendingCode")}
                  </>
                ) : (
                  <>
                    {t("sendResetLink")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
      </ResponsiveDialog>
    </div>
  );
}
