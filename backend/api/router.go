package api

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"mook/auth"
	"mook/config"
	"mook/websocket"
)

// NewRouter 组装所有路由
func NewRouter(cfg *config.Config, db *sql.DB, secret string) http.Handler {
	mux := http.NewServeMux()
	authed := auth.RequireAuth(db)

	// ---- 无需登录 ----
	mux.HandleFunc("GET /api/setup/status", handleSetupStatus(db))
	mux.HandleFunc("POST /api/setup", handleSetup(db, cfg))
	mux.HandleFunc("POST /api/login", handleLogin(db))
	mux.HandleFunc("POST /api/logout", handleLogout(db))

	// ---- 需要登录 ----
	mux.Handle("GET /api/me", authed(http.HandlerFunc(handleMe(db))))
	mux.Handle("GET /api/servers", authed(http.HandlerFunc(listServers(db))))
	mux.Handle("POST /api/servers", authed(http.HandlerFunc(createServer(db, secret))))
	mux.Handle("PUT /api/servers/{id}", authed(http.HandlerFunc(updateServer(db, secret))))
	mux.Handle("DELETE /api/servers/{id}", authed(http.HandlerFunc(deleteServer(db))))
	mux.Handle("PUT /api/servers/reorder", authed(http.HandlerFunc(reorderServers(db))))
	mux.Handle("GET /api/servers/{id}/stats", authed(http.HandlerFunc(serverStatsHandler(db, secret))))
	mux.Handle("GET /api/commands", authed(http.HandlerFunc(getCommonCommands(db))))
	mux.Handle("PUT /api/commands", authed(http.HandlerFunc(saveCommonCommands(db))))
	mux.Handle("POST /api/commands/{id}/use", authed(http.HandlerFunc(useCommonCommand(db))))
	mux.Handle("GET /api/servers/{id}/files", authed(http.HandlerFunc(handleListFiles(db, secret))))
	mux.Handle("GET /api/servers/{id}/files/download", authed(http.HandlerFunc(handleDownloadFile(db, secret))))
	mux.Handle("POST /api/servers/{id}/files/upload", authed(http.HandlerFunc(handleUploadFile(db, secret))))
	mux.Handle("POST /api/servers/{id}/files/mkdir", authed(http.HandlerFunc(handleMkdir(db, secret))))
	mux.Handle("POST /api/servers/{id}/files/rename", authed(http.HandlerFunc(handleRename(db, secret))))
	mux.Handle("POST /api/servers/{id}/files/remove", authed(http.HandlerFunc(handleRemove(db, secret))))
	mux.Handle("GET /api/settings/ai", authed(http.HandlerFunc(getAiSettings(db, secret))))
	mux.Handle("POST /api/settings/ai", authed(http.HandlerFunc(saveAiSettings(db, secret))))
	mux.Handle("POST /api/ai/command", authed(http.HandlerFunc(aiCommand(db, secret))))
	mux.Handle("POST /api/ai/analyze", authed(http.HandlerFunc(aiAnalyze(db, secret))))
	mux.Handle("GET /api/ai/models", authed(http.HandlerFunc(listAIModels(db, secret))))
	mux.Handle("POST /api/me/username", authed(http.HandlerFunc(changeUsername(db))))
	mux.Handle("POST /api/me/verify-password", authed(http.HandlerFunc(verifyPassword(db))))
	mux.Handle("POST /api/me/password", authed(http.HandlerFunc(changePassword(db))))
	mux.Handle("GET /api/backup", authed(http.HandlerFunc(exportBackup(db, secret))))
	mux.Handle("POST /api/backup/export", authed(http.HandlerFunc(exportBackupEncrypted(db, secret))))
	mux.Handle("POST /api/backup/restore", authed(http.HandlerFunc(restoreBackup(db, secret))))
	mux.Handle("GET /ws/terminal", authed(http.HandlerFunc(websocket.HandleTerminal(db, secret))))

	// ---- 前端静态资源（SPA 回退）----
	mux.Handle("/", serveFrontend(cfg))

	// 访问日志（API 请求：方法/路径/状态/耗时；不含查询串与请求体）
	return logRequests(mux)
}

func serveFrontend(cfg *config.Config) http.Handler {
	dist := cfg.FrontendDir

	// 外部访问前缀：独立部署为 "/"，飞牛 fnOS 统一网关下为 "/app/mook/"
	baseHref := "/"
	if cfg.BasePath != "" {
		baseHref = cfg.BasePath + "/"
	}

	if _, err := os.Stat(dist); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			if r.URL.Path == "/" {
				_, _ = w.Write([]byte("Mook 后端已启动。前端尚未构建：请先运行 `npm run build`，或使用开发模式 `npm run dev`。"))
				return
			}
			http.NotFound(w, r)
		})
	}

	indexPath := filepath.Join(dist, "index.html")
	fileServer := http.FileServer(http.Dir(dist))

	// serveIndex 输出 index.html，并注入 <base> 标签。
	// 前端静态资源使用相对路径，API 与 WebSocket 通过 <base> 推导访问前缀，
	// 因此同一份构建产物既能跑在根路径，也能跑在统一网关的子路径下。
	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		raw, err := os.ReadFile(indexPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		html := strings.Replace(string(raw), "<head>", `<head>
    <base href="`+baseHref+`" />`, 1)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write([]byte(html))
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			serveIndex(w, r)
			return
		}
		if _, err := os.Stat(filepath.Join(dist, filepath.Clean(r.URL.Path))); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA 回退到 index.html
		serveIndex(w, r)
	})
}
