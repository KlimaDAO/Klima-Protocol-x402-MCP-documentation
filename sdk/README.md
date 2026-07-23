# @klimadao/x402-retire

Zero-dependency TypeScript client for retiring tokenized carbon on **Base**
through the KlimaDAO Retirement Aggregator x402 endpoint using any wallet or
agent.

> **Drop-in today, package later.** `klima-retire.ts` is a single self-contained
> file: copy it into your project now, or `npm i @klimadao/x402-retire` once
> published. The `createClient()` API is identical either way.

## Easy to integrate

- **No dependencies.** Uses the global `fetch` (Node 18+ / browsers).
- **Signer-agnostic.** You pass a `signTypedData` callback — works with viem,
  ethers, a browser wallet, Coinbase AgentKit, or a KMS/MPC signer. No wallet
  library is bundled.
- **One call.** `retire()` runs prepare-auth → sign → submit → poll certificate.
- **No gas, no approval, no Base Account.** You sign one standard EIP-712 token
  authorization (EIP-3009 for USDC, EIP-2612 for kVCM); a Klima executor relays
  the transaction on-chain and is reimbursed from your signed budget. The signer
  needs only an input-token balance.

## Usage

```ts
import { createClient } from "./klima-retire";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const klima = createClient(); // https://x402.klimalabs.com, Base mainnet

const { status, transactionHash, retirements } = await klima.retire({
  from: account.address,
  amount: "1",
  carbonClass: "0xf4699531e0a5f6e9351a36de3753deaad329bf45", // from klima.discover()
  inputToken: "usdc", // or "kvcm" / an address
  details: {
    beneficiaryString: "Acme Corp",
    retirementMessage: "Net-zero 2026",
  },
  signTypedData: (td) => account.signTypedData(td as any), // cast: viem's strict generics vs. the loose wire type
});

for (const r of retirements)
  console.log(r.amountInTonnes, "t →", r.certificateUrl);
```

### Other wallets

```ts
// ethers v6
signTypedData: (td) => signer.signTypedData(td.domain, td.types, td.message);

// browser (EIP-1193)
signTypedData: (td) =>
  window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(td)],
  });
```

## API

`createClient({ baseUrl?, chainId?, fetch?, timeoutMs? })` returns:

| Method                    | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `retire(params)`          | Full flow: prepare-auth → sign → submit → poll certificate. |
| `discover(filters?)`      | Browse retirable carbon classes + live reference prices.    |
| `quote(params)`           | Price a retirement before committing.                       |
| `prepareAuth(params)`     | Build the EIP-712 payload to sign (no funds moved).         |
| `certificate({ txHash })` | Resolve the public Carbonmark certificate(s) for a tx.      |

Non-2xx responses throw `KlimaRetireError` with `.status`, `.code`, `.details`.

See the [endpoint reference](https://www.klimalabs.com/x402-endpoint) for the
full request/response shapes.
