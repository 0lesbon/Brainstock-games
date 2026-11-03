// Modo semiautomático: envia o vídeo pronto + legenda por e-mail (Gmail) para você postar pelo celular.
import nodemailer from "nodemailer";
import fs from "node:fs";

const MAX_ATTACH_BYTES = 24 * 1024 * 1024; // limite do Gmail é 25 MB

function esc(s = "") {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export function emailReady() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendVideoEmail({ script, story, voiceName, duration, videoPath, coverPath, downloadUrl }) {
  const user = process.env.GMAIL_USER;
  const to = process.env.EMAIL_TO || user;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  });

  const tags = script.hashtags.map((h) => `#${h.replace(/^#/, "").replace(/\s+/g, "")}`).join(" ");
  const caption = `${script.caption}\n\n${tags}`;
  const videoSize = fs.statSync(videoPath).size;
  const attachVideo = videoSize <= MAX_ATTACH_BYTES;

  const text = `NOVO VÍDEO PRONTO PARA POSTAR

LEGENDA (Instagram):
${caption}

Notícia original: ${story.link} (${story.source})
Voz: ${voiceName} · Duração: ${duration.toFixed(0)} s
${downloadUrl ? `Baixar o vídeo: ${downloadUrl}` : ""}${attachVideo ? "" : "\n(O vídeo passou de 25 MB e não foi anexado; use o link acima.)"}

Ao postar no Instagram: Reel, ative "Rótulo de IA" em Configurações avançadas.`;

  const box = "background:#f4f4f5;border-radius:10px;padding:14px 16px;white-space:pre-wrap;font-size:15px;line-height:1.45;color:#111";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111">
  <h2 style="margin:0 0 6px">🎬 Novo vídeo pronto para postar</h2>
  <p style="margin:0 0 16px;color:#555">${esc(story.source)} · voz: ${esc(voiceName)} · ${duration.toFixed(0)} s</p>
  <p style="margin:0 0 6px"><b>Legenda do Instagram</b> — toque e segure para copiar:</p>
  <div style="${box}">${esc(caption)}</div>
  <p style="margin:18px 0 0">
    ${downloadUrl ? `<a href="${esc(downloadUrl)}">⬇️ Baixar o vídeo</a> · ` : ""}
    <a href="${esc(story.link)}">Notícia original</a>
  </p>
  ${attachVideo ? "" : `<p style="color:#b45309">O vídeo passou de 25 MB e não foi anexado; use o link de download.</p>`}
  <p style="margin-top:18px;color:#777;font-size:13px">Ao postar: Reel, ative "Rótulo de IA" em Configurações avançadas.</p>
</div>`;

  const attachments = [{ filename: "capa.png", path: coverPath }];
  if (attachVideo) attachments.unshift({ filename: "video.mp4", path: videoPath, contentType: "video/mp4" });

  const info = await transporter.sendMail({
    from: `Robô de Notícias <${user}>`,
    to,
    subject: `🎬 Novo vídeo: ${script.headline}`,
    text,
    html,
    attachments,
  });
  return info.messageId;
}
