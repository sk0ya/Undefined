import { useEffect, useState } from "react";
import type { AIKind, HostConn, PromptOpts } from "./useGame";
import { aiEnabled, checkCodexBridge } from "./ai/client";
import type { ClientMessage } from "./game/protocol";
import type { Phase, QuestionView, RoomView, Snapshot, TimerState } from "./types";
import { PHASES, phaseIndex, phaseLabel } from "./types";
import { roomAttention, sortRoomsByAttention } from "./game/roomAttention";
import { phaseTimerPreset, timerMode, TIMER_PRESETS } from "./game/timerPresets";
import {
  AnnouncementLog,
  AnnouncementToasts,
  ConnBadge,
  DocEditor,
  ErrorToast,
  Leaderboard,
  ProposalCard,
  QuestionLog,
  ResultsView,
  ScenarioPanel,
  SoundToggle,
  TimerDisplay,
} from "./components";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 選択中ルームのデータをトップレベルに差し込んだ疑似スナップショット */
function scopeToRoom(state: Snapshot, room: RoomView | undefined): Snapshot {
  if (!room) return state;
  return {
    ...state,
    players: room.players,
    proposals: room.proposals,
    questions: room.questions,
    doc: room.doc,
    score: room.score,
    myRoomId: room.id,
    myRoomName: room.name,
  };
}

export default function HostApp({ conn }: { conn: HostConn }) {
  const { state, status, lastError, clearError, serverNow, send, roomCode } = conn;
  const [selectedRoomId, setSelectedRoomId] = useState("");

  // ルームを開くまではゲーム画面を出さない(コードが決まらないと誰も入れない)
  if (!state || !roomCode) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h1>🎛 要件定義ゲーム — ホストコンソール</h1>
          <p className="muted">
            {status === "closed"
              ? "接続に失敗しました。ネットワークを確認して再読み込みしてください。"
              : "ルームを準備しています…"}
          </p>
          {lastError && (
            <p className="error-text" onClick={clearError}>
              ⚠ {lastError}
            </p>
          )}
          <ConnBadge status={status} />
        </div>
      </div>
    );
  }

  const rooms = state.rooms ?? [];
  const room = rooms.find((r) => r.id === selectedRoomId) ?? rooms[0];

  return (
    <div className="app host-app">
      <header className="topbar">
        <div className="brand">🎛 ホストコンソール</div>
        <TimerDisplay timer={state.timer} serverNow={serverNow} />
        <div className="topbar-right">
          <span className="room-code-chip" title="プレイヤーが入力するルームコード">
            🔑 {roomCode}
          </span>
          <SoundToggle />
          <span className="muted small">
            {state.scenario ? state.scenario.clientName : "シナリオ未選択"}
          </span>
        </div>
      </header>
      <HostPhaseControls state={state} send={send} serverNow={serverNow} />
      <main className="content wide">
        <HostCockpit state={state} serverNow={serverNow} onSelectRoom={setSelectedRoomId} />
        {state.phase !== "lobby" && rooms.length > 0 && (
          <RoomTabs
            rooms={rooms}
            phase={state.phase}
            activeId={room?.id ?? ""}
            onSelect={setSelectedRoomId}
          />
        )}
        <HostPhaseContent conn={conn} state={state} send={send} room={room} />
      </main>
      <AnnouncementToasts items={state.announcements} />
      <ErrorToast message={lastError} onClose={clearError} />
      <ConnBadge status={status} />
    </div>
  );
}

// ---- 進行コックピット ---------------------------------------

