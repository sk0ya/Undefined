import type { Snapshot } from "../types";

export interface PlayerRetrospective {
  playerId: string;
  name: string;
  questions: number;
  proposals: number;
  adopted: number;
  secretScore?: number;
  secretMax?: number;
}

export interface DecisionTrailItem {
  kind: "question" | "proposal" | "document";
  label: string;
  detail: string;
}

/** 結果発表で使う、閲覧可能なSnapshotだけから作る活動サマリー。 */
export function buildPlayerRetrospectives(state: Snapshot): PlayerRetrospective[] {
  const players = state.myRoomId
    ? state.players.filter((player) => player.roomId === state.myRoomId)
    : state.players;
  return players.map((player) => {
    const proposals = state.proposals.filter((proposal) => proposal.authorId === player.id);
    const playerScore = state.score?.players.find((score) => score.playerId === player.id);
    return {
      playerId: player.id,
      name: player.name,
      questions: state.questions.filter((question) => question.askerId === player.id).length,
      proposals: proposals.length,
      adopted: proposals.filter((proposal) => proposal.status === "adopted").length,
      ...(playerScore
        ? { secretScore: playerScore.secretScore, secretMax: playerScore.secretMax }
        : {}),
    };
  });
}

/** 質問・採用要求・仕様書に残った、チームの判断材料を要約する。 */
export function buildDecisionTrail(state: Snapshot): DecisionTrailItem[] {
  const trail: DecisionTrailItem[] = [];
  for (const question of state.questions) {
    trail.push({
      kind: "question",
      label: `${question.askerName}の質問「${question.text}」`,
      detail: question.answer ? `回答を記録: ${question.answer}` : "回答は未記録",
    });
  }
  for (const proposal of state.proposals) {
    if (proposal.status !== "adopted") continue;
    trail.push({
      kind: "proposal",
      label: `要求カード「${proposal.title}」を採用`,
      detail: proposal.description || `${proposal.authorName}が提出`,
    });
  }
  for (const section of state.doc) {
    if (!section.content.trim()) continue;
    trail.push({
      kind: "document",
      label: `仕様書「${section.title}」を記入`,
      detail: section.content.trim(),
    });
  }
  return trail;
}
