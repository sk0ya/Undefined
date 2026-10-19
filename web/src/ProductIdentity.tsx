import type { Snapshot } from "./types";

export function ProductIdentity({ host = false }: { host?: boolean }) {
  return <div className="product-identity"><strong>要件定義ゲーム</strong>{host && <small>ホスト</small>}</div>;
}

export function SessionHeading({ state }: { state: Snapshot; host?: boolean }) {
  return <div className="session-heading"><h1>{state.phase === "lobby" ? "ロビー" : state.scenario?.title ?? "ワークスペース"}</h1></div>;
}
