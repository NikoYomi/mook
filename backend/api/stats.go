package api

import (
	"database/sql"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	xssh "golang.org/x/crypto/ssh"

	"mook/database"
	sshx "mook/ssh"
	"mook/utils"
)

// ---- 服务器实时状态采集（延迟 / CPU / 内存 / 磁盘）----

// statScript 在远端执行的一次性采集脚本。
// 仅依赖 grep/sed/cut/tr/head/tail 等 POSIX 基础工具，不依赖 awk（部分精简系统无 awk，
// 会导致内存/磁盘/CPU 全部解析失败），同时兼容 GNU/Linux /proc 与 macOS sysctl。
const statScript = `echo "STAT_BEGIN"
if [ -r /proc/cpuinfo ]; then
  echo "cores=$(grep -c '^processor' /proc/cpuinfo)"
elif command -v getconf >/dev/null 2>&1; then
  echo "cores=$(getconf _NPROCESSORS_ONLN)"
else
  echo "cores=1"
fi
if [ -r /proc/loadavg ]; then
  echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
else
  echo "load=$(sysctl -n vm.loadavg | tr -d '{}')"
fi
if [ -r /proc/stat ]; then
  echo "cpu=$(grep '^cpu ' /proc/stat | head -n 1)"
fi
if [ -r /proc/meminfo ]; then
  T=$(grep '^MemTotal:' /proc/meminfo | tr -dc '0-9')
  A=$(grep '^MemAvailable:' /proc/meminfo | tr -dc '0-9')
  [ -z "$A" ] && A=$T
  echo "mem=$((T * 1024)) $(((T - A) * 1024))"
else
  T=$(sysctl -n hw.memsize 2>/dev/null)
  [ -n "$T" ] && {
    FREE=$(vm_stat | grep '^Pages free' | tr -dc '0-9')
    INACT=$(vm_stat | grep '^Pages inactive' | tr -dc '0-9')
    U=$((T - (FREE + INACT) * 4096))
    [ "$U" -lt 0 ] && U=0
    echo "mem=$T $U"
  }
fi
set -- $(df -Pk / 2>/dev/null | sed -n '2p')
if [ -n "$2" ]; then
  echo "disk=$(( $2 * 1024 )) $(( $3 * 1024 ))"
fi
echo "STAT_END"`

// cpuSample CPU 两次采样的差值基准
type cpuSample struct {
	ts    time.Time
	idle  float64
	total float64
}

var (
	cpuMu   sync.Mutex
	cpuPrev = map[int64]cpuSample{}
)

// serverStats 返回给前端的服务器状态
type serverStats struct {
	LatencyMs  int64   `json:"latency_ms"`
	Cores      int     `json:"cores"`
	CPUPercent float64 `json:"cpu_percent"` // -1 表示暂无可计算值（首次采样）
	Load1      float64 `json:"load1"`
	Load5      float64 `json:"load5"`
	Load15     float64 `json:"load15"`
	MemTotal   int64   `json:"mem_total"`
	MemUsed    int64   `json:"mem_used"`
	DiskTotal  int64   `json:"disk_total"`
	DiskUsed   int64   `json:"disk_used"`
	TS         int64   `json:"ts"`
}

// GET /api/servers/{id}/stats —— 采集指定服务器实时状态（每次新建 SSH 连接）
func serverStatsHandler(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serverID, ok := serverIDFromPath(r)
		if !ok {
			writeErr(w, http.StatusBadRequest, "无效的服务器 ID")
			return
		}
		row, err := database.GetServer(db, serverID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "服务器不存在")
			return
		}
		password, _ := utils.Decrypt(secret, row.PasswordEnc)
		privateKey, _ := utils.Decrypt(secret, row.PrivateKeyEnc)

		start := time.Now()
		client, err := sshx.Dial(sshx.Config{
			Host:       row.Host,
			Port:       row.Port,
			Username:   row.Username,
			Password:   password,
			PrivateKey: privateKey,
		})
		if err != nil {
			writeErr(w, http.StatusBadGateway, "SSH 连接失败："+err.Error())
			return
		}
		defer client.Close()
		latency := time.Since(start)

		out, err := runCommand(client, statScript)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "采集系统状态失败："+err.Error())
			return
		}

		stats := parseStatOutput(out, serverID, latency)
		writeJSON(w, http.StatusOK, stats)
	}
}

