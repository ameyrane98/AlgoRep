import { getBrowser } from "./leetcode/util.js";
import {
  PATTERNS,
  patternById,
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
} from "./leetcode/weeklyPatterns.js";
import { backfillFromRepo } from "./leetcode/repoBackfill.js";
import { getValidToken, githubFetch } from "./githubApp.js";

const api = getBrowser();

// ============================================================
// Theme (light / dark) — persisted in chrome.storage.local under `theme`
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

// The popup is too small (and too short-lived) to host the Device Flow UI;
// onboarding lives entirely in welcome.html.
$('#authenticate').on('click', () => {
  api.tabs.create({ url: api.runtime.getURL('welcome.html') });
});
$('#welcome_URL').attr('href', api.runtime.getURL('welcome.html'));
$('#hook_URL').attr('href', api.runtime.getURL('welcome.html'));

$('#reset_stats').on('click', () => {
  $('#reset_confirmation').show();
  $('#reset_yes').off('click').on('click', () => {
    api.storage.local.set({ stats: null });
    $('#p_solved, #p_solved_easy, #p_solved_medium, #p_solved_hard').text(0);
    $('#reset_confirmation').hide();
  });
  $('#reset_no').off('click').on('click', () => $('#reset_confirmation').hide());
});

// ============================================================
// Study Plans
// ============================================================
let studyPlans = null;
async function loadStudyPlans() {
  if (studyPlans) return studyPlans;
  try {
    const url = api.runtime.getURL('data/studyPlans.json');
    const resp = await fetch(url);
    studyPlans = await resp.json();
    return studyPlans;
  } catch (e) {
    console.log('Could not load study plans:', e);
    return null;
  }
}

// ============================================================
// Tabs
// ============================================================
function initTabs() {
  $('.tabs').off('click').on('click', '.tab', (ev) => {
    const tab = $(ev.currentTarget).data('tab');
    $('.tab').removeClass('active').attr('aria-selected', 'false');
    $(ev.currentTarget).addClass('active').attr('aria-selected', 'true');
    $('.tab-panel').removeClass('active');
    $(`.tab-panel[data-panel="${tab}"]`).addClass('active');
  });
}

// ============================================================
// Header / Streak
// ============================================================
function renderStreak(streakData) {
  if (!streakData) return;
  $('#current_streak').text(streakData.currentStreak || 0);
  $('#longest_streak').text(streakData.longestStreak || 0);
}

function renderRepoLink(hook) {
  if (!hook) return;
  $('#repo_url').text(hook).attr('href', `https://github.com/${hook}`);
}

// ============================================================
// Today Card (today's solves + review due)
// ============================================================
function renderTodayCard(submissionHistory, reviewQueue) {
  const today = todayISO();
  const todaysProblems = getProblemsSolvedOn(submissionHistory, today);

  $('#today_count').text(todaysProblems.length);
  const listEl = $('#today_list');
  listEl.empty();

  if (todaysProblems.length === 0) {
    listEl.append('<div class="empty-state">No solves yet today — pick a problem and go.</div>');
  } else {
    for (const p of todaysProblems) {
      const slug = p.titleSlug || (p.title || '').toLowerCase().replace(/\s+/g, '-');
      const url = `https://leetcode.com/problems/${slug}/`;
      const diffClass = (p.difficulty || '').toLowerCase();
      const lang = p.language ? `<span class="today-lang">${p.language}</span>` : '';
      listEl.append(`
        <a class="today-item" href="${url}" target="_blank" title="${p.title || slug}">
          <span class="today-title">${p.title || slug}</span>
          ${lang}
          <span class="today-diff ${diffClass}">${p.difficulty || ''}</span>
        </a>
      `);
    }
  }

  // Review Due subsection
  if (!reviewQueue || Object.keys(reviewQueue).length === 0) {
    $('#review_subsection').hide();
    return;
  }
  const due = [];
  for (const [problemName, entry] of Object.entries(reviewQueue)) {
    if (entry.nextReview <= today) due.push({ problemName, ...entry });
  }
  if (due.length === 0) {
    $('#review_subsection').hide();
    return;
  }
  due.sort((a, b) => (a.nextReview > b.nextReview ? 1 : -1));
  $('#review_subsection').show();
  $('#review_count').text(due.length);

  const reviewEl = $('#review_list');
  reviewEl.empty();
  for (const item of due.slice(0, 5)) {
    const slug = item.titleSlug || item.problemName;
    const url = `https://leetcode.com/problems/${slug}/`;
    const diffClass = (item.difficulty || '').toLowerCase();
    reviewEl.append(`
      <a class="review-item" href="${url}" target="_blank" title="${item.title || item.problemName}">
        <span class="review-title">${item.title || item.problemName}</span>
        <span class="review-difficulty ${diffClass}">${item.difficulty || ''}</span>
      </a>
    `);
  }
  if (due.length > 5) {
    reviewEl.append(`<div class="review-more">+${due.length - 5} more</div>`);
  }
}

