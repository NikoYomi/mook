package api

import (
	"bufio"
	"log"
	"net"
	"net/http"
	"time"
)

// statusRecorder 记录响应状态码，供访问日志使用
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Hijack 支持 WebSocket 等需要劫持连接的场景（如 /ws/terminal）
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return r.ResponseWriter.(http.Hijacker).Hijack()
}

// Flush 支持流式响应
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// logRequests 访问日志中间件：记录 方法、路径、状态码、耗时。
// 仅记录 URL.Path（不含查询串），避免把路径参数/密钥等隐私内容写入日志。
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		// 过滤掉静态资源噪音，只记录 API 与关键页面
		if len(r.URL.Path) >= 4 && r.URL.Path[:4] == "/api" {
			log.Printf("[http] %s %s -> %d (%s)", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
		}
	})
}
