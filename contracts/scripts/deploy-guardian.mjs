import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const privateKey = process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY?.trim();
let deploymentPhase = 'configuration validation';
let deploymentProgress = 'No deployment transaction has been submitted.';

function safeFailure(error) {
  const item = error && typeof error === 'object' ? error : {};
  const raw = `${item.name || ''} ${item.shortMessage || ''} ${item.details || ''} ${item.message || error || ''} ${item.cause?.name || ''} ${item.cause?.shortMessage || ''} ${item.cause?.message || ''}`;
  const lower = raw.toLowerCase();
  let category = 'deployment/runtime';
  if (lower.includes('set sepolia_rpc_url') || lower.includes('set a valid test-only sepolia_deployer_private_key')) category = 'configuration';
  else if (lower.includes('insufficient funds') || lower.includes('insufficient balance')) category = 'insufficient Sepolia ETH';
  else if (lower.includes('private key') || lower.includes('invalid account')) category = 'deployer key';
  else if (lower.includes('chain') && (lower.includes('expected') || lower.includes('returned'))) category = 'wrong RPC network';
  else if (lower.includes('artifact') || lower.includes('bytecode') || lower.includes('solc')) category = 'compiler artifact';
  else if (lower.includes('receipt') || lower.includes('timed out') || lower.includes('timeout')) category = 'transaction receipt';
  else if (lower.includes('post-deployment check')) category = 'deployment readback';
  else if (lower.includes('request') || lower.includes('rpc') || lower.includes('fetch') || lower.includes('http')) category = 'RPC/network request';

  const message = raw
    .replace(/https?:\/\/[^\s)"']+/gi, '[RPC URL redacted]')
    .replace(/0x[a-fA-F0-9]{64}/g, '[64-hex value redacted]')
    .replace(/\b[a-fA-F0-9]{64}\b/g, '[64-hex value redacted]')
    .replace(/(api[_ -]?key|token|authorization|private[_ -]?key)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
  return { category, message: message || 'No safe error message was available.' };
}

async function artifact(name) {
  try { return JSON.parse(await readFile(resolve(root, `contracts/artifacts/${name}.json`), 'utf8')); }
  catch { throw new Error(`Missing ${name} artifact. Run npm.cmd run contract:compile-guardian first.`); }
}

async function deploy(publicClient, walletClient, account, name, args = []) {
  const contract = await artifact(name);
  if (!contract.abi || !/^0x[0-9a-fA-F]+$/.test(contract.bytecode || '')) throw new Error(`Invalid ${name} compilation artifact.`);
  deploymentProgress = `${name}: deployment request is being sent; submission status is not yet known.`;
  const hash = await walletClient.deployContract({ abi: contract.abi, bytecode: contract.bytecode, args, account });
  deploymentProgress = `${name}: transaction submitted with hash ${hash}.`;
  process.stdout.write(`${name} deployment transaction: ${hash}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} deployment did not produce a successful contract receipt.`);
  deploymentProgress = `${name}: receipt confirmed at ${receipt.contractAddress}.`;
  const code = await publicClient.getBytecode({ address: receipt.contractAddress });
  if (!code || code === '0x') throw new Error(`${name} has no bytecode at its receipt address.`);
  process.stdout.write(`${name} address: ${receipt.contractAddress}\nExplorer: https://sepolia.etherscan.io/address/${receipt.contractAddress}\n`);
  return { address: receipt.contractAddress, blockNumber: receipt.blockNumber };
}

async function verifyDeployment(publicClient, artifactName, address, checks) {
  const contract = await artifact(artifactName);
  for (const [functionName, args, expected] of checks) {
    const actual = await publicClient.readContract({ address, abi: contract.abi, functionName, args });
    if (actual !== expected) throw new Error(`${artifactName} post-deployment check failed for ${functionName}.`);
  }
}

async function main() {
  if (!rpcUrl) throw new Error('Set SEPOLIA_RPC_URL in the local shell.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw new Error('Set a valid test-only SEPOLIA_DEPLOYER_PRIVATE_KEY in the local shell.');
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
  deploymentPhase = 'Sepolia RPC chain ID check';
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) throw new Error(`RPC returned chain ${chainId}; refusing to deploy outside Sepolia.`);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
  process.stdout.write(`Deploying test-only Guardian contracts to Sepolia from ${account.address}. Test token has no monetary value.\n`);
  deploymentPhase = 'TestPayrollToken deployment';
  const token = await deploy(publicClient, walletClient, account, 'TestPayrollToken');
  deploymentPhase = 'RecurringPayments deployment';
  const payments = await deploy(publicClient, walletClient, account, 'RecurringPayments', [account.address]);
  deploymentPhase = 'post-deployment readback';
  await verifyDeployment(publicClient, 'TestPayrollToken', token.address, [
    ['owner', [], account.address],
    ['symbol', [], 'TROLL'],
    ['decimals', [], 18],
    ['totalSupply', [], 0n],
    ['balanceOf', [payments.address], 0n],
  ]);
  await verifyDeployment(publicClient, 'RecurringPayments', payments.address, [
    ['owner', [], account.address],
    ['executor', [], account.address],
    ['authorizedEmployers', [account.address], true],
    ['paused', [], false],
    ['nextScheduleId', [], 1n],
  ]);
  process.stdout.write('Deployment state verified: token owner/symbol/decimals/empty supply and Guardian owner/executor/employer authorization/unpaused state.\n');
  process.stdout.write(`\nSet these public values in project-root .env.local:\nNEXT_PUBLIC_TEST_PAYROLL_TOKEN_ADDRESS=${token.address}\nNEXT_PUBLIC_RECURRING_PAYMENTS_ADDRESS=${payments.address}\nNEXT_PUBLIC_GUARDIAN_DEPLOYMENT_BLOCK=${payments.blockNumber}\n`);
}

main().catch((error) => {
  const safe = safeFailure(error);
  process.stderr.write(`Guardian deployment failed [${safe.category}] during ${deploymentPhase}: ${safe.message}\n`);
  process.stderr.write(`Deployment progress: ${deploymentProgress}\n`);
  process.stderr.write('RPC URLs, private keys, and environment values are not printed.\n');
  process.exitCode = 1;
});
