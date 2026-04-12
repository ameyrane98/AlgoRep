import { getBrowser } from "./leetcode/util.js";

let action = false;

let api = getBrowser()

$('#authenticate').on('click', () => {
  if (action) {
    oAuth2.begin();
  }
});

/* Get URL for welcome page */
$('#welcome_URL').attr('href', api.runtime.getURL('welcome.html'));
$('#hook_URL').attr('href', api.runtime.getURL('welcome.html'));
$('#reset_stats').on('click', () => {
  $('#reset_confirmation').show();
  $('#reset_yes').off('click').on('click', () => {
    api.storage.local.set({ stats: null });
    $('#p_solved').text(0);
    $('#p_solved_easy').text(0);
    $('#p_solved_medium').text(0);
    $('#p_solved_hard').text(0);
    $('#reset_confirmation').hide()
  })
  $('#reset_no').off('click').on('click', () => {
    $('#reset_confirmation').hide()
  })
});

// --- Study Plans Data (bundled) ---
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

// --- Render Streak ---
function renderStreak(streakData) {
  if (!streakData) return;
  $('#current_streak').text(streakData.currentStreak || 0);
  $('#longest_streak').text(streakData.longestStreak || 0);
}

// --- Render Review Queue ---
function renderReviewQueue(reviewQueue) {
  if (!reviewQueue || Object.keys(reviewQueue).length === 0) return;

  const today = new Date().toISOString().split('T')[0];
  const due = [];

  for (const [problemName, entry] of Object.entries(reviewQueue)) {
    if (entry.nextReview <= today) {
      due.push({ problemName, ...entry });
    }
  }

  if (due.length === 0) return;

  // Sort by most overdue first
  due.sort((a, b) => (a.nextReview > b.nextReview ? 1 : -1));

  $('#review_section').show();
  $('#review_count').text(due.length);

  const listEl = $('#review_list');
  listEl.empty();

  // Show up to 5 items
  const displayed = due.slice(0, 5);
  for (const item of displayed) {
    const slug = item.titleSlug || item.problemName;
    const url = `https://leetcode.com/problems/${slug}/`;
    const diffClass = (item.difficulty || '').toLowerCase();

    listEl.append(`
      <div class="review-item">
        <a href="${url}" target="_blank" title="${item.title || item.problemName}">${item.title || item.problemName}</a>
        <span class="review-difficulty ${diffClass}">${item.difficulty || ''}</span>
      </div>
    `);
  }

  if (due.length > 5) {
    listEl.append(`<div class="review-item" style="color:#888;justify-content:center;">+${due.length - 5} more</div>`);
  }
}

// --- Render Topic Mastery ---
function renderTopicStats(topicStats) {
  if (!topicStats || Object.keys(topicStats).length === 0) return;

  // Filter out internal keys
  const topics = Object.entries(topicStats)
    .filter(([key]) => !key.startsWith('_'))
    .sort((a, b) => b[1] - a[1]);

  if (topics.length === 0) return;

  $('#topics_section').show();

  const listEl = $('#topics_list');
  listEl.empty();

  const maxCount = topics[0][1];

  // Show top 8 topics
  const displayed = topics.slice(0, 8);
  for (const [name, count] of displayed) {
    const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;

    // Color based on count relative to max
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
    listEl.append(`<div class="topic-row" style="color:#888;font-size:10px;justify-content:center;">+${topics.length - 8} more topics</div>`);
  }
}

// --- Render Study Plan ---
async function renderStudyPlan(stats) {
  const plans = await loadStudyPlans();
  if (!plans) return;

  $('#study_plan_section').show();

  const updatePlan = () => {
    const planKey = $('#study_plan_select').val();
    const plan = plans[planKey];
    if (!plan) return;

    // Collect all problem slugs in the plan
    const allProblems = [];
    for (const category of Object.values(plan.problems)) {
      for (const slug of category) {
        if (!allProblems.includes(slug)) {
          allProblems.push(slug);
        }
      }
    }

    // Check which are solved by looking at stats.shas keys
    const solvedSlugs = new Set();
    if (stats?.shas) {
      for (const fullPath of Object.keys(stats.shas)) {
        // fullPath is like "general/array/0001-two-sum"
        const slug = fullPath.split('/').pop();
        if (slug) solvedSlugs.add(slug);
      }
    }

    const solved = allProblems.filter(p => solvedSlugs.has(p)).length;
    const total = allProblems.length;
    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;

    $('#plan_progress_fill').css('width', pct + '%');
    $('#plan_progress_text').text(`${solved}/${total}`);

    // Find next unsolved problem
    const nextUnsolved = allProblems.find(p => !solvedSlugs.has(p));
    if (nextUnsolved) {
      const slug = nextUnsolved.replace(/^\d+-/, '');
      const displayName = nextUnsolved;
      $('#plan_next_problem').html(
        `Next: <a href="https://leetcode.com/problems/${slug}/" target="_blank">${displayName}</a>`
      );
    } else {
      $('#plan_next_problem').text('All problems completed!');
    }
  };

  $('#study_plan_select').off('change').on('change', updatePlan);
  updatePlan();
}

