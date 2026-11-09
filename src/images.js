// Busca imagens relacionadas à notícia para intercalar no vídeo:
//   1. fotos da própria matéria (as mais relevantes)
//   2. Pixabay (banco gratuito; precisa de PIXABAY_API_KEY, opcional) e Pexels (PEXELS_API_KEY, opcional)
//   3. Openverse (gratuito, sem chave; reúne fotos com licença livre do Flickr, Wikimedia etc.)
//   4. Wikimedia Commons (gratuito, sem chave; reserva caso as outras não achem nada)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UA = "NowNoticiasBot/0.1 (+https://github.com/0lesbon/Brainstock-games)";

const STOP = new Set(["the", "and", "with", "for", "from", "of", "in", "on", "a", "an", "to", "by", "new", "old"]);

// A foto só serve se os tags/título dela tiverem pelo menos uma palavra importante da busca
function relevant(query, text) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const hay = (text || "").toLowerCase();
  return words.some((w) => hay.includes(w.replace(/s$/, "")));
}

async function searchPexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=3`;
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const data = await res.json();
  return (data.photos || []).map((p) => ({ url: p.src.large2x || p.src.portrait, credit: `Pexels/${p.photographer}` }));
}

function cleanCredit(r) {
  let who = (r.creator || "").replace(/\s+/g, " ").trim();
  const half = who.slice(0, who.length / 2);
  if (half && who === half + half) who = half; // "Unknown artistUnknown artist"
  if (!who || /unknown/i.test(who)) who = r.source === "wikimedia" ? "Wikimedia Commons" : r.source || "Openverse";
  if (who.length > 26) who = who.slice(0, 25).trim() + "…";
  return `${who} (${(r.license || "").toUpperCase()})`;
}

async function searchPixabay(query) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ key, q: query.slice(0, 100), image_type: "photo", per_page: "3", safesearch: "true", min_width: "1000" });
  const res = await fetch(`https://pixabay.com/api/?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`);
  const data = await res.json();
  return (data.hits || [])
    .filter((h) => relevant(query, h.tags))
    .slice(0, 2)
    .map((h) => ({ url: h.largeImageURL, key: `pixabay-${h.id}`, credit: `Pixabay/${String(h.user).slice(0, 20)}` }));
}

async function searchOpenverse(query, retry = true) {
  const params = new URLSearchParams({ q: query, page_size: "4", size: "large", license_type: "commercial", mature: "false" });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status >= 500 && retry) return searchOpenverse(query, false); // instabilidade momentânea
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || [])
    .filter((r) => !/\.(svg|gif)$/i.test(r.url) && (!r.width || r.width >= 900))
    .filter((r) => relevant(query, `${r.title} ${(r.tags || []).map((t) => t.name).join(" ")}`))
    .slice(0, 2)
    .map((r) => ({ url: r.url, credit: cleanCredit(r) }));
}

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "6",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "1400",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`);
  const data = await res.json();
  return Object.values(data.query?.pages || {})
    .sort((a, b) => a.index - b.index)
    .map((p) => p.imageinfo?.[0])
    .filter((i) => i && /jpeg|png/.test(i.mime) && i.width >= 900 && i.height >= 600)
    .slice(0, 2)
    .map((i) => ({ url: i.thumburl || i.url, credit: "Wikimedia Commons" }));
}

// Vídeos curtos do Pixabay (mesma chave PIXABAY_API_KEY), filtrados pela relevância dos tags
async function searchPixabayVideos(query) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ key, q: query.slice(0, 100), per_page: "5", safesearch: "true" });
  const res = await fetch(`https://pixabay.com/api/videos/?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Pixabay vídeos HTTP ${res.status}`);
  const data = await res.json();
  return (data.hits || [])
    .filter((h) => relevant(query, h.tags) && h.duration >= 4)
    .slice(0, 1)
    .map((h) => {
      const v = h.videos.medium?.url ? h.videos.medium : h.videos.large?.url ? h.videos.large : h.videos.small;
      return { type: "video", url: v.url, key: `pixabay-video-${h.id}`, credit: `Pixabay/${String(h.user).slice(0, 20)}` };
    });
}

async function downloadVideo(url, outMp4) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(outMp4, Buffer.from(await res.arrayBuffer()));
  const dur = parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outMp4]).toString().trim(),
  );
  if (!(dur >= 3)) throw new Error(`vídeo curto demais (${dur}s)`);
}

// Baixa e converte para JPG; descarta imagens pequenas ou quebradas.
async function download(url, outJpg) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = outJpg + ".raw";
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  try {
    const dims = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", raw])
      .toString()
      .trim()
      .split(",")
      .map(Number);
    if (!(dims[0] >= 600 && dims[1] >= 400)) throw new Error(`pequena demais (${dims.join("x")})`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-frames:v", "1", "-q:v", "3", outJpg]);
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

export async function collectImages({ articleImages = [], queries = [], coverImage, outDir, max = 4, maxVideos = 2 }) {
  // 1) foto da própria matéria (a mais relevante), 2) trechos de vídeo, 3) fotos de banco para completar
  const fromArticle = articleImages.filter((u) => u !== coverImage).map((url) => ({ type: "image", url, credit: "Reprodução" }));
  const videos = [];
  for (const q of queries.slice(0, 3)) {
    if (videos.length >= maxVideos) break;
    try {
      videos.push(...(await searchPixabayVideos(q)));
    } catch (err) {
      console.warn(`[imagens] busca de vídeo "${q}" falhou: ${err.message}`);
    }
  }
  const photos = [];
  for (const q of queries.slice(0, 3)) {
    let found = 0;
    for (const search of [searchOpenverse, searchPixabay, searchPexels, searchCommons]) {
      if (found >= 2) break; // já achou o suficiente para esta busca
      try {
        const r = await search(q);
        photos.push(...r.map((x) => ({ type: "image", ...x })));
        found += r.length;
      } catch (err) {
        console.warn(`[imagens] busca "${q}" falhou: ${err.message}`);
      }
    }
  }
  const candidates = [...fromArticle.slice(0, 1), ...videos.slice(0, maxVideos), ...fromArticle.slice(1), ...photos];

  // descarta repetidas: mesma URL, mesma foto do banco ou mesmo arquivo (a mesma foto pode vir de buscas diferentes)
  const seen = new Set();
  const seenHashes = new Set();
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= max) break;
    const key = c.key || c.url;
    if (seen.has(key)) continue;
    seen.add(key);
    const file = path.join(outDir, `${c.type === "video" ? "clip" : "img"}-${picked.length + 1}.${c.type === "video" ? "mp4" : "jpg"}`);
    try {
      if (c.type === "video") await downloadVideo(c.url, file);
      else await download(c.url, file);
      const hash = crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
      if (seenHashes.has(hash)) {
        fs.rmSync(file, { force: true });
        continue;
      }
      seenHashes.add(hash);
      picked.push({ type: c.type, file, credit: c.credit, url: c.url });
    } catch (err) {
      console.warn(`[imagens] descartada (${err.message}): ${c.url.slice(0, 90)}`);
    }
  }
  // intercala vídeo e foto para dar ritmo
  const vids = picked.filter((p) => p.type === "video");
  const imgs = picked.filter((p) => p.type !== "video");
  const out = [];
  while (vids.length || imgs.length) {
    if (imgs.length) out.push(imgs.shift());
    if (vids.length) out.push(vids.shift());
  }
  return out;
}
