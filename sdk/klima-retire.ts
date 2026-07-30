/**
 * Klima x402 retire: TypeScript client
 * ──────────────────────────────────────
 * Retire tokenized carbon on Base through the KlimaDAO Retirement Aggregator, from any wallet or agent.
 * Zero dependencies
 */

// ─── types ─────────────────────────────────────────────────────────────────

export type Hex = `0x${string}`;

/** EIP-712 payload exactly as returned by the endpoint. Hand it to your wallet for signing. */
export interface Eip712TypedData {
  domain: Record<string, unknown>;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export type SignTypedData = (
  typedData: Eip712TypedData,
) => Promise<Hex | string> | Hex | string;

/** Certificate metadata. Baked into the onchain certificate. This CANNOT be edited later. */
export interface RetirementDetails {
  retiringAddress?: string;
  beneficiaryAddress?: string;
  /** Beneficiary display name that shows on the certificate. */
  beneficiaryString?: string;
  retiringEntityString?: string;
  /** Public message that shows on the certificate. */
  retirementMessage?: string;
  /** Bottom four are Toucan Puro only. Required for Puro credits. */
  beneficiaryLocation?: string;
  consumptionCountryCode?: string;
  consumptionPeriodStart?: number;
  consumptionPeriodEnd?: number;
}

export interface DiscoverFilters {
  carbonClass?: string;
  creditToken?: string;
  maxUsdcPricePerTonne?: string | number;
}

export interface QuoteParams {
  amount: string | number;
  carbonClass: string;
  /** "usdc" | "kvcm" | a token address. Default: "usdc". */
  inputToken?: string;
  creditToken?: string;
  vintage?: number;
  tokenId?: string | number;
}

export interface RetireParams extends QuoteParams {
  /** Payer/signer address (the wallet that holds the input token). */
  from: string;
  /** Your wallet's `eth_signTypedData_v4` callback. */
  signTypedData: SignTypedData;
  details?: RetirementDetails;
  /**
   * Who the retirement is credited to. Required on the relay path
   */
  beneficiaryIsPayer?: boolean;
  /** Authorization lifetime in seconds (max 86400 = 24 hours). */
  timeToLiveSeconds?: number;
  /** Poll /certificate when the tx is mined but not yet indexed. Default: true. */
  pollCertificate?: boolean;
  pollIntervalMs?: number;
  pollAttempts?: number;
  /** Progress callback for each stage of the flow. */
  onStep?: (step: RetireStep, info: Record<string, unknown>) => void;
}

export type RetireStep = "prepare" | "sign" | "submit" | "poll" | "done";

export interface CertificateRetirement {
  retirementId: string;
  retirementIndex: number;
  certificateUrl: string;
  amountInTonnes: string;
  beneficiaryName: string;
  beneficiaryLocation: string;
  message: string;
  projectId: string;
  creditId: string;
  retiringAddress: string;
  timestamp: number;
}

export interface RetireResult {
  status: "settled" | "pending_index";
  transactionHash: string;
  chainId: number;
  chain: string;
  quote: Record<string, unknown>;
  retirementCount: number;
  retirements: CertificateRetirement[];
  note: string;
}

export interface KlimaClientOptions {
  /** Endpoint origin (no trailing /api). Default: https://x402.klimalabs.com */
  baseUrl?: string;
  /** Default 8453 (Base mainnet). */
  chainId?: number;
  /** Override the global fetch (e.g. a custom agent/proxy). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (AbortController). Default 30000 (30 seconds). */
  timeoutMs?: number;
}

/** Thrown on any non-2xx response */
export class KlimaRetireError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "KlimaRetireError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ─── constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://x402.klimalabs.com";
const DEFAULT_CHAIN_ID = 8453;

/** Input-token symbol → address, per chain. Addresses are accepted directly too. */
const INPUT_TOKENS: Record<number, Record<string, string>> = {
  8453: {
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    kvcm: "0x00fbac94fec8d4089d3fe979f39454f48c71a65d",
  },
};

function resolveInputToken(chainId: number, token?: string): string {
  if (token && token.startsWith("0x")) return token;
  const symbol = (token ?? "usdc").toLowerCase();
  const addr = INPUT_TOKENS[chainId]?.[symbol];
  if (!addr) {
    throw new KlimaRetireError(
      `Unknown inputToken "${token}" for chain ${chainId}. Pass "usdc", "kvcm", or a token address.`,
      400,
      "unsupported_input_token",
    );
  }
  return addr;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeAmount(amount: string | number): string {
  let s =
    typeof amount === "number"
      ? amount.toLocaleString("en-US", {
          useGrouping: false,
          maximumFractionDigits: 18,
        })
      : amount.trim();
  if (s.startsWith(".")) s = "0" + s;
  return s;
}

// ─── client ────────────────────────────────────────────────────────────────

export interface KlimaClient {
  /** Browse retirable carbon classes (filters AND-combined). */
  discover(filters?: DiscoverFilters): Promise<any>;
  /** Live price for a retirement of `amount` from a class. */
  quote(params: QuoteParams): Promise<any>;
  /** Build the EIP-712 authorization to sign (does not move funds). */
  prepareAuth(
    params: Omit<
      RetireParams,
      | "signTypedData"
      | "onStep"
      | "pollCertificate"
      | "pollIntervalMs"
      | "pollAttempts"
    >,
  ): Promise<any>;
  /** prepare-auth → sign → submit → (poll certificate). The one-call path. */
  retire(params: RetireParams): Promise<RetireResult>;
  /** Resolve the public Carbonmark certificate(s) for a transaction. */
  certificate(args: { txHash: string; index?: number }): Promise<{
    transactionHash: string;
    retirementCount: number;
    retirements: CertificateRetirement[];
  }>;
}

export function createClient(options: KlimaClientOptions = {}): KlimaClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const chainId = options.chainId ?? DEFAULT_CHAIN_ID;
  const api = `${baseUrl}/api`;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!doFetch) {
    throw new KlimaRetireError(
      "No fetch available. Use Node 18+ or pass options.fetch.",
      500,
    );
  }

