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
2. LOOP ABERTO (2ª frase): prometa uma revelação específica que só vem no final. Escreva uma promessa própria deste assunto; não repita fórmulas prontas como "E o motivo é mais estranho do que parece".
3. CONTEXTO RÁPIDO: o que é, quem, onde, com 1 ou 2 dados concretos da matéria. Frases de até 12 palavras.
4. VIRADA NO MEIO: uma frase que renova a atenção ("Mas a parte mais curiosa vem agora.", "Só que tem um detalhe.").
5. REVELAÇÃO E IMPORTÂNCIA: feche o loop e explique por que isso importa para quem assiste (bolso, celular, saúde, futuro, como o mundo funciona).
6. FINAL MARCANTE: uma frase curta de impacto, que dá vontade de comentar ou mandar para alguém, seguida de "segundo o <veículo>" ou "segundo a <veículo>".

QUALIDADE (o que separa um vídeo viral de um vídeo esquecível):
- Cada frase traz uma informação NOVA e concreta: número, nome, lugar, tamanho, consequência. Se a frase pode ser apagada sem perder nada, apague.
- Use pelo menos uma comparação que a pessoa visualiza ("do tamanho de três campos de futebol", "mais quente que a superfície do Sol", "o preço de um cafezinho por dia").
- Explique o "como" ou o "porquê", não só o "o quê". O público tem que sair sabendo algo que não sabia.
- PROIBIDO frases vazias e genéricas, como: "isso mostra a importância de...", "o futuro é promissor", "o mercado está mudando", "protegendo seu futuro", "isso pode mudar tudo", "fique ligado", "é impressionante". Diga O QUE muda e PARA QUEM.
- Exemplo de frase fraca: "A descoberta pode ajudar a ciência no futuro." Forte: "Com isso, um exame que hoje leva duas semanas pode sair em vinte minutos."

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

// Ordem dos provedores: script.provider ("claude" ou "gemini") primeiro, o outro de reserva.
function providers(cfg) {
  const order = (cfg.provider || "claude") === "gemini" ? ["gemini", "claude"] : ["claude", "gemini"];
  return order.filter((p) => (p === "claude" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY));
}

async function callModel(provider, { system, user, schema, cfg, effort }) {
  return provider === "claude" ? claudeJson({ system, user, schema, cfg, effort }) : geminiJson({ system, user, schema, cfg });
}

export async function writeScript(story, articleText, cfg) {
  for (const p of providers(cfg)) {
    try {
      const s = validate(await callModel(p, { system: SYSTEM, user: userPrompt(story, articleText, cfg), schema: SCHEMA, cfg, effort: cfg.claudeEffort || "medium" }));
      console.log(`[roteiro] escrito por ${p}`);
      return s;
    } catch (err) {
      console.warn(`[roteiro] ${p} falhou (${err.message})`);
    }
  }
  console.warn("[roteiro] nenhuma IA disponível: usando o resumo do RSS como narração.");
  return fallbackScript(story);
}

// ---------- Escolha da notícia ----------
const CHOOSE_SCHEMA = {
  type: "object",
  properties: {
    index: { type: "integer", description: "Número da notícia escolhida" },
    reason: { type: "string", description: "Por que ela tem mais potencial, em uma frase" },
  },
  required: ["index", "reason"],
};

const CHOOSE_SYSTEM = `Você é o editor-chefe do @now.noticias, perfil de Reels sobre tecnologia, IA, ciência, curiosidades e economia do dia a dia.
Escolha UMA notícia da lista para virar o próximo Reel de 35 segundos. Critérios, em ordem:
1. Faz a pessoa parar de rolar o feed: surpreendente, curiosa, "eu não sabia disso", ou afeta diretamente a vida/bolso/celular de quem assiste.
2. Rende uma explicação interessante (um fenômeno, uma descoberta, uma mudança concreta), não só um anúncio.
3. Público amplo brasileiro, não nicho de especialista.
DESCARTE: propaganda ou prêmio de empresa, resultado trimestral de empresa pouco conhecida, serviço do dia (fase da Lua, previsão do tempo, cotação), listas de compras/filmes/ofertas, eventos institucionais, política partidária, crimes e tragédias.`;

export async function chooseStory(candidates, cfg) {
  const list = candidates.map((c, i) => `${i}. [${c.source}] ${c.title}${c.description ? ` — ${c.description.slice(0, 160)}` : ""}`).join("\n");
  for (const p of providers(cfg)) {
    try {
      const r = await callModel(p, { system: CHOOSE_SYSTEM, user: `Notícias candidatas:\n${list}`, schema: CHOOSE_SCHEMA, cfg, effort: "low" });
      const pick = candidates[r.index];
      if (pick) {
        console.log(`[news] ${p} escolheu #${r.index} de ${candidates.length}: ${r.reason}`);
        return pick;
      }
    } catch (err) {
      console.warn(`[news] escolha por ${p} falhou (${err.message})`);
    }
  }
  return candidates[0];
}

async function geminiJson({ system, user, schema, cfg }) {
  const model = cfg.geminiModel || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.9, responseMimeType: "application/json", responseSchema: schema },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new Error(`Gemini sem resposta (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason})`);
  return JSON.parse(text);
}

export async function claudeJson({ system, user, schema, cfg, effort = "medium" }) {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: cfg.claudeModel || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema: { ...schema, additionalProperties: false } } },
    system,
    messages: [{ role: "user", content: user }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("o modelo recusou esta notícia");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
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