// ============================================================
// Rotation Nudge
// ============================================================
async function renderRotationNudge(submissionHistory) {
  const progress = await getWeeklyPatternProgress();
  const auto = autoTickedPatterns(submissionHistory, progress.weekStart);
  const ticked = new Set([...auto, ...Object.keys(progress.manualTicked)]);

  const nudge = computeRotationSuggestion(submissionHistory, ticked);
  if (!nudge) {
    $('#rotation_nudge').hide();
    return;
  }
  const tagUrl = `https://leetcode.com/tag/${nudge.suggestion.tagSlug}/`;
  $('#rotation_nudge').show().find('.rotation-nudge-text').html(
    `<strong>${nudge.dominantPattern.label}</strong> in ${nudge.dominantCount}/${nudge.lookback} recent solves — try <a href="${tagUrl}" target="_blank" data-pattern-id="${nudge.suggestion.id}">${nudge.suggestion.label}</a> next.`
  );
}

// ============================================================
// Active Pattern Card
// ============================================================
async function renderActivePattern(submissionHistory) {
  const active = await getActivePattern();
  if (!active?.pattern) {
    $('#active_pattern_card').hide();
    return;
  }
  const p = active.pattern;
  $('#active_pattern_card').show();
  $('#active_pattern_link').text(p.label).attr('href', patternUrl(p));

  // Count solves of this pattern in the last 7 local days.
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
        seen.add(slug);
        count++;
      }
    }
  }
  $('#active_pattern_meta').text(
    count > 0 ? `${count} solve${count === 1 ? '' : 's'} in the last 7 days` : 'No solves yet — open the tag and grind.'
  );
}

