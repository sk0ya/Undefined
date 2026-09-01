import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Announcement,
  DocSection,
  Phase,
  ProposalView,
  QuestionView,
  ScenarioView,
  Snapshot,
  TimerState,
} from "./types";
import { PHASES, REACTIONS, phaseIndex } from "./types";
import { buildPhaseGuide, type GuideTask } from "./game/phaseGuide";
import type { ClientMessage } from "./game/protocol";
import {
  isMuted,
  playDing,
  playFanfare,
  playTimeUp,
  playWarning,
  setMuted,
  unlockAudio,
} from "./sound";

// ---- タイマー ----

export function TimerDisplay({
  timer,
  serverNow,
}: {
  timer: TimerState;
  serverNow: () => number;
}) {
  const [, tick] = useState(0);
  // 残り1分・0秒はそれぞれ1回だけ鳴らす
  const cued = useRef<{ warn: boolean; up: boolean }>({ warn: false, up: false });

  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [timer.running, timer.endsAtMs]);

  useEffect(() => {
    cued.current = { warn: false, up: false };
  }, [timer.endsAtMs, timer.totalMs]);

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
  const secs = Math.ceil(ms / 1000);

  if (timer.running) {
    if (over && !cued.current.up) {
      cued.current.up = true;
      playTimeUp();
    } else if (!over && secs <= 60 && !cued.current.warn) {
      cued.current.warn = true;
      playWarning();
    }
  }

  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const pct = timer.totalMs > 0 ? Math.max(0, Math.min(100, (ms / timer.totalMs) * 100)) : 0;

  return (
    <div
      className={
        "timer" +
        (over ? " timer-over" : secs <= 60 ? " timer-warn" : "") +
        (!timer.running ? " timer-paused" : "")
      }
    >
      <span className="timer-text">
        {over ? "⏰ タイムアップ" : `⏱ ${mm}:${String(ss).padStart(2, "0")}`}
      </span>
      {!timer.running && !over && <span className="timer-badge">一時停止</span>}
      {timer.totalMs > 0 && (
        <span className="timer-track">
          <span className="timer-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

/** 効果音のミュート切替(トップバー) */
export function SoundToggle() {
  const [off, setOff] = useState(isMuted);
  return (
    <button
      className="sound-toggle"
      title={off ? "効果音をオンにする" : "効果音をオフにする"}
      aria-label={off ? "効果音をオンにする" : "効果音をオフにする"}
      onClick={() => {
        setMuted(!off);
        setOff(!off);
      }}
    >
      {off ? "🔇" : "🔊"}
    </button>
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

// ---- フェーズガイド -----------------------------------------

function GuideTaskList({ title, tasks }: { title: string; tasks: GuideTask[] }) {
  return (
    <section className="guide-section">
      <h4>{title}</h4>
      <ul className="guide-task-list">
        {tasks.map((item) => (
          <li key={item.label} className={`guide-task guide-task-${item.status}`}>
            <span className="guide-task-mark" aria-hidden="true">
              {item.status === "done" ? "✓" : item.status === "todo" ? "!" : "○"}
            </span>
            <span>
              <span className="guide-task-label">{item.label}</span>
              {item.count && <span className="guide-task-count">{item.count}</span>}
              {item.note && <span className="guide-task-note">{item.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 現在の目的・行動・完了条件を、タブより先に常に表示する。 */
export function PhaseGuide({ state }: { state: Snapshot }) {
  const guide = buildPhaseGuide(state);
  return (
    <section className="phase-guide" aria-labelledby="phase-guide-title">
      <div className="phase-guide-head">
        <div>
          <div className="eyebrow">いまやること</div>
          <h3 id="phase-guide-title">このフェーズの進め方</h3>
          <p>{guide.purpose}</p>
        </div>
        <div className="phase-guide-next">
          <span className="small muted">次に見る場所</span>
          <strong>{guide.next}</strong>
        </div>
      </div>
      <div className="phase-guide-grid">
        <GuideTaskList title="必ず行うこと" tasks={guide.must} />
        <GuideTaskList title="できれば行うこと" tasks={guide.nice} />
      </div>
      <div className="phase-guide-foot">
        <div>
          <span className="small muted">完了条件</span>
          <strong>{guide.completion}</strong>
        </div>
        <div className="phase-guide-ready">
          <span className="small muted">準備OKについて</span>
          <strong>{guide.readyEffect}</strong>
        </div>
      </div>
    </section>
  );
}

/** 議論の主要導線をタブの外にも置き、未対応数から次の行動を選べるようにする。 */
export function DiscussionActionHub({
  state,
  onOpen,
}: {
  state: Snapshot;
  onOpen: (tabLabel: string) => void;
}) {
  const hasNPCs = (state.scenario?.npcs?.length ?? 0) > 0;
  const pendingQuestions = state.questions.filter((q) => q.pending || !q.answer).length;
  const blankSections = state.doc.filter((section) => !section.content.trim()).length;
  const links = [
    ...(hasNPCs
      ? [
          {
            label: "🎤 ヒアリング",
            action: pendingQuestions > 0 ? `未回答 ${pendingQuestions}件` : `質問 ${state.questions.length}件`,
            detail: pendingQuestions > 0 ? "回答を待つ質問を確認" : "まず事実・例外を質問する",
          },
        ]
      : []),
    {
      label: "📝 要求カード",
      action: state.proposals.length > 0 ? `提出済み ${state.proposals.length}件` : "未提出 まず1枚",
      detail: "チームの判断をカードに残す",
    },
    {
      label: "📄 仕様書",
      action: blankSections > 0 ? `未記入 ${blankSections}件` : "未記入なし",
      detail: "採用した内容を具体的に書く",
    },
  ];
  return (
    <section className="discussion-action-hub" aria-label="議論の主要導線">
      <div className="discussion-action-head">
        <strong>次の一手</strong>
        <span className="small muted">未対応の多いところから進められます</span>
      </div>
      <div className="discussion-action-links">
        {links.map((link) => (
          <button
            key={link.label}
            className="discussion-action-link"
            onClick={() => onOpen(link.label)}
          >
            <strong>{link.label}</strong>
            <span className="discussion-action-count">{link.action}</span>
            <span className="small muted">{link.detail}</span>
          </button>
        ))}
      </div>
    </section>
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
    playDing();
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

// ---- ヒアリング(質問ボード) ----

/**
 * ヒアリング型シナリオの中核。プレイヤーがNPCに質問を送り、AI(自動)または
 * ホスト(手動)が答える。ルーム単位の記録なので、ホストが同時に全ルームの
 * NPCを演じられなくてもヒアリングが成立する。
 */
export function QuestionBoard({
  state,
  send,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
}) {
  const npcs = state.scenario?.npcs ?? [];
  const [npcId, setNpcId] = useState(npcs[0]?.id ?? "");
  const [text, setText] = useState("");
  const npc = npcs.find((n) => n.id === npcId) ?? npcs[0];

  const myCount = state.questions.filter((q) => q.askerId === state.myPlayerId).length;
  const waiting = state.questions.filter((q) => !q.answer).length;

  const submit = () => {
    if (!text.trim() || !npc) return;
    unlockAudio();
    send({ type: "ask", npcId: npc.id, text: text.trim() });
    setText("");
  };

  if (npcs.length === 0) return null;

  return (
    <div>
      <div className="card ask-card">
        <div className="doc-editor-head">
          <h3>🎤 ヒアリング</h3>
          <span className="small muted">
            あなたの質問 {myCount}件{waiting > 0 && ` / 回答待ち ${waiting}件`}
          </span>
        </div>
        <p className="small muted">
          NPCは<strong>聞かれたことだけ</strong>答えます。「なぜ」「例外のときは」「今はどうしている」——
          具体的に踏み込むほど、隠れた事情が出てきます。
        </p>
        <div className="npc-picker">
          {npcs.map((n) => (
            <button
              key={n.id}
              className={"npc-chip" + (n.id === npc?.id ? " npc-chip-on" : "")}
              onClick={() => setNpcId(n.id)}
            >
              <span className="role-icon">{n.icon}</span>
              <span>
                <strong>{n.name}</strong>
                <span className="muted small"> {n.title}</span>
              </span>
            </button>
          ))}
        </div>
        {npc && <p className="npc-opening prewrap">💬 {npc.opening}</p>}
        <label className="sr-only" htmlFor="player-question-input">NPCへの質問</label>
        <textarea
          id="player-question-input"
          rows={2}
          maxLength={300}
          placeholder={`${npc?.name ?? "NPC"}さんへの質問(例: 予約が重なったとき、いまは誰がどう捌いていますか?)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          }}
        />
        <div className="ask-actions">
          <button disabled={!text.trim()} onClick={submit}>
            質問する
          </button>
          <span className="small muted">
            Ctrl+Enterでも送信 ／{" "}
            {state.autoAnswer ? "AIが即座に答えます" : "ホストが回答します"}
          </span>
        </div>
      </div>
      <QuestionLog questions={state.questions} myPlayerId={state.myPlayerId} />
    </div>
  );
}

/** 質問と回答の記録(新しい順)。ルーム全員で共有される */
export function QuestionLog({
  questions,
  myPlayerId,
  heading,
}: {
  questions: QuestionView[];
  myPlayerId?: string;
  heading?: string;
}) {
  // 新しい回答が届いたら知らせる
  const answered = questions.filter((q) => q.answer).length;
  const prevAnswered = useRef<number | null>(null);
  useEffect(() => {
    if (prevAnswered.current !== null && answered > prevAnswered.current) playDing();
    prevAnswered.current = answered;
  }, [answered]);

  return (
    <div className="card">
      <h3>{heading ?? `📒 ヒアリング記録(${questions.length})`}</h3>
      {questions.length === 0 && (
        <p className="muted">
          まだ質問がありません。まずは「いま困っていることは何ですか?」から始めてみましょう。
        </p>
      )}
      <div className="qa-list">
        {[...questions].reverse().map((q) => (
          <div key={q.id} className={"qa" + (q.askerId === myPlayerId ? " qa-mine" : "")}>
            <div className="qa-q">
              <span className="qa-asker">
                {q.askerName}
                {q.askerRole && <span className="muted small"> / {q.askerRole}</span>}
              </span>
              <span className="qa-arrow">→</span>
              <span className="qa-npc">
                {q.npcIcon} {q.npcName}
              </span>
            </div>
            <div className="qa-text prewrap">{q.text}</div>
            {q.answer ? (
              <div className="qa-a prewrap">
                <span className="qa-a-icon">{q.npcIcon}</span>
                <span>
                  {q.answer}
                  {q.source === "ai" && <span className="chip chip-ai">AI</span>}
                </span>
              </div>
            ) : (
              <div className="qa-waiting">
                {q.pending ? "…考えています" : "…回答待ち"}
              </div>
            )}
          </div>
        ))}
      </div>
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
        {(sc.difficulty || sc.recommendedPlayers || sc.recommendedMinutes) && (
          <p className="small scenario-meta">
            {sc.difficulty && <span className="chip chip-cat">難易度: {sc.difficulty}</span>}
            {sc.recommendedPlayers && <span className="chip chip-cat">推奨: {sc.recommendedPlayers}</span>}
            {sc.recommendedMinutes && <span className="chip chip-cat">目安: {sc.recommendedMinutes}分</span>}
          </p>
        )}
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
  onReact,
  children,
}: {
  p: ProposalView;
  phase: Phase;
  isMine: boolean;
  /** 渡すとリアクションバーを表示(議論フェーズのプレイヤー向け) */
  onReact?: (emoji: string) => void;
  children?: React.ReactNode;
}) {
  const showStatus = phase === "finalize" || phase === "results";
  const totalReactions = Object.values(p.reactions ?? {}).reduce((a, b) => a + b, 0);
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
        {!onReact && totalReactions > 0 && (
          <span className="reaction-summary">
            {REACTIONS.filter((r) => p.reactions?.[r.emoji]).map((r) => (
              <span key={r.emoji}>
                {r.emoji}
                {p.reactions![r.emoji]}
              </span>
            ))}
          </span>
        )}
      </div>
      {p.notVoted && p.notVoted.length > 0 && (
        <div className="not-voted">⏳ 未投票: {p.notVoted.join("・")}</div>
      )}
      {onReact && (
        <div className="reaction-bar">
          {REACTIONS.map((r) => {
            const count = p.reactions?.[r.emoji] ?? 0;
            const mine = p.myReaction === r.emoji;
            return (
              <button
                key={r.emoji}
                className={"reaction-btn" + (mine ? " reaction-on" : "")}
                title={r.label}
                onClick={() => onReact(r.emoji)}
              >
                <span className="reaction-emoji">{r.emoji}</span>
                <span className="reaction-label">{r.label}</span>
                {count > 0 && <span className="reaction-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
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

/** 0 から target まで数え上げる(結果発表の演出) */
function useCountUp(target: number, durationMs = 1400): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out: 最後にゆっくり止まる
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/** 紙吹雪。高得点のときだけ出す */
function Confetti({ pieces = 70 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2.2,
        duration: 2.6 + Math.random() * 2,
        hue: Math.floor(Math.random() * 360),
        tilt: Math.random() * 360,
      })),
    [pieces],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          style={{
            left: `${b.left}%`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            background: `hsl(${b.hue} 85% 62%)`,
            transform: `rotate(${b.tilt}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/** チームスコアの演出付き表示 */
function TeamScoreReveal({ teamScore }: { teamScore: number }) {
  const shown = useCountUp(teamScore);
  useEffect(() => {
    playFanfare();
  }, []);
  return (
    <>
      {teamScore >= 70 && <Confetti />}
      <div className="team-score">
        <span className="team-score-num">{shown}</span>
        <span className="team-score-max">/ 100</span>
      </div>
    </>
  );
}

export function ResultsView({ state, send }: { state: Snapshot; send?: (m: ClientMessage) => void }) {
  const score = state.score;
  const sc = state.scenario;
  const [nextAction, setNextAction] = useState(state.retrospectiveAction ?? "");
  useEffect(() => setNextAction(state.retrospectiveAction ?? ""), [state.retrospectiveAction]);

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
          <TeamScoreReveal teamScore={score.teamScore} />
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

      <h3 className="section-title">🧭 振り返り</h3>
      <div className="card retrospective-card">
        <p className="small muted">
          得点だけでなく、どんな質問・要求・判断が結果につながったかをチームで確認しましょう。
        </p>
        <h4>判断の足跡</h4>
        <ul className="small">
          {state.players.map((p) => {
            const asked = state.questions.filter((q) => q.askerId === p.id).length;
            const proposals = state.proposals.filter((proposal) => proposal.authorId === p.id);
            const adopted = proposals.filter((proposal) => proposal.status === "adopted").length;
            return (
              <li key={p.id}>
                <strong>{p.name}</strong>: 質問 {asked}件 / 要求カード {proposals.length}件(採用 {adopted}件)
              </li>
            );
          })}
          {state.players.length === 0 && <li>参加者の記録はありません</li>}
        </ul>

        {score?.hiddenReqs && score.hiddenReqs.some((req) => !req.discovered) && (
          <>
            <h4>見落とした要件を、誰に聞けたか</h4>
            <ul className="small">
              {score.hiddenReqs.filter((req) => !req.discovered).map((req) => (
                <li key={req.id}>
                  <strong>{req.text ?? req.id}</strong>
                  {req.comment && <div className="muted">→ {req.comment}</div>}
                </li>
              ))}
            </ul>
            {sc?.beats?.find((beat) => beat.phase === "探索") && (
              <p className="small muted">
                次回の問い直し: {sc.beats.find((beat) => beat.phase === "探索")?.facilitatorCue}
              </p>
            )}
          </>
        )}

        {score?.testCases && score.testCases.some((test) => test.result === "fail") && (
          <>
            <h4>実運用テストで起きた事故</h4>
            <ul className="small">
              {score.testCases.filter((test) => test.result === "fail").map((test) => (
                <li key={test.id}>
                  <strong>{test.title ?? test.id}</strong>: {test.comment}
                </li>
              ))}
            </ul>
          </>
        )}

        <h4>次回の一手(チームで1つ)</h4>
        {send ? (
          <>
            <textarea
              rows={2}
              maxLength={240}
              placeholder="例: 例外時の運用を必ず1つ聞いてから、数値付きで要件を書く"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
            />
            <button
              className="small-btn"
              disabled={!nextAction.trim() || nextAction.trim() === (state.retrospectiveAction ?? "")}
              onClick={() => send({ type: "set_retrospective", roomId: state.myRoomId, retrospectiveAction: nextAction })}
            >
              次回の一手を保存
            </button>
          </>
        ) : state.retrospectiveAction ? (
          <p className="prewrap retro-action">{state.retrospectiveAction}</p>
        ) : (
          <p className="small muted">hostが記録中です。</p>
        )}
      </div>

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

      {state.questions.length > 0 && (
        <>
          <h3 className="section-title">🎤 ヒアリングの記録</h3>
          <QuestionLog
            questions={state.questions}
            myPlayerId={state.myPlayerId}
            heading={`このチームは${state.questions.length}回質問しました`}
          />
        </>
      )}

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
  serverNow,
  lastError,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
  heading?: string;
  roomId?: string; // ホストが対象ルームを指定する場合
  serverNow?: () => number;
  lastError?: string | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  const [saveStates, setSaveStates] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [saveTimes, setSaveTimes] = useState<Record<string, number>>({});
  const [conflicts, setConflicts] = useState<Record<string, { local: string; server: string }>>({});
  const [copied, setCopied] = useState(false);
  const timeouts = useRef<Record<string, number>>({});
  const lastErrorRef = useRef<string | null>(lastError ?? null);
  // 他の人の編集表示を数秒で消すため、定期的に再描画する
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, []);

  // サーバー側更新を反映(自分が編集中でないセクションのみ)
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of state.doc) {
        if (!(s.id in next)) continue;
        if (next[s.id] === s.content) {
          delete next[s.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setSaveStates((prev) => {
      const next = { ...prev };
      for (const s of state.doc) {
        if (s.id in next && s.content === drafts[s.id]) next[s.id] = "saved";
      }
      return next;
    });
    setSaveTimes((prev) => {
      const next = { ...prev };
      for (const s of state.doc) {
        if (s.id in drafts && s.content === drafts[s.id]) next[s.id] = s.editedAtMs ?? Date.now();
      }
      return next;
    });
    setConflicts((prev) => {
      const next = { ...prev };
      for (const s of state.doc) {
        const conflict = next[s.id];
        if (s.id in drafts && baselines[s.id] !== undefined && s.content !== drafts[s.id] && s.content !== baselines[s.id]) {
          next[s.id] = { local: drafts[s.id], server: s.content };
        } else if (conflict && !(s.id in drafts)) {
          delete next[s.id];
        }
      }
      return next;
    });
  }, [state.doc, drafts, baselines]);

  useEffect(() => {
    if (lastError && lastError !== lastErrorRef.current) {
      setSaveStates((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(drafts)) next[id] = "error";
        return next;
      });
    }
    lastErrorRef.current = lastError ?? null;
  }, [lastError, drafts]);

  const onEdit = (id: string, value: string) => {
    const section = state.doc.find((s) => s.id === id);
    if (!(id in drafts) && section) {
      setBaselines((prev) => ({ ...prev, [id]: section.content }));
    }
    setDrafts((prev) => ({ ...prev, [id]: value }));
    setSaveStates((prev) => ({ ...prev, [id]: "saving" }));
    setConflicts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    window.clearTimeout(timeouts.current[id]);
    timeouts.current[id] = window.setTimeout(() => {
      send({ type: "edit_doc", sectionId: id, content: value, ...(roomId ? { roomId } : {}) });
    }, 400);
  };

  const tmpl = state.scenario?.docTemplate ?? [];
  const blank = state.doc.filter((s) => !s.content.trim()).length;

  return (
    <div className="card doc-editor">
      <div className="doc-editor-head">
        <h3>
          {heading ?? "📄 要件定義書エディタ"}
          {blank > 0 && (
            <span className="blank-count">未記入 {blank}/{state.doc.length}</span>
          )}
        </h3>
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
        <button className="ghost" onClick={() => window.print()} aria-label="要件定義書を印刷">
          🖨 印刷
        </button>
      </div>
      <p className="small muted">
        全員で同時に編集できます。同じ欄を同時に書くと上書きされるので、担当を分けましょう(誰かが書いている欄には ✏️ が出ます)。「合意された要求一覧」は採用済みカードから自動で挿入されます。
      </p>
      {state.doc.map((s) => {
        const now = serverNow ? serverNow() : Date.now();
        const busy =
          s.editedBy &&
          s.editedAtMs &&
          now - s.editedAtMs < 10000 &&
          !(s.id in drafts); // 自分が編集中の欄には出さない
        return (
          <div key={s.id} className="doc-section-edit">
            <h4>
              {s.title}
              {busy && <span className="editing-badge">✏️ {s.editedBy} が編集中</span>}
              {saveStates[s.id] === "saving" && <span className="doc-save-state doc-save-saving">保存中…</span>}
              {saveStates[s.id] === "saved" && (
                <span className="doc-save-state doc-save-saved">
                  ✓ 保存済み{saveTimes[s.id] ? ` ${new Date(saveTimes[s.id]).toLocaleTimeString()}` : ""}
                </span>
              )}
              {saveStates[s.id] === "error" && <span className="doc-save-state doc-save-error">⚠ 保存失敗</span>}
            </h4>
            {conflicts[s.id] && (
              <div className="doc-conflict" role="alert">
                <strong>⚠ 同時編集を検知しました</strong>
                <p className="small muted">サーバーに別の内容が保存されています。残す内容を選んでください。</p>
                <div className="doc-conflict-columns">
                  <div>
                    <span className="small muted">サーバー保存済み</span>
                    <p className="prewrap">{conflicts[s.id].server || "(未記入)"}</p>
                  </div>
                  <div>
                    <span className="small muted">自分の下書き</span>
                    <p className="prewrap">{conflicts[s.id].local || "(未記入)"}</p>
                  </div>
                </div>
                <button
                  className="ghost small-btn"
                  onClick={() => {
                    setDrafts((prev) => {
                      const next = { ...prev };
                      delete next[s.id];
                      return next;
                    });
                    setBaselines((prev) => {
                      const next = { ...prev };
                      delete next[s.id];
                      return next;
                    });
                    setConflicts((prev) => {
                      const next = { ...prev };
                      delete next[s.id];
                      return next;
                    });
                    setSaveStates((prev) => ({ ...prev, [s.id]: "saved" }));
                  }}
                >
                  サーバー内容を採用
                </button>
                <button
                  className="small-btn"
                  onClick={() => {
                    setBaselines((prev) => ({ ...prev, [s.id]: s.content }));
                    onEdit(s.id, conflicts[s.id].local);
                  }}
                >
                  自分の下書きを再送
                </button>
              </div>
            )}
            <label className="sr-only" htmlFor={`doc-section-${s.id}`}>{s.title}</label>
            <textarea
              id={`doc-section-${s.id}`}
              rows={4}
              placeholder={tmpl.find((t) => t.id === s.id)?.placeholder ?? ""}
              value={drafts[s.id] ?? s.content}
              onFocus={(e) => {
                if (busy && !(s.id in drafts) && !window.confirm(`${s.editedBy}さんがこの欄を編集中です。上書きしますか?`)) {
                  e.currentTarget.blur();
                }
              }}
              onChange={(e) => onEdit(s.id, e.target.value)}
            />
          </div>
        );
      })}
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

// ---- チーム(同じルームの仲間) ----

/** 自分のルームの面々。誰と組んでいるのか一目で分かるようにする */
export function TeamCard({ state }: { state: Snapshot }) {
  const mates = state.players.filter((p) => p.roomId && p.roomId === state.myRoomId);
  if (mates.length === 0) return null;
  const roles = state.scenario?.roles ?? [];
  return (
    <div className="card team-card">
      <h3>
        🚪 {state.myRoomName ?? "あなたのルーム"}のチーム({mates.length}人)
      </h3>
      <div className="team-grid">
        {mates.map((p) => {
          const role = roles.find((r) => r.id === p.roleId);
          const me = p.id === state.myPlayerId;
          return (
            <div key={p.id} className={"team-member" + (me ? " team-me" : "")}>
              <span className="role-icon">{role?.icon ?? "👤"}</span>
              <div>
                <strong>
                  {p.name}
                  {me && <span className="chip chip-mine">あなた</span>}
                </strong>
                <div className="muted small">{role?.title ?? "未割当"}</div>
              </div>
              <span className={"team-status" + (p.ready ? " ready" : "")}>
                {!p.connected ? "切断" : p.ready ? "✓ 準備OK" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 準備完了シグナル ----

/**
 * 「読み終わった / 書き終わった」をホストに伝えるボタン。フェーズを進める
 * タイミングの判断材料になり、全員待たせる/置いていく事故を減らす。
 */
export function ReadyBar({
  state,
  send,
  label,
}: {
  state: Snapshot;
  send: (m: ClientMessage) => void;
  label: string;
}) {
  const me = state.players.find((p) => p.id === state.myPlayerId);
  const mates = state.players.filter((p) => p.roomId && p.roomId === state.myRoomId);
  const readyCount = mates.filter((p) => p.ready).length;
  if (!me) return null;
  return (
    <div className={"ready-bar" + (me.ready ? " ready-on" : "")}>
      <button
        className={me.ready ? "ghost" : "primary"}
        onClick={() => {
          unlockAudio();
          send({ type: "set_ready", ready: !me.ready });
        }}
      >
        {me.ready ? "✓ 準備OK(取り消す)" : label}
      </button>
      <span className="small muted">
        チームの準備状況 {readyCount}/{mates.length}
        {readyCount === mates.length && mates.length > 0 && " — 全員完了!"}
      </span>
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
