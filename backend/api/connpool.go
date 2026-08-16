package api

import (
	"sync"
	"time"

	xssh "golang.org/x/crypto/ssh"
)

// 监控轮询的连接复用池。
// 原实现每次轮询都新建一次 SSH 连接（握手开销大，对服务器也是负担），
// 无法支撑更激进的轮询频率。改为按服务器复用已建立的连接：
// 轮询变为纯命令执行，1 秒一次也无握手压力。
// 连接是并发安全的（xssh.Client 支持并发 NewSession），读多写少，安全复用。

const (
	poolIdleTTL    = 10 * time.Minute // 闲置超过该时长则关闭
	poolCleanEvery = 2 * time.Minute  // 清理周期
)

type pooledConn struct {
	client *xssh.Client
	last   time.Time
}

type sshConnPool struct {
	mu      sync.Mutex
	clients map[int64]*pooledConn
}

var statsPool = &sshConnPool{clients: map[int64]*pooledConn{}}

// get 返回可复用的连接；不存在或已关闭时返回 nil
func (p *sshConnPool) get(id int64) *xssh.Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	pc, ok := p.clients[id]
	if !ok || pc.client == nil {
		return nil
	}
	pc.last = time.Now()
	return pc.client
}

// put 归还连接供复用（不关闭）
func (p *sshConnPool) put(id int64, c *xssh.Client) {
	if c == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if pc, ok := p.clients[id]; ok && pc.client != nil {
		return
	}
	p.clients[id] = &pooledConn{client: c, last: time.Now()}
}

// drop 移除并关闭指定服务器的连接（连接失效/命令失败时调用）
func (p *sshConnPool) drop(id int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if pc, ok := p.clients[id]; ok && pc.client != nil {
		_ = pc.client.Close()
		delete(p.clients, id)
	}
}

// closeIdle 关闭闲置超过 d 的连接
func (p *sshConnPool) closeIdle(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for id, pc := range p.clients {
		if now.Sub(pc.last) > d {
			_ = pc.client.Close()
			delete(p.clients, id)
		}
	}
}

func init() {
	go func() {
		ticker := time.NewTicker(poolCleanEvery)
		defer ticker.Stop()
		for range ticker.C {
			statsPool.closeIdle(poolIdleTTL)
		}
	}()
}
