import { useMemo } from "react";
import { lintJobText, type EeocFinding } from "@shared/eeocJobLinter";
import { AlertTriangle, AlertCircle } from "lucide-react";

/**
 * Inline real-time EEOC linter UI for the job-description editor.
 * Surfaces both blocking violations (server will hard-stop submission) and
 * advisory warnings so the user can fix wording before submit.
 */
export function EeocFeedback({ text }: { text: string }) {
  const findings = useMemo<EeocFinding[]>(() => lintJobText(text), [text]);
  if (findings.length === 0) return null;

  const blockers = findings.filter((f) => f.severity === "block");
  const warnings = findings.filter((f) => f.severity === "warn");

  return (
    <div className="mt-3 space-y-2">
      {blockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-destructive">
                {blockers.length === 1 ? "Equal-employment violation detected" : `${blockers.length} equal-employment violations detected`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                These will block posting. Edit the description to remove discriminatory language.
              </p>
              <ul className="mt-2 space-y-1.5">
                {blockers.map((f, i) => (
                  <li key={`${f.category}-${i}`} className="text-xs">
                    <span className="font-mono bg-destructive/10 px-1 rounded">"{f.match}"</span>{" "}
                    — {f.reason}
                    {f.suggestion && <span className="text-muted-foreground italic"> Try: {f.suggestion}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {warnings.length === 1 ? "Heads up" : `${warnings.length} suggestions`}
              </p>
              <ul className="mt-1 space-y-1">
                {warnings.map((f, i) => (
                  <li key={`${f.category}-${i}`} className="text-xs text-amber-900/80 dark:text-amber-200/80">
                    <span className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded">"{f.match}"</span>{" "}
                    — {f.reason}
                    {f.suggestion && <span className="italic"> Try: {f.suggestion}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
