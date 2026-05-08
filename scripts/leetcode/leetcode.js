import { LeetCodeV1, LeetCodeV2 } from './versions.js';
import setupManualSubmitBtn from './submitBtn.js';
import {
  debounce,
  delay,
  DIFFICULTY,
  getBrowser,
  getDifficulty,
  isEmptyObject,
  AlgoRepError,
  mergeStats,
} from './util.js';
import { appendProblemToReadme, sortTopicsInReadme } from './readmeTopics.js';
import {
  saveSubmissionRecord,
  getSubmissionHistory,
  updateStreakData,
  updateTopicStats,
  buildSolutionsTable,
} from './submissionHistory.js';
import { scheduleProblemForReview } from './spacedRepetition.js';
import { analyzeSubmission, formatAnalysisMarkdown, saveAnalysis } from './aiAnalysis.js';

/* Commit messages */
const readmeMsg = 'Create README - AlgoRep';
const updateReadmeMsg = 'Update README - Topic Tags';
const updateStatsMsg = 'Updated stats';
const discussionMsg = 'Prepend discussion post - AlgoRep';
const createNotesMsg = 'Attach NOTES - AlgoRep';
const defaultRepoReadme =
  'A collection of LeetCode solutions with AI analysis and spaced repetition tracking - Created using [AlgoRep](https://github.com/ameyrane98/LeetHub-2.0)';
const readmeFilename = 'README.md';
const statsFilename = 'stats.json';

// problem types
const NORMAL_PROBLEM = 0;
const EXPLORE_SECTION_PROBLEM = 1;

const WAIT_FOR_GITHUB_API_TO_NOT_THROW_409_MS = 500;

const api = getBrowser();

// Attempt counter and solve timer state
let submitAttemptCount = 0;
let problemPageLoadTime = Date.now();

/**
 * Constructs a file path by appending the given filename to the problem directory.
 * If no filename is provided, it returns the problem name as the path.
 *
 * @param {string} problem - The base problem directory or the entire file path if no filename is provided.
 * @param {string} [filename] - Optional parameter for the filename to be appended to the problem directory.
 * @returns {string} - Returns a string representing the complete file path, either with or without the appended filename.
 */
const getPath = (problem, filename) => {
  return filename ? `${problem}/${filename}` : problem;
};

// https://web.archive.org/web/20190623091645/https://monsur.hossa.in/2012/07/20/utf-8-in-javascript.html
// In order to preserve mutation of the data, we have to encode it, which is usually done in base64.
// But btoa only accepts ASCII 7 bit chars (0-127) while Javascript uses 16-bit minimum chars (0-65535).
// EncodeURIComponent converts the Unicode Points UTF-8 bits to hex UTF-8.
// Unescape converts percent-encoded hex values into regular ASCII (optional; it shrinks string size).
// btoa converts ASCII to base64.
/** Decodes a base64 encoded string into UTF-8 format using URI encoding.*/
const decode = data => decodeURIComponent(escape(atob(data)));
/** Encodes a given string into base64 format.*/
const encode = data => btoa(unescape(encodeURIComponent(data)));

/**
 * Uploads content to a specified GitHub repository and updates local stats with the sha of the updated file.
 * @async
 * @param {string} token - The authentication token used to authorize the request.
 * @param {string} hook - The owner and repository name in the format 'owner/repo'.
 * @param {string} content - The content to be uploaded, typically a string encoded in base64.
 * @param {string} problem - The problem slug, which is a combination of problem ID and name, and acts as a folder.
 * @param {string} filename - The name of the file, typically the problem slug + file extension.
 * @param {string} sha - The SHA of the existing file.
 * @param {string} message - A commit message describing the change.
 * @param {string} [difficulty] - The difficulty level of the problem.
 *
 * @returns {Promise<string>} - A promise that resolves with the new SHA of the content after successful upload.
 *
 * @throws {AlgoRepError} - Throws an error if the response is not OK (e.g., HTTP status code is not `200-299`).
 */
