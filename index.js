import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { isApiKeyConfigured, generateLocalResponse } from "./localAi.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "../dist");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(distPath));

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const useClaude = isApiKeyConfigured(API_KEY);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiMode: useClaude ? "claude" : "local" });
});

app.post("/api/claude", async (req, res) => {
  const { system, prompt, context } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing 'prompt' in request body." });
  }

  if (!useClaude) {
    const text = generateLocalResponse({ system, prompt, context });
    return res.json({ text, mode: "local" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: system || undefined,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errText}` });
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.json({ text, mode: "claude" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distPath, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  const mode = useClaude ? "Claude API" : "local (no API key)";
  console.log(`AI Data Analyst backend listening on http://localhost:${PORT} [${mode}]`);
});
