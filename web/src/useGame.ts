import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Phase, Scenario, Snapshot } from "./types";
import {
  ClientSession,
  HostSession,
  type ConnStatus,
  newRoomCode,
  normalizeRoomCode,
} from "./net/peer";
import type { ClientMessage } from "./game/protocol";
import { BUILT_IN_SCENARIOS } from "./game/scenarios";
import {
  buildAdvicePrompt,
  buildEventPrompt,
  buildNPCPrompt,
  buildScorePrompt,
  parseEvent,
  parseScoreResult,
} from "./ai/prompts";
import { aiEnabled, chat, loadAIConfig, saveAIConfig, type AIConfig } from "./ai/client";

export type { ConnStatus };

/**
 * UI側から見た接続。Goサーバー時代と同じ形を保っているので、
 * 画面のコンポーネントは通信方式の違いを意識しなくてよい。
 */
export interface GameConn {
  state: Snapshot | null;
  status: ConnStatus;
  joined: boolean;
  lastError: string | null;
  clearError: () => void;
  /** ホストの時計に合わせた現在時刻(ms) */
  serverNow: () => number;
  send: (msg: ClientMessage) => void;
  join: (opts: { name?: string }) => void;
}

const TOKEN_KEY = "reqgame_token";
const NAME_KEY = "reqgame_name";
const ROOM_KEY = "reqgame_room";
const PLAYER_ROOM_KEY = "reqgame_player_room";
const SAVED_GAME_KEY = "reqgame_hostgame";
// ローカルhost画面から共有しても、参加者は公開Pagesへ入れるようにする。
// forkや独自ドメインではVITE_PUBLIC_GAME_URLで上書きできる。
const DEFAULT_PUBLIC_GAME_URL = "https://sk0ya.github.io/Undefined/";

export function savedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

/** 前回ホストしたルームコード。リロードしてもプレイヤーが繋ぎ直せるように保持する */
export function savedRoomCode(): string {
  return localStorage.getItem(ROOM_KEY) ?? "";
}

/** 前回プレイヤーとして参加したルーム。同じURLの再読み込み時だけ自動復帰に使う */
export function savedPlayerRoomCode(): string {
  return localStorage.getItem(PLAYER_ROOM_KEY) ?? "";
}

// ---- プレイヤー ----

