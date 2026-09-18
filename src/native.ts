import {
  createPublicClient,
  parseAbi,
  encodeFunctionData,
  keccak256,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { rpcHttp } from "./rpcTransport.ts";
import { JACKPOT, TICKET_NFT } from "./config.ts";
import { parseRpcUrls } from "./model.ts";
import { nativeReturnPpm } from "./historyMath.ts";

export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const LP_MANAGER = "0xE63E54DF82d894396B885CE498F828f2454d9dCf" as const;
export const SUBSCRIPTION =
  "0x2694Bd48f3e6B4775943067DC842C93bf5F19DcD" as const;
export const BATCH = "0xBA343479D98a1Ed333899999D95a7343B808a76F" as const;
export const REGISTRY = [
  {
    name: "Jackpot",
    address: JACKPOT,
    hash: "0x597f3a8e9360fbfc2e623243507ee9e8a66609003078ffc33d9013cb0607002d",
  },
  {
    name: "LP manager",
    address: LP_MANAGER,
    hash: "0xc956ae2487e47535389743ae26df47e8c580971c11232dc91f893ea1b9ae9eac",
  },
  {
    name: "Ticket NFT",
    address: TICKET_NFT,
    hash: "0xf08234474c8484705b2e855d9602b6e229359839fc7bad67c9157a9d5dd53ca8",
  },
  {
    name: "Subscription",
    address: SUBSCRIPTION,
    hash: "0x9e0fcd58176b5d92ea27317219e90a4ee31463c18c08e26db10ca26c06e261a7",
  },
  {
    name: "Batch facilitator",
    address: BATCH,
    hash: "0xef98f46e6ed4e1e94d0c85dbb0a5de00cc458ff51dc287b01abc1c5fed3758c2",
  },
] as const;
export const jackpotAbi = parseAbi([
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256) view returns ((uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket, uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought, uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket, uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock))",
  "function getDrawingTierPayouts(uint256) view returns (uint256[12])",
  "function getTicketTierIds(uint256[]) view returns (uint256[])",
  "function emergencyMode() view returns (bool)",
  "function referralFees(address) view returns (uint256)",
  "function usdc() view returns (address)",
  "function jackpotLPManager() view returns (address)",
  "function jackpotNFT() view returns (address)",
  "function lpDeposit(uint256)",
  "function initiateWithdraw(uint256)",
  "function finalizeWithdraw()",
  "function claimReferralFees()",
  "function claimWinnings(uint256[])",
  "function emergencyWithdrawLP()",
  "function emergencyRefundTickets(uint256[])",
]);
const lpAbi = parseAbi([
  "function getLPShares(address) view returns (uint256)",
  "function getLPValueBreakdown(address) view returns ((uint256 activeDeposits, uint256 pendingDeposits, uint256 pendingWithdrawals, uint256 claimableWithdrawals))",
  "function getLpInfo(address) view returns ((uint256 consolidatedShares, (uint256 amount, uint256 drawingId) lastDeposit, (uint256 amountInShares, uint256 drawingId) pendingWithdrawal, uint256 claimableWithdrawals))",
  "function lpPoolCap() view returns (uint256)",
  "function getEstimatedNextDrawingLpPool() view returns (uint256)",
  "function getLPDrawingState(uint256) view returns ((uint256 lpPoolTotal, uint256 pendingDeposits, uint256 pendingWithdrawals))",
]);
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const nftAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function getTicketInfo(uint256) view returns ((uint256 drawingId, uint256 packedTicket, bytes32 referralScheme))",
]);
const payoutAbi = parseAbi([
  "function getTierPayout(uint256,uint256) view returns (uint256)",
]);
const subscriptionAbi = parseAbi([
  "function subscriptions(address) view returns (uint64 remainingUSDC, uint64 lastExecutedDrawing, uint64 subscribedTicketPrice, uint64 dynamicTicketCount, bytes32 source)",
  "function cancelSubscription()",
]);
const batchAbi = parseAbi([
  "function batchOrders(address) view returns (uint256 orderDrawingId, uint64 remainingUSDC, uint64 remainingTickets, uint64 totalTicketsOrdered, uint64 dynamicTicketCount, bytes32 source)",
  "function cancelBatchOrder()",
]);

