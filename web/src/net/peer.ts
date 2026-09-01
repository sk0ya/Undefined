// WebRTCによる接続層。ホストのブラウザが権威(旧Goサーバー役)になり、
// プレイヤーはデータチャネルでそこに繋ぐスター型。
//
// PeerJSを使うのは、ホスト1点に集まるスター型をそのまま表現できるから。
// メッシュ型のライブラリだと40人で780接続になり破綻する。
// シグナリング(相手を見つける手順)だけは公開ブローカーを借りるが、
// 確立後の通信はピア間を直接流れ、同一LAN内ならローカル候補で繋がる。

import Peer, { type DataConnection } from "peerjs";
import { GameEngine, GameError } from "../game/engine";
import { applyMessage, type ClientMessage, type ServerMessage } from "../game/protocol";
import type { Scenario, Snapshot } from "../types";

/** ルームコードの文字集合。0/O・1/I/L のような紛らわしい文字は除いてある */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 6;

/**
 * ピアID空間は公開ブローカーで共有されるので、十分に固有な接頭辞を付ける。
 * プロトコルを壊す変更をしたらここを上げると、旧版と衝突しなくなる。
 */
const PEER_PREFIX = "reqgame-v1-";

export const peerIdForRoom = (code: string) => PEER_PREFIX + code.toUpperCase();

export function newRoomCode(): string {
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join("");
}

export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LEN);
}

export type ConnStatus = "connecting" | "open" | "closed";

export interface SessionEvents {
  onState: (snap: Snapshot) => void;
  onStatus: (s: ConnStatus) => void;
  onError: (message: string) => void;
  /** ホストのみ: ルームコードが確定したとき */
  onRoom?: (code: string) => void;
}

// ---- ホスト ----

interface ClientConn {
  conn: DataConnection;
  playerId: string;
  joined: boolean;
}

export interface HostOptions {
  scenarios: Record<string, Scenario>;
  /** localStorageから復帰したゲーム(あれば) */
  restore?: unknown;
  /** 状態が変わるたびに呼ばれる。ホストが永続化するために使う */
  onPersist?: (data: unknown) => void;
  /** NPCとしてAIに答えさせる。未設定ならAI機能はオフ */
  answerNPC?: (npcId: string, question: string) => Promise<string>;
}

/**
 * ホスト側セッション。ゲームエンジンを保持し、接続してきたプレイヤーへ
 * 「その人に見せてよい分だけ」のスナップショットを配る。
 */
export class HostSession {
  readonly engine: GameEngine;
  private peer: Peer | null = null;
  private clients = new Set<ClientConn>();
  private ev: SessionEvents;
  private opts: HostOptions;
  private code = "";
  private broadcastTimer: number | null = null;
  private destroyed = false;
  private idAttempts = 0;

  constructor(opts: HostOptions, ev: SessionEvents) {
    this.opts = opts;
    this.ev = ev;
    this.engine = new GameEngine(opts.scenarios);
    this.engine.aiEnabled = !!opts.answerNPC;
    this.engine.autoAnswer = !!opts.answerNPC;
    if (opts.restore) this.engine.restore(opts.restore as never);
  }

  get roomCode() {
    return this.code;
  }

  /** AIキーが後から設定されたとき用 */
  setAnswerNPC(fn: HostOptions["answerNPC"]) {
    const wasEnabled = this.engine.aiEnabled;
    this.opts.answerNPC = fn;
    this.engine.aiEnabled = !!fn;
    if (!fn) this.engine.autoAnswer = false;
    else if (!wasEnabled) this.engine.autoAnswer = true;
    this.scheduleBroadcast();
  }

  start(preferredCode: string) {
    this.code = preferredCode || newRoomCode();
    this.openPeer();
  }

  private openPeer() {
    if (this.destroyed) return;
    this.ev.onStatus("connecting");
    const peer = new Peer(peerIdForRoom(this.code));
    this.peer = peer;

    peer.on("open", () => {
      this.idAttempts = 0;
      this.ev.onStatus("open");
      this.ev.onRoom?.(this.code);
      this.pushLocal();
    });

    peer.on("connection", (conn) => this.accept(conn));

    peer.on("disconnected", () => {
      this.ev.onStatus("connecting");
      if (!this.destroyed) peer.reconnect();
    });

    peer.on("error", (err: Error & { type?: string }) => {
      if (err.type === "unavailable-id") {
        // このコードは既に使われている。別のコードで開き直す
        if (this.idAttempts++ < 5) {
          this.code = newRoomCode();
          peer.destroy();
          this.openPeer();
          return;
        }
      }
      if (err.type === "peer-unavailable") return; // 相手が消えただけ
      this.ev.onStatus("closed");
      this.ev.onError(describePeerError(err));
    });
  }

