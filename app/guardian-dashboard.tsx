'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, parseEventLogs, parseUnits, type EIP1193Provider } from 'viem';
import { sepolia } from 'viem/chains';
import { horizon, switchToNetwork } from '@/lib/registry-flow.mjs';
import { canRefreshGuardian, classifyPaymentFailure, demoTokenAbi, explainPreflight, guardianAbi, readGuardianSnapshot } from '@/lib/guardian-flow.mjs';
import 'viem/window';

type Schedule = {
  id: string;
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  interval: bigint;
  nextDue: bigint;
  active: boolean;
  executions: number;
  preflight: readonly [bigint, number, number, number, bigint, bigint, bigint];
};
type Payment = { id: string; installment: number; recipient: `0x${string}`; token: `0x${string}`; amount: bigint; nextDue: bigint; hash: `0x${string}`; blockNumber: bigint };
type Snapshot = {
  chainId: number;
  owner: `0x${string}`;
  executor: `0x${string}`;
  paused: boolean;
  policy: readonly [bigint, bigint, bigint, bigint, boolean];
  employerAuthorized: boolean;
  employerFunds: bigint;
  decimals: number;
  walletTokenBalance: bigint;
  paymentTokenBalance: bigint;
  schedules: Schedule[];
  payments: Payment[];
};
type Attempt = { id: string; kind: string; status: 'flagged' | 'blocked' | 'failed'; detail: string; createdAt: string; hash?: `0x${string}`; scheduleId?: string };
const attemptStorageKey = 'temproll-guardian-attempts-v1';
const cadenceOptions = [{ label: 'Monthly (30 days)', seconds: 2592000 }, { label: 'Every two weeks', seconds: 1209600 }, { label: 'Weekly', seconds: 604800 }];
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const formatAmount = (value: bigint, decimals = 18) => formatUnits(value, decimals);

function parseGuardianLogs<TArgs>(eventName: 'ScheduleCreated' | 'PaymentApproved' | 'PaymentExecuted', logs: readonly unknown[]) {
  return parseEventLogs({ abi: guardianAbi, eventName, logs: logs as never, strict: true }) as unknown as Array<{ args: TArgs }>;
}

function chainError(error: unknown) {
  const item = error as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number; message?: string } };
  const raw = `${item?.shortMessage || ''} ${item?.message || ''} ${item?.cause?.message || ''}`.toLowerCase();
  if (item?.code === 4001 || item?.cause?.code === 4001 || raw.includes('user rejected') || raw.includes('user denied')) return 'Wallet request declined. No payment was made.';
  if (raw.includes('insufficient funds') || raw.includes('exceeds the balance')) return 'The connected wallet needs test ETH for gas.';
  if (raw.includes('failed to fetch') || raw.includes('http request failed') || raw.includes('timeout')) return 'The selected test network RPC is unavailable. Check the public RPC URL and try again.';
  if (raw.includes('recipientnotallowed')) return 'Blocked by the on-chain employee allowlist.';
  if (raw.includes('dailylimitexceeded')) return 'Blocked by the on-chain daily spending limit.';
  if (raw.includes('limitexceeded')) return 'Blocked by the on-chain payment cap.';
  if (raw.includes('approvalrequired')) return 'Employer approval is required before this payment can execute.';
  if (raw.includes('notdue')) return 'This installment is not due yet.';
  if (raw.includes('insufficienttokenbalance')) return 'The payment contract does not have enough test tokens.';
  return 'The contract rejected the request. Check the rules and wallet network.';
}

