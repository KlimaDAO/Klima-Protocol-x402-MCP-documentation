<!--
  DO NOT EDIT. Published automatically from Carbonmark/x402-klima-RA-new/examples/README.md.
  Changes made here will be overwritten by the next docs sync.
  Edit the source file and open a PR there instead.
-->

# Carbon Retirement Examples

Runnable examples of the **paid relay** path: you sign one standard token
authorization, and a Klima executor submits the on-chain retirement and pays the
gas (reimbursed out of your signed budget). You need an input-token balance
(USDC or kVCM) but **no native ETH, no prior approval, and no Base Account**.

Examples are grouped by intent: **`discover-quote/`** is read-only (no wallet, no
funds); **`retire/`** spends funds.

| File                                                                     | What it's for                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`discover-quote/discover-quote.ts`](./discover-quote/discover-quote.ts) | **Read-only, safe to run as-is.** Browses the catalog, picks the cheapest liquid credit, and prices it. No wallet needed. Prints the `carbonClass` to paste into the retire examples.                                                                            |
| [`retire/retire-sdk.ts`](./retire/retire-sdk.ts)                         | **The retirement path.** The minimal happy path via the zero-dependency client in [`../sdk/klima-retire.ts`](../sdk/klima-retire.ts) — one `retire()` call does prepare-auth → sign → submit → poll certificate.                                                 |
| [`retire/retire-raw.ts`](./retire/retire-raw.ts)                         | **Protocol walkthrough.** The same flow over plain HTTP + EIP-712 with no Klima dependencies. Read it to understand the wire protocol, or port it to another language. The four steps are the same everywhere. viem is declared in this folder's `package.json`. |

