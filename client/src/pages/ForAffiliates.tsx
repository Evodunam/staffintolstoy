import { Navigation } from "@/components/Navigation";
import { ArrowRight, CheckCircle2, DollarSign, Link2, Users, Building2, BarChart3, Share2, Percent } from "lucide-react";
import { Link } from "wouter";

const FEATURES = [
  {
    icon: Link2,
    title: "Unique Referral Links",
    description: "Share your custom links for service professionals and companies. Every signup is tied to your account.",
    color: "from-[#00A86B] to-[#008A57]",
  },
  {
    icon: Percent,
    title: "20% Commission",
    description: "Earn 20% net profit from company jobs or 20% of worker job amounts for the first year they do business.",
    color: "from-green-500 to-green-600",
  },
  {
    icon: BarChart3,
    title: "Sales Tracker",
    description: "Track referrals, signups, and earnings in your dashboard. Upgrade to Sales Affiliate for full CRM-style tracking.",
    color: "from-indigo-500 to-indigo-600",
  },
  {
    icon: Share2,
    title: "Two Affiliate Tiers",
    description: "Start with URL-based sharing, or get the Sales Affiliate tier with leads list, dashboard, and account creation.",
    color: "from-purple-500 to-purple-600",
  },
];

const TIERS = [
  {
    title: "URL-Based Affiliate",
    subtitle: "Share links, earn commission",
    points: [
      "Unique link for service professionals",
      "Unique link for companies",
      "20% of net profit / worker job amount (first year)",
      "Track clicks and signups",
    ],
    cta: "Get started",
  },
  {
    title: "Sales Affiliate",
    subtitle: "Full dashboard + links",
    points: [
      "Everything in URL-based",
      "Your own sales dashboard",
      "Manage leads and create accounts",
      "Same 20% commission structure",
    ],
    cta: "Apply for Sales tier",
  },
];

// Potential earnings: 20% of ~$380 profit per $1,000/month sales × 12 months = $912/year per company
const AVG_SALES_PER_COMPANY_MONTH = 1000;
const PROFIT_PER_1000_SALES = 380;
const AFFILIATE_PCT = 0.2;
const EARNINGS_PER_COMPANY_YEAR = (PROFIT_PER_1000_SALES * 12) * AFFILIATE_PCT; // $912

