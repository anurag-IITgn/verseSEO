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
  MISSING_H1: 'Missing H1', DUPLICATE_H1: 'Multiple H1s', IMAGES_MISSING_ALT: 'Images missing alt',
  MISSING_OG_TAGS: 'Missing OG tags', MISSING_TWITTER_TAGS: 'Missing Twitter tags',
  MISSING_VIEWPORT: 'Missing viewport', MISSING_CHARSET: 'Missing charset',
  MISSING_FAVICON: 'Missing favicon', MISSING_HTML_LANG: 'Missing lang attribute',
  THIN_CONTENT: 'Thin content', SLOW_RESPONSE: 'Slow response',
};

function barChartH(data: { label: string; value: number; color: string }[], maxVal: number, width = 280): string {
  const barH = 18;
  const gap = 4;
  const labelW = 100;
  const totalH = data.length * (barH + gap);
  let svg = `<svg width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}" class="w-full">`;
  for (let i = 0; i < data.length; i++) {
    const y = i * (barH + gap);
    const barW = maxVal > 0 ? (data[i].value / maxVal) * (width - labelW - 40) : 0;
    svg += `<text x="${labelW - 4}" y="${y + 13}" text-anchor="end" class="fill-slate-500" style="font-size:10px">${esc(data[i].label)}</text>`;
    svg += `<rect x="${labelW}" y="${y}" width="${Math.max(barW, 2)}" height="${barH}" rx="3" class="fill-${data[i].color}-400"/>`;
    svg += `<text x="${labelW + barW + 6}" y="${y + 13}" class="fill-slate-600" style="font-size:10px;font-weight:600">${data[i].value}</text>`;
  }
  svg += '</svg>';
  return svg;
}

function donutChart(segments: { value: number; color: string; label: string }[], size = 80): string {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return '';
  const r = 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  let svg = `<svg width="${size}" height="${size}" viewBox="0 0 36 36" class="shrink-0">`;
  for (const seg of segments) {
    const pct = seg.value / total;
    const dash = pct * c;
    svg += `<circle cx="18" cy="18" r="${r}" fill="none" stroke="currentColor" stroke-width="3" class="text-${seg.color}-200" stroke-dasharray="${c}" stroke-dashoffset="${-offset * c}" transform="rotate(-90 18 18)"/>`;
    svg += `<circle cx="18" cy="18" r="${r}" fill="none" stroke="currentColor" stroke-width="3" class="text-${seg.color}-500" stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset * c}" transform="rotate(-90 18 18)"/>`;
    offset += pct;
  }
  svg += `<text x="18" y="19.5" text-anchor="middle" class="fill-slate-800" style="font-size:7px;font-weight:700">${total}</text>`;
  svg += '</svg>';
  return svg;
}

function funnelBar(label: string, current: number, total: number, color: string): string {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return `<div class="flex items-center gap-2">
    <div class="w-20 text-[10px] text-slate-500 text-right shrink-0">${esc(label)}</div>
    <div class="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
      <div class="h-full bg-${color}-400 rounded-full transition-all" style="width:${pct}%"></div>
    </div>
    <div class="w-16 text-[10px] text-slate-600 font-semibold">${current} <span class="text-slate-400 font-normal">(${pct}%)</span></div>
  </div>`;
}

function coveragePill(label: string, covered: number, total: number): string {
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const color = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'rose';
  return `<div class="flex items-center justify-between py-1.5">
    <span class="text-[10px] text-slate-600">${esc(label)}</span>
    <div class="flex items-center gap-1.5">
      <div class="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-${color}-400 rounded-full" style="width:${pct}%"></div></div>
      <span class="text-[10px] font-semibold text-${color}-600 w-8 text-right">${covered}/${total}</span>
    </div>
  </div>`;
}

// --- State ---
type View = 'projects' | 'dashboard' | 'settings' | 'report' | 'search-report' | 'ai-report' | 'content-report' | 'reddit-report' | 'history';
interface Project {
  id: string; name: string | null; websiteUrl: string; domain: string; scanCount: number;
  latestScan: { id: string; status: string; startedAt: string | null; completedAt: string | null;
    createdAt: string; healthScore: number | null; pagesCrawled: number; pagesDiscovered: number; } | null;
}

let currentUser: { id: string; email: string; plan: string; createdAt?: string } | null = null;
let projects: Project[] = [];
let currentProject: Project | null = null;
let currentView: View = 'projects';
let renameTarget: Project | null = null;
let deleteTarget: Project | null = null;
let currentCrawlId = '';
let currentReportType: 'technical' | 'search' = 'technical';

const $ = (id: string) => document.getElementById(id);
const viewProjects = $('view-projects');
const viewDashboard = $('view-dashboard');
const viewSettings = $('view-settings');
const viewReport = $('view-report');
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
  if (viewReport) viewReport.classList.toggle('hidden', v !== 'report' && v !== 'search-report' && v !== 'ai-report' && v !== 'content-report' && v !== 'reddit-report' && v !== 'history');
  if (v === 'settings') void loadSettings();
  if (v === 'history' && currentProject) void loadHistoryReport(currentProject.id);
  sidebarNav.forEach(a => {
    const key = a.dataset.sidebarNav!;
    const active = (v === 'projects' && key === 'projects') ||
      (v === 'dashboard' && key === 'overview') ||
      (v === 'settings' && key === 'settings') ||
      (v === 'history' && key === 'history') ||
      (v === 'report' && key === 'technical') ||
      (v === 'search-report' && key === 'search') ||
      (v === 'ai-report' && key === 'ai') ||
      (v === 'content-report' && key === 'content') ||
      (v === 'reddit-report' && key === 'reddit');
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
  } else if (v === 'report') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'Technical Health Report';
  } else if (v === 'search-report') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'Search Opportunities Report';
  } else if (v === 'ai-report') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'AI Visibility Report';
  } else if (v === 'content-report') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'Content Opportunities Report';
  } else if (v === 'reddit-report') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'Reddit Intelligence Report';
  } else if (v === 'history') {
    if (ctx) ctx.textContent = currentProject?.domain ?? 'Project';
    if (sep) sep.style.display = '';
    if (page) page.textContent = 'Usage & Scans';
  } else {
    if (ctx) ctx.textContent = 'Settings';
    if (sep) sep.style.display = 'none';
    if (page) page.textContent = '';
  }
  const divider = $('sidebar-project-divider');
  const pnav = $('sidebar-project-nav');
  if (divider) divider.style.display = (v === 'dashboard' || v === 'report' || v === 'search-report' || v === 'ai-report' || v === 'content-report' || v === 'reddit-report' || v === 'history') ? '' : 'none';
  if (pnav) pnav.style.display = (v === 'dashboard' || v === 'report' || v === 'search-report' || v === 'ai-report' || v === 'content-report' || v === 'reddit-report' || v === 'history') ? '' : 'none';
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
  else if (k === 'history' && currentProject) showView('history');
  else if (k === 'technical' && currentProject && currentCrawlId) {
    showView('report');
    window.history.replaceState({}, '', `/app?view=technical&crawlId=${currentCrawlId}`);
    void loadTechnicalReport(currentCrawlId);
  } else if (k === 'search' && currentProject && currentCrawlId) {
    showView('search-report');
    window.history.replaceState({}, '', `/app?view=search&crawlId=${currentCrawlId}`);
    void loadSearchReport(currentCrawlId);
  } else if (k === 'reddit' && currentProject && currentCrawlId) {
    showView('reddit-report');
    window.history.replaceState({}, '', `/app?view=reddit&crawlId=${currentCrawlId}`);
    void loadRedditReport(currentCrawlId);
  } else if (k === 'ai' && currentProject && currentCrawlId) {
    showView('ai-report');
    window.history.replaceState({}, '', `/app?view=ai&crawlId=${currentCrawlId}`);
    void loadAiReport(currentCrawlId);
  } else if (k === 'content' && currentProject && currentCrawlId) {
    showView('content-report');
    window.history.replaceState({}, '', `/app?view=content&crawlId=${currentCrawlId}`);
    void loadContentReport(currentCrawlId);
  }
  if (window.innerWidth < 1024) toggleSidebar();
}));
$('sidebar-logout-btn')?.addEventListener('click', () => void logout());
$('btn-settings-logout')?.addEventListener('click', () => void logout());
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const button = target.closest('#view-settings .btn-back-dashboard');

  if (button) {
    showView('dashboard');
    window.history.replaceState({}, '', '/app');
  }
});

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

// --- Full Technical Health Report ---
function goBackToDashboard() {
  if (currentProject) {
    showView('dashboard');
    window.history.replaceState({}, '', '/app');
  }
}

function reportPassFail(ok: boolean): string {
  return ok
    ? '<span class="inline-flex items-center gap-1 text-emerald-700 font-semibold"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Yes</span>'
    : '<span class="inline-flex items-center gap-1 text-rose-600 font-semibold"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> No</span>';
}

function reportMetric(label: string, value: string | number, sub?: string): string {
  return `<div class="flex flex-col gap-0.5"><span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${esc(label)}</span><span class="text-sm font-bold text-slate-800">${esc(String(value))}</span>${sub ? `<span class="text-[10px] text-slate-400">${esc(sub)}</span>` : ''}</div>`;
}

function severityBadge(sev: string): string {
  const cls = sev === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : sev === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200';
  return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${cls}">${esc(sev)}</span>`;
}

function proBoundary(title: string, description: string): string {
  return `
    <div class="bg-gradient-to-br from-slate-50 to-indigo-50 rounded-2xl border border-slate-200 border-dashed p-8 text-center mb-4">
      <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-100 mb-3">
        <svg class="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      </div>
      <h3 class="text-sm font-bold text-slate-900 mb-1">${esc(title)}</h3>
      <p class="text-xs text-slate-500 mb-4 max-w-md mx-auto">${esc(description)}</p>
      <a href="/pricing" class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors">Upgrade to Pro →</a>
    </div>`;
}

