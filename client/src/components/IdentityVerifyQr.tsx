import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

type Props = {
  url: string;
  className?: string;
};

/** Data-URL QR for Stripe Identity (or any HTTPS URL); desktop/tablet onboarding. */
export function IdentityVerifyQr({ url, className }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(undefined);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: "M" })
      .then((src) => {
        if (!cancelled) setDataUrl(src);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (dataUrl === undefined) {
    return (
      <div
        className={cn("mx-auto h-[200px] w-[200px] animate-pulse rounded-xl border border-border bg-muted", className)}
        aria-hidden
      />
    );
  }
  if (dataUrl === null) {
    return <p className="text-center text-xs text-muted-foreground">Could not generate QR. Use “Open in browser” below.</p>;
  }
  return (
    <img
      src={dataUrl}
      alt="Scan with your phone to open identity verification"
      width={200}
      height={200}
      className={cn("mx-auto rounded-xl border border-border bg-white p-2 shadow-sm", className)}
    />
  );
}
