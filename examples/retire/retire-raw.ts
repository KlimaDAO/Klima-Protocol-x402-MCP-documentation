#!/usr/bin/env tsx
/**
 * Paid retire with raw protocol walkthrough (no SDK).
 * The four steps, the relay model, and what you sign are all explained in ./README.md.
 *   npm run retire:raw     (set PRIVATE_KEY in .env; viem is used only to sign)
 */

import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";

// ─── defaults (override with flags or env; flag > env > default) ──────────────
const CONFIG = {
  amount: "1", // tonnes (min 0.001; leading zero, "0.5" not ".5")
  carbonClass: "0x0008f35758a4318942EcB5d5414116ce7B1Ede2d", // from /discover
  creditToken: undefined as string | undefined, // pin a credit, or let the server pick
  inputToken: "usdc", // "usdc" | "kvcm" | a token address
  beneficiary: "x402 walkthrough", // certificate attribution (immutable once confirmed)
  message: "Retired via the Klima x402 relay",
  baseUrl: "https://x402.klimalabs.com", // endpoint origin (no trailing /api)
  chainId: 8453, // Base mainnet
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
    "chain-id": { type: "string" },
  },
});

if (values.help) {
  console.log(`Retire tokenized carbon over the raw protocol, no SDK (spends funds).

Usage: npm run retire:raw -- [options]
       (the -- is required so npm forwards the flags to the script)

Options:
  --amount <t>          tonnes to retire (min 0.001)         [${CONFIG.amount}]
  --carbon-class <0x>   class id (from /discover)            [${CONFIG.carbonClass}]
  --credit-token <0x>   pin a specific credit (else server picks)
  --input-token <tok>   usdc | kvcm | token address          [${CONFIG.inputToken}]
  --beneficiary <str>   certificate attribution (immutable once confirmed)
  --message <str>       certificate message
  --base-url <url>      endpoint origin                      [${CONFIG.baseUrl}]
  --chain-id <n>        chain id                             [${CONFIG.chainId}]
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
  chainId: Number(
    values["chain-id"] ?? process.env.CHAIN_ID ?? CONFIG.chainId,
  ),
};

// Base mainnet input-token aliases (or pass an address directly).
const TOKENS: Record<string, `0x${string}`> = {
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  kvcm: "0x00fbac94fec8d4089d3fe979f39454f48c71a65d",
};
const inputToken =
  TOKENS[cfg.inputToken.toLowerCase()] ?? (cfg.inputToken as `0x${string}`);
const API = `${cfg.baseUrl.replace(/\/+$/, "")}/api`;

// Secret stays out of source: load examples/.env, read the key from the env.
try {
  process.loadEnvFile();
} catch {
  /* no .env */
}
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!PRIVATE_KEY) {
  console.error(
    "Set PRIVATE_KEY in examples/.env (a wallet holding the input token on Base).",
  );
  process.exit(1);
}
const account = privateKeyToAccount(PRIVATE_KEY);

async function post(body: Record<string, unknown>) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json as any };
}

console.log(`\nPaid retire (raw) → ${API}`);
console.log(
  `  payer ${account.address} · ${cfg.amount} t · class ${cfg.carbonClass}\n`,
);

// ─── STEP 1/4 · prepare-auth ─────────────────────────────────────────────────
// Returns typedData (the EIP-712 object to sign) + actionsRetireRequest (a ready
// body you add the signature to). Moves no funds. See README "The four steps".

const prep = await post({
  action: "prepare-auth",
  chainId: cfg.chainId,
  from: account.address,
  inputToken,
  carbonClass: cfg.carbonClass,
  ...(cfg.creditToken ? { creditToken: cfg.creditToken } : {}),
  amount: cfg.amount,
  details: {
    // certificate attribution — immutable once confirmed
    beneficiaryString: cfg.beneficiary,
    retirementMessage: cfg.message,
  },
});

if (prep.status !== 200) {
  console.error("prepare-auth failed:", JSON.stringify(prep.body, null, 2));
  process.exit(1);
}
const { typedData, actionsRetireRequest, authValueFormatted } = prep.body;
console.log(
  `1/4 prepare-auth  → authorize ${authValueFormatted} (retirement + fee + executor gas)`,
);

// ─── STEP 2/4 · sign ─────────────────────────────────────────────────────────
// The ONLY signature: a standard token authorization (EIP-3009 for USDC, EIP-2612
// for kVCM). On USDC the authorization's `nonce` is keccak256(retirement, salt),
// so this one signature also covers the credit, amount, and attribution. See
// README "What you sign".

const signature = await account.signTypedData({
  domain: typedData.domain,
  types: typedData.types,
  primaryType: typedData.primaryType,
  message: typedData.message,
});
console.log(`2/4 sign          → ${signature.slice(0, 20)}…`);

// ─── STEP 3/4 · submit ───────────────────────────────────────────────────────
// actionsRetireRequest + signature → executor relays on-chain and pays the gas.
// Spread the template whole — it carries `salt`, without which actions/retire
// cannot recheck the authorization nonce and returns 400.
// Response is `settled` (done) or `pending_index` (mined, poll in step 4).

const submit = await post({
  ...actionsRetireRequest,
  authPayload: { ...actionsRetireRequest.authPayload, signature },
});
if (submit.status !== 200) {
  console.error("actions/retire failed:", JSON.stringify(submit.body, null, 2));
  process.exit(1);
}
const result = submit.body;
console.log(
  `3/4 submit        → ${result.status}  tx ${result.transactionHash}`,
);

// ─── STEP 4/4 · certificate ──────────────────────────────────────────────────
// For `pending_index`, poll /certificate by txHash (ONLY txHash). 404
// retirement_not_found while unindexed is expected — keep polling.

let retirements = result.retirements ?? [];
for (
  let i = 0;
  result.status === "pending_index" && retirements.length === 0 && i < 10;
  i++
) {
  await new Promise((r) => setTimeout(r, 3000));
  const cert = await post({
    action: "certificate",
    txHash: result.transactionHash,
  });
  if (cert.status === 200) retirements = cert.body.retirements ?? [];
}

console.log(`4/4 certificate   → ${retirements.length} retirement(s)`);
for (const r of retirements) {
  console.log(`    ${r.amountInTonnes} t  →  ${r.certificateUrl}`);
}
if (retirements.length === 0) {
  console.log(
    `    not indexed yet — poll certificate with txHash ${result.transactionHash}`,
  );
}
