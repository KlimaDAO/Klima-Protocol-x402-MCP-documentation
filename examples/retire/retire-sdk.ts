#!/usr/bin/env tsx
/**
 * Paid retire — minimal SDK example. One `retire()` call runs the whole flow:
 * prepare-auth → sign → submit → poll certificate. See ./README.md for setup,
 * parameters, the four steps, and what you sign.
 *   npm run retire:sdk     (after: npm install && cp .env.example .env)
 */

import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { createClient, KlimaRetireError } from "../../sdk/klima-retire.js";

// ─── defaults (override with flags or env; flag > env > default) ──────────────
const CONFIG = {
  amount: "1", // tonnes (min 0.001)
  carbonClass: "0x0008f35758a4318942EcB5d5414116ce7B1Ede2d", // from klima.discover()
  creditToken: undefined as string | undefined, // pin a credit, or let the server pick
  inputToken: "usdc", // "usdc" | "kvcm" | a token address
  beneficiary: "x402 SDK example", // certificate attribution (immutable once confirmed)
  message: "Retired via the Klima x402 relay",
  baseUrl: "https://x402.klimalabs.com", // endpoint origin (no trailing /api)
};
// ─────────────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    amount: { type: "string" },
    "carbon-class": { type: "string" },
    "credit-token": { type: "string" },
    "input-token": { type: "string" },
    beneficiary: { type: "string" },
    message: { type: "string" },
    "base-url": { type: "string" },
  },
});

if (values.help) {
  console.log(`Retire tokenized carbon via the Klima x402 relay (spends funds).

Usage: npm run retire:sdk -- [options]
       (the -- is required so npm forwards the flags to the script)

Options:
  --amount <t>          tonnes to retire (min 0.001)         [${CONFIG.amount}]
  --carbon-class <0x>   class id (from \`npm run discover\`)    [${CONFIG.carbonClass}]
  --credit-token <0x>   pin a specific credit (else server picks)
  --input-token <tok>   usdc | kvcm | token address          [${CONFIG.inputToken}]
  --beneficiary <str>   certificate attribution (immutable once confirmed)
  --message <str>       certificate message
  --base-url <url>      endpoint origin                      [${CONFIG.baseUrl}]
  -h, --help            show this help

PRIVATE_KEY must be set in examples/.env (a wallet holding the input token).`);
  process.exit(0);
}

// flag > env > default
const cfg = {
  amount: values.amount ?? process.env.AMOUNT ?? CONFIG.amount,
  carbonClass:
    values["carbon-class"] ?? process.env.CARBON_CLASS ?? CONFIG.carbonClass,
  creditToken:
    values["credit-token"] ?? process.env.CREDIT_TOKEN ?? CONFIG.creditToken,
  inputToken:
    values["input-token"] ?? process.env.INPUT_TOKEN ?? CONFIG.inputToken,
  beneficiary:
    values.beneficiary ?? process.env.BENEFICIARY ?? CONFIG.beneficiary,
  message: values.message ?? process.env.MESSAGE ?? CONFIG.message,
  baseUrl: values["base-url"] ?? process.env.BASE_URL ?? CONFIG.baseUrl,
};

// Secret stays out of source: load examples/.env, read the key from the env.
try { process.loadEnvFile(); } catch { /* no .env — rely on ambient env */ }
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY in examples/.env (a wallet holding USDC on Base).");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const klima = createClient({ baseUrl: cfg.baseUrl }); // chainId defaults to 8453

try {
  const result = await klima.retire({
    from: account.address,
    signTypedData: (td) => account.signTypedData(td as any), // signer-agnostic; see README

    amount: cfg.amount,
    carbonClass: cfg.carbonClass,
    ...(cfg.creditToken ? { creditToken: cfg.creditToken } : {}),
    inputToken: cfg.inputToken,
    details: { beneficiaryAddress: account.address, beneficiaryString: cfg.beneficiary, retirementMessage: cfg.message },
    beneficiaryIsPayer: true,
    onStep: (step, info) => console.log(`  · ${step}`, info),
  });

  console.log(`\n${result.status}  tx ${result.transactionHash}`);
  for (const r of result.retirements) {
    console.log(`${r.amountInTonnes} t  →  ${r.certificateUrl}`);
  }
} catch (err) {
  if (err instanceof KlimaRetireError) {
    console.error(`\n✗ ${err.code ?? err.status}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
