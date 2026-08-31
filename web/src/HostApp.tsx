import { useState } from "react";
import type { GameConn } from "./useGame";
import { apiPost } from "./useGame";
import type { RoomView, Snapshot } from "./types";
import { PHASES, phaseIndex } from "./types";
import {
  AnnouncementLog,
  AnnouncementToasts,
  ConnBadge,
  DocEditor,
  ErrorToast,
  Leaderboard,
  ProposalCard,
  ResultsView,
  ScenarioPanel,
  TimerDisplay,
} from "./components";

/** 選択中ルームのデータをトップレベルに差し込んだ疑似スナップショット */
function scopeToRoom(state: Snapshot, room: RoomView | undefined): Snapshot {
  if (!room) return state;
  return {
    ...state,
    players: room.players,
    proposals: room.proposals,
    doc: room.doc,
    score: room.score,
    myRoomId: room.id,
    myRoomName: room.name,
  };
}

const HOSTKEY_KEY = "reqgame_hostkey";

export default function HostApp({ conn }: { conn: GameConn }) {
  const { state, status, joined, lastError, clearError, serverNow, send, join } = conn;
  const [hostKey, setHostKey] = useState(localStorage.getItem(HOSTKEY_KEY) ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState("");

  if (!joined || !state) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h1>🎛 要件定義ゲーム — ホストコンソール</h1>
          <p className="muted">ファシリテーターとしてゲームを進行します。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              localStorage.setItem(HOSTKEY_KEY, hostKey);
              join({ asHost: true, hostKey });
            }}
          >
            <input
              placeholder="ホストキー(設定していなければ空欄)"
              value={hostKey}
              onChange={(e) => setHostKey(e.target.value)}
            />
            <button type="submit" disabled={status !== "open"}>
              ホストとして接続
            </button>
          </form>
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
        <div className="topbar-right muted small">
          {state.scenario ? state.scenario.clientName : "シナリオ未選択"}
        </div>
      </header>
      <HostPhaseControls state={state} send={send} />
      <main className="content wide">
        {state.phase !== "lobby" && rooms.length > 0 && (
          <RoomTabs rooms={rooms} activeId={room?.id ?? ""} onSelect={setSelectedRoomId} />
        )}
        <HostPhaseContent state={state} send={send} hostKey={hostKey} room={room} />
      </main>
      <AnnouncementToasts items={state.announcements} />
      <ErrorToast message={lastError} onClose={clearError} />
      <ConnBadge status={status} />
    </div>
  );
}

// ---- フェーズ操作バー ----

