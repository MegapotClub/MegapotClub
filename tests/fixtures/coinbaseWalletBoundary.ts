import { decodeFunctionData, type Hex } from "viem";
import { JACKPOT } from "../../src/config.ts";
import { USDC, jackpotAbi, tokenAbi } from "../../src/native.ts";
// Follow the pinned SDK actually loaded by @wagmi/connectors. Importing its real
// implementation is intentional: a mock formatter would hide browser failures.
import { WalletLinkSigner } from "club-test/coinbase-signer";

export type CoinbaseFixtureTransaction = {
  from: Hex;
  to: Hex;
  data: Hex;
  chainId: Hex;
  value?: Hex;
  gas?: Hex;
  nonce?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
};

type RelayTransaction = {
  fromAddress: string;
  toAddress: string | null;
  data: Uint8Array & { toString(encoding: "hex"): string };
  chainId: number;
  weiValue: bigint;
  gasLimit: bigint | null;
  nonce: number | null;
  gasPriceInWei: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
};

export type CoinbaseWalletBoundaryAudit = {
  sdk: "Coinbase WalletLinkSigner";
  action: string;
  chainId: 8453;
  from: string;
  to: string;
  dataBytes: number;
  calldataPreserved: true;
  value: string;
  gas: string | null;
  globalBufferPresent: boolean;
};

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Coinbase fixture: ${message}`);
}

const syntheticAccounts = new Set([
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
]);

/**
 * Exercise the installed SDK's public request, routing, formatting and relay
 * dispatch without constructing a real relay. The supplied submit function must
 * be the in-memory retail fixture transport; it must never call a live wallet.
 * No Buffer import/global is provided here, so the browser build must supply the
 * SDK's own dependency correctly. Rejections and lost responses propagate.
 */
export async function dispatchCoinbaseWalletFixture(
  input: CoinbaseFixtureTransaction,
  submit: (transaction: CoinbaseFixtureTransaction) => Hex | Promise<Hex>,
  onPrepared?: (audit: CoinbaseWalletBoundaryAudit) => void,
): Promise<Hex> {
  invariant(
    syntheticAccounts.has(input.from.toLowerCase()),
    "synthetic account required",
  );
  invariant(BigInt(input.chainId) === 8453n, "explicit Base chain required");
  invariant(
    [USDC.toLowerCase(), JACKPOT.toLowerCase()].includes(
      input.to.toLowerCase(),
    ),
    "unsupported fixture destination",
  );
  invariant(/^0x(?:[0-9a-f]{2})*$/i.test(input.data), "invalid calldata");
  invariant(
    typeof window === "undefined" || !Reflect.get(window, "ClientAnalytics"),
    "telemetry must remain disabled",
  );

  const relay = {
    async signAndSubmitEthereumTransaction(prepared: RelayTransaction) {
      invariant(prepared.chainId === 8453, "SDK changed the execution chain");
      invariant(
        prepared.fromAddress === input.from.toLowerCase(),
        "SDK changed the sender",
      );
      invariant(
        prepared.toAddress === input.to.toLowerCase(),
        "SDK changed the destination",
      );
      invariant(
        prepared.data instanceof Uint8Array,
        "SDK did not produce binary calldata",
      );
      const data = `0x${prepared.data.toString("hex")}` as Hex;
      invariant(
        data === input.data.toLowerCase(),
        "SDK changed calldata bytes",
      );
      invariant(
        prepared.weiValue === BigInt(input.value ?? "0x0"),
        "SDK changed transaction value",
      );
      const transaction: CoinbaseFixtureTransaction = {
        from: prepared.fromAddress as Hex,
        to: prepared.toAddress as Hex,
        chainId: `0x${prepared.chainId.toString(16)}`,
        data,
        value: `0x${prepared.weiValue.toString(16)}`,
      };
      const quantities = [
        ["gas", prepared.gasLimit],
        ["nonce", prepared.nonce],
        ["gasPrice", prepared.gasPriceInWei],
        ["maxFeePerGas", prepared.maxFeePerGas],
        ["maxPriorityFeePerGas", prepared.maxPriorityFeePerGas],
      ] as const;
      for (const [name, actual] of quantities) {
        invariant(
          input[name] === undefined
            ? actual === null
            : actual !== null && BigInt(actual) === BigInt(input[name]!),
          `SDK changed ${name}`,
        );
        if (actual !== null) transaction[name] = `0x${actual.toString(16)}`;
      }
      const action = decodeFunctionData({
        abi: transaction.to === USDC.toLowerCase() ? tokenAbi : jackpotAbi,
        data,
      }).functionName;
      invariant(
        [
          "approve",
          "buyTickets",
          "claimWinnings",
          "claimReferralFees",
        ].includes(action),
        "unsupported fixture action",
      );
      onPrepared?.({
        sdk: "Coinbase WalletLinkSigner",
        action,
        chainId: 8453,
        from: transaction.from,
        to: transaction.to,
        dataBytes: prepared.data.length,
        calldataPreserved: true,
        value: prepared.weiValue.toString(),
        gas: prepared.gasLimit?.toString() ?? null,
        globalBufferPresent: "Buffer" in globalThis,
      });
      return {
        method: "signEthereumTransaction",
        result: await submit(transaction),
      };
    },
  };
  // Avoid the constructor, which initializes the external relay. The real
  // initializeRelay implementation returns this already-installed test transport.
  // A deliberately different stored chain proves the explicit request wins.
  const signer = Object.assign(Object.create(WalletLinkSigner.prototype), {
    _addresses: [input.from],
    _relay: relay,
    _storage: { getItem: () => "1" },
  }) as WalletLinkSigner;
  const hash: unknown = await signer.request({
    method: "eth_sendTransaction",
    params: [input],
  });
  invariant(
    typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash),
    "invalid fixture hash",
  );
  return hash as Hex;
}
