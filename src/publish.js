// Hospeda o vídeo (GitHub Releases, URL pública) e agenda a postagem no Metricool.
import fs from "node:fs";
import path from "node:path";

// ---------- Hospedagem: GitHub Releases ----------
// O Metricool só aceita mídia por URL pública. No GitHub Actions o GITHUB_TOKEN já tem permissão
// para criar releases; o repositório precisa ser público para o link funcionar sem login.
export async function uploadToGithubRelease({ tag, name, files }) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY/GITHUB_TOKEN ausentes (rode no GitHub Actions).");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  const rel = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tag_name: tag, name, body: "Vídeo gerado automaticamente.", prerelease: true }),
  });
  if (!rel.ok) throw new Error(`Criar release: HTTP ${rel.status} ${await rel.text()}`);
  const { upload_url } = await rel.json();

  const urls = {};
  for (const file of files) {
    const base = path.basename(file);
    const type = base.endsWith(".mp4") ? "video/mp4" : base.endsWith(".png") ? "image/png" : "image/jpeg";
    const up = await fetch(upload_url.replace(/\{.*\}$/, `?name=${encodeURIComponent(base)}`), {
      method: "POST",
      headers: { ...headers, "Content-Type": type },
      body: fs.readFileSync(file),
    });
    if (!up.ok) throw new Error(`Upload ${base}: HTTP ${up.status} ${await up.text()}`);
    urls[base] = (await up.json()).browser_download_url;
  }
  return urls;
}

// ---------- Postagem: Metricool ----------
function localDateTime(date, timeZone) {
  // "YYYY-MM-DDTHH:mm:ss" no fuso do perfil
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function buildMetricoolPost({ script, videoUrl, coverUrl, publishCfg, timezone, source }) {
  const when = new Date(Date.now() + publishCfg.delayMinutes * 60000);
  const tags = script.hashtags.map((h) => `#${h.replace(/^#/, "").replace(/\s+/g, "")}`).join(" ");
  const text = `${script.caption}\n\n${tags}`;
  const providers = publishCfg.networks.map((network) => ({ network }));
  const post = {
    publicationDate: { dateTime: localDateTime(when, timezone), timezone },
    text,
    providers,
    autoPublish: publishCfg.autoPublish,
    draft: false,
    media: [videoUrl],
    mediaAltText: [],
    descendants: [],
    firstCommentText: "",
    shortener: false,
    smartLinkData: { ids: [] },
  };
  if (coverUrl) post.videoThumbnailUrl = coverUrl;
  if (publishCfg.networks.includes("instagram")) post.instagramData = { type: "REEL", showReelOnFeed: true, isAiGenerated: true };
  if (publishCfg.networks.includes("youtube"))
    post.youtubeData = {
      title: script.youtubeTitle.slice(0, 100),
      type: "short",
      privacy: "public",
      madeForKids: false,
      category: "NEWS_POLITICS",
      tags: script.hashtags.slice(0, 10),
      isAiGeneratedContent: true,
    };
  if (publishCfg.networks.includes("tiktok"))
    post.tiktokData = { privacyOption: "PUBLIC_TO_EVERYONE", title: script.headline, isAigc: true };
  if (publishCfg.networks.includes("facebook")) post.facebookData = { type: "REEL", title: script.headline };
  return post;
}

export async function scheduleOnMetricool(post) {
  const { METRICOOL_USER_TOKEN: token, METRICOOL_USER_ID: userId, METRICOOL_BLOG_ID: blogId } = process.env;
  if (!token || !userId || !blogId) throw new Error("Defina METRICOOL_USER_TOKEN, METRICOOL_USER_ID e METRICOOL_BLOG_ID.");
  const res = await fetch(
    `https://app.metricool.com/api/v2/scheduler/posts?blogId=${blogId}&userId=${userId}`,
    {
      method: "POST",
      headers: { "X-Mc-Auth": token, "Content-Type": "application/json" },
      body: JSON.stringify(post),
    },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`Metricool HTTP ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body || "{}");
}
