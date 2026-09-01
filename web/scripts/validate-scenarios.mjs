import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scenarioDir = fileURLToPath(new URL("../../scenarios/", import.meta.url));
const strict = process.argv.includes("--strict");
const files = fs.readdirSync(scenarioDir).filter((name) => name.endsWith(".json")).sort();
const errors = [];
const warnings = [];
const scenarioIds = new Map();

function error(file, message) {
  errors.push(`${file}: ${message}`);
}

function warn(file, message) {
  (strict ? errors : warnings).push(`${file}: ${message}`);
}

function requiredString(file, value, label) {
  if (typeof value !== "string" || !value.trim()) error(file, `${label}は空でない文字列が必要です`);
}

function requiredArray(file, value, label) {
  if (!Array.isArray(value) || value.length === 0) error(file, `${label}は1件以上必要です`);
}

function uniqueIds(file, values, label) {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    error(file, `${label}は配列が必要です`);
    return;
  }
  const ids = values.map((value) => value?.id).filter((id) => typeof id === "string" && id);
  if (ids.length !== values.length) error(file, `${label}の各要素にidが必要です`);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) error(file, `${label}でidが重複しています: ${duplicates.join(", ")}`);
}

function validateScenario(file, scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    error(file, "JSONのルートはオブジェクトである必要があります");
    return;
  }
  for (const key of ["id", "title", "tagline", "clientName", "industry", "background", "publicGoal"]) {
    requiredString(file, scenario[key], key);
  }
  if (scenario.type !== undefined && scenario.type !== "hearing" && scenario.type !== "stakeholder") {
    error(file, `typeが不正です: ${scenario.type}`);
  }
  if (!["初級", "標準", "上級"].includes(scenario.difficulty)) {
    error(file, "difficultyは初級・標準・上級のいずれかが必要です");
  }
  requiredString(file, scenario.recommendedPlayers, "recommendedPlayers");
  if (typeof scenario.recommendedMinutes !== "number" || scenario.recommendedMinutes <= 0) {
    error(file, "recommendedMinutesは正の数が必要です");
  }
  if (typeof scenario.id === "string") {
    if (scenarioIds.has(scenario.id)) error(file, `idが${scenarioIds.get(scenario.id)}と重複しています`);
    scenarioIds.set(scenario.id, file);
  }

  requiredArray(file, scenario.constraints, "constraints");
  requiredArray(file, scenario.categories, "categories");
  requiredArray(file, scenario.docTemplate, "docTemplate");
  uniqueIds(file, scenario.docTemplate, "docTemplate");
  if (Array.isArray(scenario.docTemplate)) {
    for (const section of scenario.docTemplate) {
      for (const key of ["id", "title", "placeholder"]) requiredString(file, section?.[key], `docTemplate.${key}`);
    }
  }

  requiredArray(file, scenario.roles, "roles");
  if (Array.isArray(scenario.roles)) {
    if (scenario.roles.length < 4) error(file, "rolesは4つ以上必要です");
    uniqueIds(file, scenario.roles, "roles");
    for (const role of scenario.roles) {
      for (const key of ["id", "name", "title", "publicProfile", "privateBrief"]) {
        requiredString(file, role?.[key], `roles.${key}`);
      }
      requiredArray(file, role?.secretConditions, `roles(${role?.id ?? "?"}).secretConditions`);
      uniqueIds(file, role?.secretConditions, `roles(${role?.id ?? "?"}).secretConditions`);
      for (const condition of role?.secretConditions ?? []) {
        for (const key of ["id", "text", "judgeHint"]) requiredString(file, condition?.[key], `secretConditions.${key}`);
        if (typeof condition?.points !== "number" || condition.points <= 0) error(file, "secretConditions.pointsは正の数が必要です");
      }
    }
  }

  for (const [key, label, requiredKeys] of [
    ["hiddenRequirements", "hiddenRequirements", ["id", "text", "judgeHint"]],
    ["scriptedEvents", "scriptedEvents", ["id", "timing", "title", "body"]],
    ["testCases", "testCases", ["id", "title", "situation", "checkPoint"]],
  ]) {
    uniqueIds(file, scenario[key], label);
    for (const item of scenario[key] ?? []) {
      for (const requiredKey of requiredKeys) requiredString(file, item?.[requiredKey], `${label}.${requiredKey}`);
    }
  }
  if (scenario.beats !== undefined) {
    if (!Array.isArray(scenario.beats) || scenario.beats.length === 0) {
      error(file, "beatsを指定する場合は1件以上必要です");
    } else {
      uniqueIds(file, scenario.beats, "beats");
      for (const beat of scenario.beats) {
        for (const key of ["id", "phase", "title", "trigger", "impact", "facilitatorCue", "counterfactual"]) {
          requiredString(file, beat?.[key], `beats.${key}`);
        }
        if (!["導入", "探索", "圧力", "決断", "結果"].includes(beat?.phase)) {
          error(file, "beats.phaseは導入・探索・圧力・決断・結果のいずれかが必要です");
        }
      }
    }
  }
  if (scenario.facilitation !== undefined) {
    const support = scenario.facilitation;
    for (const key of ["opening30", "opening120"]) requiredString(file, support?.[key], `facilitation.${key}`);
    if (!Array.isArray(support?.hints) || support.hints.length !== 3) {
      error(file, "facilitation.hintsは3段階の配列が必要です");
    } else {
      support.hints.forEach((hint, index) => requiredString(file, hint, `facilitation.hints[${index}]`));
    }
    if (!Array.isArray(support?.shortRoute) || support.shortRoute.length === 0) {
      error(file, "facilitation.shortRouteは1件以上必要です");
    } else {
      support.shortRoute.forEach((step, index) => requiredString(file, step, `facilitation.shortRoute[${index}]`));
    }
  }
  uniqueIds(file, scenario.titles, "titles");
  uniqueIds(file, scenario.rubric?.map((item) => ({ id: item?.name })), "rubric");

  if (!Array.isArray(scenario.eventIdeas) || scenario.eventIdeas.length < 3) {
    warn(file, "eventIdeasは3件以上を推奨します");
  } else {
    const legacyIdeas = scenario.eventIdeas.filter((idea) => typeof idea === "string");
    if (legacyIdeas.length > 0) {
      warn(file, "eventIdeasは発生条件・狙い・難易度を持つオブジェクト形式が必要です");
    }
    const structuredIdeas = scenario.eventIdeas.filter((idea) => idea && typeof idea === "object");
    uniqueIds(file, structuredIdeas, "eventIdeas");
    for (const idea of structuredIdeas) {
      for (const key of ["id", "title", "trigger", "intent", "difficulty"]) {
        requiredString(file, idea?.[key], `eventIdeas.${key}`);
      }
      if (!["初級", "標準", "上級"].includes(idea?.difficulty)) {
        error(file, "eventIdeas.difficultyは初級・標準・上級のいずれかが必要です");
      }
    }
  }
  if (scenario.rubric !== undefined && (!Array.isArray(scenario.rubric) || scenario.rubric.length === 0)) {
    error(file, "rubricを指定する場合は1件以上必要です");
  }

  if (scenario.type !== "hearing") {
    const secretCount = (scenario.roles ?? []).reduce(
      (total, role) => total + (Array.isArray(role?.secretConditions) ? role.secretConditions.length : 0),
      0,
    );
    for (const [key, minimum] of [["scriptedEvents", 3], ["hiddenRequirements", 5], ["testCases", 5]]) {
      if (!Array.isArray(scenario[key]) || scenario[key].length < minimum) {
        warn(file, `ステークホルダー型の${key}は${minimum}件以上を推奨します`);
      }
    }
    if (secretCount < 5) warn(file, "ステークホルダー型の秘密条件は合計5件以上を推奨します");
  }
}

for (const file of files) {
  const fullPath = path.join(scenarioDir, file);
  try {
    validateScenario(file, JSON.parse(fs.readFileSync(fullPath, "utf8")));
  } catch (e) {
    error(file, `JSONを読み込めません: ${e instanceof Error ? e.message : String(e)}`);
  }
}

for (const message of warnings) console.warn(`⚠ ${message}`);
for (const message of errors) console.error(`✖ ${message}`);
if (errors.length > 0) {
  console.error(`${errors.length}件のエラーがあります${strict ? " (--strict)" : ""}`);
  process.exitCode = 1;
} else {
  console.log(`${files.length}シナリオを検証しました${warnings.length > 0 ? `（警告${warnings.length}件）` : ""}`);
}
