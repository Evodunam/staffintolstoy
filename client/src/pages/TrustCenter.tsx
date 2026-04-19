import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft, Shield, Lock, FileText, AlertTriangle, ScrollText, Building2, CreditCard,
  Wifi, ServerCrash, ShieldCheck, ScanFace, FileSignature,
} from "lucide-react";

/**
 * Public-facing Trust Center summarizing the platform's security, privacy,
 * and compliance posture. Used by enterprise prospects in their vendor
 * security questionnaires before signing.
 *
 * Sections are intentionally evidence-light — they point to authoritative
 * sources (legal pages, status page) rather than restating policy here.
 * If you change a control here, also update the corresponding legal page.
 */
export default function TrustCenter() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Trust Center</h1>
            <p className="text-xs text-muted-foreground">How we keep your data, your workers, and your money safe.</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="rounded-lg border border-border p-6 bg-muted/20">
          <h2 className="text-xl font-semibold mb-2">For your security questionnaire</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Need a custom NDA, SOC 2 report, or pen-test letter? Email <a href="mailto:security@tolstoystaffing.com" className="underline">security@tolstoystaffing.com</a> and we'll respond within 2 business days.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/status"><Button variant="outline" size="sm" className="gap-1"><Wifi className="w-3.5 h-3.5" /> Live status</Button></Link>
            <Link href="/legal/subprocessors"><Button variant="outline" size="sm" className="gap-1"><Building2 className="w-3.5 h-3.5" /> Subprocessors</Button></Link>
            <Link href="/privacy"><Button variant="outline" size="sm" className="gap-1"><Lock className="w-3.5 h-3.5" /> Privacy policy</Button></Link>
            <Link href="/terms"><Button variant="outline" size="sm" className="gap-1"><ScrollText className="w-3.5 h-3.5" /> Terms of service</Button></Link>
          </div>
        </div>

        <Section title="Security" icon={<ShieldCheck className="w-5 h-5" />}>
          <Item label="Encryption in transit" detail="TLS 1.2+ enforced; HSTS preload submitted." />
          <Item label="Encryption at rest" detail="AES-256 on database storage; field-level AES-256-GCM for PII (SSN, DOB, bank acct)." />
          <Item label="Authentication" detail="OAuth/OpenID via Replit Auth; SCRAM-SHA-256 for direct credentials. Passwords hashed with bcrypt (cost 12)." />
          <Item label="Multi-factor auth" detail="TOTP MFA required for all admins (7-day grace at provisioning). Optional for workers/companies." />
          <Item label="Session management" detail="Sliding 30-day worker/company sessions; 24-hour admin sessions on a separate cookie scope. HTTP-only, Secure, SameSite=Lax." />
          <Item label="Access control" detail="Role-based: super-admin / admin / company / worker. Admin grants tracked in audit log; revocation takes effect within 60s." />
          <Item label="Audit logging" detail="Hash-chained tamper-evident JSONL audit log for all admin actions and PII access. Daily export for SOC 2 evidence." />
        </Section>

        <Section title="Privacy" icon={<Lock className="w-5 h-5" />}>
          <Item label="CCPA/CPRA" detail="Workers and companies can request a data export, deletion, or 'do not sell' from Account Settings → Privacy & Data." />
          <Item label="GDPR Art. 17 (right to delete)" detail="Soft-delete with 30-day grace period; hard-delete via daily scheduler. Legally-required records (tax, payroll, safety) retained per applicable law." />
          <Item label="Cookie consent" detail="Granular CCPA/GDPR-compliant consent banner. Essential cookies always on; analytics opt-in only." />
          <Item label="Data minimization" detail="We don't collect prior salary history (banned in CA, NY, WA, MA, NJ, others)." />
          <Item label="Subprocessors" detail={<>Listed publicly at <Link href="/legal/subprocessors" className="underline">/legal/subprocessors</Link>. 30-day advance notice for changes via opt-in mailing list.</>} />
        </Section>

        <Section title="Worker compliance" icon={<FileSignature className="w-5 h-5" />}>
          <Item label="Wage compliance" detail="State-specific minimum wage, overtime (FLSA + state daily/weekly), 7th-day rules, and double-time enforced at timesheet approval." />
          <Item label="Itemized wage statements" detail="CA Labor Code §226 / NY §195.3 compliant statements generated for every shift." />
          <Item label="Meal & rest breaks" detail="Auto-tracked per state rules (CA §510, OR, WA, others). Premium pay calculated when breaks are missed/short." />
          <Item label="Paid sick leave" detail="State-mandated accrual (CA, NY, NJ, WA, OR, CO, etc) tracked per worker." />
          <Item label="Wage theft prevention notices" detail="State-specific notices (CA AB 469, NY §195.1) generated at hire; available per worker on demand." />
          <Item label="EEOC anti-discrimination" detail="Job descriptions linted against age/gender/race/religion/disability/family-status biased language before posting." />
        </Section>

        <Section title="Worker safety" icon={<AlertTriangle className="w-5 h-5" />}>
          <Item label="OSHA incident reporting" detail="Workers and companies can log Form 300/301-style incidents in-app. Annual Form 300A summary auto-generated." />
          <Item label="GPS spoof detection" detail="Heuristic detection of impossible-velocity, teleport, and round-coordinate patterns at clock-in." />
          <Item label="Time-clock selfie" detail="Optional clock-in/out face match against onboarding selfie." />
          <Item label="Meal-break reminders" detail="Push notification before state-required meal break window expires." />
        </Section>

        <Section title="Background checks" icon={<ScanFace className="w-5 h-5" />}>
          <Item label="FCRA compliance" detail="Standalone disclosure (§604(b)(2)(A)) and authorization. Vendor-agnostic; Checkr adapter shipping. Pre-adverse and final adverse action workflow with §615 statutory wait period." />
          <Item label="Drug screening" detail="Vendor-agnostic interface with Accurate Background adapter. Worker consent recorded before order." />
          <Item label="OFAC SDN screening" detail="All payees screened against OFAC SDN list before payout. Fuzzy match flagged for human review." />
        </Section>

        <Section title="Financial integrity" icon={<CreditCard className="w-5 h-5" />}>
          <Item label="Payments" detail="Stripe Connect (PCI DSS Level 1). We never see raw card numbers; tokenized references only." />
          <Item label="Payouts" detail="Mercury for ACH; Stripe Instant Payouts for workers (1% + $0.30 fee). KYC/KYB verification required before any payout." />
          <Item label="Tax reporting" detail="1099-NEC aggregation per worker per year ($600 threshold). Auto-generated for company download." />
          <Item label="Disputes" detail="Two-sided rating system with admin mediation; strikes appealable within 30 days." />
        </Section>

        <Section title="Operations" icon={<ServerCrash className="w-5 h-5" />}>
          <Item label="Hosting" detail="DigitalOcean App Platform (us-east region). Database on Neon (managed Postgres) with read-replica + PITR." />
          <Item label="Backups" detail="Continuous WAL streaming with 7-day point-in-time recovery." />
          <Item label="Incident response" detail="Sentry for error tracking; PagerDuty for on-call. Status page at /status." />
          <Item label="Webhooks" detail="HMAC-SHA256 signed event delivery to company endpoints. Exponential backoff retry, 8 attempts, 12-hour ceiling." />
          <Item label="Rate limiting" detail="Per-IP and per-user limits on auth + sensitive endpoints. Cloudflare WAF in front of origin." />
        </Section>

        <Section title="Documents" icon={<FileText className="w-5 h-5" />}>
          <Item label="DPA / BAA" detail="Available on request for enterprise customers." />
          <Item label="SOC 2 Type II" detail="Audit in progress. Existing controls map to Trust Services Criteria CC1-CC9." />
          <Item label="Pen test" detail="Annual third-party pen test letter available under NDA." />
        </Section>

        <p className="text-xs text-muted-foreground text-center pt-4">
          Last updated: {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}.
          Spotted a mistake or have a security concern? <a href="mailto:security@tolstoystaffing.com" className="underline">security@tolstoystaffing.com</a>
        </p>
      </main>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 pt-0">{children}</CardContent>
    </Card>
  );
}

function Item({ label, detail }: { label: string; detail: React.ReactNode }) {
  return (
    <div className="border-l-2 border-primary/30 pl-3 py-1">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

