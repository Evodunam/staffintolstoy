import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, ArrowRight, CheckCircle2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

export default function ResetPassword() {
  const { t } = useTranslation("resetPassword");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Get token from URL
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      toast({
        title: t("invalidLink"),
        description: t("linkInvalidOrExpired"),
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [token, toast, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: t("passwordsDontMatch"),
        description: t("pleaseMakeSurePasswordsMatch"),
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: t("passwordTooShort"),
        description: t("passwordMustBeAtLeast8Characters"),
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/password-reset/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await response.json();
      if (data.success) {
        setIsSuccess(true);
        toast({
          title: t("passwordResetSuccessful"),
          description: t("passwordUpdatedCanSignIn"),
        });
        setTimeout(() => {
          setLocation("/login");
        }, 2000);
      } else {
        throw new Error(data.message || "Failed to reset password");
      }
    } catch (error: any) {
      toast({
        title: t("resetFailed"),
        description: error.message || t("invalidOrExpiredToken"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return null;
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">{t("passwordResetSuccessful")}</h2>
                <p className="text-muted-foreground mt-2">
                  {t("passwordUpdatedRedirecting")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-display font-bold text-2xl">
              T
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-center">{t("resetPassword")}</CardTitle>
          <CardDescription className="text-center">
            {t("enterNewPasswordBelow")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("newPassword")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder={t("enterNewPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  disabled={isLoading}
                  minLength={8}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("passwordRequirements")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t("confirmNewPassword")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                  disabled={isLoading}
                  minLength={8}
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !password || !confirmPassword}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("resettingPassword")}
                </>
              ) : (
                <>
                  {t("resetPassword")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
