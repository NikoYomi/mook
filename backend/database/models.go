package database

import "time"

// User 管理员用户
type User struct {
	ID           int64
	Username     string
	PasswordHash string
	CreatedAt    time.Time
}

// Server 服务器配置（含加密后的凭据）
type Server struct {
	ID              int64     `json:"id"`
	Name            string    `json:"name"`
	Host            string    `json:"host"`
	Port            int       `json:"port"`
	Username        string    `json:"username"`
	AuthType        string    `json:"auth_type"` // password | key
	PasswordEnc     string    `json:"password_enc"` // 加密后的密码
	PrivateKeyEnc   string    `json:"private_key_enc"` // 加密后的私钥
	TagsRaw         string    `json:"tags_raw,omitempty"` // 逗号分隔的原始标签
	Tags            []string  `json:"tags"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	LastConnectedAt time.Time `json:"last_connected_at"` // 上次成功连接时间（零值表示从未连接）
}

// ServerAPI 返回给前端的服务器信息（不含任何凭据）
type ServerAPI struct {
	ID              int64     `json:"id"`
	Name            string    `json:"name"`
	Host            string    `json:"host"`
	Port            int       `json:"port"`
	Username        string    `json:"username"`
	AuthType        string    `json:"auth_type"`
	Tags            []string  `json:"tags"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	LastConnectedAt string    `json:"last_connected_at"` // ISO 时间；零值表示从未连接
}