const upload = async (token, hook, content, problem, filename, sha, message) => {
  const path = getPath(problem, filename);
  const URL = `https://api.github.com/repos/${hook}/contents/${path}`;

  let data = {
    message,
    content,
    sha,
  };

  let options = {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify(data),
  };

  const res = await fetch(URL, options);
  if (!res.ok) {
    throw new AlgoRepError(res.status, { cause: res });
  }
  console.log(`Successfully committed ${getPath(problem, filename)} to github`);

  const body = await res.json();
  //TODO: Think, should we be setting stats state here?
  const stats = await getAndInitializeStats(problem);
  stats.shas[problem][filename] = body.content.sha;
  api.storage.local.set({ stats });

  return body.content.sha;
};

// Returns stats object. If it didn't exist, initializes stats with default difficulty values and initializes the sha object for problem
const getAndInitializeStats = problem => {
  return api.storage.local.get('stats').then(({ stats }) => {
    if (stats == null || isEmptyObject(stats)) {
      stats = {};
      stats.shas = {};
      stats.solved = 0;
      stats.easy = 0;
      stats.medium = 0;
      stats.hard = 0;
    }

    if (stats.shas[problem] == null) {
      stats.shas[problem] = {};
    }

    return stats;
  });
};

/**
 * Increment the statistics for a given problem based on its difficulty.
 * @param {DIFFICULTY} difficulty - The difficulty level of the problem, which can be `easy`, `medium`, or `hard`.
 * @param {string} problem - The slug problem name, e.g. `0001-two-sum`
 * @returns {Promise<Object>} A promise that resolves to the updated statistics object.
 */
const incrementStats = (difficulty, problem) => {
  const diff = getDifficulty(difficulty);
  return api.storage.local.get('stats').then(({ stats }) => {
    stats.solved += 1;
    stats.easy += diff === DIFFICULTY.EASY ? 1 : 0;
    stats.medium += diff === DIFFICULTY.MEDIUM ? 1 : 0;
    stats.hard += diff === DIFFICULTY.HARD ? 1 : 0;
    stats.shas[problem].difficulty = diff.toLowerCase();
    api.storage.local.set({ stats });
    return stats;
  });
};

/**
 * Sets persistent stats and merges any cloud updates into local stats
 * @async
 * @param {Object} localStats - Local statistics about LeetCode problems.
 * @returns {Promise<void>} A promise that resolves to the sha of the newly updated `stats.json` file.
 *
 * @throws {Error} - If the upload operation fails for any reason other than 409 Conflict
 */
const setPersistentStats = async localStats => {
  let pStats = { leetcode: localStats };
  const pStatsEncoded = encode(JSON.stringify(pStats));
  const sha = localStats?.shas?.[readmeFilename]?.[''] || '';

  const { algorep_token: token, algorep_hook: hook } = await api.storage.local.get([
    'algorep_token',
    'algorep_hook',
  ]);

  try {
    return await upload(token, hook, pStatsEncoded, statsFilename, '', sha, updateStatsMsg);
  } catch (e) {
    if (e.message === '409') {
      // Stats were updated on GitHub since last submission
      const { content, sha } = await getGitHubFile(token, hook, statsFilename).then(res =>
        res.json()
      );
      pStats = JSON.parse(decode(content));
      const mergedStats = mergeStats(pStats.leetcode, localStats);
      const mergedStatsEncoded = encode(JSON.stringify({ leetcode: mergedStats }));

      // Update local stats with the changes from GitHub
      await api.storage.local.set({ stats: mergedStats });

      return await delay(
        () => upload(token, hook, mergedStatsEncoded, statsFilename, '', sha, updateStatsMsg),
        WAIT_FOR_GITHUB_API_TO_NOT_THROW_409_MS
      );
    }
    throw e;
  }
};

