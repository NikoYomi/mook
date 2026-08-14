package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"mook/auth"
	"mook/database"
)

// POST /api/me/username —— 修改当前用户名
func changeUsername(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.CurrentUser(r)
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "请先登录")
			return
		}
		var in struct {
			Username string `json:"username"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		name := strings.TrimSpace(in.Username)
		if name == "" {
			writeErr(w, http.StatusBadRequest, "用户名不能为空")
			return
		}
		if len(name) > 32 {
			writeErr(w, http.StatusBadRequest, "用户名不能超过 32 个字符")
			return
		}
		if existing, err := database.GetUserByUsername(db, name); err == nil && existing.ID != u.ID {
			writeErr(w, http.StatusBadRequest, "用户名已被占用")
			return
		}
		if err := database.UpdateUsername(db, u.ID, name); err != nil {
			writeErr(w, http.StatusInternalServerError, "修改用户名失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "username": name})
	}
}

// POST /api/me/verify-password —— 仅验证当前密码是否正确（不修改）
func verifyPassword(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.CurrentUser(r)
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "请先登录")
			return
		}
		var in struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if !auth.CheckPassword(u.PasswordHash, in.Password) {
			writeErr(w, http.StatusBadRequest, "当前密码错误")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// POST /api/me/password —— 修改当前用户密码
func changePassword(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.CurrentUser(r)
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "请先登录")
			return
		}
		var in struct {
			OldPassword string `json:"old_password"`
			NewPassword string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if len(in.NewPassword) < 6 {
			writeErr(w, http.StatusBadRequest, "新密码至少 6 位")
			return
		}
		if !auth.CheckPassword(u.PasswordHash, in.OldPassword) {
			writeErr(w, http.StatusBadRequest, "当前密码错误")
			return
		}
		hash, err := auth.HashPassword(in.NewPassword)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "密码处理失败")
			return
		}
		if err := database.UpdatePasswordHash(db, u.ID, hash); err != nil {
			writeErr(w, http.StatusInternalServerError, "修改密码失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}