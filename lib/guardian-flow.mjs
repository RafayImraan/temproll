export const guardianAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'executor', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'approvedRecipients', stateMutability: 'view', inputs: [{ name: 'recipient', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'tokenPolicies', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ name: 'maxPerPayment', type: 'uint128' }, { name: 'dailyLimit', type: 'uint128' }, { name: 'approvalThreshold', type: 'uint128' }, { name: 'recipientChangeCooldown', type: 'uint64' }, { name: 'configured', type: 'bool' }] },
  { type: 'function', name: 'schedules', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: 'scheduleOwner', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint128' }, { name: 'maxPerPayment', type: 'uint128' }, { name: 'interval', type: 'uint64' }, { name: 'nextDue', type: 'uint64' }, { name: 'endAt', type: 'uint64' }, { name: 'executions', type: 'uint32' }, { name: 'active', type: 'bool' }] },
  { type: 'function', name: 'preflight', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: 'flags', type: 'uint16' }, { name: 'riskScore', type: 'uint8' }, { name: 'action', type: 'uint8' }, { name: 'installment', type: 'uint32' }, { name: 'dueAt', type: 'uint64' }, { name: 'tokenBalance', type: 'uint256' }, { name: 'spentToday', type: 'uint256' }] },
  { type: 'function', name: 'setExecutor', stateMutability: 'nonpayable', inputs: [{ name: 'next', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setTokenPolicy', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'maxPerPayment', type: 'uint128' }, { name: 'dailyLimit', type: 'uint128' }, { name: 'approvalThreshold', type: 'uint128' }, { name: 'recipientChangeCooldown', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'setRecipientAllowed', stateMutability: 'nonpayable', inputs: [{ name: 'recipient', type: 'address' }, { name: 'allowed', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'createSchedule', stateMutability: 'nonpayable', inputs: [{ name: 'recipient', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint128' }, { name: 'maxPerPayment', type: 'uint128' }, { name: 'firstDue', type: 'uint64' }, { name: 'interval', type: 'uint64' }, { name: 'endAt', type: 'uint64' }], outputs: [{ name: 'id', type: 'uint256' }] },
  { type: 'function', name: 'approvePayment', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'execute', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelSchedule', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'ScheduleCreated', anonymous: false, inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'owner', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'nextDue', type: 'uint64', indexed: false }, { name: 'interval', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'PaymentExecuted', anonymous: false, inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'execution', type: 'uint32', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'nextDue', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'PaymentApproved', anonymous: false, inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'installment', type: 'uint32', indexed: true }, { name: 'recipient', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'dueAt', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'RecipientApprovalUpdated', anonymous: false, inputs: [{ name: 'recipient', type: 'address', indexed: true }, { name: 'allowed', type: 'bool', indexed: false }] },
  { type: 'event', name: 'TokenPolicyUpdated', anonymous: false, inputs: [{ name: 'token', type: 'address', indexed: true }, { name: 'maxPerPayment', type: 'uint128', indexed: false }, { name: 'dailyLimit', type: 'uint128', indexed: false }, { name: 'approvalThreshold', type: 'uint128', indexed: false }, { name: 'recipientChangeCooldown', type: 'uint64', indexed: false }] },
];

export const demoTokenAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'event', name: 'Transfer', anonymous: false, inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
];

export const guardianFlags = {
  inactive: 1,
  notDue: 2,
  expired: 4,
  recipientNotAllowed: 8,
  recipientChangePending: 16,
  paymentCap: 32,
  dailyLimit: 64,
  insufficientBalance: 128,
  approvalRequired: 256,
  nearDailyLimit: 512,
};

const reasons = [
  [guardianFlags.inactive, 'Schedule is inactive or payments are paused.'],
  [guardianFlags.notDue, 'This installment is not due yet.'],
  [guardianFlags.expired, 'Schedule has passed its end date.'],
  [guardianFlags.recipientNotAllowed, 'Recipient is not on the employer allowlist.'],
  [guardianFlags.recipientChangePending, 'Recipient change cooldown has not been completed.'],
  [guardianFlags.paymentCap, 'Payment exceeds the configured per-payment limit.'],
  [guardianFlags.dailyLimit, 'Payment would exceed today’s spending limit.'],
  [guardianFlags.insufficientBalance, 'Payment contract does not have enough test tokens.'],
  [guardianFlags.approvalRequired, 'Employer approval is required for this amount.'],
  [guardianFlags.nearDailyLimit, 'Payment uses at least 75% of today’s configured budget.'],
];