  private accept(conn: DataConnection) {
    const client: ClientConn = { conn, playerId: "", joined: false };
    this.clients.add(client);

    conn.on("data", (raw) => {
      let msg: ClientMessage;
      try {
        msg = typeof raw === "string" ? JSON.parse(raw) : (raw as ClientMessage);
      } catch {
        return;
      }
      this.handle(client, msg);
    });

    const drop = () => {
      this.clients.delete(client);
      if (client.playerId && !this.hasOtherConn(client)) {
        this.engine.setConnected(client.playerId, false);
        this.scheduleBroadcast();
      }
    };
    conn.on("close", drop);
    conn.on("error", drop);
  }

  /** 同じプレイヤーが別タブでも繋いでいるか(片方閉じても切断扱いにしないため) */
  private hasOtherConn(self: ClientConn): boolean {
    for (const c of this.clients) {
      if (c !== self && c.playerId === self.playerId) return true;
    }
    return false;
  }

  private handle(client: ClientConn, msg: ClientMessage) {
    if (msg.type === "join") {
      // リモートから asHost を名乗られても絶対に信用しない。
      // ホストはこのブラウザの利用者だけ。
      try {
        const { player, isNew } = this.engine.join(msg.name ?? "", msg.token ?? "");
        player.connected = true;
        client.playerId = player.id;
        client.joined = true;
        this.send(client, { type: "joined", playerId: player.id, token: player.token });
        void isNew;
        this.scheduleBroadcast();
      } catch (e) {
        this.send(client, { type: "error", message: errText(e) });
      }
      return;
    }
    if (!client.joined) {
      this.send(client, { type: "error", message: "先に参加してください" });
      return;
    }
    this.dispatch(msg, { playerId: client.playerId, isHost: false }, (m) =>
      this.send(client, { type: "error", message: m }),
    );
  }

  /** ホスト自身のUIからの操作 */
  local(msg: ClientMessage) {
    this.dispatch(msg, { playerId: "", isHost: true }, (m) => this.ev.onError(m));
  }

  /** エンジンを直接触った後に、配信と保存をやり直させる */
  refresh() {
    this.scheduleBroadcast();
  }

  private dispatch(
    msg: ClientMessage,
    actor: { playerId: string; isHost: boolean },
    onErr: (m: string) => void,
  ) {
    let result;
    try {
      result = applyMessage(this.engine, msg, actor);
    } catch (e) {
      onErr(errText(e));
      return;
    }
    if (result.changed) this.scheduleBroadcast();
    if (result.askAI) void this.runAI(result.askAI);
  }

  private async runAI(q: { id: string; npcId: string; text: string }) {
    const fn = this.opts.answerNPC;
    if (!fn) {
      this.engine.failQuestion(q.id);
      this.scheduleBroadcast();
      return;
    }
    try {
      const answer = await fn(q.npcId, q.text);
      if (answer.trim()) this.engine.answerQuestion(q.id, answer, "ai");
      else this.engine.failQuestion(q.id);
    } catch (e) {
      console.warn("AIのNPC回答に失敗:", e);
      this.engine.failQuestion(q.id);
      this.ev.onError("AIの回答に失敗しました。質問キューから手で答えられます");
    }
    this.scheduleBroadcast();
  }

  /**
   * 短時間に複数の更新が来ても配信は1回にまとめる。
   * 仕様書の同時編集など、更新が連続する場面で効く。
   */
  private scheduleBroadcast() {
    if (this.broadcastTimer !== null) return;
    this.broadcastTimer = window.setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcast();
    }, 40);
  }

  private broadcast() {
    if (this.destroyed) return;
    for (const c of this.clients) {
      if (!c.joined) continue;
      this.send(c, { type: "state", state: this.engine.buildSnapshot(c.playerId, false) });
    }
    this.pushLocal();
    this.opts.onPersist?.(this.engine.serialize());
  }

  /** ホスト自身の画面を更新する */
  private pushLocal() {
    this.ev.onState(this.engine.buildSnapshot("", true));
  }

  private send(c: ClientConn, msg: ServerMessage) {
    try {
      if (c.conn.open) c.conn.send(msg);
    } catch (e) {
      console.warn("送信に失敗:", e);
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.broadcastTimer !== null) window.clearTimeout(this.broadcastTimer);
    for (const c of this.clients) {
      try {
        c.conn.close();
      } catch {
        /* すでに閉じている */
      }
    }
    this.clients.clear();
    this.peer?.destroy();
  }
}

