import { useMemo, useState } from "react";
import type { GameConn } from "./useGame";
import { savedName } from "./useGame";
import type { ProposalView, RoleView, Snapshot } from "./types";
import {
  AnnouncementLog,
  AnnouncementToasts,
  ConnBadge,
  DocEditor,
  ErrorToast,
  Leaderboard,
  PhaseBanner,
  PhaseStepper,
  ProposalCard,
  ResultsView,
  ScenarioPanel,
  TimerDisplay,
  VacantRolesCard,
} from "./components";

export default function PlayerApp({ conn }: { conn: GameConn }) {
  const { state, status, joined, lastError, clearError, serverNow, send, join } = conn;

  if (!joined || !state) {
    return (
      <JoinScreen
        onJoin={(name) => join({ name })}
        status={status}
        lastError={lastError}
        clearError={clearError}
      />
    );
  }

  const myRole = findMyRole(state);

  return (
    <div className="app player-app">
      <header className="topbar">
        <div className="brand">📋 要件定義ゲーム</div>
        <TimerDisplay timer={state.timer} serverNow={serverNow} />
        <div className="topbar-right">
          {state.myRoomName && <div className="room-chip">🚪 {state.myRoomName}</div>}
          {myRole && (
            <div className="me-chip">
              {myRole.icon} {myRole.title}
            </div>
          )}
        </div>
      </header>
      <PhaseStepper phase={state.phase} />
      <main className="content">
        <PhaseBanner phase={state.phase} />
        <PlayerPhaseContent state={state} send={send} myRole={myRole} />
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
  onJoin,
  status,
  lastError,
  clearError,
}: {
  onJoin: (name: string) => void;
  status: string;
  lastError: string | null;
  clearError: () => void;
}) {
  const [name, setName] = useState(savedName());
  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>📋 要件定義ゲーム</h1>
        <p className="muted">
          割り振られたロールになりきって、チームで要件定義書を作り上げましょう。
          <br />
          あなただけが知る情報と個人目標を、どう活かすかが腕の見せどころ。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onJoin(name.trim());
          }}
        >
          <input
            autoFocus
            placeholder="あなたの名前(ニックネーム可)"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={!name.trim() || status !== "open"}>
            参加する
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

function PlayerPhaseContent({
  state,
  send,
  myRole,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
  myRole: RoleView | null;
}) {
  switch (state.phase) {
    case "lobby":
      return <LobbyView state={state} />;
    case "briefing":
      return (
        <Tabs
          tabs={[
            [
              "🎭 あなたのロール",
              <div key="r">
                <RoleCard role={myRole} hearing={state.scenario?.type === "hearing"} />
                <VacantRolesCard state={state} />
              </div>,
            ],
            ["📖 シナリオ", state.scenario ? <ScenarioPanel sc={state.scenario} key="s" /> : null],
          ]}
        />
      );
    case "discussion":
      return (
        <>
          <AnnouncementLog items={state.announcements} />
          <Tabs
            tabs={[
              ["📝 要求カード", <ProposalWorkspace state={state} send={send} key="p" />],
              ["📄 仕様書", <DocEditor state={state} send={send} key="d" />],
              ["🎭 ロール", <RoleCard role={myRole} hearing={state.scenario?.type === "hearing"} key="r" />],
              ["📖 シナリオ", state.scenario ? <ScenarioPanel sc={state.scenario} key="s" /> : null],
            ]}
          />
        </>
      );
    case "voting":
      return (
        <>
          <AnnouncementLog items={state.announcements} />
          <Tabs
            tabs={[
              ["🗳 投票", <VotingView state={state} send={send} key="v" />],
              ["📄 仕様書", <DocEditor state={state} send={send} key="d" />],
              ["🎭 ロール", <RoleCard role={myRole} hearing={state.scenario?.type === "hearing"} key="r" />],
              ["📖 シナリオ", state.scenario ? <ScenarioPanel sc={state.scenario} key="s" /> : null],
            ]}
          />
        </>
      );
    case "finalize":
      return (
        <>
          <AnnouncementLog items={state.announcements} />
          <Tabs
            tabs={[
              [
                "📄 仕様書(最終確認)",
                <DocEditor
                  state={state}
                  send={send}
                  heading="📄 要件定義書(仕上げ)"
                  key="d"
                />,
              ],
              ["🎭 ロール", <RoleCard role={myRole} hearing={state.scenario?.type === "hearing"} key="r" />],
              ["📖 シナリオ", state.scenario ? <ScenarioPanel sc={state.scenario} key="s" /> : null],
            ]}
          />
        </>
      );
    case "results":
      return (
        <>
          <Leaderboard state={state} highlightRoomId={state.myRoomId} />
          <ResultsView state={state} />
        </>
      );
  }
}

