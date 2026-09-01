// ゲームエンジンのテスト。`npm test` で実行。
//
// 特に重視しているのは「スナップショットが秘密を漏らさないこと」。
// ホストのブラウザが権威になったため、ここが破れるとDevToolsを開いた
// プレイヤーに他人の個人目標やNPCの手の内が見えてしまい、ゲームが壊れる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine, MAX_PLAYERS } from "../src/game/engine";
import { applyMessage } from "../src/game/protocol";
import { buildPhaseGuide } from "../src/game/phaseGuide";
import { roomAttention, sortRoomsByAttention } from "../src/game/roomAttention";
import type { Scenario, Snapshot } from "../src/types";
import restaurant from "../../scenarios/restaurant.json";
import smartFactory from "../../scenarios/smart-factory.json";

const SCENARIOS: Record<string, Scenario> = {
  restaurant: restaurant as unknown as Scenario,
  "smart-factory": smartFactory as unknown as Scenario,
};

function newGame() {
  return new GameEngine(structuredClone(SCENARIOS));
}

/** 人数分joinさせ、プレイヤーIDを返す */
function seat(g: GameEngine, names: string[]): string[] {
  return names.map((n) => g.join(n, "").player.id);
}

function startGame(names = ["あき", "いつき", "うみ", "えま"], id = "restaurant") {
  const g = newGame();
  const ids = seat(g, names);
  g.start(id);
  return { g, ids };
}

const asHost = (g: GameEngine) => g.buildSnapshot("", true);
const asPlayer = (g: GameEngine, id: string) => g.buildSnapshot(id, false);

// ---- 参加 ----

test("同じ名前では参加できない", () => {
  const g = newGame();
  g.join("あき", "");
  assert.throws(() => g.join("あき", ""), /既に使われています/);
});

test("トークンで復帰でき、二重登録にならない", () => {
  const g = newGame();
  const { player } = g.join("あき", "");
  const again = g.join("あき", player.token);
  assert.equal(again.isNew, false);
  assert.equal(again.player.id, player.id);
  assert.equal(g.playerOrder.length, 1);
});

test("定員を超えたら断る", () => {
  const g = newGame();
  for (let i = 0; i < MAX_PLAYERS; i++) g.join(`p${i}`, "");
  assert.throws(() => g.join("あふれた人", ""), /定員/);
});

test("名前が空ならデフォルト名になる", () => {
  const g = newGame();
  assert.equal(g.join("   ", "").player.name, "プレイヤー");
});

// ---- ルーム分割 ----

for (const [n, expected] of [
  [2, [2]],
  [4, [4]],
  [5, [3, 2]],
  [7, [4, 3]],
  [10, [4, 3, 3]],
  [40, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]],
] as [number, number[]][]) {
  test(`${n}人 → ${expected.join("・")}人のルームに分かれる`, () => {
    const g = newGame();
    seat(
      g,
      Array.from({ length: n }, (_, i) => `p${i}`),
    );
    g.start("restaurant");
    assert.deepEqual(
      g.rooms.map((r) => r.playerIds.length),
      expected,
    );
    // 全員がちょうど1つのルームに属する
    assert.equal(
      g.rooms.reduce((s, r) => s + r.playerIds.length, 0),
      n,
    );
  });
}

test("ルーム内でロールが重複しない", () => {
  for (let trial = 0; trial < 20; trial++) {
    const g = newGame();
    seat(
      g,
      Array.from({ length: 12 }, (_, i) => `p${i}`),
    );
    g.start("restaurant");
    for (const room of g.rooms) {
      const roles = room.playerIds.map((pid) => g.players[pid].roleId);
      assert.equal(new Set(roles).size, roles.length, "同じルームにロールの重複がある");
      assert.ok(roles.every((r) => r));
    }
  }
});

test("2人未満では開始できない", () => {
  const g = newGame();
  g.join("ひとり", "");
  assert.throws(() => g.start("restaurant"), /2人以上/);
});

test("途中参加は空きロールのあるルームへ入る", () => {
  const { g } = startGame(["a", "b", "c", "d", "e"]); // 3人 + 2人
  const small = [...g.rooms].sort((x, y) => x.playerIds.length - y.playerIds.length)[0];
  const before = small.playerIds.length;
  const { player } = g.join("とちゅう", "");
  assert.equal(player.roomId, small.id);
  assert.equal(small.playerIds.length, before + 1);
  assert.ok(player.roleId, "ロールが割り当てられていない");
  const roles = small.playerIds.map((pid) => g.players[pid].roleId);
  assert.equal(new Set(roles).size, roles.length);
});