function renderFreeTechnicalReport(data: Record<string, any>) {
  const el = $('report-content');
  if (!el) return;

  const score = typeof data.healthScore === 'number' ? data.healthScore : 0;
  const counts = data.issueCounts ?? {};
  const issues = data.issues ?? [];
  const pages = data.pages ?? [];
  const crawl = data.crawl ?? {};
  const ps = data.pageStats ?? {};
  const hs = data.headingStats ?? {};
  const pf = data.performanceStats ?? {};
  const si = data.serverInfo ?? {};
  const tls = data.titleLengthStats ?? {};
  const mls = data.metaLengthStats ?? {};

  const total = ps.total ?? pages.length;
  const color = score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'rose';
  const errors = issues.filter((i: any) => i.severity === 'error').length;
  const warnings = issues.filter((i: any) => i.severity === 'warning').length;

  const pipelineTotal = total;
  const crawled = ps.http200 ?? pages.filter((p: any) => p.statusCode === 200).length;
  const indexable = ps.indexable ?? pages.filter((p: any) => p.isIndexable !== false).length;
  const withCanonical = ps.withCanonical ?? pages.filter((p: any) => p.canonicalUrl && p.canonicalUrl.trim() !== '').length;

  let html = '';

  // Header
  html += `<div class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Technical Health Report</h1>
      <p class="text-xs text-slate-400 mt-0.5">${esc(crawl.url ?? currentProject?.websiteUrl ?? '')}</p>
    </div>
    <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
  </div>`;

  // Section 1: Score Overview with Pipeline Funnel — VISIBLE
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <div class="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-5">
      <div class="flex items-center gap-4">
        <div class="relative w-20 h-20">
          <svg class="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
            <path class="text-slate-100" stroke-width="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="text-${color}-500" stroke-width="3" fill="none" stroke-dasharray="${score}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-2xl font-black text-${color}-600 leading-none">${score}</span>
            <span class="text-[8px] font-bold text-slate-400 mt-0.5">/ 100</span>
          </div>
        </div>
        <div>
          <div class="text-lg font-bold text-slate-900">${scoreLabel(score)}</div>
          <div class="text-xs text-slate-500">${total} pages crawled</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 text-xs">
        <div class="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"><span class="font-bold text-slate-800">${issues.length}</span> <span class="text-slate-500">issues</span></div>
        <div class="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200"><span class="font-bold text-rose-700">${errors}</span> <span class="text-rose-500">errors</span></div>
        <div class="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200"><span class="font-bold text-amber-700">${warnings}</span> <span class="text-amber-500">warnings</span></div>
      </div>
    </div>
    <div class="border-t border-slate-100 pt-4">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Crawl Pipeline</div>
      <div class="space-y-1.5">
        ${funnelBar('Discovered', pipelineTotal, pipelineTotal, 'slate')}
        ${funnelBar('HTTP 200', crawled, pipelineTotal, 'emerald')}
        ${funnelBar('Indexable', indexable, pipelineTotal, 'blue')}
        ${funnelBar('Has Canonical', withCanonical, pipelineTotal, 'violet')}
      </div>
    </div>
  </div>`;

  // Section 2: Priority Issues — VISIBLE (limited: no Why it matters / Recommended fix deep details)
  const sortedIssues = [...issues].sort((a: any, b: any) => {
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Priority Issues</h2>
    <div class="space-y-3">`;
  for (const issue of sortedIssues.slice(0, 5)) {
    const page = issue.pageId ? pages.find((p: any) => p.id === issue.pageId) : null;
    const pageUrl = page ? esc(page.url.replace(/^https?:\/\/[^/]+/, '')) : '';
    html += `<div class="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1.5">
            ${severityBadge(issue.severity)}
            <span class="text-sm font-semibold text-slate-800">${esc(issueLabels[issue.issueType] ?? issue.issueType)}</span>
          </div>
          <div class="space-y-1.5 text-xs">
            <p class="text-slate-700"><span class="font-semibold text-slate-800">What is wrong:</span> ${esc(issue.message)}</p>
            ${pageUrl ? `<p class="text-slate-600"><span class="font-semibold text-slate-800">Affected page:</span> <span class="font-mono text-slate-500">${pageUrl}</span></p>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }
  if (sortedIssues.length > 5) {
    html += `<div class="text-xs text-slate-400 text-center py-2">+ ${sortedIssues.length - 5} more issues</div>`;
  }
  html += `</div></div>`;

  // Section 3: Crawl & Indexability — BASIC SUMMARY VISIBLE
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Crawl &amp; Indexability</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Indexable</div>
        <div class="text-lg font-black text-emerald-600">${indexable}</div>
        <div class="text-[10px] text-slate-400">of ${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Non-Indexable</div>
        <div class="text-lg font-black ${(ps.nonIndexable ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${ps.nonIndexable ?? 0}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Noindex</div>
        <div class="text-lg font-black ${(counts.NOINDEX_PAGE ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${counts.NOINDEX_PAGE ?? 0}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Non-200</div>
        <div class="text-lg font-black ${(counts.NON_200_PAGE ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${counts.NON_200_PAGE ?? 0}</div>
      </div>
    </div>
  </div>`;

  // Section 4: Page Basics — BASIC SUMMARY VISIBLE (viewport, charset, favicon, lang locked to Pro)
  const pHttp200 = ps.http200 ?? pages.filter((p: any) => p.statusCode === 200).length;
  const pWithTitle = ps.withTitle ?? pages.filter((p: any) => p.title && p.title.trim() !== '').length;
  const pWithMeta = ps.withMeta ?? pages.filter((p: any) => p.metaDescription && p.metaDescription.trim() !== '').length;

  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Page Basics</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">HTTP Status 200</div>
        <div class="text-xs">${reportPassFail(pHttp200 === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pHttp200}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Title Tag</div>
        <div class="text-xs">${reportPassFail(pWithTitle === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithTitle}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Meta Description</div>
        <div class="text-xs">${reportPassFail(pWithMeta === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithMeta}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Canonical Tag</div>
        <div class="text-xs">${reportPassFail(withCanonical === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${withCanonical}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">HTTPS</div>
        <div class="text-xs">${reportPassFail(!(counts.MISSING_HTTPS > 0))}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">H1 Heading</div>
        <div class="text-xs">${reportPassFail((counts.MISSING_H1 ?? 0) === 0)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${hs.pagesWithH1 ?? 0}/${total} pages</div>
      </div>
    </div>
  </div>`;

  // Section 5: Crawl Signals — VISIBLE
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Crawl Signals</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
        <div class="text-xs font-bold text-slate-800 mb-1">robots.txt</div>
        <div class="text-xs">${crawl.robotsFound ? '<span class="text-emerald-600 font-semibold">Found</span>' : '<span class="text-rose-600 font-semibold">Missing</span>'}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
        <div class="text-xs font-bold text-slate-800 mb-1">XML Sitemap</div>
        <div class="text-xs">${crawl.sitemapFound ? '<span class="text-emerald-600 font-semibold">Found</span>' : '<span class="text-amber-600 font-semibold">Missing</span>'}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
        <div class="text-xs font-bold text-slate-800 mb-1">Server</div>
        <div class="text-xs text-slate-600">${si.servers.length > 0 ? esc(si.servers[0]) : '<span class="text-slate-400">Unknown</span>'}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center">
        <div class="text-xs font-bold text-slate-800 mb-1">CDN</div>
        <div class="text-xs text-slate-600">${si.cdns.length > 0 ? esc(si.cdns[0]) : '<span class="text-slate-400">None detected</span>'}</div>
      </div>
    </div>
  </div>`;

  // Section 6: Performance — BASIC SUMMARY VISIBLE
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Performance</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Avg Response</div>
        <div class="text-lg font-black text-slate-800">${pf.avgResponseTimeMs ?? 0}<span class="text-xs font-normal text-slate-400 ml-0.5">ms</span></div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Fastest</div>
        <div class="text-lg font-black text-slate-800">${pf.minResponseTimeMs ?? 0}<span class="text-xs font-normal text-slate-400 ml-0.5">ms</span></div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Slowest</div>
        <div class="text-lg font-black text-slate-800">${pf.maxResponseTimeMs ?? 0}<span class="text-xs font-normal text-slate-400 ml-0.5">ms</span></div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Slow Pages</div>
        <div class="text-lg font-black ${(pf.slowPages ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${pf.slowPages ?? 0}</div>
      </div>
    </div>
  </div>`;

  // Pro boundary 1: Deeper diagnostics
  html += proBoundary(
    'Unlock the complete technical diagnosis',
    'See page-level metadata, canonicalization, architecture, accessibility, content quality and performance analysis with Pro.'
  );

  // Section 7: Recommended Action Plan — VISIBLE but limited
  const highCount = issues.filter((i: any) => i.severity === 'error').length;
  const warnCount = issues.filter((i: any) => i.severity === 'warning').length;
  if (highCount > 0 || warnCount > 0) {
    html += `<div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 shadow-sm p-6 mb-4">
      <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Recommended Action Plan</h2>
      <p class="text-sm text-slate-700 mb-2"><span class="font-bold text-slate-900">${highCount + warnCount}</span> technical issues require attention.</p>
      <p class="text-xs text-slate-500 mb-4">Unlock the complete action plan to see exactly what to fix, affected pages, priority and recommended fixes.</p>
      <a href="/pricing" class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors">Upgrade to Pro →</a>
    </div>`;
  }

  // Pro boundary 2: Full action plan
  html += proBoundary(
    'Go beyond detection → get page-level analysis, visual diagnostics and prioritized fixes',
    'The complete action plan shows affected pages, priority ranking, and step-by-step recommended fixes for every issue found.'
  );

  el.innerHTML = html;
  el.classList.remove('hidden');
  $('report-loading')?.classList.add('hidden');

  el.querySelector('.btn-back-dashboard')?.addEventListener('click', () => { showView('dashboard'); window.history.replaceState({}, '', '/app'); });
}

function renderTechnicalReport(data: Record<string, any>) {
  const plan = data.plan ?? 'free';
  if (plan !== 'pro') {
    renderFreeTechnicalReport(data);
    return;
  }

  const el = $('report-content');
  if (!el) return;

  const score = typeof data.healthScore === 'number' ? data.healthScore : 0;
  const counts = data.issueCounts ?? {};
  const issues = data.issues ?? [];
  const pages = data.pages ?? [];
  const crawl = data.crawl ?? {};
  const ps = data.pageStats ?? {};
  const hs = data.headingStats ?? {};
  const is = data.imageStats ?? {};
  const sd = data.structuredDataStats ?? {};
  const ss = data.socialStats ?? {};
  const pf = data.performanceStats ?? {};
  const http = data.httpStatusDistribution ?? {};
  const si = data.serverInfo ?? {};
  const tls = data.titleLengthStats ?? {};
  const mls = data.metaLengthStats ?? {};
  const wcs = data.wordCountStats ?? {};
  const ilks = data.internalLinkStats ?? {};

  const total = ps.total ?? pages.length;
  const color = score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'rose';
  const errors = issues.filter((i: any) => i.severity === 'error').length;
  const warnings = issues.filter((i: any) => i.severity === 'warning').length;

  let html = '';

  // Header
  html += `<div class="flex items-center gap-3 mb-6">
    <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
    <div>
      <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Technical Health Report</h1>
      <p class="text-xs text-slate-400 mt-0.5">${esc(crawl.url ?? currentProject?.websiteUrl ?? '')}</p>
    </div>
  </div>`;

  // Section 1: Score Overview with Pipeline Funnel
  const pipelineTotal = total;
  const crawled = ps.http200 ?? pages.filter((p: any) => p.statusCode === 200).length;
  const indexable = ps.indexable ?? pages.filter((p: any) => p.isIndexable !== false).length;
  const withCanonical = ps.withCanonical ?? pages.filter((p: any) => p.canonicalUrl && p.canonicalUrl.trim() !== '').length;

  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <div class="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-5">
      <div class="flex items-center gap-4">
        <div class="relative w-20 h-20">
          <svg class="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
            <path class="text-slate-100" stroke-width="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="text-${color}-500" stroke-width="3" fill="none" stroke-dasharray="${score}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-2xl font-black text-${color}-600 leading-none">${score}</span>
            <span class="text-[8px] font-bold text-slate-400 mt-0.5">/ 100</span>
          </div>
        </div>
        <div>
          <div class="text-lg font-bold text-slate-900">${scoreLabel(score)}</div>
          <div class="text-xs text-slate-500">${total} pages crawled</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 text-xs">
        <div class="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"><span class="font-bold text-slate-800">${issues.length}</span> <span class="text-slate-500">issues</span></div>
        <div class="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200"><span class="font-bold text-rose-700">${errors}</span> <span class="text-rose-500">errors</span></div>
        <div class="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200"><span class="font-bold text-amber-700">${warnings}</span> <span class="text-amber-500">warnings</span></div>
      </div>
    </div>
    <div class="border-t border-slate-100 pt-4">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Crawl Pipeline</div>
      <div class="space-y-1.5">
        ${funnelBar('Discovered', pipelineTotal, pipelineTotal, 'slate')}
        ${funnelBar('HTTP 200', crawled, pipelineTotal, 'emerald')}
        ${funnelBar('Indexable', indexable, pipelineTotal, 'blue')}
        ${funnelBar('Has Canonical', withCanonical, pipelineTotal, 'violet')}
      </div>
    </div>
  </div>`;

  // Section 2: Priority Issues + Issue Type Distribution
  const issueDetails: Record<string, { whyItMatters: string; recommendedFix: string }> = {
    MISSING_TITLE: { whyItMatters: 'Title tags are the most important on-page SEO element. They tell search engines what the page is about and appear as the clickable headline in search results.', recommendedFix: 'Add a unique, descriptive title tag to each page. Include your primary keyword and keep it between 30-60 characters.' },
    TITLE_TOO_SHORT: { whyItMatters: 'Short titles may provide insufficient context to search engines and miss opportunities to include relevant keywords.', recommendedFix: 'Expand the title to 30-60 characters. Include the primary keyword and a compelling reason to click.' },
    TITLE_TOO_LONG: { whyItMatters: 'Titles over 60 characters may be truncated in search results, cutting off important information.', recommendedFix: 'Shorten the title to under 60 characters while keeping the primary keyword and main value proposition.' },
    MISSING_META_DESCRIPTION: { whyItMatters: 'Meta descriptions appear below your title in search results. Missing descriptions mean search engines generate their own, which may not accurately represent your page.', recommendedFix: 'Write a compelling 120-160 character meta description that includes your target keyword and a call to action.' },
    DUPLICATE_TITLE: { whyItMatters: 'When multiple pages have the same title, search engines struggle to determine which page to rank for that topic.', recommendedFix: 'Create unique, descriptive titles for each page that clearly differentiate their content.' },
    DUPLICATE_META_DESCRIPTION: { whyItMatters: 'Duplicate meta descriptions reduce the effectiveness of your search listings and can cause pages to compete against each other.', recommendedFix: 'Write unique meta descriptions for each page that accurately summarize the page content.' },
    MISSING_CANONICAL: { whyItMatters: 'Without canonical tags, search engines may index duplicate versions of the same page, diluting your SEO authority.', recommendedFix: 'Add a canonical tag pointing to the preferred URL for each page.' },
    NOINDEX_PAGE: { whyItMatters: 'Pages with noindex directives will not appear in search results, which may be intentional but could also hide important content.', recommendedFix: 'Review the page to ensure it should be noindexed. Remove the noindex directive if the page should be discoverable.' },
    BROKEN_INTERNAL_LINK: { whyItMatters: 'Broken links create poor user experiences and prevent search engines from discovering and indexing your content.', recommendedFix: 'Fix or remove the broken link. Update it to point to a valid page or remove it if the destination no longer exists.' },
    NON_200_PAGE: { whyItMatters: 'Pages returning non-200 status codes may not be indexed and can signal technical problems to search engines.', recommendedFix: 'Investigate why the page returns a non-200 status. Fix server errors or redirect broken pages.' },
    MISSING_ROBOTS_TXT: { whyItMatters: 'Without a robots.txt file, search engines crawl your entire site without guidance, potentially wasting crawl budget.', recommendedFix: 'Create a robots.txt file that guides search engines to important pages and away from unimportant ones.' },
    MISSING_SITEMAP: { whyItMatters: 'XML sitemaps help search engines discover all your pages, especially those not linked internally.', recommendedFix: 'Create and submit an XML sitemap to Google Search Console and Bing Webmaster Tools.' },
    MISSING_HTTPS: { whyItMatters: 'HTTPS is a ranking factor and builds trust with users. HTTP sites may be flagged as "Not Secure" in browsers.', recommendedFix: 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.' },
    MISSING_H1: { whyItMatters: 'H1 headings help search engines understand the main topic of the page and improve content structure.', recommendedFix: 'Add one H1 heading per page that clearly describes the page content and includes your primary keyword.' },
    DUPLICATE_H1: { whyItMatters: 'Multiple H1 headings can confuse search engines about the main topic of the page.', recommendedFix: 'Use only one H1 heading per page. Convert additional H1s to H2 or H3 headings.' },
    IMAGES_MISSING_ALT: { whyItMatters: 'Missing alt text hurts accessibility and prevents images from appearing in image search results.', recommendedFix: 'Add descriptive alt text to all images. Include relevant keywords where appropriate.' },
    MISSING_OG_TAGS: { whyItMatters: 'Open Graph tags control how your page appears when shared on social media platforms like Facebook and LinkedIn.', recommendedFix: 'Add og:title, og:description, and og:image tags to control your social media appearance.' },
    MISSING_TWITTER_TAGS: { whyItMatters: 'Twitter Card tags control how your page appears when shared on Twitter/X.', recommendedFix: 'Add twitter:card, twitter:title, and twitter:description tags for optimal Twitter sharing.' },
    MISSING_VIEWPORT: { whyItMatters: 'Without a viewport meta tag, your site may not render correctly on mobile devices, affecting mobile-first indexing.', recommendedFix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head of each page.' },
    MISSING_CHARSET: { whyItMatters: 'Without a charset declaration, browsers may misinterpret text encoding, causing display issues.', recommendedFix: 'Add <meta charset="utf-8"> as the first element in the head of each page.' },
    MISSING_FAVICON: { whyItMatters: 'Missing favicons look unprofessional and browsers show a generic icon in tabs and bookmarks.', recommendedFix: 'Add a <link rel="icon" href="/favicon.ico"> tag to the head of each page.' },
    MISSING_HTML_LANG: { whyItMatters: 'The lang attribute helps screen readers and search engines understand the page language, affecting accessibility and regional targeting.', recommendedFix: 'Add lang="en" (or appropriate language code) to the <html> element.' },
    THIN_CONTENT: { whyItMatters: 'Pages with very little content provide limited value to users and may struggle to rank in search results.', recommendedFix: 'Expand thin pages with comprehensive, helpful content that addresses the page topic thoroughly.' },
    SLOW_RESPONSE: { whyItMatters: 'Slow server responses waste crawl budget and degrade user experience, both of which affect search rankings.', recommendedFix: 'Investigate server performance. Consider caching, CDN, or upgrading hosting infrastructure.' },
  };

  const sortedIssues = [...issues].sort((a: any, b: any) => {
    const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  // Issue type distribution chart
  const issueTypeCounts: Record<string, number> = {};
  for (const issue of issues) {
    issueTypeCounts[issue.issueType] = (issueTypeCounts[issue.issueType] ?? 0) + 1;
  }
  const sortedIssueTypes = Object.entries(issueTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxIssueCount = sortedIssueTypes.length > 0 ? sortedIssueTypes[0][1] : 1;

  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Priority Issues</h2>`;
  if (sortedIssueTypes.length > 0) {
    html += `<div class="mb-5">${barChartH(
      sortedIssueTypes.map(([type, count]) => ({
        label: issueLabels[type] ?? type,
        value: count,
        color: (issues.find((i: any) => i.issueType === type)?.severity === 'error') ? 'rose' : (issues.find((i: any) => i.issueType === type)?.severity === 'warning') ? 'amber' : 'blue',
      })),
      maxIssueCount,
    )}</div>`;
  }
  html += `<div class="space-y-3">`;
  for (const issue of sortedIssues.slice(0, 10)) {
    const page = issue.pageId ? pages.find((p: any) => p.id === issue.pageId) : null;
    const pageUrl = page ? esc(page.url.replace(/^https?:\/\/[^/]+/, '')) : '';
    const details = issueDetails[issue.issueType];
    html += `<div class="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1.5">
            ${severityBadge(issue.severity)}
            <span class="text-sm font-semibold text-slate-800">${esc(issueLabels[issue.issueType] ?? issue.issueType)}</span>
          </div>
          <div class="space-y-1.5 text-xs">
            <p class="text-slate-700"><span class="font-semibold text-slate-800">What is wrong:</span> ${esc(issue.message)}</p>
            ${pageUrl ? `<p class="text-slate-600"><span class="font-semibold text-slate-800">Affected page:</span> <span class="font-mono text-slate-500">${pageUrl}</span></p>` : ''}
            ${details ? `
            <p class="text-slate-600"><span class="font-semibold text-slate-800">Why it matters:</span> ${esc(details.whyItMatters)}</p>
            <p class="text-blue-600"><span class="font-semibold text-blue-700">Recommended fix:</span> ${esc(details.recommendedFix)}</p>
            ` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }
  if (sortedIssues.length > 10) {
    html += `<div class="text-xs text-slate-400 text-center py-2">+ ${sortedIssues.length - 10} more issues</div>`;
  }
  html += `</div></div>`;

  // Section 3: Crawl & Indexability
  const httpKeys = Object.keys(http).sort();
  const httpMax = Math.max(...Object.values(http).map(Number), 1);
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Crawl &amp; Indexability</h2>`;
  if (httpKeys.length > 0) {
    html += `<div class="mb-4">${barChartH(
      httpKeys.map(code => ({
        label: `HTTP ${code}`,
        value: (http as Record<string, number>)[code],
        color: code.startsWith('2') ? 'emerald' : code.startsWith('3') ? 'blue' : code.startsWith('4') ? 'amber' : 'rose',
      })),
      httpMax,
    )}</div>`;
  }
  html += `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Indexable</div>
      <div class="text-lg font-black text-emerald-600">${indexable}</div>
      <div class="text-[10px] text-slate-400">of ${total} pages</div>
    </div>
    <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Non-Indexable</div>
      <div class="text-lg font-black ${(ps.nonIndexable ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${ps.nonIndexable ?? 0}</div>
    </div>
    <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Noindex</div>
      <div class="text-lg font-black ${(counts.NOINDEX_PAGE ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${counts.NOINDEX_PAGE ?? 0}</div>
    </div>
    <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Non-200</div>
      <div class="text-lg font-black ${(counts.NON_200_PAGE ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${counts.NON_200_PAGE ?? 0}</div>
    </div>
  </div></div>`;

  // Section 4: Page Basics
  const pHttp200 = ps.http200 ?? pages.filter((p: any) => p.statusCode === 200).length;
  const pWithTitle = ps.withTitle ?? pages.filter((p: any) => p.title && p.title.trim() !== '').length;
  const pWithMeta = ps.withMeta ?? pages.filter((p: any) => p.metaDescription && p.metaDescription.trim() !== '').length;
  const pWithViewport = ps.withViewport ?? 0;
  const pWithCharset = ps.withCharset ?? 0;
  const pWithFavicon = ps.withFavicon ?? 0;
  const pWithLang = ps.withLang ?? 0;

  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Page Basics</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">HTTP Status 200</div>
        <div class="text-xs">${reportPassFail(pHttp200 === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pHttp200}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Title Tag</div>
        <div class="text-xs">${reportPassFail(pWithTitle === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithTitle}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Meta Description</div>
        <div class="text-xs">${reportPassFail(pWithMeta === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithMeta}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Canonical Tag</div>
        <div class="text-xs">${reportPassFail(withCanonical === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${withCanonical}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">HTTPS</div>
        <div class="text-xs">${reportPassFail(!(counts.MISSING_HTTPS > 0))}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">H1 Heading</div>
        <div class="text-xs">${reportPassFail((counts.MISSING_H1 ?? 0) === 0)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${hs.pagesWithH1 ?? 0}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Viewport</div>
        <div class="text-xs">${reportPassFail(pWithViewport === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithViewport}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Charset</div>
        <div class="text-xs">${reportPassFail(pWithCharset === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithCharset}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Favicon</div>
        <div class="text-xs">${reportPassFail(pWithFavicon === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithFavicon}/${total} pages</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Lang Attribute</div>
        <div class="text-xs">${reportPassFail(pWithLang === total)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${pWithLang}/${total} pages</div>
      </div>
    </div>
  </div>`;

  // Section 5: Metadata Health
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Metadata Health</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Title Coverage</div>
        ${donutChart([
          { value: total - (tls.missing ?? 0), color: 'emerald', label: 'Has title' },
          { value: tls.missing ?? 0, color: 'rose', label: 'Missing' },
        ])}
        <div class="mt-2 space-y-0.5 text-[10px] text-slate-500">
          <div>Avg length: <span class="font-semibold text-slate-700">${tls.avg ?? 0} chars</span></div>
          <div>Too short (&lt;30): <span class="font-semibold text-amber-600">${tls.tooShort ?? 0}</span></div>
          <div>Too long (&gt;60): <span class="font-semibold text-amber-600">${tls.tooLong ?? 0}</span></div>
        </div>
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Meta Description Coverage</div>
        ${donutChart([
          { value: total - (mls.missing ?? 0), color: 'emerald', label: 'Has meta' },
          { value: mls.missing ?? 0, color: 'rose', label: 'Missing' },
        ])}
        <div class="mt-2 space-y-0.5 text-[10px] text-slate-500">
          <div>Avg length: <span class="font-semibold text-slate-700">${mls.avg ?? 0} chars</span></div>
          <div>Missing: <span class="font-semibold text-rose-600">${mls.missing ?? 0}</span></div>
        </div>
      </div>
    </div>
    <div class="mt-4 border-t border-slate-100 pt-4">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Metadata Quality</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="bg-slate-50 rounded-xl p-2 border border-slate-200 text-center">
          <div class="text-lg font-black ${(counts.MISSING_TITLE ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${counts.MISSING_TITLE ?? 0}</div>
          <div class="text-[9px] text-slate-400">Missing Titles</div>
        </div>
        <div class="bg-slate-50 rounded-xl p-2 border border-slate-200 text-center">
          <div class="text-lg font-black ${(counts.DUPLICATE_TITLE ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${counts.DUPLICATE_TITLE ?? 0}</div>
          <div class="text-[9px] text-slate-400">Duplicate Titles</div>
        </div>
        <div class="bg-slate-50 rounded-xl p-2 border border-slate-200 text-center">
          <div class="text-lg font-black ${(counts.MISSING_META_DESCRIPTION ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${counts.MISSING_META_DESCRIPTION ?? 0}</div>
          <div class="text-[9px] text-slate-400">Missing Meta Desc.</div>
        </div>
        <div class="bg-slate-50 rounded-xl p-2 border border-slate-200 text-center">
          <div class="text-lg font-black ${(counts.DUPLICATE_META_DESCRIPTION ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${counts.DUPLICATE_META_DESCRIPTION ?? 0}</div>
          <div class="text-[9px] text-slate-400">Duplicate Meta Desc.</div>
        </div>
      </div>
    </div>
  </div>`;

  // Section 6: Canonicalization
  const canonicalCoverage = total > 0 ? Math.round((withCanonical / total) * 100) : 0;
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Canonicalization</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Has Canonical</div>
        <div class="text-lg font-black text-emerald-600">${withCanonical}</div>
        <div class="text-[10px] text-slate-400">${canonicalCoverage}% coverage</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Missing Canonical</div>
        <div class="text-lg font-black ${(total - withCanonical) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${total - withCanonical}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Noindex + Canonical</div>
        <div class="text-lg font-black text-slate-800">${(counts.NOINDEX_PAGE ?? 0) > 0 && (counts.MISSING_CANONICAL ?? 0) < total ? 'Conflict' : 'None'}</div>
      </div>
    </div>
    <div class="mt-3">${coveragePill('Canonical tag coverage', withCanonical, total)}</div>
  </div>`;

  // Section 7: Crawl Signals
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Crawl Signals</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">robots.txt</div>
        <div class="text-xs">${reportPassFail(!!crawl.robotsFound)}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">XML Sitemap</div>
        <div class="text-xs">${reportPassFail(!!crawl.sitemapFound)}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Server</div>
        <div class="text-xs font-semibold text-slate-700">${si.servers?.length ? esc(si.servers.join(', ')) : '<span class="text-slate-400">Unknown</span>'}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">CDN</div>
        <div class="text-xs font-semibold text-slate-700">${si.cdns?.length ? esc(si.cdns.join(', ')) : '<span class="text-slate-400">None detected</span>'}</div>
      </div>
    </div>
  </div>`;

  // Section 8: Site Architecture / Internal Linking
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Site Architecture</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Avg Links/Page</div>
        <div class="text-lg font-black text-slate-800">${ilks.avgLinks ?? 0}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Zero Links</div>
        <div class="text-lg font-black ${(ilks.pagesWithZeroLinks ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${ilks.pagesWithZeroLinks ?? 0}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Few Links (&lt;3)</div>
        <div class="text-lg font-black ${(ilks.pagesWithFewLinks ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${ilks.pagesWithFewLinks ?? 0}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Broken Links</div>
        <div class="text-lg font-black ${(counts.BROKEN_INTERNAL_LINK ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${counts.BROKEN_INTERNAL_LINK ?? 0}</div>
      </div>
    </div>
  </div>`;

  // Section 9: Heading Hierarchy
  if (hs.totalH1 !== undefined) {
    const headingData = [
      { label: 'H1', value: hs.totalH1 ?? 0, color: 'blue' },
      { label: 'H2', value: hs.totalH2 ?? 0, color: 'indigo' },
      { label: 'H3', value: hs.totalH3 ?? 0, color: 'violet' },
      { label: 'H4', value: hs.totalH4 ?? 0, color: 'purple' },
      { label: 'H5', value: hs.totalH5 ?? 0, color: 'pink' },
      { label: 'H6', value: hs.totalH6 ?? 0, color: 'rose' },
    ];
    const hMax = Math.max(...headingData.map(d => d.value), 1);
    html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
      <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Heading Hierarchy</h2>
      ${barChartH(headingData, hMax)}
      <div class="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span>${hs.pagesWithH1 ?? 0} pages with H1</span>
        <span>·</span>
        <span>${hs.pagesWithMultipleH1 ?? 0} pages with multiple H1s</span>
      </div>
    </div>`;
  }

  // Section 10: Images & Accessibility
  const imgTotal = is.totalImages ?? 0;
  const imgMissing = is.totalMissingAlt ?? 0;
  const imgCoverage = imgTotal > 0 ? Math.round(((imgTotal - imgMissing) / imgTotal) * 100) : 100;
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Images &amp; Accessibility</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Total Images</div>
        <div class="text-lg font-black text-slate-800">${imgTotal}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Missing Alt</div>
        <div class="text-lg font-black ${imgMissing > 0 ? 'text-rose-600' : 'text-emerald-600'}">${imgMissing}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Alt Coverage</div>
        <div class="text-lg font-black ${imgCoverage >= 80 ? 'text-emerald-600' : 'text-amber-600'}">${imgCoverage}%</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Structured Data</div>
        <div class="text-lg font-black text-slate-800">${sd.totalJsonLdBlocks ?? 0}</div>
        <div class="text-[10px] text-slate-400">${(sd.schemaTypes ?? []).length} type${(sd.schemaTypes ?? []).length === 1 ? '' : 's'}</div>
      </div>
    </div>
    ${(sd.schemaTypes ?? []).length > 0 ? `<div class="text-[10px] text-slate-500"><span class="font-semibold">Schema types:</span> ${esc(sd.schemaTypes.join(', '))}</div>` : ''}
  </div>`;

  // Section 11: Social Metadata
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Social Metadata</h2>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Open Graph</div>
        ${coveragePill('OG Title/Description', ss.pagesWithOgTags ?? 0, total)}
        ${coveragePill('OG Image', ss.pagesWithOgImage ?? 0, total)}
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Twitter Card</div>
        ${coveragePill('Twitter Card Tags', ss.pagesWithTwitterTags ?? 0, total)}
        ${coveragePill('Twitter Image', ss.pagesWithTwitterImage ?? 0, total)}
      </div>
    </div>
  </div>`;

  // Section 12: Content Quality
  const titleIssues = (counts.TITLE_TOO_SHORT ?? 0) + (counts.TITLE_TOO_LONG ?? 0);
  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Content Quality</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Title Issues</div>
        <div class="text-lg font-black ${titleIssues > 0 ? 'text-amber-600' : 'text-emerald-600'}">${titleIssues}</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Thin Content</div>
        <div class="text-lg font-black ${(wcs.thin ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}">${wcs.thin ?? 0}</div>
        <div class="text-[10px] text-slate-400">&lt; 300 words</div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Avg Word Count</div>
        <div class="text-lg font-black text-slate-800">${wcs.avg ?? pf.avgWordCount ?? 0}</div>
      </div>
    </div>
    <div class="text-[10px] text-slate-500">
      <span class="font-semibold">Word count range:</span> ${wcs.min ?? 0} – ${wcs.max ?? 0} words
      ${wcs.zeroWords ? ` · <span class="text-amber-600">${wcs.zeroWords} pages with zero words</span>` : ''}
    </div>
  </div>`;

  // Section 13: Performance
  const rtDist = pf.responseTimeDistribution ?? {};
  const rtBuckets = [
    { label: '<500ms', value: rtDist.under500 ?? 0, color: 'emerald' },
    { label: '500-1s', value: rtDist['500to1000'] ?? 0, color: 'blue' },
    { label: '1-2s', value: rtDist['1000to2000'] ?? 0, color: 'amber' },
    { label: '2-3s', value: rtDist['2000to3000'] ?? 0, color: 'orange' },
    { label: '>3s', value: rtDist.over3000 ?? 0, color: 'rose' },
  ];
  const rtMax = Math.max(...rtBuckets.map(b => b.value), 1);

  html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
    <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Performance</h2>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Avg Response</div>
        <div class="text-lg font-black text-slate-800">${pf.avgResponseTimeMs ?? 0}<span class="text-xs font-normal text-slate-400 ml-0.5">ms</span></div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Slowest</div>
        <div class="text-lg font-black text-slate-800">${pf.maxResponseTimeMs ?? 0}<span class="text-xs font-normal text-slate-400 ml-0.5">ms</span></div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Fastest</div>
        <div class="text-lg font-black text-slate-800">${pf.minResponseTimeMs ?? 0}<span class="text-xs font-normal text-slate-400 ml-0.5">ms</span></div>
      </div>
      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Slow Pages</div>
        <div class="text-lg font-black ${(pf.slowPages ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}">${pf.slowPages ?? 0}</div>
        <div class="text-[10px] text-slate-400">&gt; 3000ms</div>
      </div>
    </div>
    <div class="border-t border-slate-100 pt-4">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Response Time Distribution</div>
      ${barChartH(rtBuckets, rtMax)}
    </div>
  </div>`;

  // Section 14: Affected Pages
  const pageIssues: Record<string, { url: string; issues: any[] }> = {};
  for (const issue of issues) {
    if (!issue.pageId) continue;
    if (!pageIssues[issue.pageId]) {
      const page = pages.find((p: any) => p.id === issue.pageId);
      pageIssues[issue.pageId] = { url: page?.url ?? 'Unknown', issues: [] };
    }
    pageIssues[issue.pageId].issues.push(issue);
  }
  const pageEntries = Object.entries(pageIssues).sort((a, b) => b[1].issues.length - a[1].issues.length);
  if (pageEntries.length > 0) {
    html += `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
      <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Affected Pages</h2>
      <div class="space-y-2">`;
    for (const [pageId, { url, issues: pageIssueList }] of pageEntries.slice(0, 15)) {
      const errCount = pageIssueList.filter((i: any) => i.severity === 'error').length;
      const warnCount = pageIssueList.filter((i: any) => i.severity === 'warning').length;
      html += `<div class="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-slate-600 truncate">${esc(url)}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${errCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-bold">${errCount} err</span>` : ''}
          ${warnCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold">${warnCount} warn</span>` : ''}
          <span class="text-[10px] font-bold text-slate-400">${pageIssueList.length} total</span>
        </div>
      </div>`;
    }
    if (pageEntries.length > 15) {
      html += `<div class="text-xs text-slate-400 text-center py-2">+ ${pageEntries.length - 15} more pages</div>`;
    }
    html += `</div></div>`;
  }

  // Section 15: Recommended Action Plan
  const highPriority: { issue: string; affected: string; whyItMatters: string; fix: string }[] = [];
  const mediumPriority: { issue: string; affected: string; whyItMatters: string; fix: string }[] = [];
  const lowPriority: { issue: string; affected: string; whyItMatters: string; fix: string }[] = [];

  const issueGroups: Record<string, { count: number; pages: string[]; severity: string }> = {};
  for (const issue of issues) {
    if (!issueGroups[issue.issueType]) {
      issueGroups[issue.issueType] = { count: 0, pages: [], severity: issue.severity };
    }
    issueGroups[issue.issueType].count++;
    if (issue.pageId) {
      const page = pages.find((p: any) => p.id === issue.pageId);
      if (page) {
        const path = page.url.replace(/^https?:\/\/[^/]+/, '');
        if (!issueGroups[issue.issueType].pages.includes(path)) {
          issueGroups[issue.issueType].pages.push(path);
        }
      }
    }
  }

  for (const [issueType, group] of Object.entries(issueGroups)) {
    const details = issueDetails[issueType];
    const label = issueLabels[issueType] ?? issueType;
    const affected = group.pages.length > 0
      ? `${group.count} issue${group.count > 1 ? 's' : ''} on ${group.pages.length} page${group.pages.length > 1 ? 's' : ''}`
      : `${group.count} site-wide issue${group.count > 1 ? 's' : ''}`;
    const item = { issue: label, affected, whyItMatters: details?.whyItMatters ?? '', fix: details?.recommendedFix ?? '' };
    if (group.severity === 'error') highPriority.push(item);
    else if (group.severity === 'warning') mediumPriority.push(item);
    else lowPriority.push(item);
  }

  if (highPriority.length > 0 || mediumPriority.length > 0 || lowPriority.length > 0) {
    html += `<div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 shadow-sm p-6 mb-4">
      <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Recommended Action Plan</h2>
      <div class="space-y-4">`;

    for (const [tier, items, badgeCls, iconColor] of [
      ['HIGH PRIORITY', highPriority, 'bg-rose-100 text-rose-700 border-rose-200', 'rose'] as const,
      ['MEDIUM PRIORITY', mediumPriority, 'bg-amber-100 text-amber-700 border-amber-200', 'amber'] as const,
      ['LOW PRIORITY', lowPriority, 'bg-blue-100 text-blue-700 border-blue-200', 'blue'] as const,
    ]) {
      if (items.length === 0) continue;
      html += `<div>
        <div class="flex items-center gap-2 mb-2">
          <span class="px-2 py-0.5 rounded-full ${badgeCls} text-[10px] font-bold border">${tier}</span>
          <span class="text-xs text-slate-500">${items.length} action${items.length > 1 ? 's' : ''}</span>
        </div>
        <div class="space-y-2">`;
      for (const item of items) {
        html += `<div class="bg-white rounded-xl p-3 border border-${iconColor}-200">
          <div class="flex items-start gap-2">
            <svg class="w-4 h-4 text-${iconColor}-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold text-slate-800">${esc(item.issue)}</div>
              <div class="text-[10px] text-slate-500 mt-0.5">${esc(item.affected)}</div>
              <div class="text-[10px] text-slate-600 mt-1">${esc(item.whyItMatters)}</div>
              <div class="text-[10px] text-blue-600 mt-1 font-medium">${esc(item.fix)}</div>
            </div>
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div></div>`;
  }

  el.innerHTML = html;
  el.classList.remove('hidden');
  $('report-loading')?.classList.add('hidden');

  el.querySelector('.btn-back-dashboard')?.addEventListener('click', () => { showView('dashboard'); window.history.replaceState({}, '', '/app'); });
}

async function loadTechnicalReport(crawlId: string) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (content) content.classList.add('hidden');

  try {
    const r = await apiFetch(`/api/crawls/${crawlId}/results`);
    if (!r.ok) throw await beErr(r);
    const data = await r.json();
    renderTechnicalReport(data);
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    if (error) {
      error.classList.remove('hidden');
      const msg = $('report-error-msg');
      if (msg) msg.textContent = e instanceof Error ? e.message : 'Failed to load report.';
    }
  }
}

// --- Search Opportunities Report ---

const oppTypeLabels: Record<string, string> = {
  CONTENT_GAP: 'Content Gap',
  WEAK_TOPIC_COVERAGE: 'Weak Coverage',
  EXISTING_PAGE_OPTIMIZATION: 'Page Optimization',
  INTERNAL_LINK_OPPORTUNITY: 'Internal Link',
  SEARCH_INTENT_GAP: 'Intent Gap',
};

const intentLabels: Record<string, string> = {
  informational: 'Informational',
  commercial: 'Commercial',
  transactional: 'Transactional',
  navigational: 'Navigational',
};

const coverageLabels: Record<string, string> = {
  GAP: 'No coverage',
  IMPROVEMENT: 'Needs improvement',
  EXISTING: 'Covered',
};

function oppPriorityColor(p: string): string {
  if (p === 'high') return 'rose';
  if (p === 'medium') return 'amber';
  return 'slate';
}

function oppTypeColor(t: string): string {
  if (t === 'CONTENT_GAP') return '#ef4444';
  if (t === 'WEAK_TOPIC_COVERAGE') return '#f59e0b';
  if (t === 'EXISTING_PAGE_OPTIMIZATION') return '#3b82f6';
  if (t === 'INTERNAL_LINK_OPPORTUNITY') return '#8b5cf6';
  if (t === 'SEARCH_INTENT_GAP') return '#10b981';
  return '#6b7280';
}

function oppIntentIcon(i: string): string {
  if (i === 'commercial') return '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>';
  if (i === 'transactional') return '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>';
  if (i === 'navigational') return '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>';
  return '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>';
}

function oppTypeIcon(t: string): string {
  if (t === 'CONTENT_GAP') return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
  if (t === 'WEAK_TOPIC_COVERAGE') return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>';
  if (t === 'EXISTING_PAGE_OPTIMIZATION') return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>';
  if (t === 'INTERNAL_LINK_OPPORTUNITY') return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>';
  return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>';
}

function oppActionLabel(t: string): string {
  if (t === 'CONTENT_GAP') return 'CREATE NEW CONTENT';
  if (t === 'WEAK_TOPIC_COVERAGE') return 'EXPAND EXISTING PAGE';
  if (t === 'EXISTING_PAGE_OPTIMIZATION') return 'IMPROVE EXISTING PAGE';
  if (t === 'INTERNAL_LINK_OPPORTUNITY') return 'ADD INTERNAL LINKS';
  if (t === 'SEARCH_INTENT_GAP') return 'IMPROVE SEARCH INTENT';
  return 'REVIEW';
}

function oppActionColor(t: string): string {
  if (t === 'CONTENT_GAP') return 'bg-red-50 text-red-700 border-red-200';
  if (t === 'WEAK_TOPIC_COVERAGE') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (t === 'EXISTING_PAGE_OPTIMIZATION') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (t === 'INTERNAL_LINK_OPPORTUNITY') return 'bg-violet-50 text-violet-700 border-violet-200';
  if (t === 'SEARCH_INTENT_GAP') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function opportunityDetailHtml(o: any): string {
  const ev = o.evidence ?? {};
  const sourcePages: Array<{ url: string; id: string | null }> = ev.sourcePages ?? [];
  const phrases: string[] = ev.sourcePhrases ?? [];
  const gsc = o.gsc ?? null;

  let gscHtml = '';
  if (gsc && gsc.status === 'ok') {
    gscHtml = `
      <div class="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Google Search Console Data</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><div class="text-lg font-bold text-slate-800">${gsc.clicks.toLocaleString()}</div><div class="text-[10px] text-slate-500">Clicks (28d)</div></div>
          <div><div class="text-lg font-bold text-slate-800">${gsc.impressions.toLocaleString()}</div><div class="text-[10px] text-slate-500">Impressions (28d)</div></div>
          <div><div class="text-lg font-bold text-slate-800">${(gsc.ctr * 100).toFixed(1)}%</div><div class="text-[10px] text-slate-500">CTR</div></div>
          <div><div class="text-lg font-bold text-slate-800">${gsc.position.toFixed(1)}</div><div class="text-[10px] text-slate-500">Avg. Position</div></div>
        </div>
        ${gsc.queries.length > 0 ? `<div class="mt-2 text-[10px] text-slate-500">Matched queries: ${gsc.queries.map((q: string) => esc(q)).join(', ')}</div>` : ''}
      </div>`;
  }

  const pagesHtml = sourcePages.length > 0
    ? sourcePages.map(p => `<div class="flex items-center gap-1.5 text-xs text-slate-600"><svg class="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg><span class="truncate" title="${esc(p.url)}">${esc(p.url)}</span></div>`).join('')
    : '<div class="text-xs text-slate-400 italic">No source pages detected</div>';

  const phrasesHtml = phrases.length > 0
    ? `<div class="flex flex-wrap gap-1">${phrases.map(p => `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded">${esc(p)}</span>`).join('')}</div>`
    : '';

  const actionLabel = oppActionLabel(o.opportunityType);
  const actionColor = oppActionColor(o.opportunityType);

  return `
    <div class="space-y-4">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">What We Found</div>
        <div class="text-sm text-slate-700 leading-relaxed">${esc(o.reason)}</div>
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Current Coverage</div>
        <div class="text-sm text-slate-600">${coverageLabels[o.coverage] ?? o.coverage}</div>
        ${phrasesHtml}
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Why This Is an Opportunity</div>
        <div class="text-sm text-slate-700 leading-relaxed">${esc(o.suggestedAction)}</div>
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Affected / Relevant Pages</div>
        ${pagesHtml}
        ${o.relatedPageUrl ? `<div class="mt-1 text-xs text-blue-600 truncate" title="${esc(o.relatedPageUrl)}">Primary: ${esc(o.relatedPageUrl)}</div>` : ''}
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Recommended Action</div>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full border ${actionColor}">${actionLabel}</span>
        <div class="mt-1.5 text-sm text-slate-600 leading-relaxed">${esc(o.suggestedAction)}</div>
      </div>
      <div class="flex items-center gap-4 pt-2 border-t border-slate-100">
        <div class="text-center"><div class="text-lg font-bold text-slate-800">${o.score}</div><div class="text-[10px] text-slate-500">Score</div></div>
        <div class="text-center"><div class="text-lg font-bold text-slate-800">${o.relevance}</div><div class="text-[10px] text-slate-500">Relevance</div></div>
        <div class="text-center"><div class="text-lg font-bold text-slate-800">${o.impact}</div><div class="text-[10px] text-slate-500">Impact</div></div>
        <div class="text-center"><div class="text-lg font-bold text-slate-800">${o.confidence}</div><div class="text-[10px] text-slate-500">Confidence</div></div>
      </div>
      ${gscHtml}
    </div>`;
}

function opportunityCard(o: any, idx: number): string {
  const pc = oppPriorityColor(o.priority);
  const detailId = `opp-detail-${idx}`;
  return `
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden opportunity-card" data-idx="${idx}">
      <button type="button" class="opp-toggle w-full text-left p-4 flex items-start gap-3 hover:bg-slate-50/50 transition-colors cursor-pointer" data-detail="${detailId}">
        <span class="shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black bg-${pc}-100 text-${pc}-700 border border-${pc}-200">${idx + 1}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-slate-900">"${esc(o.query)}"</span>
            <span class="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-${pc}-100 text-${pc}-700 border border-${pc}-200">${o.priority}</span>
            <span class="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-600">${oppTypeLabels[o.opportunityType] ?? o.opportunityType}</span>
            <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-600">${oppIntentIcon(o.intent)}${intentLabels[o.intent] ?? o.intent}</span>
          </div>
          <div class="mt-1 text-xs text-slate-500 line-clamp-2">${esc(o.reason)}</div>
          ${o.relatedPageUrl ? `<div class="mt-1 text-[10px] text-blue-600 truncate" title="${esc(o.relatedPageUrl)}">↗ ${esc(o.relatedPageUrl)}</div>` : ''}
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <span class="text-sm font-bold text-slate-700">${o.score}</span>
          <svg class="w-4 h-4 text-slate-400 transition-transform opp-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </div>
      </button>
      <div id="${detailId}" class="hidden border-t border-slate-100 p-4 bg-slate-50/30">
        ${opportunityDetailHtml(o)}
      </div>
    </div>`;
}

function renderSearchReport(data: Record<string, any>) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.add('hidden');
  if (error) error.classList.add('hidden');
  if (!content) return;
  content.classList.remove('hidden');

  const plan = data?.plan ?? 'free';
  const isPro = plan === 'pro';
  const agg = data?.aggregate ?? {};
  const allOpps: any[] = data?.opportunities ?? [];
  const total = data?.total ?? allOpps.length;
  const topicsAnalyzed = data?.topicsAnalyzed ?? 0;

  // Use aggregate stats for charts/counts (always reflects ALL opportunities)
  const highCount = agg.high ?? allOpps.filter(o => o.priority === 'high').length;
  const mediumCount = agg.medium ?? allOpps.filter(o => o.priority === 'medium').length;
  const lowCount = agg.low ?? allOpps.filter(o => o.priority === 'low').length;

  const typeCounts: Record<string, number> = agg.typeCounts ?? {};
  const intentCounts: Record<string, number> = agg.intentCounts ?? {};
  const coverageCounts: Record<string, number> = agg.coverageCounts ?? {};

  const typeBarMax = Math.max(1, ...Object.values(typeCounts));
  const typeBars = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => ({ label: oppTypeLabels[t] ?? t, value: c, color: oppTypeColor(t) }));

  const intentBarMax = Math.max(1, ...Object.values(intentCounts));
  const intentBars = Object.entries(intentCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([i, c]) => ({ label: intentLabels[i] ?? i, value: c, color: i === 'commercial' ? '#3b82f6' : i === 'transactional' ? '#10b981' : i === 'navigational' ? '#8b5cf6' : '#6b7280' }));

  let avgScore = 0;
  if (allOpps.length > 0) avgScore = Math.round(allOpps.reduce((s, o) => s + o.score, 0) / allOpps.length);

  // Top 3 for Free, top 10 for Pro
  const topOpps = [...allOpps].sort((a, b) => b.score - a.score).slice(0, isPro ? 10 : 3);

  const sections: string[] = [];

  // --- SECTION 1: Overview ---
  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Search Opportunity Overview</h2>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-blue-700 leading-none">${total}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Opportunities</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-rose-600 leading-none">${highCount}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">High Priority</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-amber-500 leading-none">${mediumCount}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Medium</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-slate-400 leading-none">${lowCount}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Low</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-indigo-600 leading-none">${topicsAnalyzed}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Topics Analyzed</div>
        </div>
      </div>
      <div class="mt-4 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div class="text-sm text-slate-700 leading-relaxed">
          VerseSEO identified <strong>${total} search opportunit${total === 1 ? 'y' : 'ies'}</strong> across your crawled pages
          ${avgScore > 0 ? ` with an average opportunity score of <strong>${avgScore}</strong>` : ''}.
          ${highCount > 0 ? `<span class="font-semibold text-rose-600">${highCount} high-priority</span> opportunit${highCount === 1 ? 'y needs' : 'ies need'} immediate attention.` : 'No high-priority opportunities were detected.'}
        </div>
      </div>
    </div>`);

  // --- SECTION 2: Opportunity Landscape ---
  if (typeBars.length > 0) {
    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Opportunity Landscape</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div class="text-xs text-slate-500 mb-3">Distribution by opportunity type</div>
          ${barChartH(typeBars, typeBarMax, 340)}
        </div>
      </div>`);
  }

  // --- SECTION 3: Top High-Intent Opportunities ---
  if (topOpps.length > 0) {
    const topHtml = topOpps.map((o, i) => `
      <div class="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100">
        <span class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black bg-blue-100 text-blue-700">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-slate-900">"${esc(o.query)}"</span>
            <span class="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-${oppPriorityColor(o.priority)}-100 text-${oppPriorityColor(o.priority)}-700">${o.priority}</span>
            <span class="inline-flex items-center gap-0.5 text-[10px] text-slate-500">${oppIntentIcon(o.intent)}${intentLabels[o.intent] ?? o.intent}</span>
          </div>
          <div class="mt-0.5 text-xs text-slate-500 line-clamp-1">${esc(o.reason)}</div>
          ${o.relatedPageUrl ? `<div class="mt-0.5 text-[10px] text-blue-600 truncate">↗ ${esc(o.relatedPageUrl)}</div>` : ''}
        </div>
        <span class="shrink-0 text-sm font-bold text-slate-700">${o.score}</span>
      </div>`).join('');

    const remaining = total - topOpps.length;
    let remainingHtml = '';
    if (!isPro && remaining > 0) {
      remainingHtml = `
        <div class="bg-gradient-to-br from-slate-50 to-indigo-50 rounded-2xl border border-slate-200 border-dashed p-6 text-center mt-3">
          <div class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 mb-2">
            <svg class="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <p class="text-sm font-bold text-slate-900 mb-1">${remaining} more opportunit${remaining === 1 ? 'y' : 'ies'} available with Pro</p>
          <p class="text-xs text-slate-500 mb-3">Unlock the complete opportunity list to see all identified search opportunities.</p>
          <a href="/pricing" class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors">Upgrade to Pro →</a>
        </div>`;
    }

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Top ${topOpps.length} High-Intent Opportunities</h2>
        <p class="text-xs text-slate-500 mb-4">These are VerseSEO's recommended search opportunities derived from your site's crawl and opportunity analysis. They are not externally verified keyword data.</p>
        <div class="space-y-2">${topHtml}</div>
        ${remainingHtml}
      </div>`);
  }

  // --- SECTION 4: Priority Opportunities ---
  if (!isPro) {
    // Free users see a Pro boundary instead of the full inventory
    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">All Opportunities by Priority</h2>
        ${proBoundary(
          'Complete Opportunity Inventory',
          'See every identified opportunity with full details, priority, intent and affected page with Pro.'
        )}
      </div>`);
  } else {
    // Pro users see the full priority-grouped inventory
    function renderPriorityGroup(label: string, color: string, group: any[]): string {
      if (group.length === 0) return '';
      const cards = group.map((o, i) => opportunityCard(o, i)).join('');
      return `
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-2 h-2 rounded-full bg-${color}-500"></span>
            <h3 class="text-sm font-extrabold text-slate-900 uppercase tracking-wider">${label}</h3>
            <span class="text-xs text-slate-400 font-medium">(${group.length})</span>
          </div>
          <div class="space-y-2">${cards}</div>
        </div>`;
    }

    const high = allOpps.filter(o => o.priority === 'high');
    const medium = allOpps.filter(o => o.priority === 'medium');
    const low = allOpps.filter(o => o.priority === 'low');

    const priorityHtml = [
      renderPriorityGroup('High Priority', 'rose', high),
      renderPriorityGroup('Medium Priority', 'amber', medium),
      renderPriorityGroup('Low Priority', 'slate', low),
    ].filter(Boolean).join('');

    if (priorityHtml) {
      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">All Opportunities by Priority</h2>
          ${priorityHtml}
        </div>`);
    }
  }

  // --- SECTION 6: Content Opportunity Map ---
  if (!isPro) {
    // Free users see a Pro boundary
    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Content Opportunity Map</h2>
        <p class="text-xs text-slate-500 mb-4">A strategic view of what to improve, create, and connect.</p>
        ${proBoundary(
          'Unlock the Content Opportunity Map',
          'See improve existing, create new content, and add internal links opportunities with Pro.'
        )}
      </div>`);
  } else {
    // Pro users see the full content opportunity map
    const improveOpps = allOpps.filter(o => o.opportunityType === 'EXISTING_PAGE_OPTIMIZATION' || o.opportunityType === 'WEAK_TOPIC_COVERAGE');
    const createOpps = allOpps.filter(o => o.opportunityType === 'CONTENT_GAP');
    const connectOpps = allOpps.filter(o => o.opportunityType === 'INTERNAL_LINK_OPPORTUNITY');

    if (improveOpps.length > 0 || createOpps.length > 0 || connectOpps.length > 0) {
      const actionCards = [
        improveOpps.length > 0 ? `
          <div class="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <div class="flex items-center gap-2 mb-2">
              <svg class="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              <span class="text-sm font-bold text-blue-900">IMPROVE EXISTING</span>
              <span class="text-xs text-blue-600 font-medium">${improveOpps.length} opportunit${improveOpps.length === 1 ? 'y' : 'ies'}</span>
            </div>
            <div class="space-y-1.5">${improveOpps.map(o => `<div class="text-xs text-blue-800"><span class="font-semibold">"${esc(o.query)}"</span> — ${o.relatedPageUrl ? esc(o.relatedPageUrl) : 'expand coverage'}</div>`).join('')}</div>
          </div>` : '',
        createOpps.length > 0 ? `
          <div class="bg-red-50 rounded-xl border border-red-200 p-4">
            <div class="flex items-center gap-2 mb-2">
              <svg class="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span class="text-sm font-bold text-red-900">CREATE NEW CONTENT</span>
              <span class="text-xs text-red-600 font-medium">${createOpps.length} opportunit${createOpps.length === 1 ? 'y' : 'ies'}</span>
            </div>
            <div class="space-y-1.5">${createOpps.map(o => `<div class="text-xs text-red-800"><span class="font-semibold">"${esc(o.query)}"</span> — ${esc(o.reason.slice(0, 80))}</div>`).join('')}</div>
          </div>` : '',
        connectOpps.length > 0 ? `
          <div class="bg-violet-50 rounded-xl border border-violet-200 p-4">
            <div class="flex items-center gap-2 mb-2">
              <svg class="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              <span class="text-sm font-bold text-violet-900">ADD INTERNAL LINKS</span>
              <span class="text-xs text-violet-600 font-medium">${connectOpps.length} opportunit${connectOpps.length === 1 ? 'y' : 'ies'}</span>
            </div>
            <div class="space-y-1.5">${connectOpps.map(o => `<div class="text-xs text-violet-800"><span class="font-semibold">"${esc(o.query)}"</span> — ${esc(o.suggestedAction.slice(0, 80))}</div>`).join('')}</div>
          </div>` : '',
      ].filter(Boolean).join('');

      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Content Opportunity Map</h2>
          <p class="text-xs text-slate-500 mb-4">A strategic view of what to improve, create, and connect.</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">${actionCards}</div>
        </div>`);
    }
  }

  // --- SECTION 7: Topic Coverage ---
  const strongCount = coverageCounts['EXISTING'] ?? 0;
  const weakCount = coverageCounts['IMPROVEMENT'] ?? 0;
  const gapCount = coverageCounts['GAP'] ?? 0;

  if (total > 0) {
    const coverageBarMax = Math.max(1, strongCount, weakCount, gapCount);
    const covBars = [
      { label: 'Strong Coverage', value: strongCount, color: '#10b981' },
      { label: 'Needs Improvement', value: weakCount, color: '#f59e0b' },
      { label: 'Gap / Opportunity', value: gapCount, color: '#ef4444' },
    ].filter(b => b.value > 0);

    let topicCoverageHtml = `
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Topic Coverage Analysis</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div class="text-xs text-slate-500 mb-3">How your site covers detected topics</div>
          ${barChartH(covBars, coverageBarMax, 340)}
          <div class="mt-4 grid grid-cols-3 gap-3 text-center">
            <div><div class="text-lg font-bold text-emerald-600">${strongCount}</div><div class="text-[10px] text-slate-500">Well covered</div></div>
            <div><div class="text-lg font-bold text-amber-500">${weakCount}</div><div class="text-[10px] text-slate-500">Needs work</div></div>
            <div><div class="text-lg font-bold text-red-500">${gapCount}</div><div class="text-[10px] text-slate-500">Missing</div></div>
          </div>
        </div>`;

    if (!isPro) {
      topicCoverageHtml += `
        <div class="mt-3">
          ${proBoundary(
            'Detailed Topic-to-Opportunity Mapping',
            'See exactly which topics map to which opportunities with Pro.'
          )}
        </div>`;
    }

    topicCoverageHtml += `</div>`;
    sections.push(topicCoverageHtml);
  }

  // --- SECTION 8: Search Intent ---
  if (intentBars.length > 0) {
    const intentDetails = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([i, c]) => {
        const desc = i === 'commercial' ? 'Users comparing options or looking for recommendations.'
          : i === 'transactional' ? 'Users ready to take action or use a tool.'
          : i === 'navigational' ? 'Users looking for a specific page or brand.'
          : 'Users seeking information or answers.';
        return `
          <div class="bg-white rounded-lg border border-slate-100 p-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="inline-flex items-center gap-1 text-xs font-bold text-slate-800">${oppIntentIcon(i)}${intentLabels[i] ?? i}</span>
              <span class="text-xs text-slate-400">${c} opportunit${c === 1 ? 'y' : 'ies'}</span>
            </div>
            <div class="text-[10px] text-slate-500 mb-1.5">${desc}</div>
          </div>`;
      }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Search Intent Distribution</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
          ${barChartH(intentBars, intentBarMax, 340)}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${intentDetails}</div>
      </div>`);
  }

  // --- SECTION 10: Internal Linking ---
  if (!isPro) {
    // Free users see a Pro boundary
    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Internal Linking Opportunities</h2>
        ${proBoundary(
          'Unlock Internal Linking Opportunities',
          'Discover which pages should link to each other to boost SEO with Pro.'
        )}
      </div>`);
  } else {
    // Pro users see the full internal linking opportunities
    const internalLinkOpps = allOpps.filter(o => o.opportunityType === 'INTERNAL_LINK_OPPORTUNITY');
    if (internalLinkOpps.length > 0) {
      const linkCards = internalLinkOpps.map(o => {
        const ev = o.evidence ?? {};
        const pages: Array<{ url: string }> = ev.sourcePages ?? [];
        const pageList = pages.length > 0
          ? pages.map(p => `<div class="text-xs text-slate-600 truncate" title="${esc(p.url)}">↗ ${esc(p.url)}</div>`).join('')
          : (o.relatedPageUrl ? `<div class="text-xs text-slate-600 truncate">↗ ${esc(o.relatedPageUrl)}</div>` : '<div class="text-xs text-slate-400 italic">No page data</div>');

        return `
          <div class="bg-white rounded-lg border border-slate-100 p-3">
            <div class="text-xs font-bold text-slate-800 mb-1">"${esc(o.query)}"</div>
            ${pageList}
            <div class="mt-1.5 text-[10px] text-slate-500">${esc(o.suggestedAction)}</div>
          </div>`;
      }).join('');

      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Internal Linking Opportunities</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${linkCards}</div>
        </div>`);
    }
  }

  // --- SECTION 11: Action Roadmap ---
  if (!isPro) {
    // Free users see a Pro boundary
    if (total > 0) {
      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Action Roadmap</h2>
          <p class="text-xs text-slate-500 mb-4">If you only have one hour this week, start here.</p>
          ${proBoundary(
            'Unlock Your Prioritized Action Roadmap',
            'Get a specific, prioritized list of recommended actions, affected pages, and step-by-step fixes with Pro.'
          )}
        </div>`);
    }
  } else {
    // Pro users see the full action roadmap
    if (allOpps.length > 0) {
      const sorted = [...allOpps].sort((a, b) => {
        const pw: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const aw = pw[a.priority] ?? 3;
        const bw = pw[b.priority] ?? 3;
        if (aw !== bw) return aw - bw;
        return b.score - a.score;
      });
      const roadmapItems = sorted.slice(0, 10).map((o, i) => {
        const actionLabel = oppActionLabel(o.opportunityType);
        const actionColor = oppActionColor(o.opportunityType);
        return `
          <div class="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100">
            <span class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black bg-slate-100 text-slate-600">${String(i + 1).padStart(2, '0')}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-bold text-slate-900">"${esc(o.query)}"</span>
                <span class="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-${oppPriorityColor(o.priority)}-100 text-${oppPriorityColor(o.priority)}-700">${o.priority}</span>
              </div>
              <div class="mt-0.5 text-xs text-slate-500">${esc(o.suggestedAction)}</div>
              <div class="mt-1"><span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded border ${actionColor}">${actionLabel}</span></div>
            </div>
          </div>`;
      }).join('');

      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Action Roadmap</h2>
          <p class="text-xs text-slate-500 mb-4">If you only have one hour this week, start here.</p>
          <div class="space-y-2">${roadmapItems}</div>
        </div>`);
    }
  }

  // --- Empty state ---
  if (sections.length === 0) {
    sections.push(`
      <div class="text-center py-16">
        <div class="text-4xl mb-3">🔍</div>
        <h3 class="text-lg font-bold text-slate-800">No Opportunities Found</h3>
        <p class="text-sm text-slate-500 mt-1">The crawler did not detect enough content to identify search opportunities.</p>
      </div>`);
  }

  content.innerHTML = `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Search Opportunities Report</h1>
        <p class="text-sm text-slate-500 mt-1">Data-grounded SEO opportunities from your crawled pages.</p>
      </div>
      <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
    </div>
    ${sections.join('')}
  `;

  // Wire back button
  content.querySelector('.btn-back-dashboard')?.addEventListener('click', () => {
    showView('dashboard');
    window.history.replaceState({}, '', '/app');
  });

  // Wire expandable opportunity cards
  content.querySelectorAll('.opp-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const detailId = (btn as HTMLElement).dataset.detail;
      if (!detailId) return;
      const el = document.getElementById(detailId);
      if (!el) return;
      const chevron = btn.querySelector('.opp-chevron') as HTMLElement;
      const isOpen = !el.classList.contains('hidden');
      el.classList.toggle('hidden');
      if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });
  });
}

async function loadSearchReport(crawlId: string) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (content) content.classList.add('hidden');

  try {
    const r = await apiFetch(`/api/crawls/${crawlId}/search-opportunities`);
    if (!r.ok) throw await beErr(r);
    const data = await r.json();
    renderSearchReport(data);
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    if (error) {
      error.classList.remove('hidden');
      const msg = $('report-error-msg');
      if (msg) msg.textContent = e instanceof Error ? e.message : 'Failed to load report.';
    }
  }
}

// --- AI Visibility Report ---

function aiScoreLabel(score: number): string {
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Moderate';
  if (score >= 25) return 'Low';
  return 'Very Low';
}

function aiScoreColor(score: number): string {
  if (score >= 60) return 'emerald';
  if (score >= 40) return 'blue';
  if (score >= 25) return 'amber';
  return 'rose';
}

function renderAiReport(data: Record<string, any>) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.add('hidden');
  if (error) error.classList.add('hidden');
  if (!content) return;
  content.classList.remove('hidden');

  if (data.status === 'unavailable') {
    content.innerHTML = `
      <div class="mb-6 flex flex-col items-center gap-4">
        <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">AI Visibility Report</h1>
        <p class="text-sm text-slate-500 mt-1">${esc(data.message ?? 'AI visibility is not configured.')}</p>
      </div>`;
    return;
  }

  const plan: string = data?.plan ?? 'free';
  const results: any[] = data?.results ?? [];
  const displayScore: number = data?.displayScore ?? 15;
  const overallRaw: number = data?.overallVisibilityScore ?? 0;
  const mentionedCount: number = data?.mentionedCount ?? 0;
  const citedCount: number = data?.citedCount ?? 0;
  const promptsRun: number = data?.promptsRun ?? 0;
  const topicsAnalyzed: number = data?.topicsAnalyzed ?? 0;
  const provider: string = data?.provider ?? 'gemini';
  const model: string = data?.model ?? '';

  const scoreColor = aiScoreColor(displayScore);
  const scoreLabel = aiScoreLabel(displayScore);

  const mentioned = results.filter((r: any) => r.mentioned);
  const cited = results.filter((r: any) => r.cited);
  const notFound = results.filter((r: any) => !r.mentioned);

  const allCompetitors = results.flatMap((r: any) => r.competitors ?? []);
  const competitorCounts = new Map<string, number>();
  for (const c of allCompetitors) competitorCounts.set(c, (competitorCounts.get(c) ?? 0) + 1);
  const topCompetitors = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const citeRate = results.length > 0 ? Math.round((citedCount / results.length) * 100) : 0;
  const mentionRate = results.length > 0 ? Math.round((mentionedCount / results.length) * 100) : 0;

  const sections: string[] = [];

  // --- SECTION 1: AI Visibility Overview ---
  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">AI Visibility Overview</h2>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-${scoreColor}-600 leading-none">${displayScore}<span class="text-sm font-normal text-slate-400">/100</span></div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">AI Visibility</div>
          <div class="text-[10px] font-semibold text-${scoreColor}-600 mt-0.5">${scoreLabel}</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-blue-600 leading-none">${mentionedCount}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Mentioned</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-emerald-600 leading-none">${citedCount}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Cited</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-violet-600 leading-none">${promptsRun}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Queries Tested</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-3xl font-black text-indigo-600 leading-none">${topicsAnalyzed}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Topics Detected</div>
        </div>
      </div>
      <div class="mt-4 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div class="text-sm text-slate-700 leading-relaxed">
          VerseSEO analyzes how clearly your site represents its topics and entities for AI-powered search, and checks actual AI responses where engine data is available.
          ${promptsRun > 0 ? ` Tested <strong>${promptsRun} quer${promptsRun === 1 ? 'y' : 'ies'}</strong> against ${provider.charAt(0).toUpperCase() + provider.slice(1)}${model ? ` (${model})` : ''}.` : ''}
          ${displayScore >= 40 ? ' Your site has <strong>moderate-to-strong</strong> AI-search visibility signals.' : displayScore >= 25 ? ' Your site has <strong>limited but present</strong> AI-search visibility signals.' : ' Your site has <strong>limited</strong> AI-search visibility signals in the current analysis.'}
        </div>
      </div>
    </div>`);

  // --- SECTION 2: AI Engine Coverage ---
  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">AI Engine Coverage</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white rounded-xl border-2 border-emerald-200 shadow-sm p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-bold text-slate-900">Gemini</span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">ACTUAL RESPONSE DATA</span>
          </div>
          <div class="text-xs text-slate-600 leading-relaxed">
            Queries were sent to Google Gemini and actual responses were analyzed for mentions, citations and competitor references.
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="text-lg font-bold text-emerald-600">${promptsRun}</span>
            <span class="text-[10px] text-slate-500">queries analyzed</span>
          </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 opacity-80">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-bold text-slate-900">Claude</span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-500 border border-slate-200">READINESS ANALYSIS</span>
          </div>
          <div class="text-xs text-slate-600 leading-relaxed">
            Claude was not queried directly. The readiness analysis below evaluates whether your content is structured to perform well if Claude surfaces it.
          </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 opacity-80">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-bold text-slate-900">Perplexity</span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-500 border border-slate-200">READINESS ANALYSIS</span>
          </div>
          <div class="text-xs text-slate-600 leading-relaxed">
            Perplexity was not queried directly. The readiness analysis below evaluates whether your content is structured to perform well if Perplexity surfaces it.
          </div>
        </div>
      </div>
    </div>`);

  // --- SECTION 3: Actual AI Query Results ---
  if (results.length > 0) {
    const queryCards = results.map((r: any) => {
      const mentionIcon = r.mentioned
        ? '<svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>'
        : '<svg class="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';
      const citeIcon = r.cited
        ? '<svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>'
        : '<svg class="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';

      let explanation = '';
      if (r.cited) explanation = 'Your site was mentioned and used as a cited source in the AI response.';
      else if (r.mentioned) explanation = 'Your site was recognized in the AI response but was not used as a cited source.';
      else explanation = 'Your site did not appear in the AI response for this topic.';

      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-bold text-slate-900">"${esc(r.topic)}"</span>
            <span class="text-xs font-bold text-slate-500">${r.visibilityScore}/100</span>
          </div>
          <div class="flex items-center gap-4 mb-2">
            <div class="flex items-center gap-1.5">
              ${mentionIcon}
              <span class="text-xs font-semibold ${r.mentioned ? 'text-emerald-700' : 'text-rose-600'}">${r.mentioned ? 'Mentioned' : 'Not mentioned'}</span>
            </div>
            <div class="flex items-center gap-1.5">
              ${citeIcon}
              <span class="text-xs font-semibold ${r.cited ? 'text-emerald-700' : 'text-rose-600'}">${r.cited ? 'Cited' : 'Not cited'}</span>
            </div>
          </div>
          <div class="text-xs text-slate-500 leading-relaxed">${esc(explanation)}</div>
          ${r.competitors && r.competitors.length > 0 ? `<div class="mt-2 text-[10px] text-slate-500">Also mentioned: ${r.competitors.map((c: string) => esc(c)).join(', ')}</div>` : ''}
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Actual AI Query Results</h2>
        <p class="text-xs text-slate-500 mb-4">Real responses from ${provider.charAt(0).toUpperCase() + provider.slice(1)} analyzed for your site.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${queryCards}</div>
      </div>`);
  }

  // --- SECTION 4: AI Visibility by Topic ---
  if (results.length > 0) {
    const topicRows = results.map((r: any) => {
      const mentionBadge = r.mentioned
        ? '<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg> Yes</span>'
        : '<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-700"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> No</span>';
      const citeBadge = r.cited
        ? '<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg> Yes</span>'
        : '<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-700"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> No</span>';
      return `
        <div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
          <span class="flex-1 text-xs font-semibold text-slate-800 truncate">${esc(r.topic)}</span>
          <span class="w-16 text-center">${mentionBadge}</span>
          <span class="w-16 text-center">${citeBadge}</span>
          <span class="w-12 text-right text-[10px] font-bold text-slate-500">${r.visibilityScore}</span>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">AI Visibility by Topic</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center gap-3 py-2 border-b border-slate-200 mb-1">
            <span class="flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Topic</span>
            <span class="w-16 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">Mentioned</span>
            <span class="w-16 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">Cited</span>
            <span class="w-12 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Score</span>
          </div>
          ${topicRows}
        </div>
        <div class="mt-3 text-xs text-slate-500">
          <strong>What does AI already associate with my website?</strong> — Topics where your site is mentioned or cited indicate existing AI recognition.
          Topics where your site is not found represent visibility gaps.
        </div>
      </div>`);
  }

  // --- SECTION 5: Why AI Is Not Surfacing the Site ---
  if (notFound.length > 0 || mentioned.length > 0) {
    const reasons: string[] = [];
    if (notFound.length > 0) {
      reasons.push(`<div class="flex items-start gap-2"><svg class="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><div><div class="text-xs font-bold text-slate-800">Limited topical coverage</div><div class="text-[10px] text-slate-600 mt-0.5">Your site may not have enough content depth around ${notFound.length} tested topic${notFound.length > 1 ? 's' : ''} for AI to confidently associate it with those queries.</div></div></div>`);
    }
    if (mentioned.length > 0 && citedCount === 0) {
      reasons.push(`<div class="flex items-start gap-2"><svg class="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><div><div class="text-xs font-bold text-slate-800">Mentioned but not cited</div><div class="text-[10px] text-slate-600 mt-0.5">AI recognized your site but did not use it as a source. This often means your content lacks the direct, specific answers AI systems look for when choosing citation sources.</div></div></div>`);
    }
    reasons.push(`<div class="flex items-start gap-2"><svg class="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg><div><div class="text-xs font-bold text-slate-800">Entity clarity could be stronger</div><div class="text-[10px] text-slate-600 mt-0.5">AI systems look for clear, consistent signals about who you are and what you offer. Strengthening your primary topic pages and internal linking helps AI build a clearer picture.</div></div></div>`);

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Why AI May Not Be Surfacing Your Site</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          ${reasons.join('')}
        </div>
      </div>`);
  }

  // --- SECTION 6: AI Entity & Topic Clarity ---
  {
    const topicDedicated = results.filter((r: any) => r.mentioned || r.cited).length;
    const topicCoverage = results.length > 0 ? Math.round((topicDedicated / results.length) * 100) : 0;
    const topicBarWidth = Math.min(100, topicCoverage);
    const topicLevel = topicCoverage >= 70 ? 'Strong' : topicCoverage >= 40 ? 'Partial' : 'Weak';
    const topicLevelColor = topicCoverage >= 70 ? 'emerald' : topicCoverage >= 40 ? 'amber' : 'rose';

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">AI Entity & Topic Clarity</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-slate-700">Primary topic recognition</span>
              <span class="text-[10px] font-bold text-${topicLevelColor}-600">${topicLevel} (${topicCoverage}%)</span>
            </div>
            <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-${topicLevelColor}-500 rounded-full" style="width:${topicBarWidth}%"></div>
            </div>
            <div class="text-[10px] text-slate-500 mt-1">${topicDedicated} of ${results.length} tested topics are recognized by AI.</div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-slate-700">Citation readiness</span>
              <span class="text-[10px] font-bold text-${citedCount > 0 ? 'emerald' : 'rose'}-600">${citedCount > 0 ? 'Good' : 'Low'} (${results.length > 0 ? Math.round((citedCount / results.length) * 100) : 0}%)</span>
            </div>
            <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-${citedCount > 0 ? 'emerald' : 'rose'}-500 rounded-full" style="width:${results.length > 0 ? Math.min(100, Math.round((citedCount / results.length) * 100)) : 0}%"></div>
            </div>
            <div class="text-[10px] text-slate-500 mt-1">${citedCount} of ${results.length} tested topics resulted in a citation.</div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-slate-700">Entity/topic association strength</span>
              <span class="text-[10px] font-bold text-${mentionedCount > 0 ? 'blue' : 'rose'}-600">${mentionedCount > 0 ? 'Moderate' : 'Weak'} (${results.length > 0 ? Math.round((mentionedCount / results.length) * 100) : 0}%)</span>
            </div>
            <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-${mentionedCount > 0 ? 'blue' : 'rose'}-500 rounded-full" style="width:${results.length > 0 ? Math.min(100, Math.round((mentionedCount / results.length) * 100)) : 0}%"></div>
            </div>
            <div class="text-[10px] text-slate-500 mt-1">${mentionedCount} of ${results.length} tested topics mention your site.</div>
          </div>
        </div>
      </div>`);
  }

  // --- SECTION 7: AI Content Readiness ---
  {
    const avgScore = results.length > 0 ? Math.round(results.reduce((s: number, r: any) => s + r.visibilityScore, 0) / results.length) : 0;
    const stanceRec = results.filter((r: any) => r.stance === 'recommendation').length;
    const stanceNeutral = results.filter((r: any) => r.stance === 'neutral').length;
    const stanceNeg = results.filter((r: any) => r.stance === 'negative').length;

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">AI Content Readiness</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div class="text-xs text-slate-500 mb-3">How your content characteristics affect AI retrieval and answer generation.</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="text-center">
              <div class="text-2xl font-bold text-slate-800">${avgScore}</div>
              <div class="text-[10px] text-slate-500">Avg. visibility score</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-emerald-600">${stanceRec}</div>
              <div class="text-[10px] text-slate-500">Positive stance</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-blue-600">${stanceNeutral}</div>
              <div class="text-[10px] text-slate-500">Neutral stance</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-rose-600">${stanceNeg}</div>
              <div class="text-[10px] text-slate-500">Negative stance</div>
            </div>
          </div>
          <div class="mt-4 text-xs text-slate-600 leading-relaxed">
            ${stanceRec > 0 ? `AI responses showed a <strong>positive recommendation stance</strong> for ${stanceRec} topic${stanceRec > 1 ? 's' : ''}. ` : ''}
            ${stanceNeutral > 0 ? `${stanceNeutral} topic${stanceNeutral > 1 ? 's' : ''} received a <strong>neutral mention</strong>. ` : ''}
            ${stanceNeg > 0 ? `${stanceNeg} topic${stanceNeg > 1 ? 's' : ''} received a <strong>negative stance</strong>. ` : ''}
            ${mentionedCount === 0 ? 'No topics were mentioned, suggesting content may need stronger topical signals for AI to recognize your site.' : ''}
          </div>
        </div>
      </div>`);
  }

  // --- SECTION 8: Citation Readiness ---
  {
    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Citation Readiness</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div class="text-sm text-slate-700 leading-relaxed mb-4">
            How likely is your site's content to serve as a useful source for AI answers?
            ${citeRate >= 40 ? ' Your site shows <strong>strong citation potential</strong>.' : citeRate >= 20 ? ' Your site shows <strong>moderate citation potential</strong>.' : ' Your site shows <strong>limited citation potential</strong>. AI mentioned your topic but did not consistently use your website as a source.'}
          </div>
          <div class="grid grid-cols-3 gap-4 text-center">
            <div class="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
              <div class="text-xl font-bold text-emerald-700">${citedCount}</div>
              <div class="text-[10px] font-bold text-emerald-600">CITED</div>
              <div class="text-[10px] text-emerald-600/70 mt-0.5">AI used your site as a source</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-3 border border-blue-100">
              <div class="text-xl font-bold text-blue-700">${mentionedCount - citedCount}</div>
              <div class="text-[10px] font-bold text-blue-600">MENTIONED ONLY</div>
              <div class="text-[10px] text-blue-600/70 mt-0.5">AI referred to your site</div>
            </div>
            <div class="bg-rose-50 rounded-lg p-3 border border-rose-100">
              <div class="text-xl font-bold text-rose-700">${notFound.length}</div>
              <div class="text-[10px] font-bold text-rose-600">NOT PRESENT</div>
              <div class="text-[10px] text-rose-600/70 mt-0.5">Site did not appear</div>
            </div>
          </div>
        </div>
      </div>`);
  }

  // --- SECTION 9: AI Visibility Opportunities ---
  {
    const opps: Array<{ priority: string; title: string; why: string; action: string }> = [];

    if (notFound.length > 0) {
      opps.push({
        priority: 'high',
        title: `Expand content coverage for ${notFound.length} missing topic${notFound.length > 1 ? 's' : ''}`,
        why: `Your site was not mentioned for ${notFound.map((r: any) => `"${r.topic}"`).join(', ')}. AI systems need clear, comprehensive content to associate a site with a topic.`,
        action: 'Create or expand dedicated pages addressing these topics with direct, specific information.',
      });
    }
    if (mentioned.length > 0 && citedCount === 0) {
      opps.push({
        priority: 'high',
        title: 'Improve citation readiness',
        why: 'Your site was mentioned but never cited. AI recognized your site but did not consider it a primary source.',
        action: 'Add structured data, direct answers to common questions, and clear factual content that AI systems can use as a source.',
      });
    }
    if (mentionedCount > 0 && citedCount > 0) {
      opps.push({
        priority: 'medium',
        title: 'Strengthen cited topics',
        why: `AI cited your site for ${citedCount} topic${citedCount > 1 ? 's' : ''}. Build on this momentum by deepening coverage and expanding related subtopics.`,
        action: 'Expand existing pages with more detailed information, add supporting content, and strengthen internal links between related pages.',
      });
    }
    if (topCompetitors.length > 0) {
      opps.push({
        priority: 'medium',
        title: 'Analyze competitor visibility',
        why: `AI surfaced ${topCompetitors.length} other source${topCompetitors.length > 1 ? 's' : ''} for your tested topics. Understanding what they do differently can inform your strategy.`,
        action: 'Review what content depth, structure, and topical coverage these competitors provide that your site may be missing.',
      });
    }

    if (opps.length > 0) {
      const visibleOpps = plan === 'pro' ? opps : opps.slice(0, 1);
      const oppHtml = visibleOpps.map((o, i) => {
        const pColor = o.priority === 'high' ? 'rose' : 'amber';
        return `
          <div class="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100">
            <span class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black bg-${pColor}-100 text-${pColor}-700">${i + 1}</span>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-slate-900">${esc(o.title)}</span>
                <span class="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-${pColor}-100 text-${pColor}-700">${o.priority}</span>
              </div>
              <div class="mt-1 text-xs text-slate-600">${esc(o.why)}</div>
              <div class="mt-1 text-xs text-blue-600 font-semibold">${esc(o.action)}</div>
            </div>
          </div>`;
      }).join('');

      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">AI Visibility Opportunities</h2>
          <div class="space-y-2">${oppHtml}</div>
          ${plan !== 'pro' && opps.length > 1 ? proBoundary('Unlock all opportunities', `See all ${opps.length} opportunities with detailed actions to improve your AI visibility.`, 'Visibility') : ''}
        </div>`);
    }
  }

  // --- SECTION 10: Competitor / Alternative Visibility ---
  if (topCompetitors.length > 0) {
    const compRows = topCompetitors.map(([host, count]) => `
      <div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
        <span class="text-xs font-semibold text-slate-800">${esc(host)}</span>
        <span class="text-[10px] text-slate-500">mentioned in ${count} quer${count > 1 ? 'ies' : 'y'}</span>
      </div>`).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Competitor / Alternative Visibility</h2>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="text-xs text-slate-500 mb-3">Other sources that AI surfaced for your tested topics.</div>
          ${compRows}
        </div>
      </div>`);
  }

  // --- SECTION 11: Engine Readiness Matrix ---
  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Engine Readiness Matrix</h2>
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-slate-200">
              <th class="text-left py-2 pr-4 font-bold text-slate-500 uppercase tracking-wider text-[10px]"></th>
              <th class="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Gemini</th>
              <th class="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Claude</th>
              <th class="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Perplexity</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-slate-100">
              <td class="py-2.5 pr-4 font-semibold text-slate-700">Actual response</td>
              <td class="text-center py-2.5 px-3"><span class="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700">✓ Analyzed</span></td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] text-slate-400">— Not queried</span></td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] text-slate-400">— Not queried</span></td>
            </tr>
            <tr class="border-b border-slate-100">
              <td class="py-2.5 pr-4 font-semibold text-slate-700">Content readiness</td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] font-bold text-${aiScoreColor(displayScore)}-600">${scoreLabel}</span></td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] font-bold text-${aiScoreColor(displayScore)}-600">${scoreLabel}</span></td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] font-bold text-${aiScoreColor(displayScore)}-600">${scoreLabel}</span></td>
            </tr>
            <tr>
              <td class="py-2.5 pr-4 font-semibold text-slate-700">Citation readiness</td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] font-bold text-${citeRate >= 40 ? 'emerald' : citeRate >= 20 ? 'amber' : 'rose'}-600">${citeRate >= 40 ? 'Good' : citeRate >= 20 ? 'Partial' : 'Low'}</span></td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] font-bold text-${citeRate >= 40 ? 'emerald' : citeRate >= 20 ? 'amber' : 'rose'}-600">${citeRate >= 40 ? 'Good' : citeRate >= 20 ? 'Partial' : 'Low'}</span></td>
              <td class="text-center py-2.5 px-3"><span class="text-[10px] font-bold text-${citeRate >= 40 ? 'emerald' : citeRate >= 20 ? 'amber' : 'rose'}-600">${citeRate >= 40 ? 'Good' : citeRate >= 20 ? 'Partial' : 'Low'}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-2 text-[10px] text-slate-500">
        ✓ = Actual analysis &nbsp;|&nbsp; — = Not queried &nbsp;|&nbsp; Readiness predictions are based on your site's content analysis, not actual engine results.
      </div>
    </div>`);

  // --- SECTION 12: Recommended AI Visibility Plan ---
  {
    const actionSteps: Array<{ step: string; problem: string; why: string; action: string }> = [];

    if (notFound.length > 0) {
      actionSteps.push({
        step: '01',
        problem: `Missing topic coverage for ${notFound.length} tested quer${notFound.length > 1 ? 'ies' : 'y'}`,
        why: 'AI systems need clear, comprehensive content to associate your site with a topic. Without dedicated content, AI cannot recognize your expertise.',
        action: `Create or expand pages covering: ${notFound.map((r: any) => r.topic).join(', ')}.`,
      });
    }
    if (mentionedCount > 0 && citedCount === 0) {
      actionSteps.push({
        step: actionSteps.length === 0 ? '01' : '02',
        problem: 'Mentioned but not cited',
        why: 'AI recognized your site but did not use it as a source. This means your content exists but lacks the directness and specificity AI systems require for citation.',
        action: 'Add structured data, direct answers to common questions, and clear factual content on your primary topic pages.',
      });
    }
    if (citedCount > 0) {
      actionSteps.push({
        step: String(actionSteps.length + 1).padStart(2, '0'),
        problem: 'Build on cited topics',
        why: `AI already cited your site for ${citedCount} topic${citedCount > 1 ? 's' : ''}. Deepening this coverage strengthens your position.`,
        action: 'Expand cited pages with more detail, add supporting subtopic pages, and strengthen internal linking.',
      });
    }
    if (topCompetitors.length > 0) {
      actionSteps.push({
        step: String(actionSteps.length + 1).padStart(2, '0'),
        problem: 'Competitor visibility gaps',
        why: `AI surfaced ${topCompetitors.length} other source${topCompetitors.length > 1 ? 's' : ''} instead of or alongside your site.`,
        action: 'Analyze what content structure, depth, and topical coverage these competitors provide. Create content that fills the gaps.',
      });
    }

    if (actionSteps.length > 0) {
      const visibleSteps = plan === 'pro' ? actionSteps : actionSteps.slice(0, 1);
      const planHtml = visibleSteps.map(p => `
        <div class="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100">
          <span class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black bg-violet-100 text-violet-700 border border-violet-200">${p.step}</span>
          <div class="flex-1">
            <div class="text-sm font-bold text-slate-900">${esc(p.problem)}</div>
            <div class="mt-1 text-xs text-slate-600">${esc(p.why)}</div>
            <div class="mt-1 text-xs text-blue-600 font-semibold">${esc(p.action)}</div>
          </div>
        </div>`).join('');

      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Your AI Visibility Action Plan</h2>
          <p class="text-xs text-slate-500 mb-4">Prioritized steps to improve how AI systems find, understand, and cite your site.</p>
          <div class="space-y-2">${planHtml}</div>
          ${plan !== 'pro' && actionSteps.length > 1 ? proBoundary('Unlock the full action plan', `Get all ${actionSteps.length} prioritized steps with specific actions to improve your AI visibility.`, 'Visibility') : ''}
        </div>`);
    }
  }

  content.innerHTML = `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">AI Visibility Report</h1>
        <p class="text-sm text-slate-500 mt-1">How AI search systems see and represent your site.</p>
      </div>
      <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
    </div>
    ${sections.join('')}
  `;

  content.querySelector('.btn-back-dashboard')?.addEventListener('click', () => {
    showView('dashboard');
    window.history.replaceState({}, '', '/app');
  });
}

