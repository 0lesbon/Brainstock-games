# Perfil de notícias automático

Gera e publica sozinho vídeos curtos de notícia (Reels / Shorts), narrados com a **ElevenLabs**.

```
RSS dos portais ─► escolhe notícia inédita ─► print da matéria + texto
      ─► Gemini (ou Claude) escreve o roteiro ─► ElevenLabs narra (com tempos por palavra)
      ─► ffmpeg monta o vídeo 1080x1920 ─► GitHub Releases hospeda ─► Metricool agenda no Instagram/YouTube
```

**Como fica o vídeo:** 3 s de capa com a manchete e a foto da notícia (zoom lento) → print da matéria rolando
dentro de um card, com barra da marca no topo, "Fonte: …" e legenda palavra por palavra sincronizada com a voz.

## Configuração (uma vez)

1. **Secrets do GitHub** — em *Settings → Secrets and variables → Actions → New repository secret*:

   | Secret | Para quê | Obrigatório |
   |---|---|---|
   | `ELEVENLABS_API_KEY` | narração | sim |
   | `ELEVENLABS_VOICE_ID` | voz escolhida na Voice Library (escolha uma voz brasileira) | recomendado |
   | `GEMINI_API_KEY` | roteiro escrito pelo Gemini (Google AI Studio) | recomendado |
   | `ANTHROPIC_API_KEY` | alternativa ao Gemini: roteiro pelo Claude | opcional |
   | `METRICOOL_USER_TOKEN` | postagem automática (Metricool → Configurações → API) | para postar |
   | `METRICOOL_USER_ID` | seu ID de usuário no Metricool | para postar |
   | `METRICOOL_BLOG_ID` | ID da marca (a do `pioneiro.curioso` é `7696558`) | para postar |

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
