import { useReducer, useState } from "react";
import HostApp from "../HostApp";
import PlayerApp from "../PlayerApp";
import { DEFAULT_AI } from "../ai/client";
import { GameEngine } from "../game/engine";
import { applyMessage } from "../game/protocol";
import { BUILT_IN_SCENARIOS } from "../game/scenarios";
import { PHASES, type Phase } from "../types";
import type { HostConn } from "../useGame";
import "./debug.css";

function createGame(scenarioId: string) {
  const game = new GameEngine(BUILT_IN_SCENARIOS);
  for (const name of ["青木", "田中", "佐藤", "鈴木", "高橋", "伊藤"]) game.join(name, "");
  game.start(scenarioId);
  game.phase = "discussion";
  const scenario = game.scenario()!;
  for (const room of game.rooms) {
    const playerId = room.playerIds[0];
    game.propose(playerId, scenario.categories[0] ?? "機能", "例外時にも業務を継続できる", "担当者が状況を確認し、代替手順で対応できるようにする。");
    game.propose(room.playerIds[1], scenario.categories[0] ?? "機能", "変更履歴を確認する", "誰がいつ変更したかを記録し、チームで共有する。");
    if (scenario.npcs?.length) {
      const q = game.ask(playerId, scenario.npcs[0].id, "忙しい時間帯に困っていることは何ですか？");
      game.answerQuestion(q.id, "複数の依頼が重なると、確認や引き継ぎが追いつかないことがあります。", "host");
      game.ask(room.playerIds[1], scenario.npcs[0].id, "予定が急に変わった場合はどう対応していますか？");
    }
    room.doc[0].content = "業務の状況をチームで共有し、確認漏れや重複対応を減らす。\n\n※画面確認用のサンプルです。";
    room.score = {
      teamScore: 75, axes: [{ name: "要件の具体性", score: 40, max: 50, comment: "主要な業務が整理されています。" }, { name: "例外への対応", score: 35, max: 50, comment: "例外時の手順をさらに具体化しましょう。" }],
      players: [], overallComment: "画面確認用のサンプル採点です。", improvement: "例外が起きたときの担当者と対応期限を決めましょう。",
    };
  }
  game.timer = { running: false, endsAtMs: 0, remainingMs: 900000, totalMs: 1800000 };
  return game;
}

export default function DebugPreview() {
  const [scenarioId, setScenarioId] = useState("restaurant");
  const [game, setGame] = useState(() => createGame("restaurant"));
  const [view, setView] = useState("player");
  const [playerIndex, setPlayerIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generation, resetView] = useReducer((n: number) => n + 1, 0);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const playerId = game.playerOrder[playerIndex] ?? game.playerOrder[0];
  const unsupported = () => setError("プレビューではAI連携を実行しません。通常のホスト画面で確認してください。");
  const reset = (id: string) => { setGame(createGame(id)); setError(null); resetView(); };
  const conn: HostConn = {
    state: game.buildSnapshot(playerId, view === "host"), status: "open", joined: view !== "join",
    lastError: error, clearError: () => setError(null), serverNow: () => Date.now(),
    send: (message) => {
      try { applyMessage(game, message, { playerId, isHost: view === "host" }); refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    },
    join: () => setView("player"), roomCode: "DEMO01", joinUrl: `${location.origin}${location.pathname}#debug`,
    ai: { ...DEFAULT_AI, provider: "api", remember: false }, setAI: unsupported,
    newRoom: () => reset(scenarioId), addScenario: (s) => { game.scenarios = { ...game.scenarios, [s.id]: s }; refresh(); },
    buildPrompt: () => "画面確認用プレビューです。", runAI: async () => { unsupported(); return null; }, applyAI: unsupported,
  };
  return <>
    <aside className="debug-toolbar" aria-label="画面プレビュー">
      <div><strong>画面プレビュー</strong><small>開発専用 · サンプルデータ · 通信不要</small></div>
      <label>視点<select aria-label="視点" value={view} onChange={(e) => setView(e.target.value)}><option value="player">参加者</option><option value="host">ホスト</option><option value="join">参加フォーム</option></select></label>
      <label>フェーズ<select aria-label="フェーズ" value={game.phase} onChange={(e) => { game.phase = e.target.value as Phase; refresh(); }}>{PHASES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label>シナリオ<select aria-label="シナリオ" value={scenarioId} onChange={(e) => { setScenarioId(e.target.value); reset(e.target.value); }}>{Object.values(BUILT_IN_SCENARIOS).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <label>参加者<select aria-label="参加者" value={playerIndex} onChange={(e) => setPlayerIndex(Number(e.target.value))}>{game.playerOrder.map((id, i) => <option key={id} value={i}>{game.players[id].name} / {game.roomOf(id)?.name ?? "ロビー"}</option>)}</select></label>
      <button onClick={() => reset(scenarioId)}>サンプルをリセット</button><a href="#">通常画面へ</a>
    </aside>
    <div key={`${generation}-${view}-${playerId}`}>
      {view === "host" ? <HostApp conn={conn} /> : <PlayerApp conn={conn} roomCode="DEMO01" connecting={false} onSubmitJoin={() => setView("player")} onCancelJoin={() => setView("join")} />}
    </div>
  </>;
}

