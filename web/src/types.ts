// サーバーの Snapshot(internal/game/game.go)に対応する型定義

export type Phase =
  | "lobby"
  | "briefing"
  | "discussion"
  | "voting"
  | "finalize"
  | "results";

export const PHASES: { id: Phase; label: string; desc: string }[] = [
  { id: "lobby", label: "ロビー", desc: "参加者の集合を待っています" },
  { id: "briefing", label: "ブリーフィング", desc: "ロールとシナリオを確認してください" },
  { id: "discussion", label: "ヒアリング・議論", desc: "議論しながら要求カードを提出してください" },
  { id: "voting", label: "合意形成(投票)", desc: "各要求カードに賛成/反対を投票してください" },
  { id: "finalize", label: "要件定義書の仕上げ", desc: "ファシリテーターが文書を仕上げ、AI採点を行います" },
  { id: "results", label: "結果発表", desc: "秘密の勝利条件が公開されます" },
];

export interface Player {
  id: string;
  name: string;
  roleId?: string;
  roomId?: string;
  connected: boolean;
  ready: boolean;
}

/** 議論中の温度感を示すリアクション(サーバーの ReactionEmojis と同じ順) */
export const REACTIONS: { emoji: string; label: string }[] = [
  { emoji: "👍", label: "賛成" },
  { emoji: "🔥", label: "重要" },
  { emoji: "❓", label: "詳しく" },
  { emoji: "⚠️", label: "懸念" },
];

export interface SecretCondition {
  id: string;
  text: string;
  points: number;
  judgeHint: string;
}

export interface RoleView {
  id: string;
  name: string;
  title: string;
  icon: string;
  publicProfile: string;
  privateBrief?: string;
  secretConditions?: SecretCondition[];
  /** 自分のルームでこのロールが不在(privateBriefは引き継ぎ資料として公開) */
  vacant?: boolean;
}

export interface DocTemplateSection {
  id: string;
  title: string;
  placeholder: string;
}

export interface NPCKnowledge {
  topic: string;
  info: string;
  revealWhen: string;
}

export interface NPCView {
  id: string;
  name: string;
  title: string;
  icon: string;
  opening: string;
  knowledge?: NPCKnowledge[];
}

export interface HiddenRequirement {
  id: string;
  text: string;
  judgeHint: string;
}

export interface ScriptedEvent {
  id: string;
  timing: string;
  title: string;
  body: string;
}

export interface TestCase {
  id: string;
  title: string;
  situation: string;
  checkPoint: string;
}

export interface EventIdea {
  id: string;
  title: string;
  trigger: string;
  intent: string;
  difficulty: "初級" | "標準" | "上級";
}

export interface ScenarioBeat {
  id: string;
  phase: "導入" | "探索" | "圧力" | "決断" | "結果";
  title: string;
  trigger: string;
  impact: string;
  facilitatorCue: string;
  counterfactual: string;
}

export interface RubricItem {
  name: string;
  max: number;
  description: string;
}

export interface TitleAwardDef {
  id: string;
  name: string;
  description: string;
}

// ---- シナリオ定義(秘密を含む完全版。ホストのブラウザのみが保持する) ----

export interface Role {
  id: string;
  name: string;
  title: string;
  icon: string;
  publicProfile: string;
  privateBrief: string;
  secretConditions: SecretCondition[];
}

export interface NPC {
  id: string;
  name: string;
  title: string;
  icon: string;
  opening: string;
  knowledge: NPCKnowledge[];
}

/**
 * scenarios/*.json をそのまま写した型。privateBrief・secretConditions・
 * npcs[].knowledge といったネタバレを含むので、プレイヤーへは必ず
 * buildSnapshot を通してフィルタしたものだけを送ること。
 */
export interface Scenario {
  id: string;
  type?: string;
  title: string;
  tagline: string;
  clientName: string;
  industry: string;
  background: string;
  publicGoal: string;
  constraints: string[];
  categories: string[];
  docTemplate: DocTemplateSection[];
  roles: Role[];
  difficulty?: "初級" | "標準" | "上級";
  recommendedPlayers?: string;
  recommendedMinutes?: number;
  eventIdeas?: (string | EventIdea)[];
  beats?: ScenarioBeat[];
  npcs?: NPC[];
  hiddenRequirements?: HiddenRequirement[];
  scriptedEvents?: ScriptedEvent[];
  testCases?: TestCase[];
  rubric?: RubricItem[];
  titles?: TitleAwardDef[];
}