async function loadAiReport(crawlId: string) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (content) content.classList.add('hidden');

  try {
    const r = await apiFetch(`/api/crawls/${crawlId}/ai-visibility`);
    if (!r.ok) throw await beErr(r);
    const data = await r.json();
    renderAiReport(data);
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    if (error) {
      error.classList.remove('hidden');
      const msg = $('report-error-msg');
      if (msg) msg.textContent = e instanceof Error ? e.message : 'Failed to load report.';
    }
  }
}

// --- Content Opportunities full report ---
async function loadContentReport(crawlId: string) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (content) content.classList.add('hidden');
  try {
    const [recsRes, crawlRes] = await Promise.all([
      apiFetch(`/api/crawls/${crawlId}/content-recommendations`),
      apiFetch(`/api/crawls/${crawlId}`),
    ]);
    if (!recsRes.ok) throw await beErr(recsRes);
    const recsData = await recsRes.json();
    let pagesData: Record<string, any> | null = null;
    if (crawlRes.ok) {
      pagesData = await crawlRes.json();
    }
    renderContentReport(recsData, pagesData);
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    if (error) {
      error.classList.remove('hidden');
      const msg = $('report-error-msg');
      if (msg) msg.textContent = e instanceof Error ? e.message : 'Failed to load report.';
    }
  }
}

