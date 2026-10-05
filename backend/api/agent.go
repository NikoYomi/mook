package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	xssh "golang.org/x/crypto/ssh"

	"mook/auth"
	"mook/database"
	sshx "mook/ssh"
	"mook/utils"
)

// maxAgentReadBytes 单次读取文件的字节上限。
// agent 场景下读文件是为了「看一眼」，不是传输大文件 —— 大文件应走 SFTP 下载。
const maxAgentReadBytes = 1 << 20 // 1 MiB

// defaultExecTimeout / maxExecTimeout 命令执行超时（秒）
const (
	defaultExecTimeout = 60
	maxExecTimeout     = 600
)

// logAgent 记录 agent 调用。
//
// 隐私约定（CLAUDE.md 第 5 条 / 项目「日志不含隐私」原则）：
// 只记 key id、方法、路径与状态码 —— 绝不记命令内容、主机地址、文件路径。
func logAgent(r *http.Request, status int) {
	key := auth.APIKeyFrom(r)
	id := int64(0)
	if key != nil {
		id = key.ID
	}
	log.Printf("[agent] key #%d %s %s -> %d", id, r.Method, r.URL.Path, status)
}

// agentServerJSON 返回给 agent 的服务器信息。
// 与前端一致：只暴露连接所需的非敏感字段，永不返回凭据。
type agentServerJSON struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Username string   `json:"username"`
	AuthType string   `json:"auth_type"`
	Tags     []string `json:"tags"`
}

func toAgentServer(s *database.Server) *agentServerJSON {
	tags := s.Tags
	if tags == nil {
		tags = []string{}
	}
	return &agentServerJSON{
		ID: s.ID, Name: s.Name, Host: s.Host, Port: s.Port,
		Username: s.Username, AuthType: s.AuthType, Tags: tags,
	}
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------

// GET /api/agent/servers —— 服务器列表
func agentListServers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := database.ListServers(db)
		if err != nil {
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "读取服务器失败")
			return
		}
		out := make([]*agentServerJSON, 0, len(rows))
		for _, s := range rows {
			out = append(out, toAgentServer(s))
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"servers": out, "count": len(out)})
	}
}

// GET /api/agent/servers/{id} —— 单台服务器详情（含实时状态）
func agentGetServer(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		s, err := database.GetServer(db, id)
		if err != nil {
			logAgent(r, http.StatusNotFound)
			writeErr(w, http.StatusNotFound, "服务器不存在")
			return
		}
		result := map[string]any{"server": toAgentServer(s)}

		// 顺带采集一次实时状态；采集失败不影响服务器信息的返回
		if client, err := dialServer(db, secret, id); err == nil {
			defer client.Close()
			if stats, err := collectStats(client, id, statScript); err == nil {
				result["stats"] = stats
			}
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, result)
	}
}

// POST /api/agent/servers —— 新增服务器
func agentCreateServer(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in ServerInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		s, err := buildServer(&in, secret, nil)
		if err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		created, err := database.CreateServer(db, s)
		if err != nil {
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "保存服务器失败")
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"server": toAgentServer(created)})
	}
}

// PUT /api/agent/servers/{id} —— 更新服务器
func agentUpdateServer(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		existing, err := database.GetServer(db, id)
		if err != nil {
			logAgent(r, http.StatusNotFound)
			writeErr(w, http.StatusNotFound, "服务器不存在")
			return
		}
		var in ServerInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		s, err := buildServer(&in, secret, existing)
		if err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := database.UpdateServer(db, s); err != nil {
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "更新服务器失败")
			return
		}
		updated, _ := database.GetServer(db, id)
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"server": toAgentServer(updated)})
	}
}

// DELETE /api/agent/servers/{id} —— 删除服务器
func agentDeleteServer(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		if err := database.DeleteServer(db, id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				logAgent(r, http.StatusNotFound)
				writeErr(w, http.StatusNotFound, "服务器不存在")
				return
			}
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "删除服务器失败")
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// 远程执行
// ---------------------------------------------------------------------------

