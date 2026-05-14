import { getBrowser } from './leetcode/util.js';
import {
  PATTERNS,
  patternUrl,
  getWeeklyPatternProgress,
  toggleManualTick,
  autoTickedPatterns,
  computeRotationSuggestion,
  getActivePattern,
  setActivePattern,
  getProblemsSolvedOn,
  bucketActivity,
  todayISO,
  weekStartISO,
  localDateOf,
} from './leetcode/weeklyPatterns.js';
import { backfillFromRepo } from './leetcode/repoBackfill.js';
import { APP, installUrl, getValidToken, githubFetch } from './githubApp.js';

const api = getBrowser();

// ============================================================
// Setup flow — Device Flow auth → install GitHub App → pick repo
// ============================================================
function showError(html) {
  $('#success_banner').hide();
  $('#error_banner').html(html).show();
}

function showSuccess(html) {
  $('#error_banner').hide();
  $('#success_banner').html(html).show();
}

const syncStats = async () => {
  const { algorep_hook, sync_stats } = await api.storage.local.get(['algorep_hook', 'sync_stats']);
  if (sync_stats === false || !algorep_hook) return;

  const resp = await githubFetch(`/repos/${algorep_hook}/contents/stats.json`);
  if (!resp.ok) {
    if (resp.status === 404) await api.storage.local.set({ sync_stats: false });
    return {};
  }
  const data = await resp.json();
  const pStats = JSON.parse(decodeURIComponent(escape(atob(data.content))));
  api.storage.local.set({ stats: pStats.leetcode, sync_stats: false });
  return { stats: pStats.leetcode };
};

// Verify the saved hook still exists for the current installation. Used on boot
// to catch the case where the user uninstalled AlgoRep from that repo.
async function verifyHook(hook) {
  const res = await githubFetch(`/repos/${hook}`);
  return res.ok;
}

async function listInstalledRepos() {
  const insts = await githubFetch('/user/installations');
  if (!insts.ok) throw new Error(`installations_${insts.status}`);
  const { installations } = await insts.json();
  const ours = installations.filter(i => i.app_id != null);
  // Surface the first AlgoRep installation we find. The app is single-tenant
  // (one install per user account) so this is sufficient.
  if (ours.length === 0) return { installationId: null, repos: [] };

  const installationId = ours[0].id;
  await api.storage.local.set({ algorep_installation_id: installationId });

  const repos = [];
  let page = 1;
  while (true) {
    const res = await githubFetch(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`repositories_${res.status}`);
    const data = await res.json();
    repos.push(...data.repositories);
    if (data.repositories.length < 100) break;
    page += 1;
  }
  return { installationId, repos };
}

const unlinkRepo = async () => {
  await api.storage.local.set({ algorep_hook: null, mode_type: 'hook', sync_stats: true, stats: null });
  showSuccess('Unlinked. Pick another repo or install AlgoRep on more.');
  await routeToCurrentStep();
};

// ============================================================
// Theme toggle (persisted in chrome.storage.local under `theme`)
// ============================================================
const MOON = '☽';
const SUN = '☀';
function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('theme-light');
    $('#theme_toggle').html(SUN).attr('title', 'Switch to dark mode');
  } else {
    document.body.classList.remove('theme-light');
    $('#theme_toggle').html(MOON).attr('title', 'Switch to light mode');
  }
}
api.storage.local.get('theme', d => applyTheme(d?.theme || 'dark'));
$('#theme_toggle').on('click', () => {
  api.storage.local.get('theme', d => {
    const next = (d?.theme || 'dark') === 'dark' ? 'light' : 'dark';
    api.storage.local.set({ theme: next }, () => applyTheme(next));
  });
});

// ---------- Step 1: Device Flow ----------
let deviceFlowPort = null;

function showAuthStep() {
  $('#auth_step').show();
  $('#install_step, #pick_repo_step').hide();
  $('#device_code_panel').hide();
  $('#connect_github_btn').show().prop('disabled', false);
  $('#device_flow_status').hide();
}

function showInstallStep() {
  $('#auth_step, #pick_repo_step').hide();
  $('#install_step').show();
  $('#install_app_link').attr('href', installUrl());
}

