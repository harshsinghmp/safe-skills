#!/usr/bin/env bash
# Gate test harness. Uses fake skillspector + fake installer.
# Non-TTY prompts auto-decline (exit 1). TTY paths tested via `script`.
set -u
cd "$(dirname "$0")/.."

export SAFE_SKILLS_SCANNER="node $(pwd)/test/fake-skillspector.js"
export SAFE_SKILLS_INSTALLER="node $(pwd)/test/fake-installer.js"
export SAFE_INSTALL_LOG="$(pwd)/test/.install.log"
export SAFE_SKILLS_CONFIG="$(pwd)/test/.config"
export SAFE_SKILLS_DATA="$(pwd)/test/.data"
export SAFE_SKILLS_LOCAL_LOCKFILE="$(pwd)/test/.data/local-skills-lock.json"
export SAFE_SKILLS_UPDATE_CMD="echo safe-skills-update-mock"
rm -rf test/.config test/.data test/.install.log
mkdir -p test/.config test/.data
cat > test/.config/allowlist.toml <<'EOF'
[trusted_sources]
repositories = [
    "anthropics/skills",
    "vercel-labs/agent-skills"
]
EOF

PASS=0; FAIL=0
check() { # name expected_exit actual_exit
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1 (exit $3)";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected $2, got $3)"; fi
}

LOCAL="test/fixtures/demo-skill"

# 1. LOW → SAFE summary, auto-installs (no prompt), exit 0
SAFE_TEST_CASE=low node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss1.log 2>&1
check "LOW gate: auto-install" 0 $?
grep -q "Decision:  SAFE" /tmp/ss1.log && grep -q "gate passed" /tmp/ss1.log && echo "PASS: LOW auto-installed" || { echo "FAIL: LOW auto-install"; FAIL=$((FAIL+1)); }
grep -q "$LOCAL" test/.install.log && echo "PASS: install ran" || { echo "FAIL: install missing"; FAIL=$((FAIL+1)); }

# 2. MEDIUM → interactive approval; non-TTY declines → exit 1, audit declined
rm -f test/.install.log
SAFE_TEST_CASE=medium node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss2.log 2>&1
check "MEDIUM non-TTY: declined" 1 $?
grep -q "Decision:  MEDIUM" /tmp/ss2.log && grep -q "secondary review" /tmp/ss2.log && echo "PASS: MEDIUM + sentry note" || { echo "FAIL: MEDIUM flow"; FAIL=$((FAIL+1)); }
grep -q '"decision":"declined"' test/.data/audit.jsonl && echo "PASS: MEDIUM declined audited" || { echo "FAIL: MEDIUM decline audit"; FAIL=$((FAIL+1)); }
[ ! -s test/.install.log ] && echo "PASS: MEDIUM decline skipped installer" || { echo "FAIL: MEDIUM declined but installed"; FAIL=$((FAIL+1)); }

# 2b. MEDIUM approved via pty (y) → installs, exit 0, audit approved, not forced
rm -f test/.install.log
printf 'y\n' | SAFE_SKILLS_FORCE_TTY=1 SAFE_TEST_CASE=medium node safe-skills.js add "$LOCAL" >/tmp/ss2b.log 2>&1
check "MEDIUM approved" 0 $?
grep -q 'Install "demo-skill" anyway?' /tmp/ss2b.log && grep -q '"decision":"approved"' test/.data/audit.jsonl && grep -q '"forced":false' test/.data/audit.jsonl && echo "PASS: MEDIUM approved + audited" || { echo "FAIL: MEDIUM approve flow"; FAIL=$((FAIL+1)); }
[ -s test/.install.log ] && echo "PASS: MEDIUM approved installed" || { echo "FAIL: MEDIUM approved but no install"; FAIL=$((FAIL+1)); }

# 2c. Mixed batch: alpha SAFE auto, beta MEDIUM approved (y) → both install, one command
rm -f test/.install.log
printf 'y\n' | SAFE_SKILLS_FORCE_TTY=1 SAFE_TEST_CASES=alpha:low,beta:medium node safe-skills.js add 'test/fixtures/multi' --skill alpha --skill beta >/tmp/ss2c.log 2>&1
check "mixed approve: exit 0" 0 $?
grep -q '"alpha"' test/.install.log && grep -q '"beta"' test/.install.log && echo "PASS: installer got both skills" || { echo "FAIL: mixed install args"; FAIL=$((FAIL+1)); }
grep -q 'Decision:  SAFE' /tmp/ss2c.log && grep -q 'Decision:  MEDIUM' /tmp/ss2c.log && grep -q 'Install "beta" anyway?' /tmp/ss2c.log && echo "PASS: per-skill review shown" || { echo "FAIL: mixed per-skill flow"; FAIL=$((FAIL+1)); }

