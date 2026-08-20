const API = (import.meta as any).env?.PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

function apiFetch(p: string, i: RequestInit = {}): Promise<Response> {
  const h: Record<string, string> = { Accept: 'application/json', ...(i.headers as Record<string, string>) };
  if (typeof i.body === 'string') h['Content-Type'] = 'application/json';
  return fetch(`${API}${p}`, { ...i, headers: h, credentials: 'include' });
}

async function beErr(r: Response): Promise<Error> {
  try { const b = await r.json(); return new Error(b?.error?.message ?? `Request failed (${r.status})`); }
  catch { return new Error(`Request failed (${r.status})`); }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const d = Math.floor(ms / 86400000);
  if (d >= 365) return `${Math.floor(d / 365)}y ago`;
  if (d >= 30) return `${Math.floor(d / 30)}mo ago`;
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
}

function scoreLabel(s: number): string {
  if (s >= 90) return 'Excellent';
  if (s >= 75) return 'Healthy';
  if (s >= 60) return 'Good';
  if (s >= 40) return 'Needs Fixes';
  return 'Critical';
}

const issueLabels: Record<string, string> = {
  MISSING_HTTPS: 'HTTPS missing', MISSING_ROBOTS_TXT: 'robots.txt missing', MISSING_SITEMAP: 'Sitemap missing',
  MISSING_TITLE: 'Missing titles', DUPLICATE_TITLE: 'Duplicate titles', TITLE_TOO_SHORT: 'Short titles',
  TITLE_TOO_LONG: 'Long titles', MISSING_META_DESCRIPTION: 'Missing meta descriptions',
  DUPLICATE_META_DESCRIPTION: 'Duplicate meta descriptions', MISSING_CANONICAL: 'Missing canonicals',
  NOINDEX_PAGE: 'Noindex pages', BROKEN_INTERNAL_LINK: 'Broken links', NON_200_PAGE: 'Non-200 pages',
};

// --- State ---
type View = 'projects' | 'dashboard' | 'settings';
interface Project {
  id: string; name: string | null; websiteUrl: string; domain: string; scanCount: number;
  latestScan: { id: string; status: string; startedAt: string | null; completedAt: string | null;
    createdAt: string; healthScore: number | null; pagesCrawled: number; pagesDiscovered: number; } | null;
}

let currentUser: { id: string; email: string } | null = null;
let projects: Project[] = [];
let currentProject: Project | null = null;
let currentView: View = 'projects';
let renameTarget: Project | null = null;
let deleteTarget: Project | null = null;
let currentCrawlId = '';

const $ = (id: string) => document.getElementById(id);
const viewProjects = $('view-projects');
const viewDashboard = $('view-dashboard');
const viewSettings = $('view-settings');
const projectsGrid = $('projects-grid');
const projectsEmpty = $('projects-empty');
const projectsLoading = $('projects-loading');
const projectsError = $('projects-error');
const sidebarNav = document.querySelectorAll<HTMLAnchorElement>('[data-sidebar-nav]');

// --- View management ---
function showView(v: View) {
  currentView = v;
  if (viewProjects) viewProjects.classList.toggle('hidden', v !== 'projects');
  if (viewDashboard) viewDashboard.classList.toggle('hidden', v !== 'dashboard');
  if (viewSettings) viewSettings.classList.toggle('hidden', v !== 'settings');
  sidebarNav.forEach(a => {
    const key = a.dataset.sidebarNav!;
    const active = (v === 'projects' && key === 'projects') ||
      (v === 'dashboard' && key === 'overview') ||
      (v === 'settings' && key === 'settings');
    a.classList.toggle('text-white', active);
    a.classList.toggle('bg-white/[0.08]', active);
    a.classList.toggle('font-semibold', active);
  });
  const ctx = $('topbar-context');
  const sep = $('topbar-sep');
  const page = $('topbar-page');
  if (v === 'projects') {
    if (ctx) ctx.textContent = 'Projects';
    if (sep) sep.style.display = 'none';
    if (page) page.textContent = '';
  } else if (v === 'dashboard') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'Overview';
  } else {
    if (ctx) ctx.textContent = 'Settings';
    if (sep) sep.style.display = 'none';
    if (page) page.textContent = '';
  }
  const divider = $('sidebar-project-divider');
  const pnav = $('sidebar-project-nav');
  if (divider) divider.style.display = v === 'dashboard' ? '' : 'none';
  if (pnav) pnav.style.display = v === 'dashboard' ? '' : 'none';
}

