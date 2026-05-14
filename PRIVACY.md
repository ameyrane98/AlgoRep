# AlgoRep Privacy Policy

_Last updated: May 13, 2026_

AlgoRep is a browser extension that helps you sync your LeetCode solutions to a GitHub repository you own, with optional AI-generated complexity analyses. This document explains what data AlgoRep handles, where it goes, and what it does not do.

If anything below is unclear, open an issue at <https://github.com/ameyrane98/AlgoRep/issues>.

---

## What AlgoRep stores locally on your computer

The following are stored in your browser's local extension storage (via `chrome.storage.local`). They never leave your machine except as described in the next section.

- **GitHub access token + refresh token.** Obtained via GitHub's Device Flow. The access token is short-lived (8 hours by default); the refresh token is single-use.
- **Your GitHub username.** Fetched once after sign-in to label commits.
- **The repository you selected as your sync target** (the `owner/repo` string).
- **Your local submission history**: problem slugs, languages, time-to-solve, accept timestamps, and per-problem stats.
- **Your AI provider preference and API key**, if you choose to enable AI analysis. The key never leaves your computer except to call the provider you chose.
- **UI preferences** (theme, active study plan, weekly pattern selections).

You can wipe all of this at any time by going to `chrome://extensions`, finding AlgoRep, clicking **Details → Site settings → Clear data**, or by uninstalling the extension.

---

## What AlgoRep sends over the network, and to whom

AlgoRep talks to three categories of services. It talks to no one else.

### 1. GitHub (`github.com`, `api.github.com`)

- **Device Flow** endpoints (`/login/device/code`, `/login/oauth/access_token`) to obtain and refresh your access token.
- **GitHub REST API** to: list the repositories you've installed AlgoRep on, read existing files in your selected repo, commit new files (your solutions, READMEs, stats), and verify the install is still valid.

AlgoRep only ever touches the repositories you explicitly installed the AlgoRep GitHub App on. The extension cannot see other repos in your account, public or private.

### 2. LeetCode (`leetcode.com`) and optionally GeeksforGeeks (`practice.geeksforgeeks.org`)

AlgoRep runs as a content script on these sites to detect when you submit a problem, read the problem metadata (slug, topic tags, difficulty), and read your submitted code. This data is never sent off the page except to commit it to your own GitHub repo as described above.

### 3. Your chosen AI provider (only if you enable AI analysis)

If you enter an API key for Google Gemini, OpenAI, or Anthropic in the extension's AI settings, AlgoRep will call that provider's API with your submitted code and problem context to generate a complexity analysis. The request is sent directly from your browser to the provider you chose using the API key you supplied.

- AlgoRep does not proxy these requests through any server.
- AlgoRep does not use its own API keys.
- If you don't configure an AI provider, no AI requests are made.

---

## What AlgoRep does **not** do

- AlgoRep does not run any backend, telemetry endpoint, or analytics service. There is no AlgoRep server.
- AlgoRep does not transmit your code, your GitHub token, your AI API key, or any other data to the AlgoRep author or any third party other than the services you explicitly connected (GitHub and, if you enabled it, your chosen AI provider).
- AlgoRep does not sell, rent, or share user data with anyone.
- AlgoRep does not include any third-party tracking pixels, ad networks, or fingerprinting libraries.
- AlgoRep does not read pages other than LeetCode and GeeksforGeeks. It does not have permission to.

---

## Permissions AlgoRep requests and why

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | To persist your token, repo selection, submission history, and preferences locally. |
| `webNavigation` | To detect when you submit a problem on LeetCode (the URL changes to `/submissions/<id>`). |
| `host_permissions: https://github.com/*` | For the Device Flow handshake that obtains your access token. |
| `host_permissions: https://api.github.com/*` | To list your installed repos and commit your solutions. |
| `content_scripts: leetcode.com`, `practice.geeksforgeeks.org` | To detect submissions and read code/problem metadata on those pages. |

---

## Open source

AlgoRep is open source under the MIT license: <https://github.com/ameyrane98/AlgoRep>. You can audit the code, build it yourself, fork it, or contribute. If you spot anything in the code that contradicts this policy, please file an issue — that's a bug.

---

## Children's privacy

AlgoRep is not directed at children under 13. It does not knowingly collect data from children.

---

## Changes to this policy

If this policy changes, the "Last updated" date at the top will move, and the change will appear in the [repository's commit history](https://github.com/ameyrane98/AlgoRep/commits/main/PRIVACY.md). Material changes will also be announced in the extension's release notes.

---

## Contact

Open an issue at <https://github.com/ameyrane98/AlgoRep/issues>, or reach the author at the email listed on the GitHub profile at <https://github.com/ameyrane98>.
