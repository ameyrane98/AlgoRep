<h1 align="center">
  <img src="assets/algorep-logo.svg" alt="AlgoRep Logo" width="128">
  <br>
  AlgoRep
  <br>
  <a href="https://github.com/ameyrane98/AlgoRep/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"/>
  </a>
  <br>
  <strong>Your AI-powered LeetCode Learning System</strong>
</h1>

<p align="center">
  Automatically sync your LeetCode solutions to GitHub with AI-driven complexity analysis, spaced repetition for long-term retention, and integrated study plan tracking.
</p>

---

## 🚀 Why AlgoRep?

Traditional tools stop at syncing code. **AlgoRep** transforms your LeetCode practice into a structured learning journey:

1.  **AI Complexity Analysis**: Automatically adds Big-O complexity and performance breakdowns to your synced solutions.
2.  **Spaced Repetition Integration**: Revisit problems at optimal intervals to ensure you actually *retain* what you learn.
3.  **Study Plan Tracking**: Keep track of your progress through curated lists and patterns (Blind 75, NeetCode 150, etc.).
4.  **Modern GitHub Portfolio**: Your GitHub profile becomes a rich record of not just code, but deep understanding.

## ✨ Features

- **Instant Sync**: Pushes your code to GitHub as soon as you pass all tests.
- **AI-Powered**: Summarizes your solution's logic and checks for better alternatives.
- **Automated READMEs**: Generates beautiful repository documentation with categorized problems.
- **Multi-Platform Support**: Works on LeetCode and GeeksforGeeks.
- **Dynamic Compatibility**: Built to handle the latest LeetCode dynamic UI.

## 🛠️ How it Works

1.  **Install**: Load the extension in Chrome or Firefox.
2.  **Authorize**: Connect with your GitHub account.
3.  **Configure**: Create or select a repository to sync your progress.
4.  **Practice**: Solve problems on LeetCode. AlgoRep handles the rest.

## 📦 Installation

### From Source (Local Development)

1.  **Fork and Clone**:
    ```bash
    git clone https://github.com/ameyrane98/AlgoRep.git
    ```
2.  **Install Dependencies**:
    ```bash
    npm run setup
    ```
3.  **Build**:
    ```bash
    npm run build
    ```
4.  **Load Extension**:
    - Go to `chrome://extensions` or `about:debugging`
    - Enable **Developer Mode**.
    - Click **Load unpacked** and select the `./dist/chrome` or `./dist/firefox` folder.

## 📜 Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Watch mode for development |
| `npm run build` | Build production assets |
| `npm run format` | Auto-format codebase |
| `npm run lint` | Run ESLint checks |
| `npm test` | Run Jasmine tests |

## 🙏 Credits

AlgoRep was inspired by [LeetHub](https://github.com/arunbhardwaj/LeetHub-2.0). It focuses on adding retention-based learning and AI insights to the core syncing functionality.

---

<p align="center">
  Built with ❤️ for the LeetCode community.
</p>
