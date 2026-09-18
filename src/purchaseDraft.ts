import type { Draw } from "./model.ts";
import { validNumbers } from "./plans.ts";
export type NumberSelection = { numbers: number[]; bonus: number };
export type PurchaseDraft = {
  schema: 1;
  draw: string;
  quantity: number;
  rows: NumberSelection[];
  mode: "quick" | "choose";
};
export const PURCHASE_DRAFT_KEY = "megapot-club:purchase-draft:v1";
/** @cc [label:security] purchase-draft-is-not-authorization
 * Saved selections MUST be bounded data, never a receipt or signing authorization.
 * Restoring a draft MUST NOT invoke a wallet or execute a transaction.
 */
export function parsePurchaseDraft(
  value: unknown,
  draw: Draw,
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
        r.numbers.every(
          (n) => Number.isInteger(n) && n >= 1 && n <= draw.ballMax,
        ) &&
        Number.isInteger(r.bonus) &&
        r.bonus >= 1 &&
        r.bonus <= draw.bonusMax,
    )
  )
    return null;
  return {
    schema: 1,
    draw: p.draw,
    quantity: p.quantity,
    rows: p.rows.map((r) => ({ numbers: [...r.numbers], bonus: r.bonus })),
    mode: p.mode,
  };
}
export type PurchaseIntent = {
  schema: 1;
  chainId: 8453;
  drawId: string;
  quantity: number;
  selections: NumberSelection[] | null;
  unitPrice: string;
  total: string;
  account: string | null;
  referrer: string | null;
};
/** A read-only handoff. A future executor must freshly validate draw, account, chain, price and numbers. */
export function purchaseIntent(
  draft: PurchaseDraft,
  draw: Draw,
  account?: string | null,
  referrer?: string,
): PurchaseIntent {
  if (referrer && !/^0x[0-9a-fA-F]{40}$/.test(referrer))
    throw new Error("invalidReferral");
  const count = draft.mode === "choose" ? draft.rows.length : draft.quantity;
  if (
    draft.draw !== draw.id ||
    count < 1 ||
    count > 100 ||
    (draft.mode === "choose" &&
      !draft.rows.every((r) =>
        validNumbers(r.numbers, r.bonus, draw.ballMax, draw.bonusMax),
      ))
  )
    throw new Error("invalidSelection");
  return {
    schema: 1,
    chainId: 8453,
    drawId: draw.id,
    quantity: count,
    selections:
      draft.mode === "choose"
        ? draft.rows.map((r) => ({ ...r, numbers: [...r.numbers] }))
        : null,
    unitPrice: draw.ticketPrice,
    total: (BigInt(draw.ticketPrice) * BigInt(count)).toString(),
    account: account ?? null,
    referrer: referrer ?? null,
  };
}
