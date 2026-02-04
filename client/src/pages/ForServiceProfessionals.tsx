import { Navigation } from "@/components/Navigation";
import { ArrowRight, CheckCircle2, DollarSign, Clock, MapPin, Users, Shield, Zap, Briefcase, Star, MessageSquare, Bell, TrendingUp, Smartphone, Building2, Hammer, Zap as ZapIcon, Droplets, Wind, Shovel, PaintBucket, HardHat } from "lucide-react";
import { Link } from "wouter";

const FEATURES = [
  {
    icon: Briefcase,
    title: "Find Jobs Instantly",
    description: "Browse available jobs in your area, filter by trade, rate, and location. Get matched with jobs that fit your skills.",
    color: "from-blue-500 to-blue-600",
  },
  {
    icon: DollarSign,
    title: "Set Your Rate",
    description: "You control your hourly rate. Set competitive prices and maximize your earnings based on your experience.",
    color: "from-green-500 to-green-600",
  },
  {
    icon: Users,
    title: "Build Your Team",
    description: "Create and manage your own team. Add employees, set their rates, and grow your business operation.",
    color: "from-purple-500 to-purple-600",
  },
  {
    icon: MapPin,
    title: "GPS Time Tracking",
    description: "Automatic clock-in/out based on location. No manual time entry - just show up and work.",
    color: "from-orange-500 to-orange-600",
  },
  {
    icon: Clock,
    title: "Fast Payments",
    description: "Get paid quickly through secure ACH transfers. Track your earnings in real-time.",
    color: "from-indigo-500 to-indigo-600",
  },
  {
    icon: Star,
    title: "Build Reputation",
    description: "Earn ratings and reviews from companies. Build your profile and get more job opportunities.",
    color: "from-yellow-500 to-yellow-600",
  },
  {
    icon: MessageSquare,
    title: "Direct Messaging",
    description: "Communicate directly with companies. Ask questions, coordinate schedules, and build relationships.",
    color: "from-pink-500 to-pink-600",
  },
  {
    icon: Bell,
    title: "Real-Time Notifications",
    description: "Get instant alerts for new jobs, messages, and payment updates. Never miss an opportunity.",
    color: "from-red-500 to-red-600",
  },
];

const SERVICE_CATEGORIES = [
  { icon: HardHat, label: "General Labor", color: "bg-blue-100 text-blue-600" },
  { icon: Hammer, label: "Carpentry", color: "bg-amber-100 text-amber-600" },
  { icon: ZapIcon, label: "Electrical", color: "bg-yellow-100 text-yellow-600" },
  { icon: Droplets, label: "Plumbing", color: "bg-cyan-100 text-cyan-600" },
  { icon: Wind, label: "HVAC", color: "bg-sky-100 text-sky-600" },
  { icon: PaintBucket, label: "Painting", color: "bg-purple-100 text-purple-600" },
  { icon: Shovel, label: "Landscaping", color: "bg-green-100 text-green-600" },
  { icon: Building2, label: "Drywall", color: "bg-gray-100 text-gray-600" },
];

const BENEFITS = [
  "Work on your own schedule",
  "Choose jobs that match your skills",
  "Set competitive hourly rates",
  "Build a team and scale your business",
  "Get paid fast with secure payments",
  "Access jobs across multiple trades",
];

