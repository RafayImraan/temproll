# Temproll

Temproll manages payroll schedules and enforces payment rules on Sepolia and Horizen Testnet. Use the network selector in the dashboard; each network has its own RPC and Guardian contract configuration. The Guardian contract checks a scheduled test-token installment against an employer-specific allowlist, per-payment cap, daily cap, escrow balance, due time, and (when configured) a one-use employer approval. The contract enforces these rules again before a token transfer.

Payment triggering is manual by any wallet; there is no keeper or automatic settlement. `TROLL` is a test-only token with no monetary value. Schedule data, recipients, policies, and transfers are public on whichever testnet is selected. The older `PayrollScheduleRegistry` records schedule metadata only and remains a separate contract. Noir proof generation/verification is not connected to this flow.

Each wallet registers itself as an independent employer. Policies, recipient allowlists, daily spending, and escrowed TROLL balances are isolated per employer. Anyone can trigger a due installment, but the contract pays only the schedule's fixed recipient and debits only that employer's escrow after enforcing policy. TROLL minting is permissionless on this test-only token and capped at 100,000 TROLL per wallet. These permissionless test facilities are not suitable for real assets.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. Without the selected network's Guardian contracts configured, the page explains what is missing. Wallet connection is optional for browsing, but MetaMask and that testnet's test ETH are needed for writes. The page reads records from the selected testnet and recent attempts stored in this browser; local attempt history is not a chain record.

Select **Horizen Testnet** in the network selector to use Horizen's EVM testnet (chain ID `2651420`). Its default public RPC is `https://horizen-testnet.rpc.caldera.xyz/http`, and its explorer is `https://explorer-testnet.horizen.io`. Configure separate `NEXT_PUBLIC_HORIZON_*` contract addresses and deployment block; contract addresses deployed to Sepolia cannot be reused there. Test ETH is available through the [Horizen testnet faucet](https://hub-testnet.horizen.io/).

## Deploy the Sepolia payment contracts manually

The existing schedule registry is not redeployed. Guardian uses two new contracts: `TestPayrollToken` and `RecurringPayments`. Deployment sends two Sepolia transactions and creates a token with no monetary value. Do not run the deploy command until you deliberately choose to deploy these contracts. Keep the test wallet private key only in the temporary PowerShell process; never put it in `.env.local`, frontend variables, a tracked file, or chat. Never use a wallet holding real funds.

Compile locally first:

```powershell
npm.cmd run contract:compile-guardian
```

For deployment, set the RPC endpoint and enter the test key through a hidden prompt. The script checks chain ID `11155111`, waits for both receipts, verifies bytecode, prints addresses and the deployment block, and never prints the private key. It also prints the exact public variables to place in the project-root `.env.local`.

```powershell
$env:SEPOLIA_RPC_URL = 'https://YOUR_SEPOLIA_RPC_URL'
$privateKeyInput = Read-Host -Prompt 'Sepolia test wallet private key' -AsSecureString
$env:SEPOLIA_DEPLOYER_PRIVATE_KEY = [System.Net.NetworkCredential]::new('', $privateKeyInput).Password
npm.cmd run contract:deploy-guardian
$deployExitCode = $LASTEXITCODE
Remove-Item Env:SEPOLIA_DEPLOYER_PRIVATE_KEY
if ($deployExitCode -ne 0) { throw 'Guardian deployment failed.' }
```

The deployment wallet is the Guardian owner for pause/emergency controls; any wallet can register and manage its own payroll. In `.env.local`, set the printed public addresses and start block, plus a public Sepolia RPC URL:

```dotenv
NEXT_PUBLIC_SEPOLIA_RPC_URL=https://YOUR_PUBLIC_SEPOLIA_RPC_URL
NEXT_PUBLIC_SEPOLIA_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_RECURRING_PAYMENTS_ADDRESS=0x...printed-address...
NEXT_PUBLIC_TEST_PAYROLL_TOKEN_ADDRESS=0x...printed-address...
NEXT_PUBLIC_GUARDIAN_DEPLOYMENT_BLOCK=...printed-block...
```

To deploy the same test-only contracts to Horizen Testnet, use `HORIZON_RPC_URL` and a test-only `HORIZON_DEPLOYER_PRIVATE_KEY` in the temporary shell, then run `npm.cmd run contract:deploy-guardian-horizon`. The script validates chain ID `2651420` and prints the three `NEXT_PUBLIC_HORIZON_*` values. Keep Sepolia and Horizen contract addresses and deployment blocks separate.

Do not add secrets to `NEXT_PUBLIC_*`; those values are sent to the browser. Restart the dev server after editing `.env.local`.

## Try a payroll payment

1. Connect any wallet with Sepolia ETH and switch to Sepolia. Select **Register employer** once; this costs gas.
2. Save a token policy. Example: cap `500`, daily limit `2000`, approval threshold `400`, recipient-change cooldown `60` seconds. Policy applies only to the connected employer wallet.
3. Allow an employee address. Mint test TROLL to the connected wallet, then fund that employer's isolated balance. Funding uses an ERC-20 approval followed by a deposit transaction.
4. Create a schedule for an allowed employee. Its first installment is due about two minutes later.
5. Run **Security Check**. It reads the contract preflight result and labels it LOW, MEDIUM, or HIGH with ALLOW, REQUIRE APPROVAL, or BLOCK.
6. For a high-value installment, approve that exact installment from the schedule-owning wallet. Any Sepolia wallet can trigger the due payment; the contract enforces the stored policy and isolated escrow. The app waits for a successful receipt, checks `PaymentExecuted`, and verifies the recipient token balance delta.
7. Try an unapproved recipient, over-cap value, missing token balance, or duplicate/early execution. The UI shows the reason; on-chain policy violations revert without a token transfer. Duplicate execution is prevented because the installment advances after success and is also tracked on-chain.
8. Review recent activity. Etherscan links represent chain-confirmed transactions; check attempts are stored locally in this browser.

The recipient-change cooldown is enforced by the contract. This basic UI does not expose schedule editing; use contract tests for that path. Existing Guardian deployments use the old owner-only/global-balance contract and are incompatible with this self-service version. Deploy fresh contracts and configure their new addresses before using judge wallets. Do not describe TROLL transfers as private or as real payroll settlement.

## Checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run contract:compile
npm.cmd run contract:compile-guardian
npm.cmd run build
```

Run Foundry tests from `contracts` if Foundry and `forge-std` are installed:

```powershell
forge test
```

These checks do not deploy contracts or send transactions. No live Guardian deployment is included by default. The test-token and payment contracts must be separately deployed before the on-chain Guardian flow can be used.
