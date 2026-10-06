# dhmz-arhiva

Arhiva satnih mjerenja DHMZ-a (vjetar, tlak, temperatura zraka, stanje neba) i temperature mora, za osobni ribolovni dnevnik.

- `sakupi.mjs` se pokreće četiri puta dnevno preko GitHub Actions i svaki put pokupi zadnja 24 sata.
- Podaci su u `data/GGGG/GGGG-MM-DD.json`, jedna datoteka po danu.
- Ručno pokretanje: kartica **Actions → Sakupljač DHMZ → Run workflow**.

Izvor podataka: Državni hidrometeorološki zavod (DHMZ), meteo.hr.
