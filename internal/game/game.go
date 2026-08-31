package game

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"sync"
	"time"
)

type Phase string

const (
	PhaseLobby      Phase = "lobby"
	PhaseBriefing   Phase = "briefing"
	PhaseDiscussion Phase = "discussion"
	PhaseVoting     Phase = "voting"
	PhaseFinalize   Phase = "finalize"
	PhaseResults    Phase = "results"
)

var phaseOrder = []Phase{PhaseLobby, PhaseBriefing, PhaseDiscussion, PhaseVoting, PhaseFinalize, PhaseResults}

const (
	MaxPlayers = 40
	RoomSize   = 4
)

type Player struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	RoleID    string `json:"roleId,omitempty"`
	RoomID    string `json:"roomId,omitempty"`
	Connected bool   `json:"connected"`
	token     string
}

type VoteValue string

const (
	VoteApprove VoteValue = "approve"
	VoteReject  VoteValue = "reject"
)

type ProposalStatus string

const (
	StatusPending  ProposalStatus = "pending"
	StatusAdopted  ProposalStatus = "adopted"
	StatusRejected ProposalStatus = "rejected"
)

type Proposal struct {
	ID          string               `json:"id"`
	AuthorID    string               `json:"authorId"`
	Category    string               `json:"category"`
	Title       string               `json:"title"`
	Description string               `json:"description"`
	Status      ProposalStatus       `json:"status"`
	CreatedAt   time.Time            `json:"createdAt"`
	Votes       map[string]VoteValue `json:"-"`
}

type DocSection struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type Announcement struct {
	ID    string    `json:"id"`
	Title string    `json:"title"`
	Body  string    `json:"body"`
	At    time.Time `json:"at"`
}

type TimerState struct {
	Running     bool  `json:"running"`
	EndsAtMs    int64 `json:"endsAtMs"`    // unix ms; valid when Running
	RemainingMs int64 `json:"remainingMs"` // valid when paused
}

// ---- scoring result types (filled by AI or manual paste) ----

type AxisScore struct {
	Name    string `json:"name"`
	Score   int    `json:"score"`
	Max     int    `json:"max"`
	Comment string `json:"comment"`
}

type ConditionResult struct {
	ID       string `json:"id"`
	Achieved bool   `json:"achieved"`
	Reason   string `json:"reason"`
}

type PlayerScore struct {
	PlayerID    string            `json:"playerId"`
	RoleName    string            `json:"roleName"`
	Conditions  []ConditionResult `json:"conditions"`
	SecretScore int               `json:"secretScore"`
	SecretMax   int               `json:"secretMax"`
}

type HiddenReqResult struct {
	ID         string `json:"id"`
	Text       string `json:"text,omitempty"` // filled server-side from scenario
	Discovered bool   `json:"discovered"`
	Comment    string `json:"comment"`
}

type TestCaseResult struct {
	ID      string `json:"id"`
	Title   string `json:"title,omitempty"` // filled server-side
	Result  string `json:"result"`          // "ok" | "partial" | "fail"
	Comment string `json:"comment"`
}

type TitleAward struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName,omitempty"` // filled server-side
	Reason     string `json:"reason"`
}

type ScoreResult struct {
	TeamScore      int           `json:"teamScore"`
	Axes           []AxisScore   `json:"axes"`
	Players        []PlayerScore `json:"players"`
	OverallComment string        `json:"overallComment"`
	Improvement    string        `json:"improvement"`

	HiddenReqs     []HiddenReqResult `json:"hiddenReqs,omitempty"`
	TestCases      []TestCaseResult  `json:"testCases,omitempty"`
	Titles         []TitleAward      `json:"titles,omitempty"`
	FutureProblems []string          `json:"futureProblems,omitempty"`
}

// ---- room ----

// Room is one team's independent play area. Scenario, phase, timer and
// announcements are shared across all rooms; proposals, doc, votes and
// scores are per-room.
type Room struct {
	ID          string
	Name        string
	playerOrder []string
	Proposals   []*Proposal
	Doc         []DocSection
	Score       *ScoreResult
}

// Game holds all mutable state for one game session (all rooms).
type Game struct {
	Mu sync.Mutex

	Scenarios map[string]*Scenario

	Phase         Phase
	ScenarioID    string
	Players       map[string]*Player
	playerOrder   []string
	Rooms         []*Room
	Announcements []Announcement
	Timer         TimerState
	StartedAt     time.Time

	onChange func()
}