function showPickStep() {
  $('#auth_step, #install_step').hide();
  $('#pick_repo_step').show();
  $('#install_app_link_more').attr('href', installUrl());
}

$('#connect_github_btn').on('click', async () => {
  $('#error_banner').hide();
  $('#success_banner').hide();
  $('#connect_github_btn').prop('disabled', true);
  $('#device_flow_status').text('Starting device flow...').show();

  // Hold a port open so the service worker stays alive while we poll GitHub.
  try { deviceFlowPort?.disconnect(); } catch (_) {}
  deviceFlowPort = api.runtime.connect({ name: 'device_flow' });

  try {
    const resp = await api.runtime.sendMessage({ type: 'START_DEVICE_FLOW' });
    if (!resp || resp.error || !resp.user_code) {
      throw new Error(resp?.error || 'no_response');
    }
    $('#user_code').text(resp.user_code);
    $('#device_open_link').attr('href', resp.verification_uri_complete || resp.verification_uri);
    $('#device_flow_status').hide();
    $('#device_code_panel').show();
    // Auto-open GitHub so the user just has to click Authorize.
    try { window.open(resp.verification_uri_complete || resp.verification_uri, '_blank'); } catch (_) {}
  } catch (e) {
    $('#device_flow_status').hide();
    $('#connect_github_btn').prop('disabled', false);
    showError(`Could not start device flow: ${e.message}`);
  }
});

$('#cancel_device_flow').on('click', async () => {
  await api.runtime.sendMessage({ type: 'CANCEL_DEVICE_FLOW' });
  try { deviceFlowPort?.disconnect(); } catch (_) {}
  deviceFlowPort = null;
  showAuthStep();
});

// React to the background's auth result via storage changes (works even if
// the SW restarted between the start of the poll and now).
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.auth_event) return;
  const evt = changes.auth_event.newValue;
  if (!evt) return;
  if (evt.type === 'success') {
    try { deviceFlowPort?.disconnect(); } catch (_) {}
    deviceFlowPort = null;
    showSuccess('Connected to GitHub.');
    await routeToCurrentStep();
  } else if (evt.type === 'error') {
    try { deviceFlowPort?.disconnect(); } catch (_) {}
    deviceFlowPort = null;
    const friendly = {
      access_denied: 'You denied the request on GitHub.',
      expired_token: 'The code expired before you authorized. Try again.',
      unsupported_grant_type: 'GitHub App isn’t configured for Device Flow.',
    };
    showError(friendly[evt.error] || `Auth failed: ${evt.error}`);
    showAuthStep();
  }
});

// ---------- Step 2: install ----------
$('#refresh_installs_btn').on('click', () => routeToCurrentStep());

// ---------- Step 3: pick repo ----------
async function populateRepoSelect() {
  const sel = $('#installed_repo_select');
  sel.empty().append('<option value="">Loading...</option>');
  $('#use_repo_btn').prop('disabled', true);
  try {
    const { repos } = await listInstalledRepos();
    sel.empty();
    if (repos.length === 0) {
      sel.append('<option value="">No repos selected during install</option>');
      return;
    }
    sel.append('<option value="">Pick a repository</option>');
    for (const r of repos) {
      sel.append(`<option value="${r.full_name}">${r.full_name}${r.private ? ' (private)' : ''}</option>`);
    }
  } catch (e) {
    sel.empty().append('<option value="">Error loading repos</option>');
    showError(`Couldn’t list repos: ${e.message}`);
  }
}

$('#installed_repo_select').on('change', function () {
  $('#use_repo_btn').prop('disabled', !this.value);
});

$('#use_repo_btn').on('click', async () => {
  const hook = $('#installed_repo_select').val();
  if (!hook) return;
  $('#error_banner').hide();
  showSuccess('Linking...');
  await api.storage.local.set({ algorep_hook: hook, mode_type: 'commit' });
  await api.storage.local.remove('stats');
  showSuccess(`Linked <a target="_blank" href="https://github.com/${hook}">${hook}</a>.`);
  const sync = await api.storage.local.get('sync_stats');
  if (sync?.sync_stats) { try { await syncStats(); } catch (_) {} }
  enterCommitMode();
});

$('#unlink_btn').on('click', unlinkRepo);