// --- Sidebar ---
function toggleSidebar() {
  $('app-sidebar')?.classList.toggle('hidden');
  $('sidebar-overlay')?.classList.toggle('hidden');
}
$('mobile-menu-btn')?.addEventListener('click', toggleSidebar);
$('sidebar-overlay')?.addEventListener('click', toggleSidebar);

sidebarNav.forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const k = a.dataset.sidebarNav!;
  if (k === 'projects') { currentProject = null; showView('projects'); void loadProjects(); }
  else if (k === 'overview' && currentProject) showView('dashboard');
  else if (k === 'settings') showView('settings');
  if (window.innerWidth < 1024) toggleSidebar();
}));
$('sidebar-logout-btn')?.addEventListener('click', () => void logout());
$('btn-settings-logout')?.addEventListener('click', () => void logout());

// --- Helpers ---
function showBanner(el: HTMLElement | null, msg: string) { if (!el) return; el.textContent = msg; el.classList.remove('hidden'); }
function hideBanner(el: HTMLElement | null) { if (!el) return; el.classList.add('hidden'); }

// --- Projects ---
const statusMeta: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RUNNING: { label: 'Running', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  PENDING: { label: 'Queued', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  FAILED: { label: 'Failed', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function renderProjectCard(p: Project): string {
  const scan = p.latestScan;
  const health = scan?.healthScore ?? null;
  const lastScanned = scan ? timeAgo(scan.completedAt ?? scan.createdAt) : 'Never';
  const meta = scan?.status ? statusMeta[scan.status] : null;
  const badge = meta
    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.cls}">${meta.label}</span>`
    : `<span class="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold bg-slate-100 text-slate-500 border-slate-200">No scan</span>`;
  return `
    <div class="relative bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4 hover:shadow-md hover:border-slate-300 transition-all">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="font-bold text-slate-900 truncate">${esc(p.domain)}</div>
          <div class="text-xs text-slate-400 font-mono truncate mt-0.5">${esc(p.websiteUrl)}</div>
        </div>
        <div class="flex items-start gap-2 shrink-0">
          <div class="text-right">
            <div class="text-xl font-black text-blue-700 leading-none">${health ?? '—'}</div>
            <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-1">health /100</div>
          </div>
          <div class="relative">
            <button type="button" data-action="menu" data-id="${p.id}" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-transparent hover:border-slate-200 transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
            </button>
            <div data-menu="${p.id}" class="hidden absolute right-0 top-full mt-1 w-40 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1">
              <button type="button" data-action="rename" data-id="${p.id}" class="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">Rename project</button>
              <button type="button" data-action="delete" data-id="${p.id}" class="w-full text-left px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer">Delete project</button>
            </div>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2 text-xs text-slate-500">
        <div class="flex items-center gap-2">${badge}${p.scanCount > 0 ? `<span class="font-mono text-slate-400">${p.scanCount} scan${p.scanCount === 1 ? '' : 's'}</span>` : ''}</div>
        <span class="font-mono">Last: <span class="text-slate-700 font-semibold">${lastScanned}</span></span>
      </div>
      <div class="flex items-center gap-2 pt-1 border-t border-slate-100">
        <button type="button" data-action="open" data-id="${p.id}" class="flex-1 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer">Open Dashboard</button>
        <button type="button" data-action="scan" data-id="${p.id}" class="flex-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Run Scan</button>
        <button type="button" data-action="history" data-id="${p.id}" class="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">History</button>
      </div>
    </div>`;
}

function renderProjects() {
  if (!projectsGrid || !projectsEmpty || !projectsLoading) return;
  projectsLoading.classList.add('hidden');
  if (projects.length === 0) { projectsGrid.innerHTML = ''; projectsEmpty.classList.remove('hidden'); return; }
  projectsEmpty.classList.add('hidden');
  projectsGrid.innerHTML = projects.map(renderProjectCard).join('');
}

function closeProjectMenus(exceptId?: string) {
  document.querySelectorAll<HTMLElement>('[data-menu]').forEach(m => {
    if (m.dataset.menu !== exceptId) m.classList.add('hidden');
  });
}

async function loadProjects() {
  if (projectsLoading) projectsLoading.classList.remove('hidden');
  try {
    const r = await apiFetch('/api/projects');
    if (!r.ok) {
      if (r.status === 401) { window.location.replace('/login?next=/app'); return; }
      showBanner(projectsError, (await beErr(r)).message); return;
    }
    projects = (await r.json()).projects ?? [];
    renderProjects();
  } catch {
    showBanner(projectsError, 'Could not load projects. Is the backend running on localhost:3000?');
    if (projectsLoading) projectsLoading.classList.add('hidden');
  }
}

// --- Module rendering ---
function setModuleStatus(mod: string, text: string, color: string) {
  const el = $(`status-${mod}`);
  if (!el) return;
  el.textContent = text;
  el.className = `status-badge inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold bg-${color}-50 text-${color}-700 border-${color}-200`;
}

function setModuleBody(mod: string, html: string) {
  const el = $(`body-${mod}`);
  if (el) el.innerHTML = html;
}

function renderProcessing(mod: string, msg: string) {
  setModuleStatus(mod, 'Processing…', 'blue');
  setModuleBody(mod, `<div class="flex flex-col items-center justify-center gap-2 py-3">
    <div class="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
    <p class="text-xs text-slate-500 font-medium">${esc(msg)}</p>
  </div>`);
}

function renderTechResult(data: Record<string, any>, mod = 'technical') {
  const crawl = data.crawl ?? {};
  const score = typeof data.healthScore === 'number' ? data.healthScore : 0;
  const counts = data.issueCounts ?? {};
  const totalIssues = data.issueCount ?? 0;
  const lines: string[] = [];
  for (const [k, n] of Object.entries(counts)) {
    if ((n as number) > 0 && issueLabels[k]) lines.push(`${issueLabels[k]}: ${n}`);
  }
  const color = score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'rose';
  setModuleStatus(mod, `${score}% · ${scoreLabel(score)}`, color);
  let html = `<div class="text-2xl font-black text-${color}-600 mb-1">${score}<span class="text-sm font-normal text-slate-400">/100</span></div>`;
  html += `<div class="text-xs text-slate-500 mb-2">${totalIssues} issue${totalIssues === 1 ? '' : 's'} found</div>`;
  if (lines.length > 0) {
    html += `<div class="space-y-1">${lines.slice(0, 3).map(l =>
      `<div class="text-xs text-amber-700 flex items-center gap-1.5"><span class="w-1 h-1 rounded-full bg-amber-400 shrink-0"></span>${esc(l)}</div>`
    ).join('')}</div>`;
  } else {
    html += `<div class="text-xs text-emerald-600 flex items-center gap-1.5"><span class="w-1 h-1 rounded-full bg-emerald-400 shrink-0"></span>No critical issues</div>`;
  }
  if (crawl.robotsFound) html += `<div class="text-xs text-emerald-600 mt-1">robots.txt found</div>`;
  if (crawl.sitemapFound) html += `<div class="text-xs text-emerald-600">sitemap.xml found</div>`;
  setModuleBody(mod, html);
  const s = $('dash-score'); if (s) s.textContent = String(score);
  const p = $('dash-pages'); if (p) p.textContent = String(data.pages?.length ?? 0);
}

function renderTechError(msg: string, mod = 'technical') {
  setModuleStatus(mod, 'Error', 'rose');
  setModuleBody(mod, `<div class="text-xs text-rose-600">${esc(msg)}</div>`);
}

function renderSearchResult(data: Record<string, any>, mod = 'search') {
  const opps = data?.opportunities ?? [];
  const high = opps.filter((o: any) => o.priority === 'high').length;
  setModuleStatus(mod, `${opps.length} opps${high > 0 ? ` · ${high} high` : ''}`, 'blue');
  const s = $('dash-opps'); if (s) s.textContent = String(opps.length);
  if (opps.length === 0) { setModuleBody(mod, '<div class="text-xs text-slate-400">No opportunities found.</div>'); return; }
  const html = opps.slice(0, 3).map((o: any) =>
    `<div class="bg-slate-50 rounded-lg p-2 mb-1.5">
      <div class="text-xs font-semibold text-slate-800 truncate">"${esc(o.query)}"</div>
      <div class="text-[10px] text-slate-500 mt-0.5">${esc((o.reason ?? '').slice(0, 80))}${(o.reason ?? '').length > 80 ? '…' : ''}</div>
    </div>`
  ).join('');
  setModuleBody(mod, html + (opps.length > 3 ? `<div class="text-[10px] text-slate-400 mt-1">+ ${opps.length - 3} more</div>` : ''));
}

function renderSearchError(msg: string, mod = 'search') {
  setModuleStatus(mod, 'Error', 'rose');
  setModuleBody(mod, `<div class="text-xs text-rose-600">${esc(msg)}</div>`);
}

function renderRedditResult(data: Record<string, any>, mod = 'reddit') {
  if (data.status === 'pending') { renderProcessing(mod, 'Analyzing Reddit conversations…'); return; }
  if (data.status === 'unavailable') {
    setModuleStatus(mod, 'Unavailable', 'slate');
    setModuleBody(mod, `<div class="text-xs text-amber-700">${esc(data.message ?? 'Reddit discovery unavailable.')}</div>`);
    return;
  }
  const disc = data?.discussions ?? [];
  const high = disc.filter((d: any) => d.priority === 'high').length;
  setModuleStatus(mod, `${disc.length} disc.${high > 0 ? ` · ${high} high` : ''}`, 'orange');
  const r = $('dash-reddit'); if (r) r.textContent = String(disc.length);
  if (disc.length === 0) { setModuleBody(mod, '<div class="text-xs text-slate-400">No discussions found.</div>'); return; }
  const html = disc.slice(0, 3).map((d: any) =>
    `<div class="bg-slate-50 rounded-lg p-2 mb-1.5">
      <div class="text-xs"><span class="text-orange-600 font-bold">r/${esc(d.subreddit)}</span> <span class="text-slate-700 truncate">${esc((d.postTitle ?? '').slice(0, 50))}</span></div>
      <div class="text-[10px] text-slate-400 mt-0.5">Score ${d.opportunityScore} · ${d.priority}</div>
    </div>`
  ).join('');
  setModuleBody(mod, html + (disc.length > 3 ? `<div class="text-[10px] text-slate-400 mt-1">+ ${disc.length - 3} more</div>` : ''));
}

function renderRedditError(msg: string, mod = 'reddit') {
  setModuleStatus(mod, 'Error', 'rose');
  setModuleBody(mod, `<div class="text-xs text-rose-600">${esc(msg)}</div>`);
}

function renderAiResult(data: Record<string, any>, mod = 'ai') {
  if (data.status === 'unavailable') {
    setModuleStatus(mod, 'Unavailable', 'slate');
    setModuleBody(mod, `<div class="text-xs text-amber-700">${esc(data.message ?? 'AI visibility unavailable.')}</div>`);
    return;
  }
  const results = data?.results ?? [];
  const mentioned = data.mentionedCount ?? 0;
  const cited = data.citedCount ?? 0;
  const score = data.overallVisibilityScore ?? 0;
  setModuleStatus(mod, `${mentioned} mentioned · ${cited} cited`, 'violet');
  let html = `<div class="text-2xl font-black text-violet-600 mb-1">${score}<span class="text-sm font-normal text-slate-400">/100</span></div>`;
  if (results.length > 0) {
    html += results.slice(0, 3).map((r: any) => {
      const label = r.cited ? 'Cited' : r.mentioned ? 'Mentioned' : 'Not found';
      const cls = r.cited ? 'text-emerald-700' : r.mentioned ? 'text-blue-600' : 'text-rose-600';
      return `<div class="bg-slate-50 rounded-lg p-2 mb-1.5">
        <div class="text-xs font-semibold text-slate-800 truncate">"${esc(r.topic)}"</div>
        <div class="text-[10px] ${cls} font-bold">${label}</div>
      </div>`;
    }).join('');
  } else {
    html += '<div class="text-xs text-slate-400">No results yet.</div>';
  }
  setModuleBody(mod, html);
}

function renderAiError(msg: string, mod = 'ai') {
  setModuleStatus(mod, 'Error', 'rose');
  setModuleBody(mod, `<div class="text-xs text-rose-600">${esc(msg)}</div>`);
}

function renderContentResult(data: Record<string, any>, mod = 'content') {
  if (data.status === 'unavailable') {
    setModuleStatus(mod, 'Unavailable', 'slate');
    setModuleBody(mod, `<div class="text-xs text-amber-700">${esc(data.message ?? 'Content generation unavailable.')}</div>`);
    return;
  }
  const recs = data?.recommendations ?? [];
  const high = recs.filter((r: any) => r.priority === 'high').length;
  setModuleStatus(mod, `${recs.length} ideas${high > 0 ? ` · ${high} high` : ''}`, 'indigo');
  if (recs.length === 0) { setModuleBody(mod, '<div class="text-xs text-slate-400">No content ideas found.</div>'); return; }
  const html = recs.slice(0, 3).map((r: any) =>
    `<div class="bg-slate-50 rounded-lg p-2 mb-1.5">
      <div class="text-xs font-semibold text-slate-800 truncate">${esc(r.title)}</div>
      <div class="text-[10px] text-slate-500 mt-0.5">${esc(r.intent)} · ${r.aiEnhanced ? 'AI brief' : 'Draft'}</div>
    </div>`
  ).join('');
  setModuleBody(mod, html + (recs.length > 3 ? `<div class="text-[10px] text-slate-400 mt-1">+ ${recs.length - 3} more</div>` : ''));
  const rec = recs[0];
  if (rec) {
    const el = $('body-recommendation');
    if (el) el.innerHTML = `<strong class="block mb-1">${esc(rec.title)}</strong><span class="text-xs text-blue-600 font-semibold">${esc(rec.priority)} priority</span> — <span class="text-xs">${esc((rec.rationale ?? '').slice(0, 120))}${(rec.rationale ?? '').length > 120 ? '…' : ''}</span>`;
  }
}

function renderContentError(msg: string, mod = 'content') {
  setModuleStatus(mod, 'Error', 'rose');
  setModuleBody(mod, `<div class="text-xs text-rose-600">${esc(msg)}</div>`);
}

function resetModules() {
  const mods = ['technical', 'search', 'reddit', 'ai', 'content'];
  const defaults: Record<string, [string, string, string]> = {
    technical: ['Awaiting scan', 'slate', 'Run a scan to check technical health.'],
    search: ['Awaiting scan', 'slate', 'Run a scan to discover search opportunities.'],
    reddit: ['Awaiting scan', 'slate', 'Run a scan to find Reddit discussions.'],
    ai: ['Awaiting scan', 'slate', 'Run a scan to check AI visibility.'],
    content: ['Awaiting scan', 'slate', 'Run a scan to generate content ideas.'],
  };
  for (const m of mods) {
    const [text, color, body] = defaults[m];
    setModuleStatus(m, text, color);
    setModuleBody(m, `<div class="text-xs text-slate-400">${body}</div>`);
  }
  const s = $('dash-score'); if (s) s.textContent = '—';
  const p = $('dash-pages'); if (p) p.textContent = '—';
  const o = $('dash-opps'); if (o) o.textContent = '—';
  const r = $('dash-reddit'); if (r) r.textContent = '—';
  const rec = $('body-recommendation');
  if (rec) rec.innerHTML = '<div class="text-blue-400 text-xs">Run a scan to get personalized recommendations.</div>';
}

// Module endpoint mapping
const modEndpoints: Record<string, string> = {
  search: '/search-opportunities',
  reddit: '/reddit-opportunities',
  ai: '/ai-visibility',
  content: '/content-recommendations',
};

const modRenderers: Record<string, (d: any) => void> = {
  technical: renderTechResult,
  search: renderSearchResult,
  reddit: renderRedditResult,
  ai: renderAiResult,
  content: renderContentResult,
};

const modErrRenderers: Record<string, (m: string) => void> = {
  technical: renderTechError,
  search: renderSearchError,
  reddit: renderRedditError,
  ai: renderAiError,
  content: renderContentError,
};

const modProcessingMsgs: Record<string, string> = {
  technical: 'Scanning website infrastructure…',
  search: 'Finding search opportunities…',
  reddit: 'Analyzing Reddit conversations…',
  ai: 'Checking AI visibility…',
  content: 'Compiling content recommendations…',
};

async function loadModules(crawlId: string) {
  renderProcessing('technical', modProcessingMsgs.technical);
  for (const m of ['search', 'reddit', 'ai', 'content']) renderProcessing(m, modProcessingMsgs[m]);

  // Load technical from crawl results
  try {
    const r = await apiFetch(`/api/crawls/${crawlId}/results`);
    if (!r.ok) throw await beErr(r);
    renderTechResult(await r.json());
  } catch (e) { renderTechError(e instanceof Error ? e.message : 'Failed to load results.'); }

  // Load other modules in parallel
  const fetches = ['search', 'reddit', 'ai', 'content'].map(async (m) => {
    try {
      const r = await apiFetch(`/api/crawls/${crawlId}${modEndpoints[m]}`);
      if (!r.ok) throw await beErr(r);
      const d = await r.json();
      if (d.status === 'pending' && m === 'reddit') {
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const pr = await apiFetch(`/api/crawls/${crawlId}${modEndpoints[m]}`);
          if (!pr.ok) throw await beErr(pr);
          const pd = await pr.json();
          if (pd.status !== 'pending') { modRenderers[m](pd); return; }
        }
        modRenderers[m]({ status: 'unavailable', message: 'Reddit discovery timed out.' });
      } else {
        modRenderers[m](d);
      }
    } catch (e) { modErrRenderers[m](e instanceof Error ? e.message : 'Failed to load.'); }
  });
  await Promise.all(fetches);
}

// --- Dashboard ---
async function openDashboard(project: Project, action?: string) {
  currentProject = project;
  showView('dashboard');
  window.scrollTo({ top: 0 });
  resetModules();
  const icon = $('dash-icon'); if (icon) icon.textContent = project.domain.charAt(0).toUpperCase();
  const domain = $('dash-domain'); if (domain) domain.textContent = project.domain;
  const scanStatus = $('dash-scan-status');
  const lastScan = $('dash-last-scan');
  if (project.latestScan) {
    const ls = project.latestScan;
    const meta = statusMeta[ls.status];
    if (scanStatus) scanStatus.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${ls.status === 'COMPLETED' ? 'bg-emerald-500' : ls.status === 'RUNNING' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}"></span><span>${meta?.label ?? ls.status}</span>`;
    if (lastScan) lastScan.textContent = `Last scan: ${timeAgo(ls.completedAt ?? ls.createdAt)}`;
    currentCrawlId = ls.id;
    if (action === 'scan') {
      void runScan(project);
    } else if (ls.status === 'COMPLETED') {
      void loadModules(ls.id);
    } else {
      void pollAndLoad(project, ls.id);
    }
  } else {
    if (scanStatus) scanStatus.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-300"></span><span>No scans yet</span>';
    if (lastScan) lastScan.textContent = '—';
    currentCrawlId = '';
  }
}

async function pollAndLoad(project: Project, crawlId: string) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const r = await apiFetch(`/api/crawls/${crawlId}`);
      if (!r.ok) throw await beErr(r);
      const run = await r.json();
      if (run.status === 'COMPLETED') { currentCrawlId = crawlId; void loadModules(crawlId); return; }
      if (run.status === 'FAILED') { setModuleStatus('technical', 'Failed', 'rose'); setModuleBody('technical', `<div class="text-xs text-rose-600">${esc(run.errorMessage ?? 'Scan failed.')}</div>`); return; }
      const scanStatus = $('dash-scan-status');
      if (scanStatus) scanStatus.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span><span>Scanning…</span>';
      await new Promise(r => setTimeout(r, 1500));
    } catch { return; }
  }
}

