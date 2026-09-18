/** Settled accumulator change, scaled to parts per million. Zero opening value has no defined return. */
export function nativeReturnPpm(previous: bigint, next: bigint): bigint | null {
  if (previous < 0n || next < 0n) throw new Error("invalidAccumulator");
  return previous === 0n ? null : ((next - previous) * 1_000_000n) / previous;
}

/** Format a signed fixed-point percentage without coercing a chain integer to a float. */
export function formatReturn(ppm: bigint | null, locale: string): string {
  if (ppm === null) return "—";
  const absolute = ppm < 0n ? -ppm : ppm;
  const major = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(absolute / 10_000n);
  const fraction = (absolute % 10_000n)
    .toString()
    .padStart(4, "0")
    .replace(/0+$/, "");
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? ".";
  return `${ppm < 0n ? "−" : ""}${major}${fraction ? decimal + fraction : ""}%`;
}
