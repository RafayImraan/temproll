import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const privateKey = process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY?.trim();

async function artifact(name) {
  try { return JSON.parse(await readFile(resolve(root, `contracts/artifacts/${name}.json`), 'utf8')); }
  catch { throw new Error(`Missing ${name} artifact. Run npm.cmd run contract:compile-guardian first.`); }
}

async function deploy(publicClient, walletClient, account, name, args = []) {
  const contract = await artifact(name);
  if (!contract.abi || !/^0x[0-9a-fA-F]+$/.test(contract.bytecode || '')) throw new Error(`Invalid ${name} compilation artifact.`);
  const hash = await walletClient.deployContract({ abi: contract.abi, bytecode: contract.bytecode, args, account });
  process.stdout.write(`${name} deployment transaction: ${hash}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} deployment did not produce a successful contract receipt.`);
  const code = await publicClient.getBytecode({ address: receipt.contractAddress });
  if (!code || code === '0x') throw new Error(`${name} has no bytecode at its receipt address.`);
  process.stdout.write(`${name} address: ${receipt.contractAddress}\nExplorer: https://sepolia.etherscan.io/address/${receipt.contractAddress}\n`);
  return { address: receipt.contractAddress, blockNumber: receipt.blockNumber };
}

async function main() {
  if (!rpcUrl) throw new Error('Set SEPOLIA_RPC_URL in the local shell.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw new Error('Set a valid test-only SEPOLIA_DEPLOYER_PRIVATE_KEY in the local shell.');
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) throw new Error(`RPC returned chain ${chainId}; refusing to deploy outside Sepolia.`);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
  process.stdout.write(`Deploying test-only Guardian contracts to Sepolia from ${account.address}. Test token has no monetary value.\n`);
  const token = await deploy(publicClient, walletClient, account, 'TestPayrollToken');
  const payments = await deploy(publicClient, walletClient, account, 'RecurringPayments', [account.address]);
  process.stdout.write(`\nSet these public values in project-root .env.local:\nNEXT_PUBLIC_TEST_PAYROLL_TOKEN_ADDRESS=${token.address}\nNEXT_PUBLIC_RECURRING_PAYMENTS_ADDRESS=${payments.address}\nNEXT_PUBLIC_GUARDIAN_DEPLOYMENT_BLOCK=${payments.blockNumber}\n`);
}

main().catch(() => {
  process.stderr.write('Guardian deployment failed. Check local Sepolia RPC, test wallet configuration, test ETH, compiler artifacts, and transaction receipts. No secret values are printed.\n');
  process.exitCode = 1;
});