# 2d. Mixed batch: alpha SAFE auto, beta MEDIUM declined (n) → only alpha installs
rm -f test/.install.log
printf 'n\n' | SAFE_SKILLS_FORCE_TTY=1 SAFE_TEST_CASES=alpha:low,beta:medium node safe-skills.js add 'test/fixtures/multi' --skill alpha --skill beta >/tmp/ss2d.log 2>&1
check "mixed decline: exit 0" 0 $?
grep -q '"alpha"' test/.install.log && ! grep -q '"beta"' test/.install.log && echo "PASS: only alpha installed" || { echo "FAIL: mixed decline install args"; FAIL=$((FAIL+1)); }
grep '"skill":"beta"' test/.data/audit.jsonl | grep -q '"decision":"declined"' && echo "PASS: beta declined audited" || { echo "FAIL: mixed decline audit"; FAIL=$((FAIL+1)); }

# 3. HIGH → blocked, exit 1, no prompt
SAFE_TEST_CASE=high node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss3.log 2>&1
check "HIGH gate: blocked" 1 $?
grep -q "INSTALLATION BLOCKED" /tmp/ss3.log && echo "PASS: HIGH blocked msg" || { echo "FAIL: HIGH block missing"; FAIL=$((FAIL+1)); }

# 4. CRITICAL + --force, non-interactive force prompt declines → exit 1
SAFE_TEST_CASE=critical node safe-skills.js add "$LOCAL" --force </dev/null >/tmp/ss4.log 2>&1
check "CRITICAL+force: force-decline" 1 $?
grep -q "bypassing the security policy" /tmp/ss4.log && echo "PASS: force warning shown" || { echo "FAIL: force warning"; FAIL=$((FAIL+1)); }

# 5. CRITICAL + --force via pty, answer y → installs, exit 0, audit approved
printf 'y\n' | SAFE_SKILLS_FORCE_TTY=1 SAFE_TEST_CASE=critical node safe-skills.js add "$LOCAL" --force >/tmp/ss5.log 2>&1
check "CRITICAL+force: forced install" 0 $?
grep -q '"decision":"approved"' test/.data/audit.jsonl && grep -q '"forced":true' test/.data/audit.jsonl && echo "PASS: audit approved+forced" || { echo "FAIL: audit entry"; FAIL=$((FAIL+1)); }

# 6. LOW auto-installs (no prompt), installer gets passthrough args
rm -f test/.install.log
SAFE_TEST_CASE=low node safe-skills.js add "$LOCAL" -g --skill demo </dev/null >/tmp/ss6.log 2>&1
check "LOW auto-install" 0 $?
grep -q '"decision":"approved"' test/.data/audit.jsonl || { echo "FAIL: audit approved (low)"; FAIL=$((FAIL+1)); }
grep -q -- "-g" test/.install.log && grep -q -- "--skill" test/.install.log && echo "PASS: installer got -g --skill" || { echo "FAIL: passthrough args"; FAIL=$((FAIL+1)); }

# 7. Scanner gets --no-llm when no provider configured (static-only flag)
SAFE_TEST_CASE=low node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss7.log 2>&1
grep -q "static-only" /tmp/ss7.log && echo "PASS: static-only default w/o keys" || { echo "FAIL: static-only detection"; FAIL=$((FAIL+1)); }

# 8. hard-block via category despite low score
SAFE_TEST_CASE=hardblock_low_score node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss8.log 2>&1
check "hard-block category" 1 $?
grep -q "INSTALLATION BLOCKED" /tmp/ss8.log && echo "PASS: low score overridden by critical finding" || { echo "FAIL: hard block"; FAIL=$((FAIL+1)); }

