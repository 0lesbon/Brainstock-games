// Escreve o roteiro da narração e a legenda do post.
// Usa o Gemini se GEMINI_API_KEY estiver definida; senão o Claude (ANTHROPIC_API_KEY);
// sem nenhuma das duas, narra o título + resumo do RSS.
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Texto da CAPA do vídeo (o que aparece no 1º segundo): 4 a 8 palavras, curiosidade máxima, pode ser pergunta ou ter número, sem ponto final, nunca falso" },
    narration: { type: "string", description: "Texto que será narrado" },
    caption: { type: "string", description: "Legenda do Instagram: 1ª linha = gancho forte com 1 emoji (é o que aparece antes do 'mais'); depois 2 ou 3 frases curtas; uma pergunta que provoque opinião nos comentários; uma chamada para salvar ou mandar para um amigo; na última linha 'Fonte: <veículo>'" },
    hashtags: { type: "array", items: { type: "string" } },
    imageQueries: {
      type: "array",
      items: { type: "string" },
      description: "3 buscas curtas EM INGLÊS (2 a 3 palavras) para achar fotos do assunto em bancos de imagens: as duas primeiras sobre o objeto, empresa, lugar ou pessoa específica da notícia (ex.: 'Lycurgus Cup', 'James Webb telescope', 'Nvidia chip'); a terceira um conceito genérico que ilustre o tema (ex.: 'ancient glass', 'smartphone', 'money coins')",
    },
  },
  required: ["headline", "narration", "caption", "hashtags", "imageQueries"],
};

const SYSTEM = `Você é o roteirista do @now.noticias, perfil brasileiro de Reels sobre tecnologia, inteligência artificial, ciência, curiosidades e economia do dia a dia.
Seu objetivo é RETENÇÃO: a pessoa está rolando o feed e decide em 1 segundo se fica. Vídeos assistidos até o fim, salvos e compartilhados viralizam.

ESTRUTURA OBRIGATÓRIA DA NARRAÇÃO:
1. GANCHO (1ª frase, até 10 palavras): pare o dedo da pessoa. Antes de escrever, pense em 3 ganchos diferentes e use o mais forte. Modelos que funcionam:
   - pergunta direta para "você" que cria curiosidade ("Você usaria um celular que nunca precisa de carregador?")
   - fato surpreendente com número concreto ("Um cálice de 1.600 anos esconde nanotecnologia.")
   - contradição ou quebra de expectativa ("O vilão da pressão alta não é só o sal.")
   - consequência pessoal ("Isso pode mudar o preço do seu mercado.")
   Proibido começar com "Olá", "Neste vídeo", "Hoje vamos falar", "Você sabia que".
2. LOOP ABERTO (2ª frase): prometa uma revelação que só vem no final ("E o motivo é mais estranho do que parece.").
3. CONTEXTO RÁPIDO: o que é, quem, onde, com 1 ou 2 dados concretos da matéria. Frases de até 12 palavras.
4. VIRADA NO MEIO: uma frase que renova a atenção ("Mas a parte mais curiosa vem agora.", "Só que tem um detalhe.").
5. REVELAÇÃO E IMPORTÂNCIA: feche o loop e explique por que isso importa para quem assiste (bolso, celular, saúde, futuro, como o mundo funciona).
6. FINAL MARCANTE: uma frase curta de impacto, que dá vontade de comentar ou mandar para alguém, seguida de "segundo o <veículo>" ou "segundo a <veículo>".

REGRAS:
- Português do Brasil falado, tom de amigo empolgado contando uma novidade: direto, leve, energético, sem gírias forçadas e sem opinião política.
- Verdade acima de tudo: use apenas fatos do material. Nunca invente números, nomes, falas ou datas. Gancho chamativo SIM, mentira ou exagero NÃO.
- Reescreva com suas palavras; não copie frases da matéria.
- Escrito para ser falado: frases curtas, ritmo rápido, uma ideia por frase, números por extenso quando ajudar a leitura. Sem emojis, hashtags ou markdown na narração.
- Fale com "você" pelo menos duas vezes.
- Em economia, traduza números e termos técnicos para o impacto no bolso.
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
      generationConfig: { temperature: 0.9, responseMimeType: "application/json", responseSchema: SCHEMA },
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
  s.caption = formatCaption(s.caption);
  return s;
}

// Garante a legenda em blocos (o modelo às vezes devolve tudo grudado: "universo?Salve este vídeo")
export function formatCaption(text) {
  let t = text.replace(/\r/g, "").trim();
  t = t.replace(/([.!?…])(?=[A-ZÀ-Ý0-9])/g, "$1 "); // espaço que faltou depois da pontuação
  t = t.replace(/(\p{Extended_Pictographic}\uFE0F?)(?=[A-Za-zÀ-ÿ0-9])/gu, "$1\n\n"); // emoji do gancho seguido de texto
  t = t.replace(/\s*(Fonte:)/, "\n\n$1");
  // blocos: gancho | resumo (até 2 frases) | pergunta | chamada para salvar | fonte
  const blocks = t.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length < 4) {
    const out = [];
    for (const b of blocks) {
      if (/^Fonte:/.test(b) || out.length === 0) {
        out.push(b);
        continue;
      }
      const sentences = b.split(/(?<=[.!?…])\s+/).filter(Boolean);
      const lead = [];
      while (sentences.length && lead.length < 2 && !/\?$/.test(sentences[0])) lead.push(sentences.shift());
      if (lead.length) out.push(lead.join(" "));
      out.push(...sentences);
    }
    t = out.join("\n\n");
  }
  return t.replace(/\n{3,}/g, "\n\n").trim();
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
