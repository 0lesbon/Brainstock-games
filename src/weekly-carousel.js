// Carrossel semanal por tema (Tecnologia e IA, Ciência, Curiosidades, Economia).
// 1) junta as notícias dos últimos 7 dias do tema; 2) o Claude escolhe as 10 melhores;
// 3) lê o texto de cada matéria e o Claude escreve os slides; 4) baixa as fotos;
// 5) monta as 12 imagens (capa + 10 + chamada) e manda por e-mail com a legenda.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import nodemailer from "nodemailer";
import { fetchFeeds } from "./news.js";
import { jsonWithFallback } from "./script.js";
import { renderCarousel } from "./carousel.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function decode(s = "") {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

// texto e foto da matéria (sem navegador: mais rápido para 10 matérias)
async function readArticle(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decode(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 80 && !/[{};]/.test(p.slice(0, 40)));
  return { image: og ? decode(og[1]) : null, text: paragraphs.slice(0, 8).join("\n").slice(0, 3500) };
}

async function downloadImage(url, outJpg) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = outJpg + ".raw";
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", raw, "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", outJpg]);
  fs.rmSync(raw, { force: true });
}

const PICK_SCHEMA = {
  type: "object",
  properties: { indexes: { type: "array", items: { type: "integer" } }, reason: { type: "string" } },
  required: ["indexes", "reason"],
};

const SLIDES_SCHEMA = {
  type: "object",
  properties: {
    cover: {
      type: "object",
      properties: {
        kicker: { type: "string", description: "Rótulo curto em maiúsculas, ex.: 'RESUMO DA SEMANA'" },
        title: { type: "string", description: "Título da capa, até 10 palavras, com 2 trechos de destaque entre *asteriscos*" },
        subtitle: { type: "string", description: "Uma frase citando 2 das notícias mais fortes" },
      },
      required: ["kicker", "title", "subtitle"],
      additionalProperties: false,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Número da matéria na lista recebida" },
          category: { type: "string", description: "Rótulo curto em maiúsculas (ex.: IA, ESPAÇO, SAÚDE, BOLSO, GAMES, APPS)" },
          title: { type: "string", description: "Título forte, até 9 palavras, com 1 trecho de destaque entre *asteriscos*" },
          text: { type: "string", description: "Resumo de 2 frases (até 260 caracteres), só com fatos da matéria" },
          data: { type: "string", description: "Destaque final (até 110 caracteres): o número mais impressionante ou uma dica prática, com 1 trecho entre *asteriscos*" },
        },
        required: ["index", "category", "title", "text", "data"],
        additionalProperties: false,
      },
    },
    cta: {
      type: "object",
      properties: { title: { type: "string" }, comment: { type: "string" } },
      required: ["title", "comment"],
      additionalProperties: false,
    },
    caption: { type: "string", description: "Legenda do Instagram: gancho com emoji, lista numerada '01 · título' das 10 notícias, pergunta, chamada para salvar, fontes e 8 hashtags" },
  },
  required: ["cover", "items", "cta", "caption"],
};

