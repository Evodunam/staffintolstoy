import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useProfile } from "@/hooks/use-profiles";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Star, Loader2, ExternalLink, CheckCircle } from "lucide-react";
import { format } from "date-fns";

const BACK_URL = "/dashboard/menu";

/** Embeddable reviews content for menu right panel or standalone page. */
export function ReviewsContent({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [syncingGoogleReviews, setSyncingGoogleReviews] = useState(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  
  const { data: reviewsData, isLoading: reviewsLoading, refetch: refetchReviews } = useQuery({
    queryKey: ["/api/reviews", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const response = await fetch(`/api/reviews?revieweeId=${profile.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch reviews");
      return response.json();
    },
    enabled: !!profile?.id,
  });

  const reviews = reviewsData?.reviews || [];
  const averageRating = reviewsData?.averageRating || 0;
  const totalReviews = reviewsData?.totalReviews || 0;
  const isGoogleConnected = !!profile?.googleBusinessAccessToken;
  const isEmployee = profile?.teamId !== null;

  const handleConnectGoogle = () => {
    setIsConnectingGoogle(true);
    window.location.href = "/api/reviews/connect-google";
  };

  const handleSyncGoogleReviews = async () => {
    if (!isGoogleConnected) {
      handleConnectGoogle();
      return;
    }
    setSyncingGoogleReviews(true);
    try {
      const response = await fetch("/api/reviews/sync-google", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to sync Google reviews");
      toast({ title: "Reviews Synced", description: `Successfully synced ${data.syncedCount || 0} Google reviews` });
      refetchReviews();
    } catch (error: any) {
      toast({ title: "Sync Failed", description: error.message || "Failed to sync Google reviews. Please try again.", variant: "destructive" });
    } finally {
      setSyncingGoogleReviews(false);
    }
  };

  const main = (
    <div className={embedded ? "space-y-6" : "container mx-auto px-4 py-6 space-y-6 max-w-4xl"}>
      {/* Google Business card first, above rating and reviews */}
      {!isEmployee && (
        <Card className="p-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Google Business Reviews</Label>
            {isGoogleConnected ? (
              <>
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>Connected to Google Business</span>
                </div>
                <Button onClick={handleSyncGoogleReviews} disabled={syncingGoogleReviews} size="sm" className="w-full">
                  {syncingGoogleReviews ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing...</> : <><ExternalLink className="w-4 h-4 mr-2" />Sync Reviews Now</>}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Connect your Google Business account to automatically sync reviews</p>
                <Button onClick={handleConnectGoogle} disabled={isConnectingGoogle} size="sm" className="w-full">
                  {isConnectingGoogle ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</> : <><ExternalLink className="w-4 h-4 mr-2" />Connect Google Business</>}
                </Button>
              </>
            )}
          </div>
        </Card>
      )}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star key={star} className={`w-5 h-5 ${star <= Math.round(averageRating) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
              ))}
            </div>
            <span className="text-lg font-semibold">{averageRating.toFixed(1)}</span>
            <span className="text-muted-foreground">({totalReviews} {totalReviews === 1 ? "review" : "reviews"})</span>
          </div>
        </div>
      </div>
      {reviewsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Star className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">No reviews yet</h3>
            <p className="text-sm text-muted-foreground">
              {isEmployee ? "Your reviews from completed jobs will appear here" : "Reviews from completed jobs and synced Google reviews will appear here"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reviews.map((review: any) => (
            <Card key={review.id} className="p-4">
              <div className="flex gap-4">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={review.reviewer?.avatarUrl || undefined} />
                  <AvatarFallback>{review.reviewer?.firstName?.[0]}{review.reviewer?.lastName?.[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {review.reviewer?.firstName} {review.reviewer?.lastName}
                          {review.isGoogleReview && <Badge variant="outline" className="ml-2 text-xs">Google</Badge>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star key={star} className={`w-3 h-3 ${star <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {review.createdAt ? format(new Date(review.createdAt), "MMM d, yyyy") : review.googleReviewDate ? format(new Date(review.googleReviewDate), "MMM d, yyyy") : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  {(review.qualityRating || review.punctualityRating || review.communicationRating || review.effortRating) && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {review.qualityRating && <div><span className="text-muted-foreground">Quality:</span> <span className="font-medium">{review.qualityRating}/5</span></div>}
                      {review.punctualityRating && <div><span className="text-muted-foreground">Punctuality:</span> <span className="font-medium">{review.punctualityRating}/5</span></div>}
                      {review.communicationRating && <div><span className="text-muted-foreground">Communication:</span> <span className="font-medium">{review.communicationRating}/5</span></div>}
                      {review.effortRating && <div><span className="text-muted-foreground">Effort:</span> <span className="font-medium">{review.effortRating}/5</span></div>}
                    </div>
                  )}
                  {review.comment && <p className="text-sm">{review.comment}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  if (embedded) return <div className="pt-2 pb-4">{main}</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(BACK_URL)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Reviews</h1>
            <p className="text-xs text-muted-foreground">View your reviews and ratings</p>
          </div>
        </div>
      </header>
      <main>{main}</main>
    </div>
  );
}

export default function ReviewsPage() {
  return <ReviewsContent />;
}
