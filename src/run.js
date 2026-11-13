// Orquestra tudo: notícia -> roteiro -> print -> narração -> vídeo -> hospedagem -> agendamento.
//
// Uso:
//   node src/run.js                 pipeline completo (posta de verdade)
//   node src/run.js --no-publish    gera o vídeo em out/ e não posta
//   node src/run.js --url <link>    usa uma matéria específica em vez de buscar nos feeds
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchFeeds, rankStories } from "./news.js";
import { captureArticle, renderCover } from "./screenshot.js";
import { writeScript, chooseStory } from "./script.js";
import { narrate, pickVoice } from "./tts.js";
import { renderVideo } from "./video.js";
import { collectImages } from "./images.js";
import { uploadToGithubRelease, buildMetricoolPost, scheduleOnMetricool } from "./publish.js";
import { emailReady, sendVideoEmail } from "./email.js";
import { buildThemeCarousel, emailCarousel } from "./weekly-carousel.js";
import { findNasaVideo, chooseVideo, downloadNasaVideo, extractFrames, writeVideoScript, renderNarratedVideo } from "./videonews.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const historyPath = path.join(ROOT, "state", "history.json");
const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));

// Modo "vídeo narrado": vídeo completo da NASA (domínio público) + narração que explica o que aparece na tela
async function mainVideo() {
  const vcfg = cfg.videoNews;
  const seenIds = new Set(history.published.map((p) => p.id));
  let candidates = await findNasaVideo({ queries: vcfg.queries, seenIds: new Set([...seenIds].map((x) => String(x).replace(/^nasa-/, ""))), yearStart: vcfg.yearStart });
  console.log(`[nasa] ${candidates.length} vídeos candidatos`);
  if (candidates.length > 1 && process.env.ANTHROPIC_API_KEY) {
    try {
      candidates = await chooseVideo(candidates.slice(0, 30), cfg.script);
    } catch (err) {
      console.warn(`[nasa] escolha pelo Claude falhou (${err.message}); usando o mais recente.`);
    }
  }
  let video, src, srcDur;
  const outBase = path.join(ROOT, "out");
  for (const c of candidates.slice(0, 6)) {
    const dir = path.join(outBase, `nasa-${c.id.replace(/[^\w-]+/g, "_")}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      srcDur = await downloadNasaVideo(c.id, path.join(dir, "original.mp4"));
      if (srcDur < 12) throw new Error(`curto demais (${srcDur.toFixed(0)}s)`);
      video = { ...c, dir };
      src = path.join(dir, "original.mp4");
      break;
    } catch (err) {
      console.warn(`[nasa] ${c.id} descartado: ${err.message}`);
    }
  }
  if (!video) return console.log("[nasa] nenhum vídeo utilizável; encerrando.");
  console.log(`[nasa] escolhido: ${video.title} (${srcDur.toFixed(0)}s)`);

  const { frames } = extractFrames(src, video.dir, { every: 3, max: 16, maxSeconds: 90 });
  const target = Math.min(vcfg.targetSeconds || 35, Math.max(15, srcDur * 1.3));
  const script = await writeVideoScript({ video, frames, targetSeconds: Math.round(target), cfg: cfg.script });
  console.log(`[roteiro] ${script.narration.split(/\s+/).length} palavras, começa em ${script.clipStart}s: ${script.headline}`);

  const files = { audio: path.join(video.dir, "narracao.mp3"), ass: path.join(video.dir, "legenda.ass"), video: path.join(video.dir, "video.mp4"), cover: path.join(video.dir, "capa.png"), post: path.join(video.dir, "post.json") };
  const voiceCfg = { ...cfg.voice };
  const voice = pickVoice(voiceCfg, history.published.length + (opt("--voice-index") ? Number(opt("--voice-index")) : 0));
  const { words } = await narrate(script.narration, voiceCfg, files.audio, voice);
  console.log(`[voz] ${voice.name}: ${words.length} palavras sincronizadas`);
  const clipStart = Math.max(0, Math.min(Number(script.clipStart) || 0, srcDur - 8));
  const { duration } = renderNarratedVideo({ sourceMp4: src, clipStart, narrationMp3: files.audio, words, profile: cfg.profile, headline: script.headline, assPath: files.ass, outMp4: files.video });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1", "-i", files.video, "-frames:v", "1", files.cover]);
  console.log(`[video] ${files.video} (${duration.toFixed(1)}s)`);

  const story = { id: `nasa-${video.id}`, title: video.title, link: `https://images.nasa.gov/details/${encodeURIComponent(video.id)}`, source: "NASA", category: "ciencia" };
  const record = { ...story, voice: voice.name, mode: "video", createdAt: new Date().toISOString(), script };
  if (flag("--no-publish") || !emailReady()) {
    fs.writeFileSync(files.post, JSON.stringify({ record }, null, 2));
    return console.log("[publicar] pulado.");
  }
  const id = await sendVideoEmail({ script, story, voiceName: voice.name, duration, videoPath: files.video, coverPath: files.cover, downloadUrl: null });
  console.log(`[publicar] e-mail enviado (${id})`);
  fs.writeFileSync(files.post, JSON.stringify({ record }, null, 2));
  history.published.push({ ...record, script: undefined, emailedAt: new Date().toISOString() });
  history.published = history.published.slice(-500);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
}

// Carrosséis semanais por tema
async function mainCarousel() {
  const wanted = opt("--tema") || "todos";
  const themes = cfg.carousels.themes.filter((t) => wanted === "todos" || t.id === wanted);
  const fmt = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: cfg.profile.timezone, day: "numeric" }).format(d);
  const month = new Intl.DateTimeFormat("pt-BR", { timeZone: cfg.profile.timezone, month: "short" }).format(new Date()).replace(".", "").toUpperCase();
  const period = `${fmt(new Date(Date.now() - 6 * 86400000))} a ${fmt(new Date())} ${month}`;
  for (const theme of themes) {
    const outDir = path.join(ROOT, "out", `carrossel-${theme.id}`);
    try {
      const r = await buildThemeCarousel({ theme: { ...theme, period }, cfg, outDir, days: cfg.carousels.days || 7 });
      console.log(`[carrossel:${theme.id}] ${r.files.length} imagens: ${r.title}`);
      if (!flag("--no-publish") && emailReady()) console.log(`[carrossel:${theme.id}] e-mail enviado (${await emailCarousel({ ...r, themeName: theme.name })})`);
    } catch (err) {
      console.error(`[carrossel:${theme.id}] falhou: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  if (opt("--modo") === "carrossel") return mainCarousel();
  if (opt("--modo") === "video") return mainVideo();
  // 1. Notícia
  let story;
  const manualUrl = opt("--url");
  if (manualUrl) {
    story = { id: `manual-${Date.now()}`, category: opt("--category") || "tecnologia", source: opt("--source") || new URL(manualUrl).hostname.replace(/^www\./, ""), title: opt("--title") || "", link: manualUrl, description: "", image: null };
  } else {
    const items = await fetchFeeds(cfg.feeds);
    console.log(`[news] ${items.length} itens nos feeds`);
    const rotation = cfg.categories?.rotation || [];
    const preferCategory = opt("--category") || rotation[history.published.length % Math.max(1, rotation.length)];
    const ranked = rankStories(items, { history, preferCategory, ...cfg.selection });
    // a IA escolhe, entre as candidatas do assunto da vez, a com mais potencial (descarta propaganda, serviço, listas)
    const pool = ranked.filter((s) => s.category === ranked[0]?.category).slice(0, 30);
    story = pool.length > 1 ? await chooseStory(pool, cfg.script) : ranked[0];
    if (!story) {
      console.log("[news] nenhuma notícia nova; encerrando.");
      return;
    }
  }
  console.log(`[news] escolhida [${story.category}]: ${story.title || story.link} (${story.source})`);

  const outDir = path.join(ROOT, "out", story.id);
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    article: path.join(outDir, "materia.png"),
    cover: path.join(outDir, "capa.png"),
    audio: path.join(outDir, "narracao.mp3"),
    ass: path.join(outDir, "legenda.ass"),
    video: path.join(outDir, "video.mp4"),
    post: path.join(outDir, "post.json"),
  };

  // 2. Print da matéria + texto
  let articleText = "";
  let articleImages = [];
  try {
    ({ articleText, articleImages } = await captureArticle(story.link, files.article));
    console.log(`[print] ok (${articleText.length} caracteres de texto)`);
  } catch (err) {
    console.warn(`[print] falhou (${err.message}); o vídeo usará só a capa.`);
  }
  if (!story.title) story.title = articleText.split("\n")[0]?.slice(0, 120) || story.link;

  // 3. Roteiro
  const script = await writeScript(story, articleText, cfg.script);
  console.log(`[roteiro] ${script.narration.split(/\s+/).length} palavras: ${script.headline}`);

  // 4. Capa, narração e vídeo
  const coverImage = story.image || articleImages[0] || null;
  const label = cfg.categories?.labels?.[story.category] || "NOTÍCIA";
  await renderCover({ headline: script.headline, source: story.source, image: coverImage, profile: cfg.profile, label, outPng: files.cover });
  const images = await collectImages({
    articleImages,
    queries: script.imageQueries,
    videoQueries: script.videoQueries,
    coverImage,
    outDir,
    max: cfg.images?.max ?? 4,
    maxVideos: cfg.images?.maxVideos ?? 2,
  });
  console.log(`[imagens] ${images.length} mídias: ${images.map((i) => `${i.type === "video" ? "vídeo" : "foto"} ${i.credit}`).join(", ")}`);
  // Enquanto a chave do Google não estiver cadastrada, continua usando a ElevenLabs
  const voiceCfg = { ...cfg.voice };
  if (voiceCfg.provider !== "elevenlabs" && !process.env.GOOGLE_TTS_API_KEY && process.env.ELEVENLABS_API_KEY) {
    console.warn("[voz] GOOGLE_TTS_API_KEY ausente: usando ElevenLabs por enquanto.");
    voiceCfg.provider = "elevenlabs";
  }
  const voice = pickVoice(voiceCfg, history.published.length + (opt("--voice-index") ? Number(opt("--voice-index")) : 0));
  const { words } = await narrate(script.narration, voiceCfg, files.audio, voice);
  console.log(`[voz] ${voice.name}: ${words.length} palavras sincronizadas`);
  const { duration, segments } = renderVideo({
    coverPng: files.cover,
    images,
    secondsEach: cfg.images?.secondsEach,
    articlePng: fs.existsSync(files.article) ? files.article : null,
    audioMp3: files.audio,
    words,
    profile: cfg.profile,
    source: story.source,
    assPath: files.ass,
    outMp4: files.video,
  });
  console.log(`[video] ${files.video} (${duration.toFixed(1)}s) ${segments.join(" | ")}`);

  const record = { id: story.id, title: story.title, link: story.link, source: story.source, category: story.category, voice: voice.name, createdAt: new Date().toISOString(), script };

  // 5. Publicação
  //   publish.mode = "email"     -> manda o vídeo + legenda para o seu e-mail (você posta pelo celular)
  //   publish.mode = "metricool" -> agenda direto no Metricool (exige plano Advanced, com API)
  const mode = cfg.publish.mode || "email";
  const skip = (why) => {
    fs.writeFileSync(files.post, JSON.stringify({ record }, null, 2));
    console.log(`[publicar] pulado: ${why}`);
  };
  if (flag("--no-publish") || flag("--dry-run")) return skip("--no-publish.");

  let entry;
  if (mode === "email") {
    if (!emailReady()) return skip("defina GMAIL_USER e GMAIL_APP_PASSWORD para receber os vídeos por e-mail.");
    let downloadUrl = null;
    try {
      const urls = await uploadToGithubRelease({ tag: `video-${story.id}`, name: script.headline, files: [files.video, files.cover] });
      downloadUrl = urls["video.mp4"];
    } catch (err) {
      console.warn(`[publicar] não consegui criar o link de download (${err.message}); o vídeo vai só em anexo.`);
    }
    const id = await sendVideoEmail({ script, story, voiceName: voice.name, duration, videoPath: files.video, coverPath: files.cover, downloadUrl });
    console.log(`[publicar] e-mail enviado (${id})`);
    fs.writeFileSync(files.post, JSON.stringify({ record, downloadUrl }, null, 2));
    entry = { videoUrl: downloadUrl, emailedAt: new Date().toISOString() };
  } else {
    const metricoolReady = ["METRICOOL_USER_TOKEN", "METRICOOL_USER_ID", "METRICOOL_BLOG_ID"].every((k) => process.env[k]);
    if (!metricoolReady) return skip("chaves do Metricool ainda não configuradas.");
    const urls = await uploadToGithubRelease({ tag: `video-${story.id}`, name: script.headline, files: [files.video, files.cover] });
    const post = buildMetricoolPost({
      script,
      videoUrl: urls["video.mp4"],
      coverUrl: urls["capa.png"],
      publishCfg: cfg.publish,
      timezone: cfg.profile.timezone,
      source: story.source,
    });
    fs.writeFileSync(files.post, JSON.stringify({ record, post }, null, 2));
    const result = await scheduleOnMetricool(post);
    console.log(`[publicar] agendado no Metricool para ${post.publicationDate.dateTime}`, JSON.stringify(result).slice(0, 300));
    entry = { videoUrl: urls["video.mp4"], scheduledFor: post.publicationDate.dateTime };
  }

  history.published.push({ ...record, script: undefined, ...entry });
  history.published = history.published.slice(-500);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
