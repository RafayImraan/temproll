import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sources = ['contracts/src/RecurringPayments.sol', 'contracts/src/TestPayrollToken.sol'];
const result = spawnSync('solc', ['--combined-json', 'abi,bin', ...sources], { cwd: root, encoding: 'utf8', windowsHide: true });
if (result.error) throw new Error(`Could not run solc: ${result.error.message}`);
if (result.status !== 0) throw new Error(result.stderr || result.stdout || `solc exited ${result.status}`);
const output = JSON.parse(result.stdout);
const entries = [
  ['RecurringPayments', 'contracts/src/RecurringPayments.sol:RecurringPayments'],
  ['TestPayrollToken', 'contracts/src/TestPayrollToken.sol:TestPayrollToken'],
];
const artifactDir = resolve(root, 'contracts/artifacts');
await mkdir(artifactDir, { recursive: true });
for (const [contractName, key] of entries) {
  const artifact = output.contracts[key];
  if (!artifact?.bin) throw new Error(`Compiler output is missing ${contractName} bytecode.`);
  await writeFile(resolve(artifactDir, `${contractName}.json`), `${JSON.stringify({ contractName, compiler: output.version, abi: artifact.abi, bytecode: `0x${artifact.bin}` }, null, 2)}\n`, { mode: 0o600 });
}
process.stdout.write(`Compiled RecurringPayments and TestPayrollToken with solc ${output.version}.\nArtifacts are local and ignored by git.\n`);
