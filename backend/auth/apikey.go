package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"mook/database"
)

// APIKeyHeader 外部 agent 携带密钥的请求头。
// 首选标准的 Authorization: Bearer，同时兼容 X-API-Key（部分 MCP 客户端更好配置）。
const (
	headerAuthorization = "Authorization"
	headerAPIKey        = "X-API-Key"
	bearerPrefix        = "Bearer "
)

// apiKeyCtxKey 与浏览器会话的 ctxKey 刻意区分：两种身份来源不应互相混淆，
// 避免 agent 请求被误当作已登录用户（或反之）。
type apiKeyCtxKey struct{}

// APIKeyFrom 从请求上下文取出已鉴权的密钥
func APIKeyFrom(r *http.Request) *database.APIKey {
	k, _ := r.Context().Value(apiKeyCtxKey{}).(*database.APIKey)
	return k
}

// extractAPIKey 从请求头提取明文密钥
func extractAPIKey(r *http.Request) string {
	if raw := strings.TrimSpace(r.Header.Get(headerAuthorization)); raw != "" {
		// 大小写不敏感地匹配 Bearer 前缀
		if len(raw) >= len(bearerPrefix) && strings.EqualFold(raw[:len(bearerPrefix)], bearerPrefix) {
			return strings.TrimSpace(raw[len(bearerPrefix):])
		}
	}
	return strings.TrimSpace(r.Header.Get(headerAPIKey))
}

// RequireAPIKey 外部 agent 鉴权中间件。
//
// 与 RequireAuth 并存而非替换：浏览器仍走会话 Cookie，agent 走 Bearer 密钥。
// scope 是本接口要求的最小权限，密钥需包含它（或持有 "*" 通配）。
func RequireAPIKey(db *sql.DB, scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			plaintext := extractAPIKey(r)
			if plaintext == "" {
				writeAPIError(w, http.StatusUnauthorized, "缺少 API 密钥")
				return
			}
			key, err := database.GetAPIKeyByHash(db, database.HashAPIKey(plaintext))
			if err != nil {
				// 不区分「不存在」与「摘要不匹配」，避免被用来探测密钥是否有效
				writeAPIError(w, http.StatusUnauthorized, "API 密钥无效")
				return
			}
			if key.Revoked {
				writeAPIError(w, http.StatusUnauthorized, "API 密钥已撤销")
				return
			}
			if !key.Valid() {
				writeAPIError(w, http.StatusUnauthorized, "API 密钥已过期")
				return
			}
			if scope != "" && !key.HasScope(scope) {
				writeAPIError(w, http.StatusForbidden, "密钥缺少权限："+scope)
				return
			}
			// 记录最后使用时间；失败不影响本次请求
			_ = database.TouchAPIKey(db, key.ID)

			ctx := context.WithValue(r.Context(), apiKeyCtxKey{}, key)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeAPIError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	body, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		body = []byte(`{"error":"请求失败"}`)
	}
	_, _ = w.Write(body)
}
