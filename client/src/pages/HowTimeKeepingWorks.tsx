import { Navigation } from "@/components/Navigation";
import { ArrowRight, CheckCircle2, MapPin, Clock, ShieldCheck, DollarSign, Zap, TrendingUp, Sparkles, Rocket } from "lucide-react";
import { Link } from "wouter";

const STEPS = [
  {
    letter: "A",
    title: "Worker Arrives at Job Site",
    description: "When a worker arrives at the job location, they open the app and tap 'Clock In'. Our system immediately captures their GPS coordinates to verify they're at the correct job site. It's instant, automatic, and foolproof! 🎯",
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&h=400&fit=crop",
    icon: MapPin,
    color: "from-blue-500 to-blue-600",
    emoji: "📍",
  },
  {
    letter: "B",
    title: "Geofence Verification",
    description: "Our system calculates the distance between the worker's location and the job site coordinates. Workers must be within a specified radius (typically 0.1-0.5 miles) to successfully clock in, preventing time theft from remote locations. Smart technology at work! 🛡️",
    image: "https://images.unsplash.com/photo-1524661135-423995f22d0b?w=800&h=400&fit=crop",
    icon: ShieldCheck,
    color: "from-green-500 to-green-600",
    emoji: "🔒",
  },
  {
    letter: "C",
    title: "Continuous Location Tracking",
    description: "Once clocked in, the app sends your location to the server about every minute. This lets us verify you're on site and, if you leave the job site while still clocked in, we can automatically clock you out. For best results, keep the app open or allow background location. Real-time transparency! 📊",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=400&fit=crop",
    icon: Clock,
    color: "from-purple-500 to-purple-600",
    emoji: "⏱️",
  },
  {
    letter: "D",
    title: "Automatic Clock-Out When You Leave",
    description: "When you leave the job site (outside the geofence), the app can auto clock you out. If the app is in the background, our server uses your recent location pings to detect that you left and automatically clocks you out—you’ll get a notification. If the app was closed or the device off, we still use location history when you clock out to only count time on site. Seamless and fair! ✨",
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=400&fit=crop",
    icon: Zap,
    color: "from-yellow-500 to-yellow-600",
    emoji: "⚡",
  },
  {
    letter: "E",
    title: "Time Calculation & Verification",
    description: "The system calculates total hours worked based on clock-in and clock-out times. Location data is cross-referenced to ensure the worker was at the job site for the entire duration. Any discrepancies are flagged for review. Accuracy guaranteed! ✅",
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=400&fit=crop",
    icon: TrendingUp,
    color: "from-orange-500 to-orange-600",
    emoji: "📈",
  },
  {
    letter: "F",
    title: "Timesheet Review & Approval",
    description: "Employers receive detailed timesheets showing clock-in/out times, location verification status, and a map view of the worker's location during their shift. They can approve, reject, or request adjustments based on the data. Complete visibility! 👀",
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=400&fit=crop",
    icon: Sparkles,
    color: "from-pink-500 to-pink-600",
    emoji: "💎",
  },
  {
    letter: "G",
    title: "Payment Processing",
    description: "Once approved, timesheets are automatically processed for payment. The system calculates total pay based on verified hours and the agreed hourly rate. Payments are processed securely through the platform. Fast, fair, and reliable! 💰",
    image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&h=400&fit=crop",
    icon: DollarSign,
    color: "from-indigo-500 to-indigo-600",
    emoji: "💵",
  },
];

const BENEFITS = [
  {
    title: "Eliminate Time Theft",
    description: "Only pay for hours worked at the job site",
    icon: ShieldCheck,
    stat: "100%",
    statLabel: "Accuracy",
  },
  {
    title: "Real-Time Transparency",
    description: "See exactly where and when workers are on-site",
    icon: MapPin,
    stat: "24/7",
    statLabel: "Tracking",
  },
  {
    title: "Automated Verification",
    description: "No manual time entry or guesswork",
    icon: Zap,
    stat: "0",
    statLabel: "Manual Entry",
  },
  {
    title: "Cost Savings",
    description: "Reduce labor costs by up to 15% by preventing time theft",
    icon: DollarSign,
    stat: "15%",
    statLabel: "Savings",
  },
];

