import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  formatUnits,
  isAddress,
  getAddress,
  decodeFunctionData,
  erc20Abi,
  type Address,
} from "viem";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { vaultCopy, type VaultCopyKey } from "./vaultCopy.ts";
import {
  PRODUCTS,
  VAULT_DEPLOYMENTS,
  productChain,
  productDecimals,
  productToken,
  type Product,
} from "./vaultRegistry.ts";
import {
  POSITION_OPERATIONS,
  type PositionOperation,
  vaultAmount,
  requestId,
  readVault,
  readVaultRequest,
  reviewVault,
  vaultEvents,
  type VaultState,
  type VaultReview,
  type VaultOperation,
  type VaultIntent,
  type RequestRecord,
} from "./vaults.ts";
import { WalletConnection, TransactionActivity } from "./WalletPanel.tsx";
import { useWallet } from "./wallet.ts";
import { submitVaultReview } from "./transactions.ts";
import { Modal } from "./Modal.tsx";
import { parseRpcUrls } from "./model.ts";
import { normalNavigation, routeHref, type Route } from "./navigation.ts";
import { chainExplorer } from "./evmClient.ts";

const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
type Copy = ReturnType<typeof vaultCopy>;
const requestOperations = (
  product: Product,
  kind: "deposit" | "exit" = "deposit",
): readonly [VaultOperation, VaultCopyKey][] => {
  const all: readonly [VaultOperation, VaultCopyKey][] = product.endsWith("eth")
    ? [
        ["cancelEntry", "cancelWaiting"],
        ["claimCancelledEntry", "claimWaiting"],
        ["claimCancelledEntryInKind", "claimLender"],
        ["claimEntry", "claimReceipt"],
        ["claimEthExit", "claimCash"],
        ["cancelExit", "cancelExit"],
        ["claimAbortedCash", "claimCash"],
        ["claimAbortedInKind", "claimLender"],
      ]
    : product === "base-usdc"
      ? [
          ["cancelDeposit", "cancelWaiting"],
          ["claimCancelled", "claimWaiting"],
          ["claimCancelledInKind", "claimLender"],
          ["claimDeposit", "claimReceipt"],
          ["claimExit", "claimCash"],
          ["cancelRedeem", "cancelExit"],
        ]
      : [
          ["bridgeDeposit", "bridge"],
          ["requestExit", "exitRemote"],
          ["claimShares", "claimReceipt"],
          ["claimCash", "claimCash"],
          ["finalizeOperation", "closeRequest"],
        ];
  const exits: VaultOperation[] = product.endsWith("eth")
    ? ["claimEthExit", "cancelExit"]
    : product === "base-usdc"
      ? ["claimExit", "cancelRedeem"]
      : ["claimCash", "finalizeOperation"];
  return all.filter(([op]) =>
    kind === "exit"
      ? exits.includes(op)
      : product === "l1-usdc" || !exits.includes(op),
  );
};
const progressOperations = (product: Product): VaultOperation[] =>
  product.endsWith("eth")
    ? [
        "seal",
        "prepare",
        "retrieveEntries",
        "settle",
        "leverage",
        "collectDownstream",
        "repayCash",
        "retrieveCollateral",
        "convertSurplus",
        "emergencySeal",
        "abortEntries",
        "releaseAbortedEntries",
        "releaseAbortedInKind",
      ]
    : product === "base-usdc"
      ? [
          "processDeposits",
          "processRedeems",
          "syncDeposits",
          "syncExits",
          "recoverNative",
        ]
      : [];

