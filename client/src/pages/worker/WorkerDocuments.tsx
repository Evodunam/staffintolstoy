import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, useUpdateProfile } from "@/hooks/use-profiles";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, FileText, Shield, Upload, CheckCircle2, AlertCircle, 
  Loader2, X, Calendar, Building2
} from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

export default function WorkerDocuments() {
  const { t } = useTranslation("workerDocuments");
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const { mutate: updateProfile } = useUpdateProfile();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isExtractingInsurance, setIsExtractingInsurance] = useState(false);
  const [isUploadingW9, setIsUploadingW9] = useState(false);
  const insuranceInputRef = useRef<HTMLInputElement>(null);
  const w9InputRef = useRef<HTMLInputElement>(null);
  
  const [insuranceData, setInsuranceData] = useState<{
    documentUrl: string | null;
    policyNumber: string;
    issuer: string;
    startDate: string;
    endDate: string;
    coverageType: string;
    coverageAmount: number;
  }>({
    documentUrl: null,
    policyNumber: "",
    issuer: "",
    startDate: "",
    endDate: "",
    coverageType: "",
    coverageAmount: 0,
  });

  useEffect(() => {
    if (profile) {
      setInsuranceData({
        documentUrl: profile.insuranceDocumentUrl || null,
        policyNumber: profile.insurancePolicyNumber || "",
        issuer: profile.insuranceIssuer || "",
        startDate: profile.insuranceStartDate ? format(new Date(profile.insuranceStartDate), "MM/dd/yyyy") : "",
        endDate: profile.insuranceEndDate ? format(new Date(profile.insuranceEndDate), "MM/dd/yyyy") : "",
        coverageType: profile.insuranceCoverageType || "",
        coverageAmount: profile.insuranceCoverageAmount || 0,
      });
    }
  }, [profile]);

  const handleInsuranceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsExtractingInsurance(true);
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64Data = ev.target?.result as string;
      setInsuranceData(prev => ({ ...prev, documentUrl: base64Data }));
      
      try {
        const response = await apiRequest("POST", "/api/ai/extract-insurance", {
          document: base64Data,
        });
        const result = await response.json();
        
        if (result.success && result.data) {
          const newData = {
            documentUrl: base64Data,
            policyNumber: result.data.policyNumber || "",
            issuer: result.data.issuer || "",
            startDate: result.data.startDate || "",
            endDate: result.data.endDate || "",
            coverageType: result.data.coverageType || "",
            coverageAmount: result.data.coverageAmount || 0,
          };
          setInsuranceData(newData);
          
          if (profile) {
            updateProfile({
              id: profile.id,
              insuranceDocumentUrl: base64Data,
              insurancePolicyNumber: result.data.policyNumber,
              insuranceIssuer: result.data.issuer,
              insuranceStartDate: result.data.startDate ? new Date(result.data.startDate) : null,
              insuranceEndDate: result.data.endDate ? new Date(result.data.endDate) : null,
              insuranceCoverageType: result.data.coverageType || null,
              insuranceCoverageAmount: result.data.coverageAmount || null,
              insuranceVerified: isInsuranceValid(result.data.startDate, result.data.endDate),
            });
          }
          
          toast({
            title: t("insuranceVerified"),
            description: t("policyInformationExtracted"),
          });
        } else {
          toast({
            title: t("extractionIncomplete"),
            description: t("someFieldsCouldNotBeExtracted"),
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Insurance extraction error:", error);
        toast({
          title: t("processingError"),
          description: t("unableToProcessInsurance"),
          variant: "destructive",
        });
      } finally {
        setIsExtractingInsurance(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleW9Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    const validTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      toast({
        title: t("uploadError") || "Invalid File Type",
        description: "Please upload a PDF or image file (PNG, JPG)",
        variant: "destructive",
      });
      return;
    }
    
    setIsUploadingW9(true);
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64Data = ev.target?.result as string;
      
      try {
        // First, validate the W-9 document
        const validationResponse = await fetch("/api/worker/validate-w9", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileData: base64Data,
            mimeType: file.type,
          }),
        });
        
        const validationResult = await validationResponse.json();
        
        if (!validationResult.isValid) {
          toast({
            title: "W-9 Validation Failed",
            description: validationResult.message || validationResult.errors?.join(", ") || "The document does not appear to be a valid W-9 form",
            variant: "destructive",
          });
          setIsUploadingW9(false);
          return;
        }
        
        // If validation passed (or has warnings but is acceptable), save the document
        if (profile) {
          updateProfile({
            id: profile.id,
            w9DocumentUrl: base64Data,
            w9UploadedAt: new Date(),
          });
        }
        
        toast({
          title: t("w9Uploaded") || "W-9 Uploaded",
          description: validationResult.confidence >= 0.7 
            ? `W-9 validated and saved successfully (${(validationResult.confidence * 100).toFixed(0)}% confidence)`
            : `W-9 saved. ${validationResult.errors?.length > 0 ? "Some fields could not be verified - manual review may be required." : ""}`,
        });
      } catch (error: any) {
        console.error("W-9 upload error:", error);
        toast({
          title: t("uploadError") || "Upload Error",
          description: error.message || t("unableToSaveW9") || "Unable to save W-9 form",
          variant: "destructive",
        });
      } finally {
        setIsUploadingW9(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const isInsuranceValid = (startDate: string, endDate: string): boolean => {
    if (!startDate || !endDate) return false;
    const today = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);
    return today >= start && today <= end;
  };

  const insuranceStatus = profile?.insuranceVerified 
    ? "verified" 
    : profile?.insuranceDocumentUrl 
      ? "expired" 
      : "missing";

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard/menu")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{t("w9AndInsurance")}</h1>
            <p className="text-xs text-muted-foreground">{t("manageYourDocuments")}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{t("insuranceCertificate")}</CardTitle>
                  <CardDescription>{t("generalLiabilityInsurance")}</CardDescription>
                </div>
              </div>
              {insuranceStatus === "verified" && (
                <Badge className="bg-green-100 text-green-700 border-green-200" data-testid="badge-verified-insured">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {t("verifiedInsured")}
                </Badge>
              )}
              {insuranceStatus === "expired" && (
                <Badge variant="destructive" data-testid="badge-insurance-expired">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {t("expired")}
                </Badge>
              )}
              {insuranceStatus === "missing" && (
                <Badge variant="secondary" className="text-amber-600 bg-amber-50 border-amber-200" data-testid="badge-insurance-not-validated">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {t("insuranceNotValidated")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={insuranceInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={handleInsuranceUpload}
              data-testid="input-insurance-upload"
            />
            
            {!insuranceData.documentUrl && !profile?.insuranceDocumentUrl ? (
              <div 
                onClick={() => insuranceInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                data-testid="dropzone-insurance-upload"
              >
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">{t("uploadInsuranceCertificate")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("pdfJpgPngAccepted")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border border-border rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{t("insuranceDocumentUploaded")}</p>
                      <p className="text-xs text-muted-foreground">
                        {insuranceData.issuer || profile?.insuranceIssuer || t("processing")}
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => insuranceInputRef.current?.click()}
                      data-testid="button-reupload-insurance"
                    >
                      {t("replace")}
                    </Button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("policyNumber")}</Label>
                    <Input 
                      value={insuranceData.policyNumber || profile?.insurancePolicyNumber || ""}
                      disabled
                      className="mt-1 bg-muted"
                      placeholder={isExtractingInsurance ? t("extracting") : t("notDetected")}
                      data-testid="input-policy-number"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("insuranceCompany")}</Label>
                    <Input 
                      value={insuranceData.issuer || profile?.insuranceIssuer || ""}
                      disabled
                      className="mt-1 bg-muted"
                      placeholder={isExtractingInsurance ? t("extracting") : t("notDetected")}
                      data-testid="input-issuer"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("startDate")}</Label>
                    <Input 
                      value={insuranceData.startDate || (profile?.insuranceStartDate ? format(new Date(profile.insuranceStartDate), "MM/dd/yyyy") : "")}
                      disabled
                      className="mt-1 bg-muted"
                      placeholder={isExtractingInsurance ? t("extracting") : t("notDetected")}
                      data-testid="input-start-date"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("endDate")}</Label>
                    <Input 
                      value={insuranceData.endDate || (profile?.insuranceEndDate ? format(new Date(profile.insuranceEndDate), "MM/dd/yyyy") : "")}
                      disabled
                      className="mt-1 bg-muted"
                      placeholder={isExtractingInsurance ? t("extracting") : t("notDetected")}
                      data-testid="input-end-date"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("coverageType")}</Label>
                    <Input 
                      value={insuranceData.coverageType || profile?.insuranceCoverageType || ""}
                      disabled
                      className="mt-1 bg-muted"
                      placeholder={isExtractingInsurance ? t("extracting") : t("notDetected")}
                      data-testid="input-coverage-type"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("coverageAmount")}</Label>
                    <Input 
                      value={(insuranceData.coverageAmount || profile?.insuranceCoverageAmount) 
                        ? `$${((insuranceData.coverageAmount || profile?.insuranceCoverageAmount || 0) / 100).toLocaleString()}`
                        : ""}
                      disabled
                      className="mt-1 bg-muted"
                      placeholder={isExtractingInsurance ? t("extracting") : t("notDetected")}
                      data-testid="input-coverage-amount"
                    />
                  </div>
                </div>
              </div>
            )}
            
            {isExtractingInsurance && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("analyzingDocumentWithAI")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-lg">{t("w9Form")}</CardTitle>
                <CardDescription>{t("requestForTaxpayerID")}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <input
              ref={w9InputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleW9Upload}
              data-testid="input-w9-upload"
            />
            
            {!profile?.w9DocumentUrl ? (
              <div 
                onClick={() => w9InputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                data-testid="dropzone-w9-upload"
              >
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">{t("uploadW9Form")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("pdfJpgPngAccepted")}</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{t("w9Uploaded")}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile.w9UploadedAt 
                        ? t("uploadedDate", { date: format(new Date(profile.w9UploadedAt), "MMM d, yyyy") })
                        : t("documentOnFile")}
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => w9InputRef.current?.click()}
                    data-testid="button-reupload-w9"
                  >
                    {t("replace")}
                  </Button>
                </div>
              </div>
            )}
            
            {isUploadingW9 && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("uploadingW9")}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="bg-muted/50 rounded-lg p-4">
          <h3 className="font-medium text-sm mb-2">{t("whyDoWeNeedTheseDocuments")}</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li><strong>{t("insurance")}:</strong> {t("insuranceDescription")}</li>
            <li><strong>{t("w9")}:</strong> {t("w9Description")}</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
