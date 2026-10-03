import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { evaluate, mergeOverrides, profileById, statusOf, valuesFromStates } from '@kbg/domain';
import type { Evaluation, Feature, LonLat, Profile, RouteResult, StatesByAttr, StatesByFeature, Status } from '@kbg/domain';
import { getSnapshot, getStates } from './api';
import { loadProfileChoice, saveProfileChoice } from './profileStore';
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
  tab: Tab;
  setTab(t: Tab): void;
  selectedId: string | null;
  select(id: string | null): void;
  route: RouteResult | null;
  setRoute(r: RouteResult | null): void;
  routeFrom: LonLat | null;
  routeTo: LonLat | null;
  setRouteFrom(p: LonLat | null): void;
  setRouteTo(p: LonLat | null): void;
  /** Który koniec trasy zostanie ustawiony następnym dotknięciem mapy (zakładka Trasa). */
  pickTarget: 'from' | 'to' | null;
  setPickTarget(t: 'from' | 'to' | null): void;
  /** Środek mapy trzymany w ref: zmiana nie renderuje konsumentów, czyta go tylko ten, kto go potrzebuje. */
  /** Cecha, dla której otwarty jest dialog zgłoszenia (renderowany w Shell). */
  reportFor: string | null;
  setReportFor(id: string | null): void;
  getMapCenter(): LonLat;
  setMapCenter(p: LonLat): void;
  userPos: LonLat | null;
  setUserPos(p: LonLat | null): void;
  statusFor(f: Feature): Status;
  evalFor(f: Feature): Evaluation;
}

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
  const [tab, setTab] = useState<Tab>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeFrom, setFrom] = useState<LonLat | null>(null);
  const [routeTo, setTo] = useState<LonLat | null>(null);
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
      ([snap, st]) => { if (live) { setData({ features: snap.features, bbox: snap.bbox }); setStates(st); } },
      (e: Error) => { if (live) setError(e.message); },
    );
    return () => { live = false; };
  }, [attempt]);

  const features = data?.features;
  const featuresById = useMemo(() => new Map((features ?? []).map((f) => [f.id, f])), [features]);
  const profile = useMemo(() => mergeOverrides(profileById(choice.id), choice.overrides), [choice]);
  const setChoice = useCallback((c: ProfileChoice) => { saveProfileChoice(c); setChoiceRaw(c); setRoute(null); }, []);
  // Zmiana końca trasy unieważnia narysowaną trasę (ponowne wyznaczenie jest ręczne).
  const setRouteFrom = useCallback((p: LonLat | null) => { setFrom(p); setRoute(null); }, []);
  const setRouteTo = useCallback((p: LonLat | null) => { setTo(p); setRoute(null); }, []);
  const setFeatureStates = useCallback((id: string, s: StatesByAttr) => setStates((prev) => ({ ...prev, [id]: s })), []);
  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const evalFor = useCallback((f: Feature) => evaluate(profile, valuesFromStates(states[f.id]), f.kind), [profile, states]);
  const statusFor = useCallback((f: Feature) => statusOf(evalFor(f)), [evalFor]);

  const value = useMemo<AppValue | null>(() => data && ({
    features: data.features, featuresById, bbox: data.bbox, states, setFeatureStates, profile, choice, setChoice,
    tab, setTab, selectedId, select, route, setRoute, statusFor, evalFor,
    routeFrom, routeTo, setRouteFrom, setRouteTo, pickTarget, setPickTarget, getMapCenter, setMapCenter, userPos, setUserPos, reportFor, setReportFor,
  }), [data, featuresById, states, setFeatureStates, profile, choice, setChoice, tab, selectedId, select, route, statusFor, evalFor, routeFrom, routeTo, setRouteFrom, setRouteTo, pickTarget, getMapCenter, setMapCenter, userPos, reportFor]);

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