const POTENTIAL_EARNINGS_TIERS = [
  { companies: 5, earnings: 5 * EARNINGS_PER_COMPANY_YEAR },
  { companies: 25, earnings: 25 * EARNINGS_PER_COMPANY_YEAR },
  { companies: 75, earnings: 75 * EARNINGS_PER_COMPANY_YEAR },
  { companies: 125, earnings: 125 * EARNINGS_PER_COMPANY_YEAR },
];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function ForAffiliates() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <style>{`
        .taskrabbit-green { color: #00A86B; }
        .taskrabbit-green-bg { background-color: #00A86B; }
        .taskrabbit-green-hover:hover { background-color: #008A57; }
        .taskrabbit-green-light { background-color: #E6F7F0; }
        .taskrabbit-text { color: #222222; }
        .taskrabbit-text-muted { color: #717171; }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-float { animation: float 3s ease-in-out infinite; }
        .animate-slide-in { animation: slide-in 0.6s ease-out; }
      `}</style>

      <Navigation />

      {/* Hero */}
      <section className="pt-20 sm:pt-24 md:pt-28 pb-16 sm:pb-20 bg-gradient-to-br from-[#E6F7F0] to-[#CCF0E0] border-b-4 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <span className="bg-[#00A86B] text-white px-4 py-1 rounded-full text-xs uppercase tracking-wider font-medium mb-4 inline-block">
              For Affiliates
            </span>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold mb-6 taskrabbit-text leading-tight">
              Earn <span className="taskrabbit-green">20%</span> When You Refer
              <br className="sm:hidden" />
              Workers & Companies
            </h1>
            <p className="text-xl sm:text-2xl taskrabbit-text-muted max-w-3xl mx-auto mb-8">
              Share your unique links. Get 20% of net profit from company jobs or 20% of worker job amounts for the first year on Tolstoy Staffing.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link href="/affiliate-onboarding">
                <button className="px-10 py-4 taskrabbit-green-bg text-white rounded-xl font-semibold text-lg taskrabbit-green-hover transition-colors inline-flex items-center gap-2 shadow-lg hover:shadow-xl">
                  Get started
                  <ArrowRight className="h-5 w-5" />
                </button>
              </Link>
              <Link href="/affiliate-dashboard">
                <button className="px-10 py-4 bg-white text-[#00A86B] border-2 border-[#00A86B] rounded-xl font-semibold text-lg hover:bg-[#E6F7F0] transition-colors inline-flex items-center gap-2">
                  Affiliate Dashboard
                  <ArrowRight className="h-5 w-5" />
                </button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for — two audiences */}
      <section className="py-10 sm:py-12 bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 gap-6 sm:gap-8">
            <div className="flex flex-col sm:flex-row gap-4 items-start p-5 rounded-xl bg-taskrabbit-green-light/50 border border-[#00A86B]/20">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#00A86B] flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold taskrabbit-text mb-1">Know skilled workers looking for work?</h3>
                <p className="text-sm taskrabbit-text-muted">
                  Have a network of tradespeople — electrical, plumbing, HVAC, labor, and more? Refer them to Tolstoy Staffing and earn when they get hired. You get paid for sourcing and connecting workers to on-demand jobs.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 items-start p-5 rounded-xl bg-taskrabbit-green-light/50 border border-[#00A86B]/20">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#00A86B] flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold taskrabbit-text mb-1">Know companies that need labor?</h3>
                <p className="text-sm taskrabbit-text-muted">
                  Do you know businesses that need on-demand skilled labor? Refer them as clients and earn a share of the profit from the work they book. Source companies, and get paid as they grow on the platform.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-20 taskrabbit-green-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">How It Works</h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              One affiliate type, with an optional Sales tier for more tools
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={index}
                  className="bg-white p-6 rounded-xl border-2 border-gray-200 hover:border-[#00A86B] transition-all hover:shadow-lg group animate-slide-in"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className={`w-16 h-16 bg-gradient-to-br ${feature.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-lg font-bold taskrabbit-text mb-2">{feature.title}</h3>
                  <p className="text-sm taskrabbit-text-muted leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Two tiers */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Two Ways to Affiliate</h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              Start with links only, or get the Sales Affiliate dashboard
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {TIERS.map((tier, index) => (
              <div
                key={index}
                className="p-6 rounded-xl border-2 border-gray-200 hover:border-[#00A86B] transition-all bg-taskrabbit-green-light/30"
              >
                <h3 className="text-xl font-bold taskrabbit-text mb-1">{tier.title}</h3>
                <p className="text-sm taskrabbit-text-muted mb-4">{tier.subtitle}</p>
                <ul className="space-y-2 mb-6">
                  {tier.points.map((point, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm taskrabbit-text">
                      <CheckCircle2 className="w-5 h-5 taskrabbit-green flex-shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <Link href="/affiliate-onboarding">
                  <button className="w-full py-3 taskrabbit-green-bg text-white rounded-xl font-semibold taskrabbit-green-hover transition-colors">
                    {tier.cta}
                  </button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Potential earnings for sales trackers */}
      <section className="py-16 sm:py-20 taskrabbit-green-light border-t border-[#00A86B]/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">
              Potential Earnings for Sales Trackers
            </h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto mb-2">
              Scale your affiliate income by onboarding companies. You earn 20% of their net profit for the first year.
            </p>
            <p className="text-sm taskrabbit-text-muted max-w-xl mx-auto">
              Based on average sales volume of ${AVG_SALES_PER_COMPANY_MONTH.toLocaleString()}/month per company; ~${PROFIT_PER_1000_SALES} profit per ${AVG_SALES_PER_COMPANY_MONTH.toLocaleString()} in sales. Your share: 20% of that profit for 12 months per business you sign up.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-5xl mx-auto">
            {POTENTIAL_EARNINGS_TIERS.map((tier, index) => (
              <div
                key={index}
                className="bg-white rounded-xl border-2 border-[#00A86B]/30 p-5 sm:p-6 text-center hover:border-[#00A86B] hover:shadow-lg transition-all"
              >
                <p className="text-2xl sm:text-3xl font-bold taskrabbit-green">{tier.companies}</p>
                <p className="text-sm taskrabbit-text-muted mt-1">companies onboarded</p>
                <p className="text-xl sm:text-2xl font-bold taskrabbit-text mt-4">
                  {formatCurrency(tier.earnings)}
                </p>
                <p className="text-xs taskrabbit-text-muted mt-1">potential earnings (year 1)</p>
              </div>
            ))}
          </div>
          <p className="text-center text-sm taskrabbit-text-muted mt-6 max-w-lg mx-auto">
            Example: {formatCurrency(EARNINGS_PER_COMPANY_YEAR)} per company in the first year. Results depend on actual volume and retention.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-20 taskrabbit-green-bg">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
            Ready to Earn as an Affiliate?
          </h2>
          <p className="text-xl text-white/90 mb-8">
            Join our affiliate program. Share your links, track signups, and earn 20% for the first year.
          </p>
          <Link href="/affiliate-onboarding">
            <button className="px-10 py-4 bg-white text-[#00A86B] rounded-xl font-semibold text-lg hover:bg-gray-100 transition-colors inline-flex items-center gap-2 shadow-lg">
              Get Started
              <ArrowRight className="h-5 w-5" />
            </button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-4 border-[#00A86B] py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4 taskrabbit-text">Discover</h4>
              <ul className="space-y-2 text-sm taskrabbit-text-muted">
                <li><a href="/for-service-professionals" className="hover:taskrabbit-green transition-colors">For Service Professionals</a></li>
                <li><a href="/worker-onboarding" className="hover:taskrabbit-green transition-colors">Become a Worker</a></li>
                <li><a href="/company-onboarding" className="hover:taskrabbit-green transition-colors">Hire Workers</a></li>
                <li><a href="/for-affiliates" className="hover:taskrabbit-green transition-colors">For Affiliates</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 taskrabbit-text">Company</h4>
              <ul className="space-y-2 text-sm taskrabbit-text-muted">
                <li><a href="/about" className="hover:taskrabbit-green transition-colors">About Us</a></li>
                <li><a href="/careers" className="hover:taskrabbit-green transition-colors">Careers</a></li>
                <li><a href="/press" className="hover:taskrabbit-green transition-colors">Press</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 taskrabbit-text">Terms & Privacy</h4>
              <ul className="space-y-2 text-sm taskrabbit-text-muted">
                <li><a href="/terms" className="hover:taskrabbit-green transition-colors">Terms of Service</a></li>
                <li><a href="/privacy" className="hover:taskrabbit-green transition-colors">Privacy Policy</a></li>
                <li><a href="/legal" className="hover:taskrabbit-green transition-colors">Legal</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 taskrabbit-text">Help</h4>
              <ul className="space-y-2 text-sm taskrabbit-text-muted">
                <li><a href="/support" className="hover:taskrabbit-green transition-colors">Support</a></li>
                <li><a href="/contact" className="hover:taskrabbit-green transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t-2 border-[#00A86B] pt-8 text-center">
            <div className="font-bold text-xl mb-2 taskrabbit-text">Tolstoy Staffing</div>
            <div className="text-sm taskrabbit-text-muted">
              © {new Date().toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric" })} Tolstoy Staffing. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