/* Discussion posts prepended at top of README */
/* Future implementations may require appending to bottom of file */
const updateReadmeWithDiscussionPost = async (
  addition,
  directory,
  filename,
  commitMsg,
  shouldPreprendDiscussionPosts
) => {
  let responseSHA;
  const { algorep_token, algorep_hook } = await api.storage.local.get([
    'algorep_token',
    'algorep_hook',
  ]);

  return getGitHubFile(algorep_token, algorep_hook, directory, filename)
    .then(resp => resp.json())
    .then(data => {
      responseSHA = data.sha;
      return decode(data.content);
    })
    .then(existingContent =>
      shouldPreprendDiscussionPosts ? encode(addition + existingContent) : encode(existingContent)
    )
    .then(newContent =>
      upload(algorep_token, algorep_hook, newContent, directory, filename, responseSHA, commitMsg)
    );
};

/**
 * Wrapper func to upload code to a specific GitHub repository and handle 409 errors (conflict)
 * @async
 * @function uploadGitWith409Retry
 * @param {string} code - The code content that needs to be uploaded.
 * @param {string} problemName - The name of the problem or file where the code is related to.
 * @param {string} filename - The target filename in the repository where the code will be stored.
 * @param {string} commitMsg - The commit message that describes the changes being made.
 * @param {Object} [optionals] - Optional parameters for updating stats
 * @param {string} optionals.sha - The SHA value of the existing content to be updated (optional).
 * @param {DIFFICULTY} optionals.difficulty - The difficulty level of the problem (optional).
 *
 * @returns {Promise<string>} A promise that resolves with the new SHA of the content after successful upload.
 *
 * @throws {AlgoRepError} If there's no token defined, the mode type is not `commit`, or if no repository hook is defined.
 */
async function uploadGitWith409Retry(
  code,
  groupName,
  primaryTopic,
  problemName,
  filename,
  commitMsg,
  optionals
) {
  let token;
  let hook;

  const storageData = await api.storage.local.get([
    'algorep_token',
    'mode_type',
    'algorep_hook',
    'stats',
  ]);

  token = storageData.algorep_token;
  if (!token) {
    throw new AlgoRepError('LeethubTokenUndefined');
  }

  if (storageData.mode_type !== 'commit') {
    throw new AlgoRepError('LeetHubNotAuthorizedByGit');
  }

  hook = storageData.algorep_hook;
  if (!hook) {
    throw new AlgoRepError('NoRepoDefined');
  }

  // Construct the full path for the file, including group, topic, and problem name
  const fullPath = `${groupName}/${primaryTopic}/${problemName}`;

  // Retrieve SHA if it exists in storageData.stats
  const sha = optionals?.sha
    ? optionals.sha
    : storageData.stats?.shas?.[fullPath]?.[filename] !== undefined
    ? storageData.stats.shas[fullPath][filename]
    : '';

  try {
    // Attempt to upload with encoded content
    return await upload(
      token,
      hook,
      code, // Pass encoded content here
      fullPath,
      filename,
      sha,
      commitMsg,
      optionals?.difficulty
    );
  } catch (err) {
    if (err.message === '409') {
      // Handle conflict by retrieving existing SHA and retrying upload
      const data = await getGitHubFile(token, hook, fullPath, filename).then(res => res.json());
      return upload(
        token,
        hook,
        code, // Use encoded content here as well
        fullPath,
        filename,
        data.sha,
        commitMsg,
        optionals?.difficulty
      );
    }
    throw err;
  }
}

/** Returns GitHub data for the file specified by `${directory}/${filename}` path
 * @async
 * @function getGitHubFile
 * @param {string} token - The personal access token for authentication with GitHub.
 * @param {string} hook - The owner and repository name in the format "owner/repository".
 * @param {string} directory - The directory within the repository where the file is located.
 * @param {string} filename - The name of the file to be fetched.
 * @returns {Promise<Response>} A promise that resolves with the response from the GitHub API request.
 * @throws {Error} Throws an error if the response is not OK (e.g., HTTP status code is not 200-299).
 */
