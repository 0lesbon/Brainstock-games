// Monta o vídeo vertical 1080x1920 com ffmpeg:
//   0-3s  capa com a manchete (zoom lento)
//   depois: print da matéria rolando -> fotos relacionadas (zoom lento) -> print de novo
//   legenda palavra por palavra sincronizada com a narração + barra com a marca do perfil
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const W = 1080;
const H = 1920;
const FPS = 30;
const COVER_SECONDS = 3;
const CARD = { x: 60, y: 300, w: 960, h: 1130 };

function probeDuration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(out.toString().trim());
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

// "#RRGGBB" -> "&H00BBGGRR" (formato de cor do ASS)
function assColor(hex) {
  const h = hex.replace("#", "");
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function escAss(s) {
  return s.replace(/[{}]/g, "").replace(/\\/g, "");
}

function chunkWords(words, maxWords = 3, maxChars = 20) {
  const chunks = [];
  let cur = [];
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || len > maxChars)) chunks.push(cur), (cur = []);
    cur.push(w);
    if (/[.!?;:,]$/.test(w.text)) chunks.push(cur), (cur = []);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function buildAss({ words, duration, profile, source, credits = [] }) {
  const accent = assColor(profile.accentColor);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Inter,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,250,1",
    "Style: Brand,Inter,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1",
    "Style: Small,Inter,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,0,0,90,1",
    "Style: Box,Inter,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const s = assTime(COVER_SECONDS);
  const e = assTime(duration);
  // Barra superior (fundo da marca) + nome do perfil + fonte
  lines.push(`Dialogue: 0,${s},${e},Box,,0,0,0,,{\\pos(0,0)\\1c&H0F0B08&\\p1}m 0 0 l ${W} 0 ${W} 240 0 240{\\p0}`);
  lines.push(`Dialogue: 1,${s},${e},Box,,0,0,0,,{\\pos(60,120)\\1c${accent}\\p1}m 0 0 l 190 0 190 70 0 70{\\p0}`);
  lines.push(`Dialogue: 2,${s},${e},Brand,,0,0,0,,{\\pos(80,128)\\fs40}AGORA`);
  lines.push(`Dialogue: 2,${s},${e},Brand,,0,0,0,,{\\pos(275,124)}${escAss(profile.name)}`);
  lines.push(`Dialogue: 2,${s},${e},Brand,,0,0,0,,{\\pos(${CARD.x},${CARD.y + CARD.h + 24})\\fs32\\b0\\1a&H40&}Fonte: ${escAss(source)}`);
  lines.push(`Dialogue: 2,0:00:00.00,${e},Small,,0,0,0,,{\\1a&H50&}${escAss(profile.handle)}`);
  for (const c of credits)
    lines.push(`Dialogue: 2,${assTime(c.start)},${assTime(c.end)},Small,,0,0,0,,{\\an9\\pos(${CARD.x + CARD.w - 14},${CARD.y + 12})\\fs26\\bord2\\1a&H20&}${escAss(c.text)}`);

  // Legenda palavra por palavra (palavra atual destacada na cor do perfil)
  const chunks = chunkWords(words);
  chunks.forEach((chunk, ci) => {
    const nextChunkStart = chunks[ci + 1]?.[0].start ?? Infinity;
    chunk.forEach((w, i) => {
      const start = w.start;
      // mantém a legenda na tela até a próxima palavra, sem sobrepor o bloco seguinte
      const end = i + 1 < chunk.length ? chunk[i + 1].start : Math.min(w.end + 0.25, nextChunkStart);
      const text = chunk
        .map((x, j) => (j === i ? `{\\1c${accent}}${escAss(x.text.toUpperCase())}{\\1c&HFFFFFF&}` : escAss(x.text.toUpperCase())))
        .join(" ");
      const pop = i === 0 ? "{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}" : "";
      lines.push(`Dialogue: 3,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${pop}${text}`);
    });
  });
  return lines.join("\n") + "\n";
}

function ff(args) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
}

const SEG_ENC = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS)];

// Capa com zoom lento
function segCover(coverPng, dur, out) {
  ff([
    "-i", coverPng,
    "-vf", `scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0009,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(dur * FPS)}:s=${W}x${H}:fps=${FPS}`,
    "-t", dur.toFixed(3), ...SEG_ENC, out,
  ]);
}

// Print da matéria rolando dentro do card, fundo = capa desfocada
function segPrint({ coverPng, art, dur, startY, speed, travel }, out) {
  const filter = [
    `[0:v]scale=${W}:${H},boxblur=30:3,eq=brightness=-0.25[bg]`,
    `[1:v]scale=${CARD.w}:-2,crop=${CARD.w}:${CARD.h}:0:'min(${startY.toFixed(1)}+t*${speed.toFixed(2)}\\,${travel})'[art]`,
    `[bg][art]overlay=${CARD.x}:${CARD.y}[v]`,
  ].join(";");
  ff([
    "-loop", "1", "-framerate", String(FPS), "-t", dur.toFixed(3), "-i", coverPng,
    "-loop", "1", "-framerate", String(FPS), "-t", dur.toFixed(3), "-i", art,
    "-filter_complex", filter, "-map", "[v]", "-t", dur.toFixed(3), ...SEG_ENC, out,
  ]);
}