function VaultReviewCard({
  review,
  urls,
  locale,
  onClose,
  onSent,
}: {
  review: VaultReview;
  urls: string[];
  locale: Locale;
  onClose: () => void;
  onSent: () => void;
}) {
  const c = clubCopy(locale),
    v = vaultCopy(locale),
    wallet = useWallet(),
    revision = useRef(wallet.revision);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const approval =
    review.call.operation === "approve"
      ? (decodeFunctionData({ abi: erc20Abi, data: review.call.data })
          .args as readonly [Address, bigint])
      : null;
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  const matches =
    wallet.revision === revision.current &&
    wallet.chainId === review.chainId &&
    wallet.account?.toLowerCase() === review.account.toLowerCase();
  return (
    <section
      className="review-card vault-review"
      aria-labelledby="vault-review-title"
      tabIndex={-1}
      ref={(el) => {
        if (el && !el.dataset.focused) {
          el.dataset.focused = "true";
          el.focus();
        }
      }}
    >
      <div className="section-top">
        <h2 id="vault-review-title">
          <ShieldCheck size={23} /> {c("review")}
        </h2>
        <button className="text-button" onClick={onClose}>
          {c("close")}
        </button>
      </div>
      <p>
        {productChain(review.product) === 1 ? "Ethereum" : "Base"} ·{" "}
        {productToken(review.product)}
      </p>
      {review.call.operation === "approve" &&
        review.intent.kind === "deposit" && (
          <p className="inline-notice">{v("approvalStep")}</p>
        )}
      <p>
        <strong>
          {review.intent.kind === "position"
            ? review.intent.operation
            : review.call.operation}
        </strong>
        {(review.intent.kind === "operate" ||
          review.intent.kind === "position") &&
        review.intent.id !== undefined
          ? ` · #${review.intent.id}`
          : ""}
      </p>
      <dl className="review-facts">
        <dt>{c("destination")}</dt>
        <dd>
          <a
            href={`${chainExplorer(review.chainId)}/address/${review.call.to}`}
            target="_blank"
            rel="noreferrer"
          >
            <code>{review.call.to}</code>
          </a>
        </dd>
        <dt>{v("due")}</dt>
        <dd>{formatUnits(review.call.value, 18)} ETH</dd>
        {"amount" in review.intent && review.intent.amount !== undefined && (
          <>
            <dt>
              {review.intent.kind === "redeem" ||
              review.intent.kind === "transfer"
                ? v("exactShares")
                : v("amount")}
            </dt>
            <dd>
              {formatUnits(
                review.intent.amount,
                review.intent.kind === "defend"
                  ? 6
                  : productDecimals(review.product),
              )}{" "}
              {review.intent.kind === "defend"
                ? "USDC"
                : review.intent.kind === "deposit"
                  ? productToken(review.product)
                  : ""}
            </dd>
          </>
        )}
        {review.intent.kind === "defend" && (
          <>
            <dt>{v("defend")}</dt>
            <dd>{v("defenseHelp")}</dd>
            <dt>{v("maximum")}</dt>
            <dd>{formatUnits(review.intent.maxWeth, 18)} Ether</dd>
          </>
        )}
        {approval && (
          <>
            <dt>{v("spender")}</dt>
            <dd>
              <code>{approval[0]}</code>
            </dd>
            <dt>{c("allowance")}</dt>
            <dd>{formatUnits(approval[1], 6)} USDC</dd>
          </>
        )}
        <dt>
          {review.intent.kind === "transfer" ? v("recipient") : v("wallet")}
        </dt>
        <dd>
          <code>
            {review.intent.kind === "transfer"
              ? review.intent.receiver
              : review.account}
          </code>
        </dd>
        <dt>{c("details")}</dt>
        <dd>
          #{review.state.block.toString()} ·{" "}
          {new Date(Number(review.state.timestamp) * 1000).toLocaleString(
            locale,
          )}
        </dd>
      </dl>
      <details>
        <summary>{v("inspect")}</summary>
        <p>
          <code>{review.call.operation}</code>
        </p>
        <pre className="vault-code">{review.call.data}</pre>
      </details>
      {review.state.contractWallet && (
        <p className="inline-notice">{c("contractWallet")}</p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="wallet-buttons">
        <button
          className="button button-primary"
          disabled={busy || !matches || review.state.contractWallet}
          onClick={() => {
            setBusy(true);
            setError("");
            const controller = new AbortController();
            submission.current = controller;
            void submitVaultReview(
              urls,
              review,
              revision.current,
              controller.signal,
            )
              .then(() => {
                if (!controller.signal.aborted) onSent();
              })
              .catch((e) => {
                if (!controller.signal.aborted) setError(errorCopy(locale, e));
              })
              .finally(() => {
                if (!controller.signal.aborted) setBusy(false);
              });
          }}
        >
          {busy ? c("working") : c("sign")} <ArrowUpRight size={17} />
        </button>
      </div>
    </section>
  );
}

function RequestFacts({
  record,
  v,
}: {
  record: RequestRecord;
  v: Copy;
  locale: Locale;
}) {
  const data = record.value;
  const owner = Array.isArray(data)
    ? data[0]
    : data && typeof data === "object" && "owner" in data
      ? data.owner
      : undefined;
  return (
    <div className="vault-request-facts">
      <h3>
        {v("requestId")} #{record.id.toString()}
      </h3>
      {typeof owner === "string" && (
        <p>
          {v("owner")} <code>{owner}</code>
        </p>
      )}
      <small>#{record.block.toString()}</small>
      <details>
        <summary>{v("inspect")}</summary>
        <pre className="vault-code" lang="en">
          {json(data)}
        </pre>
      </details>
    </div>
  );
}

export function VaultWorkspace({
  locale,
  baseUrls,
  route,
  navigate,
}: {
  locale: Locale;
  baseUrls: string[];
  route: Route;
  navigate: (next: Route) => void;
}) {
  const c = clubCopy(locale),
    v = vaultCopy(locale),
    wallet = useWallet();
  const product = route.product ?? "base-usdc",
    chainId = productChain(product),
    eth = product.endsWith("eth"),
    token = productToken(product);
  const deployment = VAULT_DEPLOYMENTS.find((d) => d.product === product)!;
  const ready = deployment.state === "deployed",
    tab = route.vaultView ?? "deposit";
  const [positionOperation, setPositionOperation] =
    useState<PositionOperation>("cancelDeposit");
  const [positionId, setPositionId] = useState("");
  const [defenseAmount, setDefenseAmount] = useState("");
  const [defenseMaximum, setDefenseMaximum] = useState("");
  const [loadedDraftKey, setLoadedDraftKey] = useState("");
  const [amount, setAmount] = useState(""),
    [receiver, setReceiver] = useState(""),
    [draftReady, setDraftReady] = useState(false),
    [storageError, setStorageError] = useState(false);
  const [rpcText, setRpcText] = useState(""),
    [ethereumUrls, setEthereumUrls] = useState<string[]>([]),
    [error, setError] = useState("");
  const [state, setState] = useState<VaultState | null>(null),
    [stateError, setStateError] = useState(false),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<VaultReview | null>(null),
    [draftReview, setDraftReview] = useState(false);
  const [request, setRequest] = useState(route.request ?? ""),
    [kind, setKind] = useState<"deposit" | "exit">(
      route.requestKind ?? "deposit",
    ),
    [record, setRecord] = useState<RequestRecord | null>(null);
  const [operation, setOperation] = useState<VaultOperation>(
      requestOperations(product, kind)[0][0],
    ),
    [operationId, setOperationId] = useState("");
  useEffect(() => {
    setOperation(requestOperations(product, kind)[0][0]);
  }, [product, kind]);
  const [progress, setProgress] = useState<VaultOperation>(
    progressOperations(product)[0] ?? "finalizeOperation",
  );
  const [history, setHistory] = useState<Awaited<
    ReturnType<typeof vaultEvents>
  > | null>(null);
  const generation = useRef(0),
    historyGeneration = useRef(0),
    draftKey = `megapot-club:vault-draft:${product}:${tab === "redeem" ? "redeem" : "deposit"}:v2`;
  const urls = chainId === 1 ? ethereumUrls : baseUrls;
  const canReview =
    !!wallet.account && wallet.chainId === chainId && ready && urls.length > 0;
  const follow = (next: Route) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (normalNavigation(e)) {
      e.preventDefault();
      navigate(next);
    }
  };
  const assetNumber = (n: bigint) => formatUnits(n, productDecimals(product));
  useEffect(() => {
    setDraftReady(false);
    setAmount("");
    setReceiver("");
    try {
      const raw = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (
        raw &&
        typeof raw.amount === "string" &&
        /^[0-9.]{0,80}$/.test(raw.amount)
      )
        setAmount(raw.amount);
      if (
        raw &&
        typeof raw.receiver === "string" &&
        /^0x[0-9a-fA-F]{0,40}$/.test(raw.receiver)
      )
        setReceiver(raw.receiver);
      const saved = JSON.parse(
        localStorage.getItem("megapot-club:ethereum-rpc:v1") ?? "[]",
      );
      if (Array.isArray(saved) && saved.length) {
        const parsed = parseRpcUrls(saved);
        setEthereumUrls(parsed);
        setRpcText(parsed.join("\n"));
      }
    } catch {
      setStorageError(true);
    }
    setLoadedDraftKey(draftKey);
    setDraftReady(true);
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady || loadedDraftKey !== draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ amount, receiver }));
    } catch {
      setStorageError(true);
    }
  }, [amount, receiver, draftReady, draftKey, loadedDraftKey]);
  useEffect(() => {
    setReview(null);
    setState(null);
    setHistory(null);
    setProgress(progressOperations(product)[0] ?? "finalizeOperation");
    setPositionOperation("cancelDeposit");
    setPositionId("");
    setDefenseAmount("");
    setDefenseMaximum("");
    setBusy(false);
    generation.current++;
    historyGeneration.current++;
  }, [wallet.account, product]);
  useEffect(() => {
    setReview(null);
    setBusy(false);
    generation.current++;
    historyGeneration.current++;
  }, [wallet.chainId, wallet.revision, tab, ethereumUrls, baseUrls]);
  useEffect(() => {
    setRequest(route.request ?? "");
    setOperationId(route.request ?? "");
    setKind(route.requestKind ?? "deposit");
    setRecord(null);
    invalidateReview();
  }, [route.request, route.requestKind]);
  useEffect(() => {
    return () => {
      generation.current++;
      historyGeneration.current++;
    };
  }, []);
  async function refresh() {
    if (!wallet.account || !ready || !urls.length) return;
    const run = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await readVault(urls, product, wallet.account);
      if (run === generation.current) {
        setState(value);
        setStateError(false);
      }
    } catch (e) {
      if (run === generation.current) {
        setStateError(true);
        setError(errorCopy(locale, e));
      }
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [
    wallet.account,
    wallet.chainId,
    wallet.revision,
    product,
    ethereumUrls,
    baseUrls,
  ]);
  function invalidateReview() {
    generation.current++;
    setBusy(false);
    setReview(null);
  }
  async function prepare(intent: VaultIntent) {
    setReview(null);
    if (!ready) {
      setDraftReview(true);
      return;
    }
    if (!canReview || !wallet.account) return;
    const run = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const checked = await reviewVault(urls, product, wallet.account, intent);
      if (run === generation.current) setReview(checked);
    } catch (e) {
      if (run === generation.current) setError(errorCopy(locale, e));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  function act(kind: "deposit" | "redeem" | "transfer") {
    try {
      const value = vaultAmount(amount, product);
      if (kind === "transfer") {
        if (!isAddress(receiver)) throw new Error("invalidAmount");
        void prepare({ kind, amount: value, receiver: getAddress(receiver) });
      } else void prepare({ kind, amount: value });
    } catch (e) {
      setError(errorCopy(locale, e));
    }
  }
  async function lookup() {
    if (!ready) return;
    const run = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const found = await readVaultRequest(
        urls,
        product,
        kind,
        requestId(request),
      );
      if (run === generation.current) setRecord(found);
    } catch (e) {
      if (run === generation.current) setError(errorCopy(locale, e));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (route.request && ready && urls.length) void lookup();
  }, [route.request, route.requestKind, ethereumUrls, baseUrls]);
  async function scan(older = false) {
    if (!wallet.account || !ready) return;
    const run = ++historyGeneration.current;
    setBusy(true);
    setError("");
    try {
      const page = await vaultEvents(
        urls,
        product,
        wallet.account,
        older ? history?.next : undefined,
      );
      if (run === historyGeneration.current) setHistory(page);
    } catch (e) {
      if (run === historyGeneration.current) setError(errorCopy(locale, e));
    } finally {
      if (run === historyGeneration.current) setBusy(false);
    }
  }
  const lots =
    product === "base-usdc" &&
    ["claimDeposit", "claimExit"].includes(operation);
  return (
    <div className="vault-workspace">
      <section className="vault-intro">
        <div className="eyebrow">{c("vaults")}</div>
        <h2>{v("shared")}</h2>
        <div className="vault-grid">
          {PRODUCTS.map((p) => {
            const next: Route = {
              ...route,
              view: "lp",
              tab: "vaults",
              product: p,
              request: undefined,
              requestKind: undefined,
            };
            const live =
              VAULT_DEPLOYMENTS.find((d) => d.product === p)?.state ===
              "deployed";
            return (
              <a
                className={`vault-card ${p === product ? "selected" : ""}`}
                key={p}
                href={routeHref(next)}
                onClick={follow(next)}
                aria-current={p === product ? "page" : undefined}
              >
                <span className="eyebrow">
                  {productChain(p) === 1 ? "Ethereum" : "Base"}
                </span>
                <strong>{productToken(p)}</strong>
                <span>
                  {live ? v("running") : c("notDeployed").split(" ·")[0]}
                </span>
                <ArrowUpRight size={18} />
              </a>
            );
          })}
        </div>
      </section>
      <section className="action-card vault-overview">
        <div className="vault-mark">{eth ? "Ξ" : "$"}</div>
        <div>
          <h2>
            {chainId === 1 ? "Ethereum" : "Base"} · {token}
          </h2>
          <p>{v(eth ? "ethStory" : "usdcStory")}</p>
          {chainId === 1 && <p>{v("bridgeStory")}</p>}
          <details>
            <summary>{c("details")}</summary>
            <p>{v("risks")}</p>
            {ready && (
              <a
                href={`${chainExplorer(chainId)}/address/${deployment.vault.address}`}
                target="_blank"
                rel="noreferrer"
              >
                <code>{deployment.vault.address}</code>{" "}
                <ArrowUpRight size={15} />
              </a>
            )}
          </details>
        </div>
      </section>
      {!ready && (
        <div className="inline-notice vault-launch">
          <ShieldCheck size={20} />
          <p>{v("launch")}</p>
          <a
            href={routeHref({ view: "lp", tab: "position" })}
            onClick={follow({ view: "lp", tab: "position" })}
          >
            {c("position")} <ArrowUpRight size={16} />
          </a>
        </div>
      )}
      <nav className="workspace-tabs vault-tabs" aria-label={c("vaults")}>
        {(["deposit", "redeem", "requests", "activity", "manage"] as const).map(
          (t) => {
            const next: Route = { ...route, vaultView: t };
            return (
              <a
                key={t}
                href={routeHref(next)}
                onClick={follow(next)}
                aria-current={tab === t ? "page" : undefined}
              >
                {t === "deposit"
                  ? v("deposit")
                  : t === "redeem"
                    ? v("withdraw")
                    : t === "activity"
                      ? c("activity")
                      : v(t)}
              </a>
            );
          },
        )}
      </nav>
      <section className="action-card">
        <div className="section-top">
          <h2>{v("wallet")}</h2>
          {ready && wallet.account && (
            <button
              className="icon-button"
              aria-label={c("refresh")}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={18} />
            </button>
          )}
        </div>
        <WalletConnection locale={locale} urls={urls} chainId={chainId} />
        {chainId === 1 && (
          <details className="vault-rpc" open={!ethereumUrls.length}>
            <summary>{v("rpc")}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const parsed = parseRpcUrls(
                    rpcText.split(/\r?\n/).filter(Boolean),
                  );
                  if (!parsed.length) throw new Error("rpcUnavailable");
                  setEthereumUrls(parsed);
                  invalidateReview();
                  try {
                    localStorage.setItem(
                      "megapot-club:ethereum-rpc:v1",
                      JSON.stringify(parsed),
                    );
                  } catch {
                    setStorageError(true);
                  }
                } catch (e) {
                  setError(errorCopy(locale, e));
                }
              }}
            >
              <label>
                {v("rpc")}
                <textarea
                  value={rpcText}
                  onChange={(e) => setRpcText(e.target.value)}
                  maxLength={5000}
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <p className="fine-print">{v("rpcHelp")}</p>
              <button className="button button-outline" type="submit">
                <Check size={16} />
                {v("save")}
              </button>
            </form>
          </details>
        )}
        {state && (
          <>
            <div className="wallet-balances">
              <div>
                <span>{c("walletBalance")}</span>
                <strong>
                  {assetNumber(eth ? state.ether : state.balance)} {token}
                </strong>
              </div>
              <div>
                <span>{v("exactShares")}</span>
                <strong>{assetNumber(state.shares)}</strong>
              </div>
            </div>
            <p className={`fine-print ${stateError ? "form-error" : ""}`}>
              {v(state.phase)} · #{state.block.toString()} ·{" "}
              {new Date(Number(state.timestamp) * 1000).toLocaleString(locale)}
            </p>
            {state.debt !== undefined && (
              <p className="fine-print">
                {v("debt")}: {formatUnits(state.debt, 6)} USDC
              </p>
            )}
          </>
        )}
      </section>
      {error && (
        <p className="form-error inline-notice" role="alert">
          {error}
        </p>
      )}
      {storageError && (
        <p className="form-error" role="status">
          {c("storageFailed")}
        </p>
      )}
      {busy && (
        <p role="status" className="fine-print">
          <RefreshCw size={15} className="spinning" /> {c("working")}
        </p>
      )}
      {review && (
        <VaultReviewCard
          key={review.createdAt}
          review={review}
          locale={locale}
          urls={urls}
          onClose={() => setReview(null)}
          onSent={() => {
            setReview(null);
            navigate({ ...route, vaultView: "activity" });
            void refresh();
          }}
        />
      )}
      {(tab === "deposit" || tab === "redeem") && (
        <section className="action-card vault-form">
          <div className="section-top">
            <h2>
              {tab === "deposit" ? v("deposit") : v("withdraw")} {token}
            </h2>
            <ArrowDownToLine size={23} />
          </div>
          <p>{tab === "deposit" ? v("steps") : v("exitSteps")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(tab === "deposit" ? "deposit" : "redeem");
            }}
          >
            <label htmlFor="vault-amount">
              {tab === "deposit" ? v("amount") : v("exactShares")}
            </label>
            <div className="vault-amount">
              <input
                id="vault-amount"
                inputMode="decimal"
                autoComplete="off"
                value={loadedDraftKey === draftKey ? amount : ""}
                placeholder="0.00"
                onChange={(e) => {
                  setAmount(e.target.value);
                  invalidateReview();
                }}
                maxLength={80}
              />
              <span>{tab === "deposit" ? token : v("receipt")}</span>
            </div>
            {draftReady &&
              loadedDraftKey === draftKey &&
              !storageError &&
              amount && <p className="fine-print">{v("draft")}</p>}
            {eth && tab === "deposit" && (
              <p className="fine-print">{v("wrapped")}</p>
            )}
            <button
              className="button button-primary"
              disabled={
                busy ||
                loadedDraftKey !== draftKey ||
                !amount ||
                (ready && !canReview)
              }
              type="submit"
            >
              {c("review")} <ChevronRight size={18} />
            </button>
          </form>
          {tab === "redeem" && (
            <details className="vault-transfer">
              <summary>{v("transfer")}</summary>
              <label>
                {v("recipient")}
                <input
                  value={receiver}
                  onChange={(e) => {
                    setReceiver(e.target.value);
                    invalidateReview();
                  }}
                  placeholder="0x…"
                  maxLength={42}
                  autoComplete="off"
                />
              </label>
              <button
                className="button button-outline"
                disabled={busy || !canReview || !amount || !isAddress(receiver)}
                onClick={() => act("transfer")}
              >
                {c("review")}
              </button>
            </details>
          )}
        </section>
      )}
      {tab === "requests" && (
        <section className="action-card">
          <h2>{v("requests")}</h2>
          <form
            className="vault-lookup"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const id = requestId(request);
                navigate({
                  ...route,
                  request: id.toString(),
                  requestKind: kind,
                });
                void lookup();
              } catch (e) {
                setError(errorCopy(locale, e));
              }
            }}
          >
            <label>
              {v("requestKind")}
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as "deposit" | "exit");
                  invalidateReview();
                }}
              >
                <option value="deposit">{v("deposit")}</option>
                <option value="exit">{v("withdraw")}</option>
              </select>
            </label>
            <label>
              {v("requestId")}
              <input
                value={request}
                onChange={(e) => {
                  setRequest(e.target.value);
                  invalidateReview();
                }}
                inputMode="numeric"
                maxLength={78}
                placeholder="1"
              />
            </label>
            <button
              type="submit"
              className="button button-outline"
              disabled={!request || busy}
            >
              {v("lookup")}
            </button>
          </form>
          {record && <RequestFacts record={record} locale={locale} v={v} />}
          <div className="vault-request-actions">
            <label>
              {c("recovery")}
              <select
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value as VaultOperation);
                  setOperationId(
                    product === "base-usdc" &&
                      ["claimDeposit", "claimExit"].includes(e.target.value)
                      ? ""
                      : request,
                  );
                  invalidateReview();
                }}
              >
                {requestOperations(product, kind).map(([op, label]) => (
                  <option key={op} value={op}>
                    {v(label)} · {op}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {v(lots ? "lot" : "requestId")}
              <input
                value={operationId}
                onChange={(e) => {
                  setOperationId(e.target.value);
                  invalidateReview();
                }}
                maxLength={78}
                inputMode="numeric"
                placeholder="1"
              />
            </label>
            <button
              className="button button-primary"
              disabled={!canReview || busy || !operationId}
              onClick={() => {
                try {
                  void prepare({
                    kind: "operate",
                    operation,
                    id: requestId(operationId),
                  });
                } catch (e) {
                  setError(errorCopy(locale, e));
                }
              }}
            >
              {c("review")} <ChevronRight size={17} />
            </button>
          </div>
        </section>
      )}
      {tab === "activity" && (
        <>
          <TransactionActivity
            locale={locale}
            urls={urls}
            chainId={chainId}
            account={wallet.account ?? undefined}
          />
          <section className="action-card">
            <div className="section-top">
              <h2>{v("history")}</h2>
              <button
                className="button button-outline"
                disabled={!canReview || busy}
                onClick={() => void scan()}
              >
                <RefreshCw size={16} />
                {c("refresh")}
              </button>
            </div>
            {history && (
              <>
                <p className="fine-print">
                  {v("coverage")}: {history.from.toString()}–
                  {history.to.toString()}
                </p>
                {!history.events.length && <p>{v("noHistory")}</p>}
                <div className="transaction-list">
                  {history.events.map((event) => (
                    <article
                      key={`${event.hash}:${event.index}`}
                      className="transaction-row"
                    >
                      <div>
                        <strong>{event.name}</strong>
                        <code>{json(event.args)}</code>
                      </div>
                      <a
                        href={`${chainExplorer(chainId)}/tx/${event.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={c("transactionHash")}
                      >
                        <ArrowUpRight size={18} />
                      </a>
                    </article>
                  ))}
                </div>
                {history.next !== undefined && (
                  <button
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => void scan(true)}
                  >
                    {v("older")}
                  </button>
                )}
              </>
            )}
          </section>
        </>
      )}
      {tab === "manage" && (
        <section className="action-card">
          <h2>{v("manage")}</h2>
          <p>{v("progressHelp")}</p>
          {progressOperations(product).length > 0 && (
            <>
              <label>
                {v("inspect")}
                <select
                  value={progress}
                  onChange={(e) => {
                    setProgress(e.target.value as VaultOperation);
                    invalidateReview();
                  }}
                >
                  {progressOperations(product).map((op) => (
                    <option key={op}>{op}</option>
                  ))}
                </select>
              </label>
              <button
                className="button button-primary"
                disabled={!canReview || busy}
                onClick={() =>
                  void prepare({ kind: "operate", operation: progress })
                }
              >
                {c("review")}
              </button>
            </>
          )}
          {eth && (
            <>
              <details>
                <summary>{v("position")}</summary>
                <label>
                  {v("inspect")}
                  <select
                    value={positionOperation}
                    onChange={(e) => {
                      setPositionOperation(e.target.value as PositionOperation);
                      invalidateReview();
                    }}
                  >
                    {POSITION_OPERATIONS.filter((op) =>
                      product === "base-eth"
                        ? !op.startsWith("collectRemote")
                        : ![
                            "retrieveWaiting",
                            "claimDepositLot",
                            "claimExitLot",
                            "recoverLockedRedeem",
                          ].includes(op),
                    ).map((op) => (
                      <option key={op}>{op}</option>
                    ))}
                  </select>
                </label>
                {positionOperation !== "startRedeem" && (
                  <label>
                    {v("requestId")} / {v("lot")}
                    <input
                      inputMode="numeric"
                      value={positionId}
                      maxLength={78}
                      onChange={(e) => {
                        setPositionId(e.target.value);
                        invalidateReview();
                      }}
                    />
                  </label>
                )}
                <button
                  className="button button-outline"
                  disabled={!canReview || busy}
                  onClick={() => {
                    try {
                      void prepare({
                        kind: "position",
                        operation: positionOperation,
                        ...(positionOperation !== "startRedeem"
                          ? { id: requestId(positionId) }
                          : {}),
                      });
                    } catch (e) {
                      setError(errorCopy(locale, e));
                    }
                  }}
                >
                  {c("review")}
                </button>
              </details>
              <details>
                <summary>{v("defend")}</summary>
                <p>{v("defenseHelp")}</p>
                <label>
                  USDC
                  <input
                    inputMode="decimal"
                    value={defenseAmount}
                    maxLength={80}
                    onChange={(e) => {
                      setDefenseAmount(e.target.value);
                      invalidateReview();
                    }}
                  />
                </label>
                <label>
                  {v("maximum")}
                  <input
                    inputMode="decimal"
                    value={defenseMaximum}
                    maxLength={80}
                    onChange={(e) => {
                      setDefenseMaximum(e.target.value);
                      invalidateReview();
                    }}
                  />
                </label>
                <button
                  className="button button-outline"
                  disabled={!canReview || busy}
                  onClick={() => {
                    try {
                      void prepare({
                        kind: "defend",
                        amount: vaultAmount(defenseAmount, "base-usdc"),
                        maxWeth: vaultAmount(defenseMaximum, "base-eth"),
                      });
                    } catch (e) {
                      setError(errorCopy(locale, e));
                    }
                  }}
                >
                  {c("review")}
                </button>
              </details>
            </>
          )}
          {!eth && (
            <button
              className="button button-outline"
              disabled={!canReview || busy}
              onClick={() => void prepare({ kind: "revoke" })}
            >
              {c("revoke")}
            </button>
          )}
          {product === "base-usdc" && (
            <button
              className="button button-outline"
              disabled={!canReview || busy || !state?.shares}
              onClick={() =>
                void prepare({
                  kind: "operate",
                  operation: "redeemRecovered",
                  amount: state!.shares,
                })
              }
            >
              {c("emergencyExit")}
            </button>
          )}
          {eth && state?.phase === "stopped" && (
            <button
              className="button button-outline"
              disabled={!canReview || busy || !state.shares}
              onClick={() =>
                void prepare({
                  kind: "operate",
                  operation: "burnWorthless",
                  amount: state.shares,
                })
              }
            >
              burnWorthless · {c("review")}
            </button>
          )}
        </section>
      )}
      {draftReview && (
        <Modal
          title={tab === "redeem" ? v("withdraw") : v("reviewDraft")}
          closeLabel={c("close")}
          onClose={() => setDraftReview(false)}
        >
          <div className="vault-draft-review">
            <strong>
              {amount} {tab === "redeem" ? v("receipt") : token} ·{" "}
              {chainId === 1 ? "Ethereum" : "Base"}
            </strong>
            <p>{v(tab === "redeem" ? "exitSteps" : "steps")}</p>
            <p>{v(eth ? "ethStory" : "usdcStory")}</p>
            {eth && <p>{v("wrapped")}</p>}
            <p className="inline-notice">{v("launch")}</p>
            <button
              className="button button-outline"
              onClick={() => setDraftReview(false)}
            >
              {c("close")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
