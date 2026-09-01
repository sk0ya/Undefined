import type { Phase, Snapshot } from "../types";
import { PHASES, phaseIndex, phaseLabel } from "../types";

export interface PhaseTransitionInfo {
  targetLabel: string;
  impacts: string[];
  warnings: string[];
}

/**
 * hostのフェーズ操作前に、状態がどう変わるかを人間向けにまとめる。
 * 実際の遷移はGameEngineが行い、この関数は表示と確認だけを担当する。
 */
export function phaseTransitionInfo(state: Snapshot, target: Phase): PhaseTransitionInfo {
  const from = state.phase;
  const fromIndex = phaseIndex(from);
  const targetIndex = phaseIndex(target);
  const impacts: string[] = [];
  const warnings: string[] = [];

  if (from === target) return { targetLabel: phaseLabel(target), impacts, warnings };

  if (from !== "lobby" || target !== "lobby") {
    impacts.push("タイマーをクリアします");
    impacts.push("全員の準備OKをリセットします");
  }
  if (from === "voting") {
    impacts.push("投票結果を多数決で確定します(同数は保留)");
  }
  if (targetIndex > fromIndex + 1) {
    warnings.push(`${PHASES.slice(fromIndex + 1, targetIndex).map((p) => p.label).join("・")}をスキップします`);
  } else if (targetIndex < fromIndex) {
    warnings.push("現在のフェーズを戻します。保存済みの内容は消えませんが、タイマーと準備OKはリセットされます");
  }

  const rooms = state.rooms ?? [];
  if (from === "discussion") {
    const pending = rooms.reduce(
      (count, room) => count + room.questions.filter((q) => q.pending || !q.answer).length,
      0,
    );
    const unready = rooms.filter(
      (room) => room.players.length === 0 || !room.players.every((player) => player.ready),
    ).length;
    if (pending > 0) warnings.push(`未回答質問が${pending}件あります`);
    if (unready > 0) warnings.push(`準備OK未完了のルームが${unready}件あります`);
  }
  if (from === "voting") {
    const unvoted = rooms.reduce(
      (count, room) => count + room.proposals.filter((proposal) => (proposal.notVoted?.length ?? 0) > 0).length,
      0,
    );
    if (unvoted > 0) warnings.push(`未投票カードが${unvoted}件あります`);
  }
  if (from === "finalize" && target === "results") {
    const unscored = rooms.filter((room) => !room.score).length;
    if (unscored > 0) warnings.push(`未採点ルームが${unscored}件あります`);
  }

  return { targetLabel: phaseLabel(target), impacts, warnings };
}

export function phaseTransitionConfirmation(state: Snapshot, target: Phase): string {
  const info = phaseTransitionInfo(state, target);
  const lines = [`「${info.targetLabel}」へ移動します。`];
  if (info.warnings.length > 0) {
    lines.push("", "確認:", ...info.warnings.map((warning) => `・${warning}`));
  }
  if (info.impacts.length > 0) {
    lines.push("", "この操作の影響:", ...info.impacts.map((impact) => `・${impact}`));
  }
  lines.push("", "続行しますか?");
  return lines.join("\n");
}
