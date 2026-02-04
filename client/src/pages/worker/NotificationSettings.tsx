import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Mail, MessageSquare, Bell, Loader2, Monitor, Smartphone, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";

const BACK_URL = "/dashboard/menu";

/** Embeddable form content for notifications. Use in menu right panel (embedded) or standalone page. */
export function NotificationSettingsContent({ embedded = false }: { embedded?: boolean }) {
  const { user, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation("notificationSettings");
  const { t: tCommon } = useTranslation("common");

  const [settings, setSettings] = useState({
    emailNotifications: true,
    smsNotifications: true,
    pushNotifications: true,
    notifyNewJobs: true,
    notifyJobUpdates: true,
    notifyPayments: true,
    notifyMessages: true,
  });

  useEffect(() => {
    if (profile) {
      setSettings({
        emailNotifications: profile.emailNotifications ?? true,
        smsNotifications: profile.smsNotifications ?? true,
        pushNotifications: profile.pushNotifications ?? true,
        notifyNewJobs: profile.notifyNewJobs ?? true,
        notifyJobUpdates: profile.notifyJobUpdates ?? true,
        notifyPayments: profile.notifyPayments ?? true,
        notifyMessages: profile.notifyMessages ?? true,
      });
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof settings) => {
      if (!profile?.id) throw new Error("No profile found");
      return apiRequest("PUT", `/api/profiles/${profile.id}`, data);
    },
    onSuccess: () => {
      toast({ title: t("settingsSaved"), description: t("preferencesUpdated") });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
    },
    onError: () => {
      toast({ title: tCommon("error"), description: t("couldNotSaveSettings"), variant: "destructive" });
    },
  });

  const handleSave = () => saveMutation.mutate(settings);

  if (authLoading || profileLoading) {
    return (
      <div className={embedded ? "py-8 flex justify-center" : "min-h-screen flex items-center justify-center"}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={embedded ? "space-y-4 py-4" : "min-h-screen bg-background"}>
        {!embedded && (
          <header className="sticky top-0 z-50 bg-background border-b border-border">
            <div className="container mx-auto px-4 py-3 flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-lg font-semibold">{t("title")}</h1>
            </div>
          </header>
        )}
        <div className={embedded ? "" : "container mx-auto px-4 py-6 max-w-lg"}>
          <p className="text-muted-foreground">{t("completeProfileFirst")}</p>
          <Button onClick={() => setLocation("/dashboard/settings/profile")} className="mt-4">
            {t("completeProfile")}
          </Button>
        </div>
      </div>
    );
  }

  const form = (
    <div className={embedded ? "space-y-8" : "container mx-auto px-4 py-6 max-w-lg space-y-8"}>
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t("emailNotifications")}</h2>
            <p className="text-sm text-muted-foreground">{t("chooseHow")}</p>
          </div>
          <Switch
            className="ml-auto"
            checked={settings.emailNotifications}
            onCheckedChange={(checked) => setSettings({ ...settings, emailNotifications: checked })}
            data-testid="switch-email"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t("smsNotifications")}</h2>
            <p className="text-sm text-muted-foreground">{t("chooseHow")}</p>
          </div>
          <Switch
            className="ml-auto"
            checked={settings.smsNotifications}
            onCheckedChange={(checked) => setSettings({ ...settings, smsNotifications: checked })}
            data-testid="switch-sms"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t("pushNotifications")}</h2>
            <p className="text-sm text-muted-foreground">{t("chooseHow")}</p>
          </div>
          <Switch
            className="ml-auto"
            checked={settings.pushNotifications}
            onCheckedChange={(checked) => setSettings({ ...settings, pushNotifications: checked })}
            data-testid="switch-push"
          />
        </div>
      </section>

      <Separator />

      <div>
        <h3 className="font-semibold mb-4">{t("newJobs")}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-jobs" className="font-medium">{t("newJobs")}</Label>
            <Switch id="notify-jobs" checked={settings.notifyNewJobs} onCheckedChange={(checked) => setSettings({ ...settings, notifyNewJobs: checked })} data-testid="switch-new-jobs" />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-updates" className="font-medium">{t("jobUpdates")}</Label>
            <Switch id="notify-updates" checked={settings.notifyJobUpdates} onCheckedChange={(checked) => setSettings({ ...settings, notifyJobUpdates: checked })} data-testid="switch-job-updates" />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-payments" className="font-medium">{t("paymentConfirmations")}</Label>
            <Switch id="notify-payments" checked={settings.notifyPayments} onCheckedChange={(checked) => setSettings({ ...settings, notifyPayments: checked })} data-testid="switch-payments" />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-messages" className="font-medium">{t("directMessages")}</Label>
            <Switch id="notify-messages" checked={settings.notifyMessages} onCheckedChange={(checked) => setSettings({ ...settings, notifyMessages: checked })} data-testid="switch-messages" />
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-2">{t("connectedDevices")}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t("connectedDevicesDesc")}</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">{t("iphone14Pro")}</p>
                <p className="text-xs text-muted-foreground">{t("thisDevice")} • {t("lastActive")}: {format(new Date(), "MMM d, h:mm a")}</p>
              </div>
            </div>
            <Badge variant="secondary" className="text-xs">{t("active")}</Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <Monitor className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">{t("chromeMacbook")}</p>
                <p className="text-xs text-muted-foreground">{t("lastActive")}: Jan 14, 9:15 AM</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" data-testid="button-remove-device-1">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} className="w-full" disabled={saveMutation.isPending} data-testid="button-save-notifications">
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-2" /> {t("saveChanges")}</>}
      </Button>
    </div>
  );

  if (embedded) return form;
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
      <main>{form}</main>
    </div>
  );
}

export default function NotificationSettings() {
  return <NotificationSettingsContent />;
}