function HostPhaseControls({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
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
        <TimerControls send={send} />
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

function TimerControls({ send }: { send: (m: Record<string, unknown>) => void }) {
  const [min, setMin] = useState(10);
  return (
    <div className="timer-controls">
      <input
        type="number"
        min={1}
        max={60}
        value={min}
        onChange={(e) => setMin(Number(e.target.value))}
      />
      <span className="small muted">分</span>
      <button onClick={() => send({ type: "timer", action: "start", seconds: min * 60 })}>
        ⏱ 開始
      </button>
      <button className="ghost" onClick={() => send({ type: "timer", action: "pause" })}>
        一時停止
      </button>
      <button className="ghost" onClick={() => send({ type: "timer", action: "start", seconds: 0 })}>
        再開
      </button>
      <button className="ghost" onClick={() => send({ type: "timer", action: "reset" })}>
        クリア
      </button>
    </div>
  );
}

// ---- ルームタブ ----

function RoomTabs({
  rooms,
  activeId,
  onSelect,
}: {
  rooms: RoomView[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (rooms.length <= 1) {
    return null;
  }
  return (
    <div className="room-tabs">
      {rooms.map((r) => (
        <button
          key={r.id}
          className={"room-tab" + (r.id === activeId ? " room-tab-active" : "")}
          onClick={() => onSelect(r.id)}
        >
          🚪 {r.name}
          <span className="room-tab-count">{r.players.length}人</span>
          {r.score && <span className="room-tab-score">{r.score.teamScore}点</span>}
        </button>
      ))}
    </div>
  );
}

// ---- フェーズ別コンテンツ ----

function HostPhaseContent({
  state,
  send,
  hostKey,
  room,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
  hostKey: string;
  room?: RoomView;
}) {
  const scoped = scopeToRoom(state, room);
  switch (state.phase) {
    case "lobby":
      return <HostLobby state={state} send={send} />;
    case "briefing":
      return (
        <div className="cols">
          <div>
            <HostRoleOverview state={scoped} />
            <NPCReference state={state} hostKey={hostKey} />
          </div>
          <div>{state.scenario && <ScenarioPanel sc={state.scenario} />}</div>
        </div>
      );
    case "discussion":
      return (
        <div className="cols">
          <div>
            <NPCReference state={state} hostKey={hostKey} />
            <HostProposalBoard state={scoped} send={send} />
          </div>
          <div>
            <ScriptedEventsPanel state={state} send={send} />
            <AIPanel state={state} hostKey={hostKey} kinds={["event", "advice"]} roomId={room?.id} />
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
            />
          </div>
          <div>
            <AIPanel state={state} hostKey={hostKey} kinds={["score", "advice"]} roomId={room?.id} />
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
            <AIPanel state={state} hostKey={hostKey} kinds={["score"]} roomId={room?.id} />
          )}
          <ResultsView state={scoped} />
        </div>
      );
  }
}

// ---- ロビー ----

function HostLobby({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const url = `${location.protocol}//${location.host}/`;
  const n = state.players.length;
  const split = roomSplitPreview(n);
  return (
    <div className="cols">
      <div className="card">
        <h3>参加者({n}/40)</h3>
        <p className="small muted">
          プレイヤーは同じネットワークから <strong className="url">{url}</strong>{" "}
          にアクセスして参加します。
        </p>
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

/** n人をどう分けるかのプレビュー(サーバーの分割ロジックと同一) */
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
  send: (m: Record<string, unknown>) => void;
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
  return (
    <div>
      <ul className="small">
        {state.proposals.map((p) => (
          <li key={p.id}>
            {p.title}: {p.votedCount}/{playerCount}人 投票済(賛成{p.approveCount}・反対
            {p.rejectCount})
          </li>
        ))}
        {total === 0 && <li className="muted">要求カードがありません</li>}
      </ul>
    </div>
  );
}

// ---- お知らせ(イベント)手動投稿 ----

function AnnounceForm({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
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
            {ideas.map((idea, i) => (
              <li key={i}>{idea}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---- NPCカンペ + AI回答(ヒアリング型) ----

function NPCReference({ state, hostKey }: { state: Snapshot; hostKey: string }) {
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
    try {
      const res = await apiPost(
        "/api/ai",
        { kind: "npc", npcId: npcId || npcs[0].id, question },
        hostKey,
      );
      if (res.mode === "auto" && res.response) setAnswer(res.response);
      else setManualPrompt(res.prompt);
      if (res.error) setAnswer("⚠ " + res.error);
    } catch (e: any) {
      setAnswer("⚠ " + (e.message ?? String(e)));
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

// ---- 固定イベント台本 ----

function ScriptedEventsPanel({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
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

type AIKind = "score" | "event" | "advice";

const KIND_META: Record<
  AIKind,
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
  state,
  hostKey,
  kinds,
  roomId,
}: {
  state: Snapshot;
  hostKey: string;
  kinds: AIKind[];
  roomId?: string;
}) {
  const [busy, setBusy] = useState<AIKind | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{
    kind: AIKind;
    mode: "auto" | "manual";
    prompt: string;
    response?: string;
    applied?: boolean;
    error?: string;
  } | null>(null);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const run = async (kind: AIKind) => {
    setBusy(kind);
    setResult(null);
    setApplyMsg(null);
    setPasted("");
    try {
      const body: Record<string, string> = { kind };
      if (kind === "event") body.direction = input;
      if (kind === "advice") body.question = input;
      if (roomId && (kind === "score" || kind === "advice")) body.roomId = roomId;
      const res = await apiPost("/api/ai", body, hostKey);
      setResult({ kind, ...res });
    } catch (e: any) {
      setResult({
        kind,
        mode: "manual",
        prompt: "",
        error: e.message ?? String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const applyManual = async () => {
    if (!result || !pasted.trim()) return;
    try {
      await apiPost(
        "/api/ai/apply",
        { kind: result.kind, raw: pasted, ...(roomId && result.kind === "score" ? { roomId } : {}) },
        hostKey,
      );
      setApplyMsg("✓ 反映しました");
      setPasted("");
    } catch (e: any) {
      setApplyMsg("⚠ " + (e.message ?? String(e)));
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
      <ul className="small muted">
        {kinds.map((k) => (
          <li key={k}>{KIND_META[k].desc}</li>
        ))}
      </ul>

      {result && (
        <div className="ai-result">
          {result.error && <p className="error-text">⚠ {result.error}</p>}

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
