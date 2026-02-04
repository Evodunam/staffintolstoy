import { Resend } from 'resend';

// Initialize Resend with API key from environment
const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.warn('WARNING: RESEND_API_KEY is not set. Email functionality will not work.');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Single from address (no subdomains). Resend default for testing; set RESEND_FROM_EMAIL when your domain is verified.
const RESEND_FROM_DEFAULT = process.env.RESEND_FROM_EMAIL || 'Tolstoy Staffing <onboarding@resend.dev>';

const COMPANY_EMAIL_TYPES = new Set<string>([
  'new_job_posted_admin', 'worker_inquiry', 'worker_accepted_job', 'balance_low', 'balance_recharged',
  'job_posted', 'job_filled', 'welcome_company', 'team_member_joined', 'team_invite_sent', 'company_onboarding_reminder',
  'close_project_review',
]);

const BRAND_COLORS = {
  primary: '#222222',
  primaryDark: '#000000',
  secondary: '#717171',
  success: '#008A05',
  /** Green used for CTA buttons (matches index/onboarding) */
  buttonGreen: '#00A86B',
  warning: '#E07912',
  danger: '#C13515',
  background: '#F7F7F7',
  card: '#FFFFFF',
  text: '#222222',
  textMuted: '#717171',
  border: '#EBEBEB',
  /** Thin light grey for list/container line separators (Airbnb-style) */
  separatorLine: '#E5E5E5',
  accent: '#FF385C',
};

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';

// Optional app icon URL (e.g. hosted T logo). If not set, a styled "T" is used.
const APP_LOGO_URL = process.env.APP_LOGO_URL || '';

const HEADER_LOGO_SIZE = 24;

function getEmailTemplate(content: string, title: string, options?: { linkSuffix?: string }): string {
  const softBlack = '#2C2C2C';
  const headerLogo = APP_LOGO_URL
    ? `<img src="${APP_LOGO_URL}" alt="Tolstoy Staffing" width="${HEADER_LOGO_SIZE}" height="${HEADER_LOGO_SIZE}" style="display: block; width: ${HEADER_LOGO_SIZE}px; height: ${HEADER_LOGO_SIZE}px; border-radius: 6px; object-fit: contain; background-color: ${softBlack};" />`
    : `<div style="width: ${HEADER_LOGO_SIZE}px; height: ${HEADER_LOGO_SIZE}px; border-radius: 6px; background-color: ${softBlack}; text-align: center; line-height: ${HEADER_LOGO_SIZE}px; font-size: 14px; font-weight: 700; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">T</div>`;
  const footerLink = `${BASE_URL}/dashboard/settings/notifications${options?.linkSuffix ? '?' + options.linkSuffix : ''}`;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ${BRAND_COLORS.background};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${BRAND_COLORS.background};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: ${BRAND_COLORS.card}; border-radius: 16px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.05);">
          <tr>
            <td align="center" style="padding: 20px 40px;">
              ${headerLogo}
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: ${BRAND_COLORS.background}; border-radius: 0 0 16px 16px; border-top: 1px solid ${BRAND_COLORS.separatorLine};">
              <p style="margin: 0; font-size: 12px; color: ${BRAND_COLORS.textMuted}; text-align: center;">
                &copy; ${new Date().getFullYear()} Tolstoy Staffing. All rights reserved.
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: ${BRAND_COLORS.textMuted}; text-align: center;">
                <a href="${footerLink}" style="color: ${BRAND_COLORS.text}; text-decoration: underline;">Manage Notifications</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function getButton(text: string, url: string, variant: 'primary' | 'success' | 'warning' = 'primary'): string {
  const bgColor = variant === 'warning' ? BRAND_COLORS.warning : BRAND_COLORS.buttonGreen;
  return `
    <a href="${url}" style="display: inline-block; padding: 14px 28px; background-color: ${bgColor}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
      ${text}
    </a>
  `;
}

/** Light, left-aligned link style (e.g. "View opportunity" with company logo). */
function getButtonLight(text: string, url: string): string {
  return `<a href="${url}" style="display: inline-block; padding: 10px 20px; background-color: transparent; color: ${BRAND_COLORS.text}; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; border: 1px solid ${BRAND_COLORS.separatorLine};">${text}</a>`;
}

function getCard(content: string): string {
  return `
    <div style="background-color: ${BRAND_COLORS.card}; border-radius: 12px; padding: 24px; margin: 16px 0; border: 1px solid ${BRAND_COLORS.separatorLine}; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);">
      ${content}
    </div>
  `;
}

/** Single row for label-value lists (thin light grey separator below, bold label, value right-aligned). */
function getListRow(label: string, value: string, isLast = false): string {
  const borderStyle = isLast ? 'none' : `border-bottom: 1px solid ${BRAND_COLORS.separatorLine};`;
  return `
    <tr>
      <td style="padding: 12px 0; ${borderStyle} font-size: 14px; font-weight: 600; color: ${BRAND_COLORS.text}; vertical-align: top;">${label}</td>
      <td style="padding: 12px 0; ${borderStyle} font-size: 14px; color: ${BRAND_COLORS.text}; text-align: right; vertical-align: top;">${value}</td>
    </tr>`;
}

/** Full address row: label left, value right-aligned (not center). */
function getListRowAddress(label: string, value: string, isLast = false): string {
  const borderStyle = isLast ? 'none' : `border-bottom: 1px solid ${BRAND_COLORS.separatorLine};`;
  return `
    <tr>
      <td style="padding: 12px 0; ${borderStyle} font-size: 14px; font-weight: 600; color: ${BRAND_COLORS.text}; vertical-align: top; width: 36%;">${label}</td>
      <td style="padding: 12px 0; ${borderStyle} font-size: 14px; color: ${BRAND_COLORS.text}; text-align: right; vertical-align: top;">${value}</td>
    </tr>`;
}

/** Section divider: thin light grey horizontal line (use between major sections). */
function getSectionDivider(): string {
  return `<div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid ${BRAND_COLORS.separatorLine};"></div>`;
}

/** Get initials for contact name for email subject (e.g. "Jane Smith" -> "J. S."). */
function getContactInitials(name: string | null | undefined): string {
  if (!name || !String(name).trim()) return 'Customer';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts.map(p => (p.charAt(0) || '').toUpperCase() + '.').join(' ');
  return (parts[0]?.charAt(0) || '').toUpperCase() + '.';
}

function getClickableWorkerCard(worker: { name: string; rate: number; rating: string; completedJobs: number; workerId?: number }, jobId: number): string {
  return `
    <a href="${BASE_URL}/company-dashboard?job=${jobId}&worker=${worker.workerId || ''}" style="display: block; text-decoration: none; color: inherit; background-color: ${BRAND_COLORS.card}; border-radius: 12px; padding: 16px 20px; margin: 12px 0; border: 1px solid ${BRAND_COLORS.separatorLine}; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); transition: all 0.2s;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="width: 48px; vertical-align: top;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background-color: ${BRAND_COLORS.background}; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 600; color: ${BRAND_COLORS.text};">
              ${worker.name.charAt(0).toUpperCase()}
            </div>
          </td>
          <td style="padding-left: 16px; vertical-align: top;">
            <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${worker.name}</p>
            <p style="margin: 0; font-size: 14px; color: ${BRAND_COLORS.textMuted};">
              $${worker.rate}/hr &middot; ⭐ ${worker.rating} &middot; ${worker.completedJobs} jobs
            </p>
          </td>
          <td style="width: 24px; text-align: right; vertical-align: middle;">
            <span style="color: ${BRAND_COLORS.textMuted}; font-size: 18px;">&rarr;</span>
          </td>
        </tr>
      </table>
    </a>
  `;
}

export type EmailType = 
  | 'new_job_nearby'
  | 'new_job_posted_admin'
  | 'job_offer_received'
  | 'application_accepted'
  | 'application_rejected'
  | 'timesheet_approved'
  | 'timesheet_rejected'
  | 'timesheet_edited'
  | 'payment_received'
  | 'strike_warning'
  | 'account_terminated'
  | 'worker_inquiry'
  | 'worker_accepted_job'
  | 'worker_clocked_in'
  | 'worker_clocked_out'
  | 'balance_low'
  | 'balance_recharged'
  | 'job_posted'
  | 'job_filled'
  | 'job_reminder'
  | 'direct_request_sent'
  | 'direct_request_expired'
  | 'team_member_joined'
  | 'team_invite_sent'
  | 'worker_team_invite'
  | 'welcome_worker'
  | 'welcome_company'
  | 'private_note'
  | 'job_start_reminder'
  | 'payout_pending_bank_setup'
  | 'payout_pending_w9'
  | 'payout_sent'
  | 'new_job_message'
  | 'call_invite'
  | 'chat_unread_digest'
  | 'payment_reminder'
  | 'password_reset'
  | 'otp_login'
  | 'magic_link_login'
  | 'otp_and_magic_link_login'
  | 'ai_dispatch_applied'
  | 'worker_onboarding_reminder'
  | 'company_onboarding_reminder'
  | 'affiliate_referred_lead_signed_up'
  | 'affiliate_payment_sent'
  | 'affiliate_setup_bank_w9'
  | 'affiliate_share_link_reminder'
  | 'affiliate_welcome'
  | 'affiliate_commission_available'
  | 'close_project_review'
  | 'geolocation_clock_in_reminder'
  | 'geolocation_clock_out_reminder'
  | 'geolocation_auto_clocked_out';

interface EmailData {
  to: string;
  type: EmailType;
  data: Record<string, any>;
  /** Optional file attachments (e.g. for job gallery images as attachments). Resend: { filename, content: Buffer | string } */
  attachments?: Array<{ filename: string; content: Buffer | string }>;
}

