import { createRequire } from "module";
import { log } from "../index";

const require = createRequire(import.meta.url);
const pdfParseModule = require("pdf-parse");
const pdfParse = (typeof pdfParseModule === "function" ? pdfParseModule : pdfParseModule?.default) as (buffer: Buffer) => Promise<{ text: string; numpages: number; info?: unknown }>;
if (typeof pdfParse !== "function") {
  throw new Error("pdf-parse did not export a function");
}

/**
 * Validates a W-9 form by extracting text and checking for required fields
 * @param fileBuffer - Buffer containing the PDF or image file
 * @param mimeType - MIME type of the file (e.g., 'application/pdf', 'image/png')
 * @returns Validation result with extracted data and validation status
 */
export async function validateW9Form(
  fileBuffer: Buffer,
  mimeType: string
): Promise<{
  isValid: boolean;
  errors: string[];
  extractedData: {
    name?: string;
    businessName?: string;
    taxId?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    ssn?: string;
    ein?: string;
  };
  confidence: number; // 0-1 score of how confident we are this is a real W-9
}> {
  const errors: string[] = [];
  const extractedData: any = {};
  let text = "";
  let confidence = 0;

  try {
    if (mimeType === "application/pdf") {
      // Extract text from PDF
      const pdfData = await pdfParse(fileBuffer);
      text = pdfData.text;
    } else if (mimeType.startsWith("image/")) {
      // For images, we'd need OCR (Tesseract.js)
      // For now, we'll do basic validation and note that OCR is needed
      log("W-9 image upload detected - OCR validation recommended for full validation", "w9-validator");
      // Basic check: if it's an image, we can't extract text without OCR
      // For MVP, we'll accept images but with lower confidence
      return {
        isValid: true, // Accept images for now, but flag for manual review
        errors: ["Image format detected - OCR validation recommended"],
        extractedData: {},
        confidence: 0.5, // Lower confidence for images
      };
    } else {
      return {
        isValid: false,
        errors: ["Unsupported file type. Please upload a PDF or image file."],
        extractedData: {},
        confidence: 0,
      };
    }

    // Normalize text for searching
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ");

    // Check for W-9 form indicators
    const w9Indicators = [
      "form w-9",
      "request for taxpayer",
      "taxpayer identification",
      "department of the treasury",
      "internal revenue service",
      "irs",
    ];

    const hasW9Indicators = w9Indicators.some((indicator) =>
      normalizedText.includes(indicator)
    );
    if (hasW9Indicators) {
      confidence += 0.3;
    } else {
      errors.push("Document does not appear to be a W-9 form");
    }

    // Extract name (Line 1)
    const nameMatch = text.match(/name\s*[:\-]?\s*([A-Za-z\s,\.]+)/i);
    if (nameMatch) {
      extractedData.name = nameMatch[1].trim();
      confidence += 0.1;
    }

    // Extract business name (Line 2)
    const businessNameMatch = text.match(
      /business\s*name\s*[:\-]?\s*([A-Za-z0-9\s,\.&]+)/i
    );
    if (businessNameMatch) {
      extractedData.businessName = businessNameMatch[1].trim();
      confidence += 0.1;
    }

    // Extract Tax ID (SSN or EIN)
    // SSN format: XXX-XX-XXXX
    const ssnMatch = text.match(/\b(\d{3}[-.\s]?\d{2}[-.\s]?\d{4})\b/);
    if (ssnMatch) {
      extractedData.ssn = ssnMatch[1].replace(/[-.\s]/g, "");
      extractedData.taxId = ssnMatch[1];
      confidence += 0.2;
    }

    // EIN format: XX-XXXXXXX
    const einMatch = text.match(/\b(\d{2}[-.\s]?\d{7})\b/);
    if (einMatch && !ssnMatch) {
      extractedData.ein = einMatch[1].replace(/[-.\s]/g, "");
      extractedData.taxId = einMatch[1];
      confidence += 0.2;
    }

    if (!extractedData.taxId) {
      errors.push("Tax ID (SSN or EIN) not found in document");
    }

    // Extract address
    const addressMatch = text.match(
      /address\s*[:\-]?\s*([A-Za-z0-9\s,#\.\-]+)/i
    );
    if (addressMatch) {
      extractedData.address = addressMatch[1].trim();
      confidence += 0.1;
    }

    // Extract city, state, zip
    const cityStateZipMatch = text.match(
      /([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/
    );
    if (cityStateZipMatch) {
      extractedData.city = cityStateZipMatch[1].trim();
      extractedData.state = cityStateZipMatch[2].trim();
      extractedData.zipCode = cityStateZipMatch[3].trim();
      confidence += 0.1;
    }

    // Check for signature indicator
    const hasSignature = /signature|signed|date\s*signed/i.test(text);
    if (hasSignature) {
      confidence += 0.1;
    } else {
      errors.push("Signature section not clearly identified");
    }

    // Minimum confidence threshold
    const isValid = confidence >= 0.4 && errors.length < 3;

    log(
      `W-9 validation: isValid=${isValid}, confidence=${confidence.toFixed(2)}, errors=${errors.length}`,
      "w9-validator"
    );

    return {
      isValid,
      errors,
      extractedData,
      confidence: Math.min(confidence, 1.0),
    };
  } catch (error: any) {
    log(`W-9 validation error: ${error.message}`, "w9-validator");
    return {
      isValid: false,
      errors: [`Validation error: ${error.message}`],
      extractedData: {},
      confidence: 0,
    };
  }
}
