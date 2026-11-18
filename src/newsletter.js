// Newsletter semanal "NOW em 5 minutos" (Beehiiv).
// 1) junta os vídeos publicados nos últimos 7 dias (state/history.json);
// 2) lê o texto de cada matéria; 3) o Claude escolhe as 6 melhores e escreve a edição;
// 4) monta o HTML (para colar na Beehiiv) e manda por e-mail para revisão.
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { jsonWithFallback } from "./script.js";
import { readArticle } from "./weekly-carousel.js";

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Assunto do e-mail, até 60 caracteres, curioso e concreto (pode ter 1 emoji)" },
    preview: { type: "string", description: "Texto de pré-visualização, até 90 caracteres, complementa o assunto" },
    intro: { type: "string", description: "Abertura de 2 frases, tom próximo e leve, sem clichê" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Número da matéria na lista recebida" },
          emoji: { type: "string", description: "1 emoji que represente o tema" },
          title: { type: "string", description: "Título forte, até 10 palavras" },
          summary: { type: "string", description: "Resumo de 2 ou 3 frases (até 320 caracteres), só com fatos do texto" },
          why: { type: "string", description: "Por que importa para quem lê, 1 frase (até 140 caracteres)" },
        },
        required: ["index", "emoji", "title", "summary", "why"],
        additionalProperties: false,
      },
    },
    curiosity: { type: "string", description: "Fecho com uma curiosidade atemporal tirada de uma das matérias de ciência, 1 ou 2 frases" },
  },
  required: ["subject", "preview", "intro", "items", "curiosity"],
};

