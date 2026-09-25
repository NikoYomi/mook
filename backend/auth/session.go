package auth

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"mook/database"
	"mook/utils"
)

const (
	// CookieName 会话 Cookie 名称
	CookieName = "mook_session"
	// SessionTTL 会话有效期（6 小时）
	SessionTTL = 6 * time.Hour
)

type ctxKey struct{}

// isSecureRequest 判断当前请求是否经 HTTPS 到达：直接 TLS 或反向代理声明的
// X-Forwarded-Proto: https 任一成立即可。
// 该判断只会「多加」Secure 标志，最坏情况是 Cookie 不被浏览器接受，
// 不会放松任何限制，因此可以安全地采信代理头。
func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

// CreateSession 创建会话并写入 Cookie
func CreateSession(db *sql.DB, w http.ResponseWriter, r *http.Request, userID int64) error {
	token, err := utils.RandomHex(32)
	if err != nil {
		return err
	}
	if err := database.CreateSession(db, token, userID, SessionTTL); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(SessionTTL.Seconds()),
	})
	return nil
}

// DestroySession 删除会话并清除 Cookie
func DestroySession(db *sql.DB, w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil {
		_ = database.DeleteSession(db, c.Value)
	}
	// Secure 需与创建时一致：否则 HTTPS 下浏览器可能拒绝这条删除指令，导致退出登录不生效
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: isSecureRequest(r), MaxAge: -1,
	})
}

// CurrentUser 从请求上下文获取当前用户
func CurrentUser(r *http.Request) *database.User {
	u, _ := r.Context().Value(ctxKey{}).(*database.User)
	return u
}

// RequireAuth 登录鉴权中间件
func RequireAuth(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(CookieName)
			if err != nil {
				writeUnauthorized(w)
				return
			}
			u, err := database.GetUserByToken(db, c.Value)
			if err != nil {
				writeUnauthorized(w)
				return
			}
			ctx := context.WithValue(r.Context(), ctxKey{}, u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"请先登录"}`))
}