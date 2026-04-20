export type ProfileLikeRecord = {
  role?: string;
  onboardingStatus?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  faceVerified?: boolean | null;
  serviceCategories?: string[] | null;
  hourlyRate?: number | null;
  bankAccountLinked?: boolean | null;
  mercuryRecipientId?: string | null;
  onboarding_status?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  face_verified?: boolean | null;
  service_categories?: string[] | null;
  hourly_rate?: number | null;
  bank_account_linked?: boolean | null;
  mercury_recipient_id?: string | null;
};

export type ProfileLike = ProfileLikeRecord | null;

function val<T>(profile: ProfileLike, camel: keyof ProfileLikeRecord, snake: string): T | null | undefined {
  if (!profile) return undefined;
  const c = profile[camel as keyof ProfileLike];
  const s = (profile as Record<string, unknown>)[snake];
  if (c !== undefined && c !== null) return c as T;
  return s as T | null | undefined;
}

/** Normalize value to boolean (handles API returning 0/1 or "true"/"false"). */
function toBool(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return false;
}

/** Normalize to number (handles decimal columns returned as string). */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalize to string array (handles JSON string or single value). */
function toServiceCategories(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === "string") : [];
    } catch {
      return v.trim() ? [v] : [];
    }
  }
  return [];
}

/**
 * Determines if a worker profile has completed onboarding with all required fields:
 * name, email, phone, face photo (avatar + verified), at least 1 skill-set, rate, bank account.
 * If the backend has marked onboardingStatus as "complete", we treat it as complete.
 * Uses defensive coercion so DB/API type quirks (e.g. boolean as 0/1, decimal as string) don't mark completed workers as incomplete.
 */
export function isWorkerOnboardingComplete(profile: ProfileLike): boolean {
  if (!profile || profile.role !== "worker") return true;

  const onboardingStatus = val<string>(profile, "onboardingStatus", "onboarding_status");
  if (String(onboardingStatus ?? "").toLowerCase() === "complete") return true;

  const firstName = val<string>(profile, "firstName", "first_name");
  const lastName = val<string>(profile, "lastName", "last_name");
  const email = val<string>(profile, "email", "email");
  const phone = val<string>(profile, "phone", "phone");
  const avatarUrl = val<string>(profile, "avatarUrl", "avatar_url");
  const faceVerifiedRaw = val<unknown>(profile, "faceVerified", "face_verified");
  const serviceCategoriesRaw = val<unknown>(profile, "serviceCategories", "service_categories");
  const hourlyRateRaw = val<unknown>(profile, "hourlyRate", "hourly_rate");
  const bankAccountLinkedRaw = val<unknown>(profile, "bankAccountLinked", "bank_account_linked");
  const mercuryRecipientId = val<string>(profile, "mercuryRecipientId", "mercury_recipient_id");

  const hasName = !!(String(firstName ?? "").trim() && String(lastName ?? "").trim());
  const hasEmail = !!String(email ?? "").trim();
  const hasPhone = !!String(phone ?? "").trim();
  const hasFacePhoto = !!(String(avatarUrl ?? "").trim() && toBool(faceVerifiedRaw));
  const serviceCategories = toServiceCategories(serviceCategoriesRaw);
  const hasSkillSet = serviceCategories.length >= 1;
  const hourlyRate = toNum(hourlyRateRaw);
  const hasRate = hourlyRate != null && hourlyRate > 0;
  const hasBank = toBool(bankAccountLinkedRaw) || !!String(mercuryRecipientId ?? "").trim();

  return hasName && hasEmail && hasPhone && hasFacePhoto && hasSkillSet && hasRate && hasBank;
}

/** Company wizard completion: backend sets onboardingStatus when /company-onboarding flow finishes. */
export function isCompanyOnboardingComplete(profile: ProfileLike): boolean {
  if (!profile || profile.role !== "company") return true;
  const onboardingStatus = val<string>(profile, "onboardingStatus", "onboarding_status");
  return String(onboardingStatus ?? "").toLowerCase() === "complete";
}

export type OnboardingMissingField =
  | "name"
  | "email"
  | "phone"
  | "facePhoto"
  | "skills"
  | "rate"
  | "bank";

/**
 * Returns which onboarding fields are missing. Used to show full wizard vs small "minor only" form.
 * Minor = phone, facePhoto (quick to fix in-place). Critical = name, email, skills, rate, bank.
 */
