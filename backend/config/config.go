package config

import (
	"os"
	"path/filepath"
)

// Config 全局配置
type Config struct {
	Port         string // HTTP 服务端口，默认 5866
	DataDir      string // 数据目录
	FrontendDir  string // 前端静态资源目录（构建产物）
	Password     string // 可选：预设初始密码（MOOK_PASSWORD）
	Secret       string // 可选：加密密钥（MOOK_SECRET）
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
		DataDir:     dataDir,
		FrontendDir: frontendDir,
		Password:    os.Getenv("MOOK_PASSWORD"),
		Secret:      os.Getenv("MOOK_SECRET"),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}