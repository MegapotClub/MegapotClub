import {
  createTransport,
  http,
  type EIP1193RequestFn,
  type HttpTransportConfig,
  type Transport,
} from "viem";

type Job = { run(): void; fail(error: Error): void; signal?: AbortSignal };
type Budget = {
  active: number;
  next: number;
  blockedUntil: number;
  queue: Job[];
  timer?: ReturnType<typeof setTimeout>;
};
const budgets = new Map<string, Budget>();
const GAP_MS = 250;
const COOLDOWN_MS = 30_000;

function budgetFor(url: string) {
  // Different paths and API keys at one provider still share its capacity.
  const origin = new URL(url).origin;
  let budget = budgets.get(origin);
  if (!budget) {
    budget = { active: 0, next: 0, blockedUntil: 0, queue: [] };
    budgets.set(origin, budget);
  }
  return budget;
}
function drain(budget: Budget) {
  clearTimeout(budget.timer);
  budget.timer = undefined;
  while (budget.queue.length) {
    const first = budget.queue[0];
    if (first.signal?.aborted || budget.blockedUntil > Date.now()) {
      budget.queue.shift();
      first.fail(
        new Error(first.signal?.aborted ? "rpcCancelled" : "rpcCoolingDown"),
      );
      continue;
    }
    if (budget.active >= 2) return;
    const delay = budget.next - Date.now();
    if (delay > 0) {
      budget.timer = setTimeout(() => drain(budget), delay);
      return;
    }
    budget.queue.shift();
    budget.active++;
    budget.next = Date.now() + GAP_MS;
    first.run();
  }
}

/**
 * @cc [label:resilience] shared-rpc-budget
 * App RPC clients at one origin MUST share a maximum of two in-flight requests
 * and 250ms between starts. HTTP 429/503 MUST suppress queued and subsequent
 * requests for at least Retry-After (30 seconds when absent). No transport
 * retries, cache substitutions, account prompts or transaction submissions.
 * viem owns RPC encoding, decoding, timeouts and response-size limits.
 */
export function rpcHttp(
  url: string,
  options: HttpTransportConfig = {},
): Transport {
  return (parameters) => {
    const budget = budgetFor(url);
    const transport = http(url, {
      ...options,
      batch: false,
      retryCount: 0,
      timeout: options.timeout ?? 12_000,
      fetchOptions: {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        ...options.fetchOptions,
      },
      async onFetchRequest(request, init) {
        const result = await options.onFetchRequest?.(request, init);
        // Anchor spacing to the actual HTTP start, including busy event loops.
        budget.next = Date.now() + GAP_MS;
        return result;
      },
      async onFetchResponse(response) {
        if (response.status === 429 || response.status === 503) {
          const value = response.headers.get("retry-after");
          const seconds =
            value !== null && /^\d+(?:\.\d+)?$/.test(value)
              ? Number(value)
              : NaN;
          const date = value === null ? NaN : Date.parse(value);
          const delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Number.isFinite(date)
              ? date - Date.now()
              : COOLDOWN_MS;
          budget.blockedUntil = Math.max(
            budget.blockedUntil,
            Date.now() + Math.max(COOLDOWN_MS, delay),
          );
          drain(budget);
        }
        await options.onFetchResponse?.(response);
      },
    })(parameters);
    return createTransport(
      {
        key: "budgetedHttp",
        name: "Budgeted viem HTTP",
        type: "http",
        retryCount: 0,
        // Preserve viem's generic method/result correspondence across the queue.
        request: ((
          args: Parameters<EIP1193RequestFn>[0],
          requestOptions?: Parameters<EIP1193RequestFn>[1],
        ) =>
          new Promise<unknown>((resolve, reject) => {
            if (budget.queue.length >= 100) {
              reject(new Error("rpcBusy"));
              return;
            }
            const parent =
              requestOptions?.signal ?? options.fetchOptions?.signal;
            const controller = new AbortController();
            let started = false,
              settled = false;
            const finish = (error?: unknown, value?: unknown) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              parent?.removeEventListener("abort", cancel);
              const index = budget.queue.indexOf(job);
              if (index >= 0) budget.queue.splice(index, 1);
              if (started) budget.active--;
              if (error) reject(error);
              else resolve(value);
              drain(budget);
            };
            const cancel = () => {
              controller.abort();
              finish(new Error("rpcCancelled"));
            };
            const job: Job = {
              signal: controller.signal,
              fail: (error) => finish(error),
              run: () => {
                started = true;
                void transport
                  .request(args, {
                    ...requestOptions,
                    signal: controller.signal,
                  })
                  .then(
                    (value) => finish(undefined, value),
                    (error) => finish(error),
                  );
              },
            };
            // viem's HTTP timeout ends at response headers. Bound queueing and
            // body consumption too, and abort fetch before releasing capacity.
            const timer = setTimeout(cancel, options.timeout ?? 12_000);
            parent?.addEventListener("abort", cancel, { once: true });
            if (parent?.aborted) cancel();
            else {
              budget.queue.push(job);
              drain(budget);
            }
          })) as EIP1193RequestFn,
      },
      transport.value,
    );
  };
}
