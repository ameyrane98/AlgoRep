import { getBrowser } from './util.js';
import { getValidToken } from '../githubApp.js';

const api = getBrowser();

const BACKFILL_DAYS = 14;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const CACHE_KEY = 'repoBackfillCache';

/**
 * Fetches commits from the linked GitHub repo for the last `BACKFILL_DAYS` days,
 * extracts problem slugs from file paths, and merges any solves not already in
 * `submissionHistory` as stub records.
 *
 * Stub records carry just enough info for the Today card and Activity chart to
 * render — they don't have topic tags, so they can't auto-tick patterns.
 *
 * Returns `{ addedSlugs: string[] }` or `null` if the call was skipped.
 */
export async function backfillFromRepo({ force = false } = {}) {
  const token = await getValidToken();
  const { algorep_hook: hook, [CACHE_KEY]: cache } =
    await api.storage.local.get(['algorep_hook', CACHE_KEY]);

  if (!token || !hook) return null;

  if (!force && cache?.fetchedAt && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { addedSlugs: [], cached: true };
  }

  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - BACKFILL_DAYS);
  const sinceISO = sinceDate.toISOString();

  const commits = await fetchCommits(token, hook, sinceISO);
  if (!commits) return null;

  const detailedCommits = await Promise.all(
    commits.map(c => fetchCommitFiles(token, c.url).then(files => ({
      isoDateTime: c.commit?.committer?.date || c.commit?.author?.date || '',
      files,
    })))
  );

  // slug -> most-recent commit ISO datetime
  const slugToDateTime = new Map();
  for (const c of detailedCommits) {
    if (!c?.isoDateTime) continue;
    for (const path of c.files || []) {
      const slug = extractProblemSlugFromPath(path);
      if (!slug) continue;
      const existing = slugToDateTime.get(slug);
      if (!existing || existing < c.isoDateTime) slugToDateTime.set(slug, c.isoDateTime);
    }
  }

  if (slugToDateTime.size === 0) {
    await api.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now() } });
    return { addedSlugs: [] };
  }

  const { submissionHistory = {} } = await api.storage.local.get('submissionHistory');
  const added = [];

  for (const [slug, isoDateTime] of slugToDateTime) {
    if (submissionHistory[slug] && submissionHistory[slug].length > 0) continue;
    submissionHistory[slug] = [makeStubRecord(slug, isoDateTime)];
    added.push(slug);
  }

  await api.storage.local.set({
    submissionHistory,
    [CACHE_KEY]: { fetchedAt: Date.now() },
  });

  return { addedSlugs: added };
}

/**
 * The LeetHub commit path is `groupName/primaryTopic/problemSlug/filename`.
 * Top-level files (README.md, stats.json) are skipped.
 */
function extractProblemSlugFromPath(path) {
  if (!path) return null;
  const parts = path.split('/');
  if (parts.length < 4) return null;
  return parts[parts.length - 2];
}

function makeStubRecord(slug, isoDateTime) {
  const d = new Date(isoDateTime);
  const titleSlug = slug.replace(/^\d+-/, '');
  const title = titleSlug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return {
    date: d.toISOString().split('T')[0],         // UTC date (matches LeetHub's stored shape)
    timestamp: Math.floor(d.getTime() / 1000),   // Unix seconds — used for local-date conversion
    titleSlug,
    title,
    topicTags: [],
    source: 'github-backfill',
  };
}

async function fetchCommits(token, hook, sinceISO) {
  try {
    const url = `https://api.github.com/repos/${hook}/commits?since=${encodeURIComponent(sinceISO)}&per_page=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      console.log('Repo backfill: commits list failed', res.status);
      return null;
    }
    return res.json();
  } catch (e) {
    console.log('Repo backfill: commits fetch threw', e?.message || e);
    return null;
  }
}

async function fetchCommitFiles(token, commitUrl) {
  try {
    const res = await fetch(commitUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const detail = await res.json();
    return (detail.files || []).map(f => f.filename);
  } catch {
    return [];
  }
}
