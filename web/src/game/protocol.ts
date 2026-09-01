// プレイヤー → ホスト のメッセージと、その適用ロジック。
// もともと internal/game/handlers.go にあったディスパッチの移植で、
// 副作用(AI呼び出し)は呼び出し側に返して、ここは純粋なまま保つ。

import { GameEngine, GameError } from "./engine";
import type { Snapshot } from "../types";

/** Goの inMsg と同じく、全メッセージ種別を横断したフラットな封筒 */
export interface ClientMessage {
  type: string;

  // join
  name?: string;
  token?: string;

  // 開始 / フェーズ
  scenarioId?: string;
  phase?: string;

  // 要求カード
  id?: string;
  category?: string;
  title?: string;
  description?: string;
  proposalId?: string;
  value?: string;
  status?: string;

  // 仕様書
  sectionId?: string;
  content?: string;
  roomId?: string;

  // タイマー
  action?: string;
  seconds?: number;

  // お知らせ
  body?: string;

  // 退出
  playerId?: string;

  // 準備OK / リアクション / ヒアリング
  ready?: boolean;
  emoji?: string;
  npcId?: string;
  text?: string;
  questionId?: string;
  answer?: string;
  enabled?: boolean;
}

export type ServerMessage =
  | { type: "state"; state: Snapshot }
  | { type: "joined"; playerId?: string; token?: string; isHost?: boolean }
  | { type: "error"; message: string };

export interface Actor {
  playerId: string;
  isHost: boolean;
}

export interface ApplyResult {
  /** 状態が変わったので全員に配り直す必要がある */
  changed: boolean;
  /** AIにNPCとして答えさせる必要がある質問(ロック外で実行するため値で返す) */
  askAI?: { id: string; npcId: string; text: string };
}

const notHost = () => {
  throw new GameError("ホストのみ実行できる操作です");
};

/**
 * 1件のメッセージをエンジンに適用する。
 * 失敗時は GameError を投げるので、呼び出し側が送信元にだけ返すこと。
 */
export function applyMessage(
  g: GameEngine,
  m: ClientMessage,
  actor: Actor,
): ApplyResult {
  const host = actor.isHost;
  const me = actor.playerId;
  let askAI: ApplyResult["askAI"];

  switch (m.type) {
    case "start_game":
      if (!host) notHost();
      g.start(m.scenarioId ?? "");
      break;

    case "set_phase":
      if (!host) notHost();
      g.setPhase((m.phase ?? "") as never);
      break;

    case "next_phase":
      if (!host) notHost();
      g.nextPhase();
      break;

    case "reset_game":
      if (!host) notHost();
      g.reset();
      break;

    case "propose":
      g.propose(me, m.category ?? "", (m.title ?? "").trim(), (m.description ?? "").trim());
      break;

    case "update_proposal":
      g.updateProposal(me, m.id ?? "", m.category ?? "", m.title ?? "", m.description ?? "", host);
      break;

    case "delete_proposal":
      g.deleteProposal(me, m.id ?? "", host);
      break;

    case "vote":
      g.vote(me, m.proposalId ?? "", m.value ?? "");
      break;

    case "set_proposal_status":
      if (!host) notHost();
      g.setProposalStatus(m.id ?? "", m.status ?? "");
      break;

    case "react":
      g.react(me, m.proposalId ?? "", m.emoji ?? "");
      break;

    case "set_ready":
      g.setReady(me, !!m.ready);
      break;

    case "ask": {
      const q = g.ask(me, m.npcId ?? "", m.text ?? "");
      // 値でコピーしてから返す(この先は非同期で走るため)
      if (q.pending) askAI = { id: q.id, npcId: q.npcId, text: q.text };
      break;
    }

    case "answer_question":
      if (!host) notHost();
      g.answerQuestion(m.questionId ?? "", m.answer ?? "", "host");
      break;

    case "retry_question": {
      if (!host) notHost();
      const q = g.findQuestion(m.questionId ?? "");
      if (!q) throw new GameError("質問が見つかりません");
      if (!g.aiEnabled) {
        throw new GameError("AIが設定されていません(ホスト画面でAPIキーを設定してください)");
      }
      q.pending = true;
      askAI = { id: q.id, npcId: q.npcId, text: q.text };
      break;
    }

    case "set_auto_answer":
      if (!host) notHost();
      g.autoAnswer = !!m.enabled && g.aiEnabled;
      break;

    case "edit_doc": {
      let roomId = m.roomId ?? "";
      let editor = "ホスト";
      if (!host) {
        roomId = g.roomOf(me)?.id ?? roomId;
        editor = g.players[me]?.name ?? editor;
      } else if (!roomId && g.rooms.length === 1) {
        roomId = g.rooms[0].id;
      }
      g.editDoc(roomId, m.sectionId ?? "", m.content ?? "", editor, host);
      break;
    }

    case "timer":
      if (!host) notHost();
      g.timerAction(m.action ?? "", m.seconds ?? 0);
      break;

    case "announce":
      if (!host) notHost();
      g.announce(m.title ?? "", m.body ?? "");
      break;

    case "remove_player":
      if (!host) notHost();
      g.removePlayer(m.playerId ?? "");
      break;

    default:
      return { changed: false };
  }

  return { changed: true, askAI };
}