// --- Scan ---
async function runScan(project: Project) {
  const btn = $('btn-run-scan') as HTMLButtonElement | null;
  const btnText = $('btn-scan-text');
  if (btn) { btn.disabled = true; btn.classList.add('opacity-60', 'cursor-wait'); }
  if (btnText) btnText.textContent = 'Scanning…';
  const scanStatus = $('dash-scan-status');
  if (scanStatus) scanStatus.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span><span>Starting scan…</span>';
  try {
    const r = await apiFetch(`/api/projects/${project.id}/crawls`, { method: 'POST' });
    if (!r.ok) throw await beErr(r);
    const crawl = await r.json();
    currentCrawlId = crawl.id;
    currentProject = { ...project, latestScan: { id: crawl.id, status: 'PENDING', startedAt: null, completedAt: null, createdAt: new Date().toISOString(), healthScore: null, pagesCrawled: 0, pagesDiscovered: 0 } };
    await pollAndLoad(project, crawl.id);
    void loadProjects();
  } catch (e) {
    setModuleStatus('technical', 'Failed', 'rose');
    setModuleBody('technical', `<div class="text-xs text-rose-600">${esc(e instanceof Error ? e.message : 'Scan failed.')}</div>`);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-wait'); }
    if (btnText) btnText.textContent = 'Run New Scan';
    window.dispatchEvent(new CustomEvent('foundable:scan-complete'));
  }
}

