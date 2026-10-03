import { useEffect, useState } from 'react';
import { AppProvider, readLastLoad, useApp } from './state';
import { formatDateTime } from './status';
import type { LonLat } from '@kbg/domain';
import { MapView } from './components/MapView';
import { FeatureSheet } from './components/FeatureSheet';
import { TabBar } from './components/TabBar';
import { ListView } from './components/ListView';
import { ProfileView } from './components/ProfileView';
import { RouteView } from './components/RouteView';
import { ReportDialog } from './components/ReportDialog';

function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const at = readLastLoad();
  // Kontener jest zawsze w drzewie dostępności; zmienia się tylko tekst.
  return <p role="status" className="offline">{online ? '' : at ? `Brak połączenia. Ostatnie udane wczytanie danych: ${formatDateTime(at)}.` : 'Brak połączenia.'}</p>;
}

function Shell() {
  const { tab, pickTarget, setPickTarget, setRouteFrom, setRouteTo, reportFor, setReportFor, setFeatureStates } = useApp();
  const onPick = (p: LonLat) => {
    if (pickTarget === 'from') setRouteFrom(p);
    else if (pickTarget === 'to') setRouteTo(p);
    setPickTarget(null);
  };
  return (
    <div className="app">
      <OfflineBanner />
      <div className="stage">
        <MapView hidden={tab === 'list' || tab === 'profile'} onPick={onPick} />
        <main id="main" tabIndex={-1} className={tab === 'map' ? 'main-map' : tab === 'route' ? 'main-float' : 'main-panel'}>
          {tab === 'map' && <h1 className="sr-only">Mapa</h1>}
          {tab === 'list' && <ListView />}
          {tab === 'profile' && <ProfileView />}
          {tab === 'route' && <RouteView />}
        </main>
      </div>
      <FeatureSheet />
      <TabBar />
      {reportFor && (
        <ReportDialog key={reportFor} featureId={reportFor} onClose={() => setReportFor(null)} onSaved={(s) => setFeatureStates(reportFor, s)} />
      )}
    </div>
  );
}

export function App() {
  return <AppProvider><Shell /></AppProvider>;
}
