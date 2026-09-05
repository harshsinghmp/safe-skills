# 🗺️ safe-skills Security & Architecture Roadmap

This document outlines the product evolution, security hardening milestones, and architectural roadmap for `safe-skills`.

---

## 🎯 Vision

To establish `safe-skills` as the universal zero-trust security gate, integrity verifier, and runtime sandbox for AI agent skills across all modern developer harnesses (**Claude Code, Antigravity, OpenCode, Codex, Cursor, Hermes**).

---

## 📅 Version Milestones

### ✅ v1.0.0 — Foundation & Zero-Trust Proxy Gate
- [x] Transparent interception wrapper for `npx skills add`.
- [x] Pre-install ephemeral sandbox cloning and isolated target inspection.
- [x] NVIDIA SkillSpector static AST and heuristic vulnerability analysis.
- [x] Four-tier risk scoring policy (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- [x] Zero-tolerance hard blocks for RCE, credential theft, and reverse shells.
- [x] Structured JSON Lines audit ledger (`~/.local/share/safe-skills/audit.jsonl`).
- [x] Organization allowlist support (`~/.config/safe-skills/allowlist.toml`).

### ✅ v1.1.0 — NVIDIA SkillSpector v2.11 & Supply-Chain Visibility
- [x] Native recognition and enforcement for `BH1` (bundled lifecycle hooks), `BH2` (direct proven remote exfiltration), and `BH3` (broad permission grants).
- [x] Zero-tolerance hard blocking for `BH2` remote transfer findings.
- [x] Secondary review routing for `BH1`, `BH3`, `hooks/hooks.json`, and `.claude/settings*.json`.
- [x] Deterministic LLM sampling controls (`--seed <int>`, `--temperature <float>`).
- [x] Persistent keys configuration (`~/.config/safe-skills/keys.env`).
- [x] Supply-chain npm lockfile auditing (`package-lock.json`, `npm-shrinkwrap.json`).

### ✅ v1.2.0 — Cross-Platform Reliability & Single-Source Updates
- [x] **Cross-Platform TTY Harness**: Eliminated OS-dependent `script` utility failures in CI and macOS runners with native `SAFE_SKILLS_FORCE_TTY=1` simulation.
- [x] **Single-Source Updater (`safe-skills update`)**: Self-updates both `safe-skills` (via git or npm) and the underlying NVIDIA SkillSpector scanner (via `uv` or `pip`).
- [x] **NPM Registry Distribution**: Published `safe-skills` as a first-class global npm package (`npm install -g safe-skills`).
- [x] **Repository Metadata Sanitization**: Clean package metadata, normalized repository URLs, and automated GitHub release notes.

### 🛡️ v1.3.0 — Cryptographic Integrity & Anti-TOCTOU Defense (Current)
- [x] **Clean Package Syntax & Ref Stripping**: Preserves clean repository targets (`<owner>/<repo>`) without commit hash refs to prevent downstream `git clone --branch` failures.
- [x] **Local Sandbox Mode (`--anti-toctou local`)**: Installs directly from the verified ephemeral sandbox directory, guaranteeing zero additional network bytes fetched.
- [x] **Cryptographic Integrity Ledger (`skills-lock.json`)**: Automatically calculates and records SHA-256 tree hashes for all approved skill files at install time.
- [x] **Integrity Verifier Command (`safe-skills verify`)**: Audits installed skills against the ledger to detect tampering, missing files, or unauthorized post-install modifications.
- [x] **Filesystem Hardening (`--readonly`)**: Enforces read-only permissions (`chmod 555`/`444`) on installed skill directories to block self-modifying payloads.

---

## 🚀 Future Milestones

### 🔍 v1.4.0 — Multi-Engine Defense & Agent Injection Linter
* **Automated Dual-Engine Cross-Validation**:
  - Automatically orchestrate secondary analyzers (e.g. Sentry `skill-scanner` and Semgrep agent rulepacks) when `MEDIUM` risk or executable scripts are detected.
* **MCP Tool Schema Poisoning Linter**:
  - Deep-scan Model Context Protocol (MCP) tool docstrings and parameter schemas for deceptive prompt injection (e.g., instructing the agent to exfiltrate `.env` in debug parameters).
* **Semantic Intent Drift Detection**:
  - LLM-powered divergence check between declared human documentation in `SKILL.md` and the actual tools/scripts packaged in the repository.

### ⚡ CI/CD & Automated NPM Publishing Workflow
* **Configure `NPM_TOKEN` Secret on GitHub**:
  - Provision and configure `NPM_TOKEN` in GitHub repository secrets (`harshsinghmp/safe-skills`) so automated tag-driven releases (`v*`) successfully publish to the npm registry.
* **Hardened Release Workflow (`.github/workflows/release.yml`)**:
  - Ensure automated tag-push events execute test gating, public npm release publishing, and GitHub release creation with auto-generated release notes in one linear pipeline.
* **OIDC & Provenance (Trusted Publishing)**:
  - Migrate from static access tokens to npm Provenance via GitHub Actions OIDC (`id-token: write`) for cryptographic supply-chain build attestation.

### 🏰 v2.0.0 — Runtime Capability Sandboxing & OS Jail
* **Capability Manifests (`CAPABILITIES.toml`)**:
  - Declare and enforce least-privilege permissions for each skill:
    ```toml
    [capabilities]
    network = false
    read_paths = ["./src"]
    write_paths = ["./dist"]
    allowed_env = ["NODE_ENV"]
    ```
* **OS-Level Execution Jails (Bubblewrap / Landlock)**:
  - Isolate skill execution scripts (`scripts/*.sh`, `*.py`) inside unprivileged Linux namespaces where `~/.ssh`, `~/.aws`, `~/.env`, and system credentials are unmapped.
* **Cryptographic Signature Verification**:
  - Validate Git commit signatures via Sigstore / SSH / GPG against trusted developer registries before running scans.
