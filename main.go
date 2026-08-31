// 要件定義ゲーム — LAN上でホストPCに接続して遊ぶ要件定義ワークショップゲーム。
//
// 使い方:
//
//	go build -o reqgame.exe . && ./reqgame.exe
//
// 環境変数:
//
//	PORT        リッスンポート (default 80 8080)
//	HOST_KEY    ホスト画面の合言葉 (未設定なら誰でもホストになれる)
//	AI_API_KEY  OpenAI互換APIキー (未設定なら手動コピペモード)
//	AI_BASE_URL APIベースURL (default https://api.openai.com/v1)
//	AI_MODEL    モデル名 (default gpt-5-mini)
package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"reqgame/internal/ai"
	"reqgame/internal/game"
)

//go:embed all:web/dist
var webFS embed.FS

//go:embed scenarios/*.json
var scenarioFS embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	hostKey := os.Getenv("HOST_KEY")
	aiCfg := ai.ConfigFromEnv()

	scenarioSub, _ := fs.Sub(scenarioFS, "scenarios")
	scenarios, err := game.LoadScenarios(scenarioSub, "scenarios")
	if err != nil {
		log.Fatalf("シナリオ読み込み失敗: %v", err)
	}

	g := game.NewGame(scenarios)
	hub := game.NewHub(g, hostKey)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.ServeWS)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "aiEnabled": aiCfg.Enabled(), "aiModel": aiCfg.Model})
	})
	mux.HandleFunc("/api/ai", requireHost(hostKey, aiHandler(g, aiCfg, hub)))
	mux.HandleFunc("/api/ai/apply", requireHost(hostKey, aiApplyHandler(g, hub)))

	// static files (React build)
	dist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatalf("web/dist: %v", err)
	}
	fileServer := http.FileServer(http.FS(dist))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if f, err := dist.Open(p); err == nil {
				f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// SPA fallback ("/", "/host", unknown routes)
		data, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			http.Error(w, "index.html not found — run `npm run build` in web/ first", 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})

	addr := ":" + port
	fmt.Println("──────────────────────────────────────────────")
	fmt.Println("  要件定義ゲーム サーバー起動")
	fmt.Println("──────────────────────────────────────────────")
	for _, ip := range lanIPs() {
		fmt.Printf("  プレイヤー用URL:  http://%s:%s/\n", ip, port)
		fmt.Printf("  ホスト用URL:      http://%s:%s/host\n", ip, port)
	}
	fmt.Printf("  (このPC上では http://localhost:%s/host )\n", port)
	if hostKey != "" {
		fmt.Println("  ホストキー: 設定済み(HOST_KEY)")
	} else {
		fmt.Println("  ホストキー: なし(/host は誰でも開けます)")
	}
	if aiCfg.Enabled() {
		fmt.Printf("  AI連携: 有効 (%s)\n", aiCfg.Model)
	} else {
		fmt.Println("  AI連携: 手動モード(プロンプトをChatGPT/Codexにコピペ)")
	}
	fmt.Println("──────────────────────────────────────────────")

	log.Fatal(http.ListenAndServe(addr, mux))
}

func lanIPs() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipnet.IP.To4()
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, ip.String())
		}
	}
	return out
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	writeJSON(w, map[string]string{"error": msg})
}

func requireHost(hostKey string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if hostKey != "" && r.Header.Get("X-Host-Key") != hostKey {
			writeErr(w, 403, "ホストキーが正しくありません")
			return
		}
		next(w, r)
	}
}

type aiRequest struct {
	Kind      string `json:"kind"`      // "score" | "event" | "advice" | "npc"
	Direction string `json:"direction"` // event用: 方向性の指示
	Question  string `json:"question"`  // advice/npc用
	NpcID     string `json:"npcId"`     // npc用
	RoomID    string `json:"roomId"`    // score必須 / advice任意
}

// aiHandler builds the prompt for the requested kind; if the AI API is
// configured it also calls it and applies the result to the game.
func aiHandler(g *game.Game, cfg ai.Config, hub *game.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "POSTのみ")
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		var req aiRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeErr(w, 400, "不正なリクエスト")
			return
		}

		g.Mu.Lock()
		var prompt string
		var err error
		switch req.Kind {
		case "score":
			prompt, err = ai.BuildScorePrompt(g, req.RoomID)
		case "event":
			prompt, err = ai.BuildEventPrompt(g, req.Direction)
		case "advice":
			prompt, err = ai.BuildAdvicePrompt(g, req.RoomID, req.Question)
		case "npc":
			prompt, err = ai.BuildNPCPrompt(g, req.NpcID, req.Question)
		default:
			err = fmt.Errorf("不正なkind: %s", req.Kind)
		}
		g.Mu.Unlock()
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}

		if !cfg.Enabled() {
			writeJSON(w, map[string]any{"mode": "manual", "prompt": prompt})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 170*time.Second)
		defer cancel()
		resp, err := cfg.Chat(ctx, prompt)
		if err != nil {
			// fall back to manual mode with the prompt so the host can still proceed
			writeJSON(w, map[string]any{"mode": "manual", "prompt": prompt, "error": err.Error()})
			return
		}

		applied, applyErr := applyAIResponse(g, hub, req.Kind, resp, req.RoomID)
		out := map[string]any{"mode": "auto", "prompt": prompt, "response": resp, "applied": applied}
		if applyErr != nil {
			out["error"] = applyErr.Error()
		}
		writeJSON(w, out)
	}
}

type aiApplyRequest struct {
	Kind   string `json:"kind"` // "score" | "event"
	Raw    string `json:"raw"`
	RoomID string `json:"roomId"` // score用
}

// aiApplyHandler applies a manually pasted LLM response.
func aiApplyHandler(g *game.Game, hub *game.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "POSTのみ")
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		var req aiApplyRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeErr(w, 400, "不正なリクエスト")
			return
		}
		applied, err := applyAIResponse(g, hub, req.Kind, req.Raw, req.RoomID)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, map[string]any{"applied": applied})
	}
}

func applyAIResponse(g *game.Game, hub *game.Hub, kind, raw, roomID string) (bool, error) {
	switch kind {
	case "score":
		sr, err := ai.ParseScoreResult(raw)
		if err != nil {
			return false, err
		}
		g.Mu.Lock()
		if roomID == "" && len(g.Rooms) == 1 {
			roomID = g.Rooms[0].ID
		}
		err = g.ApplyScore(roomID, sr)
		g.Mu.Unlock()
		if err != nil {
			return false, err
		}
		hub.Broadcast()
		return true, nil
	case "event":
		title, bodyText, err := ai.ParseEvent(raw)
		if err != nil {
			return false, err
		}
		g.Mu.Lock()
		g.Announce(title, bodyText)
		g.Mu.Unlock()
		hub.Broadcast()
		return true, nil
	case "advice", "npc":
		return false, nil // display-only
	default:
		return false, fmt.Errorf("不正なkind: %s", kind)
	}
}