func NewGame(scenarios map[string]*Scenario) *Game {
	return &Game{
		Scenarios: scenarios,
		Phase:     PhaseLobby,
		Players:   map[string]*Player{},
	}
}

func (g *Game) SetOnChange(fn func()) { g.onChange = fn }

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func newToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func randInt(n int) int {
	if n <= 1 {
		return 0
	}
	v, _ := rand.Int(rand.Reader, big.NewInt(int64(n)))
	return int(v.Int64())
}

func (g *Game) Scenario() *Scenario {
	if g.ScenarioID == "" {
		return nil
	}
	return g.Scenarios[g.ScenarioID]
}

func (g *Game) RoomByID(id string) *Room {
	for _, r := range g.Rooms {
		if r.ID == id {
			return r
		}
	}
	return nil
}

func (g *Game) RoomOf(playerID string) *Room {
	p, ok := g.Players[playerID]
	if !ok || p.RoomID == "" {
		return nil
	}
	return g.RoomByID(p.RoomID)
}

// ---- joining ----

var ErrGameFull = fmt.Errorf("これ以上参加できません(定員%d人に達しています)", MaxPlayers)
var ErrGameStarted = fmt.Errorf("ゲームは既に開始されています。空きのあるルームがありません")
var ErrNameTaken = fmt.Errorf("その名前は既に使われています")

// Join registers a new player or restores an existing one by token.
// Mid-game joins are auto-assigned to the room with the most vacancies.
func (g *Game) Join(name, token string) (*Player, bool, error) {
	if token != "" {
		for _, p := range g.Players {
			if p.token == token {
				if name != "" {
					p.Name = name
				}
				return p, false, nil
			}
		}
	}
	if name == "" {
		name = "プレイヤー"
	}
	for _, p := range g.Players {
		if p.Name == name {
			return nil, false, ErrNameTaken
		}
	}
	if len(g.Players) >= MaxPlayers {
		return nil, false, ErrGameFull
	}
	p := &Player{ID: newID(), Name: name, token: newToken()}

	if g.Phase != PhaseLobby {
		// mid-game join: pick the room with the fewest players that still
		// has a vacant role
		var target *Room
		for _, r := range g.Rooms {
			if len(r.playerOrder) >= RoomSize {
				continue
			}
			if target == nil || len(r.playerOrder) < len(target.playerOrder) {
				target = r
			}
		}
		if target == nil {
			return nil, false, ErrGameStarted
		}
		roleID := g.vacantRole(target)
		if roleID == "" {
			return nil, false, ErrGameStarted
		}
		p.RoomID = target.ID
		p.RoleID = roleID
		target.playerOrder = append(target.playerOrder, p.ID)
	}

	g.Players[p.ID] = p
	g.playerOrder = append(g.playerOrder, p.ID)
	return p, true, nil
}

// vacantRole returns a role id not used by anyone in the room.
func (g *Game) vacantRole(r *Room) string {
	sc := g.Scenario()
	if sc == nil {
		return ""
	}
	used := map[string]bool{}
	for _, pid := range r.playerOrder {
		if p, ok := g.Players[pid]; ok {
			used[p.RoleID] = true
		}
	}
	for _, role := range sc.Roles {
		if !used[role.ID] {
			return role.ID
		}
	}
	return ""
}

func (g *Game) PlayerToken(p *Player) string { return p.token }

func (g *Game) RemovePlayer(id string) {
	p, ok := g.Players[id]
	if !ok {
		return
	}
	if room := g.RoomByID(p.RoomID); room != nil {
		for i, pid := range room.playerOrder {
			if pid == id {
				room.playerOrder = append(room.playerOrder[:i], room.playerOrder[i+1:]...)
				break
			}
		}
	}
	delete(g.Players, id)
	for i, pid := range g.playerOrder {
		if pid == id {
			g.playerOrder = append(g.playerOrder[:i], g.playerOrder[i+1:]...)
			break
		}
	}
}

// ---- game lifecycle ----

