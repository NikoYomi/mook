package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mook/database"
)

// agentScopeDef scope 的中文说明与是否「写」权限。
// 前端用它渲染勾选项；键的顺序即界面展示顺序。
type agentScopeDef struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Dangerous   bool   `json:"dangerous"` // 高危权限，界面需额外提示
}

var agentScopes = []agentScopeDef{
	{Key: "servers:read", Label: "查看服务器", Description: "列出服务器信息与实时状态（不含登录凭据）"},
	{Key: "servers:write", Label: "管理服务器", Description: "新增、修改、删除服务器配置"},
	{Key: "servers:exec", Label: "远程执行", Description: "在服务器上执行命令、读写文件", Dangerous: true},
	{Key: "commands:read", Label: "查看常用命令", Description: "读取已保存的常用命令"},
	{Key: "commands:write", Label: "管理常用命令", Description: "新增、修改、删除常用命令"},
}

func validScope(s string) bool {
	if s == "*" {
		return true
	}
	for _, d := range agentScopes {
		if d.Key == s {
			return true
		}
	}
	return false
}

// GET /api/keys/scopes —— 可授权的权限清单（供前端渲染）
func listKeyScopes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, agentScopes)
	}
}

// GET /api/keys —— 密钥列表（永不返回明文）
func listKeys(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		keys, err := database.ListAPIKeys(db)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取密钥失败")
			return
		}
		if keys == nil {
			keys = []*database.APIKey{}
		}
		writeJSON(w, http.StatusOK, keys)
	}
}

// POST /api/keys —— 新建密钥
// body: {"name":"Claude Desktop","scopes":["servers:read"],"expires_in_days":90}
// 响应里的 key 字段是本密钥唯一一次明文返回。
func createKey(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Name          string   `json:"name"`
			Scopes        []string `json:"scopes"`
			ExpiresInDays int      `json:"expires_in_days"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" {
			writeErr(w, http.StatusBadRequest, "请填写密钥名称")
			return
		}
		if len(in.Name) > 64 {
			writeErr(w, http.StatusBadRequest, "密钥名称过长（最多 64 字符）")
			return
		}
		if len(in.Scopes) == 0 {
			writeErr(w, http.StatusBadRequest, "请至少选择一项权限")
			return
		}
		scopes := make([]string, 0, len(in.Scopes))
		seen := map[string]bool{}
		for _, s := range in.Scopes {
			s = strings.TrimSpace(s)
			if s == "" || seen[s] {
				continue
			}
			if !validScope(s) {
				writeErr(w, http.StatusBadRequest, "未知的权限："+s)
				return
			}
			seen[s] = true
			scopes = append(scopes, s)
		}
		if len(scopes) == 0 {
			writeErr(w, http.StatusBadRequest, "请至少选择一项权限")
			return
		}
		if in.ExpiresInDays < 0 {
			in.ExpiresInDays = 0
		}
		var expiresAt time.Time
		if in.ExpiresInDays > 0 {
			expiresAt = time.Now().AddDate(0, 0, in.ExpiresInDays)
		}

		key, plaintext, err := database.CreateAPIKey(db, in.Name, scopes, expiresAt)
		if err != nil {
			log.Printf("[keys] 创建密钥失败")
			writeErr(w, http.StatusInternalServerError, "创建密钥失败："+err.Error())
			return
		}
		// 只记名称与 id，不记密钥本身
		log.Printf("[keys] 创建密钥 #%d %q（%d 项权限）", key.ID, key.Name, len(key.Scopes))
		writeJSON(w, http.StatusOK, map[string]any{
			"key":       key,
			"plaintext": plaintext, // 唯一一次返回明文
		})
	}
}

// POST /api/keys/{id}/revoke —— 撤销密钥
func revokeKey(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := keyIDFromPath(r)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "无效的密钥 ID")
			return
		}
		if err := database.RevokeAPIKey(db, id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				writeErr(w, http.StatusNotFound, "密钥不存在")
				return
			}
			writeErr(w, http.StatusInternalServerError, "撤销密钥失败")
			return
		}
		log.Printf("[keys] 撤销密钥 #%d", id)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// DELETE /api/keys/{id} —— 删除密钥
func deleteKey(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := keyIDFromPath(r)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "无效的密钥 ID")
			return
		}
		if err := database.DeleteAPIKey(db, id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				writeErr(w, http.StatusNotFound, "密钥不存在")
				return
			}
			writeErr(w, http.StatusInternalServerError, "删除密钥失败")
			return
		}
		log.Printf("[keys] 删除密钥 #%d", id)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func keyIDFromPath(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}
