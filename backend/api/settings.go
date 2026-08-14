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
	keyAIBaseURL       = "ai_base_url"
	keyAIAPIKey        = "ai_api_key"
	keyAIModel         = "ai_model"
	keyAIValidated     = "ai_validated"
	keyCustomProviders = "ai_custom_providers"

	defaultAIBaseURL = "https://api.deepseek.com"
	defaultAIModel   = "deepseek-chat"
)

// CustomProvider 自定义厂商的持久化记录（API Key 加密存储）
type CustomProvider struct {
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
	Model   string `json:"model"`
	APIKey  string `json:"-"`
}

// GET /api/settings/ai —— 读取 AI 设置（绝不返回 API Key 原文）
func getAiSettings(db *sql.DB, _ string) http.HandlerFunc {
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
		customProviders := loadCustomProviders(db)
		list := make([]map[string]any, 0, len(customProviders))
		for _, p := range customProviders {
			list = append(list, map[string]any{
				"name":        p.Name,
				"base_url":    p.BaseURL,
				"model":       p.Model,
				"has_api_key": p.APIKey != "",
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"base_url":         baseURL,
			"model":            model,
			"has_api_key":      encKey != "",
			"validated":        validated == "1",
			"custom_providers": list,
		})
	}
}

// POST /api/settings/ai —— 保存 AI 设置（API Key 加密存储）并校验连通性
func saveAiSettings(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			BaseURL    string `json:"base_url"`
			Model      string `json:"model"`
			APIKey     string `json:"api_key"`
			ProviderID string `json:"provider_id"`
			CustomName string `json:"custom_name"`
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

		// 自定义厂商：key 验证通过后持久化，供后续下拉选择、复用
		if validated && in.ProviderID == "custom" && strings.TrimSpace(in.CustomName) != "" {
			if err := saveCustomProvider(db, secret, strings.TrimSpace(in.CustomName), baseURL, model, apiKey); err != nil {
				verr = "自定义厂商保存失败：" + err.Error()
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"validated": validated,
			"error":     verr,
		})
	}
}

// loadCustomProviders 读取全部已保存的自定义厂商
func loadCustomProviders(db *sql.DB) []CustomProvider {
	raw, _ := database.GetSetting(db, keyCustomProviders)
	var list []CustomProvider
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &list)
	}
	if list == nil {
		list = []CustomProvider{}
	}
	return list
}

// saveCustomProvider 按名称 upsert 一个自定义厂商（API Key 加密存储）
func saveCustomProvider(db *sql.DB, secret, name, baseURL, model, apiKey string) error {
	list := loadCustomProviders(db)
	found := false
	for i := range list {
		if list[i].Name == name {
			list[i].BaseURL = baseURL
			list[i].Model = model
			if apiKey != "" {
				enc, err := utils.Encrypt(secret, apiKey)
				if err != nil {
					return err
				}
				list[i].APIKey = enc
			}
			found = true
			break
		}
	}
	if !found {
		enc, err := utils.Encrypt(secret, apiKey)
		if err != nil {
			return err
		}
		list = append(list, CustomProvider{Name: name, BaseURL: baseURL, Model: model, APIKey: enc})
	}
	raw, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return database.SetSetting(db, keyCustomProviders, string(raw))
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}