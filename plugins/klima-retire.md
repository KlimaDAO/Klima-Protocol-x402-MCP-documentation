# Klima Carbon Retirement Plugin

> [!IMPORTANT]
>
> ## STOP — COMPLETE ONBOARDING BEFORE USING THIS PLUGIN
>
> Before calling any Klima endpoint, you MUST complete the Base MCP onboarding flow:
>
> 1. Call `get_wallets` (Detection)
> 2. Present wallet status and the disclaimer (Onboarding)
>
> The user's wallet address — used as `retiringAddress` / `beneficiaryAddress` in
> the retirement `details` and as the account that signs `send_calls` — is only
> confirmed during Detection. Do not fabricate it.

Klima retires tokenized carbon credits through the KlimaDAO Retirement Aggregator
on Base. This plugin fetches a quote and unsigned calldata from the Klima x402
endpoint, then executes the approval + retirement atomically via Base MCP's
`send_calls`.

In v1 every endpoint is **free** over HTTP — there is no x402 micropayment to
sign. A small protocol fee is taken **on-chain** by the Settlement Contract as
part of the retirement transaction (see [Fees](#fees) below). Paid x402 actions
are planned for v2; this plugin does not need them.

**Fetching calldata:** the Klima API (`https://x402.klimalabs.com`) is not on the
Base MCP `web_request` allowlist. Every endpoint below is exposed as a **GET** with
all parameters in the query string, so a human can open the URL in a browser. Try
`web_request` first; if it rejects the host, fetch through whatever capability the
harness exposes (shell `curl`), or ask the user to paste the JSON response into the
chat. Then continue with `send_calls`.

**Supported chain:** Base mainnet only — always pass `chainId=8453`. Any other
value is rejected with a 400: Base Sepolia (`84532`) returns `unsupported_chain_id`,
and any other number returns `schema_validation`.
Pass the **chain name** to `send_calls`, not the numeric id — the prepare
response includes a `chain` field (`"base"`) with the name already mapped.

**Key contracts (Base mainnet):**

| Contract                                            | Address                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Retirement Aggregator                               | `0xda0a793d7c32ab80bcdab7f8c725c96db22464f4`                               |
| Settlement Contract (retire target + token spender) | resolved from the prepare response (`to` / `approvalInstructions.spender`) |
| Klima Protocol AAM                                  | `0x1C24239309398220883207681602BfF4D10fbde1`                               |
| kVCM                                                | `0x00fbac94fec8d4089d3fe979f39454f48c71a65d`                               |
| USDC                                                | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                               |

In v1 the retirement is routed through the **Settlement Contract**, not the
Aggregator directly. That contract pulls the input token, takes the protocol fee,
performs the Klima-mediated swap-and-retire, and refunds any unused budget — all in
one call. Because the deployed address is environment-specific, **read it from the
prepare response** rather than hard-coding it (the `to` field and
`approvalInstructions.spender` are both the Settlement Contract).

Supported `inputToken` values: USDC (`0x8335…2913`) or kVCM (`0x00fb…a65d`).

---

## Read endpoints

Both GET. Use these to discover what's retirable and to price a retirement before
preparing it. They are read-only and never move funds.

```
GET https://x402.klimalabs.com/api/discover[?carbonClass=0x...][&creditToken=0x...][&maxUsdcPricePerTonne=20]
```

Lists carbon classes from the protocol subgraph (each with a live USDC/tonne
reference price), the supported input tokens, and the contract addresses. The three
optional filters are AND-combined: `carbonClass` keeps one class, `creditToken`
keeps the class holding that credit (and trims it to that credit), and
`maxUsdcPricePerTonne` keeps classes priced at or below that figure (a human
figure: `20` = $20/tonne). These are the **only** accepted parameters — anything
else (including `chainId`) returns a 400.

Use the response to size the retirement: each class lists
`creditsDetailed[]` (registry, vintage, `tokenId`, and `liquidityFormatted` —
the maximum retirable tonnes for that credit) plus
`minRetirementTonnesFormatted` (currently 0.001 t = 1 kg). Puro `batchId` and
token standard are resolved server-side by prepare — callers don't supply them.

```
GET https://x402.klimalabs.com/api/quote?chainId=8453&inputToken=0x833589...&carbonClass=0x...&amount=1.5[&creditToken=0x...][&vintage=2022][&tokenId=<id>]
```

Live price quote for retiring `amount` tonnes. Returns tonnes, the retirement
price, the on-chain settlement `fee`, the `total` (price + fee), the
`suggestedMaxInput` (total + slippage), a `humanSummary`, plus `resolvedCredit`
(the `creditToken` / `tokenId` / `vintage` the server actually selected) and
`alternatives` (other qualifying credits).

Required: `chainId` (always `8453`), `inputToken` and `carbonClass` (addresses),
and `amount` (a decimal tonne string, `"1.5"`). The rest narrow **credit
resolution** — when omitted, the server picks the most-liquid credit in the
class that can cover `amount`:

- `creditToken` — only consider credits at that address.
- `vintage` — only that year; an unavailable year returns a 400
  `vintage_not_found` listing `availableVintages`.
- `creditToken` + `tokenId` together — pin one exact credit (the ERC-1155 case);
  `vintage` is then ignored.

**Amount rules:** minimum 0.001 tonnes (1 kg). **Puro credits retire in whole
tonnes only** — a fractional amount returns a 422 `amount_not_whole_tonnes` with
the nearest valid amounts. Amounts above a credit's liquidity return a 422
`insufficient_liquidity`.

## Prepare endpoint

GET. Quotes on-chain, then returns unsigned calldata as an **ordered batch**: an
ERC20 `approve` followed by the retirement. `send_calls` runs the whole array
atomically in a single user approval. v1 prepares **one** retirement per call;
batch retirement is not exposed.

```
GET https://x402.klimalabs.com/api/prepare/retire?chainId=8453&inputToken=0x833589...&carbonClass=0x...&amount=1.5[&creditToken=0x...][&vintage=2022][&tokenId=<id>][&maxInputTokenIn=<atomic>][&details=<urlencoded JSON>]
```

Credit resolution and amount rules are identical to `/quote` (prepare re-quotes
server-side; the `quote` object in its response is the authoritative price).

`details` is an optional URL-encoded JSON object with retirement metadata. The
schema is **strict**: exactly the keys below are accepted, and an unknown key
returns a 400 naming it — do not invent fields.

| `details` field                                   | Meaning                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `retiringAddress`                                 | address performing the retirement — the wallet from `get_wallets` |
| `beneficiaryAddress`                              | address credited on the certificate — usually the same wallet     |
| `beneficiaryString`                               | beneficiary display name                                          |
| `retiringEntityString`                            | retiring-entity display name                                      |
| `retirementMessage`                               | public message shown on the certificate                           |
| `beneficiaryLocation`                             | Puro only — beneficiary location string                           |
| `consumptionCountryCode`                          | Puro only — ISO country code                                      |
| `consumptionPeriodStart` / `consumptionPeriodEnd` | Puro only — unix timestamps (seconds)                             |

Every field is optional for standard credits (omitted fields default to empty /
zero-address). For **Toucan Puro** credits the four Puro fields are required —
prepare returns a 400 `puro_details_required` with a `missing` array listing the
absent ones; collect them and re-prepare. Use the user's wallet address (from
`get_wallets`) for `retiringAddress` / `beneficiaryAddress` unless they specify
otherwise.

**Certificate attribution is required — collect it before preparing.**
`beneficiaryString`, `retiringEntityString`, and `retirementMessage` are what
appear on the public Carbonmark certificate, which **cannot be edited after the
retirement confirms**. A `beneficiaryString` (beneficiary name) is **mandatory**:
do not call prepare until the user has supplied one, and do not substitute the
wallet address or a placeholder. This is non-negotiable — if the user tries to
skip it, explain that the certificate must be attributed and ask again.
`retirementMessage` (a public message) and `retiringEntityString` (the retiring
entity, when it differs from the beneficiary) are optional but you should **actively offer
them** with explicit prompts rather than skipping silently; like the beneficiary
name, they are permanently set on the certificate. Use prompts such as:

- `retirementMessage`: "Would you like to add a public message to your certificate?"
- `retiringEntityString`: "Should a retiring entity name appear on the certificate (if different from the beneficiary)?"

Accept "skip" / "no" for either. Fold whatever the user supplies into `details`.

`maxInputTokenIn` (atomic units) overrides the default slippage ceiling. When
omitted the endpoint uses `(price + fee) × 1.04` (4% slippage). This is the total
budget the Settlement Contract is authorized to spend; it takes the fee and
retirement cost out of it and refunds the remainder.

Response:

```json
{
  "to": "0x<settlementContract>",
  "data": "0x...",
  "chainId": 8453,
  "chain": "base",
  "transactions": [
    {
      "step": "approve",
      "to": "0x833589...",
      "value": "0x0",
      "data": "0x...",
      "chainId": 8453
    },
    {
      "step": "prepareRetire",
      "to": "0x<settlementContract>",
      "value": "0x0",
      "data": "0x...",
      "chainId": 8453
    }
  ],
  "quote": {
    "humanSummary": "...",
    "tonnesFormatted": "1.5",
    "fee": "...",
    "total": "...",
    "...": "..."
  },
  "approvalRequired": true,
  "approvalInstructions": {
    "token": "0x833589...",
    "spender": "0x<settlementContract>",
    "amount": "...",
    "amountFormatted": "...",
    "note": "..."
  }
}
```

The `approve` step targets the **input token** and the `prepareRetire` step targets
the **Settlement Contract**. Both USDC and kVCM approve the same spender — the
Settlement Contract — so there is a single approval regardless of input token.

## Fees

There is no x402/HTTP fee in v1 — calling the API is free. But every retirement
bakes in a **protocol fee**, computed and collected **on-chain** by the Settlement
Contract during `prepareRetire`: `fee = max(floor, feeBps% of retirement cost)`,
with the floor denominated in USDC and converted via the kVCM/USDC pool when the
input token is kVCM. The fee values are read live from the contract — never
estimate them yourself:

- `quote` and the prepare response include the live fee in the `quote` object
  (`fee`, `feeFormatted`) and fold it into `total` and `suggestedMaxInput`.
- On-chain, the contract emits `RetirementSettled(payer, beneficiary, value, fee,
retirementCost, refunded)`. The payer spends exactly `retirementCost + fee`; any
  approved budget beyond that (`refunded`) is returned in the same transaction.

So the user signs one `send_calls` and pays the retirement cost plus the protocol
fee — nothing else.

## send_calls mapping

Pass every `transactions[*]` straight through to `send_calls`, in order, using the
top-level `chain` name:

```json
{
  "chain": "base",
  "calls": [
    {
      "to": "<transactions[0].to>",
      "value": "<transactions[0].value>",
      "data": "<transactions[0].data>"
    },
    {
      "to": "<transactions[1].to>",
      "value": "<transactions[1].value>",
      "data": "<transactions[1].data>"
    }
  ]
}
```

Drop the `step` and `chainId` fields — `send_calls` only needs `to` / `value` /
`data`, and the chain is set once at the top level. `value` is `0x0` for every
Klima call. Submit the full batch in one `send_calls` so the user approves once and
approve + retire execute atomically.

## Certificate endpoint

GET. After the retirement transaction confirms, resolves the public
**Carbonmark certificate URL(s)** for it. Read-only subgraph lookup — nothing to
sign, no funds moved.

```
GET https://x402.klimalabs.com/api/certificate?txHash=0x...[&index=0]
```

`txHash` is the hash of the confirmed retirement transaction (from
`get_request_status` after `send_calls`). `index` is optional: a single
transaction can contain several retirements (a batch), and `index` selects one
of them; omit it to get all. These are the only accepted parameters (no
`chainId`) — anything else returns a 400.

Response: `transactionHash`, `retirementCount`, and `retirements[]` — one entry
per retirement, each with `certificateUrl` (the shareable page on
`app.carbonmark.com`), `retirementId`, `retirementIndex`, `amountInTonnes`,
`beneficiaryName`, `beneficiaryLocation`, `message`, `projectId`, `creditId`,
`retiringAddress`, and `timestamp` (unix seconds).

A 404 `retirement_not_found` right after confirmation means the subgraph hasn't
indexed the transaction yet — wait a few seconds and retry. If you passed an
`index` and get a 404 with a message naming the valid range, the index is wrong;
don't retry.

## Errors

Failures return JSON with an `error` code plus actionable fields:

| Status + `error`              | What to do                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 400 `schema_validation`       | A parameter is malformed or unknown — `issues[]` names it. Fix and retry.                                             |
| 400 `unsupported_chain_id`    | Use `chainId=8453` (Base mainnet only).                                                                               |
| 400 `unsupported_input_token` | Use USDC or kVCM.                                                                                                     |
| 400 `vintage_not_found`       | Pick from `availableVintages`, or omit `vintage`.                                                                     |
| 400 `puro_details_required`   | Supply the `details` fields listed in `missing`, then re-prepare.                                                     |
| 404 `no_candidates`           | Nothing retirable for that class/credit — re-check `/discover`.                                                       |
| 404 `retirement_not_found`    | Certificate only — see [Certificate endpoint](#certificate-endpoint).                                                 |
| 422 `amount_not_whole_tonnes` | Puro: request a whole number of tonnes (`nearestDownTonnes` / `nearestUpTonnes` are provided).                        |
| 422 `insufficient_liquidity`  | Reduce `amount` (`bestAvailableAtomic` = the most any credit can cover, in 1e18 tonnes) or pick another class/credit. |
| 422 `amount_below_increment`  | Amount converts to zero retirable units — increase it.                                                                |
| 422 `contract_revert`         | Decoded on-chain revert — follow `decoded.retryAdvice`. Don't blind-retry.                                            |

## Orchestration pattern

```
1. get_wallets -> address                          (onboarding gate)
2. GET /discover                                   -> pick carbonClass (creditToken optional)
   - creditsDetailed[].liquidityFormatted = max retirable tonnes; Puro = whole tonnes only
3. Confirm the input token -> if the user has NOT specified one, ASK: "Would you like to pay with USDC or kVCM?"
   - do not silently default to USDC; the user may not hold it, and switching only after a failed transaction is a poor experience
   - check the use's balance of the chosen token against the quote.total before preparing where possible
4. GET /quote?chainId=8453&...                     (optional: price before preparing)
5. Collect certificate attribution -> beneficiaryString is REQUIRED (do not proceed without it); retirementMessage / retiringEntityString optional
   - certificate is uneditable after confirmation; never substitute the wallet address for the name
   - actively offer the optional fields with explicit prompts (see the Prepare endpoint section above); don't silently skip them
6. GET /prepare/retire?chainId=8453&...&details=<urlencoded {"retiringAddress": address, "beneficiaryAddress": address, "beneficiaryString": ..., "retirementMessage": ...}>
   - if web_request rejects the host: curl it, or ask the user to paste the JSON
   - if 400 puro_details_required: collect the `missing` fields and re-prepare
7. Show the quote.humanSummary to the user and confirm
8. send_calls(chain=<response.chain>, calls from transactions[])
9. Relay the approval link -> on approve, get_request_status(requestId) until confirmed
10. GET /certificate?txHash=<confirmed tx hash>    -> share certificateUrl with the user
   - 404 right after confirmation = not indexed yet; retry after a few seconds
```

## Example flows

### Offset under a price cap ("retire 2 tonnes at no more than $15/tonne")

```
1. get_wallets -> address
2. GET /discover?maxUsdcPricePerTonne=15           -> only qualifying classes remain
3. Continue from step 3 of the orchestration pattern with amount=2
```

### Retire a Puro credit

```
1-4. As in the orchestration pattern; /prepare/retire returns 400 puro_details_required
5. Ask the user for beneficiaryLocation, consumptionCountryCode, and the consumption period
6. Re-prepare with the completed details object (whole-tonne amounts only)
7. send_calls -> approval -> certificate
```

### Look up a past certificate

```
1. GET /certificate?txHash=<hash from the user or get_request_status>
2. Share retirements[].certificateUrl
```

> [!WARNING]
> A retirement permanently burns the carbon credit — there is no undo, refund, or
> resale once `send_calls` confirms. Always show `quote.humanSummary` (tonnes,
> price, fee, total) and get the user's explicit confirmation before submitting.