function enterHookMode() {
  $('#hook_mode').show();
  $('#commit_mode').hide();
  $('#brand_meta').hide();
}

function enterCommitMode() {
  $('#hook_mode').hide();
  $('#commit_mode').show();
  $('#brand_meta').show();
  $('#unlink_btn').show();
  loadDashboard();
}

// ============================================================
// Dashboard renderers
// ============================================================
let studyPlans = null;
async function loadStudyPlans() {
  if (studyPlans) return studyPlans;
  try {
    const url = api.runtime.getURL('data/studyPlans.json');
    studyPlans = await (await fetch(url)).json();
  } catch (e) { console.log('Could not load study plans:', e); }
  return studyPlans;
}

function renderHeader(hook, streakData) {
  if (hook) {
    $('#repo_link').show().text(hook).attr('href', `https://github.com/${hook}`);
  }
  if (streakData) {
    $('#streak_pill').show();
    $('#current_streak').text(streakData.currentStreak || 0);
    $('#longest_streak').text(streakData.longestStreak || 0);
  }
}

function renderStats(stats, submissionHistory) {
  $('#p_solved').text(stats?.solved ?? 0);
  $('#p_solved_easy').text(stats?.easy ?? 0);
  $('#p_solved_medium').text(stats?.medium ?? 0);
  $('#p_solved_hard').text(stats?.hard ?? 0);

  const today = todayISO();
  const weekStart = weekStartISO();
  const seenWeek = new Set();
  const seenToday = new Set();
  for (const recs of Object.values(submissionHistory || {})) {
    for (const r of recs || []) {
      const local = localDateOf(r);
      if (!local) continue;
      const slug = r.titleSlug || r.title;
      if (!slug) continue;
      if (local >= weekStart) seenWeek.add(slug);
      if (local === today) seenToday.add(slug);
    }
  }
  $('#week_count').text(seenWeek.size);
  $('#today_count_top').text(seenToday.size);
}

function renderTodayCard(submissionHistory, reviewQueue) {
  const today = todayISO();
  const todays = getProblemsSolvedOn(submissionHistory, today);
  $('#today_count').text(todays.length);

  const list = $('#today_list');
  list.empty();
  if (todays.length === 0) {
    list.append('<div class="empty-state">No solves yet today — pick a problem and go.</div>');
  } else {
    for (const p of todays) {
      const slug = p.titleSlug || (p.title || '').toLowerCase().replace(/\s+/g, '-');
      const url = `https://leetcode.com/problems/${slug}/`;
      const diffClass = (p.difficulty || '').toLowerCase();
      const lang = p.language ? `<span class="today-lang">${p.language}</span>` : '';
      list.append(`
        <a class="today-item" href="${url}" target="_blank" title="${p.title || slug}">
          <span class="today-title">${p.title || slug}</span>
          ${lang}
          <span class="today-diff ${diffClass}">${p.difficulty || ''}</span>
        </a>
      `);
    }
  }

  if (!reviewQueue || Object.keys(reviewQueue).length === 0) {
    $('#review_subsection').hide();
    return;
  }
  const todayUTC = new Date().toISOString().split('T')[0];
  const due = [];
  for (const [problemName, entry] of Object.entries(reviewQueue)) {
    if (entry.nextReview <= todayUTC) due.push({ problemName, ...entry });
  }
  if (due.length === 0) { $('#review_subsection').hide(); return; }
  due.sort((a, b) => (a.nextReview > b.nextReview ? 1 : -1));
  $('#review_subsection').show();
  $('#review_count').text(due.length);

  const reviewEl = $('#review_list');
  reviewEl.empty();
  for (const item of due.slice(0, 8)) {
    const slug = item.titleSlug || item.problemName;
    const url = `https://leetcode.com/problems/${slug}/`;
    const diffClass = (item.difficulty || '').toLowerCase();
    reviewEl.append(`
      <a class="review-item" href="${url}" target="_blank">
        <span class="review-title">${item.title || item.problemName}</span>
        <span class="review-difficulty ${diffClass}">${item.difficulty || ''}</span>
      </a>
    `);
  }
  if (due.length > 8) {
    reviewEl.append(`<div class="review-more">+${due.length - 8} more</div>`);
  }
}

