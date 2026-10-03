# Kraków bez granic — projekt dema (15 h)

Data: 2026-10-03
Podstawa: brief produktowy „Kraków bez granic” z 3 paź 2026.

## Cel

Działające demo na telefonie, zbudowane w 15 godzin przez jedną osobę z Claude Code.

Scenariusz pokazu: wybieram profil, widzę na mapie i na liście odcinki oraz przejścia Starego Miasta i Kazimierza z faktami (wartość, źródło, data, pewność), wyznaczam trasę zależną od profilu z podsumowaniem tekstowym, robię zdjęcie chodnika, AI proponuje atrybuty, potwierdzam, a trasa i pewność zmieniają się od razu.

## Zakres

W zakresie:

1. Import OSM dla Starego Miasta i Kazimierza z atrybutami dostępności.
2. Mapa i lista z trzema stanami atrybutu (jest / nie ma / brak danych), źródłem, datą i pewnością.
3. Siedem profili jako konfiguracja JSON oraz własne progi użytkownika.
4. Zgłoszenie ze zdjęciem i wstępną klasyfikacją AI.
5. Potwierdzanie i zaprzeczanie zgłoszeniom, uproszczona reputacja.
6. Routing zależny od profilu z podsumowaniem trasy.
7. Moduł dla niewidomych: lista i opis trasy jako pełnoprawny interfejs.

Poza zakresem: testy automatyczne, logowanie, rozmywanie twarzy i tablic, moderacja, właściciele obiektów, widget i publiczne API, odsyłanie poprawek do OSM, ochrona przed fałszywymi kontami, obiekty i wejścia do budynków, zgłaszanie offline, aplikacja natywna.

Kolejność cięcia przy poślizgu: reputacja, potem AI, potem routing.

## Odstępstwa od briefu

| Brief | Demo | Powód |
|---|---|---|
| NestJS | Hono | pięć endpointów, mniej ceremonii |
| PostGIS + osm2pgsql | migawka JSON z Overpass + SQLite | brak Dockera i osm2pgsql lokalnie, oszczędność 4–5 h |
| pgRouting + tłumacz reguł na SQL | Dijkstra w pamięci, jeden interpreter TS | znika największe ryzyko techniczne |
| Logowanie Google / Apple | anonimowy identyfikator urządzenia | czas |
| Cały Kraków | Stare Miasto + Kazimierz | najgęstsze dane OSM, mały graf |

Model danych (Feature, Observation, Verification, AttributeState) pozostaje zgodny z briefem, więc migracja do PostGIS i pgRouting nie zmienia domeny.

## Architektura

```
apps/api/        Hono (Node 22): REST, serwuje też zbudowany front
apps/web/        React + Vite PWA, MapLibre GL JS, kafelki OpenFreeMap
packages/domain/ typy, słownik atrybutów, profile JSON, interpreter reguł,
                 wyliczanie pewności, reputacja, Dijkstra
scripts/import-osm.ts   Overpass → data/krakow.json
```

- Monorepo pnpm, TypeScript wszędzie.
- Jedna usługa na Railway. API serwuje statyczny front, SQLite i zdjęcia leżą na wolumenie.
- Migawka OSM jest w repo. Import uruchamiamy raz, demo nie zależy od Overpass.
- Dane OSM (plik JSON) i dane społeczności (SQLite) są rozdzielone i powiązane tylko identyfikatorem, co spełnia wymóg ODbL z briefu.
- Profil potrzeb żyje w `localStorage`. Serwer dostaje go tylko w zapytaniu o trasę, nie zapisuje go i nie loguje.
- Tożsamość: losowy identyfikator urządzenia w `localStorage`, wysyłany w nagłówku `X-Author-Id`.

## Import OSM

`scripts/import-osm.ts` pobiera dane dla prostokąta obejmującego Stare Miasto i Kazimierz z głównego API OpenStreetMap (`/api/0.6/map.json`) w siatce 3 × 3 kafelków, bo Overpass nie jest osiągalny ze środowiska deweloperskiego. Filtrowanie tagów odbywa się w skrypcie.

