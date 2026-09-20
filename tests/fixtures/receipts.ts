import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbiParameters,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { jackpotAbi, PURCHASE_SOURCE, type Action } from "../../src/native.ts";
type Log = TransactionReceipt["logs"][number];
import { JACKPOT } from "../../src/config.ts";
export function purchaseLogs(
  action: Extract<Action, { kind: "purchase" }>,
  draw = action.drawId,
  firstTicketId = draw * 1000n + 100n,
): Log[] {
  const scheme = keccak256(
    encodeAbiParameters(parseAbiParameters("address[], uint256[]"), [
      [action.referrer],
      [10n ** 18n],
    ]),
  );
  const common = {
    address: JACKPOT,
    blockHash: `0x${"11".repeat(32)}` as Hex,
    blockNumber: 69999998n,
    transactionHash: `0x${"ab".repeat(32)}` as Hex,
    transactionIndex: 0,
    removed: false,
  };
  const logs: Log[] = action.tickets.map((t, i) => ({
    ...common,
    logIndex: i,
    topics: encodeEventTopics({
      abi: jackpotAbi,
      eventName: "TicketPurchased",
      args: {
        recipient: action.recipient,
        currentDrawingId: draw,
        source: PURCHASE_SOURCE,
      },
    }) as Log["topics"],
    data: encodeAbiParameters(
      parseAbiParameters("uint256, uint8[], uint8, bytes32"),
      [firstTicketId + BigInt(i), t.numbers, t.bonus, scheme],
    ),
  }));
  const amount = action.unitPrice * BigInt(action.tickets.length);
  logs.push({
    ...common,
    logIndex: logs.length,
    topics: encodeEventTopics({
      abi: jackpotAbi,
      eventName: "TicketOrderProcessed",
      args: {
        buyer: action.recipient,
        recipient: action.recipient,
        currentDrawingId: draw,
      },
    }) as Log["topics"],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256"), [
      BigInt(action.tickets.length),
      amount - amount / 10n,
      amount / 10n,
    ]),
  });
  return logs;
}
