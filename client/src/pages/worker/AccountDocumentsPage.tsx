import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, useUpdateProfile } from "@/hooks/use-profiles";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, FileText, Shield, Upload, CheckCircle2, AlertCircle,
  Loader2, X, Calendar, Building2, AlertTriangle, CheckCircle, IdCard, ExternalLink
} from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { getUrlForPath } from "@/lib/subdomain-utils";
import { getIdentityVerificationUrl } from "@/lib/identity-verification-urls";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DigitalSignature } from "@shared/schema";
import { CONTRACT_TEXT } from "@/pages/WorkerOnboarding";

const BACK_URL = "/dashboard/menu";

interface Strike {
  id: number;
  timesheetId: number;
  reportedBy: number;
  workerId: number;
  explanation: string;
  isStrike: boolean;
  createdAt: string;
  reporter: { id: number; companyName?: string; firstName?: string; lastName?: string };
}

interface StrikesResponse {
  strikes: Strike[];
  strikeCount: number;
  isBanned: boolean;
}

/** Embeddable account documents content for menu right panel or standalone page. */
export function AccountDocumentsContent({ embedded = false, initialTab }: { embedded?: boolean; initialTab?: string }) {
  const { t } = useTranslation("workerDocuments");
  const { t: tStrikes } = useTranslation("strikes");
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const { mutateAsync: updateProfile } = useUpdateProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(initialTab || "account-status");
  const [isExtractingInsurance, setIsExtractingInsurance] = useState(false);
  const [isUploadingW9, setIsUploadingW9] = useState(false);
  const [agreementPopupSig, setAgreementPopupSig] = useState<DigitalSignature | null>(null);
  const identityReturnPendingSuccess = useRef(false);

  const {
    data: w9Status,
    isLoading: w9StatusLoading,
    isError: w9StatusError,
    refetch: refetchW9Status,
  } = useQuery<{ attached: boolean; recipientId: string | null; recipientInvalid?: boolean }>({
    queryKey: ["/api/worker/w9-status"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/worker/w9-status", { credentials: "include", signal });
      if (!res.ok) return { attached: false, recipientId: null };
      return res.json();
    },
    enabled: !!user && !!profile?.id && profile?.role === "worker" && activeTab === "w9",
    staleTime: 0,
    retry: 1,
    retryDelay: 2500,
  });

  // When W-9 tab shows "W-9 on File", trigger server-side release of pending payouts and refresh banner data
  const w9OnFile = !!(w9Status?.attached || (profile as { w9UploadedAt?: string })?.w9UploadedAt);
  useEffect(() => {
    if (activeTab !== "w9" || !profile?.id || profile?.role !== "worker" || !w9OnFile) return;
    const run = async () => {
      try {
        await queryClient.fetchQuery({
          queryKey: ["/api/worker/pending-w9-payouts"],
          queryFn: async () => {
            const res = await apiRequest("GET", "/api/worker/pending-w9-payouts");
            return res.json();
          },
        });
        // Invalidate again after a short delay so banner sees updated count once release progresses
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/worker/pending-w9-payouts"] }), 3000);
      } catch (_) {
        // ignore
      }
    };
    run();
  }, [activeTab, profile?.id, profile?.role, w9OnFile, queryClient]);

  const showRecipientInvalidToast = useRef(false);
  useEffect(() => {
    if (w9Status?.recipientInvalid && !showRecipientInvalidToast.current) {
      showRecipientInvalidToast.current = true;
      toast({
        title: "Bank connection no longer valid",
        description: "Please reconnect your bank in Payout Settings to receive payments and attach your W-9.",
        variant: "destructive",
      });
    }
    if (!w9Status?.recipientInvalid) showRecipientInvalidToast.current = false;
  }, [w9Status?.recipientInvalid, toast]);

  const { data: strikesData, isLoading: strikesLoading } = useQuery<StrikesResponse>({
    queryKey: ["/api/my-strikes"],
    enabled: !!user,
  });

  const { data: signatures = [], isLoading: signaturesLoading } = useQuery<DigitalSignature[]>({
    queryKey: ["/api/signatures", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const res = await fetch(`/api/signatures/${profile.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!profile?.id,
  });

  const strikeCount = strikesData?.strikeCount || profile?.strikeCount || 0;
  const isBanned = strikesData?.isBanned || strikeCount >= 3;
  const strikes = strikesData?.strikes || [];

  // Check if profile has contractSignedAt but no digital signature record
  const hasContractSignedAt = profile?.contractSignedAt && profile.role === "worker";
  const hasDigitalSignature = signatures.some(sig => sig.documentType === "contractor_agreement");
  
  // Show implicit contract signature if profile has contractSignedAt but no digital signature record
  const implicitContractSignature = hasContractSignedAt && !hasDigitalSignature ? {
    id: -1,
    profileId: profile.id,
    documentType: "contractor_agreement",
    documentVersion: "1.0",
    signedName: `${profile.firstName} ${profile.lastName}`,
    signedAt: profile.contractSignedAt,
    ipAddress: "",
    userAgent: "",
    createdAt: profile.contractSignedAt,
  } : null;
  
  const allSignatures = implicitContractSignature 
    ? [...signatures, implicitContractSignature as DigitalSignature]
    : signatures;

  const getDocumentTitle = (type: string) => {
    switch (type) {
      case "contractor_agreement":
        return "Independent Contractor Agreement";
      case "nda":
        return "Non-Disclosure Agreement";
      case "w9":
        return "W-9 Tax Form";
      default:
        return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };

  const handleIdVerification = () => {
    const url = getIdentityVerificationUrl("settings");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // When returning from Stripe Identity (e.g. ?identity=return), refetch profile and show success if verified
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("identity") === "return") {
      identityReturnPendingSuccess.current = true;
      queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      const clean = new URLSearchParams(window.location.search);
      clean.delete("identity");
      const newSearch = clean.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    }
  }, [user?.id, queryClient]);

  useEffect(() => {
    if (identityReturnPendingSuccess.current && profile?.identityVerified) {
      identityReturnPendingSuccess.current = false;
      toast({
        title: "Identity verified",
        description: "Your ID has been verified successfully.",
      });
    }
  }, [profile?.identityVerified, toast]);

  if (profileLoading) {
    return (
      <div className={embedded ? "py-8 flex justify-center" : "min-h-screen flex items-center justify-center"}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 space-y-6 max-w-4xl"}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="account-status">Account</TabsTrigger>
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
          <TabsTrigger value="w9">W-9</TabsTrigger>
          <TabsTrigger value="id-verification">ID</TabsTrigger>
        </TabsList>

        <TabsContent value="agreements" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Signed Agreements</CardTitle>
              <CardDescription>Legal documents you&apos;ve signed on Tolstoy Staffing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-4">
                <h4 className="font-medium text-stone-900 mb-1">Worker Agreement</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Independent Contractor Agreement — view or sign from onboarding.
                </p>
                <Button variant="outline" size="sm" onClick={() => setLocation("/worker-onboarding?step=6")}>
                  <FileText className="w-4 h-4 mr-2" />
                  View / Sign worker agreement
                </Button>
              </div>
              {signaturesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : allSignatures.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No signed documents yet.</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Documents you sign during onboarding will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {allSignatures.map((sig) => (
                    <button
                      key={sig.id}
                      type="button"
                      onClick={() => sig.documentType === "contractor_agreement" && setAgreementPopupSig(sig)}
                      className="w-full text-left border rounded-lg p-4 hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center flex-shrink-0">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <h4 className="font-medium">{getDocumentTitle(sig.documentType)}</h4>
                            <p className="text-sm text-muted-foreground">
                              Signed on {sig.signedAt ? format(new Date(sig.signedAt), "MMMM d, yyyy 'at' h:mm a") : "Unknown date"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              Signed as: <span className="font-medium text-foreground">{sig.signedName}</span>
                            </p>
                            {(sig as { signatureData?: string }).signatureData?.startsWith("data:") && (
                              <img src={(sig as { signatureData: string }).signatureData} alt="Signature" className="mt-2 max-h-14 w-auto object-contain" />
                            )}
                            <p className="text-xs text-muted-foreground">Version: {sig.documentVersion}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-green-600 border-green-200 flex-shrink-0">
                          Signed
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}

        {/* Signed agreement popup: full contract text + signature details */}
        <Dialog open={!!agreementPopupSig} onOpenChange={(open) => !open && setAgreementPopupSig(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
            <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-2 border-b">
              <DialogTitle className="text-lg">
                {agreementPopupSig ? getDocumentTitle(agreementPopupSig.documentType) : ""}
              </DialogTitle>
            </DialogHeader>
            {agreementPopupSig && (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-6 pb-6">
                <div className="flex-shrink-0 py-3 text-sm text-muted-foreground space-y-1">
                  <p>Signed on {agreementPopupSig.signedAt ? format(new Date(agreementPopupSig.signedAt), "MMMM d, yyyy 'at' h:mm a") : "Unknown date"}</p>
                  <p>Signed as: <span className="font-medium text-foreground">{agreementPopupSig.signedName}</span></p>
                  <p>Version: {agreementPopupSig.documentVersion}</p>
                  {(agreementPopupSig as { signatureData?: string }).signatureData?.startsWith("data:") && (
                    <img src={(agreementPopupSig as { signatureData: string }).signatureData} alt="Signature" className="mt-2 max-h-16 w-auto object-contain" />
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                  {agreementPopupSig.documentType === "contractor_agreement" ? CONTRACT_TEXT : "Document content not available."}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account-status" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {strikeCount === 0 ? (
                  <><CheckCircle className="w-5 h-5 text-green-600" />Good Standing</>
                ) : isBanned ? (
                  <><AlertCircle className="w-5 h-5 text-red-600" />Account Suspended</>
                ) : (
                  <><AlertTriangle className="w-5 h-5 text-amber-600" />Warning</>
                )}
              </CardTitle>
              <CardDescription>
                {strikeCount === 0 ? "Your account is in good standing" : `You have ${strikeCount}/3 strikes`}
              </CardDescription>
            </CardHeader>
            {strikeCount > 0 && (
              <CardContent>
                <div className="space-y-3">
                  {strikes.map((strike) => (
                    <Card key={strike.id} className="border-red-500/30">
                      <CardContent className="py-4">
                        <div className="flex items-start gap-4">
                          <Badge variant="destructive" className="text-xs">{strike.isStrike ? "Strike" : "Warning"}</Badge>
                          <div className="flex-1">
                            <p className="text-sm text-muted-foreground mb-1">
                              Reported by: {strike.reporter?.companyName || `${strike.reporter?.firstName || ''} ${strike.reporter?.lastName || ''}`.trim() || "Company"}
                            </p>
                            <p className="text-sm">{strike.explanation}</p>
                            <p className="text-xs text-muted-foreground mt-2">{strike.createdAt ? format(new Date(strike.createdAt), "MMM d, yyyy") : ""}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="insurance" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Insurance Certificate
              </CardTitle>
              <CardDescription>Upload your liability insurance certificate</CardDescription>
            </CardHeader>
            <CardContent>
              {profile?.insuranceDocumentUrl ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="font-medium text-green-900 dark:text-green-100">Insurance Verified</p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Valid until {profile?.insuranceEndDate ? format(new Date(profile.insuranceEndDate), "MMM d, yyyy") : "N/A"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">No Insurance on File</h3>
                  <p className="text-sm text-muted-foreground mb-4">Upload your liability insurance to improve your application chances</p>
                  <Button variant="outline" onClick={() => toast({ title: "Feature coming soon", description: "Insurance upload will be available shortly" })}>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Insurance
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="w9" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                W-9 Tax Form
              </CardTitle>
              <CardDescription>Upload your W-9 for tax purposes. It is attached to your Mercury account for payouts.</CardDescription>
            </CardHeader>
            <CardContent>
              {w9StatusLoading ? (
                <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Checking W-9 status with Mercury…</p>
                </div>
              ) : w9StatusError ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Couldn’t verify W-9 with Mercury</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The check timed out or the network failed. You can still upload your W-9 below; try again to refresh status.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => refetchW9Status()}>
                    Retry
                  </Button>
                </div>
              ) : w9Status?.recipientInvalid ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-destructive">Bank connection no longer valid</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Your bank connection could not be verified. Reconnect your bank in Payout Settings to receive payments and attach your W-9.
                      </p>
                    </div>
                  </div>
                  <Button variant="default" className="w-full" onClick={() => setLocation(isMobile ? "/dashboard/settings/payouts?openBank=1" : "/dashboard/menu/bank?openBank=1")}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Payout Settings
                  </Button>
                </div>
              ) : (w9Status?.attached || (profile as { w9UploadedAt?: string })?.w9UploadedAt) ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="font-medium text-green-900 dark:text-green-100">W-9 on File</p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      {w9Status?.attached ? "Your W-9 is verified with your Mercury account and will be used for tax reporting and payouts." : "Your tax form is on file."}
                    </p>
                  </div>
                </div>
              ) : !w9Status?.recipientId ? (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <h3 className="font-semibold mb-2">Upload W-9 for payouts</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload your W-9 now. Once you connect your bank in Payout Settings, we’ll attach it to your Mercury account and any withheld payments will be released.
                    </p>
                    <input
                      id="w9-upload-no-recipient"
                      type="file"
                      accept=".pdf,image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !profile?.id) return;
                        setIsUploadingW9(true);
                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                          const base64Data = ev.target?.result as string;
                          try {
                            await updateProfile({
                              id: profile.id,
                              data: { w9DocumentUrl: base64Data },
                              skipToast: true,
                            });
                            await queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
                            await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
                            await queryClient.invalidateQueries({ queryKey: ["/api/worker/w9-status"] });
                            toast({
                              title: "W-9 saved",
                              description: "We’ll attach it to your Mercury account when you connect your bank in Payout Settings.",
                            });
                          } catch (err: unknown) {
                            toast({
                              title: "Upload failed",
                              description: err instanceof Error ? err.message : "Failed to save W-9. Please try again.",
                              variant: "destructive",
                            });
                          } finally {
                            setIsUploadingW9(false);
                            e.target.value = "";
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    <Button
                      variant="default"
                      disabled={isUploadingW9}
                      onClick={() => document.getElementById("w9-upload-no-recipient")?.click()}
                    >
                      {isUploadingW9 ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4 mr-2" />
                      )}
                      {isUploadingW9 ? "Uploading…" : "Upload W-9"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Then connect your bank to receive payments.
                  </p>
                  <Button variant="outline" className="w-full" onClick={() => setLocation(isMobile ? "/dashboard/settings/payouts?openBank=1" : "/dashboard/menu/bank?openBank=1")}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Payout Settings
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {profile?.w9UploadedAt && !w9Status?.attached && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                      Your W-9 is not yet attached to your Mercury account. Upload again to attach it for tax reporting and payouts.
                    </div>
                  )}
                  <div className="text-center py-4">
                    <h3 className="font-semibold mb-2">No W-9 on File</h3>
                    <p className="text-sm text-muted-foreground mb-4">Upload your W-9 to receive tax documentation and enable payouts</p>
                    <input
                      id="w9-upload-account-docs"
                      type="file"
                      accept=".pdf,image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !profile?.id) return;
                        setIsUploadingW9(true);
                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                          const base64Data = ev.target?.result as string;
                          try {
                            await updateProfile({
                              id: profile.id,
                              data: { w9DocumentUrl: base64Data },
                              skipToast: true,
                            });
                            await queryClient.invalidateQueries({ queryKey: ["/api/profiles", user?.id] });
                            await queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
                            await queryClient.invalidateQueries({ queryKey: ["/api/worker/w9-status"] });
                            await queryClient.invalidateQueries({ queryKey: ["/api/worker/pending-w9-payouts"] });
                            toast({
                              title: "W-9 uploaded",
                              description: "Your W-9 was attached to Mercury successfully. Pending payments are being released.",
                            });
                          } catch (err: unknown) {
                            const message = err instanceof Error ? err.message : "";
                            console.error("[AccountDocuments] W-9 upload failed:", message, err);
                            const isReconnectBankError = /Payout Settings|reconnect|connect your bank/i.test(message);
                            toast({
                              title: "Upload failed",
                              description: message || "Failed to attach W-9 to Mercury. Please try again.",
                              variant: "destructive",
                            });
                            if (isReconnectBankError) {
                              if (isMobile) {
                                setLocation("/dashboard/settings/payouts?openBank=1");
                              } else {
                                setLocation("/dashboard/menu/bank?openBank=1");
                              }
                            }
                          } finally {
                            setIsUploadingW9(false);
                            e.target.value = "";
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    <Button
                      variant="outline"
                      disabled={isUploadingW9}
                      onClick={() => document.getElementById("w9-upload-account-docs")?.click()}
                    >
                      {isUploadingW9 ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4 mr-2" />
                      )}
                      {isUploadingW9 ? "Uploading…" : "Upload W-9"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="id-verification" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IdCard className="w-5 h-5" />
                Identity Verification
              </CardTitle>
              <CardDescription>Verify your identity with Stripe</CardDescription>
            </CardHeader>
            <CardContent>
              {profile?.identityVerified ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="font-medium text-green-900 dark:text-green-100">Identity Verified</p>
                    <p className="text-sm text-green-700 dark:text-green-300">Your identity has been confirmed</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <IdCard className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">Verify Your Identity</h3>
                  <p className="text-sm text-muted-foreground mb-4">Complete identity verification to unlock all features</p>
                  <Button onClick={handleIdVerification}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Start Identity Verification
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );

  if (embedded) return <div className="pt-2 pb-4">{main}</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Account & Documents</h1>
            <p className="text-xs text-muted-foreground">Manage your account status and documents</p>
          </div>
        </div>
      </header>
      <main>{main}</main>
    </div>
  );
}

export default function AccountDocumentsPage() {
  const tabFromUrl = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("tab")
    : null;
  const initialTab = tabFromUrl && ["account-status", "agreements", "insurance", "w9", "id-verification"].includes(tabFromUrl)
    ? tabFromUrl
    : undefined;
  return <AccountDocumentsContent initialTab={initialTab} />;
}
