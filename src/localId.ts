// Local record identity is not a signing nonce. getRandomValues also works on local HTTP previews.
export function localId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
