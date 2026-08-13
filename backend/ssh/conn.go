package ssh

import (
	"fmt"
	"net"
	"time"

	xssh "golang.org/x/crypto/ssh"
)

// Config SSH 连接配置
type Config struct {
	Host       string
	Port       int
	Username   string
	Password   string
	PrivateKey string
}

// Dial 建立 SSH 连接
func Dial(cfg Config) (*xssh.Client, error) {
	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	var auths []xssh.AuthMethod
	if cfg.PrivateKey != "" {
		signer, err := xssh.ParsePrivateKey([]byte(cfg.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("解析私钥失败：%w", err)
		}
		auths = append(auths, xssh.PublicKeys(signer))
	} else {
		auths = append(auths, xssh.Password(cfg.Password))
	}
	client, err := xssh.Dial("tcp", addr, &xssh.ClientConfig{
		User:            cfg.Username,
		Auth:            auths,
		HostKeyCallback: xssh.InsecureIgnoreHostKey(), // v0.1 暂不校验主机指纹（TODO: 支持 known_hosts 校验）
		Timeout:         10 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	return client, nil
}