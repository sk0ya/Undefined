import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Announcement,
  DocSection,
  Phase,
  ProposalView,
  ScenarioView,
  ScoreResult,
  Snapshot,
  TimerState,
} from "./types";
import { PHASES, phaseIndex } from "./types";

// ---- タイマー ----

export function TimerDisplay({
  timer,
  serverNow,
}: {
  timer: TimerState;
  serverNow: () => number;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [timer.running, timer.endsAtMs]);

  let ms: number;
  if (timer.running) {
    ms = timer.endsAtMs - serverNow();
  } else if (timer.remainingMs > 0) {
    ms = timer.remainingMs;
  } else {
    return null;
  }
  const over = ms <= 0;
  if (over) ms = 0;
  const total = Math.ceil(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return (
    <div
      className={
        "timer" +
        (over ? " timer-over" : total <= 60 ? " timer-warn" : "") +
        (!timer.running ? " timer-paused" : "")
      }
    >
      {over ? "⏰ タイムアップ" : `⏱ ${mm}:${String(ss).padStart(2, "0")}`}
      {!timer.running && !over && <span className="timer-badge">一時停止</span>}
    </div>
  );
}

// ---- フェーズ表示 ----

export function PhaseStepper({ phase }: { phase: Phase }) {
  const idx = phaseIndex(phase);
  return (
    <div className="stepper">
      {PHASES.map((p, i) => (
        <div
          key={p.id}
          className={
            "step" + (i === idx ? " step-active" : i < idx ? " step-done" : "")
          }
        >
          <span className="step-num">{i + 1}</span>
          <span className="step-label">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

export function PhaseBanner({ phase }: { phase: Phase }) {
  const p = PHASES.find((x) => x.id === phase);
  if (!p) return null;
  return (
    <div className="phase-banner">
      <h2>{p.label}</h2>
      <p>{p.desc}</p>
    </div>
  );
}

// ---- お知らせ(イベント) ----

export function AnnouncementToasts({ items }: { items: Announcement[] }) {
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [visible, setVisible] = useState<Announcement[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      // 初回スナップショットの既存分はトーストしない
      initialized.current = true;
      setSeen(new Set(items.map((a) => a.id)));
      return;
    }
    const fresh = items.filter((a) => !seen.has(a.id));
    if (fresh.length === 0) return;
    setSeen((prev) => {
      const next = new Set(prev);
      fresh.forEach((a) => next.add(a.id));
      return next;
    });
    setVisible((prev) => [...prev, ...fresh]);
    fresh.forEach((a) => {
      setTimeout(() => {
        setVisible((prev) => prev.filter((x) => x.id !== a.id));
      }, 15000);
    });
  }, [items]);

  if (visible.length === 0) return null;
  return (
    <div className="toasts">
      {visible.map((a) => (
        <div key={a.id} className="toast">
          <div className="toast-title">📢 {a.title}</div>
          <div className="toast-body">{a.body}</div>
          <button
            className="toast-close"
            onClick={() => setVisible((prev) => prev.filter((x) => x.id !== a.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function AnnouncementLog({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null;
  return (
    <div className="card">
      <h3>📢 クライアントからの連絡事項</h3>
      {[...items].reverse().map((a) => (
        <div key={a.id} className="announce-item">
          <strong>{a.title}</strong>
          <p>{a.body}</p>
        </div>
      ))}
    </div>
  );
}

// ---- シナリオ表示 ----

export function ScenarioPanel({ sc }: { sc: ScenarioView }) {
  return (
    <div className="card">
      <div className="scenario-head">
        <h3>{sc.title}</h3>
        <p className="muted">
          {sc.clientName}({sc.industry})
        </p>
        <p className="tagline">“{sc.tagline}”</p>
      </div>
      <h4>背景</h4>
      <p className="prewrap">{sc.background}</p>
      <h4>プロジェクトの公式ゴール</h4>
      <p className="prewrap goal">{sc.publicGoal}</p>
      <h4>制約条件</h4>
      <ul>
        {sc.constraints.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <h4>{sc.type === "hearing" ? "開発チームの担当分け" : "登場するステークホルダー"}</h4>
      <div className="role-grid">
        {sc.roles.map((r) => (
          <div key={r.id} className="role-mini">
            <div className="role-mini-head">
              <span className="role-icon">{r.icon}</span>
              <div>
                <strong>{r.name}</strong>
                <div className="muted small">{r.title}</div>
              </div>
            </div>
            <p className="small">{r.publicProfile}</p>
          </div>
        ))}
      </div>
      {sc.npcs && sc.npcs.length > 0 && (
        <>
          <h4>🎤 ヒアリング対象(ホストが演じます)</h4>
          <p className="small muted">
            聞かれていないことは基本的に話しません。良い質問が隠れた事情を掘り当てます。
          </p>
          <div className="role-grid">
            {sc.npcs.map((n) => (
              <div key={n.id} className="role-mini npc-mini">
                <div className="role-mini-head">
                  <span className="role-icon">{n.icon}</span>
                  <div>
                    <strong>{n.name}</strong>
                    <div className="muted small">{n.title}</div>
                  </div>
                </div>
                <p className="small prewrap">{n.opening}</p>
              </div>
            ))}
          </div>
        </>
      )}
      {sc.rubric && sc.rubric.length > 0 && (
        <>
          <h4>採点基準(公開)</h4>
          <ul className="small">
            {sc.rubric.map((r) => (
              <li key={r.name}>
                <strong>
                  {r.name}({r.max}点)
                </strong>
                : {r.description}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---- 提案カード ----

const STATUS_LABEL: Record<string, string> = {
  pending: "審議中",
  adopted: "採用",
  rejected: "却下",
};

export function ProposalCard({
  p,
  phase,
  isMine,
  children,
}: {
  p: ProposalView;
  phase: Phase;
  isMine: boolean;
  children?: React.ReactNode;
}) {
  const showStatus = phase === "finalize" || phase === "results";
  return (
    <div className={"proposal" + (showStatus ? ` proposal-${p.status}` : "")}>
      <div className="proposal-head">
        <span className="chip chip-cat">{p.category}</span>
        {showStatus && (
          <span className={`chip chip-${p.status}`}>{STATUS_LABEL[p.status]}</span>
        )}
        {isMine && <span className="chip chip-mine">自分</span>}
      </div>
      <div className="proposal-title">{p.title}</div>
      {p.description && <div className="proposal-desc prewrap">{p.description}</div>}
      <div className="proposal-meta">
        提案: {p.authorRole ? `${p.authorRole} ` : ""}
        {p.authorName}
        {p.votesVisible && (phase === "voting" || showStatus) && (
          <span className="vote-counts">
            賛成 {p.approveCount} / 反対 {p.rejectCount}
          </span>
        )}
        {!p.votesVisible && phase === "voting" && (
          <span className="vote-counts">投票済 {p.votedCount}人</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ---- 要件定義書レンダリング ----

export function buildDocMarkdown(state: Snapshot): string {
  const sc = state.scenario;
  const lines: string[] = [];
  lines.push(`# 要件定義書 — ${sc?.title ?? ""}`);
  lines.push("");
  for (const s of state.doc) {
    lines.push(`## ${s.title}`);
    lines.push(s.content.trim() || "(未記入)");
    lines.push("");
  }
  lines.push(`## 合意された要求一覧`);
  const adopted = state.proposals.filter((p) => p.status === "adopted");
  const cats = sc?.categories ?? [];
  const order = [...cats, ...adopted.map((p) => p.category).filter((c) => !cats.includes(c))];
  for (const cat of [...new Set(order)]) {
    const items = adopted.filter((p) => p.category === cat);
    if (items.length === 0) continue;
    lines.push(`### ${cat}`);
    for (const p of items) {
      lines.push(`- **${p.title}** — ${p.description.replace(/\n/g, " ")}(提案: ${p.authorRole || p.authorName})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function DocView({ state }: { state: Snapshot }) {
  const adopted = state.proposals.filter((p) => p.status === "adopted");
  const cats = useMemo(() => {
    const base = state.scenario?.categories ?? [];
    const extra = adopted.map((p) => p.category).filter((c) => !base.includes(c));
    return [...new Set([...base, ...extra])];
  }, [state]);
  return (
    <div className="doc">
      {state.doc.map((s: DocSection) => (
        <section key={s.id}>
          <h4>{s.title}</h4>
          <p className="prewrap">{s.content.trim() || <span className="muted">(未記入)</span>}</p>
        </section>
      ))}
      <section>
        <h4>合意された要求一覧</h4>
        {adopted.length === 0 && <p className="muted">(まだありません)</p>}
        {cats.map((cat) => {
          const items = adopted.filter((p) => p.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} className="doc-cat">
              <h5>{cat}</h5>
              <ul>
                {items.map((p) => (
                  <li key={p.id}>
                    <strong>{p.title}</strong>
                    {p.description && ` — ${p.description}`}
                    <span className="muted small">(提案: {p.authorRole || p.authorName})</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ---- 結果表示 ----

export function ResultsView({ state }: { state: Snapshot }) {
  const score = state.score;
  const sc = state.scenario;

  const playerCards = state.players
    .filter((p) => p.roleId && (!state.myRoomId || p.roomId === state.myRoomId))
    .map((p) => {
      const role = sc?.roles.find((r) => r.id === p.roleId);
      const ps = score?.players.find((x) => x.playerId === p.id);
      return { player: p, role, ps };
    });

  const maxSecret = Math.max(0, ...playerCards.map((c) => c.ps?.secretScore ?? 0));

  return (
    <div>
      {score ? (
        <div className="card score-card">
          <h3>🏆 チームスコア</h3>
          <div className="team-score">
            <span className="team-score-num">{score.teamScore}</span>
            <span className="team-score-max">/ 100</span>
          </div>
          <div className="axes">
            {score.axes.map((a) => (
              <div key={a.name} className="axis">
                <div className="axis-head">
                  <span>{a.name}</span>
                  <span>
                    {a.score}/{a.max}
                  </span>
                </div>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{ width: `${Math.min(100, (a.score / a.max) * 100)}%` }}
                  />
                </div>
                <p className="small muted">{a.comment}</p>
              </div>
            ))}
          </div>
          {score.overallComment && (
            <>
              <h4>総評</h4>
              <p className="prewrap">{score.overallComment}</p>
            </>
          )}
          {score.improvement && (
            <>
              <h4>実務へのアドバイス</h4>
              <p className="prewrap">{score.improvement}</p>
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <h3>🏆 結果</h3>
          <p className="muted">AI採点はまだ実行されていません。秘密の勝利条件を公開します。</p>
        </div>
      )}

      {score?.testCases && score.testCases.length > 0 && (
        <>
          <h3 className="section-title">🧪 実運用テスト</h3>
          <div className="card">
            <p className="small muted">
              あなたたちの仕様どおりにシステムと店舗が動いたと仮定して、AIが実運用をシミュレーションしました。
            </p>
            {score.testCases.map((tc) => (
              <div key={tc.id} className={`testcase tc-${tc.result}`}>
                <span className="tc-mark">
                  {tc.result === "ok" ? "✅" : tc.result === "partial" ? "⚠️" : "💥"}
                </span>
                <div>
                  <strong>{tc.title ?? tc.id}</strong>
                  {sc?.testCases && (
                    <div className="small muted">
                      {sc.testCases.find((x) => x.id === tc.id)?.situation}
                    </div>
                  )}
                  <div className="small">{tc.comment}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {score?.hiddenReqs && score.hiddenReqs.length > 0 && (
        <>
          <h3 className="section-title">🔎 隠れ要件の発見状況</h3>
          <div className="card">
            <p className="small muted">
              発見 {score.hiddenReqs.filter((r) => r.discovered).length} /{" "}
              {score.hiddenReqs.length}
            </p>
            <ul className="secret-list">
              {score.hiddenReqs.map((r) => (
                <li key={r.id} className={r.discovered ? "ok" : "ng"}>
                  <span className="secret-mark">{r.discovered ? "✅" : "❌"}</span>
                  {r.text ?? r.id}
                  {r.comment && <div className="small muted">→ {r.comment}</div>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {score?.futureProblems && score.futureProblems.length > 0 && (
        <>
          <h3 className="section-title">🔮 3か月後に起きそうな問題</h3>
          <div className="card">
            <ol>
              {score.futureProblems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
        </>
      )}

      {score?.titles && score.titles.length > 0 && (
        <>
          <h3 className="section-title">🎖 称号</h3>
          <div className="title-grid">
            {score.titles.map((t) => (
              <div key={t.id} className="card title-card">
                <div className="title-name">🎖 {t.title || t.id}</div>
                <div className="title-holder">{t.playerName ?? t.playerId}</div>
                <p className="small muted">{t.reason}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="section-title">
        {sc?.type === "hearing" ? "個人目標 公開" : "秘密の勝利条件 公開"}
      </h3>
      <div className="reveal-grid">
        {playerCards.map(({ player, role, ps }) => (
          <div key={player.id} className="card reveal-card">
            <div className="reveal-head">
              <span className="role-icon big">{role?.icon}</span>
              <div>
                <strong>{player.name}</strong>
                <div className="muted small">
                  {role?.name} / {role?.title}
                </div>
              </div>
              {ps && (
                <div className="secret-score">
                  {ps.secretScore}
                  <span className="small muted">/{ps.secretMax}点</span>
                  {ps.secretScore === maxSecret && maxSecret > 0 && (
                    <span className="chip chip-mvp">MVP</span>
                  )}
                </div>
              )}
            </div>
            {role?.privateBrief && (
              <p className="small prewrap brief">{role.privateBrief}</p>
            )}
            <ul className="secret-list">
              {role?.secretConditions?.map((c) => {
                const r = ps?.conditions.find((x) => x.id === c.id);
                return (
                  <li key={c.id} className={r ? (r.achieved ? "ok" : "ng") : ""}>
                    <span className="secret-mark">
                      {r ? (r.achieved ? "✅" : "❌") : "❔"}
                    </span>
                    {c.text}
                    <span className="muted">({c.points}点)</span>
                    {r?.reason && <div className="small muted">→ {r.reason}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <h3 className="section-title">最終成果物</h3>
      <div className="card">
        <DocView state={state} />
      </div>
    </div>
  );
}

// ---- 要件定義書エディタ(ホスト・プレイヤー共用) ----

export function DocEditor({
  state,
  send,
  heading,
  roomId,
}: {
  state: Snapshot;
  send: (m: Record<string, unknown>) => void;
  heading?: string;
  roomId?: string; // ホストが対象ルームを指定する場合
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const timeouts = useRef<Record<string, number>>({});

  // サーバー側更新を反映(自分が編集中でないセクションのみ)
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of state.doc) {
        if (!(s.id in next)) continue;
        if (next[s.id] === s.content) delete next[s.id];
      }
      return next;
    });
  }, [state.doc]);

  const onEdit = (id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
    window.clearTimeout(timeouts.current[id]);
    timeouts.current[id] = window.setTimeout(() => {
      send({ type: "edit_doc", sectionId: id, content: value, ...(roomId ? { roomId } : {}) });
    }, 400);
  };

  const tmpl = state.scenario?.docTemplate ?? [];

  return (
    <div className="card">
      <div className="doc-editor-head">
        <h3>{heading ?? "📄 要件定義書エディタ"}</h3>
        <button
          className="ghost"
          onClick={() => {
            navigator.clipboard.writeText(buildDocMarkdown(state));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "✓ コピーしました" : "Markdownをコピー"}
        </button>
      </div>
      <p className="small muted">
        全員で同時に編集できます(同じ欄を同時に書くと上書きされるので、担当を分けましょう)。「合意された要求一覧」は採用済みカードから自動で挿入されます。
      </p>
      {state.doc.map((s) => (
        <div key={s.id} className="doc-section-edit">
          <h4>{s.title}</h4>
          <textarea
            rows={4}
            placeholder={tmpl.find((t) => t.id === s.id)?.placeholder ?? ""}
            value={drafts[s.id] ?? s.content}
            onChange={(e) => onEdit(s.id, e.target.value)}
          />
        </div>
      ))}
      <h4>合意された要求一覧(自動)</h4>
      <DocView state={{ ...state, doc: [] }} />
    </div>
  );
}

// ---- ルーム対抗リーダーボード ----

export function Leaderboard({
  state,
  highlightRoomId,
}: {
  state: Snapshot;
  highlightRoomId?: string;
}) {
  const lb = state.leaderboard ?? [];
  if (lb.length <= 1) return null;
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="card leaderboard">
      <h3>🏆 ルーム対抗リーダーボード</h3>
      <div className="lb-rows">
        {lb.map((e, i) => (
          <div
            key={e.roomId}
            className={
              "lb-row" +
              (e.roomId === highlightRoomId ? " lb-mine" : "") +
              (!e.scored ? " lb-unscored" : "")
            }
          >
            <span className="lb-rank">{e.scored ? (medals[i] ?? `${i + 1}位`) : "—"}</span>
            <span className="lb-name">{e.roomName}</span>
            <span className="lb-members">{e.playerNames.join("・")}</span>
            <span className="lb-score">
              {e.scored ? (
                <>
                  {e.teamScore}
                  <small>点</small>
                </>
              ) : (
                <small>採点待ち</small>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- 不在ロールの引き継ぎ資料(欠員補償) ----

export function VacantRolesCard({ state }: { state: Snapshot }) {
  const vacant = (state.scenario?.roles ?? []).filter((r) => r.vacant && r.privateBrief);
  if (vacant.length === 0) return null;
  return (
    <div className="card vacant-card">
      <h3>📂 不在ロールからの引き継ぎ資料</h3>
      <p className="small muted">
        このルーム({state.myRoomName})にいないロールの担当者が知っていた情報です。チーム全員に公開されます —
        仕様に活かしてください。
      </p>
      {vacant.map((r) => (
        <div key={r.id} className="vacant-role">
          <div className="role-mini-head">
            <span className="role-icon">{r.icon}</span>
            <div>
              <strong>
                {r.name}({r.title})
              </strong>
              <span className="chip chip-vacant">不在</span>
            </div>
          </div>
          <p className="small prewrap secret-box">{r.privateBrief}</p>
        </div>
      ))}
    </div>
  );
}

// ---- 接続バッジ ----

export function ConnBadge({ status }: { status: string }) {
  if (status === "open") return null;
  return (
    <div className="conn-badge">
      {status === "connecting" ? "接続中…" : "切断されました。再接続しています…"}
    </div>
  );
}

// ---- エラートースト ----

export function ErrorToast({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div className="error-toast" onClick={onClose}>
      ⚠ {message}
    </div>
  );
}