export default function ForServiceProfessionals() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <style>{`
        .taskrabbit-green {
          color: #00A86B;
        }
        .taskrabbit-green-bg {
          background-color: #00A86B;
        }
        .taskrabbit-green-hover:hover {
          background-color: #008A57;
        }
        .taskrabbit-green-light {
          background-color: #E6F7F0;
        }
        .taskrabbit-text {
          color: #222222;
        }
        .taskrabbit-text-muted {
          color: #717171;
        }
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
        .animate-slide-in {
          animation: slide-in 0.6s ease-out;
        }
      `}</style>
      
      <Navigation />
      
      {/* Hero Section */}
      <section className="pt-20 sm:pt-24 md:pt-28 pb-16 sm:pb-20 bg-gradient-to-br from-[#E6F7F0] to-[#CCF0E0] border-b-4 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <span className="bg-[#00A86B] text-white px-4 py-1 rounded-full text-xs uppercase tracking-wider font-medium mb-4 inline-block">
              For Service Professionals
            </span>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 taskrabbit-text leading-tight">
              Grow Your <br className="sm:hidden" />
              <span className="taskrabbit-green">Service Business</span>
            </h1>
            <p className="text-xl sm:text-2xl taskrabbit-text-muted max-w-3xl mx-auto mb-8">
              Find jobs, build your team, and scale your operation. Everything you need to succeed as a service professional.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link href="/worker-onboarding">
                <button className="px-10 py-4 taskrabbit-green-bg text-white rounded-xl font-semibold text-lg taskrabbit-green-hover transition-colors inline-flex items-center gap-2 shadow-lg hover:shadow-xl">
                  Get Started Free
                  <ArrowRight className="h-5 w-5" />
                </button>
              </Link>
              <Link href="/dashboard">
                <button className="px-10 py-4 bg-white text-[#00A86B] border-2 border-[#00A86B] rounded-xl font-semibold text-lg hover:bg-[#E6F7F0] transition-colors inline-flex items-center gap-2">
                  Browse Jobs
                  <ArrowRight className="h-5 w-5" />
                </button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Service Categories */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Work Across All Trades</h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              From general labor to specialized trades, find opportunities that match your expertise
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
            {SERVICE_CATEGORIES.map((category, index) => {
              const Icon = category.icon;
              return (
                <div
                  key={index}
                  className="flex flex-col items-center gap-3 p-4 rounded-xl hover:bg-gray-50 transition-all group cursor-pointer border-2 border-transparent hover:border-[#00A86B] animate-slide-in"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className={`w-14 h-14 rounded-full ${category.color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <span className="text-sm font-medium text-center taskrabbit-text">{category.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="py-16 sm:py-20 taskrabbit-green-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Everything You Need to Succeed</h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              Powerful tools and features designed for service professionals
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

      {/* Business Operator Feature */}
      <section className="py-16 sm:py-20 bg-gradient-to-br from-[#E6F7F0] to-[#CCF0E0] border-y-2 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="animate-slide-in">
              <div className="inline-block mb-4">
                <span className="px-4 py-2 taskrabbit-green-bg text-white rounded-full text-sm font-semibold">
                  Business Operator Feature
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold taskrabbit-text mb-6 leading-tight">
                Build and Manage
                <br />
                <span className="taskrabbit-green">Your Team</span>
              </h2>
              <p className="text-lg taskrabbit-text-muted mb-8">
                Scale your service business by building a team. Add employees, set their rates, manage schedules, and grow your operation - all from one platform.
              </p>
              
              <div className="space-y-4 mb-8">
                {[
                  "Add team members and manage their profiles",
                  "Set individual hourly rates for each team member",
                  "Track team performance and earnings",
                  "Coordinate schedules and job assignments",
                  "Handle payments and payouts for your team",
                ].map((benefit, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 taskrabbit-green flex-shrink-0 mt-0.5" />
                    <span className="text-sm taskrabbit-text">{benefit}</span>
                  </div>
                ))}
              </div>

              <Link href="/worker-onboarding">
                <button className="px-8 py-3 taskrabbit-green-bg text-white rounded-xl font-semibold taskrabbit-green-hover transition-colors inline-flex items-center gap-2">
                  Start Building Your Team
                  <ArrowRight className="h-5 w-5" />
                </button>
              </Link>
            </div>
            
            <div className="relative h-96 lg:h-[500px] flex items-center justify-center animate-slide-in">
              <div className="absolute inset-0 bg-white rounded-2xl shadow-2xl overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=500&fit=crop" 
                  alt="Team collaboration"
                  className="w-full h-full object-cover opacity-20"
                />
              </div>
              
              <div className="relative z-10 animate-float">
                <div className="relative">
                  <div className="w-20 h-20 taskrabbit-green-bg rounded-full flex items-center justify-center shadow-lg">
                    <Users className="w-10 h-10 text-white" />
                  </div>
                </div>
              </div>
              
              <div className="absolute top-4 right-4 bg-white rounded-xl p-4 shadow-lg animate-float" style={{ animationDelay: '0.3s' }}>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 taskrabbit-green" />
                  <div>
                    <div className="text-xs taskrabbit-text-muted">Team Growth</div>
                    <div className="text-lg font-bold taskrabbit-text">+150%</div>
                  </div>
                </div>
              </div>
              
              <div className="absolute bottom-4 left-4 bg-white rounded-xl p-4 shadow-lg animate-float" style={{ animationDelay: '0.6s' }}>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 taskrabbit-green" />
                  <div>
                    <div className="text-xs taskrabbit-text-muted">Earnings</div>
                    <div className="text-lg font-bold taskrabbit-text">$50K+</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Why Service Professionals Choose Us</h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              Join thousands of service professionals building successful businesses
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {BENEFITS.map((benefit, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-4 bg-taskrabbit-green-light rounded-xl border-2 border-transparent hover:border-[#00A86B] transition-all animate-slide-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <CheckCircle2 className="w-6 h-6 taskrabbit-green flex-shrink-0" />
                <span className="text-sm font-medium taskrabbit-text">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-20 taskrabbit-green-bg">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
            Ready to Grow Your Service Business?
          </h2>
          <p className="text-xl text-white/90 mb-8">
            Join thousands of service professionals finding jobs and building successful teams
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/worker-onboarding">
              <button className="px-10 py-4 bg-white text-[#00A86B] rounded-xl font-semibold text-lg hover:bg-gray-100 transition-colors inline-flex items-center gap-2 shadow-lg">
                Get Started Free
                <ArrowRight className="h-5 w-5" />
              </button>
            </Link>
            <Link href="/dashboard">
              <button className="px-10 py-4 bg-transparent text-white border-2 border-white rounded-xl font-semibold text-lg hover:bg-white/10 transition-colors inline-flex items-center gap-2">
                Browse Available Jobs
                <ArrowRight className="h-5 w-5" />
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer - TaskRabbit Style */}
      <footer className="border-t-4 border-[#00A86B] py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4 taskrabbit-text">Discover</h4>
              <ul className="space-y-2 text-sm taskrabbit-text-muted">
                <li><a href="/worker-onboarding" className="hover:taskrabbit-green transition-colors">Become a Worker</a></li>
                <li><a href="/company-onboarding" className="hover:taskrabbit-green transition-colors">Hire Workers</a></li>
                <li><a href="/dashboard" className="hover:taskrabbit-green transition-colors">Find Work</a></li>
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
                <li><a href="/how-time-keeping-works" className="hover:taskrabbit-green transition-colors">How Time Keeping Works</a></li>
                <li><a href="/support" className="hover:taskrabbit-green transition-colors">Support</a></li>
                <li><a href="/contact" className="hover:taskrabbit-green transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t-2 border-[#00A86B] pt-8 text-center">
            <div className="font-bold text-xl mb-2 taskrabbit-text">Tolstoy Staffing</div>
            <div className="text-sm taskrabbit-text-muted mb-2">
              B2B On-Demand Contract Labor Platform
            </div>
            <div className="text-sm taskrabbit-text-muted">
              © {new Date().toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric' })} Tolstoy Staffing. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
