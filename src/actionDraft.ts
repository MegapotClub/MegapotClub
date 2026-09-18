export type ActionDraft = { amount: string; ids: string; percentage: number };
export function parseActionDraft(value: unknown): ActionDraft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.amount !== "string" ||
    !/^\d{0,21}(\.\d{0,6})?$/.test(v.amount) ||
    typeof v.ids !== "string" ||
    v.ids.length > 2400 ||
    !/^[\d,\s]*$/.test(v.ids) ||
    !Number.isInteger(v.percentage) ||
    Number(v.percentage) < 1 ||
    Number(v.percentage) > 100
  )
    return null;
  return { amount: v.amount, ids: v.ids, percentage: Number(v.percentage) };
}