The retire examples produce a real retirement like this one:
**[basescan.org/tx/0x31c7…9609](https://basescan.org/tx/0x31c70244536f2a828f46c1368f67cd39195ffb538e0f697644629edfd7319609)**

## Configure

Retirement parameters (amount, class, beneficiary, …) live in a **`CONFIG`
block** at the top of each example. Edit them in place. Only the secret lives
in the environment:

```bash
cd examples && npm install      # pulls viem (signing) + tsx (runner)
cp .env.example .env            # then set PRIVATE_KEY in .env (gitignored)
```

Requires **npm ≥ 11.10** (enforced via `engines` + `engine-strict` in `.npmrc`).
That same `.npmrc` sets `min-release-age=7`, so installs refuse package versions
published less than 7 days ago, which is a supply-chain cooldown. Upgrade with
`npm install -g npm@^11.10.0` if `npm install` fails the engine check.

`PRIVATE_KEY` is a wallet holding the input token. It signs locally and is
**never sent anywhere**.

### A few parameter notes

- **`amount`** — tonnes to retire. Minimum `0.001` (1 kg). Use a leading zero in
  the string form: `"0.5"`, not `".5"`.
- **`carbonClass` / `creditToken`** — a class is a group of interchangeable
  credits that share one price; a credit is a specific token within it. Get both
  from `discover` (see below). Pin a `creditToken` to force a specific credit, or
  omit it and the server picks the class's first liquid credit.
- **`inputToken`** — `"usdc"`, `"kvcm"`, or a token address. On Base mainnet:
  USDC = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
  kVCM = `0x00fbac94fec8d4089d3fe979f39454f48c71a65d`.
- **`beneficiary` / `message`** — attribution shown on the certificate. Set them
  or they stay blank, and they **cannot be edited after the retirement confirms**.

## Run

```bash
# Read-only: browse the catalog and price a retirement (no wallet needed):
npm run discover

# Minimal retire — spends funds; set PRIVATE_KEY in .env first:
npm run retire:sdk

# Same flow, raw protocol (no SDK):
npm run retire:raw
```

## Finding a class & previewing the cost

`retire/retire-sdk.ts` hardcodes a known-liquid class so it runs out of the box. To
pick your own, run `npm run discover` — it uses the SDK's two **read-only**
calls (no funds, no signature) and prints a ready-to-paste pick:

- **`discover({ maxUsdcPricePerTonne })`** browses the catalog. Each class
  carries a reference USDC/tonne price (spot, accurate near 1 tonne) and its
  credits with available liquidity. Any liquid credit in a class yields the same
  class price, so liquidity is the only thing to choose on within a class.
- **`quote({ amount, carbonClass, creditToken, inputToken })`** prices the exact
  retirement (retirement cost + on-chain protocol fee). This is the number to
  show a user before they commit. The relay's signed budget (step 1 below) is
  slightly higher because it also covers the executor's gas.

To preview the authorization itself, call
**`prepareAuth({ from, amount, carbonClass, inputToken, details })`** — it
returns the full signed budget (incl. executor gas) and the exact EIP-712
payload your wallet would sign, ideal for a confirm screen. Still no funds, no
signature.

## The four steps

Every path, SDK or raw, follows the same four steps. The SDK's `retire()` runs all
four for you; the raw example does them by hand.

```
1. prepare-auth   POST → returns the EIP-712 typedData to sign + a ready body
2. sign           your wallet signs the typedData (eth_signTypedData_v4)
3. actions/retire POST the body + signature → executor relays on-chain
4. certificate    poll by txHash → public Carbonmark certificate URL(s)
```

**1 · prepare-auth**: Tell the endpoint what you want to retire. It resolves and
prices the credit, estimates the executor's gas, sizes the budget, and returns
the exact EIP-712 object to sign (`typedData`) plus a ready-to-send body
(`actionsRetireRequest`) that you just add the signature to. This moves no funds.

**2 · sign**: The only signature. It's a standard EIP-712 token authorization
(EIP-3009 `TransferWithAuthorization` for USDC, EIP-2612 `Permit` for kVCM) —
exactly what any x402 payment signs. In a browser this is
`eth_signTypedData_v4`; the wallet shows the token, the spender (settlement
contract), and the amount.

**3 · submit**: Send the server's `actionsRetireRequest` back with the signature
dropped in. The endpoint validates it and the executor relays
`settleRetirementWith{USDC,KVCM}` onchain (paying the gas). The response is
either `settled` (mined and indexed; certificate URLs included) or
`pending_index` (mined but the subgraph hasn't caught up; poll in step 4).
Note: if testing locally this will always return pending_index.

**4 · certificate**: `settled` already carries the retirements. For
`pending_index`, poll `/certificate` by `txHash`. While unindexed it returns
`404 retirement_not_found`. That's expected; keep polling. `certificate` takes
**only** `txHash`, no `chainId`.

## What you sign

You only ever sign the **token authorization** — one message, no approvals.

On the USDC path that signature still covers the whole retirement. The
authorization's `nonce` field is not random: it is
`keccak256(retirement, salt)`, where the retirement is the exact credit, amount,
and attribution struct `prepare-auth` returned, and `salt` is fresh 32 bytes
minted per authorization. Because `nonce` is one of the six signed EIP-3009
fields, signing the authorization signs **what gets retired and who is
credited**, not just the dollar value.

Two consequences for you:

- Post `actionsRetireRequest` back **verbatim, including `salt`**. Changing
  `creditToken`, `tokenId`, `amount`, or anything in `details` after signing
  gets a `400 params_mismatch`. Dropping `salt` gets a `400
  invalid_auth_payload`.
- Check `onChainDetails` in the `prepare-auth` response before signing. It is
  exactly the attribution the hash commits to.

The salt exists so the nonce is *verifiable* without being *deterministic*: USDC
burns each `(from, nonce)` pair permanently, so an unsalted hash would make two
identical retirements by the same payer collide. It is not a secret — the nonce
is pinned by your signature, so nobody can find a different retirement that
hashes to it.

The kVCM (EIP-2612) path has no commitment and no salt. Permit's `nonce` is the
token's own sequential counter, so it can't carry one.

The SDK is **signer-agnostic**. The examples sign with viem; swap for ethers, a
browser wallet, or an agent's signer:

```ts
// viem:   (td) => account.signTypedData(td)
// ethers: (td) => signer.signTypedData(td.domain, td.types, td.message)
```

---

See the [endpoint reference](https://www.klimalabs.com/x402-endpoint) and the
[SDK README](../sdk/README.md) for full details.
