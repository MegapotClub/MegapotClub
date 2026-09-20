import { WalletLinkRelay } from "../../node_modules/@wagmi/connectors/node_modules/@coinbase/wallet-sdk/dist/sign/walletlink/relay/WalletLinkRelay.js";
import { WLMobileRelayUI } from "../../node_modules/@wagmi/connectors/node_modules/@coinbase/wallet-sdk/dist/sign/walletlink/relay/ui/WLMobileRelayUI.js";

// Exercise the installed relay and mobile navigation without constructing any
// remote connection. Only publishEvent's external transport is substituted.
export function publishFixture(
  cachedMobile: boolean,
  request: { method: string; params: unknown },
) {
  const sent: unknown[] = [];
  const relay = Object.create(WalletLinkRelay.prototype);
  relay.isMobileWeb = cachedMobile;
  relay.ui = Object.create(WLMobileRelayUI.prototype);
  relay.ui.redirectDialog = { present() {}, clear() {} };
  relay.publishEvent = (
    event: string,
    message: unknown,
    encrypted: boolean,
  ) => {
    sent.push({ event, message, encrypted });
    return Promise.resolve();
  };
  relay.publishWeb3RequestEvent("fixture-id", request);
  return sent;
}