  async function post<T = any>(body: Record<string, unknown>): Promise<T> {
    // Bound every request: fetch never times out on its own, so a hung endpoint
    // would otherwise hang the caller forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Awaited<ReturnType<typeof doFetch>>;
    try {
      res = await doFetch(api, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Callers should only ever catch KlimaRetireError.
      if (controller.signal.aborted) {
        throw new KlimaRetireError(
          `Request timed out after ${timeoutMs}ms.`,
          408,
          "timeout",
        );
      }
      throw new KlimaRetireError(
        err instanceof Error ? err.message : "Network request failed.",
        0,
        "network_error",
      );
    } finally {
      clearTimeout(timer);
    }
    // A redirect or non-JSON body almost always means the request never reached the API.
    // Surface that clearly rather than returning a random empty object.
    if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
      throw new KlimaRetireError(
        `Endpoint did not return JSON (status ${res.status}${res.redirected ? ", redirected" : ""}). ` +
          `Check baseUrl, or that the deployment isn't behind access protection.`,
        res.status,
        "non_json_response",
      );
    }
    const json: any = await res.json().catch(() => ({}));
    if (res.status < 200 || res.status >= 300) {
      throw new KlimaRetireError(
        json?.message ?? json?.error ?? `Request failed (${res.status})`,
        res.status,
        json?.error,
        json,
      );
    }
    return json as T;
  }

  const client: KlimaClient = {
    discover(filters = {}) {
      const { maxUsdcPricePerTonne, ...rest } = filters;
      // The endpoint validates these as decimal strings over JSON so stringify before sending.
      return post({
        action: "discover",
        ...rest,
        ...(maxUsdcPricePerTonne != null
          ? { maxUsdcPricePerTonne: String(maxUsdcPricePerTonne) }
          : {}),
      });
    },

    quote(params) {
      return post({
        action: "quote",
        chainId,
        inputToken: resolveInputToken(chainId, params.inputToken),
        amount: normalizeAmount(params.amount),
        carbonClass: params.carbonClass,
        ...(params.creditToken ? { creditToken: params.creditToken } : {}),
        ...(params.vintage != null ? { vintage: params.vintage } : {}),
        ...(params.tokenId != null ? { tokenId: String(params.tokenId) } : {}),
      });
    },

    prepareAuth(params) {
      return post({
        action: "prepare-auth",
        chainId,
        from: params.from,
        inputToken: resolveInputToken(chainId, params.inputToken),
        amount: normalizeAmount(params.amount),
        carbonClass: params.carbonClass,
        ...(params.creditToken ? { creditToken: params.creditToken } : {}),
        ...(params.vintage != null ? { vintage: params.vintage } : {}),
        ...(params.tokenId != null ? { tokenId: String(params.tokenId) } : {}),
        ...(params.details ? { details: params.details } : {}),
        ...(params.beneficiaryIsPayer
          ? { beneficiaryIsPayer: params.beneficiaryIsPayer }
          : {}),
        ...(params.timeToLiveSeconds != null
          ? { timeToLiveSeconds: params.timeToLiveSeconds }
          : {}),
      });
    },

    // NOTE: the certificate endpoint is strict. It takes ONLY txHash (+ optional index). Do not send chainId here.
    certificate({ txHash, index }) {
      return post({
        action: "certificate",
        txHash,
        ...(index != null ? { index } : {}),
      });
    },

    async retire(params) {
      const {
        signTypedData,
        onStep,
        pollCertificate = true,
        pollIntervalMs = 3000,
        pollAttempts = 10,
        ...intent
      } = params;

      onStep?.("prepare", {});
      const prep = await client.prepareAuth(intent);

      onStep?.("sign", { authValueFormatted: prep.authValueFormatted });
      const signature = await signTypedData(prep.typedData as Eip712TypedData);

      onStep?.("submit", {});
      // Spread the whole template: besides details/creditToken/tokenId it carries
      // `salt`, which actions/retire needs to recheck the authorization nonce.
      const result = await post<RetireResult>({
        ...prep.actionsRetireRequest,
        authPayload: { ...prep.actionsRetireRequest.authPayload, signature },
      });

      if (
        result.status === "pending_index" &&
        pollCertificate &&
        result.transactionHash
      ) {
        for (let i = 0; i < pollAttempts; i++) {
          onStep?.("poll", { attempt: i + 1, of: pollAttempts });
          await sleep(pollIntervalMs);
          // While unindexed, /certificate returns 404 retirement_not_found. That's expected; keep polling. Re-throw anything else.
          let cert;
          try {
            cert = await client.certificate({ txHash: result.transactionHash });
          } catch (err) {
            if (
              err instanceof KlimaRetireError &&
              (err.status === 404 || err.code === "retirement_not_found")
            ) {
              continue;
            }
            throw err;
          }
          if (cert.retirements.length > 0) {
            result.status = "settled";
            result.retirements = cert.retirements;
            result.retirementCount = cert.retirementCount;
            break;
          }
        }
      }

      onStep?.("done", { status: result.status });
      return result;
    },
  };

  return client;
}
