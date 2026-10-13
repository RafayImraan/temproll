import test from 'node:test';
import assert from 'node:assert/strict';
import { canRefreshGuardian, classifyPaymentFailure, explainPreflight, guardianFlags, guardianAbi, demoTokenAbi, readGuardianSnapshot } from '../lib/guardian-flow.mjs';

test('Guardian refresh is available only with a wallet, configured contracts, and no active load', () => {
  assert.equal(canRefreshGuardian({ loading: false, hasWallet: true, configured: true }), true);
  assert.equal(canRefreshGuardian({ loading: false, hasWallet: true, configured: false }), false);
  assert.equal(canRefreshGuardian({ loading: false, hasWallet: false, configured: true }), false);
  assert.equal(canRefreshGuardian({ loading: true, hasWallet: true, configured: true }), false);
});

test('Guardian explains a safe payment as low risk and allow', () => {
  assert.deepEqual(explainPreflight([0, 10, 0]), { flags: 0, score: 10, level: 'LOW', action: 'ALLOW', reasons: [] });
});

test('Guardian explains near-budget payments as medium risk', () => {
  const result = explainPreflight([guardianFlags.nearDailyLimit, 45, 0]);
  assert.equal(result.level, 'MEDIUM');
  assert.equal(result.action, 'ALLOW');
  assert.match(result.reasons[0], /75%/);
});

test('Guardian explains approval and blocking conditions with specific reasons', () => {
  const approval = explainPreflight([guardianFlags.approvalRequired, 70, 1]);
  assert.equal(approval.level, 'HIGH');
  assert.equal(approval.action, 'REQUIRE_APPROVAL');
  assert.match(approval.reasons[0], /Employer approval/);
  const blocked = explainPreflight([guardianFlags.recipientNotAllowed | guardianFlags.dailyLimit, 100, 2]);
  assert.equal(blocked.action, 'BLOCK');
  assert.equal(blocked.reasons.length, 2);
});

test('Guardian ABI exposes the contract-enforced preflight and payment flow', () => {
  assert.ok(guardianAbi.some((item) => item.name === 'preflight'));
  assert.ok(guardianAbi.some((item) => item.name === 'execute'));
  assert.ok(demoTokenAbi.some((item) => item.name === 'mint'));
});

test('self-service Guardian ABI supports per-wallet registration, policy, allowlist and escrow funding', () => {
  const names = guardianAbi.map((entry) => entry.name);
  assert.ok(names.includes('registerEmployer'));
  assert.ok(names.includes('deposit'));
  assert.ok(names.includes('employerFunds'));
  assert.equal(guardianAbi.find((entry) => entry.name === 'tokenPolicies').inputs.length, 2);
  assert.equal(guardianAbi.find((entry) => entry.name === 'approvedRecipients').inputs.length, 2);
  assert.ok(demoTokenAbi.some((entry) => entry.name === 'approve'));
});

test('payment failures separate policy reverts from wallet and RPC failures', () => {
  assert.equal(classifyPaymentFailure(new Error('DailyLimitExceeded()')), 'blocked');
  assert.equal(classifyPaymentFailure(new Error('NotDue()')), 'blocked');
  assert.equal(classifyPaymentFailure(Object.assign(new Error('User rejected request'), { code: 4001 })), 'failed');
  assert.equal(classifyPaymentFailure(new Error('HTTP request failed')), 'failed');
});

test('Guardian snapshot decodes schedule and payment events with the contract ABI', async () => {
  const employer = '0x0000000000000000000000000000000000000001';
  const recipient = '0x0000000000000000000000000000000000000002';
  const token = '0x0000000000000000000000000000000000000003';
  const payments = '0x0000000000000000000000000000000000000004';
  const logQueries = [];
  const client = {
    getChainId: async () => 11155111,
    getBytecode: async () => '0x1234',
    getContractEvents: async (query) => {
      logQueries.push(query);
      return query.eventName === 'ScheduleCreated' ? [{ args: { id: 7n } }] : [];
    },
    readContract: async ({ functionName }) => {
      if (functionName === 'owner') return employer;
      if (functionName === 'executor') return employer;
      if (functionName === 'paused') return false;
      if (functionName === 'tokenPolicies') return [100n, 500n, 50n, 60n, true];
      if (functionName === 'authorizedEmployers') return true;
      if (functionName === 'employerFunds') return 500n;
      if (functionName === 'decimals') return 18;
      if (functionName === 'balanceOf') return 0n;
      if (functionName === 'schedules') return [employer, recipient, token, 25n, 25n, 604800n, 2000000000n, 0n, 0, true];
      if (functionName === 'preflight') return [0, 10, 0, 0, 2000000000n, 0n, 0n];
      throw new Error(`Unexpected read: ${functionName}`);
    },
  };

  const snapshot = await readGuardianSnapshot(client, {
    paymentsAddress: payments,
    tokenAddress: token,
    employer,
    deploymentBlock: 1n,
  });

  assert.equal(snapshot.schedules[0].id, '7');
  assert.equal(logQueries.length, 2);
  assert.ok(logQueries.every((query) => query.abi === guardianAbi));
});