export type Action =
  | { kind: "deposit"; amount: bigint }
  | { kind: "withdraw"; shares: bigint }
  | { kind: "claim" | "refund"; ids: bigint[] }
  | {
      kind:
        | "finalize"
        | "referral"
        | "cancelSubscription"
        | "cancelBatch"
        | "emergencyExit"
        | "revoke";
    };
export type ActionKind = Action["kind"];
export type Call = {
  to: Address;
  data: Hex;
  value: 0n;
  kind: ActionKind | "approve";
};
export type Position = {
  contractWallet: boolean;
  account: Address;
  block: bigint;
  blockHash: Hex;
  timestamp: bigint;
  draw: bigint;
  locked: boolean;
  emergency: boolean;
  balance: bigint;
  ether: bigint;
  allowance: bigint;
  shares: bigint;
  active: bigint;
  pending: bigint;
  exiting: bigint;
  claimable: bigint;
  referral: bigint;
  cap: bigint;
  nextPool: bigint;
  subscription: bigint | null;
  batch: bigint | null;
  pendingWithdrawalShares: bigint;
  withdrawalDraw: bigint;
};
export type Review = {
  action: Action;
  account: Address;
  block: bigint;
  createdAt: number;
  amount: bigint;
  position: Position;
  calls: Call[];
  endpoint: string;
};

export function amountUSDC(text: string): bigint {
  if (!/^(0|[1-9]\d{0,20})(\.\d{1,6})?$/.test(text))
    throw new Error("invalidAmount");
  const amount = parseUnits(text, 6);
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error("invalidAmount");
  return amount;
}
export function ticketIds(text: string): bigint[] {
  const parts = text.trim().split(/[\s,]+/);
  if (parts.length > 30 || parts.some((x) => !/^[1-9]\d{0,77}$/.test(x)))
    throw new Error("invalidTickets");
  const ids = parts.map(BigInt);
  if (
    new Set(ids.map(String)).size !== ids.length ||
    ids.some((id) => id >= 2n ** 256n)
  )
    throw new Error("invalidTickets");
  return ids;
}
export const nativeClient = (urls: string[], signal?: AbortSignal) =>
  createPublicClient({
    chain: base,
    ccipRead: false,
    transport: rpcHttp(parseRpcUrls(urls)[0], {
      timeout: 12_000,
      retryCount: 0,
      fetchOptions: {
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
      },
    }),
  });
type Client = ReturnType<typeof nativeClient>;
/** @cc [label:security] complete-endpoint-observation
 * Each fallback attempt MUST validate its own chain and repeat the complete observation at that endpoint.
 * Individual contract calls MUST NOT fail over into a mixed-provider wallet plan.
 */
export async function atNativeEndpoint<T>(
  urls: string[],
  read: (client: Client, endpoint: string) => Promise<T>,
): Promise<T> {
  let last: unknown = new Error("rpcUnavailable");
  for (const endpoint of parseRpcUrls(urls)) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const client = nativeClient([endpoint], controller.signal);
      if ((await client.getChainId()) !== 8453) throw new Error("wrongChain");
      return await read(client, endpoint);
    } catch (error) {
      last = error;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  throw last;
}
const linksAbi = parseAbi([
  "function jackpot() view returns (address)",
  "function usdc() view returns (address)",
  "function batchFacilitator() view returns (address)",
]);
async function linked(c: Client, blockNumber: bigint, address: Address) {
  await pinned(c, blockNumber, address);
  const jackpot = await c.readContract({
    address,
    abi: linksAbi,
    functionName: "jackpot",
    blockNumber,
  });
  if (jackpot.toLowerCase() !== JACKPOT.toLowerCase())
    throw new Error("contractChanged");
  if (address === SUBSCRIPTION || address === BATCH) {
    const token = await c.readContract({
      address,
      abi: linksAbi,
      functionName: "usdc",
      blockNumber,
    });
    if (token.toLowerCase() !== USDC.toLowerCase())
      throw new Error("contractChanged");
  }
}
async function pinned(c: Client, block: bigint, address: Address) {
  const expected = REGISTRY.find(
    (r) => r.address.toLowerCase() === address.toLowerCase(),
  );
  const code = await c.getCode({ address, blockNumber: block });
  if (!expected || !code || keccak256(code) !== expected.hash)
    throw new Error("contractChanged");
}
async function fresh(c: Client) {
  if ((await c.getChainId()) !== 8453) throw new Error("wrongChain");
  const block = await c.getBlock();
  const age = Date.now() / 1000 - Number(block.timestamp);
  if (age < -30 || age > 120 || block.number === null || !block.hash)
    throw new Error("staleChain");
  return block;
}

