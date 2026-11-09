// Busca notícias recentes nos feeds RSS configurados e escolhe uma inédita.
import crypto from "node:crypto";

const UA = "Mozilla/5.0 (compatible; PerfilNoticiasBot/0.1)";

function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripHtml(s = "") {
  return decodeEntities(decodeEntities(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

export function parseRss(xml, source, category = "geral") {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = stripHtml(tag(block, "title"));
    const link = stripHtml(tag(block, "link")) || (block.match(/<guid[^>]*>([^<]+)<\/guid>/i)?.[1] ?? "");
    const rawDesc = tag(block, "description");
    const description = stripHtml(rawDesc).slice(0, 1200);
    const pub = stripHtml(tag(block, "pubDate"));
    const image =
      block.match(/<media:content[^>]+url="([^"]+)"/i)?.[1] ||
      block.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image/i)?.[1] ||
      decodeEntities(rawDesc).match(/<img[^>]+src="([^"]+)"/i)?.[1] ||
      null;
    if (!title || !link) continue;
    items.push({
      id: crypto.createHash("sha1").update(link).digest("hex").slice(0, 16),
      source,
      category,
      title,
      link: link.trim(),
      description,
      image,
      publishedAt: pub ? new Date(pub) : null,
    });
  }
  return items;
}

export async function fetchFeeds(feeds) {
  const all = [];
  await Promise.all(
    feeds.map(async ({ source, url, category }) => {
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        all.push(...parseRss(await res.text(), source, category));
      } catch (err) {
        console.warn(`[news] falha no feed ${source}: ${err.message}`);
      }
    }),
  );
  return all;
}

// Escolhe a notícia mais recente que ainda não foi publicada e passa nos filtros.
// Se preferCategory for informado, dá preferência a esse assunto (rodízio de nichos).
export function pickStory(items, opts) {
  return rankStories(items, opts)[0];
}

// Lista de candidatas já filtradas, da preferida (assunto do rodízio, mais recente) para a menos preferida.
export function rankStories(items, { history, preferCategory, maxAgeHours = 12, maxAgeHoursByCategory = {}, blockKeywords = [], blockUrlParts = [], minDescriptionChars = 0 }) {
  const seen = new Set(history.published.map((p) => p.id));
  const seenTitles = history.published.map((p) => normalize(p.title));
  const blocked = blockKeywords.map(normalize);

  return items
    .filter((it) => !seen.has(it.id))
    .filter((it) => {
      if (!it.publishedAt || isNaN(it.publishedAt)) return true;
      const hours = Number(maxAgeHoursByCategory[it.category]) || maxAgeHours;
      return it.publishedAt.getTime() >= Date.now() - hours * 3600 * 1000;
    })
    // pula vídeos, programas de TV e transmissões ao vivo (não viram uma boa matéria para print)
    .filter((it) => !blockUrlParts.some((p) => it.link.toLowerCase().includes(p)))
    .filter((it) => it.description.length >= minDescriptionChars)
    .filter((it) => {
      const text = normalize(`${it.title} ${it.description}`);
      return !blocked.some((k) => text.includes(k));
    })
    // evita repetir o mesmo assunto vindo de outro veículo
    .filter((it) => !seenTitles.some((t) => similarity(t, normalize(it.title)) > 0.6))
    .sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0))
    .sort((a, b) => (b.category === preferCategory) - (a.category === preferCategory));
}

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");
}

function similarity(a, b) {
  const A = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const B = new Set(b.split(/\s+/).filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
