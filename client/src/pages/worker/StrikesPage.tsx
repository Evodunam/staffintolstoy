import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Shield, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

const BACK_URL = "/dashboard/menu";

interface Strike {
  id: number;
  timesheetId: number;
  reportedBy: number;
  workerId: number;
  explanation: string;
  isStrike: boolean;
  createdAt: string;
  reporter: {
    id: number;
    companyName?: string;
    firstName?: string;
    lastName?: string;
  };
}

interface StrikesResponse {
  strikes: Strike[];
  strikeCount: number;
  isBanned: boolean;
}

export default function StrikesPage() {
  const { t } = useTranslation("strikes");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  
  const { data, isLoading } = useQuery<StrikesResponse>({
    queryKey: ["/api/my-strikes"],
    enabled: !!user,
  });

  const strikeCount = data?.strikeCount || profile?.strikeCount || 0;
  const isBanned = data?.isBanned || strikeCount >= 3;
  const strikes = data?.strikes || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">{t("accountStatus")}</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl space-y-6">
        <Card className={isBanned ? "border-red-500" : strikeCount > 0 ? "border-yellow-500" : "border-green-500"}>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              isBanned 
                ? "bg-red-500/10 text-red-600 dark:text-red-400" 
                : strikeCount > 0 
                  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : "bg-green-500/10 text-green-600 dark:text-green-400"
            }`}>
              {isBanned ? (
                <AlertTriangle className="w-6 h-6" />
              ) : strikeCount > 0 ? (
                <Shield className="w-6 h-6" />
              ) : (
                <CheckCircle className="w-6 h-6" />
              )}
            </div>
            <div className="flex-1">
              <CardTitle className="text-xl">
                {isBanned 
                  ? t("accountSuspended") 
                  : strikeCount > 0 
                    ? t("strikesOnRecord", { count: strikeCount })
                    : t("goodStanding")
                }
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {isBanned 
                  ? t("accountSuspendedDueTo3Strikes")
                  : strikeCount > 0
                    ? t("moreStrikesBeforeSuspension", { count: 3 - strikeCount })
                    : t("noStrikesOnAccount")
                }
              </p>
            </div>
            {strikeCount > 0 && !isBanned && (
              <Badge variant="destructive">
                {strikeCount}/3
              </Badge>
            )}
          </CardHeader>
        </Card>

        <Card className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/10">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800 dark:text-yellow-200">{t("threeStrikePolicy")}</p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  {t("threeStrikePolicyDescription")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="font-semibold text-lg mb-4">{t("strikeHistory")}</h2>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : strikes.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <CheckCircle className="w-10 h-10 mx-auto text-green-500 mb-3" />
                <p className="font-medium">{t("noStrikesOnRecord")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("keepUpGreatWork")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {strikes.map((strike) => (
                <Card key={strike.id} className="border-red-500/30">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="destructive" className="text-xs">
                            {strike.isStrike ? t("strike") : t("warning")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {strike.createdAt ? format(new Date(strike.createdAt), "MMM d, yyyy") : ""}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {t("reportedBy")}: {strike.reporter?.companyName || 
                            `${strike.reporter?.firstName || ''} ${strike.reporter?.lastName || ''}`.trim() || 
                            t("company")}
                        </p>
                        <p className="text-sm">{strike.explanation}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {strikeCount > 0 && !isBanned && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">
                {t("contactSupportIfError")}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