async function getGitHubFile(token, hook, directory, filename) {
  const path = getPath(directory, filename);
  const URL = `https://api.github.com/repos/${hook}/contents/${path}`;

  let options = {
    method: 'GET',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  };

  const res = await fetch(URL, options);
  if (!res.ok) {
    throw new Error(res.status);
  }

  return res;
}

/* Discussion Link - When a user makes a new post, the link is prepended to the README for that problem.*/
document.addEventListener('click', event => {
  const element = event.target;
  const oldPath = window.location.pathname;

  /* Act on Post button click */
  /* Complex since "New" button shares many of the same properties as "Post button */
  if (
    element &&
    (element.classList.contains('icon__3Su4') ||
      element.parentElement?.classList.contains('icon__3Su4') ||
      element.parentElement?.classList.contains('btn-content-container__214G') ||
      element.parentElement?.classList.contains('header-right__2UzF'))
  ) {
    setTimeout(function () {
      /* Only post if post button was clicked and url changed */
      if (
        oldPath !== window.location.pathname &&
        oldPath === window.location.pathname.substring(0, oldPath.length) &&
        !Number.isNaN(window.location.pathname.charAt(oldPath.length))
      ) {
        const date = new Date();
        const currentDate = `${date.getDate()}/${date.getMonth()}/${date.getFullYear()} at ${date.getHours()}:${date.getMinutes()}`;
        const addition = `[Discussion Post (created on ${currentDate})](${window.location})  \n`;
        const problemName = window.location.pathname.split('/')[2]; // must be true.
        updateReadmeWithDiscussionPost(addition, problemName, readmeFilename, discussionMsg, true);
      }
    }, 1000);
  }
});

function createRepoReadme() {
  const content = encode(defaultRepoReadme);
  return uploadGitWith409Retry(content, readmeFilename, '', readmeMsg);
}

async function updateReadmeTopicTagsWithProblem(topicTags, problemName) {
  if (topicTags == null) {
    console.log(new AlgoRepError('TopicTagsNotFound'));
    return;
  }

  const { algorep_token, algorep_hook, stats } = await api.storage.local.get([
    'algorep_token',
    'algorep_hook',
    'stats',
  ]);

  let readme;
  let newSha;

  try {
    const { content, sha } = await getGitHubFile(
      algorep_token,
      algorep_hook,
      readmeFilename
    ).then(resp => resp.json());
    readme = content;
    stats.shas[readmeFilename] = { '': sha };
    await api.storage.local.set({ stats });
  } catch (err) {
    if (err.message === '404') {
      newSha = await createRepoReadme();
    }
    throw err;
  }
  readme = decode(readme);
  for (let topic of topicTags) {
    readme = appendProblemToReadme(topic.name, readme, algorep_hook, problemName);
  }
  readme = sortTopicsInReadme(readme);
  readme = encode(readme);

  return delay(
    () => uploadGitWith409Retry(readme, readmeFilename, '', updateReadmeMsg, { sha: newSha }),
    WAIT_FOR_GITHUB_API_TO_NOT_THROW_409_MS
  );
}

/**
 * Finds the next available version number for a same-language re-submission.
 * Checks stats.shas for existing versioned files like "0001-two-sum-v1.py", "0001-two-sum-v2.py".
 * @param {Object} shas - The shas object for the problem's fullPath
 * @param {string} problemName - The problem slug
 * @param {string} language - The language extension (e.g. ".py")
 * @returns {number} The next version number (1 if no versions exist yet)
 */
function getNextVersionNumber(shas, problemName, language) {
  let maxVersion = 0;
  for (const file of Object.keys(shas || {})) {
    const versionMatch = file.match(new RegExp(`^${problemName}-v(\\d+)\\${language}$`));
    if (versionMatch) {
      maxVersion = Math.max(maxVersion, parseInt(versionMatch[1], 10));
    }
  }
  return maxVersion + 1;
}

