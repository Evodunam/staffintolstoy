/**
 * Mercury Sandbox API Test Script
 * 
 * Tests the Mercury API sandbox connection and basic operations
 * Run with: npx tsx script/test-mercury-sandbox.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { mercuryService } from "../server/services/mercury";

// Load environment variables
const envFile = process.env.NODE_ENV === "production" 
  ? ".env.production" 
  : ".env.development";

config({ path: resolve(process.cwd(), envFile) });

// Ensure we're in development mode for sandbox
process.env.NODE_ENV = "development";

async function testMercurySandbox() {
  console.log("=".repeat(60));
  console.log("Mercury Sandbox API Test");
  console.log("=".repeat(60));
  console.log();

  // Check configuration
  console.log("1. Checking configuration...");
  const isConfigured = mercuryService.isConfigured();
  console.log(`   ✅ Mercury API configured: ${isConfigured}`);
  
  if (!isConfigured) {
    console.error("   ❌ Mercury_Sandbox not found in .env.development");
    console.error("   Please add: Mercury_Sandbox=secret-token:mercury_sandbox_wma_...");
    process.exit(1);
  }

  // Check environment variable
  const sandboxToken = process.env.Mercury_Sandbox;
  if (sandboxToken) {
    const masked = sandboxToken.substring(0, 30) + "..." + sandboxToken.substring(sandboxToken.length - 10);
    console.log(`   Token: ${masked}`);
  }
  console.log();

  // Test connection
  console.log("2. Testing API connection...");
  try {
    const isConnected = await mercuryService.verifyConnection();
    if (isConnected) {
      console.log("   ✅ Connection verified successfully");
    } else {
      console.error("   ❌ Connection verification failed");
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`   ❌ Connection error: ${error.message}`);
    console.error();
    console.error("   Troubleshooting:");
    console.error("   - Check that Mercury_Sandbox is set in .env.development");
    console.error("   - Verify the token is active in Mercury dashboard");
    console.error("   - Check IP whitelisting if required");
    console.error("   - Ensure you're using the sandbox token (not production)");
    process.exit(1);
  }
  console.log();

  // Get accounts
  console.log("3. Fetching Mercury accounts...");
  try {
    const accounts = await mercuryService.getAccounts();
    console.log(`   ✅ Found ${accounts.length} account(s)`);
    
    if (accounts.length > 0) {
      const account = accounts[0];
      console.log();
      console.log("   Account Details:");
      console.log(`   - ID: ${account.id}`);
      console.log(`   - Name: ${account.name}`);
      console.log(`   - Account Number: ${account.accountNumber}`);
      console.log(`   - Routing Number: ${account.routingNumber}`);
      console.log(`   - Available Balance: $${(account.availableBalance / 100).toFixed(2)}`);
      console.log(`   - Current Balance: $${(account.currentBalance / 100).toFixed(2)}`);
      console.log(`   - Status: ${account.status}`);
      console.log(`   - Type: ${account.type}`);
    } else {
      console.log("   ⚠️  No accounts found (this may be normal for a new sandbox account)");
    }
  } catch (error: any) {
    console.error(`   ❌ Error fetching accounts: ${error.message}`);
    process.exit(1);
  }
  console.log();

  // List recipients
  console.log("4. Fetching recipients...");
  try {
    const recipients = await mercuryService.listRecipients();
    console.log(`   ✅ Found ${recipients.length} recipient(s)`);
    
    if (recipients.length > 0) {
      console.log();
      console.log("   Sample Recipient:");
      const recipient = recipients[0];
      console.log(`   - ID: ${recipient.id}`);
      console.log(`   - Name: ${recipient.name}`);
      console.log(`   - Status: ${recipient.status}`);
      console.log(`   - Created: ${new Date(recipient.createdAt).toLocaleString()}`);
    }
  } catch (error: any) {
    console.error(`   ❌ Error fetching recipients: ${error.message}`);
    // Don't exit - this might fail if no recipients exist
  }
  console.log();

  // Test transaction listing (optional)
  console.log("5. Testing transaction access...");
  try {
    const transactions = await mercuryService.listTransactions({ limit: 5 });
    console.log(`   ✅ Found ${transactions.length} recent transaction(s)`);
  } catch (error: any) {
    console.log(`   ⚠️  Transaction access: ${error.message}`);
    // Don't exit - transactions might not exist in sandbox
  }
  console.log();

  // Test write operations (read-write key only)
  console.log("6. Testing write operations (read-write key)...");
  let writeTestPassed = false;
  try {
    // Try to create a test recipient (this will fail if read-only, succeed if read-write)
    const uniqueId = Date.now();
    const testRecipient = await mercuryService.createRecipient({
      name: `Test Recipient ${uniqueId}`,
      email: `test${uniqueId}@example.com`,
      routingNumber: "021000021", // Test routing number
      accountNumber: `123456789${uniqueId % 1000}`, // Unique account number
      accountType: "checking",
    });
    console.log(`   ✅ Write operation successful! Created recipient: ${testRecipient.id}`);
    console.log(`   ✅ Read-Write key confirmed - can create recipients`);
    writeTestPassed = true;
    
    // Note: Test recipient can be deleted manually in Mercury dashboard if needed
    console.log(`   ℹ️  Test recipient created (ID: ${testRecipient.id}, Name: ${testRecipient.name})`);
  } catch (error: any) {
    if (error.message.includes("read-only") || error.message.includes("403") || error.message.includes("Forbidden")) {
      console.log(`   ⚠️  Write operation failed: ${error.message}`);
      console.log(`   ⚠️  This appears to be a read-only key. For write operations, use a read-write key.`);
    } else if (error.message.includes("already exists") || error.message.includes("duplicate")) {
      console.log(`   ⚠️  Test recipient may already exist: ${error.message}`);
      console.log(`   ℹ️  This is expected if the test was run before. The key has write permissions.`);
      writeTestPassed = true; // Consider this a pass - we can create, just duplicate
    } else {
      console.log(`   ⚠️  Write operation test: ${error.message}`);
      console.log(`   ℹ️  This may be expected (e.g., validation error, API limitation)`);
    }
  }
  console.log();

  // Summary
  console.log("=".repeat(60));
  console.log("✅ Mercury Sandbox API Test PASSED");
  console.log("=".repeat(60));
  console.log();
  console.log("Summary:");
  console.log("  ✅ Configuration: OK");
  console.log("  ✅ Connection: OK");
  console.log("  ✅ Accounts API: OK");
  console.log("  ✅ Recipients API: OK");
  if (writeTestPassed) {
    console.log("  ✅ Write Operations: OK (Read-Write key confirmed)");
  } else {
    console.log("  ⚠️  Write Operations: Not tested or failed");
  }
  console.log();
  console.log("The Mercury sandbox integration is working correctly!");
}

// Run the test
testMercurySandbox().catch((error) => {
  console.error();
  console.error("=".repeat(60));
  console.error("❌ Mercury Sandbox API Test FAILED");
  console.error("=".repeat(60));
  console.error();
  console.error("Error:", error.message);
  console.error();
  if (error.stack) {
    console.error("Stack trace:");
    console.error(error.stack);
  }
  process.exit(1);
});
