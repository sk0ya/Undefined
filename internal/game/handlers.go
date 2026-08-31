package game

import (
	"encoding/json"
	"log"
)

// inbound message envelope — fields are a union across all message types.
type inMsg struct {
	Type string `json:"type"`

	// join
	Name    string `json:"name"`
	Token   string `json:"token"`
	AsHost  bool   `json:"asHost"`
	HostKey string `json:"hostKey"`

	// start / phase
	ScenarioID string `json:"scenarioId"`
	Phase      string `json:"phase"`

	// proposals
	ID          string `json:"id"`
	Category    string `json:"category"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ProposalID  string `json:"proposalId"`
	Value       string `json:"value"`
	Status      string `json:"status"`

	// doc
	SectionID string `json:"sectionId"`
	Content   string `json:"content"`
	RoomID    string `json:"roomId"`

	// timer
	Action  string `json:"action"`
	Seconds int    `json:"seconds"`

	// announce
	Body string `json:"body"`

	// kick
	PlayerID string `json:"playerId"`
}

func (h *Hub) handleMessage(c *Client, data []byte) {
	var m inMsg
	if err := json.Unmarshal(data, &m); err != nil {
		h.sendError(c, "不正なメッセージ形式です")
		return
	}

	if m.Type == "join" {
		h.handleJoin(c, &m)
		return
	}
	if !c.joined {
		h.sendError(c, "先にjoinしてください")
		return
	}

	g := h.game
	var err error
	changed := true

	g.Mu.Lock()
	switch m.Type {
	case "start_game":
		if !c.IsHost {
			err = errNotHost
		} else {
			err = g.Start(m.ScenarioID)
		}
	case "set_phase":
		if !c.IsHost {
			err = errNotHost
		} else {
			err = g.SetPhase(Phase(m.Phase))
		}
	case "next_phase":
		if !c.IsHost {
			err = errNotHost
		} else {
			err = g.NextPhase()
		}
	case "reset_game":
		if !c.IsHost {
			err = errNotHost
		} else {
			g.Reset()
		}
	case "propose":
		_, err = g.Propose(c.PlayerID, m.Category, m.Title, m.Description)
	case "update_proposal":
		err = g.UpdateProposal(c.PlayerID, m.ID, m.Category, m.Title, m.Description, c.IsHost)
	case "delete_proposal":
		err = g.DeleteProposal(c.PlayerID, m.ID, c.IsHost)
	case "vote":
		err = g.Vote(c.PlayerID, m.ProposalID, VoteValue(m.Value))
	case "set_proposal_status":
		if !c.IsHost {
			err = errNotHost
		} else {
			err = g.SetProposalStatus(m.ID, ProposalStatus(m.Status))
		}
	case "edit_doc":
		roomID := m.RoomID
		if !c.IsHost {
			if room := g.RoomOf(c.PlayerID); room != nil {
				roomID = room.ID
			}
		} else if roomID == "" && len(g.Rooms) == 1 {
			roomID = g.Rooms[0].ID
		}
		err = g.EditDoc(roomID, m.SectionID, m.Content, c.IsHost)
	case "timer":
		if !c.IsHost {
			err = errNotHost
		} else {
			err = g.TimerAction(m.Action, m.Seconds)
		}
	case "announce":
		if !c.IsHost {
			err = errNotHost
		} else {
			g.Announce(m.Title, m.Body)
		}
	case "remove_player":
		if !c.IsHost {
			err = errNotHost
		} else {
			g.RemovePlayer(m.PlayerID)
		}
	default:
		changed = false
	}
	g.Mu.Unlock()

	if err != nil {
		h.sendError(c, err.Error())
		return
	}
	if changed {
		h.Broadcast()
	}
}

var errNotHost = errHost("ホストのみ実行できる操作です")

type errHost string

func (e errHost) Error() string { return string(e) }

func (h *Hub) handleJoin(c *Client, m *inMsg) {
	g := h.game

	if m.AsHost {
		if h.hostKey != "" && m.HostKey != h.hostKey {
			h.sendError(c, "ホストキーが正しくありません")
			return
		}
		c.IsHost = true
		c.joined = true
		h.sendTo(c, map[string]any{"type": "joined", "isHost": true})
		h.sendState(c)
		return
	}

	g.Mu.Lock()
	p, isNew, err := g.Join(m.Name, m.Token)
	if err == nil {
		p.Connected = true
	}
	var token string
	if p != nil {
		token = g.PlayerToken(p)
	}
	g.Mu.Unlock()

	if err != nil {
		h.sendError(c, err.Error())
		return
	}
	c.PlayerID = p.ID
	c.joined = true
	h.sendTo(c, map[string]any{"type": "joined", "playerId": p.ID, "token": token})
	if isNew {
		log.Printf("player joined: %s (%s)", p.Name, p.ID)
	}
	h.Broadcast()
}