/** @param {LeetCodeV1 | LeetCodeV2} leetCode */
function loader(leetCode) {
  let iterations = 0;
  const solveStartTime = problemPageLoadTime;
  const attempts = submitAttemptCount;

  const intervalId = setInterval(async () => {
    try {
      const isSuccessfulSubmission = leetCode.getSuccessStateAndUpdate();
      if (!isSuccessfulSubmission) {
        iterations++;
        if (iterations > 9) {
          // poll for max 10 attempts (10 seconds)
          throw new AlgoRepError('Could not find successful submission after 10 seconds.');
        }
        return;
      }
      leetCode.startSpinner();

      // If successful, stop polling
      clearInterval(intervalId);

      // Calculate solve time
      const solveTimeMs = Date.now() - solveStartTime;

      // For v2, query LeetCode API for submission results
      await leetCode.init();

      const probStats = leetCode.parseStats();
      if (!probStats) {
        throw new AlgoRepError('SubmissionStatsNotFound');
      }

      const probStatement = leetCode.parseQuestion();
      if (!probStatement) {
        throw new AlgoRepError('ProblemStatementNotFound');
      }

      // Extract `envId` and set it as the group title
      const envId = getEnvIdFromUrl();
      if (envId) {
        leetCode.submissionData = leetCode.submissionData || {};
        leetCode.submissionData.question = leetCode.submissionData.question || {};
        leetCode.submissionData.question.questionGroupTitle = envId;
      }

      // Extract the group name and primary topic
      let groupName = leetCode.submissionData?.question?.questionGroupTitle || 'general';
      console.log(leetCode.submissionData.question);
      const topicTags = leetCode.submissionData?.question?.topicTags || [];
      let primaryTopic = topicTags.length > 0 ? topicTags[0].name.toLowerCase() : 'misc';

      const problemName = leetCode.getProblemNameSlug();
      const language = leetCode.getLanguageExtension();
      if (!language) {
        throw new AlgoRepError('LanguageNotFound');
      }
      const filename = problemName + language;

      // Reuse the prior folder for this problem if it was uploaded before, so re-submissions
      // don't create a duplicate when LeetCode's topic-tag ordering shifts between submissions.
      const { stats: priorStats } = await api.storage.local.get('stats');
      let fullPath = `${groupName}/${primaryTopic}/${problemName}`;
      if (priorStats?.shas) {
        const suffix = `/${problemName}`;
        const existingPath = Object.keys(priorStats.shas).find(p => p.endsWith(suffix));
        if (existingPath) {
          const parts = existingPath.split('/');
          if (parts.length >= 3) {
            fullPath = existingPath;
            groupName = parts[0];
            primaryTopic = parts.slice(1, -1).join('/');
          }
        }
      }

      // True if any prior submission for this problem (any language) is already on record.
      const alreadyCompleted = !!(
        priorStats?.shas?.[fullPath] &&
        Object.keys(priorStats.shas[fullPath]).some(k => k.includes(problemName))
      );

      // --- Multi-Solution Versioning ---
      // If the same problem+language file already exists at this path, archive the old version
      let archiveOldVersion;
      const existingSha = priorStats?.shas?.[fullPath]?.[filename];
      if (existingSha) {
        const { algorep_token, algorep_hook } = await api.storage.local.get([
          'algorep_token',
          'algorep_hook',
        ]);
        try {
          const oldFileData = await getGitHubFile(
            algorep_token,
            algorep_hook,
            fullPath,
            filename
          ).then(res => res.json());

          const nextVersion = getNextVersionNumber(priorStats.shas[fullPath], problemName, language);
          const versionedFilename = `${problemName}-v${nextVersion}${language}`;

          archiveOldVersion = uploadGitWith409Retry(
            oldFileData.content, // already base64 encoded from GitHub
            groupName,
            primaryTopic,
            problemName,
            versionedFilename,
            `Archive previous solution as ${versionedFilename}`
          );
        } catch (e) {
          console.log('Could not archive old version:', e);
        }
      }

      /* Upload README */
      const uploadReadMe = await api.storage.local.get('stats').then(({ stats }) => {
        const shaExists = stats?.shas?.[fullPath]?.[readmeFilename] !== undefined;

        if (!shaExists) {
          return uploadGitWith409Retry(
            encode(probStatement),
            groupName,
            primaryTopic,
            problemName,
            readmeFilename,
            readmeMsg
          );
        }
      });

      /* Upload Notes if any*/
      let uploadNotes;
      const notes = leetCode.getNotesIfAny();
      if (notes != undefined && notes.length > 0) {
        uploadNotes = uploadGitWith409Retry(
          encode(notes),
          groupName,
          primaryTopic,
          problemName,
          'NOTES.md',
          createNotesMsg
        );
      }

      /* Upload code to Git */
      const code = leetCode.findCode(probStats);
      const uploadCode = uploadGitWith409Retry(
        encode(code),
        groupName,
        primaryTopic,
        problemName,
        filename,
        'Uploaded code'
      );

      /* Group problem into its relevant topics */
      const updateRepoReadMe = updateReadmeTopicTagsWithProblem(
        leetCode.submissionData?.question?.topicTags,
        problemName
      );

      // Wait for archive to finish before main uploads (to avoid SHA conflicts)
      if (archiveOldVersion) {
        await archiveOldVersion;
        await delay(() => {}, WAIT_FOR_GITHUB_API_TO_NOT_THROW_409_MS);
      }

      await Promise.all([uploadReadMe, uploadNotes, uploadCode, updateRepoReadMe]);

      // --- Save Rich Submission History ---
      const languageName =
        leetCode.submissionData?.lang?.verboseName || leetCode.submissionData?.lang?.name || null;
      const submissionRecord = await saveSubmissionRecord(problemName, leetCode.submissionData, {
        difficulty: leetCode.difficulty,
        language,
        languageName,
        groupName,
        primaryTopic,
        attempts,
        solveTimeMs,
      });

      // --- AI Analysis (runs async, updates README when done) ---
      const aiAnalysisPromise = (async () => {
        try {
          const analysis = await analyzeSubmission({
            code,
            title: leetCode.submissionData?.question?.title,
            difficulty: leetCode.difficulty,
            language: languageName,
          });

          if (analysis) {
            await saveAnalysis(problemName, analysis);
            console.log('AlgoRep AI Analysis:', analysis);

            // Build enriched README with AI analysis + solutions history
            let enrichedReadme = probStatement;
            enrichedReadme += formatAnalysisMarkdown(analysis);

            const history = await getSubmissionHistory(problemName);
            if (history.length > 1) {
              enrichedReadme += buildSolutionsTable(history);
            }

            await delay(
              () =>
                uploadGitWith409Retry(
                  encode(enrichedReadme),
                  groupName,
                  primaryTopic,
                  problemName,
                  readmeFilename,
                  'Update README with AI analysis - AlgoRep'
                ),
              WAIT_FOR_GITHUB_API_TO_NOT_THROW_409_MS
            );
          }
        } catch (e) {
          console.log('AlgoRep AI: Analysis failed (non-blocking):', e.message);
        }
      })();

      // --- Update Solutions Table in README (for re-solves, only if no AI analysis) ---
      if (alreadyCompleted) {
        const history = await getSubmissionHistory(problemName);
        if (history.length > 1) {
          // Only update with plain solutions table if AI analysis won't do it
          aiAnalysisPromise.then(async () => {
            // Check if AI already updated the README
            const { aiAnalysis = {} } = await api.storage.local.get('aiAnalysis');
            if (aiAnalysis[problemName]) return; // AI already handled it

            const solutionsTable = buildSolutionsTable(history);
            const readmeWithTable = probStatement + solutionsTable;
            try {
              await delay(
                () =>
                  uploadGitWith409Retry(
                    encode(readmeWithTable),
                    groupName,
                    primaryTopic,
                    problemName,
                    readmeFilename,
                    'Update README with solutions history'
                  ),
                WAIT_FOR_GITHUB_API_TO_NOT_THROW_409_MS
              );
            } catch (e) {
              console.log('Could not update README with solutions table:', e);
            }
          });
        }
      }

      // --- Update Streak, Topic Stats, and Spaced Repetition ---
      updateStreakData().catch(e => console.log('Could not update streak:', e));
      updateTopicStats(topicTags, problemName).catch(e =>
        console.log('Could not update topic stats:', e)
      );
      scheduleProblemForReview(problemName, {
        title: leetCode.submissionData?.question?.title,
        difficulty: leetCode.difficulty,
        titleSlug: leetCode.submissionData?.question?.titleSlug,
        topicTags: topicTags.map(t => t.name),
      }).catch(e => console.log('Could not schedule for review:', e));

      leetCode.markUploaded();

      if (!alreadyCompleted) {
        // Increments local and persistent stats
        incrementStats(leetCode.difficulty, problemName).then(setPersistentStats);
      }

      // Reset attempt counter for next problem
      submitAttemptCount = 0;
    } catch (err) {
      leetCode.markUploadFailed();
      clearInterval(intervalId);

      if (!(err instanceof AlgoRepError)) {
        console.error(err);
        return;
      }
    }
  }, 1000);
}

