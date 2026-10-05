package database

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// APIKeyPrefix 所有外部 agent 密钥的统一前缀，便于在日志与界面中一眼识别
const APIKeyPrefix = "mk_"

// APIKey 外部 agent 访问密钥。
//
// 安全约定：数据库只保存 sha256(明文 key) —— 明文仅在创建那一刻返回一次，
// 之后任何接口都不再提供。prefix 是明文的一段（用于列表展示与人工辨识），
// 单凭它无法还原密钥。
type APIKey struct {
	ID         int64      `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`  // 明文前缀，如 mk_1a2b3c4d
	Scopes     []string   `json:"scopes"`  // 授权的操作范围
	KeyHash    string     `json:"-"`       // 永不外泄
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt time.Time  `json:"last_used_at"` // 零值表示从未使用
	ExpiresAt  time.Time  `json:"expires_at"`   // 零值表示永不过期
	Revoked    bool       `json:"revoked"`
}

// scope 列表在库中以逗号分隔存储；空字符串表示未授予任何权限
func joinScopes(scopes []string) string {
	out := make([]string, 0, len(scopes))
	for _, s := range scopes {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, ",")
}

func splitScopes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// HashAPIKey 计算密钥摘要。
//
// 这里用 sha256 而非 bcrypt：密钥是 48 位随机十六进制（192 bit 熵），
// 不存在字典/爆破攻击面，而每次 agent 请求都要校验一次，bcrypt 的开销
// 会成为纯损耗。用户口令是低熵输入，因此仍必须走 bcrypt（见 auth 包）。
func HashAPIKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// CreateAPIKey 创建密钥。返回的 plaintext 是本密钥唯一一次明文暴露。
func CreateAPIKey(db *sql.DB, name string, scopes []string, expiresAt time.Time) (*APIKey, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, "", errors.New("请填写密钥名称")
	}
	body, err := randomHex(24) // 48 个十六进制字符
	if err != nil {
		return nil, "", err
	}
	plaintext := APIKeyPrefix + body
	hash := HashAPIKey(plaintext)

	// 展示用前缀：把 mk_ 之后的前 8 位明文露出来，其余不可见
	prefix := plaintext
	if len(prefix) > 11 {
		prefix = prefix[:11]
	}

	expires := ""
	if !expiresAt.IsZero() {
		expires = expiresAt.Format(time.RFC3339)
	}

	res, err := db.Exec(
		`INSERT INTO api_keys (name, prefix, key_hash, scopes, created_at, last_used_at, expires_at, revoked)
		 VALUES (?, ?, ?, ?, ?, '', ?, 0)`,
		name, prefix, hash, joinScopes(scopes), nowStr(), expires,
	)
	if err != nil {
		return nil, "", err
	}
	id, _ := res.LastInsertId()
	return &APIKey{
		ID:        id,
		Name:      name,
		Prefix:    prefix,
		Scopes:    splitScopes(joinScopes(scopes)),
		CreatedAt: time.Now(),
		ExpiresAt: expiresAt,
	}, plaintext, nil
}

func scanAPIKey(row rowScanner) (*APIKey, error) {
	var k APIKey
	var scopes, createdAt, lastUsed, expires string
	var revoked int
	if err := row.Scan(&k.ID, &k.Name, &k.Prefix, &k.KeyHash, &scopes, &createdAt, &lastUsed, &expires, &revoked); err != nil {
		return nil, err
	}
	k.Scopes = splitScopes(scopes)
	k.CreatedAt = parseTime(createdAt)
	k.LastUsedAt = parseTime(lastUsed)
	k.ExpiresAt = parseTime(expires)
	k.Revoked = revoked != 0
	return &k, nil
}

const apiKeyColumns = `id, name, prefix, key_hash, scopes, created_at, last_used_at, expires_at, revoked`

// ListAPIKeys 列出全部密钥（不含明文，按创建时间倒序）
func ListAPIKeys(db *sql.DB) ([]*APIKey, error) {
	rows, err := db.Query(`SELECT ` + apiKeyColumns + ` FROM api_keys ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*APIKey{}
	for rows.Next() {
		k, err := scanAPIKey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

// GetAPIKeyByHash 按摘要查密钥（供鉴权中间件使用）
func GetAPIKeyByHash(db *sql.DB, hash string) (*APIKey, error) {
	row := db.QueryRow(`SELECT `+apiKeyColumns+` FROM api_keys WHERE key_hash = ?`, hash)
	k, err := scanAPIKey(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return k, nil
}

// TouchAPIKey 记录最后使用时间。
// 鉴权路径上的失败不应影响请求本身，调用方可以忽略错误。
func TouchAPIKey(db *sql.DB, id int64) error {
	_, err := db.Exec(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, nowStr(), id)
	return err
}

// RevokeAPIKey 撤销密钥（保留记录，便于审计）
func RevokeAPIKey(db *sql.DB, id int64) error {
	res, err := db.Exec(`UPDATE api_keys SET revoked = 1 WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteAPIKey 彻底删除密钥记录
func DeleteAPIKey(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM api_keys WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// HasScope 判断密钥是否具备某项权限。
// "*" 是通配，便于将来引入受限的超级密钥。
func (k *APIKey) HasScope(scope string) bool {
	for _, s := range k.Scopes {
		if s == scope || s == "*" {
			return true
		}
	}
	return false
}

// Valid 判断密钥当前是否可用（未撤销且未过期）
func (k *APIKey) Valid() bool {
	if k.Revoked {
		return false
	}
	if !k.ExpiresAt.IsZero() && time.Now().After(k.ExpiresAt) {
		return false
	}
	return true
}
