// ゲームの権威ある状態と、それを更新する全ロジック。
//
// もともとはGoサーバー(internal/game)にあったものを、ホストのブラウザで動かす
// ために移植したもの。ここはDOMにもネットワークにも触れない純粋なロジックで、
// Nodeでそのままテストできる。プレイヤーからのメッセージはすべてこのエンジンを
// 通り、結果は「閲覧者ごとにフィルタしたスナップショット」として配られる。
//
// 秘密条件やNPCの手の内をホスト以外に渡さないのは buildSnapshot の責務であり、
// これがゲームの根幹なので、フィルタを緩める変更は慎重に。

import type {
  Announcement,
  DocSection,
  LeaderboardEntry,
  NPCView,
  Phase,
  ProposalView,
  QuestionView,
  RoleView,
  ScenarioSummary,
  ScenarioView,
  Scenario,
  ScoreResult,
  Snapshot,
  TimerState,
  RoomView,
  Player,
} from "../types";

export const MAX_PLAYERS = 40;
export const ROOM_SIZE = 4;

const PHASE_ORDER: Phase[] = [
  "lobby",
  "briefing",
  "discussion",
  "voting",
  "finalize",
  "results",
];

/** 議論中の温度感を示すリアクション(UIの REACTIONS と対応) */
export const REACTION_EMOJIS = ["👍", "🔥", "❓", "⚠️"];

const MAX_QUESTION_LEN = 300;

/** プレイヤーに見せてよいエラー */
export class GameError extends Error {}

// 関数宣言にしているのは、TypeScriptが never 復帰として制御フローを絞り込み、
// fail() の後を到達不能として扱えるようにするため
function fail(msg: string): never {
  throw new GameError(msg);
}

// ---- 権威ある内部状態(スナップショットとは別物) ----

export interface PlayerState {
  id: string;
  name: string;
  roleId: string;
  roomId: string;
  connected: boolean;
  ready: boolean;
  token: string;
}

export interface ProposalState {
  id: string;
  authorId: string;
  category: string;
  title: string;
  description: string;
  status: "pending" | "adopted" | "rejected";
  createdAt: number;
  votes: Record<string, "approve" | "reject">;
  reactions: Record<string, string>; // playerId -> emoji(1人1つ)
}

export interface QuestionState {
  id: string;
  npcId: string;
  askerId: string;
  text: string;
  answer: string;
  source: "" | "host" | "ai";
  pending: boolean; // AIの回答を待っている
  askedAtMs: number;
  answeredMs: number;
}

export interface RoomState {
  id: string;
  name: string;
  playerIds: string[];
  proposals: ProposalState[];
  questions: QuestionState[];
  doc: DocSection[];
  score: ScoreResult | null;
}

/** localStorageに保存して、ホストがリロードしても続きから遊べるようにする */
export interface PersistedGame {
  v: 1;
  phase: Phase;
  scenarioId: string;
  players: Record<string, PlayerState>;
  playerOrder: string[];
  rooms: RoomState[];
  announcements: Announcement[];
  timer: TimerState;
  autoAnswer: boolean;
}

// ---- ID生成 ----

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const newId = () => randomHex(8);
const newToken = () => randomHex(16);

