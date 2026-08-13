package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"mook/database"
	"mook/utils"
)

// ServerInput 创建/更新服务器的请求体
type ServerInput struct {
	Name       string   `json:"name"`
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
	AuthType   string   `json:"auth_type"`
	Password   string   `json:"password"`
	PrivateKey string   `json:"private_key"`
	Tags       []string `json:"tags"`
}

// GET /api/servers —— 服务器列表
func listServers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := database.ListServers(db)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取服务器失败")
			return
		}
		out := make([]*database.ServerAPI, 0, len(rows))
		for _, s := range rows {
			out = append(out, toAPIServer(s))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// POST /api/servers —— 新增服务器
func createServer(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in ServerInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		s, err := buildServer(&in, secret, nil)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		created, err := database.CreateServer(db, s)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "保存服务器失败")
			return
		}
		writeJSON(w, http.StatusOK, toAPIServer(created))
	}
}

// PUT /api/servers/{id} —— 更新服务器
func updateServer(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		existing, err := database.GetServer(db, id)
		if err != nil {
			writeErr(w, http.StatusNotFound, "服务器不存在")
			return
		}
		var in ServerInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		s, err := buildServer(&in, secret, existing)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := database.UpdateServer(db, s); err != nil {
			writeErr(w, http.StatusInternalServerError, "更新服务器失败")
			return
		}
		updated, _ := database.GetServer(db, id)
		writeJSON(w, http.StatusOK, toAPIServer(updated))
	}
}

// DELETE /api/servers/{id} —— 删除服务器
func deleteServer(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		if err := database.DeleteServer(db, id); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				writeErr(w, http.StatusNotFound, "服务器不存在")
				return
			}
			writeErr(w, http.StatusInternalServerError, "删除服务器失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// buildServer 组装并校验服务器数据，凭据加密存储
func buildServer(in *ServerInput, secret string, existing *database.Server) (*database.Server, error) {
	s := &database.Server{
		Name:     strings.TrimSpace(in.Name),
		Host:     strings.TrimSpace(in.Host),
		Port:     in.Port,
		Username: strings.TrimSpace(in.Username),
		AuthType: in.AuthType,
		Tags:     in.Tags,
	}
	if existing != nil {
		s.ID = existing.ID
	}
	if s.Name == "" || s.Host == "" {
		return nil, errors.New("服务器名称和地址不能为空")
	}
	if s.Port == 0 {
		s.Port = 22
	}
	if s.Username == "" {
		s.Username = "root"
	}
	if s.AuthType == "" {
		s.AuthType = "password"
	}
	if s.AuthType != "password" && s.AuthType != "key" {
		return nil, errors.New("认证方式仅支持 password 或 key")
	}
	if s.AuthType == "password" {
		if in.Password != "" {
			enc, err := utils.Encrypt(secret, in.Password)
			if err != nil {
				return nil, errors.New("密码加密失败")
			}
			s.PasswordEnc = enc
			s.PrivateKeyEnc = ""
		} else if existing != nil {
			s.PasswordEnc = existing.PasswordEnc
		}
	} else {
		if in.PrivateKey != "" {
			enc, err := utils.Encrypt(secret, in.PrivateKey)
			if err != nil {
				return nil, errors.New("私钥加密失败")
			}
			s.PrivateKeyEnc = enc
			s.PasswordEnc = ""
		} else if existing != nil {
			s.PrivateKeyEnc = existing.PrivateKeyEnc
		}
	}
	if s.PasswordEnc == "" && s.PrivateKeyEnc == "" {
		return nil, errors.New("请填写密码或私钥")
	}
	return s, nil
}

func toAPIServer(s *database.Server) *database.ServerAPI {
	return &database.ServerAPI{
		ID:        s.ID,
		Name:      s.Name,
		Host:      s.Host,
		Port:      s.Port,
		Username:  s.Username,
		AuthType:  s.AuthType,
		Tags:      s.Tags,
		CreatedAt: s.CreatedAt,
		UpdatedAt: s.UpdatedAt,
	}
}