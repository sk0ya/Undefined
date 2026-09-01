import type { Phase, Snapshot } from "../types";

export type GuideTaskStatus = "done" | "todo" | "check";

export interface GuideTask {
  label: string;
  status: GuideTaskStatus;
  count?: string;
  note?: string;
}

export interface PhaseGuide {
  purpose: string;
  must: GuideTask[];
  nice: GuideTask[];
  completion: string;
  next: string;
  readyEffect: string;
}

function task(
  label: string,
  status: GuideTaskStatus,
  count?: string,
  note?: string,
): GuideTask {
  return { label, status, ...(count ? { count } : {}), ...(note ? { note } : {}) };
}

function team(state: Snapshot) {
  const members = state.players.filter((p) => p.roomId && p.roomId === state.myRoomId);
  return {
    members,
    ready: members.filter((p) => p.ready).length,
  };
}

/** プレイヤーが現在のフェーズで迷わないための表示内容を組み立てる。 */
export function buildPhaseGuide(state: Snapshot): PhaseGuide {
  const { members, ready } = team(state);
  const me = state.players.find((p) => p.id === state.myPlayerId);
  const pendingQuestions = state.questions.filter((q) => q.pending || !q.answer).length;
  const blankSections = state.doc.filter((s) => !s.content.trim()).length;
  const unansweredVotes = state.proposals.filter((p) => !p.myVote).length;
  const teamUnvoted = new Set(state.proposals.flatMap((p) => p.notVoted ?? [])).size;
  const hasNpc = (state.scenario?.npcs?.length ?? 0) > 0;

  switch (state.phase) {
    case "lobby":
      return {
        purpose: "参加者がそろい、ホストの開始を待つフェーズです。",
        must: [
          task("自分の名前が参加者一覧に表示されていることを確認", me ? "done" : "todo"),
          task("ホストから開始案内を聞く", "check"),
        ],
        nice: [task("開始後にチームで話せる場所を確認しておく", "check")],
        completion: "ホストがゲームを開始すると、ロールとシナリオが表示されます。",
        next: "ゲーム開始後、まず「あなたのロール」を開きます。",
        readyEffect: "ロビーでは準備OKは不要です。",
      };

    case "briefing":
      return {
        purpose: "自分の立場とシナリオの前提をそろえ、議論に入る準備をするフェーズです。",
        must: [
          task("自分のロール・公開プロフィール・秘密情報を読む", me?.roleId ? "check" : "todo"),
          task("シナリオの目的・制約・チーム構成を確認する", state.scenario ? "check" : "todo"),
          task("読み終わったら準備OKを押す", me?.ready ? "done" : "todo", members.length > 0 ? `${ready}/${members.length}` : undefined),
        ],
        nice: [
          task("不在ロールの引き継ぎ資料があれば、チームで共有する", "check"),
          task("最初に誰へ何を確認するか決める", "check"),
        ],
        completion: "自分の確認が終わったら準備OKを押し、全員がそろうまで待ちます。",
        next: "次は「ヒアリング・議論」です。質問・要求カード・仕様書を順番に進めます。",
        readyEffect: "準備OKはホストに読了を知らせるだけで、フェーズは自動では進みません。取り消しもできます。",
      };

    case "discussion":
      return {
        purpose: "事実と例外を聞き出し、チームの判断を要求カードと仕様書に残すフェーズです。",
        must: [
          ...(hasNpc
            ? [
                task("NPCまたは仲間に質問を3回する（事実を集める）", state.questions.length >= 3 ? "done" : "todo", `${Math.min(state.questions.length, 3)}/3`),
                task("未回答の質問をなくす", pendingQuestions === 0 ? "done" : "todo", `${pendingQuestions}件`),
              ]
            : [task("チーム内の役割ごとの事実と制約を確認する", "check")]),
          task("例外・繁忙期・現在の回避策を1つ深掘りする", "check"),
          task("要求カードを1枚以上出す", state.proposals.length > 0 ? "done" : "todo", `${state.proposals.length}件`),
          task("仕様書の必須欄を埋める", blankSections === 0 ? "done" : "todo", `${state.doc.length - blankSections}/${state.doc.length}`),
        ],
        nice: [
          task("曖昧な表現を数字・期限・対象で具体化する", "check"),
          task("やらないことと運用時の担当を仕様書に書く", "check"),
        ],
        completion: "必須行動を確認し、チーム全員が「議論はここまででOK」を押します。",
        next: "次は「合意形成(投票)」です。要求カードを1枚ずつ読み、採用・反対を決めます。",
        readyEffect: "押すとホストの準備OK人数に反映されます。全員が押しても、ホストが次へ進めるまで議論は続きます。",
      };

    case "voting":
      return {
        purpose: "要求カードを読み、チームとして採用する内容に合意するフェーズです。",
        must: [
          task("要求カードを確認する", state.proposals.length > 0 ? "done" : "todo", `${state.proposals.length}件`),
          task("すべてのカードに採用・反対を投票する", state.proposals.length > 0 && unansweredVotes === 0 ? "done" : "todo", `${unansweredVotes}件未投票`),
          task("反対または迷うカードの理由をチームで確認する", "check"),
        ],
        nice: [task("採用した要求が仕様書のどの欄に入るか確認する", "check")],
        completion: "自分の投票を終え、チーム全員の投票がそろったらホストの確定を待ちます。",
        next: "次は「要件定義書の仕上げ」です。投票結果を反映し、空欄と矛盾を確認します。",
        readyEffect:
          state.proposals.length === 0
            ? "投票対象の要求カードがありません。ホストに確認してください。"
            : teamUnvoted > 0
              ? `チームで未投票の人が${teamUnvoted}人います。`
              : "チーム全員の投票がそろっています。",
      };

    case "finalize":
      return {
        purpose: "投票結果を反映し、実際に使える要件定義書へ仕上げるフェーズです。",
        must: [
          task("仕様書の空欄をなくす", blankSections === 0 ? "done" : "todo", `${blankSections}件未記入`),
          task("採用された要求が仕様書に反映されていることを確認する", "check"),
          task("数値・例外・担当者など、運用時に迷う箇所を確認する", "check"),
        ],
        nice: [task("チーム外の人が読んでも判断できる文章に整える", "check")],
        completion: "チーム全員で最終版を確認し、仕上げ完了をホストへ知らせます。",
        next: "次は「結果発表」です。得点だけでなく、質問・要求・判断の結果を振り返ります。",
        readyEffect: "仕上げ完了を押すとホストが確認できます。文書の編集はホストが結果発表へ進めるまで可能です。",
      };

    case "results":
      return {
        purpose: "得点の理由と見落としを振り返り、実務で次に変える行動を持ち帰るフェーズです。",
        must: [
          task("得点に寄与した質問・要求・判断を確認する", "check"),
          task("見落とした要件と、本来聞けた相手を確認する", "check"),
          task("チームで次回に変える行動を1つ決める", "check"),
        ],
        nice: [task("他のルームと同じ事件への対応の違いを比べる", "check")],
        completion: "チームの学びを1つ言語化できたら、このゲームのゴールです。",
        next: "結果画面の実運用テストと総評を読み、次回の行動をメモします。",
        readyEffect: "結果発表では準備OKは不要です。",
      };
  }
}
