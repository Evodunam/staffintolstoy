import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface ReleaseNote {
  id: number;
  title: string;
  bodyHtml: string;
  audience: string;
  publishedAt: string | null;
}
interface ReleaseNotesResponse {
  notes: ReleaseNote[];
  unreadCount: number;
}

/**
 * Bell-icon dropdown that surfaces in-product release notes / changelog.
 * Polls every 5 minutes; shows a numeric badge for unread published notes.
 * Marking-as-read happens once when the drawer opens.
 */
export function ReleaseNotesBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery<ReleaseNotesResponse>({
    queryKey: ["/api/release-notes"],
    queryFn: async () => {
      const res = await fetch("/api/release-notes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && data?.unreadCount && data.unreadCount > 0) {
      // Fire-and-forget mark-read — UI updates instantly via cache invalidation.
      void apiRequest("POST", "/api/release-notes/mark-read", {}).then(() => {
        qc.invalidateQueries({ queryKey: ["/api/release-notes"] });
      });
    }
  };

  const unread = data?.unreadCount ?? 0;
  const notes = data?.notes ?? [];

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="What's new">
          <Megaphone className="w-5 h-5" />
          {unread > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px]">
              {unread > 9 ? "9+" : unread}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> What's new</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No release notes yet.</p>
          ) : notes.map((n) => (
            <article key={n.id} className="border-b border-border pb-4 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h3 className="font-medium">{n.title}</h3>
                {n.publishedAt && (
                  <time className="text-xs text-muted-foreground shrink-0">
                    {new Date(n.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </time>
                )}
              </div>
              <div className="prose prose-sm max-w-none dark:prose-invert text-sm" dangerouslySetInnerHTML={{ __html: n.bodyHtml }} />
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

