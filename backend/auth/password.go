package auth

import "golang.org/x/crypto/bcrypt"

// MinPasswordLen 密码最小长度（管理员账号密码与备份口令共用）。
// 该账号可访问全部服务器凭据，备份文件内亦含明文凭据，故下限不宜过短。
//
// 强制点共四处，改此值即全部生效：
//   - 首次初始化   backend/api/auth.go
//   - 修改密码     backend/api/account.go
//   - 导出加密备份 backend/api/backup.go
//   - MOOK_PASSWORD 预设值 backend/main.go（启动时校验）
const MinPasswordLen = 8

// HashPassword 生成密码哈希
func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword 校验密码
func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}