- Drogi: `highway` w `footway`, `path`, `pedestrian`, `steps`, `living_street`, `residential`, `service`, `cycleway`.
- Ulice wyższych klas (`unclassified`, `tertiary`, `secondary`, `primary`) wchodzą do grafu, o ile nie mają `sidewalk=no/none/separate`. Bez nich graf rozpada się tam, gdzie chodnik jest tylko tagiem.
- Drogi z `access=private/no` lub `foot=no` są pomijane.
- Węzły: `highway=crossing`, `barrier=kerb`.
- Każda droga jest cięta na segmenty w węzłach wspólnych z innymi drogami i na przejściach. Segment to jedna krawędź grafu i jeden Feature.
- Chodnik jako tag na ulicy (`sidewalk=*`) jest przypinany do segmentu ulicy bez rozróżniania stron.
- Plac (`highway=pedestrian` + `area=yes`) dostaje atrybut `open_area=true`.
- `steps`, `cycleway` i `open_area` wynikają z typu drogi, więc każdy segment ma je jako znane (prawda lub fałsz).
- Mapowanie tagów na atrybuty: `surface`, `smoothness`, `width` → `width_cm`, `incline` → `incline_pct`, `kerb` → `kerb_height_cm` (lowered 3, flush 0, raised 12), `highway=steps` → `steps`, `ramp`, `handrail`, `tactile_paving`, `traffic_signals:sound` → `signal_sound`, `traffic_signals:vibration` → `signal_vibration`, `lit`, `highway=cycleway` lub `bicycle=designated` → `cycleway`.
- Brak tagu nie tworzy obserwacji.

Wynik: `data/krakow.json` z listą Feature i tagami źródłowymi wraz z datą ostatniej edycji obiektu.

## Model danych

| Encja | Gdzie | Pola |
|---|---|---|
| Feature | `data/krakow.json` | `id` (`way/123#4` lub `node/456`), `kind` (segment / crossing), geometria, długość, węzły końcowe |
| Observation | SQLite | `id`, `feature_id`, `attr`, `value`, `source` (osm / user / ai), `author_id`, `observed_at`, `valid_until`, `photo_id` |
| Verification | SQLite | `observation_id`, `author_id`, `agree`, `created_at` |
| AttributeState | SQLite | `feature_id`, `attr`, `value`, `confidence`, `last_confirmed`, `sources` |
| Photo | SQLite + plik | `id`, ścieżka, `author_id`, pozycja, wynik AI |
| Author | SQLite | `id`, `reputation` |

Przy starcie serwera tagi z migawki stają się obserwacjami ze źródłem `osm` i datą edycji obiektu, jeśli jeszcze ich nie ma w bazie.

Słownik atrybutów: `surface`, `smoothness`, `width_cm`, `incline_pct`, `kerb_height_cm`, `steps`, `ramp`, `handrail`, `tactile_paving`, `guidance_line`, `signal_sound`, `signal_vibration`, `lit`, `bench`, `cycleway`, `open_area`, `temporary_obstacle`.

## Pewność

AttributeState jest przeliczany przy każdym zapisie obserwacji lub weryfikacji, nigdy przy odczycie.

- Waga obserwacji = waga źródła × reputacja autora × wygaszanie w czasie.
- Wagi źródeł: osm 0,6, user 0,8, ai 0,3. Dla źródeł `osm` i `ai` reputacja wynosi 1.
- Wygaszanie liczone od `observed_at`: półokres 730 dni dla `osm` i 180 dni dla `user` i `ai`. Obiekty OSM w obszarze dema mają medianę wieku 548 dni; przy 180 dniach mediana pewności samego OSM wynosiła 7%, a 21% wierszy pokazywało 0%.
- Do stanu liczy się tylko najnowsza obserwacja każdego autora (`user`) oraz najnowsza obserwacja `ai` dla danego atrybutu; starsze zostają w historii, ale nie wpływają na wynik.
- Niepotwierdzone obserwacje `ai` (bez żadnej zgody) są całkowicie pomijane, gdy istnieje jakakolwiek ważna obserwacja z innego źródła. Obserwacja `ai` potwierdzona przez człowieka liczy się normalnie; gdy `ai` jest jedynym źródłem, jest używana i oznaczona jako niepotwierdzona.
- Autor zdjęcia nie może potwierdzić sugestii AI z własnego zdjęcia (serwer odpowiada 403, a UI nie pokazuje przycisków głosowania).
- Zgoda dodaje do wagi obserwacji reputację potwierdzającego, zaprzeczenie ją odejmuje (minimum 0).
- Wartość atrybutu to ta z największą sumą wag.
- Pewność = udział zwycięskiej wartości w sumie wag × min(1, suma wag zwycięskiej wartości).
- Obserwacje po `valid_until` są pomijane, a UI prosi o ponowne potwierdzenie.
- `last_confirmed` to najnowsza data obserwacji lub zgody dla zwycięskiej wartości.
- Atrybut jest „niepotwierdzony”, gdy zwycięską wartość wspiera jedno źródło i nie ma żadnej zgody.

## Reputacja

