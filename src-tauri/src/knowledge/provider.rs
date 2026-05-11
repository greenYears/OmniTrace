use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};
use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

use super::models::LlmProvider;

const KEYCHAIN_SERVICE_PREFIX: &str = "com.omnitrace.llm-provider";

pub fn store_api_key(provider_id: &str, api_key: &str) -> Result<()> {
    let service = format!("{KEYCHAIN_SERVICE_PREFIX}.{provider_id}");
    // Delete existing entry first (ignore errors if not found)
    let _ = delete_generic_password(&service, "api_key");
    set_generic_password(&service, "api_key", api_key.as_bytes())
        .with_context(|| format!("store API key in Keychain for provider {provider_id}"))?;
    Ok(())
}

pub fn load_api_key(provider_id: &str) -> Result<String> {
    let service = format!("{KEYCHAIN_SERVICE_PREFIX}.{provider_id}");
    let bytes = get_generic_password(&service, "api_key")
        .with_context(|| format!("load API key from Keychain for provider {provider_id}"))?;
    String::from_utf8(bytes).with_context(|| "API key is not valid UTF-8")
}

pub fn delete_api_key(provider_id: &str) -> Result<()> {
    let service = format!("{KEYCHAIN_SERVICE_PREFIX}.{provider_id}");
    let _ = delete_generic_password(&service, "api_key");
    Ok(())
}

pub fn list_providers(conn: &Connection) -> Result<Vec<LlmProvider>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, base_url, model, temperature, max_output_tokens, max_cost_per_run, input_price_per_1k, output_price_per_1k, enabled, created_at, updated_at FROM llm_providers ORDER BY created_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(LlmProvider {
            id: row.get(0)?,
            name: row.get(1)?,
            base_url: row.get(2)?,
            model: row.get(3)?,
            temperature: row.get(4)?,
            max_output_tokens: row.get(5)?,
            max_cost_per_run: row.get(6)?,
            input_price_per_1k: row.get(7)?,
            output_price_per_1k: row.get(8)?,
            enabled: row.get::<_, i32>(9)? != 0,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .with_context(|| "collect llm_providers rows")
}

pub fn save_provider(conn: &Connection, provider: &LlmProvider, api_key: &str) -> Result<()> {
    conn.execute(
        r#"INSERT INTO llm_providers (id, name, base_url, model, temperature, max_output_tokens, max_cost_per_run, input_price_per_1k, output_price_per_1k, enabled, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             base_url = excluded.base_url,
             model = excluded.model,
             temperature = excluded.temperature,
             max_output_tokens = excluded.max_output_tokens,
             max_cost_per_run = excluded.max_cost_per_run,
             input_price_per_1k = excluded.input_price_per_1k,
             output_price_per_1k = excluded.output_price_per_1k,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at"#,
        rusqlite::params![
            provider.id,
            provider.name,
            provider.base_url,
            provider.model,
            provider.temperature,
            provider.max_output_tokens,
            provider.max_cost_per_run,
            provider.input_price_per_1k,
            provider.output_price_per_1k,
            provider.enabled as i32,
            provider.created_at,
            provider.updated_at,
        ],
    )?;

    if !api_key.is_empty() {
        store_api_key(&provider.id, api_key)?;
    }

    Ok(())
}

pub fn delete_provider(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM llm_providers WHERE id = ?1", [id])?;
    delete_api_key(id)?;
    Ok(())
}

pub fn get_enabled_provider(conn: &Connection) -> Result<Option<LlmProvider>> {
    let result = conn
        .query_row(
            "SELECT id, name, base_url, model, temperature, max_output_tokens, max_cost_per_run, input_price_per_1k, output_price_per_1k, enabled, created_at, updated_at FROM llm_providers WHERE enabled = 1 LIMIT 1",
            [],
            |row| {
                Ok(LlmProvider {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    base_url: row.get(2)?,
                    model: row.get(3)?,
                    temperature: row.get(4)?,
                    max_output_tokens: row.get(5)?,
                    max_cost_per_run: row.get(6)?,
                    input_price_per_1k: row.get(7)?,
                    output_price_per_1k: row.get(8)?,
                    enabled: row.get::<_, i32>(9)? != 0,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .optional()?;
    Ok(result)
}
