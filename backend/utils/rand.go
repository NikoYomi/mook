package utils

import (
	"crypto/rand"
	"encoding/hex"
)

// RandomHex 生成指定字节数的随机十六进制字符串
func RandomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}