import {
  createPublicClient,
  parseAbi,
  encodeFunctionData,
  keccak256,
  getAddress,
  isAddress,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { rpcHttp } from "./rpcTransport.ts";
import { JACKPOT, TICKET_NFT } from "./config.ts";
import { parseRpcUrls } from "./model.ts";
import { nativeReturnPpm } from "./historyMath.ts";
import { validNumbers } from "./plans.ts";
import { resolveReferrer } from "./referral.ts";
export { CLUB_REFERRER } from "./referral.ts";

export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const LP_MANAGER = "0xE63E54DF82d894396B885CE498F828f2454d9dCf" as const;
export const SUBSCRIPTION =
  "0x2694Bd48f3e6B4775943067DC842C93bf5F19DcD" as const;
export const BATCH = "0xBA343479D98a1Ed333899999D95a7343B808a76F" as const;
/** Protocol telemetry tag naming this application as the purchase source. */
export const PURCHASE_SOURCE = stringToHex("megapotclub.eth.limo", {
  size: 32,
});
const REFERRAL_UNIT = 10n ** 18n;
export const MAX_PURCHASE_TICKETS = 100;
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
  "error ContractAlreadyInitialized()",
  "error ContractNotInitialized()",
  "error DepositAmountZero()",
  "error DrawingNotDue()",
  "error EmergencyEnabled()",
  "error EmergencyModeAlreadyEnabled()",
  "error EmergencyModeNotEngaged()",
  "error InsufficientEntropyFee()",
  "error InvalidBonusball()",
  "error InvalidBonusballHardCap()",
  "error InvalidBonusballMin()",
  "error InvalidBonusballSoftCap()",
  "error InvalidDrawingDuration()",
  "error InvalidDrawingId()",
  "error InvalidGovernancePoolCap()",
  "error InvalidLpEdgeTarget()",
  "error InvalidMaxReferrers()",
  "error InvalidNormalBallMax()",
  "error InvalidNormalsCount()",
  "error InvalidProtocolFee()",
  "error InvalidRecipient()",
  "error InvalidReferralFee()",
  "error InvalidReferralSplitBps()",
  "error InvalidReferralWinShare()",
  "error InvalidReserveRatio()",
  "error InvalidTicketCount()",
  "error InvalidTicketPrice()",
  "error JackpotAlreadyInitialized()",
  "error JackpotLocked()",
  "error JackpotNotInitialized()",
  "error JackpotNotLocked()",
  "error LPDepositsAlreadyInitialized()",
  "error LPDepositsNotInitialized()",
  "error NoLPDeposits()",
  "error NoPrizePool()",
  "error NoReferralFeesToClaim()",
  "error NoTicketsProvided()",
  "error NoTicketsToClaim()",
  "error NotTicketOwner()",
  "error OwnableInvalidOwner(address owner)",
  "error OwnableUnauthorizedAccount(address account)",
  "error ReentrancyGuardReentrantCall()",
  "error ReferralSplitLengthMismatch()",
  "error ReferralSplitSumInvalid()",
  "error SafeERC20FailedOperation(address token)",
  "error TicketFromFutureDrawing()",
  "error TicketNotEligibleForRefund()",
  "error TicketPurchasesAlreadyDisabled()",
  "error TicketPurchasesAlreadyEnabled()",
  "error TicketPurchasesDisabled()",
  "error TooManyReferrers()",
  "error Uint8OutOfBounds()",
  "error UnauthorizedEntropyCaller()",
  "error WithdrawAmountZero()",
  "error ZeroAddress()",
  "event TicketOrderProcessed(address indexed buyer, address indexed recipient, uint256 indexed currentDrawingId, uint256 numberOfTickets, uint256 lpEarnings, uint256 referralFees)",
  "event TicketPurchased(address indexed recipient, uint256 indexed currentDrawingId, bytes32 indexed source, uint256 userTicketId, uint8[] normals, uint8 bonusball, bytes32 referralScheme)",
  "event TicketWinningsClaimed(address indexed userAddress, uint256 indexed drawingId, uint256 userTicketId, uint256 matchedNormals, bool bonusballMatch, uint256 winningsAmount)",
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256) view returns ((uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket, uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought, uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket, uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock))",
  "function getDrawingTierPayouts(uint256) view returns (uint256[12])",
  "function getTicketTierIds(uint256[]) view returns (uint256[])",
  "function emergencyMode() view returns (bool)",
  "function allowTicketPurchases() view returns (bool)",
  "function referralFees(address) view returns (uint256)",
  "function usdc() view returns (address)",
  "function jackpotLPManager() view returns (address)",
  "function jackpotNFT() view returns (address)",
  "function buyTickets((uint8[] normals, uint8 bonusball)[], address, address[], uint256[], bytes32) returns (uint256[])",
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
export const tokenAbi = parseAbi([
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
  "function getExpectedDrawingTierPayouts(uint256,uint256,uint8,uint8) view returns (uint256[12])",
]);
const subscriptionAbi = parseAbi([
  "function subscriptions(address) view returns (uint64 remainingUSDC, uint64 lastExecutedDrawing, uint64 subscribedTicketPrice, uint64 dynamicTicketCount, bytes32 source)",
  "function cancelSubscription()",
]);
const batchAbi = parseAbi([
  "function batchOrders(address) view returns (uint256 orderDrawingId, uint64 remainingUSDC, uint64 remainingTickets, uint64 totalTicketsOrdered, uint64 dynamicTicketCount, bytes32 source)",
  "function cancelBatchOrder()",
]);

