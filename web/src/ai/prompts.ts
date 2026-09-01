// 採点・NPC回答・イベント生成・ファシリ補助のプロンプト組み立てと、応答の解釈。
// もともと internal/ai/ai.go にあったものの移植。文字列を組むだけの純粋な処理。

import type { GameEngine, RoomState } from "../game/engine";
import type { Scenario, ScoreResult, RubricItem } from "../types";

const oneLine = (s: string) => s.replace(/\n/g, " ");

/** 1ルームの要件定義書と採用済みカードを文章化する */
function docText(g: GameEngine, room: RoomState): string {
  const out: string[] = [];
  for (const s of room.doc) {
    out.push(`## ${s.title}`);
    out.push(s.content.trim() ? `${s.content}\n` : "(未記入)\n");
  }

  const authorOf = (authorId: string) => {
    const p = g.players[authorId];
    if (!p) return "";
    return g.roleById(p.roleId)?.title ?? p.name;
  };

  out.push("## 合意された要求一覧");
  const adopted = room.proposals.filter((p) => p.status === "adopted");
  if (adopted.length === 0) {
    out.push("(なし)");
  } else {
    for (const p of adopted) {
      out.push(
        `- [${p.category}] ${p.title} — ${oneLine(p.description)} (提案者: ${authorOf(p.authorId)})`,
      );
    }
  }

  out.push("\n## 却下・保留された要求(参考)");
  for (const p of room.proposals) {
    if (p.status === "adopted") continue;
    out.push(`- [${p.category}/${p.status}] ${p.title} — ${oneLine(p.description)}`);
  }
  return out.join("\n");
}

function scenarioText(sc: Scenario): string {
  const lines = [
    `シナリオ: ${sc.title}`,
    `クライアント: ${sc.clientName}(${sc.industry})`,
    "",
    "背景:",
    sc.background,
    "",
    "プロジェクトの公式ゴール:",
    sc.publicGoal,
    "",
    "制約条件:",
    ...sc.constraints.map((c) => `- ${c}`),
  ];
  return lines.join("\n") + "\n";
}

function resolveRoom(g: GameEngine, roomId: string): RoomState {
  if (!roomId) {
    if (g.rooms.length === 1) return g.rooms[0];
    throw new Error("ルームを指定してください");
  }
  const room = g.roomById(roomId);
  if (!room) throw new Error(`ルームが見つかりません: ${roomId}`);
  return room;
}

const DEFAULT_RUBRIC: RubricItem[] = [
  { name: "明確性", max: 25, description: "要件が具体的で曖昧さがないか。数値目標・判断基準が示されているか" },
  { name: "網羅性", max: 25, description: "機能要件・非機能要件・スコープ外・体制/予算/移行が漏れなく検討されているか" },
  { name: "実現可能性", max: 25, description: "制約条件(予算・納期・体制)の中で現実的か。優先順位付けがあるか" },
  { name: "整合性", max: 25, description: "要件同士の矛盾がないか。背景・目的と要件が一貫しているか" },
];

