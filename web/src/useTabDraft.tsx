import { useCallback, useState } from "react";
import type { DocSection } from "./types";

const PREFIX = "reqgame_draft_v1:";

/** Only this tab owns these drafts; room/player/question IDs isolate each game. */
export function useTabDraft(key: string, initial = "") {
  const read = () => {
    try {
      const value = sessionStorage.getItem(PREFIX + key);
      return { key, value: value ?? initial, restored: !!value, error: false };
    } catch {
      return { key, value: initial, restored: false, error: true };
    }
  };
  const [saved, setSaved] = useState(read);
  const current = saved.key === key ? saved : read();
  if (saved.key !== key) setSaved(current);
  const setValue = useCallback((value: string) => {
    let error = false;
    try {
      if (value) sessionStorage.setItem(PREFIX + key, value);
      else sessionStorage.removeItem(PREFIX + key);
    } catch { error = true; }
    // Write synchronously so an immediate reload does not race an effect/debounce.
    setSaved({ key, value, restored: false, error });
  }, [key]);
  return { ...current, setValue };
}

export function restoreDocumentDraft(raw: string, sections: DocSection[]) {
  const drafts: Record<string, string> = {};
  const baselines: Record<string, string> = {};
  try {
    const saved = JSON.parse(raw);
    for (const section of sections) {
      const entry = saved?.[section.id];
      if (typeof entry?.content === "string" && typeof entry?.base === "string" && entry.content !== section.content) {
        drafts[section.id] = entry.content;
        baselines[section.id] = entry.base;
      }
    }
  } catch { /* Missing or corrupt local data never prevents opening the editor. */ }
  return { drafts, baselines };
}

export function serializeDocumentDraft(drafts: Record<string, string>, baselines: Record<string, string>) {
  const entries = Object.entries(drafts).map(([id, content]) => [id, { content, base: baselines[id] ?? "" }]);
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : "";
}

export function DraftNotice({ restored, error }: { restored: boolean; error: boolean }) {
  return <p className={error ? "small error-text" : "small muted"} role="status">
    {error ? "下書きをブラウザに保存できません。この画面を閉じる前に入力内容を控えてください。"
      : restored ? "未送信の下書きを復元しました。内容を確認して送信してください。"
        : "下書きはこのタブ内に保存され、再読み込みしても復元できます。"}
  </p>;
}
