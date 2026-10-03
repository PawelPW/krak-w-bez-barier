import { useApp } from '../state';
import type { Tab } from '../state';
import { ORTO_ATTRIBUTION } from '../basemaps';

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Mapa' },
  { id: 'list', label: 'Lista' },
  { id: 'route', label: 'Trasa' },
  { id: 'profile', label: 'Profil' },
];

export function TabBar() {
  const { tab, setTab, basemap } = useApp();
  return (
    <>
      <footer className={basemap === 'satellite' ? 'credit credit-wide' : 'credit'}><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Dane mapy © OpenStreetMap contributors</a>{basemap === 'satellite' && <> · <span>{ORTO_ATTRIBUTION}</span></>}</footer>
      <nav className="tabbar" aria-label="Główna nawigacja">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