// ---- プレイヤー ----

/** プレイヤー側セッション。ホストのピアに繋ぎ、切れたら自動で繋ぎ直す */
export class ClientSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private ev: SessionEvents;
  private code: string;
  private joinMsg: ClientMessage | null = null;
  private retries = 0;
  private retryTimer: number | null = null;
  private destroyed = false;

  constructor(code: string, ev: SessionEvents) {
    this.code = code;
    this.ev = ev;
  }

  start() {
    this.openPeer();
  }

  private openPeer() {
    if (this.destroyed) return;
    this.ev.onStatus("connecting");
    const peer = new Peer();
    this.peer = peer;
    peer.on("open", () => this.connect());
    peer.on("error", (err: Error & { type?: string }) => {
      if (err.type === "peer-unavailable") {
        // ホストがまだ開いていない/落ちた。少し待って繋ぎ直す
        this.scheduleRetry();
        return;
      }
      this.ev.onError(describePeerError(err));
      this.scheduleRetry();
    });
    peer.on("disconnected", () => {
      if (!this.destroyed) peer.reconnect();
    });
  }

  private connect() {
    if (this.destroyed || !this.peer) return;
    const conn = this.peer.connect(peerIdForRoom(this.code), { reliable: true });
    this.conn = conn;

    conn.on("open", () => {
      this.retries = 0;
      this.ev.onStatus("open");
      // 再接続時は前回のjoinを自動で送り直す(トークンで同じロールに戻る)
      if (this.joinMsg) this.rawSend(this.joinMsg);
    });

    conn.on("data", (raw) => {
      let msg: ServerMessage;
      try {
        msg = typeof raw === "string" ? JSON.parse(raw) : (raw as ServerMessage);
      } catch {
        return;
      }
      if (msg.type === "state") this.ev.onState(msg.state);
      else if (msg.type === "error") this.ev.onError(msg.message);
      else if (msg.type === "joined") this.onJoined?.(msg);
    });

    conn.on("close", () => {
      this.ev.onStatus("closed");
      this.scheduleRetry();
    });
    conn.on("error", () => this.scheduleRetry());
  }

  onJoined: ((m: Extract<ServerMessage, { type: "joined" }>) => void) | null = null;

  private scheduleRetry() {
    if (this.destroyed || this.retryTimer !== null) return;
    const delay = Math.min(1000 * 2 ** this.retries, 10000);
    this.retries++;
    this.ev.onStatus("closed");
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      try {
        this.conn?.close();
      } catch {
        /* すでに閉じている */
      }
      // ピア自体が壊れている場合もあるので作り直す
      this.peer?.destroy();
      this.openPeer();
    }, delay);
  }

  join(msg: ClientMessage) {
    this.joinMsg = msg;
    this.rawSend(msg);
  }

  send(msg: ClientMessage) {
    this.rawSend(msg);
  }

  private rawSend(msg: ClientMessage) {
    if (this.conn?.open) {
      try {
        this.conn.send(msg);
      } catch (e) {
        console.warn("送信に失敗:", e);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    try {
      this.conn?.close();
    } catch {
      /* すでに閉じている */
    }
    this.peer?.destroy();
  }
}

// ---- ヘルパー ----

function errText(e: unknown): string {
  if (e instanceof GameError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function describePeerError(err: Error & { type?: string }): string {
  switch (err.type) {
    case "browser-incompatible":
      return "このブラウザはWebRTCに対応していません。Chrome / Edge / Firefox の最新版をお使いください";
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "接続サーバーに繋がりません。ネットワーク(社内プロキシ等)を確認してください";
    case "unavailable-id":
      return "このルームコードは使用中です";
    case "webrtc":
      return "P2P接続を確立できませんでした。ネットワークがWebRTCを遮断している可能性があります";
    default:
      return err.message || "接続エラーが発生しました";
  }
}