// ---- 秘密の保護(最重要) ----

test("プレイヤーには他人の個人目標も本音も見えない", () => {
  const { g, ids } = startGame();
  const me = ids[0];
  const snap = asPlayer(g, me);
  const myRoleId = snap.players.find((p) => p.id === me)!.roleId;

  const assigned = new Set(g.rooms[0].playerIds.map((pid) => g.players[pid].roleId));
  for (const r of snap.scenario!.roles) {
    if (r.id === myRoleId) {
      assert.ok(r.privateBrief, "自分の本音は見えるべき");
      assert.ok(r.secretConditions?.length, "自分の目標は見えるべき");
    } else if (assigned.has(r.id)) {
      // 他人が担当しているロール = 完全に隠す
      assert.equal(r.privateBrief, undefined, `${r.id} の本音が漏れている`);
      assert.equal(r.secretConditions, undefined, `${r.id} の個人目標が漏れている`);
    }
  }
});

test("欠員ロールは引き継ぎ資料だけ公開し、個人目標は伏せる", () => {
  const { g, ids } = startGame(["a", "b"]); // 2人 → 2ロール欠員
  const snap = asPlayer(g, ids[0]);
  const assigned = new Set(g.rooms[0].playerIds.map((pid) => g.players[pid].roleId));
  const vacant = snap.scenario!.roles.filter((r) => !assigned.has(r.id));
  assert.ok(vacant.length > 0);
  for (const r of vacant) {
    assert.equal(r.vacant, true);
    assert.ok(r.privateBrief, "欠員ロールの資料はチームに公開される");
    assert.equal(r.secretConditions, undefined, "欠員ロールの個人目標は公開しない");
  }
});

test("プレイヤーにはNPCの手の内が見えない", () => {
  const { g, ids } = startGame();
  const snap = asPlayer(g, ids[0]);
  assert.ok(snap.scenario!.npcs!.length > 0);
  for (const n of snap.scenario!.npcs!) {
    assert.ok(n.opening, "冒頭の発言は見える");
    assert.equal(n.knowledge, undefined, "NPCの開示条件付き情報が漏れている");
  }
  // ホストには見える
  const hostSnap = asHost(g);
  assert.ok(hostSnap.scenario!.npcs!.every((n) => (n.knowledge?.length ?? 0) > 0));
});

test("プレイヤーには隠れ要件・テストケース・イベント台本が見えない", () => {
  const { g, ids } = startGame();
  const snap = asPlayer(g, ids[0]);
  assert.equal(snap.scenario!.hiddenRequirements, undefined);
  assert.equal(snap.scenario!.testCases, undefined);
  assert.equal(snap.scenario!.scriptedEvents, undefined);
  assert.equal(snap.scenario!.eventIdeas, undefined);

  const hostSnap = asHost(g);
  assert.ok((hostSnap.scenario!.hiddenRequirements?.length ?? 0) > 0);
  assert.ok((hostSnap.scenario!.testCases?.length ?? 0) > 0);
});

test("結果発表フェーズですべて公開される", () => {
  const { g, ids } = startGame();
  g.setPhase("results");
  const snap = asPlayer(g, ids[0]);
  assert.ok(snap.scenario!.npcs!.every((n) => (n.knowledge?.length ?? 0) > 0));
  assert.ok((snap.scenario!.hiddenRequirements?.length ?? 0) > 0);
  assert.ok(snap.scenario!.roles.every((r) => r.privateBrief));
});

test("スナップショットにトークンが混入しない", () => {
  const { g, ids } = startGame();
  const tokens = Object.values(g.players).map((p) => p.token);
  for (const snap of [asPlayer(g, ids[0]), asHost(g)]) {
    const json = JSON.stringify(snap);
    for (const t of tokens) {
      assert.ok(!json.includes(t), "スナップショットにトークンが含まれている");
    }
    assert.ok(!json.includes('"token"'));
  }
});

