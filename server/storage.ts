import { db } from "./db";
import { 
  profiles, jobs, applications, jobAssignments, reviews, users, companyLocations, teamInvites, timesheets, companyTeamMembers,
  adminStrikes, jobSuspensions, billingActions, adminActivityLog, workerStatuses, companyStatuses,
  companyPaymentMethods, companyTransactions, workerPayouts, payoutAccounts, invoices, invoiceItems, workerDismissedJobs,
  teams, workerTeamMembers, savedTeamMembers, timesheetReports, directJobInquiries, jobMessages,
  type Profile, type InsertProfile,
  type Job, type InsertJob,
  type Application, type InsertApplication,
  type Review, type InsertReview,
  type User,
  type CompanyLocation, type InsertCompanyLocation,
  type TeamInvite, type InsertTeamInvite,
  type Timesheet, type InsertTimesheet,
  type CompanyTeamMember, type InsertCompanyTeamMember,
  type AdminStrike, type InsertAdminStrike,
  type JobSuspension, type InsertJobSuspension,
  type BillingAction, type InsertBillingAction,
  type AdminActivityLog, type InsertAdminActivityLog,
  type WorkerStatus, type InsertWorkerStatus,
  type CompanyStatus, type InsertCompanyStatus,
  type CompanyPaymentMethod, type InsertCompanyPaymentMethod,
  type CompanyTransaction, type InsertCompanyTransaction,
  type WorkerPayout, type InsertWorkerPayout,
  type PayoutAccount, type InsertPayoutAccount,
  type Invoice, type InsertInvoice,
  type InvoiceItem, type InsertInvoiceItem,
  type Team, type InsertTeam,
  type WorkerTeamMember, type InsertWorkerTeamMember,
  type SavedTeamMember, type InsertSavedTeamMember,
  type TimesheetReport, type InsertTimesheetReport,
  type DirectJobInquiry, type InsertDirectJobInquiry,
  type JobMessage, type InsertJobMessage,
  affiliates,
  type Affiliate, type InsertAffiliate,
  affiliateLeads,
  type AffiliateLead, type InsertAffiliateLead,
  type AffiliateLeadActivityItem,
  platformConfig,
  type PlatformConfig, type InsertPlatformConfig,
  affiliateCommissions,
  type AffiliateCommission, type InsertAffiliateCommission
} from "@shared/schema";
import { eq, and, desc, isNull, sql, or, ne, inArray } from "drizzle-orm";

export interface IStorage {
  // Profiles
  getProfile(id: number): Promise<Profile | undefined>;
  getProfileByUserId(userId: string): Promise<Profile | undefined>;
  createProfile(profile: InsertProfile): Promise<Profile>;
  updateProfile(id: number, profile: Partial<InsertProfile>): Promise<Profile>;

  // Affiliates
  getAffiliateByUserId(userId: string): Promise<Affiliate | undefined>;
  getAffiliateByCode(code: string): Promise<Affiliate | undefined>;
  getAffiliate(id: number): Promise<Affiliate | undefined>;
  getAllAffiliates(): Promise<Affiliate[]>;
  createAffiliate(affiliate: InsertAffiliate): Promise<Affiliate>;
  updateAffiliate(id: number, updates: Partial<InsertAffiliate>): Promise<Affiliate>;
  getProfilesByReferredByAffiliateId(affiliateId: number): Promise<Profile[]>;

  getAffiliateLeadsByAffiliateId(affiliateId: number): Promise<AffiliateLead[]>;
  createAffiliateLead(lead: InsertAffiliateLead): Promise<AffiliateLead>;
  updateAffiliateLead(id: number, updates: Partial<InsertAffiliateLead>): Promise<AffiliateLead>;
  getAffiliateLeadByToken(token: string): Promise<AffiliateLead | undefined>;
  getAffiliateLeadById(id: number): Promise<AffiliateLead | undefined>;
  getAffiliateLeadActivities(leadId: number): Promise<AffiliateLeadActivityItem[]>;
  createAffiliateLeadActivity(leadId: number, body: string): Promise<AffiliateLeadActivityItem>;

  getPlatformConfig(): Promise<PlatformConfig | undefined>;
  updatePlatformConfig(id: number, updates: Partial<InsertPlatformConfig>): Promise<PlatformConfig>;

  createAffiliateCommission(commission: InsertAffiliateCommission): Promise<AffiliateCommission>;
  getAffiliateCommissionByTimesheetId(timesheetId: number): Promise<AffiliateCommission | undefined>;
  getAffiliateCommissionByAffiliateAndTimesheet(affiliateId: number, timesheetId: number): Promise<AffiliateCommission | undefined>;
  getAffiliateCommissionsByAffiliateId(affiliateId: number): Promise<AffiliateCommission[]>;
  updateAffiliateCommission(id: number, updates: Partial<InsertAffiliateCommission>): Promise<AffiliateCommission>;
  
  // Jobs
  getJob(id: number): Promise<Job | undefined>;
  getJobs(filters?: { trade?: string, location?: string }): Promise<(Job & { companyName: string | null })[]>;
  createJob(job: InsertJob): Promise<Job>;
  updateJobStatus(id: number, status: string): Promise<Job>;
  getCompanyJobs(companyId: number): Promise<Job[]>;
  
  // Applications
  createApplication(application: InsertApplication): Promise<Application>;
  getJobApplications(jobId: number): Promise<(Application & { worker: Profile })[]>;
  /** Batch: applications for multiple jobs (same join as getJobApplications). Use for GET /api/company/jobs to avoid N+1. */
  getJobApplicationsForJobIds(jobIds: number[]): Promise<(Application & { worker: Profile })[]>;
  getApplication(id: number): Promise<Application | undefined>;
  updateApplicationStatus(id: number, status: string): Promise<Application>;
  getWorkerApplications(workerId: number): Promise<(Application & { job: Job; teamMember?: WorkerTeamMember | null; company?: { id: number; companyName: string | null; phone: string | null; avatarUrl: string | null; companyLogo: string | null; firstName: string | null; lastName: string | null } | null })[]>;
  deleteApplication(id: number): Promise<void>;
  
  // Company Locations
  getCompanyLocation(id: number): Promise<CompanyLocation | undefined>;
  getCompanyLocations(profileId: number): Promise<CompanyLocation[]>;
  createCompanyLocation(location: InsertCompanyLocation): Promise<CompanyLocation>;
  updateCompanyLocation(id: number, updates: Partial<InsertCompanyLocation>): Promise<CompanyLocation>;
  deleteCompanyLocation(id: number): Promise<void>;
  
  // Team Invites
  getTeamInvite(id: number): Promise<TeamInvite | undefined>;
  getTeamInviteByToken(token: string): Promise<TeamInvite | undefined>;
  getTeamInviteByEmail(profileId: number, email: string): Promise<TeamInvite | undefined>;
  getTeamInvites(profileId: number): Promise<TeamInvite[]>;
  createTeamInvite(invite: InsertTeamInvite): Promise<TeamInvite>;
  updateTeamInvite(id: number, updates: Partial<InsertTeamInvite>): Promise<TeamInvite>;
  deleteTeamInvite(id: number): Promise<void>;
  
  // Company Team Members
  getCompanyTeamMember(id: number): Promise<CompanyTeamMember | undefined>;
  getCompanyTeamMemberByUserId(companyProfileId: number, userId: string): Promise<CompanyTeamMember | undefined>;
  getCompanyTeamMembers(companyProfileId: number): Promise<CompanyTeamMember[]>;
  createCompanyTeamMember(member: InsertCompanyTeamMember): Promise<CompanyTeamMember>;
  updateCompanyTeamMember(id: number, updates: Partial<InsertCompanyTeamMember>): Promise<CompanyTeamMember>;
  deleteCompanyTeamMember(id: number): Promise<void>;
  
