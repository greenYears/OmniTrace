import { useEffect, useState } from "react";

import { useKnowledgeStore } from "../../stores/useKnowledgeStore";
import type { LlmProvider, SaveProviderInput } from "../../types/knowledge";

export function ProviderSection() {
  const providers = useKnowledgeStore((s) => s.providers);
  const loadProviders = useKnowledgeStore((s) => s.loadProviders);
  const saveProvider = useKnowledgeStore((s) => s.saveProvider);
  const deleteProvider = useKnowledgeStore((s) => s.deleteProvider);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SaveProviderInput>(defaultForm());

  useEffect(() => {
    loadProviders().catch(console.error);
  }, [loadProviders]);

  function defaultForm(): SaveProviderInput {
    return {
      name: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      temperature: 0.3,
      maxOutputTokens: 4096,
      maxCostPerRun: null,
      inputPricePer1k: null,
      outputPricePer1k: null,
      enabled: true,
      apiKey: "",
    };
  }

  function startEdit(provider: LlmProvider) {
    setEditingId(provider.id);
    setShowForm(true);
    setForm({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      temperature: provider.temperature,
      maxOutputTokens: provider.maxOutputTokens,
      maxCostPerRun: provider.maxCostPerRun,
      inputPricePer1k: provider.inputPricePer1k,
      outputPricePer1k: provider.outputPricePer1k,
      enabled: provider.enabled,
      apiKey: "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setForm(defaultForm());
  }

  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    try {
      await saveProvider(form);
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    await deleteProvider(id);
    if (editingId === id) resetForm();
  }

  function updateField<K extends keyof SaveProviderInput>(key: K, value: SaveProviderInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const enabledProvider = providers.find((p) => p.enabled && p.hasApiKey);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <h3 className="settings-card-title">LLM Provider</h3>
        {enabledProvider && (
          <span className="settings-provider-status-active">已就绪</span>
        )}
      </div>
      <div className="settings-card-body">
        {enabledProvider ? (
          <div className="settings-provider-summary">
            <div className="settings-provider-summary-name">{enabledProvider.name}</div>
            <div className="settings-provider-summary-detail">{enabledProvider.model} · {enabledProvider.baseUrl}</div>
          </div>
        ) : (
          <p className="settings-empty">未配置 Provider，知识生成功能需要配置至少一个 LLM Provider</p>
        )}

        {!showForm ? (
          <button
            className="settings-action-btn"
            type="button"
            onClick={() => { setEditingId(null); setForm(defaultForm()); setShowForm(true); }}
          >
            添加 Provider
          </button>
        ) : (
          <form className="settings-provider-form" onSubmit={handleSubmit}>
            <div className="settings-form-grid">
              <label className="settings-field">
                <span>名称</span>
                <input type="text" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="My Provider" required />
              </label>
              <label className="settings-field">
                <span>Model</span>
                <input type="text" value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder="gpt-4o" required />
              </label>
              <label className="settings-field settings-field--wide">
                <span>Base URL</span>
                <input type="url" value={form.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} placeholder="https://api.openai.com/v1" required />
              </label>
              <label className="settings-field settings-field--wide">
                <span>API Key</span>
                <input type="password" value={form.apiKey} onChange={(e) => updateField("apiKey", e.target.value)} placeholder={editingId ? "留空保持不变" : "输入 API Key"} />
              </label>
              <label className="settings-field">
                <span>Temperature: {form.temperature}</span>
                <input type="range" min="0" max="1" step="0.1" value={form.temperature} onChange={(e) => updateField("temperature", Number(e.target.value))} />
              </label>
              <label className="settings-field">
                <span>Max Output Tokens</span>
                <input type="number" value={form.maxOutputTokens} onChange={(e) => updateField("maxOutputTokens", Number(e.target.value))} min={256} max={32768} />
              </label>
              <label className="settings-field">
                <span>费用上限 (USD)</span>
                <input type="number" value={form.maxCostPerRun ?? ""} onChange={(e) => updateField("maxCostPerRun", e.target.value ? Number(e.target.value) : null)} step="0.01" placeholder="无限制" />
              </label>
              <label className="settings-field settings-field--inline">
                <input type="checkbox" checked={form.enabled} onChange={(e) => updateField("enabled", e.target.checked)} />
                <span>启用</span>
              </label>
            </div>
            <div className="settings-provider-actions">
              <button className="settings-action-btn" type="submit">{editingId ? "更新" : "添加"}</button>
              <button className="settings-action-btn settings-action-btn--secondary" type="button" onClick={resetForm}>取消</button>
            </div>
            {submitError && <p className="settings-error">{submitError}</p>}
          </form>
        )}

        {providers.length > 0 && (
          <div className="settings-provider-list">
            {providers.map((p) => (
              <div key={p.id} className="settings-provider-item">
                <div className="settings-provider-item-info">
                  <div className="settings-provider-item-top">
                    <strong>{p.name}</strong>
                    <span className={`settings-provider-badge${p.enabled ? " is-active" : ""}`}>
                      {p.enabled ? "启用" : "禁用"}
                    </span>
                  </div>
                  <span>{p.model} · {p.baseUrl}</span>
                </div>
                <div className="settings-provider-item-actions">
                  <button className="settings-provider-action-btn" type="button" onClick={() => startEdit(p)}>编辑</button>
                  <button className="settings-provider-action-btn settings-provider-action-btn--danger" type="button" onClick={() => handleDelete(p.id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
