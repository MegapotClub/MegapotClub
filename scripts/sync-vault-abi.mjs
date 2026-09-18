import { readFileSync, writeFileSync } from "node:fs";
const built = JSON.parse(
  readFileSync(".contract-build/artifacts.json", "utf8"),
);
const names = [
  "BaseUsdcVault",
  "EthereumUsdcVault",
  "SharedEthVault",
  "WaitingEscrow",
  "ServicePosition",
  "BaseInbox",
  "KeeperBudget",
];
const selected = Object.fromEntries(
  names.map((name) => [name, built.contracts[name].abi]),
);
writeFileSync("src/vaultAbi.json", JSON.stringify(selected));
console.log(
  `Synchronized ${names.length} ABIs from compiler input ${built.inputHash}`,
);