test("プレイヤーには他ルームの中身が見えない", () => {
  const { g, ids } = startGame(["a", "b", "c", "d", "e", "f", "g", "h"]);
  const me = ids[0];
  const myRoom = g.roomOf(me)!;
  const other = g.rooms.find((r) => r.id !== myRoom.id)!;
  const author = other.playerIds[0];
  applyMessage(g, { type: "set_phase", phase: "discussion" }, { playerId: "", isHost: true });
  applyMessage(
    g,
    { type: "propose", category: "機能要件", title: "他ルームの秘密の提案" },
    { playerId: author, isHost: false },
  );
  const snap = asPlayer(g, me);
  assert.equal(snap.rooms, undefined, "プレイヤーに全ルームのデータを渡してはいけない");
  assert.ok(!JSON.stringify(snap).includes("他ルームの秘密の提案"));
});

// ---- フェーズ ----

test("シナリオ未選択ではロビー以外に進めない", () => {
  const g = newGame();
  assert.throws(() => g.setPhase("discussion"), /先にシナリオ/);
});

test("フェーズを進めると準備OKがリセットされる", () => {
  const { g, ids } = startGame();
  g.setReady(ids[0], true);
  g.setReady(ids[1], true);
  assert.equal(Object.values(g.players).filter((p) => p.ready).length, 2);
  g.nextPhase();
  assert.equal(Object.values(g.players).filter((p) => p.ready).length, 0);
});

test("フェーズを進めるとタイマーがクリアされる", () => {
  const { g } = startGame();
  g.timerAction("start", 600);
  assert.equal(g.timer.running, true);
  g.nextPhase();
  assert.equal(g.timer.running, false);
  assert.equal(g.timer.totalMs, 0);
});

// ---- 要求カードと投票 ----

function discussing() {
  const { g, ids } = startGame();
  g.setPhase("discussion");
  return { g, ids };
}

test("投票の多数決で採否が決まり、同数は保留のまま", () => {
  const { g, ids } = discussing();
  const adopt = g.propose(ids[0], "機能要件", "採用される", "");
  const reject = g.propose(ids[0], "機能要件", "却下される", "");
  const tie = g.propose(ids[0], "機能要件", "同数", "");
  g.setPhase("voting");
  for (const id of ids) g.vote(id, adopt.id, "approve");
  for (const id of ids) g.vote(id, reject.id, "reject");
  g.vote(ids[0], tie.id, "approve");
  g.vote(ids[1], tie.id, "approve");
  g.vote(ids[2], tie.id, "reject");
  g.vote(ids[3], tie.id, "reject");
  g.setPhase("finalize");
  assert.equal(adopt.status, "adopted");
  assert.equal(reject.status, "rejected");
  assert.equal(tie.status, "pending", "同数はホストの裁定に回すため保留のまま");
});

test("他ルームの提案には投票できない", () => {
  const { g, ids } = startGame(["a", "b", "c", "d", "e", "f", "g", "h"]);
  g.setPhase("discussion");
  const me = ids[0];
  const other = g.rooms.find((r) => r.id !== g.roomOf(me)!.id)!;
  const pr = g.propose(other.playerIds[0], "機能要件", "よそのカード", "");
  g.setPhase("voting");
  assert.throws(() => g.vote(me, pr.id, "approve"), /自分のルーム/);
});

test("投票フェーズ以外では投票できない", () => {
  const { g, ids } = discussing();
  const pr = g.propose(ids[0], "機能要件", "カード", "");
  assert.throws(() => g.vote(ids[0], pr.id, "approve"), /投票フェーズではありません/);
});

test("自分の提案しか編集・削除できない", () => {
  const { g, ids } = discussing();
  const pr = g.propose(ids[0], "機能要件", "自分の", "");
  assert.throws(() => g.updateProposal(ids[1], pr.id, "x", "y", "z", false), /自分の提案/);
  assert.throws(() => g.deleteProposal(ids[1], pr.id, false), /削除できません/);
  g.deleteProposal(ids[1], pr.id, true); // ホストは可
  assert.equal(g.roomOf(ids[0])!.proposals.length, 0);
});

