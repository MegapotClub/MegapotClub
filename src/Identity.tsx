import { useEnsName } from "wagmi";
import type { Address } from "viem";

/** ENS is display-only. Wallet addresses remain the authorization identity. */
export function Identity({
  address,
  prefixOnly = false,
}: {
  address: string;
  prefixOnly?: boolean;
}) {
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  const { data } = useEnsName({
    address: valid ? (address.toLowerCase() as Address) : undefined,
    chainId: 1,
    query: {
      enabled: valid && typeof window !== "undefined",
      staleTime: 86_400_000,
      gcTime: typeof window === "undefined" ? Infinity : 86_400_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  return (
    <bdi className="account-name" title={address}>
      {data || `${address.slice(0, 6)}…${prefixOnly ? "" : address.slice(-4)}`}
    </bdi>
  );
}
