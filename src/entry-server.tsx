import { WalletProviders } from "./WalletProviders.tsx";
import { renderToString } from "react-dom/server";
import App from "./App.tsx";
import type { AppProps } from "./App.tsx";
export const render = (props: AppProps) =>
  renderToString(
    <WalletProviders locale={props.locale}>
      <App {...props} />
    </WalletProviders>,
  );