test("リアクションは1人1つで、同じ絵文字なら取り消し", () => {
  const { g, ids } = discussing();
  const pr = g.propose(ids[0], "機能要件", "カード", "");
  g.react(ids[1], pr.id, "👍");
  g.react(ids[2], pr.id, "👍");
  g.react(ids[3], pr.id, "🔥");
  assert.deepEqual(asPlayer(g, ids[0]).proposals[0].reactions, { "👍": 2, "🔥": 1 });

  g.react(ids[1], pr.id, "⚠️"); // 差し替え
  assert.deepEqual(asPlayer(g, ids[0]).proposals[0].reactions, { "👍": 1, "🔥": 1, "⚠️": 1 });

  g.react(ids[1], pr.id, "⚠️"); // 取り消し
  assert.deepEqual(asPlayer(g, ids[0]).proposals[0].reactions, { "👍": 1, "🔥": 1 });

  assert.throws(() => g.react(ids[1], pr.id, "💀"), /不正なリアクション/);
});

test("投票中は自分の票だけが見え、集計は伏せられる", () => {
  const { g, ids } = discussing();
  const pr = g.propose(ids[0], "機能要件", "カード", "");
  g.setPhase("voting");
  g.vote(ids[0], pr.id, "approve");
  g.vote(ids[1], pr.id, "reject");

  const mine = asPlayer(g, ids[0]).proposals[0];
  assert.equal(mine.myVote, "approve");
  assert.equal(mine.votesVisible, false);
  assert.equal(mine.approveCount, 0, "投票中に賛成数を見せてはいけない");
  assert.equal(mine.votedCount, 2, "何人投票したかは見せる");
  assert.deepEqual(mine.notVoted?.sort(), ["うみ", "えま"].sort());

  // ホストには集計が見える
  assert.equal(asHost(g).rooms![0].proposals[0].approveCount, 1);
});

// ---- ヒアリング ----

test("質問はルーム内で共有され、他ルームには漏れない", () => {
  const { g, ids } = startGame(["a", "b", "c", "d", "e", "f", "g", "h"]);
  g.setPhase("discussion");
  const me = ids[0];
  const mate = g.roomOf(me)!.playerIds.find((p) => p !== me)!;
  const outsider = g.rooms.find((r) => r.id !== g.roomOf(me)!.id)!.playerIds[0];
  const npcId = g.scenario()!.npcs![0].id;

  g.ask(me, npcId, "予約が重なったらどうしていますか?");
  assert.equal(asPlayer(g, mate).questions.length, 1, "同じルームには見える");
  assert.equal(asPlayer(g, outsider).questions.length, 0, "他ルームには見えない");
});

test("質問のバリデーション", () => {
  const { g, ids } = discussing();
  const npcId = g.scenario()!.npcs![0].id;
  assert.throws(() => g.ask(ids[0], "いないNPC", "こんにちは"), /ヒアリング相手/);
  assert.throws(() => g.ask(ids[0], npcId, "   "), /質問を入力/);
  assert.throws(() => g.ask(ids[0], npcId, "あ".repeat(301)), /長すぎます/);
  g.ask(ids[0], npcId, "あ".repeat(300)); // 上限ちょうどは通る
});

test("投票フェーズではヒアリングできない", () => {
  const { g, ids } = discussing();
  const npcId = g.scenario()!.npcs![0].id;
  g.setPhase("voting");
  assert.throws(() => g.ask(ids[0], npcId, "まだ聞けますか?"), /フェーズではありません/);
});

test("自動回答がオンのときだけAI待ちになる", () => {
  const { g, ids } = discussing();
  const npcId = g.scenario()!.npcs![0].id;

  const manual = applyMessage(
    g,
    { type: "ask", npcId, text: "手動モードの質問" },
    { playerId: ids[0], isHost: false },
  );
  assert.equal(manual.askAI, undefined);
  assert.equal(g.roomOf(ids[0])!.questions[0].pending, false);

  g.aiEnabled = true;
  g.autoAnswer = true;
  const auto = applyMessage(
    g,
    { type: "ask", npcId, text: "自動モードの質問" },
    { playerId: ids[0], isHost: false },
  );
  assert.equal(auto.askAI?.text, "自動モードの質問");
  assert.equal(auto.askAI?.npcId, npcId);
});

