package auth

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"mook/database"
	"mook/utils"
)

const (
	// CookieName 会话 Cookie 名称
	CookieName = "mook_session"
	// SessionTTL 会话有效期（7 天）
	SessionTTL = 7 * 24 * time.Hour
)

type ctxKey struct{}

// CreateSession 创建会话并写入 Cookie
func CreateSession(db *sql.DB, w http.ResponseWriter, userID int64) error {
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
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", HttpOnly: true, MaxAge: -1,
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