// Busca imagens relacionadas à notícia para intercalar no vídeo:
//   1. fotos da própria matéria (as mais relevantes)
//   2. Pixabay (banco gratuito; precisa de PIXABAY_API_KEY, opcional) e Pexels (PEXELS_API_KEY, opcional)
//   3. Openverse (gratuito, sem chave; reúne fotos com licença livre do Flickr, Wikimedia etc.)
//   4. Wikimedia Commons (gratuito, sem chave; reserva caso as outras não achem nada)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const UA = "NowNoticiasBot/0.1 (+https://github.com/0lesbon/Brainstock-games)";

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
  return (data.hits || []).slice(0, 2).map((h) => ({ url: h.largeImageURL, credit: `Pixabay/${String(h.user).slice(0, 20)}` }));
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

export async function collectImages({ articleImages = [], queries = [], coverImage, outDir, max = 4 }) {
  const candidates = articleImages.filter((u) => u !== coverImage).map((url) => ({ url, credit: "Reprodução" }));
  for (const q of queries.slice(0, 3)) {
    let found = 0;
    for (const search of [searchPixabay, searchPexels, searchOpenverse, searchCommons]) {
      if (found >= 2) break; // já achou o suficiente para esta busca
      try {
        const r = await search(q);
        candidates.push(...r);
        found += r.length;
      } catch (err) {
        console.warn(`[imagens] busca "${q}" falhou: ${err.message}`);
      }
    }
  }

  const seen = new Set();
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const file = path.join(outDir, `img-${picked.length + 1}.jpg`);
    try {
      await download(c.url, file);
      picked.push({ file, credit: c.credit, url: c.url });
    } catch (err) {
      console.warn(`[imagens] descartada (${err.message}): ${c.url.slice(0, 90)}`);
    }
  }
  return picked;
}