export interface ScenarioView {
  id: string;
  type?: string; // "" | "stakeholder" | "hearing"
  title: string;
  tagline: string;
  clientName: string;
  industry: string;
  background: string;
  publicGoal: string;
  constraints: string[];
  categories: string[];
  roles: RoleView[];
  difficulty?: "初級" | "標準" | "上級";
  recommendedPlayers?: string;
  recommendedMinutes?: number;
  eventIdeas?: (string | EventIdea)[];
  beats?: ScenarioBeat[];
  docTemplate: DocTemplateSection[];
  npcs?: NPCView[];
  hiddenRequirements?: HiddenRequirement[];
  scriptedEvents?: ScriptedEvent[];
  testCases?: TestCase[];
  rubric?: RubricItem[];
  titles?: TitleAwardDef[];
}

export interface ProposalView {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  category: string;
  title: string;
  description: string;
  status: "pending" | "adopted" | "rejected";
  approveCount: number;
  rejectCount: number;
  votedCount: number;
  myVote?: "approve" | "reject";
  votesVisible: boolean;
  reactions?: Record<string, number>;
  myReaction?: string;
  /** 投票フェーズ中、まだ投票していないルームメンバーの名前 */
  notVoted?: string[];
}

/** ヒアリング型シナリオでの1問1答 */
export interface QuestionView {
  id: string;
  npcId: string;
  npcName: string;
  npcIcon: string;
  askerId: string;
  askerName: string;
  askerRole: string;
  text: string;
  answer?: string;
  source?: "host" | "ai";
  pending: boolean;
  askedAtMs: number;
  roomId?: string;
  roomName?: string;
  isMine?: boolean;
  answeredMs?: number;
}

export interface DocSection {
  id: string;
  title: string;
  content: string;
  editedBy?: string;
  editedAtMs?: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  at: string;
}

export interface TimerState {
  running: boolean;
  endsAtMs: number;
  remainingMs: number;
  totalMs: number;
}

export interface AxisScore {
  name: string;
  score: number;
  max: number;
  comment: string;
}

export interface ConditionResult {
  id: string;
  achieved: boolean;
  reason: string;
}

export interface PlayerScore {
  playerId: string;
  roleName: string;
  conditions: ConditionResult[];
  secretScore: number;
  secretMax: number;
}

export interface HiddenReqResult {
  id: string;
  text?: string;
  discovered: boolean;
  comment: string;
}

export interface TestCaseResult {
  id: string;
  title?: string;
  result: "ok" | "partial" | "fail";
  comment: string;
}

export interface TitleAward {
  id: string;
  title: string;
  playerId: string;
  playerName?: string;
  reason: string;
}

export interface ScoreResult {
  teamScore: number;
  axes: AxisScore[];
  players: PlayerScore[];
  overallComment: string;
  improvement: string;
  hiddenReqs?: HiddenReqResult[];
  testCases?: TestCaseResult[];
  titles?: TitleAward[];
  futureProblems?: string[];
}

export interface ScenarioSummary {
  id: string;
  type?: string;
  title: string;
  tagline: string;
  clientName: string;
  industry: string;
  maxPlayers: number;
  difficulty?: "初級" | "標準" | "上級";
  recommendedPlayers?: string;
  recommendedMinutes?: number;
}

export interface RoomView {
  id: string;
  name: string;
  players: Player[];
  proposals: ProposalView[];
  questions: QuestionView[];
  doc: DocSection[];
  score?: ScoreResult;
}

export interface LeaderboardEntry {
  roomId: string;
  roomName: string;
  teamScore: number;
  scored: boolean;
  playerNames: string[];
}

export interface Snapshot {
  phase: Phase;
  isHost: boolean;
  myPlayerId?: string;
  myRoomId?: string;
  myRoomName?: string;
  players: Player[];
  scenario?: ScenarioView;
  proposals: ProposalView[];
  questions: QuestionView[];
  doc: DocSection[];
  announcements: Announcement[];
  timer: TimerState;
  score?: ScoreResult;
  rooms?: RoomView[];
  leaderboard?: LeaderboardEntry[];
  scenarios?: ScenarioSummary[];
  serverTimeMs: number;
  aiEnabled: boolean;
  autoAnswer: boolean;
  /** ホスト専用: 全ルームの未回答質問(古い順) */
  askQueue?: QuestionView[];
}

export function phaseIndex(p: Phase): number {
  return PHASES.findIndex((x) => x.id === p);
}

export function phaseLabel(p: Phase): string {
  return PHASES.find((x) => x.id === p)?.label ?? p;
}