// Foto relacionada com zoom lento (efeito Ken Burns) dentro do card, fundo = a própria foto desfocada
function segImage({ file, dur, zoomIn }, out) {
  const frames = Math.ceil(dur * FPS);
  const z = zoomIn ? `min(zoom+0.0011,1.16)` : `if(eq(on,0),1.16,max(zoom-0.0011,1.0))`;
  const filter = [
    `[0:v]split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=35:3,eq=brightness=-0.3,loop=${frames}:1:0,fps=${FPS}[bg]`,
    `[b]scale=${CARD.w * 2}:${CARD.h * 2}:force_original_aspect_ratio=increase,crop=${CARD.w * 2}:${CARD.h * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${CARD.w}x${CARD.h}:fps=${FPS}[fg]`,
    `[bg][fg]overlay=${CARD.x}:${CARD.y}:shortest=1[v]`,
  ].join(";");
  ff(["-i", file, "-filter_complex", filter, "-map", "[v]", "-t", dur.toFixed(3), ...SEG_ENC, out]);
}

// Trecho de vídeo de banco (B-roll) dentro do card, fundo = o próprio vídeo desfocado
function segClip({ file, dur }, out) {
  const filter = [
    `[0:v]fps=${FPS},split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:3,eq=brightness=-0.3[bg]`,
    `[b]scale=${CARD.w}:${CARD.h}:force_original_aspect_ratio=increase,crop=${CARD.w}:${CARD.h}[fg]`,
    `[bg][fg]overlay=${CARD.x}:${CARD.y}[v]`,
  ].join(";");
  // começa um pouco depois do início (o 1º segundo de vídeos de banco costuma ser parado) e repete se for curto
  ff(["-stream_loop", "-1", "-ss", "1", "-i", file, "-filter_complex", filter, "-map", "[v]", "-t", dur.toFixed(3), ...SEG_ENC, out]);
}

// Monta a linha do tempo: capa -> print -> fotos relacionadas -> print (continua rolando)
export function planSegments({ duration, hasArticle, images, secondsEach = 4.5 }) {
  const segs = [{ type: "cover", dur: COVER_SECONDS }];
  let rest = duration - COVER_SECONDS;
  if (!images.length) return [...segs, { type: "print", dur: rest }];

  const firstPrint = hasArticle ? Math.min(7, rest * 0.35) : 0;
  if (firstPrint > 0) segs.push({ type: "print", dur: firstPrint }), (rest -= firstPrint);

  const fit = Math.max(1, Math.min(images.length, Math.floor(rest / 3)));
  const each = Math.min(secondsEach, rest / fit);
  images.slice(0, fit).forEach((img, i) => segs.push({ type: "image", dur: each, image: img, zoomIn: i % 2 === 0 }));
  rest -= each * fit;
  if (rest > 1.5 && hasArticle) segs.push({ type: "print", dur: rest });
  else segs[segs.length - 1].dur += Math.max(0, rest);
  return segs;
}

export function renderVideo({ coverPng, articlePng, audioMp3, words, profile, source, images = [], secondsEach, assPath, outMp4 }) {
  const duration = probeDuration(audioMp3) + 0.7;
  const hasArticle = Boolean(articlePng && fs.existsSync(articlePng));
  const art = hasArticle ? articlePng : coverPng;
  const segs = planSegments({ duration, hasArticle, images, secondsEach });

  // créditos das fotos (aparecem durante o trecho de cada uma)
  let t = 0;
  const credits = [];
  for (const sg of segs) {
    if (sg.type === "image") credits.push({ start: t, end: t + sg.dur, text: `${sg.image.type === "video" ? "Vídeo" : "Imagem"}: ${sg.image.credit}` });
    t += sg.dur;
  }
  fs.writeFileSync(assPath, buildAss({ words, duration, profile, source, credits }));

  // rolagem do print distribuída entre todos os trechos de print
  const { width, height } = pngSize(art);
  const travel = Math.max(0, Math.round((height * CARD.w) / width) - CARD.h);
  const printTime = segs.filter((x) => x.type === "print").reduce((n, x) => n + x.dur, 0);
  const speed = Math.min(140, travel / Math.max(1, printTime));

  const dir = path.dirname(outMp4);
  const parts = [];
  let scrolled = 0;
  segs.forEach((sg, i) => {
    const out = path.join(dir, `seg-${String(i).padStart(2, "0")}.mp4`);
    if (sg.type === "cover") segCover(coverPng, sg.dur, out);
    else if (sg.type === "print") {
      segPrint({ coverPng, art, dur: sg.dur, startY: scrolled, speed, travel }, out);
      scrolled += sg.dur * speed;
    } else if (sg.image.type === "video") segClip({ file: sg.image.file, dur: sg.dur }, out);
    else segImage({ file: sg.image.file, dur: sg.dur, zoomIn: sg.zoomIn }, out);
    parts.push(out);
  });

  const list = path.join(dir, "segmentos.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${path.basename(p)}'`).join("\n") + "\n");

  ff([
    "-f", "concat", "-safe", "0", "-i", list,
    "-i", audioMp3,
    "-vf", `ass=${assPath.replace(/:/g, "\\:")}`,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-af", "apad",
    "-t", duration.toFixed(2),
    "-movflags", "+faststart",
    outMp4,
  ]);
  for (const p of [...parts, list]) fs.rmSync(p, { force: true });
  return { duration, segments: segs.map((x) => `${x.type}:${x.dur.toFixed(1)}s`) };
}