// ============================================================
// Weekly Pattern Checklist
// ============================================================
async function renderWeeklyPatterns(submissionHistory) {
  const progress = await getWeeklyPatternProgress();
  const auto = autoTickedPatterns(submissionHistory, progress.weekStart);
  const isTicked = (id) => auto.has(id) || !!progress.manualTicked[id];
  const tickedCount = PATTERNS.filter(p => isTicked(p.id)).length;
  const active = await getActivePattern();
  const activeId = active?.id;

  $('#weekly_patterns_count').text(`${tickedCount}/${PATTERNS.length}`);

  const listEl = $('#weekly_patterns_list');
  listEl.empty();

  for (const p of PATTERNS) {
    const ticked = isTicked(p.id);
    const autoBadge = auto.has(p.id);
    const activeCls = p.id === activeId ? ' active' : '';
    listEl.append(`
      <div class="pattern-row${ticked ? ' ticked' : ''}${activeCls}" data-id="${p.id}">
        <input type="checkbox" class="pattern-check" ${ticked ? 'checked' : ''} aria-label="Mark ${p.label} done this week" />
        <a class="pattern-label" href="${patternUrl(p)}" target="_blank" data-id="${p.id}">
          <span class="pattern-name">${p.label}</span>
          ${autoBadge ? '<span class="pattern-auto" title="Auto-ticked from a solve this week">auto</span>' : ''}
        </a>
      </div>
    `);
  }

  const weekStartDisplay = new Date(progress.weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  $('#weekly_patterns_meta').text(`Week of ${weekStartDisplay} — resets Monday`);

  // Wire interactions
  listEl.off('change').on('change', '.pattern-check', async (ev) => {
    const id = $(ev.target).closest('.pattern-row').data('id');
    await toggleManualTick(id);
    await renderWeeklyPatterns(submissionHistory);
  });
  // Click on label sets active pattern (then opens link in new tab via default).
  listEl.off('click', '.pattern-label').on('click', '.pattern-label', async (ev) => {
    const id = $(ev.currentTarget).data('id');
    await setActivePattern(id);
    await renderActivePattern(submissionHistory);
    await renderWeeklyPatterns(submissionHistory);
    // don't preventDefault — let the link open
  });
}

// ============================================================
// Activity Chart (Week / Month / Year)
// ============================================================
let currentPeriod = 'week';

function renderActivity(submissionHistory) {
  const { buckets, detailForBucket } = bucketActivity(submissionHistory, currentPeriod);
  const max = Math.max(1, ...buckets.map(b => b.count));

  const chartEl = $('#activity_chart');
  chartEl.empty();
  const showEvery = currentPeriod === 'month' ? 5 : 1;

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const heightPct = Math.round((b.count / max) * 100);
    const showLabel = currentPeriod !== 'month' || i % showEvery === 0 || i === buckets.length - 1;
    chartEl.append(`
      <div class="bar-col" data-key="${b.key}" title="${b.label}: ${b.count} problem${b.count === 1 ? '' : 's'}">
        <div class="bar-fill-wrap">
          <div class="bar-fill" style="height: ${b.count > 0 ? Math.max(heightPct, 8) : 0}%"></div>
          ${b.count > 0 ? `<span class="bar-count">${b.count}</span>` : ''}
        </div>
        <span class="bar-label">${showLabel ? b.label : ''}</span>
      </div>
    `);
  }

  const totalSolves = buckets.reduce((s, b) => s + b.count, 0);
  const detailEl = $('#activity_detail');
  detailEl.html(`<div class="activity-summary">${totalSolves} problem${totalSolves === 1 ? '' : 's'} this ${currentPeriod}</div>`);

  chartEl.off('click').on('click', '.bar-col', (ev) => {
    const key = $(ev.currentTarget).data('key');
    chartEl.find('.bar-col').removeClass('selected');
    $(ev.currentTarget).addClass('selected');
    const items = detailForBucket(String(key));
    if (items.length === 0) {
      detailEl.html(`<div class="activity-empty">No solves on ${key}.</div>`);
      return;
    }
    let html = `<div class="activity-detail-header">${key} — ${items.length} solve${items.length === 1 ? '' : 's'}</div>`;
    for (const r of items) {
      const slug = r.titleSlug || (r.title || '').toLowerCase().replace(/\s+/g, '-');
      const url = `https://leetcode.com/problems/${slug}/`;
      const diffClass = (r.difficulty || '').toLowerCase();
      html += `
        <a class="activity-item" href="${url}" target="_blank" title="${r.title || slug}">
          <span class="activity-item-title">${r.title || slug}</span>
          <span class="activity-item-diff ${diffClass}">${r.difficulty || ''}</span>
        </a>
      `;
    }
    detailEl.html(html);
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

// ============================================================
// Topic Mastery (compact, all-time)
// ============================================================
function renderTopicStats(topicStats) {
  const listEl = $('#topics_list');
  listEl.empty();
  if (!topicStats || Object.keys(topicStats).length === 0) {
    listEl.append('<div class="empty-state">Solve a few problems to see topic coverage.</div>');
    return;
  }
  const topics = Object.entries(topicStats)
    .filter(([key]) => !key.startsWith('_'))
    .sort((a, b) => b[1] - a[1]);
  if (topics.length === 0) {
    listEl.append('<div class="empty-state">Solve a few problems to see topic coverage.</div>');
    return;
  }
  const maxCount = topics[0][1];
  for (const [name, count] of topics.slice(0, 8)) {
    const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
    let color;
    if (pct >= 70) color = '#5cb85c';
    else if (pct >= 40) color = '#f0ad4e';
    else color = '#d9534f';
    listEl.append(`
      <div class="topic-row">
        <span class="topic-name" title="${name}">${name}</span>
        <div class="topic-bar-container">
          <div class="topic-bar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <span class="topic-count">${count}</span>
      </div>
    `);
  }
  if (topics.length > 8) {
    listEl.append(`<div class="topic-more">+${topics.length - 8} more</div>`);
  }
}

// ============================================================
// Study Plan + Roadmap
// ============================================================

/**
 * NeetCode 150's canonical roadmap tiers (parents at top, dependents below).
 * Categories must match the keys in data/studyPlans.json's neetcode150 plan.
 */
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

/** Short labels so 5-wide tiers fit in a 400px popup. */
const SHORT_LABELS = {
  '1-D Dynamic Programming': '1-D DP',
  '2-D Dynamic Programming': '2-D DP',
  'Heap / Priority Queue': 'Heap / PQ',
  'Bit Manipulation': 'Bit Manip',
  'Math & Geometry': 'Math & Geo',
  'Advanced Graphs': 'Adv Graphs',
  'Arrays & Hashing': 'Arr & Hash',
};

/** Tier layouts per plan. Plans not listed get auto-tiered (3 per row). */
function tiersForPlan(planKey, plan) {
  if (planKey === 'neetcode150') return NEETCODE_TIERS;
  if (planKey === 'grind75') {
    return Object.keys(plan.problems).map(c => [c]); // one per row
  }
  // blind75 + fallback: chunk categories into rows of 3
  const cats = Object.keys(plan.problems);
  const rows = [];
  for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i + 3));
  return rows;
}

async function renderStudyPlan(stats) {
  const plans = await loadStudyPlans();
  if (!plans) return;

  const updatePlan = () => {
    const planKey = $('#study_plan_select').val();
    const plan = plans[planKey];
    if (!plan) return;

    const allProblems = [];
    for (const category of Object.values(plan.problems)) {
      for (const slug of category) {
        if (!allProblems.includes(slug)) allProblems.push(slug);
      }
    }
    const solvedSlugs = new Set();
    if (stats?.shas) {
      for (const fullPath of Object.keys(stats.shas)) {
        const slug = fullPath.split('/').pop();
        if (slug) solvedSlugs.add(slug);
      }
    }

    const solved = allProblems.filter(p => solvedSlugs.has(p)).length;
    const total = allProblems.length;
    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
    $('#plan_progress_fill').css('width', pct + '%');
    $('#plan_progress_text').text(`${solved}/${total}`);

    const nextUnsolved = allProblems.find(p => !solvedSlugs.has(p));
    if (nextUnsolved) {
      const slug = nextUnsolved.replace(/^\d+-/, '');
      $('#plan_next_problem').html(
        `Next: <a href="https://leetcode.com/problems/${slug}/" target="_blank">${nextUnsolved}</a>`
      );
    } else {
      $('#plan_next_problem').text('All problems completed!');
    }

    renderRoadmap(plan, planKey, solvedSlugs);
  };

  $('#study_plan_select').off('change').on('change', updatePlan);
  updatePlan();
}

function renderRoadmap(plan, planKey, solvedSlugs) {
  const tiers = tiersForPlan(planKey, plan);
  const container = $('#roadmap_container');
  container.empty();

  tiers.forEach((tier, tierIdx) => {
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
    if (tierIdx < tiers.length - 1) {
      container.append('<div class="roadmap-connector"></div>');
    }
  });

  $('#roadmap_detail').empty();

  container.off('click').on('click', '.roadmap-node', (ev) => {
    const cat = $(ev.currentTarget).data('cat');
    container.find('.roadmap-node').removeClass('selected');
    $(ev.currentTarget).addClass('selected');
    renderRoadmapDetail(cat, plan.problems[cat] || [], solvedSlugs);
  });
}

function renderRoadmapDetail(category, problems, solvedSlugs) {
  const detail = $('#roadmap_detail');
  detail.empty();

  const done = problems.filter(p => solvedSlugs.has(p)).length;
  detail.append(`<div class="roadmap-detail-header">${category} — ${done}/${problems.length}</div>`);

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
}

// ============================================================
// AI Settings
// ============================================================
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
        const provider = (data.algorep_ai_provider || 'gemini').charAt(0).toUpperCase()
          + (data.algorep_ai_provider || 'gemini').slice(1);
        $('#ai_status').text(provider).addClass('active');
        $('#ai_chrome_info').text(`Using ${provider} API`);
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
      const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
      $('#ai_status').text(providerName).removeClass('inactive').addClass('active');
      $('#ai_chrome_info').text(`Using ${providerName} API`);
    });
  });
}

