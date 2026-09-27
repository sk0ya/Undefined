import { useSubmission } from "./useSubmission";
import { useTabDraft, DraftNotice } from "./useTabDraft";
import { useRecordFilter } from "./RecordFilter";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PlayerConnectionContext, usePlayerConnected } from "./ConnectionContext";
import type { GameConn } from "./useGame";
import { savedName } from "./useGame";
import { normalizeRoomCode } from "./net/peer";
import type { ClientMessage } from "./game/protocol";
import type { ProposalView, RoleView, Snapshot } from "./types";
import {
  AnnouncementLog,
  AnnouncementToasts,
  ConnBadge,
  DocEditor,
  ErrorToast,
  Leaderboard,
  PhaseGuide,
  PhaseStepper,
  ProposalCard,
  QuestionBoard,
  ReadyBar,
  ResultsView,
  ScenarioPanel,
  SoundToggle,
  TeamCard,
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
    <div className="app player-app">
      <header className="topbar">
        <div className="brand">📋 要件定義ゲーム</div>
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
      <PhaseStepper phase={state.phase} />
      <main className="content">
        <PhaseGuide state={state} />
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
    <div className="join-screen">
      <div className="join-card">
        <div className="eyebrow">TEAM WORKSHOP</div>
        <h1>質問から、いい仕様を。</h1>
        <p className="join-product-name">要件定義ゲームへようこそ</p>
        <p className="muted">
          割り振られたロールになりきって、チームで要件定義書を作り上げましょう。
          <br />
          あなただけが知る情報と個人目標を、どう活かすかが腕の見せどころ。
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
        <p className="small muted">
          ルームコードはホストの画面に表示されています(6文字)。
        </p>
        {lastError && (
          <p className="error-text" role="alert" onClick={clearError}>
            ⚠ {lastError}
          </p>
        )}
        {connecting && <button className="ghost" onClick={onCancel}>接続を中止して入力し直す</button>}
        {connecting && status !== "open" && (
          <p className="small muted pulse">ホストを探しています…</p>
        )}
        <a className="host-entry-link" href="#host">主催者はこちら → ホスト画面を開く</a>
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
  const hasNPCs = (state.scenario?.npcs?.length ?? 0) > 0;
  const [discussionTab, setDiscussionTab] = useState(hasNPCs ? "🎤 ヒアリング" : "📝 要求カード");
  const [seenDiscussion, setSeenDiscussion] = useState<Record<string, Set<string>>>(() => ({
    "🎤 ヒアリング": new Set(state.questions.map((q) => q.id)),
    "📝 要求カード": new Set(state.proposals.map((p) => p.id)),
  }));
  const newQuestions = state.questions.filter(
    (q) => !q.isMine && !seenDiscussion["🎤 ヒアリング"]?.has(q.id),
  ).length;
  const newProposals = state.proposals.filter(
    (p) => p.authorId !== state.myPlayerId && !seenDiscussion["📝 要求カード"]?.has(p.id),
  ).length;
  const myProposals = state.proposals.filter((p) => p.authorId === state.myPlayerId).length;
  const pendingQuestions = state.questions.filter((q) => q.pending || !q.answer).length;
  const blankSections = state.doc.filter((section) => !section.content.trim()).length;
  const openDiscussionTab = (label: string) => {
    if (label === "🎤 ヒアリング" || label === "📝 要求カード") {
      const ids = label === "🎤 ヒアリング" ? state.questions.map((q) => q.id) : state.proposals.map((p) => p.id);
      setSeenDiscussion((prev) => ({ ...prev, [label]: new Set(ids) }));
    }
    setDiscussionTab(label);
  };
  const roleTab: Tab = [
    "🎭 ロール",
    <RoleCard role={myRole} hearing={hearing} key="r" />,
  ];
  const scenarioTab: Tab = [
    "📖 シナリオ",
    state.scenario ? <ScenarioPanel sc={state.scenario} key="s" /> : null,
  ];
  // 未対応数は作業を選ぶタブに集約する。
  const docTab = (heading?: string, badges?: TabBadge[]): Tab => [
    heading ? "📄 仕様書(最終確認)" : "📄 仕様書",
    <DocEditor state={state} send={send} heading={heading} serverNow={serverNow} lastError={lastError} key="d" />,
    badges,
  ];

  switch (state.phase) {
    case "lobby":
      return <LobbyView state={state} />;
    case "briefing":
      return (
        <>
          <Tabs
            tabs={[
              [
                "🎭 あなたのロール",
                <div key="r">
                  <RoleCard role={myRole} hearing={hearing} />
                  <VacantRolesCard state={state} />
                  <TeamCard state={state} />
                </div>,
              ],
              scenarioTab,
            ]}
          />
          <ReadyBar state={state} send={send} label="読み終わりました" />
        </>
      );
    case "discussion":
      return (
        <>
          <AnnouncementLog items={state.announcements} />
          <Tabs
            activeLabel={discussionTab}
            onActiveLabelChange={openDiscussionTab}
            tabs={[
              ...(hasNPCs
                ? ([
                    [
                      "🎤 ヒアリング",
                      <QuestionBoard state={state} send={send} key="q" />,
                      [
                        ...(pendingQuestions > 0 ? [{ label: "未対応", count: pendingQuestions }] : []),
                        ...(newQuestions > 0 ? [{ label: "新着", count: newQuestions }] : []),
                      ],
                    ],
                  ] as Tab[])
                : []),
              [
                "📝 要求カード",
                <ProposalWorkspace state={state} send={send} key="p" />,
                [
                  ...(newProposals > 0 ? [{ label: "新着", count: newProposals }] : []),
                  ...(myProposals > 0 ? [{ label: "自分の提出", count: myProposals }] : []),
                ],
              ],
              docTab(undefined, blankSections > 0 ? [{ label: "未対応", count: blankSections }] : []),
            ]}
          />
          <SupportingInfo state={state} role={myRole} hearing={hearing} />
          <ReadyBar state={state} send={send} label="議論はここまででOK" />
        </>
      );
    case "voting":
      return (
        <>
          <AnnouncementLog items={state.announcements} />
          <Tabs
            tabs={[
              [
                "🗳 投票",
                <VotingView state={state} send={send} key="v" />,
                state.proposals.filter((p) => !p.myVote).length > 0
                  ? [{ label: "未投票", count: state.proposals.filter((p) => !p.myVote).length }]
                  : [],
              ],
              docTab(),
            ]}
          />
          <SupportingInfo state={state} role={myRole} hearing={hearing} />
        </>
      );
    case "finalize":
      return (
        <>
          <AnnouncementLog items={state.announcements} />
          <Tabs
            tabs={[
              docTab("📄 要件定義書(仕上げ)"),
              ...(hasNPCs
                ? ([
                    [
                      "🎤 ヒアリング記録",
                      <QuestionBoard state={state} send={send} key="q" />,
                    ],
                  ] as Tab[])
                : []),
            ]}
          />
          <SupportingInfo state={state} role={myRole} hearing={hearing} />
          <ReadyBar state={state} send={send} label="仕上げ完了" />
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

function SupportingInfo({
  state,
  role,
  hearing,
}: {
  state: Snapshot;
  role: RoleView | null;
  hearing: boolean;
}) {
  return (
    <div className="supporting-info" aria-label="補足情報">
      <details>
        <summary>🎭 ロールを確認</summary>
        <RoleCard role={role} hearing={hearing} />
      </details>
      <details>
        <summary>📖 シナリオを確認</summary>
        {state.scenario && <ScenarioPanel sc={state.scenario} />}
      </details>
    </div>
  );
}

function LobbyView({ state }: { state: Snapshot }) {
  return (
    <div className="card center">
      <div className="lobby-status-icon" aria-hidden="true">⌛</div>
      <h3>ゲーム開始を待っています</h3>
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
      <p className="small muted">
        開始すると2〜4人のチームに分かれます。
      </p>
      <details className="lobby-tips">
        <summary>ゲームのコツを見る</summary>
        <ul className="small">
          <li><strong>例外・繁忙期・今の回避策</strong>を質問する</li>
          <li>「速い」ではなく<strong>「3秒以内」</strong>のように数字を書く</li>
          <li><strong>やらないこと</strong>も仕様書に書く</li>
        </ul>
      </details>
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
  send: (m: ClientMessage) => void;
}) {
  const connected = usePlayerConnected();
  const cats = state.scenario?.categories ?? [];
  const scope = `${state.myRoomId}:${state.myPlayerId}:proposal`;
  const categoryDraft = useTabDraft(`${scope}:category`, cats[0] ?? "");
  const titleDraft = useTabDraft(`${scope}:title`);
  const descriptionDraft = useTabDraft(`${scope}:description`);
  const { value: category, setValue: setCategory } = categoryDraft;
  const { value: title, setValue: setTitle } = titleDraft;
  const { value: description, setValue: setDescription } = descriptionDraft;

  const submission = useSubmission(state.proposals);
  const latestDraft = useRef({ title, description });
  latestDraft.current = { title, description };
  const submit = () => {
    if (!connected || !title.trim()) return;
    if (!submission.begin(
      (p) => p.authorId === state.myPlayerId && p.title === title.trim() && p.description === description.trim() && p.category === (category || cats[0] || ""),
      () => {
        if (latestDraft.current.title === title) setTitle("");
        if (latestDraft.current.description === description) setDescription("");
      },
    )) return;
    send({
      type: "propose",
      category: category || cats[0] || "",
      title: title.trim(),
      description: description.trim(),
    });
  };

  return (
    <fieldset className="proposal-workspace interaction-fields" disabled={!connected || submission.waiting}>
      <details className="card proposal-compose compose-disclosure">
        <summary>＋ 要求カードを作成</summary>
        <p className="small muted">
          自分のロールとして必要な要件を提案しましょう。口頭での議論と併用してOKです。
        </p>
        <DraftNotice restored={titleDraft.restored || descriptionDraft.restored} error={titleDraft.error || descriptionDraft.error || categoryDraft.error} />
        <div className="form-row">
          <label className="field-label" htmlFor="proposal-category">要求カードのカテゴリ</label>
          <select id="proposal-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="proposal-title">要求カードのタイトル</label>
          <input
            id="proposal-title"
            placeholder="要求のタイトル(例: ロット単位のトレーサビリティ)"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
          />
        </div>
        <label className="field-label" htmlFor="proposal-description">要求カードの詳細・理由</label>
        <textarea
          id="proposal-description"
          placeholder="詳細・理由(任意)。なぜ必要か、どこまでやるかを書くと採点で有利です"
          value={description}
          rows={3}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
        {submission.message && <p role="status" className="small">{submission.message}</p>}
        <button onClick={submit} disabled={!title.trim()}>
          提出する
        </button>
      </details>
      <ProposalList state={state} send={send} />
    </fieldset>
  );
}

function ProposalList({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const { shown, controls } = useRecordFilter({
    items: state.proposals, label: "要求カード",
    fields: (p) => [p.title, p.description, p.category, p.authorName, p.authorRole],
    facets: [{ label: "カテゴリ", value: (p) => p.category }, { label: "提出者", value: (p) => p.authorName }],
  });
  return (
    <div className="card">
      <h3>提出された要求カード({state.proposals.length})</h3>
      {state.proposals.length === 0 && (
        <p className="muted">
          まだありません。気づいたことは小さくてもカードにしておくと、投票と採点で効いてきます。
        </p>
      )}
      {state.proposals.length > 0 && (
        <p className="small muted">
          リアクションで温度感を伝えられます(投票ではないので何度でも変えられます)。
        </p>
      )}
      {state.proposals.length > 0 && <details className="filter-disclosure"><summary>要求カードを検索・絞り込み</summary>{controls}</details>}
      {shown.map((p) => {
        const isMine = p.authorId === state.myPlayerId;
        return (
          <ProposalCard
            key={p.id}
            p={p}
            phase={state.phase}
            isMine={isMine}
            onReact={(emoji) => send({ type: "react", proposalId: p.id, emoji })}
          >
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
                      onClick={() => {
                        if (window.confirm(`「${p.title}」を削除しますか？削除すると元に戻せません。`)) send({ type: "delete_proposal", id: p.id });
                      }}
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
        <label className="sr-only" htmlFor={`proposal-edit-category-${p.id}`}>要求カードのカテゴリ</label>
        <select id={`proposal-edit-category-${p.id}`} value={cat} onChange={(e) => setCat(e.target.value)}>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`proposal-edit-title-${p.id}`}>要求カードのタイトル</label>
        <input id={`proposal-edit-title-${p.id}`} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <label className="sr-only" htmlFor={`proposal-edit-description-${p.id}`}>要求カードの詳細</label>
      <textarea id={`proposal-edit-description-${p.id}`} value={desc} rows={2} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
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
  send: (m: ClientMessage) => void;
}) {
  const connected = usePlayerConnected();
  const [onlyUnvoted, setOnlyUnvoted] = useState(false);
  const total = state.proposals.length;
  const voted = state.proposals.filter((p) => p.myVote).length;
  const done = total > 0 && voted === total;
  const { shown: matches, controls } = useRecordFilter({
    items: state.proposals, label: "投票カード",
    fields: (p) => [p.title, p.description, p.category, p.authorName],
    facets: [{ label: "カテゴリ", value: (p) => p.category }],
  });
  const shown = onlyUnvoted ? matches.filter((p) => !p.myVote) : matches;

  return (
    <fieldset className="card interaction-fields voting-workspace" disabled={!connected}>
      <div className="doc-editor-head">
        <h3>
          投票({voted}/{total})
        </h3>
        {(total > voted || onlyUnvoted) && (
          <button className="ghost small-btn" onClick={() => setOnlyUnvoted((v) => !v)}>
            {onlyUnvoted ? "すべて表示" : `未投票だけ表示(${total - voted})`}
          </button>
        )}
      </div>
      <div className="vote-progress">
        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: `${total ? (voted / total) * 100 : 0}%` }}
          />
        </div>
      </div>
      {done ? (
        <p className="ok-text">✓ すべて投票しました。チーム全員が終わるまで少し待ちましょう。</p>
      ) : (
        <p className="small muted">
          各要求を最終的な要件定義書に「採用すべきか」を投票してください。多数決で仮決定され、同数はファシリテーターが裁定します。
        </p>
      )}
      {total > 0 && controls}
      {total === 0 && <p className="muted">要求カードがありません</p>}
      {onlyUnvoted && matches.length > 0 && shown.length === 0 && !done && <p className="small muted">検索結果のカードは投票済みです。「すべて表示」または絞り込みを解除して他のカードを確認できます。</p>}
      {shown.map((p) => (
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
    </fieldset>
  );
}

/** [ラベル, 中身, 状態別バッジ] */
type TabBadge = { label: string; count: number };
type Tab = [string, React.ReactNode, TabBadge[]?];

function Tabs({
  tabs,
  activeLabel,
  onActiveLabelChange,
}: {
  tabs: Tab[];
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
      {valid.map(([label, node], i) => (
        <section key={label} id={`${prefix}-${i}`} hidden={i !== activeIdx} aria-label={label}>
          {(visited.has(label) || i === activeIdx) && node}
        </section>
      ))}
    </div>
  );
}