test("AI回答に失敗した質問はホストのキューに戻る", () => {
  const { g, ids } = discussing();
  g.aiEnabled = true;
  g.autoAnswer = true;
  const q = g.ask(ids[0], g.scenario()!.npcs![0].id, "落ちる質問");
  assert.equal(asHost(g).askQueue!.length, 1);
  g.failQuestion(q.id);
  assert.equal(q.pending, false);
  assert.equal(asHost(g).askQueue!.length, 1, "未回答なのでキューに残る");

  g.answerQuestion(q.id, "手で答えました", "host");
  assert.equal(asHost(g).askQueue!.length, 0);
  assert.equal(asPlayer(g, ids[0]).questions[0].source, "host");
});

test("ホストのキューは全ルーム横断で古い順", () => {
  const { g, ids } = startGame(["a", "b", "c", "d", "e", "f", "g", "h"]);
  g.setPhase("discussion");
  const npcId = g.scenario()!.npcs![0].id;
  const other = g.rooms.find((r) => r.id !== g.roomOf(ids[0])!.id)!;
  const q1 = g.ask(ids[0], npcId, "先の質問");
  const q2 = g.ask(other.playerIds[0], npcId, "後の質問");
  q1.askedAtMs = 1000;
  q2.askedAtMs = 500;
  const queue = asHost(g).askQueue!;
  assert.deepEqual(
    queue.map((q) => q.text),
    ["後の質問", "先の質問"],
  );
  assert.ok(queue.every((q) => q.roomName));
});

// ---- 権限 ----

test("プレイヤーはホスト専用操作を実行できない", () => {
  const { g, ids } = discussing();
  const player = { playerId: ids[0], isHost: false };
  for (const m of [
    { type: "set_phase", phase: "results" },
    { type: "next_phase" },
    { type: "reset_game" },
    { type: "start_game", scenarioId: "restaurant" },
    { type: "timer", action: "start", seconds: 60 },
    { type: "announce", title: "偽のお知らせ", body: "x" },
    { type: "remove_player", playerId: ids[1] },
    { type: "answer_question", questionId: "x", answer: "なりすまし" },
    { type: "set_auto_answer", enabled: true },
    { type: "set_proposal_status", id: "x", status: "adopted" },
  ]) {
    assert.throws(() => applyMessage(g, m, player), /ホストのみ/, `${m.type} が防げていない`);
  }
  // 副作用が起きていないこと
  assert.equal(g.phase, "discussion");
  assert.equal(g.announcements.length, 0);
});

test("未知のメッセージは黙って無視する", () => {
  const { g, ids } = discussing();
  const r = applyMessage(g, { type: "存在しない命令" }, { playerId: ids[0], isHost: false });
  assert.equal(r.changed, false);
});

// ---- 仕様書 ----

test("仕様書の編集で編集者と時刻が記録される", () => {
  const { g, ids } = discussing();
  const room = g.roomOf(ids[0])!;
  applyMessage(
    g,
    { type: "edit_doc", sectionId: room.doc[0].id, content: "書いた内容" },
    { playerId: ids[0], isHost: false },
  );
  const sec = asPlayer(g, ids[0]).doc[0];
  assert.equal(sec.content, "書いた内容");
  assert.equal(sec.editedBy, "あき");
  assert.ok((sec.editedAtMs ?? 0) > 0);
});

test("プレイヤーの編集は自分のルームに限定される", () => {
  const { g, ids } = startGame(["a", "b", "c", "d", "e", "f", "g", "h"]);
  g.setPhase("discussion");
  const me = ids[0];
  const myRoom = g.roomOf(me)!;
  const other = g.rooms.find((r) => r.id !== myRoom.id)!;
  // 他ルームのIDを指定しても、自分のルームに向け直される
  applyMessage(
    g,
    { type: "edit_doc", roomId: other.id, sectionId: myRoom.doc[0].id, content: "侵入" },
    { playerId: me, isHost: false },
  );
  assert.equal(myRoom.doc[0].content, "侵入");
  assert.equal(other.doc[0].content, "");
});

test("結果発表フェーズではプレイヤーは編集できない", () => {
  const { g, ids } = discussing();
  const room = g.roomOf(ids[0])!;
  g.setPhase("results");
  assert.throws(
    () => g.editDoc(room.id, room.doc[0].id, "後から改ざん", "あき", false),
    /編集できません/,
  );
});

// ---- タイマー ----

