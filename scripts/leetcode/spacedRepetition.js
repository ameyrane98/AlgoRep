import { getBrowser } from './util.js';

const api = getBrowser();

// Simplified Leitner box intervals (in days)
const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];

/**
 * Schedules a problem for spaced repetition review.
 * Uses a simplified Leitner system with increasing intervals.
 *
 * @param {string} problemName - The problem slug, e.g. "0001-two-sum"
 * @param {Object} metadata - Problem metadata for display
 * @param {string} metadata.title - Problem title
 * @param {string} metadata.difficulty - Problem difficulty
 * @param {string} metadata.titleSlug - Problem title slug for URL
 * @param {Array<string>} metadata.topicTags - Topic tag names
 * @returns {Promise<void>}
 */
export async function scheduleProblemForReview(problemName, metadata) {
  const { reviewQueue = {} } = await api.storage.local.get('reviewQueue');

  const today = new Date().toISOString().split('T')[0];

  if (!reviewQueue[problemName]) {
    // First time solving - start at box 0
    reviewQueue[problemName] = {
      box: 0,
      lastReviewed: today,
      nextReview: addDays(today, REVIEW_INTERVALS[0]),
      title: metadata.title || problemName,
      difficulty: metadata.difficulty || 'Unknown',
      titleSlug: metadata.titleSlug || problemName,
      topicTags: metadata.topicTags || [],
      solveCount: 1,
    };
  } else {
    // Re-solving - advance to next box
    const entry = reviewQueue[problemName];
    entry.box = Math.min(entry.box + 1, REVIEW_INTERVALS.length - 1);
    entry.lastReviewed = today;
    entry.nextReview = addDays(today, REVIEW_INTERVALS[entry.box]);
    entry.solveCount = (entry.solveCount || 0) + 1;
    // Update metadata in case it changed
    if (metadata.title) entry.title = metadata.title;
    if (metadata.difficulty) entry.difficulty = metadata.difficulty;
    if (metadata.topicTags) entry.topicTags = metadata.topicTags;
  }

  await api.storage.local.set({ reviewQueue });
}

/**
 * Gets problems that are due for review today or overdue.
 * @returns {Promise<Array<Object>>} Array of review entries sorted by priority (most overdue first)
 */
export async function getProblemsToReview() {
  const { reviewQueue = {} } = await api.storage.local.get('reviewQueue');
  const today = new Date().toISOString().split('T')[0];

  const due = [];
  for (const [problemName, entry] of Object.entries(reviewQueue)) {
    if (entry.nextReview <= today) {
      due.push({
        problemName,
        ...entry,
        daysOverdue: daysBetween(entry.nextReview, today),
      });
    }
  }

  // Sort by most overdue first
  due.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return due;
}

/**
 * Gets the count of problems due for review today.
 * @returns {Promise<number>}
 */
export async function getReviewCount() {
  const due = await getProblemsToReview();
  return due.length;
}

/**
 * Marks a problem as reviewed (without re-solving). Resets its box to 0.
 * Used when a user reviews but doesn't re-solve the problem.
 * @param {string} problemName
 * @returns {Promise<void>}
 */
export async function markAsReviewed(problemName) {
  const { reviewQueue = {} } = await api.storage.local.get('reviewQueue');
  if (reviewQueue[problemName]) {
    const today = new Date().toISOString().split('T')[0];
    // Reset to box 0 since they only reviewed, didn't re-solve
    reviewQueue[problemName].box = 0;
    reviewQueue[problemName].lastReviewed = today;
    reviewQueue[problemName].nextReview = addDays(today, REVIEW_INTERVALS[0]);
    await api.storage.local.set({ reviewQueue });
  }
}

/**
 * Adds N days to a date string.
 * @param {string} dateStr - ISO date string (YYYY-MM-DD)
 * @param {number} days - Number of days to add
 * @returns {string} New ISO date string
 */
function addDays(dateStr, days) {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Calculates the number of days between two date strings.
 * @param {string} from - ISO date string
 * @param {string} to - ISO date string
 * @returns {number}
 */
function daysBetween(from, to) {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}
