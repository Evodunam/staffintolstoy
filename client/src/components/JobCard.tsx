import { type Job, type Profile } from "@shared/schema";
import { format } from "date-fns";
import { MapPin, Clock, DollarSign, Calendar } from "lucide-react";
import { Link } from "wouter";
import { getDisplayJobTitle } from "@/lib/job-display";
import { workerFacingJobHourlyCents } from "@shared/platformPayPolicy";

interface JobCardProps {
  job: Job & { companyName?: string | null; company?: Profile };
}

export function JobCard({ job }: JobCardProps) {
  const companyName = job.companyName || job.company?.companyName || "Anonymous Company";
  const wf = workerFacingJobHourlyCents(job.hourlyRate);
  const displayHr = wf > 0 ? wf / 100 : job.hourlyRate / 100;

  return (
    <Link href={`/jobs/${job.id}`}>
      <div className="card-premium cursor-pointer group h-full flex flex-col justify-between hover-card-lift hover-border rounded-xl border">
        <div>
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground mb-2 capitalize hover-badge">
                {job.trade}
              </span>
              <h3 className="text-xl font-bold group-hover:text-primary/80 transition-colors">
                {getDisplayJobTitle(job)}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">{companyName}</p>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-lg font-bold">
                ${displayHr.toFixed(2)}/hr
              </span>
              <span className="text-xs text-muted-foreground">Fixed Rate</span>
            </div>
          </div>
          
          <p className="text-muted-foreground line-clamp-3 mb-6 text-sm">
            {job.description}
          </p>
        </div>

        <div className="border-t border-border/50 pt-4 mt-auto">
          <div className="grid grid-cols-2 gap-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 hover-icon" />
              <span className="truncate">{job.location}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 hover-icon" />
              <span>{format(new Date(job.startDate), "MMM d, yyyy")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 hover-icon" />
              <span>{job.estimatedHours} hrs est.</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
