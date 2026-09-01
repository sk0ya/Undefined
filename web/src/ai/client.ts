// ホストのAI呼び出し口。
//
// 既存のOpenAI互換APIに加え、host PCで起動したCodex CLIブリッジにも対応する。
// APIキーやブリッジURLはゲーム状態・スナップショットには一切入らない。

const KEY_STORAGE = "reqgame_ai";
const CODEX_BRIDGE_CHECK_TIMEOUT_MS = 5_000;

export interface AIConfig {
  provider: "codex" | "api";
  apiKey: string;
  baseUrl: string;
  model: string;
  /** host PC上のCodexブリッジURL */
  codexBridgeUrl: string;
  /** falseならlocalStorageに残さず、このタブを閉じたら消える */
  remember: boolean;
}

export const DEFAULT_AI: AIConfig = {
  provider: "codex",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  codexBridgeUrl: "http://127.0.0.1:8787",
  remember: true,
};

/** このタブ限りのキー(remember=false のとき使う) */
let sessionKey = "";

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return { ...DEFAULT_AI, apiKey: sessionKey };
    const saved = JSON.parse(raw) as Partial<AIConfig>;
    // provider追加前の保存データは、APIキーがあれば従来のAPIモードを維持する。
    const provider = saved.provider ?? ((saved.apiKey ?? sessionKey).trim() ? "api" : DEFAULT_AI.provider);
    return {
      ...DEFAULT_AI,
      ...saved,
      provider,
      apiKey: saved.remember === false ? sessionKey : (saved.apiKey ?? ""),
    };
  } catch {
    return { ...DEFAULT_AI };
  }
}

export function saveAIConfig(cfg: AIConfig) {
  sessionKey = cfg.apiKey;
  const toStore: Partial<AIConfig> = { ...cfg };
  if (!cfg.remember) delete toStore.apiKey;
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(toStore));
  } catch {
    /* プライベートモード等で保存できなくても動作は続ける */
  }
}

export function clearAIConfig() {
  sessionKey = "";
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* 消せなくても問題ない */
  }
}

export const aiEnabled = (cfg: AIConfig) =>
  cfg.provider === "codex" ? cfg.codexBridgeUrl.trim().length > 0 : cfg.apiKey.trim().length > 0;

/** Codex CLIブリッジが起動しているかを確認する */
export async function checkCodexBridge(baseUrl: string, signal?: AbortSignal): Promise<void> {
  const url = baseUrl.replace(/\/+$/, "") + "/healthz";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CODEX_BRIDGE_CHECK_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        `Codexブリッジの接続確認が${CODEX_BRIDGE_CHECK_TIMEOUT_MS / 1000}秒でタイムアウトしました。` +
          "ブリッジが起動しているか確認してください",
      );
    }
    throw new Error(
      `Codexブリッジに接続できませんでした(${e instanceof Error ? e.message : String(e)})。` +
        "host PCで npm run codex:bridge を起動してください",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!res.ok) throw new Error(`Codexブリッジの応答が異常です(${res.status})`);
  let health: { ok?: unknown; service?: unknown };
  try {
    health = (await res.json()) as { ok?: unknown; service?: unknown };
  } catch {
    throw new Error("Codexブリッジのヘルスチェック応答を解析できません");
  }
  if (health.ok !== true || health.service !== "reqgame-codex-bridge") {
    throw new Error("Codexブリッジではない応答を受け取りました");
  }
}

/** チャット補完を1回投げて、本文だけ返す */
export async function chat(cfg: AIConfig, prompt: string, signal?: AbortSignal): Promise<string> {
  if (cfg.provider === "codex") return codexChat(cfg, prompt, signal);

  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });
  } catch (e) {
    // ブラウザから直接叩くのでCORSやネットワーク遮断がここに出る
    throw new Error(
      `APIに接続できませんでした(${e instanceof Error ? e.message : String(e)})。` +
        "ベースURLと、そのAPIがブラウザからの呼び出し(CORS)を許可しているか確認してください",
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AI APIエラー ${res.status}: ${text.slice(0, 500)}`);
  }
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("AI応答の解析に失敗しました");
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI応答が空です");
  return content;
}

async function codexChat(cfg: AIConfig, prompt: string, signal?: AbortSignal): Promise<string> {
  const url = cfg.codexBridgeUrl.replace(/\/+$/, "") + "/run";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal,
    });
  } catch (e) {
    throw new Error(
      `Codexブリッジに接続できませんでした(${e instanceof Error ? e.message : String(e)})。` +
        "host PCで npm run codex:bridge を起動してください",
    );
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`Codex実行エラー ${res.status}: ${text.slice(0, 500)}`);
  let data: { response?: string };
  try {
    data = JSON.parse(text) as { response?: string };
  } catch {
    throw new Error("Codexブリッジ応答の解析に失敗しました");
  }
  if (!data.response?.trim()) throw new Error("Codexの応答が空です");
  return data.response;
}
