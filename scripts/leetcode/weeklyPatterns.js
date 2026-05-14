import { getBrowser } from './util.js';

const api = getBrowser();

/**
 * Canonical interview-pattern list.
 *   - `tags`: raw LeetCode topic-tag names that count as a solve for this pattern.
 *   - `tagSlug`: LC URL slug — clicking a pattern opens https://leetcode.com/tag/<slug>/.
 */
export const PATTERNS = [
  { id: 'sliding-window', label: 'Sliding Window', tagSlug: 'sliding-window', tags: ['Sliding Window'] },
  { id: 'two-pointers', label: 'Two Pointers', tagSlug: 'two-pointers', tags: ['Two Pointers'] },
  { id: 'binary-search', label: 'Binary Search', tagSlug: 'binary-search', tags: ['Binary Search'] },
  { id: 'trees-dfs', label: 'Trees / DFS', tagSlug: 'depth-first-search', tags: ['Tree', 'Binary Tree', 'Binary Search Tree', 'Depth-First Search'] },
  { id: 'bfs', label: 'BFS', tagSlug: 'breadth-first-search', tags: ['Breadth-First Search'] },
  { id: 'backtracking', label: 'Backtracking', tagSlug: 'backtracking', tags: ['Backtracking'] },
  { id: 'dp', label: 'Dynamic Programming', tagSlug: 'dynamic-programming', tags: ['Dynamic Programming'] },
  { id: 'heap', label: 'Heap / PQ', tagSlug: 'heap-priority-queue', tags: ['Heap (Priority Queue)'] },
  { id: 'graph', label: 'Graph', tagSlug: 'graph', tags: ['Graph'] },
  { id: 'trie', label: 'Trie', tagSlug: 'trie', tags: ['Trie'] },
  { id: 'union-find', label: 'Union Find', tagSlug: 'union-find', tags: ['Union Find'] },
  { id: 'topo-sort', label: 'Topological Sort', tagSlug: 'topological-sort', tags: ['Topological Sort'] },
  { id: 'greedy', label: 'Greedy', tagSlug: 'greedy', tags: ['Greedy'] },
  { id: 'bit-manip', label: 'Bit Manipulation', tagSlug: 'bit-manipulation', tags: ['Bit Manipulation'] },
  { id: 'monotonic-stack', label: 'Monotonic Stack', tagSlug: 'monotonic-stack', tags: ['Monotonic Stack'] },
  { id: 'linked-list', label: 'Linked List', tagSlug: 'linked-list', tags: ['Linked List'] },
];

const TAG_TO_PATTERN_IDS = (() => {
  const map = new Map();
  for (const p of PATTERNS) {
    for (const tag of p.tags) {
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(p.id);
    }
  }
  return map;
})();

export function patternById(id) {
  return PATTERNS.find(p => p.id === id) || null;
}

export function patternUrl(pattern) {
  return `https://leetcode.com/tag/${pattern.tagSlug}/`;
}

/**
 * Format a Date as local YYYY-MM-DD (NOT UTC).
 * Submission records carry both `date` (UTC) and `timestamp` (Unix). For the
 * popup we want to bucket by the user's wall-clock day, so we always derive
 * dates from the timestamp via this helper.
 */
function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Local-time YYYY-MM-DD for a submission record. Prefers `timestamp` (Unix
 * seconds) so we can convert to local; falls back to the stored UTC `date`
 * if no timestamp is present.
 */
export function localDateOf(record) {
  if (record?.timestamp) return localDateString(new Date(record.timestamp * 1000));
  return record?.date || '';
}

/**
 * Today's date in the user's local timezone.
 */
export function todayISO() {
  return localDateString(new Date());
}

/**
 * Local-time YYYY-MM-DD of the Monday of the week containing `date`.
 */
export function weekStartISO(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return localDateString(d);
}

/**
 * Loads weekly progress from storage, resetting manual ticks if a new week
 * has begun.
 *
 * Stored shape: { weekStart, manualTicked: { [patternId]: true } }
 */
export async function getWeeklyPatternProgress() {
  const { weeklyPatternProgress } = await api.storage.local.get('weeklyPatternProgress');
  const currentWeek = weekStartISO();

  if (!weeklyPatternProgress || weeklyPatternProgress.weekStart !== currentWeek) {
    const fresh = { weekStart: currentWeek, manualTicked: {} };
    await api.storage.local.set({ weeklyPatternProgress: fresh });
    return fresh;
  }
  return weeklyPatternProgress;
}

export async function toggleManualTick(patternId) {
  const progress = await getWeeklyPatternProgress();
  if (progress.manualTicked[patternId]) {
    delete progress.manualTicked[patternId];
  } else {
    progress.manualTicked[patternId] = true;
  }
  await api.storage.local.set({ weeklyPatternProgress: progress });
  return progress;
}

/**
 * Pattern IDs auto-ticked by solves whose local date is on/after `weekStart`.
 */
export function autoTickedPatterns(submissionHistory, weekStart) {
  const ticked = new Set();
  if (!submissionHistory) return ticked;

  for (const records of Object.values(submissionHistory)) {
    for (const r of records || []) {
      const local = localDateOf(r);
      if (!local || local < weekStart) continue;
      for (const tag of r.topicTags || []) {
        for (const id of TAG_TO_PATTERN_IDS.get(tag) || []) ticked.add(id);
      }
    }
  }
  return ticked;
}

/**
 * Get the user's currently active pattern (the one they're focused on).
 * Returns null if none set.
 */
export async function getActivePattern() {
  const { activePattern } = await api.storage.local.get('activePattern');
  if (!activePattern?.id) return null;
  return { ...activePattern, pattern: patternById(activePattern.id) };
}