test("一時停止と再開で総時間が保たれる", () => {
  const g = newGame();
  g.timerAction("start", 300);
  assert.equal(g.timer.totalMs, 300000);
  g.timerAction("pause");
  assert.equal(g.timer.running, false);
  assert.equal(g.timer.totalMs, 300000);
  assert.ok(g.timer.remainingMs > 0);
  g.timerAction("start", 0);
  assert.equal(g.timer.running, true);
  assert.equal(g.timer.totalMs, 300000);
  g.timerAction("reset");
  assert.equal(g.timer.totalMs, 0);
  assert.throws(() => g.timerAction("なにか", 0), /不正なタイマー操作/);
});

// ---- 採点 ----

test("採点結果に役職名・満点・称号の名前が補完される", () => {
  const { g, ids } = startGame();
  const room = g.rooms[0];
  const me = g.players[ids[0]];
  const role = g.roleById(me.roleId)!;
  const conds = role.secretConditions;

  g.applyScore(room.id, {
    teamScore: 80,
    axes: [],
    players: [
      {
        playerId: me.id,
        roleName: "",
        conditions: [
          { id: conds[0].id, achieved: true, reason: "達成" },
          { id: conds[1].id, achieved: false, reason: "未達" },
        ],
        secretScore: 0,
        secretMax: 0,
      },
    ],
    overallComment: "",
    improvement: "",
    titles: [{ id: g.scenario()!.titles![0].id, title: "", playerId: me.id, reason: "" }],
  });

  const ps = room.score!.players[0];
  assert.equal(ps.roleName, role.title);
  assert.equal(ps.secretScore, conds[0].points);
  assert.equal(
    ps.secretMax,
    conds.reduce((s, c) => s + c.points, 0),
  );
  const t = room.score!.titles![0];
  assert.equal(t.title, g.scenario()!.titles![0].name);
  assert.equal(t.playerName, me.name);
});

test("リーダーボードは採点済みを上に、点数の高い順に並ぶ", () => {
  const { g } = startGame(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]);
  const base = {
    axes: [],
    players: [],
    overallComment: "",
    improvement: "",
  };
  g.applyScore(g.rooms[0].id, { ...base, teamScore: 60 });
  g.applyScore(g.rooms[2].id, { ...base, teamScore: 90 });
  g.setPhase("results");
  const lb = asHost(g).leaderboard!;
  assert.deepEqual(
    lb.map((e) => [e.roomName, e.scored, e.teamScore]),
    [
      [g.rooms[2].name, true, 90],
      [g.rooms[0].name, true, 60],
      [g.rooms[1].name, false, 0],
    ],
  );
});

// ---- 永続化 ----

test("保存して読み直すと同じ状態に戻る", () => {
  const { g, ids } = discussing();
  const npcId = g.scenario()!.npcs![0].id;
  g.propose(ids[0], "機能要件", "残ってほしいカード", "説明");
  g.ask(ids[1], npcId, "残ってほしい質問");
  g.editDoc(g.roomOf(ids[0])!.id, g.roomOf(ids[0])!.doc[0].id, "残ってほしい本文", "あき", false);
  g.announce("お知らせ", "本文");
  g.setReady(ids[0], true);

  const saved = JSON.parse(JSON.stringify(g.serialize()));
  const restored = newGame();
  restored.restore(saved);

  const before = asPlayer(g, ids[0]);
  const after = asPlayer(restored, ids[0]);
  // 復帰直後は全員未接続扱いなので、そこだけ揃えて比較する
  const norm = (s: Snapshot) => ({
    ...s,
    serverTimeMs: 0,
    players: s.players.map((p) => ({ ...p, connected: false })),
  });
  assert.deepEqual(norm(after), norm(before));

  // トークンも保持され、同じプレイヤーとして復帰できる
  const token = g.players[ids[0]].token;
  assert.equal(restored.join("", token).player.id, ids[0]);
});

test("壊れた保存データは無視する", () => {
  const g = newGame();
  g.restore({ v: 99 } as never);
  assert.equal(g.phase, "lobby");
  assert.equal(g.playerOrder.length, 0);
});

// ---- ステークホルダー型シナリオでも成立する ----