function renderContentReport(data: Record<string, any>, pagesData: Record<string, any> | null = null) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.add('hidden');
  if (error) error.classList.add('hidden');

  const plan: string = data?.plan ?? 'free';
  const FREE_RECOMMENDATION_LIMIT = 1;
  const recs: any[] = data?.recommendations ?? [];
  const visibleRecs = plan === 'pro' ? recs : recs.slice(0, FREE_RECOMMENDATION_LIMIT);
  const topicsAnalyzed = data?.topicsAnalyzed ?? 0;
  const provider = data?.provider ?? null;

  if (data.status === 'unavailable') {
    content.innerHTML = `
      <div class="flex flex-col items-center gap-4">
        <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Content Opportunities Report</h1>
        <p class="text-sm text-slate-500 mt-1">${esc(data.message ?? 'Content generation is unavailable.')}</p>
      </div>`;
    return;
  }

  const high = visibleRecs.filter(r => r.priority === 'high');
  const medium = visibleRecs.filter(r => r.priority === 'medium');
  const low = visibleRecs.filter(r => r.priority === 'low');
  const newContent = visibleRecs.filter(r => ['CONTENT_GAP', 'CORE_TOPIC', 'AI_VISIBILITY_GAP', 'SEARCH_INTENT_GAP'].includes(r.sourceType));
  const improveExisting = visibleRecs.filter(r => ['SEO_FIX', 'WEAK_TOPIC_COVERAGE'].includes(r.sourceType));
  const actionCounts: Record<string, number> = {};
  for (const r of visibleRecs) {
    const action = sourceTypeToAction(r.sourceType);
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
  }

  // Pages analysis from crawl data
  const pages: any[] = pagesData?.pages ?? [];
  const pageStats = pagesData?.pageStats ?? null;
  const wordCountStats = pagesData?.wordCountStats ?? null;
  const internalLinkStats = pagesData?.internalLinkStats ?? null;
  const htmlPages = pages.filter((p: any) => p.contentType?.includes('html') || (!p.contentType && p.wordCount != null));
  const thinPages = htmlPages.filter((p: any) => p.wordCount != null && p.wordCount < 300);
  const avgWordCount = wordCountStats?.avg ?? (htmlPages.length > 0 ? Math.round(htmlPages.reduce((s: number, p: any) => s + (p.wordCount ?? 0), 0) / htmlPages.length) : 0);
  const pagesWithGoodHeadings = htmlPages.filter((p: any) => (p.h1Count ?? 0) === 1 && (p.h2Count ?? 0) >= 2);
  const pagesWithZeroInternalLinks = htmlPages.filter((p: any) => !p.internalLinks || p.internalLinks.length === 0);
  const internalLinkGraph = new Map<string, Set<string>>();
  for (const p of htmlPages) {
    const from = normalizeUrl(p.url);
    if (!internalLinkGraph.has(from)) internalLinkGraph.set(from, new Set());
    for (const link of (p.internalLinks ?? [])) {
      const to = normalizeUrl(link);
      internalLinkGraph.get(from)!.add(to);
    }
  }

  const sections: string[] = [];

  // --- SECTION 1: Content Opportunity Overview ---
  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Opportunity Overview</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-indigo-600">${recs.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Total Opportunities</div>
        </div>
        <div class="bg-white rounded-xl border border-rose-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-rose-600">${high.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">High Priority</div>
        </div>
        <div class="bg-white rounded-xl border border-amber-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-amber-600">${medium.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Medium Priority</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-slate-400">${low.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Low Priority</div>
        </div>
        <div class="bg-white rounded-xl border border-emerald-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-emerald-600">${newContent.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">New Content Ideas</div>
        </div>
        <div class="bg-white rounded-xl border border-blue-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-blue-600">${improveExisting.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Improve Existing</div>
        </div>
      </div>
      <div class="mt-4 bg-indigo-50 rounded-xl border border-indigo-200/80 p-4">
        <p class="text-sm text-indigo-900 leading-relaxed">
          VerseSEO identified <strong>${recs.length} content opportunities</strong> from ${topicsAnalyzed} analyzed topics
          ${high.length > 0 ? `. <strong>${high.length} high priority</strong> and focus on topics where your current content is missing, thin, or does not fully address the detected intent.` : ''}
          ${improveExisting.length > 0 ? ` ${improveExisting.length} opportunity${improveExisting.length > 1 ? 's' : ''} can be addressed by improving existing pages.` : ''}
        </p>
      </div>
    </div>`);

  // --- SECTION 2: Content Strategy Snapshot ---
  const maxActionCount = Math.max(...Object.values(actionCounts), 1);
  const actionLabels: Record<string, string> = {
    'Create new content': 'CREATE NEW',
    'Improve existing page': 'IMPROVE EXISTING',
    'Expand topic coverage': 'EXPAND / UPDATE',
  };
  const actionColors: Record<string, string> = {
    'Create new content': 'bg-emerald-500',
    'Improve existing page': 'bg-blue-500',
    'Expand topic coverage': 'bg-amber-500',
  };
  const actionBars = Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => {
      const pct = Math.round((count / maxActionCount) * 100);
      return `
        <div class="flex items-center gap-3">
          <div class="w-36 text-xs font-semibold text-slate-700 text-right shrink-0">${actionLabels[action] ?? action}</div>
          <div class="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
            <div class="${actionColors[action] ?? 'bg-slate-400'} h-full rounded-full flex items-center justify-end pr-2" style="width:${Math.max(pct, 12)}%">
              <span class="text-[10px] font-bold text-white">${count}</span>
            </div>
          </div>
        </div>`;
    }).join('');

  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Strategy Snapshot</h2>
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div class="space-y-3">${actionBars}</div>
      </div>
    </div>`);

  // --- Content Health Metrics (from crawl data) ---
  if (htmlPages.length > 0) {
    const thinPct = htmlPages.length > 0 ? Math.round((thinPages.length / htmlPages.length) * 100) : 0;
    const goodHeadingPct = htmlPages.length > 0 ? Math.round((pagesWithGoodHeadings.length / htmlPages.length) * 100) : 0;
    const zeroLinksPct = htmlPages.length > 0 ? Math.round((pagesWithZeroInternalLinks.length / htmlPages.length) * 100) : 0;
    const withTitlePct = htmlPages.length > 0 ? Math.round((htmlPages.filter((p: any) => p.title && p.title.trim().length > 0).length / htmlPages.length) * 100) : 0;

    const healthCards = [
      { label: 'Avg. word count', value: String(avgWordCount), note: avgWordCount < 300 ? 'Low — many pages may lack depth' : avgWordCount < 600 ? 'Moderate — room for deeper coverage' : 'Strong across most pages', color: avgWordCount < 300 ? 'text-rose-600' : avgWordCount < 600 ? 'text-amber-600' : 'text-emerald-600' },
      { label: 'Thin pages', value: `${thinPages.length}`, note: `${thinPct}% of HTML pages under 300 words`, color: thinPct > 30 ? 'text-rose-600' : thinPct > 10 ? 'text-amber-600' : 'text-emerald-600' },
      { label: 'Good heading structure', value: `${pagesWithGoodHeadings.length}`, note: `${goodHeadingPct}% have 1 H1 + 2+ H2s`, color: goodHeadingPct > 60 ? 'text-emerald-600' : goodHeadingPct > 30 ? 'text-amber-600' : 'text-rose-600' },
      { label: 'Zero internal links', value: `${pagesWithZeroInternalLinks.length}`, note: `${zeroLinksPct}% of pages link to no other pages`, color: zeroLinksPct > 20 ? 'text-rose-600' : zeroLinksPct > 5 ? 'text-amber-600' : 'text-emerald-600' },
      { label: 'Pages with titles', value: `${htmlPages.filter((p: any) => p.title && p.title.trim().length > 0).length}`, note: `${withTitlePct}% have a title tag`, color: withTitlePct < 80 ? 'text-rose-600' : 'text-emerald-600' },
      { label: 'HTML pages', value: String(htmlPages.length), note: `of ${pages.length} total pages crawled`, color: 'text-slate-600' },
    ];

    const healthHtml = healthCards.map(c => `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div class="text-2xl font-extrabold ${c.color}">${c.value}</div>
        <div class="text-[11px] font-semibold text-slate-500 mt-1">${c.label}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${c.note}</div>
      </div>`).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Content Health Metrics</h2>
        <p class="text-xs text-slate-500 mb-4">Derived from your crawled pages. Strong content targets a specific topic per page, addresses it thoroughly, and connects naturally to related pages.</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${healthHtml}</div>
      </div>`);
  }

  // --- SECTION 3: Top Content Opportunities ---
  if (visibleRecs.length > 0) {
    const topCards = visibleRecs.map((r: any, i: number) => {
      const priorityColor = r.priority === 'high' ? 'bg-rose-100 text-rose-700 border-rose-200' : r.priority === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200';
      const sourceLabel = sourceTypeToLabel(r.sourceType);
      const sourceColor = sourceTypeColor(r.sourceType);
      const action = sourceTypeToAction(r.sourceType);
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                <span class="text-[11px] font-bold text-slate-400">#${i + 1}</span>
                <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityColor}">${r.priority.toUpperCase()}</span>
                <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${sourceColor}">${sourceLabel}</span>
              </div>
              <h3 class="text-sm font-bold text-slate-900 leading-snug">${esc(r.title)}</h3>
              <p class="text-xs text-slate-500 mt-1 line-clamp-2">${esc(r.rationale)}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-3 text-[11px] text-slate-500">
            <span class="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">${esc(r.intent)}</span>
            <span class="text-slate-300">|</span>
            <span class="text-slate-600 font-medium">${action}</span>
            ${r.aiEnhanced ? '<span class="text-slate-300">|</span><span class="text-indigo-500 font-medium">AI enhanced</span>' : ''}
          </div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Top Content Opportunities</h2>
        <div class="space-y-3">${topCards}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock all content opportunities', `See all ${recs.length} content opportunities and the complete content strategy.`, 'Content'));
    }
  }

  // --- SECTION 4: Content Opportunity Cards (expandable) ---
  if (visibleRecs.length > 0) {
    const oppCards = visibleRecs.map((r: any, i: number) => {
      const priorityColor = r.priority === 'high' ? 'bg-rose-100 text-rose-700 border-rose-200' : r.priority === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200';
      const action = sourceTypeToAction(r.sourceType);
      const structureHtml = (r.structure ?? []).map((s: string) => `<li class="text-xs text-slate-600">${esc(s)}</li>`).join('');
      return `
        <details class="group bg-white rounded-xl border border-slate-200 shadow-sm">
          <summary class="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-slate-50 rounded-xl transition">
            <span class="text-[11px] font-bold text-slate-400 w-5 text-center shrink-0">${i + 1}</span>
            <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityColor} shrink-0">${r.priority.toUpperCase()}</span>
            <span class="text-sm font-bold text-slate-900 flex-1 min-w-0 truncate">${esc(r.title)}</span>
            <svg class="w-4 h-4 text-slate-400 shrink-0 transition group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          <div class="px-5 pb-5 border-t border-slate-100 pt-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">What to create</div>
                <p class="text-sm text-slate-800 font-medium">${esc(r.title)}</p>
              </div>
              <div>
                <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Why</div>
                <p class="text-xs text-slate-600 leading-relaxed">${esc(r.rationale)}</p>
              </div>
              <div>
                <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Where</div>
                <p class="text-xs text-slate-600">${action}</p>
              </div>
              <div>
                <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">How</div>
                <ul class="space-y-0.5">${structureHtml}</ul>
              </div>
            </div>
          </div>
        </details>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Opportunity Cards</h2>
        <div class="space-y-2">${oppCards}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock detailed content briefs', `Each opportunity includes a full brief with structure, rationale, and recommended actions. Pro unlocks all ${recs.length}.`, 'Content'));
    }
  }

  // --- SECTION 5: Existing Page Optimization ---
  if (improveExisting.length > 0) {
    const optimizeCards = improveExisting.map((r: any) => {
      const sourceLabel = sourceTypeToLabel(r.sourceType);
      const missingItems = (r.structure ?? []).map((s: string) => `<li class="text-xs text-slate-600 leading-relaxed">${esc(s)}</li>`).join('');
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${sourceTypeColor(r.sourceType)}">${sourceLabel}</span>
            <span class="text-sm font-bold text-slate-900">${esc(r.topic)}</span>
          </div>
          <p class="text-xs text-slate-500 mb-3">${esc(r.rationale)}</p>
          <div>
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Recommended additions</div>
            <ul class="space-y-1 list-disc list-inside">${missingItems}</ul>
          </div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Existing Page Optimization</h2>
        <p class="text-xs text-slate-500 mb-4">These opportunities can be addressed by improving pages that already exist.</p>
        <div class="space-y-3">${optimizeCards}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock all optimization targets', `See the complete list of existing pages that can be improved.`, 'Content'));
    }
  }

  // --- SECTION 6: New Content to Create ---
  if (newContent.length > 0) {
    const newCards = newContent.map((r: any) => {
      const intentLabel = r.intent === 'informational' ? 'Guide / educational article' : r.intent === 'commercial' ? 'Comparison / buying guide' : r.intent === 'transactional' ? 'Tool / landing page' : 'Content page';
      const structureItems = (r.structure ?? []).map((s: string) => `<li class="text-xs text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5">${esc(s)}</li>`).join('');
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </div>
            <div>
              <h3 class="text-sm font-bold text-slate-900">${esc(r.title)}</h3>
              <div class="flex items-center gap-2 mt-1">
                <span class="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-medium text-slate-600">${esc(r.intent)}</span>
                <span class="text-[10px] text-slate-400">${intentLabel}</span>
              </div>
            </div>
          </div>
          <p class="text-xs text-slate-600 leading-relaxed mb-3">${esc(r.rationale)}</p>
          <div>
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Suggested structure</div>
            <ul class="space-y-1">${structureItems}</ul>
          </div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">New Content to Create</h2>
        <p class="text-xs text-slate-500 mb-4">Dedicated content assets recommended by the analysis.</p>
        <div class="space-y-3">${newCards}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock all new content ideas', `See every recommended new content asset based on your site's gaps and opportunities.`, 'Content'));
    }
  }

  // --- SECTION 7: Content Gap Analysis ---
  if (visibleRecs.length > 0) {
    const gapRows = visibleRecs.map((r: any) => {
      const coverage = r.sourceType === 'CONTENT_GAP' ? 'Not covered' : r.sourceType === 'WEAK_TOPIC_COVERAGE' ? 'Thin / weak' : r.sourceType === 'SEO_FIX' ? 'Has SEO issues' : 'Referenced but not targeted';
      return `
        <div class="flex items-stretch gap-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="w-1/4 bg-slate-50 px-3 py-3 border-r border-slate-200">
            <div class="text-[11px] font-bold text-slate-500 uppercase mb-1">Topic</div>
            <div class="text-xs font-semibold text-slate-800">${esc(r.topic)}</div>
          </div>
          <div class="w-1/4 px-3 py-3 border-r border-slate-100">
            <div class="text-[11px] font-bold text-slate-500 uppercase mb-1">Current coverage</div>
            <div class="text-xs text-slate-600">${coverage}</div>
          </div>
          <div class="w-1/4 px-3 py-3 border-r border-slate-100">
            <div class="text-[11px] font-bold text-slate-500 uppercase mb-1">Gap</div>
            <div class="text-xs text-slate-600">${esc(r.rationale.length > 60 ? r.rationale.slice(0, 60) + '…' : r.rationale)}</div>
          </div>
          <div class="w-1/4 px-3 py-3">
            <div class="text-[11px] font-bold text-slate-500 uppercase mb-1">Recommended</div>
            <div class="text-xs font-semibold text-indigo-700">${sourceTypeToAction(r.sourceType)}</div>
          </div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Gap Analysis</h2>
        <div class="space-y-2">${gapRows}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock full gap analysis', `See how all ${recs.length} topics compare in coverage, gaps, and recommended actions.`, 'Content'));
    }
  }

  // --- SECTION 8: Search Intent → Content Format ---
  const intentGroups: Record<string, any[]> = {};
  for (const r of visibleRecs) {
    const intent = r.intent ?? 'informational';
    if (!intentGroups[intent]) intentGroups[intent] = [];
    intentGroups[intent].push(r);
  }
  const intentFormatMap: Record<string, { format: string; icon: string }> = {
    informational: { format: 'Guide / FAQ / Educational article', icon: '📖' },
    commercial: { format: 'Comparison / Buying guide / Product page', icon: '🔍' },
    transactional: { format: 'Calculator / Tool page / Landing page', icon: '⚡' },
    navigational: { format: 'Brand / Product page', icon: '🧭' },
  };
  if (Object.keys(intentGroups).length > 0) {
    const intentCards = Object.entries(intentGroups).map(([intent, items]) => {
      const fmt = intentFormatMap[intent] ?? { format: 'Content page', icon: '📄' };
      const topics = items.map((r: any) => `<li class="text-xs text-slate-700">${esc(r.topic)}</li>`).join('');
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-base">${fmt.icon}</span>
            <span class="text-sm font-bold text-slate-900 uppercase">${intent}</span>
            <span class="text-xs text-slate-400">(${items.length})</span>
          </div>
          <div class="text-xs text-indigo-600 font-medium mb-2">→ ${fmt.format}</div>
          <ul class="space-y-0.5 list-disc list-inside">${topics}</ul>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Search Intent → Content Format</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${intentCards}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock intent mapping for all opportunities', `See how all ${recs.length} opportunities map to search intent and content format.`, 'Content'));
    }
  }

  // --- SECTION 9: Content Cluster / Topic Structure ---
  const clusters = buildContentClusters(visibleRecs);
  if (clusters.length > 0) {
    const clusterHtml = clusters.map(c => {
      const items = c.items.map((r: any) => `<li class="text-xs text-slate-700 flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ${r.priority === 'high' ? 'bg-rose-400' : r.priority === 'medium' ? 'bg-amber-400' : 'bg-slate-300'} shrink-0"></span>${esc(r.title)}</li>`).join('');
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-6 h-6 rounded bg-indigo-100 flex items-center justify-center">
              <svg class="w-3.5 h-3.5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </div>
            <span class="text-sm font-bold text-slate-900">${esc(c.name)}</span>
            <span class="text-[10px] text-slate-400">${c.items.length} item${c.items.length > 1 ? 's' : ''}</span>
          </div>
          <ul class="space-y-1">${items}</ul>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Cluster / Topic Structure</h2>
        <p class="text-xs text-slate-500 mb-4">Related content opportunities grouped by topic. Pillar + supporting articles that work together.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${clusterHtml}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock full topic clusters', `See how all ${recs.length} opportunities group into content clusters and pillar strategies.`, 'Content'));
    }
  }

  // --- SECTION 10: Content Brief (high priority only) ---
  if (high.length > 0) {
    const briefs = high.map((r: any) => {
      const structureHtml = (r.structure ?? []).map((s: string, i: number) => `<div class="flex items-start gap-2"><span class="text-[10px] font-bold text-indigo-400 mt-0.5 shrink-0">H2</span><span class="text-xs text-slate-700">${esc(s)}</span></div>`).join('');
      return `
        <div class="bg-white rounded-xl border border-indigo-200 shadow-sm p-5">
          <div class="flex items-center gap-2 mb-3">
            <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">HIGH PRIORITY</span>
            <span class="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-medium text-slate-600">${esc(r.intent)}</span>
          </div>
          <h3 class="text-sm font-bold text-slate-900 mb-1">${esc(r.title)}</h3>
          <p class="text-xs text-slate-500 mb-3">Topic: ${esc(r.topic)}</p>
          <div class="bg-slate-50 rounded-lg p-3 mb-3">
            <div class="text-[11px] font-bold text-slate-500 uppercase mb-1.5">Suggested H2 structure</div>
            <div class="space-y-1">${structureHtml}</div>
          </div>
          <div class="text-[11px] font-bold text-slate-500 uppercase mb-1">Rationale</div>
          <p class="text-xs text-slate-600 leading-relaxed">${esc(r.rationale)}</p>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Briefs</h2>
        <p class="text-xs text-slate-500 mb-4">Compact briefs for high-priority opportunities. Start here.</p>
        <div class="space-y-3">${briefs}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock all content briefs', `Get AI-enhanced briefs for every high-priority opportunity across all ${recs.length} recommendations.`, 'Content'));
    }
  }

  // --- Internal Linking Opportunities ---
  if (visibleRecs.length > 0 && htmlPages.length > 1) {
    const linkOpps = findInternalLinkOpportunities(visibleRecs, htmlPages, internalLinkGraph);
    if (linkOpps.length > 0) {
      const linkHtml = linkOpps.slice(0, 6).map(opp => `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-4 h-4 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span class="text-xs font-bold text-slate-800">${esc(opp.from)}</span>
          </div>
          <div class="text-[11px] text-slate-500 mb-1">→ link to: <span class="font-medium text-indigo-600">${esc(opp.to)}</span></div>
          <div class="text-[10px] text-slate-400">${esc(opp.reason)}</div>
        </div>`).join('');

      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Internal Linking Opportunities</h2>
          <p class="text-xs text-slate-500 mb-4">Pages that should link to each other to strengthen topical connections and help visitors discover related content.</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${linkHtml}</div>
        </div>`);
      if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
        sections.push(proBoundary('Unlock all internal linking suggestions', `Discover more linking opportunities across all ${recs.length} content recommendations.`, 'Content'));
      }
    }
  }

  // --- SECTION 11: Priority Action Plan ---
  const prioritized = [...high, ...medium, ...low];
  if (prioritized.length > 0) {
    const actions = prioritized.slice(0, 8).map((r: any, i: number) => {
      const num = String(i + 1).padStart(2, '0');
      const priorityColor = r.priority === 'high' ? 'bg-rose-500' : r.priority === 'medium' ? 'bg-amber-500' : 'bg-slate-400';
      const action = sourceTypeToAction(r.sourceType);
      return `
        <div class="flex items-start gap-3 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="w-8 h-8 rounded-full ${priorityColor} flex items-center justify-center shrink-0">
            <span class="text-xs font-bold text-white">${num}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-bold text-slate-900">${esc(r.title)}</span>
              <span class="text-[10px] font-bold ${r.priority === 'high' ? 'text-rose-600' : r.priority === 'medium' ? 'text-amber-600' : 'text-slate-500'}">${r.priority.toUpperCase()}</span>
            </div>
            <p class="text-xs text-slate-500 mb-1.5">${esc(r.rationale)}</p>
            <div class="text-[11px] font-medium text-indigo-600">${action} → ${esc(r.topic)}</div>
          </div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Priority Action Plan</h2>
        <p class="text-xs text-slate-500 mb-4">If I can only work on three content improvements this month, what should I do?</p>
        <div class="space-y-2">${actions}</div>
      </div>`);
    if (plan !== 'pro' && recs.length > FREE_RECOMMENDATION_LIMIT) {
      sections.push(proBoundary('Unlock the complete action plan', `Get prioritized actions for all ${recs.length} content opportunities, ranked by impact.`, 'Content'));
    }
  }

  // --- Learn: Why authoritative content matters ---
  sections.push(`
    <div class="mb-8">
      <div class="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl border border-indigo-200/80 p-6">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-lg">&#x1F4D6;</span>
          <h2 class="text-sm font-extrabold text-indigo-900 tracking-tight">Learn</h2>
        </div>
        <h3 class="text-sm font-bold text-indigo-900 mb-2">Why does relevant, authoritative content matter?</h3>
        <div class="text-xs text-indigo-800 leading-relaxed space-y-2">
          <p>Effective content targeting is not simply inserting keywords into pages. A strong page should have a clear, specific topic, satisfy the intended user's search need, demonstrate useful expertise, and connect naturally with related content on your site.</p>
          <p>Search engines reward content that is written for real people — pages that answer genuine questions, provide practical value, and are maintained over time. Each page should target a focused topic rather than trying to cover multiple unrelated subjects at once.</p>
          <p>When pages are organized around pillar topics with supporting content that links between them, both visitors and search engines can better understand what your site covers and how your pages relate to each other.</p>
        </div>
        <div class="mt-3 pt-3 border-t border-indigo-200/60">
          <p class="text-[10px] text-indigo-600">Based on guidance from <a href="https://www.mtu.edu/umc/services/websites/seo/" target="_blank" rel="noopener noreferrer" class="underline hover:text-indigo-800">Michigan Technological University</a></p>
        </div>
      </div>
    </div>`);

  // --- Empty state ---
  if (visibleRecs.length === 0) {
    sections.push(`
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center mb-8">
        <div class="text-sm text-slate-500">No content opportunities found. Run a deeper scan to get recommendations.</div>
      </div>`);
  }

  if (content) {
    content.classList.remove('hidden');
    content.innerHTML = `
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Content Opportunities Report</h1>
          <p class="text-xs text-slate-500 mt-1">Analyzed ${topicsAnalyzed} topics${provider ? ` via ${provider}` : ''} · ${recs.length} opportunit${recs.length === 1 ? 'y' : 'ies'} found</p>
        </div>
        <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
      </div>
      ${sections.join('')}
    `;
    content.querySelector('.btn-back-dashboard')?.addEventListener('click', () => {
      showView('dashboard');
      window.history.replaceState({}, '', '/app');
    });
  }
}

function sourceTypeToAction(sourceType: string): string {
  switch (sourceType) {
    case 'CONTENT_GAP': return 'Create new content';
    case 'SEARCH_INTENT_GAP': return 'Expand topic coverage';
    case 'WEAK_TOPIC_COVERAGE': return 'Expand topic coverage';
    case 'SEO_FIX': return 'Improve existing page';
    case 'CORE_TOPIC': return 'Create new content';
    case 'AI_VISIBILITY_GAP': return 'Create new content';
    default: return 'Create new content';
  }
}

function sourceTypeToLabel(sourceType: string): string {
  switch (sourceType) {
    case 'CONTENT_GAP': return 'Content gap';
    case 'SEARCH_INTENT_GAP': return 'Intent gap';
    case 'WEAK_TOPIC_COVERAGE': return 'Weak coverage';
    case 'SEO_FIX': return 'SEO fix';
    case 'CORE_TOPIC': return 'Core topic';
    case 'AI_VISIBILITY_GAP': return 'AI gap';
    default: return sourceType;
  }
}

function sourceTypeColor(sourceType: string): string {
  switch (sourceType) {
    case 'CONTENT_GAP': return 'bg-rose-100 text-rose-700';
    case 'SEARCH_INTENT_GAP': return 'bg-amber-100 text-amber-700';
    case 'WEAK_TOPIC_COVERAGE': return 'bg-orange-100 text-orange-700';
    case 'SEO_FIX': return 'bg-blue-100 text-blue-700';
    case 'CORE_TOPIC': return 'bg-violet-100 text-violet-700';
    case 'AI_VISIBILITY_GAP': return 'bg-indigo-100 text-indigo-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function buildContentClusters(recs: any[]): { name: string; items: any[] }[] {
  const wordBuckets = new Map<string, any[]>();
  for (const r of recs) {
    const words = r.topic.toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length > 3);
    let placed = false;
    for (const word of words) {
      if (wordBuckets.has(word)) {
        wordBuckets.get(word)!.push(r);
        placed = true;
        break;
      }
    }
    if (!placed && words.length > 0) {
      wordBuckets.set(words[0], [r]);
    }
  }
  const clusters: { name: string; items: any[] }[] = [];
  const used = new Set<string>();
  for (const [word, items] of wordBuckets) {
    if (items.length < 2 || used.has(items.map((i: any) => i.topic).join('|'))) continue;
    const key = items.map((i: any) => i.topic).sort().join('|');
    if (used.has(key)) continue;
    used.add(key);
    clusters.push({ name: word.charAt(0).toUpperCase() + word.slice(1), items });
  }
  return clusters.sort((a, b) => b.items.length - a.items.length).slice(0, 6);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return u.hostname + path;
  } catch {
    return url.replace(/\/+$/, '') || '/';
  }
}

function findInternalLinkOpportunities(recs: any[], pages: any[], linkGraph: Map<string, Set<string>>): { from: string; to: string; reason: string }[] {
  const opps: { from: string; to: string; reason: string }[] = [];
  const used = new Set<string>();
  for (const r of recs) {
    const topicWords = r.topic.toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length > 3);
    const matchingPages = pages.filter((p: any) => {
      const title = (p.title ?? '').toLowerCase();
      const slug = (p.url ?? '').toLowerCase();
      return topicWords.some((w: string) => title.includes(w) || slug.includes(w));
    });
    if (matchingPages.length < 2) continue;
    for (let i = 0; i < matchingPages.length; i++) {
      for (let j = i + 1; j < matchingPages.length; j++) {
        const a = normalizeUrl(matchingPages[i].url);
        const b = normalizeUrl(matchingPages[j].url);
        const key = [a, b].sort().join('|');
        if (used.has(key)) continue;
        const aLinks = linkGraph.get(a) ?? new Set();
        const bLinks = linkGraph.get(b) ?? new Set();
        if (aLinks.has(b) || bLinks.has(a)) continue;
        used.add(key);
        const fromTitle = matchingPages[i].title || matchingPages[i].url;
        const toTitle = matchingPages[j].title || matchingPages[j].url;
        opps.push({
          from: fromTitle.length > 40 ? fromTitle.slice(0, 40) + '…' : fromTitle,
          to: toTitle.length > 40 ? toTitle.slice(0, 40) + '…' : toTitle,
          reason: `Both relate to "${r.topic}" but don't link to each other`,
        });
        if (opps.length >= 8) return opps;
      }
    }
  }
  return opps;
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
    if (data.reason === 'PRO_REQUIRED') {
      setModuleStatus(mod, 'Pro only', 'slate');
      setModuleBody(mod, `<div class="text-xs text-slate-500">${esc(data.message ?? 'Reddit Intelligence is a Pro feature.')}</div>`);
      return;
    }
    if (data.reason === 'WEEKLY_LIMIT' || data.reason === 'MONTHLY_LIMIT') {
      setModuleStatus(mod, 'Limit reached', 'amber');
      setModuleBody(mod, `<div class="text-xs text-amber-700">${esc(data.message ?? 'Reddit scan limit reached.')}</div>`);
      return;
    }
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

// --- Reddit Intelligence full report ---
async function loadRedditReport(crawlId: string) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (content) content.classList.add('hidden');
  try {
    const r = await apiFetch(`/api/crawls/${crawlId}/reddit-opportunities`);
    if (!r.ok) throw await beErr(r);
    const data = await r.json();
    renderRedditReport(data);
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    if (error) {
      error.classList.remove('hidden');
      const msg = $('report-error-msg');
      if (msg) msg.textContent = e instanceof Error ? e.message : 'Failed to load report.';
    }
  }
}

function renderRedditReport(data: Record<string, any>) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.add('hidden');
  if (error) error.classList.add('hidden');

  const disc: any[] = data?.discussions ?? [];
  const topicsAnalyzed = data?.topicsAnalyzed ?? 0;

  if (data.status === 'unavailable') {
    if (content) {
      content.classList.remove('hidden');
      content.innerHTML = `
        <div class="flex flex-col items-center gap-4">
          <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
            <div class="text-sm text-slate-500">${esc(data.message ?? 'Reddit Intelligence is unavailable.')}</div>
          </div>
        </div>`;
      content.querySelector('.btn-back-dashboard')?.addEventListener('click', () => { showView('dashboard'); void loadDashboard(currentProject!); });
    }
    return;
  }

  const high = disc.filter((d: any) => d.priority === 'high');
  const medium = disc.filter((d: any) => d.priority === 'medium');
  const low = disc.filter((d: any) => d.priority === 'low');

  // Theme extraction: group by subreddit
  const subredditCounts = new Map<string, any[]>();
  for (const d of disc) {
    const sub = d.subreddit ?? 'unknown';
    if (!subredditCounts.has(sub)) subredditCounts.set(sub, []);
    subredditCounts.get(sub)!.push(d);
  }

  const sections: string[] = [];

  // --- SECTION 1: Reddit Intelligence Overview ---
  sections.push(`
    <div class="mb-8">
      <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Reddit Intelligence Overview</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-orange-600">${disc.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Conversations</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-slate-600">${topicsAnalyzed}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Topics Analyzed</div>
        </div>
        <div class="bg-white rounded-xl border border-rose-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-rose-600">${high.length}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">High Priority</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div class="text-2xl font-extrabold text-slate-400">${subredditCounts.size}</div>
          <div class="text-[11px] font-semibold text-slate-500 mt-1">Communities</div>
        </div>
      </div>
      <div class="mt-4 bg-orange-50 rounded-xl border border-orange-200/80 p-4">
        <p class="text-sm text-orange-900 leading-relaxed">
          VerseSEO analyzed <strong>${disc.length} Reddit conversations</strong> across ${subredditCounts.size} communities
          ${high.length > 0 ? `. <strong>${high.length} high-priority</strong> opportunities identified.` : ''}
          These conversations reveal what real users are discussing about topics related to your website.
        </p>
      </div>
    </div>`);

  // --- SECTION 2: What People Are Talking About ---
  if (subredditCounts.size > 0) {
    const themeCards = [...subredditCounts.entries()].map(([sub, items]) => {
      const highCount = items.filter((d: any) => d.priority === 'high').length;
      const pct = disc.length > 0 ? Math.round((items.length / disc.length) * 100) : 0;
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-bold text-orange-600">r/${esc(sub)}</span>
            <span class="text-[10px] font-bold text-slate-400">${items.length} conversation${items.length > 1 ? 's' : ''} · ${pct}%</span>
          </div>
          ${highCount > 0 ? `<div class="text-[10px] font-bold text-rose-600 mb-1">${highCount} high priority</div>` : ''}
          <div class="space-y-1">${items.slice(0, 3).map((d: any) => `<div class="text-xs text-slate-600 truncate">${esc((d.postTitle ?? '').slice(0, 60))}</div>`).join('')}</div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">What People Are Talking About</h2>
        <p class="text-xs text-slate-500 mb-4">Communities where relevant discussions are happening.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${themeCards}</div>
      </div>`);
  }

  // --- SECTION 3: Top Pain Points ---
  if (high.length > 0 || medium.length > 0) {
    const painPoints = [...high, ...medium].slice(0, 6).map((d: any) => {
      const priorityColor = d.priority === 'high' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-amber-100 text-amber-700 border-amber-200';
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityColor}">${d.priority.toUpperCase()}</span>
            <span class="text-[10px] text-slate-400">r/${esc(d.subreddit)}</span>
          </div>
          <h3 class="text-sm font-bold text-slate-900 mb-1">${esc(d.postTitle)}</h3>
          <p class="text-xs text-slate-500 leading-relaxed">${esc(d.bodySnippet ?? 'No discussion text available.')}</p>
          <div class="mt-2 text-[10px] text-slate-400">${esc(d.reason ?? '')}</div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Top Pain Points</h2>
        <div class="space-y-3">${painPoints}</div>
      </div>`);
  }

  // --- SECTION 4: Customer Language ---
  if (disc.length > 0) {
    const phrases = disc.slice(0, 8).map((d: any) => {
      const words = (d.postTitle ?? '').split(/\s+/).filter((w: string) => w.length > 3).slice(0, 4);
      return words.join(' ');
    }).filter((p: string) => p.length > 5);
    const uniquePhrases = [...new Set(phrases)].slice(0, 8);
    const chips = uniquePhrases.map((p: string) =>
      `<span class="inline-block px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-700 font-medium">${esc(p)}</span>`
    ).join(' ');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-1">Customer Language</h2>
        <p class="text-xs text-slate-500 mb-3">How real Reddit users describe their problems.</p>
        <div class="flex flex-wrap gap-2">${chips}</div>
      </div>`);
  }

  // --- SECTION 5: Reddit Conversations ---
  if (disc.length > 0) {
    const convos = disc.map((d: any, i: number) => {
      const priorityColor = d.priority === 'high' ? 'bg-rose-100 text-rose-700 border-rose-200' : d.priority === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200';
      const postUrl = d.postUrl || `https://www.reddit.com${d.permalink}`;
      const comments = Array.isArray(d.comments) ? d.comments : [];
      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                <span class="text-[11px] font-bold text-slate-400">#${i + 1}</span>
                <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityColor}">${d.priority.toUpperCase()}</span>
                <span class="inline-block px-1.5 py-0.5 bg-orange-100 rounded text-[10px] font-medium text-orange-700">r/${esc(d.subreddit)}</span>
              </div>
              <h3 class="text-sm font-bold text-slate-900 leading-snug">${esc(d.postTitle)}</h3>
            </div>
          </div>
          ${d.bodySnippet ? `<p class="text-xs text-slate-500 mt-2 leading-relaxed">${esc(d.bodySnippet)}</p>` : ''}
          ${comments.length > 0 ? `<div class="mt-3 space-y-1.5">${comments.slice(0, 3).map((c: any) => `<div class="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5">"${esc((c.body ?? '').slice(0, 150))}${(c.body ?? '').length > 150 ? '…' : ''}"</div>`).join('')}</div>` : ''}
          <div class="flex items-center gap-3 mt-3 text-[10px] text-slate-400">
            <span>Score: ${d.opportunityScore}</span>
            ${d.score > 0 ? `<span>${d.score} upvotes</span>` : ''}
            ${d.numComments > 0 ? `<span>${d.numComments} comments</span>` : ''}
          </div>
          <div class="mt-2"><a href="${esc(postUrl)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition">View discussion →</a></div>
        </div>`;
    }).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Reddit Conversations</h2>
        <div class="space-y-3">${convos}</div>
      </div>`);
  }

  // --- SECTION 6: What This Means for Your Website ---
  if (disc.length > 0) {
    const insights = disc.filter((d: any) => d.priority === 'high').slice(0, 4).map((d: any) => `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-6 h-6 rounded bg-indigo-100 flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <span class="text-sm font-bold text-slate-900">${esc(d.topic)}</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">${esc(d.reason)}</p>
      </div>`).join('');

    if (insights) {
      sections.push(`
        <div class="mb-8">
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">What This Means for Your Website</h2>
          <div class="space-y-3">${insights}</div>
        </div>`);
    }
  }

  // --- SECTION 7: Content Opportunities ---
  if (high.length > 0) {
    const contentOpps = high.slice(0, 4).map((d: any) => `
      <div class="bg-white rounded-xl border border-indigo-200 shadow-sm p-4">
        <div class="text-[11px] font-bold text-indigo-600 uppercase mb-1">Content Opportunity</div>
        <h3 class="text-sm font-bold text-slate-900 mb-1">${esc(d.topic)}</h3>
        <p class="text-xs text-slate-500 leading-relaxed mb-2">${esc(d.reason)}</p>
        <div class="text-[10px] text-slate-400">Found across ${disc.filter((x: any) => x.topic === d.topic).length} of ${disc.length} analyzed conversations</div>
      </div>`).join('');

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Content Opportunities</h2>
        <div class="space-y-3">${contentOpps}</div>
      </div>`);
  }

  // --- SECTION 8: Key Takeaways ---
  if (disc.length > 0) {
    const takeaways = [
      high.length > 0 ? `${high.length} high-priority conversation${high.length > 1 ? 's' : ''} with strong relevance to your topics` : null,
      `${subredditCounts.size} distinct communit${subredditCounts.size > 1 ? 'ies' : 'y'} where your audience discusses related topics`,
      disc.length > 0 ? `Real user language and pain points extracted from actual discussions` : null,
    ].filter(Boolean);

    sections.push(`
      <div class="mb-8">
        <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Key Takeaways</h2>
        <div class="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl border border-orange-200/80 p-5">
          <ul class="space-y-2">${takeaways.map((t: string) => `<li class="flex items-start gap-2 text-sm text-orange-900"><svg class="w-4 h-4 text-orange-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>${t}</li>`).join('')}</ul>
        </div>
      </div>`);
  }

  // --- Empty state ---
  if (disc.length === 0) {
    sections.push(`
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center mb-8">
        <div class="text-sm text-slate-500">No relevant Reddit discussions found for this scan.</div>
      </div>`);
  }

  // --- Back button support removed: consolidated to top btn-back-dashboard ---

  if (content) {
    content.classList.remove('hidden');
    content.innerHTML = `
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Reddit Intelligence Report</h1>
          <p class="text-xs text-slate-500 mt-1">${disc.length} conversations across ${subredditCounts.size} communities · ${topicsAnalyzed} topics analyzed</p>
        </div>
        <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
      </div>
      ${sections.join('')}
    `;
    content.querySelector('.btn-back-dashboard')?.addEventListener('click', () => {
      showView('dashboard');
      window.history.replaceState({}, '', '/app');
    });
  }
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
    reddit: currentUser && currentUser.plan !== 'pro'
      ? ['Pro only', 'slate', '<span class="text-xs text-slate-500">Reddit Intelligence is a Pro feature.</span> <a href="/pricing" class="text-[11px] font-semibold text-violet-600 hover:text-violet-700 underline">Upgrade to Pro</a>']
      : ['Awaiting scan', 'slate', 'Run a scan to find Reddit discussions.'],
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
  const isPro = currentUser?.plan === 'pro';
  const mods = isPro ? ['search', 'reddit', 'ai', 'content'] : ['search', 'ai', 'content'];
  for (const m of mods) renderProcessing(m, modProcessingMsgs[m]);

  // Load technical from crawl results
  try {
    const r = await apiFetch(`/api/crawls/${crawlId}/results`);
    if (!r.ok) throw await beErr(r);
    renderTechResult(await r.json());
  } catch (e) { renderTechError(e instanceof Error ? e.message : 'Failed to load results.'); }

  // Load other modules in parallel
  const fetches = mods.map(async (m) => {
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
  const btn = $('btn-run-scan') as HTMLButtonElement | null;
  const btnText = $('btn-scan-text');

  // Reset scan button to default state
  if (btn) {
    btn.className = 'inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-blue-600/20 transition-colors cursor-pointer';
    btn.disabled = false;
  }
  if (btnText) btnText.textContent = 'Run New Scan';

  // Check free plan scan status
  if (currentUser && currentUser.plan !== 'pro') {
    try {
      const statusRes = await apiFetch('/api/user/scan-status');
      if (statusRes.ok) {
        const status = await statusRes.json();
        if (!status.canScan && btn && btnText) {
          btn.className = 'inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-indigo-600/20 transition-colors cursor-pointer';
          btnText.textContent = 'Upgrade to Pro';
          btn.onclick = () => { window.location.href = '/pricing'; };
        }
      }
    } catch { /* proceed normally */ }
  }

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
  // Check free plan scan limit
  if (currentUser && currentUser.plan !== 'pro') {
    try {
      const statusRes = await apiFetch('/api/user/scan-status');
      if (statusRes.ok) {
        const status = await statusRes.json();
        if (!status.canScan) {
          const scanStatus = $('dash-scan-status');
          if (scanStatus) scanStatus.innerHTML = '<span class="text-amber-600 text-xs font-semibold">Free plan limit reached</span>';
          const btn = $('btn-run-scan') as HTMLButtonElement | null;
          if (btn) {
            btn.className = 'inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-indigo-600/20 transition-colors cursor-pointer';
            const btnText = $('btn-scan-text');
            if (btnText) btnText.textContent = 'Upgrade to Pro';
            btn.onclick = () => { window.location.href = '/pricing'; };
            btn.disabled = false;
            btn.classList.remove('opacity-60', 'cursor-wait');
          }
          return;
        }
      }
    } catch { /* proceed with scan if status check fails */ }
  }

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
$('modal-create')?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-modal-panel]')) return; closeCreateModal(); });

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
      const err = await beErr(r);
      if (err.code === 'PROJECT_LIMIT_REACHED') {
        showBanner($('create-error'), `You've reached your Free plan project limit. Free accounts can have 1 project. <a href="/pricing" class="underline text-blue-600 hover:text-blue-800">Upgrade to Pro</a> to create another project.`); return;
      }
      showBanner($('create-error'), err.message); return;
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
$('modal-rename')?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-modal-panel]')) return; closeRenameModal(); });
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
$('modal-delete')?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-modal-panel]')) return; closeDeleteModal(); });
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

