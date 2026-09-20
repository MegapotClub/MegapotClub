import { createContext } from "react";

// Shared shell observation; opening a share card never starts another RPC poller.
export const WinSharePrizePool = createContext<string | null>(null);
