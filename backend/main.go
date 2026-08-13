package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

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

	addr := ":" + cfg.Port
	log.Printf("Mook v0.2 已启动: http://localhost:%s", cfg.Port)
	log.Printf("数据目录: %s", cfg.DataDir)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}