export async function setActivePattern(patternId) {
  const p = patternById(patternId);
  if (!p) return null;
  const entry = { id: patternId, setAt: todayISO() };
  await api.storage.local.set({ activePattern: entry });
  return { ...entry, pattern: p };
}

/**
 * Flatten submissionHistory into a single array, newest first. Each record
 * is annotated with `_localDate` (computed once) so downstream consumers
 * don't recompute timezone conversion in tight loops.
 */
function flattenHistory(submissionHistory) {
  const all = [];
  if (!submissionHistory) return all;
  for (const records of Object.values(submissionHistory)) {
    for (const r of records || []) {
      const local = localDateOf(r);
      if (!local) continue;
      all.push({ ...r, _localDate: local });
    }
  }
  all.sort((a, b) => (a._localDate < b._localDate ? 1 : -1));
  return all;
}

/**
 * Submissions made on a given local-date string (YYYY-MM-DD), deduplicated
 * by titleSlug.
 */
export function getProblemsSolvedOn(submissionHistory, isoDate) {
  const seen = new Map();
  for (const r of flattenHistory(submissionHistory)) {
    if (r._localDate !== isoDate) continue;
    const key = r.titleSlug || r.title || r.questionId;
    if (!key || seen.has(key)) continue;
    seen.set(key, r);
  }
  return [...seen.values()];
}

/**
 * Build an activity series for the popup chart.
 *
 * @param {Object} submissionHistory
 * @param {'week'|'month'|'year'} period
 * @returns {{
 *   buckets: Array<{ key: string, label: string, count: number }>,
 *   detailKeyForBucket: (key: string) => Array<Object>
 * }}
 *
 * - week: 7 daily buckets (last 7 days, today last)
 * - month: 30 daily buckets (last 30 days)
 * - year: 12 monthly buckets (last 12 months)
 */
export function bucketActivity(submissionHistory, period) {
  const all = flattenHistory(submissionHistory);
  const bucketMap = new Map(); // key -> Map(slug -> record), to dedupe per bucket

  // Local-time buckets so the chart matches the user's wall clock.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = [];
  if (period === 'year') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString(undefined, { month: 'short' });
      buckets.push({ key, label, count: 0 });
      bucketMap.set(key, new Map());
    }
  } else {
    const days = period === 'month' ? 30 : 7;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = period === 'week'
        ? ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'][d.getDay()]
        : String(d.getDate());
      buckets.push({ key, label, count: 0 });
      bucketMap.set(key, new Map());
    }
  }

  for (const r of all) {
    const key = period === 'year' ? r._localDate.slice(0, 7) : r._localDate;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;
    const slug = r.titleSlug || r.title || r.questionId;
    if (!slug || bucket.has(slug)) continue;
    bucket.set(slug, r);
  }

  for (const b of buckets) {
    b.count = bucketMap.get(b.key).size;
  }

  return {
    buckets,
    detailForBucket: (key) => {
      const m = bucketMap.get(key);
      return m ? [...m.values()] : [];
    },
  };
}

/**
 * Rotation suggestion: if one pattern dominates the user's last `lookback` solves
 * (>= `dominanceThreshold`), recommend a different one.
 */
export function computeRotationSuggestion(submissionHistory, weeklyTicked, {
  lookback = 5,
  dominanceThreshold = 3,
  staleAfterDays = 14,
} = {}) {
  const all = flattenHistory(submissionHistory);
  if (all.length === 0) return null;

  const recent = all.slice(0, lookback);
  const recentCounts = new Map();
  for (const r of recent) {
    const seen = new Set();
    for (const tag of r.topicTags || []) {
      for (const id of TAG_TO_PATTERN_IDS.get(tag) || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        recentCounts.set(id, (recentCounts.get(id) || 0) + 1);
      }
    }
  }

  let dominantId = null;
  let dominantCount = 0;
  for (const [id, count] of recentCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantId = id;
    }
  }
  if (!dominantId || dominantCount < dominanceThreshold) return null;

  const lastSeen = new Map();
  for (const r of all) {
    for (const tag of r.topicTags || []) {
      for (const id of TAG_TO_PATTERN_IDS.get(tag) || []) {
        if (!lastSeen.has(id) || lastSeen.get(id) < r._localDate) {
          lastSeen.set(id, r._localDate);
        }
      }
    }
  }

  const todayMs = new Date(todayISO() + 'T00:00:00').getTime();
  let stalestUntickedId = null;
  let stalestUntickedDays = -1;
  let anyUntickedId = null;
  let oldestId = null;
  let oldestDays = -1;

  for (const p of PATTERNS) {
    if (p.id === dominantId) continue;
    const last = lastSeen.get(p.id);
    const daysAgo = last
      ? Math.floor((todayMs - new Date(last + 'T00:00:00').getTime()) / 86400000)
      : Infinity;

    if (!weeklyTicked.has(p.id)) {
      if (anyUntickedId === null) anyUntickedId = p.id;
      if (daysAgo >= staleAfterDays && daysAgo > stalestUntickedDays) {
        stalestUntickedId = p.id;
        stalestUntickedDays = daysAgo;
      }
    }
    if (daysAgo > oldestDays) {
      oldestDays = daysAgo;
      oldestId = p.id;
    }
  }

  const suggestionId = stalestUntickedId || anyUntickedId || oldestId;
  if (!suggestionId) return null;

  const dominant = patternById(dominantId);
  const suggestion = patternById(suggestionId);
  return {
    dominantPattern: { id: dominant.id, label: dominant.label },
    dominantCount,
    lookback,
    suggestion: { id: suggestion.id, label: suggestion.label, tagSlug: suggestion.tagSlug },
  };
}
