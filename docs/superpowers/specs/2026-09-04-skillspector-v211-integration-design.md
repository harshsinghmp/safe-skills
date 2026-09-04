# Design Specification: NVIDIA SkillSpector v2.11 Integration

- **Date:** 2026-09-04
- **Status:** Approved
- **Author:** Muse (Agency Council)
- **Target Repository:** `safe-skills`

---

## 1. Overview & Goals

NVIDIA SkillSpector v2.11 introduces expanded supply-chain analysis (npm lockfile v1, v2, v3 resolution), new lifecycle hook & permission tampering findings (`BH1`–`BH3`), and deterministic LLM sampling controls (`SKILLSPECTOR_TEMPERATURE`, `SKILLSPECTOR_SEED`).

This design upgrades `safe-skills` to natively recognize and enforce these security capabilities while maintaining complete backwards compatibility, strict zero-trust defaults, and clean downstream execution with `npx skills add`.

---

## 2. Architecture & Policy Rules

### 2.1 Finding Classification in `classifyIssues()`
The scanner's findings will be categorized across two primary security tiers:

1. **Hard Block Tier (`BLOCKED`)**:
   - Finding `BH2` (direct proven remote exfiltration of sensitive content or tokens).
   - High or Critical npm dependency CVEs identified via lockfile audits.
   - Any match against `HARD_BLOCK_RE` or findings where severity $\ge$ High.
   - Requires explicit interactive confirmation or `--force`.

2. **Secondary Review Tier (`MEDIUM`)**:
   - Finding `BH1` (bundled lifecycle hooks in `hooks/hooks.json` or lifecycle triggers).
   - Finding `BH3` (broad or ignored project permission modes in `.claude/settings*.json` or agent config).
   - Sensitive components: files in `hooks/`, `.claude/settings*.json`, or executable scripts (`.sh`, `.py`, `.js`, etc.).
   - Triggers `sentry = true`, prompting the user with a warning to inspect lifecycle hooks and permissions.

### 2.2 Supply-Chain & Lockfile Visibility
- Before scanning, `safe-skills` inspects the target directory for `package-lock.json` or `npm-shrinkwrap.json`.
- In `summary()`, report whether an npm lockfile was detected and audited.
- If dependencies contain vulnerabilities, SkillSpector issues are surfaced with their standard severity scores.

---

## 3. CLI & Environment Controls

### 3.1 New CLI Options
In `safe-skills add`:
- `--seed <integer>`: Validates that the input is an integer (e.g. `42`). Populates `process.env.SKILLSPECTOR_SEED`.
- `--temperature <float>`: Validates that the input is a number between `0.0` and `2.0`. Populates `process.env.SKILLSPECTOR_TEMPERATURE`.

### 3.2 Argument Sanitization & Reserved Flags
- Both `--seed` and `--temperature` are added to the internal `reserved` set.
- They are consumed by `safe-skills` and excluded from the downstream `npx skills add` command.
- If invalid values are provided, the process terminates immediately with exit code 2 and a clear message.

### 3.3 Keys & Environment Persistence
- `loadKeys()` loads `SKILLSPECTOR_SEED` and `SKILLSPECTOR_TEMPERATURE` from `~/.config/safe-skills/keys.env` if present.
- Precedence hierarchy:
  1. CLI arguments (`--seed`, `--temperature`)
  2. Active shell environment (`export SKILLSPECTOR_SEED=...`)
  3. `keys.env` (`~/.config/safe-skills/keys.env`)

---

## 4. Error Handling & Edge Cases

| Scenario | Behavior | Exit Code |
|---|---|---|
| Non-integer `--seed` (e.g. `--seed foo`) | Output `safe-skills: bad --seed foo` | 2 |
| Out-of-range or invalid `--temperature` (e.g. `--temperature -1` or `3.5`) | Output `safe-skills: bad --temperature <val> (must be between 0.0 and 2.0)` | 2 |
| `BH2` finding present in report | Mark target `BLOCKED`, print findings, require override | 1 (declined) / 0 (overridden) |
| `BH1` or `BH3` finding present in report | Mark target `MEDIUM`, warn on lifecycle hooks / permissions | 1 (declined) / 0 (approved) |
| Missing lockfile in target | Display `"Lockfile: none"` in summary; continue scan | N/A |

---

## 5. Verification & Test Plan

Test suite in `test/run.sh` will be expanded to verify:
1. **Existing Baseline**: All 14 existing tests continue to pass.
2. **BH2 Enforcement**: Mock report containing `BH2` finding is classified as `BLOCKED`.
3. **BH1 / BH3 Enforcement**: Mock report containing `BH1` or `BH3` is classified as `MEDIUM` with Sentry notification.
4. **CLI Flag Validation**: Test `--seed` and `--temperature` error paths on invalid inputs.
5. **CLI Flag Forwarding & Stripping**:
   - Verify `SKILLSPECTOR_SEED` and `SKILLSPECTOR_TEMPERATURE` are set in environment.
   - Verify `--seed` and `--temperature` are not passed to the installer mock.
6. **Lockfile Detection**: Verify summary logs lockfile presence when `package-lock.json` exists.
