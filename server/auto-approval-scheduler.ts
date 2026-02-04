import { processAutoApprovals } from "./services/autoApprovalService";

export function startAutoApprovalScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
  
  console.log("[AutoApproval] Starting auto-approval scheduler (checking every minute)");
  
  async function runAutoApprovalCheck() {
    try {
      const result = await processAutoApprovals();
      if (result.processed > 0) {
        console.log(`[AutoApproval] Complete. Approved: ${result.processed}, Paid: ${result.paid}, Failed: ${result.failed}`);
      }
    } catch (error: any) {
      console.error("[AutoApproval] Error running auto-approval check:", error.message);
    }
  }
  
  setInterval(runAutoApprovalCheck, CHECK_INTERVAL_MS);
  
  setTimeout(runAutoApprovalCheck, 5000);
}
