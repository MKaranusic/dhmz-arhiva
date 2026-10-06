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
    catch { dani[datum] = { datum, izvor: "DHMZ (meteo.hr), HHI (adriaticsea.hhi.hr)", sati: {}, more: { termini: [], postaje: {} } }; }
    dani[datum].plima ??= {};
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

// ── HHI mareografi: izmjerena i prognozirana razina mora, visoke i niske vode ──
// Portal vraća 24 h unatrag i 24 h unaprijed, u minutnom koraku i po zimskom vremenu (UTC+1) cijele godine.
// Sprema se svaka 10. minuta, preračunato u lokalno vrijeme, u centimetrima iznad hidrografske nule.
const HHI = "https://adriaticsea.hhi.hr";
const MAREOGRAFI = { "Rijeka": [17, "RI0"], "Bakar": [6, "BK0"], "Rovinj": [4, "RO0"], "Mali Lošinj": [7, "ML0"], "Zadar": [5, "ZD0"], "Split": [2, "ST0"], "Vis": [8, "VI0"], "Ploče": [1, "PL0"], "Dubrovnik": [3, "DU0"] };
const KORAK = 10;
const fmtZg = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const lokalno = (y, mo, d, h, mi) => fmtZg.format(Date.UTC(y, mo - 1, d, h - 1, mi)).replace(",", "");   // UTC+1 → "GGGG-MM-DD HH:mm" po našem vremenu
const cm = v => (v == null || v === "" || isNaN(+v)) ? null : Math.round(+v * 1000) / 10;
const UA = { "User-Agent": "dhmz-arhiva (osobni ribolovni dnevnik)" };

async function hhiSesija() {            // stranica postaje daje kolačiće i CSRF token bez kojih portal ne vraća podatke
  const kolacici = {};
  let url = `${HHI}/public-stations/station?id=2&designation=ST0`, html = "";
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { ...UA, Cookie: Object.entries(kolacici).map(([k, v]) => `${k}=${v}`).join("; ") }, redirect: "manual", signal: AbortSignal.timeout(30000) });
    for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(";"), j = kv.indexOf("="); kolacici[kv.slice(0, j).trim()] = kv.slice(j + 1); }
    const dalje = r.status >= 300 && r.status < 400 && r.headers.get("location");
    if (!dalje) { html = await r.text(); break; }
    url = new URL(dalje, url).href;
  }
  const token = (html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) || [])[1];
  if (!token) throw new Error("nema CSRF tokena na stranici");
  return { token, cookie: Object.entries(kolacici).map(([k, v]) => `${k}=${v}`).join("; ") };
}

let plimaOk = 0;
try {
  const ses = await hhiSesija();
  for (const [ime, [id, kod]] of Object.entries(MAREOGRAFI)) {
    try {
      const r = await fetch(`${HHI}/public-stations/load-tide-data`, {
        method: "POST", signal: AbortSignal.timeout(60000),
        headers: { ...UA, Cookie: ses.cookie, "X-CSRF-Token": ses.token, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: `${HHI}/public-stations/station?id=${id}&designation=${kod}` },
        body: new URLSearchParams({ code: kod, stationId: String(id), zero: "H0", dateFrom: "", dateTo: "", lastDate: "false", live: "false" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.data) || j.data.length < 100) throw new Error("nema podataka");
      const zapis = async datum => { const d = await dan(datum); return d.plima[ime] ??= { korak_min: KORAK, prognoza: Array(1440 / KORAK).fill(null), izmjereno: Array(1440 / KORAK).fill(null), ekstremi: [] }; };
      for (const row of j.data) {
        const m = String(row.date).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
        if (!m) continue;
        const lok = lokalno(+m[1], +m[2], +m[3], +m[4], +m[5]), min = +lok.slice(11, 13) * 60 + +lok.slice(14, 16);
        if (min % KORAK) continue;
        const z = await zapis(lok.slice(0, 10)), i = min / KORAK, pr = cm(row.value_pr), iz = cm(row.value);
        if (pr != null) z.prognoza[i] = pr;
        if (iz != null) z.izmjereno[i] = iz;             // staro mjerenje se ne briše praznim
      }
      const tekst = String(j.list || "").replace(/<[^>]*>/g, " ");
      for (const e of tekst.matchAll(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})\s+(HW|LW)\s+(-?[\d.]+)/g)) {
        const lok = lokalno(+e[3], +e[2], +e[1], +e[4], +e[5]), z = await zapis(lok.slice(0, 10)), t = lok.slice(11);
        const minuta = x => +x.slice(0, 2) * 60 + +x.slice(3);
        z.ekstremi = z.ekstremi.filter(x => !(x.tip === e[6] && Math.abs(minuta(x.t) - minuta(t)) < 90));   // novija prognoza zamjenjuje staru
        z.ekstremi.push({ t, tip: e[6], cm: cm(e[7]) });
        z.ekstremi.sort((a, b) => a.t.localeCompare(b.t));
      }
      plimaOk++;
    } catch (e) { console.log(`plima ${ime}: ${e.message}`); }
  }
} catch (e) { console.log(`plima: ${e.message}`); }

for (const [datum, d] of Object.entries(dani)) {
  d.sati = Object.fromEntries(Object.entries(d.sati).sort());
  d.azurirano = new Date().toISOString();
  await mkdir(`data/${datum.slice(0, 4)}`, { recursive: true });
  await writeFile(`data/${datum.slice(0, 4)}/${datum}.json`, JSON.stringify(d) + "\n");
}
console.log(`Spremljeno sati: ${dobrihSati}/24, more: ${moreOk ? "da" : "ne"}, mareografi: ${plimaOk}/${Object.keys(MAREOGRAFI).length}, dani: ${Object.keys(dani).sort().join(", ")}`);
// Ako se većina ne pročita, DHMZ je vjerojatno promijenio stranicu: pokretanje pada pa GitHub šalje mail.
if (dobrihSati < 18 || !moreOk || plimaOk === 0) { console.error("GREŠKA: premalo podataka pročitano."); process.exit(1); }
