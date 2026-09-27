import { createContext, useContext } from "react";

// The host edits locally; only player operations depend on a live data channel.
export const PlayerConnectionContext = createContext(true);
export const usePlayerConnected = () => useContext(PlayerConnectionContext);