async function renderRotationNudge(submissionHistory) {
  const progress = await getWeeklyPatternProgress();
  const auto = autoTickedPatterns(submissionHistory, progress.weekStart);
  const ticked = new Set([...auto, ...Object.keys(progress.manualTicked)]);
  const nudge = computeRotationSuggestion(submissionHistory, ticked);
  if (!nudge) { $('#rotation_nudge').hide(); return; }
  const tagUrl = `https://leetcode.com/tag/${nudge.suggestion.tagSlug}/`;
  $('#rotation_nudge').show().find('.rotation-nudge-text').html(
    `<strong>${nudge.dominantPattern.label}</strong> in ${nudge.dominantCount}/${nudge.lookback} recent solves — try <a href="${tagUrl}" target="_blank">${nudge.suggestion.label}</a> next.`
  );
}

async function renderActivePattern(submissionHistory) {
  const active = await getActivePattern();
  if (!active?.pattern) { $('#active_pattern_card').hide(); return; }
  const p = active.pattern;
  $('#active_pattern_card').show();
  $('#active_pattern_link').text(p.label).attr('href', patternUrl(p));

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffMs = cutoff.getTime();
  const tagSet = new Set(p.tags);
  const seen = new Set();
  let count = 0;
  for (const recs of Object.values(submissionHistory || {})) {
    for (const r of recs || []) {
      const ms = r.timestamp ? r.timestamp * 1000 : r.date ? new Date(r.date + 'T00:00:00').getTime() : 0;
      if (!ms || ms < cutoffMs) continue;
      const slug = r.titleSlug || r.title;
      if (!slug || seen.has(slug)) continue;
      if ((r.topicTags || []).some(t => tagSet.has(t))) {
        seen.add(slug); count++;
      }
    }
  }
  $('#active_pattern_meta').text(
    count > 0 ? `${count} solve${count === 1 ? '' : 's'} in the last 7 days` : 'No solves yet — open the tag and grind.'
  );
}

async function renderWeeklyPatterns(submissionHistory) {
  const progress = await getWeeklyPatternProgress();
  const auto = autoTickedPatterns(submissionHistory, progress.weekStart);
  const isTicked = (id) => auto.has(id) || !!progress.manualTicked[id];
  const tickedCount = PATTERNS.filter(p => isTicked(p.id)).length;
  const active = await getActivePattern();
  const activeId = active?.id;

  $('#weekly_patterns_count').text(`${tickedCount}/${PATTERNS.length}`);
  const list = $('#weekly_patterns_list');
  list.empty();

  for (const p of PATTERNS) {
    const ticked = isTicked(p.id);
    const autoBadge = auto.has(p.id);
    const activeCls = p.id === activeId ? ' active' : '';
    list.append(`
      <div class="pattern-row${ticked ? ' ticked' : ''}${activeCls}" data-id="${p.id}">
        <input type="checkbox" class="pattern-check" ${ticked ? 'checked' : ''} />
        <a class="pattern-label" href="${patternUrl(p)}" target="_blank" data-id="${p.id}">
          <span class="pattern-name">${p.label}</span>
          ${autoBadge ? '<span class="pattern-auto">auto</span>' : ''}
        </a>
      </div>
    `);
  }

  const display = new Date(progress.weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  $('#weekly_patterns_meta').text(`Week of ${display} — resets Monday`);

  list.off('change').on('change', '.pattern-check', async (ev) => {
    const id = $(ev.target).closest('.pattern-row').data('id');
    await toggleManualTick(id);
    await renderWeeklyPatterns(submissionHistory);
  });
  list.off('click', '.pattern-label').on('click', '.pattern-label', async (ev) => {
    const id = $(ev.currentTarget).data('id');
    await setActivePattern(id);
    await renderActivePattern(submissionHistory);
    await renderWeeklyPatterns(submissionHistory);
  });
}

let currentPeriod = 'week';
function renderActivity(submissionHistory) {
  const { buckets, detailForBucket } = bucketActivity(submissionHistory, currentPeriod);
  const max = Math.max(1, ...buckets.map(b => b.count));

  const chart = $('#activity_chart');
  chart.empty();
  const showEvery = currentPeriod === 'month' ? 5 : 1;

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const heightPct = Math.round((b.count / max) * 100);
    const showLabel = currentPeriod !== 'month' || i % showEvery === 0 || i === buckets.length - 1;
    chart.append(`
      <div class="bar-col" data-key="${b.key}" title="${b.label}: ${b.count} problem${b.count === 1 ? '' : 's'}">
        <div class="bar-fill-wrap">
          <div class="bar-fill" style="height:${b.count > 0 ? Math.max(heightPct, 6) : 0}%"></div>
          ${b.count > 0 ? `<span class="bar-count">${b.count}</span>` : ''}
        </div>
        <span class="bar-label">${showLabel ? b.label : ''}</span>
      </div>
    `);
  }

  const total = buckets.reduce((s, b) => s + b.count, 0);
  $('#activity_detail').html(
    `<div class="activity-summary">${total} problem${total === 1 ? '' : 's'} this ${currentPeriod}</div>`
  );

  chart.off('click').on('click', '.bar-col', (ev) => {
    const key = $(ev.currentTarget).data('key');
    chart.find('.bar-col').removeClass('selected');
    $(ev.currentTarget).addClass('selected');
    const items = detailForBucket(String(key));
    const detail = $('#activity_detail');
    if (items.length === 0) {
      detail.html(`<div class="activity-empty">No solves on ${key}.</div>`);
      return;
    }
    let html = `<div class="activity-detail-header">${key} — ${items.length} solve${items.length === 1 ? '' : 's'}</div>`;
    for (const r of items) {
      const slug = r.titleSlug || (r.title || '').toLowerCase().replace(/\s+/g, '-');
      const url = `https://leetcode.com/problems/${slug}/`;
      const diffClass = (r.difficulty || '').toLowerCase();
      html += `
        <a class="activity-item" href="${url}" target="_blank">
          <span class="activity-item-title">${r.title || slug}</span>
          <span class="activity-item-diff ${diffClass}">${r.difficulty || ''}</span>
        </a>
      `;
    }
    detail.html(html);
  });
}

