const config = require("./config");

// Calls the NVIDIA (OpenAI-compatible) chat completions API and returns plain text.
async function chat(system, user, { temperature = 0.4, maxTokens = 1800 } = {}) {
  if (!config.aiKey) throw new Error("AI_API_KEY is not set");
  const res = await fetch(config.aiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + config.aiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model: config.aiModel,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: "/no_think\n" + system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`AI API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return stripThinking(data.choices?.[0]?.message?.content || "");
}

function stripThinking(s) {
  return String(s).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

// Extracts the first JSON object from a model reply (tolerates ```json fences and stray text).
function parseJson(text) {
  const s = stripThinking(text).replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("AI reply had no JSON");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("AI reply had incomplete JSON");
}

async function chatJson(system, user, opts) {
  const first = await chat(system, user, opts);
  try {
    return parseJson(first);
  } catch {
    const retry = await chat(system, user + "\n\nReturn ONLY one valid JSON object, nothing else.", { ...opts, temperature: 0.1 });
    return parseJson(retry);
  }
}

module.exports = { chat, chatJson, parseJson, stripThinking };
