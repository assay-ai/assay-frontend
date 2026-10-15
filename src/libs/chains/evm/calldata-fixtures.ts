import { encodeFunctionData, parseAbi, type Abi } from "viem";

/**
 * Tests and the demo stage set only: calldata for `function <signature>` with
 * `args`, so tests (and `libs/demo` fixtures) outside `src/libs/chains/` can
 * build the payloads a backend might serve without importing viem themselves.
 */
export function encodeCall(signature: string, args: readonly unknown[] = []): `0x${string}` {
  const abi = parseAbi([`function ${signature}`] as readonly string[]) as Abi;
  const functionName = signature.slice(0, signature.indexOf("("));
  return encodeFunctionData({ abi, functionName, args: [...args] });
}
