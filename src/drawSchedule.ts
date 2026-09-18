/** Club's expected settlement target is five minutes after the protocol cutoff. */
export const DRAW_SETTLEMENT_DELAY_SECONDS = 5 * 60;
export const DRAW_TIME_CYCLE_SECONDS = 8;

/** @cc [label:data] expected-draw-is-not-cutoff
 * The expected draw time MUST NOT replace raw protocol timestamps or authorize an action.
 * At the current 17:00 UTC cutoff, the shared retail target is 17:05 UTC (12:05 EST).
 */
export function expectedDrawAt(scheduledAt: number) {
  return scheduledAt + DRAW_SETTLEMENT_DELAY_SECONDS;
}
