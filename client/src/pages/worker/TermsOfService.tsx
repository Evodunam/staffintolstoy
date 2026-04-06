import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const BACK_URL = "/dashboard/menu";

const termsProse = (
  <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
    <p className="text-muted-foreground">Last updated: January 2026</p>
    <section>
      <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
      <p>By accessing and using the Tolstoy Staffing platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use the Service.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">2. Description of Service</h2>
      <p>Tolstoy Staffing is a construction staffing marketplace that connects skilled workers ("Subcontractors") with construction companies ("Companies") for on-demand hourly work opportunities.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">3. User Registration</h2>
      <p>To use the Service, you must register for an account by providing accurate, current, and complete information. You are responsible for maintaining the confidentiality of your account credentials.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">4. Subcontractor Terms</h2>
      <p>As a Subcontractor on our platform, you agree to:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>Provide accurate information about your skills, certifications, and experience</li>
        <li>Maintain all required licenses and insurance for your trade</li>
        <li>Arrive on time and complete accepted jobs professionally</li>
        <li>Report hours accurately and honestly</li>
        <li>Maintain professional conduct with Companies and other workers</li>
      </ul>
    </section>
    <section>
      <h2 className="text-xl font-semibold">5. Company Terms</h2>
      <p>As a Company on our platform, you agree to:</p>
      <ul className="list-disc pl-6 space-y-2">
        <li>Maintain a minimum deposit balance to hire workers</li>
        <li>Provide accurate job descriptions and requirements</li>
        <li>Ensure a safe working environment for all workers</li>
        <li>Pay workers promptly for completed work</li>
        <li>Provide fair and honest reviews of worker performance</li>
      </ul>
    </section>
    <section>
      <h2 className="text-xl font-semibold">6. Payment Terms</h2>
      <p>Companies must maintain a $2,000 deposit before hiring workers. Payments are drawn from this deposit as workers log hours. Auto-billing occurs when the balance drops to $200.</p>
      <p>Subcontractors are paid weekly for completed work. Payouts are processed to the connected bank account or debit card on file.</p>
      <p className="mt-3">Companies may enable <strong>Auto-fulfill</strong> so applicants who meet configured rules can be accepted automatically. Timesheets may be paid after company approval or after the platform&apos;s review period (auto-approval). Companies may dispute charges only within the timeframe described in platform rules.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">7. Referral Program</h2>
      <p>Subcontractors may earn $100 for each qualified referral. A referral is qualified when the referred worker earns their first $100 on the platform.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">8. Strike Policy</h2>
      <p>Subcontractors who fail to show up for accepted jobs or engage in unprofessional conduct may receive strikes. Three strikes may result in account suspension or termination.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">9. Limitation of Liability</h2>
      <p>Tolstoy Staffing acts as a marketplace connecting workers and companies. We are not responsible for disputes between parties, the quality of work performed, or workplace incidents.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">10. Modifications</h2>
      <p>We reserve the right to modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the modified Terms.</p>
    </section>
    <section>
      <h2 className="text-xl font-semibold">11. Contact</h2>
      <p>For questions about these Terms, please contact us at legal@tolstoystaffing.com.</p>
    </section>
  </div>
);

export function TermsContent({ embedded = false }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
  if (embedded) {
    return (
      <div className="pt-2 pb-4 max-w-2xl">
        <ScrollArea className="max-h-[70vh] pr-4">{termsProse}</ScrollArea>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">Terms of Service</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <ScrollArea className="h-[calc(100vh-120px)]">
          {termsProse}
        </ScrollArea>
      </main>
    </div>
  );
}

export default function TermsOfService() {
  return <TermsContent />;
}
