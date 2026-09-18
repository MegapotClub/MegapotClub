import {
  createPublicClient,
  parseAbi,
  keccak256,
  isAddress,
  getAddress,
} from "viem";
import { base } from "viem/chains";
import { rpcHttp } from "./rpcTransport.ts";
import { CHAIN_ID, JACKPOT, TICKET_NFT } from "./config.ts";
import { parseSnapshot, parseRpcUrls, parseTicketRecords } from "./model.ts";
import type { Snapshot, Draw, AccountObservation } from "./model.ts";

const abi = parseAbi([
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256) view returns ((uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket, uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought, uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket, uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock))",
  "function getUnpackedTicket(uint256, uint256) view returns (uint8[] normals, uint8 bonusball)",
]);
const ticketsAbi = parseAbi([
  "function getUserTickets(address, uint256) view returns ((uint256 ticketId, (uint256 drawingId, uint256 packedTicket, bytes32 referralScheme) ticket, uint8[] normals, uint8 bonusball)[])",
]);
export type ReadClient = ReturnType<typeof clientFor>;
type Client = ReadClient;
const clientFor = (url: string, signal: AbortSignal) =>
  createPublicClient({
    chain: base,
    batch: { multicall: { wait: 10, batchSize: 8192 } },
    ccipRead: false,
    transport: rpcHttp(url, {
      timeout: 10_000,
      retryCount: 0,
      // viem shares HTTP batches by URL, not fetchOptions.signal. Batching here
      // would let an obsolete account read abort an unrelated active read.
      batch: false,
      fetchOptions: {
        signal,
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
    }),
  });

/**
 * @cc [label:resilience] bounded-endpoint-attempt
 * Each complete endpoint observation MUST have its own deadline, including response bodies.
 * A failed or timed-out observation MUST advance to the next configured endpoint without partial results.
 */
async function atEndpoint<T>(
  urls: string[],
  read: (client: Client) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (const url of parseRpcUrls(urls)) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    try {
      const client = clientFor(url, controller.signal);
      if ((await client.getChainId()) !== CHAIN_ID) continue;
      return await read(client);
    } catch {
      /* A complete read is retried on the next endpoint. */
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  signal?.throwIfAborted();
  throw new Error("rpcUnavailable");
}

async function readDraw(
  client: Client,
  id: bigint,
  block: bigint,
): Promise<Draw> {
  const d = await client.readContract({
    address: JACKPOT,
    abi,
    functionName: "getDrawingState",
    args: [id],
    blockNumber: block,
  });
  const result =
    d.winningTicket === 0n
      ? null
      : await client.readContract({
          address: JACKPOT,
          abi,
          functionName: "getUnpackedTicket",
          args: [id, d.winningTicket],
          blockNumber: block,
        });
  return {
    id: id.toString(),
    prizePool: d.prizePool.toString(),
    ticketPrice: d.ticketPrice.toString(),
    ticketCount: d.globalTicketsBought.toString(),
    closesAt: Number(d.drawingTime),
    locked: d.jackpotLock,
    settled: d.winningTicket !== 0n,
    ballMax: d.ballMax,
    bonusMax: d.bonusballMax,
    result: result ? { numbers: [...result[0]], bonus: result[1] } : null,
  };
}

export async function fetchDrawing(
  urls: string[],
  id: string,
  expectedHash: string,
) {
  if (!/^[1-9]\d{0,17}$/.test(id)) throw new Error("invalidDraw");
  return atEndpoint(urls, async (client) => {
    const block = await client.getBlock();
    const code = await client.getCode({
      address: JACKPOT,
      blockNumber: block.number,
    });
    if (!code || keccak256(code) !== expectedHash)
      throw new Error("unsupportedDeployment");
    const current = await client.readContract({
      address: JACKPOT,
      abi,
      functionName: "currentDrawingId",
      blockNumber: block.number,
    });
    if (BigInt(id) > current) throw new Error("invalidDraw");
    const draw = await readDraw(client, BigInt(id), block.number);
    if (
      (await client.getBlock({ blockNumber: block.number })).hash !== block.hash
    )
      throw new Error("changedBlock");
    return { draw, blockNumber: block.number.toString() };
  });
}

/**
 * @cc [label:data] coherent-chain-snapshot
 * All draw state in one snapshot MUST be read at one numbered block from one chain-validated RPC.
 * A failed endpoint MUST NOT contribute partial values to the fallback endpoint's observation.
 * If supplied, a runtime-code hash mismatch MUST prevent a new snapshot from being accepted.
 */
export async function fetchSnapshot(
  urls: string[],
  expectedHash?: string,
  minimumBlock = 0n,
  signal?: AbortSignal,
): Promise<Snapshot> {
  return atEndpoint(
    urls,
    async (client) => {
      const block = await client.getBlock({ blockTag: "latest" });
      const age = Date.now() - Number(block.timestamp) * 1000;
      if (block.number < minimumBlock || age > 120_000 || age < -120_000)
        throw new Error("staleEndpoint");
      const [id, code] = await Promise.all([
        client.readContract({
          address: JACKPOT,
          abi,
          functionName: "currentDrawingId",
          blockNumber: block.number,
        }),
        client.getCode({ address: JACKPOT, blockNumber: block.number }),
      ]);
      if (!code || code === "0x") throw new Error("unsupportedDeployment");
      const codeHash = keccak256(code);
      if (expectedHash && codeHash !== expectedHash)
        throw new Error("unsupportedDeployment");
      const ids = Array.from(
        { length: Math.min(7, Number(id)) },
        (_, i) => id - BigInt(i),
      );
      const draws = await Promise.all(
        ids.map((drawId) => readDraw(client, drawId, block.number)),
      );
      const snapshot = parseSnapshot(
        {
          schema: 1,
          chainId: CHAIN_ID,
          address: JACKPOT,
          blockNumber: block.number.toString(),
          blockHash: block.hash,
          blockTime: Number(block.timestamp),
          observedAt: Date.now(),
          codeHash,
          current: draws[0],
          recent: draws.slice(1),
        },
        JACKPOT,
      );
      if (!snapshot) throw new Error("unsupportedDeployment");
      if (
        (await client.getBlock({ blockNumber: block.number })).hash !==
        block.hash
      )
        throw new Error("changedBlock");
      return snapshot;
    },
    signal,
  );
}

/**
 * @cc [label:privacy] explicit-address-read
 * Account lookup MUST only read the explicitly supplied address. It MUST NOT connect a wallet,
 * request a signature, submit a transaction, or persist the address. Results identify their draw and block.
 */
export async function fetchTickets(
  urls: string[],
  input: string,
  drawId: string,
  signal?: AbortSignal,
): Promise<AccountObservation> {
  return (await fetchTicketCollections(urls, input, [drawId], signal))[0];
}

/** Read a bounded collection at one verified block, letting viem aggregate calls. */
export async function fetchTicketCollections(
  urls: string[],
  input: string,
  drawIds: string[],
  signal?: AbortSignal,
): Promise<AccountObservation[]> {
  if (!isAddress(input.trim(), { strict: false }))
    throw new Error("invalidAddress");
  if (
    !drawIds.length ||
    drawIds.length > 6 ||
    drawIds.some((id) => !/^[1-9]\d{0,17}$/.test(id))
  )
    throw new Error("invalidDraw");
  const address = getAddress(input.trim());
  return atEndpoint(
    urls,
    async (client) => {
      const block = await client.getBlock({ blockTag: "latest" });
      if (!block.hash || !/^0x[0-9a-fA-F]{64}$/.test(block.hash))
        throw new Error("invalidBlockIdentity");
      const blockTime = Number(block.timestamp),
        age = Date.now() - blockTime * 1000;
      if (!Number.isSafeInteger(blockTime) || age > 120_000 || age < -120_000)
        throw new Error("staleEndpoint");
      const blockNumber = block.number;
      const collections = await Promise.all(
        drawIds.map(async (drawId) => {
          const [tickets, draw] = await Promise.all([
            client.readContract({
              address: TICKET_NFT,
              abi: ticketsAbi,
              functionName: "getUserTickets",
              args: [address, BigInt(drawId)],
              blockNumber,
            }),
            readDraw(client, BigInt(drawId), blockNumber),
          ]);
          const records = parseTicketRecords(
            tickets.map((t) => ({
              id: t.ticketId.toString(),
              drawId: t.ticket.drawingId.toString(),
              numbers: [...t.normals],
              bonus: t.bonusball,
            })),
            draw,
          );
          if (!records) throw new Error("invalidTicketObservation");
          return {
            address,
            drawId,
            draw,
            blockTime,
            blockNumber: blockNumber.toString(),
            observedAt: Date.now(),
            total: tickets.length,
            tickets: records,
          };
        }),
      );
      if ((await client.getBlock({ blockNumber })).hash !== block.hash)
        throw new Error("changedBlock");
      return collections;
    },
    signal,
  );
}

export async function fetchPlayerAccount(urls: string[], account: string, signal?: AbortSignal) {
  const { readPlayerAccountAt } = await import('./playerReads.ts');
  return atEndpoint(urls, client => readPlayerAccountAt(client, account), signal);
}
