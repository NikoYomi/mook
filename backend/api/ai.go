package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"mook/ai"
	"mook/database"
	"mook/utils"
)

var errAINotConfigured = errors.New("AI 尚未配置，请先到「设置」页填写 API Key")

func loadAIClient(db *sql.DB, secret string) (*ai.Client, error) {
	baseURL, _ := database.GetSetting(db, keyAIBaseURL)
	model, _ := database.GetSetting(db, keyAIModel)
	if baseURL == "" {
		baseURL = defaultAIBaseURL
	}
	if model == "" {
		model = defaultAIModel
	}
	apiKey, err := utils.Decrypt(secret, getProviderKey(db, baseURL))
	if err != nil {
		return nil, err
	}
	if apiKey == "" {
		return nil, errAINotConfigured
	}
	return ai.NewClient(baseURL, apiKey, model), nil
}

// POST /api/ai/command —— 自然语言生成命令
func aiCommand(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, err := loadAIClient(db, secret)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		var req struct {
			Prompt string `json:"prompt"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if strings.TrimSpace(req.Prompt) == "" {
			writeErr(w, http.StatusBadRequest, "请描述你的需求")
			return
		}
		messages := []ai.Message{
			{Role: "system", Content: "你是一名资深 Linux 运维工程师。请根据用户需求，只输出一条可以直接在服务器上执行的命令，不要任何解释、前后缀或多余文字。若需求无法用单条命令完成，输出用 && 连接的组合命令。"},
			{Role: "user", Content: req.Prompt},
		}
		reply, err := client.Chat(messages)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "AI 调用失败："+err.Error())
			return
		}
		log.Println("[ai] 生成命令完成")
		writeJSON(w, http.StatusOK, map[string]any{"result": reply})
	}
}

// GET /api/ai/models?base_url=&api_key= —— 获取模型列表（用于设置页下拉选择）
func listAIModels(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		baseURL := strings.TrimSpace(r.URL.Query().Get("base_url"))
		if baseURL == "" {
			baseURL, _ = database.GetSetting(db, keyAIBaseURL)
		}
		if baseURL == "" {
			baseURL = defaultAIBaseURL
		}
		apiKey := strings.TrimSpace(r.URL.Query().Get("api_key"))
		if apiKey == "" {
			apiKey, _ = utils.Decrypt(secret, getProviderKey(db, baseURL))
		}
		client := ai.NewClient(baseURL, apiKey, "")
		models, err := client.ListModels()
		if err != nil {
			writeErr(w, http.StatusBadGateway, "获取模型列表失败："+err.Error())
			return
		}
		log.Println("[ai] 获取模型列表完成")
		writeJSON(w, http.StatusOK, map[string]any{"models": models})
	}
}

// POST /api/ai/analyze —— 日志/输出分析
func aiAnalyze(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, err := loadAIClient(db, secret)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if strings.TrimSpace(req.Content) == "" {
			writeErr(w, http.StatusBadRequest, "请粘贴要分析的日志或命令输出")
			return
		}
		messages := []ai.Message{
			{Role: "system", Content: ai.SystemPrompt},
			{Role: "user", Content: req.Content},
		}
		reply, err := client.Chat(messages)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "AI 调用失败："+err.Error())
			return
		}
		log.Println("[ai] 日志分析完成")
		writeJSON(w, http.StatusOK, map[string]any{"result": reply})
	}
}
