package database

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type rowScanner interface {
	Scan(dest ...any) error
}

// ListServers 服务器列表
func ListServers(db *sql.DB) ([]*Server, error) {
	rows, err := db.Query(
		`SELECT id, name, host, port, username, auth_type, password_enc, private_key_enc, tags, created_at, updated_at, last_connected_at
		 FROM servers ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Server
	for rows.Next() {
		s, err := scanServer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetServer 单个服务器（含加密凭据）
func GetServer(db *sql.DB, id int64) (*Server, error) {
	row := db.QueryRow(
		`SELECT id, name, host, port, username, auth_type, password_enc, private_key_enc, tags, created_at, updated_at, last_connected_at
		 FROM servers WHERE id = ?`,
		id,
	)
	return scanServer(row)
}

// CreateServer 新建服务器
func CreateServer(db *sql.DB, s *Server) (*Server, error) {
	now := nowStr()
	res, err := db.Exec(
		`INSERT INTO servers (name, host, port, username, auth_type, password_enc, private_key_enc, tags, created_at, updated_at, last_connected_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.Name, s.Host, s.Port, s.Username, s.AuthType, s.PasswordEnc, s.PrivateKeyEnc,
		joinTags(s.Tags), now, now, timeStr(s.LastConnectedAt),
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	s.ID = id
	s.CreatedAt = time.Now()
	s.UpdatedAt = time.Now()
	return s, nil
}

// UpdateServer 更新服务器
func UpdateServer(db *sql.DB, s *Server) error {
	_, err := db.Exec(
		`UPDATE servers SET name=?, host=?, port=?, username=?, auth_type=?, password_enc=?, private_key_enc=?, tags=?, updated_at=?
		 WHERE id=?`,
		s.Name, s.Host, s.Port, s.Username, s.AuthType, s.PasswordEnc, s.PrivateKeyEnc,
		joinTags(s.Tags), nowStr(), s.ID,
	)
	return err
}

// UpdateLastConnected 记录服务器最近一次成功连接时间
func UpdateLastConnected(db *sql.DB, id int64) error {
	_, err := db.Exec(`UPDATE servers SET last_connected_at=? WHERE id=?`, nowStr(), id)
	return err
}

// DeleteServer 删除服务器
func DeleteServer(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM servers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ClearServers 清空全部服务器（用于还原备份）
func ClearServers(db *sql.DB) error {
	_, err := db.Exec(`DELETE FROM servers`)
	return err
}
func joinTags(tags []string) string {
	return strings.Join(tags, ",")
}

func splitTags(s string) []string {
	if s == "" {
		return []string{}
	}
	var out []string
	for _, t := range strings.Split(s, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func scanServer(row rowScanner) (*Server, error) {
	var s Server
	var created, updated, lastConnected string
	if err := row.Scan(
		&s.ID, &s.Name, &s.Host, &s.Port, &s.Username, &s.AuthType,
		&s.PasswordEnc, &s.PrivateKeyEnc, &s.TagsRaw, &created, &updated, &lastConnected,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	s.CreatedAt, _ = time.Parse(time.RFC3339, created)
	s.UpdatedAt, _ = time.Parse(time.RFC3339, updated)
	s.LastConnectedAt, _ = time.Parse(time.RFC3339, lastConnected)
	s.Tags = splitTags(s.TagsRaw)
	return &s, nil
}

// timeStr 把 time.Time 转成存储字符串；零值返回空串
func timeStr(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}