/** 1ルームの成果物を採点させるプロンプト */
export function buildScorePrompt(g: GameEngine, roomId: string): string {
  const sc = g.scenario();
  if (!sc) throw new Error("ゲームが開始されていません");
  const room = resolveRoom(g, roomId);
  const hearing = sc.type === "hearing";
  const b: string[] = [];

  if (hearing) {
    b.push(`あなたは要件定義ゲームの審判です。プレイヤーは開発チームとしてクライアントにヒアリングを行い、仕様(要件定義書)を作成しました。
あなたにはシナリオの完全情報(隠れた業務要件を含む)を与えます。プレイヤーの仕様を厳しくも建設的に評価してください。
単なる採点ではなく、プレイヤーが「そこまで考えてなかった!」と思える指摘を優先してください。

# シナリオ`);
  } else {
    b.push(`あなたはITコンサルティングファームの熟練PMO兼審査員です。
社内研修用「要件定義ゲーム」の成果物を採点してください。プレイヤーはクライアント企業のステークホルダーを演じ、協力して要件定義書を作成しました。各プレイヤーには秘密の勝利条件があります。

# シナリオ`);
  }
  b.push(scenarioText(sc));

  if (sc.npcs?.length) {
    b.push("\n# 世界の完全情報(NPCが持つ事情 — プレイヤーは質問で発見する必要があった)");
    for (const n of sc.npcs) {
      b.push(`## ${n.name}(${n.title})`);
      for (const k of n.knowledge) b.push(`- ${k.topic}: ${oneLine(k.info)}`);
    }
  }

  b.push(`\n# 最終成果物(${room.name}の要件定義書)`);
  b.push(docText(g, room));

  if (room.questions.length > 0) {
    b.push("\n# ヒアリング記録(このチームが実際に行った質問)");
    b.push("誰がどれだけ本質的な質問をしたかは、称号や個人目標の判定材料にしてください。");
    const counts: Record<string, number> = {};
    for (const q of room.questions) {
      const p = g.players[q.askerId];
      const asker = p ? `${p.name}(playerId: ${p.id})` : "不明";
      if (p) counts[p.id] = (counts[p.id] ?? 0) + 1;
      const npcName = g.npcById(q.npcId)?.name ?? q.npcId;
      b.push(`- ${asker} →【${npcName}】${oneLine(q.text)}`);
      if (q.answer) b.push(`  ↳ 回答: ${oneLine(q.answer)}`);
    }
    const tally = room.playerIds
      .map((pid) => g.players[pid])
      .filter(Boolean)
      .map((p) => `${p.name}=${counts[p.id] ?? 0}件`)
      .join(" ");
    b.push(`\n質問数: ${tally}`);
  }

  b.push("\n# プレイヤーと個人目標(秘密)");
  b.push("各条件について、最終成果物から達成/未達成を判定してください。judgeHintは判定基準です。");
  b.push(
    "※このルームに不在のロールの情報は資料としてチームに公開済みであり、採点対象のプレイヤーは以下のみです。\n",
  );
  for (const pid of room.playerIds) {
    const p = g.players[pid];
    if (!p?.roleId) continue;
    const r = g.roleById(p.roleId);
    if (!r) continue;
    b.push(`## playerId: ${p.id} / ${p.name}(役: ${r.name} ${r.title})`);
    for (const c of r.secretConditions) {
      b.push(`- conditionId: ${c.id} / 条件: ${c.text}(${c.points}点)/ 判定基準: ${c.judgeHint}`);
    }
    b.push("");
  }

  if (sc.hiddenRequirements?.length) {
    b.push("# 隠れ要件(プレイヤーが発見・考慮すべきだったもの)");
    b.push("最終成果物に反映(発見)されているかを判定してください。");
    for (const hr of sc.hiddenRequirements) {
      b.push(`- id: ${hr.id} / ${hr.text} / 判定基準: ${hr.judgeHint}`);
    }
    b.push("");
  }

  if (sc.testCases?.length) {
    b.push("# 実運用テストケース");
    b.push(
      "最終成果物の仕様どおりにシステムと店舗運用が動いたと仮定して、各ケースをシミュレーションし、問題なく処理できるか判定してください(ok=対応済 / partial=一部考慮 / fail=事故になる)。",
    );
    for (const tc of sc.testCases) {
      b.push(`- id: ${tc.id} / ${tc.title}: ${oneLine(tc.situation)} / チェック: ${tc.checkPoint}`);
    }
    b.push("");
  }

  const rubric = sc.rubric?.length ? sc.rubric : DEFAULT_RUBRIC;
  b.push("# 採点基準(チームスコア: 100点満点)");
  for (const ru of rubric) b.push(`- ${ru.name}(${ru.max}点): ${ru.description}`);

  if (sc.titles?.length) {
    b.push("\n# ボーナス称号");
    b.push(
      "採用された要求の提案者や仕様の内容から、最もふさわしいプレイヤーに授与してください(該当者がいない称号は省略可)。",
    );
    for (const t of sc.titles) b.push(`- id: ${t.id} / ${t.name}: ${t.description}`);
  }

  b.push("\n# 出力形式\n以下のJSONのみを出力してください。コードフェンスや説明文は不要です。\n{");
  b.push('  "teamScore": <合計点数(整数)>,\n  "axes": [');
  rubric.forEach((ru, i) => {
    const comma = i === rubric.length - 1 ? "" : ",";
    b.push(
      `    {"name": "${ru.name}", "score": <整数>, "max": ${ru.max}, "comment": "<日本語で1〜2文>"}${comma}`,
    );
  });
  b.push(`  ],
  "players": [
    {"playerId": "<上記のplayerId>", "conditions": [
      {"id": "<conditionId>", "achieved": true/false, "reason": "<判定理由を日本語で1文>"}
    ]}
  ],`);
  if (sc.hiddenRequirements?.length) {
    b.push(`  "hiddenReqs": [
    {"id": "<隠れ要件のid>", "discovered": true/false, "comment": "<判定理由を日本語で1文>"}
  ],`);
  }
  if (sc.testCases?.length) {
    b.push(`  "testCases": [
    {"id": "<テストケースのid>", "result": "ok" | "partial" | "fail", "comment": "<何が起きるかを具体的に。日本語で1〜2文>"}
  ],`);
  }
  if (sc.titles?.length) {
    b.push(`  "titles": [
    {"id": "<称号のid>", "playerId": "<授与するプレイヤーのplayerId>", "reason": "<授与理由を日本語で1文>"}
  ],`);
  }
  if (hearing) {
    b.push(
      `  "futureProblems": ["<このシステムを実際に3か月運用した場合に発生しそうな問題を3つ。プレイヤーが考えていなかったものを優先>", "...", "..."],`,
    );
  }
  b.push(`  "overallComment": "<全体講評。良かった点を中心に日本語で3〜5文>",
  "improvement": "<実務に活かせる改善アドバイスを日本語で3〜5文>"
}`);
  return b.join("\n");
}

