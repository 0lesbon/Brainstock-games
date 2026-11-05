// Decide se a execução agendada deve gerar um vídeo agora.
// O agendamento do GitHub atrasa ou pula horários; por isso o workflow acorda de hora em hora
// e este script libera o vídeo só quando faz sentido:
//   - dentro da janela de horário (fuso do perfil)
//   - abaixo do limite de vídeos do dia
//   - com intervalo mínimo desde o último vídeo
// Escreve run=true|false em $GITHUB_OUTPUT. Não depende de pacotes (roda antes do npm ci).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const history = JSON.parse(fs.readFileSync(path.join(ROOT, "state", "history.json"), "utf8"));
const sched = { startHour: 8, endHour: 22, videosPerDay: 3, minHoursBetween: 3.5, ...(cfg.schedule || {}) };
const tz = cfg.profile.timezone || "America/Sao_Paulo";

function localParts(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const now = new Date();
const { day, hour } = localParts(now);
const sent = history.published.map((p) => new Date(p.emailedAt || p.scheduledFor || p.createdAt)).filter((d) => !isNaN(d));
const today = sent.filter((d) => localParts(d).day === day).length;
const last = sent.sort((a, b) => b - a)[0];
const hoursSince = last ? (now - last) / 3600000 : Infinity;

let run = true;
let why = "liberado";
if (hour < sched.startHour || hour >= sched.endHour) (run = false), (why = `fora da janela ${sched.startHour}h-${sched.endHour}h (agora ${hour}h)`);
else if (today >= sched.videosPerDay) (run = false), (why = `já saíram ${today} vídeos hoje`);
else if (hoursSince < sched.minHoursBetween) (run = false), (why = `último vídeo há ${hoursSince.toFixed(1)} h`);

console.log(`[agenda] ${run ? "gerar vídeo" : "pular"}: ${why} (hoje: ${today}/${sched.videosPerDay})`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
