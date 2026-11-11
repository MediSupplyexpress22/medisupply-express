import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "Server setup incomplete: GEMINI_API_KEY secret is missing." }, 500);

    const body = await req.json();
    const imageBase64 = String(body?.imageBase64 || "");
    const mimeType = String(body?.mimeType || "");
    if (!imageBase64 || imageBase64.length > 11_200_000) return json({ error: "Image is missing or too large." }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return json({ error: "Only JPG, PNG and WEBP images are supported." }, 400);

    const prompt = `Read this medical-store product order list. It may be handwritten or printed, in English, Hindi, or mixed. Extract only the product/medicine names and requested quantities. Ignore prices, totals, headers, addresses, phone numbers, and unrelated notes. Preserve the product name as written; do not guess or invent unreadable names. If quantity is absent or unclear, use 1. Return ONLY valid JSON in this exact shape: {"items":[{"name":"product name","quantity":1}]}. If a line cannot be read confidently, omit it. Do not include markdown fences.`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error", result);
      return json({ error: "Image reading service returned an error. Check Gemini API key, quota and model access." }, 502);
    }
    const text = result?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
    let parsed: { items?: Array<{ name?: string; quantity?: number }> };
    try { parsed = JSON.parse(text); } catch { return json({ error: "Could not read the product list. Please upload a clearer photo." }, 422); }
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((item) => ({ name: String(item.name || "").trim().slice(0, 120), quantity: Math.max(1, Math.min(10000, Math.floor(Number(item.quantity) || 1))) }))
      .filter((item) => item.name.length > 0)
      .slice(0, 100);
    return json({ items });
  } catch (error) {
    console.error("photo-order-ocr error", error);
    return json({ error: "Unexpected photo processing error." }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
      }
        
