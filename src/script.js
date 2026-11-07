// Escreve o roteiro da narração e a legenda do post.
// Usa o Gemini se GEMINI_API_KEY estiver definida; senão o Claude (ANTHROPIC_API_KEY);
// sem nenhuma das duas, narra o título + resumo do RSS.
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Manchete curta para a capa do vídeo, até 70 caracteres" },
    narration: { type: "string", description: "Texto que será narrado" },
    caption: { type: "string", description: "Legenda do Instagram: 2 a 4 frases, uma pergunta para o público comentar e, na última linha, 'Fonte: <veículo>'" },
    hashtags: { type: "array", items: { type: "string" } },
    imageQueries: {
      type: "array",
      items: { type: "string" },
      description: "3 buscas curtas EM INGLÊS (2 a 3 palavras) para achar fotos do assunto em bancos de imagens: as duas primeiras sobre o objeto, empresa, lugar ou pessoa específica da notícia (ex.: 'Lycurgus Cup', 'James Webb telescope', 'Nvidia chip'); a terceira um conceito genérico que ilustre o tema (ex.: 'ancient glass', 'smartphone', 'money coins')",
    },
  },
  required: ["headline", "narration", "caption", "hashtags", "imageQueries"],
};

const SYSTEM = `Você é o roteirista do @now.noticias, perfil brasileiro de Reels no Instagram sobre tecnologia, inteligência artificial, ciência, curiosidades e economia do dia a dia.
Público: brasileiros curiosos de 18 a 40 anos rolando o feed; você tem 1 segundo para prender a atenção.
Regras:
- Escreva em português do Brasil, tom jornalístico mas leve e próximo, claro e direto, sem exagero nem opinião.
- Use apenas fatos presentes no material fornecido. Nunca invente números, nomes, falas ou datas.
- Reescreva com suas próprias palavras; não copie frases da matéria.
- A primeira frase é um gancho curto e curioso (até 10 palavras) que faz a pessoa querer ouvir o resto, sem mentir nem exagerar.
- Depois: o que aconteceu, por que isso importa para quem está assistindo (bolso, celular, dia a dia, futuro) e termine citando a fonte ("segundo o <veículo>").
- Em economia, traduza números e termos técnicos para o impacto no bolso.
- Narração escrita para ser falada: frases curtas, números por extenso quando ajudar a leitura, sem emojis, sem hashtags, sem markdown.
- Hashtags: 5 a 8, sem o símbolo #, misturando o assunto específico e o nicho (ex.: tecnologia, inteligenciaartificial, ciencia, curiosidades, economia).`;

function userPrompt(story, articleText, cfg) {
  return `Veículo: ${story.source}
Título: ${story.title}
Resumo do RSS: ${story.description}
Link: ${story.link}

Texto da matéria:
${articleText || "(não foi possível extrair o texto; use só título e resumo)"}

Assunto do perfil para este vídeo: ${story.category}.
${story.category === "ciencia" ? `Este é um vídeo de DIVULGAÇÃO CIENTÍFICA ATEMPORAL: ele precisa continuar fazendo sentido se alguém assistir daqui a meses.
- Não use referências de tempo relativas ("hoje", "ontem", "nesta semana", "recentemente", "acaba de"); se a data importar, diga o ano.
- Foque no conhecimento: explique o fenômeno ou a descoberta, como funciona e por que é curioso ou importante, como um professor empolgado.
- Termine com um fato curioso ou uma reflexão que dê vontade de salvar e compartilhar o vídeo, e só então cite a fonte.
- Na legenda, nada de "hoje"/"nesta semana"; convide a pessoa a salvar o vídeo.` : ""}
Escreva uma narração de ${cfg.targetWords} palavras (30 a 40 segundos falados).`;
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
  for (const k of ["headline", "narration", "caption"])
    if (typeof s[k] !== "string" || !s[k].trim()) throw new Error(`campo ${k} vazio`);
  if (!Array.isArray(s.hashtags)) s.hashtags = [];
  if (!Array.isArray(s.imageQueries)) s.imageQueries = [];
  return s;
}

function fallbackScript(story) {
  const desc = story.description || "";
  return {
    headline: story.title.slice(0, 90),
    narration: `${story.title}. ${desc} As informações são do ${story.source}.`,
    caption: `${story.title}\n\n${desc.slice(0, 300)}\n\nFonte: ${story.source}`,
    hashtags: ["noticias", "tecnologia", "ciencia", "economia", "curiosidades"],
    imageQueries: [],
  };
}
