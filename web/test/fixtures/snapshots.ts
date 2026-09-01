import { GameEngine } from "../../src/game/engine";
import type { Phase, Scenario, Snapshot } from "../../src/types";
import restaurant from "../../../scenarios/restaurant.json";

/**
 * 各フェーズのプレイヤー向けSnapshotを作るテストfixture。
 * ID・時刻は毎回変わるため、JSONを固定保存せず構築手順を固定する。
 */
export function snapshotFixture(phase: Phase): Snapshot {
  const g = new GameEngine({ restaurant: structuredClone(restaurant) as unknown as Scenario });
  if (phase === "lobby") return g.buildSnapshot("", false);

  const ids = ["あき", "いつき", "うみ", "えま"].map((name) => g.join(name, "").player.id);
  g.start("restaurant");
  if (phase === "briefing") return g.buildSnapshot(ids[0], false);

  g.setPhase("discussion");
  const npcId = g.scenario()!.npcs![0].id;
  g.ask(ids[1], npcId, "通常時と例外時の運用を教えてください");
  g.propose(ids[0], "機能要件", "代表的な要求カード", "fixture用の説明");
  const room = g.roomOf(ids[0])!;
  g.editDoc(room.id, room.doc[0].id, "fixture用の仕様書本文", "あき", false);

  if (phase === "discussion") return g.buildSnapshot(ids[0], false);
  g.setPhase("voting");
  if (phase === "voting") return g.buildSnapshot(ids[0], false);

  g.setPhase("finalize");
  if (phase === "finalize") return g.buildSnapshot(ids[0], false);
  g.setPhase("results");
  return g.buildSnapshot(ids[0], false);
}
