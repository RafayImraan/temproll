import { isAddress, parseEventLogs } from 'viem';
import { sepolia } from 'viem/chains';

export const registryAbi = [
  { type: 'function', name: 'employer', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'createSchedule', stateMutability: 'nonpayable', inputs: [{ name: 'scheduleId', type: 'bytes32' }, { name: 'employee', type: 'address' }, { name: 'intervalSeconds', type: 'uint64' }, { name: 'firstDue', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'getSchedule', stateMutability: 'view', inputs: [{ name: 'scheduleId', type: 'bytes32' }], outputs: [{ name: 'scheduleEmployer', type: 'address' }, { name: 'employee', type: 'address' }, { name: 'intervalSeconds', type: 'uint64' }, { name: 'firstDue', type: 'uint64' }, { name: 'exists', type: 'bool' }] },
  { type: 'event', name: 'PayrollScheduleCreated', anonymous: false, inputs: [{ name: 'scheduleId', type: 'bytes32', indexed: true }, { name: 'employer', type: 'address', indexed: true }, { name: 'employee', type: 'address', indexed: true }, { name: 'intervalSeconds', type: 'uint64', indexed: false }, { name: 'firstDue', type: 'uint64', indexed: false }] },
];

export const cadenceOptions = [604800, 1209600, 2592000];
export const sepoliaChainId = 11155111;

export function validateScheduleInput(employeeAddress, cadenceSeconds) {
  if (!isAddress(employeeAddress)) return 'Enter a valid employee wallet address. That address is public on-chain.';
  if (!cadenceOptions.includes(Number(cadenceSeconds))) return 'Choose a supported cadence: weekly, every two weeks, or monthly.';
  return null;
}

export function makeScheduleArguments({ scheduleId, employeeAddress, cadenceSeconds, nowSeconds }) {
  return [scheduleId, employeeAddress, BigInt(cadenceSeconds), BigInt(nowSeconds + 600)];
}

export async function switchToSepolia(provider, rpcUrl, explorerUrl) {
  const chainId = `0x${sepoliaChainId.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId,
      chainName: sepolia.name,
      nativeCurrency: sepolia.nativeCurrency,
      rpcUrls: [rpcUrl],
      blockExplorerUrls: [explorerUrl],
    }] });
    // Adding a chain does not guarantee the wallet selected it.
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}

export function registryErrorMessage(error) {
  const code = error?.code ?? error?.cause?.code;
  const message = String(error?.shortMessage ?? error?.message ?? '').toLowerCase();
  if (code === 4001 || code === 'ACTION_REJECTED') return 'You rejected the wallet request. No schedule was created.';
  if (message.includes('insufficient funds') || message.includes('insufficient balance')) return 'This wallet needs Sepolia test ETH for gas before it can create a schedule.';
  if (message.includes('user rejected') || message.includes('user denied')) return 'You rejected the wallet request. No schedule was created.';
  if (message.includes('failed to fetch') || message.includes('http request failed') || message.includes('timeout')) return 'Could not reach the configured Sepolia RPC. Check the RPC URL and connection, then retry.';
  if (error instanceof Error && error.name === 'RegistryFlowError') return error.message;
  return 'The schedule was not verified. Check the wallet network, registry configuration, and Sepolia RPC, then retry.';
}

/**
 * @param {object} options
 * @param {any} options.walletClient
 * @param {any} options.publicClient
 * @param {`0x${string}`} options.registryAddress
 * @param {`0x${string}`} options.employeeAddress
 * @param {number} options.cadenceSeconds
 * @param {`0x${string}`} options.scheduleId
 * @param {number} options.nowSeconds
 * @param {(pending: object) => void} options.onSubmitted
 */
export async function createVerifiedRegistrySchedule(options) {
  const { walletClient, publicClient, registryAddress, employeeAddress, cadenceSeconds, scheduleId, nowSeconds, onSubmitted } = options;
  const invalid = validateScheduleInput(employeeAddress, cadenceSeconds);
  if (invalid) throw Object.assign(new Error(invalid), { name: 'RegistryFlowError' });
  if (!isAddress(registryAddress)) throw Object.assign(new Error('The configured registry address is missing or invalid.'), { name: 'RegistryFlowError' });

  const employer = (await walletClient.requestAddresses())[0];
  if (!employer) throw Object.assign(new Error('Connect the registry employer wallet to continue.'), { name: 'RegistryFlowError' });
  const walletChain = await walletClient.getChainId();
  if (walletChain !== sepoliaChainId) throw Object.assign(new Error(`Wallet is on ${walletChain === 1 ? 'Ethereum Mainnet' : `chain ${walletChain}`}; switch to Sepolia (${sepoliaChainId}) first.`), { name: 'RegistryFlowError' });
  const rpcChain = await publicClient.getChainId();
  if (rpcChain !== sepoliaChainId) throw Object.assign(new Error(`Configured RPC reports chain ${rpcChain}; expected Sepolia (${sepoliaChainId}).`), { name: 'RegistryFlowError' });

  const authorizedEmployer = await publicClient.readContract({ address: registryAddress, abi: registryAbi, functionName: 'employer' });
  if (authorizedEmployer.toLowerCase() !== employer.toLowerCase()) throw Object.assign(new Error(`Connected wallet is not the registry employer. Connect ${authorizedEmployer.slice(0, 6)}...${authorizedEmployer.slice(-4)}, the deployment wallet.`), { name: 'RegistryFlowError' });

  const args = makeScheduleArguments({ scheduleId, employeeAddress, cadenceSeconds, nowSeconds });
  const hash = await walletClient.writeContract({ account: employer, address: registryAddress, abi: registryAbi, functionName: 'createSchedule', args });
  const firstDue = Number(args[3]);
  onSubmitted({ hash, scheduleId, employee: employeeAddress, intervalSeconds: cadenceSeconds, firstDue });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw Object.assign(new Error('The transaction was mined but reverted.'), { name: 'RegistryFlowError' });
  const event = parseEventLogs({ abi: registryAbi, eventName: 'PayrollScheduleCreated', logs: receipt.logs, strict: true }).find((log) => log.args.scheduleId.toLowerCase() === scheduleId.toLowerCase() && log.args.employer.toLowerCase() === employer.toLowerCase() && log.args.employee.toLowerCase() === employeeAddress.toLowerCase() && log.args.intervalSeconds === BigInt(cadenceSeconds) && log.args.firstDue === BigInt(firstDue));
  if (!event) throw Object.assign(new Error('Receipt succeeded, but the expected schedule event was not found.'), { name: 'RegistryFlowError' });
  const [recordedEmployer, recordedEmployee, interval, due, exists] = await publicClient.readContract({ address: registryAddress, abi: registryAbi, functionName: 'getSchedule', args: [scheduleId] });
  if (!exists || recordedEmployer.toLowerCase() !== employer.toLowerCase() || recordedEmployee.toLowerCase() !== employeeAddress.toLowerCase() || interval !== BigInt(cadenceSeconds) || due !== BigInt(firstDue)) throw Object.assign(new Error('Receipt/event verified, but stored schedule readback did not match.'), { name: 'RegistryFlowError' });
  return { hash, scheduleId, employee: employeeAddress, intervalSeconds: cadenceSeconds, firstDue, blockNumber: receipt.blockNumber };
}
