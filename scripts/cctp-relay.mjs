/** Optional operator tooling. Exact unsigned calls only; no private keys, wallet access or broadcasting. */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { encodeFunctionData, getAddress, isAddress, keccak256 } from "viem";
import { compileContracts } from "./compile-contracts.mjs";
import {
  buildDeploymentPlan,
  clientFor,
  codePin,
  assertReviewedPins,
  externalAddresses,
} from "./vault-deployment.mjs";
const stringify = (v) =>
  JSON.stringify(v, (_, n) => (typeof n === "bigint" ? n.toString() : n), 2);
export function relayCall(abi, to, message, attestation) {
  if (
    typeof message !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(message) ||
    ![404, 632].includes((message.length - 2) / 2)
  )
    throw new Error("Unsupported CCTP message shape");
  if (
    typeof attestation !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2}){65,4096}$/.test(attestation)
  )
    throw new Error("Missing or invalid attestation");
  const method = message.length === 1266 ? "relayAsset" : "relayControl";
  return {
    to: getAddress(to),
    value: "0",
    data: encodeFunctionData({
      abi,
      functionName: method,
      args: [message, attestation],
    }),
    method,
  };
}
const INBOX_ACTIONS = new Set([
  "invest",
  "cancelWaiting",
  "retrieveWaiting",
  "claimDepositLot",
  "startRedeem",
  "claimExitLot",
  "recoverLockedRedeem",
  "closeRedeem",
  "returnCash",
  "closeOperation",
  "announceStop",
]);
export function inboxCall(abi, to, operation, id) {
  if (!INBOX_ACTIONS.has(operation))
    throw new Error("Unsupported inbox operation");
  let args = [];
  if (operation !== "announceStop") {
    if (
      typeof id !== "string" ||
      !/^([1-9]\d{0,77})$/.test(id) ||
      BigInt(id) >= 2n ** 256n
    )
      throw new Error("Invalid operation/request/lot ID");
    args = [BigInt(id)];
    if (operation === "returnCash") args.push(2n ** 256n - 1n);
  }
  return {
    to: getAddress(to),
    value: "0",
    data: encodeFunctionData({ abi, functionName: operation, args }),
    method: operation,
  };
}
export async function fetchAttestations(sourceDomain, hash) {
  if (![0, 6].includes(sourceDomain) || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error("Invalid source domain or transaction hash");
  const response = await fetch(
    `https://iris-api.circle.com/v2/messages/${sourceDomain}?transactionHash=${hash}`,
    { signal: AbortSignal.timeout(20000), redirect: "error" },
  );
  if (!response.ok)
    throw new Error(
      "Circle attestation service could not return this transaction",
    );
  const raw = await response.text();
  if (raw.length > 1_000_000)
    throw new Error("Attestation response exceeds bound");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.messages) || data.messages.length > 100)
    throw new Error("Invalid Circle response");
  return {
    sourceDomain,
    transactionHash: hash,
    messages: data.messages.map((m) => ({
      status: m.status,
      message: m.message,
      attestation: m.attestation,
    })),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "fetch") {
      const [domain, hash, out] = args;
      if (!out)
        throw new Error(
          "fetch requires sourceDomain transactionHash output.json",
        );
      writeFileSync(
        out,
        stringify(await fetchAttestations(Number(domain), hash)) + "\n",
      );
    } else {
      const [planFile, manifestFile, chainText, account, inputFile, out] = args;
      if (!["relay", "inbox"].includes(mode) || !out || !isAddress(account))
        throw new Error(
          "relay|inbox requires plan.json manifest.json chainId caller input.json output.json",
        );
      const id = Number(chainText);
      if (![1, 8453].includes(id) || (mode === "inbox" && id !== 8453))
        throw new Error("Wrong operation chain");
      const compilation = compileContracts(),
        plan = JSON.parse(readFileSync(planFile, "utf8")),
        manifest = JSON.parse(readFileSync(manifestFile, "utf8")),
        input = JSON.parse(readFileSync(inputFile, "utf8"));
      if (
        stringify(buildDeploymentPlan(plan.config, compilation)) !==
        stringify(plan)
      )
        throw new Error("Deployment plan does not match current source");
      const c = clientFor(id),
        b = await c.getBlock();
      if (
        (await c.getChainId()) !== id ||
        Date.now() / 1000 - Number(b.timestamp) > 120 ||
        Number(b.timestamp) > Date.now() / 1000 + 30
      )
        throw new Error("Wrong or stale chain observation");
      const target =
        id === 8453 ? plan.addresses.baseInbox : plan.addresses.l1Usdc;
      const pins = manifest.deployments
        .filter((d) => d.chainId === id && d.state === "deployed")
        .flatMap((d) => [d.vault, d.asset, ...d.dependencies]);
      const reviewed = pins.find(
        (p) => p.address.toLowerCase() === target.toLowerCase(),
      );
      if (!reviewed)
        throw new Error("Route is not activated in the reviewed manifest");
      const actual = await codePin(c, target, b.number);
      if (stringify(actual) !== stringify(reviewed))
        throw new Error("Route code changed");
      assertReviewedPins(
        plan.config,
        id,
        await Promise.all(
          externalAddresses(plan.config, id).map((a) =>
            codePin(c, a, b.number),
          ),
        ),
      );
      const abi =
        compilation.contracts[id === 8453 ? "BaseInbox" : "EthereumUsdcVault"]
          .abi;
      const call =
        mode === "relay"
          ? relayCall(abi, target, input.message, input.attestation)
          : inboxCall(abi, target, input.operation, input.id);
      const result = await c.call({
        account: getAddress(account),
        to: call.to,
        data: call.data,
        value: 0n,
        blockNumber: b.number,
      });
      const gas = await c.estimateGas({
        account: getAddress(account),
        to: call.to,
        data: call.data,
        value: 0n,
      });
      if ((await c.getBlock({ blockNumber: b.number })).hash !== b.hash)
        throw new Error("Observation changed");
      writeFileSync(
        out,
        stringify({
          schema: 1,
          kind: "unsigned-operator-review",
          chainId: id,
          from: getAddress(account),
          ...call,
          gas: gas.toString(),
          observedAtBlock: b.number,
          blockHash: b.hash,
          simulationHash: keccak256(result.data ?? "0x"),
        }) + "\n",
      );
    }
    console.log("Saved review data. No transaction was signed or broadcast.");
  } catch (error) {
    console.error(
      (error.shortMessage ?? error.message ?? "Operator check failed").split(
        "\n",
      )[0],
    );
    process.exitCode = 1;
  }
}
