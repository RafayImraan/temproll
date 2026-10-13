import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { createVerifiedRegistrySchedule, makeScheduleArguments, registryAbi, registryErrorMessage, switchToSepolia, validateScheduleInput } from '../lib/registry-flow.mjs';

const employer = '0x1111111111111111111111111111111111111111';
const employee = '0x2222222222222222222222222222222222222222';
const registry = '0x3333333333333333333333333333333333333333';
const scheduleId = `0x${'44'.repeat(32)}`;
const hash = `0x${'55'.repeat(32)}`;
const nowSeconds = 1_800_000_000;

test('validates employee address and only supported cadence values', () => {
  assert.match(validateScheduleInput('bad-address', 604800), /valid employee/);
  assert.match(validateScheduleInput(employee, 123), /supported cadence/);
  assert.equal(validateScheduleInput(employee, 2592000), null);
});

test('builds createSchedule arguments including interval and firstDue', () => {
  assert.deepEqual(makeScheduleArguments({ scheduleId, employeeAddress: employee, cadenceSeconds: 1209600, nowSeconds }), [scheduleId, employee, 1209600n, 1_800_000_600n]);
});

test('switches to Sepolia and adds it if the wallet does not know the chain', async () => {
  const calls = [];
  const provider = { request: async (request) => {
    calls.push(request);
    if (request.method === 'wallet_switchEthereumChain' && calls.length === 1) throw { code: 4902 };
  } };
  await switchToSepolia(provider, 'https://rpc.example', 'https://sepolia.etherscan.io');
  assert.deepEqual(calls.map((call) => call.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  assert.equal(calls[1].params[0].chainId, '0xaa36a7');
});

test('preserves wallet errors when switching or adding Sepolia fails', async () => {
  await assert.rejects(switchToSepolia({ request: async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); } }, 'https://rpc.example', 'https://sepolia.etherscan.io'), (error) => registryErrorMessage(error).includes('rejected'));
  let firstSwitch = true;
  const cannotAdd = { request: async ({ method }) => {
    if (method === 'wallet_switchEthereumChain' && firstSwitch) { firstSwitch = false; throw { code: 4902 }; }
    if (method === 'wallet_addEthereumChain') throw new Error('wallet rejected network');
  } };
  await assert.rejects(switchToSepolia(cannotAdd, 'https://rpc.example', 'https://sepolia.etherscan.io'), /wallet rejected network/);
});

function makeClients({ walletChain = 11155111, rpcChain = 11155111, write = async () => hash, receiptStatus = 'success', correctReadback = true } = {}) {
  const argsSeen = [];
  const due = BigInt(nowSeconds + 600);
  const event = registryAbi.find((item) => item.type === 'event');
  const topics = encodeEventTopics({ abi: [event], eventName: 'PayrollScheduleCreated', args: { scheduleId, employer, employee } });
  const data = encodeAbiParameters([{ type: 'uint64' }, { type: 'uint64' }], [1209600n, due]);
  const walletClient = {
    requestAddresses: async () => [employer],
    getChainId: async () => walletChain,
    writeContract: async (args) => { argsSeen.push(args); return write(); },
  };
  const publicClient = {
    getChainId: async () => rpcChain,
    readContract: async ({ functionName }) => functionName === 'employer'
      ? employer
      : [employer, correctReadback ? employee : '0x6666666666666666666666666666666666666666', 1209600n, due, true],
    waitForTransactionReceipt: async () => ({ status: receiptStatus, blockNumber: 77n, logs: [{ address: registry, topics, data }] }),
  };
  return { walletClient, publicClient, argsSeen };
}

const baseOptions = (clients, onSubmitted = () => {}) => ({ ...clients, registryAddress: registry, employeeAddress: employee, cadenceSeconds: 1209600, scheduleId, nowSeconds, onSubmitted });

test('submits, waits for receipt, verifies event and reads schedule back', async () => {
  const clients = makeClients();
  const submitted = [];
  const result = await createVerifiedRegistrySchedule(baseOptions(clients, (value) => submitted.push(value)));
  assert.deepEqual(clients.argsSeen[0].args, [scheduleId, employee, 1209600n, 1_800_000_600n]);
  assert.equal(clients.argsSeen[0].functionName, 'createSchedule');
  assert.equal(submitted[0].hash, hash);
  assert.equal(result.blockNumber, 77n);
  assert.equal(result.firstDue, nowSeconds + 600);
});

test('does not submit if wallet or RPC is on the wrong chain', async () => {
  const wrongWallet = makeClients({ walletChain: 1 });
  await assert.rejects(createVerifiedRegistrySchedule(baseOptions(wrongWallet)), /Ethereum Mainnet/);
  assert.equal(wrongWallet.argsSeen.length, 0);
  const wrongRpc = makeClients({ rpcChain: 1 });
  await assert.rejects(createVerifiedRegistrySchedule(baseOptions(wrongRpc)), /expected Sepolia/);
  assert.equal(wrongRpc.argsSeen.length, 0);
});

test('reports rejected requests, missing test ETH, failed receipts and readback mismatch', async () => {
  const rejected = makeClients({ write: async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); } });
  await assert.rejects(createVerifiedRegistrySchedule(baseOptions(rejected)), (error) => registryErrorMessage(error).includes('rejected'));
  const noGas = makeClients({ write: async () => { throw new Error('insufficient funds for gas'); } });
  await assert.rejects(createVerifiedRegistrySchedule(baseOptions(noGas)), (error) => registryErrorMessage(error).includes('Sepolia test ETH'));
  await assert.rejects(createVerifiedRegistrySchedule(baseOptions(makeClients({ receiptStatus: 'reverted' }))), /reverted/);
  await assert.rejects(createVerifiedRegistrySchedule(baseOptions(makeClients({ correctReadback: false }))), /readback did not match/);
});