export function getWorkerOnboardingMissing(profile: ProfileLike): {
  missing: OnboardingMissingField[];
  minorOnly: boolean;
} {
  const missing: OnboardingMissingField[] = [];
  if (!profile || profile.role !== "worker") return { missing: [], minorOnly: true };

  const onboardingStatus = val<string>(profile, "onboardingStatus", "onboarding_status");
  if (String(onboardingStatus ?? "").toLowerCase() === "complete") return { missing: [], minorOnly: true };

  const firstName = val<string>(profile, "firstName", "first_name");
  const lastName = val<string>(profile, "lastName", "last_name");
  const email = val<string>(profile, "email", "email");
  const phone = val<string>(profile, "phone", "phone");
  const avatarUrl = val<string>(profile, "avatarUrl", "avatar_url");
  const faceVerifiedRaw = val<unknown>(profile, "faceVerified", "face_verified");
  const serviceCategoriesRaw = val<unknown>(profile, "serviceCategories", "service_categories");
  const hourlyRateRaw = val<unknown>(profile, "hourlyRate", "hourly_rate");
  const bankAccountLinkedRaw = val<unknown>(profile, "bankAccountLinked", "bank_account_linked");
  const mercuryRecipientId = val<string>(profile, "mercuryRecipientId", "mercury_recipient_id");

  const hasName = !!(String(firstName ?? "").trim() && String(lastName ?? "").trim());
  const hasEmail = !!String(email ?? "").trim();
  const hasPhone = !!String(phone ?? "").trim();
  const hasFacePhoto = !!(String(avatarUrl ?? "").trim() && toBool(faceVerifiedRaw));
  const serviceCategories = toServiceCategories(serviceCategoriesRaw);
  const hasSkillSet = serviceCategories.length >= 1;
  const hourlyRate = toNum(hourlyRateRaw);
  const hasRate = hourlyRate != null && hourlyRate > 0;
  const hasBank = toBool(bankAccountLinkedRaw) || !!String(mercuryRecipientId ?? "").trim();

  if (!hasName) missing.push("name");
  if (!hasEmail) missing.push("email");
  if (!hasPhone) missing.push("phone");
  if (!hasFacePhoto) missing.push("facePhoto");
  if (!hasSkillSet) missing.push("skills");
  if (!hasRate) missing.push("rate");
  if (!hasBank) missing.push("bank");

  const minorFields: OnboardingMissingField[] = ["phone", "facePhoto"];
  const minorOnly =
    missing.length > 0 && missing.every((m) => minorFields.includes(m));

  return { missing, minorOnly };
}

export type OnboardingChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  required: boolean;
  url: string;
};

/**
 * Returns onboarding checklist items with completion status and progress percentage.
 * Checklist: name, email, phone, photo (face verified), skills, rate, W-9, bank.
 * W-9 is required for getting paid but can be skipped initially (required: false).
 */
export function getWorkerOnboardingProgress(profile: ProfileLike): {
  items: OnboardingChecklistItem[];
  progressPercent: number;
  completedCount: number;
  totalCount: number;
} {
  if (!profile || profile.role !== "worker") {
    return { items: [], progressPercent: 100, completedCount: 0, totalCount: 0 };
  }

  const onboardingStatus = val<string>(profile, "onboardingStatus", "onboarding_status");
  if (String(onboardingStatus ?? "").toLowerCase() === "complete") {
    return { items: [], progressPercent: 100, completedCount: 0, totalCount: 0 };
  }

  const firstName = val<string>(profile, "firstName", "first_name");
  const lastName = val<string>(profile, "lastName", "last_name");
  const email = val<string>(profile, "email", "email");
  const phone = val<string>(profile, "phone", "phone");
  const avatarUrl = val<string>(profile, "avatarUrl", "avatar_url");
  const faceVerifiedRaw = val<unknown>(profile, "faceVerified", "face_verified");
  const serviceCategoriesRaw = val<unknown>(profile, "serviceCategories", "service_categories");
  const hourlyRateRaw = val<unknown>(profile, "hourlyRate", "hourly_rate");
  const bankAccountLinkedRaw = val<unknown>(profile, "bankAccountLinked", "bank_account_linked");
  const mercuryRecipientId = val<string>(profile, "mercuryRecipientId", "mercury_recipient_id");
  const w9UploadedAt = (profile as any).w9UploadedAt || (profile as any).w9_uploaded_at;

  const hasName = !!(String(firstName ?? "").trim() && String(lastName ?? "").trim());
  const hasEmail = !!String(email ?? "").trim();
  const hasPhone = !!String(phone ?? "").trim();
  const hasFacePhoto = !!(String(avatarUrl ?? "").trim() && toBool(faceVerifiedRaw));
  const serviceCategories = toServiceCategories(serviceCategoriesRaw);
  const hasSkillSet = serviceCategories.length >= 1;
  const hourlyRate = toNum(hourlyRateRaw);
  const hasRate = hourlyRate != null && hourlyRate > 0;
  const hasBank = toBool(bankAccountLinkedRaw) || !!String(mercuryRecipientId ?? "").trim();
  const hasW9 = !!w9UploadedAt;

  const items: OnboardingChecklistItem[] = [
    {
      id: "name",
      label: "Name",
      completed: hasName,
      required: true,
      url: "/worker-onboarding?step=1",
    },
    {
      id: "email",
      label: "Email",
      completed: hasEmail,
      required: true,
      url: "/worker-onboarding?step=1",
    },
    {
      id: "phone",
      label: "Phone",
      completed: hasPhone,
      required: true,
      url: "/worker-onboarding?step=1",
    },
    {
      id: "photo",
      label: "Face photo (verified)",
      completed: hasFacePhoto,
      required: true,
      url: "/worker-onboarding?step=1",
    },
    {
      id: "skills",
      label: "Skills / industries",
      completed: hasSkillSet,
      required: true,
      url: "/worker-onboarding?step=3&sub=categories",
    },
    {
      id: "rate",
      label: "Hourly rate",
      completed: hasRate,
      required: true,
      url: "/worker-onboarding?step=3&sub=rate",
    },
    {
      id: "w9",
      label: "W-9 form",
      completed: hasW9,
      required: false, // Can skip initially but required to get paid
      url: "/worker-onboarding?step=6",
    },
    {
      id: "bank",
      label: "Bank account",
      completed: hasBank,
      required: true,
      url: "/worker-onboarding?step=5",
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

  return { items, progressPercent, completedCount, totalCount };
}
