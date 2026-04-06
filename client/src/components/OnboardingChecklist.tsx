import { CheckCircle, Circle, ChevronRight, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkerOnboardingProgress, type ProfileLike } from "@/lib/worker-onboarding";
import { useTranslation } from "react-i18next";

interface OnboardingChecklistProps {
  profile: ProfileLike;
  className?: string;
}

export function OnboardingChecklist({ profile, className }: OnboardingChecklistProps) {
  const { t } = useTranslation();
  const { items, progressPercent, completedCount, totalCount } = getWorkerOnboardingProgress(profile);

  if (items.length === 0) return null; // Already complete

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <CardTitle className="text-lg">
              {t("workerDashboard.completeProfileToGetPaid", "Complete profile to get paid")}
            </CardTitle>
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            {completedCount}/{totalCount}
          </div>
        </div>
        <CardDescription>
          {t("workerDashboard.completeProfileDescription", "Finish these steps to start receiving payments")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t("workerDashboard.progress", "Progress")}
            </span>
            <span className="font-medium">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              to={item.url}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors group"
            >
              <div className="flex items-center gap-3 flex-1">
                {item.completed ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                )}
                <span className={item.completed ? "text-muted-foreground line-through" : "font-medium"}>
                  {item.label}
                </span>
                {!item.required && (
                  <span className="text-xs text-muted-foreground">
                    ({t("workerDashboard.optional", "optional")})
                  </span>
                )}
              </div>
              {!item.completed && (
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              )}
            </Link>
          ))}
        </div>

        <Button asChild className="w-full" variant="default">
          <Link to="/worker-onboarding">
            {t("workerDashboard.completeOnboarding", "Complete onboarding")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