// --- Create project ---
function openCreateModal() {
  const modal = $('modal-create');
  if (modal) modal.classList.remove('hidden');
  setTimeout(() => ($('input-create-url') as HTMLInputElement | null)?.focus(), 50);
}
function closeCreateModal() { $('modal-create')?.classList.add('hidden'); }

$('btn-new-project')?.addEventListener('click', openCreateModal);
$('btn-empty-new')?.addEventListener('click', openCreateModal);
$('btn-create-cancel')?.addEventListener('click', closeCreateModal);
$('modal-create')?.addEventListener('click', e => { if ((e.target as HTMLElement).hasAttribute('data-modal-panel')) return; closeCreateModal(); });

$('form-create')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideBanner($('create-error'));
  const urlInput = $('input-create-url') as HTMLInputElement | null;
  const raw = urlInput?.value.trim() ?? '';
  if (!raw) { showBanner($('create-error'), 'Please enter a website URL.'); return; }
  const websiteUrl = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : `https://${raw.replace(/\/+$/, '')}`;
  const name = (($('input-create-name') as HTMLInputElement | null)?.value ?? '').trim();
  const submitBtn = $('btn-create-submit') as HTMLButtonElement | null;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }
  try {
    const r = await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ ...(name ? { name } : {}), websiteUrl }) });
    if (!r.ok) {
      if (r.status === 401) { window.location.replace('/login?next=/app'); return; }
      showBanner($('create-error'), (await beErr(r)).message); return;
    }
    const project: Project = await r.json();
    closeCreateModal();
    ($('form-create') as HTMLFormElement | null)?.reset();
    await loadProjects();
    void openDashboard(project);
  } catch { showBanner($('create-error'), 'Could not reach the backend.'); }
  finally { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create project'; } }
});

