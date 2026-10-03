import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { evaluate, mergeOverrides, profileById, statusOf, valuesFromStates } from '@kbg/domain';
import type { Evaluation, Feature, LonLat, Profile, RouteResult, StatesByAttr, StatesByFeature, Status } from '@kbg/domain';
import { getSnapshot, getStates, postRoute } from './api';
import { loadBasemap, loadProfileChoice, saveBasemap, saveProfileChoice } from './profileStore';
import type { BasemapId } from './basemaps';
import type { ProfileChoice } from './profileStore';

export type Tab = 'map' | 'list' | 'route' | 'profile';

export interface AppValue {
  features: Feature[];
  featuresById: Map<string, Feature>;
  bbox: { south: number; west: number; north: number; east: number };
  states: StatesByFeature;
  setFeatureStates(id: string, s: StatesByAttr): void;
  profile: Profile;
  choice: ProfileChoice;
  setChoice(c: ProfileChoice): void;
  /** Podkład mapy: jedno źródło prawdy dla przełącznika, mapy i linii atrybucji. */
  basemap: BasemapId;
  setBasemap(id: BasemapId): void;
  tab: Tab;
  setTab(t: Tab): void;
  selectedId: string | null;
  select(id: string | null): void;
  route: RouteResult | null;
  setRoute(r: RouteResult | null): void;
  /** Wyznaczanie trasy żyje w stanie aplikacji, żeby linia na mapie odświeżała się na każdej zakładce. */
  routeBusy: boolean;
  routeMessage: { kind: 'alert' | 'info'; text: string } | null;
  /** Komunikat dla regionu live w zakładce Trasa (np. po automatycznym ponownym wyznaczeniu). */
  routeNotice: string;
  computeRoute(): void;
  routeFrom: LonLat | null;
  routeTo: LonLat | null;
  setRouteFrom(p: LonLat | null): void;
  setRouteTo(p: LonLat | null): void;
  /** Który koniec trasy zostanie ustawiony następnym dotknięciem mapy (zakładka Trasa). */
  pickTarget: 'from' | 'to' | null;
  setPickTarget(t: 'from' | 'to' | null): void;
  /** Cecha, dla której otwarty jest dialog zgłoszenia (renderowany w Shell). */
  reportFor: string | null;
  setReportFor(id: string | null): void;
  /** Środek mapy trzymany w ref: zmiana nie renderuje konsumentów, czyta go tylko ten, kto go potrzebuje. */
  getMapCenter(): LonLat;
  setMapCenter(p: LonLat): void;
  userPos: LonLat | null;
  setUserPos(p: LonLat | null): void;
  statusFor(f: Feature): Status;
  evalFor(f: Feature): Evaluation;
}

const LAST_LOAD_KEY = 'kbg.lastLoad';
export function readLastLoad(): number | null {
  try { const n = Number(localStorage.getItem(LAST_LOAD_KEY)); return Number.isFinite(n) && n > 0 ? n : null; } catch { return null; }
}
/** Czy odpowiedź na dany adres przyszła z sieci (transferSize > 0)? null = Resource Timing niedostępny. */
function viaNetwork(path: string): boolean | null {
  try {
    const list = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = list.length - 1; i >= 0; i--) {
      if (new URL(list[i].name, location.href).pathname === path) return list[i].transferSize > 0;
    }
  } catch { /* brak API */ }
  return null;
}
const ROUTE_CHANGED = 'Dane się zmieniły — trasa została wyznaczona ponownie.';
const writeLastLoad = (n: number) => { try { localStorage.setItem(LAST_LOAD_KEY, String(n)); } catch { /* tryb prywatny */ } };

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp poza AppProvider');
  return v;
}

