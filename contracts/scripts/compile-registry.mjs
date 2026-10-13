import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '../..');
const source = 'contracts/src/PayrollScheduleRegistry.sol';
const result = spawnSync('solc', ['--combined-json', 'abi,bin', source], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
if (result.error) throw new Error(`Could not run solc: ${result.error.message}`);
if (result.status !== 0) throw new Error(result.stderr || result.stdout || `solc exited ${result.status}`);

const output = JSON.parse(result.stdout);
const contract = Object.entries(output.contracts).find(([name]) => name.endsWith(':PayrollScheduleRegistry'))?.[1];
if (!contract?.bin) throw new Error('solc output did not contain PayrollScheduleRegistry bytecode.');

const artifactPath = resolve(projectRoot, 'contracts/artifacts/PayrollScheduleRegistry.json');
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify({ contractName: 'PayrollScheduleRegistry', compiler: output.version, abi: contract.abi, bytecode: `0x${contract.bin}` }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Compiled PayrollScheduleRegistry with solc ${output.version}\nArtifact: ${artifactPath}\n`);
