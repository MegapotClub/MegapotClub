/** Megapot's retail free-ticket tiers. These awards are ordinary claimable USDC. */
export const isFreeTicketTier = (tier: bigint | number | undefined) =>
  tier === 1 || tier === 4 || tier === 1n || tier === 4n;
