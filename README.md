# Klima-Protocol MCP/x402 Documentation

Retire tokenized carbon credits on **Base** from any AI agent or HTTP client, through the KlimaDAO Retirement Aggregator. This repo holds the agent **plugin** and the **setup guide** for the Klima x402 endpoint (`https://x402.klimalabs.com/api`).

Full API + error reference is published at **[klimalabs.com/x402-endpoint](https://www.klimalabs.com/x402-endpoint)**.

> ⚠️ **Retirement is irreversible**: it permanently burns the carbon credit. Always review before approving.

## Contents

| Path | What |
|---|---|
| `plugins/klima-retire.md` | The Base MCP plugin |
| `base-mcp-setup.md` | Step-by-step: connect Base MCP + load the plugin. |
| `klima-retire-action.md` | HTTP endpoint reference for the relayed retirement (`discover` → `quote` → `actions/retire` → `certificate`). |
| `sdk/` | Zero-dependency TypeScript client (`@klimadao/x402-retire`). One `retire()` call runs the whole flow. |
| `examples/` | Runnable examples: read-only discover/quote, the SDK retire path, and a raw-HTTP walkthrough. |

## Install

**Prerequisites**

1. Default Base MCP skills installed: `npx skills add base/skills --skill base-mcp`
2. A **Base Account** funded **on Base mainnet** with:
   - **USDC or kVCM**: covers the retirement cost + protocol fee.
   - **A small amount of ETH**: for gas

   This is the smart wallet that executes the retirement, _not_ your Coinbase exchange balance.

See [`base-mcp-setup.md`](./base-mcp-setup.md) for the full walkthrough (connect server → OAuth → add skill).

### Two steps

1. Copy the plugin into the skill:

```bash
cp plugins/klima-retire.md ~/.claude/skills/base-mcp/plugins/klima-retire.md
```

2. Add a routing row to `~/.claude/skills/base-mcp/SKILL.md` (in the **Plugins** table):

```
| [Klima](plugins/klima-retire.md) | Retire / offset carbon credits, buy carbon offsets. | discover, quote, prepare/retire, certificate | Base only. Always chainId=8453. |
```

Then restart your agent.

> **Note:** re-running `npx skills add base/skills --skill base-mcp` can overwrite `SKILL.md` and drop the Klima row. Be sure to re-add it if you update the skill.

## TypeScript SDK & examples

For calling the endpoint from a script, an app, or an agent (rather than through the MCP plugin), use the SDK. You sign one standard EIP-712 token authorization; a Klima executor relays the on-chain retirement and pays the gas (reimbursed from your signed budget). No native ETH, no prior approval, no Base Account: just an input-token balance.

```ts
import { createClient } from "./sdk/klima-retire";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const klima = createClient(); // https://x402.klimalabs.com, Base mainnet

const { status, transactionHash, retirements } = await klima.retire({
  from: account.address,
  amount: "1",
  carbonClass: "0xf4699531e0a5f6e9351a36de3753deaad329bf45", // from klima.discover()
  inputToken: "usdc", // or "kvcm" / an address
  details: { beneficiaryString: "Acme Corp", retirementMessage: "Net-zero 2026" },
  signTypedData: (td) => account.signTypedData(td as any),
});
```

**Drop-in today, package later.** `sdk/klima-retire.ts` is a single zero-dependency file: copy it into your project and import it directly (as the examples do). Once the package is published you can instead `npm i @klimadao/x402-retire` and change only the import line; the `createClient()` API is identical either way.

Start here:

- [`examples/`](./examples/): runnable end-to-end. `npm run discover` is read-only (no wallet); `npm run retire:sdk` performs a real retirement. See [`examples/README.md`](./examples/README.md).
- [`sdk/README.md`](./sdk/README.md): the full client API (`retire`, `discover`, `quote`, `prepareAuth`, `certificate`) and how to swap in ethers / a browser wallet / an agent signer.

## Docs

- [Base MCP setup](./base-mcp-setup.md): connect a wallet and load the plugin.
- [Relay action reference](./klima-retire-action.md): the `discover` → `quote` → `actions/retire` → `certificate` HTTP flow the SDK wraps.
- [x402 endpoint reference](https://www.klimalabs.com/x402-endpoint): endpoints, `details` schema, fees, and the full error catalog (published at klimalabs.com).

## License

[MIT](./LICENSE)