/** @cc [label:security] transaction-observation
 * A wallet plan MUST come from fresh Base state with pinned target bytecode and matching protocol links.
 * Cached display data MUST NOT establish balances, authorizations, ownership, or execution eligibility.
 */
export function readPosition(urls: string[], input: string): Promise<Position> {
  return atNativeEndpoint(urls, (c) => readPositionAt(c, input));
}
async function readPositionAt(c: Client, input: string): Promise<Position> {
  if (!isAddress(input)) throw new Error("invalidAddress");
  const account = getAddress(input),
    b = await fresh(c),
    blockNumber = b.number;
  await Promise.all([
    pinned(c, blockNumber, JACKPOT),
    linked(c, blockNumber, LP_MANAGER),
  ]);
  const j = { address: JACKPOT, abi: jackpotAbi, blockNumber } as const;
  const lp = { address: LP_MANAGER, abi: lpAbi, blockNumber } as const;
  const [
    token,
    manager,
    nft,
    draw,
    emergency,
    balance,
    ether,
    allowance,
    shares,
    value,
    info,
    referral,
    cap,
    nextPool,
  ] = await Promise.all([
    c.readContract({ ...j, functionName: "usdc" }),
    c.readContract({ ...j, functionName: "jackpotLPManager" }),
    c.readContract({ ...j, functionName: "jackpotNFT" }),
    c.readContract({ ...j, functionName: "currentDrawingId" }),
    c.readContract({ ...j, functionName: "emergencyMode" }),
    c.readContract({
      address: USDC,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    c.getBalance({ address: account, blockNumber }),
    c.readContract({
      address: USDC,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account, JACKPOT],
      blockNumber,
    }),
    c.readContract({ ...lp, functionName: "getLPShares", args: [account] }),
    c.readContract({
      ...lp,
      functionName: "getLPValueBreakdown",
      args: [account],
    }),
    c.readContract({ ...lp, functionName: "getLpInfo", args: [account] }),
    c.readContract({ ...j, functionName: "referralFees", args: [account] }),
    c.readContract({ ...lp, functionName: "lpPoolCap" }),
    c.readContract({ ...lp, functionName: "getEstimatedNextDrawingLpPool" }),
  ]);
  if (
    token.toLowerCase() !== USDC.toLowerCase() ||
    manager.toLowerCase() !== LP_MANAGER.toLowerCase() ||
    nft.toLowerCase() !== TICKET_NFT.toLowerCase()
  )
    throw new Error("contractChanged");
  const state = await c.readContract({
    ...j,
    functionName: "getDrawingState",
    args: [draw],
  });
  // An incompatible recovery helper does not hide the main LP position.
  const [sub, batch] = await Promise.allSettled([
    linked(c, blockNumber, SUBSCRIPTION).then(() =>
      c.readContract({
        address: SUBSCRIPTION,
        abi: subscriptionAbi,
        functionName: "subscriptions",
        args: [account],
        blockNumber,
      }),
    ),
    linked(c, blockNumber, BATCH).then(() =>
      c.readContract({
        address: BATCH,
        abi: batchAbi,
        functionName: "batchOrders",
        args: [account],
        blockNumber,
      }),
    ),
  ]);
  const contractWallet = await c
    .getCode({ address: account, blockNumber })
    .then((code) =>
      Boolean(code && code !== "0x" && !/^0xef0100[0-9a-fA-F]{40}$/.test(code)),
    );
  if ((await c.getBlock({ blockNumber })).hash !== b.hash)
    throw new Error("staleChain");
  return {
    contractWallet,
    account,
    block: blockNumber,
    blockHash: b.hash!,
    timestamp: b.timestamp,
    draw,
    locked: state.jackpotLock,
    emergency,
    balance,
    ether,
    allowance,
    shares,
    active: value.activeDeposits,
    pending: value.pendingDeposits,
    exiting: value.pendingWithdrawals,
    claimable: value.claimableWithdrawals,
    referral,
    cap,
    nextPool,
    subscription: sub.status === "fulfilled" ? sub.value[0] : null,
    batch: batch.status === "fulfilled" ? batch.value[1] : null,
    pendingWithdrawalShares: info.pendingWithdrawal.amountInShares,
    withdrawalDraw: info.pendingWithdrawal.drawingId,
  };
}

/** @cc [label:security] closed-call-set
 * Calls MUST be derived solely from this discriminated action set, with canonical destinations and zero ETH value.
 * Deposit approval MUST name Jackpot and the exact requested amount. Purchase selectors MUST remain absent.
 */
export function actionCalls(action: Action, allowance = 0n): Call[] {
  if (action.kind === "deposit") {
    if (action.amount <= 0n || action.amount >= 2n ** 256n)
      throw new Error("invalidAmount");
    const approve: Call = {
      to: USDC,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [JACKPOT, action.amount],
      }),
      value: 0n,
      kind: "approve",
    };
    const deposit: Call = {
      to: JACKPOT,
      data: encodeFunctionData({
        abi: jackpotAbi,
        functionName: "lpDeposit",
        args: [action.amount],
      }),
      value: 0n,
      kind: action.kind,
    };
    return allowance >= action.amount ? [deposit] : [approve, deposit];
  }
  if (action.kind === "withdraw") {
    if (action.shares <= 0n || action.shares >= 2n ** 256n)
      throw new Error("invalidAmount");
    return [
      {
        to: JACKPOT,
        data: encodeFunctionData({
          abi: jackpotAbi,
          functionName: "initiateWithdraw",
          args: [action.shares],
        }),
        value: 0n,
        kind: action.kind,
      },
    ];
  }
  if (action.kind === "claim" || action.kind === "refund") {
    ticketIds(action.ids.join(","));
    return [
      {
        to: JACKPOT,
        data: encodeFunctionData({
          abi: jackpotAbi,
          functionName:
            action.kind === "claim"
              ? "claimWinnings"
              : "emergencyRefundTickets",
          args: [action.ids],
        }),
        value: 0n,
        kind: action.kind,
      },
    ];
  }
  if (action.kind === "revoke")
    return [
      {
        to: USDC,
        data: encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [JACKPOT, 0n],
        }),
        value: 0n,
        kind: action.kind,
      },
    ];
  if (action.kind === "cancelSubscription")
    return [
      {
        to: SUBSCRIPTION,
        data: encodeFunctionData({
          abi: subscriptionAbi,
          functionName: "cancelSubscription",
        }),
        value: 0n,
        kind: action.kind,
      },
    ];
  if (action.kind === "cancelBatch")
    return [
      {
        to: BATCH,
        data: encodeFunctionData({
          abi: batchAbi,
          functionName: "cancelBatchOrder",
        }),
        value: 0n,
        kind: action.kind,
      },
    ];
  const fn = {
    finalize: "finalizeWithdraw",
    referral: "claimReferralFees",
    emergencyExit: "emergencyWithdrawLP",
  } as const;
  return [
    {
      to: JACKPOT,
      data: encodeFunctionData({
        abi: jackpotAbi,
        functionName: fn[action.kind],
      }),
      value: 0n,
      kind: action.kind,
    },
  ];
}

