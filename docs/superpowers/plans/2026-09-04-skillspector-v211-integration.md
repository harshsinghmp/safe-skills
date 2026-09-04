# SkillSpector v2.11 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade safe-skills with NVIDIA SkillSpector v2.11 capabilities: BH1–BH3 lifecycle hook & permission rules, npm lockfile supply-chain audits, and deterministic LLM sampling (`--seed`, `--temperature`).

**Architecture:** Extend issue classification in `classifyIssues()` with new finding IDs, add CLI argument parsing and validation for `--seed` and `--temperature`, detect lockfiles in scan targets and display status in `summary()`, and verify downstream argument sanitization.

**Tech Stack:** Node.js (>=18.0.0, pure stdlib), Bash test harness (`test/run.sh`), GitHub CLI (`gh`).

## Global Constraints

- Pure Node.js standard library runtime (no external npm runtime dependencies).
- Strictly preserve all existing workflows: `npm test`, `npm run lint`.
- All downstream `npx skills add` arguments must be sanitized of reserved flags.
- Follow the process order: Create Issue > PR > Dev Branch > Main Branch Publish.

---

### Task 1: GitHub Repository & Issue Setup

**Files:**
- Modify: `package.json:30-34`
- Modify: `README.md:80-96`

- [ ] **Step 1: Update repository references from your-username to harshsinghmp**
- [ ] **Step 2: Initialize remote GitHub repository `harshsinghmp/safe-skills` via `gh repo create`**
- [ ] **Step 3: Create GitHub Issue describing SkillSpector v2.11 integration**
- [ ] **Step 4: Commit repo metadata updates to `main` and push**

---

### Task 2: Dev Branch Initialization

- [ ] **Step 1: Create and check out branch `feat/skillspector-v211` from `main`**
- [ ] **Step 2: Push branch `feat/skillspector-v211` to origin**

---

### Task 3: Test Suite Extension for BH1–BH3 & Sampling Controls (TDD)

**Files:**
- Modify: `test/run.sh`

**Interfaces:**
- Consumes: Mock scanner output JSON fixtures.
- Produces: Failing test assertions for `BH2` hard-block, `BH1`/`BH3` medium sentry review, `--seed`/`--temperature` validation and argument stripping, and lockfile detection.

- [ ] **Step 1: Add failing test cases to `test/run.sh`**
  - Test case: finding `BH2` triggers `BLOCKED` verdict.
  - Test case: finding `BH1` and `BH3` trigger `MEDIUM` verdict + sentry review.
  - Test case: invalid `--seed abc` exits with code 2.
  - Test case: invalid `--temperature 3.0` exits with code 2.
  - Test case: valid `--seed 42` and `--temperature 0.2` set environment and are stripped from installer.
  - Test case: lockfile detection shown in summary.
- [ ] **Step 2: Run `npm test` to verify new tests fail as expected**

---

### Task 4: Implement BH1–BH3 Finding & Component Classification

**Files:**
- Modify: `safe-skills.js:36-42,159-177`
- Test: `test/run.sh`

**Interfaces:**
- Consumes: `report.issues`, `report.components`.
- Produces: `classifyIssues(report)` returning `{ bySeverity, hardBlock, sentry }`.

- [ ] **Step 1: Update `HARD_BLOCK_RE` and `classifyIssues()` to hard-block on `BH2`**
- [ ] **Step 2: Update `SENTRY_RE` and `classifyIssues()` to route `BH1`, `BH3`, `hooks/hooks.json`, and `.claude/settings*.json` to Sentry review**
- [ ] **Step 3: Run `npm test` to verify BH1, BH2, BH3 tests pass**
- [ ] **Step 4: Commit changes to `feat/skillspector-v211`**

---

### Task 5: Implement `--seed` and `--temperature` CLI Flags

**Files:**
- Modify: `safe-skills.js:260-295`
- Test: `test/run.sh`

**Interfaces:**
- Consumes: `process.argv`.
- Produces: Validation errors (exit 2) or `process.env.SKILLSPECTOR_SEED` / `process.env.SKILLSPECTOR_TEMPERATURE`.

- [ ] **Step 1: Add `--seed` and `--temperature` to `reserved` set and argument parser**
- [ ] **Step 2: Add validation for integer seed and float temperature (0.0–2.0)**
- [ ] **Step 3: Update CLI usage help text**
- [ ] **Step 4: Run `npm test` to verify argument parsing and stripping tests pass**
- [ ] **Step 5: Commit changes to `feat/skillspector-v211`**

---

### Task 6: Supply-Chain Lockfile Detection & Summary UI

**Files:**
- Modify: `safe-skills.js:141-152,201-226`
- Test: `test/run.sh`

**Interfaces:**
- Consumes: Target directory path.
- Produces: `hasLockfile` boolean / lockfile name surfaced in `summary()`.

- [ ] **Step 1: Inspect target directory for `package-lock.json` or `npm-shrinkwrap.json`**
- [ ] **Step 2: Display lockfile audit status in `summary()` output**
- [ ] **Step 3: Run `npm test` and `npm run lint`**
- [ ] **Step 4: Commit changes to `feat/skillspector-v211`**

---

### Task 7: Full Verification & Documentation

**Files:**
- Modify: `README.md`
- Test: `npm test && npm run lint`

- [ ] **Step 1: Update README.md documenting `--seed`, `--temperature`, and BH1–BH3 security coverage**
- [ ] **Step 2: Run full test suite (`npm test`) and linter (`npm run lint`)**
- [ ] **Step 3: Commit documentation updates to `feat/skillspector-v211` and push branch to GitHub**

---

### Task 8: Pull Request, Merge to Main & Main Branch Publish

- [ ] **Step 1: Open Pull Request from `feat/skillspector-v211` to `main` referencing the Issue**
- [ ] **Step 2: Merge PR into `main` using `gh pr merge`**
- [ ] **Step 3: Check out `main`, pull merged changes, verify clean build, and publish tag/release**
