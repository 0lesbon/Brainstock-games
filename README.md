# @now.noticias — Reels de notícia automáticos

Gera sozinho Reels de notícia sobre **tecnologia, IA, ciência, curiosidades e economia**, narrados com a **ElevenLabs**,
com print da matéria e fotos relacionadas.

```
RSS dos portais ─► escolhe notícia inédita ─► print da matéria + texto
      ─► Gemini (ou Claude) escreve o roteiro ─► ElevenLabs narra (com tempos por palavra)
      ─► ffmpeg monta o vídeo 1080x1920 ─► GitHub Releases hospeda ─► Metricool agenda no Instagram/YouTube
```

**Como fica o vídeo (30–40 s):** capa com a manchete e o assunto (zoom lento) → print da matéria rolando →
fotos relacionadas (da matéria, Pexels, Openverse ou Wikimedia Commons) com zoom lento → print de novo.
Barra da marca no topo, "Fonte: …", crédito da imagem e legenda palavra por palavra sincronizada com a voz.
Os assuntos se revezam a cada vídeo (`categories.rotation` em `config.json`).

## Configuração (uma vez)

1. **Secrets do GitHub** — em *Settings → Secrets and variables → Actions → New repository secret*:

   | Secret | Para quê | Obrigatório |
   |---|---|---|
   | `GOOGLE_TTS_API_KEY` | narração com vozes brasileiras do Google (grátis até o limite mensal) | sim |
   | `ELEVENLABS_API_KEY` | narração com ElevenLabs (`voice.provider` = `elevenlabs` ou `misto`) | opcional |
   | `ELEVENLABS_VOICE_ID` | sua voz (Voice Library). Entra em rodízio com as vozes padrão de `config.json` (`voice.defaultVoices`) | recomendado |
   | `GEMINI_API_KEY` | roteiro escrito pelo Gemini (Google AI Studio) | recomendado |
   | `ANTHROPIC_API_KEY` | alternativa ao Gemini: roteiro pelo Claude | opcional |
   | `PIXABAY_API_KEY` | fotos de banco de imagens mais bonitas (grátis em pixabay.com/api/docs) | opcional |
   | `PEXELS_API_KEY` | idem, Pexels (novas chaves estão pausadas) | opcional |
   | `GMAIL_USER` | Gmail que envia os vídeos (modo e-mail, o padrão) | sim, no modo e-mail |
   | `GMAIL_APP_PASSWORD` | senha de app do Gmail (myaccount.google.com/apppasswords) | sim, no modo e-mail |
   | `EMAIL_TO` | onde receber, se for outro e-mail | opcional |
   | `METRICOOL_USER_TOKEN` | postagem automática (Metricool → Configurações → API) | para postar |
   | `METRICOOL_USER_ID` | seu ID de usuário no Metricool | para postar |
   | `METRICOOL_BLOG_ID` | ID da marca (a do `pioneiro.curioso` é `7696558`) | para postar |

   Em `config.json`, `publish.mode` escolhe: `"email"` (você recebe o vídeo + legenda e posta pelo celular)
   ou `"metricool"` (agenda sozinho; exige plano Advanced do Metricool).

2. **Repositório público** — o Metricool baixa o vídeo por link; os releases precisam ser públicos.
3. Ajuste o `config.json`: nome do perfil, cor, feeds, palavras bloqueadas, redes e voz.

## Rodando

- **Automático:** o workflow `.github/workflows/noticias.yml` roda 3x por dia (~08h40, 12h40 e 18h40 de Brasília).
- **Manual:** aba *Actions → Vídeo de notícia automático → Run workflow*. Dá para colar o link de uma matéria
  específica e desmarcar "Publicar" para só gerar o vídeo (ele fica disponível como artefato do workflow).
- **Local:**
  ```bash
  npm install && npx playwright install chromium
  cp .env.example .env   # preencha as chaves e exporte: set -a; . ./.env; set +a
  node src/run.js --no-publish            # gera em out/<id>/video.mp4
  node src/run.js --url https://...       # usa uma matéria específica
  ```

O arquivo `state/history.json` guarda o que já foi publicado, para não repetir notícia nem assunto.

## Cuidados

- O roteiro reescreve a notícia com outras palavras e sempre cita o veículo; o vídeo mostra "Fonte: …".
  Mesmo assim, usar print de matéria de terceiros tem risco de direito autoral — prefira fontes com licença aberta
  (ex.: Agência Brasil, que permite reprodução com crédito) se quiser reduzir esse risco.
- Os posts saem marcados como conteúdo gerado por IA no Instagram/YouTube/TikTok.
- `selection.blockKeywords` evita temas sensíveis; revise a lista para o seu público.
