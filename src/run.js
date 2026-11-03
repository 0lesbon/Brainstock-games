// Orquestra tudo: notícia -> roteiro -> print -> narração -> vídeo -> hospedagem -> agendamento.
//
// Uso:
//   node src/run.js                 pipeline completo (posta de verdade)
//   node src/run.js --no-publish    gera o vídeo em out/ e não posta
//   node src/run.js --url <link>    usa uma matéria específica em vez de buscar nos feeds
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFeeds, pickStory } from "./news.js";
import { captureArticle, renderCover } from "./screenshot.js";
import { writeScript } from "./script.js";
import { narrate } from "./tts.js";
import { renderVideo } from "./video.js";
import { uploadToGithubRelease, buildMetricoolPost, scheduleOnMetricool } from "./publish.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const historyPath = path.join(ROOT, "state", "history.json");
const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));

async function main() {
  // 1. Notícia
  let story;
  const manualUrl = opt("--url");
  if (manualUrl) {
    story = { id: `manual-${Date.now()}`, source: opt("--source") || new URL(manualUrl).hostname.replace(/^www\./, ""), title: opt("--title") || "", link: manualUrl, description: "", image: null };
  } else {
    const items = await fetchFeeds(cfg.feeds);
    console.log(`[news] ${items.length} itens nos feeds`);
    story = pickStory(items, { history, ...cfg.selection });
    if (!story) {
      console.log("[news] nenhuma notícia nova; encerrando.");
      return;
    }
  }
  console.log(`[news] escolhida: ${story.title || story.link} (${story.source})`);

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
  try {
    ({ articleText } = await captureArticle(story.link, files.article));
    console.log(`[print] ok (${articleText.length} caracteres de texto)`);
  } catch (err) {
    console.warn(`[print] falhou (${err.message}); o vídeo usará só a capa.`);
  }
  if (!story.title) story.title = articleText.split("\n")[0]?.slice(0, 120) || story.link;

  // 3. Roteiro
  const script = await writeScript(story, articleText, cfg.script);
  console.log(`[roteiro] ${script.narration.split(/\s+/).length} palavras: ${script.headline}`);

  // 4. Capa, narração e vídeo
  await renderCover({ headline: script.headline, source: story.source, image: story.image, profile: cfg.profile, outPng: files.cover });
  const { words } = await narrate(script.narration, cfg.voice, files.audio);
  console.log(`[voz] ${words.length} palavras sincronizadas`);
  const { duration } = renderVideo({
    coverPng: files.cover,
    articlePng: fs.existsSync(files.article) ? files.article : null,
    audioMp3: files.audio,
    words,
    profile: cfg.profile,
    source: story.source,
    assPath: files.ass,
    outMp4: files.video,
  });
  console.log(`[video] ${files.video} (${duration.toFixed(1)}s)`);

  const record = { id: story.id, title: story.title, link: story.link, source: story.source, createdAt: new Date().toISOString(), script };

  // 5. Publicação
  if (flag("--no-publish") || flag("--dry-run")) {
    fs.writeFileSync(files.post, JSON.stringify({ record }, null, 2));
    console.log("[publicar] pulado (--no-publish).");
    return;
  }
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

  history.published.push({ ...record, script: undefined, videoUrl: urls["video.mp4"], scheduledFor: post.publicationDate.dateTime });
  history.published = history.published.slice(-500);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