const emailTemplates: Record<EmailType, (data: Record<string, any>) => { subject: string; content: string }> = {
  /** new_job_nearby: all text/components are from real data when sent from routes (job create + send alert).
   * Data keys: jobTitle, jobId, trade, location, city, state, partialAddress, distance, seekerName, posterBusinessName,
   * posterContactName, posterReputation, jobsPostedCount, memberSince, companyLogoUrl, dates, startDateRelative,
   * scheduledTime, timeType, description, skillsCategory, requiredSkills, hourlyRate, estimatedHours, estimatedPayout,
   * mapImageUrl (proxy URL), galleryImages (absolute URLs), suggestedTeammates (name, availability, distanceMi),
   * suggestedTeammateIds, showAiDispatchPrompt. Sample data uses getSampleDataForType('new_job_nearby'). */
  new_job_nearby: (data) => {
    const posterContactName = data.posterContactName || (data.posterBusinessName || data.seekerName) || 'Contact';
    const jobsPostedCount = data.jobsPostedCount != null ? data.jobsPostedCount : '';
    const memberSince = data.memberSince || '';
    const trade = data.trade || data.serviceCategory || 'Skilled labor';
    const cityState = (data.city && data.state) ? `${data.city}, ${data.state}` : (data.partialAddress || '');
    const contactInitials = getContactInitials(posterContactName);
    const dates = data.dates || (data.startDate ? new Date(data.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD');
    const startDateRelative = data.startDateRelative || '';
    const timeType = data.timeType || (data.jobType || 'one_time');
    const scheduledTime = data.scheduledTime || '';
    const timeTypeLabel = timeType === 'one_time' ? 'One-time' : timeType === 'recurring' ? 'Recurring' : 'On-demand';
    const dateTimeRow = [timeTypeLabel, `${dates}${startDateRelative ? ` (${startDateRelative})` : ''}`, scheduledTime].filter(Boolean).join(' · ');
    const description = data.description || '';
    const mapImgUrl = data.mapImageUrl || '';
    const shortAddress = data.partialAddress || (data.location ? [data.location, data.city, data.state].filter(Boolean).join(', ') : (data.city && data.state ? `${data.city}, ${data.state}` : ''));
    const galleryImages = Array.isArray(data.galleryImages) ? data.galleryImages : (data.galleryImages ? [data.galleryImages] : []);
    const hourlyRateCents = data.hourlyRate != null ? Number(data.hourlyRate) : null;
    const estimatedHours = data.estimatedHours != null ? Number(data.estimatedHours) : null;
    const estimatedPayoutComputed = (hourlyRateCents != null && estimatedHours != null)
      ? `~$${Math.round((hourlyRateCents / 100) * estimatedHours)}`
      : (data.estimatedPayout || '');
    const estimatedHoursLabel = estimatedHours != null ? (estimatedHours === 1 ? '1 hour' : `${estimatedHours} hours`) : '';
    const skillsCategory = data.skillsCategory || trade;
    const requiredSkills = Array.isArray(data.requiredSkills) ? data.requiredSkills : (data.requiredSkills ? [data.requiredSkills] : []);
    const skillsetsLabel = requiredSkills.length > 0 ? requiredSkills.join(', ') : skillsCategory;
    const suggestedTeammates = Array.isArray(data.suggestedTeammates) ? data.suggestedTeammates : [];
    const teammateIds = Array.isArray(data.suggestedTeammateIds) ? data.suggestedTeammateIds : [];
    // Teammates: compact tags with name · availability · distance (e.g. "Alex · Available · 12mi")
    const testSuffix = data.testMode ? '&test=1' : '';
    const applyUrl = (teammateIds.length > 0 ? `${BASE_URL}/dashboard/find?job=${data.jobId}&apply=1&teammates=${teammateIds.join(',')}` : `${BASE_URL}/dashboard/find?job=${data.jobId}&apply=1`) + testSuffix;
    const sep = () => `<div style="border-top:1px solid ${BRAND_COLORS.separatorLine};margin:20px 0;padding-top:16px;"></div>`;
    const pillSkills = '#dbeafe';
    const pillAvail = '#dcfce7';

    const hasSkillsets = !!skillsetsLabel;
    const hasPayout = !!estimatedPayoutComputed || !!estimatedHoursLabel;
    const hasAttachments = galleryImages.length > 0;
    const hasTeammates = suggestedTeammates.length > 0;

    const chunks: string[] = [];

    // 1. Bordered company container: map thumbnail inside at top (full width), then contact + business details + View opportunity (lower, right-aligned). Extra padding below container.
    const mapBlock = mapImgUrl
      ? `<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:${BRAND_COLORS.textMuted};">Approximate job location</p><img src="${mapImgUrl}" alt="Approximate job location" width="600" height="260" style="display:block;max-width:100%;width:100%;height:auto;max-height:260px;object-fit:cover;border-radius:8px 8px 0 0;" />`
      : '';
    chunks.push(`<div style="border:1px solid ${BRAND_COLORS.separatorLine};border-radius:12px;overflow:hidden;padding-bottom:20px;margin-bottom:28px;">
${mapBlock ? `<div style="margin:0;">${mapBlock}</div>` : ''}
<div style="padding:16px 20px;">
<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:${BRAND_COLORS.text};">${posterContactName}</p>
${jobsPostedCount !== '' ? `<p style="margin:0 0 4px;font-size:13px;color:${BRAND_COLORS.textMuted};">${jobsPostedCount} job${Number(jobsPostedCount) !== 1 ? 's' : ''} posted</p>` : ''}
${memberSince ? `<p style="margin:0 0 16px;font-size:13px;color:${BRAND_COLORS.textMuted};">${memberSince}</p>` : ''}
<div style="margin-top:16px;text-align:right;">${getButtonLight('View opportunity', applyUrl)}</div>
</div>
</div>`);

    // 3. Job details – title, description, time/date, address (short form); no border on last row to avoid duplicate line with sep
    let jobBlock = `<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:${BRAND_COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Job details</p>
<div style="padding:10px 0;border-bottom:1px solid ${BRAND_COLORS.separatorLine};"><p style="margin:0;font-size:14px;font-weight:600;color:${BRAND_COLORS.text};">Title</p><p style="margin:4px 0 0;font-size:14px;color:${BRAND_COLORS.text};">${data.jobTitle || trade}</p></div>
${description ? `<div style="padding:10px 0;border-bottom:1px solid ${BRAND_COLORS.separatorLine};"><p style="margin:0;font-size:14px;font-weight:600;color:${BRAND_COLORS.text};">Description</p><p style="margin:4px 0 0;font-size:14px;color:${BRAND_COLORS.text};line-height:1.5;">${description.length > 250 ? description.substring(0, 250) + '…' : description}</p></div>` : ''}
<div style="padding:10px 0;border-bottom:1px solid ${BRAND_COLORS.separatorLine};"><p style="margin:0;font-size:14px;font-weight:600;color:${BRAND_COLORS.text};">Time · Date · Start</p><p style="margin:4px 0 0;font-size:14px;color:${BRAND_COLORS.text};">${dateTimeRow}</p></div>
${shortAddress ? `<div style="padding:10px 0;"><p style="margin:0;font-size:14px;font-weight:600;color:${BRAND_COLORS.text};">Address</p><p style="margin:4px 0 0;font-size:14px;color:${BRAND_COLORS.text};">${shortAddress}</p></div>` : ''}`;
    chunks.push(jobBlock);

    // 4. Skill-sets & category — no border on last row
    if (hasSkillsets) {
      chunks.push(`<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:${BRAND_COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Skill-sets & category</p>
<div style="padding:10px 0;"><p style="margin:0;font-size:14px;color:${BRAND_COLORS.text};">${skillsetsLabel}</p></div>`);
    }

    // 5. Estimated hours + payout (hours based on job time/date)
    if (hasPayout) {
      chunks.push(`<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:${BRAND_COLORS.text};">Estimated payout</p>${estimatedHoursLabel ? `<p style="margin:0 0 4px;font-size:14px;color:${BRAND_COLORS.textMuted};">${estimatedHoursLabel} of work</p>` : ''}<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:${BRAND_COLORS.success};">${estimatedPayoutComputed}</p>`);
    }

    // 6. Attachments – always show section; inline thumbnails when present (use absolute URLs so images load in email)
    const thumbHtml = galleryImages.slice(0, 12).map((url: string) => {
      const src = url.startsWith('http') ? url : (BASE_URL + (url.startsWith('/') ? url : '/' + url));
      return `<img src="${src}" alt="" width="72" height="72" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid ${BRAND_COLORS.separatorLine};display:inline-block;margin:4px;vertical-align:top;" />`;
    }).join('');
    chunks.push(`<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:${BRAND_COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Attachments</p><div style="margin-bottom:20px;">${hasAttachments ? thumbHtml : `<p style="margin:0;font-size:13px;color:${BRAND_COLORS.textMuted};">No attachments for this job.</p>`}</div>`);

    // 7. Your teammates – compact text-wrapped tags: name · availability · distance (e.g. 12mi). Scales for large teams.
    const showAiDispatchPrompt = hasTeammates && (data.showAiDispatchPrompt === true || data.aiDispatchOn === false);
    if (hasTeammates) {
      const tags = suggestedTeammates.map((t: { name?: string; availability?: string; distanceMi?: number }) => {
        const name = t.name || 'Teammate';
        const avail = t.availability || 'Available';
        const dist = t.distanceMi != null ? `${t.distanceMi}mi` : 'nearby';
        const label = [name, avail, dist].join(' · ');
        return `<span style="display:inline-block;padding:6px 12px;margin:4px 6px 4px 0;border-radius:9999px;font-size:12px;background:${pillAvail};color:#166534;border:1px solid ${BRAND_COLORS.separatorLine};">${label}</span>`;
      }).join('');
      chunks.push(`<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:${BRAND_COLORS.text};">Your teammates near this job</p>
${showAiDispatchPrompt ? `<p style="margin:0 0 10px;font-size:11px;color:${BRAND_COLORS.textMuted};line-height:1.4;">Turn on AI Dispatch in the app to auto-apply to jobs based on your team&rsquo;s schedule.</p>` : ''}
<p style="margin:0 0 8px;font-size:13px;color:${BRAND_COLORS.textMuted};">Same team, within range of job location</p>
<div style="margin-bottom:16px;line-height:1.6;">${tags}</div>`);
    }

    // Join with sep() between chunks EXCEPT between company (index 0) and job details (index 1) — no line below customer part
    let contentBody = chunks[0] || '';
    for (let i = 1; i < chunks.length; i++) {
      if (i === 1) contentBody += chunks[i];
      else contentBody += sep() + chunks[i];
    }
    return {
      subject: `Customer ${contactInitials} needs ${trade} in ${cityState}`,
      content: `<div style="margin:0;padding:0;">${contentBody}
<div style="text-align:center;margin:24px 0 0;">${getButton('Apply now', applyUrl, 'primary')}</div>
</div>`
    };
  },

  new_job_posted_admin: (data) => {
    const trade = data.trade || data.serviceCategory || 'Skilled labor';
    const fullAddress = data.fullAddress || data.location || (data.city && data.state ? `${data.city}, ${data.state}` : 'See details');
    const dates = data.dates || (data.startDate ? new Date(data.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD');
    const galleryImages = Array.isArray(data.galleryImages) ? data.galleryImages : (data.galleryImages ? [data.galleryImages] : []);
    const description = data.description || '';
    const skillsCategory = data.skillsCategory || trade;
    const locationRepresentative = data.locationRepresentative || '';
    const paymentMethodForLocation = data.paymentMethodForLocation || '';
    const workersWillSeeCount = data.workersWillSeeCount != null ? Number(data.workersWillSeeCount) : null;
    const jobTitle = data.jobTitle || trade;
    const subjectCategory = skillsCategory && skillsCategory !== trade ? skillsCategory : trade;
    const timeType = data.timeType || 'One-time';
    const scheduledTime = data.scheduledTime || '';
    const estimatedHours = data.estimatedHours != null ? Number(data.estimatedHours) : null;
    const avgPayout40 = estimatedHours != null ? estimatedHours * 40 : null;

    return {
      subject: `Your job is posted – ${jobTitle} – ${subjectCategory}`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Your job is posted</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        This confirms the job you just posted. Workers in your area with matching skills will see it and can apply.
      </p>
      ${workersWillSeeCount != null ? `
      <p style="margin: 0 0 12px; font-size: 14px; color: ${BRAND_COLORS.text}; line-height: 1.6;">
        <strong>${workersWillSeeCount}</strong> worker${workersWillSeeCount !== 1 ? 's' : ''} in your area will see this posting.
      </p>
      <p style="margin: 0 0 24px; font-size: 14px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You can typically expect applications within 24–48 hours. Next steps: review applications in your dashboard, then accept or reply to workers who apply. If your posting has attachments, they are included below.
      </p>
      ` : `
      <p style="margin: 0 0 24px; font-size: 14px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Next steps: review applications in your dashboard, then accept or reply to workers who apply. If your posting has attachments, they are included below.
      </p>
      `}
      ${getCard(`
        <h3 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: ${BRAND_COLORS.text};">${jobTitle}</h3>
        <p style="margin: 0 0 6px; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">Time type: ${timeType}</p>
        <p style="margin: 0 0 6px; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">📅 ${dates}</p>
        ${scheduledTime ? `<p style="margin: 0 0 6px; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">🕐 ${scheduledTime}</p>` : ''}
        ${estimatedHours != null ? `<p style="margin: 0 0 4px; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">Estimated hours: ${estimatedHours} ${estimatedHours === 1 ? 'hour' : 'hours'}</p>` : ''}
        ${avgPayout40 != null ? `<p style="margin: 0; font-size: 14px; font-weight: 600; color: ${BRAND_COLORS.success};">Estimated avg payout (at ~$40/hr): ~$${avgPayout40}</p>` : ''}
      `)}
      ${getSectionDivider()}
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: ${BRAND_COLORS.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">Job details</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size: 14px; color: ${BRAND_COLORS.text};">
        ${getListRow('Title', jobTitle)}
        ${description ? getListRow('Description', description.length > 300 ? description.substring(0, 300) + '…' : description) : ''}
        ${getListRow('Skill-sets & category', skillsCategory)}
        ${getListRowAddress('Full address', fullAddress, !locationRepresentative && !paymentMethodForLocation)}
        ${locationRepresentative ? getListRow('Representative for this location', locationRepresentative, !paymentMethodForLocation) : ''}
        ${paymentMethodForLocation ? getListRow('Payment method for this location', paymentMethodForLocation, true) : ''}
      </table>
      ${galleryImages.length > 0 ? `
      ${getSectionDivider()}
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: ${BRAND_COLORS.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">Attachments</p>
      <div style="margin-bottom: 24px;">${galleryImages.slice(0, 12).map((url: string) => `<img src="${url}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid ${BRAND_COLORS.separatorLine};display:inline-block;margin:4px;vertical-align:top;" />`).join('')}</div>
      ` : ''}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View job in dashboard', `${BASE_URL}/company-dashboard?tab=jobs`, 'primary')}
      </div>
    `
    };
  },

  job_offer_received: (data) => ({
    subject: `${data.companyName} Wants to Hire You!`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">You Have a Job Offer!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.companyName} has sent you a direct job request.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Company', data.companyName)}
          ${getListRow('Rate', `$${data.hourlyRate}/hr`)}
          ${getListRow('Start', data.startDate)}
          ${getListRow('Location', data.location, true)}
        </table>
      `)}
      <p style="margin: 24px 0 16px; color: ${BRAND_COLORS.warning}; font-size: 14px; text-align: center;">
        ⏰ This offer expires in 24 hours
      </p>
      <div style="text-align: center;">
        ${getButton('Accept Offer', `${BASE_URL}/dashboard?offer=${data.offerId}`, 'success')}
      </div>
    `
  }),

  application_accepted: (data) => ({
    subject: `Congratulations! You Got the Job at ${data.companyName}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">🎉 You're Hired!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Great news! ${data.companyName} has accepted your application.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Start Date', data.startDate)}
          ${getListRow('Location', data.location)}
          ${getListRow('Rate', `$${data.hourlyRate}/hr`, true)}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Job Details', `${BASE_URL}/dashboard?job=${data.jobId}`, 'primary')}
      </div>
    `
  }),

  application_rejected: (data) => ({
    subject: `Update on Your Application for ${data.jobTitle}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Application Update</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Unfortunately, ${data.companyName} has decided to go with another candidate for the position: <strong>${data.jobTitle}</strong>.
      </p>
      ${data.rejectionReason ? `
        ${getCard(`
          <p style="margin: 0 0 8px; font-size: 14px; color: ${BRAND_COLORS.text};"><strong>Feedback from the company:</strong></p>
          <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; font-style: italic;">
            "${data.rejectionReason}"
          </p>
        `)}
      ` : ''}
      <p style="margin: 24px 0; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Don't worry - there are plenty of other opportunities waiting for you!
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Browse More Jobs', `${BASE_URL}/dashboard`, 'primary')}
      </div>
    `
  }),

  timesheet_approved: (data) => {
    const workerName = data.workerName || 'Worker';
    const adminName = data.adminName;
    const messageLink = data.messageLink;
    const workerContainer = `
      <div style="margin-bottom: 20px; padding: 16px 20px; background-color: ${BRAND_COLORS.background}; border-radius: 12px; border: 1px solid ${BRAND_COLORS.separatorLine};">
        <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${BRAND_COLORS.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">Worker</p>
        <p style="margin: 0; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${workerName}</p>
        ${adminName && messageLink ? `
        <p style="margin: 12px 0 0; font-size: 14px; color: ${BRAND_COLORS.textMuted};">
          Approved by <strong>${adminName}</strong> · <a href="${messageLink}" style="color: ${BRAND_COLORS.buttonGreen}; text-decoration: underline;">Send a message</a>
        </p>
        ` : ''}
      </div>`;
    return {
      subject: `Timesheet Approved - $${data.amount} Payment Coming`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">✓ Timesheet Approved</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your timesheet has been approved and payment is being processed.
      </p>
      ${workerContainer}
      ${getCard(`
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Job', data.jobTitle)}
          ${getListRow('Hours', data.hours)}
          ${getListRow('Amount', `$${data.amount}`, true)}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Earnings', `${BASE_URL}/dashboard?section=earnings`, 'success')}
      </div>
    `
    };
  },

  timesheet_rejected: (data) => {
    const workerName = data.workerName || 'Worker';
    const adminName = data.adminName;
    const messageLink = data.messageLink;
    const workerContainer = `
      <div style="margin-bottom: 20px; padding: 16px 20px; background-color: ${BRAND_COLORS.background}; border-radius: 12px; border: 1px solid ${BRAND_COLORS.separatorLine};">
        <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${BRAND_COLORS.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">Worker</p>
        <p style="margin: 0; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${workerName}</p>
        ${adminName && messageLink ? `
        <p style="margin: 12px 0 0; font-size: 14px; color: ${BRAND_COLORS.textMuted};">
          Rejected by <strong>${adminName}</strong> · <a href="${messageLink}" style="color: ${BRAND_COLORS.buttonGreen}; text-decoration: underline;">Send a message</a>
        </p>
        ` : ''}
      </div>`;
    return {
      subject: `Timesheet Needs Revision`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">Timesheet Rejected</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your timesheet requires revision. Please review the feedback below.
      </p>
      ${workerContainer}
      ${getCard(`
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Job', data.jobTitle)}
          ${getListRow('Reason', data.reason, true)}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Review Timesheet', `${BASE_URL}/dashboard?timesheet=${data.timesheetId}`, 'primary')}
      </div>
    `
    };
  },

  payment_received: (data) => ({
    subject: `Payment Received: $${data.amount}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">💰 Payment Received!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Great news! Your payment has been processed and sent to your bank account.
      </p>
      ${getCard(`
        <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${BRAND_COLORS.success}; text-align: center;">
          $${data.amount}
        </p>
        <p style="margin: 8px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
          Payment for ${data.jobTitle}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Payment History', `${BASE_URL}/dashboard?section=earnings`, 'primary')}
      </div>
    `
  }),

  strike_warning: (data) => ({
    subject: `Warning: Strike ${data.strikeCount} of 3 Received`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">⚠️ Strike Warning</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You have received a strike on your account. Please review the details below.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Strike:</strong> ${data.strikeCount} of 3<br>
          <strong>Reason:</strong> ${data.reason}<br>
          <strong>Date:</strong> ${data.date}
        </p>
      `)}
      <p style="margin: 24px 0 16px; color: ${BRAND_COLORS.danger}; font-size: 14px;">
        ⚠️ 3 strikes will result in account termination.
      </p>
      <div style="text-align: center;">
        ${getButton('View Account Status', `${BASE_URL}/dashboard?section=account`, 'primary')}
      </div>
    `
  }),

  account_terminated: (data) => ({
    subject: `Account Terminated`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.danger};">Account Terminated</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your account has been terminated due to receiving 3 strikes.
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        <strong>Reason:</strong> ${data.reason}
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        If you believe this was a mistake, please contact support.
      </p>
    `
  }),

  worker_inquiry: (data) => {
    const workers = data.workers || [{ 
      name: data.workerName, 
      rate: data.workerRate, 
      rating: data.workerRating, 
      completedJobs: data.completedJobs,
      workerId: data.workerId 
    }];
    const workerCount = workers.length;
    const workerCards = workers.map((w: any) => getClickableWorkerCard({
      name: w.name,
      rate: w.rate,
      rating: w.rating || '5.0',
      completedJobs: w.completedJobs || 0,
      workerId: w.workerId
    }, data.jobId)).join('');
    
    return {
      subject: workerCount > 1 
        ? `${workerCount} New Applications for ${data.jobTitle}`
        : `New Application for ${data.jobTitle}`,
      content: `
        <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 600; color: ${BRAND_COLORS.text};">
          ${workerCount > 1 ? `${workerCount} Workers Applied` : 'New Worker Application'}
        </h2>
        <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
          ${workerCount > 1 
            ? `${workerCount} workers have applied for your job posting "${data.jobTitle}". Click on any applicant to view their full profile.`
            : `A worker has applied for your job posting "${data.jobTitle}". Click below to view their profile.`
          }
        </p>
        ${workerCards}
        <div style="text-align: center; margin-top: 28px;">
          ${getButton('View All Applications', `${BASE_URL}/company-dashboard?job=${data.jobId}`, 'primary')}
        </div>
      `
    };
  },

  worker_accepted_job: (data) => ({
    subject: `${data.workerName} Accepted Your Job Request!`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">🎉 Worker Confirmed!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.workerName} has accepted your job request and will be working on ${data.startDate}.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 8px; font-size: 16px; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Worker:</strong> ${data.workerName}<br>
          <strong>Phone:</strong> ${data.workerPhone}<br>
          <strong>Start:</strong> ${data.startDate}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Job Details', `${BASE_URL}/company-dashboard?job=${data.jobId}`, 'primary')}
      </div>
    `
  }),

  worker_clocked_in: (data) => ({
    subject: `${data.workerName} Clocked In at ${data.location}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">✓ Worker Clocked In</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.workerName} has arrived at the job site.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Job:</strong> ${data.jobTitle}<br>
          <strong>Location:</strong> ${data.location}<br>
          <strong>Time:</strong> ${data.clockInTime}
        </p>
      `)}
    `
  }),

  worker_clocked_out: (data) => ({
    subject: `${data.workerName} Completed Work - ${data.hours} Hours`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Work Session Complete</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.workerName} has clocked out and submitted a timesheet for approval.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Job:</strong> ${data.jobTitle}<br>
          <strong>Hours Worked:</strong> ${data.hours}<br>
          <strong>Total Cost:</strong> $${data.totalCost}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Review Timesheet', `${BASE_URL}/company-dashboard?timesheet=${data.timesheetId}`, 'primary')}
      </div>
    `
  }),

  balance_low: (data) => ({
    subject: `Low Balance Alert - $${data.balance} Remaining`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">⚠️ Low Balance Alert</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your account balance is running low. Auto-recharge of $2,000 will occur when balance drops below $200.
      </p>
      ${getCard(`
        <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${BRAND_COLORS.warning}; text-align: center;">
          $${data.balance}
        </p>
        <p style="margin: 8px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
          Current Balance
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Billing', `${BASE_URL}/company-dashboard?section=billing`, 'primary')}
      </div>
    `
  }),

  balance_recharged: (data) => ({
    subject: `Account Recharged: $${data.amount}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">✓ Account Recharged</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your account has been automatically recharged with $${data.amount}.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Amount Added:</strong> $${data.amount}<br>
          <strong>New Balance:</strong> $${data.newBalance}<br>
          <strong>Card Used:</strong> ****${data.cardLast4}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Billing History', `${BASE_URL}/company-dashboard?section=billing`, 'primary')}
      </div>
    `
  }),

  job_posted: (data) => ({
    subject: `Job Posted: ${data.jobTitle}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">✓ Job Posted Successfully</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your job has been posted and is now visible to workers in your area.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 8px; font-size: 16px; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Trade:</strong> ${data.trade}<br>
          <strong>Rate:</strong> $${data.hourlyRate}/hr<br>
          <strong>Workers Needed:</strong> ${data.workersNeeded}<br>
          <strong>Location:</strong> ${data.location}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Job', `${BASE_URL}/company-dashboard?job=${data.jobId}`, 'primary')}
      </div>
    `
  }),

  job_filled: (data) => ({
    subject: `All Positions Filled for ${data.jobTitle}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">🎉 Job Fully Staffed!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        All ${data.workersNeeded} positions have been filled for your job.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 8px; font-size: 16px; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Workers Hired:</strong> ${data.workersNeeded}<br>
          <strong>Start Date:</strong> ${data.startDate}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Team', `${BASE_URL}/company-dashboard?job=${data.jobId}`, 'primary')}
      </div>
    `
  }),

  job_reminder: (data) => ({
    subject: `Reminder: ${data.jobTitle} Still Has Open Positions`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Job Positions Still Open</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your job still has ${data.openPositions} unfilled position(s). Would you like to send another alert to workers?
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 8px; font-size: 16px; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Positions Filled:</strong> ${data.filledPositions} of ${data.totalPositions}<br>
          <strong>Applications:</strong> ${data.applicationCount}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Send Alert to Workers', `${BASE_URL}/company-dashboard?job=${data.jobId}&action=alert`, 'primary')}
      </div>
    `
  }),

  direct_request_sent: (data) => ({
    subject: `Direct Request Sent to ${data.workerName}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Request Sent!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your job request has been sent to ${data.workerName}. They have 24 hours to respond.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 8px; font-size: 16px; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Worker:</strong> ${data.workerName}<br>
          <strong>Expires:</strong> ${data.expiresAt}
        </p>
      `)}
      ${data.fallbackToPublic ? `
        <p style="margin: 16px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
          ℹ️ If not accepted, this job will be posted publicly after 24 hours.
        </p>
      ` : ''}
    `
  }),

  direct_request_expired: (data) => ({
    subject: `Job Request Expired - ${data.jobTitle} Now Public`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Request Expired</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.workerName} did not respond to your job request within 24 hours. 
        ${data.postedPublicly ? 'The job has been automatically posted publicly.' : ''}
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Job', `${BASE_URL}/company-dashboard?job=${data.jobId}`, 'primary')}
      </div>
    `
  }),

  welcome_worker: (data) => ({
    subject: `Welcome to Tolstoy Staffing, ${data.firstName}!`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Welcome to Tolstoy Staffing!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.firstName}, you're all set to start finding work! Companies in your area can now discover you based on your skills.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Your Rate:</strong> $${data.hourlyRate}/hr<br>
          <strong>Skills:</strong> ${data.skills}<br>
          <strong>Location:</strong> ${data.location}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Your Dashboard', `${BASE_URL}/dashboard`, 'success')}
      </div>
    `
  }),

  welcome_company: (data) => ({
    subject: `Welcome to Tolstoy Staffing, ${data.companyName}!`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Welcome to Tolstoy Staffing!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your company account is set up and ready to hire workers. Start posting jobs to find skilled contractors in your area.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Post Your First Job', `${BASE_URL}/post-job`, 'success')}
      </div>
    `
  }),

  team_member_joined: (data) => ({
    subject: `${data.memberName} Joined Your Team!`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">New Team Member!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.memberName} has accepted your invitation and joined your team.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Team Member:</strong> ${data.memberName}<br>
          <strong>Email:</strong> ${data.memberEmail}<br>
          <strong>Joined:</strong> ${data.joinedDate}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Team', `${BASE_URL}/company-dashboard?section=team`, 'primary')}
      </div>
    `
  }),

  team_invite_sent: (data) => ({
    subject: `You're Invited to Join ${data.companyName} on Tolstoy Staffing`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Team Invitation</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.inviterName} has invited you to join the <strong>${data.companyName}</strong> team on Tolstoy Staffing.
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        As a team member, you'll be able to help manage jobs, review worker applications, and handle timesheets for the company.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Company:</strong> ${data.companyName}<br>
          <strong>Invited By:</strong> ${data.inviterName}<br>
          <strong>Expires:</strong> ${data.expiresAt}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Accept Invitation', data.inviteLink || `${BASE_URL}/company/join/${data.inviteToken}`, 'success')}
      </div>
      <p style="margin: 24px 0 0; font-size: 12px; color: ${BRAND_COLORS.textMuted}; text-align: center;">
        This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
      </p>
    `
  }),

  worker_team_invite: (data) => ({
    subject: `You're Invited to Join ${data.ownerName}'s Team on Tolstoy Staffing`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Team Invitation</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.memberFirstName}, <strong>${data.ownerName}</strong> has invited you to join their team on Tolstoy Staffing as ${data.role === 'admin' ? 'an Admin' : 'an Employee'}.
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.role === 'admin' 
          ? 'As an Admin, you\'ll have full access to manage jobs, view team schedules, and handle business operations.'
          : 'As an Employee, you\'ll be able to view your assigned jobs, check your calendar, and track your work schedule.'}
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Business Operator:</strong> ${data.ownerName}<br>
          <strong>Your Role:</strong> ${data.role === 'admin' ? 'Admin' : 'Employee'}<br>
          <strong>Hourly Rate:</strong> $${data.hourlyRate}/hr<br>
          <strong>Skills:</strong> ${data.skills || 'Not yet specified'}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Accept Invitation & Create Account', `${BASE_URL}/team/join/${data.inviteToken}`, 'success')}
      </div>
      <p style="margin: 24px 0 0; font-size: 12px; color: ${BRAND_COLORS.textMuted}; text-align: center;">
        This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
      </p>
    `
  }),

  timesheet_edited: (data) => ({
    subject: `Your Timesheet Was ${data.action === 'edited' ? 'Edited' : 'Reported'}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${data.action === 'edited' ? BRAND_COLORS.warning : BRAND_COLORS.danger};">${data.action === 'edited' ? 'Timesheet Edited' : 'Timesheet Reported'}</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.action === 'edited' 
          ? `Your timesheet for "${data.jobTitle}" has been edited by ${data.companyName}.`
          : `Your timesheet for "${data.jobTitle}" has been reported by ${data.companyName}.`
        }
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Job:</strong> ${data.jobTitle}<br>
          <strong>Original Hours:</strong> ${data.originalHours}<br>
          <strong>Adjusted Hours:</strong> ${data.adjustedHours}<br>
          ${data.reason ? `<strong>Reason:</strong> ${data.reason}` : ''}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Details', `${BASE_URL}/dashboard?section=earnings&timesheet=${data.timesheetId}`, 'primary')}
      </div>
    `
  }),

  private_note: (data) => {
    const repAvatar = data.companyAvatarUrl
      ? `<img src="${data.companyAvatarUrl}" alt="" width="72" height="72" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 1px solid ${BRAND_COLORS.separatorLine};" />`
      : `<div style="width: 72px; height: 72px; border-radius: 50%; background: ${BRAND_COLORS.background}; text-align: center; line-height: 72px; font-size: 28px; font-weight: 600; color: ${BRAND_COLORS.text}; border: 1px solid ${BRAND_COLORS.separatorLine};">${(data.companyRepName || data.companyName || 'C').charAt(0).toUpperCase()}</div>`;
    const companyLogo = data.companyLogoUrl
      ? `<img src="${data.companyLogoUrl}" alt="" width="48" height="48" style="width: 48px; height: 48px; border-radius: 8px; object-fit: contain; border: 1px solid ${BRAND_COLORS.separatorLine};" />`
      : '';
    const repName = data.companyRepName || data.companyName || 'The company';
    const whoWrote = data.companyName || 'They';
    const reviewUrl = data.reviewUrl || `${BASE_URL}/dashboard/reviews`;
    return {
      subject: `Find out what ${whoWrote} wrote`,
      content: `
      <h2 style="margin: 0 0 20px; font-size: 22px; font-weight: 700; color: ${BRAND_COLORS.text};">Find out what ${whoWrote} wrote</h2>
      <div style="margin-bottom: 24px; padding: 20px; background: ${BRAND_COLORS.background}; border-radius: 12px; border: 1px solid ${BRAND_COLORS.separatorLine};">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
          <td style="width: 72px; vertical-align: top;">${repAvatar}</td>
          ${companyLogo ? `<td style="width: 48px; vertical-align: top; padding-left: 12px;">${companyLogo}</td>` : ''}
          <td style="padding-left: 16px; vertical-align: top;">
            <p style="margin: 0; font-size: 18px; font-weight: 600; color: ${BRAND_COLORS.text};">${repName}</p>
            <p style="margin: 4px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">${data.companyName} – "${data.jobTitle}"</p>
          </td>
        </tr></table>
      </div>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; font-size: 15px; line-height: 1.6;">
        You can read ${whoWrote}'s feedback and private note in the app.
      </p>
      <div style="text-align: center; margin-bottom: 28px;">
        ${getButton('View private note & review', reviewUrl, 'primary')}
      </div>
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid ${BRAND_COLORS.buttonGreen}; border-radius: 12px; padding: 24px 28px; margin: 0 0 24px;">
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND_COLORS.textMuted}; font-weight: 600;">Your performance ratings</p>
        <p style="margin: 0; font-size: 16px; font-weight: bold; color: ${BRAND_COLORS.buttonGreen};">
          Overall: ${data.overallRating?.toFixed(1) || 'N/A'} / 5.0
        </p>
        <p style="margin: 8px 0 0; font-size: 13px; color: ${BRAND_COLORS.textMuted};">
          Timeliness ${'★'.repeat(data.ratings?.timeliness || 0)}${'☆'.repeat(5 - (data.ratings?.timeliness || 0))} &middot;
          Effort ${'★'.repeat(data.ratings?.effort || 0)}${'☆'.repeat(5 - (data.ratings?.effort || 0))} &middot;
          Communication ${'★'.repeat(data.ratings?.communication || 0)}${'☆'.repeat(5 - (data.ratings?.communication || 0))} &middot;
          Value ${'★'.repeat(data.ratings?.value || 0)}${'☆'.repeat(5 - (data.ratings?.value || 0))}
        </p>
      </div>
      <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">
        Thank you for your hard work.
      </p>
    `
    };
  },

  /** When app is closed: ask worker to open app to clock in (sent with push during ping window). */
  geolocation_clock_in_reminder: (data) => ({
    subject: `Reminder: Please clock in for ${data.jobTitle}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Time to clock in</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.workerName || 'there'}, your shift for <strong>${data.jobTitle}</strong> is starting. Please open the app and clock in when you arrive at the job site.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Start time:</strong> ${data.startTime || 'See app'}<br>
          ${data.location ? `<strong>Location:</strong> ${data.location}` : ''}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Open app & clock in', `${BASE_URL}/dashboard?tab=calendar&job=${data.jobId}`, 'success')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">
        Keeping the app open helps us track your hours accurately. If you've left the job site, remember to clock out.
      </p>
    `
  }),

  /** When app is closed and no location pings: ask worker to open app to clock out. */
  geolocation_clock_out_reminder: (data) => ({
    subject: `Reminder: Please clock out from ${data.jobTitle}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">Clock out reminder</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.workerName || 'there'}, you're currently clocked in to <strong>${data.jobTitle}</strong> but we haven't received your location recently. If you've left the job site, please open the app and clock out now.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          We use your location to verify time on site. If you're still at work, keeping the app open helps ensure accurate hours.
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Open app & clock out', `${BASE_URL}/dashboard?tab=calendar&job=${data.jobId}`, 'warning')}
      </div>
    `
  }),

  /** After auto clock-out due to stale pings or left job site: inform worker. */
  geolocation_auto_clocked_out: (data) => ({
    subject: `You were auto clocked out from ${data.jobTitle}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Automatic clock-out</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.workerName || 'there'}, you were automatically clocked out from <strong>${data.jobTitle}</strong> at ${data.clockOutTime || 'the last recorded time'}.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          ${data.reason || 'We stopped receiving your location, so we clocked you out to keep your hours accurate.'}
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View timesheet', `${BASE_URL}/dashboard?tab=calendar&job=${data.jobId}`, 'primary')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">
        To avoid automatic clock-out, keep the app open or allow background location while on the job.
      </p>
    `
  }),

  job_start_reminder: (data) => {
    const showRate = data.showHourlyRate !== false;
    const timeType = data.timeType || (data.isRecurring ? 'Recurring' : 'One-time');
    const isAdminCopy = data.isAdminCopy === true;
    return {
      subject: data.subject || (isAdminCopy ? `Job reminder: "${data.jobTitle}" – ${data.workerName}` : `Reminder: Your job "${data.jobTitle}" starts ${data.within24hr ? 'within 24 hours' : 'soon'}!`),
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">${isAdminCopy ? 'Job starting soon' : 'Your job starts soon!'}</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${isAdminCopy ? `Job "${data.jobTitle}" is scheduled to start ${data.within24hr ? 'within 24 hours' : 'soon'}. Assigned worker: ${data.workerName}.` : `Hi ${data.workerName}, this is a reminder that your job starts ${data.within24hr ? 'within 24 hours' : 'soon'}. Please open the app and clock in when you arrive.`}
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${isAdminCopy ? getListRow('Assigned worker', data.workerName) : ''}
          ${getListRow('Company', data.companyName)}
          ${getListRow('Start date', data.startDate || 'See details')}
          ${getListRow('Start time', data.startTime)}
          ${getListRow('Time type', timeType)}
          ${getListRow('Location', data.location, !(showRate && data.hourlyRate != null))}
          ${showRate && data.hourlyRate != null ? getListRow('Hourly rate', `$${data.hourlyRate}/hr`, true) : ''}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton(isAdminCopy ? 'View job' : 'Open app & clock in', isAdminCopy ? `${BASE_URL}/company-dashboard?job=${data.jobId}` : `${BASE_URL}/dashboard?tab=calendar&job=${data.jobId}`, 'success')}
      </div>
      ${!isAdminCopy ? `<p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">Don't forget to clock in when you arrive at the job site!</p>` : ''}
    `
    };
  },

  payout_pending_bank_setup: (data) => ({
    subject: `Action Required: Add Bank Account to Receive Your $${data.amount} Payment`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">Payment Pending - Bank Account Required</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.workerName}, your timesheet for <strong>${data.jobTitle}</strong> has been approved and you're owed <strong>$${data.amount}</strong>!
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        However, we can't send your payment because you haven't set up a bank account yet. Your payment is being held securely and will be released automatically once you add your bank details.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">Payment Details</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Amount', `$${data.amount}`)}
          ${getListRow('Job', data.jobTitle)}
          ${getListRow('Status', 'Held – Pending bank account setup', true)}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Add Bank Account Now', `${data.dashboardLink}?tab=payments`, 'primary')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">
        Once you add your bank account, your payment will be sent automatically via ACH transfer.
      </p>
    `
  }),

  payout_pending_w9: (data) => {
    const documentsUrl = data.documentsUrl || `${BASE_URL}/dashboard/account-documents`;
    return {
      subject: `Action Required: Upload W-9 to Receive Your $${data.amount} Payment`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">Payment Pending - W-9 Required</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.workerName}, your timesheet for <strong>${data.jobTitle}</strong> has been approved and you're owed <strong>$${data.amount}</strong>!
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        However, we can't process your payment because you haven't uploaded your W-9 form yet. Your payment is being held securely and will be released automatically once you upload your W-9 in the worker menu <strong>Documents</strong> tab.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">Payment Details</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Amount', `$${data.amount}`)}
          ${getListRow('Job', data.jobTitle)}
          ${getListRow('Status', 'Held – Pending W-9 upload', true)}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Upload W-9 in Documents tab', documentsUrl, 'primary')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">
        Open your worker menu → Documents (Account & Documents). Once you upload your W-9 there, your payment will be processed automatically via ACH transfer.
      </p>
    `
    };
  },

  payout_sent: (data) => {
    const isInstant = data.isInstantPayout === true;
    const feeRow = isInstant && data.feeAmount != null
      ? getListRow('Instant payout fee (1% + $0.30)', `$${data.feeAmount}`, false)
      : '';
    const netIsLast = !isInstant || data.feeAmount == null;
    return {
      subject: isInstant
        ? `Instant Payout Sent – $${data.netAmount} (fee $${data.feeAmount})`
        : `Payout Sent – $${data.amount}`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">💰 Payout Sent</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your payment has been sent to your bank account.
        ${isInstant ? ' You chose instant payout; the fee has been deducted from your earnings.' : ''}
      </p>
      ${getCard(`
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Job', data.jobTitle)}
          ${isInstant ? getListRow('Gross amount', `$${data.amount}`) : ''}
          ${feeRow}
          ${getListRow(isInstant ? 'Net amount (to your account)' : 'Amount', `$${isInstant ? (data.netAmount || data.amount) : data.amount}`, netIsLast)}
        </table>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Earnings', `${BASE_URL}/dashboard?section=earnings`, 'success')}
      </div>
    `
    };
  },

  new_job_message: (data) => {
    const senderInitial = (data.senderName || 'U').charAt(0).toUpperCase();
    const senderAvatar = data.senderAvatarUrl
      ? `<img src="${data.senderAvatarUrl}" alt="" width="56" height="56" style="width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 1px solid ${BRAND_COLORS.separatorLine};" />`
      : `<div style="width: 56px; height: 56px; border-radius: 50%; background: ${BRAND_COLORS.background}; text-align: center; line-height: 56px; font-size: 20px; font-weight: 600; color: ${BRAND_COLORS.text}; border: 1px solid ${BRAND_COLORS.separatorLine};">${senderInitial}</div>`;
    return {
      subject: `New message from ${data.senderName} – ${data.jobTitle}`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">New message</h2>
      <div style="border: 1px solid ${BRAND_COLORS.separatorLine}; border-radius: 12px; overflow: hidden; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
        <div style="padding: 16px 20px; background: ${BRAND_COLORS.background}; border-bottom: 1px solid ${BRAND_COLORS.separatorLine};">
          <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND_COLORS.textMuted}; font-weight: 600;">Associated project</p>
          <p style="margin: 4px 0 0; font-size: 18px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</p>
        </div>
        <div style="padding: 20px; display: flex; align-items: center; gap: 16px;">
          <div style="flex-shrink: 0;">${senderAvatar}</div>
          <div>
            <p style="margin: 0; font-size: 18px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.senderName}</p>
            <p style="margin: 4px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">Sent you a message</p>
          </div>
        </div>
      </div>
      <div style="background: #f8fafc; border: 1px solid ${BRAND_COLORS.separatorLine}; border-radius: 12px; padding: 20px; margin: 0 0 24px;">
        <p style="margin: 0; color: ${BRAND_COLORS.text}; font-size: 15px; line-height: 1.7;">
          "${(data.messagePreview || '').substring(0, 300)}${(data.messagePreview || '').length >= 300 ? '...' : ''}"
        </p>
      </div>
      <div style="text-align: center;">
        ${getButton('View conversation', `${BASE_URL}/accepted-job/${data.jobId}`, 'primary')}
      </div>
    `
    };
  },

  call_invite: (data) => {
    const inviterName = data.inviterName || 'Someone';
    const jobTitle = data.jobTitle || 'Job';
    const roomUrl = data.roomUrl || '';
    return {
      subject: `${inviterName} invited you to a video call – ${jobTitle}`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">You're invited to a video call</h2>
      <p style="margin: 0 0 16px; font-size: 15px; color: ${BRAND_COLORS.text}; line-height: 1.6;">
        ${inviterName} has started a video call for <strong>${jobTitle}</strong>. Join the call using the link below.
      </p>
      <div style="text-align: center; margin: 24px 0;">
        ${roomUrl ? getButton('Join the call', roomUrl, 'primary') : ''}
      </div>
      ${roomUrl ? `<p style="margin: 12px 0 0; font-size: 13px; color: ${BRAND_COLORS.textMuted}; word-break: break-all;">${roomUrl}</p>` : ''}
      `
    };
  },

  close_project_review: (data) => {
    const jobTitle = data.jobTitle || 'Job';
    const reviewUrl = data.reviewUrl || '';
    return {
      subject: `Close out your project – ${jobTitle}`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Your labor budget has been reached</h2>
      <p style="margin: 0 0 16px; font-size: 15px; color: ${BRAND_COLORS.text}; line-height: 1.6;">
        The estimated labor budget for <strong>${jobTitle}</strong> has been met. You can now close out this project: add completion photos (optional), leave reviews for workers, add workers to your team, and mark the job complete.
      </p>
      <div style="text-align: center; margin: 24px 0;">
        ${reviewUrl ? getButton('Close out project', reviewUrl, 'primary') : ''}
      </div>
      ${reviewUrl ? `<p style="margin: 12px 0 0; font-size: 13px; color: ${BRAND_COLORS.textMuted}; word-break: break-all;">${reviewUrl}</p>` : ''}
      `
    };
  },

  chat_unread_digest: (data) => {
    const items = Array.isArray(data.items) ? data.items : [];
    const itemRows = items.slice(0, 10).map((item: { jobTitle: string; jobId: number; unreadCount: number; lastPreview?: string }) => `
      <tr>
        <td style="padding: 12px 0; ${items.indexOf(item) < items.length - 1 ? 'border-bottom: 1px solid ' + BRAND_COLORS.separatorLine + ';' : ''}">
          <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600; color: ${BRAND_COLORS.text};">${item.jobTitle || 'Job'}</p>
          <p style="margin: 0; font-size: 13px; color: ${BRAND_COLORS.textMuted};">
            ${item.unreadCount} unread message${item.unreadCount !== 1 ? 's' : ''}${item.lastPreview ? ` · "${(item.lastPreview || '').substring(0, 60)}${(item.lastPreview || '').length > 60 ? '...' : ''}"` : ''}
          </p>
          <a href="${BASE_URL}/chats/${item.jobId}" style="font-size: 13px; color: ${BRAND_COLORS.primary}; margin-top: 4px; display: inline-block;">View conversation →</a>
        </td>
      </tr>
    `).join('');
    return {
      subject: `You have unread messages – ${items.length} conversation${items.length !== 1 ? 's' : ''}`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Unread chat messages</h2>
      <p style="margin: 0 0 20px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You have unread messages in the following ${items.length === 1 ? 'conversation' : 'conversations'}:
      </p>
      <div style="border: 1px solid ${BRAND_COLORS.separatorLine}; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${itemRows}
        </table>
      </div>
      <div style="text-align: center;">
        ${getButton('View all chats', `${BASE_URL}/chats`, 'primary')}
      </div>
    `
    };
  },

  payment_reminder: (data) => ({
    subject: `Payment Reminder: ${data.openTimesheetCount} Unpaid Timesheet${data.openTimesheetCount > 1 ? 's' : ''} - ${data.workerName}`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Payment Reminder</h2>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You have ${data.openTimesheetCount} unpaid timesheet${data.openTimesheetCount > 1 ? 's' : ''} for work completed by <strong>${data.workerName}</strong>.
      </p>
      <div style="margin: 0 0 24px; padding: 18px 20px; background-color: #FEF3C7; border: 2px solid #F59E0B; border-radius: 10px; color: #92400E; font-size: 15px; line-height: 1.6;">
        <strong>⚠️ Important:</strong> If this invoice is not responded to within 24 hours, we will autodraw from your balance to pay the worker.
      </div>
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">Payment Summary</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Worker', data.workerName)}
          ${getListRow('Total Hours', `${data.totalHours.toFixed(1)} hrs`)}
          <tr>
            <td style="padding: 12px 0; font-size: 14px; font-weight: 600; color: ${BRAND_COLORS.text}; vertical-align: top;">Amount Due</td>
            <td style="padding: 12px 0; font-size: 18px; font-weight: 700; color: ${BRAND_COLORS.warning}; text-align: right; vertical-align: top;">$${(data.totalAmountCents / 100).toFixed(2)}</td>
          </tr>
        </table>
      `)}
      ${data.timesheetDetails ? `
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid ${BRAND_COLORS.separatorLine};">
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${BRAND_COLORS.text};">Timesheet Details</p>
          ${data.timesheetDetails.map((ts: { date: string; hours: string; amount: string; jobTitle: string }, i: number) => `
            <div style="padding: 12px 0; ${i < data.timesheetDetails.length - 1 ? `border-bottom: 1px solid ${BRAND_COLORS.separatorLine};` : ''}">
              <p style="margin: 0 0 4px; font-size: 14px; color: ${BRAND_COLORS.text}; font-weight: 500;">${ts.jobTitle}</p>
              <p style="margin: 0; font-size: 13px; color: ${BRAND_COLORS.textMuted};">${ts.date} &middot; ${ts.hours} hrs &middot; $${ts.amount}</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Review & Pay Now', `${BASE_URL}/company-dashboard?tab=timesheets`, 'warning')}
      </div>
      <p style="margin: 16px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 12px; text-align: center; line-height: 1.5;">
        Prompt payment helps maintain your company's reputation and ensures workers get paid on time.
      </p>
    `
  }),

  password_reset: (data) => ({
    subject: 'Reset Your Password',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Reset Your Password</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.firstName}, you requested to reset your password. Click the button below to create a new password.
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6; font-size: 14px;">
        This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Reset Password', data.resetUrl, 'primary')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 12px; text-align: center;">
        Or copy and paste this link into your browser: <br>
        <span style="word-break: break-all; color: ${BRAND_COLORS.text}; font-size: 11px;">${data.resetUrl}</span>
      </p>
    `
  }),

  otp_login: (data) => ({
    subject: 'Your Login Code',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Your Login Code</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.firstName}, use this code to sign in to your account:
      </p>
      ${getCard(`
        <p style="margin: 0; font-size: 36px; font-weight: 700; color: ${BRAND_COLORS.text}; text-align: center; letter-spacing: 8px; font-family: monospace;">
          ${data.otpCode}
        </p>
      `)}
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
        This code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.
      </p>
    `
  }),

  magic_link_login: (data) => ({
    subject: 'Sign In to Your Account',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Sign In to Your Account</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.firstName}, click the button below to sign in to your account. No password needed!
      </p>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6; font-size: 14px;">
        This link will expire in 15 minutes. If you didn't request this, you can safely ignore this email.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Sign In', data.magicLink, 'success')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 12px; text-align: center;">
        Or copy and paste this link into your browser: <br>
        <span style="word-break: break-all; color: ${BRAND_COLORS.text}; font-size: 11px;">${data.magicLink}</span>
      </p>
    `
  }),

  otp_and_magic_link_login: (data) => ({
    subject: 'Your login code – sign in to Tolstoy Staffing',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Sign in to your account</h2>
      <p style="margin: 0 0 20px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Hi ${data.firstName}, use the code below or click the button to sign in. No password needed.
      </p>
      ${getCard(`
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND_COLORS.textMuted}; font-weight: 600;">Your login code</p>
        <p style="margin: 0; font-size: 36px; font-weight: 700; color: ${BRAND_COLORS.text}; text-align: center; letter-spacing: 8px; font-family: monospace;">
          ${data.otpCode}
        </p>
      `)}
      <div style="text-align: center; margin-top: 28px;">
        ${getButton('Sign in to your account', data.magicLink, 'success')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 13px; text-align: center;">
        Code expires in 10 minutes; link expires in 15 minutes. If you didn't request this, you can ignore this email.
      </p>
    `
  }),

  ai_dispatch_applied: (data) => {
    const teammates = (data.teammatesAlsoAssigned || []) as { name: string }[];
    const multipleAssigned = teammates.length > 0;
    const namesList = ['You', ...teammates.map((t: { name: string }) => t.name)];
    const assignedLine = multipleAssigned
      ? `You and ${teammates.length} other teammate(s) were assigned to this job by AI Dispatch: ${namesList.join(', ')}.`
      : 'You were assigned to this job by AI Dispatch.';
    const assignedList = multipleAssigned
      ? `<div style="margin-top: 12px; padding: 12px 16px; background: ${BRAND_COLORS.background}; border-radius: 8px; border: 1px solid ${BRAND_COLORS.separatorLine};">
          <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: ${BRAND_COLORS.textMuted}; text-transform: uppercase;">Teammates assigned to this job</p>
          <ul style="margin: 0; padding-left: 20px; color: ${BRAND_COLORS.text}; font-size: 14px;">
            <li style="margin: 4px 0;">You</li>
            ${teammates.map((t: { name: string }) => `<li style="margin: 4px 0;">${t.name}</li>`).join('')}
          </ul>
        </div>`
      : '';
    return {
      subject: multipleAssigned
        ? `AI Dispatch assigned you and ${teammates.length} other(s) to "${data.jobTitle}"`
        : `AI Dispatch applied you to "${data.jobTitle}"`,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">🤖 AI Dispatch Applied</h2>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${assignedLine}
      </p>
      ${assignedList}
      ${getCard(`
        <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.text};">${data.jobTitle}</h3>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          ${getListRow('Location', data.location || 'See job details')}
          ${getListRow('Start', data.startDate || 'TBD', data.hourlyRate == null)}
          ${data.hourlyRate != null ? getListRow('Rate', `$${data.hourlyRate}/hr`, true) : ''}
        </table>
        <p style="margin: 12px 0 0; padding-top: 12px; border-top: 1px solid ${BRAND_COLORS.separatorLine}; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          The company will review your application and get back to you.
        </p>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Job', `${BASE_URL}/dashboard?job=${data.jobId}`, 'primary')}
      </div>
    `
    };
  },

  worker_onboarding_reminder: (data) => {
    const items = data.incompleteItems || [];
    const itemsList = items.length > 0
      ? items.map((item: { label: string; url: string }) =>
          `<li style="margin: 8px 0;"><a href="${item.url}" style="color: ${BRAND_COLORS.text}; text-decoration: underline;">${item.label}</a></li>`
        ).join('')
      : '<li style="margin: 8px 0;">Complete your profile to start getting matched with jobs.</li>';
    const reminderNum = data.reminderNumber || 1;
    const triggeredByTeamMember = data.triggeredByTeamMember === true;
    const subject = triggeredByTeamMember
      ? 'Your team needs you to complete your account setup – Tolstoy Staffing'
      : reminderNum === 1
      ? 'Finish your Tolstoy Staffing profile – you\'re almost there!'
      : reminderNum === 2
      ? 'Quick reminder: complete your profile to get job matches'
      : 'Last reminder: finish your profile to start working';
    const introParagraph = triggeredByTeamMember
      ? `One of your team members asked we remind you: please complete your account setup. Incomplete onboarding will halt future payments to your team. Finish the steps below so you can keep getting paid and your team can keep working.`
      : `You started setting up your worker account on Tolstoy Staffing. Finish the steps below so companies can find and hire you.`;
    return {
      subject,
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Hi ${data.firstName || 'there'},</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${introParagraph}
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 12px; font-size: 16px; color: ${BRAND_COLORS.text};">Remaining steps:</h3>
        <ul style="margin: 0; padding-left: 20px; color: ${BRAND_COLORS.textMuted}; font-size: 14px; line-height: 1.6;">
          ${itemsList}
        </ul>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Resume where I left off', data.resumeUrl || `${BASE_URL}/worker-onboarding`, 'primary')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
        If you have questions, reply to this email or contact support.
      </p>
    `
    };
  },

  company_onboarding_reminder: (data) => {
    const items = data.incompleteItems || [];
    const itemsList = items.length > 0
      ? items.map((item: { label: string; url: string }) =>
          `<li style="margin: 8px 0;"><a href="${item.url}" style="color: ${BRAND_COLORS.text}; text-decoration: underline;">${item.label}</a></li>`
        ).join('')
      : '<li style="margin: 8px 0;">Complete your company profile to start hiring workers.</li>';
    return {
      subject: 'Finish your company profile – start hiring on Tolstoy Staffing',
      content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Hi ${data.firstName || 'there'},</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You started setting up your company on Tolstoy Staffing. Complete the steps below to start posting jobs and hiring vetted workers.
      </p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.warning}; font-size: 14px; line-height: 1.6;">
        <strong>Important:</strong> Incomplete onboarding will halt future payments to your workers. Finish setup to keep payouts running.
      </p>
      ${getCard(`
        <h3 style="margin: 0 0 12px; font-size: 16px; color: ${BRAND_COLORS.text};">Remaining steps:</h3>
        <ul style="margin: 0; padding-left: 20px; color: ${BRAND_COLORS.textMuted}; font-size: 14px; line-height: 1.6;">
          ${itemsList}
        </ul>
      `)}
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Resume where I left off', data.resumeUrl || `${BASE_URL}/company-onboarding`, 'primary')}
      </div>
      <p style="margin: 24px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
        If you have questions, reply to this email or contact support.
      </p>
    `
    };
  },

  affiliate_referred_lead_signed_up: (data) => ({
    subject: `Your referral just created an account – ${data.referredName || 'New signup'}!`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">🎉 Referral Signed Up!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Great news! Someone you referred has created an account on Tolstoy Staffing.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Name:</strong> ${data.referredName || 'New user'}<br>
          <strong>Account type:</strong> ${data.referredRole === 'company' ? 'Company' : 'Worker'}<br>
          <strong>Date:</strong> ${data.signedUpAt || new Date().toLocaleDateString('en-US')}
        </p>
      `)}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        When they hire or get hired, you'll earn a commission. Keep sharing your link to grow your earnings!
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Your Dashboard', data.dashboardUrl || `${BASE_URL}/affiliate-dashboard`, 'primary')}
      </div>
    `
  }),

  affiliate_payment_sent: (data) => ({
    subject: `Payment sent: $${(data.amountCents / 100).toFixed(2)} – Commission on its way`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">💰 Commission Payment Sent</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Your affiliate commission has been sent to your linked bank account.
      </p>
      ${getCard(`
        <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${BRAND_COLORS.success}; text-align: center;">
          $${(data.amountCents / 100).toFixed(2)}
        </p>
        <p style="margin: 8px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
          ${data.description || 'Affiliate commission'}
        </p>
      `)}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Funds typically arrive within 1–3 business days. Thank you for referring great talent and companies!
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Payment History', data.dashboardUrl || `${BASE_URL}/affiliate-dashboard`, 'primary')}
      </div>
    `
  }),

  affiliate_setup_bank_w9: (data) => ({
    subject: 'Action required: Set up payout to receive your commissions',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.warning};">⚡ Payout Setup Required</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You have pending commissions waiting for you, but we need a few details before we can send your payments.
      </p>
      ${getCard(`
        <p style="margin: 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px;">
          <strong>Pending amount:</strong> $${((data.pendingCents || 0) / 100).toFixed(2)}<br>
          <strong>What's needed:</strong><br>
          ${data.needsBank ? '• Add your bank account (routing + account number)<br>' : ''}
          ${data.needsW9 ? '• Upload your W-9 for tax purposes' : ''}
        </p>
      `)}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Once you complete setup, your commissions will be sent automatically to your bank account.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Complete Payout Setup', data.setupUrl || `${BASE_URL}/affiliate-dashboard`, 'success')}
      </div>
    `
  }),

  affiliate_share_link_reminder: (data) => ({
    subject: 'Share your link – Earn more with every referral',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.text};">Hi ${data.firstName || 'there'},</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Every worker and company you refer earns you 20% of the platform fee when they get hired or hire. The more you share, the more you earn!
      </p>
      ${getCard(`
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND_COLORS.textMuted}; font-weight: 600;">Your referral link</p>
        <p style="margin: 0; font-size: 14px; word-break: break-all; color: ${BRAND_COLORS.text};">
          <a href="${data.referralLink || BASE_URL}" style="color: ${BRAND_COLORS.buttonGreen}; text-decoration: underline;">${data.referralLink || BASE_URL}</a>
        </p>
        <p style="margin: 12px 0 0; font-size: 12px; color: ${BRAND_COLORS.textMuted};">
          Share this link with workers and companies. Add <code style="background: ${BRAND_COLORS.background}; padding: 2px 6px; border-radius: 4px;">?ref=${data.code || 'your-code'}</code> for tracking.
        </p>
      `)}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        Share on social media, in your network, or via email. Your referral window is 1 year – you earn when they hire or get hired within that time.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Go to Dashboard', data.dashboardUrl || `${BASE_URL}/affiliate-dashboard`, 'primary')}
      </div>
    `
  }),

  affiliate_welcome: (data) => ({
    subject: 'Welcome to Tolstoy Staffing Affiliate Program',
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">Welcome, ${data.firstName || 'there'}!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        You're now part of the Tolstoy Staffing affiliate program. Share your referral link with workers and companies – you'll earn 20% of the platform fee when they hire or get hired.
      </p>
      ${getCard(`
        <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND_COLORS.textMuted}; font-weight: 600;">Your referral link</p>
        <p style="margin: 0; font-size: 14px; word-break: break-all; color: ${BRAND_COLORS.text};">
          <a href="${data.referralLink || BASE_URL}" style="color: ${BRAND_COLORS.buttonGreen}; text-decoration: underline;">${data.referralLink || BASE_URL}</a>
        </p>
      `)}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        To receive payments, add your bank account and upload a W-9 in your dashboard. Commissions are paid when referred users have approved timesheets.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('Get Started', data.dashboardUrl || `${BASE_URL}/affiliate-dashboard`, 'success')}
      </div>
    `
  }),

  affiliate_commission_available: (data) => ({
    subject: `You've earned $${((data.amountCents || 0) / 100).toFixed(2)} – Commission ready`,
    content: `
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${BRAND_COLORS.success};">🎉 New Commission Earned!</h2>
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        A referred worker or company just had a timesheet approved. You've earned a commission!
      </p>
      ${getCard(`
        <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${BRAND_COLORS.success}; text-align: center;">
          $${((data.amountCents || 0) / 100).toFixed(2)}
        </p>
        <p style="margin: 8px 0 0; color: ${BRAND_COLORS.textMuted}; font-size: 14px; text-align: center;">
          ${data.description || 'Commission from referral activity'}
        </p>
      `)}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.textMuted}; line-height: 1.6;">
        ${data.hasPayoutSetup ? 'Your payment will be sent to your linked bank account soon.' : 'Add your bank account and W-9 in your dashboard to receive this payment.'}
      </p>
      <div style="text-align: center; margin-top: 24px;">
        ${getButton('View Dashboard', data.dashboardUrl || `${BASE_URL}/affiliate-dashboard`, 'primary')}
      </div>
    `
  }),
};

