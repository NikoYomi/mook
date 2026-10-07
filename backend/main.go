package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"mook/api"
	"mook/auth"
	"mook/config"
	"mook/database"
	"mook/utils"
)

func main() {
	cfg := config.Load()

	// 数据目录
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("创建数据目录失败: %v", err)
	}

	// 加密密钥（首次运行自动生成并保存）
	secret, err := utils.EnsureSecret(filepath.Join(cfg.DataDir, "secret.key"), cfg.Secret)
	if err != nil {
		log.Fatalf("初始化密钥失败: %v", err)
	}

	// 数据库
	db, err := database.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}
	defer db.Close()

	// 若通过环境变量预设了初始密码，且尚无用户，则自动创建管理员
	if cfg.Password != "" {
		n, _ := database.CountUsers(db)
		if n == 0 {
			// 与网页初始化共用同一口令下限，避免环境变量成为绕过校验的后门。
			// 该分支仅在「尚无任何用户」时进入，故不会影响已有实例的升级启动。
			if len(cfg.Password) < auth.MinPasswordLen {
				log.Fatalf("MOOK_PASSWORD 至少 %d 位（当前 %d 位）", auth.MinPasswordLen, len(cfg.Password))
			}
			hash, err := auth.HashPassword(cfg.Password)
			if err != nil {
				log.Fatalf("创建初始管理员失败: %v", err)
			}
			if _, err := database.CreateUser(db, "admin", hash); err != nil {
				log.Fatalf("创建初始管理员失败: %v", err)
			}
			log.Println("已通过 MOOK_PASSWORD 创建初始管理员账号 admin")
		}
	}

	// 路由
	router := api.NewRouter(cfg, db, secret)

	// 外部访问前缀：仅在配置了 MOOK_BASE_PATH 时启用。
	//
	// 两个监听口的前缀策略**刻意不同**：
	//
	//   - Unix Socket（飞牛统一网关）：飞牛把 /app/mook/* 原样转发过来，因此
	//     只接受带前缀的路径，其余一律 404 —— 避免子路径部署时被绕过前缀直接访问。
	//
	//   - TCP（本机 / 独立 Docker / 套件版直连端口）：外部程序（dsh-mook-skill、
	//     MCP 客户端、脚本）拿到的是 http://<NAS>:<端口> 这样的服务根地址，
	//     不会带 /app/mook 前缀。此前这里同样只认前缀，导致套件版直连端口上
	//     所有 /api/* 都返回 404（插件报「Mook 没有返回 JSON（HTTP 404）」）。
	//     TCP 侧因此**同时接受**带前缀与不带前缀两种路径。
	var tcpHandler, socketHandler http.Handler = router, router
	if cfg.BasePath != "" {
		socketHandler = stripBasePath(cfg.BasePath, router)
		tcpHandler = acceptWithOrWithoutPrefix(cfg.BasePath, router)
	}

	log.Printf("Mook v0.4.6 已启动: http://localhost:%s", cfg.Port)
	log.Printf("数据目录: %s", cfg.DataDir)
	if cfg.BasePath != "" {
		log.Printf("外部访问前缀: %s", cfg.BasePath)
	}

	errCh := make(chan error, 2)

	// 1) TCP 监听 —— 本机访问、独立 Docker 部署与套件版直连端口
	go func() {
		if err := http.ListenAndServe(":"+cfg.Port, tcpHandler); err != nil {
			errCh <- fmt.Errorf("HTTP 服务启动失败: %w", err)
		}
	}()

	// 2) Unix Socket 监听 —— 飞牛 fnOS 统一网关（可选，配置 MOOK_SOCKET 后启用）
	if cfg.SocketPath != "" {
		if err := os.MkdirAll(filepath.Dir(cfg.SocketPath), 0o755); err != nil {
			log.Fatalf("创建 Socket 目录失败: %v", err)
		}
		// 清理上次运行遗留的 Socket 文件，否则 Listen 会报 address already in use
		_ = os.Remove(cfg.SocketPath)
		ln, err := net.Listen("unix", cfg.SocketPath)
		if err != nil {
			log.Fatalf("监听 Unix Socket 失败: %v", err)
		}
		// 网关以独立身份访问 Socket，放宽到属主/同组可读写
		if err := os.Chmod(cfg.SocketPath, 0o660); err != nil {
			log.Printf("设置 Socket 权限失败: %v", err)
		}
		log.Printf("Unix Socket 已监听: %s", cfg.SocketPath)
		go func() {
			if err := http.Serve(ln, socketHandler); err != nil {
				errCh <- fmt.Errorf("Unix Socket 服务退出: %w", err)
			}
		}()
	}

	if err := <-errCh; err != nil {
		log.Fatalf("%v", err)
	}
}

// stripBasePath 剥离外部访问前缀。
// 只接受带前缀的路径，前缀之外一律 404 —— 用于 Unix Socket（统一网关）侧，
// 避免应用在子路径部署时被绕过前缀直接访问。
func stripBasePath(prefix string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == prefix || r.URL.Path == prefix+"/":
			serveWithPath(w, r, "/", api.WithBasePrefixMark(r), h)
		case strings.HasPrefix(r.URL.Path, prefix+"/"):
			serveWithPath(w, r, strings.TrimPrefix(r.URL.Path, prefix), api.WithBasePrefixMark(r), h)
		default:
			http.NotFound(w, r)
		}
	})
}

// acceptWithOrWithoutPrefix 用于 TCP（直连端口）侧：同时接受带前缀与不带前缀的路径。
//
// 套件版必须设置 MOOK_BASE_PATH（统一网关需要它来还原 /app/mook/* 并注入
// 前端 <base href>），但直连端口的使用者拿到的是服务根地址，不会带前缀。
// 若这里沿用 stripBasePath 的「前缀之外一律 404」，直连端口上的 /api/* 会全部
// 失效 —— 插件只会看到 `404 page not found`，进而报「Mook 没有返回 JSON」。
//
// 安全性：前缀剥离本身不构成鉴权，去掉前缀也不会绕过任何权限校验 ——
// 每个 /api/* 路由仍各自要求会话 Cookie 或 API 密钥。这里放宽的只是路由
// 可达性，不是访问控制。
func acceptWithOrWithoutPrefix(prefix string, h http.Handler) http.Handler {
	stripped := stripBasePath(prefix, h)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, prefix) {
			stripped.ServeHTTP(w, r)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func serveWithPath(w http.ResponseWriter, r *http.Request, path string, marked *http.Request, h http.Handler) {
	r2 := r.Clone(marked.Context())
	r2.URL.Path = path
	// RawPath 只在它是 Path 的合法编码时才生效，这里直接清空以 Path 为准
	r2.URL.RawPath = ""
	h.ServeHTTP(w, r2)
}
