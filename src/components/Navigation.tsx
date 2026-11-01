import React from 'react';
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
    return view && (TAB_IDS as readonly string[]).includes(view) ? (view as TabId) : 'terminal';
  } catch {
    return 'terminal';
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
  // All routes remain intact; only the visible navigation is reduced.
  const primaryTabs = tabs.filter((tab) => tab.id === 'terminal');
  const secondaryTabs = tabs.filter((tab) => tab.id !== 'terminal');
  const isSecondaryActive = activeTab !== 'terminal';
  const mobileLabels: Partial<Record<TabId, string>> = { home: 'Pulpit', comms: 'Czat', terminal: 'Terminal', apps: 'Aplikacje', integrations: 'Integracje' };

  return (
    <nav aria-label="Nawigacja BastillaOS" className="app-navigation order-last flex w-full shrink-0 flex-row border-t border-blue-200/10 bg-[#07101e] lg:order-first lg:h-auto lg:w-60 lg:flex-col lg:border-r lg:border-t-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row gap-1 p-1.5 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:p-3">
        <div className="hidden px-3 pb-2 pt-1 text-[9px] font-mono font-bold tracking-[0.18em] text-blue-200/40 lg:block">
          OBSZAR ROBOCZY
        </div>
        {primaryTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.label}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative min-w-0 flex-1 flex-col items-center justify-center gap-1 min-h-11 rounded-xl px-1 py-2 text-center transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 lg:w-full lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-left ${tab.id === 'terminal' ? 'flex' : 'hidden lg:flex'} ${
                isActive
                  ? 'border border-cyan-300/15 bg-cyan-950/50 text-cyan-100 shadow-[inset_2px_0_0_#67e8f9,0_4px_18px_rgba(8,145,178,0.08)]'
                  : 'border border-transparent text-slate-400 hover:bg-blue-950/50 hover:text-blue-100'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 transition ${isActive ? 'text-cyan-200' : 'text-slate-500 group-hover:text-cyan-200'}`} />
              <span className="w-full truncate text-[10px] font-medium lg:hidden">{mobileLabels[tab.id] || tab.label}</span>
              <span className="hidden min-w-0 flex-1 truncate text-[11px] font-medium lg:block">{tab.label}</span>
              <span className={`hidden rounded-md px-1.5 py-0.5 text-[8px] font-mono font-bold xl:block ${isActive ? 'bg-cyan-900/70 text-cyan-200' : 'bg-slate-900 text-slate-500'}`}>
                {tab.badge}
              </span>
            </button>
          );
        })}
        <div className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 min-h-11 rounded-xl px-1 py-2 lg:mt-2 lg:w-full lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3 ${isSecondaryActive ? 'bg-cyan-950/50 text-cyan-100' : 'bg-slate-900 text-cyan-200'}`}>
          <Plug className="h-4 w-4 shrink-0" aria-hidden="true" />
          <label htmlFor="bastilla-more-modules" className="w-full truncate text-center text-[10px] lg:text-left lg:text-[11px]">Więcej</label>
          <select
            id="bastilla-more-modules"
            aria-label="Więcej — wybierz moduł BastillaOS"
            className="absolute inset-0 h-full w-full cursor-pointer rounded-xl opacity-0 focus-visible:opacity-100 focus-visible:bg-slate-950 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            value={isSecondaryActive ? activeTab : ''}
            onChange={(event) => { if (event.target.value) onSelectTab(event.target.value as TabId); }}
          >
            <option value="" disabled>Wybierz moduł</option>
            {secondaryTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </select>
        </div>
      </div>
      <div className="hidden border-t border-blue-200/10 p-3 text-[9px] font-mono text-blue-200/40 lg:block">
        BASTILLAOS · DEBIAN 13
      </div>
    </nav>
  );
};

