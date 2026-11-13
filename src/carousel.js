// Carrossel semanal do @now.noticias: capa + 10 notícias + chamada final, em 1080x1350 (4:5).
// Uso: node src/carousel.js carrossel/<arquivo>.json <pasta-de-saída>
// O JSON traz o texto de cada slide e o caminho (ou URL) da foto.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const W = 1080;
const H = 1350;

function esc(s = "") {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
// *texto* vira destaque na cor do perfil
function hl(s) {
  return esc(s).replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>');
}

function img(src, base) {
  if (!src) return "";
  if (/^https?:/.test(src)) return src;
  const file = path.resolve(base, src);
  const ext = path.extname(file).slice(1).replace("jpg", "jpeg");
  return `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}`;
}

const CSS = (accent) => `
* { margin:0; padding:0; box-sizing:border-box; }
body { width:${W}px; height:${H}px; overflow:hidden; background:#0b0f19; color:#fff;
       font-family:'Inter','DejaVu Sans',sans-serif; -webkit-font-smoothing:antialiased; }
.hl { color:${accent}; }
.brand { display:flex; align-items:center; gap:16px; font-weight:800; font-size:30px; letter-spacing:1px; }
.chip { background:${accent}; color:#fff; font-weight:800; font-size:24px; letter-spacing:2px; padding:8px 18px; border-radius:8px; }
.top { position:absolute; top:56px; left:64px; right:64px; display:flex; justify-content:space-between; align-items:center; z-index:3; }
.page { font-weight:700; font-size:24px; color:#cbd5e1; background:rgba(255,255,255,.08); padding:8px 16px; border-radius:20px; }
.foot { position:absolute; bottom:52px; left:64px; right:64px; display:flex; justify-content:space-between; align-items:center; font-size:24px; color:#94a3b8; z-index:3; }
.swipe { font-weight:800; color:#fff; letter-spacing:2px; }

/* capa */
.cover-bg { position:absolute; inset:0; background-size:cover; background-position:center; }
.cover-shade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(11,15,25,.55) 0%, rgba(11,15,25,.25) 30%, rgba(11,15,25,.92) 58%, #0b0f19 75%); }
.cover-box { position:absolute; left:64px; right:64px; bottom:190px; z-index:3; }
.kicker { display:inline-block; font-weight:800; font-size:28px; letter-spacing:3px; border-left:10px solid ${accent}; padding-left:18px; margin-bottom:28px; color:#e2e8f0; }
.cover-title { font-weight:900; font-size:96px; line-height:1.0; letter-spacing:-2px; text-transform:uppercase; }
.cover-sub { margin-top:28px; font-size:34px; color:#cbd5e1; line-height:1.3; }

/* notícia */
.photo { position:absolute; top:140px; left:64px; right:64px; height:560px; border-radius:28px; background-size:cover; background-position:center; overflow:hidden; }
.photo::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg, transparent 60%, rgba(0,0,0,.45)); }
.photo .chip { position:absolute; left:24px; bottom:24px; z-index:2; }
.num { position:absolute; top:630px; right:64px; width:150px; height:150px; border-radius:28px; background:${accent}; color:#fff; font-weight:900; font-size:84px; display:flex; align-items:center; justify-content:center; letter-spacing:-2px; box-shadow:0 10px 30px rgba(0,0,0,.45); z-index:2; }
.body { position:absolute; top:810px; left:64px; right:64px; }
.title { font-weight:900; font-size:56px; line-height:1.06; letter-spacing:-1px; margin-bottom:20px; }
.text { font-size:30px; line-height:1.4; color:#d6dbe4; }
.data { margin-top:22px; display:flex; gap:18px; align-items:flex-start; background:rgba(255,255,255,.06); border-left:8px solid ${accent}; border-radius:14px; padding:20px 24px; font-size:28px; line-height:1.35; font-weight:700; }

/* chamada final */
.cta { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:0 80px; background:radial-gradient(circle at 50% 35%, #1b2233 0%, #0b0f19 65%); }
.cta h2 { font-weight:900; font-size:84px; line-height:1.02; letter-spacing:-2px; margin-bottom:56px; }
.cta .row { display:flex; gap:26px; align-items:center; font-size:38px; font-weight:700; margin:20px 0; }
.cta .ico { width:84px; height:84px; border-radius:22px; background:${accent}; display:flex; align-items:center; justify-content:center; font-size:44px; flex:none; }
.cta .follow { margin-top:64px; font-size:30px; color:#cbd5e1; line-height:1.4; }
.cta .follow b { color:#fff; }
`;

function shell(accent, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS(accent)}</style></head><body>${inner}</body></html>`;
}

function brandHtml(profile) {
  return `<div class="brand"><span class="chip">NOW</span><span>${esc(profile.name.replace(/^NOW\s*/i, "") || "NOTÍCIAS")}</span></div>`;
}

function coverSlide(d, profile, base, total) {
  return `<div class="cover-bg" style="background-image:url('${img(d.cover.image, base)}')"></div><div class="cover-shade"></div>
  <div class="top">${brandHtml(profile)}<span class="page">${esc(d.cover.period)}</span></div>
  <div class="cover-box"><div class="kicker">${esc(d.cover.kicker)}</div>
    <div class="cover-title">${hl(d.cover.title)}</div>
    ${d.cover.subtitle ? `<div class="cover-sub">${hl(d.cover.subtitle)}</div>` : ""}</div>
  <div class="foot"><span>${esc(profile.handle)}</span><span class="swipe">ARRASTA PRO LADO &nbsp;›››</span></div>`;
}

function itemSlide(it, i, profile, base, total) {
  return `<div class="top">${brandHtml(profile)}<span class="page">${i + 2}/${total}</span></div>
  <div class="photo" style="background-image:url('${img(it.image, base)}')"><span class="chip">${esc(it.category)}</span></div>
  <div class="num">${String(i + 1).padStart(2, "0")}</div>
  <div class="body"><div class="title">${hl(it.title)}</div><div class="text">${hl(it.text)}</div>
    ${it.data ? `<div class="data"><span>👉</span><span>${hl(it.data)}</span></div>` : ""}</div>
  <div class="foot"><span>Fonte: ${esc(it.source)}</span><span class="swipe">›››</span></div>`;
}

function ctaSlide(d, profile, total) {
  return `<div class="cta">
    <div class="top" style="position:absolute">${brandHtml(profile)}<span class="page">${total}/${total}</span></div>
    <h2>${hl(d.cta.title)}</h2>
    <div class="row"><span class="ico">💬</span><span>${hl(d.cta.comment)}</span></div>
    <div class="row"><span class="ico">🔖</span><span>Salve para não esquecer</span></div>
    <div class="row"><span class="ico">📤</span><span>Mande para quem precisa saber</span></div>
    <div class="follow">Siga <b>${esc(profile.handle)}</b><br>${esc(d.cta.follow)}</div>
  </div>`;
}

export async function renderCarousel(dataFile, outDir, profile) {
  const base = path.dirname(path.resolve(dataFile));
  const d = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const total = d.items.length + 2;
  const accent = profile.accentColor || "#E11D48";
  fs.mkdirSync(outDir, { recursive: true });
  const opts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const slides = [coverSlide(d, profile, base, total), ...d.items.map((it, i) => itemSlide(it, i, profile, base, total)), ctaSlide(d, profile, total)];
  const files = [];
  for (const [i, inner] of slides.entries()) {
    await page.setContent(shell(accent, inner), { waitUntil: "load" });
    await page.waitForTimeout(150);
    const f = path.join(outDir, `${String(i + 1).padStart(2, "0")}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 92 });
    files.push(f);
  }
  await browser.close();
  return files;
}

// linha de comando
if (process.argv[1] && process.argv[1].endsWith("carousel.js")) {
  const [dataFile, outDir] = process.argv.slice(2);
  const cfg = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  renderCarousel(dataFile, outDir || "out/carrossel", cfg.profile).then((f) => console.log(f.join("\n")));
}
