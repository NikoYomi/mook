package database

import (
	"database/sql"
	"errors"
	"time"
)

// CreateSession 创建会话
func CreateSession(db *sql.DB, token string, userID int64, ttl time.Duration) error {
	now := time.Now()
	_, err := db.Exec(
		`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token, userID, now.Add(ttl).Format(time.RFC3339), now.Format(time.RFC3339),
	)
	return err
}

// GetUserByToken 校验会话令牌并返回用户
func GetUserByToken(db *sql.DB, token string) (*User, error) {
	if token == "" {
		return nil, ErrNotFound
	}
	var userID int64
	var expires string
	err := db.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token = ?`,
		token,
	).Scan(&userID, &expires)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	exp, err := time.Parse(time.RFC3339, expires)
	if err != nil || time.Now().After(exp) {
		_ = DeleteSession(db, token)
		return nil, ErrNotFound
	}
	return GetUserByID(db, userID)
}

// DeleteSession 删除会话
func DeleteSession(db *sql.DB, token string) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}