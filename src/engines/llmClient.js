const ALLOWED_LLM_ENDPOINTS = new Set(["https://api.openai.com/v1/chat/completions"]);

export function isAllowedLlmEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    url.hash = "";
    return url.protocol === "https:" && ALLOWED_LLM_ENDPOINTS.has(url.toString());
  } catch {
    return false;
  }
}

export const LlmClient = {
  async requestJson(config, messages) {
    if (!isAllowedLlmEndpoint(config.endpoint)) {
      throw new Error("허용된 HTTPS LLM Endpoint만 사용할 수 있습니다.");
    }

    const payload = {
      model: config.model,
      messages,
      temperature: 1.0,
      response_format: { type: "json_object" },
    };

    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 220)}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error("API 응답이 JSON이 아닙니다.");
    }

    const content = data.choices?.[0]?.message?.content || data.output_text || data.content;
    if (!content) {
      throw new Error("API 응답에서 message content를 찾지 못했습니다.");
    }

    return parseJsonContent(content);
  },
};



export function parseJsonContent(content) {
  if (typeof content === "object") return content;
  const trimmed = String(content).trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("message content를 JSON으로 파싱하지 못했습니다.");
  }
}