export function explainPreflight(preflightResult) {
  const flags = Number(preflightResult[0]);
  const score = Number(preflightResult[1]);
  const actionCode = Number(preflightResult[2]);
  return {
    flags,
    score,
    level: score >= 70 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW',
    action: actionCode === 2 ? 'BLOCK' : actionCode === 1 ? 'REQUIRE_APPROVAL' : 'ALLOW',
    reasons: reasons.filter(([flag]) => (flags & flag) !== 0).map(([, reason]) => reason),
  };
}

/** @param {any} publicClient @param {{paymentsAddress: `0x${string}`, tokenAddress: `0x${string}`, employer: `0x${string}`, deploymentBlock: bigint}} config */
export async function readGuardianSnapshot(publicClient, config) {
  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) throw new Error(`Guardian RPC reports chain ${chainId}, expected Sepolia 11155111.`);
  const [paymentsCode, tokenCode] = await Promise.all([
    publicClient.getBytecode({ address: config.paymentsAddress }),
    publicClient.getBytecode({ address: config.tokenAddress }),
  ]);
  if (!paymentsCode || paymentsCode === '0x') throw new Error('No Guardian payment contract bytecode at the configured address.');
  if (!tokenCode || tokenCode === '0x') throw new Error('No test token bytecode at the configured address.');
  const [owner, executor, paused, policy, decimals, walletTokenBalance, paymentTokenBalance, scheduleLogs, paymentLogs] = await Promise.all([
    publicClient.readContract({ address: config.paymentsAddress, abi: guardianAbi, functionName: 'owner' }),
    publicClient.readContract({ address: config.paymentsAddress, abi: guardianAbi, functionName: 'executor' }),
    publicClient.readContract({ address: config.paymentsAddress, abi: guardianAbi, functionName: 'paused' }),
    publicClient.readContract({ address: config.paymentsAddress, abi: guardianAbi, functionName: 'tokenPolicies', args: [config.tokenAddress] }),
    publicClient.readContract({ address: config.tokenAddress, abi: demoTokenAbi, functionName: 'decimals' }),
    publicClient.readContract({ address: config.tokenAddress, abi: demoTokenAbi, functionName: 'balanceOf', args: [config.employer] }),
    publicClient.readContract({ address: config.tokenAddress, abi: demoTokenAbi, functionName: 'balanceOf', args: [config.paymentsAddress] }),
    publicClient.getLogs({ address: config.paymentsAddress, eventName: 'ScheduleCreated', args: { owner: config.employer }, fromBlock: config.deploymentBlock }),
    publicClient.getLogs({ address: config.paymentsAddress, eventName: 'PaymentExecuted', fromBlock: config.deploymentBlock }),
  ]);
  const schedules = await Promise.all(scheduleLogs.map(async (log) => {
    const id = log.args.id;
    const [state, check] = await Promise.all([
      publicClient.readContract({ address: config.paymentsAddress, abi: guardianAbi, functionName: 'schedules', args: [id] }),
      publicClient.readContract({ address: config.paymentsAddress, abi: guardianAbi, functionName: 'preflight', args: [id] }),
    ]);
    return { id: id.toString(), owner: state[0], recipient: state[1], token: state[2], amount: state[3], maxPerPayment: state[4], interval: state[5], nextDue: state[6], executions: state[8], active: state[9], preflight: check };
  }));
  const payments = paymentLogs.map((log) => ({ id: log.args.id.toString(), installment: Number(log.args.execution), recipient: log.args.recipient, token: log.args.token, amount: log.args.amount, nextDue: log.args.nextDue, hash: log.transactionHash, blockNumber: log.blockNumber }));
  return { chainId, owner, executor, paused, policy, decimals: Number(decimals), walletTokenBalance, paymentTokenBalance, schedules, payments };
}