// ============================================================
// Bootstrap
// ============================================================
(async () => {
  const token = await getValidToken();
  if (!token) { $('#auth_mode').show(); return; }

  // Verify the token works (catches revoked installs) before painting the dash.
  let ok = false;
  try {
    const res = await githubFetch('/user');
    ok = res.ok;
  } catch (_) { ok = false; }
  if (!ok) { $('#auth_mode').show(); return; }

  const { mode_type } = await api.storage.local.get('mode_type');
  if (mode_type !== 'commit') { $('#hook_mode').show(); return; }

  $('#commit_mode').show();
  const data3 = await api.storage.local.get([
    'stats', 'algorep_hook', 'streakData', 'reviewQueue', 'topicStats', 'submissionHistory',
  ]);
  const stats = data3?.stats;
  let submissionHistory = data3?.submissionHistory;

  $('#p_solved').text(stats?.solved ?? 0);
  $('#p_solved_easy').text(stats?.easy ?? 0);
  $('#p_solved_medium').text(stats?.medium ?? 0);
  $('#p_solved_hard').text(stats?.hard ?? 0);

  renderRepoLink(data3?.algorep_hook);
  renderStreak(data3?.streakData);

  initTabs();
  initPeriodToggle(submissionHistory);

  renderTodayCard(submissionHistory, data3?.reviewQueue);
  await renderRotationNudge(submissionHistory);
  await renderActivePattern(submissionHistory);
  await renderWeeklyPatterns(submissionHistory);
  renderActivity(submissionHistory);
  renderTopicStats(data3?.topicStats);
  renderStudyPlan(stats);
  renderAISettings();

  try {
    const result = await backfillFromRepo();
    if (result?.addedSlugs?.length > 0) {
      const { submissionHistory: merged } =
        await api.storage.local.get('submissionHistory');
      submissionHistory = merged;
      initPeriodToggle(submissionHistory);
      renderTodayCard(submissionHistory, data3?.reviewQueue);
      await renderActivePattern(submissionHistory);
      await renderWeeklyPatterns(submissionHistory);
      renderActivity(submissionHistory);
      console.log(`AlgoRep: backfilled ${result.addedSlugs.length} solves from repo`);
    }
  } catch (e) {
    console.log('Repo backfill skipped:', e?.message || e);
  }
})();
