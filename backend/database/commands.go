package database

import "database/sql"

// CommonCommand 常用命令
type CommonCommand struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Command    string `json:"command"`
	Category   string `json:"category,omitempty"`
	SortOrder  int    `json:"sort_order"`
	UsageCount int    `json:"usage_count"` // 使用次数（排序用）
	Pinned     bool   `json:"pinned"`      // 用户手动置顶
}

// ListCommonCommands 列出全部常用命令（置顶优先，其次按使用次数，再次按添加顺序）
func ListCommonCommands(db *sql.DB) ([]CommonCommand, error) {
	rows, err := db.Query(
		`SELECT id, name, command, category, sort_order, usage_count, pinned
		 FROM common_commands ORDER BY pinned DESC, usage_count DESC, sort_order, id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommonCommand
	for rows.Next() {
		var c CommonCommand
		var pinned int
		if err := rows.Scan(&c.ID, &c.Name, &c.Command, &c.Category, &c.SortOrder, &c.UsageCount, &pinned); err != nil {
			return nil, err
		}
		c.Pinned = pinned != 0
		out = append(out, c)
	}
	return out, rows.Err()
}

// ReplaceCommonCommands 全量替换常用命令（持久化到数据目录 /data）
func ReplaceCommonCommands(db *sql.DB, items []CommonCommand) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM common_commands`); err != nil {
		return err
	}
	for i, c := range items {
		if c.ID == "" || c.Name == "" || c.Command == "" {
			continue
		}
		pinned := 0
		if c.Pinned {
			pinned = 1
		}
		if _, err := tx.Exec(
			`INSERT INTO common_commands (id, name, command, category, sort_order, usage_count, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			c.ID, c.Name, c.Command, c.Category, i, c.UsageCount, pinned, nowStr(),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// IncrementCommonCommandUsage 使用次数 +1（用于自动按使用次数排序）
func IncrementCommonCommandUsage(db *sql.DB, id string) error {
	_, err := db.Exec(`UPDATE common_commands SET usage_count = usage_count + 1 WHERE id = ?`, id)
	return err
}