/** All Resend email types (for sample/test sending). */
export const ALL_EMAIL_TYPES: EmailType[] = Object.keys(emailTemplates) as EmailType[];

const BASE_URL_SAMPLE = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';

/** Sample data for each email type (for dev sample sends). */
export function getSampleDataForType(type: EmailType): Record<string, any> {
  const common = {
    jobTitle: 'Sample Job – Electrical Install',
    jobId: 1,
    companyName: 'Sample Company LLC',
    workerName: 'Sample Worker',
    location: '123 Main St, Austin, TX',
    hourlyRate: 28,
    startDate: 'Jan 15, 2026',
    trade: 'Electrical',
    amount: '450.00',
    hours: '16',
    firstName: 'Sample',
  };
  switch (type) {
    case 'new_job_nearby': {
      const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
      const sampleMapUrl = `${baseUrl}/api/map-thumbnail?sample=1`;
      return {
        ...common,
        seekerName: 'Sample Company LLC',
        posterBusinessName: 'Sample Company LLC',
        posterContactName: 'A. L.',
        posterReputation: 'Verified business',
        jobsPostedCount: 12,
        memberSince: 'Member since Jan 2024',
        companyLogoUrl: '',
        distance: 2,
        city: 'Middletown',
        state: 'OH',
        partialAddress: 'Gage St, Cincinnati, OH 45219',
        dates: 'Feb 1, 2026',
        startDateRelative: 'in 3 days',
        scheduledTime: '8:00 AM – 4:00 PM',
        timeType: 'one_time',
        description: 'Install electrical panels and wiring in new commercial build. Must have 2+ years experience.',
        skillsCategory: 'Electrical Elite',
        requiredSkills: ['Electrical', 'Commercial'],
        hourlyRate: 2800,
        estimatedHours: 8,
        mapImageUrl: sampleMapUrl,
        suggestedTeammates: [
          { name: 'Alex Rivera', availability: 'Available', distanceMi: 12 },
          { name: 'Jamie Chen', availability: 'Available', distanceMi: 18 },
        ],
        suggestedTeammateIds: [1, 2],
        showAiDispatchPrompt: true,
        galleryImages: [
          'https://placehold.co/200x200/e5e7eb/6b7280?text=Job+Photo+1',
          'https://placehold.co/200x200/e5e7eb/6b7280?text=Job+Photo+2',
          'https://placehold.co/200x200/e5e7eb/6b7280?text=Job+Photo+3',
        ],
        testMode: true,
      };
    }
    case 'new_job_posted_admin':
      return {
        ...common,
        jobTitle: 'Electrical Install',
        fullAddress: '123 Gage St, Cincinnati, OH 45219',
        partialAddress: 'Gage St, Cincinnati, Monroe, OH',
        mapImageUrl: '',
        galleryImages: [],
        description: 'Install electrical panels and wiring in new build.',
        skillsCategory: 'Commercial',
        dates: 'Feb 1, 2026',
        scheduledTime: '8:00 AM – 4:00 PM',
        timeType: 'One-time',
        estimatedHours: 8,
        workersWillSeeCount: 24,
        recommendedWorkers: [{ name: 'Alex Rivera', skills: 'Electrical, HVAC', workerId: 1 }],
        aiDispatchOn: false,
        hasWorkers: true,
      };
    case 'job_offer_received':
      return { ...common, offerId: 1 };
    case 'application_accepted':
    case 'application_rejected':
      return { ...common, rejectionReason: type === 'application_rejected' ? 'Went with another candidate.' : undefined };
    case 'timesheet_approved':
      return { ...common, amount: '448.00' };
    case 'timesheet_rejected':
      return { ...common, reason: 'Hours do not match records.', timesheetId: 1 };
    case 'timesheet_edited':
      return { ...common, action: 'edited', originalHours: '8', adjustedHours: '6', reason: 'Correction', timesheetId: 1 };
    case 'payment_received':
      return { ...common, amount: '448.00' };
    case 'strike_warning':
      return { strikeCount: 1, reason: 'Timesheet reported', date: new Date().toLocaleDateString() };
    case 'account_terminated':
      return { reason: 'Received 3 strikes' };
    case 'worker_inquiry':
      return { ...common, workers: [{ name: 'Sample Worker', rate: 28, rating: '4.8', completedJobs: 12, workerId: 1 }] };
    case 'worker_accepted_job':
      return { ...common, workerPhone: '555-123-4567' };
    case 'worker_clocked_in':
      return { ...common, clockInTime: '8:00 AM' };
    case 'worker_clocked_out':
      return { ...common, hours: '8', totalCost: '224.00', timesheetId: 1 };
    case 'balance_low':
      return { balance: '150.00' };
    case 'balance_recharged':
      return { amount: '2000.00', newBalance: '2150.00', cardLast4: '4242' };
    case 'job_posted':
      return { ...common, workersNeeded: 2 };
    case 'job_filled':
      return { ...common, workersNeeded: 2 };
    case 'job_reminder':
      return { ...common, openPositions: 1, filledPositions: 1, totalPositions: 2, applicationCount: 3 };
    case 'direct_request_sent':
      return { ...common, workerName: 'Sample Worker', expiresAt: '24 hours', fallbackToPublic: true };
    case 'direct_request_expired':
      return { ...common, workerName: 'Sample Worker', postedPublicly: true };
    case 'team_member_joined':
      return { memberName: 'Jane Doe', memberEmail: 'jane@example.com', joinedDate: new Date().toLocaleDateString() };
    case 'team_invite_sent':
      return { companyName: 'Sample Company LLC', inviterName: 'John Smith', expiresAt: '7 days', inviteLink: `${BASE_URL_SAMPLE}/company/join/sample-token`, inviteToken: 'sample-token' };
    case 'worker_team_invite':
      return { memberFirstName: 'Sample', ownerName: 'John Smith', role: 'admin', hourlyRate: 28, skills: 'Electrical, HVAC', inviteToken: 'sample-token' };
    case 'welcome_worker':
      return { ...common, skills: 'Electrical, Plumbing', location: 'Austin, TX' };
    case 'welcome_company':
      return { companyName: 'Sample Company LLC' };
    case 'private_note':
      return { ...common, note: 'Great work on the install. We’d like to hire you again.', ratings: { timeliness: 5, effort: 5, communication: 5, value: 5 }, overallRating: 5 };
    case 'job_start_reminder':
      return { ...common, workerName: 'Sample Worker', startTime: '8:00 AM' };
    case 'payout_pending_bank_setup':
      return { ...common, workerName: 'Sample Worker', dashboardLink: BASE_URL_SAMPLE };
    case 'payout_pending_w9':
      return { ...common, workerName: 'Sample Worker', documentsUrl: `${BASE_URL_SAMPLE}/dashboard/account-documents` };
    case 'payout_sent':
      return { ...common, amount: '450.00', netAmount: '445.20', feeAmount: '4.80', isInstantPayout: true };
    case 'new_job_message':
      return { ...common, senderName: 'Sample Company', messagePreview: 'Can you start at 7am instead?' };
    case 'call_invite':
      return { ...common, inviterName: 'Sample User', roomUrl: 'https://peercalls.example.com/job-123' };
    case 'close_project_review': {
      const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
      return { ...common, reviewUrl: `${baseUrl}/company-dashboard?completeJob=1&jobTitle=${encodeURIComponent(common.jobTitle)}` };
    }
    case 'geolocation_clock_in_reminder':
      return { ...common, workerName: 'Sample Worker', startTime: '8:00 AM', location: '123 Main St, Austin TX' };
    case 'geolocation_clock_out_reminder':
      return { ...common, workerName: 'Sample Worker' };
    case 'geolocation_auto_clocked_out':
      return { ...common, workerName: 'Sample Worker', clockOutTime: '5:00 PM', reason: 'We stopped receiving your location.' };
    case 'chat_unread_digest':
      return { items: [{ jobTitle: common.jobTitle, jobId: 1, unreadCount: 3, lastPreview: 'Can you start earlier?' }] };
    case 'payment_reminder':
      return { workerName: 'Sample Worker', openTimesheetCount: 2, totalHours: 16, totalAmountCents: 44800, timesheetDetails: [{ date: 'Jan 10', hours: '8', amount: '224.00', jobTitle: common.jobTitle }] };
    case 'password_reset':
      return { firstName: 'Sample', resetUrl: `${BASE_URL_SAMPLE}/reset-password?token=sample` };
    case 'otp_login':
      return { firstName: 'Sample', otpCode: '847291' };
    case 'magic_link_login':
      return { firstName: 'Sample', magicLink: `${BASE_URL_SAMPLE}/auth/magic?token=sample` };
    case 'otp_and_magic_link_login':
      return { firstName: 'Sample', otpCode: '847291', magicLink: `${BASE_URL_SAMPLE}/auth/magic?token=sample` };
    case 'ai_dispatch_applied':
      return { ...common };
    case 'worker_onboarding_reminder':
      return { firstName: 'Sample', reminderNumber: 1, resumeUrl: `${BASE_URL_SAMPLE}/worker-onboarding?step=2`, incompleteItems: [{ label: 'Add your address', url: `${BASE_URL_SAMPLE}/worker-onboarding?step=2` }] };
    case 'company_onboarding_reminder':
      return { firstName: 'Sample', resumeUrl: `${BASE_URL_SAMPLE}/company-onboarding?step=1`, incompleteItems: [{ label: 'Add company details', url: `${BASE_URL_SAMPLE}/company-onboarding?step=1` }] };
    case 'affiliate_referred_lead_signed_up':
      return { firstName: 'Jane', referredName: 'Acme Construction LLC', referredRole: 'company', signedUpAt: new Date().toLocaleDateString('en-US'), dashboardUrl: `${BASE_URL_SAMPLE}/affiliate-dashboard` };
    case 'affiliate_payment_sent':
      return { firstName: 'Jane', amountCents: 2080, description: 'Commission from timesheet #123', dashboardUrl: `${BASE_URL_SAMPLE}/affiliate-dashboard` };
    case 'affiliate_setup_bank_w9':
      return { firstName: 'Jane', pendingCents: 4560, needsBank: true, needsW9: true, setupUrl: `${BASE_URL_SAMPLE}/affiliate-dashboard` };
    case 'affiliate_share_link_reminder':
      return { firstName: 'Jane', referralLink: `${BASE_URL_SAMPLE}/company-onboarding?ref=jane-doe`, code: 'jane-doe', dashboardUrl: `${BASE_URL_SAMPLE}/affiliate-dashboard` };
    case 'affiliate_welcome':
      return { firstName: 'Jane', referralLink: `${BASE_URL_SAMPLE}/company-onboarding?ref=jane-doe`, dashboardUrl: `${BASE_URL_SAMPLE}/affiliate-dashboard` };
    case 'affiliate_commission_available':
      return { firstName: 'Jane', amountCents: 2080, description: 'Commission from timesheet #123', hasPayoutSetup: false, dashboardUrl: `${BASE_URL_SAMPLE}/affiliate-dashboard` };
    default:
      return common;
  }
}

