import type { Draw, TicketRecord } from "./model.ts";

export function mainMatches(ticket: TicketRecord, draw: Draw): number {
  return ticket.numbers.filter((number) =>
    draw.result?.numbers.includes(number),
  ).length;
}

/** Sort the full observed draw before pagination; never reorder the cached observation itself. */
export function ticketsByMatches(
  tickets: TicketRecord[],
  draw: Draw,
): TicketRecord[] {
  if (!draw.settled || !draw.result) return tickets;
  return [...tickets].sort(
    (a, b) =>
      mainMatches(b, draw) - mainMatches(a, draw) ||
      Number(b.bonus === draw.result!.bonus) -
        Number(a.bonus === draw.result!.bonus) ||
      (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0),
  );
}