// Start splits all lobby players into balanced rooms of up to RoomSize and
// assigns roles randomly within each room.
func (g *Game) Start(scenarioID string) error {
	sc, ok := g.Scenarios[scenarioID]
	if !ok {
		return fmt.Errorf("シナリオが見つかりません: %s", scenarioID)
	}
	n := len(g.Players)
	if n < 2 {
		return fmt.Errorf("開始には2人以上のプレイヤーが必要です(現在%d人)", n)
	}
	if len(sc.Roles) < RoomSize {
		return fmt.Errorf("このシナリオはロールが%d個しかありません", len(sc.Roles))
	}
	g.ScenarioID = scenarioID
	g.StartedAt = time.Now()

	// shuffle players
	order := append([]string{}, g.playerOrder...)
	for i := len(order) - 1; i > 0; i-- {
		j := randInt(i + 1)
		order[i], order[j] = order[j], order[i]
	}

	// balanced split: sizes differ by at most 1, none smaller than 2
	// (except a single room of 2..3 when n < 4)
	numRooms := (n + RoomSize - 1) / RoomSize
	base := n / numRooms
	extra := n % numRooms

	g.Rooms = nil
	idx := 0
	for i := 0; i < numRooms; i++ {
		size := base
		if i < extra {
			size++
		}
		room := &Room{ID: newID(), Name: fmt.Sprintf("ルーム%d", i+1)}
		for _, t := range sc.DocTemplate {
			room.Doc = append(room.Doc, DocSection{ID: t.ID, Title: t.Title, Content: ""})
		}
		// assign shuffled roles to this room's members
		roleIdx := make([]int, len(sc.Roles))
		for k := range roleIdx {
			roleIdx[k] = k
		}
		for k := len(roleIdx) - 1; k > 0; k-- {
			j := randInt(k + 1)
			roleIdx[k], roleIdx[j] = roleIdx[j], roleIdx[k]
		}
		for s := 0; s < size; s++ {
			pid := order[idx]
			idx++
			p := g.Players[pid]
			p.RoomID = room.ID
			p.RoleID = sc.Roles[roleIdx[s]].ID
			room.playerOrder = append(room.playerOrder, pid)
		}
		g.Rooms = append(g.Rooms, room)
	}

	g.Announcements = nil
	g.Timer = TimerState{}
	g.Phase = PhaseBriefing
	return nil
}

func (g *Game) Reset() {
	g.Phase = PhaseLobby
	g.ScenarioID = ""
	g.Rooms = nil
	g.Announcements = nil
	g.Timer = TimerState{}
	for _, p := range g.Players {
		p.RoleID = ""
		p.RoomID = ""
	}
}

func (g *Game) SetPhase(phase Phase) error {
	valid := false
	for _, p := range phaseOrder {
		if p == phase {
			valid = true
		}
	}
	if !valid {
		return fmt.Errorf("不正なフェーズ: %s", phase)
	}
	if phase != PhaseLobby && g.ScenarioID == "" {
		return fmt.Errorf("先にシナリオを選んでゲームを開始してください")
	}
	prev := g.Phase
	g.Phase = phase
	g.Timer = TimerState{}
	if prev == PhaseVoting && phase == PhaseFinalize {
		for _, room := range g.Rooms {
			room.settleVotes()
		}
	}
	return nil
}

func (g *Game) NextPhase() error {
	for i, p := range phaseOrder {
		if p == g.Phase && i+1 < len(phaseOrder) {
			return g.SetPhase(phaseOrder[i+1])
		}
	}
	return nil
}

func (r *Room) settleVotes() {
	for _, pr := range r.Proposals {
		if pr.Status != StatusPending {
			continue
		}
		approve, reject := 0, 0
		for _, v := range pr.Votes {
			switch v {
			case VoteApprove:
				approve++
			case VoteReject:
				reject++
			}
		}
		if approve > reject {
			pr.Status = StatusAdopted
		} else if reject > approve {
			pr.Status = StatusRejected
		}
	}
}

// ---- proposals ----

