import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";
import { createHash } from "node:crypto";

export function compileContracts({ mocks = false } = {}) {
  const sources = {};
  const visit = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.posix.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (file.endsWith(".sol"))
        sources[file] = { content: readFileSync(file, "utf8") };
    }
  };
  visit("contracts");
  if (mocks) visit("tests/contracts");
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "storageLayout",
          ],
        },
      },
    },
  };
  const resolvedImports = {};
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (file) => {
        if (!file.startsWith("@openzeppelin/contracts/") || file.includes(".."))
          return { error: `Unapproved import: ${file}` };
        const contents = readFileSync(path.join("node_modules", file), "utf8");
        resolvedImports[file] = { content: contents };
        return { contents };
      },
    }),
  );
  for (const e of output.errors ?? []) {
    if (e.severity === "error") throw new Error(e.formattedMessage);
    process.stderr.write(e.formattedMessage);
  }
  const contracts = {};
  for (const [file, entries] of Object.entries(output.contracts))
    for (const [name, artifact] of Object.entries(entries)) {
      const bytes = artifact.evm.deployedBytecode.object.length / 2;
      if (bytes > 24576)
        throw new Error(`${name}: deployed code ${bytes} exceeds EIP-170`);
      if (file.startsWith("contracts/") || file.startsWith("tests/"))
        contracts[name] = { ...artifact, file, deployedBytes: bytes };
    }
  return {
    compiler: solc.version(),
    evmVersion: input.settings.evmVersion,
    inputHash: createHash("sha256")
      .update(
        JSON.stringify({
          ...input,
          sources: Object.fromEntries(
            Object.entries({ ...input.sources, ...resolvedImports }).sort(
              ([a], [b]) => a.localeCompare(b),
            ),
          ),
        }),
      )
      .digest("hex"),
    contracts,
  };
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const result = compileContracts();
  mkdirSync(".contract-build", { recursive: true });
  writeFileSync(
    ".contract-build/artifacts.json",
    JSON.stringify(result, null, 2),
  );
  for (const [name, c] of Object.entries(result.contracts))
    if (c.deployedBytes)
      console.log(`${name}: ${c.deployedBytes} deployed bytes`);
}
