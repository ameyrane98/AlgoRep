import { getBrowser } from './util.js';

const api = getBrowser();

const ANALYSIS_PROMPT = `You are a coding interview expert. Analyze this LeetCode solution and respond in EXACTLY this JSON format, nothing else:

{"timeComplexity":"O(...)","spaceComplexity":"O(...)","pattern":"pattern name","keyInsight":"1-2 sentence key insight for revision"}

Rules:
- timeComplexity: Big-O time complexity (e.g. "O(n)", "O(n log n)", "O(n^2)")
- spaceComplexity: Big-O space complexity (e.g. "O(1)", "O(n)")
- pattern: The primary algorithmic pattern used. Pick ONE from: Two Pointers, Sliding Window, Binary Search, BFS, DFS, Backtracking, Dynamic Programming, Greedy, Monotonic Stack, Union Find, Trie, Heap, Divide and Conquer, Bit Manipulation, Math, Sorting, Hashing, Graph, Tree, Linked List, Simulation, Prefix Sum, or Other
- keyInsight: A concise 1-2 sentence insight that helps remember HOW to solve this problem. Focus on the "aha" moment, not the implementation details.

Problem: PROBLEM_TITLE (DIFFICULTY)
Language: LANGUAGE

Code:
CODE_HERE`;

/**
 * Analyzes a code submission using AI to extract complexity, pattern, and revision notes.
 * Tries Chrome Built-in AI first, falls back to configured API key.
 *
 * @param {Object} params
 * @param {string} params.code - The solution code
 * @param {string} params.title - Problem title
 * @param {string} params.difficulty - Problem difficulty
 * @param {string} params.language - Programming language name
 * @returns {Promise<Object|null>} Analysis result or null if AI unavailable
 */
export async function analyzeSubmission({ code, title, difficulty, language }) {
  const prompt = ANALYSIS_PROMPT
    .replace('PROBLEM_TITLE', title || 'Unknown')
    .replace('DIFFICULTY', difficulty || 'Unknown')
    .replace('LANGUAGE', language || 'Unknown')
    .replace('CODE_HERE', code || '');

  // Try Chrome Built-in AI first
  const chromeResult = await tryChromeBuildInAI(prompt);
  if (chromeResult) return chromeResult;

  // Try user-configured API key
  const apiResult = await tryExternalAPI(prompt);
  if (apiResult) return apiResult;

  console.log('LeetHub AI: No AI provider available, skipping analysis');
  return null;
}

/**
 * Tries Chrome's built-in AI (Gemini Nano on-device).
 * Available in Chrome 131+ with the Prompt API.
 */
async function tryChromeBuildInAI(prompt) {
  try {
    // Check if Chrome Built-in AI is available
    if (typeof self === 'undefined' || !self.ai || !self.ai.languageModel) {
      // Also check the older API shape
      if (typeof chrome === 'undefined' || !chrome.aiOriginTrial?.languageModel) {
        return null;
      }
    }

    const aiApi = self.ai?.languageModel || chrome.aiOriginTrial?.languageModel;

    // Check capabilities
    const capabilities = await aiApi.capabilities();
    if (capabilities.available === 'no') {
      return null;
    }

    // Create session and prompt
    const session = await aiApi.create({
      systemPrompt: 'You are a coding interview expert. Respond only in valid JSON.',
    });

    const response = await session.prompt(prompt);
    session.destroy();

    return parseAIResponse(response);
  } catch (e) {
    console.log('LeetHub AI: Chrome Built-in AI not available:', e.message);
    return null;
  }
}

/**
 * Tries an external API (Gemini free tier, or user-configured key).
 */
async function tryExternalAPI(prompt) {
  try {
    const { leethub_ai_provider, leethub_ai_key } = await api.storage.local.get([
      'leethub_ai_provider',
      'leethub_ai_key',
    ]);

    if (!leethub_ai_key) {
      // Try Gemini free tier without key (limited)
      return null;
    }

    const provider = leethub_ai_provider || 'gemini';

    if (provider === 'gemini') {
      return await callGemini(leethub_ai_key, prompt);
    } else if (provider === 'openai') {
      return await callOpenAI(leethub_ai_key, prompt);
    }

    return null;
  } catch (e) {
    console.log('LeetHub AI: External API error:', e.message);
    return null;
  }
}

async function callGemini(apiKey, prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseAIResponse(text);
}

async function callOpenAI(apiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Respond only in valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 256,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return parseAIResponse(text);
}

/**
 * Parses the AI response text into a structured object.
 * Handles various response formats and edge cases.
 */
function parseAIResponse(text) {
  if (!text) return null;

  try {
    // Extract JSON from potential markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const jsonStr = jsonMatch[1].trim();
    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.timeComplexity && !parsed.pattern && !parsed.keyInsight) {
      return null;
    }

    return {
      timeComplexity: parsed.timeComplexity || 'Unknown',
      spaceComplexity: parsed.spaceComplexity || 'Unknown',
      pattern: parsed.pattern || 'Unknown',
      keyInsight: parsed.keyInsight || '',
    };
  } catch (e) {
    console.log('LeetHub AI: Failed to parse response:', text?.substring(0, 200));
    return null;
  }
}

/**
 * Formats AI analysis as a markdown section to append to problem README.
 * @param {Object} analysis - The analysis result from analyzeSubmission()
 * @returns {string} Markdown string
 */
export function formatAnalysisMarkdown(analysis) {
  if (!analysis) return '';

  let md = '\n\n---\n### AI Analysis\n';
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Time Complexity | \`${analysis.timeComplexity}\` |\n`;
  md += `| Space Complexity | \`${analysis.spaceComplexity}\` |\n`;
  md += `| Pattern | ${analysis.pattern} |\n`;

  if (analysis.keyInsight) {
    md += `\n**Key Insight:** ${analysis.keyInsight}\n`;
  }

  return md;
}

/**
 * Saves AI analysis result to storage for the given problem.
 * @param {string} problemName - The problem slug
 * @param {Object} analysis - The analysis result
 * @returns {Promise<void>}
 */
export async function saveAnalysis(problemName, analysis) {
  if (!analysis) return;

  const { aiAnalysis = {} } = await api.storage.local.get('aiAnalysis');
  aiAnalysis[problemName] = {
    ...analysis,
    analyzedAt: new Date().toISOString(),
  };
  await api.storage.local.set({ aiAnalysis });
}
