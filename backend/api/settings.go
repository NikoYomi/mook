package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"mook/ai"
	"mook/database"
	"mook/utils"
)

const (
	keyAIBaseURL   = "ai_base_url"
	keyAIAPIKey    = "ai_api_key"
	keyAIModel     = "ai_model"
	keyAIValidated = "ai_validated"

	defaultAIBaseURL = "https://api.deepseek.com"
	defaultAIModel   = "deepseek-chat"
)

// GET /api/settings/ai —— 读取 AI 设置（绝不返回 API Key 原文）
func getAiSettings(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		baseURL, _ := database.GetSetting(db, keyAIBaseURL)
		model, _ := database.GetSetting(db, keyAIModel)
		encKey, _ := database.GetSetting(db, keyAIAPIKey)
		validated, _ := database.GetSetting(db, keyAIValidated)
		if baseURL == "" {
			baseURL = defaultAIBaseURL
		}
		if model == "" {
			model = defaultAIModel
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"base_url":    baseURL,
			"model":       model,
			"has_api_key": encKey != "",
			"validated":   validated == "1",
		})
	}
}

// POST /api/settings/ai —— 保存 AI 设置（API Key 加密存储）并校验连通性
func saveAiSettings(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			BaseURL string `json:"base_url"`
			Model   string `json:"model"`
			APIKey  string `json:"api_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "请求格式错误")
			return
		}
		if in.BaseURL != "" {
			_ = database.SetSetting(db, keyAIBaseURL, in.BaseURL)
		}
		if in.Model != "" {
			_ = database.SetSetting(db, keyAIModel, in.Model)
		}
		if in.APIKey != "" {
			enc, err := utils.Encrypt(secret, in.APIKey)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "API Key 加密失败")
				return
			}
			_ = database.SetSetting(db, keyAIAPIKey, enc)
		}

		// 读取生效中的配置，并尝试调用模型校验连通性
		baseURL := strings.TrimSpace(in.BaseURL)
		if baseURL == "" {
			baseURL, _ = database.GetSetting(db, keyAIBaseURL)
		}
		if baseURL == "" {
			baseURL = defaultAIBaseURL
		}
		model := strings.TrimSpace(in.Model)
		if model == "" {
			model, _ = database.GetSetting(db, keyAIModel)
		}
		if model == "" {
			model = defaultAIModel
		}
		apiKey := strings.TrimSpace(in.APIKey)
		if apiKey == "" {
			encKey, _ := database.GetSetting(db, keyAIAPIKey)
			apiKey, _ = utils.Decrypt(secret, encKey)
		}

		validated := false
		var verr string
		if apiKey != "" {
			client := ai.NewClient(baseURL, apiKey, model)
			if _, err := client.Chat([]ai.Message{{Role: "user", Content: "ping"}}); err == nil {
				validated = true
			} else {
				verr = err.Error()
			}
		}
		_ = database.SetSetting(db, keyAIValidated, boolStr(validated))
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"validated": validated,
			"error":     verr,
		})
	}
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}