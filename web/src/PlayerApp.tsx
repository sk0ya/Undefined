import { ProductIdentity, SessionHeading } from "./ProductIdentity";
import { useEffect, useId, useMemo, useState } from "react";
import { PlayerConnectionContext } from "./ConnectionContext";
import type { GameConn } from "./useGame";
import { savedName } from "./useGame";
import { normalizeRoomCode } from "./net/peer";
import type { ClientMessage } from "./game/protocol";
import type { RoleView, Snapshot } from "./types";
import {
  AnnouncementLog,
  AnnouncementToasts,
  ConnBadge,
  DocEditor,
  ErrorToast,
  Leaderboard,
  PhaseStepper,
  QuestionBoard,
  QuestionLog,
  ReadyBar,
  ResultsView,
  ScenarioPanel,
  SoundToggle,
  TimerDisplay,
  VacantRolesCard,
} from "./components";

export default function PlayerApp({
  conn,
  roomCode,
  connecting,
  onSubmitJoin,
  onCancelJoin,
}: {
  conn: GameConn;
  roomCode: string;
  /** ルームコード入力後、参加が確定するまでの待ち状態 */
  connecting: boolean;
  onSubmitJoin: (code: string, name: string) => void;
  onCancelJoin: () => void;
}) {
  const { state, status, joined, lastError, clearError, serverNow, send } = conn;
  useEffect(() => { window.scrollTo(0, 0); }, [state?.phase]);

  if (!joined || !state) {
    return (
      <JoinScreen
        initialCode={roomCode}
        connecting={connecting}
        onJoin={onSubmitJoin}
        onCancel={onCancelJoin}
        status={status}
        lastError={lastError}
        clearError={clearError}
      />
    );
  }

  const myRole = findMyRole(state);

  return (
    <div className={`app player-app${state.phase === "lobby" ? " player-lobby" : state.phase !== "results" ? " player-authoring" : ""}`}>
      <header className="topbar">
        <ProductIdentity />
        <TimerDisplay timer={state.timer} serverNow={serverNow} />
        <div className="topbar-right">
          <SoundToggle />
          {state.myRoomName && <div className="room-chip">🚪 {state.myRoomName}</div>}
          {myRole && (
            <div className="me-chip">
              {myRole.icon} {myRole.title}
            </div>
          )}
        </div>
      </header>
      {state.phase !== "lobby" && <PhaseStepper phase={state.phase} />}
      <main className="content">
        {state.phase === "results" && <SessionHeading state={state} />}
        {status !== "open" && <div className="connection-notice" role="status">ホストとの接続を確認しています。入力内容はこの画面に残ります。再接続まで送信・編集はできません。</div>}
        <PlayerConnectionContext.Provider value={status === "open"}>
        <PlayerPhaseContent
          key={state.scenario?.id ?? "lobby"}
          state={state}
          send={send}
          myRole={myRole}
          serverNow={serverNow}
          lastError={lastError}
        />
        </PlayerConnectionContext.Provider>
      </main>
      <AnnouncementToasts items={state.announcements} />
      <ErrorToast message={lastError} onClose={clearError} />
      <ConnBadge status={status} />
    </div>
  );
}

function findMyRole(state: Snapshot): RoleView | null {
  const me = state.players.find((p) => p.id === state.myPlayerId);
  if (!me?.roleId || !state.scenario) return null;
  return state.scenario.roles.find((r) => r.id === me.roleId) ?? null;
}