export function reviewAction(
  urls: string[],
  account: string,
  action: Action,
): Promise<Review> {
  return atNativeEndpoint(urls, (c, endpoint) =>
    reviewActionAt(c, endpoint, account, action),
  );
}
async function reviewActionAt(
  c: Client,
  endpoint: string,
  account: string,
  action: Action,
): Promise<Review> {
  const p = await readPositionAt(c, account),
    blockNumber = p.block;
  let amount = 0n;
  if (action.kind === "deposit") {
    amount = action.amount;
    if (p.emergency || p.locked) throw new Error("drawLocked");
    if (amount > p.balance) throw new Error("insufficientBalance");
    if (p.nextPool + amount > p.cap) throw new Error("noCapacity");
  } else if (action.kind === "withdraw") {
    if (p.emergency || p.locked) throw new Error("drawLocked");
    if (action.shares > p.shares) throw new Error("invalidAmount");
    amount = p.shares === 0n ? 0n : (p.active * action.shares) / p.shares;
  } else if (action.kind === "finalize") amount = p.claimable;
  else if (action.kind === "referral") amount = p.referral;
  else if (action.kind === "cancelSubscription") amount = p.subscription ?? 0n;
  else if (action.kind === "cancelBatch") amount = p.batch ?? 0n;
  else if (action.kind === "emergencyExit") {
    if (!p.emergency) throw new Error("unavailable");
    amount = p.active + p.pending + p.exiting + p.claimable;
  } else if (action.kind === "revoke") {
    if (!p.allowance) throw new Error("nothingAvailable");
  } else if (action.kind === "claim" || action.kind === "refund") {
    ticketIds(action.ids.join(","));
    await linked(c, blockNumber, TICKET_NFT);
    const pool = await c.readContract({
      address: LP_MANAGER,
      abi: lpAbi,
      functionName: "getLPDrawingState",
      args: [p.draw],
      blockNumber,
    });
    const tiers =
      action.kind === "claim"
        ? await c.readContract({
            address: JACKPOT,
            abi: jackpotAbi,
            functionName: "getTicketTierIds",
            args: [action.ids],
            blockNumber,
          })
        : [];
    for (let i = 0; i < action.ids.length; i++) {
      const id = action.ids[i];
      const [owner, info] = await Promise.all([
        c.readContract({
          address: TICKET_NFT,
          abi: nftAbi,
          functionName: "ownerOf",
          args: [id],
          blockNumber,
        }),
        c.readContract({
          address: TICKET_NFT,
          abi: nftAbi,
          functionName: "getTicketInfo",
          args: [id],
          blockNumber,
        }),
      ]);
      if (owner.toLowerCase() !== p.account.toLowerCase())
        throw new Error("notOwner");
      const d = await c.readContract({
        address: JACKPOT,
        abi: jackpotAbi,
        functionName: "getDrawingState",
        args: [info.drawingId],
        blockNumber,
      });
      if (action.kind === "refund") {
        if (!p.emergency || info.drawingId !== p.draw)
          throw new Error("unavailable");
        amount +=
          BigInt(info.referralScheme) === 0n
            ? d.ticketPrice
            : (d.ticketPrice * (10n ** 18n - d.referralFee)) / 10n ** 18n;
      } else {
        if (info.drawingId >= p.draw || d.winningTicket === 0n)
          throw new Error("notSettled");
        const tier = tiers[i];
        if (tier === undefined || tier > 11n) throw new Error("notWinner");
        // Match the calculator and getter used by claimWinnings at this same block.
        const gross = await c.readContract({
          address: d.payoutCalculator,
          abi: payoutAbi,
          functionName: "getTierPayout",
          args: [info.drawingId, tier],
          blockNumber,
        });
        if (gross === 0n) throw new Error("notWinner");
        const noScheme = BigInt(info.referralScheme) === 0n;
        const fee =
          noScheme && (p.emergency || pool.lpPoolTotal === 0n)
            ? 0n
            : (gross * d.referralWinShare) / 10n ** 18n;
        amount += gross - fee;
      }
    }
  }
  if (action.kind !== "revoke" && amount <= 0n)
    throw new Error("nothingAvailable");
  const calls = actionCalls(action, p.allowance);
  // Simulate what can execute now. Deposit is simulated again after its approval confirms.
  await c.call({
    account: p.account,
    to: calls[0].to,
    data: calls[0].data,
    value: 0n,
    blockNumber,
  });
  if ((await c.getBlock({ blockNumber })).hash !== p.blockHash)
    throw new Error("staleChain");
  return {
    endpoint,
    action,
    account: p.account,
    block: blockNumber,
    createdAt: Date.now(),
    amount,
    position: p,
    calls,
  };
}

