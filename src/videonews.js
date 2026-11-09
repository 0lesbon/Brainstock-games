// Modo "vídeo narrado": pega um vídeo completo de uma fonte liberada para reuso (NASA, domínio público),
// o Claude "assiste" a quadros do vídeo e escreve uma narração explicando o que aparece em cada momento,
// e o robô monta o Reel vertical com a narração, legenda sincronizada e o som original baixinho.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { claudeJson, formatCaption } from "./script.js";
import { assTime, assColor, escAss, chunkWords, probeDuration } from "./video.js";

const UA = "NowNoticiasBot/0.1 (+https://github.com/0lesbon/Brainstock-games)";
const W = 1080;
const H = 1920;
const FPS = 30;

// ---------- 1. Escolher o vídeo (NASA Image and Video Library, domínio público) ----------
export async function findNasaVideo({ queries, seenIds, yearStart }) {
  const found = [];
  for (const q of queries) {
    const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=video&year_start=${yearStart}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = (await res.json()).collection?.items || [];
      for (const it of items) {
        const m = it.data?.[0];
        if (!m || seenIds.has(m.nasa_id) || (m.description || "").length < 80) continue;
        if (/conference|briefing|interview|panel|webinar|town hall|teleconference|q&a|livestream|replay/i.test(m.title)) continue;
        found.push({ id: m.nasa_id, title: m.title, description: m.description, date: m.date_created, center: m.center, query: q });
      }
    } catch (err) {
      console.warn(`[nasa] busca "${q}" falhou: ${err.message}`);
    }
  }
  found.sort((a, b) => new Date(b.date) - new Date(a.date));
  const unique = [...new Map(found.map((f) => [f.id, f])).values()];
  return unique;
}

export async function downloadNasaVideo(id, outMp4) {
  const res = await fetch(`https://images-api.nasa.gov/asset/${encodeURIComponent(id)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`asset HTTP ${res.status}`);
  const files = (await res.json()).collection.items.map((i) => i.href);
  const pick =
    files.find((f) => /~medium\.mp4$/i.test(f)) || files.find((f) => /~mobile\.mp4$/i.test(f)) || files.find((f) => /~small\.mp4$/i.test(f)) ||
    files.find((f) => /~orig\.mp4$/i.test(f)) || files.find((f) => /\.mp4$/i.test(f));
  if (!pick) throw new Error("sem arquivo mp4");
  const v = await fetch(pick.replace(/^http:/, "https:"), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180000) });
  if (!v.ok) throw new Error(`vídeo HTTP ${v.status}`);
  fs.writeFileSync(outMp4, Buffer.from(await v.arrayBuffer()));
  return probeDuration(outMp4);
}

// Claude escolhe o vídeo com mais potencial visual para um Reel
export async function chooseVideo(candidates, cfg) {
  const list = candidates.map((c, i) => `${i}. ${c.title} (${c.date?.slice(0, 10)}) — ${c.description.replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
  const r = await claudeJson({
    system: `Você é o editor de vídeo do @now.noticias (Reels de ciência e espaço). Escolha UM vídeo da NASA para virar um Reel narrado de 35 segundos.
Prefira imagens espetaculares e em movimento: lançamentos, vistas da Terra, planetas, auroras, eclipses, robôs em ação, testes de motor, timelapses.
DESCARTE: coletivas de imprensa, entrevistas, palestras, painéis, pessoas falando para a câmera, slides, áudio sem imagem, vídeos com mais de 1 hora.`,
    user: `Vídeos candidatos:\n${list}`,
    schema: {
      type: "object",
      properties: { index: { type: "integer" }, reason: { type: "string" } },
      required: ["index", "reason"],
    },
    cfg,
    effort: "low",
  });
  console.log(`[nasa] claude escolheu #${r.index}: ${r.reason}`);
  return candidates[r.index] ? [candidates[r.index], ...candidates.filter((_, i) => i !== r.index)] : candidates;
}

// ---------- 2. "Assistir": extrair quadros com o tempo de cada um ----------
export function extractFrames(videoMp4, dir, { every = 3, max = 16, maxSeconds = 60 }) {
  const dur = Math.min(probeDuration(videoMp4), maxSeconds);
  const step = Math.max(every, dur / max);
  const frames = [];
  for (let t = 0.5; t < dur; t += step) {
    const f = path.join(dir, `frame-${frames.length}.jpg`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", t.toFixed(2), "-i", videoMp4, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", f]);
    if (fs.existsSync(f)) frames.push({ t, file: f });
  }
  return { frames, usable: dur };
}

// ---------- 3. Roteiro sincronizado com o que aparece na tela ----------
const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Texto da capa (4 a 8 palavras, curiosidade, sem ponto final)" },
    narration: { type: "string", description: "Narração completa, em ordem cronológica com o vídeo" },
    caption: { type: "string", description: "Legenda do Instagram: gancho com 1 emoji na 1ª linha, 2-3 frases, uma pergunta, chamada para salvar, e 'Fonte: NASA' no fim" },
    hashtags: { type: "array", items: { type: "string" } },
    clipStart: { type: "number", description: "Segundo do vídeo original em que o Reel deve começar (para pular partes paradas)" },
  },
  required: ["headline", "narration", "caption", "hashtags", "clipStart"],
};

