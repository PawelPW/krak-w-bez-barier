# Follow-up report (R1-R3)

Checks: `tsc --noEmit` for packages/domain, apps/api, apps/web all passed (printed ok); `pnpm --filter @kbg/web build` passed (PWA 7 precache entries, dist/sw.js generated).

## R1 (state.tsx) - headless Chrome 390x844, isolated API :3961, scratch Vite :5188 (config in scratchpad, not committed)
```
route len 1675 fitBounds calls 1
centre before [19.955,50.05] fit 1          (map panned away from route)
off-route segment way/1180673287#0 ; seed obs 200 (other author) ; then "Potwierdzam"
route requests after confirm 1
centre after  [19.955,50.05] fit 1          (no jump, no refit)
route live region: "Trasa 1675 m. Przejścia: 9 (...)"   (no "Dane się zmieniły")
target step way/295356762#1 Franciszkańska, 52 m  -> temporary_obstacle "jest"
old length 1675 new length 1679 segment still on route? false
live region: "Dane się zmieniły — trasa została wyznaczona ponownie. Trasa 1679 m. ..."
fitBounds calls total 2
```
## R2 (store.ts) - isolated API :3960, rows inserted via node:sqlite on way/19842465#0 (OSM surface asphalt)
ai-old "sett" (confirmed by B), ai-new "gravel" (unconfirmed):
```
state surface: {"value":"sett","confidence":0.44,"lastConfirmed":"2026-09-11T00:00:00Z","sources":["ai"],"unconfirmed":false}
ai-new ai "gravel" agree=0 superseded=false
ai-old ai "sett" agree=1 superseded=false
osm:way/ osm "asphalt" agree=0 superseded=false
```
Confirmed AI value competes and wins; it is not superseded. recompute keeps latest ai plus every ai with agree_n>0; featureDetail never marks an ai row with agree>0 superseded.

## R3 (state.tsx) - by inspection only
Condition changed from `net ?? navigator.onLine` to `net || navigator.onLine`: transferSize===0 with navigator.onLine true now writes the timestamp; offline (onLine false) cache hit does not; no stored time leaves the banner text unchanged.
