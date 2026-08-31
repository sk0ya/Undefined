import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

export type ConnStatus = "connecting" | "open" | "closed";

export interface GameConn {
  state: Snapshot | null;
  status: ConnStatus;
  joined: boolean;
  lastError: string | null;
  clearError: () => void;
  /** サーバー時刻との補正済み現在時刻(ms) */
  serverNow: () => number;
  send: (msg: Record<string, unknown>) => void;
  join: (opts: { name?: string; asHost?: boolean; hostKey?: string }) => void;
}

const TOKEN_KEY = "reqgame_token";
const NAME_KEY = "reqgame_name";

export function savedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function useGame(): GameConn {
  const [state, setState] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [joined, setJoined] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timeOffsetRef = useRef(0);
  const joinMsgRef = useRef<Record<string, unknown> | null>(null);
  const retryRef = useRef(0);

  const connect = useCallback(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("open");
      retryRef.current = 0;
      // 再接続時は前回のjoinを自動再送
      if (joinMsgRef.current) {
        ws.send(JSON.stringify(joinMsgRef.current));
      }
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "state") {
        const snap: Snapshot = msg.state;
        timeOffsetRef.current = snap.serverTimeMs - Date.now();
        setState(snap);
      } else if (msg.type === "joined") {
        setJoined(true);
        if (msg.token) localStorage.setItem(TOKEN_KEY, msg.token);
      } else if (msg.type === "error") {
        setLastError(msg.message ?? "エラーが発生しました");
      }
    };
    ws.onclose = () => {
      setStatus("closed");
      const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
      retryRef.current++;
      setTimeout(() => connect(), delay);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const join = useCallback(
    (opts: { name?: string; asHost?: boolean; hostKey?: string }) => {
      const msg: Record<string, unknown> = { type: "join" };
      if (opts.asHost) {
        msg.asHost = true;
        if (opts.hostKey) msg.hostKey = opts.hostKey;
      } else {
        msg.name = opts.name ?? "";
        msg.token = localStorage.getItem(TOKEN_KEY) ?? "";
        if (opts.name) localStorage.setItem(NAME_KEY, opts.name);
      }
      joinMsgRef.current = msg;
      send(msg);
    },
    [send],
  );

  const serverNow = useCallback(() => Date.now() + timeOffsetRef.current, []);
  const clearError = useCallback(() => setLastError(null), []);

  return { state, status, joined, lastError, clearError, serverNow, send, join };
}

/** ホスト用API呼び出し */
export async function apiPost(
  path: string,
  body: unknown,
  hostKey?: string,
): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(hostKey ? { "X-Host-Key": hostKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}
