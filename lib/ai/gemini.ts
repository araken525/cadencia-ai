// lib/ai/gemini.ts
import { GoogleGenAI } from "@google/genai";

const genai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

export async function geminiText(params: {
  model: string;              // 例: "gemini-2.5-pro" / "gemini-3-flash-preview"
  system: string;
  user: string;
  temperature?: number;
}) {
  if (!genai) return null;

  const res = await genai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: params.user }] }],
    config: {
      systemInstruction: params.system,
      temperature: params.temperature ?? 0.2,
    },
  });

  return res.text?.trim() ?? "";
}