function initPeriodToggle(submissionHistory) {
  $('.period-toggle').off('click').on('click', '.period-btn', (ev) => {
    const p = $(ev.currentTarget).data('period');
    if (p === currentPeriod) return;
    currentPeriod = p;
    $('.period-btn').removeClass('active');
    $(ev.currentTarget).addClass('active');
    renderActivity(submissionHistory);
  });
}

function renderTopicStats(topicStats) {
  const list = $('#topics_list');
  list.empty();
  if (!topicStats) {
    list.append('<div class="empty-state">Solve a few problems to see topic coverage.</div>');
    return;
  }
  const topics = Object.entries(topicStats)
    .filter(([k]) => !k.startsWith('_'))
    .sort((a, b) => b[1] - a[1]);
  if (topics.length === 0) {
    list.append('<div class="empty-state">Solve a few problems to see topic coverage.</div>');
    return;
  }
  const max = topics[0][1];
  for (const [name, count] of topics.slice(0, 16)) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    let color;
    if (pct >= 70) color = '#5cb85c';
    else if (pct >= 40) color = '#f0ad4e';
    else color = '#d9534f';
    list.append(`
      <div class="topic-row">
        <span class="topic-name" title="${name}">${name}</span>
        <div class="topic-bar-container">
          <div class="topic-bar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <span class="topic-count">${count}</span>
      </div>
    `);
  }
}

// Roadmap (same logic as popup, larger)
const NEETCODE_TIERS = [
  ['Arrays & Hashing'],
  ['Two Pointers', 'Stack'],
  ['Binary Search', 'Sliding Window', 'Linked List'],
  ['Trees'],
  ['Tries', 'Backtracking'],
  ['Heap / Priority Queue', 'Graphs', '1-D Dynamic Programming'],
  ['Intervals', 'Greedy', 'Advanced Graphs', '2-D Dynamic Programming', 'Bit Manipulation'],
  ['Math & Geometry'],
];
const SHORT_LABELS = {
  '1-D Dynamic Programming': '1-D DP',
  '2-D Dynamic Programming': '2-D DP',
  'Heap / Priority Queue': 'Heap / PQ',
};
function tiersForPlan(planKey, plan) {
  if (planKey === 'neetcode150') return NEETCODE_TIERS;
  if (planKey === 'grind75') return Object.keys(plan.problems).map(c => [c]);
  const cats = Object.keys(plan.problems);
  const rows = [];
  for (let i = 0; i < cats.length; i += 4) rows.push(cats.slice(i, i + 4));
  return rows;
}