func (g *Game) Propose(authorID, category, title, description string) (*Proposal, error) {
	if g.Phase != PhaseDiscussion && g.Phase != PhaseBriefing {
		return nil, fmt.Errorf("いまは要求カードを提出できるフェーズではありません")
	}
	if title == "" {
		return nil, fmt.Errorf("タイトルを入力してください")
	}
	room := g.RoomOf(authorID)
	if room == nil {
		return nil, fmt.Errorf("ルームに所属していません")
	}
	pr := &Proposal{
		ID:          newID(),
		AuthorID:    authorID,
		Category:    category,
		Title:       title,
		Description: description,
		Status:      StatusPending,
		CreatedAt:   time.Now(),
		Votes:       map[string]VoteValue{},
	}
	room.Proposals = append(room.Proposals, pr)
	return pr, nil
}

// findProposal searches all rooms (proposal ids are globally unique).
func (g *Game) findProposal(id string) (*Room, *Proposal) {
	for _, room := range g.Rooms {
		for _, p := range room.Proposals {
			if p.ID == id {
				return room, p
			}
		}
	}
	return nil, nil
}

func (g *Game) UpdateProposal(actorID, id, category, title, description string, isHost bool) error {
	_, pr := g.findProposal(id)
	if pr == nil {
		return fmt.Errorf("提案が見つかりません")
	}
	if !isHost && pr.AuthorID != actorID {
		return fmt.Errorf("自分の提案のみ編集できます")
	}
	if !isHost && g.Phase != PhaseDiscussion && g.Phase != PhaseBriefing {
		return fmt.Errorf("いまは編集できません")
	}
	if title != "" {
		pr.Title = title
	}
	pr.Category = category
	pr.Description = description
	return nil
}

func (g *Game) DeleteProposal(actorID, id string, isHost bool) error {
	room, pr := g.findProposal(id)
	if pr == nil {
		return fmt.Errorf("提案が見つかりません")
	}
	if !isHost && (pr.AuthorID != actorID || g.Phase == PhaseVoting || g.Phase == PhaseFinalize || g.Phase == PhaseResults) {
		return fmt.Errorf("削除できません")
	}
	for i, p := range room.Proposals {
		if p.ID == id {
			room.Proposals = append(room.Proposals[:i], room.Proposals[i+1:]...)
			return nil
		}
	}
	return nil
}

func (g *Game) Vote(playerID, proposalID string, value VoteValue) error {
	if g.Phase != PhaseVoting {
		return fmt.Errorf("投票フェーズではありません")
	}
	room, pr := g.findProposal(proposalID)
	if pr == nil {
		return fmt.Errorf("提案が見つかりません")
	}
	if voter := g.Players[playerID]; voter == nil || voter.RoomID != room.ID {
		return fmt.Errorf("自分のルームの提案にのみ投票できます")
	}
	if value != VoteApprove && value != VoteReject {
		return fmt.Errorf("不正な投票値")
	}
	pr.Votes[playerID] = value
	return nil
}

func (g *Game) SetProposalStatus(id string, status ProposalStatus) error {
	_, pr := g.findProposal(id)
	if pr == nil {
		return fmt.Errorf("提案が見つかりません")
	}
	if status != StatusPending && status != StatusAdopted && status != StatusRejected {
		return fmt.Errorf("不正なステータス")
	}
	pr.Status = status
	return nil
}

// ---- doc ----

// EditDoc updates one section of a room's document. Players edit their own
// room while the game is in progress; the host targets any room by id.
func (g *Game) EditDoc(roomID, sectionID, content string, isHost bool) error {
	if !isHost {
		switch g.Phase {
		case PhaseBriefing, PhaseDiscussion, PhaseVoting, PhaseFinalize:
		default:
			return fmt.Errorf("いまは仕様書を編集できません")
		}
	}
	room := g.RoomByID(roomID)
	if room == nil {
		return fmt.Errorf("ルームが見つかりません")
	}
	for i := range room.Doc {
		if room.Doc[i].ID == sectionID {
			room.Doc[i].Content = content
			return nil
		}
	}
	return fmt.Errorf("セクションが見つかりません")
}

// ---- timer ----

func (g *Game) TimerAction(action string, seconds int) error {
	now := time.Now().UnixMilli()
	switch action {
	case "start":
		var remain int64
		if g.Timer.RemainingMs > 0 && seconds <= 0 {
			remain = g.Timer.RemainingMs
		} else {
			if seconds <= 0 {
				seconds = 600
			}
			remain = int64(seconds) * 1000
		}
		g.Timer = TimerState{Running: true, EndsAtMs: now + remain}
	case "pause":
		if g.Timer.Running {
			remain := g.Timer.EndsAtMs - now
			if remain < 0 {
				remain = 0
			}
			g.Timer = TimerState{Running: false, RemainingMs: remain}
		}
	case "reset":
		g.Timer = TimerState{}
	default:
		return fmt.Errorf("不正なタイマー操作: %s", action)
	}
	return nil
}

