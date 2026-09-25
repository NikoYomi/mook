package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"mook/auth"
	"mook/config"
	"mook/database"
)

// 登录限流参数。密码最小长度不在此处，见 auth.MinPasswordLen（跨包共用，避免多处硬编码漂移）。
const (
	maxLoginFails = 5
	lockoutDur    = 15 * time.Minute

	// sweepInterval 清理过期限流桶的最小间隔，避免每次请求都全量遍历 map
	sweepInterval = 1 * time.Minute
)

type loginBucket struct {
	fails int
	until time.Time // 零值表示尚未进入锁定
	last  time.Time // 最后一次失败时间，用于回收
}

var (
	loginMu    sync.Mutex
	loginFails = map[string]*loginBucket{}
	lastSweep  time.Time
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
		if len(req.Password) < auth.MinPasswordLen {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("密码至少 %d 位", auth.MinPasswordLen))
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
		// 「是否已初始化」与「建用户」在同一事务内二次确认，避免并发重复初始化
		created, err := database.CreateFirstUser(db, "admin", hash)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "创建用户失败")
			return
		}
		if !created {
			writeErr(w, http.StatusForbidden, "系统已完成初始化")
			return
		}
		log.Println("[auth] 完成首次初始化（设置管理员密码）")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /api/login —— 登录（用户名 + 密码）
func handleLogin(db *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r, cfg.TrustProxy)
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
			log.Println("[auth] 登录失败：用户名或密码错误")
			writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
			return
		}
		noteLoginOK(ip)
		log.Println("[auth] 登录成功")
		if err := auth.CreateSession(db, w, r, u.ID); err != nil {
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

// sweepLocked 回收 lockoutDur 内已无活动的桶，防止 map 无上限增长。
// 调用方必须持有 loginMu。
func sweepLocked(now time.Time) {
	if !lastSweep.IsZero() && now.Sub(lastSweep) < sweepInterval {
		return
	}
	lastSweep = now
	for ip, b := range loginFails {
		if now.Sub(b.last) > lockoutDur {
			delete(loginFails, ip)
		}
	}
}

func allowLogin(ip string) bool {
	now := time.Now()
	loginMu.Lock()
	defer loginMu.Unlock()
	sweepLocked(now)

	b, ok := loginFails[ip]
	if !ok {
		return true
	}
	// until 非零才表示已进入锁定。注意零值 time.Time 参与 After 比较恒为真，
	// 若直接写 now.After(b.until)，未锁定的桶会被每次尝试清掉，计数永远到不了阈值。
	if !b.until.IsZero() {
		if now.Before(b.until) {
			return false
		}
		// 锁定期已过：重置该 IP 的计数
		delete(loginFails, ip)
		return true
	}
	return b.fails < maxLoginFails
}

func noteLoginFail(ip string) {
	now := time.Now()
	loginMu.Lock()
	defer loginMu.Unlock()
	sweepLocked(now)

	b, ok := loginFails[ip]
	if !ok {
		b = &loginBucket{}
		loginFails[ip] = b
	}
	b.fails++
	b.last = now
	if b.fails >= maxLoginFails {
		b.until = now.Add(lockoutDur)
	}
}

func noteLoginOK(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	delete(loginFails, ip)
}

// clientIP 解析客户端 IP。
// 仅当显式启用可信代理（MOOK_TRUST_PROXY）时才采信 X-Forwarded-For；
// 否则一律使用直连地址 —— 该头可被任意伪造，无条件信任会让按 IP 的限流形同虚设。
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if first := strings.TrimSpace(strings.Split(xff, ",")[0]); first != "" {
				return first
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}