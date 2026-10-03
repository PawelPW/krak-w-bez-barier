import { useApp } from '../state';
import type { Tab } from '../state';

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Mapa' },
  { id: 'list', label: 'Lista' },
  { id: 'route', label: 'Trasa' },
  { id: 'profile', label: 'Profil' },
];

export function TabBar() {
  const { tab, setTab } = useApp();
  return (
    <nav className="tabbar" aria-label="Główna nawigacja">
      {TABS.map((t) => (
        <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
