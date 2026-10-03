import { AppProvider, useApp } from './state';
import type { LonLat } from '@kbg/domain';
import { MapView } from './components/MapView';
import { FeatureSheet } from './components/FeatureSheet';
import { TabBar } from './components/TabBar';
import { ListView } from './components/ListView';
import { ProfileView } from './components/ProfileView';
import { RouteView } from './components/RouteView';
import { ReportDialog } from './components/ReportDialog';

function Shell() {
  const { tab, pickTarget, setPickTarget, setRouteFrom, setRouteTo, reportFor, setReportFor, setFeatureStates } = useApp();
  const onPick = (p: LonLat) => {
    if (pickTarget === 'from') setRouteFrom(p);
    else if (pickTarget === 'to') setRouteTo(p);
    setPickTarget(null);
  };
  return (
    <div className="app">
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