// --- Rename ---
function openRenameModal(p: Project) {
  renameTarget = p;
  const d = $('rename-domain'); if (d) d.textContent = p.domain;
  const inp = $('input-rename') as HTMLInputElement | null;
  if (inp) { inp.value = p.name ?? p.domain; inp.removeAttribute('disabled'); }
  hideBanner($('rename-error'));
  $('modal-rename')?.classList.remove('hidden');
  setTimeout(() => inp?.focus(), 50);
}
function closeRenameModal() { $('modal-rename')?.classList.add('hidden'); renameTarget = null; }
$('btn-rename-cancel')?.addEventListener('click', closeRenameModal);
$('modal-rename')?.addEventListener('click', e => { if ((e.target as HTMLElement).hasAttribute('data-modal-panel')) return; closeRenameModal(); });
$('btn-rename-submit')?.addEventListener('click', async () => {
  if (!renameTarget) return;
  const name = (($('input-rename') as HTMLInputElement | null)?.value ?? '').trim();
  if (!name) { showBanner($('rename-error'), 'Please enter a project name.'); return; }
  hideBanner($('rename-error'));
  try {
    const r = await apiFetch(`/api/projects/${renameTarget.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    if (!r.ok) { if (r.status === 401) { window.location.replace('/login?next=/app'); return; } showBanner($('rename-error'), (await beErr(r)).message); return; }
    const updated: Project = await r.json();
    const idx = projects.findIndex(p => p.id === updated.id);
    if (idx >= 0) projects[idx] = { ...projects[idx], ...updated };
    if (currentProject?.id === updated.id) currentProject = updated;
    renderProjects();
    closeRenameModal();
  } catch { showBanner($('rename-error'), 'Could not reach the backend.'); }
});

// --- Delete ---
function openDeleteModal(p: Project) {
  deleteTarget = p;
  const d = $('delete-domain'); if (d) d.textContent = p.domain;
  hideBanner($('delete-error'));
  $('modal-delete')?.classList.remove('hidden');
}
function closeDeleteModal() { $('modal-delete')?.classList.add('hidden'); deleteTarget = null; }
$('btn-delete-cancel')?.addEventListener('click', closeDeleteModal);
$('modal-delete')?.addEventListener('click', e => { if ((e.target as HTMLElement).hasAttribute('data-modal-panel')) return; closeDeleteModal(); });
$('btn-delete-submit')?.addEventListener('click', async () => {
  if (!deleteTarget) return;
  hideBanner($('delete-error'));
  try {
    const r = await apiFetch(`/api/projects/${deleteTarget.id}`, { method: 'DELETE' });
    if (!r.ok) { if (r.status === 401) { window.location.replace('/login?next=/app'); return; } showBanner($('delete-error'), (await beErr(r)).message); return; }
    const deletedId = deleteTarget.id;
    projects = projects.filter(p => p.id !== deletedId);
    closeDeleteModal();
    renderProjects();
    if (currentProject?.id === deletedId) { currentProject = null; showView('projects'); void loadProjects(); }
  } catch { showBanner($('delete-error'), 'Could not reach the backend.'); }
});

// --- Project card actions ---
projectsGrid?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>('button[data-action]');
  if (!btn) return;
  const id = btn.getAttribute('data-id')!;
  const action = btn.getAttribute('data-action') as string;
  const project = projects.find(p => p.id === id);
  if (!project) return;
  if (action === 'menu') {
    const menu = document.querySelector<HTMLElement>(`[data-menu="${id}"]`);
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    closeProjectMenus();
    if (willOpen) menu.classList.remove('hidden');
    return;
  }
  closeProjectMenus();
  if (action === 'rename') { openRenameModal(project); return; }
  if (action === 'delete') { openDeleteModal(project); return; }
  if (action === 'open' || action === 'history') { void openDashboard(project, action); return; }
  if (action === 'scan') { void openDashboard(project, 'scan'); return; }
});

document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button[data-action]')) closeProjectMenus(); });

// --- Run scan button on dashboard ---
$('btn-run-scan')?.addEventListener('click', () => { if (currentProject) void runScan(currentProject); });

// --- View report buttons ---
document.querySelectorAll<HTMLButtonElement>('.view-report-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const report = btn.dataset.report;
    if (!report || !currentCrawlId) return;
    window.open(`/app?view=${report}&crawlId=${currentCrawlId}`, '_self');
  });
});

// --- Logout ---
async function logout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
  window.location.href = '/';
}

// --- Init ---
async function init() {
  const r = await apiFetch('/api/auth/me');
  if (!r.ok) { window.location.replace('/login?next=/app'); return; }
  currentUser = (await r.json()).user;
  const emailEls = [$('topbar-email'), $('sidebar-user-email'), $('settings-email')];
  emailEls.forEach(el => { if (el && currentUser) el.textContent = currentUser.email; });
  const avatar = $('sidebar-user-avatar');
  if (avatar && currentUser) avatar.textContent = currentUser.email.charAt(0).toUpperCase();
  await loadProjects();
}

window.addEventListener('foundable:scan-complete', () => void loadProjects());

showView('projects');
void init();
