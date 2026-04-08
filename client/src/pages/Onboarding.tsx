import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProfileSchema, userRoles, trades } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useCreateProfile, useProfile } from "@/hooks/use-profiles";
import { useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

// Extend schema for form validation if needed, e.g. coerce numbers
const formSchema = insertProfileSchema.extend({
  hourlyRate: z.coerce.number().optional(),
  experienceYears: z.coerce.number().optional(),
});

export default function Onboarding() {
  const { t } = useTranslation("onboarding");
  const { user, isLoading: authLoading } = useAuth();
  const { mutate: createProfile, isPending } = useCreateProfile();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const [, setLocation] = useLocation();

  // Redirect if already has profile
  useEffect(() => {
    if (profile) {
      setLocation("/dashboard");
    }
  }, [profile, setLocation]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      userId: user?.id || "",
      role: "worker",
      trades: [],
    },
  });

  // Update userId when auth loads
  useEffect(() => {
    if (user) {
      form.setValue("userId", user.id);
    }
  }, [user, form]);

  const role = form.watch("role");

  function onSubmit(data: z.infer<typeof formSchema>) {
    // Convert rate to cents for storage
    const submissionData = {
      ...data,
      hourlyRate: data.hourlyRate ? data.hourlyRate * 100 : undefined,
    };
    createProfile(submissionData, {
      onSuccess: () => setLocation("/dashboard"),
    });
  }

  if (authLoading || profileLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-card rounded-2xl shadow-lg border border-border p-8 md:p-12">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold mb-2">{t("completeYourProfile")}</h1>
          <p className="text-muted-foreground">{t("tellUsAboutYourself")}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("iAmA")}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-12 text-lg">
                        <SelectValue placeholder={t("selectARole")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="worker">{t("workerLookingForJobs")}</SelectItem>
                      <SelectItem value="company">{t("companyHiringWorkers")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {role === "worker" && (
              <>
                <FormField
                  control={form.control}
                  name="trades"
                  render={() => (
                    <FormItem>
                      <div className="mb-4">
                        <FormLabel className="text-base">{t("selectYourTrades")}</FormLabel>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {trades.map((trade) => (
                          <FormField
                            key={trade}
                            control={form.control}
                            name="trades"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={trade}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(trade)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), trade])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== trade
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer">
                                    {trade}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="hourlyRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("hourlyRate")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} className="input-field" placeholder={t("hourlyRatePlaceholder")} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="experienceYears"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("yearsOfExperience")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} className="input-field" placeholder={t("yearsOfExperiencePlaceholder")} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            {role === "company" && (
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("companyName")}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} className="input-field" placeholder={t("companyNamePlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("location")}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} className="input-field" placeholder={t("locationPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("bioDescription")}</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      value={field.value ?? ""}
                      className="resize-none min-h-[100px] rounded-xl border-input" 
                      placeholder={role === "worker" ? t("bioPlaceholderWorker") : t("bioPlaceholderCompany")} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isPending} className="w-full h-12 text-lg rounded-xl">
              {isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              {t("createProfile")}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