// runCommand 在远端执行命令并返回输出
func runCommand(client *xssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	data, err := session.CombinedOutput(cmd)
	return string(data), err
}

// parseStatOutput 解析采集脚本输出并计算指标
func parseStatOutput(out string, serverID int64, latency time.Duration) *serverStats {
	stats := &serverStats{
		LatencyMs:  latency.Milliseconds(),
		CPUPercent: -1,
	}
	var cpuLine string

	lines := strings.Split(out, "\n")
	started := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "STAT_BEGIN" {
			started = true
			continue
		}
		if !started {
			continue
		}
		if line == "STAT_END" {
			break
		}
		switch {
		case strings.HasPrefix(line, "cores="):
			stats.Cores, _ = strconv.Atoi(strings.TrimPrefix(line, "cores="))
		case strings.HasPrefix(line, "load="):
			parts := strings.Fields(strings.TrimPrefix(line, "load="))
			if len(parts) >= 3 {
				stats.Load1, _ = strconv.ParseFloat(parts[0], 64)
				stats.Load5, _ = strconv.ParseFloat(parts[1], 64)
				stats.Load15, _ = strconv.ParseFloat(parts[2], 64)
			}
		case strings.HasPrefix(line, "cpu "):
			cpuLine = line
		case strings.HasPrefix(line, "cpuusage="):
			if v, err := strconv.ParseFloat(strings.TrimPrefix(line, "cpuusage="), 64); err == nil && v >= 0 {
				stats.CPUPercent = v
			}
		case strings.HasPrefix(line, "mem="):
			parts := strings.Fields(strings.TrimPrefix(line, "mem="))
			if len(parts) >= 2 {
				stats.MemTotal, _ = strconv.ParseInt(parts[0], 10, 64)
				stats.MemUsed, _ = strconv.ParseInt(parts[1], 10, 64)
			}
		case strings.HasPrefix(line, "disk="):
			parts := strings.Fields(strings.TrimPrefix(line, "disk="))
			if len(parts) >= 2 {
				stats.DiskTotal, _ = strconv.ParseInt(parts[0], 10, 64)
				stats.DiskUsed, _ = strconv.ParseInt(parts[1], 10, 64)
			}
		}
	}

	stats.TS = time.Now().Unix()

	if cpuLine != "" && stats.CPUPercent < 0 {
		stats.CPUPercent = computeCPU(serverID, cpuLine)
	}
	return stats
}

// computeCPU 依据 /proc/stat 前后两次采样差值计算 CPU 使用率（%）
func computeCPU(serverID int64, line string) float64 {
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return -1
	}
	vals := make([]float64, 0, len(fields)-1)
	for _, f := range fields[1:] {
		v, err := strconv.ParseFloat(f, 64)
		if err != nil {
			v = 0
		}
		vals = append(vals, v)
	}
	total := 0.0
	for _, v := range vals {
		total += v
	}
	var idle float64
	if len(vals) >= 1 {
		idle = vals[3]
	}
	if len(vals) >= 5 {
		idle += vals[4] // iowait 计入空闲
	}
	if total <= 0 {
		return -1
	}
	return updateCPUSample(serverID, time.Now(), idle, total)
}

// updateCPUSample 记录本次采样并基于差值返回 CPU 使用率；首次采样返回 -1
func updateCPUSample(serverID int64, now time.Time, idle, total float64) float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()
	prev, ok := cpuPrev[serverID]
	cpuPrev[serverID] = cpuSample{ts: now, idle: idle, total: total}
	if !ok {
		return -1
	}
	dt := now.Sub(prev.ts).Seconds()
	dTotal := total - prev.total
	dIdle := idle - prev.idle
	if dt <= 0 || dTotal <= 0 || dIdle < 0 {
		return -1
	}
	percent := (1 - dIdle/dTotal) * 100
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	if math.IsNaN(percent) {
		return -1
	}
	return percent
}