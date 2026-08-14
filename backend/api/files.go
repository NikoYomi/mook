package api

import (
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/pkg/sftp"
	xssh "golang.org/x/crypto/ssh"

	"mook/database"
	sshx "mook/ssh"
	"mook/utils"
)

// fileEntry 文件列表项
type fileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"is_dir"`
	Size    int64  `json:"size"`
	ModTime string `json:"mod_time"`
	Mode    string `json:"mode"`
}

// dialSFTP 建立到指定服务器的 SFTP 连接，返回 (sftp 客户端, ssh 连接)
func dialSFTP(db *sql.DB, secret string, serverID int64) (*sftp.Client, *xssh.Client, error) {
	row, err := database.GetServer(db, serverID)
	if err != nil {
		return nil, nil, err
	}
	password, _ := utils.Decrypt(secret, row.PasswordEnc)
	privateKey, _ := utils.Decrypt(secret, row.PrivateKeyEnc)
	conn, err := sshx.Dial(sshx.Config{
		Host:       row.Host,
		Port:       row.Port,
		Username:   row.Username,
		Password:   password,
		PrivateKey: privateKey,
	})
	if err != nil {
		return nil, nil, err
	}
	sc, err := sftp.NewClient(conn)
	if err != nil {
		conn.Close()
		return nil, nil, err
	}
	return sc, conn, nil
}

func cleanRemotePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return path.Clean(p)
}

func serverIDFromPath(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

// GET /api/servers/{id}/files?path=/ —— 列出目录
func handleListFiles(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		dir := cleanRemotePath(r.URL.Query().Get("path"))
		sc, conn, err := dialSFTP(db, secret, serverID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()
		entries, err := sc.ReadDir(dir)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "读取目录失败："+err.Error())
			return
		}
		out := make([]fileEntry, 0, len(entries))
		for _, e := range entries {
			out = append(out, fileEntry{
				Name:    e.Name(),
				Path:    path.Join(dir, e.Name()),
				IsDir:   e.IsDir(),
				Size:    e.Size(),
				ModTime: e.ModTime().Format("2006-01-02 15:04"),
				Mode:    e.Mode().String(),
			})
		}
		log.Printf("[files] 列目录：server #%d", serverID)
		writeJSON(w, http.StatusOK, map[string]any{"path": dir, "entries": out})
	}
}

// GET /api/servers/{id}/files/download?path=/x —— 下载文件
func handleDownloadFile(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		filePath := cleanRemotePath(r.URL.Query().Get("path"))
		sc, conn, err := dialSFTP(db, secret, serverID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()
		if info, err := sc.Stat(filePath); err == nil && info.IsDir() {
			writeErr(w, http.StatusBadRequest, "不能下载目录")
			return
		}
		f, err := sc.Open(filePath)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "打开文件失败："+err.Error())
			return
		}
		defer f.Close()
		if info, err := f.Stat(); err == nil {
			w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
		}
		name := path.Base(filePath)
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name))
		log.Printf("[files] 下载文件：server #%d", serverID)
		_, _ = io.Copy(w, f)
	}
}

// POST /api/servers/{id}/files/upload?dir=/x —— 上传文件（multipart/form-data，字段名 file）
func handleUploadFile(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		dir := cleanRemotePath(r.URL.Query().Get("dir"))
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			writeErr(w, http.StatusBadRequest, "解析上传表单失败")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "缺少上传文件")
			return
		}
		defer file.Close()
		name := path.Base(header.Filename)
		if name == "" || name == "." || name == "/" {
			writeErr(w, http.StatusBadRequest, "无效的文件名")
			return
		}
		target := path.Join(dir, name)
		sc, conn, err := dialSFTP(db, secret, serverID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()
		dst, err := sc.Create(target)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "创建远程文件失败："+err.Error())
			return
		}
		defer dst.Close()
		if _, err := io.Copy(dst, file); err != nil {
			writeErr(w, http.StatusBadGateway, "写入文件失败："+err.Error())
			return
		}
		log.Printf("[files] 上传文件：server #%d", serverID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": target})
	}
}

// POST /api/servers/{id}/files/mkdir —— 新建目录 {path}
func handleMkdir(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		var in struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		dirPath := cleanRemotePath(in.Path)
		if dirPath == "/" {
			writeErr(w, http.StatusBadRequest, "无法创建根目录")
			return
		}
		sc, conn, err := dialSFTP(db, secret, serverID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()
		if err := sc.Mkdir(dirPath); err != nil {
			writeErr(w, http.StatusBadGateway, "创建目录失败："+err.Error())
			return
		}
		log.Printf("[files] 新建目录：server #%d", serverID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": dirPath})
	}
}

// POST /api/servers/{id}/files/rename —— 重命名/移动 {old_path, new_path}
func handleRename(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		var in struct {
			OldPath string `json:"old_path"`
			NewPath string `json:"new_path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		oldP := cleanRemotePath(in.OldPath)
		newP := cleanRemotePath(in.NewPath)
		if oldP == "/" || newP == "/" || oldP == newP {
			writeErr(w, http.StatusBadRequest, "无效的路径")
			return
		}
		sc, conn, err := dialSFTP(db, secret, serverID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()
		if err := sc.Rename(oldP, newP); err != nil {
			writeErr(w, http.StatusBadGateway, "重命名失败："+err.Error())
			return
		}
		log.Printf("[files] 重命名：server #%d", serverID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": newP})
	}
}

// POST /api/servers/{id}/files/remove —— 删除文件/目录（目录递归删除）{path}
func handleRemove(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		var in struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		filePath := cleanRemotePath(in.Path)
		if filePath == "/" {
			writeErr(w, http.StatusBadRequest, "不能删除根目录")
			return
		}
		sc, conn, err := dialSFTP(db, secret, serverID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SFTP 连接失败："+err.Error())
			return
		}
		defer sc.Close()
		defer conn.Close()
		if err := sftpRemoveAll(sc, filePath); err != nil {
			writeErr(w, http.StatusBadGateway, "删除失败："+err.Error())
			return
		}
		log.Printf("[files] 删除：server #%d", serverID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// sftpRemoveAll 递归删除文件或目录
func sftpRemoveAll(sc *sftp.Client, p string) error {
	info, err := sc.Stat(p)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return sc.Remove(p)
	}
	entries, err := sc.ReadDir(p)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := sftpRemoveAll(sc, path.Join(p, e.Name())); err != nil {
			return err
		}
	}
	return sc.RemoveDirectory(p)
}
