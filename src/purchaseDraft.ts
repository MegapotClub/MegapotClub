import { keccak256, stringToHex, type Address } from "viem";
import type { Draw } from "./model.ts";
import { quickPick, validNumbers } from "./plans.ts";
import { purchaseTickets, type Action } from "./native.ts";
import { resolveReferrer } from "./referral.ts";
import { localId } from "./localId.ts";
export type NumberSelection = { numbers: number[]; bonus: number };
export type PurchaseDraft = {
  schema: 1;
  journeyId?: string;
  revision?: number;
  draw: string;
  quantity: number;
  rows: NumberSelection[];
  mode: "quick" | "choose";
  invitation?: string;
};
export type PurchaseAction = Extract<Action, { kind: "purchase" }>;
export const PURCHASE_DRAFT_KEY = "megapot-club:purchase-draft:v1";
export const emptyDraft = (draw: string): PurchaseDraft => ({
  schema: 1,
  journeyId: localId(),
  revision: 0,
  draw,
  quantity: 10,
  rows: [{ numbers: [], bonus: 1 }],
  mode: "quick",
});
/** @cc [label:security] purchase-draft-is-not-authorization
 * Saved selections MUST be bounded data, never a receipt or signing authorization.
 * Restoring a draft MUST NOT invoke a wallet or execute a transaction.
 */
export function parsePurchaseDraft(
  value: unknown,
  _draw: Draw,
): PurchaseDraft | null {
  if (!value || typeof value !== "object") return null;
  const p = value as PurchaseDraft;
  if (
    p.schema !== 1 ||
    typeof p.draw !== "string" ||
    !/^[1-9]\d{0,17}$/.test(p.draw) ||
    !Number.isInteger(p.quantity) ||
    p.quantity < 1 ||
    p.quantity > 100 ||
    !["quick", "choose"].includes(p.mode) ||
    !Array.isArray(p.rows) ||
    p.rows.length < 1 ||
    p.rows.length > 100 ||
    !p.rows.every(
      (r) =>
        r &&
        Array.isArray(r.numbers) &&
        r.numbers.length <= 5 &&
        new Set(r.numbers).size === r.numbers.length &&
        r.numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 255) &&
        Number.isInteger(r.bonus) &&
        r.bonus >= 1 &&
        r.bonus <= 255,
    )
  )
    return null;
  return {
    schema: 1,
    journeyId:
      typeof p.journeyId === "string" &&
      /^[a-zA-Z0-9-]{1,80}$/.test(p.journeyId)
        ? p.journeyId
        : localId(),
    revision:
      Number.isSafeInteger(p.revision) && p.revision! >= 0 ? p.revision : 0,
    draw: p.draw,
    quantity: p.quantity,
    rows: p.rows.map((r) => ({ numbers: [...r.numbers], bonus: r.bonus })),
    mode: p.mode,
    ...(typeof p.invitation === "string"
      ? { invitation: p.invitation.slice(0, 160) }
      : {}),
  };
}
export function purchaseDraftKey(draft: PurchaseDraft): string {
  return keccak256(
    stringToHex(
      JSON.stringify({
        journeyId: draft.journeyId,
        revision: draft.revision,
        quantity: draft.quantity,
        mode: draft.mode,
        rows: draft.rows,
        invitation: draft.invitation,
      }),
    ),
  );
}
/** @cc [label:security] purchase-order-from-draft
 * A purchase MUST preserve the connected recipient, selection and resolved invitation through
 * approval and draw rollover. Quick Play uses rejection sampling once per order. Draft restoration
 * never authorizes a wallet request. Observed draw and price remain display data, not execution locks.
 */
export function purchaseAction(
  draft: PurchaseDraft,
  draw: Draw,
  account: Address,
  random?: Parameters<typeof quickPick>[2],
): PurchaseAction {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("invalidAddress");
  const count = draft.mode === "choose" ? draft.rows.length : draft.quantity;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    (draft.mode === "choose" &&
      !draft.rows.every((r) =>
        validNumbers(r.numbers, r.bonus, draw.ballMax, draw.bonusMax),
      ))
  )
    throw new Error("invalidSelection");
  const tickets =
    draft.mode === "choose"
      ? draft.rows.map((r) => ({ numbers: [...r.numbers], bonus: r.bonus }))
      : Array.from({ length: count }, () =>
          quickPick(draw.ballMax, draw.bonusMax, random),
        );
  return {
    kind: "purchase",
    tickets: purchaseTickets(tickets, draw.ballMax, draw.bonusMax),
    recipient: account,
    drawId: BigInt(draw.id),
    unitPrice: BigInt(draw.ticketPrice),
    referrer: resolveReferrer(draft.invitation),
    orderId: localId(),
    draftKey: purchaseDraftKey(draft),
  };
}
