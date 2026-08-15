package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Message 对话消息
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Client OpenAI 兼容 API 客户端
type Client struct {
	BaseURL string
	APIKey  string
	Model   string
	HTTP    *http.Client
}

// NewClient 创建客户端
func NewClient(baseURL, apiKey, model string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		Model:   model,
		HTTP:    &http.Client{Timeout: 90 * time.Second},
	}
}

// Chat 发送对话请求，返回回复文本
func (c *Client) Chat(messages []Message) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      c.Model,
		"messages":   messages,
		"max_tokens": 4096,
	})
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 AI 服务失败：%w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI 服务返回错误 (%d)：%s", resp.StatusCode, truncate(string(data), 300))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("解析 AI 响应失败：%w", err)
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("AI 未返回有效内容")
	}
	return out.Choices[0].Message.Content, nil
}

// ListModels 获取该接口支持的模型列表（OpenAI 兼容 /models）
func (c *Client) ListModels() ([]string, error) {
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/models", nil)
	if err != nil {
		return nil, err
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求模型列表失败：%w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("获取模型列表失败 (%d)：%s", resp.StatusCode, truncate(string(data), 200))
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("解析模型列表失败：%w", err)
	}
	seen := map[string]bool{}
	models := make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		id := strings.TrimSpace(m.ID)
		if id != "" && !seen[id] {
			seen[id] = true
			models = append(models, id)
		}
	}
	return models, nil
}
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}