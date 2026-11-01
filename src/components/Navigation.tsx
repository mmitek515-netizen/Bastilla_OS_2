import React, { useState } from 'react';
import { Terminal, MessagesSquare, FileCode2, Database, History, Activity, Cpu, GitBranch, Clock, Sigma, FolderOpen, HardDrive, LayoutGrid, Brain, Github, Home, ClipboardCheck, Radio, Plug, Shield, Images, Blocks, ChartNoAxesCombined } from 'lucide-react';

export type TabId =
  | 'home'
  | 'bastilla_os_2'
  | 'comms'
  | 'approvals'
  | 'process_matrix'
  | 'astyria_mission'
  | 'schema_graph'
  | 'temporal'
  | 'terminal'
  | 'monolith'
  | 'datastore'
  | 'diagnostics'
  | 'visualizer'
  | 'file_explorer'
  | 'apps'
  | 'hyper_com'
  | 'without_nlp'
  | 'github'
  | 'gpt_actions'
  | 'cloud_library'
  | 'integrations'
  | 'project_progress';

export const TAB_IDS: readonly TabId[] = [
  'home', 'bastilla_os_2', 'comms', 'approvals', 'process_matrix', 'astyria_mission', 'schema_graph', 'temporal',
  'terminal', 'monolith', 'datastore', 'diagnostics', 'visualizer', 'file_explorer',
  'apps', 'hyper_com', 'without_nlp', 'github', 'gpt_actions', 'cloud_library', 'integrations', 'project_progress',
];

/** Widok startowy z adresu, np. /?view=without_nlp (launchery KDE w BastillaOS). */
export function initialTabFromLocation(): TabId {
  try {
    const view = new URLSearchParams(window.location.search).get('view');
    return view && (TAB_IDS as readonly string[]).includes(view) ? (view as TabId) : 'home';
  } catch {
    return 'home';
  }
}

