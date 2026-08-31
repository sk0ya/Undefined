package game

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// LAN use: allow all origins (host PC IP varies)
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client is one websocket connection.
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	PlayerID string // "" until joined (or host)
	IsHost   bool
	joined   bool
}

// Hub manages all websocket clients for the single game room.
type Hub struct {
	mu      sync.Mutex
	clients map[*Client]bool
	game    *Game
	hostKey string
}

func NewHub(g *Game, hostKey string) *Hub {
	h := &Hub{clients: map[*Client]bool{}, game: g, hostKey: hostKey}
	g.SetOnChange(h.Broadcast)
	return h
}

func (h *Hub) Game() *Game { return h.game }

// Broadcast sends each connected, joined client its personalized snapshot.
func (h *Hub) Broadcast() {
	h.mu.Lock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		if c.joined {
			clients = append(clients, c)
		}
	}
	h.mu.Unlock()

	h.game.Mu.Lock()
	type payload struct {
		c   *Client
		msg []byte
	}
	payloads := make([]payload, 0, len(clients))
	for _, c := range clients {
		snap := h.game.BuildSnapshot(c.PlayerID, c.IsHost)
		data, err := json.Marshal(map[string]any{"type": "state", "state": snap})
		if err != nil {
			continue
		}
		payloads = append(payloads, payload{c, data})
	}
	h.game.Mu.Unlock()

	for _, p := range payloads {
		select {
		case p.c.send <- p.msg:
		default: // slow client; drop connection
			p.c.conn.Close()
		}
	}
}

func (h *Hub) sendTo(c *Client, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

func (h *Hub) sendError(c *Client, msg string) {
	h.sendTo(c, map[string]any{"type": "error", "message": msg})
}

func (h *Hub) sendState(c *Client) {
	h.game.Mu.Lock()
	snap := h.game.BuildSnapshot(c.PlayerID, c.IsHost)
	h.game.Mu.Unlock()
	h.sendTo(c, map[string]any{"type": "state", "state": snap})
}

// ServeWS upgrades the connection and starts pumps.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, 64)}
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	go c.writePump()
	go c.readPump()
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 70 * time.Second
	pingPeriod = 30 * time.Second
)

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.disconnect(c)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(64 * 1024)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		c.hub.handleMessage(c, data)
	}
}

func (h *Hub) disconnect(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()

	if c.PlayerID != "" {
		h.game.Mu.Lock()
		// only mark disconnected if no other connection uses the same player
		stillConnected := false
		h.mu.Lock()
		for other := range h.clients {
			if other.PlayerID == c.PlayerID {
				stillConnected = true
			}
		}
		h.mu.Unlock()
		if !stillConnected {
			if p, ok := h.game.Players[c.PlayerID]; ok {
				p.Connected = false
			}
		}
		h.game.Mu.Unlock()
		h.Broadcast()
	}
}
