import { getBrowser } from './util.js';

const api = getBrowser();

/**
 * Saves a submission record to chrome.storage.local under the `submissionHistory` key.
 * Each problem slug maps to an array of submission records, ordered chronologically.
 *
 * @param {string} problemName - The problem slug, e.g. "0001-two-sum"
 * @param {Object} submissionData - The raw submission data from LeetCode's GraphQL API
 * @param {Object} extras - Additional data not in submissionData
 * @param {string} extras.difficulty - Normalized difficulty string
 * @param {string} extras.language - Language extension string (e.g. ".py")
 * @param {string} extras.languageName - Language display name (e.g. "Python3")
 * @param {string} extras.groupName - The group folder name
 * @param {string} extras.primaryTopic - The primary topic folder name
 * @param {number} [extras.attempts] - Number of submit attempts before acceptance
 * @param {number} [extras.solveTimeMs] - Time from page load to acceptance in ms
 * @returns {Promise<void>}
 */
export async function saveSubmissionRecord(problemName, submissionData, extras) {
  const record = {
    timestamp: submissionData?.timestamp || Math.floor(Date.now() / 1000),
    date: new Date().toISOString().split('T')[0],
    submissionId: submissionData?.submissionId || null,
    runtime: submissionData?.runtimeDisplay || null,
    runtimePercentile: submissionData?.runtimePercentile
      ? Math.round((submissionData.runtimePercentile + Number.EPSILON) * 100) / 100
      : null,
    memory: submissionData?.memoryDisplay || null,
    memoryPercentile: submissionData?.memoryPercentile
      ? Math.round((submissionData.memoryPercentile + Number.EPSILON) * 100) / 100
      : null,
    language: extras.languageName || null,
    languageExt: extras.language || null,
    difficulty: extras.difficulty || null,
    topicTags: (submissionData?.question?.topicTags || []).map(t => t.name),
    questionId: submissionData?.question?.questionId || null,
    title: submissionData?.question?.title || null,
    titleSlug: submissionData?.question?.titleSlug || null,
    groupName: extras.groupName || 'general',
    primaryTopic: extras.primaryTopic || 'misc',
    attempts: extras.attempts || null,
    solveTimeMs: extras.solveTimeMs || null,
  };

  const { submissionHistory = {} } = await api.storage.local.get('submissionHistory');

  if (!submissionHistory[problemName]) {
    submissionHistory[problemName] = [];
  }

  submissionHistory[problemName].push(record);

  await api.storage.local.set({ submissionHistory });
  return record;
}

/**
 * Gets submission history for a specific problem.
 * @param {string} problemName - The problem slug
 * @returns {Promise<Array>} Array of submission records
 */
export async function getSubmissionHistory(problemName) {
  const { submissionHistory = {} } = await api.storage.local.get('submissionHistory');
  return submissionHistory[problemName] || [];
}

/**
 * Gets all submission history.
 * @returns {Promise<Object>} Map of problem slugs to submission record arrays
 */
export async function getAllSubmissionHistory() {
  const { submissionHistory = {} } = await api.storage.local.get('submissionHistory');
  return submissionHistory;
}

/**
 * Updates streak data based on a new solve.
 * Tracks current streak, longest streak, last solve date, and daily activity.
 * @returns {Promise<Object>} Updated streak data
 */
export async function updateStreakData() {
  const { streakData = {} } = await api.storage.local.get('streakData');

  const today = new Date().toISOString().split('T')[0];

  if (!streakData.lastSolveDate) {
    streakData.currentStreak = 1;
    streakData.longestStreak = 1;
    streakData.lastSolveDate = today;
    streakData.activityDays = { [today]: 1 };
    await api.storage.local.set({ streakData });
    return streakData;
  }

  // Increment activity count for today
  if (!streakData.activityDays) streakData.activityDays = {};
  streakData.activityDays[today] = (streakData.activityDays[today] || 0) + 1;

  // Calculate streak
  const lastDate = new Date(streakData.lastSolveDate + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Same day, no streak change
  } else if (diffDays === 1) {
    // Consecutive day
    streakData.currentStreak = (streakData.currentStreak || 0) + 1;
  } else {
    // Streak broken
    streakData.currentStreak = 1;
  }

  streakData.longestStreak = Math.max(
    streakData.longestStreak || 0,
    streakData.currentStreak
  );
  streakData.lastSolveDate = today;

  await api.storage.local.set({ streakData });
  return streakData;
}

/**
 * Updates topic stats based on a new solve.
 * Tracks count of problems solved per topic tag.
 * @param {Array<{name: string}>} topicTags - Topic tags from the problem
 * @param {string} problemName - The problem slug (to prevent double-counting)
 * @returns {Promise<Object>} Updated topic stats
 */
export async function updateTopicStats(topicTags, problemName) {
  const { topicStats = {} } = await api.storage.local.get('topicStats');

  if (!topicStats._solvedProblems) {
    topicStats._solvedProblems = {};
  }

  // Only count each problem once per topic
  if (topicStats._solvedProblems[problemName]) {
    return topicStats;
  }
  topicStats._solvedProblems[problemName] = true;

  for (const tag of topicTags || []) {
    const name = tag.name || tag;
    if (!topicStats[name]) {
      topicStats[name] = 0;
    }
    topicStats[name]++;
  }

  await api.storage.local.set({ topicStats });
  return topicStats;
}

/**
 * Builds a solutions comparison table in markdown format for a problem's README.
 * @param {Array} submissions - Array of submission records for this problem
 * @returns {string} Markdown table string
 */
export function buildSolutionsTable(submissions) {
  if (!submissions || submissions.length <= 1) return '';

  let table = '\n\n---\n### Solutions History\n';
  table += '| # | Date | Runtime | Memory | Language |\n';
  table += '|---|------|---------|--------|----------|\n';

  submissions.forEach((sub, i) => {
    const runtime = sub.runtimePercentile
      ? `${sub.runtime} (${sub.runtimePercentile}%)`
      : sub.runtime || 'N/A';
    const memory = sub.memoryPercentile
      ? `${sub.memory} (${sub.memoryPercentile}%)`
      : sub.memory || 'N/A';
    table += `| ${i + 1} | ${sub.date || 'N/A'} | ${runtime} | ${memory} | ${sub.language || 'N/A'} |\n`;
  });

  return table;
}