- Start 0,5, zakres 0,1–1,0.
- Zgoda innego autora: +0,05 dla autora obserwacji.
- Zaprzeczenie w ciągu 7 dni od `observed_at`: −0,05, gdy obserwacja zgłaszała barierę, −0,15, gdy zgłaszała brak bariery.
- Zaprzeczenie po 7 dniach nie zmienia reputacji.
- Autor nie może weryfikować własnych obserwacji; jedna weryfikacja na autora i obserwację.

Słownik atrybutów określa dla każdej wartości, czy oznacza barierę (np. `steps=true`, `temporary_obstacle=true`, `surface=cobblestone`).

## Reguły i profile

Format profilu jak w briefie:

```json
{
  "id": "wheelchair_manual",
  "hard": [
    { "attr": "steps", "eq": true, "unless": "ramp" },
    { "attr": "kerb_height_cm", "gt": 3 },
    { "attr": "width_cm", "lt": 90 }
  ],
  "soft": [
    { "attr": "incline_pct", "gt": 6, "cost": 5 },
    { "attr": "surface", "in": ["sett", "cobblestone", "gravel"], "cost": 4 }
  ],
  "unknown_cost": 1.5
}
```

- Operatory: `eq`, `gt`, `lt`, `in`, modyfikator `unless`.
- `evaluate(profile, states)` zwraca `{ blocked, costMultiplier, reasons[] }`. Każdy powód niesie atrybut, wartość, próg i rodzaj (twardy / miękki / brak danych).
- Reguły miękkie mnożą koszt przez `cost`. Brak danych dla atrybutu wymienionego w dowolnej regule mnoży koszt przez `unknown_cost` raz na atrybut, o ile atrybut dotyczy danego rodzaju miejsca (odcinek albo węzeł). Wyjątki, dla których brak danych jest neutralny: `temporary_obstacle`, `guidance_line`, `bench` oraz `incline_pct`, `width_cm` i `smoothness`. Te trzy ostatnie są w OSM prawie nieobecne (nachylenie 0%, szerokość 3%, gładkość 19% segmentów w obszarze dema), więc liczone jako brak danych zamieniałyby całą mapę w „brak danych”. Na karcie odcinka nadal widać je jako „brak danych”.
- Status „utrudnione” daje reguła miękka o koszcie co najmniej 2; mniejsze koszty wpływają tylko na trasę.
- `temporary_obstacle=true` jest regułą twardą w profilach wózkowych i miękką w pozostałych.
- Profile: `wheelchair_manual`, `wheelchair_electric`, `blind`, `senior`, `stroller`, `skates`, `bike`. Progi robocze z briefu.
- Nadpisania użytkownika to scalenie progów z profilem bazowym, zapisane w `localStorage`.
- Ta sama funkcja obsługuje kartę odcinka, kolorowanie mapy i routing.

## Routing

`POST /route` z `{ from: [lon, lat], to: [lon, lat], profile }`.

- Serwer dociąga start i cel do najbliższego węzła grafu w promieniu 100 m.
- Dijkstra z kosztem krawędzi `długość × costMultiplier`; krawędzie `blocked` są pomijane.
- Przejście będące węzłem na trasie dolicza koszt z oceny tego przejścia.
- Odpowiedź: geometria, długość, podsumowanie (liczba przejść, w tym z polami uwagi, z sygnałem dźwiękowym i bez danych; schody; udziały nawierzchni; metry bez danych) oraz lista kroków z powodami.
- Do licznika przejść „brak danych” trafia każde przejście, w którego ocenie dla profilu jest brakujący atrybut istotny dla reguł (powód rodzaju `unknown`), a także przejście bez znanych pól uwagi.
- Gdy dane się zmienią (zgłoszenie, głos), klient sam wyznacza istniejącą trasę ponownie z tymi samymi punktami i profilem i ogłasza to w regionie live zakładki Trasa.
- Gdy trasa nie istnieje, serwer liczy trasę z regułami twardymi zamienionymi na bardzo wysoki koszt i zwraca ją z flagą `violatesHardRules` oraz listą złamanych reguł.

## API

| Endpoint | Rola |
|---|---|
| `GET /api/features` | cała migawka Feature (obszar dema jest mały, klient ocenia profil lokalnie) |
| `GET /api/states` | bieżące AttributeState wszystkich Feature |
| `GET /api/features/:id` | szczegóły: stany, obserwacje, weryfikacje, zdjęcia |
| `POST /api/observations` | zgłoszenie ręczne lub potwierdzenie sugestii AI |
| `POST /api/observations/:id/verify` | zgoda / zaprzeczenie |
| `POST /api/photos` | wgranie zdjęcia, klasyfikacja AI, sugestie |
| `POST /api/route` | trasa dla profilu |
| `GET /api/profiles` | profile bazowe |