export async function sendEmail(emailData: EmailData): Promise<{ success: boolean; error?: string }> {
  try {
    const template = emailTemplates[emailData.type];
    if (!template) {
      return { success: false, error: `Unknown email type: ${emailData.type}` };
    }

    const { subject, content } = template(emailData.data);
    const templateOptions = emailData.data?.testMode ? { linkSuffix: 'test=1' } : undefined;
    const html = getEmailTemplate(content, subject, templateOptions);

    // Check if Resend is configured
    if (!resend) {
      console.error('Resend is not configured. RESEND_API_KEY is missing.');
      return { success: false, error: 'Email service is not configured. Please contact support.' };
    }

    // Development email override: redirect all emails to test email (set DISABLE_DEV_EMAIL_OVERRIDE=1 to send to actual recipient, e.g. for Resend sample to account email)
    const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV || process.env.NODE_ENV === 'dev';
    const originalTo = emailData.to;
    const overrideDisabled = process.env.DISABLE_DEV_EMAIL_OVERRIDE === '1' || process.env.DISABLE_DEV_EMAIL_OVERRIDE === 'true';
    const finalTo = isDevelopment && !overrideDisabled ? 'cairlbrandon@gmail.com' : emailData.to;

    if (isDevelopment && !overrideDisabled && originalTo !== finalTo) {
      console.log(`[DEV EMAIL OVERRIDE] Redirecting email from "${originalTo}" to "${finalTo}"`);
      console.log(`[DEV EMAIL OVERRIDE] Email type: ${emailData.type}, Subject: ${subject}`);
    }

    const fromAddress = RESEND_FROM_DEFAULT;
    const payload: Parameters<typeof resend.emails.send>[0] = {
      from: fromAddress,
      to: finalTo,
      subject: isDevelopment && originalTo !== finalTo ? `[DEV] ${subject} (Original: ${originalTo})` : subject,
      html,
    };
    if (emailData.attachments && emailData.attachments.length > 0) {
      payload.attachments = emailData.attachments;
    }
    const { error } = await resend.emails.send(payload);

    if (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Email service error:', error);
    return { success: false, error: error.message };
  }
}

const BULK_EMAIL_BATCH_SIZE = 10;
const BULK_EMAIL_DELAY_MS = 200;

export async function sendBulkEmails(emails: EmailData[]): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < emails.length; i += BULK_EMAIL_BATCH_SIZE) {
    const batch = emails.slice(i, i + BULK_EMAIL_BATCH_SIZE);
    const results = await Promise.all(batch.map((email) => sendEmail(email)));
    for (const result of results) {
      if (result.success) sent++;
      else failed++;
    }
    if (i + BULK_EMAIL_BATCH_SIZE < emails.length) {
      await new Promise((r) => setTimeout(r, BULK_EMAIL_DELAY_MS));
    }
  }

  return { sent, failed };
}
