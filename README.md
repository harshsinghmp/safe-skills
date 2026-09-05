<div align="center">

<img src="https://raw.githubusercontent.com/harshsinghmp/safe-skills/main/assets/og-banner.png" alt="safe-skills — Zero-Trust Security Gate for AI Agent Skills" width="100%" style="border-radius: 12px; margin-bottom: 24px;" />

# 🛡️ safe-skills

**The Zero-Trust Security Gate & Vulnerability Scanner for AI Agent Skills.**

[![NPM Version](https://img.shields.io/npm/v/safe-skills.svg?color=cb3837&style=flat-square)](https://www.npmjs.com/package/safe-skills)
[![NPM Downloads](https://img.shields.io/npm/dm/safe-skills.svg?color=blue&style=flat-square)](https://www.npmjs.com/package/safe-skills)
[![CI Test Suite](https://img.shields.io/github/actions/workflow/status/harshsinghmp/safe-skills/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/harshsinghmp/safe-skills/actions)
[![Scanner: NVIDIA SkillSpector](https://img.shields.io/badge/Scanner-NVIDIA%20SkillSpector-76B900.svg?style=flat-square)](https://github.com/nvidia/skillspector)
[![Node.js Version](https://img.shields.io/badge/Node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS-black.svg?style=flat-square)]()

<p align="center">
  <b>Intercept, sandbox, and deeply audit untrusted skills before granting them execution privileges in your AI agents.</b>
  <br />
  Compatible with <b>Claude Code, Antigravity, OpenCode, Codex CLI, Cursor, and Hermes</b>.
</p>

[Quickstart](#-quickstart) • [Why safe-skills?](#-why-safe-skills) • [CLI Reference](#-cli-command-reference) • [Policy Engine](#-security-policy--hard-blocks) • [Roadmap](ROADMAP.md)

---

</div>

## 🚨 The Threat: Agent Skills Run With Ambient Host Access

Running `npx skills add <repository>` grants third-party repositories direct execution capabilities inside your agentic coding workflows. Skills can bundle scripts, lifecycle hooks, and instructions executed directly on your workstation.

Unvetted or malicious skills can silently execute:

* 🔑 **Credential Theft & Exfiltration**: Stealthily harvesting `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, AWS tokens, SSH keys (`~/.ssh/id_rsa`), and `.env` files.
* 💣 **Arbitrary Remote Code Execution (RCE)**: Executing hidden reverse shells (`nc -e`, `bash -i`) or downloaders through unreviewed lifecycle scripts.
* 🕵️ **Hidden Host Persistence**: Installing covert cron jobs, systemd services, or modifying user shell profiles (`.zshrc`, `.bashrc`).
* 🎭 **Indirect Prompt Injection**: Embedding subversive directives in Markdown comments or tool schemas that hijack agent reasoning during pair-programming.
* 📦 **Supply-Chain Attacks**: Smuggling compromised transitive npm dependencies and unpinned scripts.

---

## ✨ The Solution: Transparent Zero-Trust Proxy

`safe-skills` acts as a **transparent security proxy** for `npx skills add`. It intercepts every installation command, clones the target into an ephemeral sandbox, executes deep static and LLM security audits powered by **NVIDIA SkillSpector**, evaluates the risk score against strict policy thresholds, and requires your explicit informed consent before anything is installed.

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
                  │  Static AST • YARA Rules • Lockfiles    │
                  │  Deterministic LLM Semantic Analysis    │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │        3. Risk Score & Policy           │
                  │  LOW (0-20) • MED (21-50) • HIGH (51-80)│
                  │  ⛔ Zero-Tolerance: RCE / Exfil / BH2   │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │   4. Human Consent & Security Review    │
                  │  Finding Breakdown • Audit Log Record   │
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

### Method 1: Via NPM (Recommended)

```bash
npm install -g safe-skills
```

### Method 2: 1-Line Universal Installer (Linux & macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/harshsinghmp/safe-skills/main/install.sh | bash
```

### Method 3: Manual Clone

```bash
git clone https://github.com/harshsinghmp/safe-skills.git ~/.local/share/safe-skills
ln -s ~/.local/share/safe-skills/bin/safe-skills ~/.local/bin/safe-skills
ln -s ~/.local/share/safe-skills/bin/skills ~/.local/bin/skills
```

> [!NOTE]
> The installer automatically provisions the `skills` alias, allowing you to use `skills add <repo>` as a drop-in replacement for `npx skills add`.

---

## 💻 Usage Examples

### 1. Basic Scan & Install
Scan an untrusted repository and review its risk profile before installation:
```bash
safe-skills add anthropics/anthropic-quickstarts
```

### 2. Multi-Skill Repository (Targeted Scan)
Extract and audit an individual skill from a mono-repo:
```bash
safe-skills add getsentry/skills --skill skill-scanner
```

### 3. Dry-Run Mode
Inspect a skill's vulnerability findings without modifying your system:
```bash
safe-skills add JuliusBrussee/cavekit --dry-run
```

### 4. Deterministic LLM Sampling (SkillSpector v2.11+)
Pin sampling parameters for reproducible audit scoring:
```bash
safe-skills add some-org/some-skill --seed 42 --temperature 0.0
```

### 5. Enforce Strict Security Ceilings
Reject any skill that exceeds a custom risk threshold:
```bash
safe-skills add some-org/some-skill --threshold medium
```

### 6. Single-Source Self-Update
Keep `safe-skills` and the underlying NVIDIA SkillSpector scanner updated with one command (auto-detects npm, bun, or git environments, or can be specified explicitly):
```bash
# Auto-detects package manager (npm, bun, or GitHub git clone)
safe-skills update

# Or specify update source explicitly
safe-skills update --npm
safe-skills update --bun
safe-skills update --github

# Check for updates without installing
safe-skills update --check
```

### 7. Cryptographic Integrity Audit (`safe-skills verify`)
Audit all installed skills against the cryptographic ledger (`skills-lock.json`) to detect post-installation tampering:
```bash
# Verify all installed skills in local project
safe-skills verify

# Verify a specific skill or audit strictly
safe-skills verify demo-skill --strict
```

### 8. Anti-TOCTOU & Read-Only Hardening
Eliminate Time-of-Check to Time-of-Use network races and enforce read-only execution permissions:
```bash
# Install directly from verified sandbox directory and lock directory to chmod 555
safe-skills add some-org/some-skill --anti-toctou local --readonly
```

---

## 📊 Sample Terminal Security Review

When you invoke `safe-skills add`, you receive an instant terminal breakdown:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SKILL SECURITY REVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Repository: https://github.com/example/untrusted-skill
Skill:      crypto-helper
Scope:      LOCAL
Commit:     7a8f3b9c12de
Source:     UNKNOWN
Lockfile:   audited (package-lock.json)

SkillSpector:
  Score: 35/100
  Severity: MEDIUM
  Recommendation: REVIEW_CAREFULLY

Files: SKILL.md, scripts/fetch_price.py, package.json, hooks/hooks.json

Findings:
  Critical: 0
  High:     0
  Medium:   1
  Low:      2

Findings at or above threshold:
  MEDIUM network_access — Outbound HTTP socket transmission in scripts/fetch_price.py:L14
  MEDIUM BH1 — Untrusted bundled lifecycle hook registered in hooks/hooks.json

Decision:  MEDIUM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠ MEDIUM risk — secondary review recommended.
Install "crypto-helper" anyway? [y/N]
```

---

## 🔒 Security Policy & Hard Blocks

### 1. Four-Tier Risk Policy
| Tier | Score Range | Default Behavior | Criteria & Findings |
| :--- | :---: | :---: | :--- |
| **`LOW`** | **0 – 20** | **Auto-Install** | Clean static analysis, trusted sources, zero suspicious hooks. |
| **`MEDIUM`** | **21 – 50** | **Prompt Required** | Network requests, script hooks, bundled lifecycle hooks (`BH1`), or permission tampering (`BH3`). |
| **`HIGH`** | **51 – 80** | **Blocked** | Obfuscated code, unpinned supply-chain dependencies, high-severity CVEs. |
| **`CRITICAL`** | **81 – 100** | **Blocked** | Known exploits, remote exfiltration, backdoor patterns. |

### 2. Zero-Tolerance Hard Blocks (Non-Overridable by Default)
Regardless of the calculated numerical score, `safe-skills` halts execution immediately if any of the following are detected:
* ⛔ **`BH2` Remote Transfer**: Directly proven unauthorized exfiltration of sensitive tokens or context.
* ⛔ **Credential Access**: Tampering with `~/.ssh`, `~/.aws`, `~/.env`, or system keychains.
* ⛔ **Remote Code Execution (RCE)**: `nc -e`, `bash -i`, dynamic `eval`, or unverified subprocess spawning.
* ⛔ **Host Persistence**: Writes to `/etc/systemd`, crontabs, or user shell dotfiles (`.zshrc`/`.bashrc`).

> [!WARNING]
> Bypassing a hard block requires explicit interactive confirmation or the `--force` flag. All forced overrides are recorded to the immutable audit trail.

---

## 🛠️ CLI Command Reference

| Flag | Argument | Default | Description |
| :--- | :---: | :---: | :--- |
| `--skill` | `<name>` | all | Target a specific skill directory inside a repository. |
| `--threshold` | `<lvl>` | `high` | Set maximum allowed risk before blocking (`low`, `medium`, `high`, `critical`). |
| `--seed` | `<int>` | none | Forward deterministic seed to SkillSpector v2.11 for reproducible evaluation. |
| `--temperature` | `<float>` | none | Set LLM sampling temperature (valid range: `0.0` to `2.0`). |
| `--dry-run` | flag | `false` | Execute full sandbox scan and log audit without invoking installer. |
| `--no-llm` | flag | `false` | Run static AST & YARA analysis only (skips LLM provider calls). |
| `--llm` | flag | `auto` | Force LLM semantic review pass. |
| `--force` | flag | `false` | Allow prompting for manual bypass on high-risk/blocked skills. |
| `-g`, `--global` | flag | `false` | Pass global installation scope to downstream agent installer. |

---

## ⚙️ Configuration & Secrets

### 1. Trusted Repository Allowlist (`~/.config/safe-skills/allowlist.toml`)
Trusted repositories skip interactive prompts if their scan score is `LOW`:

```toml
[trusted_sources]
repositories = [
  "anthropics/skills",
  "vercel-labs/agent-skills",
  "github.com/my-org/*"
]
```

### 2. Provider Keys & Deterministic Sampling (`~/.config/safe-skills/keys.env`)
Configure provider keys and sampling defaults locally outside version control:

```bash
# ~/.config/safe-skills/keys.env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
SKILLSPECTOR_SEED=42
SKILLSPECTOR_TEMPERATURE=0.0
```

### 3. Structured Audit Ledger (`~/.local/share/safe-skills/audit.jsonl`)
Every single scan and installation decision is written to an append-only JSON Lines ledger:

```json
{
  "timestamp": "2026-09-04T12:00:00.000Z",
  "repository": "example/untrusted-skill",
  "skill": "crypto-helper",
  "scope": "local",
  "commit": "7a8f3b9c12de",
  "risk_score": 35,
  "severity": "MEDIUM",
  "decision": "approved",
  "forced": false
}
```

---

## 🧪 Verification & Test Suite

`safe-skills` includes an end-to-end integration test suite with zero external network dependencies:

```bash
npm test
# Or run with syntax linting:
npm test && npm run lint
```

---

## 🗺️ Product Roadmap

Check out [`ROADMAP.md`](ROADMAP.md) for our full multi-milestone plan:
* **v1.3.0**: Anti-TOCTOU commit SHA pinning, `skills-lock.json` cryptographic integrity ledger, `safe-skills verify` audit command, post-install write-protection (`chmod 555`). *(Shipped)*
* **v1.4.0**: Automated dual-engine cross-validation (SkillSpector + Sentry) and MCP tool schema poisoning defense.
* **v2.0.0**: Runtime capability manifests (`CAPABILITIES.toml`) and Linux Bubblewrap / Landlock OS sandboxing.

---

## 📄 License & Integrity

Distributed under the [MIT License](LICENSE). Built for the developer agent ecosystem by [Harsh](https://github.com/harshsinghmp).
