# Temproll

Temproll is a Sepolia hackathon demo for payroll policy checks. The Guardian contract checks a scheduled test-token installment against an employer allowlist, per-payment cap, daily cap, available contract balance, due time, and (when configured) a one-use employer approval. The check explains its result; the contract enforces the same rules again before a token transfer.

The payment executor is manual. There is no keeper or automatic settlement. `TROLL` is a demo-only token with no monetary value. Schedule data, recipients, policies, and transfers are public on Sepolia. The older `PayrollScheduleRegistry` records schedule metadata only and remains a separate contract. Noir proof generation/verification is not connected to this flow.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. Without the Guardian contracts configured, the page explains what is missing. Wallet connection is optional for browsing, but MetaMask on Sepolia and test ETH are needed for writes. The page reads Sepolia records and recent attempts stored in this browser; local attempt history is not a chain record.

## Deploy the demo payment contracts manually

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

The deployment wallet becomes both the Guardian owner and payment executor. In `.env.local`, set the printed public addresses and start block, plus a public Sepolia RPC URL:

```dotenv
NEXT_PUBLIC_SEPOLIA_RPC_URL=https://YOUR_PUBLIC_SEPOLIA_RPC_URL
NEXT_PUBLIC_SEPOLIA_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_RECURRING_PAYMENTS_ADDRESS=0x...printed-address...
NEXT_PUBLIC_TEST_PAYROLL_TOKEN_ADDRESS=0x...printed-address...
NEXT_PUBLIC_GUARDIAN_DEPLOYMENT_BLOCK=...printed-block...
```

Do not add secrets to `NEXT_PUBLIC_*`; those values are sent to the browser. Restart the dev server after editing `.env.local`.

## Demo flow

1. Connect the deployer wallet and switch to Sepolia.
2. Save a token policy. Example: cap `500`, daily limit `2000`, approval threshold `400`, recipient-change cooldown `60` seconds. These values cost Sepolia gas to write.
3. Allow an employee address. Mint TROLL to the connected wallet, then fund the payment contract with TROLL.
4. Create a schedule for an allowed employee. Its first installment is due about two minutes later.
5. Run **Security Check**. It reads the contract preflight result and labels it LOW, MEDIUM, or HIGH with ALLOW, REQUIRE APPROVAL, or BLOCK.
6. For a high-value installment, use the owner wallet to approve that exact installment. Connect the configured executor wallet and execute when due. The app waits for a successful receipt, checks `PaymentExecuted`, and verifies the recipient token balance delta before showing it as a verified payment.
7. Try an unapproved recipient, over-cap value, missing token balance, or duplicate/early execution. The UI shows the reason; on-chain policy violations revert without a token transfer. Duplicate execution is prevented because the installment advances after success and is also tracked on-chain.
8. Review recent activity. Etherscan links represent chain-confirmed transactions; check attempts are stored locally in this browser.

The recipient-change cooldown is enforced by the contract. This basic UI does not expose schedule editing; use contract tests for that path. Do not describe TROLL transfers as private or as real payroll settlement.

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
