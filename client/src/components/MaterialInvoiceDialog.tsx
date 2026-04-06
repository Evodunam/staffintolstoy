import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Receipt, Upload, Loader2, ChevronRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";

interface MaterialInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number;
  jobTitle: string;
}

export function MaterialInvoiceDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
}: MaterialInvoiceDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [amountDollars, setAmountDollars] = useState("");
  const [description, setDescription] = useState("");
  const [receiptObjectPath, setReceiptObjectPath] = useState<string | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);

  const { uploadFile, isUploading } = useUpload({
    defaultBucket: "receipts",
    onSuccess: (res) => {
      setReceiptObjectPath(res.objectPath);
      setReceiptPreviewUrl(res.objectPath ? `${window.location.origin}${res.objectPath}` : null);
    },
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amountDollars) * 100);
      if (!receiptObjectPath) throw new Error("Receipt photo is required");
      if (!Number.isFinite(amountCents) || amountCents < 0) throw new Error("Enter a valid amount");
      const res = await apiRequest("POST", "/api/timesheets/material-invoice", {
        jobId,
        amountCents,
        description: description.trim() || undefined,
        receiptUrl: receiptObjectPath,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Material invoice submitted", description: "It will appear on the company timesheets with your receipt." });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/job", jobId] });
      onOpenChange(false);
      setAmountDollars("");
      setDescription("");
      setReceiptObjectPath(null);
      setReceiptPreviewUrl(null);
    },
    onError: (err: Error) => {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.includes("pdf")) {
      toast({ title: "Invalid file", description: "Please upload an image or PDF receipt.", variant: "destructive" });
      return;
    }
    setReceiptObjectPath(null);
    setReceiptPreviewUrl(null);
    await uploadFile(file, "receipts");
    e.target.value = "";
  };

  const canSubmit =
    !!receiptObjectPath &&
    amountDollars !== "" &&
    Number.isFinite(parseFloat(amountDollars)) &&
    parseFloat(amountDollars) >= 0 &&
    !submitMutation.isPending;

  // Stack above parent job shell: Drawer z-[100], Dialog z-[201], Sheet z-50 — nested must be higher.
  const nestedStackOverlay = "!z-[220]";
  const nestedStackContent = "!z-[221]";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName={nestedStackOverlay}
      showBackButton
      onBack={() => onOpenChange(false)}
      backLabel="Back"
      title={
        <>
          <span className="text-xs text-muted-foreground font-normal block truncate" title={jobTitle}>
            {jobTitle}
            <ChevronRight className="w-3 h-3 inline-block mx-0.5 align-middle" />
          </span>
          <span className="block font-semibold text-lg tracking-tight mt-0.5">Material Invoice</span>
        </>
      }
      description="Upload a receipt photo and enter the amount. It will appear on the company's timesheets as an invoice with receipt."
      contentClassName={cn("sm:max-w-md", nestedStackContent)}
    >
        <div className="space-y-4">
          {/* Receipt upload (required) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Receipt photo <span className="text-destructive">*</span>
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            {receiptObjectPath ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                {receiptPreviewUrl && (
                  <a
                    href={receiptPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 w-12 h-12 rounded border bg-background overflow-hidden"
                  >
                    <img src={receiptPreviewUrl} alt="Receipt" className="w-full h-full object-cover" />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Receipt attached</p>
                  <p className="text-xs text-muted-foreground">Tap to replace</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  Replace
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full h-24 border-dashed flex flex-col gap-1"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="w-6 h-6 text-muted-foreground" />
                )}
                <span className="text-sm">{isUploading ? "Uploading…" : "Tap to upload receipt (image or PDF)"}</span>
              </Button>
            )}
          </div>

          {/* Amount - auto-fill placeholder for future OCR */}
          <div className="space-y-2">
            <Label htmlFor="material-invoice-amount">
              Amount ($) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="material-invoice-amount"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.00"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
            />
          </div>

          {/* Description (optional) */}
          <div className="space-y-2">
            <Label htmlFor="material-invoice-desc">Description (optional)</Label>
            <Input
              id="material-invoice-desc"
              placeholder="e.g. Concrete, lumber"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <Button
            className="w-full"
            disabled={!canSubmit}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            Submit material invoice
          </Button>
        </div>
    </ResponsiveDialog>
  );
}
