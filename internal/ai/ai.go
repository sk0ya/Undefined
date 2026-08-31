// Package ai builds prompts for scoring/assistance and optionally calls an
// OpenAI-compatible chat API. When no API key is configured the host UI runs
// in "manual mode": the generated prompt is copied into ChatGPT / Codex by the
// host, and the response is pasted back.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"reqgame/internal/game"
)

type Config struct {
	APIKey  string
	BaseURL string
	Model   string
}

func ConfigFromEnv() Config {
	cfg := Config{
		APIKey:  os.Getenv("AI_API_KEY"),
		BaseURL: os.Getenv("AI_BASE_URL"),
		Model:   os.Getenv("AI_MODEL"),
	}
	if cfg.APIKey == "" {
		cfg.APIKey = os.Getenv("OPENAI_API_KEY")
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.Model == "" {
		cfg.Model = "gpt-5-mini"
	}
	return cfg
}

func (c Config) Enabled() bool { return c.APIKey != "" }

// Chat sends a single-user-message chat completion request.
func (c Config) Chat(ctx context.Context, prompt string) (string, error) {
	body := map[string]any{
		"model": c.Model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	}
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(c.BaseURL, "/")+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("AI API error %d: %s", resp.StatusCode, truncate(string(raw), 500))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("AI応答の解析に失敗: %w", err)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("AI応答が空です")
	}
	return out.Choices[0].Message.Content, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// ---- prompt builders ----

// docText renders one room's requirements document + adopted proposals.
func docText(g *game.Game, room *game.Room) string {
	var b strings.Builder
	for _, s := range room.Doc {
		b.WriteString("## " + s.Title + "\n")
		if strings.TrimSpace(s.Content) == "" {
			b.WriteString("(未記入)\n\n")
		} else {
			b.WriteString(s.Content + "\n\n")
		}
	}
	sc := g.Scenario()
	b.WriteString("## 合意された要求一覧\n")
	any := false
	for _, p := range room.Proposals {
		if p.Status != game.StatusAdopted {
			continue
		}
		any = true
		author := ""
		if pl, ok := g.Players[p.AuthorID]; ok {
			author = pl.Name
			if sc != nil {
				if r := sc.RoleByID(pl.RoleID); r != nil {
					author = r.Title
				}
			}
		}
		fmt.Fprintf(&b, "- [%s] %s — %s (提案者: %s)\n", p.Category, p.Title, strings.ReplaceAll(p.Description, "\n", " "), author)
	}
	if !any {
		b.WriteString("(なし)\n")
	}
	b.WriteString("\n## 却下・保留された要求(参考)\n")
	for _, p := range room.Proposals {
		if p.Status == game.StatusAdopted {
			continue
		}
		fmt.Fprintf(&b, "- [%s/%s] %s — %s\n", p.Category, p.Status, p.Title, strings.ReplaceAll(p.Description, "\n", " "))
	}
	return b.String()
}

// resolveRoom returns the room for roomID, defaulting to the only room when
// exactly one exists.
func resolveRoom(g *game.Game, roomID string) (*game.Room, error) {
	if roomID == "" {
		if len(g.Rooms) == 1 {
			return g.Rooms[0], nil
		}
		return nil, fmt.Errorf("ルームを指定してください")
	}
	room := g.RoomByID(roomID)
	if room == nil {
		return nil, fmt.Errorf("ルームが見つかりません: %s", roomID)
	}
	return room, nil
}

func scenarioText(sc *game.Scenario) string {
	var b strings.Builder
	fmt.Fprintf(&b, "シナリオ: %s\nクライアント: %s(%s)\n\n背景:\n%s\n\nプロジェクトの公式ゴール:\n%s\n\n制約条件:\n", sc.Title, sc.ClientName, sc.Industry, sc.Background, sc.PublicGoal)
	for _, c := range sc.Constraints {
		b.WriteString("- " + c + "\n")
	}
	return b.String()
}

// BuildScorePrompt builds the full scoring prompt for one room.
// Caller must hold g.Mu.
func BuildScorePrompt(g *game.Game, roomID string) (string, error) {
	sc := g.Scenario()
	if sc == nil {
		return "", fmt.Errorf("ゲームが開始されていません")
	}
	room, err := resolveRoom(g, roomID)
	if err != nil {
		return "", err
	}
	hearing := sc.Type == "hearing"

	var b strings.Builder
	if hearing {
		b.WriteString(`あなたは要件定義ゲームの審判です。プレイヤーは開発チームとしてクライアントにヒアリングを行い、仕様(要件定義書)を作成しました。
あなたにはシナリオの完全情報(隠れた業務要件を含む)を与えます。プレイヤーの仕様を厳しくも建設的に評価してください。
単なる採点ではなく、プレイヤーが「そこまで考えてなかった!」と思える指摘を優先してください。

# シナリオ
`)
	} else {
		b.WriteString(`あなたはITコンサルティングファームの熟練PMO兼審査員です。
社内研修用「要件定義ゲーム」の成果物を採点してください。プレイヤーはクライアント企業のステークホルダーを演じ、協力して要件定義書を作成しました。各プレイヤーには秘密の勝利条件があります。

# シナリオ
`)
	}
	b.WriteString(scenarioText(sc))

	if len(sc.NPCs) > 0 {
		b.WriteString("\n# 世界の完全情報(NPCが持つ事情 — プレイヤーは質問で発見する必要があった)\n")
		for _, n := range sc.NPCs {
			fmt.Fprintf(&b, "## %s(%s)\n", n.Name, n.Title)
			for _, k := range n.Knowledge {
				fmt.Fprintf(&b, "- %s: %s\n", k.Topic, strings.ReplaceAll(k.Info, "\n", " "))
			}
		}
	}

	fmt.Fprintf(&b, "\n# 最終成果物(%sの要件定義書)\n", room.Name)
	b.WriteString(docText(g, room))

	b.WriteString("\n# プレイヤーと個人目標(秘密)\n")
	b.WriteString("各条件について、最終成果物から達成/未達成を判定してください。judgeHintは判定基準です。\n")
	b.WriteString("※このルームに不在のロールの情報は資料としてチームに公開済みであり、採点対象のプレイヤーは以下のみです。\n\n")
	for _, p := range g.Players {
		if p.RoleID == "" || p.RoomID != room.ID {
			continue
		}
		r := sc.RoleByID(p.RoleID)
		if r == nil {
			continue
		}
		fmt.Fprintf(&b, "## playerId: %s / %s(役: %s %s)\n", p.ID, p.Name, r.Name, r.Title)
		for _, c := range r.SecretConditions {
			fmt.Fprintf(&b, "- conditionId: %s / 条件: %s(%d点)/ 判定基準: %s\n", c.ID, c.Text, c.Points, c.JudgeHint)
		}
		b.WriteString("\n")
	}

	if len(sc.HiddenRequirements) > 0 {
		b.WriteString("# 隠れ要件(プレイヤーが発見・考慮すべきだったもの)\n")
		b.WriteString("最終成果物に反映(発見)されているかを判定してください。\n")
		for _, hr := range sc.HiddenRequirements {
			fmt.Fprintf(&b, "- id: %s / %s / 判定基準: %s\n", hr.ID, hr.Text, hr.JudgeHint)
		}
		b.WriteString("\n")
	}

	if len(sc.TestCases) > 0 {
		b.WriteString("# 実運用テストケース\n")
		b.WriteString("最終成果物の仕様どおりにシステムと店舗運用が動いたと仮定して、各ケースをシミュレーションし、問題なく処理できるか判定してください(ok=対応済 / partial=一部考慮 / fail=事故になる)。\n")
		for _, tc := range sc.TestCases {
			fmt.Fprintf(&b, "- id: %s / %s: %s / チェック: %s\n", tc.ID, tc.Title, strings.ReplaceAll(tc.Situation, "\n", " "), tc.CheckPoint)
		}
		b.WriteString("\n")
	}

	// rubric
	b.WriteString("# 採点基準(チームスコア: 100点満点)\n")
	rubric := sc.Rubric
	if len(rubric) == 0 {
		rubric = []game.RubricItem{
			{Name: "明確性", Max: 25, Description: "要件が具体的で曖昧さがないか。数値目標・判断基準が示されているか"},
			{Name: "網羅性", Max: 25, Description: "機能要件・非機能要件・スコープ外・体制/予算/移行が漏れなく検討されているか"},
			{Name: "実現可能性", Max: 25, Description: "制約条件(予算・納期・体制)の中で現実的か。優先順位付けがあるか"},
			{Name: "整合性", Max: 25, Description: "要件同士の矛盾がないか。背景・目的と要件が一貫しているか"},
		}
	}
	for _, ru := range rubric {
		fmt.Fprintf(&b, "- %s(%d点): %s\n", ru.Name, ru.Max, ru.Description)
	}

	if len(sc.Titles) > 0 {
		b.WriteString("\n# ボーナス称号\n")
		b.WriteString("採用された要求の提案者や仕様の内容から、最もふさわしいプレイヤーに授与してください(該当者がいない称号は省略可)。\n")
		for _, t := range sc.Titles {
			fmt.Fprintf(&b, "- id: %s / %s: %s\n", t.ID, t.Name, t.Description)
		}
	}

	// output schema
	b.WriteString("\n# 出力形式\n以下のJSONのみを出力してください。コードフェンスや説明文は不要です。\n{\n")
	b.WriteString("  \"teamScore\": <合計点数(整数)>,\n  \"axes\": [\n")
	for i, ru := range rubric {
		comma := ","
		if i == len(rubric)-1 {
			comma = ""
		}
		fmt.Fprintf(&b, "    {\"name\": \"%s\", \"score\": <整数>, \"max\": %d, \"comment\": \"<日本語で1〜2文>\"}%s\n", ru.Name, ru.Max, comma)
	}
	b.WriteString(`  ],
  "players": [
    {"playerId": "<上記のplayerId>", "conditions": [
      {"id": "<conditionId>", "achieved": true/false, "reason": "<判定理由を日本語で1文>"}
    ]}
  ],`)
	if len(sc.HiddenRequirements) > 0 {
		b.WriteString(`
  "hiddenReqs": [
    {"id": "<隠れ要件のid>", "discovered": true/false, "comment": "<判定理由を日本語で1文>"}
  ],`)
	}
	if len(sc.TestCases) > 0 {
		b.WriteString(`
  "testCases": [
    {"id": "<テストケースのid>", "result": "ok" | "partial" | "fail", "comment": "<何が起きるかを具体的に。日本語で1〜2文>"}
  ],`)
	}
	if len(sc.Titles) > 0 {
		b.WriteString(`
  "titles": [
    {"id": "<称号のid>", "playerId": "<授与するプレイヤーのplayerId>", "reason": "<授与理由を日本語で1文>"}
  ],`)
	}
	if hearing {
		b.WriteString(`
  "futureProblems": ["<このシステムを実際に3か月運用した場合に発生しそうな問題を3つ。プレイヤーが考えていなかったものを優先>", "...", "..."],`)
	}
	b.WriteString(`
  "overallComment": "<全体講評。良かった点を中心に日本語で3〜5文>",
  "improvement": "<実務に活かせる改善アドバイスを日本語で3〜5文>"
}`)
	return b.String(), nil
}

// BuildNPCPrompt makes the AI answer a player question in-character as an NPC.
func BuildNPCPrompt(g *game.Game, npcID, question string) (string, error) {
	sc := g.Scenario()
	if sc == nil {
		return "", fmt.Errorf("ゲームが開始されていません")
	}
	npc := sc.NPCByID(npcID)
	if npc == nil {
		return "", fmt.Errorf("NPCが見つかりません: %s", npcID)
	}
	if strings.TrimSpace(question) == "" {
		return "", fmt.Errorf("プレイヤーからの質問を入力してください")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "あなたは要件定義ゲームのNPC「%s(%s)」です。開発チーム(プレイヤー)からのヒアリングに、この人物になりきって答えてください。\n\n# 世界設定\n", npc.Name, npc.Title)
	b.WriteString(scenarioText(sc))
	fmt.Fprintf(&b, "\n# あなた(%s)の人物像・冒頭の発言\n%s\n\n# あなたが知っている情報と開示条件\n", npc.Name, npc.Opening)
	for _, k := range npc.Knowledge {
		fmt.Fprintf(&b, "- %s: %s(開示条件: %s)\n", k.Topic, strings.ReplaceAll(k.Info, "\n", " "), k.RevealWhen)
	}
	b.WriteString(`
# ルール
- 聞かれたことにだけ答える。開示条件を満たさない情報は自分からは言わない
- 「そこをもっと聞いたほうがいい」等のヒントは出さない
- 知らないことは「分かりません」「それは〇〇さんに聞いてください」と自然に返す
- 業務の当事者らしい自然な口調で、3文以内で答える
- 曖昧な質問には曖昧に答えてよい(プレイヤーが具体的に聞き直すのもゲームのうち)

# プレイヤーからの質問
`)
	b.WriteString(question)
	b.WriteString("\n\n回答(セリフのみを出力):")
	return b.String(), nil
}

// BuildEventPrompt asks the AI to invent a mid-game curveball announcement.
// The event is broadcast to all rooms, so all rooms' proposals inform it.
func BuildEventPrompt(g *game.Game, direction string) (string, error) {
	sc := g.Scenario()
	if sc == nil {
		return "", fmt.Errorf("ゲームが開始されていません")
	}
	var b strings.Builder
	b.WriteString("あなたは研修用「要件定義ゲーム」のゲームマスター補佐です。議論に揺さぶりをかける「クライアントからの追加情報イベント」を1つ作ってください。イベントは全ルーム(全チーム)に一斉配信されます。\n\n# シナリオ\n")
	b.WriteString(scenarioText(sc))
	b.WriteString("\n# 現在までに提案されている要求\n")
	for _, room := range g.Rooms {
		for _, p := range room.Proposals {
			fmt.Fprintf(&b, "- [%s][%s] %s: %s\n", room.Name, p.Category, p.Title, p.Description)
		}
	}
	if len(sc.EventIdeas) > 0 {
		b.WriteString("\n# イベントの方向性の例\n")
		for _, e := range sc.EventIdeas {
			b.WriteString("- " + e + "\n")
		}
	}
	if strings.TrimSpace(direction) != "" {
		b.WriteString("\n# ホストからの指示\n" + direction + "\n")
	}
	b.WriteString(`
# 出力形式
以下のJSONのみを出力してください。
{"title": "<イベント名(例: 社長からの緊急連絡)>", "body": "<プレイヤー全員に公開するイベント本文。150字程度。議論の前提を変えるが、ゲームを壊さない内容>"}`)
	return b.String(), nil
}

// BuildAdvicePrompt asks the AI for facilitation advice for the host.
// roomID may be empty when there are multiple rooms; the prompt then covers
// every room briefly.
func BuildAdvicePrompt(g *game.Game, roomID, question string) (string, error) {
	sc := g.Scenario()
	if sc == nil {
		return "", fmt.Errorf("ゲームが開始されていません")
	}
	var b strings.Builder
	b.WriteString("あなたは研修用「要件定義ゲーム」のファシリテーション補佐です。ホスト(ファシリテーター)へのアドバイスを日本語で簡潔に出してください。\n\n# シナリオ\n")
	b.WriteString(scenarioText(sc))
	b.WriteString("\n# 現在のフェーズ: " + string(g.Phase) + "\n")
	if room, err := resolveRoom(g, roomID); err == nil {
		fmt.Fprintf(&b, "\n# 現在の成果物(%s)\n", room.Name)
		b.WriteString(docText(g, room))
	} else {
		for _, room := range g.Rooms {
			fmt.Fprintf(&b, "\n# 現在の成果物(%s)\n", room.Name)
			b.WriteString(docText(g, room))
		}
	}
	if strings.TrimSpace(question) != "" {
		b.WriteString("\n# ホストからの質問\n" + question + "\n")
	} else {
		b.WriteString("\n# 依頼\n議論が深まっていない観点、ファシリテーターが投げかけるとよい質問を3つ挙げてください。\n")
	}
	return b.String(), nil
}

// ---- response parsing ----

// ExtractJSON pulls the first top-level JSON object out of an LLM response,
// tolerating code fences and surrounding prose.
func ExtractJSON(s string) (string, error) {
	s = strings.TrimSpace(s)
	start := strings.Index(s, "{")
	if start < 0 {
		return "", fmt.Errorf("JSONが見つかりません")
	}
	depth := 0
	inStr := false
	esc := false
	for i := start; i < len(s); i++ {
		ch := s[i]
		if inStr {
			if esc {
				esc = false
			} else if ch == '\\' {
				esc = true
			} else if ch == '"' {
				inStr = false
			}
			continue
		}
		switch ch {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1], nil
			}
		}
	}
	return "", fmt.Errorf("JSONが閉じていません")
}

// ParseScoreResult parses an LLM scoring response into a ScoreResult.
func ParseScoreResult(raw string) (*game.ScoreResult, error) {
	js, err := ExtractJSON(raw)
	if err != nil {
		return nil, err
	}
	var sr game.ScoreResult
	if err := json.Unmarshal([]byte(js), &sr); err != nil {
		return nil, fmt.Errorf("採点JSONの解析に失敗: %w", err)
	}
	return &sr, nil
}

// ParseEvent parses an event-generation response.
func ParseEvent(raw string) (title, body string, err error) {
	js, err := ExtractJSON(raw)
	if err != nil {
		return "", "", err
	}
	var ev struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := json.Unmarshal([]byte(js), &ev); err != nil {
		return "", "", fmt.Errorf("イベントJSONの解析に失敗: %w", err)
	}
	return ev.Title, ev.Body, nil
}
