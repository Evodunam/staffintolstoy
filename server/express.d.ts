import type { Profile } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      /** Current user's profile (set by attachProfile middleware; from session or DB). */
      profile?: Profile | undefined;
    }
  }
}

export {};
