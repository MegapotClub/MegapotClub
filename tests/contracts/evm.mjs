import { createVM } from "@ethereumjs/vm";
import { createBlock } from "@ethereumjs/block";
import { Common, Mainnet, Hardfork } from "@ethereumjs/common";
import {
  createAccount,
  createAddressFromString,
  bytesToHex,
  hexToBytes,
} from "@ethereumjs/util";
import {
  encodeDeployData,
  encodeFunctionData,
  decodeFunctionResult,
  decodeErrorResult,
} from "viem";

export async function createHarness(compilation, options = {}) {
  const common =
    options.common ?? new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
  const vm = await createVM({
    common,
    ...(options.stateManager ? { stateManager: options.stateManager } : {}),
  });
  let timestamp = options.timestamp ?? 1_800_000_000n;
  const accounts = Array.from(
    { length: 6 },
    (_, i) => `0x${(BigInt(i) + 0xa000n).toString(16).padStart(40, "0")}`,
  );
  for (const addr of accounts)
    await vm.stateManager.putAccount(
      createAddressFromString(addr),
      createAccount({ balance: 10n ** 30n }),
    );
  const [alice, bob, carol, keeper, attacker] = accounts;
  const gas = [];
  async function run({
    caller = alice,
    to,
    data,
    value = 0n,
    label,
    isStatic = false,
  }) {
    const result = await vm.evm.runCall({
      caller: createAddressFromString(caller),
      ...(to ? { to: createAddressFromString(to) } : {}),
      data: hexToBytes(data),
      value,
      gasLimit: 30_000_000n,
      isStatic,
      block: createBlock(
        {
          header: {
            timestamp,
            number: options.blockNumber ?? 100n,
            gasLimit: 30_000_000n,
          },
        },
        { common },
      ),
    });
    const hex = bytesToHex(result.execResult.returnValue);
    if (result.execResult.exceptionError) {
      let reason = hex;
      for (const artifact of Object.values(compilation.contracts)) {
        try {
          const e = decodeErrorResult({ abi: artifact.abi, data: hex });
          reason = `${e.errorName}(${(e.args ?? []).join(",")})`;
          break;
        } catch {}
      }
      throw new Error(
        `${label}: ${result.execResult.exceptionError.error}: ${reason}`,
      );
    }
    if (!isStatic)
      gas.push({ label, gas: result.execResult.executionGasUsed.toString() });
    return { result, hex };
  }
  function contract(name, address) {
    const abi = compilation.contracts[name].abi;
    return {
      address,
      abi,
      async call(fn, args = [], caller = alice, value = 0n) {
        const { hex } = await run({
          caller,
          to: address,
          data: encodeFunctionData({ abi, functionName: fn, args }),
          value,
          label: `${name}.${fn}`,
        });
        return decodeFunctionResult({ abi, functionName: fn, data: hex });
      },
      async read(fn, args = []) {
        const { hex } = await run({
          to: address,
          data: encodeFunctionData({ abi, functionName: fn, args }),
          label: `${name}.${fn}`,
          isStatic: true,
        });
        return decodeFunctionResult({ abi, functionName: fn, data: hex });
      },
    };
  }
  async function deploy(name, args = []) {
    const a = compilation.contracts[name];
    const { result } = await run({
      data: encodeDeployData({
        abi: a.abi,
        bytecode: `0x${a.evm.bytecode.object}`,
        args,
      }),
      label: `deploy ${name}`,
    });
    return contract(name, result.createdAddress.toString());
  }
  return {
    vm,
    alice,
    bob,
    carol,
    keeper,
    attacker,
    accounts,
    deploy,
    contract,
    gas,
    now: () => timestamp,
    advance: (seconds) => {
      timestamp += BigInt(seconds);
    },
  };
}
