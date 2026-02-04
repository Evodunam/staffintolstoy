import { db } from "../server/db";
import { storage } from "../server/storage";
import { profiles, jobs, applications } from "../shared/schema";
import { eq, or, ilike } from "drizzle-orm";

/**
 * Script to create approved/accepted jobs for carlos account for route testing
 */
async function createCarlosJobs() {
  console.log("🔍 Finding carlos user profile...");
  
  // Find carlos profile - try different variations of the name/email
  const carlosProfiles = await db
    .select()
    .from(profiles)
    .where(
      or(
        ilike(profiles.firstName, "%carlos%"),
        ilike(profiles.lastName, "%carlos%"),
        ilike(profiles.email, "%carlos%")
      )
    );
  
  if (carlosProfiles.length === 0) {
    console.error("❌ No carlos profile found. Please check the database.");
    console.log("💡 Available profiles (first 10):");
    const allProfiles = await db.select().from(profiles).limit(10);
    allProfiles.forEach(p => {
      console.log(`  - ${p.firstName} ${p.lastName} (${p.email}) - ID: ${p.id}, Role: ${p.role}`);
    });
    process.exit(1);
  }
  
  const carlos = carlosProfiles.find(p => p.role === "worker") || carlosProfiles[0];
  console.log(`✅ Found carlos profile: ${carlos.firstName} ${carlos.lastName} (ID: ${carlos.id}, Email: ${carlos.email})`);
  
  // Find a company profile to create jobs for
  console.log("🔍 Finding company profile...");
  const companies = await db
    .select()
    .from(profiles)
    .where(eq(profiles.role, "company"))
    .limit(1);
  
  if (companies.length === 0) {
    console.error("❌ No company profile found. Cannot create jobs.");
    process.exit(1);
  }
  
  const company = companies[0];
  console.log(`✅ Found company: ${company.companyName || company.firstName} (ID: ${company.id})`);
  
  // Get carlos's location for route optimization
  const carlosLat = carlos.latitude ? parseFloat(carlos.latitude) : 37.3482;
  const carlosLng = carlos.longitude ? parseFloat(carlos.longitude) : -121.8963;
  const carlosCity = carlos.city || "San Jose";
  const carlosState = carlos.state || "CA";
  
  console.log(`📍 Carlos location: ${carlosLat}, ${carlosLng} (${carlosCity}, ${carlosState})`);
  
  // Create jobs with coordinates around San Jose area for route testing
  // These jobs will be spread out to create a good route
  const testJobs = [
    {
      companyId: company.id,
      title: "Electrical Panel Installation - Downtown",
      description: "Install new electrical panel in commercial building",
      location: "San Jose, CA",
      address: "200 S 1st St",
      city: "San Jose",
      state: "CA",
      zipCode: "95113",
      latitude: "37.3349",
      longitude: "-121.8889",
      trade: "Electrical" as const,
      hourlyRate: 4500, // $45/hour in cents
      maxWorkersNeeded: 1,
      status: "open" as const,
      startDate: new Date(new Date().setHours(8, 0, 0, 0)), // Today at 8 AM
      endDate: new Date(new Date().setHours(14, 0, 0, 0)), // Today at 2 PM
      estimatedHours: 6,
      timezone: "America/Los_Angeles",
    },
    {
      companyId: company.id,
      title: "Plumbing Repair - Willow Glen",
      description: "Fix main water line leak in residential property",
      location: "San Jose, CA",
      address: "1200 Lincoln Ave",
      city: "San Jose",
      state: "CA",
      zipCode: "95125",
      latitude: "37.3044",
      longitude: "-121.9011",
      trade: "Plumbing" as const,
      hourlyRate: 5000, // $50/hour in cents
      maxWorkersNeeded: 1,
      status: "open" as const,
      startDate: new Date(new Date().setHours(9, 0, 0, 0)), // Today at 9 AM
      endDate: new Date(new Date().setHours(13, 0, 0, 0)), // Today at 1 PM
      estimatedHours: 4,
      timezone: "America/Los_Angeles",
    },
    {
      companyId: company.id,
      title: "HVAC System Maintenance - East San Jose",
      description: "Annual maintenance and filter replacement for HVAC system",
      location: "San Jose, CA",
      address: "1500 E Santa Clara St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3394",
      longitude: "-121.8930",
      trade: "HVAC" as const,
      hourlyRate: 4800, // $48/hour in cents
      maxWorkersNeeded: 1,
      status: "open" as const,
      startDate: new Date(new Date().setHours(10, 0, 0, 0)), // Today at 10 AM
      endDate: new Date(new Date().setHours(13, 0, 0, 0)), // Today at 1 PM
      estimatedHours: 3,
      timezone: "America/Los_Angeles",
    },
    {
      companyId: company.id,
      title: "Drywall Installation - North San Jose",
      description: "Install drywall in new construction project",
      location: "San Jose, CA",
      address: "1800 N 1st St",
      city: "San Jose",
      state: "CA",
      zipCode: "95112",
      latitude: "37.3467",
      longitude: "-121.8967",
      trade: "Drywall" as const,
      hourlyRate: 4000, // $40/hour in cents
      maxWorkersNeeded: 1,
      status: "open" as const,
      startDate: new Date(new Date().setHours(11, 0, 0, 0)), // Today at 11 AM
      endDate: new Date(new Date().setHours(16, 0, 0, 0)), // Today at 4 PM
      estimatedHours: 5,
      timezone: "America/Los_Angeles",
    },
    {
      companyId: company.id,
      title: "Carpentry Work - West San Jose",
      description: "Custom cabinet installation in kitchen renovation",
      location: "San Jose, CA",
      address: "2200 Stevens Creek Blvd",
      city: "San Jose",
      state: "CA",
      zipCode: "95128",
      latitude: "37.3423",
      longitude: "-121.8912",
      trade: "Carpentry" as const,
      hourlyRate: 5500, // $55/hour in cents
      maxWorkersNeeded: 1,
      status: "open" as const,
      startDate: new Date(new Date().setHours(13, 0, 0, 0)), // Today at 1 PM
      endDate: new Date(new Date().setHours(19, 0, 0, 0)), // Today at 7 PM
      estimatedHours: 6,
      timezone: "America/Los_Angeles",
    },
    {
      companyId: company.id,
      title: "Concrete Pouring - South San Jose",
      description: "Pour concrete foundation for new building",
      location: "San Jose, CA",
      address: "2500 S Bascom Ave",
      city: "San Jose",
      state: "CA",
      zipCode: "95124",
      latitude: "37.3200",
      longitude: "-121.9200",
      trade: "Concrete" as const,
      hourlyRate: 4200, // $42/hour in cents
      maxWorkersNeeded: 2,
      status: "open" as const,
      startDate: new Date(new Date().setHours(14, 0, 0, 0)), // Today at 2 PM
      endDate: new Date(new Date().setHours(22, 0, 0, 0)), // Today at 10 PM
      estimatedHours: 8,
      timezone: "America/Los_Angeles",
    },
  ];
  
  console.log(`\n📦 Creating ${testJobs.length} jobs for carlos...`);
  
  let createdCount = 0;
  for (const jobData of testJobs) {
    try {
      // Create the job
      const job = await storage.createJob(jobData);
      console.log(`  ✅ Created job: ${job.title} (ID: ${job.id})`);
      
      // Create application for carlos
      const application = await storage.createApplication({
        jobId: job.id,
        workerId: carlos.id,
        message: "Auto-approved for route testing",
      });
      
      // Accept the application
      await storage.updateApplicationStatus(application.id, "accepted");
      console.log(`  ✅ Accepted application for carlos (App ID: ${application.id})`);
      
      createdCount++;
    } catch (error: any) {
      console.error(`  ❌ Error creating job "${jobData.title}":`, error.message);
    }
  }
  
  console.log(`\n✅ Successfully created ${createdCount} approved jobs for carlos!`);
  console.log(`\n📍 Jobs are spread across San Jose area for route testing:`);
  testJobs.forEach((job, index) => {
    console.log(`  ${index + 1}. ${job.title} - ${job.address} (${job.latitude}, ${job.longitude})`);
  });
  console.log(`\n🗺️  Open the calendar map view to see the routes connecting these jobs.`);
  
  process.exit(0);
}

createCarlosJobs().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
