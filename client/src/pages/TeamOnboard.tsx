import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";

const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof formSchema>;

interface TeamData {
  id: number;
  name: string;
  owner: {
    firstName: string;
    lastName: string;
  } | null;
}

export default function TeamOnboard() {
  const { t } = useTranslation("joinWorkerTeam");
  const { t: tCommon } = useTranslation("common");
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [addressData, setAddressData] = useState<{
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  }>({});

  const { data: teamData, isLoading, error } = useQuery<TeamData>({
    queryKey: ["/api/team", id],
    queryFn: async () => {
      const res = await fetch(`/api/team/${id}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Team not found");
      }
      return res.json();
    },
    enabled: !!id,
    retry: false,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onboardMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", `/api/team/${id}/onboard`, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone || null,
        address: addressData.address || data.address || null,
        city: addressData.city || data.city || null,
        state: addressData.state || data.state || null,
        zipCode: addressData.zipCode || data.zipCode || null,
        password: data.password,
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

  const onSubmit = (data: FormData) => {
    onboardMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="loading-team-onboard">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" data-testid="card-team-error">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>{t("invalidInvitation")}</CardTitle>
            <CardDescription>
              {(error as Error).message || "Team not found"}
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
              onClick={() => setLocation("/")}
              data-testid="button-sign-in"
            >
              {t("nav.signIn")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ownerName = teamData?.owner 
    ? `${teamData.owner.firstName} ${teamData.owner.lastName}` 
    : t("businessOperator");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md" data-testid="card-team-onboard">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t("joinOwnersTeam", { ownerName })}</CardTitle>
          <CardDescription>
            {t("invitedToJoinAsTeamMember")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("yourName")}</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} data-testid="input-first-name" />
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
                      <FormLabel className="opacity-0">{t("yourName")}</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} data-testid="input-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("email")}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("phone")} ({tCommon("optional")})</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="(555) 123-4567" {...field} data-testid="input-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>{tCommon("address")} ({tCommon("optional")})</FormLabel>
                <GooglePlacesAutocomplete
                  value={form.getValues("address") || ""}
                  onChange={(address, components) => {
                    setAddressData({ 
                      address: address, 
                      city: components.city || "", 
                      state: components.state || "", 
                      zipCode: components.zipCode || "" 
                    });
                    form.setValue("address", address);
                    if (components.city) form.setValue("city", components.city);
                    if (components.state) form.setValue("state", components.state);
                    if (components.zipCode) form.setValue("zipCode", components.zipCode);
                  }}
                />
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
                disabled={onboardMutation.isPending}
                data-testid="button-create-account"
              >
                {onboardMutation.isPending ? (
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
