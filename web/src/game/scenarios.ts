// シナリオ定義の読み込み。
//
// 以前はGoバイナリに埋め込んでいたが、静的ホスティングになったので
// リポジトリ直下の scenarios/*.json をビルド時にバンドルする。
// JSONを1つ追加してpushすれば、GitHub Actionsが再ビルドして公開される。

import type { Scenario } from "../types";

const modules = import.meta.glob<{ default: Scenario }>("../../../scenarios/*.json", {
  eager: true,
});

function collect(): Record<string, Scenario> {
  const out: Record<string, Scenario> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const sc = mod.default;
    if (!sc?.id) {
      console.warn(`シナリオにidがないため読み込みませんでした: ${path}`);
      continue;
    }
    out[sc.id] = sc;
  }
  return out;
}

export const BUILT_IN_SCENARIOS = collect();

/** シナリオJSONとして妥当かをざっと確認する(自作シナリオの取り込み用) */
export function validateScenario(data: unknown): Scenario {
  const sc = data as Partial<Scenario>;
  const missing = (["id", "title", "roles", "docTemplate"] as const).filter((k) => !sc?.[k]);
  if (missing.length) {
    throw new Error(`シナリオの必須項目が足りません: ${missing.join(", ")}`);
  }
  if (!Array.isArray(sc.roles) || sc.roles.length < 4) {
    throw new Error("rolesは4つ以上必要です");
  }
  if (!Array.isArray(sc.docTemplate) || sc.docTemplate.length === 0) {
    throw new Error("docTemplateが空です");
  }
  // 任意項目が欠けていてもUIが落ちないよう、未定義のものだけ埋める
  const full = { ...(sc as Scenario) };
  full.constraints ??= [];
  full.categories ??= [];
  full.background ??= "";
  full.publicGoal ??= "";
  full.tagline ??= "";
  full.clientName ??= "";
  full.industry ??= "";
  return full;
}
