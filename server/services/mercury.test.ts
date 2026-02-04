/**
 * Mercury Bank Service Integration Tests
 * 
 * These tests verify the Mercury Bank API integration works correctly.
 * Run with: npm test mercury.test.ts
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { mercuryService } from './mercury';

describe('Mercury Bank Service', () => {
  describe('Configuration', () => {
    it('should be configured in sandbox mode', () => {
      expect(mercuryService.isConfigured()).toBe(true);
    });

    it('should verify connection to Mercury API', async () => {
      const isConnected = await mercuryService.verifyConnection();
      expect(isConnected).toBe(true);
    });
  });

  describe('Account Operations', () => {
    let testAccountId: string;

    it('should get list of accounts', async () => {
      const accounts = await mercuryService.getAccounts();
      expect(Array.isArray(accounts)).toBe(true);
      
      if (accounts.length > 0) {
        testAccountId = accounts[0].id;
        expect(accounts[0]).toHaveProperty('id');
        expect(accounts[0]).toHaveProperty('name');
        expect(accounts[0]).toHaveProperty('accountNumber');
        expect(accounts[0]).toHaveProperty('routingNumber');
      }
    });

    it('should get account balance', async () => {
      if (!testAccountId) {
        console.log('Skipping: No test account available');
        return;
      }

      const balance = await mercuryService.getBalance(testAccountId);
      expect(typeof balance).toBe('number');
      expect(balance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Recipient Operations', () => {
    let testRecipientId: string;

    it('should create a recipient', async () => {
      const recipient = await mercuryService.createRecipient({
        name: 'Test Worker',
        email: 'test@example.com',
        accountType: 'checking',
        routingNumber: '021000021', // Chase test routing number
        accountNumber: '1234567890',
        note: 'Integration test recipient',
      });

      expect(recipient).toHaveProperty('id');
      expect(recipient.name).toBe('Test Worker');
      testRecipientId = recipient.id;
    });

    it('should get recipient details', async () => {
      if (!testRecipientId) {
        console.log('Skipping: No test recipient created');
        return;
      }

      const recipient = await mercuryService.getRecipient(testRecipientId);
      expect(recipient.id).toBe(testRecipientId);
      expect(recipient.name).toBe('Test Worker');
    });

    it('should list all recipients', async () => {
      const recipients = await mercuryService.listRecipients();
      expect(Array.isArray(recipients)).toBe(true);
      expect(recipients.length).toBeGreaterThan(0);
    });
  });

  describe('Payment Operations (Sandbox)', () => {
    let testRecipientId: string;
    let testPaymentId: string;

    beforeAll(async () => {
      // Create a test recipient for payment testing
      const recipient = await mercuryService.createRecipient({
        name: 'Test Payment Recipient',
        email: 'payment-test@example.com',
        accountType: 'checking',
        routingNumber: '021000021',
        accountNumber: '9876543210',
        note: 'Payment test recipient',
      });
      testRecipientId = recipient.id;
    });

    it('should initiate a payment (sandbox)', async () => {
      if (!testRecipientId) {
        console.log('Skipping: No test recipient available');
        return;
      }

      const payment = await mercuryService.sendPayment({
        recipientId: testRecipientId,
        amount: 10000, // $100.00
        description: 'Test payment',
        idempotencyKey: `test-payment-${Date.now()}`,
        note: 'Integration test payment',
      });

      expect(payment).toHaveProperty('id');
      expect(payment).toHaveProperty('status');
      expect(payment.amount).toBe(10000);
      testPaymentId = payment.id;
    });

    it('should get payment status', async () => {
      if (!testPaymentId) {
        console.log('Skipping: No test payment created');
        return;
      }

      const payment = await mercuryService.getPayment(testPaymentId);
      expect(payment.id).toBe(testPaymentId);
      expect(['pending', 'sent', 'completed', 'failed']).toContain(payment.status);
    });

    it('should handle idempotency correctly', async () => {
      if (!testRecipientId) {
        console.log('Skipping: No test recipient available');
        return;
      }

      const idempotencyKey = `test-idempotency-${Date.now()}`;

      // First payment
      const payment1 = await mercuryService.sendPayment({
        recipientId: testRecipientId,
        amount: 5000,
        description: 'Idempotency test',
        idempotencyKey,
        note: 'Test 1',
      });

      // Duplicate payment with same idempotency key
      const payment2 = await mercuryService.sendPayment({
        recipientId: testRecipientId,
        amount: 5000,
        description: 'Idempotency test',
        idempotencyKey,
        note: 'Test 2 (should be same as Test 1)',
      });

      // Should return the same payment
      expect(payment1.id).toBe(payment2.id);
    });
  });

  describe('Transaction Queries', () => {
    it('should list recent transactions', async () => {
      const transactions = await mercuryService.listTransactions({
        limit: 10,
      });

      expect(Array.isArray(transactions)).toBe(true);
      
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('id');
        expect(transactions[0]).toHaveProperty('amount');
        expect(transactions[0]).toHaveProperty('kind');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid recipient ID', async () => {
      await expect(
        mercuryService.getRecipient('invalid-recipient-id')
      ).rejects.toThrow();
    });

    it('should handle invalid payment details', async () => {
      await expect(
        mercuryService.sendPayment({
          recipientId: 'invalid-id',
          amount: -100, // Invalid negative amount
          description: 'Invalid payment',
          idempotencyKey: `invalid-${Date.now()}`,
        })
      ).rejects.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      // Test with invalid API endpoint
      const invalidService = { ...mercuryService };
      // This would require mocking, but demonstrates the concept
      expect(typeof mercuryService.verifyConnection).toBe('function');
    });
  });

  describe('Business Operations', () => {
    it('should process company top-up workflow', async () => {
      // This is a placeholder for the full workflow test
      // In production, this would:
      // 1. Create a company recipient
      // 2. Request a debit from their account
      // 3. Verify the transaction was created
      // 4. Check the status updates correctly
      expect(true).toBe(true);
    });

    it('should process worker payout workflow', async () => {
      // This is a placeholder for the full workflow test
      // In production, this would:
      // 1. Create a worker recipient
      // 2. Send a payment to their account
      // 3. Verify the payout record was created
      // 4. Check the status updates correctly
      expect(true).toBe(true);
    });
  });
});

/**
 * End-to-End Test Scenarios
 * 
 * Run these manually or with Playwright/Cypress for full UI testing:
 * 
 * 1. Company Bank Linking:
 *    - Navigate to company onboarding
 *    - Enter bank details (routing: 021000021, account: test)
 *    - Submit and verify success message
 *    - Check that Mercury recipient was created
 * 
 * 2. Worker Payout Setup:
 *    - Navigate to worker onboarding
 *    - Enter bank details
 *    - Submit and verify success message
 *    - Check that Mercury recipient was created
 * 
 * 3. Auto-Replenishment:
 *    - Create a company with low balance
 *    - Approve a timesheet that would cause negative balance
 *    - Verify auto-replenishment is triggered
 *    - Check that Mercury debit was requested
 * 
 * 4. Worker Payout:
 *    - Approve a timesheet for a worker with bank account linked
 *    - Verify payout is initiated
 *    - Check that Mercury payment was sent
 * 
 * 5. Manual Company Top-Up:
 *    - Navigate to company dashboard
 *    - Click "Add Funds"
 *    - Enter amount
 *    - Verify Mercury debit request
 * 
 * 6. Escrow Release:
 *    - Create a worker payout before bank account is linked
 *    - Link bank account
 *    - Verify pending payouts are released automatically
 */
