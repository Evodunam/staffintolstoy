// Load environment variables FIRST - must be before any server imports
import "../server/env-loader";

// Now import modules that depend on environment variables
import { db } from "../server/db";
import { storage } from "../server/storage";
import { profiles, workerTeamMembers } from "../shared/schema";
import { eq, or, ilike } from "drizzle-orm";
import { geocodeAddress } from "../server/geocoding";

/**
 * Script to update all of Carlos's teammates with addresses for GPS fleet routing
 * This ensures all team members have addresses for route optimization
 */
async function updateCarlosTeammatesAddresses() {
  console.log("🔍 Finding Carlos's profile...");
  
  // Find Carlos profile
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
    console.error("❌ No Carlos profile found. Please check the database.");
    process.exit(1);
  }
  
  const carlos = carlosProfiles.find(p => p.role === "worker") || carlosProfiles[0];
  console.log(`✅ Found Carlos profile: ${carlos.firstName} ${carlos.lastName} (ID: ${carlos.id})`);
  
  // Find Carlos's team
  const team = await storage.getWorkerTeam(carlos.id);
  if (!team) {
    console.error("❌ Carlos doesn't have a team. Cannot update teammates.");
    process.exit(1);
  }
  
  console.log(`✅ Found team: ${team.name} (ID: ${team.id})`);
  
  // Get all team members
  const members = await storage.getWorkerTeamMembers(team.id);
  console.log(`📋 Found ${members.length} team member(s)`);
  
  if (members.length === 0) {
    console.log("⚠️ No team members found. Nothing to update.");
    process.exit(0);
  }
  
  // Default addresses for teammates (San Jose area addresses)
  const defaultAddresses: Record<string, { address: string; city: string; state: string; zipCode: string }> = {
    "Miguel Santos": { address: "150 N 1st St", city: "San Jose", state: "CA", zipCode: "95113" },
    "Ana Rodriguez": { address: "250 S 2nd St", city: "San Jose", state: "CA", zipCode: "95113" },
    "David Chen": { address: "350 E Santa Clara St", city: "San Jose", state: "CA", zipCode: "95113" },
    "Brandon Tolstoy": { address: "450 W Santa Clara St", city: "San Jose", state: "CA", zipCode: "95113" },
    "Brandon Cairl": { address: "550 N 3rd St", city: "San Jose", state: "CA", zipCode: "95113" },
  };
  
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const member of members) {
    const fullName = `${member.firstName} ${member.lastName}`;
    const hasAddress = !!(member.address && member.city && member.state);
    
    if (hasAddress) {
      console.log(`⏭️  Skipping ${fullName} - already has address: ${member.address}`);
      skippedCount++;
      continue;
    }
    
    // Get default address for this member or use a generic one
    const defaultAddr = defaultAddresses[fullName] || {
      address: `${100 + (member.id % 100)} N ${member.id % 10 + 1}${member.id % 2 === 0 ? 'st' : 'nd'} St`,
      city: "San Jose",
      state: "CA",
      zipCode: "95113"
    };
    
    console.log(`📍 Updating ${fullName} (ID: ${member.id})...`);
    console.log(`   Address: ${defaultAddr.address}`);
    
    // Geocode the address to get coordinates
    let latitude: string | null = null;
    let longitude: string | null = null;
    
    try {
      const coords = await geocodeAddress(
        `${defaultAddr.address}, ${defaultAddr.city}, ${defaultAddr.state} ${defaultAddr.zipCode}`
      );
      if (coords) {
        latitude = coords.latitude.toString();
        longitude = coords.longitude.toString();
        console.log(`   ✅ Geocoded: ${latitude}, ${longitude}`);
      } else {
        console.log(`   ⚠️  Geocoding failed, using default coordinates`);
        // Use default San Jose coordinates with slight offset based on member ID
        latitude = (37.3382 + (member.id % 10) * 0.01).toString();
        longitude = (-121.8863 - (member.id % 10) * 0.01).toString();
      }
    } catch (error: any) {
      console.log(`   ⚠️  Geocoding error: ${error.message}, using default coordinates`);
      latitude = (37.3382 + (member.id % 10) * 0.01).toString();
      longitude = (-121.8863 - (member.id % 10) * 0.01).toString();
    }
    
    // Update the team member
    await db.update(workerTeamMembers)
      .set({
        address: defaultAddr.address,
        city: defaultAddr.city,
        state: defaultAddr.state,
        zipCode: defaultAddr.zipCode,
        latitude: latitude,
        longitude: longitude,
      })
      .where(eq(workerTeamMembers.id, member.id));
    
    console.log(`   ✅ Updated ${fullName} successfully`);
    updatedCount++;
  }
  
  console.log();
  console.log("=".repeat(60));
  console.log("✅ Update Complete!");
  console.log("=".repeat(60));
  console.log(`   Updated: ${updatedCount} team member(s)`);
  console.log(`   Skipped: ${skippedCount} team member(s) (already had addresses)`);
  console.log();
}

// Run the script
updateCarlosTeammatesAddresses()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