// --- Render AI Settings ---
function renderAISettings() {
  // Check Chrome Built-in AI availability
  const hasBuiltInAI =
    (typeof self !== 'undefined' && self.ai?.languageModel) ||
    (typeof chrome !== 'undefined' && chrome.aiOriginTrial?.languageModel);

  if (hasBuiltInAI) {
    $('#ai_status').text('On-Device').addClass('active');
    $('#ai_chrome_info').text('Using Chrome Built-in AI (free, on-device)');
  } else {
    // Check for API key
    api.storage.local.get(['leethub_ai_key', 'leethub_ai_provider'], data => {
      if (data.leethub_ai_key) {
        const provider = (data.leethub_ai_provider || 'gemini').charAt(0).toUpperCase()
          + (data.leethub_ai_provider || 'gemini').slice(1);
        $('#ai_status').text(provider).addClass('active');
        $('#ai_chrome_info').text(`Using ${provider} API`);
      } else {
        $('#ai_status').text('No AI').addClass('inactive');
        $('#ai_chrome_info').text('Add an API key below, or use Chrome 131+ for free on-device AI');
      }
    });
  }

  // Load saved provider
  api.storage.local.get(['leethub_ai_provider', 'leethub_ai_key'], data => {
    if (data.leethub_ai_provider) {
      $('#ai_provider').val(data.leethub_ai_provider);
    }
    if (data.leethub_ai_key) {
      $('#ai_key').attr('placeholder', 'Key saved (enter new to replace)');
    }
  });

  // Save API key
  $('#ai_save_key').off('click').on('click', () => {
    const key = $('#ai_key').val().trim();
    const provider = $('#ai_provider').val();
    if (key) {
      api.storage.local.set({
        leethub_ai_key: key,
        leethub_ai_provider: provider,
      }, () => {
        $('#ai_key').val('');
        $('#ai_key').attr('placeholder', 'Key saved (enter new to replace)');
        const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
        $('#ai_status').text(providerName).removeClass('inactive').addClass('active');
        $('#ai_chrome_info').text(`Using ${providerName} API`);
      });
    }
  });
}

// --- Main Auth & Data Loading ---
api.storage.local.get('leethub_token', data => {
  const token = data.leethub_token;
  if (token === null || token === undefined) {
    action = true;
    $('#auth_mode').show();
  } else {
    // To validate user, load user object from GitHub.
    const AUTHENTICATION_URL = 'https://api.github.com/user';

    const xhr = new XMLHttpRequest();
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          /* Show MAIN FEATURES */
          api.storage.local.get('mode_type', data2 => {
            if (data2 && data2.mode_type === 'commit') {
              $('#commit_mode').show();
              /* Get problem stats and repo link */
              api.storage.local.get(
                ['stats', 'leethub_hook', 'streakData', 'reviewQueue', 'topicStats'],
                data3 => {
                  const stats = data3?.stats;
                  $('#p_solved').text(stats?.solved ?? 0);
                  $('#p_solved_easy').text(stats?.easy ?? 0);
                  $('#p_solved_medium').text(stats?.medium ?? 0);
                  $('#p_solved_hard').text(stats?.hard ?? 0);
                  const leethubHook = data3?.leethub_hook;
                  if (leethubHook) {
                    $('#repo_url').html(
                      `<a target="blank" style="color: cadetblue !important; font-size:0.8em;" href="https://github.com/${leethubHook}">${leethubHook}</a>`
                    );
                  }

                  // Render new features
                  renderStreak(data3?.streakData);
                  renderReviewQueue(data3?.reviewQueue);
                  renderTopicStats(data3?.topicStats);
                  renderStudyPlan(stats);
                  renderAISettings();
                }
              );
            } else {
              $('#hook_mode').show();
            }
          });
        } else if (xhr.status === 401) {
          // bad oAuth
          // reset token and redirect to authorization process again!
          api.storage.local.set({ leethub_token: null }, () => {
            console.log('BAD oAuth!!! Redirecting back to oAuth process');
            action = true;
            $('#auth_mode').show();
          });
        }
      }
    });
    xhr.open('GET', AUTHENTICATION_URL, true);
    xhr.setRequestHeader('Authorization', `token ${token}`);
    xhr.send();
  }
});