export default function GuardianDashboard() {
  const [networkKey, setNetworkKey] = useState<'sepolia' | 'horizon'>('sepolia');
  const activeChain = networkKey === 'horizon' ? horizon : sepolia;
  const networkName = networkKey === 'horizon' ? 'Horizen Testnet' : 'Sepolia';
  const rpcUrl = networkKey === 'horizon'
    ? process.env.NEXT_PUBLIC_HORIZON_RPC_URL || horizon.rpcUrls.default.http[0]
    : process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || sepolia.rpcUrls.default.http[0];
  const explorerUrl = (networkKey === 'horizon'
    ? process.env.NEXT_PUBLIC_HORIZON_EXPLORER_URL || horizon.blockExplorers.default.url
    : process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_URL || sepolia.blockExplorers.default.url).replace(/\/$/, '');
  const paymentsAddress = networkKey === 'horizon' ? process.env.NEXT_PUBLIC_HORIZON_RECURRING_PAYMENTS_ADDRESS : process.env.NEXT_PUBLIC_RECURRING_PAYMENTS_ADDRESS;
  const tokenAddress = networkKey === 'horizon' ? process.env.NEXT_PUBLIC_HORIZON_TEST_PAYROLL_TOKEN_ADDRESS : process.env.NEXT_PUBLIC_TEST_PAYROLL_TOKEN_ADDRESS;
  const startBlockRaw = networkKey === 'horizon' ? process.env.NEXT_PUBLIC_HORIZON_GUARDIAN_DEPLOYMENT_BLOCK : process.env.NEXT_PUBLIC_GUARDIAN_DEPLOYMENT_BLOCK;
  const startBlock = /^\d+$/.test(startBlockRaw || '') ? BigInt(startBlockRaw!) : 0n;
  const publicClient = useMemo(() => createPublicClient({ chain: activeChain, transport: http(rpcUrl) }), [activeChain, rpcUrl]);
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletMessage, setWalletMessage] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadMessage, setLoadMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [recipient, setRecipient] = useState('');
  const [recipientAllowed, setRecipientAllowed] = useState<boolean | null>(null);
  const [amount, setAmount] = useState('25');
  const [cadence, setCadence] = useState(2592000);
  const [maxPerPayment, setMaxPerPayment] = useState('500');
  const [dailyLimit, setDailyLimit] = useState('2000');
  const [approvalThreshold, setApprovalThreshold] = useState('400');
  const [recipientCooldown, setRecipientCooldown] = useState('60');
  const [mintAmount, setMintAmount] = useState('1000');
  const [fundAmount, setFundAmount] = useState('500');
  const [selectedCheck, setSelectedCheck] = useState<Record<string, ReturnType<typeof explainPreflight>>>({});

  const guardianConfigured = !!paymentsAddress && isAddress(paymentsAddress) && !!tokenAddress && isAddress(tokenAddress);
  const connectedToSepolia = chainId === activeChain.id;
  const isEmployer = !!snapshot?.employerAuthorized;
  const scheduleBlockReason = !wallet
    ? `Connect a ${networkName} wallet.`
    : !connectedToSepolia
      ? `Switch the wallet to ${networkName}.`
      : !snapshot
        ? 'Waiting for contract data.'
        : !isEmployer
          ? 'Register this wallet as an employer first.'
          : !snapshot.policy[4]
            ? 'Configure the payment policy first.'
            : !isAddress(recipient)
              ? 'Enter a recipient address.'
              : recipientAllowed !== true
                ? 'Allow this recipient first.'
                : busy
                  ? `${busy}...`
                  : '';

  const recordAttempt = useCallback((entry: Omit<Attempt, 'id' | 'createdAt'>) => {
    const record: Attempt = { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    setAttempts((current) => {
      const next = [record, ...current].slice(0, 50);
      try { localStorage.setItem(attemptStorageKey, JSON.stringify(next)); } catch { /* Local audit history is optional when storage is unavailable. */ }
      return next;
    });
  }, []);

  const readWallet = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) return;
    try {
      const client = createWalletClient({ chain: activeChain, transport: custom(provider as EIP1193Provider) });
      const [accounts, currentChain] = await Promise.all([client.getAddresses(), client.getChainId()]);
      setWallet(accounts[0] ?? null);
      setChainId(currentChain);
      setWalletMessage('');
    } catch {
      setWalletMessage('Wallet unavailable. Unlock MetaMask and try again.');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!guardianConfigured || !wallet) return;
    setLoading(true);
    setLoadMessage('');
    try {
      const data = await readGuardianSnapshot(publicClient, {
        paymentsAddress: paymentsAddress as `0x${string}`,
        tokenAddress: tokenAddress as `0x${string}`,
        employer: wallet,
        deploymentBlock: startBlock,
        expectedChainId: activeChain.id,
        networkName,
      }) as Snapshot;
      setSnapshot(data);
      if (data.policy[4]) {
        setMaxPerPayment(formatAmount(data.policy[0], data.decimals));
        setDailyLimit(formatAmount(data.policy[1], data.decimals));
        setApprovalThreshold(formatAmount(data.policy[2], data.decimals));
        setRecipientCooldown(String(data.policy[3]));
      }
    } catch (error) {
      setLoadMessage(chainError(error));
    } finally {
      setLoading(false);
    }
  }, [activeChain.id, guardianConfigured, networkName, publicClient, wallet]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(attemptStorageKey) || '[]');
      if (Array.isArray(stored)) setAttempts(stored.filter((entry) => entry && typeof entry.detail === 'string').slice(0, 50));
    } catch { setAttempts([]); }
    const provider = window.ethereum;
    if (!provider) return;
    const update = () => { if (wallet) void readWallet(); };
    provider.on?.('chainChanged', update);
    provider.on?.('accountsChanged', update);
    return () => {
      provider.removeListener?.('chainChanged', update);
      provider.removeListener?.('accountsChanged', update);
    };
  }, [readWallet, wallet]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    if (!guardianConfigured || !isAddress(recipient)) { setRecipientAllowed(null); return; }
    if (!wallet) { setRecipientAllowed(null); return; }
    void publicClient.readContract({ address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'approvedRecipients', args: [wallet, recipient as `0x${string}`] })
      .then((allowed) => { if (active) setRecipientAllowed(Boolean(allowed)); })
      .catch(() => { if (active) setRecipientAllowed(null); });
    return () => { active = false; };
  }, [guardianConfigured, publicClient, recipient, snapshot, wallet]);

  async function connectWallet() {
    const provider = window.ethereum;
    if (!provider) { setWalletMessage('MetaMask was not found.'); return; }
    try {
      const client = createWalletClient({ chain: activeChain, transport: custom(provider as EIP1193Provider) });
      const accounts = await client.requestAddresses();
      setWallet(accounts[0] ?? null);
      setChainId(await client.getChainId());
      setWalletMessage('');
    } catch (error) { setWalletMessage(chainError(error)); }
  }

  function disconnectWallet() {
    setWallet(null);
    setChainId(null);
    setSnapshot(null);
    setRecipientAllowed(null);
    setWalletMessage('Wallet disconnected from Temproll.');
  }

  async function switchNetwork() {
    const provider = window.ethereum;
    if (!provider) return;
    try {
      await switchToNetwork(provider, activeChain, rpcUrl, explorerUrl);
      await readWallet();
    } catch (error) { setWalletMessage(chainError(error)); }
  }

  async function sendGuardianCall(label: string, functionName: string, args: readonly unknown[]) {
    if (!wallet || !connectedToSepolia) throw new Error('Connect the employer wallet on Sepolia first.');
    if (!guardianConfigured) throw new Error('Sepolia payment contracts are not configured.');
    setBusy(label);
    let hash: `0x${string}` | undefined;
    try {
      const provider = window.ethereum;
      if (!provider) throw new Error('MetaMask was not found.');
      const client = createWalletClient({ chain: activeChain, transport: custom(provider as EIP1193Provider) });
      if (await client.getChainId() !== activeChain.id) throw new Error('Wallet is not on Sepolia.');
      hash = await client.writeContract({ account: wallet, address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: functionName as never, args: args as never });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted on Sepolia.');
      recordAttempt({ kind: label, status: 'flagged', detail: `${label} confirmed on Sepolia.`, hash });
      await refresh();
      return { hash, receipt };
    } catch (error) {
      const message = chainError(error);
      recordAttempt({ kind: label, status: 'failed', detail: message, hash });
      setLoadMessage(message);
      throw error;
    } finally { setBusy(''); }
  }

  async function configurePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.decimals) { setLoadMessage('Payment contracts are not ready.'); return; }
    try {
      const max = parseUnits(maxPerPayment, snapshot.decimals);
      const daily = parseUnits(dailyLimit, snapshot.decimals);
      const approval = parseUnits(approvalThreshold || '0', snapshot.decimals);
      if (max <= 0n || daily < max || approval > max || !/^\d+$/.test(recipientCooldown)) throw new Error('Set a positive payment cap, daily limit at least that cap, valid approval threshold, and whole-second cooldown.');
      const { hash } = await sendGuardianCall('Policy update', 'setTokenPolicy', [tokenAddress, max, daily, approval, BigInt(recipientCooldown)]);
      setLoadMessage(`Policy updated. Transaction ${short(hash)}.`);
    } catch (error) { if (error instanceof Error && !busy) setLoadMessage(error.message); }
  }

  async function changeRecipientAccess(allowed: boolean) {
    if (!isAddress(recipient)) { setLoadMessage('Enter a valid employee wallet address.'); return; }
    try {
      const { hash } = await sendGuardianCall(allowed ? 'Employee allowed' : 'Employee removed', 'setRecipientAllowed', [recipient, allowed]);
      const current = await publicClient.readContract({ address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'approvedRecipients', args: [wallet!, recipient as `0x${string}`] });
      setRecipientAllowed(Boolean(current));
      setLoadMessage(`${allowed ? 'Employee allowed' : 'Employee access removed'} on Sepolia. ${short(hash)}.`);
    } catch { /* Error is already shown by sendGuardianCall. */ }
  }

  async function tokenAction(action: 'mint' | 'fund', event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet || !connectedToSepolia || !snapshot || !isEmployer) { setLoadMessage('Connect and register this wallet on Sepolia first.'); return; }
    try {
      const value = parseUnits(action === 'mint' ? mintAmount : fundAmount, snapshot.decimals);
      if (value <= 0n) throw new Error('Enter a positive token amount.');
      setBusy(action === 'mint' ? 'Minting test tokens' : 'Approving test-token deposit');
      const provider = window.ethereum;
      if (!provider) throw new Error('MetaMask was not found.');
      const client = createWalletClient({ chain: activeChain, transport: custom(provider as EIP1193Provider) });
      let hash: `0x${string}`;
      if (action === 'mint') {
        hash = await client.writeContract({ account: wallet, address: tokenAddress as `0x${string}`, abi: demoTokenAbi, functionName: 'mint', args: [wallet, value] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error('Token mint reverted on Sepolia.');
      } else {
        hash = await client.writeContract({ account: wallet, address: tokenAddress as `0x${string}`, abi: demoTokenAbi, functionName: 'approve', args: [paymentsAddress as `0x${string}`, value] });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash });
        if (approvalReceipt.status !== 'success') throw new Error('Token approval reverted on Sepolia.');
        setBusy('Funding employer balance');
        hash = await client.writeContract({ account: wallet, address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'deposit', args: [tokenAddress as `0x${string}`, value] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error('Employer funding reverted on Sepolia.');
      }
      recordAttempt({ kind: action === 'mint' ? 'Test tokens minted' : 'Employer balance funded', status: 'flagged', detail: `${formatAmount(value, snapshot.decimals)} TROLL · Sepolia confirmed.`, hash });
      setLoadMessage(`${action === 'mint' ? 'Test tokens minted' : 'Employer balance funded'}: ${short(hash)}.`);
      await refresh();
    } catch (error) {
      const message = chainError(error);
      recordAttempt({ kind: action === 'mint' ? 'Mint failed' : 'Funding failed', status: 'failed', detail: message });
      setLoadMessage(message);
    } finally { setBusy(''); }
  }

  async function registerEmployer() {
    try {
      await sendGuardianCall('Employer registration', 'registerEmployer', []);
      setLoadMessage('Wallet registered. Configure your policy and recipient list.');
    } catch { /* Error is already shown by sendGuardianCall. */ }
  }

  async function createRecurringSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.policy[4]) { setLoadMessage('Configure the token policy before creating schedules.'); return; }
    if (!recipientAllowed) { setLoadMessage('Add this employee to the on-chain allowlist first.'); return; }
    try {
      if (!isAddress(recipient)) throw new Error('Enter a valid employee address.');
      const value = parseUnits(amount, snapshot.decimals);
      if (value <= 0n || value > snapshot.policy[0]) throw new Error('Payment must be positive and no higher than the configured cap.');
      setBusy('Creating schedule');
      const provider = window.ethereum;
      if (!provider || !wallet || !connectedToSepolia) throw new Error('Connect the employer wallet on Sepolia.');
      const client = createWalletClient({ chain: activeChain, transport: custom(provider as EIP1193Provider) });
      const firstDue = BigInt(Math.floor(Date.now() / 1000) + 120);
      const hash = await client.writeContract({ account: wallet, address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'createSchedule', args: [recipient, tokenAddress, value, value, firstDue, BigInt(cadence), 0n] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Schedule transaction reverted.');
      const event = parseGuardianLogs<{ id: bigint; owner: `0x${string}`; recipient: `0x${string}`; amount: bigint }>('ScheduleCreated', receipt.logs).find((log) => log.args.owner.toLowerCase() === wallet.toLowerCase() && log.args.recipient.toLowerCase() === recipient.toLowerCase() && log.args.amount === value);
      if (!event) throw new Error('Schedule receipt did not contain the expected ScheduleCreated event.');
      recordAttempt({ kind: 'Schedule created', status: 'flagged', detail: `Schedule #${event.args.id} registered on Sepolia.`, hash, scheduleId: event.args.id.toString() });
      setLoadMessage(`Schedule #${event.args.id} created. First installment is due in about two minutes.`);
      await refresh();
    } catch (error) {
      const message = chainError(error);
      recordAttempt({ kind: 'Schedule creation failed', status: 'failed', detail: message });
      setLoadMessage(message);
    } finally { setBusy(''); }
  }

  async function runSecurityCheck(schedule: Schedule) {
    try {
      const result = await publicClient.readContract({ address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'preflight', args: [BigInt(schedule.id)] });
      const assessment = explainPreflight(result);
      setSelectedCheck((current) => ({ ...current, [schedule.id]: assessment }));
      const status = assessment.action === 'BLOCK' ? 'blocked' : assessment.level === 'MEDIUM' || assessment.action === 'REQUIRE_APPROVAL' ? 'flagged' : 'flagged';
      recordAttempt({ kind: 'Security check', status, detail: `${assessment.level} risk · ${assessment.action}${assessment.reasons.length ? ` · ${assessment.reasons.join(' ')}` : ' · No policy flags.'}`, scheduleId: schedule.id });
      setLoadMessage('Security check read current contract state. No transaction was sent.');
    } catch (error) { setLoadMessage(chainError(error)); }
  }

  async function approvePayment(schedule: Schedule) {
    try {
      const { hash, receipt } = await sendGuardianCall('Employer approval', 'approvePayment', [BigInt(schedule.id)]);
      const approved = parseGuardianLogs<{ id: bigint; installment: number; recipient: `0x${string}`; amount: bigint }>('PaymentApproved', receipt.logs).some((log) => log.args.id === BigInt(schedule.id) && log.args.installment === schedule.executions && log.args.recipient.toLowerCase() === schedule.recipient.toLowerCase() && log.args.amount === schedule.amount);
      if (!approved) throw new Error('Approval receipt did not match this schedule installment.');
      setLoadMessage(`Approval recorded for schedule #${schedule.id}, installment ${schedule.executions}. ${short(hash)}.`);
      await refresh();
    } catch (error) { setLoadMessage(chainError(error)); }
  }

  async function executePayment(schedule: Schedule) {
    if (!wallet || !connectedToSepolia) { setLoadMessage('Connect a wallet on Sepolia.'); return; }
    setBusy(`Executing schedule ${schedule.id}`);
    let hash: `0x${string}` | undefined;
    try {
      const before = await publicClient.readContract({ address: tokenAddress as `0x${string}`, abi: demoTokenAbi, functionName: 'balanceOf', args: [schedule.recipient] }) as bigint;
      await publicClient.simulateContract({ account: wallet, address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'execute', args: [BigInt(schedule.id)] });
      const provider = window.ethereum;
      if (!provider) throw new Error('MetaMask was not found.');
      const client = createWalletClient({ chain: activeChain, transport: custom(provider as EIP1193Provider) });
      hash = await client.writeContract({ account: wallet, address: paymentsAddress as `0x${string}`, abi: guardianAbi, functionName: 'execute', args: [BigInt(schedule.id)] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Execution transaction reverted on Sepolia.');
      const event = parseGuardianLogs<{ id: bigint; execution: number; recipient: `0x${string}`; token: `0x${string}`; amount: bigint }>('PaymentExecuted', receipt.logs).find((log) => log.args.id === BigInt(schedule.id) && log.args.execution === schedule.executions && log.args.recipient.toLowerCase() === schedule.recipient.toLowerCase() && log.args.token.toLowerCase() === tokenAddress?.toLowerCase() && log.args.amount === schedule.amount);
      if (!event) throw new Error('Receipt did not contain the expected PaymentExecuted event.');
      const after = await publicClient.readContract({ address: tokenAddress as `0x${string}`, abi: demoTokenAbi, functionName: 'balanceOf', args: [schedule.recipient] }) as bigint;
      if (after - before !== schedule.amount) throw new Error('Payment event was found, but recipient token balance did not increase by the scheduled amount.');
      recordAttempt({ kind: 'Payment executed', status: 'flagged', detail: `Sepolia verified · ${formatAmount(schedule.amount, snapshot?.decimals)} TROLL paid to ${short(schedule.recipient)}.`, hash, scheduleId: schedule.id });
      setLoadMessage(`Payment verified in block ${receipt.blockNumber}. ${short(hash)}.`);
      await refresh();
    } catch (error) {
      const message = chainError(error);
      recordAttempt({ kind: 'Payment blocked or failed', status: classifyPaymentFailure(error), detail: message, hash, scheduleId: schedule.id });
      setLoadMessage(message);
    } finally { setBusy(''); }
  }

  const scheduleIds = new Set(snapshot?.schedules.map((schedule) => schedule.id) || []);
  const payments = snapshot?.payments.filter((payment) => scheduleIds.has(payment.id)) || [];
  const confirmedPaymentHashes = new Set(payments.map((payment) => payment.hash.toLowerCase()));
  const latestHistory = [
    ...payments.map((payment) => ({ source: networkName, title: `Schedule #${payment.id} · installment ${payment.installment + 1}`, detail: `${formatAmount(payment.amount, snapshot?.decimals)} TROLL · ${short(payment.recipient)}`, hash: payment.hash, sort: Number(payment.blockNumber), type: 'onchain' })),
    ...attempts
      .filter((attempt) => !(attempt.kind === 'Payment executed' && attempt.hash && confirmedPaymentHashes.has(attempt.hash.toLowerCase())))
      .map((attempt) => ({ source: attempt.hash ? `${networkName} tx` : 'Local', title: attempt.kind, detail: attempt.detail, hash: attempt.hash, sort: new Date(attempt.createdAt).getTime(), type: 'local' })),
  ].sort((a, b) => b.sort - a.sort).slice(0, 8);

  return <main className="app-shell">
    <header className="app-header">
      <Link className="app-brand" href="/"><Image src="/temproll-mark.svg" alt="" width={28} height={28} />Temproll</Link>
      <div className="app-header-right">
        <label className="network-switcher"><span className="network-switcher-label">Network</span><span className="network-select-wrap"><select aria-label="Select network" value={networkKey} onChange={(event) => { setNetworkKey(event.target.value as 'sepolia' | 'horizon'); setSnapshot(null); setLoadMessage(''); }}><option value="sepolia">Sepolia</option><option value="horizon">Horizen Testnet</option></select></span></label>
        {wallet ? <div className={`wallet-label${chainId === activeChain.id ? '' : ' mismatch'}`}><span>{chainId === activeChain.id ? networkName : chainId === 1 ? 'Ethereum Mainnet' : `Chain ${chainId}`} · {short(wallet)}</span>{chainId !== activeChain.id && <button onClick={() => void switchNetwork()}>Switch to {networkName}</button>}<button className="button" onClick={disconnectWallet}>Disconnect</button></div> : <button className="button button-primary" onClick={() => void connectWallet()}>Connect wallet</button>}
      </div>
    </header>
    <div className="app-content guardian-content">
      {walletMessage && <p className="notice" role="status">{walletMessage}</p>}
      <div className="guardian-title"><div><h1>Payroll</h1></div><button className="button" onClick={() => void refresh()} disabled={!canRefreshGuardian({ loading, hasWallet: !!wallet, configured: guardianConfigured })}>{loading ? 'Refreshing...' : 'Refresh'}</button></div>

      {!guardianConfigured && <div className="notice" role="status">{networkName} payment contracts are not configured.</div>}
      {loadMessage && <p className="action-message" role="status">{loadMessage}</p>}

      {guardianConfigured && <>
      {wallet && connectedToSepolia && snapshot && !snapshot.employerAuthorized && <section className="guardian-section"><p>Set up this wallet as its own employer.</p><button className="button button-primary" onClick={() => void registerEmployer()} disabled={!!busy}>{busy === 'Employer registration' ? 'Registering...' : 'Register employer'}</button></section>}
      <section className="guardian-section">
        <div className="section-title"><h2>Policy</h2><span>{snapshot?.policy[4] ? 'Configured on Sepolia' : 'Not configured'}</span></div>
        <form className="policy-form" onSubmit={configurePolicy}>
          <label>Max per payment <span>TROLL</span><input type="number" min="0.000000000000000001" step="any" value={maxPerPayment} onChange={(e) => setMaxPerPayment(e.target.value)} /></label>
          <label>Daily limit <span>TROLL</span><input type="number" min="0.000000000000000001" step="any" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} /></label>
          <label>Approval threshold <span>TROLL; 0 disables</span><input type="number" min="0" step="any" value={approvalThreshold} onChange={(e) => setApprovalThreshold(e.target.value)} /></label>
          <label>Recipient cooldown <span>seconds</span><input type="number" min="0" step="1" value={recipientCooldown} onChange={(e) => setRecipientCooldown(e.target.value)} /></label>
          <button className="button button-primary" type="submit" disabled={!isEmployer || !connectedToSepolia || !!busy}>{busy === 'Policy update' ? 'Saving…' : 'Save policy'}</button>
        </form>
        {snapshot && <p className="balance-line">Wallet: {formatAmount(snapshot.walletTokenBalance, snapshot.decimals)} TROLL <span>·</span> Your payroll balance: {formatAmount(snapshot.employerFunds, snapshot.decimals)} TROLL</p>}
      </section>

      <section className="guardian-section">
        <div className="section-title"><h2>New schedule</h2></div>
        <form className="schedule-form" onSubmit={createRecurringSchedule}>
          <label>Recipient<input value={recipient} onChange={(e) => setRecipient(e.target.value)} required pattern="0x[a-fA-F0-9]{40}" autoComplete="off" spellCheck={false} /></label>
          <label>Amount <span>TROLL</span><input type="number" min="0.000000000000000001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label>Frequency<select value={cadence} onChange={(e) => setCadence(Number(e.target.value))}>{cadenceOptions.map((option) => <option value={option.seconds} key={option.seconds}>{option.label}</option>)}</select></label>
          <div className="schedule-access">
            <button className="button" type="button" onClick={() => void changeRecipientAccess(true)} disabled={!isEmployer || !connectedToSepolia || !!busy || !isAddress(recipient)}>Allow recipient</button>
            <button className="button button-danger" type="button" onClick={() => void changeRecipientAccess(false)} disabled={!isEmployer || !connectedToSepolia || !!busy || !isAddress(recipient)}>Remove access</button>
            <span>{recipientAllowed === true ? 'Allowed on Sepolia' : recipientAllowed === false ? 'Not allowed' : isAddress(recipient) ? 'Checking access...' : 'Enter a recipient'}</span>
          </div>
          <button className="button button-primary" type="submit" disabled={!!scheduleBlockReason}>{busy === 'Creating schedule' ? 'Creating...' : 'Create schedule'}</button>
        </form>
        {scheduleBlockReason && <p className="footnote" role="status">{scheduleBlockReason}</p>}
        <p className="footnote">Installments are executed manually when due.</p>
      </section>

      <section className="guardian-section">
        <div className="section-title"><h2>TROLL token</h2><span>No monetary value · Sepolia</span></div>
        <div className="token-actions">
          <form onSubmit={(e) => void tokenAction('mint', e)}><label>Mint to wallet<input type="number" min="0.000000000000000001" step="any" value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} /></label><button className="button" disabled={!isEmployer || !connectedToSepolia || !!busy}>{busy === 'Minting test tokens' ? 'Minting...' : 'Mint test tokens'}</button></form>
          <form onSubmit={(e) => void tokenAction('fund', e)}><label>Fund your payroll balance<input type="number" min="0.000000000000000001" step="any" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} /></label><button className="button" disabled={!isEmployer || !connectedToSepolia || !!busy}>{busy.includes('Funding') || busy.includes('Approving') ? 'Funding...' : 'Fund'}</button></form>
        </div>
      </section>

      <section className="guardian-section">
        <div className="section-title"><h2>Schedules</h2></div>
        {!wallet && <p className="empty-state">Connect the employer wallet to load its schedules.</p>}
        {wallet && snapshot?.schedules.length === 0 && <p className="empty-state">No schedules found for this wallet.</p>}
        <div className="schedule-cards">{snapshot?.schedules.map((schedule) => {
          const assessment = selectedCheck[schedule.id] || explainPreflight(schedule.preflight);
          return <article className="payment-schedule" key={schedule.id}>
            <div className="payment-top"><div><strong>Schedule #{schedule.id}</strong><span>{short(schedule.recipient)} · {formatAmount(schedule.amount, snapshot.decimals)} TROLL · {cadenceOptions.find((item) => item.seconds === Number(schedule.interval))?.label || `${schedule.interval}s`}</span></div><span className={`risk-level ${assessment.level.toLowerCase()}`}>{assessment.level} · {assessment.score}</span></div>
            <div className="risk-details"><b>{assessment.action.replace('_', ' ')}</b>{assessment.reasons.length ? <ul>{assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <span>No policy flags.</span>}</div>
            <div className="payment-bottom"><span>{schedule.active ? `Due ${new Date(Number(schedule.nextDue) * 1000).toLocaleString()}` : 'Inactive'} · installment {schedule.executions + 1}</span><div>
              <button className="text-button" onClick={() => void runSecurityCheck(schedule)} disabled={!!busy}>Check rules</button>
              {assessment.action === 'REQUIRE_APPROVAL' && isEmployer && <button className="text-button" onClick={() => void approvePayment(schedule)} disabled={!!busy}>Approve</button>}
              {assessment.action === 'ALLOW' && <button className="text-button" onClick={() => void executePayment(schedule)} disabled={!connectedToSepolia || !!busy}>Execute payment</button>}
            </div></div>
          </article>;
        })}</div>
      </section>

      <section className="guardian-section">
        <div className="section-title"><h2>Activity</h2><span>{payments.length} confirmed payments</span></div>
        {latestHistory.length === 0 ? <p className="empty-state">No activity yet.</p> : <div className="activity-list">{latestHistory.map((item, index) => <div className="activity-row" key={`${item.type}-${item.hash || item.sort}-${index}`}><div><strong>{item.title}</strong><span>{item.detail}</span></div><small>{item.source}</small>{item.hash && <a href={`${explorerUrl}/tx/${item.hash}`} target="_blank" rel="noreferrer">Explorer ↗</a>}</div>)}</div>}
        <p className="footnote">{networkName} transactions are public. Checks without a transaction are saved in this browser.</p>
      </section>

      </>}
    </div>
  </main>;
}

