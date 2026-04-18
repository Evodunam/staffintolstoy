/**
 * Salary-history-ban tracker.
 *
 * 21+ US states/cities prohibit asking job applicants about prior pay
 * (e.g. CA Labor Code §432.3, NY Labor Law §194-a, MA Equal Pay Act).
 *
 * **Platform policy**: Tolstoy Staffing NEVER collects, stores, or asks for
 * prior salary, wage, or pay-history information from workers. This is the
 * conservative single-policy approach — easier to defend and consistent across
 * jurisdictions than maintaining per-state form variants.
 *
 * Anyone tempted to add a "Previous hourly rate" field, an "Expected rate
 * based on past jobs" prompt, or import salary history from a resume parser
 * MUST stop and consult legal first. The list below exists so a code review
 * can grep for these jurisdictions and confirm the no-collection rule still
 * holds.
 */

export const SALARY_HISTORY_BAN_JURISDICTIONS: readonly string[] = [
  "AL", // Alabama (statewide)
  "CA", // California (Labor Code §432.3)
  "CO", // Colorado
  "CT", // Connecticut
  "DC", // District of Columbia
  "DE", // Delaware
  "HI", // Hawaii
  "IL", // Illinois
  "ME", // Maine
  "MA", // Massachusetts (Equal Pay Act)
  "MD", // Maryland
  "MI", // Michigan (state employees)
  "NJ", // New Jersey
  "NV", // Nevada
  "NY", // New York
  "NC", // North Carolina (state agencies)
  "OH", // Cincinnati, Toledo, Columbus
  "OR", // Oregon
  "PA", // Philadelphia
  "PR", // Puerto Rico
  "RI", // Rhode Island
  "SC", // Columbia
  "VT", // Vermont
  "VA", // Virginia (state agencies)
  "WA", // Washington
];

/**
 * Always returns false. Provided so other code can express the intent
 * "should we ever ask about prior pay?" — answer is hardcoded NO regardless of
 * jurisdiction. If you find yourself wanting to flip this, see the file-level
 * comment first.
 */
export function maySolicitSalaryHistory(_state?: string | null): false {
  return false;
}
