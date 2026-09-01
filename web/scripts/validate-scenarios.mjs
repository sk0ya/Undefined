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
  uniqueIds(file, scenario.titles, "titles");
  uniqueIds(file, scenario.rubric?.map((item) => ({ id: item?.name })), "rubric");

  if (!Array.isArray(scenario.eventIdeas) || scenario.eventIdeas.length < 3) {
    warn(file, "eventIdeasは3件以上を推奨します");
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
