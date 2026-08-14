package database

import (
	"database/sql"
	"errors"
	"time"
)

// ErrNotFound 记录不存在
var ErrNotFound = errors.New("not found")

// CreateUser 创建用户
func CreateUser(db *sql.DB, username, passwordHash string) (*User, error) {
	res, err := db.Exec(
		`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
		username, passwordHash, nowStr(),
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &User{ID: id, Username: username, PasswordHash: passwordHash, CreatedAt: time.Now()}, nil
}

// CountUsers 用户数量
func CountUsers(db *sql.DB) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// GetUserByUsername 按用户名查询
func GetUserByUsername(db *sql.DB, username string) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, password_hash, created_at FROM users WHERE username = ?`,
		username,
	)
	return scanUser(row)
}

// GetFirstUser 返回系统中的唯一用户（单密码登录：不校验用户名）
func GetFirstUser(db *sql.DB) (*User, error) {
	return scanUser(db.QueryRow(
		`SELECT id, username, password_hash, created_at FROM users ORDER BY id LIMIT 1`,
	))
}

// GetUserByID 按 ID 查询
func GetUserByID(db *sql.DB, id int64) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, password_hash, created_at FROM users WHERE id = ?`,
		id,
	)
	return scanUser(row)
}

// UpdateUsername 修改用户名
func UpdateUsername(db *sql.DB, id int64, username string) error {
	_, err := db.Exec(`UPDATE users SET username = ? WHERE id = ?`, username, id)
	return err
}

// UpdatePasswordHash 修改密码哈希
func UpdatePasswordHash(db *sql.DB, id int64, passwordHash string) error {
	_, err := db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, id)
	return err
}
func scanUser(row *sql.Row) (*User, error) {
	var u User
	var created string
	if err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &created); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.CreatedAt, _ = time.Parse(time.RFC3339, created)
	return &u, nil
}