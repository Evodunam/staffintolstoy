import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { ArrowRight, CheckCircle2, Shield, Users, HardHat, Hammer, Zap, Droplets, Wind, Shovel, PaintBucket, Building2, Star, Building, Briefcase, Package, ShoppingCart, Home as HomeIcon, PartyPopper, Truck, Warehouse, ClipboardList, Store, Sparkles, Wrench, Utensils, Monitor, Volume2, UserCog, HeartHandshake, MapPin, Clock, ShieldCheck, DollarSign, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { useEffect, useState, useRef } from "react";
import { INDUSTRY_CATEGORIES } from "@shared/industries";
import { useTranslation } from "react-i18next";
import { AppLoading } from "@/components/AppLoading";
import TestimonialSection from "@/components/ui/testimonial-section";

// Popular services to display prominently
const POPULAR_SERVICES = [
  { 
    id: "Laborer", 
    label: "General Labor", 
    icon: HardHat, 
    desc: "Furniture assembly, demolition, moving, general labor", 
    price: "Starting at $18/hr",
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&h=300&fit=crop"
  },
  { 
    id: "Carpentry Lite", 
    label: "Carpentry", 
    icon: Hammer, 
    desc: "Trim, tools, framing walls, small stairs", 
    price: "Starting at $22/hr",
    image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=300&fit=crop"
  },
  { 
    id: "Electrical Lite", 
    label: "Electrical Help", 
    icon: Zap, 
    desc: "Outlets, ceiling fans, replacing fixtures", 
    price: "Starting at $26/hr",
    image: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=400&h=300&fit=crop"
  },
  { 
    id: "Plumbing Lite", 
    label: "Plumbing", 
    icon: Droplets, 
    desc: "Faucets, toilets, repairs", 
    price: "Starting at $24/hr",
    image: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=400&h=300&fit=crop"
  },
  { 
    id: "Painting", 
    label: "Painting", 
    icon: PaintBucket, 
    desc: "Interior and exterior painting", 
    price: "Starting at $20/hr",
    image: "https://images.unsplash.com/photo-1563453392212-326f5e854473?w=400&h=300&fit=crop"
  },
  { 
    id: "Landscaping", 
    label: "Landscaping", 
    icon: Shovel, 
    desc: "Lawn care, gardening, outdoor work", 
    price: "Starting at $18/hr",
    image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&h=300&fit=crop"
  },
  { 
    id: "HVAC Lite", 
    label: "HVAC", 
    icon: Wind, 
    desc: "Repairs, existing systems", 
    price: "Starting at $28/hr",
    image: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=400&h=300&fit=crop"
  },
  { 
    id: "Drywall", 
    label: "Drywall", 
    icon: Building2, 
    desc: "Hanging, mudding, and taping", 
    price: "Starting at $20/hr",
    image: "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=300&fit=crop"
  },
];

// B2B Customer testimonials
const TESTIMONIALS = [
  { name: "Sarah M.", company: "ABC Construction", service: "General Labor", text: "Tolstoy Staffing helped us fill critical labor positions on short notice. The workers were professional, reliable, and exactly what we needed for our project deadline.", rating: 5 },
  { name: "Michael T.", company: "Premier Contractors", service: "Carpentry", text: "We use Tolstoy Staffing regularly for our carpentry projects. The quality of workers is excellent and the platform makes it easy to find skilled tradespeople quickly.", rating: 5 },
  { name: "Jennifer L.", company: "Metro Electric Co.", service: "Electrical Help", text: "As a contractor, finding qualified electricians on demand has been a game-changer. The background checks give us confidence, and the workers are always professional.", rating: 5 },
  { name: "Robert K.", company: "City Plumbing Services", service: "Plumbing", text: "We've used Tolstoy Staffing to staff multiple job sites simultaneously. The on-demand contract labor model fits perfectly with our project-based workflow.", rating: 5 },
  { name: "Lisa R.", company: "Commercial Painters Inc.", service: "Painting", text: "The ability to scale our workforce up and down based on project needs has been invaluable. Workers are vetted and ready to work immediately.", rating: 5 },
  { name: "David P.", company: "Landscape Solutions", service: "Landscaping", text: "For local locations that need staffing, Tolstoy Staffing is our go-to. We can post jobs and have workers on-site the same day. Highly recommend for any contractor.", rating: 5 },
];

export default function Home() {
  const { t } = useTranslation("home");
  const [, setLocation] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(isAuthenticated ? user?.id : undefined);
  const [isSticky, setIsSticky] = useState(false);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.id) {
      if (!profileLoading && profile) {
        if (profile.role === "company") {
          setLocation("/company-dashboard");
        } else if (profile.role === "worker") {
          setLocation("/dashboard");
        }
      }
    }
  }, [authLoading, profileLoading, isAuthenticated, profile, user?.id, setLocation]);

  useEffect(() => {
    if (window.innerWidth >= 1024) return;
    
    let ticking = false;
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (ctaRef.current) {
            const rect = ctaRef.current.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollDelta = scrollTop - lastScrollTop;
            
            // Only show sticky when scrolled past CTA and scrolling down
            const shouldBeSticky = rect.top < -100 && scrollDelta > 0 && scrollTop > 200;
            
            setIsSticky(prev => {
              // Only update if state actually changes to prevent flashing
              if (shouldBeSticky !== prev) {
                return shouldBeSticky;
              }
              return prev;
            });
            
            lastScrollTop = scrollTop;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (authLoading || (isAuthenticated && profileLoading)) {
    return <AppLoading />;
  }

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
        .taskrabbit-green-border {
          border-color: #00A86B;
        }
        .taskrabbit-green-accent {
          background: linear-gradient(135deg, #E6F7F0 0%, #CCF0E0 100%);
        }
        .taskrabbit-text {
          color: #222222;
        }
        .taskrabbit-text-muted {
          color: #717171;
        }
        .taskrabbit-bg-light {
          background-color: #F7F7F7;
        }
        .b2b-badge {
          background-color: #00A86B;
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          display: inline-block;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @keyframes pulse-ring {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
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
        .animate-pulse-ring {
          animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
        .animate-slide-in {
          animation: slide-in 0.6s ease-out;
        }
        @keyframes scroll-left {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        @keyframes scroll-right {
          from {
            transform: translateX(-50%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-scroll-left {
          animation: scroll-left 30s linear infinite;
        }
        .animate-scroll-right {
          animation: scroll-right 30s linear infinite;
        }
        @media (max-width: 1023px) {
          .animate-scroll-left {
            animation: scroll-left 30s linear infinite;
          }
          .animate-scroll-right {
            animation: scroll-right 30s linear infinite;
          }
          .animate-scroll-left:hover,
          .animate-scroll-left:active {
            animation: scroll-left 60s linear infinite !important;
          }
          .animate-scroll-right:hover,
          .animate-scroll-right:active {
            animation: scroll-right 60s linear infinite !important;
          }
        }
        @media (min-width: 1024px) {
          .animate-scroll-left:hover,
          .animate-scroll-right:hover {
            animation-play-state: paused;
          }
        }
      `}</style>
      
      <Navigation />
      
      {/* Hero Section - B2B Focused */}
      <section className="pt-20 sm:pt-24 md:pt-28 pb-16 sm:pb-20 bg-white border-b-4 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <span className="b2b-badge mb-4 inline-block">B2B Staffing Platform</span>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6 taskrabbit-text leading-tight">
              On-Demand Contract Labor
              <br />
              <span className="taskrabbit-green">for Your Business</span>
            </h1>
            <p className="text-xl sm:text-2xl taskrabbit-text-muted max-w-3xl mx-auto mb-8">
              Staff local locations, fill project needs, and scale your workforce instantly. 
              Built for <span className="taskrabbit-green font-semibold">contractors, businesses, and organizations</span> that need reliable contract labor on demand.
            </p>
          </div>

          {/* Tasks Our Business - Industry Icons */}
          <div className="mb-12">
            <h3 className="text-2xl sm:text-3xl font-bold mb-6 taskrabbit-text text-center">Tasks Our Business</h3>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide lg:justify-center lg:flex-wrap">
              {INDUSTRY_CATEGORIES.map((industry) => {
                const Icon = industry.icon;
                return (
                  <a
                    key={industry.id}
                    href="/company-onboarding"
                    className="flex flex-col items-center gap-3 p-4 rounded-xl hover:bg-gray-50 transition-colors group cursor-pointer border-2 border-transparent hover:border-[#00A86B] flex-shrink-0 min-w-[120px]"
                  >
                    <div className="w-14 h-14 rounded-full taskrabbit-green-light flex items-center justify-center group-hover:bg-[#CCF0E0] transition-colors ring-2 ring-transparent group-hover:ring-[#00A86B]">
                      <Icon className="w-7 h-7 taskrabbit-green" />
                    </div>
                    <span className="text-sm font-medium text-center taskrabbit-text">{industry.label}</span>
                  </a>
                );
              })}
            </div>
          </div>

          {/* Primary CTA */}
          <div ref={ctaRef} className="text-center">
            <a 
              href="/company-onboarding" 
              className="inline-block px-10 py-4 taskrabbit-green-bg text-white rounded-xl font-semibold text-lg taskrabbit-green-hover transition-colors no-underline inline-flex items-center gap-2 shadow-lg hover:shadow-xl"
              data-testid="button-hire-workers"
            >
              Start Hiring Today
              <ArrowRight className="h-5 w-5" />
            </a>
            <p className="text-sm taskrabbit-text-muted mt-4">For businesses, contractors, and organizations only</p>
          </div>
          
          {/* Sticky CTA for Mobile */}
          <div className={`fixed top-0 left-0 right-0 z-[100] bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 py-2.5 px-4 transition-all duration-500 ease-in-out lg:hidden ${
            isSticky ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
          }`}>
            <a 
              href="/company-onboarding" 
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gray-800 text-white rounded-lg font-medium text-sm transition-colors hover:bg-gray-700 no-underline"
            >
              Start Hiring Today
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* B2B Value Proposition */}
      <section className="py-16 sm:py-20 taskrabbit-green-accent border-y-2 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="p-6">
              <div className="w-16 h-16 taskrabbit-green-bg rounded-full flex items-center justify-center mx-auto mb-4">
                <Building className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-bold text-lg taskrabbit-text mb-2">Staff Local Locations</h3>
              <p className="text-sm taskrabbit-text-muted">Need workers at multiple locations? Post jobs and get matched with qualified workers in each area instantly.</p>
            </div>
            <div className="p-6">
              <div className="w-16 h-16 taskrabbit-green-bg rounded-full flex items-center justify-center mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-bold text-lg taskrabbit-text mb-2">For Contractors & Businesses</h3>
              <p className="text-sm taskrabbit-text-muted">Built specifically for B2B needs. Scale your workforce up or down based on project demands and deadlines.</p>
            </div>
            <div className="p-6">
              <div className="w-16 h-16 taskrabbit-green-bg rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-bold text-lg taskrabbit-text mb-2">On-Demand Contract Labor</h3>
              <p className="text-sm taskrabbit-text-muted">No long-term commitments. Hire skilled workers when you need them, for as long as you need them.</p>
            </div>
          </div>
        </div>
      </section>

      {/* All Industry Categories */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Industries We Serve</h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              From construction sites to retail locations, we provide contract labor across all industries
            </p>
          </div>
          <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide lg:grid lg:grid-cols-3 lg:overflow-visible">
            {INDUSTRY_CATEGORIES.map((industry) => {
              const Icon = industry.icon;
              return (
                <div key={industry.id} className="p-6 bg-white border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all hover:shadow-lg group flex-shrink-0 w-[300px] lg:w-auto">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 taskrabbit-green-light rounded-lg flex items-center justify-center group-hover:bg-[#CCF0E0] transition-colors">
                      <Icon className="w-6 h-6 taskrabbit-green" />
                    </div>
                    <h3 className="text-lg font-bold taskrabbit-text">{industry.label}</h3>
                  </div>
                  <div className="space-y-2">
                    {industry.roles.slice(0, 4).map((role) => (
                      <div key={role.id} className="flex items-center gap-2 text-sm taskrabbit-text-muted">
                        <div className="w-1.5 h-1.5 taskrabbit-green-bg rounded-full" />
                        <span>{role.label}</span>
                      </div>
                    ))}
                    {industry.roles.length > 4 && (
                      <div className="text-sm taskrabbit-green font-medium pt-2">
                        +{industry.roles.length - 4} more roles
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Geolocation Time Keeping Feature - Animated Section */}
      <section className="py-16 sm:py-20 bg-gradient-to-br from-[#E6F7F0] to-[#CCF0E0] border-y-2 border-[#00A86B] relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Side - Content */}
            <div className="animate-slide-in order-2 lg:order-1">
              <div className="inline-block mb-4">
                <span className="px-4 py-2 taskrabbit-green-bg text-white rounded-full text-sm font-semibold">
                  State-of-the-Art Technology
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold taskrabbit-text mb-6 leading-tight">
                Geolocation Time Keeping
                <br />
                <span className="taskrabbit-green">Save on Time Theft</span>
              </h2>
              <p className="text-lg taskrabbit-text-muted mb-8">
                Our advanced geolocation tracking ensures you only pay for the hours workers actually work. Real-time location verification prevents time theft and gives you complete transparency.
              </p>
              
              {/* Tags - Horizontally Scrollable on Mobile */}
              <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide mb-8 lg:flex-wrap">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full backdrop-blur-sm border-2 border-[#00A86B]/30 flex-shrink-0">
                  <MapPin className="w-4 h-4 taskrabbit-green flex-shrink-0" />
                  <span className="text-sm font-medium taskrabbit-text whitespace-nowrap">Real-Time Location Tracking</span>
                </div>
                
                <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full backdrop-blur-sm border-2 border-[#00A86B]/30 flex-shrink-0">
                  <Clock className="w-4 h-4 taskrabbit-green flex-shrink-0" />
                  <span className="text-sm font-medium taskrabbit-text whitespace-nowrap">Accurate Time Tracking</span>
                </div>
                
                <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full backdrop-blur-sm border-2 border-[#00A86B]/30 flex-shrink-0">
                  <ShieldCheck className="w-4 h-4 taskrabbit-green flex-shrink-0" />
                  <span className="text-sm font-medium taskrabbit-text whitespace-nowrap">Prevent Time Theft</span>
                </div>
                
                <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full backdrop-blur-sm border-2 border-[#00A86B]/30 flex-shrink-0">
                  <DollarSign className="w-4 h-4 taskrabbit-green flex-shrink-0" />
                  <span className="text-sm font-medium taskrabbit-text whitespace-nowrap">Save Money</span>
                </div>
              </div>
            </div>
            
            {/* Right Side - Animated Visual (Above tags on mobile) */}
            <div className="relative h-64 sm:h-80 lg:h-[500px] flex items-center justify-center animate-slide-in order-1 lg:order-2">
              {/* Animated Map Background */}
              <div className="absolute inset-0 bg-white rounded-2xl shadow-2xl overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1524661135-423995f22d0b?w=600&h=500&fit=crop" 
                  alt="Map view"
                  className="w-full h-full object-cover opacity-20"
                />
              </div>
              
              {/* Animated Location Pin - Smaller on mobile */}
              <div className="relative z-10 animate-float">
                <div className="relative">
                  {/* Pulsing rings - Smaller on mobile */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-32 lg:h-32 taskrabbit-green-light rounded-full animate-pulse-ring"></div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-32 lg:h-32 taskrabbit-green-light rounded-full animate-pulse-ring" style={{ animationDelay: '0.5s' }}></div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-32 lg:h-32 taskrabbit-green-light rounded-full animate-pulse-ring" style={{ animationDelay: '1s' }}></div>
                  </div>
                  
                  {/* Center pin - Smaller on mobile */}
                  <div className="relative w-12 h-12 sm:w-16 sm:h-16 lg:w-20 lg:h-20 taskrabbit-green-bg rounded-full flex items-center justify-center shadow-lg">
                    <MapPin className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10 text-white" />
                  </div>
                </div>
              </div>
              
              {/* Floating stats cards - Hidden on mobile, shown on desktop */}
              <div className="hidden lg:block absolute top-4 right-4 bg-white rounded-xl p-4 shadow-lg animate-float" style={{ animationDelay: '0.3s' }}>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 taskrabbit-green" />
                  <div>
                    <div className="text-xs taskrabbit-text-muted">Hours Tracked</div>
                    <div className="text-lg font-bold taskrabbit-text">8.5</div>
                  </div>
                </div>
              </div>
              
              <div className="hidden lg:block absolute bottom-4 left-4 bg-white rounded-xl p-4 shadow-lg animate-float" style={{ animationDelay: '0.6s' }}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 taskrabbit-green" />
                  <div>
                    <div className="text-xs taskrabbit-text-muted">Verified</div>
                    <div className="text-lg font-bold taskrabbit-text">100%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Bottom CTA */}
          <div className="text-center mt-12">
            <p className="text-xl font-bold taskrabbit-text mb-4">
              Only pay for the hours they work
            </p>
            <Link href="/how-time-keeping-works">
              <button className="inline-block px-8 py-3 taskrabbit-green-bg text-white rounded-xl font-semibold taskrabbit-green-hover transition-colors no-underline inline-flex items-center gap-2 cursor-pointer border-0">
                Learn More
                <ArrowRight className="h-5 w-5" />
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* Popular Projects Section - TaskRabbit Style */}
      <section className="py-16 sm:py-20 taskrabbit-bg-light border-y-2 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-4">
            <h2 className="text-3xl sm:text-4xl font-bold mb-2 taskrabbit-text">Popular Staffing Needs</h2>
            <p className="text-sm taskrabbit-text-muted">Common roles businesses hire through our platform</p>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide mt-10 lg:grid lg:grid-cols-4 lg:overflow-visible">
            {POPULAR_SERVICES.slice(0, 8).map((service) => {
              const Icon = service.icon;
              return (
                <a
                  key={service.id}
                  href="/company-onboarding"
                  className="bg-white border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all hover:shadow-lg group cursor-pointer overflow-hidden flex-shrink-0 w-[280px] lg:w-auto"
                >
                  <div className="relative h-32 w-full overflow-hidden">
                    <img 
                      src={service.image} 
                      alt={service.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2 right-2">
                      <div className="w-8 h-8 taskrabbit-green-light rounded-full flex items-center justify-center backdrop-blur-sm bg-white/80">
                        <Icon className="w-4 h-4 taskrabbit-green" />
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold taskrabbit-text mb-1 text-sm">{service.label}</h3>
                    <p className="text-xs taskrabbit-text-muted mb-2 line-clamp-2">{service.desc}</p>
                    <p className="text-xs font-semibold taskrabbit-green">{service.price}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* B2B Customer Testimonials - New Design */}
      <section className="py-16 sm:py-20 taskrabbit-bg-light overflow-hidden">
        <TestimonialSection 
          testimonials={TESTIMONIALS}
          stats={[
            {
              percentage: "80%",
              label: "faster hiring",
              isIncrease: true,
              logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='40'%3E%3Crect width='100' height='40' fill='%2300A86B'/%3E%3C/svg%3E",
            },
            {
              percentage: "30%",
              label: "cost reduction",
              isIncrease: true,
              logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='40'%3E%3Crect width='100' height='40' fill='%2300A86B'/%3E%3C/svg%3E",
            },
            {
              percentage: "25%",
              label: "time saved",
              isIncrease: true,
              logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='40'%3E%3Crect width='100' height='40' fill='%2300A86B'/%3E%3C/svg%3E",
            },
            {
              percentage: "$100K",
              label: "saved per year",
              isIncrease: true,
              logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='40'%3E%3Crect width='100' height='40' fill='%2300A86B'/%3E%3C/svg%3E",
            },
          ]}
        />
      </section>

      {/* Trust Section - TaskRabbit Style */}
      <section className="py-16 sm:py-20 bg-white border-y-2 border-[#00A86B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Your satisfaction, guaranteed</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="text-center p-6 taskrabbit-green-light rounded-xl">
              <div className="w-20 h-20 taskrabbit-green-bg rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
              <h3 className="font-semibold mb-3 text-lg taskrabbit-text">Happiness Pledge</h3>
              <p className="text-sm taskrabbit-text-muted leading-relaxed">If you're not satisfied, we'll work to make it right.</p>
            </div>
            <div className="text-center p-6 taskrabbit-green-light rounded-xl">
              <div className="w-20 h-20 taskrabbit-green-bg rounded-full flex items-center justify-center mx-auto mb-6">
                <Shield className="w-10 h-10 text-white" />
              </div>
              <h3 className="font-semibold mb-3 text-lg taskrabbit-text">Vetted Workers</h3>
              <p className="text-sm taskrabbit-text-muted leading-relaxed">All workers are background checked before joining.</p>
            </div>
            <div className="text-center p-6 taskrabbit-green-light rounded-xl">
              <div className="w-20 h-20 taskrabbit-green-bg rounded-full flex items-center justify-center mx-auto mb-6">
                <Users className="w-10 h-10 text-white" />
              </div>
              <h3 className="font-semibold mb-3 text-lg taskrabbit-text">Dedicated Support</h3>
              <p className="text-sm taskrabbit-text-muted leading-relaxed">Friendly service when you need us – every day.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - TaskRabbit Style */}
      <section className="py-16 sm:py-20 taskrabbit-bg-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">How it works</h2>
            <p className="text-sm taskrabbit-text-muted">Simple process for businesses and contractors</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-10 max-w-5xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 taskrabbit-green-bg text-white rounded-full flex items-center justify-center font-bold text-2xl mx-auto mb-6 shadow-lg">
                1
              </div>
              <h3 className="font-semibold mb-3 text-lg taskrabbit-text">Post your staffing need</h3>
              <p className="text-sm taskrabbit-text-muted leading-relaxed">Describe the role, location, and timeline. Post jobs for single locations or multiple sites.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 taskrabbit-green-bg text-white rounded-full flex items-center justify-center font-bold text-2xl mx-auto mb-6 shadow-lg">
                2
              </div>
              <h3 className="font-semibold mb-3 text-lg taskrabbit-text">Get matched instantly</h3>
              <p className="text-sm taskrabbit-text-muted leading-relaxed">We'll connect you with qualified, vetted workers in your area. Review profiles and select the best fit.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 taskrabbit-green-bg text-white rounded-full flex items-center justify-center font-bold text-2xl mx-auto mb-6 shadow-lg">
                3
              </div>
              <h3 className="font-semibold mb-3 text-lg taskrabbit-text">Scale your workforce</h3>
              <p className="text-sm taskrabbit-text-muted leading-relaxed">Workers complete the job, you approve timesheets, and pay through the platform. No long-term commitments.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Get Help Today - Tag Style with Auto-Scroll */}
      <section className="py-16 sm:py-20 bg-white border-t-2 border-[#00A86B] overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 taskrabbit-text">Get help today</h2>
            <p className="text-sm taskrabbit-text-muted">Find contract labor for your business needs</p>
          </div>
          
          {/* Get all roles from all industries */}
          {(() => {
            const allRoles = INDUSTRY_CATEGORIES.flatMap(industry => industry.roles);
            // Split into 3 rows
            const rows = [
              allRoles.slice(0, Math.ceil(allRoles.length / 3)),
              allRoles.slice(Math.ceil(allRoles.length / 3), Math.ceil(allRoles.length / 3) * 2),
              allRoles.slice(Math.ceil(allRoles.length / 3) * 2)
            ];
            
            // Animation directions: left, right, left
            const directions = ['left', 'right', 'left'];
            
            return (
              <div className="space-y-4">
                {rows.map((row, rowIndex) => {
                  // Duplicate tags for seamless infinite scroll
                  const duplicatedRow = [...row, ...row];
                  const direction = directions[rowIndex];
                  const animationClass = direction === 'left' ? 'animate-scroll-left' : 'animate-scroll-right';
                  
                  return (
                    <div
                      key={rowIndex}
                      className="flex gap-3 overflow-hidden pb-4 w-full"
                      style={{ maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)' }}
                    >
                      <div className={`flex gap-3 ${animationClass}`} style={{ width: 'max-content', willChange: 'transform' }}>
                        {duplicatedRow.map((role, index) => {
                          const Icon = role.icon;
                          return (
                            <a
                              key={`${role.id}-${index}`}
                              href="/company-onboarding"
                              className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-200 rounded-full hover:border-[#00A86B] hover:bg-taskrabbit-green-light transition-all cursor-pointer whitespace-nowrap flex-shrink-0 group"
                            >
                              <Icon className="w-4 h-4 taskrabbit-green group-hover:scale-110 transition-transform" />
                              <span className="text-sm font-medium taskrabbit-text">{role.label}</span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </section>


      {/* Footer - TaskRabbit Style */}
      <footer className="border-t-4 border-[#00A86B] py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4 taskrabbit-text">Discover</h4>
              <ul className="space-y-2 text-sm taskrabbit-text-muted">
                <li><a href="/for-service-professionals" className="hover:taskrabbit-green transition-colors">For Service Professionals</a></li>
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
                <li><a href="/llms.txt" className="hover:taskrabbit-green transition-colors">llms.txt</a></li>
                <li><a href="/sitemap.xml" className="hover:taskrabbit-green transition-colors">Sitemap</a></li>
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
