package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"mook/database"
)

// GET /api/commands —— 常用命令列表（持久化于 /data）
func getCommonCommands(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cmds, err := database.ListCommonCommands(db)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取常用命令失败")
			return
		}
		if cmds == nil {
			cmds = []database.CommonCommand{}
		}
		writeJSON(w, http.StatusOK, cmds)
	}
}

// PUT /api/commands —— 全量保存常用命令
func saveCommonCommands(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var items []database.CommonCommand
		if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		valid := make([]database.CommonCommand, 0, len(items))
		for _, c := range items {
			c.Name = strings.TrimSpace(c.Name)
			c.Command = strings.TrimSpace(c.Command)
			if c.Name == "" || c.Command == "" {
				continue
			}
			if c.ID == "" {
				c.ID = fmt.Sprintf("cmd-%d", time.Now().UnixNano())
			}
			valid = append(valid, c)
		}
		if err := database.ReplaceCommonCommands(db, valid); err != nil {
			writeErr(w, http.StatusInternalServerError, "保存常用命令失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