export type NativeHistory = {
  block: bigint;
  blockHash: Hex;
  rows: {
    draw: bigint;
    scheduledAt: number;
    accumulator: bigint;
    previousAccumulator: bigint;
    poolCapital: bigint;
    netReturnPpm: bigint | null;
    lpEarnings: bigint;
    prizePool: bigint;
  }[];
};
/** Net accumulator change includes native draw losses; ticket revenue is never substituted for LP return. */
export async function readNativeHistory(
  urls: string[],
): Promise<NativeHistory> {
  return atNativeEndpoint(urls, async (c) => {
    const b = await fresh(c),
      blockNumber = b.number;
    await Promise.all([
      pinned(c, blockNumber, JACKPOT),
      linked(c, blockNumber, LP_MANAGER),
    ]);
    const current = await c.readContract({
      address: JACKPOT,
      abi: jackpotAbi,
      functionName: "currentDrawingId",
      blockNumber,
    });
    const accumulatorAbi = parseAbi([
      "function drawingAccumulator(uint256) view returns (uint256)",
    ]);
    const ids = Array.from(
      { length: Math.min(60, Number(current > 1n ? current - 1n : 0n)) },
      (_, i) => current - 1n - BigInt(i),
    );
    const rows: NativeHistory["rows"] = [];
    // Bounded concurrency avoids flooding user-supplied RPC providers.
    for (let offset = 0; offset < ids.length; offset += 8) {
      const batch = await Promise.all(
        ids.slice(offset, offset + 8).map(async (draw) => {
          const [state, accumulator, previousAccumulator, pool] =
            await Promise.all([
              c.readContract({
                address: JACKPOT,
                abi: jackpotAbi,
                functionName: "getDrawingState",
                args: [draw],
                blockNumber,
              }),
              c.readContract({
                address: LP_MANAGER,
                abi: accumulatorAbi,
                functionName: "drawingAccumulator",
                args: [draw],
                blockNumber,
              }),
              c.readContract({
                address: LP_MANAGER,
                abi: accumulatorAbi,
                functionName: "drawingAccumulator",
                args: [draw - 1n],
                blockNumber,
              }),
              c.readContract({
                address: LP_MANAGER,
                abi: lpAbi,
                functionName: "getLPDrawingState",
                args: [draw],
                blockNumber,
              }),
            ]);
          if (
            state.winningTicket === 0n ||
            state.drawingTime > 8_640_000_000_000n
          )
            throw new Error("invalidHistory");
          return {
            draw,
            scheduledAt: Number(state.drawingTime),
            accumulator,
            previousAccumulator,
            poolCapital: pool.lpPoolTotal,
            netReturnPpm:
              pool.lpPoolTotal === 0n
                ? null
                : nativeReturnPpm(previousAccumulator, accumulator),
            lpEarnings: state.lpEarnings,
            prizePool: state.prizePool,
          };
        }),
      );
      rows.push(...batch);
    }
    if ((await c.getBlock({ blockNumber })).hash !== b.hash)
      throw new Error("staleChain");
    return { block: blockNumber, blockHash: b.hash!, rows };
  });
}
