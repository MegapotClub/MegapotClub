import { getAddress, isAddress, keccak256, parseAbi, type Hex } from "viem";
import type { ReadClient } from "./chain.ts";
import { JACKPOT, TICKET_NFT } from "./config.ts";
import { USDC, LP_MANAGER, REGISTRY, jackpotAbi } from "./native.ts";

const playerNftAbi = parseAbi([
  "function jackpot() view returns (address)",
  "function ownerOf(uint256) view returns (address)",
  "function getUserTickets(address,uint256) view returns ((uint256 ticketId,(uint256 drawingId,uint256 packedTicket,bytes32 referralScheme) ticket,uint8[] normals,uint8 bonusball)[])",
]);
const playerTokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);
const playerPoolAbi = parseAbi([
  "function jackpot() view returns (address)",
  "function getLPDrawingState(uint256) view returns ((uint256 lpPoolTotal,uint256 pendingDeposits,uint256 pendingWithdrawals))",
]);
const playerPayoutAbi = parseAbi([
  "function getTierPayout(uint256,uint256) view returns (uint256)",
]);
const resultAbi = parseAbi([
  "function getUnpackedTicket(uint256,uint256) view returns (uint8[] normals,uint8 bonusball)",
]);
const WAD = 10n ** 18n;

/** @cc [label:data] owned-player-prizes
 * Player prizes MUST use current ownership and each draw calculator at one block.
 * Missing/burned tickets MUST NOT be labeled claimed; display data MUST NOT authorize a transaction.
 */
