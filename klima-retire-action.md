# Klima Carbon Retirement — Relay Action Skill

Retire tokenized carbon credits on Base via the Klima x402 endpoint. The user signs an
EIP-712 authorization off-chain; the Klima x402 endpoint performs the retirement. **No on-chain approval from the user is needed.**

---

## Endpoints

Base URL: `https://x402.klimalabs.com/api`. All paths below are relative to it
(e.g. `GET https://x402.klimalabs.com/api/discover`, `POST https://x402.klimalabs.com/api/actions/retire`).

### `GET /discover`

```
GET /discover[?carbonClass=0x...][&creditToken=0x...][&maxUsdcPricePerTonne=20]
```

Lists carbon classes with live USDC/tonne prices. Filters are AND-combined.
Each class includes `creditsDetailed[]` (registry, vintage, `tokenId`,
`liquidityFormatted` — max retirable tonnes) and `minRetirementTonnesFormatted`.
Puro credits retire in whole tonnes only.

---

### `GET /quote`

```
GET /quote?chainId=8453&inputToken=0x...&carbonClass=0x...&amount=1.5[&creditToken=0x...][&vintage=2022][&tokenId=<id>]
```

Live price quote. Returns `fee`, `total`, `suggestedMaxInput`, `humanSummary`,
`resolvedCredit`, and `alternatives`. Minimum 0.001 tonnes. Puro: whole tonnes
only (`422 amount_not_whole_tonnes` with `nearestDownTonnes`/`nearestUpTonnes`).

---

### `POST /actions/retire` — two-phase

**Phase 1 — get the authorization to sign** (no `authPayload` in body):

```json
POST /actions/retire
{ "chainId": 8453, "from": "0x<wallet>", "inputToken": "0x...", "carbonClass": "0x...",
  "amount": "1.5", "creditToken": "0x...", "tokenId": "0",
  "details": { "retiringAddress": "0x...", "beneficiaryAddress": "0x...", "beneficiaryString": "..." } }
```

Returns **HTTP 402** with the signed budget sized and the EIP-712 data ready:

```json
{
  "authValue": "147480",
  "authValueFormatted": "0.147480 USDC",
  "typedData": { "domain": {...}, "types": {...}, "primaryType": "TransferWithAuthorization", "message": {...} },
  "actionsRetireRequest": {
    "chainId": 8453, "from": "0x<wallet>", "inputToken": "0x...", "carbonClass": "0x...",
    "amount": "1.5", "creditToken": "0x...", "tokenId": "0", "details": {...},
    "authPayload": { "from": "0x<wallet>", "to": "0x<settlementContract>",
      "value": "147480", "validAfter": "0", "validBefore": "1750000000", "nonce": "0x..." }
  }
}
```

`actionsRetireRequest` is the Phase 2 body pre-filled — add `v`/`r`/`s` and POST it back.
For kVCM: `primaryType` is `Permit`; `authPayload` has `deadline` instead of `validAfter`/`validBefore`/`nonce`.

> _Optional:_ the same authorization can be fetched explicitly via the `prepare-auth` action (`POST /api` with `"action": "prepare-auth"`, or `GET /api/prepare-auth`), which returns the identical `typedData` + `actionsRetireRequest` as a plain **200** instead of a 402. It's off-chain only and purely a convenience. Phase 1 above already yields the same payload via the standard 402, so you don't need it.

**Phase 2 — relay** (with `authPayload.v/r/s` populated):

POST the completed `actionsRetireRequest`. The server validates, relays, and waits for confirmation.

```json
POST /actions/retire
{ ...actionsRetireRequest, "authPayload": { ...stub, "v": 27, "r": "0x...", "s": "0x..." } }
```

Response:

```json
{
  "status": "settled",
  "transactionHash": "0x...",
  "retirements": [{ "certificateUrl": "https://app.carbonmark.com/..." }]
}
```

Or `"status": "pending_index"` with `retirements: []` — poll `/certificate` with the `transactionHash` after a few seconds.

---

### `GET /certificate`

```
GET /certificate?txHash=0x...[&index=0]
```

Returns `retirements[]` each with `certificateUrl`, `amountInTonnes`,
`beneficiaryName`, `retirementMessage`, and `timestamp`.
`404 retirement_not_found` immediately after confirmation = not indexed yet; retry.

---

## Signing

Sign the `typedData` from the Phase 1 response using `eth_signTypedData_v4`.
The 65-byte result encodes r + s + v:

```
r = "0x" + sig.slice(2, 66)
s = "0x" + sig.slice(66, 130)
v = parseInt(sig.slice(130, 132), 16)   // 27 or 28
```

Add to `actionsRetireRequest.authPayload` and POST Phase 2.

---

## Orchestration

```
1. Obtain the user's wallet address
2. GET /discover → pick carbonClass (creditToken optional)
3. Ask "USDC or kVCM?" if input token unspecified — do not default silently
4. GET /quote (optional)
5. Collect attribution — beneficiaryString is REQUIRED before proceeding:
   - Offer: "Add a public message to your certificate?" (retirementMessage)
   - Offer: "Retiring entity name, if different from beneficiary?" (retiringEntityString)
   - Both permanent on-chain; never substitute the wallet address for a name
6. POST /actions/retire Phase 1 (no authPayload)
   - 400 puro_details_required → collect missing[] fields and retry Phase 1
7. Show authValueFormatted + quote.humanSummary → get explicit user confirmation
8. Sign typedData → split r/s/v → add to actionsRetireRequest.authPayload
9. POST /actions/retire Phase 2
   - 400 insufficient_authorized_value → prices moved; repeat from step 6
   - 503 gas_estimate_unavailable → retry after a few seconds
10. settled → share certificateUrl | pending_index → GET /certificate after a few seconds
```

---

## Errors

| Status + `error`                    | Action                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| 400 `schema_validation`             | `issues[]` names the bad field. Fix and retry.                  |
| 400 `unsupported_chain_id`          | Use `chainId=8453`.                                             |
| 400 `unsupported_input_token`       | Use USDC or kVCM.                                               |
| 400 `vintage_not_found`             | Pick from `availableVintages` or omit `vintage`.                |
| 400 `puro_details_required`         | Supply `missing[]` fields and retry Phase 1.                    |
| 400 `invalid_auth_payload`          | Auth fields wrong — repeat from Phase 1.                        |
| 400 `insufficient_authorized_value` | Prices moved — repeat from Phase 1 and re-sign.                 |
| 404 `no_candidates`                 | Nothing retirable — re-check /discover.                         |
| 404 `retirement_not_found`          | Not indexed yet — retry /certificate shortly.                   |
| 422 `amount_not_whole_tonnes`       | Puro: use `nearestDownTonnes` or `nearestUpTonnes`.             |
| 422 `insufficient_liquidity`        | Reduce `amount` or pick another class.                          |
| 422 `transaction_reverted`          | Tx reverted on-chain — surface `transactionHash`; do not retry. |
| 422 `contract_revert`               | Pre-broadcast revert — follow `decoded.retryAdvice`.            |
| 503 `gas_estimate_unavailable`      | Retry after a few seconds.                                      |

---

## Warnings

- **Irreversible.** Retirement permanently burns the credit. Always confirm `authValueFormatted` + `quote.humanSummary` with the user before signing.
- **Budget ceiling.** `authValue` is the max the contract may pull; it refunds any unused amount in the same transaction.
- **Expiry.** The signed authorization is valid for 1 hour (`validBefore`). If it expires before Phase 2 is called, repeat from Phase 1.
- **Certificate is permanent.** Attribution fields cannot be changed after confirmation.
