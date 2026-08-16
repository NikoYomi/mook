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
	keyAIProviderKeys  = "ai_provider_keys"

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

// migrateLegacyProviderKey 将旧版单一 ai_api_key 持久化到按厂商密钥表（幂等，仅迁移一次）。
// 旧版本只有 ai_api_key 一个密钥；若不写回 ai_provider_keys，保存新厂商时该密钥会被静默覆盖丢失。
func migrateLegacyProviderKey(db *sql.DB) {
	enc, _ := database.GetSetting(db, keyAIAPIKey)
	if enc == "" {
		return
	}
	baseURL, _ := database.GetSetting(db, keyAIBaseURL)
	if baseURL == "" {
		baseURL = defaultAIBaseURL
	}
	m := loadProviderKeys(db)
	key := normalizeAIBaseURL(baseURL)
	if _, ok := m[key]; ok {
		return // 已迁移
	}
	m[key] = enc
	raw, err := json.Marshal(m)
	if err != nil {
		return
	}
	_ = database.SetSetting(db, keyAIProviderKeys, string(raw))
}

// GET /api/settings/ai —— 读取 AI 设置（绝不返回 API Key 原文）
func getAiSettings(db *sql.DB, _ string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		migrateLegacyProviderKey(db)
		baseURL, _ := database.GetSetting(db, keyAIBaseURL)
		model, _ := database.GetSetting(db, keyAIModel)
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
		// 每个厂商（按 base_url 区分）是否已配置密钥
		providerKeys := loadProviderKeys(db)
		// 兼容旧数据：仅存有 legacy ai_api_key 时，把当前 base_url 视为已配置
		if _, ok := providerKeys[normalizeAIBaseURL(baseURL)]; !ok {
			if enc, _ := database.GetSetting(db, keyAIAPIKey); enc != "" {
				providerKeys[normalizeAIBaseURL(baseURL)] = enc
			}
		}
		hasKeys := map[string]bool{}
		for k, v := range providerKeys {
			hasKeys[k] = v != ""
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"base_url":         baseURL,
			"model":            model,
			"has_api_key":      hasKeys[normalizeAIBaseURL(baseURL)],
			"validated":        validated == "1",
			"custom_providers": list,
			"provider_keys":    hasKeys,
		})
	}
}

// POST /api/settings/ai —— 保存 AI 设置（API Key 加密存储）并校验连通性
func saveAiSettings(db *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 先迁移旧版单密钥，防止下方覆盖 ai_api_key 时丢失该密钥
		migrateLegacyProviderKey(db)
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

		// 读取生效中的 base_url（先落库再取，保证与刚保存一致）
		baseURL := strings.TrimSpace(in.BaseURL)
		if baseURL == "" {
			baseURL, _ = database.GetSetting(db, keyAIBaseURL)
		}
		if baseURL == "" {
			baseURL = defaultAIBaseURL
		}

		// API Key：既存 legacy 单 key，也按 base_url 存入各厂商独立密钥表
		if in.APIKey != "" {
			enc, err := utils.Encrypt(secret, in.APIKey)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "API Key 加密失败")
				return
			}
			_ = database.SetSetting(db, keyAIAPIKey, enc)
			_ = saveProviderKey(db, baseURL, enc)
		}

		// 读取生效中的配置，并尝试调用模型校验连通性
		model := strings.TrimSpace(in.Model)
		if model == "" {
			model, _ = database.GetSetting(db, keyAIModel)
		}
		if model == "" {
			model = defaultAIModel
		}
		apiKey := strings.TrimSpace(in.APIKey)
		if apiKey == "" {
			encKey := getProviderKey(db, baseURL)
			apiKey, _ = utils.Decrypt(secret, encKey)
		}

		validated := false
		var verr string
		if apiKey != "" {
			client := ai.NewClient(baseURL, apiKey, model)
			// 优先用模型列表接口验证（GET /models，快、不消耗 token）；
			// 少数服务不提供 /models 时回退到一次最小对话验证。
			if _, err := client.ListModels(); err == nil {
				validated = true
			} else if _, err := client.Chat([]ai.Message{{Role: "user", Content: "ping"}}); err == nil {
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

// normalizeAIBaseURL 规范化接口地址，用于作为各厂商密钥的存储键
func normalizeAIBaseURL(u string) string {
	u = strings.ToLower(strings.TrimSpace(u))
	return strings.TrimRight(u, "/")
}

// loadProviderKeys 读取各厂商（按 base_url 规范化键）的加密 API Key 表
func loadProviderKeys(db *sql.DB) map[string]string {
	raw, _ := database.GetSetting(db, keyAIProviderKeys)
	if raw == "" {
		return map[string]string{}
	}
	m := map[string]string{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string]string{}
	}
	return m
}

// getProviderKey 返回指定 base_url 对应的已加密 API Key（若无该厂商独立密钥则回退 legacy ai_api_key）
func getProviderKey(db *sql.DB, baseURL string) string {
	if baseURL == "" {
		baseURL = defaultAIBaseURL
	}
	key := normalizeAIBaseURL(baseURL)
	m := loadProviderKeys(db)
	if enc, ok := m[key]; ok && enc != "" {
		return enc
	}
	enc, _ := database.GetSetting(db, keyAIAPIKey)
	return enc
}

// saveProviderKey 按 base_url 保存某个厂商的加密 API Key
func saveProviderKey(db *sql.DB, baseURL, enc string) error {
	m := loadProviderKeys(db)
	m[normalizeAIBaseURL(baseURL)] = enc
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return database.SetSetting(db, keyAIProviderKeys, string(raw))
}
