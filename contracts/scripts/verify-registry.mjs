import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, isAddress } from 'viem';
import { sepolia } from 'viem/chains';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceName = 'contracts/src/PayrollScheduleRegistry.sol';
const localEnv = await readFile(resolve(root, '.env.local'), 'utf8').catch(() => '');
const localValues = Object.fromEntries(localEnv.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*(NEXT_PUBLIC_PAYROLL_REGISTRY_ADDRESS|NEXT_PUBLIC_SEPOLIA_RPC_URL)\s*=\s*(.*?)\s*$/);
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [];
}));
const address = (process.env.NEXT_PUBLIC_PAYROLL_REGISTRY_ADDRESS || localValues.NEXT_PUBLIC_PAYROLL_REGISTRY_ADDRESS)?.trim();
const rpcUrl = (process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || process.env.SEPOLIA_RPC_URL || localValues.NEXT_PUBLIC_SEPOLIA_RPC_URL)?.trim();

async function main() {
  if (!address || !isAddress(address)) throw new Error('Set a valid NEXT_PUBLIC_PAYROLL_REGISTRY_ADDRESS first.');
  if (!rpcUrl) throw new Error('Set NEXT_PUBLIC_SEPOLIA_RPC_URL or SEPOLIA_RPC_URL first.');
  const source = await readFile(resolve(root, sourceName), 'utf8');
  const input = JSON.stringify({
    language: 'Solidity',
    sources: { [sourceName]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } },
  });
  const compiled = spawnSync('solc', ['--standard-json'], { cwd: root, input, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (compiled.error) throw new Error(`Could not run solc: ${compiled.error.message}`);
  if (compiled.status !== 0) throw new Error('Solidity compilation failed; run contract:compile and check solc.');
  const output = JSON.parse(compiled.stdout.slice(compiled.stdout.indexOf('{')));
  const contract = output.contracts?.[sourceName]?.PayrollScheduleRegistry;
  if (!contract?.evm?.deployedBytecode?.object) throw new Error('Compiler output is missing registry runtime bytecode.');

  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 20_000, retryCount: 0 }) });
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) throw new Error(`RPC reports chain ${chainId}; expected Sepolia (${sepolia.id}).`);
  const code = await publicClient.getBytecode({ address });
  if (!code || code === '0x') throw new Error('No deployed bytecode exists at the configured registry address on Sepolia.');

  const normalize = (value, references) => {
    const bytes = value.slice(2).toLowerCase().split('');
    for (const locations of Object.values(references || {})) for (const { start, length } of locations) {
      bytes.fill('0', start * 2, (start + length) * 2);
    }
    return bytes.join('');
  };
  const references = contract.evm.deployedBytecode.immutableReferences;
  const localRuntime = normalize(`0x${contract.evm.deployedBytecode.object}`, references);
  const chainRuntime = normalize(code, references);
  const runtimeMatches = localRuntime === chainRuntime;
  if (!runtimeMatches) throw new Error(`Deployed runtime does not exactly match the locally compiled source after normalizing immutable employer values (local ${localRuntime.length / 2} bytes; chain ${chainRuntime.length / 2} bytes).`);
  const employer = await publicClient.readContract({ address, abi: contract.abi, functionName: 'employer' });
  process.stdout.write(`Sepolia chain ID: ${chainId}\nRegistry: ${address}\nRuntime bytecode: matches local PayrollScheduleRegistry compilation\nRuntime size: ${code.length / 2 - 1} bytes\nAuthorized employer: ${employer}\nExplorer: https://sepolia.etherscan.io/address/${address}\n`);
}

main().catch((error) => {
  const message = error instanceof Error && error.name === 'HttpRequestError'
    ? 'Could not reach the configured Sepolia RPC. Check RPC connectivity and URL.'
    : error instanceof Error ? error.message : 'Registry verification failed.';
  process.stderr.write(`Registry verification failed: ${message}\n`);
  process.exitCode = 1;
});
