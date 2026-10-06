// Čitanje DHMZ stranica. Čiste funkcije nad tekstom, bez mreže, da se mogu testirati zasebno.
const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', deg: "°", scaron: "š", Scaron: "Š", zcaron: "ž", Zcaron: "Ž" };
export const cist = s => s.replace(/<[^>]*>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m)
  .replace(/\s+/g, " ").trim();
export const broj = s => { const t = (s || "").replace(",", ".").replace(/[^\d.+-]/g, ""); return t === "" || t === "-" || t === "+" || isNaN(+t) ? null : +t; };
const p2 = n => String(n).padStart(2, "0");

// Stranica "Vrijeme u Hrvatskoj DD.MM.GGGG. u HH h" → { datum, sat, postaje } ili null
export function parseSat(html) {
  const m = cist(html).match(/Vrijeme u Hrvatskoj\s*(\d{2})\.(\d{2})\.(\d{4})\.?\s*u\s*(\d{1,2})\s*h/);
  if (!m) return null;
  for (const tbl of html.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const redovi = (tbl.match(/<tr[\s\S]*?<\/tr>/gi) || []).map(r => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cist(c[1])));
    if (!redovi.length || !redovi[0].some(h => /tlak/i.test(h))) continue;
    const glava = redovi[0].map(h => h.toLowerCase());
    const kol = re => glava.findIndex(h => re.test(h));
    const ix = { smjer: kol(/smjer/), brzina: kol(/brzina/), temp: kol(/temp/), vlaga: kol(/vla/), tlak: kol(/^\s*tlak/), tend: kol(/tendenc/), nebo: kol(/stanje/) };
    const postaje = {};
    for (const r of redovi.slice(1)) {
      if (r.length < 3 || !r[0]) continue;
      const c = i => (i >= 0 && r[i] != null) ? r[i] : "";
      const tekst = v => (v === "-" || v === "") ? null : v;
      postaje[r[0]] = { smjer: tekst(c(ix.smjer)), brzina: broj(c(ix.brzina)), temp: broj(c(ix.temp)), vlaga: broj(c(ix.vlaga)), tlak: broj(c(ix.tlak)), tend: broj(c(ix.tend)), nebo: tekst(c(ix.nebo)) };
    }
    return { datum: `${m[3]}-${m[2]}-${m[1]}`, sat: p2(+m[4]), postaje };
  }
  return null;
}

// XML temperature mora → { datum, termini: ["07",...], postaje: { ime: [broj|null,...] } } ili null
export function parseMore(xml) {
  const d = xml.match(/<Datum>\s*(\d{2})\.(\d{2})\.(\d{4})/);
  const blokovi = [...xml.matchAll(/<Podatci>([\s\S]*?)<\/Podatci>/g)].map(b => ({
    ime: cist((b[1].match(/<Postaja[^>]*>([\s\S]*?)<\/Postaja>/) || [, ""])[1]),
    v: [...b[1].matchAll(/<Termin\s*\/>|<Termin>([\s\S]*?)<\/Termin>/g)].map(t => (t[1] || "").trim()),
  }));
  if (!d || blokovi.length < 2) return null;
  const postaje = {};
  for (const b of blokovi.slice(1)) if (b.ime) postaje[b.ime] = b.v.map(broj);
  return { datum: `${d[3]}-${d[2]}-${d[1]}`, termini: blokovi[0].v.map(t => p2(+t)), postaje };
}
