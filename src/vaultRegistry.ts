import { getAddress, isAddress, type Address, type Hex } from "viem";
import manifest from "./vaultDeployments.json" with { type: "json" };
import type { VaultChain } from "./evmClient.ts";

export const PRODUCTS = ["base-usdc", "base-eth", "l1-usdc", "l1-eth"] as const;
export type Product = (typeof PRODUCTS)[number];
export const productChain = (product: Product): VaultChain =>
  product.startsWith("base") ? 8453 : 1;
export const productDecimals = (product: Product) =>
  product.endsWith("eth") ? 18 : 6;
export const productToken = (product: Product) =>
  product.endsWith("eth") ? "Ether" : "USDC";
export type CodePin = {
  address: Address;
  codeHash: Hex;
  aggregator?: { address: Address; codeHash: Hex };
  implementation?: { slot: Hex; address: Address; codeHash: Hex };
};
export type ReadyVault = {
  product: Product;
  state: "deployed";
  chainId: VaultChain;
  vault: CodePin;
  asset: CodePin;
  dependencies: CodePin[];
  deployedAtBlock: bigint;
};
export type VaultDeployment =
  | ReadyVault
  | { product: Product; state: "undeployed" };
const uint = (v: unknown) =>
  typeof v === "string" &&
  /^(0|[1-9]\d{0,77})$/.test(v) &&
  BigInt(v) < 2n ** 256n;
const hash = (v: unknown): v is Hex =>
  typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0+$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function pin(value: unknown): CodePin {
  if (
    !object(value) ||
    typeof value.address !== "string" ||
    !isAddress(value.address) ||
    /^0x0{40}$/i.test(value.address) ||
    !hash(value.codeHash)
  )
    throw new Error("invalidDeployment");
  const result: CodePin = {
    address: getAddress(value.address),
    codeHash: value.codeHash,
  };
  if (value.aggregator !== undefined) {
    if (!object(value.aggregator)) throw new Error("invalidDeployment");
    const a = pin({
      address: value.aggregator.address,
      codeHash: value.aggregator.codeHash,
    });
    result.aggregator = { address: a.address, codeHash: a.codeHash };
  }
  if (value.implementation !== undefined) {
    const i = value.implementation;
    if (!object(i) || !hash(i.slot)) throw new Error("invalidDeployment");
    const inner = pin({ address: i.address, codeHash: i.codeHash });
    result.implementation = { ...inner, slot: i.slot };
  }
  return result;
}

/** @cc [label:security] compiled-deployment-allowlist
 * Only reviewed deployments bundled in the release may receive vault transactions.
 * URLs, storage and RPC data MUST NOT install a vault, asset or implementation identity.
 */
export function parseDeployments(value: unknown): VaultDeployment[] {
  if (
    !object(value) ||
    value.schema !== 1 ||
    !Array.isArray(value.deployments) ||
    value.deployments.length !== 4
  )
    throw new Error("invalidDeployment");
  const seen = new Set<string>();
  return value.deployments.map((item) => {
    if (
      !object(item) ||
      !PRODUCTS.includes(item.product as Product) ||
      seen.has(String(item.product))
    )
      throw new Error("invalidDeployment");
    const product = item.product as Product;
    seen.add(product);
    if (item.state === "undeployed") return { product, state: "undeployed" };
    if (
      item.state !== "deployed" ||
      item.chainId !== productChain(product) ||
      !uint(item.deployedAtBlock) ||
      !Array.isArray(item.dependencies) ||
      item.dependencies.length === 0 ||
      item.dependencies.length > 24
    )
      throw new Error("invalidDeployment");
    return {
      product,
      state: "deployed",
      chainId: productChain(product),
      vault: pin(item.vault),
      asset: pin(item.asset),
      dependencies: item.dependencies.map(pin),
      deployedAtBlock: BigInt(item.deployedAtBlock as string),
    };
  });
}
export const VAULT_DEPLOYMENTS = parseDeployments(manifest);
export function deployedVault(product: Product): ReadyVault {
  const found = VAULT_DEPLOYMENTS.find((v) => v.product === product);
  if (!found || found.state !== "deployed") throw new Error("notDeployed");
  return found;
}
