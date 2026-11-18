---
name: now-publicar
description: Agenda no Metricool (Instagram, TikTok e YouTube) os vídeos novos do @now.noticias que ainda não foram agendados. Use quando um disparo agendado pedir para publicar os vídeos novos, ou quando o usuário pedir para postar um vídeo do robô.
---

# Publicar vídeos novos do @now.noticias no Metricool

Marca do Metricool: **now.noticias**, blogId `8206313`, fuso `America/Sao_Paulo`.
Controle do que já foi agendado: `state/social.json` (chave = tag do release `video-<id>`).

## Passos
1. `git pull --rebase` no branch `claude/automated-news-video-profile-j9rpa2` e leia `state/social.json`.
2. Liste os releases do repositório `0lesbon/Brainstock-games` (ferramenta do GitHub `list_releases`, campos `tag_name`, `name`, `published_at`).
   Pegue os releases publicados **depois** de `cutoff` que ainda não estão em `posts`.
3. Para cada um (do mais antigo para o mais novo), leia o release (`get_release_by_tag`):
   - o `body` traz a legenda pronta + hashtags e, no fim, `<!--now-meta {...} -->` com id, headline, category, source, voice, duration, hashtags.
   - vídeo: `https://github.com/0lesbon/Brainstock-games/releases/download/<tag>/video.mp4`
   - Se o body não tiver legenda (release antigo), procure o e-mail "🎬 Novo vídeo: <name>" no Gmail e use a legenda dele.
4. Escolha o horário de cada rede: o próximo horário de `slots.<rede>` que seja pelo menos 20 min no futuro e ainda não usado
   por outro post desta rede no mesmo dia (confira com `getScheduledPosts` do Metricool). Notícia quente (tecnologia/economia)
   vai no primeiro horário livre; ciência/curiosidade (atemporal) pode ir no horário de pico da noite.
5. Agende um post **por rede** com `createScheduledPost` (blogId `8206313`, `autoPublish: true`):
   - **Instagram**: `instagramData: {type: "REEL", showReelOnFeed: true, isAiGenerated: true}`; texto = legenda do release.
   - **TikTok**: `tiktokData: {title: <name>, privacyOption: "PUBLIC_TO_EVERYONE", isAigc: true, autoAddMusic: false}`;
     texto = legenda sem a linha "Siga @now.noticias" (hashtags no máximo 6).
   - **YouTube**: `youtubeData: {title: <name> + emoji, type: "short", privacy: "public", category: "SCIENCE_TECHNOLOGY",
     madeForKids: false, isAiGeneratedContent: true, tags: 6 palavras-chave}`; texto = legenda trocando a chamada final por
     "Inscreva-se no NOW Notícias pra mais <tema> em 30 segundos." e com `#Shorts` como primeira hashtag.
6. Registre em `state/social.json` → `posts[<tag>] = {title, instagram, tiktok, youtube}` (data e hora agendadas de cada rede),
   faça commit ("Social: agenda <tag>") e push. Se um agendamento falhar, registre `"erro: <mensagem>"` na rede e siga.
7. Responda em uma linha só se algo falhou; se deu tudo certo, responda só "Agendado".

## Regras
- Nunca reagende o que já está em `posts`. Nunca poste nos perfis de outra marca do Metricool.
- Não invente fatos: use só o texto da legenda gerada.
- Instagram não aceita mais de 30 hashtags; TikTok aceita título até 90 caracteres; YouTube título até 100.
