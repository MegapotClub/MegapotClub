import { createContext } from "react";

// Shared shell observation; opening a share card never starts another RPC poller.
export const WinShareJackpot = createContext<string | null>(null);