// ---- announcements ----

func (g *Game) Announce(title, body string) {
	g.Announcements = append(g.Announcements, Announcement{
		ID: newID(), Title: title, Body: body, At: time.Now(),
	})
}

// ---- score ----

func (g *Game) ApplyScore(roomID string, sr *ScoreResult) error {
	room := g.RoomByID(roomID)
	if room == nil {
		return fmt.Errorf("ルームが見つかりません: %s", roomID)
	}
	sc := g.Scenario()
	for i := range sr.Players {
		ps := &sr.Players[i]
		p := g.Players[ps.PlayerID]
		if p == nil || sc == nil {
			continue
		}
		role := sc.RoleByID(p.RoleID)
		if role == nil {
			continue
		}
		ps.RoleName = role.Title
		total, max := 0, 0
		for _, cond := range role.SecretConditions {
			max += cond.Points
			for _, cr := range ps.Conditions {
				if cr.ID == cond.ID && cr.Achieved {
					total += cond.Points
				}
			}
		}
		ps.SecretScore = total
		ps.SecretMax = max
	}
	if sc != nil {
		for i := range sr.HiddenReqs {
			for _, hr := range sc.HiddenRequirements {
				if hr.ID == sr.HiddenReqs[i].ID {
					sr.HiddenReqs[i].Text = hr.Text
				}
			}
		}
		for i := range sr.TestCases {
			for _, tc := range sc.TestCases {
				if tc.ID == sr.TestCases[i].ID {
					sr.TestCases[i].Title = tc.Title
				}
			}
		}
		for i := range sr.Titles {
			t := &sr.Titles[i]
			if t.Title == "" {
				for _, def := range sc.Titles {
					if def.ID == t.ID {
						t.Title = def.Name
					}
				}
			}
			if p, ok := g.Players[t.PlayerID]; ok {
				t.PlayerName = p.Name
			}
		}
	}
	room.Score = sr
	return nil
}

// ---- snapshot ----

type RoleView struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Title            string            `json:"title"`
	Icon             string            `json:"icon"`
	PublicProfile    string            `json:"publicProfile"`
	PrivateBrief     string            `json:"privateBrief,omitempty"`
	SecretConditions []SecretCondition `json:"secretConditions,omitempty"`
	Vacant           bool              `json:"vacant,omitempty"` // viewer's room has nobody on this role
}

// NPCView hides interview knowledge from players (host sees everything).
type NPCView struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Title     string         `json:"title"`
	Icon      string         `json:"icon"`
	Opening   string         `json:"opening"`
	Knowledge []NPCKnowledge `json:"knowledge,omitempty"`
}

type ScenarioView struct {
	ID          string               `json:"id"`
	Type        string               `json:"type"`
	Title       string               `json:"title"`
	Tagline     string               `json:"tagline"`
	ClientName  string               `json:"clientName"`
	Industry    string               `json:"industry"`
	Background  string               `json:"background"`
	PublicGoal  string               `json:"publicGoal"`
	Constraints []string             `json:"constraints"`
	Categories  []string             `json:"categories"`
	Roles       []RoleView           `json:"roles"`
	EventIdeas  []string             `json:"eventIdeas,omitempty"`
	DocTemplate []DocTemplateSection `json:"docTemplate"`

	NPCs               []NPCView           `json:"npcs,omitempty"`
	HiddenRequirements []HiddenRequirement `json:"hiddenRequirements,omitempty"` // host / results only
	ScriptedEvents     []ScriptedEvent     `json:"scriptedEvents,omitempty"`     // host only
	TestCases          []TestCase          `json:"testCases,omitempty"`          // host / results only
	Rubric             []RubricItem        `json:"rubric,omitempty"`
	Titles             []TitleAwardDef     `json:"titles,omitempty"`
}

