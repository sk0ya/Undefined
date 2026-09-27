import { useEffect, useRef, useState } from "react";

/** Keep drafts until the authoritative shared list contains the submitted item. */
export function useSubmission<T extends { id: string }>(items: T[]) {
  const pending = useRef<{ matches: (item: T) => boolean; done: () => void } | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "uncertain">("idle");
  useEffect(() => {
    if (pending.current && items.some(pending.current.matches)) {
      const done = pending.current.done;
      pending.current = null;
      setStatus("idle");
      done();
    }
  }, [items]);
  useEffect(() => {
    if (status !== "waiting") return;
    const timer = window.setTimeout(() => setStatus("uncertain"), 12000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const begin = (matches: (item: T) => boolean, done: () => void) => {
    if (status === "waiting" || (pending.current && status !== "uncertain")) return false;
    const previous = new Set(items.map((item) => item.id));
    pending.current = { matches: (item) => !previous.has(item.id) && matches(item), done };
    setStatus("waiting");
    return true;
  };
  return { begin, waiting: status === "waiting", message: status === "waiting"
    ? "送信を確認しています。入力内容は確認が終わるまで保持します。"
    : status === "uncertain" ? "送信を確認できませんでした。入力内容は残っています。一覧に届いていないことを確認してから再送してください。" : "" };
}
