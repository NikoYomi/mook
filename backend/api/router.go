package api

import (
	"context"
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
	mux.HandleFunc("POST /api/login", handleLogin(db, cfg))
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

	// ---- 访问密钥管理（浏览器侧：仍需登录，用会话 Cookie）----
	mux.Handle("GET /api/keys/scopes", authed(http.HandlerFunc(listKeyScopes())))
	mux.Handle("GET /api/keys", authed(http.HandlerFunc(listKeys(db))))
	mux.Handle("POST /api/keys", authed(http.HandlerFunc(createKey(db))))
	mux.Handle("POST /api/keys/{id}/revoke", authed(http.HandlerFunc(revokeKey(db))))
	mux.Handle("DELETE /api/keys/{id}", authed(http.HandlerFunc(deleteKey(db))))

	// ---- 外部 agent 接口（Bearer 密钥，按 scope 授权）----
	// 与 /api/* 浏览器接口完全分离：认证方式不同，且便于将来单独限流。
	// 注意：账户与备份接口刻意不对外开放 —— 改密码、导出备份属高危操作。
	mux.Handle("GET /api/agent/servers",
		auth.RequireAPIKey(db, "servers:read")(http.HandlerFunc(agentListServers(db))))
	mux.Handle("POST /api/agent/servers",
		auth.RequireAPIKey(db, "servers:write")(http.HandlerFunc(agentCreateServer(db, secret))))
	mux.Handle("GET /api/agent/servers/{id}",
		auth.RequireAPIKey(db, "servers:read")(http.HandlerFunc(agentGetServer(db, secret))))
	mux.Handle("PUT /api/agent/servers/{id}",
		auth.RequireAPIKey(db, "servers:write")(http.HandlerFunc(agentUpdateServer(db, secret))))
	mux.Handle("DELETE /api/agent/servers/{id}",
		auth.RequireAPIKey(db, "servers:write")(http.HandlerFunc(agentDeleteServer(db))))
	mux.Handle("POST /api/agent/servers/{id}/exec",
		auth.RequireAPIKey(db, "servers:exec")(http.HandlerFunc(agentExec(db, secret))))
	mux.Handle("GET /api/agent/servers/{id}/files",
		auth.RequireAPIKey(db, "servers:exec")(http.HandlerFunc(agentListFiles(db, secret))))
	mux.Handle("GET /api/agent/servers/{id}/files/read",
		auth.RequireAPIKey(db, "servers:exec")(http.HandlerFunc(agentReadFile(db, secret))))
	mux.Handle("POST /api/agent/servers/{id}/files/write",
		auth.RequireAPIKey(db, "servers:exec")(http.HandlerFunc(agentWriteFile(db, secret))))
	mux.Handle("GET /api/agent/commands",
		auth.RequireAPIKey(db, "commands:read")(http.HandlerFunc(agentListCommands(db))))
	mux.Handle("POST /api/agent/commands",
		auth.RequireAPIKey(db, "commands:write")(http.HandlerFunc(agentCreateCommand(db))))
	mux.Handle("PUT /api/agent/commands/{id}",
		auth.RequireAPIKey(db, "commands:write")(http.HandlerFunc(agentUpdateCommand(db))))
	mux.Handle("DELETE /api/agent/commands/{id}",
		auth.RequireAPIKey(db, "commands:write")(http.HandlerFunc(agentDeleteCommand(db))))
	mux.Handle("POST /api/agent/commands/{id}/use",
		auth.RequireAPIKey(db, "commands:read")(http.HandlerFunc(agentUseCommand(db))))

	// ---- 前端静态资源（SPA 回退）----
	mux.Handle("/", serveFrontend(cfg))

	// 访问日志（API 请求：方法/路径/状态/耗时；不含查询串与请求体）
	return logRequests(mux)
}

// baseHrefFor 推导注入 index.html 的 <base href>。
//
// 判定依据不是当前路径（网关侧的前缀已被上游剥离），而是上游在剥离前打的标记：
// 带前缀的请求用配置前缀，直连端口的请求用 "/"。这样同一份构建产物在网关与
// 直连端口两条链路上都能正确加载静态资源。
func baseHrefFor(r *http.Request, basePath, gatewayBase string) string {
	if basePath == "" {
		return "/"
	}
	if marked, _ := r.Context().Value(basePrefixCtxKey{}).(bool); marked {
		return gatewayBase
	}
	return "/"
}

// basePrefixCtxKey 标记「本请求在路由前带有外部访问前缀」（飞牛网关链路）。
// 键定义在 api 包、由 main 包在剥离路径前通过 WithBasePrefixMark 写入，
// 保证同一次请求内两边看到的是同一个键值。
type basePrefixCtxKey struct{}

// WithBasePrefixMark 在路径被剥离**之前**打标记：本次请求带有外部访问前缀。
// 由 main 包的 stripBasePath 调用，router 侧据此决定注入的 <base href>。
func WithBasePrefixMark(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), basePrefixCtxKey{}, true))
}

func serveFrontend(cfg *config.Config) http.Handler {
	dist := cfg.FrontendDir

	// 外部访问前缀：独立部署为 "/"，飞牛 fnOS 统一网关下为 "/app/mook/"。
	//
	// 直连端口（TCP）上同一份产物可能从根路径访问，此时若仍写死网关前缀，
	// 前端会去 /app/mook/ 取资源而落空。因此 <base> 跟随**本次请求实际所在的
	// 前缀**：请求带了配置的前缀就用它，没带就用 "/"。
	gatewayBase := "/"
	if cfg.BasePath != "" {
		gatewayBase = cfg.BasePath + "/"
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
    <base href="`+baseHrefFor(r, cfg.BasePath, gatewayBase)+`" />`, 1)
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