/** 0以上n未満の一様乱数(剰余バイアスを避ける) */
function randInt(n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(0xffffffff / n) * n;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % n;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- エンジン ----

export class GameEngine {
  scenarios: Record<string, Scenario>;
  phase: Phase = "lobby";
  scenarioId = "";
  players: Record<string, PlayerState> = {};
  playerOrder: string[] = [];
  rooms: RoomState[] = [];
  announcements: Announcement[] = [];
  timer: TimerState = { running: false, endsAtMs: 0, remainingMs: 0, totalMs: 0 };

  /** AIキーが設定されているか。autoAnswerはホストがトグルで切り替える */
  aiEnabled = false;
  autoAnswer = false;

  constructor(scenarios: Record<string, Scenario>) {
    this.scenarios = scenarios;
  }

  scenario(): Scenario | null {
    return this.scenarioId ? (this.scenarios[this.scenarioId] ?? null) : null;
  }

  roleById(id: string) {
    return this.scenario()?.roles.find((r) => r.id === id) ?? null;
  }

  npcById(id: string) {
    return this.scenario()?.npcs?.find((n) => n.id === id) ?? null;
  }

  roomById(id: string): RoomState | null {
    return this.rooms.find((r) => r.id === id) ?? null;
  }

  roomOf(playerId: string): RoomState | null {
    const p = this.players[playerId];
    return p?.roomId ? this.roomById(p.roomId) : null;
  }

  // ---- 参加 ----

  /**
   * 新規参加、またはトークンによる復帰。ゲーム開始後の参加は、空きロールのある
   * 最も人数の少ないルームへ自動配属する。
   */
  join(name: string, token: string): { player: PlayerState; isNew: boolean } {
    if (token) {
      const existing = Object.values(this.players).find((p) => p.token === token);
      if (existing) {
        if (name) existing.name = name;
        return { player: existing, isNew: false };
      }
    }
    name = name.trim() || "プレイヤー";
    if (Object.values(this.players).some((p) => p.name === name)) {
      fail("その名前は既に使われています");
    }
    if (this.playerOrder.length >= MAX_PLAYERS) {
      fail(`これ以上参加できません(定員${MAX_PLAYERS}人に達しています)`);
    }

    const p: PlayerState = {
      id: newId(),
      name,
      roleId: "",
      roomId: "",
      connected: false,
      ready: false,
      token: newToken(),
    };

    if (this.phase !== "lobby") {
      let target: RoomState | null = null;
      for (const r of this.rooms) {
        if (r.playerIds.length >= ROOM_SIZE) continue;
        if (!target || r.playerIds.length < target.playerIds.length) target = r;
      }
      const roleId = target ? this.vacantRole(target) : "";
      if (!target || !roleId) {
        fail("ゲームは既に開始されています。空きのあるルームがありません");
      }
      p.roomId = target!.id;
      p.roleId = roleId;
      target!.playerIds.push(p.id);
    }

    this.players[p.id] = p;
    this.playerOrder.push(p.id);
    return { player: p, isNew: true };
  }

  private vacantRole(r: RoomState): string {
    const sc = this.scenario();
    if (!sc) return "";
    const used = new Set(r.playerIds.map((pid) => this.players[pid]?.roleId));
    return sc.roles.find((role) => !used.has(role.id))?.id ?? "";
  }

  removePlayer(id: string) {
    const p = this.players[id];
    if (!p) return;
    const room = this.roomById(p.roomId);
    if (room) room.playerIds = room.playerIds.filter((pid) => pid !== id);
    delete this.players[id];
    this.playerOrder = this.playerOrder.filter((pid) => pid !== id);
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players[id];
    if (p) p.connected = connected;
  }

  // ---- ゲーム進行 ----

  /** 全員を最大ROOM_SIZE人の均等なルームに分け、ルーム内でロールを配る */
  start(scenarioId: string) {
    const sc = this.scenarios[scenarioId];
    if (!sc) fail(`シナリオが見つかりません: ${scenarioId}`);
    const n = this.playerOrder.length;
    if (n < 2) fail(`開始には2人以上のプレイヤーが必要です(現在${n}人)`);
    if (sc.roles.length < ROOM_SIZE) {
      fail(`このシナリオはロールが${sc.roles.length}個しかありません`);
    }
    this.scenarioId = scenarioId;

    const order = shuffle([...this.playerOrder]);
    const numRooms = Math.ceil(n / ROOM_SIZE);
    const base = Math.floor(n / numRooms);
    const extra = n % numRooms;

    this.rooms = [];
    let idx = 0;
    for (let i = 0; i < numRooms; i++) {
      const size = base + (i < extra ? 1 : 0);
      const room: RoomState = {
        id: newId(),
        name: `ルーム${i + 1}`,
        playerIds: [],
        proposals: [],
        questions: [],
        doc: sc.docTemplate.map((t) => ({ id: t.id, title: t.title, content: "" })),
        score: null,
      };
      const roleIdx = shuffle(sc.roles.map((_, k) => k));
      for (let s = 0; s < size; s++) {
        const p = this.players[order[idx++]];
        p.roomId = room.id;
        p.roleId = sc.roles[roleIdx[s]].id;
        room.playerIds.push(p.id);
      }
      this.rooms.push(room);
    }

    this.announcements = [];
    this.timer = { running: false, endsAtMs: 0, remainingMs: 0, totalMs: 0 };
    this.phase = "briefing";
  }

  reset() {
    this.phase = "lobby";
    this.scenarioId = "";
    this.rooms = [];
    this.announcements = [];
    this.timer = { running: false, endsAtMs: 0, remainingMs: 0, totalMs: 0 };
    for (const p of Object.values(this.players)) {
      p.roleId = "";
      p.roomId = "";
      p.ready = false;
    }
  }

  setPhase(phase: Phase) {
    if (!PHASE_ORDER.includes(phase)) fail(`不正なフェーズ: ${phase}`);
    if (phase !== "lobby" && !this.scenarioId) {
      fail("先にシナリオを選んでゲームを開始してください");
    }
    const prev = this.phase;
    this.phase = phase;
    this.timer = { running: false, endsAtMs: 0, remainingMs: 0, totalMs: 0 };
    for (const p of Object.values(this.players)) p.ready = false;
    if (prev === "voting" && phase === "finalize") {
      for (const room of this.rooms) settleVotes(room);
    }
  }

  nextPhase() {
    const i = PHASE_ORDER.indexOf(this.phase);
    if (i >= 0 && i + 1 < PHASE_ORDER.length) this.setPhase(PHASE_ORDER[i + 1]);
  }

  setReady(playerId: string, ready: boolean) {
    const p = this.players[playerId];
    if (p) p.ready = ready;
  }

  // ---- 要求カード ----

  propose(authorId: string, category: string, title: string, description: string) {
    if (this.phase !== "discussion" && this.phase !== "briefing") {
      fail("いまは要求カードを提出できるフェーズではありません");
    }
    if (!title) fail("タイトルを入力してください");
    const room = this.roomOf(authorId);
    if (!room) fail("ルームに所属していません");
    const pr: ProposalState = {
      id: newId(),
      authorId,
      category,
      title,
      description,
      status: "pending",
      createdAt: Date.now(),
      votes: {},
      reactions: {},
    };
    room!.proposals.push(pr);
    return pr;
  }

  private findProposal(id: string): [RoomState, ProposalState] | [null, null] {
    for (const room of this.rooms) {
      const pr = room.proposals.find((p) => p.id === id);
      if (pr) return [room, pr];
    }
    return [null, null];
  }

  updateProposal(
    actorId: string,
    id: string,
    category: string,
    title: string,
    description: string,
    isHost: boolean,
  ) {
    const [, pr] = this.findProposal(id);
    if (!pr) fail("提案が見つかりません");
    if (!isHost && pr!.authorId !== actorId) fail("自分の提案のみ編集できます");
    if (!isHost && this.phase !== "discussion" && this.phase !== "briefing") {
      fail("いまは編集できません");
    }
    if (title) pr!.title = title;
    pr!.category = category;
    pr!.description = description;
  }

  deleteProposal(actorId: string, id: string, isHost: boolean) {
    const [room, pr] = this.findProposal(id);
    if (!pr) fail("提案が見つかりません");
    const locked =
      this.phase === "voting" || this.phase === "finalize" || this.phase === "results";
    if (!isHost && (pr!.authorId !== actorId || locked)) fail("削除できません");
    room!.proposals = room!.proposals.filter((p) => p.id !== id);
  }

  vote(playerId: string, proposalId: string, value: string) {
    if (this.phase !== "voting") fail("投票フェーズではありません");
    const [room, pr] = this.findProposal(proposalId);
    if (!pr) fail("提案が見つかりません");
    const voter = this.players[playerId];
    if (!voter || voter.roomId !== room!.id) {
      fail("自分のルームの提案にのみ投票できます");
    }
    if (value !== "approve" && value !== "reject") fail("不正な投票値");
    pr!.votes[playerId] = value;
  }

  setProposalStatus(id: string, status: string) {
    const [, pr] = this.findProposal(id);
    if (!pr) fail("提案が見つかりません");
    if (status !== "pending" && status !== "adopted" && status !== "rejected") {
      fail("不正なステータス");
    }
    pr!.status = status;
  }

  /** 同じ絵文字を再送すると取り消し、別の絵文字なら差し替え */
  react(playerId: string, proposalId: string, emoji: string) {
    if (!REACTION_EMOJIS.includes(emoji)) fail("不正なリアクション");
    const [room, pr] = this.findProposal(proposalId);
    if (!pr) fail("提案が見つかりません");
    const p = this.players[playerId];
    if (!p || p.roomId !== room!.id) {
      fail("自分のルームの提案にのみリアクションできます");
    }
    if (pr!.reactions[playerId] === emoji) delete pr!.reactions[playerId];
    else pr!.reactions[playerId] = emoji;
  }

  // ---- 仕様書 ----

  editDoc(
    roomId: string,
    sectionId: string,
    content: string,
    editorName: string,
    isHost: boolean,
  ) {
    if (!isHost) {
      const ok = ["briefing", "discussion", "voting", "finalize"].includes(this.phase);
      if (!ok) fail("いまは仕様書を編集できません");
    }
    const room = this.roomById(roomId);
    if (!room) fail("ルームが見つかりません");
    const sec = room!.doc.find((s) => s.id === sectionId);
    if (!sec) fail("セクションが見つかりません");
    sec.content = content;
    sec.editedBy = editorName;
    sec.editedAtMs = Date.now();
  }

  // ---- ヒアリング ----

  ask(playerId: string, npcId: string, text: string): QuestionState {
    if (!this.scenario()) fail("ゲームが開始されていません");
    if (this.phase !== "discussion" && this.phase !== "briefing") {
      fail("いまはヒアリングできるフェーズではありません");
    }
    text = text.trim();
    if (!text) fail("質問を入力してください");
    if ([...text].length > MAX_QUESTION_LEN) {
      fail(`質問が長すぎます(${MAX_QUESTION_LEN}文字まで)`);
    }
    if (!this.npcById(npcId)) fail("ヒアリング相手が見つかりません");
    const room = this.roomOf(playerId);
    if (!room) fail("ルームに所属していません");

    const q: QuestionState = {
      id: newId(),
      npcId,
      askerId: playerId,
      text,
      answer: "",
      source: "",
      pending: this.autoAnswer && this.aiEnabled,
      askedAtMs: Date.now(),
      answeredMs: 0,
    };
    room!.questions.push(q);
    return q;
  }

  findQuestion(id: string): QuestionState | null {
    for (const room of this.rooms) {
      const q = room.questions.find((x) => x.id === id);
      if (q) return q;
    }
    return null;
  }

  answerQuestion(id: string, answer: string, source: "host" | "ai") {
    const q = this.findQuestion(id);
    if (!q) fail("質問が見つかりません");
    answer = answer.trim();
    if (!answer) fail("回答を入力してください");
    q!.answer = answer;
    q!.source = source;
    q!.pending = false;
    q!.answeredMs = Date.now();
  }

  /** AI回答に失敗したとき、ホストのキューに戻す */
  failQuestion(id: string) {
    const q = this.findQuestion(id);
    if (q) q.pending = false;
  }

  // ---- タイマー ----

  timerAction(action: string, seconds = 0) {
    const now = Date.now();
    if (action === "start") {
      let remain: number;
      let total = this.timer.totalMs;
      if (this.timer.remainingMs > 0 && seconds <= 0) {
        remain = this.timer.remainingMs; // 再開
      } else {
        remain = (seconds > 0 ? seconds : 600) * 1000;
        total = remain;
      }
      this.timer = { running: true, endsAtMs: now + remain, remainingMs: 0, totalMs: total };
    } else if (action === "pause") {
      if (this.timer.running) {
        this.timer = {
          running: false,
          endsAtMs: 0,
          remainingMs: Math.max(0, this.timer.endsAtMs - now),
          totalMs: this.timer.totalMs,
        };
      }
    } else if (action === "extend") {
      const addedMs = (seconds > 0 ? seconds : 300) * 1000;
      const currentMs = this.timer.running
        ? Math.max(0, this.timer.endsAtMs - now)
        : this.timer.remainingMs;
      const totalMs = this.timer.totalMs + addedMs;
      this.timer = {
        running: true,
        endsAtMs: now + currentMs + addedMs,
        remainingMs: 0,
        totalMs: totalMs > 0 ? totalMs : addedMs,
      };
    } else if (action === "reset") {
      this.timer = { running: false, endsAtMs: 0, remainingMs: 0, totalMs: 0 };
    } else {
      fail(`不正なタイマー操作: ${action}`);
    }
  }

  announce(title: string, body: string) {
    this.announcements.push({ id: newId(), title, body, at: new Date().toISOString() });
  }

  // ---- 採点結果の適用 ----

  applyScore(roomId: string, sr: ScoreResult) {
    const room = this.roomById(roomId);
    if (!room) fail(`ルームが見つかりません: ${roomId}`);
    const sc = this.scenario();

    for (const ps of sr.players ?? []) {
      const p = this.players[ps.playerId];
      if (!p || !sc) continue;
      const role = this.roleById(p.roleId);
      if (!role) continue;
      ps.roleName = role.title;
      let total = 0;
      let max = 0;
      for (const cond of role.secretConditions ?? []) {
        max += cond.points;
        if (ps.conditions?.some((cr) => cr.id === cond.id && cr.achieved)) {
          total += cond.points;
        }
      }
      ps.secretScore = total;
      ps.secretMax = max;
    }

    if (sc) {
      for (const hr of sr.hiddenReqs ?? []) {
        const def = sc.hiddenRequirements?.find((x) => x.id === hr.id);
        if (def) hr.text = def.text;
      }
      for (const tc of sr.testCases ?? []) {
        const def = sc.testCases?.find((x) => x.id === tc.id);
        if (def) tc.title = def.title;
      }
      for (const t of sr.titles ?? []) {
        if (!t.title) {
          const def = sc.titles?.find((x) => x.id === t.id);
          if (def) t.title = def.name;
        }
        const p = this.players[t.playerId];
        if (p) t.playerName = p.name;
      }
    }
    room!.score = sr;
  }

  // ---- スナップショット ----

  private proposalView(
    room: RoomState,
    pr: ProposalState,
    viewerId: string,
    votesVisible: boolean,
  ): ProposalView {
    const pv: ProposalView = {
      id: pr.id,
      authorId: pr.authorId,
      authorName: "",
      authorRole: "",
      category: pr.category,
      title: pr.title,
      description: pr.description,
      status: pr.status,
      approveCount: 0,
      rejectCount: 0,
      votedCount: Object.keys(pr.votes).length,
      votesVisible,
    };
    const author = this.players[pr.authorId];
    if (author) {
      pv.authorName = author.name;
      pv.authorRole = this.roleById(author.roleId)?.title ?? "";
    }
    if (votesVisible) {
      for (const v of Object.values(pr.votes)) {
        if (v === "approve") pv.approveCount++;
        else pv.rejectCount++;
      }
    }
    if (pr.votes[viewerId]) pv.myVote = pr.votes[viewerId];
    const entries = Object.entries(pr.reactions);
    if (entries.length > 0) {
      pv.reactions = {};
      for (const [pid, emoji] of entries) {
        pv.reactions[emoji] = (pv.reactions[emoji] ?? 0) + 1;
        if (pid === viewerId) pv.myReaction = emoji;
      }
    }
    if (this.phase === "voting") {
      const notVoted = room.playerIds
        .filter((pid) => !(pid in pr.votes))
        .map((pid) => this.players[pid]?.name)
        .filter((n): n is string => !!n);
      if (notVoted.length > 0) pv.notVoted = notVoted;
    }
    return pv;
  }

  private questionView(room: RoomState, q: QuestionState, viewerId: string): QuestionView {
    const npc = this.npcById(q.npcId);
    const asker = this.players[q.askerId];
    return {
      id: q.id,
      npcId: q.npcId,
      npcName: npc?.name ?? "",
      npcIcon: npc?.icon ?? "",
      askerId: q.askerId,
      askerName: asker?.name ?? "",
      askerRole: asker ? (this.roleById(asker.roleId)?.title ?? "") : "",
      text: q.text,
      answer: q.answer || undefined,
      source: (q.source || undefined) as QuestionView["source"],
      pending: q.pending,
      askedAtMs: q.askedAtMs,
      roomId: room.id,
      roomName: room.name,
      isMine: q.askerId === viewerId,
      answeredMs: q.answeredMs || undefined,
    };
  }

  private roomView(
    room: RoomState,
    viewerId: string,
    votesVisible: boolean,
    withScore: boolean,
  ): RoomView {
    return {
      id: room.id,
      name: room.name,
      players: room.playerIds
        .map((pid) => this.players[pid])
        .filter(Boolean)
        .map(publicPlayer),
      proposals: room.proposals.map((pr) =>
        this.proposalView(room, pr, viewerId, votesVisible),
      ),
      questions: room.questions.map((q) => this.questionView(room, q, viewerId)),
      doc: room.doc.map((s) => ({ ...s })),
      score: withScore ? (room.score ?? undefined) : undefined,
    };
  }

  /** 1つの接続に見せてよい状態だけを組み立てる */
  buildSnapshot(viewerId: string, isHost: boolean): Snapshot {
    const reveal = this.phase === "results";
    const votesVisible = isHost || this.phase === "finalize" || reveal;

    const snap: Snapshot = {
      phase: this.phase,
      isHost,
      myPlayerId: viewerId || undefined,
      players: [],
      proposals: [],
      questions: [],
      doc: [],
      announcements: this.announcements.map((a) => ({ ...a })),
      timer: { ...this.timer },
      serverTimeMs: Date.now(),
      aiEnabled: this.aiEnabled,
      autoAnswer: this.autoAnswer,
    };

    snap.players = this.playerOrder
      .map((pid) => this.players[pid])
      .filter(Boolean)
      .map(publicPlayer)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    if (isHost) {
      snap.scenarios = summaries(this.scenarios);
      snap.rooms = this.rooms.map((room) => this.roomView(room, "", votesVisible, true));
      const queue: QuestionView[] = [];
      for (const room of this.rooms) {
        for (const q of room.questions) {
          if (!q.answer) queue.push(this.questionView(room, q, ""));
        }
      }
      queue.sort((a, b) => a.askedAtMs - b.askedAtMs);
      snap.askQueue = queue;
    }

    let myRoom: RoomState | null = null;
    if (!isHost) {
      myRoom = this.roomOf(viewerId);
      if (myRoom) {
        snap.myRoomId = myRoom.id;
        snap.myRoomName = myRoom.name;
        const rv = this.roomView(myRoom, viewerId, votesVisible, reveal);
        snap.proposals = rv.proposals;
        snap.questions = rv.questions;
        snap.doc = rv.doc;
        snap.score = rv.score;
      }
    }

    if (this.rooms.length > 0 && (isHost || reveal)) {
      snap.leaderboard = this.rooms
        .map((room): LeaderboardEntry => {
          const names = room.playerIds
            .map((pid) => this.players[pid]?.name)
            .filter((n): n is string => !!n);
          return {
            roomId: room.id,
            roomName: room.name,
            teamScore: room.score?.teamScore ?? 0,
            scored: !!room.score,
            playerNames: names,
          };
        })
        .sort((a, b) =>
          a.scored !== b.scored ? (a.scored ? -1 : 1) : b.teamScore - a.teamScore,
        );
    }

    const sc = this.scenario();
    if (sc) {
      const sv: ScenarioView = {
        id: sc.id,
        type: sc.type,
        title: sc.title,
        tagline: sc.tagline,
        clientName: sc.clientName,
        industry: sc.industry,
        background: sc.background,
        publicGoal: sc.publicGoal,
        constraints: sc.constraints,
        categories: sc.categories,
        docTemplate: sc.docTemplate,
        rubric: sc.rubric,
        titles: sc.titles,
        roles: [],
      };
      if (isHost) {
        sv.eventIdeas = sc.eventIdeas;
        sv.scriptedEvents = sc.scriptedEvents;
      }
      if (isHost || reveal) {
        sv.hiddenRequirements = sc.hiddenRequirements;
        sv.testCases = sc.testCases;
      }
      if (sc.npcs) {
        sv.npcs = sc.npcs.map((n): NPCView => {
          const nv: NPCView = {
            id: n.id,
            name: n.name,
            title: n.title,
            icon: n.icon,
            opening: n.opening,
          };
          // NPCの手の内はホストと結果発表時のみ
          if (isHost || reveal) nv.knowledge = n.knowledge;
          return nv;
        });
      }

      const myRoleId = this.players[viewerId]?.roleId ?? "";
      const assignedInMyRoom = new Set(
        (myRoom?.playerIds ?? []).map((pid) => this.players[pid]?.roleId),
      );
      sv.roles = sc.roles.map((r): RoleView => {
        const rv: RoleView = {
          id: r.id,
          name: r.name,
          title: r.title,
          icon: r.icon,
          publicProfile: r.publicProfile,
        };
        const vacant = !!myRoom && !assignedInMyRoom.has(r.id);
        if (isHost || reveal || r.id === myRoleId) {
          rv.privateBrief = r.privateBrief;
          rv.secretConditions = r.secretConditions;
        } else if (vacant) {
          // 欠員ロールの補償: 不在ロールの独占情報はチームに公開する
          // (個人目標は誰も持たないため公開しない)
          rv.privateBrief = r.privateBrief;
        }
        if (!isHost) rv.vacant = vacant;
        return rv;
      });
      snap.scenario = sv;
    }

    return snap;
  }

  // ---- 永続化(ホストのリロード対策) ----

  serialize(): PersistedGame {
    return {
      v: 1,
      phase: this.phase,
      scenarioId: this.scenarioId,
      players: this.players,
      playerOrder: this.playerOrder,
      rooms: this.rooms,
      announcements: this.announcements,
      timer: this.timer,
      autoAnswer: this.autoAnswer,
    };
  }

  restore(d: PersistedGame) {
    if (d?.v !== 1) return;
    this.phase = d.phase;
    this.scenarioId = d.scenarioId;
    this.players = d.players ?? {};
    this.playerOrder = d.playerOrder ?? [];
    this.rooms = d.rooms ?? [];
    this.announcements = d.announcements ?? [];
    this.timer = d.timer ?? { running: false, endsAtMs: 0, remainingMs: 0, totalMs: 0 };
    this.autoAnswer = !!d.autoAnswer && this.aiEnabled;
    // 復帰直後は誰も繋がっていない
    for (const p of Object.values(this.players)) p.connected = false;
  }
}

// ---- ヘルパー ----

/** tokenを絶対に外へ出さないための射影 */
function publicPlayer(p: PlayerState): Player {
  return {
    id: p.id,
    name: p.name,
    roleId: p.roleId || undefined,
    roomId: p.roomId || undefined,
    connected: p.connected,
    ready: p.ready,
  };
}

function settleVotes(room: RoomState) {
  for (const pr of room.proposals) {
    if (pr.status !== "pending") continue;
    let approve = 0;
    let reject = 0;
    for (const v of Object.values(pr.votes)) {
      if (v === "approve") approve++;
      else if (v === "reject") reject++;
    }
    if (approve > reject) pr.status = "adopted";
    else if (reject > approve) pr.status = "rejected";
  }
}

export function summaries(scenarios: Record<string, Scenario>): ScenarioSummary[] {
  return Object.values(scenarios)
    .map((sc) => ({
      id: sc.id,
      type: sc.type,
      title: sc.title,
      tagline: sc.tagline,
      clientName: sc.clientName,
      industry: sc.industry,
      maxPlayers: sc.roles.length,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
