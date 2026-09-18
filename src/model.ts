export type Draw = {
  id: string;
  prizePool: string;
  ticketPrice: string;
  ticketCount: string;
  closesAt: number;
  locked: boolean;
  settled: boolean;
  ballMax: number;
  bonusMax: number;
  result: { numbers: number[]; bonus: number } | null;
};
export type Snapshot = {
  schema: 1;
  chainId: 8453;
  address: string;
  blockNumber: string;
  blockHash: string;
  blockTime: number;
  observedAt: number;
  codeHash: string;
  current: Draw;
  recent: Draw[];
};
export type TicketRecord = {
  id: string;
  drawId: string;
  numbers: number[];
  bonus: number;
};
export type AccountObservation = {
  address: string;
  draw: Draw;
  blockTime: number;
  blockNumber: string;
  observedAt: number;
  drawId: string;
  tickets: TicketRecord[];
  total: number;
};

const integerString = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d*)$/.test(v) && v.length < 79;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_DATE_MS = 8_640_000_000_000_000;
const safeTime = (v: unknown, unit = 1): v is number =>
  typeof v === "number" &&
  Number.isSafeInteger(v) &&
  v > 0 &&
  v <= MAX_DATE_MS / unit;

function validDraw(v: unknown): v is Draw {
  if (!record(v)) return false;
  if (![v.id, v.prizePool, v.ticketPrice, v.ticketCount].every(integerString))
    return false;
  if (
    !safeTime(v.closesAt, 1000) ||
    typeof v.locked !== "boolean" ||
    typeof v.settled !== "boolean"
  )
    return false;
  if (
    !Number.isInteger(v.ballMax) ||
    Number(v.ballMax) < 5 ||
    Number(v.ballMax) > 255 ||
    !Number.isInteger(v.bonusMax) ||
    Number(v.bonusMax) < 1 ||
    Number(v.bonusMax) > 255
  )
    return false;
  if (v.result === null) return !v.settled;
  const r = v.result;
  return (
    v.settled &&
    record(r) &&
    Array.isArray(r.numbers) &&
    r.numbers.length === 5 &&
    new Set(r.numbers).size === 5 &&
    r.numbers.every(
      (n) => Number.isInteger(n) && n >= 1 && n <= Number(v.ballMax),
    ) &&
    Number.isInteger(r.bonus) &&
    Number(r.bonus) >= 1 &&
    Number(r.bonus) <= Number(v.bonusMax)
  );
}

/**
 * @cc [label:data] reject-invalid-snapshots
 * Cached or remote snapshots MUST be structurally valid, match the pinned chain and address,
 * and contain distinct drawing IDs before any values are displayed. Invalid input MUST return null.
 */
export function parseSnapshot(
  value: unknown,
  address: string,
): Snapshot | null {
  if (
    !record(value) ||
    value.schema !== 1 ||
    value.chainId !== 8453 ||
    value.address !== address
  )
    return null;
  if (
    !integerString(value.blockNumber) ||
    !safeTime(value.blockTime, 1000) ||
    !safeTime(value.observedAt) ||
    Number(value.blockTime) * 1000 > Number(value.observedAt) + 120_000
  )
    return null;
  if (
    typeof value.blockHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.blockHash) ||
    typeof value.codeHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.codeHash)
  )
    return null;
  if (
    !validDraw(value.current) ||
    !Array.isArray(value.recent) ||
    value.recent.length > 12 ||
    !value.recent.every(validDraw)
  )
    return null;
  const current = value.current;
  const ids = [current.id, ...value.recent.map((d) => d.id)];
  if (
    new Set(ids).size !== ids.length ||
    value.recent.some((d) => BigInt(d.id) >= BigInt(current.id))
  )
    return null;
  return value as unknown as Snapshot;
}

/**
 * @cc [label:data] bounded-ticket-observation
 * Accepted ticket records MUST have unique IDs, belong to the requested drawing, and contain
 * exactly five distinct in-range main numbers and one in-range bonus number. Reject the whole set on failure.
 */