/**
 * Submit by Keyboard Shortcuts (only supported on LeetCode v2)
 * @param {Event} event
 * @returns
 */
function wasSubmittedByKeyboard(event) {
  const isEnterKey = event.key === 'Enter';
  const isMacOS = window.navigator.userAgent.includes('Mac');

  // Adapt to MacOS operating system
  return isEnterKey && ((isMacOS && event.metaKey) || (!isMacOS && event.ctrlKey));
}

/**
 * Get SubmissionID by listening for URL changes to `/submissions/(d+)` format
 * @returns {string} submissionId
 */
async function listenForSubmissionId() {
  const { submissionId } = await api.runtime.sendMessage({
    type: 'LEETCODE_SUBMISSION',
  });
  if (submissionId == null) {
    console.log(new AlgoRepError('SubmissionIdNotFound'));
    return;
  }
  return submissionId;
}

/**
 * @param {Event} event
 * @param {LeetCodeV2} leetCode
 * @returns {void}
 */
async function v2SubmissionHandler(event, leetCode) {
  if (event.type !== 'click' && !wasSubmittedByKeyboard(event)) {
    return;
  }

  // Track submission attempts
  submitAttemptCount++;

  const authenticated =
    !isEmptyObject(await api.storage.local.get(['algorep_token'])) &&
    !isEmptyObject(await api.storage.local.get(['algorep_hook']));
  if (!authenticated) {
    throw new AlgoRepError('UserNotAuthenticated');
  }

  // is click or is ctrl enter
  const submissionId = await listenForSubmissionId();

  leetCode.submissionId = submissionId;
  loader(leetCode);
  return true;
}

function getEnvIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('envId');
}

// Use MutationObserver to determine when the submit button elements are loaded
const submitBtnObserver = new MutationObserver(function (_mutations, observer) {
  const v1SubmitBtn = document.querySelector('[data-cy="submit-code-btn"]');
  const v2SubmitBtn = document.querySelector('[data-e2e-locator="console-submit-button"]');
  const textareaList = document.getElementsByTagName('textarea');
  const textarea =
    textareaList.length === 4
      ? textareaList[2]
      : textareaList.length === 2
      ? textareaList[0]
      : textareaList[1];

  if (v1SubmitBtn) {
    observer.disconnect();

    const leetCode = new LeetCodeV1();
    v1SubmitBtn.addEventListener('click', () => {
      submitAttemptCount++;
      loader(leetCode);
    });
    return;
  }

  if (v2SubmitBtn && textarea) {
    observer.disconnect();

    const leetCode = new LeetCodeV2();
    if (!!!v2SubmitBtn.onclick) {
      textarea.addEventListener('keydown', e => v2SubmissionHandler(e, leetCode));
      v2SubmitBtn.onclick = e => v2SubmissionHandler(e, leetCode);
    }
  }
});

submitBtnObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

/* Sync to local storage */
api.storage.local.get('isSync', data => {
  const keys = [
    'algorep_token',
    'leethub_username',
    'pipe_leethub',
    'stats',
    'algorep_hook',
    'mode_type',
  ];
  if (!data || !data.isSync) {
    keys.forEach(key => {
      api.storage.sync.get(key, data => {
        api.storage.local.set({ [key]: data[key] });
      });
    });
    api.storage.local.set({ isSync: true }, () => {
      console.log('AlgoRep Synced to local values');
    });
  } else {
    console.log('AlgoRep Local storage already synced!');
  }
});

