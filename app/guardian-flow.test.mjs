import test from 'node:test';
import assert from 'node:assert/strict';
import { explainPreflight, guardianFlags, guardianAbi, demoTokenAbi } from '../lib/guardian-flow.mjs';

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