interface NavigationProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  messageCount: number;
  versionCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  messageCount,
  versionCount,
}) => {
  const [expanded, setExpanded] = useState(false);
  const tabs = [
    {
      id: 'home' as TabId,
      label: 'BastillaOS',
      icon: Home,
      badge: 'SYSTEM'
    },
    {
      id: 'bastilla_os_2' as TabId,
      label: 'Bastilla OS 2',
      icon: Shield,
      badge: 'IVORY & GOLD'
    },
    {
      id: 'comms' as TabId,
      label: 'Komora Triady & Dialog',
      icon: MessagesSquare,
      badge: `${messageCount}`
    },
    {
      id: 'approvals' as TabId,
      label: 'Akceptacje czatu',
      icon: ClipboardCheck,
      badge: 'DECYZJE'
    },
    {
      id: 'process_matrix' as TabId,
      label: 'Infrastruktura & Naprawa z Logów [Alex]',
      icon: Cpu,
      badge: 'DOWÓDCA'
    },
    {
      id: 'astyria_mission' as TabId,
      label: 'Misja Astyria & VM_Ten_System',
      icon: GitBranch,
      badge: 'VM v8.5'
    },
    {
      id: 'schema_graph' as TabId,
      label: 'Mapa Pamięci [Astyria]',
      icon: GitBranch,
      badge: 'ASTYRIA'
    },
    {
      id: 'temporal' as TabId,
      label: 'Oś Czasu & Migawki [Aurelius]',
      icon: Clock,
      badge: 'AURELIUS'
    },
    {
      id: 'terminal' as TabId,
      label: 'Konsola CLI',
      icon: Terminal,
      badge: 'PY 3.10'
    },
    {
      id: 'monolith' as TabId,
      label: 'Monolit Python (.py)',
      icon: FileCode2,
      badge: 'CODE'
    },
    {
      id: 'datastore' as TabId,
      label: 'Rejestr DATA_STORE',
      icon: Database,
      badge: 'JSON'
    },
    {
      id: 'diagnostics' as TabId,
      label: 'Telemetria',
      icon: Activity,
      badge: 'LIVE'
    },
    {
      id: 'visualizer' as TabId,
      label: 'Wizualizator Triady',
      icon: Sigma,
      badge: '3D'
    },
    {
      id: 'file_explorer' as TabId,
      label: 'Eksplorator RING-0',
      icon: HardDrive,
      badge: 'STORAGE'
    },
    {
      id: 'apps' as TabId,
      label: 'Aplikacje [Terminal Forge]',
      icon: LayoutGrid,
      badge: 'FORGE'
    },
    {
      id: 'hyper_com' as TabId,
      label: 'HyperCom — transmisje',
      icon: Radio,
      badge: 'HYPERCOM'
    },
    {
      id: 'without_nlp' as TabId,
      label: 'Rdzeń without_nlp [Astyria]',
      icon: Sigma,
      badge: 'EULER'
    },
    {
      id: 'gpt_actions' as TabId,
      label: 'Połączenie ChatGPT',
      icon: Plug,
      badge: 'API'
    },
    { id: 'integrations' as TabId, label: 'Integracje', icon: Blocks, badge: 'USŁUGI' },
    { id: 'cloud_library' as TabId, label: 'Zdjęcia i notatki', icon: Images, badge: 'IMPORT' },
    {
      id: 'project_progress' as TabId,
      label: 'Bastilla OS 2 · Postęp',
      icon: ChartNoAxesCombined,
      badge: 'GITHUB'
    },
    {
      id: 'github' as TabId,
      label: 'Eksport GitHub',
      icon: Github,
      badge: 'GIT'
    }
  ];
  const mobileLabels: Partial<Record<TabId, string>> = { home: 'Pulpit', comms: 'Czat', terminal: 'Terminal', apps: 'Aplikacje', integrations: 'Integracje' };

  const primary: TabId[] = ['comms', 'terminal', 'apps', 'file_explorer', 'project_progress'];
  const renderItem = (tab: typeof tabs[number]) => {
    const Icon = tab.icon;
    const selected = activeTab === tab.id;
    return <button key={tab.id} type="button" aria-current={selected ? 'page' : undefined}
      onClick={() => { onSelectTab(tab.id); setExpanded(false); }}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[12px] transition ${selected ? 'bg-slate-700/60 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
    ><Icon size={17} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{tab.label}</span></button>;
  };
  return <>
    <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Zamknij menu' : 'Otwórz menu'} aria-expanded={expanded}
      className="fixed right-3 top-3 z-[70] flex h-11 w-11 items-center justify-center rounded-xl border border-slate-600 bg-[#101827] text-white shadow-lg lg:hidden">
      {expanded ? '✕' : '☰'}
    </button>
    {expanded && <button aria-label="Zamknij menu" className="fixed inset-0 z-[59] bg-black/60 lg:hidden" onClick={() => setExpanded(false)} />}
    <nav aria-label="Menu Bastilla OS 2" className={`fixed inset-y-0 left-0 z-[60] flex w-[min(82vw,260px)] flex-col border-r border-slate-700 bg-[#0d1523] transition-transform lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:translate-x-0 ${expanded ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-4"><span className="text-sm font-semibold">Bastilla OS 2</span><button className="rounded p-2 text-xs text-slate-300 lg:hidden" onClick={() => setExpanded(false)}>Zamknij</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500">Przestrzeń robocza</div>
        {primary.map(id => tabs.find(t => t.id === id)).filter((t): t is typeof tabs[number] => Boolean(t)).map(renderItem)}
        <div className="my-3 border-t border-slate-700" />
        <button type="button" onClick={() => setExpanded(!expanded)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-800">Pozostałe moduły</button>
        {tabs.filter(t => !primary.includes(t.id)).map(renderItem)}
      </div>
      <div className="border-t border-slate-700 px-4 py-3 text-[11px] text-slate-500">BASTILLA OS 2 · MENU</div>
    </nav>
  </>;
};