export function parseTicketRecords(
  value: unknown,
  draw: Draw,
): TicketRecord[] | null {
  if (!Array.isArray(value) || !validDraw(draw)) return null;
  const ids = new Set<string>();
  for (const ticket of value) {
    if (
      !record(ticket) ||
      !integerString(ticket.id) ||
      ids.has(ticket.id) ||
      ticket.drawId !== draw.id ||
      !Array.isArray(ticket.numbers) ||
      ticket.numbers.length !== 5 ||
      new Set(ticket.numbers).size !== 5 ||
      !ticket.numbers.every(
        (n) => Number.isInteger(n) && n >= 1 && n <= draw.ballMax,
      ) ||
      !Number.isInteger(ticket.bonus) ||
      Number(ticket.bonus) < 1 ||
      Number(ticket.bonus) > draw.bonusMax
    )
      return null;
    ids.add(ticket.id);
  }
  return value as TicketRecord[];
}

export function parseCachedSnapshot(
  value: unknown,
  address: string,
  now: number,
): Snapshot | null {
  const snapshot = parseSnapshot(value, address);
  if (
    !snapshot ||
    snapshot.observedAt > now + 120_000 ||
    snapshot.blockTime * 1000 > now + 120_000
  )
    return null;
  return snapshot;
}

/**
 * @cc [label:precision] exact-money-display
 * Monetary base units MUST remain integers through grouping and rounding. Formatting MUST NOT
 * convert the full monetary amount to a floating-point number.
 */
export function money(
  raw: string,
  locale = "en",
  fraction: 0 | 2 | 6 = 0,
): string {
  const units = BigInt(raw);
  if (![0, 2, 6].includes(fraction)) throw new Error("Unsupported precision");
  const scale = 10n ** BigInt(6 - fraction);
  const absolute = units < 0n ? -units : units;
  const rounded = (absolute + scale / 2n) / scale;
  const denominator = 10n ** BigInt(fraction);
  const major = rounded / denominator;
  const grouped = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(major);
  const sign = units < 0n && rounded !== 0n ? "−" : "";
  if (fraction === 0) return sign + grouped;
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? ".";
  return `${sign}${grouped}${decimal}${(rounded % denominator).toString().padStart(fraction, "0")}`;
}

export function countdown(
  closesAt: number,
  now: number,
): [string, string, string] {
  const left = Math.max(0, closesAt - Math.floor(now / 1000));
  return [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map(
    (v) => String(v).padStart(2, "0"),
  ) as [string, string, string];
}

export function phase(
  draw: Draw,
  now: number,
): "open" | "awaiting" | "settling" | "settled" {
  if (draw.settled) return "settled";
  if (draw.locked) return "settling";
  return draw.closesAt * 1000 <= now ? "awaiting" : "open";
}

/**
 * @cc [label:security] public-rpc-url
 * Only HTTPS RPC endpoints without embedded user credentials may be accepted. Protocol changes,
 * private-network hostnames, fragments, and empty endpoint lists MUST be rejected.
 */
export function parseRpcUrls(value: string[]): string[] {
  if (value.length < 1 || value.length > 4) throw new Error("rpcConfig");
  return [
    ...new Set(
      value.map((raw) => {
        const u = new URL(raw.trim());
        const host = u.hostname.toLowerCase().replace(/\.$/, "");
        const localName =
          /(^|\.)(localhost|local|internal|lan|home|home\.arpa|test|invalid)$/.test(
            host,
          );
        const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host)
          ? host.split(".").map(Number)
          : null;
        const privateIp =
          ipv4 &&
          ([0, 10, 127].includes(ipv4[0]) ||
            ipv4[0] >= 224 ||
            (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
            (ipv4[0] === 169 && ipv4[1] === 254) ||
            (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
            (ipv4[0] === 192 &&
              (ipv4[1] === 168 ||
                (ipv4[1] === 0 && [0, 2].includes(ipv4[2])))) ||
            (ipv4[0] === 198 &&
              ([18, 19].includes(ipv4[1]) ||
                (ipv4[1] === 51 && ipv4[2] === 100))) ||
            (ipv4[0] === 203 && ipv4[1] === 0 && ipv4[2] === 113));
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.hash ||
          u.port ||
          !host.includes(".") ||
          host.includes(":") ||
          localName ||
          privateIp
        )
          throw new Error("rpcConfig");
        return u.toString();
      }),
    ),
  ];
}