  // Timesheets
  getTimesheet(id: number): Promise<Timesheet | undefined>;
  /** Batch: timesheets for multiple job IDs. Use for GET /api/company/jobs to avoid N+1. */
  getTimesheetsByJobIds(jobIds: number[]): Promise<Timesheet[]>;
  getActiveTimesheet(workerId: number): Promise<Timesheet | undefined>;
  getActiveTimesheetsForWorker(workerId: number): Promise<Timesheet[]>;
  getActiveTimesheetsForTeamMember(teamMemberId: number): Promise<Timesheet[]>;
  getTimesheetsByCompany(companyId: number, status?: string): Promise<(Timesheet & { worker: Profile; job: Job })[]>;
  getTimesheetsByWorker(workerId: number): Promise<(Timesheet & { company: Profile; job: Job })[]>;
  createTimesheet(timesheet: InsertTimesheet): Promise<Timesheet>;
  updateTimesheet(id: number, updates: Partial<InsertTimesheet> & { approvedAt?: Date; paymentStatus?: string; paymentId?: string; paidAt?: Date }): Promise<Timesheet>;
  
  // Nearby Jobs
  getNearbyJobs(lat: number, lng: number, radiusMiles: number): Promise<Job[]>;
  
  // Admin - Workers
  getAllWorkers(): Promise<Profile[]>;
  getWorkerStatus(workerId: number): Promise<WorkerStatus | undefined>;
  setWorkerStatus(status: InsertWorkerStatus): Promise<WorkerStatus>;
  updateWorkerStatus(workerId: number, updates: Partial<InsertWorkerStatus>): Promise<WorkerStatus>;
  
  // Admin - Companies
  getAllCompanies(): Promise<Profile[]>;
  getCompanyStatus(companyId: number): Promise<CompanyStatus | undefined>;
  setCompanyStatus(status: InsertCompanyStatus): Promise<CompanyStatus>;
  updateCompanyStatusRecord(companyId: number, updates: Partial<InsertCompanyStatus>): Promise<CompanyStatus>;
  
  // Admin - Jobs
  getAllJobs(): Promise<(Job & { companyName: string | null })[]>;
  updateJob(id: number, updates: Partial<Job>): Promise<Job>;
  getJobSuspensions(jobId: number): Promise<JobSuspension[]>;
  createJobSuspension(suspension: InsertJobSuspension): Promise<JobSuspension>;
  
  // Admin - Strikes
  getWorkerStrikes(workerId: number): Promise<AdminStrike[]>;
  getAllStrikes(): Promise<(AdminStrike & { worker: Profile })[]>;
  createStrike(strike: InsertAdminStrike): Promise<AdminStrike>;
  resolveStrike(id: number, resolvedBy: string, notes?: string): Promise<AdminStrike>;
  
  // Admin - Billing
  getBillingActions(entityType?: string, entityId?: number): Promise<BillingAction[]>;
  createBillingAction(action: InsertBillingAction): Promise<BillingAction>;
  
  // Admin - Activity Log
  logAdminActivity(activity: InsertAdminActivityLog): Promise<AdminActivityLog>;
  getAdminActivityLog(limit?: number): Promise<AdminActivityLog[]>;
  createAdminActivityLog(activity: InsertAdminActivityLog): Promise<AdminActivityLog>;
  
  // Company Payment Methods
  getCompanyPaymentMethod(id: number): Promise<CompanyPaymentMethod | undefined>;
  getCompanyPaymentMethodByStripePmId(stripePaymentMethodId: string): Promise<CompanyPaymentMethod | undefined>;
  getCompanyPaymentMethods(profileId: number): Promise<CompanyPaymentMethod[]>;
  getPrimaryPaymentMethod(profileId: number): Promise<CompanyPaymentMethod | undefined>;
  createCompanyPaymentMethod(method: InsertCompanyPaymentMethod): Promise<CompanyPaymentMethod>;
  updateCompanyPaymentMethod(id: number, updates: Partial<InsertCompanyPaymentMethod>): Promise<CompanyPaymentMethod>;
  deleteCompanyPaymentMethod(id: number): Promise<void>;
  
  // Company Transactions
  getCompanyTransactions(profileId: number): Promise<CompanyTransaction[]>;
  createCompanyTransaction(transaction: InsertCompanyTransaction): Promise<CompanyTransaction>;
  
  // Worker Payouts
  getWorkerPayouts(workerId: number): Promise<WorkerPayout[]>;
  getWorkerPayoutsByStatus(workerId: number, status: string): Promise<WorkerPayout[]>;
  /** Latest payout row for a timesheet (if any). */
  getWorkerPayoutByTimesheetId(timesheetId: number): Promise<WorkerPayout | undefined>;
  createWorkerPayout(payout: InsertWorkerPayout): Promise<WorkerPayout>;
  updateWorkerPayout(id: number, updates: Partial<InsertWorkerPayout>): Promise<WorkerPayout>;
  
  // Payout Accounts
  getPayoutAccounts(profileId: number): Promise<PayoutAccount[]>;
  createPayoutAccount(account: InsertPayoutAccount): Promise<PayoutAccount>;
  
  // Profile by email
  getProfileByEmail(email: string): Promise<Profile | undefined>;
  
  // Applications by job
  getApplicationsByJob(jobId: number): Promise<Application[]>;
  