// POST /api/agent/servers/{id}/exec —— 在服务器上执行命令
// body: {"command":"uptime","timeout_sec":60}
func agentExec(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		var in struct {
			Command    string `json:"command"`
			TimeoutSec int    `json:"timeout_sec"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		cmd := strings.TrimSpace(in.Command)
		if cmd == "" {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "命令不能为空")
			return
		}
		timeout := in.TimeoutSec
		if timeout <= 0 {
			timeout = defaultExecTimeout
		}
		if timeout > maxExecTimeout {
			timeout = maxExecTimeout
		}

		client, err := dialServer(db, secret, id)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "SSH 连接失败："+err.Error())
			return
		}
		defer client.Close()

		output, err := runCommandTimeout(client, cmd, timeout)
		if err != nil {
			// 命令本身失败（非零退出码）也把输出带回去，便于 agent 判断原因
			logAgent(r, http.StatusOK)
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":      false,
				"output":  output,
				"error":   err.Error(),
				"timeout": timeout,
			})
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"output":  output,
			"timeout": timeout,
		})
	}
}

// ---------------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------------

// GET /api/agent/servers/{id}/files?path=/ —— 列目录
func agentListFiles(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		dir := cleanRemotePath(r.URL.Query().Get("path"))
		sc, conn, err := dialSFTP(db, secret, id)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()

		entries, err := sc.ReadDir(dir)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "读取目录失败："+err.Error())
			return
		}
		out := make([]fileEntry, 0, len(entries))
		for _, e := range entries {
			out = append(out, fileEntry{
				Name:    e.Name(),
				Path:    joinRemote(dir, e.Name()),
				IsDir:   e.IsDir(),
				Size:    e.Size(),
				ModTime: e.ModTime().Format("2006-01-02 15:04"),
				Mode:    e.Mode().String(),
			})
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"path": dir, "entries": out})
	}
}

// GET /api/agent/servers/{id}/files/read?path=/etc/hostname —— 读文件
func agentReadFile(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		filePath := cleanRemotePath(r.URL.Query().Get("path"))
		sc, conn, err := dialSFTP(db, secret, id)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()

		info, err := sc.Stat(filePath)
		if err != nil {
			logAgent(r, http.StatusNotFound)
			writeErr(w, http.StatusNotFound, "文件不存在")
			return
		}
		if info.IsDir() {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "该路径是目录，请用列目录接口")
			return
		}

		f, err := sc.Open(filePath)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "打开文件失败："+err.Error())
			return
		}
		defer f.Close()

		// 多读 1 字节用于判断是否被截断
		data, err := io.ReadAll(io.LimitReader(f, maxAgentReadBytes+1))
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "读取文件失败："+err.Error())
			return
		}
		truncated := len(data) > maxAgentReadBytes
		if truncated {
			data = data[:maxAgentReadBytes]
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{
			"path":      filePath,
			"content":   string(data),
			"size":      info.Size(),
			"truncated": truncated,
		})
	}
}

// POST /api/agent/servers/{id}/files/write —— 写文件
// body: {"path":"/tmp/x","content":"..."}
func agentWriteFile(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := serverIDFromPath(r)
		if !ok {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		var in struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if strings.TrimSpace(in.Path) == "" {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请指定文件路径")
			return
		}
		filePath := cleanRemotePath(in.Path)

		sc, conn, err := dialSFTP(db, secret, id)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()

		f, err := sc.Create(filePath)
		if err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "创建文件失败："+err.Error())
			return
		}
		if _, err := f.Write([]byte(in.Content)); err != nil {
			f.Close()
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "写入文件失败："+err.Error())
			return
		}
		if err := f.Close(); err != nil {
			logAgent(r, http.StatusBadGateway)
			writeErr(w, http.StatusBadGateway, "写入文件失败："+err.Error())
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"path":     filePath,
			"bytes":    len(in.Content),
		})
	}
}

// ---------------------------------------------------------------------------
// 常用命令
// ---------------------------------------------------------------------------

// GET /api/agent/commands —— 常用命令列表
func agentListCommands(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := database.ListCommonCommands(db)
		if err != nil {
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "读取常用命令失败")
			return
		}
		if items == nil {
			items = []database.CommonCommand{}
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"commands": items, "count": len(items)})
	}
}

// POST /api/agent/commands —— 新增一条常用命令
func agentCreateCommand(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Name     string `json:"name"`
			Command  string `json:"command"`
			Category string `json:"category"`
			Pinned   bool   `json:"pinned"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		c := &database.CommonCommand{
			Name:     strings.TrimSpace(in.Name),
			Command:  strings.TrimSpace(in.Command),
			Category: strings.TrimSpace(in.Category),
			Pinned:   in.Pinned,
		}
		created, err := database.AddCommonCommand(db, c)
		if err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"command": created})
	}
}