// Reset attempt counter and solve timer on problem page navigation
let lastProblemUrl = window.location.pathname;
const navigationObserver = new MutationObserver(() => {
  const currentUrl = window.location.pathname;
  if (currentUrl !== lastProblemUrl) {
    lastProblemUrl = currentUrl;
    // Reset if navigating to a new problem (URL contains /problems/)
    if (currentUrl.includes('/problems/')) {
      submitAttemptCount = 0;
      problemPageLoadTime = Date.now();
    }
  }
});
navigationObserver.observe(document.body, { childList: true, subtree: true });

setupManualSubmitBtn(
  debounce(
    () => {
      const leetCode = new LeetCodeV2();
      // Manual submission event can only fire when we have submissionId. Simply retrieve it.
      const submissionMatch = window.location.href.match(/leetcode\.com\/.*\/submissions\/(\d+)/);
      if (!submissionMatch) return;
      leetCode.submissionId = submissionMatch[1];
      loader(leetCode);
      return;
    },
    5000,
    true
  )
);

// --- In-Page Problem Status Badges ---
// Injects green checkmarks next to problems that have been synced to GitHub
function injectProblemBadges() {
  api.storage.local.get('stats', ({ stats }) => {
    if (!stats?.shas) return;

    // Build a set of solved problem slugs from stats.shas keys
    const solvedSlugs = new Set();
    for (const fullPath of Object.keys(stats.shas)) {
      const slug = fullPath.split('/').pop();
      if (slug) solvedSlugs.add(slug);
    }

    if (solvedSlugs.size === 0) return;

    // Find all problem links on the page
    const links = document.querySelectorAll('a[href*="/problems/"]');
    for (const link of links) {
      // Skip already-badged links
      if (link.querySelector('.algorep-synced-badge')) continue;

      const match = link.href.match(/\/problems\/([^/]+)/);
      if (!match) continue;

      const titleSlug = match[1];

      // Check if any solved slug ends with this titleSlug
      const isSolved = [...solvedSlugs].some(slug => slug.endsWith(titleSlug));

      if (isSolved) {
        const badge = document.createElement('span');
        badge.className = 'algorep-synced-badge';
        badge.title = 'Synced to GitHub via AlgoRep';
        badge.style.cssText =
          'display:inline-block;margin-left:4px;color:#5cb85c;font-size:12px;vertical-align:middle;';
        badge.textContent = '\u2713'; // checkmark
        link.appendChild(badge);
      }
    }
  });
}

// Inject badges whenever the page content changes (SPA navigation)
const badgeObserver = new MutationObserver(
  debounce(() => {
    if (
      window.location.pathname.includes('/problemset/') ||
      window.location.pathname.includes('/problem-list/') ||
      window.location.pathname.includes('/tag/') ||
      window.location.pathname.includes('/study-plan/') ||
      window.location.pathname === '/'
    ) {
      injectProblemBadges();
    }
  }, 500)
);
badgeObserver.observe(document.body, { childList: true, subtree: true });

// Initial injection
injectProblemBadges();

class LeetHubNetworkError extends AlgoRepError {
  constructor(response) {
    super(response.statusText);
    this.status = response.status;
  }
}
