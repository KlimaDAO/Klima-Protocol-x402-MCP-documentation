<!--
  DO NOT EDIT. Published automatically from Carbonmark/x402-klima-RA-new/docs/x402-endpoint.md.
  Changes made here will be overwritten by the next docs sync.
  Edit the source file and open a PR there instead.
-->

# Klima x402 Endpoint

> Page content for **https://www.klimalabs.com/x402-endpoint**

Retire tokenized carbon credits on **Base** through the KlimaDAO Retirement Aggregator straight from an AI agent or any HTTP client. The endpoint discovers retirable carbon, prices it live, hands back unsigned `[approve, retire]` calldata, and resolves the public Carbonmark certificate once the transaction confirms.

> **Base URL:** `https://x402.klimalabs.com/api`
> **Chain:** Base mainnet (`chainId=8453`) only
> **Auth:** none on the HTTP layer. Reads are free **GET**s; the paid relay path **POST**s to the same `/api`. The only cost is on-chain: the protocol fee inside the retirement transaction (plus gas reimbursement on the relay path).
> **Agent manifest:** `https://x402.klimalabs.com/.well-known/x402.json`
> **Agent plugin + setup docs:** [github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation)

## Why x402

The endpoint is built for the [x402](https://www.x402.org/) agent-payments ecosystem and plugs directly into [Base MCP](https://docs.base.org/ai-agents/quickstart): an agent reads the catalog, prepares a retirement, and submits the batch through the user's Base Account wallet in a single approval. See the [Base MCP setup guide](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation/blob/main/base-mcp-setup.md) for the connection steps. 

Two ways to retire:

- **Build-your-own (free GET):** `discover` → `quote` → `prepare/retire` hands back unsigned `[approve, retire]` calldata that **you** submit from a Base Account (e.g. via Base MCP). Reads are free; you pay gas and submit the batch yourself.
- **Paid relay (sign once, no gas, no Base account):** `prepare-auth` → sign one EIP-712 token authorization → `actions/retire`. A Klima executor relays the retirement on-chain and **pays the gas**, reimbursed from your signed budget. Any third-party wallet or agent can do this — see [Paid retire (relay)](#paid-retire-relay--sign-once-no-gas) below.

## The read endpoints

All are GET; reads never move funds.

### 1. `GET /discover` — what's retirable

```
GET /discover[?carbonClass=0x...][&creditToken=0x...][&maxUsdcPricePerTonne=20]
```

Lists carbon classes from the protocol subgraph, each with a **reference USDC/tonne price**, the credits inside it (registry, vintage, token, available liquidity), plus supported input tokens and contract addresses. Filters are optional and AND-combined (`maxUsdcPricePerTonne=20` means ≤ $20/tonne). `chainId` is **not** accepted here.

```bash
curl "https://x402.klimalabs.com/api/discover?maxUsdcPricePerTonne=15"
```

> **Reference price ≠ price at size.** `priceUsdcPerTonne` is the **marginal/spot** price (accurate near 1 tonne). Large orders walk up the AAM curve e.g. Biochar quoted ~$107.82/t at 1 t but ~$386.61/t for 100 t (≈ 58% of pool liquidity). Always call `/quote` for the true cost of your size.

### 2. `GET /quote` — live price

```
GET /quote?chainId=8453&inputToken=0x...&carbonClass=0x...&amount=1.5[&creditToken=0x...][&vintage=2022][&tokenId=<id>]
```

Returns the retirement price, the on-chain `fee`, `total` (price + fee), `suggestedMaxInput` (total + 4% slippage), a `humanSummary`, the `resolvedCredit` the server selected, and `alternatives`. When you don't pin a credit, the server picks the most-liquid one in the class that can cover `amount`.

```bash
curl "https://x402.klimalabs.com/api/quote?chainId=8453\
&inputToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\
&carbonClass=0xf4699531e0a5f6e9351a36de3753deaad329bf45&amount=1.5"
```

```json
{
  "tonnesFormatted": "1.5",
  "retirementPriceFormatted": "19.791336",
  "feeFormatted": "0.01",
  "totalFormatted": "19.801336",
  "suggestedMaxInputFormatted": "20.593389",
  "humanSummary": "1.5 tonnes @ 19.791336 USDC + 0.01 USDC fee = 19.801336 USDC (max 20.593389 USDC with 4% slippage)",
  "resolvedCredit": { "creditToken": "0xe662…71b8", "tokenId": 0, "vintage": 2021 }
}
```

### 3. `GET /prepare/retire` — unsigned calldata

```
GET /prepare/retire?chainId=8453&inputToken=0x...&carbonClass=0x...&amount=1.5[&creditToken=0x...][&vintage=2022][&tokenId=<id>][&maxInputTokenIn=<atomic>][&details=<urlencoded JSON>]
```

Re-quotes on-chain and returns an **ordered batch** — an ERC-20 `approve` followed by the retirement — to be submitted atomically (e.g. via Base MCP `send_calls`). The `to` field and `approvalInstructions.spender` are both the Settlement Contract; read them from the response rather than hard-coding.

**`details`** is an optional URL-encoded JSON object for certificate metadata. The schema is strict (unknown keys 400):

| Field | Meaning |
|---|---|
| `retiringAddress` | address performing the retirement — defaults to the payer when omitted |
| `beneficiaryAddress` | address credited with the retirement. **Required on the relay path** (`prepare-auth` / `actions/retire`) unless you pass `beneficiaryIsPayer: true`; defaults to the payer on the self-submit path. |
| `beneficiaryString` | beneficiary display name — **shows on the certificate** |
| `retiringEntityString` | retiring-entity display name |
| `retirementMessage` | public message on the certificate |
| `beneficiaryLocation`, `consumptionCountryCode`, `consumptionPeriodStart`, `consumptionPeriodEnd` | **Toucan Puro only** — required for Puro credits |

> **Attribution tip:** `beneficiaryString` and `retirementMessage` are what make a certificate *named*; the certificate **cannot be edited after the retirement confirms**, so set them up front. (The certificate's on-chain `retiringAddress` reflects an internal settlement/relayer address, not the `details.retiringAddress` you pass.)

### 4. `GET /certificate` — public proof

```
GET /certificate?txHash=0x...[&index=0]
```

After the retirement confirms, resolves the shareable **Carbonmark certificate URL(s)** for the transaction. `index` selects one retirement out of a multi-retirement transaction; omit it for all.

```json
{
  "retirementCount": 1,
  "retirements": [{
    "certificateUrl": "https://app.carbonmark.com/retirements/id/8453-0x4a7f…f4bf-0",
    "amountInTonnes": "1",
    "beneficiaryAddress": "0x1234567890123456789012345678901234567890",
    "beneficiaryName": "testing",
    "projectId": "UCR-423",
    "creditId": "UCR-423-2022"
  }]
}
```

`beneficiaryAddress` is the address credited on-chain — check this one to verify attribution. `retiringAddress` on the same entry is the aggregator's settlement address, not the party the retirement was made for.

A `404 retirement_not_found` right after confirmation just means the subgraph hasn't indexed yet — retry in a few seconds.

### 5. Manifest — `/.well-known/x402.json`

Agent-discovery manifest describing the endpoint for x402 directories. Each action carries its `inputSchema`, `outputSchema`, and `errorCodes` — the codes that action can return, resolvable against the registry below.

### 6. Error codes — `/.well-known/x402-errors.json`

Machine-readable registry of every `error` value the API returns (GET alias: `/api/errors`). One entry per code with its HTTP `status`, `group`, `retryable` flag, the actions that emit it, what it means, and the remedy. It is the same data as the [error reference](#error-reference) below, which is generated from it.

## Versioning — pinning a major

The API is versioned by host. Every release answers at two addresses:

| Host | Serves |
| --- | --- |
| `x402.klimalabs.com` | the **latest** release. Moves across majors — a breaking release moves it. |
| `v1.x402.klimalabs.com` | the **v1 major**, and every future 1.x patch and minor. Never moves to v2. |
| `v0.x402.klimalabs.com` | the previous major, still answering for callers that have not migrated. |

Everything on this page describes **v1**. If your integration predates it and you are not ready for the [v1 breaking changes](#error-reference), point at `v0.x402.klimalabs.com` and migrate when you can — v0 is not being extended, only kept reachable.

Both `/.well-known/x402.json` and `/.well-known/x402-changelog.json` (GET alias `/api/changelog`) carry `apiVersion` and a `versionedHosts` object, so an agent can resolve the right host without reading this table. The changelog also carries a `migration` string on every breaking release.

## Paid retire (relay) — sign once, no gas

The relay path lets **any wallet or agent** retire without holding native ETH, without a prior token approval, and without a Base Account. You sign **one** standard EIP-712 token authorization; a Klima executor submits the on-chain transaction and is reimbursed for gas out of your signed budget.

> **You sign one token authorization, and it binds the retirement.** The only signature is a standard [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) `TransferWithAuthorization` (USDC) or [EIP-2612](https://eips.ethereum.org/EIPS/eip-2612) `Permit` (kVCM) — exactly what any x402-style payment signs, so client signing stays plain `eth_signTypedData_v4` with no custom typed data to assemble.
>
> On the USDC path the authorization's `nonce` is not random: it is `keccak256(retirement, salt)` — the exact credit, token id, amount, and full attribution struct being authorized, plus a fresh 32-byte `salt` the server mints for each authorization and returns in `actionsRetireRequest`. Because `nonce` is one of the six signed EIP-3009 fields, your signature covers **what gets retired and who is credited**, not just the dollar value. `actions/retire` rebuilds the retirement from the submitted body, re-hashes it with the submitted `salt`, and returns `400 params_mismatch` if the result isn't the nonce you signed — so nothing between you and the endpoint can swap the retirement out after you sign. Check `onChainDetails` before signing; it is exactly what the hash commits to.
>
> **Post `actionsRetireRequest` back verbatim, `salt` included.** It is one of the two inputs to the nonce and the authorization cannot be verified without it (`400 invalid_auth_payload`). It is not a secret and needs no special handling — the nonce is pinned by your signature, so no attacker-chosen salt can make a different retirement hash to it.
>
> The salt is what keeps the nonce *verifiable* without making it *deterministic*. USDC permanently burns each `(from, nonce)` pair on use, so an unsalted commitment would give two identical retirements by the same payer the same nonce, and the second would revert inside the token. One salt per authorization means repeat retirements of the same credit for the same beneficiary just work.
>
> The kVCM (EIP-2612) path carries no commitment and no salt: `Permit`'s nonce is the token's own sequential counter, with no caller-chosen field to bind to. Use USDC where this property matters.

### Flow

```
1. POST /api  prepare-auth   → server resolves + prices, returns:
                                 • typedData            (EIP-712 object to sign)
                                 • actionsRetireRequest (ready-to-send body,
                                     incl. `salt` on the USDC path)
2. wallet     signTypedData(typedData)        ← the ONLY signing step
3. POST /api  actions/retire (body + signature) → executor relays on-chain
4. POST /api  certificate    { txHash }       → public proof (poll if pending)
```

`prepare-auth` is the 200 alias of the 402 challenge that `actions/retire` returns when posted **without** an `authPayload`; either entry point gives you the same `typedData`. The signed budget (`authValue`) covers **retirement + protocol fee + executor gas reimbursement**, slippage-buffered. The signer needs only an input-token balance (USDC or kVCM) — **no ETH**.

### Client SDK

The four steps are wrapped in a tiny, **zero-dependency** TypeScript client — [`sdk/klima-retire.ts`](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation/blob/main/sdk/klima-retire.ts). Drop the single file into your project (or `npm i @klimadao/x402-retire` once published — same API). It's **signer-agnostic**: you pass a `signTypedData` callback, so it works with viem, ethers, a browser wallet, or an agent's signer with no hard wallet dependency.

```ts
import { createClient } from "./klima-retire";
import { privateKeyToAccount } from "viem/accounts"; // or ethers, or a browser wallet

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const klima = createClient(); // defaults to https://x402.klimalabs.com, chainId 8453

const { status, transactionHash, retirements } = await klima.retire({
  from: account.address,
  amount: "1",
  carbonClass: "0xf4699531e0a5f6e9351a36de3753deaad329bf45", // from discover()
  inputToken: "usdc",                                        // or "kvcm" / an address
  details: { beneficiaryString: "Acme Corp", retirementMessage: "Net-zero 2026" },
  beneficiaryIsPayer: true,   // or details.beneficiaryAddress. one is required
  signTypedData: (td) => account.signTypedData(td as any),   // your wallet's signer
});

console.log(status, transactionHash);
for (const r of retirements) console.log(r.amountInTonnes, "t →", r.certificateUrl);
```

`retire()` runs the whole flow — prepare-auth → sign → submit → poll the certificate — and returns once the retirement is `settled` (or `pending_index` with a `transactionHash` you can resolve later). The same client also exposes `discover()`, `quote()`, and `certificate()`.

**Other wallets:** ethers — `signTypedData: (td) => signer.signTypedData(td.domain, td.types, td.message)`; browser — `signTypedData: (td) => window.ethereum.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(td)] })`.

Runnable examples live in [`examples/`](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation/tree/main/examples): a read-only discover + quote script (safe to run, no wallet), the minimal SDK retire, and a raw-HTTP protocol walkthrough for porting to other languages.

### `actions/retire` responses

| `status` | Meaning |
|---|---|
| `settled` | Mined **and** indexed — `retirements[]` carries the certificate URL(s). |
| `pending_index` | Mined (or broadcast) but subgraph not caught up — poll `/certificate` with `transactionHash`. |

Anything else is an error; see the reference below.

## Error reference

Every non-2xx response — and the 402 challenge — uses one envelope:

```json
{ "error": "<code>", "message": "…", "x402FacilitatorVersion": 2 }
```

plus code-specific context fields (`issues` on `schema_validation`, `expectedNonce`/`receivedNonce`/`submitted` on `params_mismatch`, `availableVintages` on `vintage_not_found`, and so on). **Match on `error`, never on `message`** — codes are stable, wording is not.

`retryable: yes` means the identical request can succeed later untouched. `retryable: no` means fix the request first.

<!-- generated:error-codes -->
<!-- Do not edit by hand: npm run docs:render -->

| Code | HTTP | Group | Retryable | Meaning and remedy |
| --- | --- | --- | --- | --- |
| `invalid_json` | 400 | request | no | The request body was not parseable JSON. Send a JSON object with a `content-type: application/json` header. Note the API takes a single POST body, not form-encoded fields. |
| `unknown_action` | 400 | request | no | The body's `action` field is missing or is not one of the supported actions. Set `action` to one of the values in `supported` (echoed in the error body), or GET the endpoint root for the action index. |
| `not_found` | 404 | request | no | No route exists at the requested path. This API is a single POST multiplexer: POST the endpoint URL with an `action` field rather than using per-action paths. The 404 body carries the endpoint and action list. |
| `document_not_found` | 404 | request | no | No documentation document with the requested `id` (from `/api/docs?id=…`). Use one of the ids in the error's `available` list, or fetch the index at /api/docs. |
| `schema_validation` | 400 | request | no | The body failed schema validation. `issues` carries the offending path and reason. Bodies are strict at the top level and inside `details`, so an unrecognized key is an error rather than being silently dropped. Read `issues[].path` and `issues[].keys`. For `unrecognized_keys`, check the key belongs where you put it — attribution fields go inside `details`, not at the top level. |
| `internal_error` | 500 | request | yes | An unhandled server-side failure. Retry with backoff. If it persists, report it via the contact in /.well-known/security.txt with the request body. |
| `unsupported_chain_id` | 400 | resolution | no | `chainId` is not a supported network. Use 8453 (Base mainnet) or 84532 (Base Sepolia). |
| `unsupported_input_token` | 400 | resolution | no | `inputToken` is not an accepted payment token on this chain. Use the USDC or kVCM address for the chain — see the manifest, or the addresses in the endpoint documentation. |
| `invalid_input_token` | 400 | resolution | no | `inputToken` passed validation but matches neither settlement path (EIP-3009 USDC nor EIP-2612 kVCM), so no relay function applies. Use the chain's USDC or kVCM address. |
| `no_candidates` | 404 | resolution | yes | No credit in the carbon class matched the request filters, or the class holds no credits. Call `discover` to list live classes and credits, then retry with a `carbonClass`/`creditToken` from that response. Retryable because class inventory changes. |
| `vintage_not_found` | 400 | resolution | no | No credit in the class carries the requested `vintage`. Pick one of the years in the error's `availableVintages`, or omit `vintage` to let the server choose a liquid credit. |
| `insufficient_liquidity` | 422 | amount | yes | The pool cannot fill the requested amount at any price right now. Reduce `amount`, choose another credit or class, or retry later. Retryable because pool depth changes block to block. |
| `amount_not_whole_tonnes` | 422 | amount | no | The credit's registry (Puro) retires in whole tonnes only, and `amount` has a fractional part. Send an integer `amount` (e.g. "2", not "2.5"). |
| `amount_below_increment` | 422 | amount | no | `amount` is smaller than the credit's minimum retirement unit. Raise `amount` to at least the minimum reported in the error body. |
| `puro_details_required` | 400 | amount | no | The credit is Puro-issued, whose registry requires consumption metadata that the request omitted. Add the fields named in the error body to `details`: `beneficiaryLocation`, `consumptionCountryCode`, `consumptionPeriodStart`, `consumptionPeriodEnd`. |
| `payment_required` | 402 | authorization | no | Not a failure: the x402 challenge returned when `actions/retire` is posted without an `authPayload`. The body carries the EIP-712 `typedData` to sign and a ready-to-send `actionsRetireRequest`. Identical in shape to a `prepare-auth` 200. Sign `typedData` with the payer wallet, set `authPayload.signature` (or `v`/`r`/`s`), and POST `actionsRetireRequest` back — verbatim, including `salt` on the USDC path. |
| `attribution_required` | 400 | authorization | no | A relayed retirement named no beneficiary. The beneficiary is indexed on-chain as a permanent grouping key and cannot be changed once the retirement confirms, so it is not defaulted silently. Set `details.beneficiaryAddress` to the party the retirement is for, or set `beneficiaryIsPayer: true` to credit the paying wallet deliberately. |
| `invalid_auth_payload` | 400 | authorization | no | The authorization is structurally wrong for this request: `authPayload.from` is not the request `from`, `authPayload.to` is not the settlement contract, the payload shape doesn't match the input token's scheme (EIP-3009 for USDC, EIP-2612 for kVCM), or a USDC payload arrived without its top-level `salt`. Post the `actionsRetireRequest` from `prepare-auth` (or the 402 challenge) verbatim, adding only the signature. Do not rebuild the payload by hand. |
| `insufficient_authorized_value` | 400 | authorization | no | The signed `authPayload.value` no longer covers retirement + protocol fee + executor gas, usually because price or gas moved after signing. Relaying it would revert on-chain. Re-run `prepare-auth` (or re-request the 402 challenge) to size a fresh budget of at least `requiredMinimum`, then re-sign. The old authorization is unusable, not merely stale. |
| `params_mismatch` | 400 | authorization | no | The submitted retirement is not the one that was authorized. On the USDC path `authPayload.nonce` is keccak256 of the retirement plus `salt`, so the signature binds the credit, amount, and attribution — not just the spend value. The rebuilt struct hashed to something else. Re-post `actionsRetireRequest` verbatim including `creditToken`, `tokenId`, `details`, and `salt`, or re-run `prepare-auth` and re-sign. A salt is single-use; one from an earlier authorization will not reproduce the nonce. The error echoes `expectedNonce`, `receivedNonce`, and the `submitted` values to diff against. |
| `contract_revert` | 422 | settlement | yes | A contract call reverted during simulation, so nothing was broadcast and no funds moved. `selector` and `decoded.errorName` identify the revert; `contract`, `function`, and `args` give the call context. Read `decoded.errorName`. Liquidity and slippage reverts are worth retrying with a fresh quote; validation and permission reverts are not. |
| `transaction_reverted` | 422 | settlement | yes | The relayed transaction mined but reverted, typically from a state change between simulation and inclusion. No retirement was recorded. Inspect `transactionHash` on a block explorer, then re-run `prepare-auth` and re-sign. The old authorization's nonce may already be consumed. |
| `retirement_not_found` | 404 | settlement | yes | No indexed retirement for that transaction hash. Immediately after confirmation this means the subgraph has not caught up yet, not that the retirement failed. Poll every few seconds. If a retirement response returned `pending_index`, this is the expected interim state. |
| `gas_estimate_unavailable` | 503 | upstream | yes | The executor's gas reimbursement could not be priced, so the authorization budget cannot be sized. No retirement was attempted. Retry with backoff. Nothing was signed or spent, so the request can be repeated unchanged. |

<!-- /generated:error-codes -->

On-chain failures all surface as `contract_revert`, with the specific revert decoded onto the response as `selector` and `decoded.errorName` rather than enumerated above.

### Which action returns what

<!-- generated:error-codes-by-action -->
<!-- Do not edit by hand: npm run docs:render -->

| Action | Codes specific to it |
| --- | --- |
| `discover` | — |
| `quote` | `unsupported_chain_id`, `unsupported_input_token`, `no_candidates`, `vintage_not_found`, `insufficient_liquidity`, `amount_not_whole_tonnes`, `amount_below_increment`, `contract_revert` |
| `prepare/retire` | `unsupported_chain_id`, `unsupported_input_token`, `no_candidates`, `vintage_not_found`, `insufficient_liquidity`, `amount_not_whole_tonnes`, `amount_below_increment`, `puro_details_required`, `contract_revert` |
| `prepare-auth` | `unsupported_chain_id`, `unsupported_input_token`, `no_candidates`, `vintage_not_found`, `insufficient_liquidity`, `amount_not_whole_tonnes`, `amount_below_increment`, `puro_details_required`, `attribution_required`, `contract_revert`, `gas_estimate_unavailable` |
| `actions/retire` | `unsupported_chain_id`, `unsupported_input_token`, `invalid_input_token`, `no_candidates`, `vintage_not_found`, `insufficient_liquidity`, `amount_not_whole_tonnes`, `amount_below_increment`, `puro_details_required`, `payment_required`, `attribution_required`, `invalid_auth_payload`, `insufficient_authorized_value`, `params_mismatch`, `contract_revert`, `transaction_reverted`, `gas_estimate_unavailable` |
| `certificate` | `retirement_not_found` |

Every action can additionally return: `invalid_json`, `unknown_action`, `not_found`, `document_not_found`, `schema_validation`, `internal_error`.

<!-- /generated:error-codes-by-action -->

The same data is served live at [`/.well-known/x402-errors.json`](https://x402.klimalabs.com/.well-known/x402-errors.json) (GET alias `/api/errors`) — build error handling against that document rather than against this page.

## Inputs & contracts (Base mainnet)

| | Address |
|---|---|
| Input token — USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Input token — kVCM | `0x00fbac94fec8d4089d3fe979f39454f48c71a65d` |
| Retirement Aggregator | `0xda0a793d7c32ab80bcdab7f8c725c96db22464f4` |
| Klima Protocol AAM | `0x1C24239309398220883207681602BfF4D10fbde1` |
| Settlement Contract (retire target + token spender) | read from each prepare response (`to` / `approvalInstructions.spender`) |

**Amount rules:** decimal tonne string, minimum **0.001 t (1 kg)**. **Toucan Puro credits retire in whole tonnes only.** Amounts above a credit's liquidity are rejected.

## Fees

API calls are free. Each retirement bakes in a protocol fee — `max(floor, feeBps% of cost)`, floor denominated in USDC (converted to kVCM via the pool when paying in kVCM) — computed and collected on-chain by the Settlement Contract. It's always included in `quote.fee` and folded into `total`. The contract spends exactly `retirementCost + fee` and refunds any unused slippage budget in the same transaction.

## Use it from an AI agent

The fastest path is the **Klima Base MCP plugin** — it wires this endpoint into any Base MCP–capable agent (e.g. Claude Code).

1. **Install** — connect Base MCP and add the Klima plugin by following the **[Base MCP setup guide](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation/blob/main/base-mcp-setup.md)**.
   - Plugin file to install: **[`plugins/klima-retire.md`](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation/blob/main/plugins/klima-retire.md)**
   - All docs: **[KlimaDAO/Klima-Protocol-x402-MCP-documentation](https://github.com/KlimaDAO/Klima-Protocol-x402-MCP-documentation)**
2. **Ask in plain language** — e.g. *"Retire 2 tonnes of carbon under $15/tonne, beneficiary 'Acme Corp'."*
3. The agent runs `discover` → `quote` → `prepare/retire` → shows you the cost → submits **one** wallet approval → returns your certificate URL.

**Prefer a direct integration (no MCP)?** Call the GET endpoints above yourself, then sign and submit the `prepare/retire` batch (`approve` + retirement) with your own wallet on Base.

> ⚠️ **Retirement is irreversible.** It permanently burns the carbon credit — no undo, refund, or resale once the transaction confirms. Always review the quoted tonnes, price, and fee before approving.