const SYSTEM = `Você é o narrador do @now.noticias, perfil brasileiro de Reels de ciência, tecnologia e curiosidades.
Você vai ASSISTIR a um vídeo (recebe quadros com o segundo de cada um) e escrever a narração que vai por cima dele, explicando para quem assiste o que está acontecendo NA TELA, momento a momento, como um apresentador empolgado que entende do assunto.

REGRAS:
- A narração segue a ordem do vídeo: quando a imagem muda, a narração acompanha ("agora repare...", "esse clarão é...", "aqui a câmera está...").
- Comece com um gancho de até 10 palavras sobre o que é mais impressionante no vídeo. Proibido "Olá", "Neste vídeo", "Você sabia que".
- Explique o que a pessoa está vendo e por que importa: o que é, onde, tamanho, velocidade, por que isso é difícil ou inédito. Use pelo menos uma comparação visual ("mais rápido que uma bala").
- Use só fatos da descrição oficial e do que dá para ver nos quadros. Nunca invente números, nomes ou datas. Se não tiver certeza do que aparece num quadro, descreva de forma geral.
- Conteúdo atemporal: sem "hoje", "ontem", "nesta semana"; se a data importar, diga o ano.
- Frases curtas, ritmo de fala, português do Brasil, sem emojis na narração. Termine com uma frase marcante e "imagens da NASA".
- A narração deve durar o tempo indicado (cerca de 2,6 palavras por segundo).
- clipStart: escolha o segundo em que o trecho mais interessante começa, deixando tempo suficiente de vídeo depois dele para a narração inteira.`;