  // Invoices
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined>;
  getInvoicesByCompany(companyId: number): Promise<Invoice[]>;
  getInvoicesByWorker(workerId: number): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, updates: Partial<InsertInvoice>): Promise<Invoice>;
  getNextInvoiceNumber(): Promise<string>;
  
  // Invoice Items
  getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]>;
  createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem>;
  createInvoiceItems(items: InsertInvoiceItem[]): Promise<InvoiceItem[]>;
  
  // Worker Dismissed Jobs
  getDismissedJobs(workerId: number): Promise<number[]>;
  dismissJob(workerId: number, jobId: number, reason?: string): Promise<void>;
  undismissJob(workerId: number, jobId: number): Promise<void>;
  
  // Saved Team Members (contractors saved by companies; per location when companyLocationId set)
  getSavedTeamMembers(companyId: number, locationId?: number | null): Promise<(SavedTeamMember & { worker: Profile })[]>;
  getSavedTeamMember(companyId: number, workerId: number, locationId?: number | null): Promise<SavedTeamMember | undefined>;
  createSavedTeamMember(member: InsertSavedTeamMember): Promise<SavedTeamMember>;
  updateSavedTeamMember(id: number, updates: Partial<InsertSavedTeamMember>): Promise<SavedTeamMember>;
  deleteSavedTeamMember(id: number): Promise<void>;
  getWorkersWithApprovedJobs(companyId: number): Promise<Profile[]>;
  
  // Timesheet Reports (worker strikes from companies)
  createTimesheetReport(report: InsertTimesheetReport): Promise<TimesheetReport>;
  getTimesheetReports(workerId: number): Promise<(TimesheetReport & { reporter: Profile })[]>;
  getTimesheetReportsByCompany(companyId: number): Promise<TimesheetReport[]>;
  
  // Direct Job Inquiries
  createDirectJobInquiry(inquiry: InsertDirectJobInquiry): Promise<DirectJobInquiry>;
  getDirectJobInquiry(id: number): Promise<DirectJobInquiry | undefined>;
  getDirectJobInquiriesForWorker(workerId: number): Promise<(DirectJobInquiry & { company: Profile })[]>;
  getDirectJobInquiriesForCompany(companyId: number): Promise<(DirectJobInquiry & { worker: Profile })[]>;
  updateDirectJobInquiry(id: number, updates: Partial<DirectJobInquiry>): Promise<DirectJobInquiry>;
  respondToDirectJobInquiry(id: number, status: 'accepted' | 'declined', workerMessage?: string): Promise<DirectJobInquiry>;
  
  // Job Messages (Chat)
  getJobMessages(jobId: number): Promise<(JobMessage & { sender: Profile })[]>;
  createJobMessage(message: InsertJobMessage): Promise<JobMessage>;
  updateJobMessageMetadata(jobId: number, messageId: number, metadataPatch: Record<string, unknown>): Promise<JobMessage | undefined>;
  markMessagesAsRead(jobId: number, readerId: number): Promise<void>;
  getUnreadMessageCount(jobId: number, userId: number): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // Profiles
  async getProfile(id: number): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, id));
    return profile;
  }

  async getProfileByUserId(userId: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    return profile;
  }

  async createProfile(insertProfile: InsertProfile): Promise<Profile> {
    const [profile] = await db.insert(profiles).values(insertProfile).returning();
    return profile;
  }

  async updateProfile(id: number, updates: Partial<InsertProfile>): Promise<Profile> {
    const [profile] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, id))
      .returning();
    return profile;
  }

  // Affiliates
  async getAffiliateByUserId(userId: string): Promise<Affiliate | undefined> {
    const [a] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
    return a;
  }

  async getAffiliateByCode(code: string): Promise<Affiliate | undefined> {
    const [a] = await db.select().from(affiliates).where(eq(affiliates.code, code));
    return a;
  }

  async getAffiliate(id: number): Promise<Affiliate | undefined> {
    const [a] = await db.select().from(affiliates).where(eq(affiliates.id, id));
    return a;
  }

  async getAllAffiliates(): Promise<Affiliate[]> {
    return db.select().from(affiliates);
  }

  async createAffiliate(affiliate: InsertAffiliate): Promise<Affiliate> {
    const [a] = await db.insert(affiliates).values(affiliate).returning();
    return a;
  }

  async updateAffiliate(id: number, updates: Partial<InsertAffiliate>): Promise<Affiliate> {
    const [a] = await db.update(affiliates).set(updates).where(eq(affiliates.id, id)).returning();
    return a;
  }

  async getProfilesByReferredByAffiliateId(affiliateId: number): Promise<Profile[]> {
    return db.select().from(profiles).where(eq(profiles.referredByAffiliateId, affiliateId));
  }

  async getAffiliateLeadsByAffiliateId(affiliateId: number): Promise<AffiliateLead[]> {
    return db.select().from(affiliateLeads).where(eq(affiliateLeads.affiliateId, affiliateId)).orderBy(desc(affiliateLeads.updatedAt));
  }

  async createAffiliateLead(lead: InsertAffiliateLead): Promise<AffiliateLead> {
    const [l] = await db.insert(affiliateLeads).values(lead).returning();
    return l;
  }

  async updateAffiliateLead(id: number, updates: Partial<InsertAffiliateLead>): Promise<AffiliateLead> {
    const [l] = await db.update(affiliateLeads).set({ ...updates, updatedAt: new Date() }).where(eq(affiliateLeads.id, id)).returning();
    return l;
  }

  async getAffiliateLeadByToken(token: string): Promise<AffiliateLead | undefined> {
    const [l] = await db.select().from(affiliateLeads).where(eq(affiliateLeads.token, token));
    return l;
  }

  async getAffiliateLeadById(id: number): Promise<AffiliateLead | undefined> {
    const [l] = await db.select().from(affiliateLeads).where(eq(affiliateLeads.id, id));
    return l;
  }

  async getAffiliateLeadActivities(leadId: number): Promise<AffiliateLeadActivityItem[]> {
    const lead = await this.getAffiliateLeadById(leadId);
    if (!lead?.activityList || !Array.isArray(lead.activityList)) return [];
    return [...lead.activityList].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }

  async createAffiliateLeadActivity(leadId: number, body: string): Promise<AffiliateLeadActivityItem> {
    const lead = await this.getAffiliateLeadById(leadId);
    if (!lead) throw new Error("Lead not found");
    const list: AffiliateLeadActivityItem[] = Array.isArray(lead.activityList) ? [...lead.activityList] : [];
    const item: AffiliateLeadActivityItem = { body, createdAt: new Date().toISOString() };
    list.unshift(item);
    await db.update(affiliateLeads).set({ activityList: list, updatedAt: new Date() }).where(eq(affiliateLeads.id, leadId));
    return item;
  }

  async getPlatformConfig(): Promise<PlatformConfig | undefined> {
    const [c] = await db.select().from(platformConfig).where(eq(platformConfig.id, 1));
    return c;
  }

  async updatePlatformConfig(id: number, updates: Partial<InsertPlatformConfig>): Promise<PlatformConfig> {
    const [c] = await db.update(platformConfig).set({ ...updates, updatedAt: new Date() }).where(eq(platformConfig.id, id)).returning();
    return c!;
  }

  async createAffiliateCommission(commission: InsertAffiliateCommission): Promise<AffiliateCommission> {
    const [c] = await db.insert(affiliateCommissions).values(commission).returning();
    return c!;
  }

  async getAffiliateCommissionByTimesheetId(timesheetId: number): Promise<AffiliateCommission | undefined> {
    const [c] = await db.select().from(affiliateCommissions).where(eq(affiliateCommissions.timesheetId, timesheetId));
    return c;
  }

  async getAffiliateCommissionByAffiliateAndTimesheet(affiliateId: number, timesheetId: number): Promise<AffiliateCommission | undefined> {
    const [c] = await db.select().from(affiliateCommissions).where(and(eq(affiliateCommissions.affiliateId, affiliateId), eq(affiliateCommissions.timesheetId, timesheetId)));
    return c;
  }

  async getAffiliateCommissionsByAffiliateId(affiliateId: number): Promise<AffiliateCommission[]> {
    return db.select().from(affiliateCommissions).where(eq(affiliateCommissions.affiliateId, affiliateId)).orderBy(desc(affiliateCommissions.createdAt));
  }

  async updateAffiliateCommission(id: number, updates: Partial<InsertAffiliateCommission>): Promise<AffiliateCommission> {
    const [c] = await db.update(affiliateCommissions).set(updates).where(eq(affiliateCommissions.id, id)).returning();
    return c!;
  }

  // Jobs
  async getJob(id: number): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job;
  }

  async getJobs(filters?: { trade?: string, location?: string }): Promise<(Job & { companyName: string | null })[]> {
    // Optimized: Use JOIN to fetch company names in a single query instead of N+1 queries
    let query = db
      .select({
        ...jobs,
        companyName: profiles.companyName,
      })
      .from(jobs)
      .leftJoin(profiles, eq(jobs.companyId, profiles.id))
      .where(eq(jobs.status, 'open'))
      .orderBy(desc(jobs.createdAt));
    
    // Apply filters at database level for better performance
    if (filters?.trade) {
      query = query.where(eq(jobs.trade, filters.trade)) as any;
    }
    if (filters?.location) {
      query = query.where(sql`${jobs.location} ILIKE ${`%${filters.location}%`}`) as any;
    }
    
    const result = await query;
    
    // Map results to expected format
    return result.map(row => ({
      ...row,
      companyName: row.companyName || null,
    }));
  }

  async createJob(insertJob: InsertJob): Promise<Job> {
    const [job] = await db.insert(jobs).values(insertJob).returning();
    return job;
  }

  async updateJobStatus(id: number, status: string): Promise<Job> {
    const [job] = await db
      .update(jobs)
      .set({ status: status as any })
      .where(eq(jobs.id, id))
      .returning();
    return job;
  }

  async getCompanyJobs(companyId: number): Promise<Job[]> {
    return await db.select().from(jobs).where(eq(jobs.companyId, companyId)).orderBy(desc(jobs.createdAt));
  }

  // Applications
  async createApplication(insertApplication: InsertApplication): Promise<Application> {
    const [application] = await db.insert(applications).values(insertApplication).returning();
    return application;
  }

  async getJobApplications(jobId: number): Promise<(Application & { worker: Profile })[]> {
    const result = await db
      .select({
        application: applications,
        worker: profiles,
      })
      .from(applications)
      .innerJoin(profiles, eq(applications.workerId, profiles.id))
      .where(eq(applications.jobId, jobId));
      
    return result.map(({ application, worker }) => ({ ...application, worker }));
  }

  async getJobApplicationsForJobIds(jobIds: number[]): Promise<(Application & { worker: Profile })[]> {
    if (jobIds.length === 0) return [];
    const result = await db
      .select({
        application: applications,
        worker: profiles,
      })
      .from(applications)
      .innerJoin(profiles, eq(applications.workerId, profiles.id))
      .where(inArray(applications.jobId, jobIds));
    return result.map(({ application, worker }) => ({ ...application, worker }));
  }

  async getApplication(id: number): Promise<Application | undefined> {
    const [app] = await db.select().from(applications).where(eq(applications.id, id));
    return app;
  }

  async updateApplicationStatus(id: number, status: string): Promise<Application> {
    const statusTyped = status as Application["status"];
    const shouldSetRespondedAt =
      status === "accepted" || status === "rejected" || status === "withdrawn";
    const [app] = await db
      .update(applications)
      .set({
        status: statusTyped,
        ...(shouldSetRespondedAt ? { respondedAt: new Date() } : {}),
      })
      .where(eq(applications.id, id))
      .returning();
    if (status === "accepted" && app) {
      await this.syncJobAssignmentForAcceptedApplication(app);
    }
    return app;
  }

  /** Upsert job_assignments when an application is accepted (hire → assignment record). */
  private async syncJobAssignmentForAcceptedApplication(application: Application): Promise<void> {
    const job = await this.getJob(application.jobId);
    if (!job) return;

    const agreedRate =
      application.proposedRate != null && application.proposedRate > 0
        ? application.proposedRate
        : job.hourlyRate ?? 0;

    await db
      .insert(jobAssignments)
      .values({
        jobId: application.jobId,
        workerId: application.workerId,
        applicationId: application.id,
        agreedRate,
        status: "assigned",
      })
      .onConflictDoUpdate({
        target: [jobAssignments.jobId, jobAssignments.workerId],
        set: {
          applicationId: application.id,
          agreedRate,
          status: "assigned",
        },
      });
  }

  async getWorkerApplications(workerId: number): Promise<(Application & { job: Job; teamMember?: WorkerTeamMember | null; company?: { id: number; companyName: string | null; phone: string | null; avatarUrl: string | null; companyLogo: string | null; firstName: string | null; lastName: string | null } | null })[]> {
    const companyProfiles = db.$with('company_profiles').as(
      db.select({
        id: profiles.id,
        companyName: profiles.companyName,
        phone: profiles.phone,
        avatarUrl: profiles.avatarUrl,
        companyLogo: profiles.companyLogo,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
      }).from(profiles).where(eq(profiles.role, 'company'))
    );

    const result = await db
      .with(companyProfiles)
      .select({
        application: applications,
        job: jobs,
        teamMember: workerTeamMembers,
        companyId: companyProfiles.id,
        companyName: companyProfiles.companyName,
        companyPhone: companyProfiles.phone,
        companyAvatarUrl: companyProfiles.avatarUrl,
        companyLogo: companyProfiles.companyLogo,
        companyFirstName: companyProfiles.firstName,
        companyLastName: companyProfiles.lastName,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(workerTeamMembers, eq(applications.teamMemberId, workerTeamMembers.id))
      .leftJoin(companyProfiles, eq(jobs.companyId, companyProfiles.id))
      .where(eq(applications.workerId, workerId));

    return result.map(({ application, job, teamMember, companyId, companyName, companyPhone, companyAvatarUrl, companyLogo, companyFirstName, companyLastName }) => ({ 
      ...application, 
      job,
      teamMember: teamMember || null,
      company: application.status === 'accepted' && companyId ? {
        id: companyId,
        companyName: companyName,
        phone: companyPhone,
        avatarUrl: companyAvatarUrl,
        companyLogo: companyLogo,
        firstName: companyFirstName,
        lastName: companyLastName,
      } : null
    }));
  }

  async deleteApplication(id: number): Promise<void> {
    // Keep legacy delete path FK-safe:
    // if an assignment references this application, unlink it first.
    await db
      .update(jobAssignments)
      .set({
        applicationId: null,
        status: "cancelled",
        completedAt: new Date(),
      })
      .where(eq(jobAssignments.applicationId, id));

    await db.delete(applications).where(eq(applications.id, id));
  }
  
  // Company Locations
  async getCompanyLocation(id: number): Promise<CompanyLocation | undefined> {
    const [loc] = await db.select().from(companyLocations).where(eq(companyLocations.id, id));
    return loc;
  }
  
  async getCompanyLocations(profileId: number): Promise<CompanyLocation[]> {
    return await db.select().from(companyLocations).where(eq(companyLocations.profileId, profileId));
  }
  
  async createCompanyLocation(location: InsertCompanyLocation): Promise<CompanyLocation> {
    const [loc] = await db.insert(companyLocations).values(location).returning();
    return loc;
  }
  
  async updateCompanyLocation(id: number, updates: Partial<InsertCompanyLocation>): Promise<CompanyLocation> {
    const [loc] = await db.update(companyLocations).set(updates).where(eq(companyLocations.id, id)).returning();
    return loc;
  }
  
  async deleteCompanyLocation(id: number): Promise<void> {
    await db.delete(companyLocations).where(eq(companyLocations.id, id));
  }
  
  // Team Invites
  async getTeamInvite(id: number): Promise<TeamInvite | undefined> {
    const [inv] = await db.select().from(teamInvites).where(eq(teamInvites.id, id));
    return inv;
  }
  
  async getTeamInviteByToken(token: string): Promise<TeamInvite | undefined> {
    const [inv] = await db.select().from(teamInvites).where(eq(teamInvites.token, token));
    return inv;
  }
  
  async getTeamInviteByEmail(profileId: number, email: string): Promise<TeamInvite | undefined> {
    const [inv] = await db.select().from(teamInvites).where(
      and(eq(teamInvites.profileId, profileId), eq(teamInvites.email, email))
    );
    return inv;
  }
  
  async getTeamInvites(profileId: number): Promise<TeamInvite[]> {
    return await db.select().from(teamInvites).where(eq(teamInvites.profileId, profileId));
  }
  
  async createTeamInvite(invite: InsertTeamInvite): Promise<TeamInvite> {
    const [inv] = await db.insert(teamInvites).values(invite).returning();
    return inv;
  }
  
  async updateTeamInvite(id: number, updates: Partial<InsertTeamInvite>): Promise<TeamInvite> {
    const [inv] = await db.update(teamInvites).set(updates as any).where(eq(teamInvites.id, id)).returning();
    return inv;
  }
  
  async deleteTeamInvite(id: number): Promise<void> {
    await db.delete(teamInvites).where(eq(teamInvites.id, id));
  }
  
  // Company Team Members
  async getCompanyTeamMember(id: number): Promise<CompanyTeamMember | undefined> {
    const [member] = await db.select().from(companyTeamMembers).where(eq(companyTeamMembers.id, id));
    return member;
  }
  
  async getCompanyTeamMemberByUserId(companyProfileId: number, userId: string): Promise<CompanyTeamMember | undefined> {
    const [member] = await db.select().from(companyTeamMembers).where(
      and(eq(companyTeamMembers.companyProfileId, companyProfileId), eq(companyTeamMembers.userId, userId))
    );
    return member;
  }
  
  async getCompanyTeamMembers(companyProfileId: number): Promise<CompanyTeamMember[]> {
    return await db.select().from(companyTeamMembers).where(
      and(eq(companyTeamMembers.companyProfileId, companyProfileId), eq(companyTeamMembers.isActive, true))
    );
  }
  
  async createCompanyTeamMember(member: InsertCompanyTeamMember): Promise<CompanyTeamMember> {
    const [m] = await db.insert(companyTeamMembers).values(member).returning();
    return m;
  }
  
  async updateCompanyTeamMember(id: number, updates: Partial<InsertCompanyTeamMember>): Promise<CompanyTeamMember> {
    const [m] = await db.update(companyTeamMembers).set(updates as any).where(eq(companyTeamMembers.id, id)).returning();
    return m;
  }
  
  async deleteCompanyTeamMember(id: number): Promise<void> {
    await db.delete(companyTeamMembers).where(eq(companyTeamMembers.id, id));
  }
  
  // Timesheets
  async getTimesheet(id: number): Promise<Timesheet | undefined> {
    const [ts] = await db.select().from(timesheets).where(eq(timesheets.id, id));
    return ts;
  }

  async getTimesheetsByJobIds(jobIds: number[]): Promise<Timesheet[]> {
    if (jobIds.length === 0) return [];
    return await db.select().from(timesheets).where(inArray(timesheets.jobId, jobIds));
  }
  
  async getActiveTimesheet(workerId: number): Promise<Timesheet | undefined> {
    const [ts] = await db.select().from(timesheets).where(
      and(
        eq(timesheets.workerId, workerId),
        isNull(timesheets.clockOutTime)
      )
    );
    return ts;
  }
  
  async getActiveTimesheetsForWorker(workerId: number): Promise<Timesheet[]> {
    return db.select().from(timesheets).where(
      and(
        eq(timesheets.workerId, workerId),
        isNull(timesheets.clockOutTime)
      )
    );
  }
  
  async getActiveTimesheetsForTeamMember(teamMemberId: number): Promise<Timesheet[]> {
    // Find applications where this team member is assigned and has active timesheets
    const activeApps = await db.select({ jobId: applications.jobId })
      .from(applications)
      .where(
        and(
          eq(applications.teamMemberId, teamMemberId),
          eq(applications.status, "accepted")
        )
      );
    
    if (activeApps.length === 0) return [];
    
    const jobIds = activeApps.map(a => a.jobId);
    return db.select().from(timesheets).where(
      and(
        inArray(timesheets.jobId, jobIds),
        isNull(timesheets.clockOutTime)
      )
    );
  }
  
  async getTimesheetsByCompany(companyId: number, status?: string): Promise<(Timesheet & { worker: Profile; job: Job })[]> {
    let query = db.select({
      timesheet: timesheets,
      worker: profiles,
      job: jobs,
    })
    .from(timesheets)
    .innerJoin(profiles, eq(timesheets.workerId, profiles.id))
    .innerJoin(jobs, eq(timesheets.jobId, jobs.id))
    .where(eq(timesheets.companyId, companyId))
    .orderBy(desc(timesheets.createdAt));
    
    const result = await query;
    
    let filtered = result;
    if (status) {
      filtered = result.filter(r => r.timesheet.status === status);
    }
    
    return filtered.map(({ timesheet, worker, job }) => ({ 
      ...timesheet, 
      worker, 
      job 
    }));
  }
  
  async getTimesheetsByWorker(workerId: number): Promise<(Timesheet & { company: Profile; job: Job })[]> {
    const result = await db.select({
      timesheet: timesheets,
      company: profiles,
      job: jobs,
    })
    .from(timesheets)
    .innerJoin(profiles, eq(timesheets.companyId, profiles.id))
    .innerJoin(jobs, eq(timesheets.jobId, jobs.id))
    .where(eq(timesheets.workerId, workerId))
    .orderBy(desc(timesheets.createdAt));
    
    return result.map(({ timesheet, company, job }) => ({ 
      ...timesheet, 
      company, 
      job 
    }));
  }

  /** Timesheets for all workers in a team (business operator view): owner + members (profiles with teamId). Returns worker profile for each row. */
  async getTimesheetsByTeamOwner(ownerId: number): Promise<(Timesheet & { company: Profile; job: Job; worker: Profile })[]> {
    const team = await this.getWorkerTeam(ownerId);
    if (!team) return [];
    const memberProfiles = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.teamId, team.id));
    const workerIds = [ownerId, ...memberProfiles.map((p) => p.id)];
    if (workerIds.length === 0) return [];
    const result = await db.select({
      timesheet: timesheets,
      company: profiles,
      job: jobs,
    })
    .from(timesheets)
    .innerJoin(profiles, eq(timesheets.companyId, profiles.id))
    .innerJoin(jobs, eq(timesheets.jobId, jobs.id))
    .where(inArray(timesheets.workerId, workerIds))
    .orderBy(desc(timesheets.createdAt));
    const workerProfiles = await db.select().from(profiles).where(inArray(profiles.id, workerIds));
    const workerProfileMap = new Map(workerProfiles.map((p) => [p.id, p]));
    return result.map(({ timesheet, company, job }) => ({
      ...timesheet,
      company,
      job,
      worker: workerProfileMap.get(timesheet.workerId) ?? ({} as Profile),
    }));
  }
  
  async createTimesheet(ts: InsertTimesheet): Promise<Timesheet> {
    const [timesheet] = await db.insert(timesheets).values(ts).returning();
    return timesheet;
  }
  
  async updateTimesheet(id: number, updates: Partial<InsertTimesheet> & { approvedAt?: Date; paymentStatus?: string; paymentId?: string; paidAt?: Date }): Promise<Timesheet> {
    const [ts] = await db.update(timesheets).set({
      ...updates,
      updatedAt: new Date(),
    } as any).where(eq(timesheets.id, id)).returning();
    return ts;
  }
  
  // Nearby Jobs
  async getNearbyJobs(lat: number, lng: number, radiusMiles: number): Promise<Job[]> {
    const allJobs = await db.select().from(jobs).where(eq(jobs.status, 'open'));
    
    const METERS_PER_MILE = 1609.34;
    const radiusMeters = radiusMiles * METERS_PER_MILE;
    
    const nearby = allJobs.filter(job => {
      if (!job.latitude || !job.longitude) return false;
      
      // Filter out fully staffed jobs (workersHired >= maxWorkersNeeded)
      const maxWorkers = job.maxWorkersNeeded || 1;
      const workersHired = job.workersHired || 0;
      if (workersHired >= maxWorkers) return false;
      
      const jobLat = parseFloat(job.latitude);
      const jobLng = parseFloat(job.longitude);
      
      const R = 6371e3;
      const φ1 = (lat * Math.PI) / 180;
      const φ2 = (jobLat * Math.PI) / 180;
      const Δφ = ((jobLat - lat) * Math.PI) / 180;
      const Δλ = ((jobLng - lng) * Math.PI) / 180;
      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      return distance <= radiusMeters;
    });
    
    return nearby;
  }
  
  // Admin - Workers
  async getAllWorkers(): Promise<Profile[]> {
    return await db.select().from(profiles).where(eq(profiles.role, 'worker')).orderBy(desc(profiles.createdAt));
  }
  
  async getWorkerStatus(workerId: number): Promise<WorkerStatus | undefined> {
    const [status] = await db.select().from(workerStatuses).where(eq(workerStatuses.workerId, workerId));
    return status;
  }
  
  async setWorkerStatus(status: InsertWorkerStatus): Promise<WorkerStatus> {
    const existing = await this.getWorkerStatus(status.workerId);
    if (existing) {
      return await this.updateWorkerStatus(status.workerId, status);
    }
    const [newStatus] = await db.insert(workerStatuses).values(status).returning();
    return newStatus;
  }
  
  async updateWorkerStatus(workerId: number, updates: Partial<InsertWorkerStatus>): Promise<WorkerStatus> {
    const [status] = await db.update(workerStatuses)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(workerStatuses.workerId, workerId))
      .returning();
    return status;
  }
  
  // Admin - Companies
  async getAllCompanies(): Promise<Profile[]> {
    return await db.select().from(profiles).where(eq(profiles.role, 'company')).orderBy(desc(profiles.createdAt));
  }
  
  async getCompanyStatus(companyId: number): Promise<CompanyStatus | undefined> {
    const [status] = await db.select().from(companyStatuses).where(eq(companyStatuses.companyId, companyId));
    return status;
  }
  
  async setCompanyStatus(status: InsertCompanyStatus): Promise<CompanyStatus> {
    const existing = await this.getCompanyStatus(status.companyId);
    if (existing) {
      return await this.updateCompanyStatusRecord(status.companyId, status);
    }
    const [newStatus] = await db.insert(companyStatuses).values(status).returning();
    return newStatus;
  }
  
  async updateCompanyStatusRecord(companyId: number, updates: Partial<InsertCompanyStatus>): Promise<CompanyStatus> {
    const [status] = await db.update(companyStatuses)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(companyStatuses.companyId, companyId))
      .returning();
    return status;
  }
  
  // Admin - Jobs
  async getAllJobs(): Promise<(Job & { companyName: string | null })[]> {
    const allJobs = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
    const result = await Promise.all(allJobs.map(async (job) => {
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, job.companyId));
      return { ...job, companyName: profile?.companyName || null };
    }));
    return result;
  }
  
  async updateJob(id: number, updates: Partial<Job>): Promise<Job> {
    const [job] = await db.update(jobs).set(updates as any).where(eq(jobs.id, id)).returning();
    return job;
  }
  
  async getJobSuspensions(jobId: number): Promise<JobSuspension[]> {
    return await db.select().from(jobSuspensions).where(eq(jobSuspensions.jobId, jobId)).orderBy(desc(jobSuspensions.createdAt));
  }
  
  async createJobSuspension(suspension: InsertJobSuspension): Promise<JobSuspension> {
    const [susp] = await db.insert(jobSuspensions).values(suspension).returning();
    return susp;
  }
  
  // Admin - Strikes
  async getWorkerStrikes(workerId: number): Promise<AdminStrike[]> {
    return await db.select().from(adminStrikes).where(eq(adminStrikes.workerId, workerId)).orderBy(desc(adminStrikes.createdAt));
  }
  
  async getAllStrikes(): Promise<(AdminStrike & { worker: Profile })[]> {
    const strikes = await db.select().from(adminStrikes).orderBy(desc(adminStrikes.createdAt));
    const result = await Promise.all(strikes.map(async (strike) => {
      const [worker] = await db.select().from(profiles).where(eq(profiles.id, strike.workerId));
      return { ...strike, worker };
    }));
    return result;
  }
  
  async createStrike(strike: InsertAdminStrike): Promise<AdminStrike> {
    const [newStrike] = await db.insert(adminStrikes).values(strike).returning();
    // Update worker's strike count
    await db.update(profiles)
      .set({ strikeCount: sql`${profiles.strikeCount} + 1` })
      .where(eq(profiles.id, strike.workerId));
    return newStrike;
  }
  
  async resolveStrike(id: number, resolvedBy: string, notes?: string): Promise<AdminStrike> {
    const [strike] = await db.update(adminStrikes)
      .set({ isActive: false, resolvedAt: new Date(), resolvedBy, resolvedNotes: notes } as any)
      .where(eq(adminStrikes.id, id))
      .returning();
    return strike;
  }
  
  // Admin - Billing
  async getBillingActions(entityType?: string, entityId?: number): Promise<BillingAction[]> {
    if (entityType && entityId) {
      return await db.select().from(billingActions)
        .where(and(eq(billingActions.entityType, entityType as any), eq(billingActions.entityId, entityId)))
        .orderBy(desc(billingActions.createdAt));
    }
    return await db.select().from(billingActions).orderBy(desc(billingActions.createdAt));
  }
  
  async createBillingAction(action: InsertBillingAction): Promise<BillingAction> {
    const [newAction] = await db.insert(billingActions).values(action).returning();
    // If affecting a company's deposit, update it
    if (action.entityType === 'company') {
      const deltaAmount = action.actionType === 'credit' || action.actionType === 'refund' 
        ? action.amountCents 
        : -action.amountCents;
      await db.update(profiles)
        .set({ depositAmount: sql`COALESCE(${profiles.depositAmount}, 0) + ${deltaAmount}` })
        .where(eq(profiles.id, action.entityId));
    }
    return newAction;
  }
  
  // Admin - Activity Log
  async logAdminActivity(activity: InsertAdminActivityLog): Promise<AdminActivityLog> {
    const [log] = await db.insert(adminActivityLog).values(activity).returning();
    return log;
  }
  
  async getAdminActivityLog(limit: number = 100): Promise<AdminActivityLog[]> {
    return await db.select().from(adminActivityLog).orderBy(desc(adminActivityLog.createdAt)).limit(limit);
  }
  
  async createAdminActivityLog(activity: InsertAdminActivityLog): Promise<AdminActivityLog> {
    const [log] = await db.insert(adminActivityLog).values(activity).returning();
    return log;
  }
  
  // Company Payment Methods
  async getCompanyPaymentMethod(id: number): Promise<CompanyPaymentMethod | undefined> {
    const [method] = await db.select().from(companyPaymentMethods).where(eq(companyPaymentMethods.id, id));
    return method;
  }

  async getCompanyPaymentMethodByStripePmId(stripePaymentMethodId: string): Promise<CompanyPaymentMethod | undefined> {
    const [method] = await db.select().from(companyPaymentMethods).where(eq(companyPaymentMethods.stripePaymentMethodId, stripePaymentMethodId));
    return method;
  }
  
  async getCompanyPaymentMethods(profileId: number): Promise<CompanyPaymentMethod[]> {
    return await db.select().from(companyPaymentMethods).where(eq(companyPaymentMethods.profileId, profileId));
  }
  
  async getPrimaryPaymentMethod(profileId: number): Promise<CompanyPaymentMethod | undefined> {
    const [method] = await db.select().from(companyPaymentMethods)
      .where(and(
        eq(companyPaymentMethods.profileId, profileId),
        eq(companyPaymentMethods.isPrimary, true)
      ));
    return method;
  }
  
  // When adding a Stripe payment method (card/ACH), always pass stripePaymentMethodId so it is stored for precheck (no need to fetch from Stripe).
  async createCompanyPaymentMethod(method: InsertCompanyPaymentMethod): Promise<CompanyPaymentMethod> {
    const [newMethod] = await db.insert(companyPaymentMethods).values(method).returning();
    return newMethod;
  }
  
  async updateCompanyPaymentMethod(id: number, updates: Partial<InsertCompanyPaymentMethod>): Promise<CompanyPaymentMethod> {
    const [method] = await db.update(companyPaymentMethods).set(updates).where(eq(companyPaymentMethods.id, id)).returning();
    return method;
  }
  
  async deleteCompanyPaymentMethod(id: number): Promise<void> {
    await db.delete(companyPaymentMethods).where(eq(companyPaymentMethods.id, id));
  }
  
  // Company Transactions
  async getCompanyTransactions(profileId: number): Promise<CompanyTransaction[]> {
    return await db.select().from(companyTransactions).where(eq(companyTransactions.profileId, profileId)).orderBy(desc(companyTransactions.createdAt));
  }
  
  async createCompanyTransaction(transaction: InsertCompanyTransaction): Promise<CompanyTransaction> {
    const [newTransaction] = await db.insert(companyTransactions).values(transaction).returning();
    return newTransaction;
  }
  
  // Worker Payouts
  async getWorkerPayouts(workerId: number): Promise<WorkerPayout[]> {
    // Explicitly select only columns that exist in the database (excluding deprecated unit_payment columns)
    return await db.select({
      id: workerPayouts.id,
      workerId: workerPayouts.workerId,
      jobId: workerPayouts.jobId,
      timesheetId: workerPayouts.timesheetId,
      amount: workerPayouts.amount,
      status: workerPayouts.status,
      mercuryPaymentId: workerPayouts.mercuryPaymentId,
      mercuryPaymentStatus: workerPayouts.mercuryPaymentStatus,
      description: workerPayouts.description,
      hoursWorked: workerPayouts.hoursWorked,
      hourlyRate: workerPayouts.hourlyRate,
      isInstantPayout: workerPayouts.isInstantPayout,
      instantPayoutFee: workerPayouts.instantPayoutFee,
      originalAmount: workerPayouts.originalAmount,
      processedAt: workerPayouts.processedAt,
      completedAt: workerPayouts.completedAt,
      errorMessage: workerPayouts.errorMessage,
      createdAt: workerPayouts.createdAt,
    }).from(workerPayouts).where(eq(workerPayouts.workerId, workerId)).orderBy(desc(workerPayouts.createdAt));
  }
  
  async getWorkerPayoutsByStatus(workerId: number, status: string): Promise<WorkerPayout[]> {
    try {
      // Explicitly select only columns that exist in the database (excluding deprecated unit_payment columns)
      return await db.select({
        id: workerPayouts.id,
        workerId: workerPayouts.workerId,
        jobId: workerPayouts.jobId,
        timesheetId: workerPayouts.timesheetId,
        amount: workerPayouts.amount,
        status: workerPayouts.status,
        mercuryPaymentId: workerPayouts.mercuryPaymentId,
        mercuryPaymentStatus: workerPayouts.mercuryPaymentStatus,
        description: workerPayouts.description,
        hoursWorked: workerPayouts.hoursWorked,
        hourlyRate: workerPayouts.hourlyRate,
        isInstantPayout: workerPayouts.isInstantPayout,
        instantPayoutFee: workerPayouts.instantPayoutFee,
        originalAmount: workerPayouts.originalAmount,
        processedAt: workerPayouts.processedAt,
        completedAt: workerPayouts.completedAt,
        errorMessage: workerPayouts.errorMessage,
        createdAt: workerPayouts.createdAt,
      }).from(workerPayouts).where(
        and(
          eq(workerPayouts.workerId, workerId),
          eq(workerPayouts.status, status as any)
        )
      ).orderBy(desc(workerPayouts.createdAt));
    } catch (err: any) {
      console.error(`[Storage] Error getting worker payouts by status:`, {
        workerId,
        status,
        error: err.message,
        code: err.code,
        detail: err.detail,
      });
      throw err;
    }
  }

  async getWorkerPayoutByTimesheetId(timesheetId: number): Promise<WorkerPayout | undefined> {
    const [p] = await db
      .select()
      .from(workerPayouts)
      .where(eq(workerPayouts.timesheetId, timesheetId))
      .orderBy(desc(workerPayouts.createdAt))
      .limit(1);
    return p;
  }
  
  async createWorkerPayout(payout: InsertWorkerPayout): Promise<WorkerPayout> {
    const [newPayout] = await db.insert(workerPayouts).values(payout).returning();
    return newPayout;
  }
  
  async updateWorkerPayout(id: number, updates: Partial<InsertWorkerPayout>): Promise<WorkerPayout> {
    const [payout] = await db.update(workerPayouts).set(updates).where(eq(workerPayouts.id, id)).returning();
    return payout;
  }
  
  // Payout Accounts
  async getPayoutAccounts(profileId: number): Promise<PayoutAccount[]> {
    return await db.select().from(payoutAccounts).where(eq(payoutAccounts.profileId, profileId));
  }
  
  async createPayoutAccount(account: InsertPayoutAccount): Promise<PayoutAccount> {
    const [newAccount] = await db.insert(payoutAccounts).values(account).returning();
    return newAccount;
  }
  
  // Profile by email
  async getProfileByEmail(email: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.email, email));
    return profile;
  }
  
  // Applications by job
  async getApplicationsByJob(jobId: number): Promise<Application[]> {
    return await db.select().from(applications).where(eq(applications.jobId, jobId));
  }
  
  // Invoices
  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }
  
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber));
    return invoice;
  }
  
  async getInvoicesByCompany(companyId: number): Promise<Invoice[]> {
    return await db.select().from(invoices).where(eq(invoices.companyId, companyId)).orderBy(desc(invoices.createdAt));
  }
  
  async getInvoicesByWorker(workerId: number): Promise<Invoice[]> {
    return await db.select().from(invoices).where(eq(invoices.workerId, workerId)).orderBy(desc(invoices.createdAt));
  }
  
  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    return newInvoice;
  }
  
  async updateInvoice(id: number, updates: Partial<InsertInvoice>): Promise<Invoice> {
    const [invoice] = await db.update(invoices).set({
      ...updates,
      updatedAt: new Date(),
    } as any).where(eq(invoices.id, id)).returning();
    return invoice;
  }
  
  async getNextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    
    const [lastInvoice] = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(sql`${invoices.invoiceNumber} LIKE ${prefix + '%'}`)
      .orderBy(desc(invoices.invoiceNumber))
      .limit(1);
    
    let nextNumber = 1;
    if (lastInvoice?.invoiceNumber) {
      const lastNum = parseInt(lastInvoice.invoiceNumber.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) {
        nextNumber = lastNum + 1;
      }
    }
    
    return `${prefix}${String(nextNumber).padStart(5, '0')}`;
  }
  
  // Invoice Items
  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  }
  
  async createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    const [newItem] = await db.insert(invoiceItems).values(item).returning();
    return newItem;
  }
  
  async createInvoiceItems(items: InsertInvoiceItem[]): Promise<InvoiceItem[]> {
    if (items.length === 0) return [];
    const newItems = await db.insert(invoiceItems).values(items).returning();
    return newItems;
  }
  
  // Worker Dismissed Jobs
  async getDismissedJobs(workerId: number): Promise<number[]> {
    const dismissed = await db.select({ jobId: workerDismissedJobs.jobId })
      .from(workerDismissedJobs)
      .where(eq(workerDismissedJobs.workerId, workerId));
    return dismissed.map(d => d.jobId);
  }
  
  async dismissJob(workerId: number, jobId: number, reason?: string): Promise<void> {
    await db.insert(workerDismissedJobs)
      .values({ workerId, jobId, reason })
      .onConflictDoNothing();
  }
  
  async undismissJob(workerId: number, jobId: number): Promise<void> {
    await db.delete(workerDismissedJobs)
      .where(and(
        eq(workerDismissedJobs.workerId, workerId),
        eq(workerDismissedJobs.jobId, jobId)
      ));
  }

  // Worker Teams (Business Operator)
  async getWorkerTeam(ownerId: number): Promise<Team | null> {
    const [team] = await db.select().from(teams).where(eq(teams.ownerId, ownerId));
    return team || null;
  }

  async getTeamById(teamId: number): Promise<Team | null> {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    return team || null;
  }

  async createWorkerTeam(team: InsertTeam): Promise<Team> {
    const [newTeam] = await db.insert(teams).values(team).returning();
    return newTeam;
  }

  async updateWorkerTeam(id: number, updates: Partial<InsertTeam>): Promise<Team> {
    const [team] = await db.update(teams).set(updates).where(eq(teams.id, id)).returning();
    return team;
  }

  // Worker Team Members
  async getWorkerTeamMembers(teamId: number): Promise<WorkerTeamMember[]> {
    return await db.select().from(workerTeamMembers).where(eq(workerTeamMembers.teamId, teamId));
  }

  async getWorkerTeamMember(id: number): Promise<WorkerTeamMember | null> {
    const [member] = await db.select().from(workerTeamMembers).where(eq(workerTeamMembers.id, id));
    return member || null;
  }

  /** Batch: worker team members by IDs. Use to avoid N+1 when enriching applications. */
  async getWorkerTeamMembersByIds(ids: number[]): Promise<WorkerTeamMember[]> {
    if (ids.length === 0) return [];
    const uniq = [...new Set(ids)];
    return await db.select().from(workerTeamMembers).where(inArray(workerTeamMembers.id, uniq));
  }

  async createWorkerTeamMember(member: InsertWorkerTeamMember): Promise<WorkerTeamMember> {
    const [newMember] = await db.insert(workerTeamMembers).values(member).returning();
    return newMember;
  }

  async updateWorkerTeamMember(id: number, updates: Partial<InsertWorkerTeamMember>): Promise<WorkerTeamMember> {
    const [member] = await db.update(workerTeamMembers).set({
      ...updates,
      updatedAt: new Date(),
    } as any).where(eq(workerTeamMembers.id, id)).returning();
    return member;
  }

  async deleteWorkerTeamMember(id: number): Promise<void> {
    await db.delete(workerTeamMembers).where(eq(workerTeamMembers.id, id));
  }

  async getWorkerTeamMemberByInviteToken(token: string): Promise<WorkerTeamMember | null> {
    const [member] = await db.select().from(workerTeamMembers).where(eq(workerTeamMembers.inviteToken, token));
    return member || null;
  }

  async updateWorkerTeamMemberPassword(id: number, passwordHash: string): Promise<void> {
    await db.update(workerTeamMembers).set({ 
      passwordHash,
      updatedAt: new Date() 
    }).where(eq(workerTeamMembers.id, id));
  }

  // Saved Team Members (contractors saved by companies; optional locationId filters by that location)
  async getSavedTeamMembers(companyId: number, locationId?: number | null): Promise<(SavedTeamMember & { worker: Profile })[]> {
    const conditions = [eq(savedTeamMembers.companyId, companyId)];
    if (locationId !== undefined && locationId !== null) {
      conditions.push(eq(savedTeamMembers.companyLocationId, locationId));
    }
    const members = await db.select({
      savedMember: savedTeamMembers,
      worker: profiles
    })
    .from(savedTeamMembers)
    .innerJoin(profiles, eq(savedTeamMembers.workerId, profiles.id))
    .where(and(...conditions))
    .orderBy(desc(savedTeamMembers.createdAt));
    
    return members.map(m => ({
      ...m.savedMember,
      worker: m.worker
    }));
  }

  async getSavedTeamMember(companyId: number, workerId: number, locationId?: number | null): Promise<SavedTeamMember | undefined> {
    const conditions = [
      eq(savedTeamMembers.companyId, companyId),
      eq(savedTeamMembers.workerId, workerId)
    ];
    if (locationId !== undefined && locationId !== null) {
      conditions.push(eq(savedTeamMembers.companyLocationId, locationId));
    } else {
      conditions.push(isNull(savedTeamMembers.companyLocationId));
    }
    const [member] = await db.select()
      .from(savedTeamMembers)
      .where(and(...conditions));
    return member;
  }

  async createSavedTeamMember(member: InsertSavedTeamMember): Promise<SavedTeamMember> {
    const [newMember] = await db.insert(savedTeamMembers).values(member).returning();
    return newMember;
  }

  async updateSavedTeamMember(id: number, updates: Partial<InsertSavedTeamMember>): Promise<SavedTeamMember> {
    const [member] = await db.update(savedTeamMembers).set(updates).where(eq(savedTeamMembers.id, id)).returning();
    return member;
  }

  async deleteSavedTeamMember(id: number): Promise<void> {
    await db.delete(savedTeamMembers).where(eq(savedTeamMembers.id, id));
  }

  async getWorkersWithApprovedJobs(companyId: number): Promise<Profile[]> {
    const withLocation = await this.getWorkersWithApprovedJobsAndLocation(companyId);
    return withLocation.map(({ worker }) => worker);
  }

  /** Workers who have accepted jobs for this company (not in saved team), with the location they worked at (from most recent job). */
  async getWorkersWithApprovedJobsAndLocation(companyId: number): Promise<Array<{ worker: Profile; companyLocationId: number | null }>> {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (p.id) p.id, p.user_id, p.role, p.first_name, p.last_name, p.email, p.phone, p.company_name,
        p.bio, p.avatar_url, p.strike_count, p.average_rating, p.completed_jobs, p.hourly_rate, p.trades, p.portfolio_images,
        p.created_at, p.updated_at, j.company_location_id
      FROM profiles p
      INNER JOIN applications a ON a.worker_id = p.id
      INNER JOIN jobs j ON j.id = a.job_id
      WHERE j.company_id = ${companyId}
        AND a.status = 'accepted'
        AND p.id NOT IN (
          SELECT worker_id FROM saved_team_members WHERE company_id = ${companyId}
        )
      ORDER BY p.id, j.id DESC
    `);
    const rows = result.rows as any[];
    return rows.map((row) => {
      const { company_location_id, ...rest } = row;
      return {
        worker: rest as Profile,
        companyLocationId: company_location_id != null ? Number(company_location_id) : null,
      };
    });
  }

  // Timesheet Reports (worker strikes from companies)
  async createTimesheetReport(report: InsertTimesheetReport): Promise<TimesheetReport> {
    const [newReport] = await db.insert(timesheetReports).values(report).returning();
    
    // If it's a strike, increment the worker's strike count
    if (report.isStrike !== false) {
      await db.update(profiles)
        .set({ strikeCount: sql`strike_count + 1` })
        .where(eq(profiles.id, report.workerId));
    }
    
    return newReport;
  }

  async getTimesheetReports(workerId: number): Promise<(TimesheetReport & { reporter: Profile })[]> {
    const reports = await db.select({
      report: timesheetReports,
      reporter: profiles
    })
    .from(timesheetReports)
    .innerJoin(profiles, eq(timesheetReports.reportedBy, profiles.id))
    .where(eq(timesheetReports.workerId, workerId))
    .orderBy(desc(timesheetReports.createdAt));
    
    return reports.map(r => ({
      ...r.report,
      reporter: r.reporter
    }));
  }

  async getTimesheetReportsByCompany(companyId: number): Promise<TimesheetReport[]> {
    return await db.select()
      .from(timesheetReports)
      .where(eq(timesheetReports.reportedBy, companyId))
      .orderBy(desc(timesheetReports.createdAt));
  }

  // Direct Job Inquiries
  async createDirectJobInquiry(inquiry: InsertDirectJobInquiry): Promise<DirectJobInquiry> {
    const [newInquiry] = await db.insert(directJobInquiries).values(inquiry).returning();
    return newInquiry;
  }

  async getDirectJobInquiry(id: number): Promise<DirectJobInquiry | undefined> {
    const [inquiry] = await db.select().from(directJobInquiries).where(eq(directJobInquiries.id, id));
    return inquiry;
  }

  async getDirectJobInquiriesForWorker(workerId: number): Promise<(DirectJobInquiry & { company: Profile })[]> {
    const results = await db.select({
      inquiry: directJobInquiries,
      company: profiles
    })
    .from(directJobInquiries)
    .innerJoin(profiles, eq(directJobInquiries.companyId, profiles.id))
    .where(eq(directJobInquiries.workerId, workerId))
    .orderBy(desc(directJobInquiries.createdAt));

    return results.map(r => ({
      ...r.inquiry,
      company: r.company
    }));
  }

  async getDirectJobInquiriesForCompany(companyId: number): Promise<(DirectJobInquiry & { worker: Profile })[]> {
    const results = await db.select({
      inquiry: directJobInquiries,
      worker: profiles
    })
    .from(directJobInquiries)
    .innerJoin(profiles, eq(directJobInquiries.workerId, profiles.id))
    .where(eq(directJobInquiries.companyId, companyId))
    .orderBy(desc(directJobInquiries.createdAt));

    return results.map(r => ({
      ...r.inquiry,
      worker: r.worker
    }));
  }

  async updateDirectJobInquiry(id: number, updates: Partial<DirectJobInquiry>): Promise<DirectJobInquiry> {
    const [inquiry] = await db.update(directJobInquiries)
      .set(updates)
      .where(eq(directJobInquiries.id, id))
      .returning();
    return inquiry;
  }

  async respondToDirectJobInquiry(id: number, status: 'accepted' | 'declined', workerMessage?: string): Promise<DirectJobInquiry> {
    const [inquiry] = await db.update(directJobInquiries)
      .set({
        status,
        workerMessage,
        respondedAt: new Date()
      })
      .where(eq(directJobInquiries.id, id))
      .returning();
    return inquiry;
  }

  // Job Messages (Chat)
  async getJobMessages(jobId: number): Promise<(JobMessage & { sender: Profile })[]> {
    const results = await db.select({
      message: jobMessages,
      sender: profiles
    })
    .from(jobMessages)
    .innerJoin(profiles, eq(jobMessages.senderId, profiles.id))
    .where(eq(jobMessages.jobId, jobId))
    .orderBy(jobMessages.createdAt);

    return results.map(r => ({
      ...r.message,
      sender: r.sender
    }));
  }

  async createJobMessage(message: InsertJobMessage): Promise<JobMessage> {
    const [created] = await db.insert(jobMessages).values(message).returning();
    return created;
  }

  async updateJobMessageMetadata(jobId: number, messageId: number, metadataPatch: Record<string, unknown>): Promise<JobMessage | undefined> {
    const [existing] = await db.select().from(jobMessages).where(and(eq(jobMessages.jobId, jobId), eq(jobMessages.id, messageId)));
    if (!existing) return undefined;
    const merged = { ...((existing.metadata as Record<string, unknown>) || {}), ...metadataPatch };
    const [updated] = await db.update(jobMessages).set({ metadata: merged }).where(and(eq(jobMessages.jobId, jobId), eq(jobMessages.id, messageId))).returning();
    return updated;
  }

  async markMessagesAsRead(jobId: number, readerId: number): Promise<void> {
    await db.update(jobMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(jobMessages.jobId, jobId),
          ne(jobMessages.senderId, readerId),
          eq(jobMessages.isRead, false)
        )
      );
  }

  async getUnreadMessageCount(jobId: number, userId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(jobMessages)
      .where(
        and(
          eq(jobMessages.jobId, jobId),
          ne(jobMessages.senderId, userId),
          eq(jobMessages.isRead, false)
        )
      );
    return result[0]?.count || 0;
  }
}

export const storage = new DatabaseStorage();