export default function HowTimeKeepingWorks() {
  return (
    <div className="min-h-screen bg-white font-sans overflow-x-hidden">
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
            transform: translateY(-15px);
          }
        }
        @keyframes slide-in-left {
          from {
            opacity: 0;
            transform: translateX(-50px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes slide-in-right {
          from {
            opacity: 0;
            transform: translateX(50px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(0, 168, 107, 0.3);
          }
          50% {
            box-shadow: 0 0 40px rgba(0, 168, 107, 0.6);
          }
        }
        @keyframes bounce-in {
          0% {
            opacity: 0;
            transform: translateY(30px) scale(0.9);
          }
          50% {
            transform: translateY(-10px) scale(1.05);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.8s ease-out;
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.8s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.6s ease-out;
        }
        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }
        .animate-bounce-in {
          animation: bounce-in 0.8s ease-out;
        }
        .gradient-text {
          background: linear-gradient(135deg, #00A86B 0%, #008A57 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>
      
      <Navigation />
      
      {/* Hero Section - Energetic */}
      <section className="pt-20 sm:pt-24 md:pt-28 pb-16 sm:pb-20 bg-gradient-to-br from-[#E6F7F0] via-[#CCF0E0] to-[#B8E8D0] border-b-4 border-[#00A86B] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-32 h-32 bg-[#00A86B] rounded-full blur-3xl animate-float"></div>
          <div className="absolute bottom-10 right-10 w-40 h-40 bg-[#00A86B] rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }}></div>
          <div className="absolute top-1/2 left-1/2 w-36 h-36 bg-[#00A86B] rounded-full blur-3xl animate-float" style={{ animationDelay: '0.5s' }}></div>
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-8 animate-bounce-in">
            <div className="inline-block mb-6">
              <span className="bg-[#00A86B] text-white px-6 py-2 rounded-full text-sm uppercase tracking-wider font-bold shadow-lg animate-pulse-glow">
                🚀 Revolutionary Technology
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              <span className="gradient-text">How Our Time Keeping</span>
              <br />
              <span className="taskrabbit-text">Works - Complete Guide!</span>
            </h1>
            <p className="text-xl sm:text-2xl taskrabbit-text-muted max-w-3xl mx-auto mb-8 font-medium">
              Discover the <span className="taskrabbit-green font-bold">game-changing</span> geolocation technology that's revolutionizing how businesses track time and prevent theft! 💪
            </p>
            <div className="flex items-center justify-center gap-2 text-2xl animate-float">
              <Rocket className="w-8 h-8 taskrabbit-green" />
              <span className="text-3xl">✨</span>
              <Sparkles className="w-8 h-8 taskrabbit-green" />
            </div>
          </div>
        </div>
      </section>

      {/* Steps Section - Animated */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 taskrabbit-text">
              The <span className="gradient-text">7-Step Process</span> That Changes Everything! 🎯
            </h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              From arrival to payment - see how our cutting-edge system works
            </p>
          </div>

          <div className="space-y-20">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isEven = index % 2 === 0;
              
              return (
                <div
                  key={index}
                  className={`grid lg:grid-cols-2 gap-12 items-center ${
                    isEven ? '' : 'lg:flex-row-reverse'
                  }`}
                >
                  {/* Content */}
                  <div className={`${isEven ? 'animate-slide-in-left' : 'animate-slide-in-right'}`} style={{ animationDelay: `${index * 0.2}s` }}>
                    <div className="flex items-center gap-4 mb-6">
                      <div className={`w-16 h-16 bg-gradient-to-br ${step.color} rounded-full flex items-center justify-center font-bold text-2xl text-white shadow-xl animate-scale-in`} style={{ animationDelay: `${index * 0.2 + 0.3}s` }}>
                        {step.letter}
                      </div>
                      <div>
                        <h3 className="text-2xl sm:text-3xl font-bold taskrabbit-text mb-2">
                          {step.title} {step.emoji}
                        </h3>
                        <div className={`w-20 h-1 bg-gradient-to-r ${step.color} rounded-full`}></div>
                      </div>
                    </div>
                    <p className="text-lg taskrabbit-text-muted leading-relaxed mb-6">
                      {step.description}
                    </p>
                    <div className={`inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r ${step.color} text-white rounded-full font-semibold text-sm`}>
                      <Icon className="w-5 h-5" />
                      <span>Step {step.letter}</span>
                    </div>
                  </div>

                  {/* Image */}
                  <div className={`${isEven ? 'animate-slide-in-right' : 'animate-slide-in-left'} relative`} style={{ animationDelay: `${index * 0.2 + 0.1}s` }}>
                    <div className="relative group">
                      <div className={`absolute inset-0 bg-gradient-to-br ${step.color} rounded-2xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity`}></div>
                      <img 
                        src={step.image}
                        alt={step.title}
                        className="relative w-full h-64 sm:h-80 object-cover rounded-2xl border-4 border-white shadow-2xl transform group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className={`absolute -bottom-4 -right-4 w-20 h-20 bg-gradient-to-br ${step.color} rounded-full flex items-center justify-center shadow-xl animate-float`} style={{ animationDelay: `${index * 0.3}s` }}>
                        <Icon className="w-10 h-10 text-white" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section - Energetic */}
      <section className="py-16 sm:py-20 bg-gradient-to-br from-[#E6F7F0] to-[#CCF0E0] border-y-4 border-[#00A86B] relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 left-0 w-full h-full" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0, 168, 107, 0.1) 10px, rgba(0, 168, 107, 0.1) 20px)' }}></div>
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16 animate-bounce-in">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 taskrabbit-text">
              Incredible <span className="gradient-text">Benefits</span> You'll Love! 🎉
            </h2>
            <p className="text-lg taskrabbit-text-muted max-w-2xl mx-auto">
              See why thousands of businesses trust our time keeping system
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {BENEFITS.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={index}
                  className="bg-white p-6 rounded-2xl border-4 border-[#00A86B] hover:border-[#008A57] transition-all hover:shadow-2xl transform hover:scale-105 animate-scale-in group"
                  style={{ animationDelay: `${index * 0.15}s` }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-14 h-14 bg-gradient-to-br from-[#00A86B] to-[#008A57] rounded-xl flex items-center justify-center group-hover:rotate-12 transition-transform`}>
                      <Icon className="w-7 h-7 text-white" />
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold gradient-text">{benefit.stat}</div>
                      <div className="text-xs taskrabbit-text-muted uppercase tracking-wider">{benefit.statLabel}</div>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold taskrabbit-text mb-2">{benefit.title}</h3>
                  <p className="text-sm taskrabbit-text-muted leading-relaxed">{benefit.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section - Super Energetic */}
      <section className="py-20 sm:py-24 bg-gradient-to-br from-[#00A86B] via-[#008A57] to-[#006B44] relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full blur-3xl animate-float"></div>
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }}></div>
        </div>
        
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="mb-8 animate-bounce-in">
            <div className="text-6xl mb-4 animate-float">🚀</div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-white">
              Ready to Transform Your Business?
            </h2>
            <p className="text-xl text-white/90 mb-8 font-medium">
              Join thousands of companies saving time and money with our revolutionary time keeping system! 💪✨
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-scale-in" style={{ animationDelay: '0.3s' }}>
            <Link href="/company-onboarding">
              <button className="px-10 py-4 bg-white text-[#00A86B] rounded-xl font-bold text-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-2xl inline-flex items-center gap-2">
                Get Started Now!
                <ArrowRight className="h-5 w-5" />
              </button>
            </Link>
            <Link href="/contact">
              <button className="px-10 py-4 bg-transparent text-white border-3 border-white rounded-xl font-bold text-lg hover:bg-white/10 transition-all transform hover:scale-105 inline-flex items-center gap-2">
                Learn More
                <ArrowRight className="h-5 w-5" />
              </button>
            </Link>
          </div>
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