# 9. source normalization (allowlist matching key)
node -e "
const src = 'vercel-labs/agent-skills'.replace(/^https?:\/\//,'').replace(/^git@github\.com:/,'').replace(/\.git$/,'');
const m = src.match(/^(github\.com\/)?([^/]+\/[^/]+)/);
console.log(m ? m[2] : null);
" >/tmp/ss9.norm
grep -q "vercel-labs/agent-skills" /tmp/ss9.norm && echo "PASS: source normalization" || { echo "FAIL: normalize"; FAIL=$((FAIL+1)); }

# 10. --dry-run: full gate, no install, audit dry_run (auto, no prompt)
rm -f test/.install.log
SAFE_TEST_CASE=low node safe-skills.js add "$LOCAL" --dry-run </dev/null >/tmp/ss10.log 2>&1
check "dry-run" 0 $?
grep -q "DRY RUN" /tmp/ss10.log && grep -q '"decision":"dry_run"' test/.data/audit.jsonl && echo "PASS: dry-run logged, no install" || { echo "FAIL: dry-run flow"; FAIL=$((FAIL+1)); }
[ ! -s test/.install.log ] && echo "PASS: dry-run skipped installer" || { echo "FAIL: dry-run installed"; FAIL=$((FAIL+1)); }

# 11. scanner exit 1 (DO_NOT_INSTALL verdict) = valid scan, not tool failure
SAFE_TEST_CASE=high SAFE_TEST_EXIT=1 node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss11.log 2>&1
check "scanner exit-1 treated as verdict" 1 $?
grep -q "INSTALLATION BLOCKED" /tmp/ss11.log && grep -q "Decision:  BLOCKED" /tmp/ss11.log && echo "PASS: exit-1 scan blocked via policy" || { echo "FAIL: exit-1 verdict flow"; FAIL=$((FAIL+1)); }
unset SAFE_TEST_EXIT

# 12. BLOCKED, interactive override WITHOUT --force: y → installs
rm -f test/.install.log
printf 'y\n' | SAFE_SKILLS_FORCE_TTY=1 SAFE_TEST_CASE=high node safe-skills.js add "$LOCAL" >/tmp/ss12.log 2>&1
check "blocked interactive override" 0 $?
grep -q 'Install "demo-skill" anyway despite the security findings?' /tmp/ss12.log && grep -q '"decision":"approved"' test/.data/audit.jsonl && grep -q '"forced":true' test/.data/audit.jsonl && [ -s test/.install.log ] && echo "PASS: override installed + audited forced" || { echo "FAIL: override flow"; FAIL=$((FAIL+1)); }

# 13. BLOCKED, interactive decline: n → exit 1, audit blocked
printf 'n\n' | SAFE_SKILLS_FORCE_TTY=1 SAFE_TEST_CASE=high node safe-skills.js add "$LOCAL" >/tmp/ss13.log 2>&1
check "blocked interactive decline" 1 $?
grep -q '"decision":"blocked"' test/.data/audit.jsonl && echo "PASS: override declined audited" || { echo "FAIL: decline audit"; FAIL=$((FAIL+1)); }

# 14. BH2 finding (direct proven remote exfil) → BLOCKED despite low score
SAFE_TEST_CASE=bh2 node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss14.log 2>&1
check "BH2 hard-block" 1 $?
grep -q "INSTALLATION BLOCKED" /tmp/ss14.log && grep -q "Decision:  BLOCKED" /tmp/ss14.log && echo "PASS: BH2 hard-blocked" || { echo "FAIL: BH2 block flow"; FAIL=$((FAIL+1)); }

# 15. BH1 finding (bundled lifecycle hook) → MEDIUM risk + sentry review
SAFE_TEST_CASE=bh1 node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss15.log 2>&1
check "BH1 sentry medium" 1 $?
grep -q "Decision:  MEDIUM" /tmp/ss15.log && grep -q "secondary review" /tmp/ss15.log && echo "PASS: BH1 routes to medium" || { echo "FAIL: BH1 flow"; FAIL=$((FAIL+1)); }

# 16. BH3 finding (broad permission mode) → MEDIUM risk + sentry review
SAFE_TEST_CASE=bh3 node safe-skills.js add "$LOCAL" </dev/null >/tmp/ss16.log 2>&1
check "BH3 sentry medium" 1 $?
grep -q "Decision:  MEDIUM" /tmp/ss16.log && grep -q "secondary review" /tmp/ss16.log && echo "PASS: BH3 routes to medium" || { echo "FAIL: BH3 flow"; FAIL=$((FAIL+1)); }

# 17. bad --seed (non-integer) → exit 2
node safe-skills.js add "$LOCAL" --seed notanumber </dev/null >/tmp/ss17.log 2>&1
check "bad --seed: exit 2" 2 $?
grep -q "bad --seed" /tmp/ss17.log && echo "PASS: bad --seed error message" || { echo "FAIL: bad --seed msg"; FAIL=$((FAIL+1)); }

# 18. bad --temperature (out of range or invalid) → exit 2
node safe-skills.js add "$LOCAL" --temperature 3.5 </dev/null >/tmp/ss18.log 2>&1
check "bad --temperature: exit 2" 2 $?
grep -q "bad --temperature" /tmp/ss18.log && echo "PASS: bad --temperature error message" || { echo "FAIL: bad --temperature msg"; FAIL=$((FAIL+1)); }

# 19. valid --seed and --temperature forward to scanner env & are stripped from installer
rm -f test/.install.log /tmp/scanner_env.log
SAFE_SCAN_ENV_LOG="/tmp/scanner_env.log" SAFE_TEST_CASE=low node safe-skills.js add "$LOCAL" --seed 42 --temperature 0.5 </dev/null >/tmp/ss19.log 2>&1
check "valid sampling controls: exit 0" 0 $?
grep -q '"seed":"42"' /tmp/scanner_env.log && grep -q '"temperature":"0.5"' /tmp/scanner_env.log && echo "PASS: scanner received seed and temperature" || { echo "FAIL: scanner env forwarding"; FAIL=$((FAIL+1)); }
! grep -q -- "--seed" test/.install.log && ! grep -q -- "--temperature" test/.install.log && echo "PASS: installer stripped sampling flags" || { echo "FAIL: installer got reserved sampling flags"; FAIL=$((FAIL+1)); }

# 20. lockfile detection in summary
LOCKFILE_SKILL="test/.lockfile-skill"
rm -rf "$LOCKFILE_SKILL"
mkdir -p "$LOCKFILE_SKILL"
echo "# Mock Skill" > "$LOCKFILE_SKILL/SKILL.md"
echo '{"name":"mock","lockfileVersion":3}' > "$LOCKFILE_SKILL/package-lock.json"
SAFE_TEST_CASE=low node safe-skills.js add "$LOCKFILE_SKILL" </dev/null >/tmp/ss20.log 2>&1
check "lockfile scan: exit 0" 0 $?
grep -q "Lockfile:   audited (package-lock.json)" /tmp/ss20.log && echo "PASS: lockfile audited reported in summary" || { echo "FAIL: lockfile detection missing in summary"; FAIL=$((FAIL+1)); }
rm -rf "$LOCKFILE_SKILL"

# 21. update subcommand executes cleanly
node safe-skills.js update </dev/null >/tmp/ss21.log 2>&1
check "update subcommand: exit 0" 0 $?
grep -q "SYSTEM UPDATE" /tmp/ss21.log && grep -q "safe-skills-update-mock" /tmp/ss21.log && echo "PASS: update subcommand executed with mock" || { echo "FAIL: update banner or mock"; FAIL=$((FAIL+1)); }

# 21b. update --npm --dry-run
SAFE_SKILLS_UPDATE_CMD="" node safe-skills.js update --npm --dry-run </dev/null >/tmp/ss21b.log 2>&1
check "update --npm --dry-run: exit 0" 0 $?
grep -q "Update method:     NPM" /tmp/ss21b.log && grep -q "npm install -g safe-skills@latest" /tmp/ss21b.log && echo "PASS: update --npm selects npm correctly" || { echo "FAIL: update --npm flag"; FAIL=$((FAIL+1)); }

# 21c. update --bun --dry-run
SAFE_SKILLS_UPDATE_CMD="" node safe-skills.js update --bun --dry-run </dev/null >/tmp/ss21c.log 2>&1
check "update --bun --dry-run: exit 0" 0 $?
grep -q "Update method:     BUN" /tmp/ss21c.log && grep -q "bun add -g safe-skills@latest" /tmp/ss21c.log && echo "PASS: update --bun selects bun correctly" || { echo "FAIL: update --bun flag"; FAIL=$((FAIL+1)); }

# 21d. update --github --dry-run
SAFE_SKILLS_UPDATE_CMD="" node safe-skills.js update --github --dry-run </dev/null >/tmp/ss21d.log 2>&1
check "update --github --dry-run: exit 0" 0 $?
grep -q "Update method:     GITHUB" /tmp/ss21d.log && grep -q "git -C" /tmp/ss21d.log && echo "PASS: update --github selects github correctly" || { echo "FAIL: update --github flag"; FAIL=$((FAIL+1)); }

# 21e. update --check
SAFE_SKILLS_UPDATE_CMD="" node safe-skills.js update --check </dev/null >/tmp/ss21e.log 2>&1
check "update --check: exit 0" 0 $?
grep -q "SYSTEM UPDATE" /tmp/ss21e.log && ! grep -q "npm install -g" /tmp/ss21e.log && echo "PASS: update --check does not execute install" || { echo "FAIL: update --check executed install"; FAIL=$((FAIL+1)); }

# 22. invalid subcommand exits with code 2
node safe-skills.js invalid-cmd </dev/null >/tmp/ss22.log 2>&1
check "invalid subcommand: exit 2" 2 $?
grep -q "usage: safe-skills <add|update|verify>" /tmp/ss22.log && echo "PASS: invalid subcommand shows usage" || { echo "FAIL: invalid subcommand usage"; FAIL=$((FAIL+1)); }

# 23. cryptographic ledger (skills-lock.json) written upon install
[ -f test/.data/skills-lock.json ] && grep -q '"demo-skill"' test/.data/skills-lock.json && grep -q 'sha256:' test/.data/skills-lock.json
check "skills-lock.json generated" 0 $?
[ -f "$SAFE_SKILLS_LOCAL_LOCKFILE" ] && echo "PASS: local skills-lock.json generated" || { echo "FAIL: local skills-lock.json missing"; FAIL=$((FAIL+1)); }

# 24. verify subcommand passes on intact skill
node safe-skills.js verify demo-skill --path "$LOCAL" </dev/null >/tmp/ss24.log 2>&1
check "verify intact skill: exit 0" 0 $?
grep -q "VERIFIED" /tmp/ss24.log && grep -q "passed cryptographic verification" /tmp/ss24.log && echo "PASS: verify intact skill passed" || { echo "FAIL: verify intact skill"; FAIL=$((FAIL+1)); }

# 25. verify subcommand detects tampering (exit 1)
TAMPER_DIR="test/.tmp-tamper-skill"
rm -rf "$TAMPER_DIR"
mkdir -p "$TAMPER_DIR"
echo "original content" > "$TAMPER_DIR/SKILL.md"
SAFE_TEST_CASE=low node safe-skills.js add "$TAMPER_DIR" </dev/null >/dev/null 2>&1
# Tamper with file
echo "malicious modification" >> "$TAMPER_DIR/SKILL.md"
node safe-skills.js verify .tmp-tamper-skill --path "$TAMPER_DIR" </dev/null >/tmp/ss25.log 2>&1
check "verify detects tampering: exit 1" 1 $?
grep -q "TAMPERED" /tmp/ss25.log && grep -q "tampering detected" /tmp/ss25.log && echo "PASS: tampering detected in report" || { echo "FAIL: tampering detection missing"; FAIL=$((FAIL+1)); }
rm -rf "$TAMPER_DIR"

# 26. Anti-TOCTOU: remote repo install target preserves clean target even if commit mode requested
GIT_SRC="test/.tmp-git-repo"
rm -rf "$GIT_SRC"
mkdir -p "$GIT_SRC"
git -C "$GIT_SRC" init -q
git -C "$GIT_SRC" config user.name "tester"
git -C "$GIT_SRC" config user.email "tester@example.com"
echo "content" > "$GIT_SRC/SKILL.md"
git -C "$GIT_SRC" add .
git -C "$GIT_SRC" commit -q -m "test commit"
GIT_COMMIT=$(git -C "$GIT_SRC" rev-parse HEAD)

rm -f test/.install.log
SAFE_TEST_CASE=low node safe-skills.js add "file://$(pwd)/$GIT_SRC" --anti-toctou commit </dev/null >/tmp/ss26.log 2>&1
check "anti-TOCTOU clean target: exit 0" 0 $?
grep -q "Anti-TOCTOU notice — commit pinning" /tmp/ss26.log && echo "PASS: anti-TOCTOU notice logged" || { echo "FAIL: anti-TOCTOU notice missing"; FAIL=$((FAIL+1)); }
! grep -q "file://$(pwd)/$GIT_SRC#" test/.install.log && grep -q "file://$(pwd)/$GIT_SRC" test/.install.log && echo "PASS: installer received clean target without commit SHA" || { echo "FAIL: commit SHA leaked into installer args"; FAIL=$((FAIL+1)); }

# 26b. Anti-TOCTOU: default mode is off (clean package target without appended commit hash)
rm -f test/.install.log
SAFE_TEST_CASE=low node safe-skills.js add "file://$(pwd)/$GIT_SRC" </dev/null >/tmp/ss26b.log 2>&1
check "anti-TOCTOU default off mode: exit 0" 0 $?
! grep -q "file://$(pwd)/$GIT_SRC#" test/.install.log && grep -q "file://$(pwd)/$GIT_SRC" test/.install.log && echo "PASS: default mode preserves clean target" || { echo "FAIL: clean target corrupted in default mode"; FAIL=$((FAIL+1)); }

# 26c. Source with hash: strips hash ref to keep downstream target clean
rm -f test/.install.log
SAFE_TEST_CASE=low node safe-skills.js add "file://$(pwd)/$GIT_SRC#somehash123" </dev/null >/tmp/ss26c.log 2>&1
check "strip hash ref: exit 0" 0 $?
! grep -q "file://$(pwd)/$GIT_SRC#" test/.install.log && grep -q "file://$(pwd)/$GIT_SRC" test/.install.log && echo "PASS: hash ref stripped cleanly" || { echo "FAIL: hash ref not stripped"; FAIL=$((FAIL+1)); }
rm -rf "$GIT_SRC"

# 27. Anti-TOCTOU: local mode passes sandbox root to installer
GIT_SRC="test/.tmp-git-repo2"
rm -rf "$GIT_SRC"
mkdir -p "$GIT_SRC"
git -C "$GIT_SRC" init -q
git -C "$GIT_SRC" config user.name "tester"
git -C "$GIT_SRC" config user.email "tester@example.com"
echo "content" > "$GIT_SRC/SKILL.md"
git -C "$GIT_SRC" add .
git -C "$GIT_SRC" commit -q -m "test commit"

rm -f test/.install.log
SAFE_TEST_CASE=low node safe-skills.js add "file://$(pwd)/$GIT_SRC" --anti-toctou local </dev/null >/tmp/ss27.log 2>&1
check "anti-TOCTOU local mode: exit 0" 0 $?
grep -q "installing from verified local sandbox" /tmp/ss27.log && echo "PASS: local anti-TOCTOU logged" || { echo "FAIL: local anti-TOCTOU log missing"; FAIL=$((FAIL+1)); }
grep -q "safe-skills-src-" test/.install.log && echo "PASS: installer received local sandbox path" || { echo "FAIL: installer did not receive local sandbox path"; FAIL=$((FAIL+1)); }
rm -rf "$GIT_SRC"

# 28. Filesystem hardening (--readonly)
SAFE_TEST_CASE=low node safe-skills.js add "$LOCAL" --readonly </dev/null >/tmp/ss28.log 2>&1
check "readonly hardening: exit 0" 0 $?
grep -q "Decision:  SAFE" /tmp/ss28.log && echo "PASS: readonly install completed" || { echo "FAIL: readonly install"; FAIL=$((FAIL+1)); }

# 29. Subcommand delegation when called as skills binary
SAFE_SKILLS_UPSTREAM="node $(pwd)/test/fake-installer.js" node bin/skills.js list </dev/null >/tmp/ss29.log 2>&1
check "subcommand delegation via skills binary: exit 0" 0 $?
grep -q '"list"' test/.install.log && echo "PASS: delegated list subcommand upstream" || { echo "FAIL: delegation missing"; FAIL=$((FAIL+1)); }

# 30. Recursion guard (SAFE_SKILLS_PASSTHROUGH=1) bypasses scan and delegates
rm -f test/.install.log
SAFE_SKILLS_UPSTREAM="node $(pwd)/test/fake-installer.js" SAFE_SKILLS_PASSTHROUGH=1 node safe-skills.js add "some/skill" </dev/null >/tmp/ss30.log 2>&1
check "passthrough guard bypasses scan: exit 0" 0 $?
grep -q '"add"' test/.install.log && grep -q '"some/skill"' test/.install.log && echo "PASS: passthrough bypassed scan cleanly" || { echo "FAIL: passthrough guard failed"; FAIL=$((FAIL+1)); }

echo
echo "=== $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ]
