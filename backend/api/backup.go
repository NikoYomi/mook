package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"mook/database"
	"mook/utils"
)

// backupSettingsKeys 导出/还原允许携带的全部设置项
var backupSettingsKeys = []string{keyAIBaseURL, keyAIModel, keyAIAPIKey, keyAIValidated, keyCustomProviders, keyAIProviderKeys}

// GET /api/backup —— 导出备份（服务器配置 + AI 设置；凭据为服务端加密密文）
func exportBackup(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload := buildBackup(db)
		log.Printf("[backup] 导出备份（%d 台服务器、%d 条常用命令）", len(payload.Servers), len(payload.CommonCommands))
		writeJSON(w, http.StatusOK, payload)
	}
}

// POST /api/backup/export —— 导出加密备份：整包数据用口令加密后再返回
func exportBackupEncrypted(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if len(in.Password) < 6 {
			writeErr(w, http.StatusBadRequest, "备份密码至少 6 位")
			return
		}
		payload := buildBackup(db)
		raw, err := json.Marshal(payload)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "序列化备份失败")
			return
		}
		enc, err := utils.EncryptWithPassword(in.Password, string(raw))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "备份加密失败")
			return
		}
		log.Printf("[backup] 导出加密备份（%d 台服务器、%d 条常用命令）", len(payload.Servers), len(payload.CommonCommands))
		writeJSON(w, http.StatusOK, map[string]any{"data": enc})
	}
}

// buildBackup 组装备份数据（服务器 + 设置 + 常用命令）
func buildBackup(db *sql.DB) BackupPayload {
	servers, _ := database.ListServers(db)
	settings := map[string]string{}
	for _, key := range backupSettingsKeys {
		v, _ := database.GetSetting(db, key)
		if v != "" {
			settings[key] = v
		}
	}
	cmds, _ := database.ListCommonCommands(db)
	return BackupPayload{
		Version:        1,
		ExportedAt:     time.Now().Format(time.RFC3339),
		Servers:        servers,
		Settings:       settings,
		CommonCommands: cmds,
	}
}

type BackupPayload struct {
	Version        int                      `json:"version"`
	ExportedAt     string                   `json:"exported_at"`
	Servers        []*database.Server       `json:"servers"`
	Settings       map[string]string        `json:"settings"`
	CommonCommands []database.CommonCommand `json:"common_commands"`
}

// POST /api/backup/restore —— 还原备份（服务器清空后重建；设置覆盖）
// 支持两种请求体：加密版 {password, data} 与旧版明文 {version, servers, settings, common_commands}
func restoreBackup(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Password string `json:"password"`
			Data     string `json:"data"`
		}
		body, err := decodeBody(r)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "备份文件格式错误")
			return
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeErr(w, http.StatusBadRequest, "备份文件格式错误")
			return
		}
		plain := body
		if req.Data != "" {
			if req.Password == "" {
				writeErr(w, http.StatusBadRequest, "请输入备份密码")
				return
			}
			pt, err := utils.DecryptWithPassword(req.Password, req.Data)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "备份密码错误或文件已损坏")
				return
			}
			plain = []byte(pt)
		}
		var in BackupPayload
		if err := json.Unmarshal(plain, &in); err != nil {
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
			for _, allowed := range backupSettingsKeys {
				if key == allowed {
					_ = database.SetSetting(db, key, val)
					break
				}
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

func decodeBody(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
