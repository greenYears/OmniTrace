use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatResponse {
    pub choices: Vec<ChatChoice>,
    pub usage: Option<UsageInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatChoice {
    pub message: ChatMessageResponse,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessageResponse {
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UsageInfo {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone)]
pub struct LlmClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
    temperature: f64,
    max_output_tokens: u32,
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RETRIES: u32 = 3;

impl LlmClient {
    pub fn new(
        base_url: String,
        api_key: String,
        model: String,
        temperature: f64,
        max_output_tokens: u32,
    ) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .with_context(|| "build HTTP client")?;

        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            model,
            temperature,
            max_output_tokens,
        })
    }

    pub async fn chat_completion(&self, messages: Vec<ChatMessage>) -> Result<ChatResponse> {
        let url = format!("{}/chat/completions", self.base_url);

        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_output_tokens,
        });

        let mut last_error = None;
        for attempt in 0..MAX_RETRIES {
            if attempt > 0 {
                let delay = Duration::from_secs(1 << (2 * attempt)); // 1s, 4s, 16s
                tokio::time::sleep(delay).await;
            }

            let result = self
                .http
                .post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await;

            match result {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        let chat_response: ChatResponse = response
                            .json()
                            .await
                            .with_context(|| "parse LLM response JSON")?;
                        return Ok(chat_response);
                    }

                    let status_code = status.as_u16();
                    let body_text = response.text().await.unwrap_or_default();

                    if should_retry(status_code) && attempt < MAX_RETRIES - 1 {
                        last_error = Some(format!("HTTP {status_code}: {body_text}"));
                        continue;
                    }

                    bail!("LLM request failed with HTTP {status_code}: {body_text}");
                }
                Err(e) => {
                    if e.is_timeout() && attempt < MAX_RETRIES - 1 {
                        last_error = Some(format!("timeout: {e}"));
                        continue;
                    }
                    if e.is_connect() && attempt < MAX_RETRIES - 1 {
                        last_error = Some(format!("connection error: {e}"));
                        continue;
                    }
                    bail!("LLM request failed: {e}");
                }
            }
        }

        bail!(
            "LLM request failed after {MAX_RETRIES} retries. Last error: {}",
            last_error.unwrap_or_default()
        )
    }

    pub fn model(&self) -> &str {
        &self.model
    }
}

fn should_retry(status_code: u16) -> bool {
    matches!(status_code, 429 | 500 | 502 | 503 | 504)
}

impl ChatResponse {
    pub fn content(&self) -> Option<&str> {
        self.choices
            .first()
            .and_then(|c| c.message.content.as_deref())
    }
}
