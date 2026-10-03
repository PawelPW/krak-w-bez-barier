import { AppProvider, useApp } from './state';
import type { Tab } from './state';
import { MapView } from './components/MapView';
import { FeatureSheet } from './components/FeatureSheet';
import { TabBar } from './components/TabBar';

const TITLES: Record<Tab, string> = { map: 'Mapa', list: 'Lista', route: 'Trasa', profile: 'Profil' };

function Shell() {
  const { tab } = useApp();
  return (
    <div className="app">
      <div className="stage">
        <MapView hidden={tab === 'list' || tab === 'profile'} />
        <main id="main" tabIndex={-1} className={tab === 'map' ? 'main-map' : tab === 'route' ? 'main-float' : 'main-panel'}>
          <h1 className={tab === 'map' ? 'sr-only' : undefined}>{TITLES[tab]}</h1>
          {tab !== 'map' && <p>Ten widok pojawi się w kolejnym kroku.</p>}
        </main>
      </div>
      <FeatureSheet />
      <TabBar />
    </div>
  );
}

export function App() {
  return <AppProvider><Shell /></AppProvider>;
}
