// Narração com a ElevenLabs. Usa o endpoint "with-timestamps" para sincronizar as legendas palavra por palavra.
import fs from "node:fs";

export async function narrate(text, voiceCfg, outMp3) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Defina ELEVENLABS_API_KEY (sua chave da ElevenLabs).");
  const voiceId = process.env.ELEVENLABS_VOICE_ID || voiceCfg.voiceId;

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
