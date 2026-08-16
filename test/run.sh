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
printf 'y\n' | script -qec "SAFE_TEST_CASE=medium node safe-skills.js add '$LOCAL'" /dev/null >/tmp/ss2b.log 2>&1
check "MEDIUM approved" 0 $?
grep -q 'Install "demo-skill" anyway?' /tmp/ss2b.log && grep -q '"decision":"approved"' test/.data/audit.jsonl && grep -q '"forced":false' test/.data/audit.jsonl && echo "PASS: MEDIUM approved + audited" || { echo "FAIL: MEDIUM approve flow"; FAIL=$((FAIL+1)); }
[ -s test/.install.log ] && echo "PASS: MEDIUM approved installed" || { echo "FAIL: MEDIUM approved but no install"; FAIL=$((FAIL+1)); }

# 2c. Mixed batch: alpha SAFE auto, beta MEDIUM approved (y) → both install, one command
rm -f test/.install.log
printf 'y\n' | script -qec "SAFE_TEST_CASES=alpha:low,beta:medium node safe-skills.js add 'test/fixtures/multi' --skill alpha --skill beta" /dev/null >/tmp/ss2c.log 2>&1
check "mixed approve: exit 0" 0 $?
grep -q '"alpha"' test/.install.log && grep -q '"beta"' test/.install.log && echo "PASS: installer got both skills" || { echo "FAIL: mixed install args"; FAIL=$((FAIL+1)); }
grep -q 'Decision:  SAFE' /tmp/ss2c.log && grep -q 'Decision:  MEDIUM' /tmp/ss2c.log && grep -q 'Install "beta" anyway?' /tmp/ss2c.log && echo "PASS: per-skill review shown" || { echo "FAIL: mixed per-skill flow"; FAIL=$((FAIL+1)); }

# 2d. Mixed batch: alpha SAFE auto, beta MEDIUM declined (n) → only alpha installs
rm -f test/.install.log
printf 'n\n' | script -qec "SAFE_TEST_CASES=alpha:low,beta:medium node safe-skills.js add 'test/fixtures/multi' --skill alpha --skill beta" /dev/null >/tmp/ss2d.log 2>&1
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
printf 'y\n' | script -qec "SAFE_TEST_CASE=critical node safe-skills.js add '$LOCAL' --force" /dev/null >/tmp/ss5.log 2>&1
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
printf 'y\n' | script -qec "SAFE_TEST_CASE=high node safe-skills.js add '$LOCAL'" /dev/null >/tmp/ss12.log 2>&1
check "blocked interactive override" 0 $?
grep -q 'Install "demo-skill" anyway despite the security findings?' /tmp/ss12.log && grep -q '"decision":"approved"' test/.data/audit.jsonl && grep -q '"forced":true' test/.data/audit.jsonl && [ -s test/.install.log ] && echo "PASS: override installed + audited forced" || { echo "FAIL: override flow"; FAIL=$((FAIL+1)); }

# 13. BLOCKED, interactive decline: n → exit 1, audit blocked
printf 'n\n' | script -qec "SAFE_TEST_CASE=high node safe-skills.js add '$LOCAL'" /dev/null >/tmp/ss13.log 2>&1
check "blocked interactive decline" 1 $?
grep -q '"decision":"blocked"' test/.data/audit.jsonl && echo "PASS: override declined audited" || { echo "FAIL: decline audit"; FAIL=$((FAIL+1)); }

echo
echo "=== $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ]
