import { useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { useTranslation } from "react-i18next";

interface NotificationBannerProps {
  profileId: number | undefined;
}

export function NotificationBanner({ profileId }: NotificationBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { t } = useTranslation();
  const { 
    isSupported, 
    isCurrentDeviceRegistered, 
    permissionStatus,
    enableNotifications,
    isEnabling
  } = useNotifications(profileId);

  if (!profileId || dismissed) return null;
  if (!isSupported) return null;
  if (permissionStatus === "denied") return null;
  // Don't show banner if notifications are already enabled for this device
  // This means either the device is registered OR permission is granted (notifications enabled)
  if (permissionStatus === "granted") return null;
  if (isCurrentDeviceRegistered) return null;

  return (
    <div className="bg-primary text-primary-foreground px-3 py-2 flex items-center justify-between gap-2 md:gap-4">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Bell className="w-4 h-4 shrink-0" />
        <span className="text-xs md:text-sm whitespace-nowrap truncate">
          {t("banners.enableNotifications")}
        </span>
      </div>
      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <Button 
          variant="secondary" 
          size="sm" 
          className="h-7 px-2 md:px-3 text-xs md:text-sm whitespace-nowrap"
          onClick={async () => {
            try {
              await enableNotifications();
            } catch (error: any) {
              // Error is already logged in the hook
              // Only show user-facing errors if it's not a connection issue
              if (!error.message?.includes("connect to server")) {
                console.error("Failed to enable notifications:", error);
              }
            }
          }}
          disabled={isEnabling}
          data-testid="button-enable-notifications-banner"
        >
          {isEnabling ? t("banners.enabling") : t("banners.enable")}
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6 md:h-7 md:w-7 text-primary-foreground hover:bg-primary-foreground/20 shrink-0"
          onClick={() => setDismissed(true)}
          data-testid="button-dismiss-notification-banner"
        >
          <X className="w-3 h-3 md:w-4 md:h-4" />
        </Button>
      </div>
    </div>
  );
}
