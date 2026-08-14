package database

import "database/sql"

// CommonCommand 常用命令
type CommonCommand struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Command   string `json:"command"`
	Category  string `json:"category,omitempty"`
	SortOrder int    `json:"sort_order"`
}

// ListCommonCommands 列出全部常用命令（按添加顺序）
func ListCommonCommands(db *sql.DB) ([]CommonCommand, error) {
	rows, err := db.Query(
		`SELECT id, name, command, category, sort_order FROM common_commands ORDER BY sort_order, id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommonCommand
	for rows.Next() {
		var c CommonCommand
		if err := rows.Scan(&c.ID, &c.Name, &c.Command, &c.Category, &c.SortOrder); err != nil {
			return nil, err
		}
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
		if _, err := tx.Exec(
			`INSERT INTO common_commands (id, name, command, category, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			c.ID, c.Name, c.Command, c.Category, i, nowStr(),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