function LobbyView({ state }: { state: Snapshot }) {
  return (
    <div className="card center">
      <h3>参加者({state.players.length}/40)</h3>
      <div className="player-list">
        {state.players.map((p) => (
          <div key={p.id} className={"player-tag" + (p.connected ? "" : " offline")}>
            {p.name}
            {!p.connected && "(切断)"}
          </div>
        ))}
      </div>
      <p className="muted pulse">ホストがゲームを開始するのを待っています…</p>
      <p className="small muted">開始時に2〜4人のルームへ自動で分かれ、ルーム対抗で要件定義書の品質を競います。</p>
    </div>
  );
}

function RoleCard({ role, hearing }: { role: RoleView | null; hearing?: boolean }) {
  if (!role) return <div className="card">ロールが割り当てられていません</div>;
  return (
    <div className="card role-card">
      <div className="role-head">
        <span className="role-icon big">{role.icon}</span>
        <div>
          <h3>{role.name}</h3>
          <div className="muted">{role.title}</div>
        </div>
      </div>
      <h4>公開プロフィール</h4>
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

function ProposalWorkspace({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
}) {
  const cats = state.scenario?.categories ?? [];
  const [category, setCategory] = useState(cats[0] ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    send({
      type: "propose",
      category: category || cats[0] || "",
      title: title.trim(),
      description: description.trim(),
    });
    setTitle("");
    setDescription("");
  };

  return (
    <div>
      <div className="card">
        <h3>要求カードを提出</h3>
        <p className="small muted">
          自分のロールとして必要な要件を提案しましょう。口頭での議論と併用してOKです。
        </p>
        <div className="form-row">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            placeholder="要求のタイトル(例: ロット単位のトレーサビリティ)"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <textarea
          placeholder="詳細・理由(任意)。なぜ必要か、どこまでやるかを書くと採点で有利です"
          value={description}
          rows={3}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button onClick={submit} disabled={!title.trim()}>
          提出する
        </button>
      </div>
      <ProposalList state={state} send={send} />
    </div>
  );
}

function ProposalList({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="card">
      <h3>提出された要求カード({state.proposals.length})</h3>
      {state.proposals.length === 0 && <p className="muted">まだありません</p>}
      {state.proposals.map((p) => {
        const isMine = p.authorId === state.myPlayerId;
        return (
          <ProposalCard key={p.id} p={p} phase={state.phase} isMine={isMine}>
            {isMine && state.phase === "discussion" && (
              <div className="proposal-actions">
                {editing === p.id ? (
                  <EditForm
                    p={p}
                    cats={state.scenario?.categories ?? []}
                    onSave={(cat, title, desc) => {
                      send({
                        type: "update_proposal",
                        id: p.id,
                        category: cat,
                        title,
                        description: desc,
                      });
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <button className="ghost small-btn" onClick={() => setEditing(p.id)}>
                      編集
                    </button>
                    <button
                      className="ghost small-btn danger"
                      onClick={() => send({ type: "delete_proposal", id: p.id })}
                    >
                      削除
                    </button>
                  </>
                )}
              </div>
            )}
          </ProposalCard>
        );
      })}
    </div>
  );
}

function EditForm({
  p,
  cats,
  onSave,
  onCancel,
}: {
  p: ProposalView;
  cats: string[];
  onSave: (cat: string, title: string, desc: string) => void;
  onCancel: () => void;
}) {
  const [cat, setCat] = useState(p.category);
  const [title, setTitle] = useState(p.title);
  const [desc, setDesc] = useState(p.description);
  return (
    <div className="edit-form">
      <div className="form-row">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <textarea value={desc} rows={2} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
      <div className="proposal-actions">
        <button className="small-btn" onClick={() => title.trim() && onSave(cat, title.trim(), desc)}>
          保存
        </button>
        <button className="ghost small-btn" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

function VotingView({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
}) {
  const voted = state.proposals.filter((p) => p.myVote).length;
  return (
    <div className="card">
      <h3>
        投票({voted}/{state.proposals.length})
      </h3>
      <p className="small muted">
        各要求を最終的な要件定義書に「採用すべきか」を投票してください。多数決で仮決定され、同数はファシリテーターが裁定します。
      </p>
      {state.proposals.map((p) => (
        <ProposalCard key={p.id} p={p} phase={state.phase} isMine={p.authorId === state.myPlayerId}>
          <div className="vote-buttons">
            <button
              className={"vote-btn approve" + (p.myVote === "approve" ? " selected" : "")}
              onClick={() => send({ type: "vote", proposalId: p.id, value: "approve" })}
            >
              👍 採用に賛成
            </button>
            <button
              className={"vote-btn reject" + (p.myVote === "reject" ? " selected" : "")}
              onClick={() => send({ type: "vote", proposalId: p.id, value: "reject" })}
            >
              👎 反対
            </button>
          </div>
        </ProposalCard>
      ))}
    </div>
  );
}

function Tabs({ tabs }: { tabs: [string, React.ReactNode][] }) {
  const valid = useMemo(() => tabs.filter(([, node]) => node != null), [tabs]);
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="tabs">
        {valid.map(([label], i) => (
          <button
            key={label}
            className={"tab" + (i === active ? " tab-active" : "")}
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
      </div>
      {valid[Math.min(active, valid.length - 1)]?.[1]}
    </div>
  );
}