/** NPCになりきって、聞かれたことだけ答えさせるプロンプト */
export function buildNPCPrompt(g: GameEngine, npcId: string, question: string): string {
  const sc = g.scenario();
  if (!sc) throw new Error("ゲームが開始されていません");
  const npc = g.npcById(npcId);
  if (!npc) throw new Error(`NPCが見つかりません: ${npcId}`);
  if (!question.trim()) throw new Error("プレイヤーからの質問を入力してください");

  const b: string[] = [];
  b.push(
    `あなたは要件定義ゲームのNPC「${npc.name}(${npc.title})」です。開発チーム(プレイヤー)からのヒアリングに、この人物になりきって答えてください。\n\n# 世界設定`,
  );
  b.push(scenarioText(sc));
  b.push(`\n# あなた(${npc.name})の人物像・冒頭の発言\n${npc.opening}\n\n# あなたが知っている情報と開示条件`);
  for (const k of npc.knowledge) {
    b.push(`- ${k.topic}: ${oneLine(k.info)}(開示条件: ${k.revealWhen})`);
  }
  b.push(`
# ルール
- 聞かれたことにだけ答える。開示条件を満たさない情報は自分からは言わない
- 「そこをもっと聞いたほうがいい」等のヒントは出さない
- 知らないことは「分かりません」「それは〇〇さんに聞いてください」と自然に返す
- 業務の当事者らしい自然な口調で、3文以内で答える
- 曖昧な質問には曖昧に答えてよい(プレイヤーが具体的に聞き直すのもゲームのうち)

# プレイヤーからの質問
${question}

回答(セリフのみを出力):`);
  return b.join("\n");
}

/** 議論に揺さぶりをかけるイベントを作らせるプロンプト */
export function buildEventPrompt(g: GameEngine, direction: string): string {
  const sc = g.scenario();
  if (!sc) throw new Error("ゲームが開始されていません");
  const b: string[] = [];
  b.push(
    "あなたは研修用「要件定義ゲーム」のゲームマスター補佐です。議論に揺さぶりをかける「クライアントからの追加情報イベント」を1つ作ってください。イベントは全ルーム(全チーム)に一斉配信されます。\n\n# シナリオ",
  );
  b.push(scenarioText(sc));
  b.push("\n# 現在までに提案されている要求");
  for (const room of g.rooms) {
    for (const p of room.proposals) {
      b.push(`- [${room.name}][${p.category}] ${p.title}: ${p.description}`);
    }
  }
  if (sc.eventIdeas?.length) {
    b.push("\n# イベントの方向性の例");
    for (const e of sc.eventIdeas) {
      if (typeof e === "string") b.push(`- ${e}`);
      else b.push(`- ${e.title} / 発生条件: ${e.trigger} / 狙い: ${e.intent} / 難易度: ${e.difficulty}`);
    }
  }
  if (direction.trim()) b.push(`\n# ホストからの指示\n${direction}`);
  b.push(`
# 出力形式
以下のJSONのみを出力してください。
{"title": "<イベント名(例: 社長からの緊急連絡)>", "body": "<プレイヤー全員に公開するイベント本文。150字程度。議論の前提を変えるが、ゲームを壊さない内容>"}`);
  return b.join("\n");
}

/** ホスト向けのファシリテーション助言プロンプト */
export function buildAdvicePrompt(g: GameEngine, roomId: string, question: string): string {
  const sc = g.scenario();
  if (!sc) throw new Error("ゲームが開始されていません");
  const b: string[] = [];
  b.push(
    "あなたは研修用「要件定義ゲーム」のファシリテーション補佐です。ホスト(ファシリテーター)へのアドバイスを日本語で簡潔に出してください。\n\n# シナリオ",
  );
  b.push(scenarioText(sc));
  b.push(`\n# 現在のフェーズ: ${g.phase}`);
  const rooms = roomId ? [g.roomById(roomId)].filter(Boolean) : g.rooms;
  for (const room of rooms as RoomState[]) {
    b.push(`\n# 現在の成果物(${room.name})`);
    b.push(docText(g, room));
  }
  if (question.trim()) {
    b.push(`\n# ホストからの質問\n${question}`);
  } else {
    b.push(
      "\n# 依頼\n議論が深まっていない観点、ファシリテーターが投げかけるとよい質問を3つ挙げてください。",
    );
  }
  return b.join("\n");
}

// ---- 応答の解釈 ----

/**
 * LLMの返答から最初のトップレベルJSONオブジェクトを取り出す。
 * コードフェンスや前後の説明文が付いていても拾えるようにしている。
 */
export function extractJSON(s: string): string {
  s = s.trim();
  const start = s.indexOf("{");
  if (start < 0) throw new Error("JSONが見つかりません");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("JSONが閉じていません");
}

export function parseScoreResult(raw: string): ScoreResult {
  try {
    return JSON.parse(extractJSON(raw)) as ScoreResult;
  } catch (e) {
    throw new Error(`採点JSONの解析に失敗: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function parseEvent(raw: string): { title: string; body: string } {
  try {
    const ev = JSON.parse(extractJSON(raw)) as { title?: string; body?: string };
    return { title: ev.title ?? "", body: ev.body ?? "" };
  } catch (e) {
    throw new Error(`イベントJSONの解析に失敗: ${e instanceof Error ? e.message : String(e)}`);
  }
}