type ProposalView struct {
	ID           string         `json:"id"`
	AuthorID     string         `json:"authorId"`
	AuthorName   string         `json:"authorName"`
	AuthorRole   string         `json:"authorRole"`
	Category     string         `json:"category"`
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	Status       ProposalStatus `json:"status"`
	ApproveCount int            `json:"approveCount"`
	RejectCount  int            `json:"rejectCount"`
	VotedCount   int            `json:"votedCount"`
	MyVote       string         `json:"myVote,omitempty"`
	VotesVisible bool           `json:"votesVisible"`
}

// RoomView is one room's full play data (host console / own room).
type RoomView struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Players   []Player       `json:"players"`
	Proposals []ProposalView `json:"proposals"`
	Doc       []DocSection   `json:"doc"`
	Score     *ScoreResult   `json:"score,omitempty"`
}

type LeaderboardEntry struct {
	RoomID      string   `json:"roomId"`
	RoomName    string   `json:"roomName"`
	TeamScore   int      `json:"teamScore"`
	Scored      bool     `json:"scored"`
	PlayerNames []string `json:"playerNames"`
}

type Snapshot struct {
	Phase         Phase              `json:"phase"`
	IsHost        bool               `json:"isHost"`
	MyPlayerID    string             `json:"myPlayerId,omitempty"`
	MyRoomID      string             `json:"myRoomId,omitempty"`
	MyRoomName    string             `json:"myRoomName,omitempty"`
	Players       []Player           `json:"players"` // global roster
	Scenario      *ScenarioView      `json:"scenario,omitempty"`
	Proposals     []ProposalView     `json:"proposals"` // viewer's room
	Doc           []DocSection       `json:"doc"`       // viewer's room
	Score         *ScoreResult       `json:"score,omitempty"`
	Rooms         []RoomView         `json:"rooms,omitempty"`       // host only
	Leaderboard   []LeaderboardEntry `json:"leaderboard,omitempty"` // host always / players in results
	Announcements []Announcement     `json:"announcements"`
	Timer         TimerState         `json:"timer"`
	Scenarios     []ScenarioSummary  `json:"scenarios,omitempty"` // host, lobby
	ServerTimeMs  int64              `json:"serverTimeMs"`
}

func (g *Game) proposalView(room *Room, pr *Proposal, viewerID string, votesVisible bool) ProposalView {
	pv := ProposalView{
		ID: pr.ID, AuthorID: pr.AuthorID, Category: pr.Category,
		Title: pr.Title, Description: pr.Description, Status: pr.Status,
		VotedCount: len(pr.Votes), VotesVisible: votesVisible,
	}
	if author, ok := g.Players[pr.AuthorID]; ok {
		pv.AuthorName = author.Name
		if sc := g.Scenario(); sc != nil {
			if role := sc.RoleByID(author.RoleID); role != nil {
				pv.AuthorRole = role.Title
			}
		}
	}
	if votesVisible {
		for _, v := range pr.Votes {
			if v == VoteApprove {
				pv.ApproveCount++
			} else {
				pv.RejectCount++
			}
		}
	}
	if v, ok := pr.Votes[viewerID]; ok {
		pv.MyVote = string(v)
	}
	return pv
}

func (g *Game) roomView(room *Room, viewerID string, votesVisible, withScore bool) RoomView {
	rv := RoomView{ID: room.ID, Name: room.Name, Doc: append([]DocSection{}, room.Doc...)}
	for _, pid := range room.playerOrder {
		if p, ok := g.Players[pid]; ok {
			rv.Players = append(rv.Players, *p)
		}
	}
	rv.Proposals = []ProposalView{}
	for _, pr := range room.Proposals {
		rv.Proposals = append(rv.Proposals, g.proposalView(room, pr, viewerID, votesVisible))
	}
	if withScore {
		rv.Score = room.Score
	}
	return rv
}