export type TicketSelection = { numbers: number[]; bonus: number };
export type Action =
  | { kind: "deposit"; amount: bigint }
  | { kind: "withdraw"; shares: bigint }
  | {
      kind: "purchase";
      tickets: TicketSelection[];
      recipient: Address;
      drawId: bigint;
      unitPrice: bigint;
      referrer: Address;
      orderId?: string;
      draftKey?: string;
    }
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
  ticketPrice: bigint;
  prizePool: bigint;
  ballMax: number;
  bonusMax: number;
  drawingTime: bigint;
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
  position: Position | RetailPosition;
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
/** @cc [label:correctness] bounded-ticket-order
 * A purchase order MUST contain 1–100 tickets, each with five distinct main numbers and one bonus
 * number inside the supplied ranges. The exact order is encoded; no ticket is added, dropped or reordered.
 */
export function purchaseTickets(
  tickets: TicketSelection[],
  ballMax = 255,
  bonusMax = 255,
): TicketSelection[] {
  if (
    !Array.isArray(tickets) ||
    tickets.length < 1 ||
    tickets.length > MAX_PURCHASE_TICKETS ||
    !tickets.every(
      (t) =>
        t &&
        Array.isArray(t.numbers) &&
        validNumbers(t.numbers, t.bonus, ballMax, bonusMax),
    )
  )
    throw new Error("invalidSelection");
  return tickets.map((t) => ({
    numbers: [...t.numbers].sort((a, b) => a - b),
    bonus: t.bonus,
  }));
}
export const nativeClient = (urls: string[], signal?: AbortSignal) =>
  createPublicClient({
    chain: base,
    ccipRead: false,
    batch: { multicall: { wait: 15, batchSize: 16_384 } },
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
  signal?: AbortSignal,
): Promise<T> {
  let last: unknown = new Error("rpcUnavailable");
  for (const endpoint of parseRpcUrls(urls)) {
    if (signal?.aborted) throw new Error("reviewCancelled");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 45_000);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const client = nativeClient([endpoint], controller.signal);
      if ((await client.getChainId()) !== 8453) throw new Error("wrongChain");
      return await read(client, endpoint);
    } catch (error) {
      last = error;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal?.removeEventListener("abort", cancel);
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
const deploymentChecks = new Map<string, number>();
async function pinned(c: Client, block: bigint, address: Address) {
  const expected = REGISTRY.find(
    (r) => r.address.toLowerCase() === address.toLowerCase(),
  );
  const key = `${c.transport.url}:${address}:${expected?.hash}`;
  if ((deploymentChecks.get(key) ?? 0) > Date.now()) return;
  const code = await c.getCode({ address, blockNumber: block });
  if (!expected || !code || keccak256(code) !== expected.hash)
    throw new Error("contractChanged");
  // These pinned contracts are immutable, not upgradeable proxies. Cache only a positive
  // runtime match at this endpoint; transaction-sensitive state is always read afresh.
  deploymentChecks.set(key, Date.now() + 10 * 60_000);
}
async function fresh(c: Client) {
  const block = await c.getBlock();
  const age = Date.now() / 1000 - Number(block.timestamp);
  if (age < -30 || age > 120 || block.number === null || !block.hash)
    throw new Error("staleChain");
  return block;
}

export type RetailPosition = Pick<
  Position,
  | "account"
  | "block"
  | "blockHash"
  | "timestamp"
  | "draw"
  | "locked"
  | "emergency"
  | "ticketPrice"
  | "prizePool"
  | "ballMax"
  | "bonusMax"
  | "drawingTime"
  | "balance"
  | "ether"
  | "allowance"
  | "referral"
> & { allowTicketPurchases: boolean; contractWallet: boolean };

/** Retail reviews read no LP shares, withdrawal balances or automation-helper state. */
async function readRetailPositionAt(
  c: Client,
  input: string,
): Promise<RetailPosition> {
  if (!isAddress(input)) throw new Error("invalidAddress");
  const account = getAddress(input),
    b = await fresh(c),
    blockNumber = b.number;
  const j = { address: JACKPOT, abi: jackpotAbi, blockNumber } as const;
  const [
    draw,
    emergency,
    allowTicketPurchases,
    token,
    nft,
    manager,
    balance,
    allowance,
    ether,
    referral,
    code,
  ] = await Promise.all([
    c.readContract({ ...j, functionName: "currentDrawingId" }),
    c.readContract({ ...j, functionName: "emergencyMode" }),
    c.readContract({ ...j, functionName: "allowTicketPurchases" }),
    c.readContract({ ...j, functionName: "usdc" }),
    c.readContract({ ...j, functionName: "jackpotNFT" }),
    c.readContract({ ...j, functionName: "jackpotLPManager" }),
    c.readContract({
      address: USDC,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    c.readContract({
      address: USDC,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account, JACKPOT],
      blockNumber,
    }),
    c.getBalance({ address: account, blockNumber }),
    c.readContract({ ...j, functionName: "referralFees", args: [account] }),
    c.getCode({ address: account, blockNumber }),
    pinned(c, blockNumber, JACKPOT),
  ]);
  if (
    token.toLowerCase() !== USDC.toLowerCase() ||
    nft.toLowerCase() !== TICKET_NFT.toLowerCase() ||
    manager.toLowerCase() !== LP_MANAGER.toLowerCase()
  )
    throw new Error("contractChanged");
  const state = await c.readContract({
    ...j,
    functionName: "getDrawingState",
    args: [draw],
  });
  return {
    account,
    block: blockNumber,
    blockHash: b.hash!,
    timestamp: b.timestamp,
    draw,
    emergency,
    allowTicketPurchases,
    locked: state.jackpotLock,
    ticketPrice: state.ticketPrice,
    prizePool: state.prizePool,
    ballMax: state.ballMax,
    bonusMax: state.bonusballMax,
    drawingTime: state.drawingTime,
    balance,
    allowance,
    ether,
    referral,
    contractWallet: Boolean(
      code && code !== "0x" && !/^0xef0100[0-9a-fA-F]{40}$/.test(code),
    ),
  };
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
    ticketPrice: state.ticketPrice,
    prizePool: state.prizePool,
    ballMax: state.ballMax,
    bonusMax: state.bonusballMax,
    drawingTime: state.drawingTime,
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
 * Deposit and purchase approvals MUST name Jackpot and the exact requested amount. A purchase MUST call
 * Jackpot.buyTickets with the selected tickets, connected recipient and immutable resolved referrer.
 */
export function actionCalls(action: Action, allowance = 0n): Call[] {
  if (action.kind === "purchase") {
    const tickets = purchaseTickets(action.tickets);
    if (
      !isAddress(action.recipient) ||
      action.unitPrice <= 0n ||
      action.unitPrice >= 2n ** 256n
    )
      throw new Error("invalidSelection");
    const total = action.unitPrice * BigInt(tickets.length);
    if (total >= 2n ** 256n) throw new Error("invalidAmount");
    const approve: Call = {
      to: USDC,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [JACKPOT, total],
      }),
      value: 0n,
      kind: "approve",
    };
    const buy: Call = {
      to: JACKPOT,
      data: encodeFunctionData({
        abi: jackpotAbi,
        functionName: "buyTickets",
        args: [
          tickets.map((t) => ({ normals: t.numbers, bonusball: t.bonus })),
          getAddress(action.recipient),
          [resolveReferrer(action.referrer)],
          [REFERRAL_UNIT],
          PURCHASE_SOURCE,
        ],
      }),
      value: 0n,
      kind: action.kind,
    };
    return allowance >= total ? [buy] : [approve, buy];
  }
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
  signal?: AbortSignal,
): Promise<Review> {
  return atNativeEndpoint(
    urls,
    (c, endpoint) => reviewActionAt(c, endpoint, account, action),
    signal,
  );
}
async function reviewActionAt(
  c: Client,
  endpoint: string,
  account: string,
  action: Action,
): Promise<Review> {
  const retail = ["purchase", "claim", "refund", "referral"].includes(
    action.kind,
  );
  const full = retail ? undefined : await readPositionAt(c, account);
  const p = full ?? (await readRetailPositionAt(c, account)),
    blockNumber = p.block;
  let amount = 0n;
  if (action.kind === "purchase") {
    if (action.recipient.toLowerCase() !== p.account.toLowerCase())
      throw new Error("walletChanged");
    const tickets = purchaseTickets(action.tickets, p.ballMax, p.bonusMax);
    if (
      p.emergency ||
      p.locked ||
      p.prizePool === 0n ||
      !("allowTicketPurchases" in p && p.allowTicketPurchases)
    )
      throw new Error("drawLocked");
    action = { ...action, tickets, unitPrice: p.ticketPrice, drawId: p.draw };
    amount = p.ticketPrice * BigInt(tickets.length);
    if (amount > p.balance) throw new Error("insufficientBalance");
  } else if (action.kind === "deposit") {
    amount = action.amount;
    if (p.emergency || p.locked) throw new Error("drawLocked");
    if (amount > p.balance) throw new Error("insufficientBalance");
    if (full!.nextPool + amount > full!.cap) throw new Error("noCapacity");
  } else if (action.kind === "withdraw") {
    if (p.emergency || p.locked) throw new Error("drawLocked");
    if (action.shares > full!.shares) throw new Error("invalidAmount");
    amount =
      full!.shares === 0n ? 0n : (full!.active * action.shares) / full!.shares;
  } else if (action.kind === "finalize") amount = full!.claimable;
  else if (action.kind === "referral") amount = p.referral;
  else if (action.kind === "cancelSubscription")
    amount = full!.subscription ?? 0n;
  else if (action.kind === "cancelBatch") amount = full!.batch ?? 0n;
  else if (action.kind === "emergencyExit") {
    if (!p.emergency) throw new Error("unavailable");
    amount = full!.active + full!.pending + full!.exiting + full!.claimable;
  } else if (action.kind === "revoke") {
    if (!p.allowance) throw new Error("nothingAvailable");
  } else if (action.kind === "claim" || action.kind === "refund") {
    ticketIds(action.ids.join(","));
    await Promise.all([
      linked(c, blockNumber, TICKET_NFT),
      linked(c, blockNumber, LP_MANAGER),
    ]);
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
    const infos = await Promise.all(
      action.ids.map(async (id) => {
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
        return info;
      }),
    );
    const drawIds = [...new Set(infos.map((info) => info.drawingId))];
    const states = new Map(
      await Promise.all(
        drawIds.map(
          async (id) =>
            [
              id,
              await c.readContract({
                address: JACKPOT,
                abi: jackpotAbi,
                functionName: "getDrawingState",
                args: [id],
                blockNumber,
              }),
            ] as const,
        ),
      ),
    );
    const payouts = new Map<string, Promise<bigint>>();
    const amounts = await Promise.all(
      infos.map(async (info, i) => {
        const d = states.get(info.drawingId)!;
        if (action.kind === "refund") {
          if (!p.emergency || info.drawingId !== p.draw)
            throw new Error("unavailable");
          return BigInt(info.referralScheme) === 0n
            ? d.ticketPrice
            : (d.ticketPrice * (10n ** 18n - d.referralFee)) / 10n ** 18n;
        }
        if (info.drawingId >= p.draw || d.winningTicket === 0n)
          throw new Error("notSettled");
        const tier = tiers[i];
        if (tier === undefined || tier > 11n) throw new Error("notWinner");
        const key = `${info.drawingId}:${tier}`;
        if (!payouts.has(key))
          payouts.set(
            key,
            c.readContract({
              address: d.payoutCalculator,
              abi: payoutAbi,
              functionName: "getTierPayout",
              args: [info.drawingId, tier],
              blockNumber,
            }),
          );
        const gross = await payouts.get(key)!;
        if (gross === 0n) throw new Error("notWinner");
        const fee =
          BigInt(info.referralScheme) === 0n &&
          (p.emergency || pool.lpPoolTotal === 0n)
            ? 0n
            : (gross * d.referralWinShare) / 10n ** 18n;
        return gross - fee;
      }),
    );
    amount = amounts.reduce((sum, value) => sum + value, 0n);
  }
  if (action.kind !== "revoke" && amount <= 0n)
    throw new Error("nothingAvailable");
  const calls = actionCalls(action, p.allowance);
  // Simulate what can execute now. Deposit and purchase are simulated again after their approval confirms.
  await simulateAction(c, p.account, action, calls[0], blockNumber);
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

async function simulateAction(
  c: Client,
  account: Address,
  action: Action,
  call: Call,
  blockNumber: bigint,
) {
  const context = { account, blockNumber } as const;
  if (call.kind === "approve" || action.kind === "revoke") {
    const amount =
      action.kind === "purchase"
        ? action.unitPrice * BigInt(action.tickets.length)
        : action.kind === "deposit"
          ? action.amount
          : 0n;
    return c.simulateContract({
      ...context,
      address: USDC,
      abi: tokenAbi,
      functionName: "approve",
      args: [JACKPOT, amount],
    });
  }
  const j = { ...context, address: JACKPOT, abi: jackpotAbi } as const;
  switch (action.kind) {
    case "purchase":
      return c.simulateContract({
        ...j,
        functionName: "buyTickets",
        args: [
          purchaseTickets(action.tickets).map((t) => ({
            normals: t.numbers,
            bonusball: t.bonus,
          })),
          action.recipient,
          [resolveReferrer(action.referrer)],
          [REFERRAL_UNIT],
          PURCHASE_SOURCE,
        ],
      });
    case "claim":
      return c.simulateContract({
        ...j,
        functionName: "claimWinnings",
        args: [action.ids],
      });
    case "refund":
      return c.simulateContract({
        ...j,
        functionName: "emergencyRefundTickets",
        args: [action.ids],
      });
    case "deposit":
      return c.simulateContract({
        ...j,
        functionName: "lpDeposit",
        args: [action.amount],
      });
    case "withdraw":
      return c.simulateContract({
        ...j,
        functionName: "initiateWithdraw",
        args: [action.shares],
      });
    case "referral":
      return c.simulateContract({ ...j, functionName: "claimReferralFees" });
    case "finalize":
      return c.simulateContract({ ...j, functionName: "finalizeWithdraw" });
    case "emergencyExit":
      return c.simulateContract({ ...j, functionName: "emergencyWithdrawLP" });
    case "cancelSubscription":
      return c.simulateContract({
        ...context,
        address: SUBSCRIPTION,
        abi: subscriptionAbi,
        functionName: "cancelSubscription",
      });
    case "cancelBatch":
      return c.simulateContract({
        ...context,
        address: BATCH,
        abi: batchAbi,
        functionName: "cancelBatchOrder",
      });
  }
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

/**
 * @cc [label:data] jackpot-referral-example
 * The referral example MUST use the current drawing's expected jackpot-tier
 * gross payout and referral share at the same block, never the entire prize pool.
 * This public observation cannot authorize signing.
 */
export function readReferralTerms(urls: string[], signal?: AbortSignal) {
  return atNativeEndpoint(
    urls,
    async (c) => {
      const blockNumber = await c.getBlockNumber();
      const draw = await c.readContract({
        address: JACKPOT,
        abi: jackpotAbi,
        functionName: "currentDrawingId",
        blockNumber,
      });
      const state = await c.readContract({
        address: JACKPOT,
        abi: jackpotAbi,
        functionName: "getDrawingState",
        args: [draw],
        blockNumber,
      });
      // Current draws have no stored settlement payout yet. Ask the deployed
      // calculator for its expected tiers using this drawing's actual inputs.
      const payouts = await c.readContract({
        address: state.payoutCalculator,
        abi: payoutAbi,
        functionName: "getExpectedDrawingTierPayouts",
        args: [draw, state.prizePool, state.ballMax, state.bonusballMax],
        blockNumber,
      });
      const jackpotGross = payouts[11];
      return {
        draw,
        jackpotGross,
        jackpotReferralReward:
          (jackpotGross * state.referralWinShare) / 10n ** 18n,
        purchaseFee: state.referralFee,
        winShare: state.referralWinShare,
      };
    },
    signal,
  );
}
