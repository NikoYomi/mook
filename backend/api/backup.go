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
func exportBackup(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload := buildBackup(db, secret)
		log.Printf("[backup] 导出备份（%d 台服务器、%d 条常用命令）", len(payload.Servers), len(payload.CommonCommands))
		writeJSON(w, http.StatusOK, payload)
	}
}

// POST /api/backup/export —— 导出加密备份：整包数据用口令加密后再返回
func exportBackupEncrypted(db *sql.DB, secret string) http.HandlerFunc {
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
		payload := buildBackup(db, secret)
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
// 凭据：把服务端密文解密为明文放入备份（PasswordEnc → Password），
// 使备份在任意环境还原后都能用当前 secret 重新加密，不依赖导出环境的密钥。
func buildBackup(db *sql.DB, secret string) BackupPayload {
	servers, _ := database.ListServers(db)
	for _, s := range servers {
		if p, err := utils.Decrypt(secret, s.PasswordEnc); err == nil {
			s.Password = p
		}
		if k, err := utils.Decrypt(secret, s.PrivateKeyEnc); err == nil {
			s.PrivateKey = k
		}
		s.PasswordEnc = ""
		s.PrivateKeyEnc = ""
	}
	settings := map[string]string{}
	for _, key := range backupSettingsKeys {
		v, _ := database.GetSetting(db, key)
		if v != "" {
			settings[key] = v
		}
	}
	// AI 密钥解密为明文，随备份跨环境还原（与服务器凭据同理）
	decryptAISettings(settings, secret)
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
				writeErr(w, http.StatusBadRequest, "备份密码错误，请重新输入")
				return
			}
			plain = []byte(pt)
		}
		var in BackupPayload
		if err := json.Unmarshal(plain, &in); err != nil {
			writeErr(w, http.StatusBadRequest, "备份文件已损坏或不是有效的 Mook 备份")
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
			// 备份内是明文凭据（buildBackup 解密填充），还原时用当前 secret 重新加密，
			// 使备份可在任意环境还原，不依赖导出环境的密钥。
			if s.Password != "" {
				enc, err := utils.Encrypt(secret, s.Password)
				if err != nil {
					writeErr(w, http.StatusInternalServerError, "还原服务器密码失败："+err.Error())
					return
				}
				s.PasswordEnc = enc
			}
			if s.PrivateKey != "" {
				enc, err := utils.Encrypt(secret, s.PrivateKey)
				if err != nil {
					writeErr(w, http.StatusInternalServerError, "还原服务器私钥失败："+err.Error())
					return
				}
				s.PrivateKeyEnc = enc
			}
			// 兼容旧版备份：可能只有密文（password_enc）没有明文，原样保留
			if _, err := database.CreateServer(db, s); err != nil {
				writeErr(w, http.StatusInternalServerError, "还原服务器失败："+err.Error())
				return
			}
			restored++
		}
		for key, val := range in.Settings {
			for _, allowed := range backupSettingsKeys {
				if key == allowed {
					val = reencryptAISetting(secret, key, val)
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

// decryptAISettings 把备份设置中的 AI 密钥从服务端密文解密为明文，
// 供跨环境还原（导出时调用）。
func decryptAISettings(settings map[string]string, secret string) {
	for _, key := range []string{keyAIAPIKey} {
		if enc := settings[key]; enc != "" {
			if pt, err := utils.Decrypt(secret, enc); err == nil {
				settings[key] = pt
			}
		}
	}
	// ai_provider_keys 为 map[base_url]→密文
	if raw := settings[keyAIProviderKeys]; raw != "" {
		m := map[string]string{}
		if json.Unmarshal([]byte(raw), &m) == nil {
			changed := false
			for k, enc := range m {
				if pt, err := utils.Decrypt(secret, enc); err == nil {
					m[k] = pt
					changed = true
				}
			}
			if changed {
				if b, err := json.Marshal(m); err == nil {
					settings[keyAIProviderKeys] = string(b)
				}
			}
		}
	}
}

// reencryptAISetting 还原备份设置时，把 AI 密钥统一转换为当前 secret 的密文。
// 兼容两种备份形态：
//   - 新格式：值为明文（buildBackup 已解密）→ 用当前 secret 加密；
//   - 旧格式：值已是密文 → 若能被当前 secret 解密（同 secret 场景）则原样保留，否则原样保留（无法转换）。
func reencryptAISetting(secret, key, val string) string {
	switch key {
	case keyAIAPIKey:
		if _, err := utils.Decrypt(secret, val); err == nil {
			return val // 已是当前 secret 密文（旧版备份），保留
		}
		if enc, err := utils.Encrypt(secret, val); err == nil {
			return enc // 明文 → 加密
		}
	case keyAIProviderKeys:
		m := map[string]string{}
		if json.Unmarshal([]byte(val), &m) == nil {
			changed := false
			for k, v := range m {
				if _, err := utils.Decrypt(secret, v); err == nil {
					m[k] = v // 已是当前 secret 密文，保留
					changed = true
				} else if enc, err := utils.Encrypt(secret, v); err == nil {
					m[k] = enc // 明文 → 加密
					changed = true
				}
			}
			if changed {
				if b, err := json.Marshal(m); err == nil {
					return string(b)
				}
			}
		}
	}
	return val
}
