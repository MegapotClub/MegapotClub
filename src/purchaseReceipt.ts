import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  parseEventLogs,
  type TransactionReceipt,
} from "viem";
import { JACKPOT } from "./config.ts";
import {
  jackpotAbi,
  PURCHASE_SOURCE,
  purchaseTickets,
  type Action,
} from "./native.ts";

/** Receipt evidence describes the tickets actually bought, including an accepted draw rollover. */
export function purchaseReceipt(
  logs: TransactionReceipt["logs"],
  action: Extract<Action, { kind: "purchase" }>,
) {
  const events = parseEventLogs({
    abi: jackpotAbi,
    logs: logs.filter((l) => l.address.toLowerCase() === JACKPOT.toLowerCase()),
    strict: true,
  });
  const orders = events.filter((e) => e.eventName === "TicketOrderProcessed");
  const tickets = events.filter((e) => e.eventName === "TicketPurchased");
  const expected = purchaseTickets(action.tickets);
  const scheme = keccak256(
    encodeAbiParameters(parseAbiParameters("address[], uint256[]"), [
      [action.referrer],
      [10n ** 18n],
    ]),
  );
  if (orders.length !== 1 || tickets.length !== expected.length)
    throw new Error("receiptMismatch");
  const order = orders[0].args;
  if (
    order.buyer.toLowerCase() !== action.recipient.toLowerCase() ||
    order.recipient.toLowerCase() !== action.recipient.toLowerCase() ||
    order.numberOfTickets !== BigInt(expected.length)
  )
    throw new Error("receiptMismatch");
  tickets.forEach((event, i) => {
    const t = event.args,
      wanted = expected[i];
    if (
      t.recipient.toLowerCase() !== action.recipient.toLowerCase() ||
      t.currentDrawingId !== order.currentDrawingId ||
      t.source !== PURCHASE_SOURCE ||
      t.referralScheme !== scheme ||
      t.bonusball !== wanted.bonus ||
      t.normals.length !== wanted.numbers.length ||
      t.normals.some((n, j) => n !== wanted.numbers[j])
    )
      throw new Error("receiptMismatch");
  });
  const ids = tickets.map((t) => t.args.userTicketId.toString());
  if (new Set(ids).size !== ids.length) throw new Error("receiptMismatch");
  return {
    draw: order.currentDrawingId.toString(),
    ticketIds: ids,
    paid: (order.lpEarnings + order.referralFees).toString(),
  };
}

export function claimReceipt(
  logs: TransactionReceipt["logs"],
  account: string,
) {
  const events = parseEventLogs({
    abi: jackpotAbi,
    eventName: "TicketWinningsClaimed",
    strict: true,
    logs: logs.filter((l) => l.address.toLowerCase() === JACKPOT.toLowerCase()),
  }).filter((e) => e.args.userAddress.toLowerCase() === account.toLowerCase());
  if (!events.length) throw new Error("receiptMismatch");
  return {
    amount: events
      .reduce((sum, e) => sum + e.args.winningsAmount, 0n)
      .toString(),
    ticketIds: events.map((e) => e.args.userTicketId.toString()),
  };
}