function JoinScreen({
  initialCode,
  connecting,
  onJoin,
  onCancel,
  status,
  lastError,
  clearError,
}: {
  initialCode: string;
  connecting: boolean;
  onJoin: (code: string, name: string) => void;
  onCancel: () => void;
  status: string;
  lastError: string | null;
  clearError: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(savedName());
  const ready = code.length === 6 && !!name.trim();

  return (
    <div className="join-screen join-experience">
      <div className="join-form-panel">
      <div className="join-card">
        <ProductIdentity />
        <h1>ゲームに参加</h1>
        <p className="muted">
          ホストから届いたルームコードと、チームに表示する名前を入力してください。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !connecting) onJoin(code, name.trim());
          }}
        >
          <label className="field-label" htmlFor="join-room-code">ルームコード <span>ホストから届いた6文字</span></label>
          <input
            id="join-room-code"
            disabled={connecting}
            autoComplete="off"
            autoFocus={!initialCode}
            className="room-input"
            placeholder="ルームコード"
            value={code}
            maxLength={6}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
          />
          <label className="field-label" htmlFor="join-player-name">あなたの名前 <span>ニックネームでもOK</span></label>
          <input
            id="join-player-name"
            disabled={connecting}
            autoComplete="nickname"
            autoFocus={!!initialCode}
            placeholder="あなたの名前(ニックネーム可)"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={!ready || connecting}>
            {connecting ? "接続中…" : "参加する"}
          </button>
        </form>
        {lastError && (
          <p className="error-text" role="alert" onClick={clearError}>
            ⚠ {lastError}
          </p>
        )}
        {connecting && <button className="ghost" onClick={onCancel}>接続を中止して入力し直す</button>}
        {connecting && status !== "open" && (
          <p className="small muted pulse">ホストを探しています…</p>
        )}
        <a className="host-entry-link" href="#host">ホストとして始める</a>
      </div>
      </div>
    </div>
  );
}

function PlayerPhaseContent({
  state,
  send,
  myRole,
  serverNow,
  lastError,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
  myRole: RoleView | null;
  serverNow: () => number;
  lastError: string | null;
}) {
  const hearing = state.scenario?.type === "hearing";
  const document = <DocEditor state={state} send={send} serverNow={serverNow} lastError={lastError} focused />;
  switch (state.phase) {
    case "lobby": return <LobbyView state={state} />;
    case "briefing": // Compatibility with older snapshots.
    case "discussion":
    case "voting": // Older saved sessions still allow participants to finish their document.
    case "finalize": return <>
      <AnnouncementLog items={state.announcements} />
      <div className="authoring-workspace">
          <Tabs heading={<SessionHeading state={state} />} tabs={[
            ["準備", <div className="preparation-layout">
              <div>
                <RoleCard role={myRole} hearing={hearing} />
                <VacantRolesCard state={state} />
              </div>
              <div className="preparation-reference">
                <ScenarioPanel sc={state.scenario!} collapsible showRubric={false} />
              </div>
            </div>],
            ["質問", (state.phase === "discussion" || state.phase === "briefing")
              ? <QuestionBoard state={state} send={send} />
              : <QuestionLog questions={state.questions} />],
            ["仕様書", <>{document}<ReadyBar state={state} send={send} label="仕様書の確認完了" /></>],
          ]} />
      </div>
    </>;
    case "results": return <>
      <Leaderboard state={state} highlightRoomId={state.myRoomId} />
      <ResultsView state={state} />
    </>;
  }
}

