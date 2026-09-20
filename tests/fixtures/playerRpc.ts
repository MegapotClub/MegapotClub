/** Synthetic deterministic QA fixture. Never import into a production entry point. */
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { purchaseLogs } from "./receipts.ts";
import { jackpotAbi } from "../../src/native.ts";
export const fixtureAddress =
  "0x1111111111111111111111111111111111111111" as const;
export const alternateAddress =
  "0x2222222222222222222222222222222222222222" as const;
export const qaAddresses = {
  jackpot: "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2",
  nft: "0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  lp: "0xE63E54DF82d894396B885CE498F828f2454d9dCf",
  subscription: "0x2694Bd48f3e6B4775943067DC842C93bf5F19DcD",
  batch: "0xBA343479D98a1Ed333899999D95a7343B808a76F",
  payout: "0x0000000000000000000000000000000000000001",
  multicall: "0xca11bde05977b3631167028862be2a173976ca11",
} as const satisfies Record<string, Address>;
export const qaCode = "0x6000" as const;
export const qaCodeHash = keccak256(qaCode);
const zero32 = `0x${"00".repeat(32)}` as Hex;
const blockHash = `0x${"11".repeat(32)}` as Hex;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const WAD = 10n ** 18n;

// Unique signatures merged across chain.ts, playerReads.ts and native.ts.
export const qaPlayerAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
  "function getEthBalance(address) view returns (uint256)",
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256) view returns ((uint256 prizePool,uint256 ticketPrice,uint256 edgePerTicket,uint256 referralWinShare,uint256 referralFee,uint256 globalTicketsBought,uint256 lpEarnings,uint256 drawingTime,uint256 winningTicket,uint8 ballMax,uint8 bonusballMax,address payoutCalculator,bool jackpotLock))",
  "function getUnpackedTicket(uint256,uint256) view returns (uint8[] normals,uint8 bonusball)",
  "function getUserTickets(address,uint256) view returns ((uint256 ticketId,(uint256 drawingId,uint256 packedTicket,bytes32 referralScheme) ticket,uint8[] normals,uint8 bonusball)[])",
  "function getTicketInfo(uint256) view returns ((uint256 drawingId,uint256 packedTicket,bytes32 referralScheme))",
  "function getTicketTierIds(uint256[]) view returns (uint256[])",
  "function getDrawingTierPayouts(uint256) view returns (uint256[12])",
  "function getTierPayout(uint256,uint256) view returns (uint256)",
  "function getExpectedDrawingTierPayouts(uint256,uint256,uint8,uint8) view returns (uint256[12])",
  "function ownerOf(uint256) view returns (address)",
  "function allowTicketPurchases() view returns (bool)",
  "function emergencyMode() view returns (bool)",
  "function referralFees(address) view returns (uint256)",
  "function usdc() view returns (address)",
  "function jackpot() view returns (address)",
  "function jackpotLPManager() view returns (address)",
  "function jackpotNFT() view returns (address)",
  "function batchFacilitator() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function getLPShares(address) view returns (uint256)",
  "function getLPValueBreakdown(address) view returns ((uint256 activeDeposits,uint256 pendingDeposits,uint256 pendingWithdrawals,uint256 claimableWithdrawals))",
  "function getLpInfo(address) view returns ((uint256 consolidatedShares,(uint256 amount,uint256 drawingId) lastDeposit,(uint256 amountInShares,uint256 drawingId) pendingWithdrawal,uint256 claimableWithdrawals))",
  "function lpPoolCap() view returns (uint256)",
  "function getEstimatedNextDrawingLpPool() view returns (uint256)",
  "function getLPDrawingState(uint256) view returns ((uint256 lpPoolTotal,uint256 pendingDeposits,uint256 pendingWithdrawals))",
  "function subscriptions(address) view returns (uint64 remainingUSDC,uint64 lastExecutedDrawing,uint64 subscribedTicketPrice,uint64 dynamicTicketCount,bytes32 source)",
  "function batchOrders(address) view returns (uint256 orderDrawingId,uint64 remainingUSDC,uint64 remainingTickets,uint64 totalTicketsOrdered,uint64 dynamicTicketCount,bytes32 source)",
  "function claimWinnings(uint256[])",
  "function buyTickets((uint8[] normals,uint8 bonusball)[],address,address[],uint256[],bytes32) returns (uint256[])",
  "function claimReferralFees()",
  "function approve(address,uint256) returns (bool)",
  "function lpDeposit(uint256)",
  "function initiateWithdraw(uint256)",
  "function finalizeWithdraw()",
  "function cancelSubscription()",
  "function cancelBatchOrder()",
  "function emergencyWithdrawLP()",
  "function emergencyRefundTickets(uint256[])",
]);

