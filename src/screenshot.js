// Abre a matéria num navegador headless, tira o print e extrai o texto.
// Também renderiza a capa (card com a manchete) usada no início do vídeo e como thumbnail.
import { chromium } from "playwright";
import fs from "node:fs";

const CONSENT_TEXTS = ["Aceitar", "Aceito", "Concordo", "Aceitar todos", "Aceitar e fechar", "Entendi", "OK", "Accept", "I agree", "Continuar"];

async function launch() {
  const opts = {};
  // No container do Claude Code o Chromium fica nesse caminho; no GitHub Actions o Playwright instala o seu.
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

export async function captureArticle(url, outPng) {
  const browser = await launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 400, height: 800 },
      deviceScaleFactor: 2.7, // 400 * 2.7 = 1080 px de largura
      isMobile: true,
      hasTouch: true,
      locale: "pt-BR",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);

    // Tenta fechar banners de cookies / LGPD
    for (const t of CONSENT_TEXTS) {
      const btn = page.getByRole("button", { name: t, exact: true }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }

    // Esconde pop-ups, anúncios e overlays — mas nunca o bloco que contém a matéria
    // (alguns sites usam palavras como "paywall" ou "modal" na classe da página inteira)
    await page.addStyleTag({ content: `iframe { display: none !important; } html, body { overflow: auto !important; }` });
    await page.evaluate(() => {
      const h1 = document.querySelector("article h1, main h1, h1");
      const sel = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [class*="paywall" i], [class*="newsletter" i], [class*="modal" i], [class*="popup" i], [id*="ad-" i], [class*="banner-ad" i]';
      for (const el of document.querySelectorAll(sel)) {
        if (["HTML", "BODY", "MAIN", "ARTICLE"].includes(el.tagName)) continue;
        if (h1 && el.contains(h1)) continue;
        if ((el.innerText || "").length > 1500) continue; // é conteúdo, não pop-up
        el.style.setProperty("display", "none", "important");
      }
    });
    await page.evaluate(() => {
      const h1 = document.querySelector("article h1, main h1, h1");
      for (const el of document.querySelectorAll("body *")) {
        if (h1 && el.contains(h1)) continue;
        const s = getComputedStyle(el);
        if ((s.position === "fixed" || s.position === "sticky") && el.getBoundingClientRect().height > 40) {
          el.style.setProperty("display", "none", "important");
        }
      }
    });

    // Remove chamadas promocionais no meio do texto ("siga o canal no WhatsApp", "leia também"...)
    await page.evaluate(() => {
      const promo = /(siga|entre|participe|receba).{0,40}(whatsapp|telegram|canal|newsletter|google news)|leia (também|mais)|veja (também|mais)|publicidade|continua (após|depois) (a|da) publicidade/i;
      for (const el of document.querySelectorAll("p, li, a, div, aside, section")) {
        const t = (el.innerText || "").trim();
        if (t && t.length < 220 && promo.test(t)) el.style.setProperty("display", "none", "important");
      }
    });

    // Imagens da própria matéria (fotos grandes dentro do artigo, sem logos/anúncios)
    const articleImages = await page.evaluate(() => {
      const root = document.querySelector("article") || document.querySelector("main") || document.body;
      const urls = [];
      const og = document.querySelector('meta[property="og:image"]')?.content;
      if (og) urls.push(og);
      for (const img of root.querySelectorAll("img")) {
        const src = img.currentSrc || img.src || img.dataset.src;
        if (!src || src.startsWith("data:")) continue;
        if (img.naturalWidth && img.naturalWidth < 500) continue;
        if (/logo|avatar|icon|sprite|banner|ads?[\/_-]|pixel|placeholder/i.test(src)) continue;
        urls.push(new URL(src, location.href).href);
      }
      return [...new Set(urls)].slice(0, 6);
    });

    // Rola até o título da matéria (pula cabeçalho do site)
    const headlineY = await page.evaluate(() => {
      const h = document.querySelector("article h1, main h1, h1");
      return h ? Math.max(0, h.getBoundingClientRect().top + window.scrollY - 24) : 0;
    });

    const articleText = await page.evaluate(() => {
      const grab = (root) =>
        [...root.querySelectorAll("p")]
          .map((p) => p.innerText.trim())
          .filter((t) => t.length > 60)
          .join("\n");
      const root = document.querySelector("article") || document.querySelector("main") || document.body;
      let text = grab(root);
      if (text.length < 300) text = grab(document.body); // sites sem a marcação padrão de artigo
      return text.slice(0, 8000);
    });

    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clipH = Math.min(2200, Math.max(800, pageHeight - headlineY));
    await page.screenshot({ path: outPng, clip: { x: 0, y: headlineY, width: 400, height: clipH }, fullPage: true });
    return { articleText, articleImages, ok: true };
  } finally {
    await browser.close();
  }
}

function esc(s = "") {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export async function renderCover({ headline, source, image, profile, label = "NOTÍCIA", outPng }) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const bg = image ? `url('${image.replace(/'/g, "%27")}')` : "none";
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      * { margin:0; box-sizing:border-box; }
      body { width:1080px; height:1920px; font-family:'Inter','DejaVu Sans',sans-serif; color:#fff;
             background:#0b0f19 ${bg} center/cover no-repeat; position:relative; overflow:hidden; }
      .shade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,.35) 35%, rgba(5,8,15,.96) 62%); }
      .top { position:absolute; top:110px; left:70px; right:70px; display:flex; gap:20px; align-items:center; }
      .live { background:${profile.accentColor}; font-weight:800; font-size:40px; padding:10px 26px; border-radius:10px; letter-spacing:2px; }
      .brand { font-weight:800; font-size:40px; letter-spacing:1px; text-shadow:0 2px 8px #000; }
      .box { position:absolute; left:70px; right:70px; bottom:600px; }
      .src { display:inline-block; font-size:34px; font-weight:700; color:#fff; border-left:10px solid ${profile.accentColor}; padding-left:20px; margin-bottom:34px; opacity:.9; }
      h1 { font-size:76px; line-height:1.12; font-weight:900; letter-spacing:-1px; }
    </style></head><body>
      <div class="shade"></div>
      <div class="top"><span class="live">${esc(label)}</span><span class="brand">${esc(profile.name)}</span></div>
      <div class="box"><div class="src">Fonte: ${esc(source)}</div><h1>${esc(headline)}</h1></div>
    </body></html>`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: outPng });
  } finally {
    await browser.close();
  }
  return fs.existsSync(outPng);
}
