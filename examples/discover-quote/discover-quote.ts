#!/usr/bin/env tsx
/**
 * Discover & quote: read-only
 */

import { parseArgs } from "node:util";
import { createClient, KlimaRetireError } from "../../sdk/klima-retire.js";

// ─── defaults (override with flags or env; flag > env > default) ──────────────
const CONFIG = {
  amount: "1", // tonnes to price (min 0.001)
  maxUsdcPricePerTonne: undefined as number | undefined, // e.g. 50 to filter the catalog
  baseUrl: "https://x402.klimalabs.com", // endpoint origin (no trailing /api)
};
// ─────────────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    amount: { type: "string" },
    "max-usdc-price": { type: "string" },
    "base-url": { type: "string" },
  },
});

if (values.help) {
  console.log(`Browse the carbon catalog and price a retirement (read-only).

Usage: npm run discover -- [options]
       (the -- is required so npm forwards the flags to the script)

Options:
  --amount <t>          tonnes to price (min 0.001)      [${CONFIG.amount}]
  --max-usdc-price <n>  filter catalog to <= n USDC/tonne
  --base-url <url>      endpoint origin                  [${CONFIG.baseUrl}]
  -h, --help            show this help`);
  process.exit(0);
}

// flag > env > default
const maxPriceRaw = values["max-usdc-price"] ?? process.env.MAX_USDC_PRICE;
const cfg = {
  amount: values.amount ?? process.env.AMOUNT ?? CONFIG.amount,
  maxUsdcPricePerTonne:
    maxPriceRaw != null ? Number(maxPriceRaw) : CONFIG.maxUsdcPricePerTonne,
  baseUrl: values["base-url"] ?? process.env.BASE_URL ?? CONFIG.baseUrl,
};

const klima = createClient({ baseUrl: cfg.baseUrl });

try {
  // 1 · discover: the full catalog. Every credit in a class shares the class
  // price, so within a class you only choose on liquidity.
  const catalog = await klima.discover(
    cfg.maxUsdcPricePerTonne != null
      ? { maxUsdcPricePerTonne: cfg.maxUsdcPricePerTonne }
      : {},
  );

  console.log(`\nCatalog (${catalog.carbonClasses.length} classes)\n`);
  for (const cc of catalog.carbonClasses) {
    const liquidity = (cc.creditsDetailed as any[]).reduce(
      (sum, cr) => sum + Number(cr.liquidityFormatted),
      0,
    );
    console.log(
      `  ${cc.carbonClassId}  $${cc.priceUsdcPerTonneFormatted ?? "?"}/t` +
        `  ${cc.name ?? "unnamed"}  (${liquidity.toFixed(1)} t liquid)`,
    );
  }

  // 2 · pick: cheapest class with a single credit liquid enough for the amount.
  const picks = (catalog.carbonClasses as any[])
    .filter((cc) => cc.priceUsdcPerTonneFormatted != null)
    .flatMap((cc) =>
      (cc.creditsDetailed as any[])
        .filter((cr) => Number(cr.liquidityFormatted) >= Number(cfg.amount))
        .map((credit) => ({ cc, credit })),
    )
    .sort(
      (a, b) =>
        Number(a.cc.priceUsdcPerTonneFormatted) -
        Number(b.cc.priceUsdcPerTonneFormatted),
    );
  if (picks.length === 0) {
    console.error(
      `\nNo credit has ${cfg.amount} t of liquidity. Lower amount.`,
    );
    process.exit(1);
  }
  const { cc, credit } = picks[0];

  // 3 · quote: the real cost at size (retirement + on-chain protocol fee).
  // The catalog price is spot.
  const quote = await klima.quote({
    amount: cfg.amount,
    carbonClass: cc.carbonClassId,
    creditToken: credit.tokenAddress,
    inputToken: "usdc",
  });

  console.log(`\nCheapest liquid pick`);
  console.log(`  carbonClass  ${cc.carbonClassId}  (${cc.name})`);
  console.log(
    `  creditToken  ${credit.tokenAddress}  (${credit.projectId ?? "?"}, vintage ${credit.vintage ?? "?"})`,
  );
  console.log(`  quote        ${quote.humanSummary}\n`);
  console.log(
    `Paste carbonClass (and optionally creditToken) into retire-sdk.ts CONFIG to retire.\n`,
  );
} catch (err) {
  if (err instanceof KlimaRetireError) {
    console.error(`\n✗ ${err.code ?? err.status}: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