// PUT /api/agent/commands/{id} —— 更新一条常用命令
func agentUpdateCommand(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.PathValue("id"))
		if id == "" {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的命令 ID")
			return
		}
		var in struct {
			Name     string `json:"name"`
			Command  string `json:"command"`
			Category string `json:"category"`
			Pinned   bool   `json:"pinned"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		updated, err := database.UpdateCommonCommand(db, id, &database.CommonCommand{
			Name:     strings.TrimSpace(in.Name),
			Command:  strings.TrimSpace(in.Command),
			Category: strings.TrimSpace(in.Category),
			Pinned:   in.Pinned,
		})
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				logAgent(r, http.StatusNotFound)
				writeErr(w, http.StatusNotFound, "命令不存在")
				return
			}
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "更新命令失败")
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"command": updated})
	}
}

// DELETE /api/agent/commands/{id} —— 删除一条常用命令
func agentDeleteCommand(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.PathValue("id"))
		if id == "" {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的命令 ID")
			return
		}
		if err := database.DeleteCommonCommand(db, id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				logAgent(r, http.StatusNotFound)
				writeErr(w, http.StatusNotFound, "命令不存在")
				return
			}
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "删除命令失败")
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /api/agent/commands/{id}/use —— 使用次数 +1
func agentUseCommand(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.PathValue("id"))
		if id == "" {
			logAgent(r, http.StatusBadRequest)
			writeErr(w, http.StatusBadRequest, "无效的命令 ID")
			return
		}
		if err := database.IncrementCommonCommandUsage(db, id); err != nil {
			logAgent(r, http.StatusInternalServerError)
			writeErr(w, http.StatusInternalServerError, "记录使用失败")
			return
		}
		logAgent(r, http.StatusOK)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// ---------------------------------------------------------------------------
// 复用的小工具
// ---------------------------------------------------------------------------

// dialServer 按服务器 id 新建一条 SSH 连接。
//
// 与 stats 的连接池刻意分开：agent 的执行命令/读写文件往往是「一次性、
// 长耗时」的，复用池会在超长命令上阻塞其他采集请求，也会让失效连接更难察觉。
func dialServer(db *sql.DB, secret string, serverID int64) (*xssh.Client, error) {
	row, err := database.GetServer(db, serverID)
	if err != nil {
		return nil, err
	}
	password, _ := utils.Decrypt(secret, row.PasswordEnc)
	privateKey, _ := utils.Decrypt(secret, row.PrivateKeyEnc)
	return sshx.Dial(sshx.Config{
		Host:       row.Host,
		Port:       row.Port,
		Username:   row.Username,
		Password:   password,
		PrivateKey: privateKey,
	})
}

// runCommandTimeout 在远端执行命令，超过 timeout 秒则中断。
// 无论成功失败都返回已产生的输出，方便调用方判断失败原因。
func runCommandTimeout(client *xssh.Client, cmd string, timeout int) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	type result struct {
		out string
		err error
	}
	done := make(chan result, 1)
	go func() {
		data, err := session.CombinedOutput(cmd)
		done <- result{string(data), err}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	select {
	case res := <-done:
		return res.out, res.err
	case <-ctx.Done():
		// 关闭会话会让阻塞中的 CombinedOutput 提前返回
		_ = session.Close()
		select {
		case res := <-done:
			return res.out, errors.New("命令执行超时")
		case <-time.After(2 * time.Second):
			return "", errors.New("命令执行超时")
		}
	}
}

// joinRemote 拼接远端路径（与前端列目录保持一致的 path.Join 语义）
func joinRemote(dir, name string) string {
	return path.Join(dir, name)
}
