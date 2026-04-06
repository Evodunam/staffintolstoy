import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const BACK_URL = "/dashboard/menu";

const privacyProse = (
  <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
            <p className="text-muted-foreground">Last updated: January 2026</p>

            <section>
              <h2 className="text-xl font-semibold">1. Introduction</h2>
              <p>
                Tolstoy Staffing ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">2. Information We Collect</h2>
              <h3 className="text-lg font-medium">Personal Information</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Name, email address, and phone number</li>
                <li>Physical address and location data</li>
                <li>Profile photo and identification documents</li>
                <li>Skills, certifications, and work history</li>
                <li>Payment information (bank account, debit card)</li>
              </ul>

              <h3 className="text-lg font-medium mt-4">Automatically Collected Information</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Device information (IP address, browser type)</li>
                <li>Usage data and analytics</li>
                <li>Location data when using the mobile app</li>
                <li>Clock-in/out times and job-site-related location used to verify shifts, calculate pay, and support Auto-fulfill / automatic timesheet approval flows</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>To create and manage your account</li>
                <li>To match you with relevant job opportunities</li>
                <li>To process payments and payouts</li>
                <li>To verify your identity and qualifications</li>
                <li>To communicate with you about jobs and updates</li>
                <li>To improve our services and user experience</li>
                <li>To comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">4. Information Sharing</h2>
              <p>We may share your information with:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Companies when you apply for or accept jobs</li>
                <li>Payment processors (Stripe, Plaid, Dwolla)</li>
                <li>Service providers who assist our operations</li>
                <li>Law enforcement when required by law</li>
              </ul>
              <p className="mt-4">
                We do not sell your personal information to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">5. Data Security</h2>
              <p>
                We implement industry-standard security measures to protect your information, including encryption, secure servers, and regular security audits. Payment information is tokenized and stored securely by our payment partners.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">6. Face Verification</h2>
              <p>
                During onboarding, we may use face verification technology to confirm your identity matches your profile photo. This helps ensure platform safety. Face data is processed locally on your device and is not stored on our servers.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">7. Location Data</h2>
              <p>
                We collect location data to match you with nearby job opportunities and to verify job site attendance. You can disable location services in your device settings, but this may limit functionality.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">8. Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Access your personal information</li>
                <li>Correct inaccurate information</li>
                <li>Delete your account and associated data</li>
                <li>Opt out of marketing communications</li>
                <li>Request a copy of your data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">9. Data Retention</h2>
              <p>
                We retain your information for as long as your account is active or as needed to provide services. Upon account deletion, we may retain certain information as required by law or for legitimate business purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">10. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy periodically. We will notify you of significant changes via email or in-app notification.
              </p>
            </section>

    <section>
      <h2 className="text-xl font-semibold">11. Contact Us</h2>
      <p>For privacy-related questions or requests, please contact us at privacy@tolstoystaffing.com.</p>
    </section>
  </div>
);

export function PrivacyContent({ embedded = false }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
  if (embedded) {
    return (
      <div className="pt-2 pb-4 max-w-2xl">
        <ScrollArea className="max-h-[70vh] pr-4">{privacyProse}</ScrollArea>
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
          <h1 className="text-lg font-semibold">Privacy Policy</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <ScrollArea className="h-[calc(100vh-120px)]">{privacyProse}</ScrollArea>
      </main>
    </div>
  );
}

export default function PrivacyPolicy() {
  return <PrivacyContent />;
}
