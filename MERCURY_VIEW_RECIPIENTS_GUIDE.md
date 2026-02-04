# How to View Recipients in Mercury Dashboard

## Quick Access

After successfully creating a recipient (worker or company bank account), you can view it in the Mercury dashboard:

### Sandbox (Development)
**URL**: https://sandbox.mercury.com/recipients

### Production
**URL**: https://app.mercury.com/recipients

---

## Step-by-Step Instructions

### 1. Login to Mercury Dashboard

- **Sandbox**: Go to https://sandbox.mercury.com
- **Production**: Go to https://app.mercury.com

### 2. Navigate to Recipients

1. In the left sidebar, click on **"Recipients"** or **"Payments"** → **"Recipients"**
2. You'll see a list of all recipients (workers and companies with bank accounts)

### 3. Find Your Recipient

Recipients are listed with:
- **Name**: The worker/company name (e.g., "John Doe" or "Company Name")
- **Status**: `pending`, `active`, or `inactive`
- **Account Type**: `checking` or `savings`
- **Last 4 digits**: The last 4 digits of the bank account
- **Created Date**: When the recipient was created

### 4. View Recipient Details

Click on any recipient to see:
- Full recipient ID (Mercury's internal ID)
- Bank account details (masked)
- Routing number
- Account type
- Status
- Payment history (if any payments have been sent)

---

## Using the API Response

When you successfully connect a bank account, the API response includes:

```json
{
  "success": true,
  "recipientId": "abc123-def456-ghi789",
  "mercuryRecipientId": "abc123-def456-ghi789",
  "mercuryDashboardUrl": "https://sandbox.mercury.com/recipients/abc123-def456-ghi789",
  "lastFour": "1234",
  "message": "Bank account added successfully."
}
```

You can:
1. **Copy the `mercuryRecipientId`** from the response
2. **Click the `mercuryDashboardUrl`** (if provided) to go directly to the recipient
3. **Search in Mercury dashboard** using the recipient ID or name

---

## Viewing Recipients via API

You can also list all recipients programmatically:

### Using the Test Script

```bash
npx tsx script/test-mercury-sandbox.ts
```

This will show:
- Total number of recipients
- Sample recipient details (ID, name, status, created date)

### Using the Mercury Service

```typescript
import { mercuryService } from "./server/services/mercury";

// List all recipients
const recipients = await mercuryService.listRecipients();
console.log(`Found ${recipients.length} recipients`);

// Find a specific recipient
const recipient = recipients.find(r => r.name === "John Doe");
console.log("Recipient ID:", recipient.id);
```

---

## Finding a Specific Recipient

### By Name
1. Go to Recipients page
2. Use the search/filter box
3. Type the worker/company name

### By Recipient ID
1. Go to Recipients page
2. Look for the recipient ID in the list
3. Or use the direct URL: `https://sandbox.mercury.com/recipients/{RECIPIENT_ID}`

### By Account Last 4 Digits
1. Go to Recipients page
2. Look for recipients with matching last 4 digits
3. Click to view full details

---

## Recipient Status Meanings

- **`pending`**: Recipient created but not yet verified/activated
- **`active`**: Recipient is active and can receive payments
- **`inactive`**: Recipient has been deactivated

**Note**: New recipients may show as `pending` initially. They become `active` after Mercury processes the bank account information.

---

## Troubleshooting

### Can't Find the Recipient?

1. **Check the server logs** - Look for the `recipientId` in the console output:
   ```
   [mercury] Created Mercury recipient: abc123-def456-ghi789 (John Doe)
   ```

2. **Verify it was created** - Check the API response for `success: true` and `recipientId`

3. **Check Mercury dashboard filters** - Make sure no filters are hiding the recipient

4. **Wait a few seconds** - Sometimes there's a slight delay before new recipients appear

5. **Check the correct environment**:
   - Development → https://sandbox.mercury.com
   - Production → https://app.mercury.com

### Recipient Not Showing?

- **Refresh the page** in Mercury dashboard
- **Check API key permissions** - Ensure your API key has `recipients:read` permission
- **Verify the recipient was created** - Check server logs for confirmation

---

## Example: Finding a Worker's Recipient

1. **After worker connects bank account**, note the `recipientId` from the response
2. **Login to Mercury** (sandbox or production)
3. **Go to Recipients** page
4. **Search for the worker's name** or use the recipient ID
5. **Click to view details** - You'll see:
   - Bank account information
   - Account type (checking/savings)
   - Status
   - Any payments sent to this recipient

---

**Last Updated**: January 27, 2026