function HostCockpit({
  state,
  serverNow,
  onSelectRoom,
}: {
  state: Snapshot;
  serverNow: () => number;
  onSelectRoom: (id: string) => void;
}) {
  const rooms = state.rooms ?? [];
  const ordered = sortRoomsByAttention(rooms, state.phase);
  const connected = state.players.filter((p) => p.connected).length;
  const blocking = ordered.filter((r) => roomAttention(r, state.phase).level === "blocking").length;
  const ready = ordered.filter((r) => roomAttention(r, state.phase).level === "ready").length;
  const checks = nextPhaseChecks(state);

  return (
    <section className="host-cockpit" aria-labelledby="host-cockpit-title">
      <div className="host-cockpit-head">
        <div>
          <div className="eyebrow">host dashboard</div>
          <h3 id="host-cockpit-title">進行コックピット</h3>
        </div>
        <div className="cockpit-phase">
          <strong>{phaseLabel(state.phase)}</strong>
          <TimerSummary timer={state.timer} serverNow={serverNow} />
        </div>
      </div>
      <div className="cockpit-stats">
        <span>参加者 <strong>{state.players.length}</strong>人</span>
        <span>接続中 <strong>{connected}</strong>人</span>
        <span className={blocking > 0 ? "cockpit-stat-alert" : ""}>要対応 <strong>{blocking}</strong>ルーム</span>
        <span className={ready > 0 ? "cockpit-stat-ready" : ""}>全員準備OK <strong>{ready}</strong>ルーム</span>
      </div>
      {rooms.length > 0 && (
        <div className="cockpit-lane" aria-label="ルーム優先キュー">
          {ordered.map((room) => {
            const attention = roomAttention(room, state.phase);
            return (
              <button
                key={room.id}
                className={`cockpit-room cockpit-room-${attention.level}`}
                onClick={() => onSelectRoom(room.id)}
                title={attention.reason}
              >
                <span className="cockpit-room-label">{attention.label}</span>
                <strong>{room.name}</strong>
                <span className="small">{room.players.length}人</span>
                <span className="cockpit-room-reason">{attention.reason}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="cockpit-checks">
        <span className="small muted">次へ進む前の確認</span>
        {checks.map((check) => (
          <span key={check.label} className={check.ok ? "cockpit-check-ok" : "cockpit-check-alert"}>
            {check.ok ? "✓" : "!"} {check.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function TimerSummary({ timer, serverNow }: { timer: TimerState; serverNow: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer.running) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [timer.running, timer.endsAtMs]);

  if (timer.totalMs === 0 && !timer.running && timer.remainingMs === 0) {
    return <span className="small muted">タイマー未設定</span>;
  }
  const ms = timer.running ? Math.max(0, timer.endsAtMs - serverNow()) : timer.remainingMs;
  const seconds = Math.ceil(ms / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <span className={seconds === 0 ? "cockpit-time-over" : "small"}>⏱ {time}{!timer.running && "（停止中）"}</span>;
}

function nextPhaseChecks(state: Snapshot): { label: string; ok: boolean }[] {
  const rooms = state.rooms ?? [];
  const pendingQuestions = rooms.reduce(
    (count, room) => count + room.questions.filter((q) => q.pending || !q.answer).length,
    0,
  );
  const unvoted = rooms.reduce(
    (count, room) => count + room.proposals.filter((p) => (p.notVoted?.length ?? 0) > 0).length,
    0,
  );
  const unscored = rooms.filter((room) => !room.score).length;
  if (state.phase === "discussion") {
    return [
      { label: `未回答質問 ${pendingQuestions}件`, ok: pendingQuestions === 0 },
      { label: `未準備ルーム ${rooms.filter((r) => !r.players.length || !r.players.every((p) => p.ready)).length}件`, ok: rooms.every((r) => r.players.length > 0 && r.players.every((p) => p.ready)) },
    ];
  }
  if (state.phase === "voting") {
    return [{ label: `未投票カード ${unvoted}件`, ok: unvoted === 0 }];
  }
  if (state.phase === "finalize") {
    return [{ label: `未採点ルーム ${unscored}件`, ok: unscored === 0 }];
  }
  return [{ label: "確認項目なし", ok: true }];
}

// ---- フェーズ操作バー ----

function HostPhaseControls({
  state,
  send,
  serverNow,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
  serverNow: () => number;
}) {
  const idx = phaseIndex(state.phase);
  return (
    <div className="host-controls">
      <div className="stepper clickable">
        {PHASES.map((p, i) => (
          <button
            key={p.id}
            className={
              "step" + (i === idx ? " step-active" : i < idx ? " step-done" : "")
            }
            disabled={p.id !== "lobby" && !state.scenario}
            onClick={() => send({ type: "set_phase", phase: p.id })}
            title={p.desc}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="control-row">
        {idx < PHASES.length - 1 && state.scenario && (
          <button className="primary" onClick={() => send({ type: "next_phase" })}>
            ▶ 次のフェーズへ({PHASES[idx + 1].label})
          </button>
        )}
        <ReadyReadout state={state} />
        <TimerControls send={send} timer={state.timer} phase={state.phase} serverNow={serverNow} />
        <button
          className="ghost danger"
          onClick={() => {
            if (confirm("ゲームをリセットしてロビーに戻します。よろしいですか?")) {
              send({ type: "reset_game" });
            }
          }}
        >
          リセット
        </button>
      </div>
    </div>
  );
}

/** 「次に進んでいいか」の判断材料: 準備OKを出した人数 */
function ReadyReadout({ state }: { state: Snapshot }) {
  if (state.phase === "lobby" || state.phase === "results") return null;
  const assigned = state.players.filter((p) => p.roomId);
  if (assigned.length === 0) return null;
  const ready = assigned.filter((p) => p.ready).length;
  const all = ready === assigned.length;
  const waiting = assigned.filter((p) => !p.ready).map((p) => p.name);
  return (
    <div
      className={"ready-readout" + (all ? " all-ready" : "")}
      title={waiting.length > 0 ? `未完了: ${waiting.join("・")}` : "全員が準備OKです"}
    >
      {all ? "✅" : "⏳"} 準備OK {ready}/{assigned.length}
    </div>
  );
}

function TimerControls({
  send,
  timer,
  phase,
  serverNow,
}: {
  send: (m: ClientMessage) => void;
  timer: TimerState;
  phase: Phase;
  serverNow: () => number;
}) {
  const [min, setMin] = useState(10);
  const mode = timerMode(timer, serverNow());
  const recommended = phaseTimerPreset(phase);
  const start = (m: number) => send({ type: "timer", action: "start", seconds: m * 60 });
  const mainAction = () => {
    if (mode === "running") send({ type: "timer", action: "pause" });
    else if (mode === "paused") send({ type: "timer", action: "start", seconds: 0 });
    else if (mode === "over") send({ type: "timer", action: "extend", seconds: 300 });
    else start(recommended);
  };
  return (
    <div className="timer-controls">
      <span className="timer-recommended small muted">推奨 {recommended}分</span>
      <button className="primary timer-main-action" onClick={mainAction}>
        {mode === "running"
          ? "⏸ 一時停止"
          : mode === "paused"
            ? "▶ 再開"
            : mode === "over"
              ? "＋5分延長"
              : `▶ 開始(${recommended}分)`}
      </button>
      <span className="timer-presets-label small muted">時間を変更:</span>
      {TIMER_PRESETS.filter((m) => m !== recommended).map((m) => (
        <button key={m} className="ghost small-btn" onClick={() => start(m)}>
          {m}分
        </button>
      ))}
      <input
        type="number"
        min={1}
        max={60}
        value={min}
        onChange={(e) => setMin(Number(e.target.value))}
      />
      <button className="ghost small-btn" onClick={() => start(min)}>設定時間で開始</button>
      {mode === "over" && <span className="timer-expired-note">時間切れ: 延長または次へ</span>}
      <button className="ghost" onClick={() => send({ type: "timer", action: "reset" })}>
        クリア
      </button>
    </div>
  );
}

// ---- ルームタブ ----

function RoomTabs({
  rooms,
  phase,
  activeId,
  onSelect,
}: {
  rooms: RoomView[];
  phase: Phase;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (rooms.length <= 1) {
    return null;
  }
  return (
    <div className="room-tabs">
      {sortRoomsByAttention(rooms, phase).map((r) => {
        const waiting = r.questions.filter((q) => !q.answer).length;
        const ready = r.players.filter((p) => p.ready).length;
        const attention = roomAttention(r, phase);
        return (
          <button
            key={r.id}
            className={"room-tab" + (r.id === activeId ? " room-tab-active" : "")}
            onClick={() => onSelect(r.id)}
            title={`要求カード ${r.proposals.length}件 / 質問 ${r.questions.length}件`}
          >
            🚪 {r.name}
            <span className={`room-tab-attention room-tab-attention-${attention.level}`}>
              {attention.label}
            </span>
            <span className="room-tab-count">
              {r.players.length}人
              {ready > 0 && ` ✓${ready}`}
            </span>
            {waiting > 0 && <span className="room-tab-alert">🎤 {waiting}</span>}
            {r.score && <span className="room-tab-score">{r.score.teamScore}点</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---- フェーズ別コンテンツ ----

function HostPhaseContent({
  conn,
  state,
  send,
  room,
}: {
  conn: HostConn;
  state: Snapshot;
  send: (m: ClientMessage) => void;
  room?: RoomView;
}) {
  const scoped = scopeToRoom(state, room);
  switch (state.phase) {
    case "lobby":
      return <HostLobby conn={conn} state={state} send={send} />;
    case "briefing":
      return (
        <div className="cols">
          <div>
            <AskQueuePanel conn={conn} state={state} send={send} />
            <HostRoleOverview state={scoped} />
            <NPCReference conn={conn} state={state} />
          </div>
          <div>{state.scenario && <ScenarioPanel sc={state.scenario} />}</div>
        </div>
      );
    case "discussion":
      return (
        <div className="cols">
          <div>
            <AskQueuePanel conn={conn} state={state} send={send} />
            {scoped.questions.length > 0 && (
              <QuestionLog
                questions={scoped.questions}
                heading={`📒 ${room?.name ?? ""}のヒアリング記録(${scoped.questions.length})`}
              />
            )}
            <NPCReference conn={conn} state={state} />
            <HostProposalBoard state={scoped} send={send} />
          </div>
          <div>
            <CausalChainPanel state={state} />
            <ScriptedEventsPanel state={state} send={send} />
            <AIPanel conn={conn} state={state} kinds={["event", "advice"]} roomId={room?.id} />
            <AISettings conn={conn} />
            <AnnounceForm state={state} send={send} />
            <AnnouncementLog items={state.announcements} />
            <HiddenReqPanel state={state} />
            <HostRoleOverview state={scoped} compact />
          </div>
        </div>
      );
    case "voting":
      return (
        <div className="cols">
          <div>
            <HostProposalBoard state={scoped} send={send} />
          </div>
          <div>
            <div className="card">
              <h3>投票の進み具合{room ? `(${room.name})` : ""}</h3>
              <VoteProgress state={scoped} />
              <p className="small muted">
                全ルームの投票が終わったら「次のフェーズへ」。多数決で仮決定され、同数のカードは仕上げフェーズであなたが裁定します。
              </p>
            </div>
            <HostRoleOverview state={scoped} compact />
          </div>
        </div>
      );
    case "finalize":
      return (
        <div className="cols">
          <div>
            <DocEditor
              state={scoped}
              send={send}
              roomId={room?.id}
              heading={room ? `📄 要件定義書エディタ(${room.name})` : undefined}
              lastError={conn.lastError}
            />
          </div>
          <div>
            <AIPanel conn={conn} state={state} kinds={["score", "advice"]} roomId={room?.id} />
            <AISettings conn={conn} />
            <TestCasePreview state={state} />
            <HiddenReqPanel state={state} />
            <HostProposalBoard state={scoped} send={send} compact />
          </div>
        </div>
      );
    case "results":
      return (
        <div>
          <Leaderboard state={state} highlightRoomId={room?.id} />
          {!scoped.score && (
            <AIPanel conn={conn} state={state} kinds={["score"]} roomId={room?.id} />
          )}
          <ResultsView state={scoped} />
        </div>
      );
  }
}

// ---- ロビー ----

function HostLobby({
  conn,
  state,
  send,
}: {
  conn: HostConn;
  state: Snapshot;
  send: (m: ClientMessage) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const n = state.players.length;
  const split = roomSplitPreview(n);
  return (
    <div className="cols">
      <div>
        <InviteCard conn={conn} />
        <AISettings conn={conn} />
        <div className="card">
          <h3>参加者({n}/40)</h3>
          {state.players.length === 0 && <p className="muted pulse">参加を待っています…</p>}
          <div className="player-list">
            {state.players.map((p) => (
              <div key={p.id} className={"player-tag" + (p.connected ? "" : " offline")}>
                {p.name}
                {!p.connected && "(切断)"}
                <button
                  className="tag-x"
                  title="削除"
                  onClick={() => send({ type: "remove_player", playerId: p.id })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <h3>シナリオを選択</h3>
        <div className="scenario-list">
          {(state.scenarios ?? []).map((sc) => (
            <button
              key={sc.id}
              className={"scenario-item" + (selected === sc.id ? " selected" : "")}
              onClick={() => setSelected(sc.id)}
            >
              <strong>{sc.title}</strong>
              <div className="small muted">
                <span className="chip chip-cat">
                  {sc.type === "hearing" ? "ヒアリング型" : "ステークホルダー型"}
                </span>
                {sc.clientName}({sc.industry})/ 最大{sc.maxPlayers}人
                {sc.difficulty && ` / ${sc.difficulty}`}
                {sc.recommendedMinutes && ` / ${sc.recommendedMinutes}分`}
              </div>
              <div className="small tagline">“{sc.tagline}”</div>
            </button>
          ))}
        </div>
        <button
          className="primary big-btn"
          disabled={!selected || n < 2}
          onClick={() => send({ type: "start_game", scenarioId: selected })}
        >
          🚀 ゲーム開始(ルーム分け・ロール配布)
        </button>
        {n < 2 ? (
          <p className="small muted">開始には2人以上の参加が必要です</p>
        ) : (
          <p className="small muted">
            開始すると自動でルーム分けされます: 現在{n}人 → {split}
          </p>
        )}
      </div>
    </div>
  );
}

/** プレイヤーの入り口。ルームコードと参加URLを大きく出す */
function InviteCard({ conn }: { conn: HostConn }) {
  const [copied, setCopied] = useState<"code" | "url" | null>(null);
  const copy = (text: string, what: "code" | "url") => {
    void navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <div className="card invite-card">
      <h3>プレイヤーの参加方法</h3>
      <p className="small muted">
        このページを開いたまま進行してください。<strong>このタブがゲームの本体</strong>です
        (閉じても、同じブラウザで開き直せば途中から再開できます)。
      </p>
      <div className="invite-code" onClick={() => copy(conn.roomCode, "code")} title="クリックでコピー">
        {conn.roomCode}
      </div>
      <p className="small muted center">
        プレイヤーは同じURLを開き、このコードと名前を入れて参加します
      </p>
      <div className="invite-actions">
        <button className="ghost" onClick={() => copy(conn.roomCode, "code")}>
          {copied === "code" ? "✓ コピーしました" : "コードをコピー"}
        </button>
        <button className="ghost" onClick={() => copy(conn.joinUrl, "url")}>
          {copied === "url" ? "✓ コピーしました" : "参加リンクをコピー"}
        </button>
      </div>
      <p className="small invite-url">{conn.joinUrl}</p>
      <details className="ideas">
        <summary>うまく繋がらないときは</summary>
        <ul className="small muted">
          <li>
            プレイヤーとホストの両方がインターネットに繋がっている必要があります(相手探しに使うため)。
            繋がった後の通信は端末同士で直接やりとりします
          </li>
          <li>
            社内ネットワークがWebRTCを遮断していると接続できません。別回線やテザリングで試してください
          </li>
          <li>コードを打ち間違えていないか確認してください(0とO、1とIは使っていません)</li>
        </ul>
      </details>
      <button
        className="ghost danger small-btn"
        onClick={() => {
          if (confirm("進行中のゲームを破棄して、新しいルームコードで開き直します。よろしいですか?")) {
            conn.newRoom();
          }
        }}
      >
        新しいルームを開く
      </button>
    </div>
  );
}

/** APIキーはホスト本人のブラウザにのみ置かれ、プレイヤーには渡らない */
function AISettings({ conn }: { conn: HostConn }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(conn.ai);
  const [bridgeStatus, setBridgeStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const enabled = aiEnabled(conn.ai);
  const checkBridge = async () => {
    setBridgeStatus("checking");
    try {
      await checkCodexBridge(draft.codexBridgeUrl);
      setBridgeStatus("online");
    } catch {
      setBridgeStatus("offline");
    }
  };
  return (
    <div className="card ai-settings">
      <div className="doc-editor-head">
        <h3>🔑 AI設定</h3>
        <span className={enabled ? "chip chip-adopted" : "chip chip-pending"}>
          {conn.ai.provider === "codex" ? "Codexモード" : enabled ? "自動モード" : "手動モード(コピペ)"}
        </span>
      </div>
      <p className="small muted">
        {conn.ai.provider === "codex"
          ? "host PCのCodexを画面から直接呼び出します。APIキーのコピペは不要です。"
          : enabled
            ? "AIが採点やNPC回答を直接実行します。"
            : "キー未設定でも遊べます。プロンプトをコピーしてChatGPTに貼り、返答を貼り戻してください。"}
      </p>
      <button className="ghost small-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "閉じる" : conn.ai.provider === "codex" ? "接続設定" : enabled ? "キーを変更する" : "APIキーを設定する"}
      </button>
      {open && (
        <div className="ai-settings-form">
          <div className="ai-provider-tabs" role="tablist" aria-label="AI接続方式">
            <button
              className={draft.provider === "codex" ? "small-btn" : "ghost small-btn"}
              onClick={() => {
                setDraft({ ...draft, provider: "codex" });
                setBridgeStatus("idle");
              }}
            >
              Codex(host PC)
            </button>
            <button
              className={draft.provider === "api" ? "small-btn" : "ghost small-btn"}
              onClick={() => setDraft({ ...draft, provider: "api" })}
            >
              OpenAI互換API
            </button>
          </div>
          {draft.provider === "codex" ? (
            <>
              <p className="small muted">
                host PCで一度だけ <code>cd web</code> → <code>npm run codex:bridge</code> を実行してください。
                Codex CLIのログイン状態をそのまま使います。
              </p>
              <div className="form-row">
                <input
                  placeholder="CodexブリッジURL"
                  value={draft.codexBridgeUrl}
                  onChange={(e) => {
                    setDraft({ ...draft, codexBridgeUrl: e.target.value });
                    setBridgeStatus("idle");
                  }}
                />
                <button className="ghost small-btn" onClick={checkBridge} disabled={bridgeStatus === "checking"}>
                  {bridgeStatus === "checking" ? "確認中…" : "接続確認"}
                </button>
              </div>
              {bridgeStatus === "online" && <p className="small ok-text">✓ Codexブリッジに接続できます</p>}
              {bridgeStatus === "offline" && (
                <p className="small error-text">⚠ 未接続です。ブリッジを起動してから再確認してください。</p>
              )}
            </>
          ) : (
            <>
              <p className="small muted">
                キーは<strong>このブラウザにだけ</strong>保存され、APIへ直接送られます。プレイヤーには渡りません。
              </p>
              <input
                type="password"
                placeholder="APIキー(sk-...)"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
              <div className="form-row">
                <input
                  placeholder="ベースURL"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                />
                <input
                  placeholder="モデル名"
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
              </div>
            </>
          )}
          {draft.provider === "api" && (
            <label className="auto-answer-toggle">
              <input
                type="checkbox"
                checked={draft.remember}
                onChange={(e) => setDraft({ ...draft, remember: e.target.checked })}
              />
              このブラウザに保存する(共用PCでは外す)
            </label>
          )}
          <div className="proposal-actions">
            <button
              className="small-btn"
              onClick={() => {
                conn.setAI(draft);
                setOpen(false);
              }}
            >
              保存
            </button>
            {draft.provider === "api" && (
              <button
                className="ghost small-btn danger"
                onClick={() => {
                  const cleared = { ...draft, apiKey: "" };
                  setDraft(cleared);
                  conn.setAI(cleared);
                }}
              >
                キーを消す
              </button>
            )}
          </div>
          {draft.provider === "api" && (
            <p className="small muted">
              ブラウザから直接呼ぶため、APIがCORSを許可している必要があります(OpenAIは対応)。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** n人をどう分けるかのプレビュー(ホスト側の分割ロジックと同一) */
function roomSplitPreview(n: number): string {
  if (n < 2) return "-";
  const numRooms = Math.ceil(n / 4);
  const base = Math.floor(n / numRooms);
  const extra = n % numRooms;
  const sizes: number[] = [];
  for (let i = 0; i < numRooms; i++) sizes.push(i < extra ? base + 1 : base);
  const counts = new Map<number, number>();
  sizes.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
  return (
    `${numRooms}ルーム(` +
    [...counts.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([size, c]) => `${size}人×${c}`)
      .join("・") +
    ")"
  );
}

// ---- ロール一覧(ホストは秘密も見える) ----

function HostRoleOverview({ state, compact }: { state: Snapshot; compact?: boolean }) {
  const sc = state.scenario;
  if (!sc) return null;
  return (
    <div className="card">
      <h3>🎭 ロールと秘密の勝利条件(ホスト専用)</h3>
      {sc.roles.map((r) => {
        const player = state.players.find((p) => p.roleId === r.id);
        return (
          <div key={r.id} className="host-role">
            <div className="host-role-head">
              <span className="role-icon">{r.icon}</span>
              <strong>
                {r.name} {r.title}
              </strong>
              <span className={"chip " + (player ? "chip-assigned" : "chip-none")}>
                {player ? `→ ${player.name}` : "未割当"}
              </span>
            </div>
            {!compact && r.privateBrief && (
              <p className="small muted prewrap">{r.privateBrief}</p>
            )}
            <ul className="secret-list small">
              {r.secretConditions?.map((c) => (
                <li key={c.id}>
                  🎯 {c.text} <span className="muted">({c.points}点)</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ---- 提案ボード ----

function HostProposalBoard({
  state,
  send,
  compact,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
  compact?: boolean;
}) {
  return (
    <div className="card">
      <h3>要求カード({state.proposals.length})</h3>
      {state.proposals.length === 0 && <p className="muted">まだ提出されていません</p>}
      {state.proposals.map((p) => (
        <ProposalCard key={p.id} p={p} phase={state.phase} isMine={false}>
          <div className="proposal-actions">
            <span className="small muted">裁定:</span>
            {(["adopted", "pending", "rejected"] as const).map((s) => (
              <button
                key={s}
                className={
                  "ghost small-btn" + (p.status === s ? " status-selected" : "")
                }
                onClick={() => send({ type: "set_proposal_status", id: p.id, status: s })}
              >
                {s === "adopted" ? "採用" : s === "pending" ? "審議中" : "却下"}
              </button>
            ))}
            {!compact && (
              <button
                className="ghost small-btn danger"
                onClick={() => send({ type: "delete_proposal", id: p.id })}
              >
                削除
              </button>
            )}
          </div>
        </ProposalCard>
      ))}
    </div>
  );
}

function VoteProgress({ state }: { state: Snapshot }) {
  const total = state.proposals.length;
  const playerCount = state.players.length;
  const complete = state.proposals.filter((p) => p.votedCount >= playerCount).length;
  const tied = state.proposals.filter(
    (p) => p.votedCount >= playerCount && p.approveCount === p.rejectCount,
  );
  return (
    <div>
      {total > 0 && (
        <>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(complete / total) * 100}%` }} />
          </div>
          <p className="small">
            {complete}/{total} 件が全員投票済
            {complete === total && " — このルームは完了です"}
          </p>
          {tied.length > 0 && (
            <p className="small warn-text">
              ⚖ 同数のカードが{tied.length}件あります(仕上げフェーズであなたが裁定します):
              {tied.map((p) => p.title).join("・")}
            </p>
          )}
        </>
      )}
      <ul className="small">
        {state.proposals.map((p) => (
          <li key={p.id} className={p.votedCount >= playerCount ? "muted" : ""}>
            {p.title}: {p.votedCount}/{playerCount}人 投票済(賛成{p.approveCount}・反対
            {p.rejectCount})
            {p.notVoted && p.notVoted.length > 0 && (
              <span className="muted"> — 未投票: {p.notVoted.join("・")}</span>
            )}
          </li>
        ))}
        {total === 0 && <li className="muted">要求カードがありません</li>}
      </ul>
    </div>
  );
}

// ---- 因果チェーン(ホスト専用) ----

function CausalChainPanel({ state }: { state: Snapshot }) {
  const beats = state.scenario?.beats ?? [];
  if (beats.length === 0) return null;
  return (
    <div className="card causal-chain">
      <details>
        <summary>
          <strong>🔗 因果チェーン({beats.length}場面)</strong>
        </summary>
        <p className="small muted">イベントを出す前に、チームの判断とつながる場面を確認してください。</p>
        {beats.map((beat) => (
          <div key={beat.id} className="causal-beat">
            <div className="causal-beat-head">
              <span className="chip chip-cat">{beat.phase}</span>
              <strong>{beat.title}</strong>
            </div>
            <div className="small"><b>発生条件:</b> {beat.trigger}</div>
            <div className="small"><b>影響:</b> {beat.impact}</div>
            <div className="small muted"><b>投げかけ:</b> {beat.facilitatorCue}</div>
            <div className="small muted"><b>未対応時:</b> {beat.counterfactual}</div>
          </div>
        ))}
      </details>
    </div>
  );
}

// ---- お知らせ(イベント)手動投稿 ----

function AnnounceForm({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const ideas = state.scenario?.eventIdeas ?? [];
  return (
    <div className="card">
      <h3>📢 イベントを配信</h3>
      <p className="small muted">
        議論に揺さぶりをかける「クライアントからの追加情報」を全員に配信します。
      </p>
      <input
        placeholder="タイトル(例: 社長からの緊急連絡)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="本文"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button
        disabled={!title.trim() || !body.trim()}
        onClick={() => {
          send({ type: "announce", title: title.trim(), body: body.trim() });
          setTitle("");
          setBody("");
        }}
      >
        配信する
      </button>
      {ideas.length > 0 && (
        <details className="ideas">
          <summary>イベントのネタ帳(シナリオ同梱)</summary>
          <ul className="small">
            {ideas.map((idea, i) =>
              typeof idea === "string" ? (
                <li key={i}>{idea}</li>
              ) : (
                <li key={idea.id}>
                  <div className="doc-editor-head">
                    <strong>{idea.title}</strong>
                    <button
                      className="ghost small-btn"
                      onClick={() => {
                        setTitle(idea.title);
                        setBody(idea.trigger);
                      }}
                    >
                      下書きに使う
                    </button>
                  </div>
                  <div className="muted">発生条件: {idea.trigger}</div>
                  <div className="muted">狙い: {idea.intent} / 難易度: {idea.difficulty}</div>
                </li>
              ),
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---- NPCカンペ + AI回答(ヒアリング型) ----

function NPCReference({ conn, state }: { conn: HostConn; state: Snapshot }) {
  const npcs = state.scenario?.npcs ?? [];
  const [npcId, setNpcId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (npcs.length === 0) return null;

  const ask = async () => {
    setBusy(true);
    setAnswer(null);
    setManualPrompt(null);
    const opts = { npcId: npcId || npcs[0].id, question };
    try {
      const res = await conn.runAI("npc", opts);
      // キー未設定ならプロンプトを出して手貼りしてもらう
      if (res) setAnswer(res.response);
      else setManualPrompt(conn.buildPrompt("npc", opts));
    } catch (e) {
      setAnswer("⚠ " + errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card npc-panel">
      <h3>🎤 NPCカンペ(ホスト専用)</h3>
      <p className="small muted">
        あなたがNPCを演じます。<strong>聞かれたことだけ</strong>答え、開示条件を満たさない情報は出さないでください。
      </p>
      {npcs.map((n) => (
        <details key={n.id} className="npc-detail">
          <summary>
            {n.icon} {n.name}({n.title})
          </summary>
          <p className="small prewrap">{n.opening}</p>
          <table className="npc-table">
            <tbody>
              {(n.knowledge ?? []).map((k, i) => (
                <tr key={i}>
                  <td className="npc-topic">{k.topic}</td>
                  <td>
                    {k.info}
                    <div className="muted">開示条件: {k.revealWhen}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      <details className="npc-detail ai-ask">
        <summary>🤖 AIにNPCとして回答させる</summary>
        <div className="form-row">
          <select value={npcId} onChange={(e) => setNpcId(e.target.value)}>
            {npcs.map((n) => (
              <option key={n.id} value={n.id}>
                {n.icon} {n.name}
              </option>
            ))}
          </select>
          <input
            placeholder="プレイヤーからの質問を入力"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && question.trim() && ask()}
          />
        </div>
        <button disabled={busy || !question.trim()} onClick={ask}>
          {busy ? "考え中…" : "回答を生成"}
        </button>
        {answer && <div className="ai-response prewrap">{answer}</div>}
        {manualPrompt && (
          <div className="manual-flow">
            <p className="small">
              <strong>手動モード:</strong> プロンプトをコピーしてChatGPT/Codexに貼り付け、回答を読み上げてください。
            </p>
            <div className="prompt-box">
              <button
                className="ghost small-btn copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(manualPrompt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "✓ コピー済" : "📋 コピー"}
              </button>
              <textarea readOnly rows={5} value={manualPrompt} />
            </div>
          </div>
        )}
      </details>
    </div>
  );
}

// ---- ヒアリング質問キュー(全ルーム横断) ----

/**
 * プレイヤーからの未回答質問を一覧し、その場で答える。AIが有効なら自動回答が
 * 走るので、ここに残るのは「AIを切っている」「AIが失敗した」ケース。
 */
function AskQueuePanel({
  conn,
  state,
  send,
}: {
  conn: HostConn;
  state: Snapshot;
  send: (m: ClientMessage) => void;
}) {
  const queue = state.askQueue ?? [];
  const hasNPCs = (state.scenario?.npcs?.length ?? 0) > 0;
  if (!hasNPCs) return null;

  return (
    <div className="card ask-queue">
      <div className="doc-editor-head">
        <h3>🎤 質問キュー({queue.length})</h3>
        <label className="auto-answer-toggle" title={state.aiEnabled ? "" : "APIキーが未設定です(下のAI設定から)"}>
          <input
            type="checkbox"
            checked={state.autoAnswer}
            disabled={!state.aiEnabled}
            onChange={(e) => send({ type: "set_auto_answer", enabled: e.target.checked })}
          />
          AIが自動で答える
        </label>
      </div>
      <p className="small muted">
        {state.autoAnswer
          ? "AIがNPCになりきって即答します。ホストは口頭ヒアリングの進行に集中できます。"
          : state.aiEnabled
            ? "自動回答はオフです。あなたが回答を書くとそのルームに届きます。"
            : "AI未設定のため、あなたが回答を書きます(NPCカンペを参照)。複数ルームなら口頭ヒアリングとの併用がおすすめです。"}
      </p>
      {queue.length === 0 && <p className="muted">未回答の質問はありません</p>}
      {queue.map((q) => (
        <AnswerRow key={q.id} conn={conn} q={q} send={send} aiEnabled={state.aiEnabled} />
      ))}
    </div>
  );
}

function AnswerRow({
  conn,
  q,
  send,
  aiEnabled,
}: {
  conn: HostConn;
  q: QuestionView;
  send: (m: ClientMessage) => void;
  aiEnabled: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // AI有効なら生成して即反映、手動モードならプロンプトを出して貼り戻してもらう
  const askAI = async () => {
    setBusy(true);
    setPrompt(null);
    try {
      const res = await conn.runAI("npc", { questionId: q.id });
      if (!res) setPrompt(conn.buildPrompt("npc", { questionId: q.id }));
    } catch (e) {
      setPrompt(null);
      alert("AI呼び出しに失敗しました: " + errText(e));
    } finally {
      setBusy(false);
    }
  };

  const applyPasted = async () => {
    if (!answer.trim()) return;
    send({ type: "answer_question", questionId: q.id, answer: answer.trim() });
    setAnswer("");
    setPrompt(null);
  };

  return (
    <div className={"queue-item" + (q.pending ? " queue-pending" : "")}>
      <div className="queue-head">
        <span className="chip chip-cat">{q.roomName}</span>
        <strong>
          {q.npcIcon} {q.npcName}
        </strong>
        <span className="muted small">
          ← {q.askerName}
          {q.askerRole && ` / ${q.askerRole}`}
        </span>
      </div>
      <div className="queue-q prewrap">{q.text}</div>
      {q.pending ? (
        <p className="small muted pulse">AIが回答を生成しています…</p>
      ) : (
        <>
          <textarea
            rows={2}
            placeholder={`${q.npcName}としての回答(聞かれたことだけ答える)`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) applyPasted();
            }}
          />
          <div className="proposal-actions">
            <button className="small-btn" disabled={!answer.trim()} onClick={applyPasted}>
              回答を送る
            </button>
            <button className="ghost small-btn" disabled={busy} onClick={askAI}>
              {busy ? "生成中…" : aiEnabled ? "🤖 AIに答えさせる" : "🤖 プロンプトを作る"}
            </button>
          </div>
        </>
      )}
      {prompt && (
        <div className="manual-flow">
          <p className="small">
            <strong>手動モード:</strong> これをChatGPT/Codexに貼り、返ってきたセリフを上の欄に貼り戻してください。
          </p>
          <div className="prompt-box">
            <button
              className="ghost small-btn copy-btn"
              onClick={() => {
                navigator.clipboard.writeText(prompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "✓ コピー済" : "📋 コピー"}
            </button>
            <textarea readOnly rows={5} value={prompt} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 固定イベント台本 ----

function ScriptedEventsPanel({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
}) {
  const events = state.scenario?.scriptedEvents ?? [];
  const [fired, setFired] = useState<Set<string>>(() => new Set());
  if (events.length === 0) return null;
  return (
    <div className="card">
      <h3>🎬 イベント台本</h3>
      <p className="small muted">タイミングが来たら配信してください(全員にトースト表示されます)。</p>
      {events.map((ev) => (
        <div key={ev.id} className={"scripted-event" + (fired.has(ev.id) ? " fired" : "")}>
          <div>
            <span className="chip chip-cat">{ev.timing}</span>
            <strong>{ev.title}</strong>
            <p className="small muted prewrap">{ev.body}</p>
          </div>
          <button
            className={fired.has(ev.id) ? "ghost small-btn" : "small-btn"}
            onClick={() => {
              send({ type: "announce", title: ev.title, body: ev.body });
              setFired((prev) => new Set(prev).add(ev.id));
            }}
          >
            {fired.has(ev.id) ? "再配信" : "▶ 配信"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- 隠れ要件チェックリスト ----

function HiddenReqPanel({ state }: { state: Snapshot }) {
  const reqs = state.scenario?.hiddenRequirements ?? [];
  if (reqs.length === 0) return null;
  return (
    <div className="card">
      <details>
        <summary>
          <strong>🔎 隠れ要件チェックリスト(ホスト専用・{reqs.length}件)</strong>
        </summary>
        <p className="small muted">
          プレイヤーが質問で発見すべき要件です。教えないこと。採点時にAIが発見状況を判定します。
        </p>
        <ul className="small">
          {reqs.map((r) => (
            <li key={r.id}>
              <strong>{r.text}</strong>
              <div className="muted">{r.judgeHint}</div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// ---- 実運用テストケース台本 ----

function TestCasePreview({ state }: { state: Snapshot }) {
  const cases = state.scenario?.testCases ?? [];
  if (cases.length === 0) return null;
  return (
    <div className="card">
      <details>
        <summary>
          <strong>🧪 実運用テストケース(採点時にAIが実行・{cases.length}件)</strong>
        </summary>
        <ul className="small">
          {cases.map((tc) => (
            <li key={tc.id}>
              <strong>{tc.title}</strong>: {tc.situation}
              <div className="muted">チェック: {tc.checkPoint}</div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// ---- AIパネル ----

type PanelKind = Exclude<AIKind, "npc">;
type AIStatus = "waiting" | "running" | "applied" | "failed" | "manual-done";

const KIND_META: Record<
  PanelKind,
  { label: string; icon: string; desc: string; inputLabel?: string }
> = {
  score: {
    label: "AI採点を実行",
    icon: "🏅",
    desc: "最終成果物と各プレイヤーの秘密条件をAIが採点・判定します",
  },
  event: {
    label: "揺さぶりイベントを生成",
    icon: "🌀",
    desc: "議論の前提を変える「クライアントからの追加情報」をAIが作り、全員に配信します",
    inputLabel: "方向性の指示(任意。例: 予算を絞る方向で)",
  },
  advice: {
    label: "ファシリ補助を依頼",
    icon: "💡",
    desc: "議論の抜け漏れや投げかけるべき質問をAIが提案します(ホストにのみ表示)",
    inputLabel: "質問(任意。空欄なら観点の抜け漏れを指摘)",
  },
};

function AIPanel({
  conn,
  state,
  kinds,
  roomId,
}: {
  conn: HostConn;
  state: Snapshot;
  kinds: PanelKind[];
  roomId?: string;
}) {
  const [busy, setBusy] = useState<PanelKind | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{
    kind: PanelKind;
    mode: "auto" | "manual";
    prompt: string;
    opts: PromptOpts;
    status: AIStatus;
    response?: string;
    applied?: boolean;
    error?: string;
  } | null>(null);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const optsFor = (kind: PanelKind): PromptOpts => ({
    direction: kind === "event" ? input : undefined,
    question: kind === "advice" ? input : undefined,
    roomId: kind === "score" || kind === "advice" ? roomId : undefined,
  });

  const run = async (kind: PanelKind) => {
    setBusy(kind);
    const opts = optsFor(kind);
    setResult({ kind, mode: "auto", prompt: "", opts, status: "running" });
    setApplyMsg(null);
    setPasted("");
    try {
      const res = await conn.runAI(kind, opts);
      if (res) {
        setResult({
          kind,
          mode: "auto",
          prompt: "",
          opts,
          status: "applied",
          response: res.response,
          applied: res.applied,
        });
      } else {
        // APIキー未設定 = 手動モード。プロンプトを出してコピペしてもらう
        setResult({ kind, mode: "manual", prompt: conn.buildPrompt(kind, opts), opts, status: "waiting" });
      }
    } catch (e) {
      // 失敗しても進行を止めないよう、手動モードに退避する
      let prompt = "";
      try {
        prompt = conn.buildPrompt(kind, opts);
      } catch {
        /* プロンプトすら組めない場合はエラーだけ出す */
      }
      setResult({ kind, mode: "manual", prompt, opts, status: "failed", error: errText(e) });
    } finally {
      setBusy(null);
    }
  };

  const applyManual = () => {
    if (!result || !pasted.trim()) return;
    try {
      conn.applyAI(result.kind, pasted, result.opts);
      setResult((prev) => (prev ? { ...prev, status: "manual-done", error: undefined } : prev));
      setApplyMsg("✓ 反映しました");
      setPasted("");
    } catch (e) {
      setApplyMsg("⚠ " + errText(e));
    }
  };

  return (
    <div className="card ai-panel">
      <h3>🤖 AIアシスタント(ChatGPT / Codex)</h3>
      {roomId && kinds.includes("score") && (state.rooms?.length ?? 0) > 1 && (
        <p className="small muted">
          採点対象: {state.rooms?.find((r) => r.id === roomId)?.name}(上のルームタブで切替)
        </p>
      )}
      {kinds.some((k) => KIND_META[k].inputLabel) && (
        <input
          placeholder={KIND_META[kinds.find((k) => KIND_META[k].inputLabel)!].inputLabel}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      )}
      <div className="ai-buttons">
        {kinds.map((k) => (
          <button key={k} className="primary" disabled={busy !== null} onClick={() => run(k)}>
            {busy === k ? "実行中…" : `${KIND_META[k].icon} ${KIND_META[k].label}`}
          </button>
        ))}
      </div>
      <div className="ai-status-line" aria-live="polite">
        <span className={`ai-status ai-status-${result?.status ?? "waiting"}`}>
          {result?.status === "running"
              ? "実行中"
            : result?.status === "applied"
              ? result.kind === "advice"
                ? "生成済み"
                : "適用済み"
              : result?.status === "failed"
                ? "失敗"
                : result?.status === "manual-done"
                  ? "手動対応済み"
                  : "待機中"}
        </span>
        {result?.mode === "manual" && result.status === "waiting" && <span className="small muted">手動対応待ち</span>}
      </div>
      <ul className="small muted">
        {kinds.map((k) => (
          <li key={k}>{KIND_META[k].desc}</li>
        ))}
      </ul>

      {result && (
        <div className="ai-result">
          {result.error && <p className="error-text">⚠ {result.error}</p>}

          {result.status === "failed" && (
            <button className="ghost small-btn" disabled={busy !== null} onClick={() => run(result.kind)}>
              ↻ 再試行
            </button>
          )}

          {result.mode === "auto" && result.applied && (
            <p className="ok-text">✓ AIの結果をゲームに反映しました</p>
          )}
          {result.mode === "auto" && result.kind === "advice" && result.response && (
            <div className="ai-response prewrap">{result.response}</div>
          )}

          {result.mode === "manual" && result.prompt && (
            <div className="manual-flow">
              <p className="small">
                <strong>手動モード:</strong> 下のプロンプトをコピーして ChatGPT / Codex
                に貼り付け、返ってきた回答を下の欄に貼り戻してください。
              </p>
              <div className="prompt-box">
                <button
                  className="ghost small-btn copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(result.prompt);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "✓ コピー済" : "📋 プロンプトをコピー"}
                </button>
                <textarea readOnly rows={6} value={result.prompt} />
              </div>
              {result.kind !== "advice" && (
                <>
                  <textarea
                    rows={4}
                    placeholder="AIの回答(JSON)をここに貼り付け"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                  <button disabled={!pasted.trim()} onClick={applyManual}>
                    回答を反映する
                  </button>
                  {applyMsg && <p className="small">{applyMsg}</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
