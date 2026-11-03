// Escreve o roteiro da narração e a legenda do post.
// Usa o Gemini se GEMINI_API_KEY estiver definida; senão o Claude (ANTHROPIC_API_KEY);
// sem nenhuma das duas, narra o título + resumo do RSS.
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Manchete curta para a capa do vídeo, até 70 caracteres" },
    narration: { type: "string", description: "Texto que será narrado" },
    caption: { type: "string", description: "Legenda do post, 2 a 4 frases, terminando com a fonte" },
    hashtags: { type: "array", items: { type: "string" } },
    youtubeTitle: { type: "string", description: "Título para o YouTube Shorts, até 90 caracteres" },
  },
  required: ["headline", "narration", "caption", "hashtags", "youtubeTitle"],
};

const SYSTEM = `Você é o roteirista de um perfil brasileiro de notícias em vídeos curtos (Reels/Shorts).
Regras:
- Escreva em português do Brasil, tom jornalístico, claro e direto, sem sensacionalismo nem opinião.
- Use apenas fatos presentes no material fornecido. Nunca invente números, nomes, falas ou datas.
- Reescreva com suas próprias palavras; não copie frases da matéria.
- A narração começa com um gancho forte na primeira frase, explica o que aconteceu, por que importa e termina citando a fonte ("segundo o <veículo>").
- Narração escrita para ser falada: frases curtas, números por extenso quando ajudar a leitura, sem emojis, sem hashtags, sem markdown.
- Hashtags: 4 a 6, sem o símbolo #, relevantes para o assunto.`;

function userPrompt(story, articleText, cfg) {
  return `Veículo: ${story.source}
Título: ${story.title}
Resumo do RSS: ${story.description}
Link: ${story.link}

Texto da matéria:
${articleText || "(não foi possível extrair o texto; use só título e resumo)"}

Escreva uma narração de ${cfg.targetWords} palavras.`;
}

export async function writeScript(story, articleText, cfg) {
  try {
    if (process.env.GEMINI_API_KEY) return validate(await withGemini(story, articleText, cfg));
    if (process.env.ANTHROPIC_API_KEY) return validate(await withClaude(story, articleText, cfg));
    console.warn("[script] nenhuma chave de IA definida: usando o resumo do RSS como narração.");
  } catch (err) {
    console.warn(`[script] falha ao gerar roteiro (${err.message}); usando o resumo do RSS.`);
  }
  return fallbackScript(story);
}

async function withGemini(story, articleText, cfg) {
  const model = cfg.geminiModel || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(story, articleText, cfg) }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new Error(`Gemini sem resposta (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason})`);
  return JSON.parse(text);
}

async function withClaude(story, articleText, cfg) {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: cfg.claudeModel || "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: { ...SCHEMA, additionalProperties: false } } },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(story, articleText, cfg) }],
  });
  if (response.stop_reason === "refusal") throw new Error("o modelo recusou esta notícia");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`resposta sem texto (stop_reason=${response.stop_reason})`);
  return JSON.parse(text);
}

function validate(s) {
  for (const k of ["headline", "narration", "caption", "youtubeTitle"])
    if (typeof s[k] !== "string" || !s[k].trim()) throw new Error(`campo ${k} vazio`);
  if (!Array.isArray(s.hashtags)) s.hashtags = [];
  return s;
}

function fallbackScript(story) {
  const desc = story.description || "";
  return {
    headline: story.title.slice(0, 90),
    narration: `${story.title}. ${desc} As informações são do ${story.source}.`,
    caption: `${story.title}\n\n${desc.slice(0, 300)}\n\nFonte: ${story.source}`,
    hashtags: ["noticias", "brasil", "urgente", "informacao"],
    youtubeTitle: story.title.slice(0, 90),
  };
}