// --- Delete account ---
function openDeleteAccountModal() { hideBanner($('delete-account-error')); $('modal-delete-account')?.classList.remove('hidden'); }
function closeDeleteAccountModal() { $('modal-delete-account')?.classList.add('hidden'); }
$('btn-delete-account')?.addEventListener('click', openDeleteAccountModal);
$('btn-delete-account-cancel')?.addEventListener('click', closeDeleteAccountModal);
$('modal-delete-account')?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-modal-panel]')) return; closeDeleteAccountModal(); });
$('btn-delete-account-submit')?.addEventListener('click', async () => {
  hideBanner($('delete-account-error'));
  const btn = $('btn-delete-account-submit') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    const r = await apiFetch('/api/account', { method: 'DELETE' });
    if (!r.ok) { if (r.status === 401) { window.location.replace('/login?next=/app'); return; } showBanner($('delete-account-error'), (await beErr(r)).message); if (btn) { btn.disabled = false; btn.textContent = 'Delete account'; } return; }
    window.location.href = '/';
  } catch { showBanner($('delete-account-error'), 'Could not reach the backend.'); if (btn) { btn.disabled = false; btn.textContent = 'Delete account'; } }
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
    if (report === 'technical') {
      showView('report');
      window.history.replaceState({}, '', `/app?view=technical&crawlId=${currentCrawlId}`);
      void loadTechnicalReport(currentCrawlId);
    } else if (report === 'search') {
      showView('search-report');
      window.history.replaceState({}, '', `/app?view=search&crawlId=${currentCrawlId}`);
      void loadSearchReport(currentCrawlId);
    } else if (report === 'ai') {
      showView('ai-report');
      window.history.replaceState({}, '', `/app?view=ai&crawlId=${currentCrawlId}`);
      void loadAiReport(currentCrawlId);
    } else if (report === 'content') {
      showView('content-report');
      window.history.replaceState({}, '', `/app?view=content&crawlId=${currentCrawlId}`);
      void loadContentReport(currentCrawlId);
    } else if (report === 'reddit') {
      showView('reddit-report');
      window.history.replaceState({}, '', `/app?view=reddit&crawlId=${currentCrawlId}`);
      void loadRedditReport(currentCrawlId);
    } else {
      window.open(`/app?view=${report}&crawlId=${currentCrawlId}`, '_self');
    }
  });
});

