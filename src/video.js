// Monta o vídeo vertical 1080x1920 com ffmpeg:
//   0-3s  capa com a manchete (zoom lento)
//   3s+   print da matéria rolando dentro de um card, fundo desfocado
//   legenda palavra por palavra sincronizada com a narração + barra com a marca do perfil
import { execFileSync } from "node:child_process";
import fs from "node:fs";

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

export function buildAss({ words, duration, profile, source }) {
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

export function renderVideo({ coverPng, articlePng, audioMp3, words, profile, source, assPath, outMp4 }) {
  const duration = probeDuration(audioMp3) + 0.7;
  fs.writeFileSync(assPath, buildAss({ words, duration, profile, source }));

  const art = articlePng && fs.existsSync(articlePng) ? articlePng : coverPng;
  const { width, height } = pngSize(art);
  const scaledH = Math.round((height * CARD.w) / width);
  const travel = Math.max(0, scaledH - CARD.h);
  const speed = Math.min(140, travel / Math.max(1, duration - COVER_SECONDS - 1));
  const coverFrames = COVER_SECONDS * FPS;

  const filter = [
    // fundo: capa desfocada e escurecida
    `[0:v]scale=${W}:${H},boxblur=30:3,eq=brightness=-0.25[bg]`,
    // print da matéria rolando dentro do card com cantos arredondados simulados por borda
    `[1:v]scale=${CARD.w}:-2,crop=${CARD.w}:${CARD.h}:0:'min(max(0\\,t-${COVER_SECONDS + 0.5})*${speed.toFixed(2)}\\,${travel})'[art]`,
    `[bg][art]overlay=${CARD.x}:${CARD.y}:shortest=1[base]`,
    // capa com zoom lento nos 3 primeiros segundos
    `[2:v]scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0009,1.08)':d=${coverFrames}:s=${W}x${H}:fps=${FPS},trim=duration=${COVER_SECONDS}[cv]`,
    `[base][cv]overlay=0:0:eof_action=pass[pre]`,
    `[pre]ass=${assPath.replace(/:/g, "\\:")}[v]`,
  ].join(";");

  execFileSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-loop", "1", "-framerate", String(FPS), "-t", duration.toFixed(2), "-i", coverPng,
      "-loop", "1", "-framerate", String(FPS), "-t", duration.toFixed(2), "-i", art,
      "-i", coverPng,
      "-i", audioMp3,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-af", "apad",
      "-t", duration.toFixed(2),
      "-movflags", "+faststart",
      outMp4,
    ],
    { stdio: "inherit" },
  );
  return { duration };
}
