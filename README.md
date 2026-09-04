<div align="center">

# 🛡️ safe-skills

**The Zero-Trust Security Gate & Vulnerability Scanner for AI Agent Skills.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Scanner: NVIDIA SkillSpector](https://img.shields.io/badge/Scanner-NVIDIA%20SkillSpector-76B900.svg)](https://github.com/nvidia/skillspector)
[![Platform: Linux & macOS](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS-black.svg)]()

*Scan untrusted AI agent skills for prompt injections, credential theft, reverse shells, and malicious persistence before they touch your filesystem.*

---

</div>

## 🚨 The Problem: Agent Skills Are Unvetted Code

Running `npx skills add <repository>` gives third-party repositories direct execution access inside your AI agents (**Claude Code, Antigravity, OpenCode, Hermes, Codex, Cursor**). 

Malicious or poorly vetted skills can silently:
* 🔑 **Exfiltrate environment variables & API keys** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, AWS credentials).
* 💣 **Execute arbitrary shell commands (RCE)** through untrusted lifecycle scripts or subagent triggers.
* 🕵️ **Install hidden persistence** (cron jobs, systemd services, modified shell profiles).
* 🎭 **Inject indirect prompts** that hijack your agent's instructions during pair-programming sessions.

---

## ✨ The Solution: `safe-skills`

`safe-skills` acts as a **transparent security proxy** for `npx skills add`. It intercepts every skill installation request, clones the target into an isolated sandbox, runs deep static and heuristic security scans powered by **NVIDIA SkillSpector**, evaluates the risk score against strict policy thresholds, and requires your explicit consent before anything is installed.

```
                  ┌─────────────────────────────────────────┐
                  │ User runs: safe-skills add <repository> │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │       1. Isolated Temp Sandbox          │
                  │   Clones skill to an ephemeral folder   │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │    2. NVIDIA SkillSpector Scanner       │
                  │  Static AST • YARA Rules • Heuristics   │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │        3. Risk Score & Policy           │
                  │  LOW (0-20) • MED (21-50) • HIGH (51-80)│
                  │  ⛔ Hard Blocks: RCE / Exfil / Malware  │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │   4. Human Consent & Security Review    │
                  │  Detailed finding breakdown + Prompt    │
                  └────────────────────┬────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │ (Approved)                          │ (Declined / Blocked)
                    ▼                                     ▼
      ┌───────────────────────────┐         ┌───────────────────────────┐
      │   5. Safe Installation    │         │     Aborted Cleanly       │
      │   npx skills add executed │         │   No files modified       │
      └───────────────────────────┘         └───────────────────────────┘
```

---

## 🚀 Quickstart

### 1-Line Installation (Linux & macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/harshsinghmp/safe-skills/main/install.sh | bash
```

### Or via NPM (Global)

```bash
npm install -g safe-skills
```

### Or Manual Clone

```bash
git clone https://github.com/harshsinghmp/safe-skills.git ~/.local/share/safe-skills
ln -s ~/.local/share/safe-skills/bin/safe-skills ~/.local/bin/safe-skills
ln -s ~/.local/share/safe-skills/bin/skills ~/.local/bin/skills
```

---

## 💻 Usage

Run `safe-skills add <repository>` (or simply `skills add <repository>` via the included alias):

```bash
# Basic usage (scans repository and prompts for consent)
safe-skills add anthropics/anthropic-quickstarts

# Add a specific skill from a multi-skill mono-repo
safe-skills add getsentry/skills --skill skill-scanner

# Dry-run mode (scans and displays risk report without installing)
safe-skills add JuliusBrussee/cavekit --dry-run

# Run static-only analysis (bypasses LLM provider inference)
safe-skills add some-org/some-skill --no-llm

# Enforce a strict risk threshold (blocks anything above MEDIUM)
safe-skills add some-org/some-skill --threshold medium
```

---

## 📊 Sample Security Review Output

When you run `safe-skills add`, you are presented with a detailed, color-coded security review:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SKILL SECURITY REVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Repository: https://github.com/example/untrusted-skill
Skill:      crypto-helper
Scope:      LOCAL
Source:     UNKNOWN  (static-only scan)

SkillSpector:
  Score: 35/100
  Severity: MEDIUM
  Recommendation: REVIEW_CAREFULLY

Files: SKILL.md, scripts/fetch_price.py, package.json

Findings:
  Critical: 0
  High:     0
  Medium:   1
  Low:      2

Findings at or above threshold:
  MEDIUM network_access — Outbound HTTP request detected in scripts/fetch_price.py:L14

Decision:  MEDIUM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Install crypto-helper? [y/N]: 
```

---

## 🔒 Security Policies & Hard Blocks

### 1. Risk Score Tiers
* **LOW (0–20)**: Clean static analysis, trusted patterns $\rightarrow$ Prompted for standard install.
* **MEDIUM (21–50)**: Contains network calls, script hooks, or environment variable reads $\rightarrow$ Flagged with yellow warning.
* **HIGH (51–80)**: Suspicious obfuscation, dynamic execution $\rightarrow$ Blocked by default.
* **CRITICAL (81–100)**: Known exploits, privilege escalation $\rightarrow$ Hard blocked.

### 2. Zero-Tolerance Hard Blocks (Non-Overridable)
`safe-skills` automatically halts execution regardless of score if any of the following patterns are detected:
* ⛔ **Credential / Secret Theft** (`~/.ssh`, `~/.aws/credentials`, `~/.env`, browser cookies)
* ⛔ **Data Exfiltration** (unauthorized outbound socket connections transmitting local file contents)
* ⛔ **Reverse Shells / Remote Code Execution (RCE)** (`nc -e`, `bash -i`, dynamic `eval` payloads)
* ⛔ **Malicious Persistence** (tampering with `/etc/systemd`, crontabs, or `.zshrc`/`.bashrc` hooks)

---

## ⚙️ Configuration

### 1. Allowlist (`~/.config/safe-skills/allowlist.toml`)
You can whitelist trusted organizations or internal repositories so they skip interactive prompts:

```toml
# ~/.config/safe-skills/allowlist.toml
trusted_repositories = [
  "anthropics/*",
  "github.com/vercel/*",
  "github.com/my-agency/*"
]
```

### 2. Audit Trail (`~/.local/share/safe-skills/audit.jsonl`)
Every single scan and installation decision (approved, declined, or blocked) is appended to a structured JSON Lines audit file:

```json
{
  "timestamp": "2026-08-16T17:29:49.123Z",
  "repo": "JuliusBrussee/cavekit",
  "skill": "cavekit",
  "score": 0,
  "decision": "SAFE",
  "approved": true
}
```

---

## 🧪 Testing

`safe-skills` comes with a complete integration test suite with zero external network dependencies:

```bash
npm test
# Or: bash test/run.sh
```

---

## 🤝 Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md) before submitting a pull request.

---

## 📄 License

This project is licensed under the **MIT License** — see the [`LICENSE`](LICENSE) file for details.
