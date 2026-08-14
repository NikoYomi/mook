package api

import (
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"mook/auth"
	"mook/config"
	"mook/database"
)

const (
	maxLoginFails = 5
	lockoutDur    = 15 * time.Minute
)

type loginBucket struct {
	fails int
	until time.Time
}

var (
	loginMu    sync.Mutex
	loginFails = map[string]*loginBucket{}
)

// GET /api/setup/status —— 是否需要进行首次初始化
func handleSetupStatus(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		n, err := database.CountUsers(db)
		writeJSON(w, http.StatusOK, map[string]any{
			"setup_required": err == nil && n == 0,
		})
	}
}

// POST /api/setup —— 首次设置管理员密码
func handleSetup(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		n, err := database.CountUsers(db)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取用户失败")
			return
		}
		if n > 0 {
			writeErr(w, http.StatusForbidden, "系统已完成初始化")
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if len(req.Password) < 6 {
			writeErr(w, http.StatusBadRequest, "密码至少 6 位")
			return
		}
		password := req.Password
		if cfg.Password != "" {
			password = cfg.Password
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "密码处理失败")
			return
		}
		if _, err := database.CreateUser(db, "admin", hash); err != nil {
			writeErr(w, http.StatusInternalServerError, "创建用户失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /api/login —— 登录（用户名 + 密码）
func handleLogin(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !allowLogin(ip) {
			writeErr(w, http.StatusTooManyRequests, "尝试次数过多，请 15 分钟后再试")
			return
		}
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		name := strings.TrimSpace(req.Username)
		var u *database.User
		var err error
		if name == "" {
			// 单密码登录：不区分用户名，直接以系统中的唯一用户校验
			u, err = database.GetFirstUser(db)
		} else {
			u, err = database.GetUserByUsername(db, name)
		}
		if err != nil || u == nil || !auth.CheckPassword(u.PasswordHash, req.Password) {
			noteLoginFail(ip)
			writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
			return
		}
		noteLoginOK(ip)
		if err := auth.CreateSession(db, w, u.ID); err != nil {
			writeErr(w, http.StatusInternalServerError, "创建会话失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "username": u.Username})
	}
}

// POST /api/logout —— 退出登录
func handleLogout(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth.DestroySession(db, w, r)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// GET /api/me —— 当前用户
func handleMe(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.CurrentUser(r)
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "请先登录")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"username": u.Username})
	}
}

// ---- 登录限流 ----
func allowLogin(ip string) bool {
	loginMu.Lock()
	defer loginMu.Unlock()
	b, ok := loginFails[ip]
	if !ok {
		return true
	}
	if time.Now().After(b.until) {
		delete(loginFails, ip)
		return true
	}
	return b.fails < maxLoginFails
}

func noteLoginFail(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	b, ok := loginFails[ip]
	if !ok {
		b = &loginBucket{}
		loginFails[ip] = b
	}
	b.fails++
	if b.fails >= maxLoginFails {
		b.until = time.Now().Add(lockoutDur)
	}
}

func noteLoginOK(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	delete(loginFails, ip)
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}