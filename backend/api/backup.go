package api

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"mook/database"
)

// GET /api/backup —— 导出备份（服务器配置 + AI 设置；凭据为服务端加密密文）
func exportBackup(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		servers, err := database.ListServers(db)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取服务器失败")
			return
		}
		settings := map[string]string{}
		for _, key := range []string{keyAIBaseURL, keyAIModel, keyAIAPIKey, keyAIValidated} {
			v, _ := database.GetSetting(db, key)
			if v != "" {
				settings[key] = v
			}
		}
		cmds, err := database.ListCommonCommands(db)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取常用命令失败")
			return
		}
		log.Printf("[backup] 导出备份（%d 台服务器、%d 条常用命令）", len(servers), len(cmds))
		writeJSON(w, http.StatusOK, map[string]any{
			"version":         1,
			"exported_at":     time.Now().Format(time.RFC3339),
			"servers":         servers,
			"settings":        settings,
			"common_commands": cmds,
		})
	}
}

// POST /api/backup/restore —— 还原备份（服务器清空后重建；设置覆盖）
func restoreBackup(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Version        int                       `json:"version"`
			Servers        []*database.Server        `json:"servers"`
			Settings       map[string]string         `json:"settings"`
			CommonCommands []database.CommonCommand  `json:"common_commands"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "备份文件格式错误")
			return
		}
		if in.Version != 1 {
			writeErr(w, http.StatusBadRequest, "不支持的备份版本")
			return
		}
		if err := database.ClearServers(db); err != nil {
			writeErr(w, http.StatusInternalServerError, "清空服务器失败")
			return
		}
		restored := 0
		for _, s := range in.Servers {
			if s == nil || s.Name == "" || s.Host == "" {
				continue
			}
			if _, err := database.CreateServer(db, s); err != nil {
				writeErr(w, http.StatusInternalServerError, "还原服务器失败："+err.Error())
				return
			}
			restored++
		}
		for key, val := range in.Settings {
			switch key {
			case keyAIBaseURL, keyAIModel, keyAIAPIKey, keyAIValidated:
				_ = database.SetSetting(db, key, val)
			}
		}
		log.Printf("[backup] 还原备份（%d 台服务器）", restored)
		if in.CommonCommands != nil {
			if err := database.ReplaceCommonCommands(db, in.CommonCommands); err != nil {
				writeErr(w, http.StatusInternalServerError, "还原常用命令失败")
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "servers_restored": restored})
	}
}