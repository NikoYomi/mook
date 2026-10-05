package database

import (
	"database/sql"
	"errors"
	"strconv"
	"time"
)

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

// GetCommonCommand 按 id 取单条常用命令
func GetCommonCommand(db *sql.DB, id string) (*CommonCommand, error) {
	row := db.QueryRow(
		`SELECT id, name, command, category, sort_order, usage_count, pinned
		 FROM common_commands WHERE id = ?`, id,
	)
	var c CommonCommand
	var pinned int
	if err := row.Scan(&c.ID, &c.Name, &c.Command, &c.Category, &c.SortOrder, &c.UsageCount, &pinned); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Pinned = pinned != 0
	return &c, nil
}

// AddCommonCommand 新增单条常用命令（外部 agent 用）。
//
// 与 ReplaceCommonCommands 的全量替换语义不同，这里只动一条记录，
// 因此不会影响浏览器端已保存的其他命令。id 为空时自动生成。
func AddCommonCommand(db *sql.DB, c *CommonCommand) (*CommonCommand, error) {
	if c.ID == "" {
		c.ID = "cmd-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	if c.Name == "" || c.Command == "" {
		return nil, errors.New("命令名称与内容不能为空")
	}
	// 新命令排到末尾
	var maxOrder sql.NullInt64
	_ = db.QueryRow(`SELECT MAX(sort_order) FROM common_commands`).Scan(&maxOrder)
	order := 0
	if maxOrder.Valid {
		order = int(maxOrder.Int64) + 1
	}
	pinned := 0
	if c.Pinned {
		pinned = 1
	}
	if _, err := db.Exec(
		`INSERT INTO common_commands (id, name, command, category, sort_order, usage_count, pinned, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.Command, c.Category, order, c.UsageCount, pinned, nowStr(),
	); err != nil {
		return nil, err
	}
	c.SortOrder = order
	return c, nil
}

// UpdateCommonCommand 更新单条常用命令（仅覆盖传入的非空字段，其余保持原值）
func UpdateCommonCommand(db *sql.DB, id string, patch *CommonCommand) (*CommonCommand, error) {
	current, err := GetCommonCommand(db, id)
	if err != nil {
		return nil, err
	}
	if patch.Name != "" {
		current.Name = patch.Name
	}
	if patch.Command != "" {
		current.Command = patch.Command
	}
	if patch.Category != "" {
		current.Category = patch.Category
	}
	pinned := 0
	if patch.Pinned {
		pinned = 1
	}
	if _, err := db.Exec(
		`UPDATE common_commands SET name = ?, command = ?, category = ?, pinned = ? WHERE id = ?`,
		current.Name, current.Command, current.Category, pinned, id,
	); err != nil {
		return nil, err
	}
	current.Pinned = patch.Pinned
	return current, nil
}

// DeleteCommonCommand 删除单条常用命令
func DeleteCommonCommand(db *sql.DB, id string) error {
	res, err := db.Exec(`DELETE FROM common_commands WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
