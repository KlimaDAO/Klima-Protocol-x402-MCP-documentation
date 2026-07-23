# Base MCP setup: connect a wallet and load the Klima plugin

Step-by-step guide for wiring [Base MCP](https://docs.base.org/ai-agents/quickstart) into an AI coding agent (Claude Code used here) so it can read the Klima Protocol liquidity, prepare retirements, and settle them from a Base Account.

> **What you get:** a non-custodial Base Account wallet exposed to the agent via `mcp.base.org`, plus the Klima retirement plugin that turns "retire 1 tonne of wind energy" into an on-chain `[approve, retire]` batch and a public Carbonmark certificate.

## Prerequisites

| Need                                                                                | Why                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A **Base Account** (sign up in the Base app / [Base Account](https://www.base.org)) | This is the smart wallet that signs. **Not** your Coinbase exchange balance. Before retiring, fund it **on Base mainnet** with **USDC or kVCM** (retirement cost + protocol fee) **and a small amount of ETH**  for gas. |
| **Claude Code** (or another MCP-capable agent)                                      |
| **Node / npx**                                                                      | Required only for the skill bundle install (step 3).                                                                                         |

Base MCP is **non-custodial**: the server never holds your keys. Auth is OAuth 2.1 against your Base Account, and every transaction is presented for explicit approval (with simulated asset changes) before anything goes on-chain.

---

## 1. Add the Base MCP server

```bash
# user scope = available in every project (recommended)
claude mcp add --transport http --scope user base-mcp https://mcp.base.org
```

Verify it registered:

```bash
claude mcp list          # → base-mcp: https://mcp.base.org (HTTP) · ! Needs authentication
claude mcp get base-mcp  # confirm the Scope line
```

> **Gotcha --> scope.** Confirm `claude mcp get base-mcp` reports `Scope: User config`. If it shows `Local config (private to you in this project)`, the server was only added for the current directory. To make it global, remove and re-add:
>
> ```bash
> claude mcp remove base-mcp -s local
> claude mcp add --transport http --scope user base-mcp https://mcp.base.org
> ```

`Needs authentication` is expected at this stage; nothing has touched your wallet yet.

## 2. Authenticate (OAuth via Base Account)

In a Claude Code session:

1. Type **`/mcp`**.
2. Select **`base-mcp`** (shows `needs authentication`).
3. Choose **Authenticate** → your browser opens the Base Account OAuth consent screen.
4. **Sign in to your Base Account and approve.**

> **Gotcha --> restart to appear.** Claude Code reads the MCP server list at **session startup**. If you ran step 1 inside a running session, `base-mcp` won't show up in `/mcp` until you **exit and relaunch** Claude Code.

## 3. Install the skill bundle (gives you the plugin layer)

The MCP **server** provides wallet tools. The Base **skill** provides the onboarding flow and the protocol plugin routing (Morpho, Uniswap, **Klima**, …). Install default base skills:

```bash
# Run from your home directory for a global install (recommended)
cd ~ && npx skills add base/skills --skill base-mcp
```

This creates a `base-mcp/` skill directory with `SKILL.md`, `plugins/`, and `references/`.

> ⚠️ **Gotcha: where it lands.** The skill installs into a `.claude/skills/base-mcp/` directory **relative to where you run the command**. Run it from a project directory and it lands in `<project>/.claude/skills/`, scoped to that project only. 
> 
> For a **global install (recommended), run it from your home directory** (`cd ~ && …`) so it lands in `~/.claude/skills/`.
>
> **Symlink edge case.** `~/.claude/skills/` may itself be a **symlink** (e.g. to `~/.agents/skills/`). If you do a local install and later `mv` the directory into `~/.claude/skills/`, the move can silently follow the symlink and land the files in the link's target instead of where you expect. After moving, verify with `ls -l ~/.claude/skills/` and confirm the plugin is actually where the agent reads it.

Confirm:

```bash
ls ~/.claude/skills/base-mcp/plugins/   # or <project>/.claude/skills/base-mcp/plugins/ for a local install
```

## 4. Add the Klima plugin

The Base skill bundle does **not** ship Klima; you add it as a custom plugin. Two steps are required.

> **Which file:** use **`klima-retire.md`**

1. Copy the plugin into the skill's `plugins/` directory:
   ```bash
   cp plugins/klima-retire.md .claude/skills/base-mcp/plugins/klima-retire.md
   ```
2. **Register it in `.claude/skills/base-mcp/SKILL.md`**. This step is crucial. Add a row to the **Plugins** routing table so the agent knows when to open it:
   ```
   | [Klima](plugins/klima-retire.md) | Retire / offset carbon credits, buy carbon offsets. | discover, quote, prepare/retire, certificate | Base only. Always chainId=8453. |
   ```

## 5. Restart and verify

Restart Claude Code, then try a read-only request first:

> "Show me carbon classes I can retire under $15/tonne."

The agent should run onboarding (capability blurb + Terms disclaimer), then call `discover`/`quote`. A full test:

> "Retire 1 tonne of wind energy, paying in kVCM."

Expected flow: `get_wallets` → `discover` → `prepare/retire` → quote shown for confirmation → `send_calls` (approve in Base Account) → `get_request_status` → certificate URL. You'll need ~3.5 kVCM (or the USDC equivalent) in the Base Account for that example.

---

## Disconnecting

Three independent layers. Do all three for a clean teardown:

```bash
# 1. Remove the MCP server (stops the agent from calling the wallet)
claude mcp remove base-mcp            # auto-detects scope; add -s user / -s local if needed

# 3. Remove the skill (docs only, no wallet access)
rm -rf .claude/skills/base-mcp        # or ~/.claude/skills/base-mcp
```

**2. Revoke the wallet authorization on Base's side** (the step people forget). Removing the MCP server locally does **not** revoke the OAuth grant. Open your Base Account → connected apps / authorizations and revoke **Base MCP**. Until you do, the access token still exists server-side.

---

## Troubleshooting

| Symptom                               | Cause / fix                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base-mcp` missing from `/mcp`        | Added mid-session. **Restart Claude Code**; the list loads at startup.                                                                                           |
| Server only works in one project      | It's in local scope. Re-add with `--scope user` (see step 1 gotcha).                                                                                             |
| Skill installed but plugins not found | `npx skills add` ran in the wrong directory. Check `~/.claude/skills` vs `<project>/.claude/skills`.                                                             |
| Agent doesn't reach for Klima         | Missing routing row in `SKILL.md` Plugins table (step 4.2), or installed plugin copy is stale. Re-copy and restart.                                              |
| "Needs authentication" persists       | Re-run `/mcp` → Authenticate; complete the Base Account OAuth in the browser.                                                                                     |
| Retirement reverts on-chain           | Insufficient input-token balance on **Base mainnet**, or amount below the class minimum (1 kg). See the error catalog at [klimalabs.com/x402-endpoint](https://www.klimalabs.com/x402-endpoint). |
| `send_calls` fails before confirming  | No **ETH** for gas in the Base Account. The input token (USDC/kVCM) covers the retirement cost + fee, but gas is paid in ETH so you need to fund the account with a small amount of ETH on Base mainnet.                          |
