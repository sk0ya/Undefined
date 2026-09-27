import { useState } from "react";
import HostApp from "../../src/HostApp";
import { GameEngine } from "../../src/game/engine";
import { applyMessage } from "../../src/game/protocol";
import { DEFAULT_AI } from "../../src/ai/client";
import type { HostConn } from "../../src/useGame";
import type { Scenario } from "../../src/types";
import restaurant from "../../../scenarios/restaurant.json";

/** Test-only UI workload; no simulated claim about forty network connections. */
export default function ScaleHost() {
  const [engine] = useState(() => {
    const game = new GameEngine({ restaurant: restaurant as unknown as Scenario });
    for (let i = 1; i <= 40; i++) {
      const player = game.join(`参加者${i}`, "").player;
      game.setConnected(player.id, true);
    }
    game.start("restaurant");
    game.setPhase("discussion");
    for (const room of game.rooms) {
      for (const [index, playerId] of room.playerIds.entries()) {
        game.propose(playerId, "必須機能", `${room.name}の要求${index + 1}`, "予約の例外を扱う");
        game.ask(playerId, game.scenario()!.npcs![index].id, `${room.name}の確認${index + 1}`);
      }
    }
    return game;
  });
  const [state, setState] = useState(() => engine.buildSnapshot("", true));
  const [lastError, setError] = useState<string | null>(null);
  const conn: HostConn = {
    state, status: "open", joined: true, lastError, clearError: () => setError(null),
    serverNow: () => Date.now(), roomCode: "SCALE2", joinUrl: "#SCALE2",
    ai: { ...DEFAULT_AI, provider: "api" }, setAI: () => {}, join: () => {},
    newRoom: () => {}, addScenario: () => {}, buildPrompt: () => "", runAI: async () => null, applyAI: () => {},
    send: (message) => {
      try {
        applyMessage(engine, message, { isHost: true, playerId: "" });
        setState(engine.buildSnapshot("", true));
      } catch (error) { setError(String(error)); }
    },
  };
  return <HostApp conn={conn} />;
}