export type RpcRequest = {
  jsonrpc?: string;
  id: number | string | null;
  method: string;
  params?: unknown[];
};
export type RpcResponse = {
  jsonrpc: "2.0";
  id: RpcRequest["id"];
  result?: unknown;
  error?: { code: number; message: string };
};
export type FixtureOptions = {
  account?: Address;
  timestamp?: number;
  blockNumber?: bigint;
  rankedTickets?: boolean;
  usdcBalance?: bigint;
  usdcAllowance?: bigint;
  currentDraw?: bigint;
  allowPurchases?: boolean;
  prizePool?: bigint;
  locked?: boolean;
  emergency?: boolean;
};
export const clubReferrer =
  "0xd560dFDC6838b9f11C77177f940592A2ba230155" as const;
export function createPlayerRpcFixture(options: FixtureOptions = {}) {
  const account = options.account ?? fixtureAddress;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  let blockNumber = options.blockNumber ?? 70_000_000n;
  const currentDraw = options.currentDraw ?? 175n;
  let balance = options.usdcBalance ?? 25_000_000n,
    allowance = options.usdcAllowance ?? 0n,
    referralFees = 3_000_000n;
  const claimed = new Set<bigint>();
  const purchased = new Map<
    bigint,
    {
      drawingId: bigint;
      packedTicket: bigint;
      referralScheme: Hex;
      normals: number[];
      bonusball: number;
    }
  >();
  const transactions = new Map<
    string,
    { tx: Record<string, unknown>; receipt: Record<string, unknown> }
  >();
  const counters = {
    requests: 0,
    multicalls: 0,
    deniedWrites: 0,
    methods: {} as Record<string, number>,
    functions: {} as Record<string, number>,
  };
  const hex = (n: bigint | number) => `0x${n.toString(16)}`;
  const owns = (address: unknown) =>
    String(address).toLowerCase() === account.toLowerCase();
  const ticketInfo = (id: bigint) => {
    if (claimed.has(id)) throw new Error("Fixture ticket burned after claim");
    const bought = purchased.get(id);
    if (bought)
      return {
        drawingId: bought.drawingId,
        packedTicket: bought.packedTicket,
        referralScheme: bought.referralScheme,
      };
    if (id % 1000n !== 1n && id % 1000n !== 2n)
      throw new Error("Unknown fixture ticket");
    const drawingId = id / 1000n;
    if (drawingId < currentDraw - 6n || drawingId > currentDraw)
      throw new Error("Unknown fixture draw");
    return { drawingId, packedTicket: id, referralScheme: zero32 };
  };
  const tiers = Array.from({ length: 12 }, (_, i) =>
    i === 0 || i === 2 ? 0n : i === 1 ? 2_000_000n : BigInt(i) * 1_000_000n,
  );
  function call(to: string | undefined, data: Hex, depth = 0): Hex {
    if (depth > 10) throw new Error("Fixture multicall nesting exceeded");
    if (
      !to ||
      !Object.values(qaAddresses).some(
        (a) => a.toLowerCase() === to.toLowerCase(),
      )
    )
      throw new Error("Unknown fixture contract");
    const decoded = decodeFunctionData({ abi: qaPlayerAbi, data });
    const name = decoded.functionName;
    const args = decoded.args as readonly unknown[] | undefined;
    counters.functions[name] = (counters.functions[name] ?? 0) + 1;
    let result: unknown;
    switch (name) {
      case "aggregate3": {
        if (to.toLowerCase() !== qaAddresses.multicall.toLowerCase())
          throw new Error("Wrong multicall target");
        counters.multicalls++;
        const calls = args![0] as readonly {
          target: Address;
          allowFailure: boolean;
          callData: Hex;
        }[];
        result = calls.map((item) => {
          try {
            return {
              success: true,
              returnData: call(item.target, item.callData, depth + 1),
            };
          } catch (e) {
            if (!item.allowFailure) throw e;
            return { success: false, returnData: "0x" };
          }
        });
        break;
      }
      case "currentDrawingId":
        result = currentDraw;
        break;
      case "getDrawingState": {
        const id = args![0] as bigint;
        if (id <= 0n || id > currentDraw)
          throw new Error("Unknown fixture draw");
        result = {
          prizePool: options.prizePool ?? 1_100_000_000_000n,
          ticketPrice: 1_000_000n,
          edgePerTicket: 175_000n,
          referralWinShare: WAD / 10n,
          referralFee: WAD / 10n,
          globalTicketsBought: 1000n,
          lpEarnings: 175_000_000n,
          drawingTime: BigInt(timestamp + 3600) - (currentDraw - id) * 86400n,
          winningTicket: id < currentDraw ? 1n : 0n,
          ballMax: 30,
          bonusballMax: 10,
          payoutCalculator: qaAddresses.payout,
          jackpotLock: id < currentDraw || Boolean(options.locked),
        };
        break;
      }
      case "getUnpackedTicket":
        result = [[3, 7, 14, 22, 29], 5];
        break;
      case "getUserTickets": {
        const id = args![1] as bigint;
        result =
          owns(args![0]) && id >= currentDraw - 6n && id <= currentDraw
            ? [1n, 2n]
                .filter((i) => !claimed.has(id * 1000n + i))
                .map((i) => ({
                  ticketId: id * 1000n + i,
                  ticket: ticketInfo(id * 1000n + i),
                  normals:
                    i === 1n
                      ? [1, 2, 4, 6, 8]
                      : options.rankedTickets
                        ? [3, 7, 14, 12, 13]
                        : [9, 10, 11, 12, 13],
                  bonusball: i === 1n ? 5 : 3,
                }))
                .concat(
                  [...purchased.entries()]
                    .filter(([, t]) => t.drawingId === id)
                    .map(([ticketId, t]) => ({
                      ticketId,
                      ticket: ticketInfo(ticketId),
                      normals: t.normals,
                      bonusball: t.bonusball,
                    })),
                )
            : [];
        break;
      }
      case "getTicketInfo":
        result = ticketInfo(args![0] as bigint);
        break;
      case "ownerOf":
        ticketInfo(args![0] as bigint);
        result = account;
        break;
      // Tier12 deliberately exercises the existing no-prize sentinel handling.
      case "getTicketTierIds":
        result = (args![0] as bigint[]).map((id) => {
          ticketInfo(id);
          return id % 1000n === 1n ? 1n : options.rankedTickets ? 6n : 12n;
        });
        break;
      case "getTierPayout":
        result = tiers[Number(args![1])] ?? 0n;
        break;
      case "getDrawingTierPayouts":
        result = tiers;
        break;
      case "getExpectedDrawingTierPayouts":
        result = tiers.map((amount, tier) =>
          tier === 11 ? 220_000_000_000n : amount,
        );
        break;
      case "allowTicketPurchases":
        result = options.allowPurchases ?? true;
        break;
      case "emergencyMode":
        result = options.emergency ?? false;
        break;
      case "referralFees":
        result = owns(args![0]) ? referralFees : 0n;
        break;
      case "balanceOf":
        result = owns(args![0]) ? balance : 0n;
        break;
      case "getEthBalance":
        result = owns(args![0]) ? 10n ** 16n : 0n;
        break;
      case "allowance":
        result =
          owns(args![0]) &&
          String(args![1]).toLowerCase() === qaAddresses.jackpot.toLowerCase()
            ? allowance
            : 0n;
        break;
      case "usdc":
        result = qaAddresses.usdc;
        break;
      case "jackpot":
        result = qaAddresses.jackpot;
        break;
      case "jackpotLPManager":
        result = qaAddresses.lp;
        break;
      case "jackpotNFT":
        result = qaAddresses.nft;
        break;
      case "batchFacilitator":
        result = qaAddresses.batch;
        break;
      case "getLPShares":
        result = 0n;
        break;
      case "getLPValueBreakdown":
        result = {
          activeDeposits: 0n,
          pendingDeposits: 0n,
          pendingWithdrawals: 0n,
          claimableWithdrawals: 0n,
        };
        break;
      case "getLpInfo":
        result = {
          consolidatedShares: 0n,
          lastDeposit: { amount: 0n, drawingId: 0n },
          pendingWithdrawal: { amountInShares: 0n, drawingId: 0n },
          claimableWithdrawals: 0n,
        };
        break;
      case "lpPoolCap":
        result = 2_000_000_000_000n;
        break;
      case "getEstimatedNextDrawingLpPool":
        result = 1_100_000_000_000n;
        break;
      case "getLPDrawingState":
        result = {
          lpPoolTotal: 1_100_000_000_000n,
          pendingDeposits: 0n,
          pendingWithdrawals: 0n,
        };
        break;
      case "subscriptions":
        result = [0n, 0n, 1_000_000n, 0n, zero32];
        break;
      case "batchOrders":
        result = [0n, 0n, 0n, 0n, 0n, zero32];
        break;
      case "approve":
        result = true;
        break;
      case "claimWinnings":
        for (const id of args![0] as bigint[]) {
          if (
            ticketInfo(id).drawingId >= currentDraw ||
            (id % 1000n !== 1n && !(options.rankedTickets && id % 1000n === 2n))
          )
            throw new Error("Fixture ticket not claimable");
        }
        return "0x";
      case "buyTickets": {
        // Mirrors the deployed validation: eth_call only, never a recorded purchase.
        const [tickets, recipient, referrers, splits] = args as unknown as [
          readonly { normals: readonly number[]; bonusball: number }[],
          string,
          readonly string[],
          readonly bigint[],
        ];
        if (to.toLowerCase() !== qaAddresses.jackpot.toLowerCase())
          throw new Error("Wrong purchase target");
        if (tickets.length < 1) throw new Error("InvalidTicketCount");
        if (!owns(recipient)) throw new Error("Fixture recipient mismatch");
        if (referrers.length !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(referrers[0]))
          throw new Error("Fixture referrer mismatch");
        if (splits.length !== 1 || splits[0] !== WAD)
          throw new Error("ReferralSplitSumInvalid");
        for (const t of tickets) {
          if (
            t.normals.length !== 5 ||
            new Set(t.normals).size !== 5 ||
            t.normals.some((n) => n < 1 || n > 30)
          )
            throw new Error("Invalid set selection");
          if (t.bonusball < 1 || t.bonusball > 10)
            throw new Error("InvalidBonusball");
        }
        const total = BigInt(tickets.length) * 1_000_000n;
        if (allowance < total)
          throw new Error("ERC20: transfer amount exceeds allowance");
        if (balance < total)
          throw new Error("ERC20: transfer amount exceeds balance");
        result = tickets.map((_, i) => currentDraw * 1000n + 100n + BigInt(i));
        break;
      }
      // These branches simulate eth_call only. No state mutation is ever accepted.
      case "claimReferralFees":
      case "lpDeposit":
      case "initiateWithdraw":
      case "finalizeWithdraw":
      case "cancelSubscription":
      case "cancelBatchOrder":
      case "emergencyWithdrawLP":
      case "emergencyRefundTickets":
        return "0x";
      default:
        throw new Error(`Unsupported fixture selector: ${name}`);
    }
    return encodeFunctionResult({
      abi: qaPlayerAbi,
      functionName: name,
      result,
    } as never);
  }
  function respond(request: RpcRequest): RpcResponse {
    counters.requests++;
    counters.methods[request.method] =
      (counters.methods[request.method] ?? 0) + 1;
    const params = request.params ?? [];
    try {
      let result: unknown;
      switch (request.method) {
        case "eth_chainId":
          result = "0x2105";
          break;
        case "net_version":
          result = "8453";
          break;
        case "eth_blockNumber":
          result = hex(blockNumber);
          break;
        case "eth_getCode":
          result =
            owns(params[0]) ||
            String(params[0]).toLowerCase() === alternateAddress
              ? "0x"
              : qaCode;
          break;
        case "eth_getBalance":
          result = owns(params[0]) ? hex(10n ** 16n) : "0x0";
          break;
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          result = "0xf4240";
          break;
        case "eth_getTransactionCount":
          result = owns(params[0]) ? hex(transactions.size) : "0x0";
          break;
        case "eth_getTransactionByHash":
          result = transactions.get(String(params[0]))?.tx ?? null;
          break;
        case "eth_getTransactionReceipt":
          result = transactions.get(String(params[0]))?.receipt ?? null;
          break;
        case "eth_getLogs": {
          const filter = params[0] as {
            address?: string;
            topics?: (string | null)[];
          };
          result = [...transactions.values()]
            .flatMap((t) => t.receipt.logs as Record<string, unknown>[])
            .filter(
              (l) =>
                (!filter.address ||
                  String(l.address).toLowerCase() ===
                    filter.address.toLowerCase()) &&
                (filter.topics ?? []).every(
                  (topic, i) =>
                    topic === null ||
                    String((l.topics as string[])[i]).toLowerCase() ===
                      topic.toLowerCase(),
                ),
            );
          break;
        }
        case "eth_getBlockByNumber":
          result = {
            number: hex(blockNumber),
            hash: blockHash,
            parentHash: zero32,
            timestamp: hex(timestamp),
            transactions: [],
            baseFeePerGas: "0xf4240",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            miner: zeroAddress,
            difficulty: "0x0",
            totalDifficulty: "0x0",
            size: "0x1",
            nonce: "0x0000000000000000",
            extraData: "0x",
            receiptsRoot: zero32,
            stateRoot: zero32,
            transactionsRoot: zero32,
            sha3Uncles: zero32,
            uncles: [],
            logsBloom: `0x${"00".repeat(256)}`,
          };
          break;
        case "eth_call":
        case "eth_estimateGas": {
          const tx = params[0] as { to?: string; data?: Hex; input?: Hex };
          const simulated = call(tx.to, tx.data ?? tx.input ?? "0x");
          result = request.method === "eth_estimateGas" ? "0x30d40" : simulated;
          break;
        }
        default:
          if (/send|sign|wallet_|personal_/i.test(request.method)) {
            counters.deniedWrites++;
            throw new Error(
              `Signing/submission forbidden in fixture: ${request.method}`,
            );
          }
          throw new Error(`Unexpected fixture RPC method: ${request.method}`);
      }
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Fixture failure",
        },
      };
    }
  }
  /** Emulates wallet/receipt outcomes entirely in memory. It never forwards a mutation. */
  function simulateSend(
    input: { from: Address; to: Address; data: Hex },
    outcome: "confirmed" | "reverted" | "ambiguous" | "rejected" = "rejected",
  ) {
    if (outcome === "rejected")
      throw Object.assign(new Error("Synthetic wallet rejection"), {
        code: 4001,
      });
    if (!owns(input.from)) throw new Error("Fixture account mismatch");
    const decoded = decodeFunctionData({ abi: qaPlayerAbi, data: input.data });
    const hash =
      `0x${(transactions.size + 1).toString(16).padStart(64, "0")}` as Hex;
    // The transaction lands after the reviewed block and has two confirmations.
    blockNumber += 3n;
    let logs: Record<string, unknown>[] = [];
    if (outcome !== "reverted") {
      if (decoded.functionName === "approve") {
        if (
          input.to.toLowerCase() !== qaAddresses.usdc.toLowerCase() ||
          decoded.args[0].toLowerCase() !== qaAddresses.jackpot.toLowerCase()
        )
          throw new Error("Fixture approval target mismatch");
        allowance = decoded.args[1];
      } else if (decoded.functionName === "buyTickets") {
        const buy = decodeFunctionData({ abi: jackpotAbi, data: input.data });
        if (buy.functionName !== "buyTickets")
          throw new Error("Fixture purchase mismatch");
        const action = {
          kind: "purchase" as const,
          recipient: buy.args[1],
          referrer: buy.args[2][0],
          tickets: buy.args[0].map((t) => ({
            numbers: [...t.normals],
            bonus: t.bonusball,
          })),
          unitPrice: 1_000_000n,
          drawId: currentDraw,
        };
        call(input.to, input.data);
        const total = BigInt(action.tickets.length) * action.unitPrice;
        balance -= total;
        allowance -= total;
        const firstTicketId =
          currentDraw * 1000n + 100n + BigInt(purchased.size);
        logs = purchaseLogs(action, currentDraw, firstTicketId).map((l) => ({
          ...l,
          blockNumber: hex(blockNumber - 2n),
          logIndex: hex(l.logIndex),
          transactionIndex: "0x0",
          transactionHash: hash,
        }));
        action.tickets.forEach((t, i) => {
          const id = firstTicketId + BigInt(i);
          purchased.set(id, {
            drawingId: currentDraw,
            packedTicket: id,
            referralScheme: zero32,
            normals: t.numbers,
            bonusball: t.bonus,
          });
        });
      } else if (decoded.functionName === "claimWinnings") {
        if (input.to.toLowerCase() !== qaAddresses.jackpot.toLowerCase())
          throw new Error("Fixture claim target mismatch");
        call(input.to, input.data);
        logs = decoded.args[0].map((id, index) => {
          const drawingId = ticketInfo(id).drawingId;
          const tier = id % 1000n === 1n ? 1 : 6;
          const payout = (tiers[tier] * 9n) / 10n;
          claimed.add(id);
          balance += payout;
          return {
            address: qaAddresses.jackpot,
            blockHash,
            blockNumber: hex(blockNumber - 2n),
            logIndex: hex(index),
            transactionIndex: "0x0",
            transactionHash: hash,
            removed: false,
            topics: encodeEventTopics({
              abi: jackpotAbi,
              eventName: "TicketWinningsClaimed",
              args: { userAddress: input.from, drawingId },
            }),
            data: encodeAbiParameters(
              [
                { type: "uint256" },
                { type: "uint256" },
                { type: "bool" },
                { type: "uint256" },
              ],
              [id, BigInt(Math.floor(tier / 2)), tier % 2 === 1, payout],
            ),
          };
        });
      } else if (decoded.functionName === "claimReferralFees") {
        if (input.to.toLowerCase() !== qaAddresses.jackpot.toLowerCase())
          throw new Error("Fixture referral target mismatch");
        balance += referralFees;
        referralFees = 0n;
      } else throw new Error("Unsupported synthetic wallet action");
    }
    const tx = {
      ...input,
      input: input.data,
      value: "0x0",
      hash,
      nonce: hex(transactions.size),
      blockHash,
      blockNumber: hex(blockNumber - 2n),
      transactionIndex: "0x0",
      gas: "0x30d40",
      gasPrice: "0xf4240",
      type: "0x0",
      v: "0x1",
      r: "0x1",
      s: "0x1",
      chainId: "0x2105",
    };
    const receipt = {
      from: input.from,
      to: input.to,
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash,
      blockNumber: hex(blockNumber - 2n),
      status: outcome === "reverted" ? "0x0" : "0x1",
      cumulativeGasUsed: "0x30d40",
      gasUsed: "0x30d40",
      effectiveGasPrice: "0xf4240",
      logs,
      logsBloom: `0x${"00".repeat(256)}`,
      contractAddress: null,
      type: "0x0",
    };
    transactions.set(hash, { tx, receipt });
    if (outcome === "ambiguous")
      throw new Error("Synthetic response lost after execution");
    return hash;
  }
  return {
    account,
    timestamp,
    get blockNumber() {
      return blockNumber;
    },
    currentDraw,
    counters,
    respond,
    simulateSend,
    respondBody: (body: RpcRequest | RpcRequest[]) =>
      Array.isArray(body) ? body.map(respond) : respond(body),
  };
}

/** Compatibility with the existing ticketRpc(request, timestamp) fixture style. */
export function playerRpc(
  request: RpcRequest,
  timestamp = Math.floor(Date.now() / 1000),
): RpcResponse {
  return createPlayerRpcFixture({ timestamp }).respond(request);
}
