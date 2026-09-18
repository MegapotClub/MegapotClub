import {
  encodeFunctionData,
  erc20Abi,
  keccak256,
  getAddress,
  isAddress,
  parseUnits,
  parseAbi,
  decodeEventLog,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import abis from "./vaultAbi.json" with { type: "json" };
import { atEvmEndpoint, type EvmClient } from "./evmClient.ts";
import {
  deployedVault,
  productDecimals,
  type ReadyVault,
  type Product,
  type CodePin,
} from "./vaultRegistry.ts";

export const vaultAbi = (product: Product): Abi =>
  (product.endsWith("eth")
    ? abis.SharedEthVault
    : product === "base-usdc"
      ? abis.BaseUsdcVault
      : abis.EthereumUsdcVault) as Abi;
export const OPERATIONS = [
  "cancelDeposit",
  "claimCancelled",
  "claimCancelledInKind",
  "claimDeposit",
  "cancelRedeem",
  "claimExit",
  "redeemRecovered",
  "processDeposits",
  "processRedeems",
  "syncDeposits",
  "syncExits",
  "recoverNative",
  "bridgeDeposit",
  "requestExit",
  "claimShares",
  "claimCash",
  "finalizeOperation",
  "cancelEntry",
  "claimCancelledEntry",
  "claimCancelledEntryInKind",
  "claimEntry",
  "cancelExit",
  "claimEthExit",
  "claimAbortedCash",
  "claimAbortedInKind",
  "burnWorthless",
  "seal",
  "prepare",
  "retrieveEntries",
  "settle",
  "leverage",
  "collectDownstream",
  "repayCash",
  "retrieveCollateral",
  "convertSurplus",
  "emergencySeal",
  "abortEntries",
  "releaseAbortedEntries",
  "releaseAbortedInKind",
] as const;
export type VaultOperation = (typeof OPERATIONS)[number];
export const POSITION_OPERATIONS = [
  "cancelDeposit",
  "retrieveWaiting",
  "claimDepositLot",
  "startRedeem",
  "claimExitLot",
  "recoverLockedRedeem",
  "collectRemoteDeposit",
  "collectRemoteExit",
  "closeDeposit",
  "closeRedeem",
] as const;
export type PositionOperation = (typeof POSITION_OPERATIONS)[number];
export type VaultIntent =
  | { kind: "deposit"; amount: bigint }
  | { kind: "redeem"; amount: bigint }
  | { kind: "transfer"; amount: bigint; receiver: Address }
  | { kind: "revoke" }
  | { kind: "position"; operation: PositionOperation; id?: bigint }
  | { kind: "defend"; amount: bigint; maxWeth: bigint }
  | {
      kind: "operate";
      operation: VaultOperation;
      id?: bigint;
      amount?: bigint;
    };
export type VaultCall = {
  to: Address;
  data: Hex;
  value: bigint;
  kind: "vaults";
  operation: string;
};
export type VaultState = {
  block: bigint;
  blockHash: Hex;
  timestamp: bigint;
  ether: bigint;
  balance: bigint;
  shares: bigint;
  allowance: bigint;
  contractWallet: boolean;
  phase: "running" | "draining" | "stopped";
  debt?: bigint;
  health?: bigint;
  waitingUnits?: bigint;
  position?: Address;
};
export type VaultReview = {
  product: Product;
  chainId: 1 | 8453;
  account: Address;
  intent: VaultIntent;
  call: VaultCall;
  state: VaultState;
  endpoint: string;
  createdAt: number;
  simulation: Hex;
};
const positive = (n: bigint | undefined): bigint => {
  if (typeof n !== "bigint" || n <= 0n || n >= 2n ** 256n)
    throw new Error("invalidAmount");
  return n;
};
export function vaultAmount(text: string, product: Product): bigint {
  const decimals = productDecimals(product);
  if (!new RegExp(`^(0|[1-9]\\d{0,59})(\\.\\d{1,${decimals}})?$`).test(text))
    throw new Error("invalidAmount");
  return positive(parseUnits(text, decimals));
}
export function requestId(text: string): bigint {
  if (!/^[1-9]\d{0,77}$/.test(text)) throw new Error("invalidAmount");
  return positive(BigInt(text));
}

/** @cc [label:security] closed-vault-call-vocabulary
 * Destination, function, spender, receiver and native value are constructed locally from the pinned product and explicit intent.
 * No user-controlled calldata or arbitrary target enters this planner. Approvals are exact; new deposits never consume existing shares.
 */
export function planVaultCall(
  d: ReadyVault,
  account: Address,
  intent: VaultIntent,
  allowance = 0n,
  position?: Address,
): VaultCall {
  const address = d.vault.address,
    eth = d.product.endsWith("eth");
  let to = address,
    abi: Abi = vaultAbi(d.product),
    fn: string,
    args: readonly unknown[] = [],
    value = 0n;
  switch (intent.kind) {
    case "defend":
      if (!eth) throw new Error("invalidAction");
      fn = "defendWithFlash";
      args = [positive(intent.amount), positive(intent.maxWeth)];
      break;
    case "position": {
      if (
        !eth ||
        !position ||
        !d.dependencies.some(
          (p) => p.address.toLowerCase() === position.toLowerCase(),
        )
      )
        throw new Error("contractChanged");
      const id =
        intent.operation === "startRedeem" ? undefined : positive(intent.id);
      const local: Partial<
        Record<PositionOperation, readonly [string, readonly unknown[]]>
      > = {
        cancelDeposit: ["cancelDeposit", [id]],
        startRedeem: ["startRedeem", []],
        closeDeposit: ["closeRequest", [id, true]],
        closeRedeem: ["closeRequest", [id, false]],
        ...(d.product === "base-eth"
          ? {
              retrieveWaiting: ["retrieveWaiting", [id]],
              claimDepositLot: ["claimDepositLot", [id]],
              claimExitLot: ["claimExitLot", [id]],
              recoverLockedRedeem: ["recoverLockedRedeem", [id]],
            }
          : {
              collectRemoteDeposit: ["collectRemote", [id, true]],
              collectRemoteExit: ["collectRemote", [id, false]],
            }),
      };
      const call = local[intent.operation];
      if (!call) throw new Error("invalidAction");
      to = position;
      abi = abis.ServicePosition as Abi;
      [fn, args] = call;
      break;
    }
    case "deposit": {
      const amount = positive(intent.amount);
      if (eth) {
        fn = "requestDeposit";
        args = [amount, account, true];
        value = amount;
      } else if (allowance < amount) {
        to = d.asset.address;
        abi = erc20Abi;
        fn = "approve";
        args = [address, amount];
      } else {
        fn = "requestDeposit";
        args = [amount, account];
      }
      break;
    }
    case "redeem":
      fn = "requestRedeem";
      args = [positive(intent.amount), account];
      break;
    case "revoke":
      if (eth) throw new Error("invalidAmount");
      to = d.asset.address;
      abi = erc20Abi;
      fn = "approve";
      args = [address, 0n];
      break;
    case "transfer": {
      if (
        !isAddress(intent.receiver) ||
        /^0x0{40}$/i.test(intent.receiver) ||
        intent.receiver.toLowerCase() === address.toLowerCase()
      )
        throw new Error("invalidAmount");
      fn = "transfer";
      args = [getAddress(intent.receiver), positive(intent.amount)];
      break;
    }
    case "operate": {
      const op = intent.operation;
      const base: Partial<
        Record<VaultOperation, readonly [string, readonly unknown[]]>
      > = {
        cancelDeposit: ["cancelDeposit", [intent.id]],
        claimCancelled: ["claimCancelled", [intent.id, account, false]],
        claimCancelledInKind: ["claimCancelled", [intent.id, account, true]],
        claimDeposit: ["claimDeposit", [intent.id, account]],
        cancelRedeem: ["cancelRedeem", [intent.id, account]],
        claimExit: ["claimExit", [intent.id, account]],
        redeemRecovered: ["redeemRecovered", [intent.amount, account]],
        processDeposits: ["processDeposits", [64n, 2n ** 256n - 1n]],
        processRedeems: ["processRedeems", [64n, 2n ** 256n - 1n]],
        syncDeposits: ["syncDeposits", []],
        syncExits: ["syncExits", []],
        recoverNative: ["recoverNative", []],
      };
      const remote: Partial<
        Record<VaultOperation, readonly [string, readonly unknown[]]>
      > = {
        bridgeDeposit: ["bridgeDeposit", [intent.id]],
        requestExit: ["requestExit", [intent.id]],
        claimShares: ["claimShares", [intent.id, account]],
        claimCash: ["claimCash", [intent.id, account]],
        finalizeOperation: ["finalizeOperation", [intent.id]],
      };
      const ether: Partial<
        Record<VaultOperation, readonly [string, readonly unknown[]]>
      > = {
        cancelEntry: ["cancelEntry", [intent.id]],
        claimCancelledEntry: [
          "claimCancelledEntry",
          [intent.id, account, false],
        ],
        claimCancelledEntryInKind: [
          "claimCancelledEntry",
          [intent.id, account, true],
        ],
        claimEntry: ["claimEntry", [intent.id, account, true]],
        cancelExit: ["cancelExit", [intent.id, account]],
        claimEthExit: ["claimExit", [intent.id, account, true]],
        claimAbortedCash: ["claimAbortedInKind", [intent.id, account, false]],
        claimAbortedInKind: ["claimAbortedInKind", [intent.id, account, true]],
        burnWorthless: ["burnWorthless", [intent.amount]],
        seal: ["seal", []],
        prepare: ["prepare", [64n]],
        retrieveEntries: ["retrieveEntries", []],
        settle: ["settle", []],
        leverage: ["leverage", []],
        collectDownstream: ["collectDownstream", []],
        repayCash: ["repayCash", []],
        retrieveCollateral: ["retrieveCollateral", []],
        convertSurplus: ["convertSurplus", []],
        emergencySeal: ["emergencySeal", []],
        abortEntries: ["abortEntries", []],
        releaseAbortedEntries: ["releaseAbortedEntries", []],
        releaseAbortedInKind: ["releaseAbortedInKind", []],
      };
      const found = (eth ? ether : d.product === "base-usdc" ? base : remote)[
        op
      ];
      if (!found) throw new Error("invalidAction");
      [fn, args] = found;
      if (args.some((a) => a === undefined)) throw new Error("invalidAmount");
      if (intent.id !== undefined) positive(intent.id);
      if (intent.amount !== undefined) positive(intent.amount);
      break;
    }
    default:
      throw new Error("invalidAction");
  }
  return {
    to,
    data: encodeFunctionData({ abi, functionName: fn, args }),
    value,
    kind: "vaults",
    operation: fn,
  };
}

async function verifyPin(client: EvmClient, blockNumber: bigint, pin: CodePin) {
  const code = await client.getCode({ address: pin.address, blockNumber });
  if (!code || keccak256(code) !== pin.codeHash)
    throw new Error("contractChanged");
  if (pin.aggregator) {
    const actual = await client.readContract({
      address: pin.address,
      abi: parseAbi(["function aggregator() view returns (address)"]),
      functionName: "aggregator",
      blockNumber,
    });
    if (actual.toLowerCase() !== pin.aggregator.address.toLowerCase())
      throw new Error("contractChanged");
    await verifyPin(client, blockNumber, pin.aggregator);
  }
  if (pin.implementation) {
    const i = pin.implementation,
      raw = await client.getStorageAt({
        address: pin.address,
        slot: i.slot,
        blockNumber,
      });
    if (
      !raw ||
      raw.slice(-40).toLowerCase() !== i.address.slice(2).toLowerCase()
    )
      throw new Error("contractChanged");
    await verifyPin(client, blockNumber, {
      address: i.address,
      codeHash: i.codeHash,
    });
  }
}
export async function verifyVault(
  client: EvmClient,
  block: bigint,
  d: ReadyVault,
) {
  await Promise.all(
    [d.vault, d.asset, ...d.dependencies].map((p) =>
      verifyPin(client, block, p),
    ),
  );
  const asset = (await client.readContract({
    address: d.vault.address,
    abi: vaultAbi(d.product),
    functionName: d.product.endsWith("eth")
      ? "weth"
      : d.product === "base-usdc"
        ? "asset"
        : "token",
    blockNumber: block,
  })) as Address;
  if (asset.toLowerCase() !== d.asset.address.toLowerCase())
    throw new Error("contractChanged");
}
async function stateAt(
  client: EvmClient,
  d: ReadyVault,
  account: Address,
): Promise<VaultState> {
  const block = await client.getBlock();
  if (
    block.number === null ||
    !block.hash ||
    Number(block.timestamp) * 1000 < Date.now() - 120_000 ||
    Number(block.timestamp) * 1000 > Date.now() + 30_000
  )
    throw new Error("staleChain");
  await verifyVault(client, block.number, d);
  const blockNumber = block.number,
    address = d.vault.address,
    eth = d.product.endsWith("eth");
  const read = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address,
      abi: vaultAbi(d.product),
      functionName,
      args,
      blockNumber,
    });
  const [ether, balance, shares, allowance, code, status] = await Promise.all([
    client.getBalance({ address: account, blockNumber }),
    client.readContract({
      address: d.asset.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    read("balanceOf", [account]) as Promise<bigint>,
    client.readContract({
      address: d.asset.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, address],
      blockNumber,
    }),
    client.getCode({ address: account, blockNumber }),
    read(
      eth ? "phase" : d.product === "base-usdc" ? "terminal" : "remoteStopped",
    ),
  ]);
  const phase = eth
    ? Number(status) === 0
      ? "running"
      : Number(status) === 1
        ? "draining"
        : "stopped"
    : status
      ? "stopped"
      : "running";
  const result: VaultState = {
    block: blockNumber,
    blockHash: block.hash,
    timestamp: block.timestamp,
    ether,
    balance,
    shares,
    allowance,
    contractWallet:
      !!code && code !== "0x" && !/^0xef0100[0-9a-fA-F]{40}$/.test(code),
    phase,
  };
  if (eth) {
    result.position = (await read("position")) as Address;
    if (
      !d.dependencies.some(
        (p) => p.address.toLowerCase() === result.position!.toLowerCase(),
      )
    )
      throw new Error("contractChanged");
    const controller = (await client.readContract({
      address: result.position,
      abi: abis.ServicePosition as Abi,
      functionName: "controller",
      blockNumber,
    })) as Address;
    if (controller.toLowerCase() !== address.toLowerCase())
      throw new Error("contractChanged");
    [result.debt, result.health] = (await Promise.all([
      read("debt"),
      read("health"),
    ])) as [bigint, bigint];
  } else if (d.product === "base-usdc")
    result.waitingUnits = (await read("waitingUnitsOf", [account])) as bigint;
  if ((await client.getBlock({ blockNumber })).hash !== block.hash)
    throw new Error("staleChain");
  return result;
}
export async function readVault(
  urls: string[],
  product: Product,
  account: Address,
) {
  const d = deployedVault(product);
  return atEvmEndpoint(d.chainId, urls, (client) =>
    stateAt(client, d, account),
  );
}
export async function reviewVault(
  urls: string[],
  product: Product,
  account: Address,
  intent: VaultIntent,
): Promise<VaultReview> {
  const d = deployedVault(product);
  return atEvmEndpoint(d.chainId, urls, async (client, endpoint) => {
    const state = await stateAt(client, d, account),
      call = planVaultCall(d, account, intent, state.allowance, state.position);
    if (
      intent.kind === "deposit" &&
      (state.phase === "stopped" ||
        (product.endsWith("eth") ? state.ether : state.balance) < intent.amount)
    )
      throw new Error("insufficientBalance");
    if (
      (intent.kind === "redeem" || intent.kind === "transfer") &&
      intent.amount > state.shares
    )
      throw new Error("insufficientBalance");
    const result = await client.call({
      account,
      to: call.to,
      data: call.data,
      value: call.value,
      blockNumber: state.block,
    });
    if (
      (await client.getBlock({ blockNumber: state.block })).hash !==
      state.blockHash
    )
      throw new Error("staleChain");
    return {
      product,
      chainId: d.chainId,
      account,
      intent,
      call,
      state,
      endpoint,
      createdAt: Date.now(),
      simulation: keccak256(result.data ?? "0x"),
    };
  });
}

