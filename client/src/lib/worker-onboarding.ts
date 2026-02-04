type ProfileLike = {
  role?: string;
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
  // Support snake_case in case API returns raw DB shape
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  face_verified?: boolean | null;
  service_categories?: string[] | null;
  hourly_rate?: number | null;
  bank_account_linked?: boolean | null;
  mercury_recipient_id?: string | null;
} | null;

function val<T>(profile: ProfileLike, camel: keyof ProfileLike, snake: string): T | null | undefined {
  if (!profile) return undefined;
  const c = profile[camel as keyof ProfileLike];
  const s = (profile as Record<string, unknown>)[snake];
  if (c !== undefined && c !== null) return c as T;
  return s as T | null | undefined;
}

/**
 * Determines if a worker profile has completed onboarding with all required fields:
 * name, email, phone, face photo (avatar + verified), at least 1 skill-set, rate, bank account.
 */
export function isWorkerOnboardingComplete(profile: ProfileLike): boolean {
  if (!profile || profile.role !== "worker") return true;

  const firstName = val<string>(profile, "firstName", "first_name");
  const lastName = val<string>(profile, "lastName", "last_name");
  const email = val<string>(profile, "email", "email");
  const phone = val<string>(profile, "phone", "phone");
  const avatarUrl = val<string>(profile, "avatarUrl", "avatar_url");
  const faceVerified = val<boolean>(profile, "faceVerified", "face_verified");
  const serviceCategories = val<string[]>(profile, "serviceCategories", "service_categories");
  const hourlyRate = val<number>(profile, "hourlyRate", "hourly_rate");
  const bankAccountLinked = val<boolean>(profile, "bankAccountLinked", "bank_account_linked");
  const mercuryRecipientId = val<string>(profile, "mercuryRecipientId", "mercury_recipient_id");

  const hasName = !!(String(firstName ?? "").trim() && String(lastName ?? "").trim());
  const hasEmail = !!String(email ?? "").trim();
  const hasPhone = !!String(phone ?? "").trim();
  const hasFacePhoto = !!(String(avatarUrl ?? "").trim() && faceVerified === true);
  const hasSkillSet = Array.isArray(serviceCategories) && serviceCategories.length >= 1;
  const hasRate = hourlyRate != null && Number(hourlyRate) > 0;
  const hasBank = !!(bankAccountLinked === true || String(mercuryRecipientId ?? "").trim());

  return hasName && hasEmail && hasPhone && hasFacePhoto && hasSkillSet && hasRate && hasBank;
}