const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderHtml(ed, chosen, cfg, links) {
  const accent = cfg.profile.accentColor || "#E11D48";
  const items = ed.items
    .filter((it) => chosen[it.index])
    .map((it, n) => {
      const c = chosen[it.index];
      return `<tr><td style="padding:22px 0;border-top:1px solid #e5e7eb">
  <div style="font:700 12px Arial,sans-serif;letter-spacing:2px;color:${accent}">${String(n + 1).padStart(2, "0")} · ${esc(c.category || "").toUpperCase()}</div>
  <h2 style="margin:6px 0 8px;font:800 22px/1.25 Arial,sans-serif;color:#0b0f19">${esc(it.emoji)} ${esc(it.title)}</h2>
  <p style="margin:0 0 10px;font:16px/1.55 Arial,sans-serif;color:#1f2937">${esc(it.summary)}</p>
  <p style="margin:0 0 10px;font:600 15px/1.5 Arial,sans-serif;color:#111;background:#fff1f2;border-left:4px solid ${accent};padding:10px 12px">👉 ${esc(it.why)}</p>
  <p style="margin:0;font:13px Arial,sans-serif;color:#6b7280">Fonte: <a href="${esc(c.link)}" style="color:#6b7280">${esc(c.source)}</a></p>
</td></tr>`;
    })
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
<tr><td style="padding:8px 0 4px"><span style="background:${accent};color:#fff;font:800 13px Arial,sans-serif;letter-spacing:2px;padding:4px 10px;border-radius:6px">NOW</span>
  <span style="font:800 13px Arial,sans-serif;letter-spacing:2px;color:#0b0f19;margin-left:6px">EM 5 MINUTOS</span></td></tr>
<tr><td style="padding:14px 0 6px"><p style="margin:0;font:17px/1.55 Arial,sans-serif;color:#1f2937">${esc(ed.intro)}</p></td></tr>
${items}
<tr><td style="padding:22px 0;border-top:1px solid #e5e7eb">
  <div style="font:700 12px Arial,sans-serif;letter-spacing:2px;color:${accent}">🤯 CURIOSIDADE DA SEMANA</div>
  <p style="margin:8px 0 0;font:16px/1.55 Arial,sans-serif;color:#1f2937">${esc(ed.curiosity)}</p>
</td></tr>
<tr><td style="padding:22px 16px;background:#0b0f19;border-radius:12px;text-align:center">
  <p style="margin:0 0 12px;font:800 18px Arial,sans-serif;color:#fff">Quer a notícia em 30 segundos, todo dia?</p>
  <p style="margin:0;font:15px/1.8 Arial,sans-serif">
    <a href="${links.instagram}" style="color:#fff">📸 Instagram</a> &nbsp;·&nbsp;
    <a href="${links.tiktok}" style="color:#fff">🎵 TikTok</a> &nbsp;·&nbsp;
    <a href="${links.youtube}" style="color:#fff">▶️ YouTube</a></p>
  <p style="margin:12px 0 0;font:13px Arial,sans-serif;color:#cbd5e1">Gostou? Encaminhe para um amigo. 💌</p>
</td></tr></table>`;
}

function renderText(ed, chosen) {
  const items = ed.items
    .filter((it) => chosen[it.index])
    .map((it, n) => `${String(n + 1).padStart(2, "0")}. ${it.emoji} ${it.title}\n${it.summary}\n👉 ${it.why}\nFonte: ${chosen[it.index].source} (${chosen[it.index].link})`)
    .join("\n\n");
  return `${ed.intro}\n\n${items}\n\n🤯 Curiosidade da semana\n${ed.curiosity}`;
}

export async function buildNewsletter({ cfg, history, outDir, days = 7 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const cutoff = Date.now() - days * 86400000;
  const pool = history.published
    .filter((p) => p.link && new Date(p.emailedAt || p.createdAt).getTime() >= cutoff)
    .slice(-30);
  if (pool.length < 4) throw new Error(`só ${pool.length} vídeos na semana`);

  const material = [];
  for (const [i, p] of pool.entries()) {
    let text = "";
    try {
      text = (await readArticle(p.link)).text;
    } catch (err) {
      console.warn(`[newsletter] não li ${p.link}: ${err.message}`);
    }
    material.push(`### ${i}. [${p.category || "geral"} · ${p.source}] ${p.title}\n${(text || "").slice(0, 1800)}`);
  }

  const ed = await jsonWithFallback({
    system: `Você edita a newsletter semanal "NOW em 5 minutos" do @now.noticias (tecnologia, IA, ciência, curiosidades e economia do bolso; público brasileiro de 18 a 40 anos).
Escolha as 6 matérias mais relevantes e variadas da semana (no máximo 2 do mesmo tema) e escreva a edição.
Regras: português do Brasil, frases curtas, tom de conversa; use APENAS fatos do texto de cada matéria (nunca invente números, nomes ou datas); explique o impacto para quem lê; nada de clichê ("fique ligado", "não perca"); evite tempo relativo ("hoje", "no domingo", "nesta sexta") porque a edição é lida dias depois: use a data (ex.: "em 15 de novembro") ou tire a referência; prefira histórias que continuem valendo ao longo da semana. Ordem: a mais forte primeiro.`,
    user: `Matérias da semana:\n\n${material.join("\n\n")}`,
    schema: SCHEMA,
    cfg: cfg.script,
    effort: cfg.script.claudeEffort || "medium",
  });

  const links = cfg.newsletter?.links || {};
  const html = renderHtml(ed, pool, cfg, links);
  const text = renderText(ed, pool);
  fs.writeFileSync(path.join(outDir, "newsletter.html"), html);
  fs.writeFileSync(path.join(outDir, "newsletter.txt"), `ASSUNTO: ${ed.subject}\nPRÉVIA: ${ed.preview}\n\n${text}\n`);
  return { ...ed, html, text };
}

export async function emailNewsletter({ subject, preview, html, text, outDir }) {
  const user = process.env.GMAIL_USER;
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") } });
  const howTo = `<div style="font:14px/1.5 Arial,sans-serif;background:#f4f4f5;border-radius:10px;padding:14px 16px;margin-bottom:24px;color:#111">
<b>📰 Edição da semana pronta para a Beehiiv</b><br>
1. Na Beehiiv: <b>Start writing</b> → cole o assunto e a prévia abaixo.<br>
2. Selecione tudo a partir da linha "NOW EM 5 MINUTOS" deste e-mail, copie e cole no editor (ou use o anexo <i>newsletter.html</i> num bloco HTML).<br>
3. Revise e clique em <b>Publish → Email</b> (ou agende para 8h).<br><br>
<b>Assunto:</b> ${esc(subject)}<br><b>Prévia:</b> ${esc(preview)}</div>`;
  const info = await transporter.sendMail({
    from: `Robô de Notícias <${user}>`,
    to: process.env.EMAIL_TO || user,
    subject: `📰 Newsletter da semana: ${subject}`,
    text: `ASSUNTO: ${subject}\nPRÉVIA: ${preview}\n\n${text}`,
    html: `<div style="max-width:640px;margin:0 auto">${howTo}${html}</div>`,
    attachments: [{ filename: "newsletter.html", path: path.join(outDir, "newsletter.html"), contentType: "text/html" }],
  });
  return info.messageId;
}
