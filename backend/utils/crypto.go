package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"os"

	"golang.org/x/crypto/pbkdf2"
)

// DeriveKey 从任意字符串派生 32 字节 AES 密钥
func DeriveKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// Encrypt 使用 AES-256-GCM 加密，返回 base64 字符串
func Encrypt(secret, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	block, err := aes.NewCipher(DeriveKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// Decrypt 解密 Encrypt 的输出
func Decrypt(secret, encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(DeriveKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("密文长度不足")
	}
	nonce, ct := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// EnsureSecret 返回加密密钥：优先环境变量，否则读取/生成 secret.key
func EnsureSecret(keyFile, envSecret string) (string, error) {
	if envSecret != "" {
		return envSecret, nil
	}
	if data, err := os.ReadFile(keyFile); err == nil {
		return string(data), nil
	}
	secret, err := RandomHex(32)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(keyFile, []byte(secret), 0o600); err != nil {
		return "", err
	}
	return secret, nil
}

// derivePasswordKey 通过 PBKDF2（SHA-256）从口令派生 32 字节 AES 密钥
func derivePasswordKey(password string, salt []byte) []byte {
	return pbkdf2.Key([]byte(password), salt, 210000, 32, sha256.New)
}

// EncryptWithPassword 使用口令加密（PBKDF2 派生密钥 + AES-256-GCM），
// 返回 base64( salt(16) || nonce(12) || ciphertext )，无需额外保存盐值即可解密
func EncryptWithPassword(password, plaintext string) (string, error) {
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", err
	}
	block, err := aes.NewCipher(derivePasswordKey(password, salt))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	blob := make([]byte, 0, len(salt)+len(ct))
	blob = append(blob, salt...)
	blob = append(blob, ct...)
	return base64.StdEncoding.EncodeToString(blob), nil
}

// DecryptWithPassword 解密 EncryptWithPassword 的输出
func DecryptWithPassword(password, encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	const saltLen = 16
	if len(data) < saltLen {
		return "", errors.New("密文长度不足")
	}
	salt := data[:saltLen]
	block, err := aes.NewCipher(derivePasswordKey(password, salt))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	body := data[saltLen:]
	if len(body) < gcm.NonceSize() {
		return "", errors.New("密文长度不足")
	}
	nonce, ct := body[:gcm.NonceSize()], body[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