async function renderStudyPlan(stats) {
  const plans = await loadStudyPlans();
  if (!plans) return;
  const update = () => {
    const planKey = $('#study_plan_select').val();
    const plan = plans[planKey];
    if (!plan) return;

    const all = [];
    for (const cat of Object.values(plan.problems)) {
      for (const slug of cat) if (!all.includes(slug)) all.push(slug);
    }
    const solved = new Set();
    if (stats?.shas) {
      for (const fullPath of Object.keys(stats.shas)) {
        const slug = fullPath.split('/').pop();
        if (slug) solved.add(slug);
      }
    }
    const done = all.filter(p => solved.has(p)).length;
    const pct = all.length > 0 ? Math.round((done / all.length) * 100) : 0;
    $('#plan_progress_fill').css('width', pct + '%');
    $('#plan_progress_text').text(`${done}/${all.length}`);
    const next = all.find(p => !solved.has(p));
    if (next) {
      const slug = next.replace(/^\d+-/, '');
      $('#plan_next_problem').html(`Next: <a href="https://leetcode.com/problems/${slug}/" target="_blank">${next}</a>`);
    } else {
      $('#plan_next_problem').text('All problems completed!');
    }
    renderRoadmap(plan, planKey, solved);
  };
  $('#study_plan_select').off('change').on('change', update);
  update();
}

function renderRoadmap(plan, planKey, solvedSlugs) {
  const tiers = tiersForPlan(planKey, plan);
  const container = $('#roadmap_container');
  container.empty();

  tiers.forEach((tier, idx) => {
    const tierEl = $('<div class="roadmap-tier"></div>');
    for (const cat of tier) {
      const problems = plan.problems[cat];
      if (!problems) continue;
      const total = problems.length;
      const done = problems.filter(p => solvedSlugs.has(p)).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      let stateCls;
      if (pct === 0) stateCls = 'state-empty';
      else if (pct === 100) stateCls = 'state-done';
      else stateCls = 'state-progress';
      const label = SHORT_LABELS[cat] || cat;
      tierEl.append(`
        <button class="roadmap-node ${stateCls}" data-cat="${cat}" title="${cat} — ${done}/${total}">
          <span class="node-label">${label}</span>
          <span class="node-bar"><span class="node-bar-fill" style="width:${pct}%"></span></span>
          <span class="node-count">${done}/${total}</span>
        </button>
      `);
    }
    container.append(tierEl);
    if (idx < tiers.length - 1) container.append('<div class="roadmap-connector"></div>');
  });

  $('#roadmap_detail').empty();
  container.off('click').on('click', '.roadmap-node', (ev) => {
    const cat = $(ev.currentTarget).data('cat');
    container.find('.roadmap-node').removeClass('selected');
    $(ev.currentTarget).addClass('selected');
    const problems = plan.problems[cat] || [];
    const done = problems.filter(p => solvedSlugs.has(p)).length;
    const detail = $('#roadmap_detail');
    detail.empty();
    detail.append(`<div class="roadmap-detail-header">${cat} — ${done}/${problems.length}</div>`);
    for (const slug of problems) {
      const isDone = solvedSlugs.has(slug);
      const lcSlug = slug.replace(/^\d+-/, '');
      const url = `https://leetcode.com/problems/${lcSlug}/`;
      detail.append(`
        <a class="roadmap-problem ${isDone ? 'done' : ''}" href="${url}" target="_blank">
          <span class="roadmap-problem-check">${isDone ? '&#x2713;' : '&#x25CB;'}</span>
          <span class="roadmap-problem-name">${slug}</span>
        </a>
      `);
    }
  });
}