test("ステークホルダー型(NPCなし)でも通常どおり進行する", () => {
  const g = newGame();
  const ids = seat(g, ["a", "b", "c", "d"]);
  g.start("smart-factory");
  g.setPhase("discussion");
  const snap = asPlayer(g, ids[0]);
  assert.equal(snap.scenario!.npcs, undefined);
  assert.ok(snap.scenario!.roles.length >= 4);
  g.propose(ids[0], snap.scenario!.categories[0], "生産実績の自動収集", "");
  assert.equal(asPlayer(g, ids[1]).proposals.length, 1);
});

// ---- プレイヤー向けフェーズガイド ----

test("フェーズガイドはプレイヤー向けSnapshotの未対応件数を表示する", () => {
  const { g, ids } = startGame(["a", "b", "c", "d"]);
  g.setPhase("discussion");
  const before = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.equal(before.must.some((t) => t.label === "要求カードを1枚以上出す" && t.status === "todo"), true);
  assert.equal(before.must.some((t) => t.label === "未回答の質問をなくす"), true);

  g.propose(ids[0], "機能要件", "カード", "説明");
  const room = g.roomOf(ids[0])!;
  g.editDoc(room.id, room.doc[0].id, "本文", "a", false);
  const after = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.equal(after.must.find((t) => t.label === "要求カードを1枚以上出す")?.status, "done");
  assert.equal(after.must.find((t) => t.label === "仕様書の必須欄を埋める")?.count, `1/${room.doc.length}`);
});

test("フェーズガイドは投票完了と準備OKの説明をフェーズごとに切り替える", () => {
  const { g, ids } = startGame(["a", "b", "c", "d"]);
  g.setPhase("briefing");
  g.setReady(ids[0], true);
  const briefing = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.match(briefing.readyEffect, /自動では進みません/);
  assert.equal(briefing.must.find((t) => t.label === "読み終わったら準備OKを押す")?.status, "done");

  g.setPhase("discussion");
  g.propose(ids[0], "機能要件", "カード", "説明");
  g.setPhase("voting");
  const voting = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.equal(voting.must.find((t) => t.label === "すべてのカードに採用・反対を投票する")?.status, "todo");
  g.vote(ids[0], g.rooms[0].proposals[0].id, "approve");
  const voted = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.equal(voted.must.find((t) => t.label === "すべてのカードに採用・反対を投票する")?.status, "done");
});

test("NPCなしのフェーズガイドは質問キューを要求せず、空の投票を警告する", () => {
  const g = newGame();
  const ids = seat(g, ["a", "b", "c", "d"]);
  g.start("smart-factory");
  g.setPhase("discussion");
  const discussion = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.equal(discussion.must.some((t) => t.label.includes("未回答の質問")), false);
  assert.equal(discussion.must.some((t) => t.label.includes("役割ごとの事実")), true);

  g.setPhase("voting");
  const voting = buildPhaseGuide(asPlayer(g, ids[0]));
  assert.match(voting.readyEffect, /投票対象の要求カードがありません/);
});

test("hostのルーム優先度は進行を止める状態から並べる", () => {
  const { g } = startGame(["a", "b", "c", "d", "e", "f", "g", "h"]);
  g.setPhase("discussion");
  const [first, second] = g.rooms;
  first.playerIds.forEach((id) => {
    g.players[id].connected = true;
    g.players[id].ready = true;
  });
  second.playerIds.forEach((id) => {
    g.players[id].connected = false;
  });
  const snapshot = asHost(g);
  const ordered = sortRoomsByAttention(snapshot.rooms!, snapshot.phase);
  assert.equal(ordered[0].id, second.id);
  assert.equal(roomAttention(ordered[0], snapshot.phase).level, "blocking");
  assert.equal(roomAttention(ordered[1], snapshot.phase).level, "ready");

  const stalled = structuredClone(snapshot.rooms![0]);
  stalled.players = stalled.players.map((p) => ({ ...p, ready: false, connected: true }));
  assert.equal(roomAttention(stalled, "discussion").level, "stalled");
  assert.equal(roomAttention(stalled, "finalize").label, "未採点");

  const normal = structuredClone(stalled);
  normal.proposals.push({
    id: "proposal-1",
    authorId: normal.players[0].id,
    authorName: normal.players[0].name,
    authorRole: "",
    category: "機能要件",
    title: "通常の要求",
    description: "",
    status: "pending",
    approveCount: 0,
    rejectCount: 0,
    votedCount: 0,
    votesVisible: false,
  });
  assert.equal(roomAttention(normal, "discussion").level, "normal");
});
