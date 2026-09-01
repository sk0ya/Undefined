// OpenAI互換APIをホストのブラウザから直接呼ぶ。
//
// サーバーが無くなったため、APIキーはホスト本人のブラウザに保存し、そこから
// 直接APIへ送る。キーはゲーム状態にもスナップショットにも一切入らないので、
// プレイヤーへ渡ることはない。共用PCで使う場合はキーを保存しない設定を選べる。

const KEY_STORAGE = "reqgame_ai";

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** falseならlocalStorageに残さず、このタブを閉じたら消える */
  remember: boolean;
}

export const DEFAULT_AI: AIConfig = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  remember: true,
};

/** このタブ限りのキー(remember=false のとき使う) */
let sessionKey = "";

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return { ...DEFAULT_AI, apiKey: sessionKey };
    const saved = JSON.parse(raw) as Partial<AIConfig>;
    return {
      ...DEFAULT_AI,
      ...saved,
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

export const aiEnabled = (cfg: AIConfig) => cfg.apiKey.trim().length > 0;

/** チャット補完を1回投げて、本文だけ返す */
export async function chat(cfg: AIConfig, prompt: string, signal?: AbortSignal): Promise<string> {
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
