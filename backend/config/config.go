package config

import (
	"os"
	"path/filepath"
	"strings"
)

// Config 全局配置
type Config struct {
	Port        string // HTTP 服务端口，默认 5866
	BasePath    string // 外部访问前缀（如 /app/mook）；为空表示部署在根路径
	SocketPath  string // 额外监听的 Unix Socket 路径；为空表示不启用
	DataDir     string // 数据目录
	FrontendDir string // 前端静态资源目录（构建产物）
	Password    string // 可选：预设初始密码（MOOK_PASSWORD）
	Secret      string // 可选：加密密钥（MOOK_SECRET）
}

// Load 从环境变量加载配置
func Load() *Config {
	dataDir := getenv("MOOK_DATA", "./data")
	if abs, err := filepath.Abs(dataDir); err == nil {
		dataDir = abs
	}
	frontendDir := getenv("MOOK_DIST", "./dist")
	return &Config{
		Port:        getenv("MOOK_PORT", "5866"),
		BasePath:    NormalizeBasePath(os.Getenv("MOOK_BASE_PATH")),
		SocketPath:  os.Getenv("MOOK_SOCKET"),
		DataDir:     dataDir,
		FrontendDir: frontendDir,
		Password:    os.Getenv("MOOK_PASSWORD"),
		Secret:      os.Getenv("MOOK_SECRET"),
	}
}

// NormalizeBasePath 归一化外部访问前缀：确保以 "/" 开头、不以 "/" 结尾。
// 空值或 "/" 表示部署在根路径，返回空字符串。
func NormalizeBasePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || p == "/" {
		return ""
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return strings.TrimRight(p, "/")
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