// --- Logout ---
async function logout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
  window.location.href = '/';
}

// --- Settings ---
async function loadSettings() {
  const loading = $('settings-loading');
  const content = $('settings-content');
  if (loading) loading.classList.remove('hidden');
  if (content) content.classList.add('hidden');

  try {
    const r = await apiFetch('/api/account');
    if (!r.ok) throw new Error('Failed to load account');
    const data = await r.json();

    // Account
    const emailEl = $('settings-email');
    if (emailEl) emailEl.textContent = data.user.email;
    const joinEl = $('settings-join-date');
    if (joinEl) joinEl.textContent = new Date(data.user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Plan
    const planLabel = $('settings-plan-label');
    const planBadge = $('settings-plan-badge');
    const planDesc = $('settings-plan-desc');
    const upgradeBtn = $('settings-upgrade-btn');
    const isPro = data.plan === 'pro';
    if (planLabel) planLabel.textContent = isPro ? 'Pro' : 'Free';
    if (planBadge) {
      planBadge.textContent = isPro ? 'Active' : 'Free';
      planBadge.className = isPro
        ? 'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-indigo-50 text-indigo-700 border-indigo-100'
        : 'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-slate-50 text-slate-500 border-slate-200';
    }
    if (planDesc) planDesc.textContent = isPro
      ? 'Unlimited projects, all modules, Reddit Intelligence.'
      : '1 project, 1 scan, limited modules, no Reddit Intelligence.';
    if (upgradeBtn) {
      if (isPro) {
        upgradeBtn.textContent = 'Current plan';
        upgradeBtn.classList.add('bg-slate-100', 'text-slate-500', 'pointer-events-none');
        upgradeBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700', 'text-white');
      }
    }

    // Usage
    const isFree = !isPro;
    const projectLimit = isPro ? '∞' : '1';
    const scanLimit = isPro ? '∞' : '1';
    const projectsUsed = $('settings-projects-used');
    const projectsLimit = $('settings-projects-limit');
    const projectsBar = $('settings-projects-bar');
    const scansUsed = $('settings-scans-used');
    const scansLimit = $('settings-scans-limit');
    const scansBar = $('settings-scans-bar');
    if (projectsUsed) projectsUsed.textContent = String(data.projectCount);
    if (projectsLimit) projectsLimit.textContent = projectLimit;
    if (projectsBar) {
      const pct = isPro ? 0 : Math.min(100, (data.projectCount / 1) * 100);
      projectsBar.style.width = `${pct}%`;
      if (!isPro && data.projectCount >= 1) projectsBar.classList.replace('bg-blue-400', 'bg-rose-400');
    }
    if (scansUsed) scansUsed.textContent = String(data.totalScans);
    if (scansLimit) scansLimit.textContent = scanLimit;
    if (scansBar) {
      const pct = isPro ? 0 : Math.min(100, (data.totalScans / 1) * 100);
      scansBar.style.width = `${pct}%`;
      if (!isPro && data.totalScans >= 1) scansBar.classList.replace('bg-blue-400', 'bg-rose-400');
    }

    // Reddit usage (Pro only)
    const redditUsage = $('settings-reddit-usage');
    if (redditUsage && isPro) {
      redditUsage.classList.remove('hidden');
      const ru = data.redditUsage;

      const renewal = $('settings-reddit-weekly-renewal');
      if (renewal) {
        const now = new Date();
        const day = now.getUTCDay();
        const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
        const nextMonday = new Date(now);
        nextMonday.setUTCDate(now.getUTCDate() + daysUntilNextMonday);
        nextMonday.setUTCHours(0, 0, 0, 0);

        renewal.textContent = `Renews ${nextMonday.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC'
        })}`;
      }

      const rWeekUsed = $('settings-reddit-weekly-used');
      const rWeekLimit = $('settings-reddit-weekly-limit');
      const rWeekBar = $('settings-reddit-weekly-bar');
      const rWeekRenewal = $('settings-reddit-weekly-renewal');
      if (rWeekRenewal) {
        const now = new Date();
        const daysUntilMonday = now.getUTCDay() === 0 ? 1 : 8 - now.getUTCDay();
        const nextMonday = new Date(now);
        nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
        rWeekRenewal.textContent = `Renews ${nextMonday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      }
      const rMonthUsed = $('settings-reddit-monthly-used');
      const rMonthLimit = $('settings-reddit-monthly-limit');
      const rMonthBar = $('settings-reddit-monthly-bar');
      if (rWeekUsed) rWeekUsed.textContent = String(ru.weeklyScansUsed);
      if (rWeekLimit) rWeekLimit.textContent = String(ru.weeklyScansLimit);
      if (rWeekBar) rWeekBar.style.width = `${Math.min(100, (ru.weeklyScansUsed / ru.weeklyScansLimit) * 100)}%`;
      if (rMonthUsed) rMonthUsed.textContent = String(ru.monthlyScansUsed);
      if (rMonthLimit) rMonthLimit.textContent = String(ru.monthlyScansLimit);
      if (rMonthBar) rMonthBar.style.width = `${Math.min(100, (ru.monthlyScansUsed / ru.monthlyScansLimit) * 100)}%`;
    }

    // Projects list
    const projectsList = $('settings-projects-list');
    if (projectsList) {
      if (projects.length === 0) {
        projectsList.innerHTML = '<div class="p-5 text-sm text-slate-400">No projects yet.</div>';
      } else {
        projectsList.innerHTML = projects.map(p => `
          <div class="p-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-900 truncate">${esc(p.name || p.domain)}</div>
              <div class="text-xs text-slate-500 font-mono truncate">${esc(p.domain)} · ${p.scanCount} scan${p.scanCount !== 1 ? 's' : ''}</div>
            </div>
            <button type="button" data-settings-project="${esc(p.id)}" class="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer">Open →</button>
          </div>
        `).join('');
        projectsList.querySelectorAll('[data-settings-project]').forEach(btn => {
          btn.addEventListener('click', () => {
            const pid = (btn as HTMLElement).dataset.settingsProject;
            const proj = projects.find(p => p.id === pid);
            if (proj) {
              currentProject = proj;
              currentCrawlId = proj.latestScan?.id ?? null;
              showView('dashboard');
            }
          });
        });
      }
    }

    if (loading) loading.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load settings', err);
    if (loading) loading.innerHTML = '<p class="text-sm text-rose-600">Failed to load account data.</p>';
  }
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

  // Handle URL parameters for direct access
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const crawlIdParam = params.get('crawlId');

  // Handle post-signup website parameter: auto-open create modal with prefilled URL
  const websiteParam = params.get('website');
  if (websiteParam) {
    const cleanUrl = websiteParam.startsWith('http') ? websiteParam : `https://${websiteParam}`;
    params.delete('website');
    const newSearch = params.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    const urlInput = $('input-create-url') as HTMLInputElement | null;
    if (urlInput) urlInput.value = cleanUrl;
    openCreateModal();
    return;
  }

  // Handle view=technical, view=search, view=ai, view=content, or view=reddit report direct access
  if ((viewParam === 'technical' || viewParam === 'search' || viewParam === 'ai' || viewParam === 'content' || viewParam === 'reddit') && crawlIdParam) {
    let matchedProject = projects.find(p => p.latestScan?.id === crawlIdParam);
    if (!matchedProject) {
      try {
        const cr = await apiFetch(`/api/crawls/${crawlIdParam}`);
        if (cr.ok) {
          const crawl = await cr.json();
          matchedProject = projects.find(p => p.id === crawl.projectId) ?? (projects.length > 0 ? projects[0] : null);
        }
      } catch { /* ignore */ }
    }
    if (matchedProject) {
      currentProject = matchedProject;
    }
    currentCrawlId = crawlIdParam;
    if (viewParam === 'search') {
      showView('search-report');
      void loadSearchReport(crawlIdParam);
    } else if (viewParam === 'ai') {
      showView('ai-report');
      void loadAiReport(crawlIdParam);
    } else if (viewParam === 'content') {
      showView('content-report');
      void loadContentReport(crawlIdParam);
    } else if (viewParam === 'reddit') {
      showView('reddit-report');
      void loadRedditReport(crawlIdParam);
    } else {
      showView('report');
      void loadTechnicalReport(crawlIdParam);
    }
  }
}

window.addEventListener('foundable:scan-complete', () => void loadProjects());

// --- Browser back/forward ---
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const crawlIdParam = params.get('crawlId');
  if (viewParam && crawlIdParam) {
    currentCrawlId = crawlIdParam;
    if (viewParam === 'technical') { showView('report'); void loadTechnicalReport(crawlIdParam); }
    else if (viewParam === 'search') { showView('search-report'); void loadSearchReport(crawlIdParam); }
    else if (viewParam === 'ai') { showView('ai-report'); void loadAiReport(crawlIdParam); }
    else if (viewParam === 'content') { showView('content-report'); void loadContentReport(crawlIdParam); }
    else if (viewParam === 'reddit') { showView('reddit-report'); void loadRedditReport(crawlIdParam); }
  } else if (!viewParam) {
    if (currentProject) showView('dashboard');
    else { showView('projects'); void loadProjects(); }
  }
});

async function loadHistoryReport(projectId: string) {
  const loading = $('report-loading');
  const error = $('report-error');
  const content = $('report-content');
  if (loading) loading.classList.remove('hidden');
  if (error) error.classList.add('hidden');
  if (content) content.classList.add('hidden');

  try {
    const [scansRes, accountRes] = await Promise.all([
      apiFetch(`/api/projects/${projectId}/scans`),
      apiFetch('/api/account'),
    ]);
    if (!scansRes.ok) throw await beErr(scansRes);
    const scansData = await scansRes.json();
    const scans: ScanSnapshot[] = (scansData.scans ?? []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let accountData: any = null;
    if (accountRes.ok) accountData = await accountRes.json();

    const isPro = accountData?.plan === 'pro';
    const totalScans = accountData?.totalScans ?? 0;
    const ru = accountData?.redditUsage ?? null;

    if (content) {
      content.classList.remove('hidden');
      content.innerHTML = `
        <div class="mb-6 flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Usage & Scans</h1>
            <p class="text-sm text-slate-500 mt-1">Track your scan usage and website scan activity across your projects.</p>
          </div>
          <button type="button" class="btn-back-dashboard px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">← Back to Dashboard</button>
        </div>

        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 class="text-sm font-bold text-slate-900 mb-4">Website Scan Usage</h2>
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-slate-600">Scans</span>
                <span class="text-xs font-semibold text-slate-900">${isPro ? 'Unlimited' : esc(String(totalScans) + ' / 1 lifetime')}</span>
              </div>
              ${!isPro ? `<div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full ${totalScans >= 1 ? 'bg-rose-400' : 'bg-blue-400'} transition-all" style="width: ${Math.min(100, (totalScans / 1) * 100)}%"></div>
              </div>
              <p class="text-[11px] text-slate-400 mt-1">Free plan: 1 scan lifetime limit.</p>` : '<p class="text-[11px] text-slate-400 mt-1">Pro plan: unlimited scans.</p>'}
            </div>
          </div>

          <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 class="text-sm font-bold text-slate-900 mb-4">Reddit Intelligence</h2>
            ${!isPro
              ? `<div class="flex flex-col items-center justify-center py-6 text-center">
                  <div class="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mb-3">
                    <svg class="w-5 h-5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  </div>
                  <p class="text-sm font-semibold text-slate-700 mb-1">Pro only</p>
                  <p class="text-xs text-slate-500 mb-3">Upgrade to Pro to access Reddit Intelligence.</p>
                  <a href="/pricing" class="inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors">Upgrade to Pro</a>
                </div>`
              : `<div class="space-y-4">
                  <div>
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="text-xs text-slate-600">This Week</span>
                      <span class="text-xs font-semibold text-slate-900">${ru ? esc(String(ru.weeklyScansUsed)) : '0'} / ${ru ? esc(String(ru.weeklyScansLimit)) : '2'}</span>
                    </div>
                    <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div class="h-full rounded-full bg-orange-400 transition-all" style="width: ${ru ? Math.min(100, (ru.weeklyScansUsed / ru.weeklyScansLimit) * 100) + '%' : '0%'}"></div>
                    </div>
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="text-xs text-slate-600">This Month</span>
                      <span class="text-xs font-semibold text-slate-900">${ru ? esc(String(ru.monthlyScansUsed)) : '0'} / ${ru ? esc(String(ru.monthlyScansLimit)) : '8'}</span>
                    </div>
                    <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div class="h-full rounded-full bg-orange-400 transition-all" style="width: ${ru ? Math.min(100, (ru.monthlyScansUsed / ru.monthlyScansLimit) * 100) + '%' : '0%'}"></div>
                    </div>
                  </div>
                </div>`
            }
          </div>
        </div>

        <div>
          <h2 class="text-lg font-extrabold text-slate-900 tracking-tight mb-4">Scan History</h2>
          ${scans.length === 0
            ? `<div class="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
                <p class="text-sm font-semibold text-slate-700 mb-1">No scans yet.</p>
                <p class="text-xs text-slate-500">Run a website scan to see your scan history here.</p>
              </div>`
            : `<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table class="w-full text-left">
                  <thead>
                    <tr class="border-b border-slate-100 bg-slate-50/60">
                      <th class="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Project</th>
                      <th class="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th class="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                      <th class="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pages Crawled</th>
                      <th class="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${scans.map((s: any) => {
                      const domain = esc(currentProject?.domain ?? '');
                      const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'Unknown date';
                      const pages = s.pagesCrawled != null ? esc(String(s.pagesCrawled)) : '—';
                      let statusHtml = '';
                      let actionHtml = '';
                      if (s.status === 'COMPLETED') {
                        statusHtml = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">Completed</span>';
                        actionHtml = `<a href="#" class="text-blue-600 text-xs font-semibold hover:text-blue-800 transition view-project-btn" data-crawl-id="${s.id}">View Report →</a>`;
                      } else if (s.status === 'FAILED') {
                        statusHtml = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100">Failed</span>';
                        actionHtml = `<span class="text-slate-400 text-xs">—</span>`;
                      } else {
                        statusHtml = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-100">Running</span>';
                        actionHtml = `<span class="text-slate-400 text-xs italic">In progress</span>`;
                      }
                      return `<tr class="hover:bg-slate-50/50 transition-colors">
                        <td class="px-4 py-3 text-sm font-medium text-slate-900">${domain}</td>
                        <td class="px-4 py-3">${statusHtml}</td>
                        <td class="px-4 py-3 text-xs text-slate-500">${esc(date)}</td>
                        <td class="px-4 py-3 text-xs text-slate-500">${pages}</td>
                        <td class="px-4 py-3">${actionHtml}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>`
          }
        </div>
      `;
      content.querySelectorAll('.view-project-btn').forEach(b => {
        b.addEventListener('click', (e) => {
          e.preventDefault();
          const crawlId = (e.target as HTMLElement).dataset.crawlId;
          showView('report');
          window.history.replaceState({}, '', `/app?view=technical&crawlId=${crawlId}`);
          void loadTechnicalReport(crawlId);
        });
      });
      content.querySelectorAll('.btn-back-dashboard').forEach(b => {
        b.addEventListener('click', () => {
          showView('dashboard');
          window.history.replaceState({}, '', '/app');
        });
      });
    }
  } catch (err) {
    console.error('Failed to load usage & scans', err);
    if (error) error.innerHTML = '<p class="text-sm text-rose-600">Failed to load usage data.</p>';
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

showView('projects');
void init();
