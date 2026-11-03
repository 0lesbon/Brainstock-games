// Escreve o roteiro da narração e a legenda do post com o Claude.
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
  additionalProperties: false,
};

const SYSTEM = `Você é o roteirista de um perfil brasileiro de notícias em vídeos curtos (Reels/Shorts).
Regras:
- Escreva em português do Brasil, tom jornalístico, claro e direto, sem sensacionalismo nem opinião.
- Use apenas fatos presentes no material fornecido. Nunca invente números, nomes, falas ou datas.
- Reescreva com suas próprias palavras; não copie frases da matéria.
- A narração começa com um gancho forte na primeira frase, explica o que aconteceu, por que importa e termina citando a fonte ("segundo o <veículo>").
- Narração escrita para ser falada: frases curtas, números por extenso quando ajudar a leitura, sem emojis, sem hashtags, sem markdown.
- Hashtags: 4 a 6, sem o símbolo #, relevantes para o assunto.`;

export async function writeScript(story, articleText, cfg) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[script] ANTHROPIC_API_KEY ausente: usando o resumo do RSS como narração.");
    return fallbackScript(story);
  }

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: cfg.model,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Veículo: ${story.source}
Título: ${story.title}
Resumo do RSS: ${story.description}
Link: ${story.link}

Texto da matéria:
${articleText || "(não foi possível extrair o texto; use só título e resumo)"}

Escreva uma narração de ${cfg.targetWords} palavras.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn("[script] o modelo recusou esta notícia; usando o resumo do RSS.");
    return fallbackScript(story);
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`Resposta sem texto (stop_reason=${response.stop_reason})`);
  return JSON.parse(text);
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
