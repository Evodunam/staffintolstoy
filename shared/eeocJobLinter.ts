/**
 * EEOC-compliance linter for job posting text. Flags language that suggests
 * preference for / against members of protected classes (Title VII, ADEA,
 * ADA, PDA). NOT a substitute for legal review — but it catches obvious
 * red-flag phrases before they go live.
 *
 * Used at job posting time and on the post-job wizard step 1 as the user
 * types so they can fix wording before submit.
 *
 * Categories tracked:
 *   - age (ADEA: 40+ protected; "young", "energetic", "recent grad", "digital native")
 *   - gender (Title VII; "salesman", "waitress", "manpower", "he/his")
 *   - race / national origin ("native English speaker" — citizenship/origin proxy)
 *   - religion ("Christian environment", "must observe X")
 *   - disability ("able-bodied", "must be physically fit" without job-relevant rationale)
 *   - pregnancy ("no pregnant women", "must not be pregnant")
 *   - marital/family ("single", "no kids", "must be available 24/7" can imply caregiver bias)
 *   - veteran (positive preferences are protected and OK; negatives are not)
 */

export type EeocFindingCategory =
  | "age"
  | "gender"
  | "race_or_origin"
  | "religion"
  | "disability"
  | "pregnancy"
  | "family"
  | "other";

export interface EeocFinding {
  category: EeocFindingCategory;
  /** The exact substring that triggered the finding. */
  match: string;
  /** Plain-English explanation of why this might be problematic. */
  reason: string;
  /** Severity: "block" should hard-stop posting; "warn" is advisory. */
  severity: "block" | "warn";
  /** Optional rewrite suggestion. */
  suggestion?: string;
}

interface Pattern {
  re: RegExp;
  category: EeocFindingCategory;
  reason: string;
  severity: "block" | "warn";
  suggestion?: string;
}

const PATTERNS: Pattern[] = [
  // === Age (ADEA) ===
  { re: /\b(young|youthful)\b(?!\s+(?:professional|adult)\s+only is satirical)/i, category: "age", severity: "warn",
    reason: 'Age-based language ("young") implies preference against workers 40+ (ADEA-protected).',
    suggestion: 'Remove the age word. Describe the work or required skills instead.' },
  { re: /\benergetic\b/i, category: "age", severity: "warn",
    reason: '"Energetic" is widely flagged as age-coded. EEOC has cited it in age-discrimination cases.',
    suggestion: 'Try "motivated", "self-starter", or describe specific physical demands of the job.' },
  { re: /\b(recent\s+(?:college\s+)?grad(?:uate)?s?|new\s+grads?|digital\s+native)\b/i, category: "age", severity: "block",
    reason: 'Targeting "recent graduates" or "digital natives" is treated as age discrimination by the EEOC.',
    suggestion: 'Specify required experience years instead, e.g. "0–3 years experience".' },
  { re: /\b(?:max(?:imum)?\s+age|under\s+(?:25|30|35|40)|no\s+older\s+than)\b/i, category: "age", severity: "block",
    reason: 'Hard age caps violate ADEA (40+ protected).',
    suggestion: 'Remove the age limit entirely.' },
  { re: /\b(rockstar|ninja|guru)\b/i, category: "age", severity: "warn",
    reason: '"Rockstar/ninja/guru" trends younger and is widely flagged in EEOC training as age-coded.',
    suggestion: 'Use the actual job title.' },

  // === Gender (Title VII) ===
  { re: /\b(salesman|waitress|waiter|stewardess|busboy|manpower|workman(?:ship)?|chairman|fireman|policeman|repairman|handyman|foreman)\b/i,
    category: "gender", severity: "warn",
    reason: "Gendered job title. Use neutral form to avoid Title VII gender-preference inference.",
    suggestion: "Use neutral terms: salesperson, server, flight attendant, helper, workforce, craftsmanship, chair, firefighter, police officer, repair worker, handyperson, supervisor." },
  { re: /\b(male|female)\s+only\b/i, category: "gender", severity: "block",
    reason: "Sex-restricted hiring (Title VII). Allowed only for the rare BFOQ — almost never applies.",
    suggestion: "Remove the gender restriction. Describe the work, not the worker." },
  { re: /\b(?:she|he|his|her)\s+(?:will|should|must|can|is\s+expected)/i, category: "gender", severity: "warn",
    reason: "Gendered pronouns suggest sex preference. Use 'they' or restructure.",
    suggestion: 'Use "they/them" or "the worker".' },

  // === Race / national origin ===
  { re: /\bnative\s+(?:english|spanish|french)\s+speaker\b/i, category: "race_or_origin", severity: "block",
    reason: '"Native English speaker" is a national-origin proxy and presumptively unlawful (Title VII).',
    suggestion: 'Specify proficiency: "fluent in English" or "professional working proficiency".' },
  { re: /\bU\.?S\.?\s+citizens?\s+only\b/i, category: "race_or_origin", severity: "block",
    reason: "Citizenship-only requirements typically violate IRCA national-origin protections (rare federal-contract exceptions).",
    suggestion: 'Use "must be authorized to work in the U.S." instead.' },

  // === Religion ===
  { re: /\b(?:christian|muslim|jewish|hindu|catholic)\s+(?:environment|workplace|values|preferred)/i, category: "religion", severity: "block",
    reason: "Religious preference in hiring violates Title VII (narrow exceptions for actual religious organizations).",
    suggestion: "Remove religious requirement unless your org qualifies under the religious-employer exemption." },

  // === Disability ===
  { re: /\b(able-?bodied|fully\s+able|no\s+disabilities|physically\s+(?:perfect|fit))\b/i, category: "disability", severity: "warn",
    reason: 'Phrases like "able-bodied" can deter disabled applicants and violate ADA. Describe job-essential physical demands instead.',
    suggestion: 'Replace with the specific physical requirement: "must lift 50 lbs repeatedly" or "must climb ladders to 20 ft".' },

  // === Pregnancy / family / marital ===
  { re: /\b(?:no\s+pregnan|not\s+pregnant|cannot\s+be\s+pregnant)/i, category: "pregnancy", severity: "block",
    reason: "Pregnancy discrimination violates the Pregnancy Discrimination Act + Title VII.",
    suggestion: "Remove. State actual job-essential requirements only." },
  { re: /\b(?:single|childless|no\s+kids|unmarried)\s+(?:only|preferred)\b/i, category: "family", severity: "block",
    reason: "Marital/family-status preferences violate Title VII (and many state laws).",
    suggestion: "Remove. If 24/7 availability is essential, describe that requirement plainly." },

  // === Misc ===
  { re: /\battractive\s+(?:applicants?|candidates?|workers?)\b/i, category: "other", severity: "warn",
    reason: "Appearance-based language can imply sex/race preference and may violate state laws (e.g. MI, DC ban appearance-based hiring).",
    suggestion: "Drop the requirement or describe a job-essential criterion (e.g. uniform standard)." },
];

export function lintJobText(text: string): EeocFinding[] {
  if (!text) return [];
  const findings: EeocFinding[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    const m = text.match(p.re);
    if (m) {
      findings.push({
        category: p.category,
        match: m[0],
        reason: p.reason,
        severity: p.severity,
        suggestion: p.suggestion,
      });
    }
  }
  // Dedup identical (category, match) pairs
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.category}|${f.match.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasBlockingFindings(findings: EeocFinding[]): boolean {
  return findings.some((f) => f.severity === "block");
}
