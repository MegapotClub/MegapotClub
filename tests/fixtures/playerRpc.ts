/** Private deterministic QA fixture. Never import into a production entry point. */
import { decodeFunctionData, encodeFunctionResult, parseAbi, keccak256, type Address, type Hex } from 'viem';

export const fixtureAddress = '0x1111111111111111111111111111111111111111' as const;
export const alternateAddress = '0x2222222222222222222222222222222222222222' as const;
export const qaAddresses = {
  jackpot: '0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2',
  nft: '0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  lp: '0xE63E54DF82d894396B885CE498F828f2454d9dCf',
  subscription: '0x2694Bd48f3e6B4775943067DC842C93bf5F19DcD',
  batch: '0xBA343479D98a1Ed333899999D95a7343B808a76F',
  payout: '0x0000000000000000000000000000000000000001',
  multicall: '0xca11bde05977b3631167028862be2a173976ca11',
} as const satisfies Record<string, Address>;
export const qaCode = '0x6000' as const;
export const qaCodeHash = keccak256(qaCode);
const zero32 = `0x${'00'.repeat(32)}` as Hex;
const blockHash = `0x${'11'.repeat(32)}` as Hex;
const zeroAddress = '0x0000000000000000000000000000000000000000';
const WAD = 10n ** 18n;

// Unique signatures merged across chain.ts, playerReads.ts and native.ts.
export const qaPlayerAbi = parseAbi([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  'function currentDrawingId() view returns (uint256)',
  'function getDrawingState(uint256) view returns ((uint256 prizePool,uint256 ticketPrice,uint256 edgePerTicket,uint256 referralWinShare,uint256 referralFee,uint256 globalTicketsBought,uint256 lpEarnings,uint256 drawingTime,uint256 winningTicket,uint8 ballMax,uint8 bonusballMax,address payoutCalculator,bool jackpotLock))',
  'function getUnpackedTicket(uint256,uint256) view returns (uint8[] normals,uint8 bonusball)',
  'function getUserTickets(address,uint256) view returns ((uint256 ticketId,(uint256 drawingId,uint256 packedTicket,bytes32 referralScheme) ticket,uint8[] normals,uint8 bonusball)[])',
  'function getTicketInfo(uint256) view returns ((uint256 drawingId,uint256 packedTicket,bytes32 referralScheme))',
  'function getTicketTierIds(uint256[]) view returns (uint256[])',
  'function getDrawingTierPayouts(uint256) view returns (uint256[12])',
  'function getTierPayout(uint256,uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function emergencyMode() view returns (bool)',
  'function referralFees(address) view returns (uint256)',
  'function usdc() view returns (address)',
  'function jackpot() view returns (address)',
  'function jackpotLPManager() view returns (address)',
  'function jackpotNFT() view returns (address)',
  'function batchFacilitator() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function getLPShares(address) view returns (uint256)',
  'function getLPValueBreakdown(address) view returns ((uint256 activeDeposits,uint256 pendingDeposits,uint256 pendingWithdrawals,uint256 claimableWithdrawals))',
  'function getLpInfo(address) view returns ((uint256 consolidatedShares,(uint256 amount,uint256 drawingId) lastDeposit,(uint256 amountInShares,uint256 drawingId) pendingWithdrawal,uint256 claimableWithdrawals))',
  'function lpPoolCap() view returns (uint256)',
  'function getEstimatedNextDrawingLpPool() view returns (uint256)',
  'function getLPDrawingState(uint256) view returns ((uint256 lpPoolTotal,uint256 pendingDeposits,uint256 pendingWithdrawals))',
  'function subscriptions(address) view returns (uint64 remainingUSDC,uint64 lastExecutedDrawing,uint64 subscribedTicketPrice,uint64 dynamicTicketCount,bytes32 source)',
  'function batchOrders(address) view returns (uint256 orderDrawingId,uint64 remainingUSDC,uint64 remainingTickets,uint64 totalTicketsOrdered,uint64 dynamicTicketCount,bytes32 source)',
  'function claimWinnings(uint256[])',
  'function claimReferralFees()',
  'function approve(address,uint256) returns (bool)',
  'function lpDeposit(uint256)',
  'function initiateWithdraw(uint256)',
  'function finalizeWithdraw()',
  'function cancelSubscription()',
  'function cancelBatchOrder()',
  'function emergencyWithdrawLP()',
  'function emergencyRefundTickets(uint256[])',
]);

