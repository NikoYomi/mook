package websocket

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	xssh "golang.org/x/crypto/ssh"

	"mook/database"
	sshx "mook/ssh"
	"mook/utils"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // 同源部署；开发模式下允许 Vite 跨源
	},
}

// wsMsg 浏览器 -> 服务端消息
type wsMsg struct {
	Type string `json:"type"` // input | resize
	Data string `json:"data"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

// HandleTerminal WebSocket 终端入口：GET /ws/terminal?serverId=1
func HandleTerminal(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, err := strconv.ParseInt(r.URL.Query().Get("serverId"), 10, 64)
		if err != nil {
			http.Error(w, "缺少有效的 serverId", http.StatusBadRequest)
			return
		}
		row, err := database.GetServer(db, serverID)
		if err != nil {
			http.Error(w, "服务器不存在", http.StatusNotFound)
			return
		}
		password, _ := utils.Decrypt(secret, row.PasswordEnc)
		privateKey, _ := utils.Decrypt(secret, row.PrivateKeyEnc)
		if row.AuthType == "password" && password == "" {
			http.Error(w, "该服务器未配置密码", http.StatusBadRequest)
			return
		}
		if row.AuthType == "key" && privateKey == "" {
			http.Error(w, "该服务器未配置私钥", http.StatusBadRequest)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		client, err := sshx.Dial(sshx.Config{
			Host:       row.Host,
			Port:       row.Port,
			Username:   row.Username,
			Password:   password,
			PrivateKey: privateKey,
		})
		if err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "SSH 连接失败：" + err.Error()})
			return
		}
		defer client.Close()

		session, err := client.NewSession()
		if err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "创建会话失败：" + err.Error()})
			return
		}
		defer session.Close()

		// 默认终端尺寸
		cols, rows := 80, 24
		modes := xssh.TerminalModes{
			xssh.ECHO:          1,
			xssh.TTY_OP_ISPEED: 14400,
			xssh.TTY_OP_OSPEED: 14400,
		}
		if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "申请终端失败：" + err.Error()})
			return
		}
		stdin, err := session.StdinPipe()
		if err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "初始化失败：" + err.Error()})
			return
		}
		stdout, err := session.StdoutPipe()
		if err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "初始化失败：" + err.Error()})
			return
		}
		stderr, err := session.StderrPipe()
		if err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "初始化失败：" + err.Error()})
			return
		}
		if err := session.Shell(); err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "启动 Shell 失败：" + err.Error()})
			return
		}

		// WebSocket 写入并发安全
		var writeMu sync.Mutex
		send := func(v any) {
			writeMu.Lock()
			defer writeMu.Unlock()
			_ = conn.WriteJSON(v)
		}

		// 服务端心跳，检测死连接
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				writeMu.Lock()
				err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
				writeMu.Unlock()
				if err != nil {
					return
				}
			}
		}()

		// SSH stdout -> 浏览器
		go func() {
			buf := make([]byte, 4096)
			for {
				n, err := stdout.Read(buf)
				if n > 0 {
					send(map[string]any{"type": "output", "data": string(buf[:n])})
				}
				if err != nil {
					send(map[string]any{"type": "closed", "reason": "SSH 会话已结束"})
					return
				}
			}
		}()
		// SSH stderr -> 浏览器
		go func() {
			buf := make([]byte, 4096)
			for {
				n, err := stderr.Read(buf)
				if n > 0 {
					send(map[string]any{"type": "output", "data": string(buf[:n])})
				}
				if err != nil {
					return
				}
			}
		}()

		// 浏览器 -> SSH（输入 / 调整尺寸）
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(120 * time.Second))
			return nil
		})
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			var m wsMsg
			if err := json.Unmarshal(data, &m); err != nil {
				continue
			}
			switch m.Type {
			case "input":
				_, _ = stdin.Write([]byte(m.Data))
			case "resize":
				if m.Cols > 0 && m.Rows > 0 {
					_ = session.WindowChange(m.Rows, m.Cols)
				}
			}
		}
	}
}