function LobbyView({ state }: { state: Snapshot }) {
  return (
    <section className="lobby-wait" aria-labelledby="lobby-wait-title">
      <h1 id="lobby-wait-title">ゲーム開始を待っています</h1>
      <p className="small muted">ホストが開始すると、自動で画面が切り替わります。</p>
      <div className="lobby-guide">
        <h2>このゲームでやること</h2>
        <p>依頼されたシステムについてチームで相談し、制限時間内に1つの仕様書を完成させます。プログラムを書く必要はありません。</p>
        <dl>
          <div><dt>準備</dt><dd>お題と自分の役割・秘密の目標を確認します。</dd></div>
          <div><dt>質問</dt><dd>依頼者や関係者に質問して、必要な情報を集めます。</dd></div>
          <div><dt>仕様書</dt><dd>何を作るか・作らないかを相談し、担当を分けて記入します。</dd></div>
        </dl>
        <p className="small muted">開始後はタブを自由に行き来できます。質問タブからホストにも質問できます。</p>
        <p className="small muted">最後に仕様書を採点します。チームの得点に加えて、自分だけの秘密の目標にも個人得点があります。</p>
      </div>
      <p className="small muted">参加者 {state.players.length}人</p>
      <div className="player-list">
        {state.players.map((p) => (
          <div
            key={p.id}
            className={
              "player-tag" +
              (p.connected ? "" : " offline") +
              (p.id === state.myPlayerId ? " player-me" : "")
            }
          >
            {p.name}
            {!p.connected && "(切断)"}
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleCard({ role, hearing }: { role: RoleView | null; hearing?: boolean }) {
  if (!role) return <div className="card">ロールが割り当てられていません</div>;
  return (
    <div className="card role-card">
      <div className="role-head">
        <span className="role-icon big">{role.icon}</span>
        <div>
          <p className="role-caption">あなたの役割</p>
          <h2>{role.title}</h2>
          <div className="muted small">{role.name}として参加します</div>
        </div>
      </div>
      <h4>あなたが担うこと</h4>
      <p className="prewrap">{role.publicProfile}</p>
      {role.privateBrief && (
        <>
          <h4>{hearing ? "🤫 あなただけが知っている情報" : "🤫 あなたの本音(非公開)"}</h4>
          <p className="prewrap secret-box">{role.privateBrief}</p>
        </>
      )}
      {role.secretConditions && role.secretConditions.length > 0 && (
        <>
          <h4>{hearing ? "🎯 あなたの個人目標(非公開)" : "🎯 秘密の勝利条件(あなただけが知っています)"}</h4>
          <ul className="secret-list">
            {role.secretConditions.map((c) => (
              <li key={c.id}>
                <span className="secret-mark">🎯</span>
                {c.text} <span className="chip chip-points">{c.points}点</span>
              </li>
            ))}
          </ul>
          <p className="small muted">
            最終的な要件定義書の内容からAIが達成/未達成を判定します。露骨に主張しすぎると他のプレイヤーに悟られるかも…?
          </p>
        </>
      )}
    </div>
  );
}

/** [ラベル, 中身, 状態別バッジ] */
type TabBadge = { label: string; count: number };
type Tab = [string, React.ReactNode, TabBadge[]?];

function Tabs({
  tabs,
  heading,
  activeLabel,
  onActiveLabelChange,
}: {
  tabs: Tab[];
  heading?: React.ReactNode;
  activeLabel?: string;
  onActiveLabelChange?: (label: string) => void;
}) {
  const valid = useMemo(() => tabs.filter(([, node]) => node != null), [tabs]);
  const prefix = useId();
  const [visited, setVisited] = useState<Set<string>>(() => new Set([valid[0]?.[0]]));
  const [internalActiveLabel, setInternalActiveLabel] = useState(valid[0]?.[0] ?? "");
  const selectedLabel = activeLabel ?? internalActiveLabel;
  // タブ構成はフェーズで変わるので、位置ではなくラベルで選択を保持する
  const foundIdx = valid.findIndex(([label]) => label === selectedLabel);
  const activeIdx = foundIdx >= 0 ? foundIdx : 0;
  const activeTabLabel = valid[activeIdx]?.[0];
  useEffect(() => {
    if (activeTabLabel) setVisited((prev) => prev.has(activeTabLabel) ? prev : new Set(prev).add(activeTabLabel));
  }, [activeTabLabel]);
  return (
    <div>
      <div className="authoring-toolbar">
      <nav className="tabs" aria-label="作業の切り替え">
        {valid.map(([label, , badges], i) => (
          <button
            key={label}
            className={"tab" + (i === activeIdx ? " tab-active" : "")}
            aria-pressed={i === activeIdx}
            aria-controls={`${prefix}-${i}`}
            onClick={() => {
              setVisited((prev) => new Set(prev).add(valid[activeIdx][0]).add(label));
              setInternalActiveLabel(label);
              onActiveLabelChange?.(label);
            }}
          >
            {label}
            {badges?.map((badge) => (
              <span className="tab-badge" key={badge.label}>
                {badge.label} {badge.count}
              </span>
            ))}
          </button>
        ))}
      </nav>
      {heading}
      </div>
      {valid.map(([label, node], i) => (
        <section key={label} id={`${prefix}-${i}`} hidden={i !== activeIdx} aria-label={label}>
          {(visited.has(label) || i === activeIdx) && node}
        </section>
      ))}
    </div>
  );
}
