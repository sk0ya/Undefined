package game

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SecretCondition is a hidden win condition assigned to a role.
type SecretCondition struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	Points    int    `json:"points"`
	JudgeHint string `json:"judgeHint"`
}

// Role is a stakeholder role in a scenario.
type Role struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Title            string            `json:"title"`
	Icon             string            `json:"icon"`
	PublicProfile    string            `json:"publicProfile"`
	PrivateBrief     string            `json:"privateBrief"`
	SecretConditions []SecretCondition `json:"secretConditions"`
}

// NPCKnowledge is one piece of information an NPC holds, revealed only when
// players ask the right questions (host reference / AI roleplay material).
type NPCKnowledge struct {
	Topic      string `json:"topic"`
	Info       string `json:"info"`
	RevealWhen string `json:"revealWhen"`
}

// NPC is an interviewee played by the host (or AI) in hearing-type scenarios.
type NPC struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Title     string         `json:"title"`
	Icon      string         `json:"icon"`
	Opening   string         `json:"opening"`
	Knowledge []NPCKnowledge `json:"knowledge"`
}

// HiddenRequirement is a requirement players must discover through questioning.
type HiddenRequirement struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	JudgeHint string `json:"judgeHint"`
}

// ScriptedEvent is a pre-written mid-game event the host fires at will.
type ScriptedEvent struct {
	ID     string `json:"id"`
	Timing string `json:"timing"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}

// TestCase is one operation-simulation case run against the final spec.
type TestCase struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Situation  string `json:"situation"`
	CheckPoint string `json:"checkPoint"`
}

// RubricItem is one scoring category with its weight.
type RubricItem struct {
	Name        string `json:"name"`
	Max         int    `json:"max"`
	Description string `json:"description"`
}

// TitleAwardDef is a bonus title the AI can award to a player.
type TitleAwardDef struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// DocTemplateSection defines one editable section of the requirements doc.
type DocTemplateSection struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Placeholder string `json:"placeholder"`
}

// Scenario is a full game scenario definition.
//
// Type "stakeholder": players are client-side stakeholders with hidden win
// conditions. Type "hearing": players are the development team interviewing
// NPCs (played by host/AI) to discover hidden requirements; the final spec is
// stress-tested with TestCases. Empty Type means "stakeholder".
type Scenario struct {
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
	DocTemplate []DocTemplateSection `json:"docTemplate"`
	Roles       []Role               `json:"roles"`
	EventIdeas  []string             `json:"eventIdeas"`

	// hearing-type extensions (all optional)
	NPCs               []NPC               `json:"npcs"`
	HiddenRequirements []HiddenRequirement `json:"hiddenRequirements"`
	ScriptedEvents     []ScriptedEvent     `json:"scriptedEvents"`
	TestCases          []TestCase          `json:"testCases"`
	Rubric             []RubricItem        `json:"rubric"`
	Titles             []TitleAwardDef     `json:"titles"`
}

func (s *Scenario) NPCByID(id string) *NPC {
	for i := range s.NPCs {
		if s.NPCs[i].ID == id {
			return &s.NPCs[i]
		}
	}
	return nil
}

func (s *Scenario) RoleByID(id string) *Role {
	for i := range s.Roles {
		if s.Roles[i].ID == id {
			return &s.Roles[i]
		}
	}
	return nil
}

// ScenarioSummary is the public listing entry (no secrets).
type ScenarioSummary struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Title      string `json:"title"`
	Tagline    string `json:"tagline"`
	ClientName string `json:"clientName"`
	Industry   string `json:"industry"`
	MaxPlayers int    `json:"maxPlayers"`
}

// LoadScenarios loads all scenario JSON files from the embedded FS, then
// overlays any *.json files found in overrideDir (allowing users to add or
// replace scenarios without rebuilding).
func LoadScenarios(embedded fs.FS, overrideDir string) (map[string]*Scenario, error) {
	out := map[string]*Scenario{}

	load := func(data []byte, src string) error {
		var sc Scenario
		if err := json.Unmarshal(data, &sc); err != nil {
			return fmt.Errorf("%s: %w", src, err)
		}
		if sc.ID == "" {
			return fmt.Errorf("%s: scenario id is empty", src)
		}
		out[sc.ID] = &sc
		return nil
	}

	entries, err := fs.ReadDir(embedded, ".")
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := fs.ReadFile(embedded, e.Name())
		if err != nil {
			return nil, err
		}
		if err := load(data, e.Name()); err != nil {
			return nil, err
		}
	}

	if overrideDir != "" {
		if files, err := filepath.Glob(filepath.Join(overrideDir, "*.json")); err == nil {
			for _, f := range files {
				data, err := os.ReadFile(f)
				if err != nil {
					continue
				}
				if err := load(data, f); err != nil {
					fmt.Fprintf(os.Stderr, "scenario override skipped: %v\n", err)
				}
			}
		}
	}

	if len(out) == 0 {
		return nil, fmt.Errorf("no scenarios loaded")
	}
	return out, nil
}

func Summaries(scenarios map[string]*Scenario) []ScenarioSummary {
	list := make([]ScenarioSummary, 0, len(scenarios))
	for _, sc := range scenarios {
		list = append(list, ScenarioSummary{
			ID:         sc.ID,
			Type:       sc.Type,
			Title:      sc.Title,
			Tagline:    sc.Tagline,
			ClientName: sc.ClientName,
			Industry:   sc.Industry,
			MaxPlayers: len(sc.Roles),
		})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	return list
}