export type RequestRecord = {
  id: bigint;
  kind: "deposit" | "exit";
  value: unknown;
  block: bigint;
};
export async function readVaultRequest(
  urls: string[],
  product: Product,
  kind: "deposit" | "exit",
  id: bigint,
): Promise<RequestRecord> {
  positive(id);
  const d = deployedVault(product);
  return atEvmEndpoint(d.chainId, urls, async (client) => {
    const block = await client.getBlockNumber();
    await verifyVault(client, block, d);
    const functionName = product.endsWith("eth")
      ? kind === "deposit"
        ? "entries"
        : "exits"
      : product === "base-usdc"
        ? kind === "deposit"
          ? "deposits"
          : "redeems"
        : "getOperation";
    const value = await client.readContract({
      address: d.vault.address,
      abi: vaultAbi(product),
      functionName,
      args: [id],
      blockNumber: block,
    });
    return { id, kind, value, block };
  });
}

export type VaultEvent = {
  name: string;
  args: Record<string, unknown>;
  block: bigint;
  hash: Hex;
  index: number;
};
// Bounded, resumable event discovery: indexed chain history, no app indexer, and no silent claim of full coverage.
export async function vaultEvents(
  urls: string[],
  product: Product,
  account: Address,
  before?: bigint,
) {
  const d = deployedVault(product);
  return atEvmEndpoint(d.chainId, urls, async (client) => {
    const head = await client.getBlockNumber();
    await verifyVault(client, head, d);
    const end = before !== undefined && before < head ? before : head;
    const start =
      end > d.deployedAtBlock + 19_999n ? end - 19_999n : d.deployedAtBlock;
    const events: VaultEvent[] = [];
    const controllers = new Map<string, string>();
    for (let from = start; from <= end; from += 2000n) {
      const logs = await client.getLogs({
        address: d.vault.address,
        fromBlock: from,
        toBlock: from + 1999n < end ? from + 1999n : end,
      });
      if (logs.length > 4000) throw new Error("historyTooLarge");
      for (const log of logs) {
        if (
          log.removed ||
          log.blockNumber === null ||
          log.transactionHash === null ||
          log.logIndex === null
        )
          continue;
        const decoded = decodeEventLog({
          abi: vaultAbi(product),
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        const raw: unknown = decoded.args;
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          typeof decoded.eventName !== "string"
        )
          continue;
        const args = raw as Record<string, unknown>;
        let owned = Object.values(args).some(
          (v) =>
            typeof v === "string" && v.toLowerCase() === account.toLowerCase(),
        );
        if (
          !owned &&
          product === "base-usdc" &&
          ["DepositCommitted", "ExitCommitted"].includes(decoded.eventName) &&
          typeof args.request === "bigint"
        ) {
          const method =
              decoded.eventName === "DepositCommitted" ? "deposits" : "redeems",
            key = `${method}:${args.request}`;
          let controller = controllers.get(key);
          if (controller === undefined) {
            if (controllers.size >= 256) throw new Error("historyTooLarge");
            const value = (await client.readContract({
              address: d.vault.address,
              abi: vaultAbi(product),
              functionName: method,
              args: [args.request],
              blockNumber: head,
            })) as readonly [Address, bigint];
            controller = value[0].toLowerCase();
            controllers.set(key, controller);
          }
          owned = controller === account.toLowerCase();
        }
        if (!owned) continue;
        events.push({
          name: decoded.eventName,
          args,
          block: log.blockNumber,
          hash: log.transactionHash,
          index: log.logIndex,
        });
      }
    }
    return {
      events: events.sort((a, b) =>
        a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1,
      ),
      from: start,
      to: end,
      next: start > d.deployedAtBlock ? start - 1n : undefined,
    };
  });
}
