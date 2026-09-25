// MIN_PASSWORD_LEN 密码最小长度，须与后端 backend/api/auth.go 的 minPasswordLen 保持一致。
// 后端是唯一权威校验点，此常量仅用于在提交前给出提示，避免用户填完才被拒。
export const MIN_PASSWORD_LEN = 8

/**
 * 备份还原（导入）时对密码的要求：仅「非空」。
 * 还原校验的是「用户已有的备份口令」，不能用新口令的下限去卡旧备份 ——
 * 否则历史备份（口令短于当前下限）将永远无法还原。
 */
export function isBackupPasswordMissing(pwd: string): boolean {
  return pwd.trim() === ''
}
