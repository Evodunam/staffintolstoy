import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

interface W9RequirementBannerProps {
  profileId: number;
  onDismiss?: () => void;
}

export function W9RequirementBanner({ profileId, onDismiss }: W9RequirementBannerProps) {
  const { t } = useTranslation("workerDashboard");
  const [, setLocation] = useLocation();

  const { data: pendingPayouts, isLoading } = useQuery({
    queryKey: ["/api/worker/pending-w9-payouts"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/worker/pending-w9-payouts");
      return response.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Don't show banner if no pending payouts
  if (isLoading || !pendingPayouts || pendingPayouts.count === 0) {
    return null;
  }

  const handleUploadW9 = () => {
    setLocation("/dashboard/menu?tab=profile&section=business");
  };

  return (
    <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20 mb-4 mx-4 mt-2">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="font-semibold text-amber-800 dark:text-amber-400">
                  {t("w9RequiredTitle", "W-9 Form Required")}
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {t("w9RequiredMessage", "You have {{count}} payment{{plural}} totaling {{amount}} held pending W-9 upload. Upload your W-9 form in Business Information to receive your payments.", {
                    count: pendingPayouts.count,
                    plural: pendingPayouts.count > 1 ? "s" : "",
                    amount: pendingPayouts.totalAmountFormatted,
                  })}
                </p>
              </div>
              {onDismiss && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                  onClick={onDismiss}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button
                onClick={handleUploadW9}
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                <FileText className="w-4 h-4 mr-2" />
                {t("uploadW9", "Upload W-9 Now")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