export async function buildThemeCarousel({ theme, cfg, outDir, days = 7 }) {
  fs.mkdirSync(path.join(outDir, "img"), { recursive: true });
  const all = await fetchFeeds(cfg.feeds);
  const cutoff = Date.now() - days * 86400000;
  const blocked = cfg.selection.blockKeywords.map(norm);
  const seen = new Set();
  const pool = all
    .filter((x) => theme.categories.includes(x.category))
    .filter((x) => x.publishedAt && x.publishedAt.getTime() >= cutoff)
    .filter((x) => !cfg.selection.blockUrlParts.some((p) => x.link.toLowerCase().includes(p)))
    .filter((x) => !blocked.some((k) => norm(`${x.title} ${x.description}`).includes(k)))
    .filter((x) => (seen.has(x.title.slice(0, 50)) ? false : seen.add(x.title.slice(0, 50))))
    .slice(0, 120);
  console.log(`[carrossel:${theme.id}] ${pool.length} candidatas`);
  if (pool.length < 10) throw new Error("poucas notícias para montar o carrossel");

  // 1) escolha das 10 (com 4 reservas, caso alguma matéria não abra)
  const list = pool.map((c, i) => `${i}. [${c.source}] ${c.title}${c.description ? ` — ${c.description.slice(0, 140)}` : ""}`).join("\n");
  const pick = await jsonWithFallback({
    system: `Você é o editor-chefe do @now.noticias. Monte o carrossel semanal "${theme.name}".
${theme.brief}
Escolha as 14 notícias da semana com mais potencial (as 10 primeiras são as titulares, em ordem de impacto; as 4 últimas são reservas).
Critérios: faz a pessoa parar de rolar, afeta a vida/bolso/celular de quem lê ou é surpreendente; assuntos variados (não repita o mesmo caso).
DESCARTE: ofertas e listas de compras, propaganda de empresa, serviço do dia (fase da Lua, cotação), eventos institucionais, política partidária, crimes, tragédias.`,
    user: `Notícias da semana:\n${list}`,
    schema: PICK_SCHEMA,
    cfg: cfg.script,
    effort: "low",
  });
  console.log(`[carrossel:${theme.id}] escolhidas: ${pick.indexes.join(", ")}`);

  // 2) ler as matérias escolhidas
  const chosen = [];
  for (const idx of pick.indexes) {
    if (chosen.length >= 10) break;
    const story = pool[idx];
    if (!story) continue;
    try {
      const art = await readArticle(story.link);
      const image = art.image || story.image;
      if (!image) throw new Error("sem foto");
      const file = path.join(outDir, "img", `n${chosen.length + 1}.jpg`);
      await downloadImage(image, file);
      chosen.push({ idx, story, text: art.text || story.description, image: path.relative(outDir, file) });
    } catch (err) {
      console.warn(`[carrossel:${theme.id}] pulando "${story.title.slice(0, 60)}": ${err.message}`);
    }
  }
  if (chosen.length < 8) throw new Error(`só ${chosen.length} matérias utilizáveis`);

  // 3) textos dos slides
  const material = chosen.map((c, i) => `### ${i}. [${c.story.source}] ${c.story.title}\n${c.text}`).join("\n\n");
  const slides = await jsonWithFallback({
    system: `Você escreve o carrossel semanal "${theme.name}" do @now.noticias (Instagram, público brasileiro de 18 a 40 anos).
${theme.brief}
Regras: português do Brasil, direto e leve; use APENAS fatos do texto de cada matéria (nunca invente números, nomes ou datas); explique o impacto para quem lê; nada de frases vazias.
Capa: título curto e chamativo no estilo "As ${chosen.length} notícias de ... que você perdeu", com 2 destaques entre *asteriscos*.
Mantenha a ordem das matérias recebidas (index 0, 1, 2...).`,
    user: `Matérias:\n\n${material}`,
    schema: SLIDES_SCHEMA,
    cfg: cfg.script,
    effort: cfg.script.claudeEffort || "medium",
  });

  const data = {
    cover: { ...slides.cover, image: chosen[0].image, period: theme.period },
    items: slides.items
      .filter((it) => chosen[it.index])
      .map((it) => ({ ...it, image: chosen[it.index].image, source: chosen[it.index].story.source })),
    cta: { ...slides.cta, follow: "Tecnologia, ciência e economia em 30 segundos, todo dia." },
  };
  const dataFile = path.join(outDir, "data.json");
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  const files = await renderCarousel(dataFile, path.join(outDir, "slides"), cfg.profile);
  fs.writeFileSync(path.join(outDir, "legenda.txt"), slides.caption);
  return { files, caption: slides.caption, title: data.cover.title.replace(/\*/g, "") };
}

export async function emailCarousel({ files, caption, title, themeName }) {
  const user = process.env.GMAIL_USER;
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") } });
  const info = await transporter.sendMail({
    from: `Robô de Notícias <${user}>`,
    to: process.env.EMAIL_TO || user,
    subject: `🖼️ Carrossel ${themeName}: ${title}`,
    text: `Carrossel pronto (${files.length} imagens, 1080x1350). Poste na ordem dos anexos (01 primeiro).\n\nLEGENDA (copie e cole):\n\n${caption}\n`,
    attachments: files.map((f) => ({ filename: path.basename(f), path: f, contentType: "image/jpeg" })),
  });
  return info.messageId;
}
