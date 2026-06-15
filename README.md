# Klima-Protocol MCP/x402 Documentation

Retire tokenized carbon credits on **Base** from any AI agent or HTTP client, through the KlimaDAO Retirement Aggregator. This repo holds the agent **plugin** and the **setup guide** for the free Klima x402 endpoint (`https://x402.klimalabs.com/api`). Full API + error reference is published at **[klimalabs.com/x402-endpoint](https://www.klimalabs.com/x402-endpoint)**.

> ⚠️ **Retirement is irreversible** — it permanently burns the carbon credit. No undo, refund, or resale once the transaction confirms. Always review tonnes / price / fee before approving.

## Contents

| Path | What |
|---|---|
| `plugins/klima-retire.md` | The Base MCP plugin — copy this into your skill. |
| `base-mcp-setup.md` | Step-by-step: connect Base MCP + load the plugin. |

## Install

**Prerequisites**

1. The Base MCP skill installed: `npx skills add base/skills --skill base-mcp`
2. A **Base Account** funded with USDC or kVCM **on Base mainnet** — this is the smart wallet that signs, *not* your Coinbase exchange balance.

See [`base-mcp-setup.md`](./base-mcp-setup.md) for the full walkthrough (connect server → OAuth → skill).

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

> **Note:** re-running `npx skills add base/skills --skill base-mcp` can overwrite `SKILL.md` and drop the Klima row — re-add it if you update the skill.

## Docs

- [Base MCP setup](./base-mcp-setup.md) — connect a wallet and load the plugin.
- [x402 endpoint reference](https://www.klimalabs.com/x402-endpoint) — endpoints, `details` schema, fees, and the full error catalog (published at klimalabs.com).

## License

[MIT](./LICENSE)
