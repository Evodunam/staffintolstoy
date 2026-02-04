"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowDown, ArrowUp } from "lucide-react";

interface Testimonial {
  name: string;
  company: string;
  service: string;
  text: string;
  rating: number;
  avatar?: string;
}

interface StatItem {
  percentage: string;
  label: string;
  isIncrease: boolean;
  logo: string;
}

interface TestimonialSectionProps {
  testimonials: Testimonial[];
  stats: StatItem[];
}

export default function TestimonialSection({ testimonials, stats }: TestimonialSectionProps) {
  // Get first 2 testimonials for the heading avatars
  const headingTestimonials = testimonials.slice(0, 2);
  
  // Use Unsplash images for avatars if not provided
  const getAvatarUrl = (index: number) => {
    const avatars = [
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=faces",
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=faces",
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=faces",
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=faces",
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=faces",
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=faces",
    ];
    return avatars[index % avatars.length];
  };

  return (
    <div className="bg-gray-50 w-full py-8 sm:py-12 md:py-16 px-4 md:px-8 lg:px-16 relative">
      <div className="max-w-6xl mx-auto">
        {/* Community Badge */}
        <div className="flex justify-center mb-4 sm:mb-6 md:mb-8">
          <div className="bg-[#f1efec] text-black px-4 py-1 rounded-full text-xs uppercase tracking-wider font-medium">
            Our Community
          </div>
        </div>

        {/* Main Heading with Images */}
        <div className="text-center max-w-screen-xl mx-auto relative text-neutral-900 mb-4 sm:mb-6 md:mb-8">
          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-semibold leading-tight mb-1 sm:mb-2">
            We make it easy for <br className="sm:hidden" />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-block mx-1 sm:mx-2 align-middle relative">
                    <div className="relative overflow-hidden w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 origin-center transition-all duration-300 md:hover:w-36 hover:h-24 rounded-full border-2 border-white shadow-md">
                      <img
                        src={headingTestimonials[0]?.avatar || getAvatarUrl(0)}
                        alt={headingTestimonials[0]?.name || "Person"}
                        className="object-cover w-full h-full"
                        style={{ objectPosition: "center" }}
                      />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-xs bg-white text-black p-4 rounded-lg shadow-lg border-none z-50"
                >
                  <p className="mb-2 text-sm">
                    "{headingTestimonials[0]?.text || ''}"
                  </p>
                  <p className="font-medium text-sm">{headingTestimonials[0]?.name || ''}</p>
                  <p className="text-xs text-gray-600">{headingTestimonials[0]?.company || ''}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            companies and
          </h1>

          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold leading-tight mb-1 sm:mb-2">
            and their
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-block mx-1 sm:mx-2 align-middle">
                    <div className="relative overflow-hidden w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 origin-center transition-all duration-300 lg:hover:w-36 md:hover:w-24 hover:h-20 rounded-full border-2 border-white shadow-md">
                      <img
                        src={headingTestimonials[1]?.avatar || getAvatarUrl(1)}
                        alt={headingTestimonials[1]?.name || "Employee"}
                        className="object-cover w-full h-full"
                      />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-xs bg-white text-black p-4 rounded-lg shadow-lg border-none z-50"
                >
                  <p className="mb-2 text-sm">
                    "{headingTestimonials[1]?.text || ''}"
                  </p>
                  <p className="font-medium text-sm">{headingTestimonials[1]?.name || ''}</p>
                  <p className="text-xs text-gray-600">{headingTestimonials[1]?.company || ''}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            employees to contribute and
          </h1>
          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold text-[#333333] leading-tight">
            manage staffing needs
          </h1>
        </div>
        
        {/* Stats Section */}
        <div className="sm:flex grid grid-cols-2 gap-3 sm:gap-4 md:gap-8 bg-neutral-100 mt-4 sm:mt-6 md:mt-8 w-full mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-5 md:py-6 border rounded-md border-neutral-200">
          {stats.map((stat, index) => (
            <div
              key={stat?.label}
              className="flex-1 flex gap-2 sm:gap-4 pl-4 sm:pl-6 md:pl-10 relative min-h-[50px] sm:min-h-[60px] md:min-h-[80px]"
            >
              {index !== 0 && (
                <div className="w-0.5 h-9 border border-dashed border-neutral-200 absolute left-0 hidden sm:block" />
              )}
              <div className="w-full h-full group relative flex items-center justify-center">
                <div className="w-[85%] h-8 sm:h-10 bg-gray-300 rounded flex items-center justify-center mx-auto translate-y-0 group-hover:-translate-y-12 opacity-100 group-hover:opacity-0 transition-all duration-300 ease-out">
                  <div className="w-full h-full bg-gradient-to-r from-[#00A86B] to-[#008A57] rounded"></div>
                </div>
                <div className="absolute left-0 top-6 sm:top-8 opacity-0 flex flex-col items-center justify-center w-full group-hover:-top-3.5 group-hover:opacity-100 transition-all duration-300 ease-out">
                  <div className="flex items-center justify-center gap-2 relative">
                    {stat.isIncrease ? (
                      <ArrowUp className="md:w-6 md:h-6 w-4 h-4 text-green-500" />
                    ) : (
                      <ArrowDown className="md:w-6 md:h-6 w-4 h-4 text-gray-800" />
                    )}
                    <span className="md:text-4xl text-2xl font-semibold text-gray-800">
                      {stat.percentage}
                    </span>
                  </div>
                  <p className="text-gray-800 md:text-sm text-xs text-center capitalize mt-1 px-2">
                    {stat.label}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
