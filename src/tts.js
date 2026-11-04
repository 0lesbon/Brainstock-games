// Narração. Dois provedores:
//   - Google Cloud Text-to-Speech (padrão; grátis até o limite mensal do Google)
//   - ElevenLabs (opcional; usa sua voz personalizada)
// Os dois devolvem o tempo de cada palavra, usado na legenda sincronizada.
import fs from "node:fs";

// Escolhe a voz do vídeo em rodízio. O índice vem do número de vídeos já feitos.
//   voice.provider = "google" | "elevenlabs" | "misto" (misto: intercala as listas dos dois)
export function pickVoice(voiceCfg, index) {
  const provider = voiceCfg.provider || "google";
  const google = (voiceCfg.googleVoices || []).map((v) => ({ provider: "google", ...v }));
  const own = (process.env.ELEVENLABS_VOICE_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  const eleven = [
    ...own.flatMap((id) => [{ name: "sua voz", id }, { name: "sua voz", id }]),
    ...(voiceCfg.defaultVoices || []),
  ].map((v) => ({ provider: "elevenlabs", ...v }));

  const mixed = [];
  for (let i = 0; i < Math.max(google.length, eleven.length); i++) {
    if (google[i]) mixed.push(google[i]);
    if (eleven[i]) mixed.push(eleven[i]);
  }
  const pool = provider === "elevenlabs" ? eleven : provider === "misto" ? mixed : google;
  if (!pool.length) throw new Error(`Nenhuma voz configurada para o provedor "${provider}".`);
  return pool[index % pool.length];
}

export async function narrate(text, voiceCfg, outMp3, voice) {
  if (voice.provider === "elevenlabs") return narrateElevenLabs(text, voiceCfg, outMp3, voice.id);
  return narrateGoogle(text, voiceCfg, outMp3, voice.id);
}

// ---------------- Google Cloud Text-to-Speech ----------------
function escXml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

async function narrateGoogle(text, voiceCfg, outMp3, voiceName, retry = true) {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error("Defina GOOGLE_TTS_API_KEY (chave do Google Cloud Text-to-Speech).");

  // Uma marca antes de cada palavra: o Google devolve em que segundo cada marca foi falada.
  const tokens = text.split(/\s+/).filter(Boolean);
  const ssml = `<speak>${tokens.map((w, i) => `<mark name="${i}"/>${escXml(w)}`).join(" ")}</speak>`;

  const res = await fetch("https://texttospeech.googleapis.com/v1beta1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: "pt-BR", name: voiceName },
      audioConfig: { audioEncoding: "MP3", speakingRate: voiceCfg.googleSpeakingRate ?? 1.1, sampleRateHertz: 44100 },
      enableTimePointing: ["SSML_MARK"],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    // voz inexistente/indisponível: tenta uma voz padrão antes de desistir
    if (retry && res.status === 400 && /voice/i.test(body) && voiceName !== "pt-BR-Neural2-A") {
      console.warn(`[voz] ${voiceName} indisponível; usando pt-BR-Neural2-A.`);
      return narrateGoogle(text, voiceCfg, outMp3, "pt-BR-Neural2-A", false);
    }
    throw new Error(`Google TTS HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  fs.writeFileSync(outMp3, Buffer.from(data.audioContent, "base64"));

  const starts = new Map((data.timepoints || []).map((t) => [Number(t.markName), t.timeSeconds]));
  const words = [];
  tokens.forEach((w, i) => {
    if (!starts.has(i)) return;
    words.push({ text: w, start: starts.get(i), end: starts.get(i) + 0.35 });
  });
  for (let i = 0; i + 1 < words.length; i++) words[i].end = Math.max(words[i].start + 0.05, words[i + 1].start - 0.02);
  return { words };
}

// ---------------- ElevenLabs ----------------
async function narrateElevenLabs(text, voiceCfg, outMp3, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Defina ELEVENLABS_API_KEY (sua chave da ElevenLabs).");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: voiceCfg.modelId,
        language_code: "pt",
        voice_settings: {
          stability: voiceCfg.stability,
          similarity_boost: voiceCfg.similarityBoost,
          style: voiceCfg.style,
          speed: voiceCfg.speed,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  fs.writeFileSync(outMp3, Buffer.from(data.audio_base64, "base64"));
  const words = alignmentToWords(data.normalized_alignment || data.alignment);
  return { words };
}

// Converte o alinhamento por caractere em palavras com início/fim (segundos).
export function alignmentToWords(al) {
  if (!al?.characters) return [];
  const words = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    const start = al.character_start_times_seconds[i];
    const end = al.character_end_times_seconds[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur), (cur = null);
      return;
    }
    if (!cur) cur = { text: "", start, end };
    cur.text += ch;
    cur.end = end;
  });
  if (cur) words.push(cur);
  return words;
}