interface Loaded { features: Feature[]; bbox: AppValue['bbox'] }

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [states, setStates] = useState<StatesByFeature>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoiceRaw] = useState<ProfileChoice>(loadProfileChoice);
  const [basemap, setBasemapRaw] = useState<BasemapId>(loadBasemap);
  const setBasemap = useCallback((id: BasemapId) => { saveBasemap(id); setBasemapRaw(id); }, []);
  const [tab, setTab] = useState<Tab>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeFrom, setFrom] = useState<LonLat | null>(null);
  const [routeTo, setTo] = useState<LonLat | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeMessage, setRouteMessage] = useState<AppValue['routeMessage']>(null);
  const [routeNotice, setRouteNotice] = useState('');
  const [statesVersion, setStatesVersion] = useState(0);
  // Numer bieżącego żądania trasy: spóźniona odpowiedź dla innych punktów/profilu/danych jest odrzucana.
  const reqId = useRef(0);
  const inFlight = useRef(false);
  const [pickTarget, setPickTarget] = useState<'from' | 'to' | null>(null);
  const mapCenterRef = useRef<LonLat>([19.940, 50.057]);
  const getMapCenter = useCallback(() => mapCenterRef.current, []);
  const setMapCenter = useCallback((p: LonLat) => { mapCenterRef.current = p; }, []);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<LonLat | null>(null);

  // Wskazywanie punktu na mapie ma sens tylko w zakładce Trasa.
  useEffect(() => { if (tab !== 'route') setPickTarget(null); }, [tab]);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([getSnapshot(), getStates()]).then(
      ([snap, st]) => {
        if (!live) return;
        setData({ features: snap.features, bbox: snap.bbox }); setStates(st);
        // Z cache'u (Service Worker, HTTP) dane też „wczytują się”: znacznik zapisujemy tylko, gdy żądanie poszło przez sieć.
        // Bez Resource Timing zostaje starsze zachowanie (navigator.onLine).
        const net = viaNetwork('/api/states');
        // transferSize 0 przy navigator.onLine === true też traktujemy jak sieć (Service Worker NetworkFirst bywa raportowany jako 0).
        if (net || navigator.onLine) writeLastLoad(Date.now());
      },
      (e: Error) => { if (live) setError(e.message); },
    );
    return () => { live = false; };
  }, [attempt]);

  const features = data?.features;
  const featuresById = useMemo(() => new Map((features ?? []).map((f) => [f.id, f])), [features]);
  const profile = useMemo(() => mergeOverrides(profileById(choice.id), choice.overrides), [choice]);
  const dropRoute = useCallback(() => {
    reqId.current++; inFlight.current = false;
    setRoute(null); setRouteBusy(false); setRouteMessage(null); setRouteNotice('');
  }, []);
  const setChoice = useCallback((c: ProfileChoice) => { saveProfileChoice(c); setChoiceRaw(c); dropRoute(); }, [dropRoute]);
  // Zmiana końca trasy unieważnia narysowaną trasę (pierwsze wyznaczenie jest ręczne).
  const setRouteFrom = useCallback((p: LonLat | null) => { setFrom(p); dropRoute(); }, [dropRoute]);
  const setRouteTo = useCallback((p: LonLat | null) => { setTo(p); dropRoute(); }, [dropRoute]);
  const setFeatureStates = useCallback((id: string, s: StatesByAttr) => {
    setStates((prev) => ({ ...prev, [id]: s }));
    setStatesVersion((v) => v + 1);
  }, []);

  const latest = useRef({ from: routeFrom, to: routeTo, profile, route });
  latest.current = { from: routeFrom, to: routeTo, profile, route };
  const runRoute = useCallback(async (auto: boolean) => {
    const { from, to, profile: prof } = latest.current;
    if (!from || !to) return;
    const id = ++reqId.current;
    inFlight.current = true;
    setRouteBusy(true); setRouteMessage(null); setRouteNotice('');
    if (!auto) setRoute(null);
    const fail = (m: NonNullable<AppValue['routeMessage']>) => { setRoute(null); setRouteMessage(m); };
    try {
      const res = await postRoute(from, to, prof);
      if (id !== reqId.current) return;
      if ('error' in res) {
        fail({ kind: 'info', text: res.error === 'out_of_area' ? 'Ten punkt jest poza obszarem dema (Stare Miasto i Kazimierz).' : 'Nie znaleziono połączenia między tymi punktami.' });
      } else if (res.coords.length === 0 || res.summary.lengthM === 0) {
        fail({ kind: 'info', text: 'Start i cel to to samo miejsce. Wskaż dwa różne punkty.' });
      } else {
        const prev = latest.current.route;
        // Automatyczne przeliczenie dało tę samą trasę: zostaje poprzedni obiekt (mapa się nie dopasowuje), bez komunikatu.
        if (auto && prev && prev.sentence === res.sentence && prev.coords.length === res.coords.length
          && prev.coords.every((c, i) => c[0] === res.coords[i][0] && c[1] === res.coords[i][1])) return;
        setRoute(res);
        if (auto) setRouteNotice(ROUTE_CHANGED);
      }
    } catch (e) {
      if (id === reqId.current) fail({ kind: 'alert', text: (e as Error).message });
    } finally {
      if (id === reqId.current) { inFlight.current = false; setRouteBusy(false); }
    }
  }, []);
  const computeRoute = useCallback(() => { void runRoute(false); }, [runRoute]);
  // Dane się zmieniły (zgłoszenie, głos): jeśli istnieje trasa (albo trwa jej wyznaczanie), policz ją od nowa.
  useEffect(() => {
    if (statesVersion === 0) return;
    if (latest.current.route || inFlight.current) void runRoute(true);
  }, [statesVersion, runRoute]);
  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const evalFor = useCallback((f: Feature) => evaluate(profile, valuesFromStates(states[f.id]), f.kind), [profile, states]);
  const statusFor = useCallback((f: Feature) => statusOf(evalFor(f)), [evalFor]);

  const value = useMemo<AppValue | null>(() => data && ({
    features: data.features, featuresById, bbox: data.bbox, states, setFeatureStates, profile, choice, setChoice,
    basemap, setBasemap, tab, setTab, selectedId, select, route, setRoute, routeBusy, routeMessage, routeNotice, computeRoute, statusFor, evalFor,
    routeFrom, routeTo, setRouteFrom, setRouteTo, pickTarget, setPickTarget, getMapCenter, setMapCenter, userPos, setUserPos, reportFor, setReportFor,
  }), [data, featuresById, states, setFeatureStates, profile, choice, setChoice, basemap, setBasemap, tab, selectedId, select, route, routeBusy, routeMessage, routeNotice, computeRoute, statusFor, evalFor, routeFrom, routeTo, setRouteFrom, setRouteTo, pickTarget, getMapCenter, setMapCenter, userPos, reportFor]);

  if (error) {
    return (
      <div className="boot">
        <p role="alert">{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Spróbuj ponownie</button>
      </div>
    );
  }
  if (!value) return <div className="boot"><p role="status">Wczytywanie danych…</p></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