export function usePlayerGame(roomCode: string): GameConn {
  const [state, setState] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [joined, setJoined] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const sessionRef = useRef<ClientSession | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!roomCode) return;
    const s = new ClientSession(roomCode, {
      onState: (snap) => {
        offsetRef.current = snap.serverTimeMs - Date.now();
        setState(snap);
      },
      onStatus: setStatus,
      onError: (m) => setLastError(m),
    });
    s.onJoined = (m) => {
      setJoined(true);
      if (m.token) localStorage.setItem(TOKEN_KEY, m.token);
    };
    sessionRef.current = s;
    s.start();
    return () => {
      s.destroy();
      sessionRef.current = null;
      setJoined(false);
      setState(null);
    };
  }, [roomCode]);

  const send = useCallback((msg: ClientMessage) => sessionRef.current?.send(msg), []);

  const join = useCallback((opts: { name?: string }) => {
    if (opts.name) localStorage.setItem(NAME_KEY, opts.name);
    localStorage.setItem(PLAYER_ROOM_KEY, roomCode);
    sessionRef.current?.join({
      type: "join",
      name: opts.name ?? "",
      token: localStorage.getItem(TOKEN_KEY) ?? "",
    });
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  const clearError = useCallback(() => setLastError(null), []);

  return { state, status, joined, lastError, clearError, serverNow, send, join };
}

// ---- ホスト ----

export interface HostConn extends GameConn {
  roomCode: string;
  /** プレイヤーに配る参加URL */
  joinUrl: string;
  ai: AIConfig;
  setAI: (cfg: AIConfig) => void;
  /** 保存済みゲームを復帰した直後にhostへ一度だけ表示する情報 */
  restoredGame?: RestoredGameInfo;
  /** 保存済みのゲームを捨てて新しいルームを開く */
  newRoom: () => void;
  /** 自作シナリオを取り込む(このタブのゲームにのみ反映) */
  addScenario: (sc: Scenario) => void;
  /** ホスト画面でプロンプトを組み立てる(手動モード用) */
  buildPrompt: (kind: AIKind, opts: PromptOpts) => string;
  /** AIを呼んで結果をゲームに反映する。未設定ならnullを返す */
  runAI: (kind: AIKind, opts: PromptOpts) => Promise<AIRunResult | null>;
  /** 手貼りされたAI応答を反映する */
  applyAI: (kind: AIKind, raw: string, opts: PromptOpts) => void;
}

export interface RestoredGameInfo {
  roomCode: string;
  phase: Phase;
  savedAtMs?: number;
}

export type AIKind = "score" | "event" | "advice" | "npc";

export interface PromptOpts {
  roomId?: string;
  direction?: string;
  question?: string;
  npcId?: string;
  questionId?: string;
}

export interface AIRunResult {
  response: string;
  applied: boolean;
}

export function useHostGame(): HostConn {
  const [state, setState] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [restoredGame, setRestoredGame] = useState<RestoredGameInfo>();
  const [ai, setAiState] = useState<AIConfig>(loadAIConfig);
  const sessionRef = useRef<HostSession | null>(null);
  const aiRef = useRef(ai);
  aiRef.current = ai;

  // AIの呼び出し口。CodexブリッジURL/APIキーが未設定の間は undefined を返す。
  const answerNPC = useMemo(() => {
    if (!aiEnabled(ai)) return undefined;
    return async (npcId: string, question: string) => {
      const s = sessionRef.current;
      if (!s) return "";
      return chat(aiRef.current, buildNPCPrompt(s.engine, npcId, question));
    };
  }, [ai.provider, ai.apiKey, ai.baseUrl, ai.model, ai.codexBridgeUrl]);

  useEffect(() => {
    let restore: unknown;
    let savedAtMs: number | undefined;
    try {
      const raw = localStorage.getItem(SAVED_GAME_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          "game" in parsed &&
          parsed.game &&
          typeof parsed.game === "object"
        ) {
          const envelope = parsed as { game: unknown; savedAtMs?: unknown };
          restore = envelope.game;
          savedAtMs = typeof envelope.savedAtMs === "number" ? envelope.savedAtMs : undefined;
        } else {
          // メタデータ追加前の生PersistedGameもそのまま復帰できるようにする。
          restore = parsed;
        }
      }
    } catch {
      /* 壊れていれば新規で始める */
    }
    if (restore && typeof restore === "object" && "phase" in restore) {
      setRestoredGame({
        roomCode: savedRoomCode(),
        phase: restore.phase as Phase,
        ...(savedAtMs !== undefined ? { savedAtMs } : {}),
      });
    }

    const session = new HostSession(
      {
        scenarios: BUILT_IN_SCENARIOS,
        restore,
        onPersist: (data) => {
          try {
            localStorage.setItem(
              SAVED_GAME_KEY,
              JSON.stringify({ game: data, savedAtMs: Date.now() }),
            );
          } catch {
            /* 保存できなくても進行は続く */
          }
        },
        answerNPC,
      },
      {
        onState: setState,
        onStatus: setStatus,
        onError: (m) => setLastError(m),
        onRoom: (code) => {
          setRoomCode(code);
          localStorage.setItem(ROOM_KEY, code);
        },
      },
    );
    sessionRef.current = session;
    session.start(savedRoomCode());
    return () => {
      session.destroy();
      sessionRef.current = null;
    };
    // 起動は1回だけ。AIキーの変更は下のeffectで反映する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // キーを後から入れても、セッションを作り直さずAIを有効化する
  useEffect(() => {
    sessionRef.current?.setAnswerNPC(answerNPC);
  }, [answerNPC]);

  const send = useCallback((msg: ClientMessage) => sessionRef.current?.local(msg), []);
  const join = useCallback(() => {
    /* ホストはこのブラウザの利用者そのものなので、参加手続きは不要 */
  }, []);
  const serverNow = useCallback(() => Date.now(), []);
  const clearError = useCallback(() => setLastError(null), []);

  const setAI = useCallback((cfg: AIConfig) => {
    saveAIConfig(cfg);
    setAiState(cfg);
  }, []);

  const newRoom = useCallback(() => {
    localStorage.removeItem(SAVED_GAME_KEY);
    const code = newRoomCode();
    localStorage.setItem(ROOM_KEY, code);
    location.reload();
  }, []);

  const addScenario = useCallback((sc: Scenario) => {
    const s = sessionRef.current;
    if (!s) return;
    s.engine.scenarios[sc.id] = sc;
    s.refresh();
  }, []);

  const buildPrompt = useCallback((kind: AIKind, opts: PromptOpts): string => {
    const s = sessionRef.current;
    if (!s) throw new Error("準備中です");
    const g = s.engine;
    switch (kind) {
      case "score":
        return buildScorePrompt(g, opts.roomId ?? "");
      case "event":
        return buildEventPrompt(g, opts.direction ?? "");
      case "advice":
        return buildAdvicePrompt(g, opts.roomId ?? "", opts.question ?? "");
      case "npc": {
        // キュー中の質問を指定された場合は、その本文を使う
        if (opts.questionId) {
          const q = g.findQuestion(opts.questionId);
          if (!q) throw new Error("質問が見つかりません");
          return buildNPCPrompt(g, q.npcId, q.text);
        }
        return buildNPCPrompt(g, opts.npcId ?? "", opts.question ?? "");
      }
    }
  }, []);

  const applyAI = useCallback((kind: AIKind, raw: string, opts: PromptOpts) => {
    const s = sessionRef.current;
    if (!s) return;
    const g = s.engine;
    if (kind === "score") {
      const roomId = opts.roomId || (g.rooms.length === 1 ? g.rooms[0].id : "");
      g.applyScore(roomId, parseScoreResult(raw));
    } else if (kind === "event") {
      const ev = parseEvent(raw);
      g.announce(ev.title, ev.body);
    } else if (kind === "npc" && opts.questionId) {
      g.answerQuestion(opts.questionId, raw, "ai");
    } else {
      return; // advice は表示のみ
    }
    s.refresh();
  }, []);

  const runAI = useCallback(
    async (kind: AIKind, opts: PromptOpts): Promise<AIRunResult | null> => {
      if (!aiEnabled(aiRef.current)) return null;
      const prompt = buildPrompt(kind, opts);
      const response = await chat(aiRef.current, prompt);
      let applied = false;
      if (kind !== "advice") {
        applyAI(kind, response, opts);
        applied = true;
      }
      return { response, applied };
    },
    [buildPrompt, applyAI],
  );

  const joinUrl = useMemo(() => {
    if (!roomCode) return "";
    const configured = import.meta.env.VITE_PUBLIC_GAME_URL?.trim();
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
    const base = configured || (isLocal ? DEFAULT_PUBLIC_GAME_URL : `${location.origin}${location.pathname}`);
    const url = new URL(base, location.href);
    url.hash = roomCode;
    return url.toString();
  }, [roomCode]);

  return {
    state,
    status,
    joined: true,
    lastError,
    clearError,
    serverNow,
    send,
    join,
    roomCode,
    joinUrl,
    restoredGame,
    ai,
    setAI,
    newRoom,
    addScenario,
    buildPrompt,
    runAI,
    applyAI,
  };
}

// ---- ルーティング(GitHub Pagesで使えるようハッシュのみ) ----

export interface Route {
  isHost: boolean;
  roomCode: string;
}

export function parseRoute(): Route {
  const h = location.hash.replace(/^#/, "");
  if (h === "host") return { isHost: true, roomCode: "" };
  return { isHost: false, roomCode: normalizeRoomCode(h.replace(/^room=/, "")) };
}