// BuildSnapshot builds the state visible to one connection.
func (g *Game) BuildSnapshot(viewerID string, isHost bool) *Snapshot {
	reveal := g.Phase == PhaseResults
	votesVisible := isHost || g.Phase == PhaseFinalize || reveal

	snap := &Snapshot{
		Phase:         g.Phase,
		IsHost:        isHost,
		MyPlayerID:    viewerID,
		Proposals:     []ProposalView{},
		Doc:           []DocSection{},
		Announcements: append([]Announcement{}, g.Announcements...),
		Timer:         g.Timer,
		ServerTimeMs:  time.Now().UnixMilli(),
	}

	for _, pid := range g.playerOrder {
		if p, ok := g.Players[pid]; ok {
			snap.Players = append(snap.Players, *p)
		}
	}
	sort.SliceStable(snap.Players, func(i, j int) bool { return snap.Players[i].Name < snap.Players[j].Name })

	if isHost {
		snap.Scenarios = Summaries(g.Scenarios)
		for _, room := range g.Rooms {
			snap.Rooms = append(snap.Rooms, g.roomView(room, "", votesVisible, true))
		}
	}

	var myRoom *Room
	if !isHost {
		myRoom = g.RoomOf(viewerID)
		if myRoom != nil {
			snap.MyRoomID = myRoom.ID
			snap.MyRoomName = myRoom.Name
			rv := g.roomView(myRoom, viewerID, votesVisible, isHost || reveal)
			snap.Proposals = rv.Proposals
			snap.Doc = rv.Doc
			snap.Score = rv.Score
		}
	}

	// leaderboard: host always (once rooms exist), players at results
	if len(g.Rooms) > 0 && (isHost || reveal) {
		for _, room := range g.Rooms {
			e := LeaderboardEntry{RoomID: room.ID, RoomName: room.Name}
			for _, pid := range room.playerOrder {
				if p, ok := g.Players[pid]; ok {
					e.PlayerNames = append(e.PlayerNames, p.Name)
				}
			}
			if room.Score != nil {
				e.Scored = true
				e.TeamScore = room.Score.TeamScore
			}
			snap.Leaderboard = append(snap.Leaderboard, e)
		}
		sort.SliceStable(snap.Leaderboard, func(i, j int) bool {
			a, b := snap.Leaderboard[i], snap.Leaderboard[j]
			if a.Scored != b.Scored {
				return a.Scored
			}
			return a.TeamScore > b.TeamScore
		})
	}

	if sc := g.Scenario(); sc != nil {
		sv := &ScenarioView{
			ID: sc.ID, Type: sc.Type, Title: sc.Title, Tagline: sc.Tagline, ClientName: sc.ClientName,
			Industry: sc.Industry, Background: sc.Background, PublicGoal: sc.PublicGoal,
			Constraints: sc.Constraints, Categories: sc.Categories, DocTemplate: sc.DocTemplate,
			Rubric: sc.Rubric, Titles: sc.Titles,
		}
		if isHost {
			sv.EventIdeas = sc.EventIdeas
			sv.ScriptedEvents = sc.ScriptedEvents
		}
		if isHost || reveal {
			sv.HiddenRequirements = sc.HiddenRequirements
			sv.TestCases = sc.TestCases
		}
		for _, n := range sc.NPCs {
			nv := NPCView{ID: n.ID, Name: n.Name, Title: n.Title, Icon: n.Icon, Opening: n.Opening}
			if isHost || reveal {
				nv.Knowledge = n.Knowledge
			}
			sv.NPCs = append(sv.NPCs, nv)
		}

		// roles assigned within the viewer's room
		myRoleID := ""
		assignedInMyRoom := map[string]bool{}
		if p, ok := g.Players[viewerID]; ok {
			myRoleID = p.RoleID
		}
		if myRoom != nil {
			for _, pid := range myRoom.playerOrder {
				if p, ok := g.Players[pid]; ok {
					assignedInMyRoom[p.RoleID] = true
				}
			}
		}
		for _, r := range sc.Roles {
			rv := RoleView{ID: r.ID, Name: r.Name, Title: r.Title, Icon: r.Icon, PublicProfile: r.PublicProfile}
			vacant := myRoom != nil && !assignedInMyRoom[r.ID]
			if isHost || reveal || r.ID == myRoleID {
				rv.PrivateBrief = r.PrivateBrief
				rv.SecretConditions = r.SecretConditions
			} else if vacant {
				// 欠員ロールの補償: 不在ロールの独占情報はチームに公開する
				// (個人目標は誰も持たないため公開しない)
				rv.PrivateBrief = r.PrivateBrief
			}
			if !isHost {
				rv.Vacant = vacant
			}
			sv.Roles = append(sv.Roles, rv)
		}
		snap.Scenario = sv
	}

	return snap
}
