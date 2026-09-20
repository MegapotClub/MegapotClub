import { getAddress, isAddress, zeroAddress, type Address } from "viem";

/** Default attribution for a purchase without an explicit invitation. */
export const CLUB_REFERRER =
  "0xd560dFDC6838b9f11C77177f940592A2ba230155" as const;

export function resolveReferrer(invitation?: string): Address {
  if (invitation === undefined) return CLUB_REFERRER;
  if (
    !isAddress(invitation, { strict: false }) ||
    invitation.toLowerCase() === zeroAddress
  )
    throw new Error("invalidInvitation");
  return getAddress(invitation.toLowerCase());
}
