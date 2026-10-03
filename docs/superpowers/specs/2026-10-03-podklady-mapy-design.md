# Przełącznik podkładu mapy — projekt

Data: 2026-10-03
Zatwierdzone przez użytkownika w rozmowie.

## Cel

Użytkownik wybiera tło mapy: jasne, uliczne albo zdjęcia lotnicze. Dane dostępności (odcinki, przejścia, trasa) pozostają takie same na każdym podkładzie.

## Podkłady

| Id | Nazwa | Źródło |
|---|---|---|
| `light` (domyślny) | Jasna | styl `https://tiles.openfreemap.org/styles/positron` |
| `streets` | Ulice | styl `https://tiles.openfreemap.org/styles/liberty` |
| `satellite` | Satelita | kafle WMTS ortofotomapy Geoportalu (GUGiK): `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution`, warstwa `ORTOFOTOMAPA`, zestaw `EPSG:3857`, kafle 256 px JPEG, maksymalny zoom 19 |

WMS tej samej usługi zwracał błędy 404 dla około 40% identycznych zapytań (pomiar 2026-10-03), dlatego używamy WMTS.

Wszystkie źródła działają bez klucza i zwracają `Access-Control-Allow-Origin: *` (sprawdzone 2026-10-03).

## Zachowanie

- Przełącznik to grupa trzech opcji „Jasna / Ulice / Satelita” w górnym pasku mapy, poza węzłem mapy z `aria-hidden`, obsługiwana klawiaturą, z celami dotykowymi co najmniej 44 px. Aktualny wybór jest oznaczony nie tylko kolorem.
- Wybór zapisuje się w `localStorage` i jest przywracany przy starcie.
- Zmiana podkładu podmienia styl MapLibre, a aplikacja nakłada ponownie własne źródła i warstwy (odcinki, węzły, zaznaczenie, trasa). Widok mapy, wybrany odcinek, punkty startu i celu oraz trasa pozostają bez zmian.
- Linie odcinków i punkty węzłów mają białą obwódkę, żeby były czytelne na zdjęciach lotniczych. Obwódka jest na wszystkich podkładach.
- Przy satelicie stała linia atrybucji pokazuje dodatkowo „Ortofotomapa © GUGiK (Geoportal)”.
- Gdy podkład się nie wczyta, aplikacja wraca do „Jasnej” i pokazuje komunikat „Nie udało się wczytać podkładu. Wracam do mapy jasnej.” w istniejącym regionie statusu mapy.
- Zmiana podkładu jest ogłaszana czytnikom ekranu w regionie statusu („Podkład mapy: Satelita”).

## Poza zakresem

Lista, trasa, API i service worker (kafelków nie zapisuje) pozostają bez zmian. Brak nowych zależności. Brak testów automatycznych; weryfikacja zrzutami ekranu trzech podkładów.

## Pliki

- `apps/web/src/basemaps.ts` — definicje podkładów (id, etykieta, styl lub obiekt stylu rastrowego, atrybucja).
- `apps/web/src/components/MapView.tsx` — nakładanie własnych warstw wydzielone do funkcji wywoływanej po każdym `style.load`; przełącznik w pasku mapy.
- `apps/web/src/profileStore.ts` — zapis i odczyt wybranego podkładu.
- `apps/web/src/components/TabBar.tsx` — atrybucja zależna od podkładu.
- `apps/web/src/styles.css` — style przełącznika.