function renderAISettings() {
  const hasBuiltInAI =
    (typeof self !== 'undefined' && self.ai?.languageModel) ||
    (typeof chrome !== 'undefined' && chrome.aiOriginTrial?.languageModel);

  if (hasBuiltInAI) {
    $('#ai_status').text('On-Device').addClass('active');
    $('#ai_chrome_info').text('Using Chrome Built-in AI (free, on-device)');
  } else {
    api.storage.local.get(['algorep_ai_key', 'algorep_ai_provider'], data => {
      if (data.algorep_ai_key) {
        const provider = (data.algorep_ai_provider || 'gemini');
        const name = provider.charAt(0).toUpperCase() + provider.slice(1);
        $('#ai_status').text(name).addClass('active');
        $('#ai_chrome_info').text(`Using ${name} API`);
      } else {
        $('#ai_status').text('No AI').addClass('inactive');
        $('#ai_chrome_info').text('Add an API key below, or use Chrome 131+ for free on-device AI');
      }
    });
  }
  api.storage.local.get(['algorep_ai_provider', 'algorep_ai_key'], data => {
    if (data.algorep_ai_provider) $('#ai_provider').val(data.algorep_ai_provider);
    if (data.algorep_ai_key) $('#ai_key').attr('placeholder', 'Key saved (enter new to replace)');
  });
  $('#ai_save_key').off('click').on('click', () => {
    const key = $('#ai_key').val().trim();
    const provider = $('#ai_provider').val();
    if (!key) return;
    api.storage.local.set({ algorep_ai_key: key, algorep_ai_provider: provider }, () => {
      $('#ai_key').val('').attr('placeholder', 'Key saved (enter new to replace)');
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      $('#ai_status').text(name).removeClass('inactive').addClass('active');
      $('#ai_chrome_info').text(`Using ${name} API`);
    });
  });
}

// ============================================================
// Dashboard bootstrap
// ============================================================
async function loadDashboard() {
  const data = await api.storage.local.get([
    'stats', 'algorep_hook', 'streakData', 'reviewQueue', 'topicStats', 'submissionHistory',
  ]);
  let submissionHistory = data?.submissionHistory;

  renderHeader(data?.algorep_hook, data?.streakData);
  renderStats(data?.stats, submissionHistory);
  renderTodayCard(submissionHistory, data?.reviewQueue);
  await renderRotationNudge(submissionHistory);
  await renderActivePattern(submissionHistory);
  await renderWeeklyPatterns(submissionHistory);
  initPeriodToggle(submissionHistory);
  renderActivity(submissionHistory);
  renderTopicStats(data?.topicStats);
  await renderStudyPlan(data?.stats);
  renderAISettings();

  // Background backfill from repo, then re-render data sections if anything new arrived
  try {
    const result = await backfillFromRepo();
    if (result?.addedSlugs?.length > 0) {
      const { submissionHistory: merged } = await api.storage.local.get('submissionHistory');
      submissionHistory = merged;
      renderStats(data?.stats, submissionHistory);
      renderTodayCard(submissionHistory, data?.reviewQueue);
      await renderActivePattern(submissionHistory);
      await renderWeeklyPatterns(submissionHistory);
      initPeriodToggle(submissionHistory);
      renderActivity(submissionHistory);
      console.log(`AlgoRep welcome: backfilled ${result.addedSlugs.length} solves from repo`);
    }
  } catch (e) {
    console.log('Repo backfill skipped:', e?.message || e);
  }
}

// ============================================================
// Boot: figure out which step the user is on and show it
// ============================================================
async function routeToCurrentStep() {
  enterHookMode();
  const token = await getValidToken();
  if (!token) { showAuthStep(); return; }

  // Token in hand. Do they have an AlgoRep installation with at least one repo?
  let repos = [];
  try {
    const result = await listInstalledRepos();
    repos = result.repos;
  } catch (e) {
    showError(`Couldn’t reach GitHub: ${e.message}`);
    showAuthStep();
    return;
  }
  if (repos.length === 0) { showInstallStep(); return; }

  // Installed. Do we already have a hook saved?
  const { algorep_hook } = await api.storage.local.get('algorep_hook');
  if (algorep_hook && repos.some(r => r.full_name === algorep_hook)) {
    if (await verifyHook(algorep_hook)) {
      enterCommitMode();
      return;
    }
  }
  // Need to pick (or re-pick if the saved hook is no longer installed)
  showPickStep();
  await populateRepoSelect();
}

routeToCurrentStep();