export async function writeVideoScript({ video, frames, targetSeconds, cfg }) {
  const words = Math.round(targetSeconds * 2.6);
  const content = [
    {
      type: "text",
      text: `Vídeo: ${video.title}\nData: ${video.date?.slice(0, 10)}\nDescrição oficial da NASA:\n${video.description.slice(0, 3000)}\n\nA seguir, os quadros do vídeo com o segundo de cada um. Escreva uma narração de cerca de ${words} palavras (${targetSeconds} segundos).`,
    },
  ];
  for (const f of frames) {
    content.push({ type: "text", text: `Segundo ${f.t.toFixed(1)}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(f.file).toString("base64") } });
  }
  const s = await claudeJson({ system: SYSTEM, user: content, schema: SCHEMA, cfg, effort: cfg.claudeEffort || "medium" });
  s.caption = formatCaption(s.caption);
  if (!Array.isArray(s.hashtags)) s.hashtags = [];
  return s;
}

// ---------- 4. Montagem ----------
function buildAss({ words, duration, profile, headline }) {
  const accent = assColor(profile.accentColor);
  const L = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Inter,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,330,1",
    "Style: Head,Inter,74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,8,70,70,330,1",
    "Style: Brand,Inter,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1",
    "Style: Small,Inter,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,0,0,90,1",
    "Style: Box,Inter,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const e = assTime(duration);
  L.push(`Dialogue: 0,0:00:00.00,${e},Box,,0,0,0,,{\\pos(0,0)\\1c&H0F0B08&\\p1}m 0 0 l ${W} 0 ${W} 240 0 240{\\p0}`);
  L.push(`Dialogue: 1,0:00:00.00,${e},Box,,0,0,0,,{\\pos(60,120)\\1c${accent}\\p1}m 0 0 l 190 0 190 70 0 70{\\p0}`);
  L.push(`Dialogue: 2,0:00:00.00,${e},Brand,,0,0,0,,{\\pos(80,128)\\fs40}AGORA`);
  L.push(`Dialogue: 2,0:00:00.00,${e},Brand,,0,0,0,,{\\pos(275,124)}${escAss(profile.name)}`);
  L.push(`Dialogue: 2,0:00:00.00,${e},Small,,0,0,0,,{\\1a&H50&}${escAss(profile.handle)}`);
  L.push(`Dialogue: 2,0:00:00.00,${e},Brand,,0,0,0,,{\\an9\\pos(1020,1295)\\fs30\\b0\\1a&H40&}Vídeo: NASA`);
  // manchete grande nos 3 primeiros segundos (o "gancho visual")
  L.push(`Dialogue: 3,0:00:00.00,0:00:03.20,Head,,0,0,0,,{\\fad(0,250)}${escAss(headline.toUpperCase())}`);
  const chunks = chunkWords(words);
  chunks.forEach((chunk, ci) => {
    const next = chunks[ci + 1]?.[0].start ?? Infinity;
    chunk.forEach((w, i) => {
      const end = i + 1 < chunk.length ? chunk[i + 1].start : Math.min(w.end + 0.25, next);
      const text = chunk
        .map((x, j) => (j === i ? `{\\1c${accent}}${escAss(x.text.toUpperCase())}{\\1c&HFFFFFF&}` : escAss(x.text.toUpperCase())))
        .join(" ");
      L.push(`Dialogue: 4,${assTime(Math.max(w.start, 3.2))},${assTime(Math.max(end, 3.25))},Caption,,0,0,0,,${text}`);
    });
  });
  return L.join("\n") + "\n";
}

export function renderNarratedVideo({ sourceMp4, clipStart, narrationMp3, words, profile, headline, assPath, outMp4 }) {
  const duration = probeDuration(narrationMp3) + 0.8;
  const available = probeDuration(sourceMp4) - clipStart;
  // se o trecho for mais curto que a narração, desacelera um pouco (até 1,6x) e congela o último quadro se ainda faltar
  const slow = available < duration ? Math.min(1.6, duration / Math.max(1, available)) : 1;
  fs.writeFileSync(assPath, buildAss({ words, duration, profile, headline }));
  const vy = 400; // área do vídeo: 1080x880 abaixo da barra da marca (vídeo ampliado, laterais cortadas)
  const vh = 880;
  const filter = [
    `[0:v]setpts=${slow.toFixed(3)}*(PTS-STARTPTS),fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.ceil(duration)},split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:3,eq=brightness=-0.35[bg]`,
    `[b]scale=-2:${vh},crop='min(iw,${W})':${vh}[fg0]`,
    `[fg0]pad=${W}:${vh}:(ow-iw)/2:0:black@0[fg]`,
    `[bg][fg]overlay=0:${vy}[pre]`,
    `[pre]ass=${assPath.replace(/:/g, "\\:")}[v]`,
    // narração + som original do vídeo bem baixo, para dar ambiente
    `[0:a]atempo=${(1 / slow).toFixed(3)},volume=0.12[orig]`,
    `[1:a]volume=1.0[nar]`,
    `[nar][orig]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
  ];
  const hasAudio = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", sourceMp4]).toString().trim() !== "";
  const f = hasAudio ? filter : filter.slice(0, 5);
  execFileSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(clipStart), "-i", sourceMp4,
      "-i", narrationMp3,
      "-filter_complex", f.join(";"),
      "-map", "[v]", "-map", hasAudio ? "[aout]" : "1:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k",
      "-t", duration.toFixed(2), "-movflags", "+faststart", outMp4,
    ],
    { stdio: "inherit" },
  );
  return { duration };
}