export type RpcRequest = { jsonrpc?: string; id: number | string | null; method: string; params?: unknown[] };
export type RpcResponse = { jsonrpc: '2.0'; id: RpcRequest['id']; result?: unknown; error?: { code: number; message: string } };
export type FixtureOptions = { account?: Address; timestamp?: number; blockNumber?: bigint; rankedTickets?: boolean; usdcBalance?: bigint };
export function createPlayerRpcFixture(options: FixtureOptions = {}) {
  const account = options.account ?? fixtureAddress;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const blockNumber = options.blockNumber ?? 70_000_000n;
  const currentDraw = 175n;
  const counters = { requests: 0, multicalls: 0, deniedWrites: 0, methods: {} as Record<string, number>, functions: {} as Record<string, number> };
  const hex = (n: bigint | number) => `0x${n.toString(16)}`;
  const owns = (address: unknown) => String(address).toLowerCase() === account.toLowerCase();
  const ticketInfo = (id: bigint) => {
    if (id % 1000n !== 1n && id % 1000n !== 2n) throw new Error('Unknown fixture ticket');
    const drawingId = id / 1000n;
    if (drawingId < currentDraw - 6n || drawingId > currentDraw) throw new Error('Unknown fixture draw');
    return { drawingId, packedTicket: id, referralScheme: zero32 };
  };
  const tiers = Array.from({ length: 12 }, (_, i) => i === 0 || i === 2 ? 0n : i === 1 ? 2_000_000n : BigInt(i) * 1_000_000n);
  function call(to: string | undefined, data: Hex, depth = 0): Hex {
    if (depth > 10) throw new Error('Fixture multicall nesting exceeded');
    if (!to || !Object.values(qaAddresses).some(a => a.toLowerCase() === to.toLowerCase())) throw new Error('Unknown fixture contract');
    const decoded = decodeFunctionData({ abi: qaPlayerAbi, data });
    const name = decoded.functionName;
    const args = decoded.args as readonly unknown[] | undefined;
    counters.functions[name] = (counters.functions[name] ?? 0) + 1;
    let result: unknown;
    switch (name) {
      case 'aggregate3': {
        if (to.toLowerCase() !== qaAddresses.multicall.toLowerCase()) throw new Error('Wrong multicall target');
        counters.multicalls++;
        const calls = args![0] as readonly { target: Address; allowFailure: boolean; callData: Hex }[];
        result = calls.map(item => {
          try { return { success: true, returnData: call(item.target, item.callData, depth + 1) }; }
          catch (e) { if (!item.allowFailure) throw e; return { success: false, returnData: '0x' }; }
        });
        break;
      }
      case 'currentDrawingId': result = currentDraw; break;
      case 'getDrawingState': {
        const id = args![0] as bigint;
        if (id <= 0n || id > currentDraw) throw new Error('Unknown fixture draw');
        result = { prizePool: 1_100_000_000_000n, ticketPrice: 1_000_000n, edgePerTicket: 175_000n,
          referralWinShare: WAD / 10n, referralFee: WAD / 10n, globalTicketsBought: 1000n,
          lpEarnings: 175_000_000n, drawingTime: BigInt(timestamp + 3600) - (currentDraw - id) * 86400n,
          winningTicket: id < currentDraw ? 1n : 0n, ballMax: 30, bonusballMax: 10,
          payoutCalculator: qaAddresses.payout, jackpotLock: id < currentDraw };
        break;
      }
      case 'getUnpackedTicket': result = [[3, 7, 14, 22, 29], 5]; break;
      case 'getUserTickets': {
        const id = args![1] as bigint;
        result = owns(args![0]) && id >= currentDraw - 6n && id <= currentDraw ? [1n, 2n].map(i => ({
          ticketId: id * 1000n + i, ticket: ticketInfo(id * 1000n + i),
          normals: i === 1n ? [1, 2, 4, 6, 8] : options.rankedTickets ? [3, 7, 14, 12, 13] : [9, 10, 11, 12, 13], bonusball: i === 1n ? 5 : 3,
        })) : [];
        break;
      }
      case 'getTicketInfo': result = ticketInfo(args![0] as bigint); break;
      case 'ownerOf': ticketInfo(args![0] as bigint); result = account; break;
      // Tier12 deliberately exercises the existing no-prize sentinel handling.
      case 'getTicketTierIds': result = (args![0] as bigint[]).map(id => { ticketInfo(id); return id % 1000n === 1n ? 1n : options.rankedTickets ? 6n : 12n; }); break;
      case 'getTierPayout': result = tiers[Number(args![1])] ?? 0n; break;
      case 'getDrawingTierPayouts': result = tiers; break;
      case 'emergencyMode': result = false; break;
      case 'referralFees': result = owns(args![0]) ? 3_000_000n : 0n; break;
      case 'balanceOf': result = owns(args![0]) ? (options.usdcBalance ?? 25_000_000n) : 0n; break;
      case 'allowance': result = 0n; break;
      case 'usdc': result = qaAddresses.usdc; break;
      case 'jackpot': result = qaAddresses.jackpot; break;
      case 'jackpotLPManager': result = qaAddresses.lp; break;
      case 'jackpotNFT': result = qaAddresses.nft; break;
      case 'batchFacilitator': result = qaAddresses.batch; break;
      case 'getLPShares': result = 0n; break;
      case 'getLPValueBreakdown': result = { activeDeposits: 0n, pendingDeposits: 0n, pendingWithdrawals: 0n, claimableWithdrawals: 0n }; break;
      case 'getLpInfo': result = { consolidatedShares: 0n, lastDeposit: { amount: 0n, drawingId: 0n }, pendingWithdrawal: { amountInShares: 0n, drawingId: 0n }, claimableWithdrawals: 0n }; break;
      case 'lpPoolCap': result = 2_000_000_000_000n; break;
      case 'getEstimatedNextDrawingLpPool': result = 1_100_000_000_000n; break;
      case 'getLPDrawingState': result = { lpPoolTotal: 1_100_000_000_000n, pendingDeposits: 0n, pendingWithdrawals: 0n }; break;
      case 'subscriptions': result = [0n, 0n, 1_000_000n, 0n, zero32]; break;
      case 'batchOrders': result = [0n, 0n, 0n, 0n, 0n, zero32]; break;
      case 'approve': result = true; break;
      case 'claimWinnings':
        for (const id of args![0] as bigint[]) {
          if (ticketInfo(id).drawingId >= currentDraw || id % 1000n !== 1n) throw new Error('Fixture ticket not claimable');
        }
        return '0x';
      // These branches simulate eth_call only. No state mutation is ever accepted.
      case 'claimReferralFees': case 'lpDeposit': case 'initiateWithdraw': case 'finalizeWithdraw':
      case 'cancelSubscription': case 'cancelBatchOrder': case 'emergencyWithdrawLP': case 'emergencyRefundTickets': return '0x';
      default: throw new Error(`Unsupported fixture selector: ${name}`);
    }
    return encodeFunctionResult({ abi: qaPlayerAbi, functionName: name, result } as never);
  }
  function respond(request: RpcRequest): RpcResponse {
    counters.requests++;
    counters.methods[request.method] = (counters.methods[request.method] ?? 0) + 1;
    const params = request.params ?? [];
    try {
      let result: unknown;
      switch (request.method) {
        case 'eth_chainId': result = '0x2105'; break;
        case 'net_version': result = '8453'; break;
        case 'eth_blockNumber': result = hex(blockNumber); break;
        case 'eth_getCode': result = owns(params[0]) || String(params[0]).toLowerCase() === alternateAddress ? '0x' : qaCode; break;
        case 'eth_getBalance': result = owns(params[0]) ? hex(10n ** 16n) : '0x0'; break;
        case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': result = '0xf4240'; break;
        case 'eth_getTransactionCount': result = '0x0'; break;
        case 'eth_getLogs': result = []; break;
        case 'eth_getBlockByNumber': result = { number: hex(blockNumber), hash: blockHash, parentHash: zero32,
          timestamp: hex(timestamp), transactions: [], baseFeePerGas: '0xf4240', gasLimit: '0x1c9c380', gasUsed: '0x0',
          miner: zeroAddress, difficulty: '0x0', totalDifficulty: '0x0', size: '0x1', nonce: '0x0000000000000000',
          extraData: '0x', receiptsRoot: zero32, stateRoot: zero32, transactionsRoot: zero32,
          sha3Uncles: zero32, uncles: [], logsBloom: `0x${'00'.repeat(256)}` }; break;
        case 'eth_call': case 'eth_estimateGas': {
          const tx = params[0] as { to?: string; data?: Hex; input?: Hex };
          const simulated = call(tx.to, tx.data ?? tx.input ?? '0x');
          result = request.method === 'eth_estimateGas' ? '0x30d40' : simulated;
          break;
        }
        default:
          if (/send|sign|wallet_|personal_/i.test(request.method)) { counters.deniedWrites++; throw new Error(`Signing/submission forbidden in fixture: ${request.method}`); }
          throw new Error(`Unexpected fixture RPC method: ${request.method}`);
      }
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : 'Fixture failure' } };
    }
  }
  return { account, timestamp, blockNumber, currentDraw, counters, respond,
    respondBody: (body: RpcRequest | RpcRequest[]) => Array.isArray(body) ? body.map(respond) : respond(body) };
}

/** Compatibility with the existing ticketRpc(request, timestamp) fixture style. */
export function playerRpc(request: RpcRequest, timestamp = Math.floor(Date.now() / 1000)): RpcResponse {
  return createPlayerRpcFixture({ timestamp }).respond(request);
}
