import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, FileText, Check, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { DigitalSignature } from "@shared/schema";

const BACK_URL = "/dashboard/menu";

/** Embeddable legal documents content for menu right panel or standalone page. */
export function LegalDocumentsContent({ embedded = false }: { embedded?: boolean }) {
  const { user, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const [, setLocation] = useLocation();

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

  const isLoading = authLoading || profileLoading || signaturesLoading;

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

  if (isLoading) {
    return (
      <div className={embedded ? "py-8 flex justify-center" : "min-h-screen flex items-center justify-center"}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 max-w-lg space-y-6"}>
        <div>
          <h2 className="text-xl font-semibold mb-2">Signed Agreements</h2>
          <p className="text-muted-foreground">
            View all legal documents you have signed on the Tolstoy Staffing platform.
          </p>
        </div>

        {allSignatures.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No signed documents yet.</p>
              <p className="text-sm text-muted-foreground mt-2">
                Documents you sign during onboarding will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {allSignatures.map((sig) => (
              <Card key={sig.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
                        <Check className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{getDocumentTitle(sig.documentType)}</CardTitle>
                        <CardDescription>
                          Signed on {sig.signedAt ? format(new Date(sig.signedAt), "MMMM d, yyyy 'at' h:mm a") : "Unknown date"}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-600 border-green-200">
                      Signed
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <div className="space-y-1">
                      <p className="text-muted-foreground">Signed as: <span className="text-foreground">{sig.signedName}</span></p>
                      <p className="text-muted-foreground">Version: <span className="text-foreground">{sig.documentVersion}</span></p>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2">
                      <ExternalLink className="w-4 h-4" /> View
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {profile?.contractSigned && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Independent Contractor Agreement</CardTitle>
                    <CardDescription>
                      {profile.contractSignedAt 
                        ? `Signed on ${format(new Date(profile.contractSignedAt), "MMMM d, yyyy 'at' h:mm a")}`
                        : "Signed during onboarding"}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-green-600 border-green-200">
                  Signed
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm">
                <p className="text-muted-foreground">
                  Signed as: <span className="text-foreground">{profile.firstName} {profile.lastName}</span>
                </p>
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="w-4 h-4" /> View
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );

  if (embedded) return <div className="pt-2 pb-4">{main}</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">Legal Documents</h1>
        </div>
      </header>
      <main>{main}</main>
    </div>
  );
}

export default function LegalDocuments() {
  return <LegalDocumentsContent />;
}