export async function readPlayerAccountAt(
  c: ReadClient,
  input: string,
  history = 6,
) {
  if (
    !isAddress(input) ||
    !Number.isInteger(history) ||
    history < 1 ||
    history > 6
  )
    throw new Error("invalidAddressOrWindow");
  const account = getAddress(input);
  const b = await c.getBlock({ blockTag: "latest" });
  const age = Date.now() / 1000 - Number(b.timestamp);
  if (!b.hash || b.number === null || age < -30 || age > 120)
    throw new Error("staleChain");
  const blockNumber = b.number;
  const j = { address: JACKPOT, abi: jackpotAbi, blockNumber } as const;
  async function pin(
    address: typeof JACKPOT | typeof TICKET_NFT | typeof LP_MANAGER,
  ) {
    const code = await c.getCode({ address, blockNumber });
    const expected = REGISTRY.find(
      (r) => r.address.toLowerCase() === address.toLowerCase(),
    );
    if (!code || !expected || keccak256(code) !== expected.hash)
      throw new Error("contractChanged");
  }
  const [
    current,
    emergency,
    balance,
    referral,
    token,
    nft,
    manager,
    nftJackpot,
  ] = await Promise.all([
    c.readContract({ ...j, functionName: "currentDrawingId" }),
    c.readContract({ ...j, functionName: "emergencyMode" }),
    c.readContract({
      address: USDC,
      abi: playerTokenAbi,
      functionName: "balanceOf",
      args: [account],
      blockNumber,
    }),
    c.readContract({ ...j, functionName: "referralFees", args: [account] }),
    c.readContract({ ...j, functionName: "usdc" }),
    c.readContract({ ...j, functionName: "jackpotNFT" }),
    c.readContract({ ...j, functionName: "jackpotLPManager" }),
    c.readContract({
      address: TICKET_NFT,
      abi: playerNftAbi,
      functionName: "jackpot",
      blockNumber,
    }),
    pin(JACKPOT),
    pin(TICKET_NFT),
  ]);
  if (
    token.toLowerCase() !== USDC.toLowerCase() ||
    nft.toLowerCase() !== TICKET_NFT.toLowerCase() ||
    manager.toLowerCase() !== LP_MANAGER.toLowerCase() ||
    nftJackpot.toLowerCase() !== JACKPOT.toLowerCase()
  )
    throw new Error("contractChanged");

  // Includes current + up to six prior draws. Derive from live block, not cached snapshot.
  const ids = Array.from(
    { length: history + 1 },
    (_, i) => current - BigInt(i),
  ).filter((id) => id > 0n);
  const draws = await Promise.all(
    ids.map(async (id) => {
      const [state, tickets] = await Promise.all([
        c.readContract({ ...j, functionName: "getDrawingState", args: [id] }),
        c.readContract({
          address: TICKET_NFT,
          abi: playerNftAbi,
          functionName: "getUserTickets",
          args: [account, id],
          blockNumber,
        }),
      ]);
      if (state.referralWinShare > WAD) throw new Error("invalidShare");
      const result =
        state.winningTicket === 0n
          ? null
          : await c.readContract({
              address: JACKPOT,
              abi: resultAbi,
              functionName: "getUnpackedTicket",
              args: [id, state.winningTicket],
              blockNumber,
            });
      return { id, state, tickets, result };
    }),
  );
  const seen = new Set<string>();
  const all = draws.flatMap((d) =>
    d.tickets.map((t) => {
      if (
        t.ticketId <= 0n ||
        seen.has(String(t.ticketId)) ||
        t.ticket.drawingId !== d.id ||
        t.normals.length !== 5 ||
        new Set(t.normals).size !== 5 ||
        t.normals.some((n) => n < 1 || n > d.state.ballMax) ||
        t.bonusball < 1 ||
        t.bonusball > d.state.bonusballMax
      )
        throw new Error("invalidTicketObservation");
      seen.add(String(t.ticketId));
      return { ...t, draw: d };
    }),
  );
  const eligible = all.filter(
    (t) => t.draw.id < current && t.draw.state.winningTicket !== 0n,
  );
  const settled = eligible.slice(0, 600);
  const needsPool =
    !emergency && settled.some((t) => BigInt(t.ticket.referralScheme) === 0n);
  async function poolRead(): Promise<bigint | null> {
    if (!needsPool) return null;
    const [pool, linked] = await Promise.all([
      c.readContract({
        address: LP_MANAGER,
        abi: playerPoolAbi,
        functionName: "getLPDrawingState",
        args: [current],
        blockNumber,
      }),
      c.readContract({
        address: LP_MANAGER,
        abi: playerPoolAbi,
        functionName: "jackpot",
        blockNumber,
      }),
      pin(LP_MANAGER),
    ]);
    if (linked.toLowerCase() !== JACKPOT.toLowerCase())
      throw new Error("contractChanged");
    return pool.lpPoolTotal;
  }
  const chunks = Array.from(
    { length: Math.ceil(settled.length / 100) },
    (_, i) => settled.slice(i * 100, i * 100 + 100),
  );
  const [tierChunks, owners, pool] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        c.readContract({
          ...j,
          functionName: "getTicketTierIds",
          args: [chunk.map((t) => t.ticketId)],
        }),
      ),
    ),
    Promise.all(
      settled.map((t) =>
        c.readContract({
          address: TICKET_NFT,
          abi: playerNftAbi,
          functionName: "ownerOf",
          args: [t.ticketId],
          blockNumber,
        }),
      ),
    ),
    poolRead(),
  ]);
  const tiers = tierChunks.flat();
  if (
    tiers.length !== settled.length ||
    owners.some((owner) => owner.toLowerCase() !== account.toLowerCase())
  )
    throw new Error("inconsistentOwnership");
  // One promise per unique draw/calculator/tier, scheduled together for viem batching.
  const payout = new Map<string, Promise<bigint>>();
  const priced = await Promise.all(
    settled.map(async (t, i) => {
      const tier = tiers[i];
      const key = `${t.draw.id}:${t.draw.state.payoutCalculator.toLowerCase()}:${tier}`;
      if (tier <= 11n && !payout.has(key))
        payout.set(
          key,
          c.readContract({
            address: t.draw.state.payoutCalculator,
            abi: playerPayoutAbi,
            functionName: "getTierPayout",
            args: [t.draw.id, tier],
            blockNumber,
          }),
        );
      const gross = tier > 11n ? 0n : await payout.get(key)!;
      const noScheme = BigInt(t.ticket.referralScheme) === 0n;
      if (noScheme && !emergency && pool === null)
        throw new Error("missingPoolState");
      const fee =
        noScheme && (emergency || pool === 0n)
          ? 0n
          : (gross * t.draw.state.referralWinShare) / WAD;
      return { ...t, tier, gross, net: gross - fee };
    }),
  );
  if ((await c.getBlock({ blockNumber })).hash !== b.hash)
    throw new Error("changedBlock");
  const available = priced.filter((t) => t.net > 0n);
  return {
    account,
    chainId: 8453 as const,
    currentDraw: current,
    emergency,
    blockNumber,
    blockHash: b.hash as Hex,
    blockTime: Number(b.timestamp),
    observedAt: Date.now(),
    usdcBalance: balance,
    referralEarnings: referral,
    draws,
    allTickets: all,
    settledTickets: priced,
    pricingComplete: settled.length === eligible.length,
    unpricedTickets: eligible.length - settled.length,
    claimIds: available.map((t) => t.ticketId),
    prizeTotal: available.reduce((n, t) => n + t.net, 0n),
    coverage: {
      firstDraw: ids.at(-1)!,
      lastDraw: current,
      completeAllHistory: ids.at(-1) === 1n,
    },
  };
}

export type PlayerObservation = Awaited<ReturnType<typeof readPlayerAccountAt>>;
