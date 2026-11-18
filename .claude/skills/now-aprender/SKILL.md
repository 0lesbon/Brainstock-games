---
name: now-aprender
description: Analisa o desempenho dos vídeos do @now.noticias no Instagram, TikTok e YouTube (via Metricool) e atualiza state/aprendizados.md, que o robô lê ao escolher notícias e escrever roteiros. Use no disparo semanal de aprendizado ou quando o usuário pedir para o robô aprender com os resultados.
---

# Aprender com os resultados (ciclo semanal)

O robô (`src/script.js`) injeta o conteúdo de `state/aprendizados.md` nos prompts de **escolha da notícia** e de **roteiro**.
Esta skill mantém esse arquivo atualizado com base em dados reais. Marca do Metricool: blogId `8206313`.

## Passos
1. `git pull --rebase` no branch `claude/automated-news-video-profile-j9rpa2`. Leia `state/history.json`, `state/social.json`
   e o `state/aprendizados.md` atual.
2. Puxe as métricas dos últimos 14 dias no Metricool (`getAnalyticsAvailableMetrics` para ver os nomes e depois
   `getAnalyticsDataByMetrics`) para Instagram (Reels), TikTok e YouTube: visualizações/alcance, tempo médio assistido ou
   retenção, curtidas, comentários, compartilhamentos, salvamentos e seguidores ganhos, **por post**.
3. Cruze cada post com o histórico (pelo título/manchete): categoria, fonte, voz, duração, tipo de gancho da manchete
   (pergunta, número, "você", absurdo), horário e rede.
4. Calcule o que funciona: compare a mediana de visualizações e de compartilhamentos+salvamentos por categoria, por tipo de
   gancho, por voz, por faixa de duração (<35 s, 35–45 s, >45 s) e por horário/rede. Só tire conclusão com pelo menos 3 posts
   no grupo; com menos, marque como "hipótese".
5. Reescreva `state/aprendizados.md` (máx. ~3500 caracteres), em português, no formato:
   - `## Atualizado em <data>` e o período analisado
   - `## Faça mais` (3 a 6 itens concretos: temas, ganchos, estruturas, duração — cite os 2 ou 3 melhores títulos como exemplo)
   - `## Evite` (3 a 5 itens, com os piores títulos como exemplo)
   - `## Testes da semana` (1 ou 2 experimentos para a próxima semana, ex.: "testar ganchos com número no início")
   Escreva como instruções diretas para o roteirista e o editor. Não inclua dados pessoais.
6. Ajustes opcionais no `config.json`, só com evidência forte (≥ 2 semanas apontando a mesma coisa):
   - `categories.rotation`: aumentar a frequência da categoria que mais performa (nunca remover nenhuma);
   - `state/social.json` → `slots`: trocar um horário de uma rede que ficou consistentemente abaixo da média.
7. Commit ("Aprendizados: semana de <data>") e push. Mande ao usuário um resumo curto (5 linhas) do que mudou.

## Regras
- Nunca invente métricas; se o Metricool não devolver dados de uma rede, diga isso no arquivo.
- Mantenha as regras de qualidade e de segurança do roteiro (o arquivo só complementa o prompt, não o substitui).
