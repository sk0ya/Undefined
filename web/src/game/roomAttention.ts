import type { Phase, RoomView } from "../types";

export type RoomAttentionLevel = "blocking" | "ready" | "stalled" | "normal";

export interface RoomAttention {
  level: RoomAttentionLevel;
  rank: number;
  label: string;
  reason: string;
}

const RANK: Record<RoomAttentionLevel, number> = {
  blocking: 0,
  ready: 1,
  stalled: 2,
  normal: 3,
};

/** hostがルーム巡回する順番を決める。状態だけを受け取る純粋関数。 */
export function roomAttention(room: RoomView, phase: Phase): RoomAttention {
  const offline = room.players.filter((p) => !p.connected).length;
  const pendingQuestions = room.questions.filter((q) => q.pending || !q.answer).length;
  const unvotedCards = room.proposals.filter((p) => (p.notVoted?.length ?? 0) > 0).length;

  if (offline > 0) {
    return attention("blocking", `接続切れ ${offline}人`, "再接続を確認してください");
  }
  if (pendingQuestions > 0) {
    return attention("blocking", `未回答質問 ${pendingQuestions}件`, "回答またはAI再試行が必要です");
  }
  if (phase === "voting" && unvotedCards > 0) {
    return attention("blocking", `未投票カード ${unvotedCards}件`, "投票の完了を確認してください");
  }
  if ((phase === "finalize" || phase === "results") && !room.score) {
    return attention("blocking", "未採点", "採点結果を適用してください");
  }

  const allReady = room.players.length > 0 && room.players.every((p) => p.ready);
  if (["briefing", "discussion", "finalize"].includes(phase) && allReady) {
    return attention("ready", "全員準備OK", "次のフェーズへ進められます");
  }

  const noActivity = room.questions.length === 0 && room.proposals.length === 0;
  if (phase === "discussion" && noActivity) {
    return attention("stalled", "反応がありません", "質問または要求カードを促してください");
  }
  if (phase === "voting" && room.proposals.length === 0) {
    return attention("stalled", "投票対象なし", "要求カードがあるか確認してください");
  }

  return attention("normal", "通常", "対応は不要です");
}

export function sortRoomsByAttention(rooms: RoomView[], phase: Phase): RoomView[] {
  return rooms
    .map((room, index) => ({ room, index, attention: roomAttention(room, phase) }))
    .sort((a, b) => a.attention.rank - b.attention.rank || a.index - b.index)
    .map(({ room }) => room);
}

function attention(level: RoomAttentionLevel, label: string, reason: string): RoomAttention {
  return { level, rank: RANK[level], label, reason };
}
