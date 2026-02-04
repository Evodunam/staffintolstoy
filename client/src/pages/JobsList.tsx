import { Navigation } from "@/components/Navigation";
import { useJobs } from "@/hooks/use-jobs";
import { JobCard } from "@/components/JobCard";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trades } from "@shared/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function JobsList() {
  const { t } = useTranslation("jobsList");
  const [tradeFilter, setTradeFilter] = useState<string>("");
  const [locationFilter, setLocationFilter] = useState<string>("");
  
  const { data: jobs, isLoading } = useJobs({ 
    trade: tradeFilter === "all" ? undefined : tradeFilter, 
    location: locationFilter 
  });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <div className="bg-secondary/30 py-12 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-6 font-display">{t("findYourNextProject")}</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder={t("searchLocation")} 
                className="pl-10 h-12 bg-background"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
              />
            </div>
            
            <Select value={tradeFilter} onValueChange={setTradeFilter}>
              <SelectTrigger className="h-12 bg-background">
                <SelectValue placeholder={t("allTrades")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTrades")}</SelectItem>
                {trades.map(trade => (
                  <SelectItem key={trade} value={trade}>{trade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : jobs?.length === 0 ? (
          <div className="text-center py-20">
            <h3 className="text-xl font-bold mb-2">{t("noJobsFound")}</h3>
            <p className="text-muted-foreground">{t("tryAdjustingFilters")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs?.map(job => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
