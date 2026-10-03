# Kraków bez granic

Demo aplikacji mobilnej (PWA), która pokazuje informacje o dostępności chodników i przejść dla pieszych w Krakowie. Każda cecha (np. nawierzchnia, schody, pola uwagi) ma jeden z trzech stanów: „jest”, „nie ma” albo „brak danych”, z podaniem źródła, daty i pewności. Dane niepotwierdzone są oznaczone. Sugestie AI ze zdjęć zawsze wymagają potwierdzenia przez człowieka. Dla osób niewidomych podstawą jest widok listy i tekstowy opis trasy; mapa jest dla nich pomijana.

Obszar demo: Stare Miasto i Kazimierz.

## Uruchomienie lokalne

Wymagane: Node.js 22.13 lub nowszy, pnpm (wersja z pola `packageManager`, np. przez `corepack enable`).

```
pnpm install
pnpm dev:api   # API na http://localhost:3000
pnpm dev:web   # front (Vite), proxy /api i /photos na port 3000
```

Wersja produkcyjna z jednego portu: `pnpm build`, potem `pnpm start` (API serwuje też zbudowany front).

### Klucz do analizy zdjęć (lokalnie)

Skopiuj `.env.example` do `.env` w katalogu głównym, wpisz `ANTHROPIC_API_KEY=...` i uruchom API ponownie. Plik `.env` jest ignorowany przez git i nie wolno go commitować. API wczytuje go automatycznie, jeśli istnieje (`--env-file-if-exists`); bez pliku działa tak samo, tylko bez analizy zdjęć.

### Wdrożenie

Wdrożenie nie jest częścią obecnego dema. W repozytorium jest `Dockerfile` i `.dockerignore`, ale obraz nie był budowany ani testowany.

## Ponowny import danych OSM

```
pnpm import:osm
```

Skrypt pobiera dane z głównego API OpenStreetMap, dzieląc obszar na siatkę kafli 3×3. Wynik trafia do `data/krakow.json`.

## Zmienne środowiskowe

- `ANTHROPIC_API_KEY` (opcjonalna, tylko po stronie serwera; lokalnie z pliku `.env`): włącza analizę zdjęć. Bez niej zdjęcie jest zapisywane, a użytkownik uzupełnia dane ręcznie.
- `DATA_DIR`: katalog na bazę SQLite i zdjęcia (domyślnie `var/` w repozytorium; w obrazie Docker `/data`, tam należy zamontować wolumen).
- `PORT`: port serwera (domyślnie 3000).

## Dane i licencja

Dane mapy © autorzy OpenStreetMap, licencja ODbL (https://www.openstreetmap.org/copyright). Obserwacje społeczności (zgłoszenia użytkowników, sugestie AI, głosy) są przechowywane osobno, w SQLite, i nie są częścią danych OSM.

## Znane ograniczenia

- Zdjęcia nie są rozmywane (twarze, tablice rejestracyjne). Trzeba to rozwiązać przed jakimkolwiek publicznym uruchomieniem.
- Brak logowania; autorzy zgłoszeń to anonimowe identyfikatory urządzeń.
- Progi w profilach dostępności (nachylenie, szerokość, wysokość krawężnika) są wstępne i nie są zweryfikowane.
- Obszar demo to Stare Miasto i Kazimierz.
- Aplikacja służy do planowania trasy, nie do nawigacji; GPS w wąskich ulicach myli się o kilka–kilkanaście metrów.
