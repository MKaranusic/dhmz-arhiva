// Sakupljač DHMZ mjerenja: sprema zadnja 24 sata (vjetar, tlak, zrak) i današnju temperaturu mora
// u jednu JSON datoteku po danu (data/GGGG/GGGG-MM-DD.json). Podaci: DHMZ, meteo.hr (Otvorena dozvola RH).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseSat, parseMore } from "./parse.mjs";

const SAT_URL = h => `https://meteo.hr/podaci.php?section=podaci_vrijeme&param=hrvatska1_n&sat=${h}`;
const MORE_URL = "https://vrijeme.hr/more_n.xml";
const p2 = n => String(n).padStart(2, "0");

async function dohvati(url) {
  for (let pokusaj = 1; ; pokusaj++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "dhmz-arhiva (osobni ribolovni dnevnik)" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const glava = buf.subarray(0, 2048).toString("latin1");
      const cs = ((r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || glava.match(/charset=["']?([\w-]+)/i) || glava.match(/encoding=["']([\w-]+)/i) || [, "utf-8"])[1];
      return new TextDecoder(cs).decode(buf);
    } catch (e) {
      if (pokusaj >= 3) throw e;
      await new Promise(r => setTimeout(r, 3000 * pokusaj));
    }
  }
}

const dani = {};   // datum → sadržaj datoteke
async function dan(datum) {
  if (!dani[datum]) {
    try { dani[datum] = JSON.parse(await readFile(`data/${datum.slice(0, 4)}/${datum}.json`, "utf8")); }
    catch { dani[datum] = { datum, izvor: "DHMZ (meteo.hr)", sati: {}, more: { termini: [], postaje: {} } }; }
  }
  return dani[datum];
}

let dobrihSati = 0;
for (let h = 0; h < 24; h++) {
  try {
    const p = parseSat(await dohvati(SAT_URL(p2(h))));
    if (!p || Object.keys(p.postaje).length < 10) { console.log(`sat ${p2(h)}: nije pročitano`); continue; }
    const d = await dan(p.datum);
    d.sati[p.sat] = { ...(d.sati[p.sat] || {}), ...p.postaje };
    dobrihSati++;
  } catch (e) { console.log(`sat ${p2(h)}: ${e.message}`); }
}

let moreOk = false;
try {
  const m = parseMore(await dohvati(MORE_URL));
  if (m) {
    const d = await dan(m.datum);
    const svi = [...new Set([...d.more.termini, ...m.termini])].sort();
    const stare = d.more.postaje, stariT = d.more.termini, nove = {};
    for (const ime of new Set([...Object.keys(stare), ...Object.keys(m.postaje)])) {
      nove[ime] = svi.map(t => {
        const n = m.postaje[ime]?.[m.termini.indexOf(t)], s = stare[ime]?.[stariT.indexOf(t)];
        return n ?? s ?? null;                       // novo mjerenje ima prednost, staro se ne briše
      });
    }
    d.more = { termini: svi, postaje: nove };
    moreOk = true;
  }
} catch (e) { console.log(`more: ${e.message}`); }

for (const [datum, d] of Object.entries(dani)) {
  d.sati = Object.fromEntries(Object.entries(d.sati).sort());
  d.azurirano = new Date().toISOString();
  await mkdir(`data/${datum.slice(0, 4)}`, { recursive: true });
  await writeFile(`data/${datum.slice(0, 4)}/${datum}.json`, JSON.stringify(d) + "\n");
}
console.log(`Spremljeno sati: ${dobrihSati}/24, more: ${moreOk ? "da" : "ne"}, dani: ${Object.keys(dani).join(", ")}`);
// Ako se većina ne pročita, DHMZ je vjerojatno promijenio stranicu: pokretanje pada pa GitHub šalje mail.
if (dobrihSati < 18 || !moreOk) { console.error("GREŠKA: premalo podataka pročitano."); process.exit(1); }