## Zgłoszenie ze zdjęciem i AI

1. `<input type="file" accept="image/*" capture="environment">`; w tym samym momencie pozycja z Geolocation API.
2. Klient zmniejsza zdjęcie do 1280 px i wysyła `POST /photos` z pozycją oraz opcjonalnym `feature_id`. Bez `feature_id` serwer dobiera najbliższy segment w promieniu 30 m; użytkownik może go zmienić.
3. Serwer zapisuje plik i woła Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) z wymuszoną strukturą odpowiedzi: `surface`, `smoothness`, `tactile_paving`, `steps`, każde z pewnością albo `unknown`. Wysokości progu i nachylenia model nie ocenia.
4. Każdy rozpoznany atrybut staje się obserwacją ze źródłem `ai`.
5. Użytkownik potwierdza lub poprawia każdą sugestię jednym dotknięciem, co tworzy obserwację `user` z `photo_id`.
6. Zgłoszenie bez zdjęcia: formularz z atrybutami ze słownika; `temporary_obstacle` ma `valid_until` domyślnie za 7 dni.

Klucz `ANTHROPIC_API_KEY` jest tylko po stronie serwera.

Zdjęcia nie są rozmywane. W demie są widoczne na karcie odcinka z dopiskiem „zdjęcie niezweryfikowane”. Rozmywanie twarzy i tablic jest warunkiem publicznego uruchomienia.

## Interfejs

Mobile first, język polski. Dolny pasek: Mapa, Lista, Trasa, Profil.

- **Mapa.** Segmenty kolorowane wynikiem `evaluate` dla aktywnego profilu: przejezdne, utrudnione, zablokowane, brak danych. Stany różnią się też wzorem linii, nie tylko kolorem. Przejścia jako punkty. Przycisk „Zgłoś”.
- **Karta odcinka.** Werdykt profilu z powodami („próg 5 cm, twój limit 3 cm”). Każdy atrybut w jednym z trzech stanów, z wartością, źródłem, datą ostatniego potwierdzenia, pewnością, etykietą „niepotwierdzone” oraz przyciskami „Potwierdzam” i „Nieprawda”.
- **Lista.** Te same dane co mapa jako nagłówki i listy HTML, sortowane odległością, z filtrem „tylko problemy dla mojego profilu”.
- **Trasa.** Start i cel dotknięciem mapy lub „moja pozycja”. Wynik jako linia oraz opis tekstowy: zdanie podsumowujące i lista kroków z ostrzeżeniami.
- **Profil.** Wybór jednego z siedmiu, suwaki nadpisujące progi, informacja o tym, że profil nie jest zapisywany na serwerze.

### Moduł dla niewidomych

- Lista i opis trasy są w pełni używalne bez mapy. Mapa ma `aria-hidden` i link „pomiń mapę”.
- Regiony `aria-live` dla wyniku trasy i sugestii AI.
- Cele dotykowe co najmniej 44 px, kontrast AA, pełna obsługa klawiaturą.
- Przy trasie stały komunikat: aplikacja służy do planowania, a GPS nie rozróżnia stron ulicy.

## Obsługa błędów

- Brak zgody na lokalizację: zgłoszenie wymaga wskazania miejsca na mapie, trasa startuje z dotkniętego punktu.
- AI niedostępne lub brak klucza: zgłoszenie przechodzi w formularz ręczny, zdjęcie zostaje zapisane.
- Punkt poza obszarem danych: komunikat z zasięgiem dema.
- Brak sieci: PWA pokazuje ostatnio pobrane dane z datą pobrania.

## Weryfikacja

Testy automatyczne są poza zakresem. Każdy blok kończy się ręcznym sprawdzeniem w przeglądarce w trybie mobilnym, a na końcu przejściem scenariusza pokazu na telefonie po wdrożeniu.

## Budżet czasu

| Blok | Czas |
|---|---|
| Szkielet monorepo, import OSM, podział na segmenty | 2 h |
| `packages/domain`: reguły, profile, pewność, reputacja | 2 h |
| API + SQLite | 1,5 h |
| Mapa, lista, karta odcinka | 3 h |
| Routing + podsumowanie trasy | 2 h |
| Zgłoszenie ze zdjęciem + AI | 2 h |
| Potwierdzanie i reputacja w UI | 1 h |
| Deploy na Railway, poprawki | 1,5 h |

## Otwarte po demie

Progi liczbowe profili, wartości reputacji i półokres wygaszania są robocze i wymagają weryfikacji z użytkownikami. Pozostałe otwarte decyzje z briefu (łączenie profili, model stron chodnika, ODbL, moderacja, miernik sukcesu) nie są rozstrzygane przez to demo.
