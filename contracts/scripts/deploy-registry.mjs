import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const privateKey = process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY?.trim();

async function main() {
  if (!rpcUrl) throw new Error('Missing SEPOLIA_RPC_URL. Set it in this shell to your Sepolia RPC endpoint.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) {
    throw new Error('Missing or invalid SEPOLIA_DEPLOYER_PRIVATE_KEY. Set a 32-byte test-wallet key in this shell only.');
  }

  let artifact;
  try {
    artifact = JSON.parse(await readFile(resolve(root, 'contracts/artifacts/PayrollScheduleRegistry.json'), 'utf8'));
  } catch {
    throw new Error('Registry artifact is missing or invalid. Run npm.cmd run contract:compile first.');
  }
  if (!artifact.abi || !/^0x[0-9a-fA-F]+$/.test(artifact.bytecode || '')) {
    throw new Error('Registry artifact does not contain an ABI and deployment bytecode. Re-run contract:compile.');
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) throw new Error(`RPC reported chain ID ${chainId}; refusing deployment because Sepolia is 11155111.`);

  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
  process.stdout.write(`Deploying PayrollScheduleRegistry from ${account.address} to Sepolia (${chainId}).\n`);
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, account });
  process.stdout.write(`Deployment transaction: ${hash}\n`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error(`Deployment transaction ${hash} was mined with status ${receipt.status}.`);
  if (!receipt.contractAddress) throw new Error(`Successful deployment receipt ${hash} did not include a contract address.`);
  const deployedCode = await publicClient.getBytecode({ address: receipt.contractAddress });
  if (!deployedCode || deployedCode === '0x') throw new Error(`No contract bytecode found at ${receipt.contractAddress} after deployment.`);

  process.stdout.write(`Contract address: ${receipt.contractAddress}\n`);
  process.stdout.write(`Transaction: https://sepolia.etherscan.io/tx/${hash}\n`);
  process.stdout.write(`Contract: https://sepolia.etherscan.io/address/${receipt.contractAddress}\n`);
  process.stdout.write(`Set in the Next.js shell: $env:NEXT_PUBLIC_PAYROLL_REGISTRY_ADDRESS = '${receipt.contractAddress}'\n`);
}

main().catch((error) => {
  process.stderr.write(`Sepolia registry deployment failed: ${error instanceof Error ? error.message : 'Unknown error.'}\n`);
  process.exitCode = 1;
});
