#!/usr/bin/env node
/**
 * safe-skills — installation policy wrapper for npx skills add.
 *
 * Gate: exact-skill resolution → SkillSpector scan → risk policy → human
 * approval → npx skills add. Records every decision to an audit log.
 *
 * Follows the "Agent Skills Security & Installation SOP".
 */

'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.env.SAFE_SKILLS_PASSTHROUGH === '1') {
  const [icmd, ...iprefix] = (process.env.SAFE_SKILLS_UPSTREAM || 'npx --yes --package=skills -- skills').split(/\s+/).filter(Boolean);
  const r = spawnSync(icmd, [...iprefix, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

const VERSION = '1.3.7';

const CONFIG_DIR = process.env.SAFE_SKILLS_CONFIG || path.join(os.homedir(), '.config', 'safe-skills');
const DATA_DIR = process.env.SAFE_SKILLS_DATA || path.join(os.homedir(), '.local', 'share', 'safe-skills');
const ALLOWLIST_FILE = path.join(CONFIG_DIR, 'allowlist.toml');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const LOCK_FILE = process.env.SAFE_SKILLS_LOCKFILE || path.join(DATA_DIR, 'skills-lock.json');

const SCANNER = process.env.SAFE_SKILLS_SCANNER || 'skillspector';
const INSTALLER = process.env.SAFE_SKILLS_INSTALLER || 'npx --yes --package=skills --';

// Score policy (SOP §07). HIGH/CRITICAL blocked by default.
const SCORE_POLICY = [
  { max: 20, level: 'LOW' },
  { max: 50, level: 'MEDIUM' },
  { max: 80, level: 'HIGH' },
  { max: Infinity, level: 'CRITICAL' },
];

// Finding categories that hard-block regardless of score (SOP §08).
const HARD_BLOCK_RE = /credential\s*(theft|access)|exfiltrat|malware|yara|reverse\s*shell|remote\s*(code|transfer)|(^|\s)rce($|\s)|privilege\s*escalat|(malicious\s*)?persistence|self-?modif|taint|data\s*theft|hidden\s*prompt\s*inject|\bBH2\b/i;

// Categories that trigger Sentry secondary review (SOP §10).
const SENTRY_RE = /network|exfiltrat|credential|secret|env(ironment)?\s*var|mcp|persistence|cron|systemd|lifecycle|hook|privilege|permission|config|supply\s*chain|dependency|install|execut|shell|taint|\bBH[13]\b/i;

const LEVELS = { low: 1, medium: 2, high: 3, critical: 4 };

// ── helpers ────────────────────────────────────────────────────────────────

function die(msg, code = 2) {
  process.stderr.write(`safe-skills: ${msg}\n`);
  process.exit(code);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  return r;
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { die(`cannot parse scanner output ${file}: ${e.message}`, 3); }
}

const rl = !!(process.stdin.isTTY || process.env.SAFE_SKILLS_FORCE_TTY === '1');

// Sync line read from fd 0. Works on TTY (canonical) and pipes. EOF → null.
function readLineSync() {
  const buf = Buffer.alloc(1);
  let line = '';
  while (true) {
    let n;
    try { n = fs.readSync(0, buf, 0, 1); } catch { return line; }
    if (n === 0) return line === '' ? null : line; // EOF
    const c = buf.toString();
    if (c === '\n') return line;
    line += c;
  }
}

function prompt(question, defYes = false) {
  if (!rl) {
    process.stdout.write(`${question} [n] (non-interactive: declined)\n`);
    return false;
  }
  process.stdout.write(`${question} `);
  const a = (readLineSync() || '').trim().toLowerCase();
  if (a === '') return defYes;
  return a === 'y' || a === 'yes';
}

function severityScore(s) { return LEVELS[String(s).toLowerCase()] || 0; }

// ── config ─────────────────────────────────────────────────────────────────

function readAllowlist() {
  const set = new Set();
  try {
    const txt = fs.readFileSync(ALLOWLIST_FILE, 'utf8');
    for (const m of txt.matchAll(/"([^"]+)"/g)) set.add(m[1].replace(/^github\.com\//, ''));
  } catch { /* missing allowlist = everything unknown */ }
  return set;
}

function normalizeSource(source) {
  let s = (source || '').replace(/#.*$/, '').replace(/^https?:\/\//, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '');
  const m = s.match(/^(github\.com\/)?([^/]+\/[^/]+)/);
  return m ? m[2] : null;
}

// ── skill resolution (SOP §05) ─────────────────────────────────────────────

function isLocal(src) {
  return src.startsWith('./') || src.startsWith('/') || src.startsWith('~') || fs.existsSync(src);
}

function toGitUrl(source) {
  if (isLocal(source)) return source;
  if (/^(git@[^:]+:|https?:\/\/)/.test(source)) return source;
  const m = source.match(/^([^/]+)\/([^/]+?)(?:#(.+))?$/);
  if (m) {
    const branch = m[3] ? `#${m[3]}` : '';
    return `https://github.com/${m[1]}/${m[2]}.git${branch}`;
  }
  return source;
}

function cloneSource(source, tmpDir) {
  const gitUrl = toGitUrl(source);
  console.log(`safe-skills: resolving ${source} (${gitUrl}) ...`);
  const cloneRes = sh('git', ['clone', '--depth', '1', gitUrl.replace(/#.*$/, ''), tmpDir], { stdio: 'inherit' });
  if (cloneRes.status !== 0) {
    die(`failed to clone repository from "${gitUrl}" (exit code ${cloneRes.status})`, 1);
  }
  const r = sh('git', ['rev-parse', 'HEAD'], { cwd: tmpDir });
  return r.stdout.trim();
}

function locateSkill(root, name) {
  for (const cand of [path.join(root, 'skills', name), path.join(root, name), path.join(root, '.agents', 'skills', name)]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function findSkillDirs(root, skillNames) {
  if (!skillNames.length) return [{ dir: root, label: path.basename(root) || 'all' }];
  const out = [];
  for (const name of skillNames) {
    const dir = locateSkill(root, name);
    if (dir) out.push({ dir, label: name });
    else out.push({ dir: null, label: name, missing: true });
  }
  return out;
}

function detectLockfile(dir, root) {
  for (const d of [dir, root].filter(Boolean)) {
    if (fs.existsSync(path.join(d, 'package-lock.json'))) return 'audited (package-lock.json)';
    if (fs.existsSync(path.join(d, 'npm-shrinkwrap.json'))) return 'audited (npm-shrinkwrap.json)';
  }
  return 'none';
}

// ── scanning ───────────────────────────────────────────────────────────────

function scanTarget(dir, useLLM) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'safe-skills-')), 'scan.json');
  const args = ['scan', dir, '--format', 'json', '--output', out];
  if (!useLLM) args.push('--no-llm');
  const [cmd, ...prefix] = SCANNER.split(/\s+/).filter(Boolean);
  const r = sh(cmd, [...prefix, ...args]);
  // exit 1 = scanner's own DO_NOT_INSTALL verdict (report still written and valid);
  // anything else = tool failure.
  if (r.status !== 0 && r.status !== 1) die(`scanner failed (exit ${r.status})`, 3);
  return readJSON(out);
}

// ── risk policy ────────────────────────────────────────────────────────────

function scoreLevel(score) {
  for (const p of SCORE_POLICY) if (score <= p.max) return p.level;
}

function classifyIssues(report) {
  const issues = report.issues || [];
  const bySeverity = { critical: [], high: [], medium: [], low: [] };
  let hardBlock = false;
  let sentry = false;
  for (const i of issues) {
    const sev = String(i.severity || 'low').toLowerCase();
    (bySeverity[sev] || bySeverity.low).push(i);
    const specific = `${i.finding || ''} ${i.code_snippet || ''}`;
    const id = String(i.id || '').toUpperCase();
    if (id === 'BH2' || severityScore(sev) >= 3 || HARD_BLOCK_RE.test(specific) || HARD_BLOCK_RE.test(i.explanation || '') || HARD_BLOCK_RE.test(i.category || '')) hardBlock = true;
    if (id === 'BH1' || id === 'BH3' || SENTRY_RE.test(`${i.category || ''} ${i.explanation || ''} ${specific}`)) sentry = true;
  }
  for (const c of report.components || []) {
    if (c.executable) sentry = true;
    if (/^(scripts|hooks|\.github\/workflows|src|\.claude)/.test(c.path)) sentry = true;
    if (/\.(sh|py|js|ts|rb|pl)$/i.test(c.path)) sentry = true;
    if (/(^|\/)(hooks\.json|settings(\.local)?\.json)$/i.test(c.path)) sentry = true;
  }
  return { bySeverity, hardBlock, sentry };
}

function llmAvailable() {
  const env = process.env;
  return !!(env.SKILLSPECTOR_PROVIDER || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY ||
    env.NVIDIA_INFERENCE_KEY || env.AWS_PROFILE);
}

// Load provider keys from ~/.config/safe-skills/keys.env (NOT symlinked into
// dotfiles — stays machine-local). Existing env vars win.
function loadKeys() {
  const f = path.join(CONFIG_DIR, 'keys.env');
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return; }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

// ── UI (SOP §11, §12) ──────────────────────────────────────────────────────

function bar() { console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'); }

function summary(meta, report, issues, level, trusted, staticOnly) {
  bar();
  console.log(` SKILL SECURITY REVIEW${level === 'MEDIUM' ? '  ⚠' : ''}`);
  bar();
  console.log(`\nRepository: ${meta.repo}`);
  console.log(`Skill:      ${meta.skill}`);
  console.log(`Scope:      ${meta.scope}`);
  if (meta.commit) console.log(`Commit:     ${meta.commit.slice(0, 12)}`);
  console.log(`Source:     ${trusted ? 'TRUSTED' : 'UNKNOWN'}${staticOnly ? '  (static-only scan)' : ''}`);
  if (meta.lockfile) console.log(`Lockfile:   ${meta.lockfile}`);
  const ra = report.risk_assessment || {};
  console.log(`\nSkillSpector:`);
  console.log(`  Score: ${ra.score}/100`);
  console.log(`  Severity: ${ra.severity}`);
  console.log(`  Recommendation: ${ra.recommendation}`);
  const files = (report.components || []).map(c => c.path);
  const shown = files.slice(0, 8).join(', ') + (files.length > 8 ? ` … (+${files.length - 8} more)` : '');
  console.log(`\nFiles: ${shown || 'n/a'}`);
  console.log(`\nFindings:`);
  console.log(`  Critical: ${issues.bySeverity.critical.length}`);
  console.log(`  High:     ${issues.bySeverity.high.length}`);
  console.log(`  Medium:   ${issues.bySeverity.medium.length}`);
  console.log(`  Low:      ${issues.bySeverity.low.length}`);
  if (issues.hardBlock) console.log('\n  ⛔ HARD BLOCK — HIGH+ severity or credible critical evidence');
  console.log(`\nDecision:  ${level}`);
  bar();
}

function printFindings(issues, min = 'medium') {
  const want = severityScore(min);
  const groups = new Map();
  for (const i of [...issues.bySeverity.critical, ...issues.bySeverity.high, ...issues.bySeverity.medium]) {
    if (severityScore(i.severity) < want) continue;
    const key = `${i.id}|${i.severity}|${i.category}`;
    const g = groups.get(key) || { issue: i, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  if (!groups.size) return;
  console.log('\nFindings at or above threshold:');
  for (const { issue: i, count } of groups.values()) {
    const dup = count > 1 ? ` ×${count}` : '';
    console.log(`  ${String(i.severity).toUpperCase()} ${i.category || i.id}${dup} — ${(i.explanation || i.remediation || '').slice(0, 140)}`);
  }
}

// ── audit (SOP §19) ────────────────────────────────────────────────────────

function audit(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    process.stderr.write(`safe-skills: audit write failed: ${e.message}\n`);
  }
}

// ── cryptographic integrity ledger (SOP §20 / v1.3.0) ──────────────────────

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
}

function computeSkillTreeHashes(dir) {
  const hashes = {};
  function walk(current, base) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const fullPath = path.join(current, e.name);
      const relPath = path.relative(base, fullPath);
      if (e.isDirectory()) {
        walk(fullPath, base);
      } else if (e.isFile()) {
        hashes[relPath] = hashFile(fullPath);
      }
    }
  }
  walk(dir, dir);
  return hashes;
}

function readLockfile(filePath = LOCK_FILE) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { version: '1.0', updated_at: null, skills: {} };
  }
}

function writeLockfile(lockData, filePath = LOCK_FILE) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    lockData.updated_at = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(lockData, null, 2) + '\n', 'utf8');
  } catch (e) {
    process.stderr.write(`safe-skills: lockfile write failed: ${e.message}\n`);
  }
}

function updateLockLedger(skillName, record, isGlobal) {
  const central = readLockfile(LOCK_FILE);
  if (!central.skills) central.skills = {};
  central.skills[skillName] = record;
  writeLockfile(central, LOCK_FILE);

  if (!isGlobal) {
    const localPath = process.env.SAFE_SKILLS_LOCAL_LOCKFILE || path.join(process.cwd(), 'skills-lock.json');
    const localLock = readLockfile(localPath);
    if (!localLock.skills) localLock.skills = {};
    localLock.skills[skillName] = record;
    writeLockfile(localLock, localPath);
  }
}

function findInstalledSkillDir(skillName, scope = 'local', customBase = null) {
  const candidates = [];
  if (customBase) {
    candidates.push(path.join(customBase, skillName));
    candidates.push(path.join(customBase, 'skills', skillName));
    candidates.push(path.join(customBase, '.agents', 'skills', skillName));
    if (path.basename(customBase) === skillName) {
      candidates.push(customBase);
    }
  }
  if (process.env.SAFE_SKILLS_INSTALL_DIR) {
    candidates.push(path.join(process.env.SAFE_SKILLS_INSTALL_DIR, skillName));
    candidates.push(process.env.SAFE_SKILLS_INSTALL_DIR);
  }
  if (scope === 'local' || !scope) {
    candidates.push(path.join(process.cwd(), 'skills', skillName));
    candidates.push(path.join(process.cwd(), '.agents', 'skills', skillName));
  }
  if (scope === 'global' || !scope) {
    candidates.push(path.join(os.homedir(), '.agents', 'skills', skillName));
    candidates.push(path.join(os.homedir(), '.claude', 'skills', skillName));
    candidates.push(path.join(os.homedir(), '.config', 'skills', skillName));
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      return c;
    }
  }
  return null;
}

function applyWriteProtection(skillDir) {
  if (!fs.existsSync(skillDir)) return;
  function protect(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(current, e.name);
      if (e.isDirectory()) {
        protect(fullPath);
        try { fs.chmodSync(fullPath, 0o555); } catch {}
      } else if (e.isFile()) {
        try { fs.chmodSync(fullPath, 0o444); } catch {}
      }
    }
    try { fs.chmodSync(current, 0o555); } catch {}
  }
  try { protect(skillDir); } catch {}
}

function runVerify(opts = {}) {
  bar();
  console.log(' 🛡️ SAFE-SKILLS INTEGRITY AUDIT');
  bar();

  const lockFiles = [];
  if (opts.customLock) {
    lockFiles.push(opts.customLock);
  } else {
    const localLock = process.env.SAFE_SKILLS_LOCAL_LOCKFILE || path.join(process.cwd(), 'skills-lock.json');
    if (!opts.globalOnly && fs.existsSync(localLock)) lockFiles.push(localLock);
    if (fs.existsSync(LOCK_FILE)) lockFiles.push(LOCK_FILE);
  }

  if (!lockFiles.length) {
    console.log('\nNo skills-lock.json ledger found.');
    console.log(`Expected at: ${LOCK_FILE} or ./skills-lock.json`);
    console.log('Install skills with safe-skills to record cryptographic provenance.');
    bar();
    return;
  }

  const combinedSkills = {};
  for (const lf of lockFiles) {
    const data = readLockfile(lf);
    for (const [name, rec] of Object.entries(data.skills || {})) {
      if (!combinedSkills[name]) combinedSkills[name] = rec;
    }
  }

  let names = Object.keys(combinedSkills);
  if (opts.skillName) {
    names = names.filter(n => n === opts.skillName);
    if (!names.length) {
      console.log(`\nSkill "${opts.skillName}" is not recorded in the ledger.`);
      bar();
      return;
    }
  }
  if (!names.length) {
    console.log('\nCryptographic ledger is empty (no skills tracked).');
    bar();
    return;
  }

  console.log(`\nAuditing ${names.length} tracked skill(s) against cryptographic ledger...\n`);

  let verifiedCount = 0;
  let tamperedCount = 0;
  let missingCount = 0;
  const results = [];

  for (const name of names) {
    const record = combinedSkills[name];
    const skillDir = findInstalledSkillDir(name, record.scope, opts.path);

    if (!skillDir) {
      missingCount++;
      results.push({ name, status: 'MISSING', details: ['Installed directory not found on disk'] });
      continue;
    }

    const currentHashes = computeSkillTreeHashes(skillDir);
    const recordedFiles = record.files || {};
    const mismatches = [];

    // 1. Check recorded files
    for (const [relPath, expectedHash] of Object.entries(recordedFiles)) {
      if (!currentHashes[relPath]) {
        mismatches.push(`missing file: ${relPath}`);
      } else if (currentHashes[relPath] !== expectedHash) {
        mismatches.push(`tampered: ${relPath} (expected ${expectedHash.slice(0, 16)}..., got ${currentHashes[relPath].slice(0, 16)}...)`);
      }
    }

    // 2. Check for newly introduced unexpected files
    for (const relPath of Object.keys(currentHashes)) {
      if (!recordedFiles[relPath]) {
        mismatches.push(`unrecorded file added: ${relPath}`);
      }
    }

    if (mismatches.length > 0) {
      tamperedCount++;
      results.push({ name, status: 'TAMPERED', dir: skillDir, details: mismatches });
    } else {
      verifiedCount++;
      results.push({ name, status: 'VERIFIED', dir: skillDir, fileCount: Object.keys(recordedFiles).length });
    }
  }

  for (const res of results) {
    if (res.status === 'VERIFIED') {
      console.log(`  ✔ [VERIFIED]  ${res.name} (${res.fileCount} files verified SHA-256 match)`);
    } else if (res.status === 'TAMPERED') {
      console.log(`  🚨 [TAMPERED]  ${res.name} at ${res.dir}`);
      for (const d of res.details) {
        console.log(`     └─ ⚠ ${d}`);
      }
    } else if (res.status === 'MISSING') {
      console.log(`  ⚪ [MISSING]   ${res.name} (not found in expected directories)`);
    }
  }

  console.log('\nIntegrity Summary:');
  console.log(`  Verified: ${verifiedCount}`);
  console.log(`  Tampered: ${tamperedCount}`);
  console.log(`  Missing:  ${missingCount}`);

  audit({
    action: 'verify',
    verified: verifiedCount,
    tampered: tamperedCount,
    missing: missingCount,
    passed: tamperedCount === 0 && (opts.strict ? missingCount === 0 : true),
  });

  bar();

  if (tamperedCount > 0) {
    die(`tampering detected in ${tamperedCount} skill(s)! Verify ledger or reinstall.`, 1);
  }
  if (opts.strict && missingCount > 0) {
    die(`strict verification failed: ${missingCount} skill(s) missing from filesystem`, 1);
  }
  console.log('\nsafe-skills: all tracked skills passed cryptographic verification.\n');
}

function parseSemver(v) {
  const clean = (v || '').replace(/^v/, '').trim();
  const parts = clean.split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareSemver(v1, v2) {
  const [a1, b1, c1] = parseSemver(v1);
  const [a2, b2, c2] = parseSemver(v2);
  if (a1 !== a2) return a1 - a2;
  if (b1 !== b2) return b1 - b2;
  return c1 - c2;
}

function detectUpdateMethod(opts = {}) {
  if (opts.npm) return 'npm';
  if (opts.bun) return 'bun';
  if (opts.github || opts.git) return 'github';
  if (process.env.SAFE_SKILLS_UPDATE_METHOD) {
    return process.env.SAFE_SKILLS_UPDATE_METHOD.toLowerCase();
  }

  const argv1 = process.argv[1] || '';
  const scriptDir = path.resolve(__dirname);

  // 1. Bun runtime or bin path
  if (process.versions?.bun || argv1.includes('/.bun/') || argv1.includes('\\.bun\\') || scriptDir.includes('/.bun/')) {
    return 'bun';
  }

  // 2. Installed inside DATA_DIR with a git repo
  const repoDir = path.join(DATA_DIR, 'repo');
  if (scriptDir.startsWith(DATA_DIR) && (fs.existsSync(path.join(DATA_DIR, '.git')) || fs.existsSync(path.join(repoDir, '.git')))) {
    return 'github';
  }

  // 3. Node/npm environment
  if (argv1.includes('/node_modules/') || argv1.includes('/.nvm/') || argv1.includes('/npm/')) {
    return 'npm';
  }

  // 4. Check available binaries on PATH
  try {
    if (sh('which', ['npm']).status === 0) return 'npm';
  } catch {}
  try {
    if (sh('which', ['bun']).status === 0) return 'bun';
  } catch {}

  if (fs.existsSync(path.join(DATA_DIR, '.git'))) {
    return 'github';
  }

  return 'npm';
}

function runUpdate(opts = {}) {
  bar();
  console.log(' 🔄 SAFE-SKILLS SYSTEM UPDATE');
  bar();
  console.log(`\nInstalled version: v${VERSION}`);

  // 1. Update safe-skills
  const method = detectUpdateMethod(opts);
  console.log(`Update method:     ${method.toUpperCase()}`);

  if (process.env.SAFE_SKILLS_UPDATE_CMD) {
    console.log(`\nExecuting update command: ${process.env.SAFE_SKILLS_UPDATE_CMD}`);
    if (!opts.dryRun) {
      const [cmd, ...cargs] = process.env.SAFE_SKILLS_UPDATE_CMD.split(/\s+/).filter(Boolean);
      sh(cmd, cargs, { stdio: 'inherit' });
    }
  } else if (method === 'npm') {
    let latestVersion = null;
    try {
      const vCheck = sh('npm', ['view', 'safe-skills', 'version']);
      if (vCheck.status === 0 && vCheck.stdout.trim()) {
        latestVersion = vCheck.stdout.trim();
      }
    } catch {}

    if (latestVersion) {
      console.log(`Latest published npm version: v${latestVersion}`);
      const cmp = compareSemver(latestVersion, VERSION);
      if (cmp > 0) {
        console.log(`Update available: v${VERSION} -> v${latestVersion}`);
      } else if (cmp < 0) {
        console.log(`Installed version (v${VERSION}) is ahead of latest published npm release (v${latestVersion}).`);
      } else {
        console.log('safe-skills is already on the latest version.');
      }
    }

    if (opts.check) {
      // Check only
    } else if (opts.dryRun) {
      console.log('\n[dry-run] Would execute: npm install -g safe-skills@latest');
    } else {
      console.log('\nUpdating safe-skills via npm (npm install -g safe-skills@latest)...');
      try {
        const npmUp = sh('npm', ['install', '-g', 'safe-skills@latest'], { stdio: 'inherit' });
        if (npmUp.status === 0) {
          console.log('safe-skills updated successfully to latest npm release.');
        } else {
          console.log(`npm update failed with exit code ${npmUp.status}`);
        }
      } catch (e) {
        console.log(`npm update failed: ${e.message}`);
      }
    }
  } else if (method === 'bun') {
    let latestVersion = null;
    try {
      const vCheck = sh('npm', ['view', 'safe-skills', 'version']);
      if (vCheck.status === 0 && vCheck.stdout.trim()) {
        latestVersion = vCheck.stdout.trim();
      }
    } catch {}

    if (latestVersion) {
      console.log(`Latest published version: v${latestVersion}`);
      const cmp = compareSemver(latestVersion, VERSION);
      if (cmp > 0) {
        console.log(`Update available: v${VERSION} -> v${latestVersion}`);
      } else if (cmp < 0) {
        console.log(`Installed version (v${VERSION}) is ahead of latest published release (v${latestVersion}).`);
      } else {
        console.log('safe-skills is already on the latest version.');
      }
    }

    if (opts.check) {
      // Check only
    } else if (opts.dryRun) {
      console.log('\n[dry-run] Would execute: bun add -g safe-skills@latest');
    } else {
      console.log('\nUpdating safe-skills via bun (bun add -g safe-skills@latest)...');
      try {
        const bunUp = sh('bun', ['add', '-g', 'safe-skills@latest'], { stdio: 'inherit' });
        if (bunUp.status === 0) {
          console.log('safe-skills updated successfully to latest bun release.');
        } else {
          console.log(`bun update failed with exit code ${bunUp.status}`);
        }
      } catch (e) {
        console.log(`bun update failed: ${e.message}`);
      }
    }
  } else if (method === 'github') {
    const scriptDir = path.resolve(__dirname);
    const defaultGitDir = path.join(DATA_DIR, 'repo');
    let gitDir = null;

    if (fs.existsSync(path.join(DATA_DIR, '.git'))) {
      gitDir = DATA_DIR;
    } else if (fs.existsSync(path.join(defaultGitDir, '.git'))) {
      gitDir = defaultGitDir;
    } else if ((opts.github || opts.git) && fs.existsSync(path.join(scriptDir, '.git'))) {
      gitDir = scriptDir;
    }

    if (!gitDir) {
      if (opts.check) {
        console.log(`\nNo git clone found in ${defaultGitDir}.`);
      } else if (opts.dryRun) {
        console.log(`\n[dry-run] Would clone https://github.com/harshsinghmp/safe-skills.git into ${defaultGitDir}`);
      } else {
        console.log(`\nCloning latest safe-skills from GitHub into ${defaultGitDir}...`);
        try {
          fs.mkdirSync(defaultGitDir, { recursive: true });
          const clone = sh('git', ['clone', 'https://github.com/harshsinghmp/safe-skills.git', defaultGitDir], { stdio: 'inherit' });
          if (clone.status === 0) {
            console.log('safe-skills cloned successfully from GitHub.');
          } else {
            console.log(`git clone failed with exit code ${clone.status}`);
          }
        } catch (e) {
          console.log(`git clone failed: ${e.message}`);
        }
      }
    } else {
      console.log(`\nUpdating safe-skills via git repository (${gitDir})...`);
      if (opts.check) {
        try {
          sh('git', ['fetch', 'origin'], { cwd: gitDir });
          const status = sh('git', ['status', '-uno'], { cwd: gitDir });
          console.log(status.stdout.trim() || 'Git status checked.');
        } catch (e) {
          console.log(`git check failed: ${e.message}`);
        }
      } else if (opts.dryRun) {
        console.log(`\n[dry-run] Would execute: git -C ${gitDir} pull --ff-only`);
      } else {
        try {
          const pull = sh('git', ['pull', '--ff-only'], { cwd: gitDir });
          if (pull.status === 0) {
            console.log(pull.stdout.trim() || 'safe-skills is already up to date.');
          } else {
            console.log(`git update notice: ${pull.stderr.trim() || 'already up to date or local branch'}`);
          }
        } catch (e) {
          console.log(`git update failed: ${e.message}`);
        }
      }
    }
  }

  // 2. Update NVIDIA SkillSpector scanner
  if (opts.check) {
    console.log('\nChecking NVIDIA SkillSpector scanner status...');
  } else if (opts.dryRun) {
    console.log('\n[dry-run] Would upgrade NVIDIA SkillSpector scanner');
  } else if (SCANNER !== 'skillspector' && process.env.SAFE_SKILLS_SCANNER) {
    console.log(`\nCustom scanner configured (${SCANNER}) — skipping external SkillSpector upgrade.`);
  } else {
    console.log('\nChecking NVIDIA SkillSpector scanner...');
    let scannerUpdated = false;
    try {
      const uvCheck = sh('which', ['uv']);
      if (uvCheck.status === 0) {
        console.log('Running: uv tool upgrade skillspector...');
        const uvUp = sh('uv', ['tool', 'upgrade', 'skillspector']);
        if (uvUp.status === 0) {
          console.log(uvUp.stdout.trim() || 'SkillSpector updated.');
          scannerUpdated = true;
        }
      }
    } catch {}

    if (!scannerUpdated) {
      try {
        const pipCheck = sh('which', ['pip']);
        if (pipCheck.status === 0) {
          console.log('Running: pip install --upgrade skillspector...');
          const pipUp = sh('pip', ['install', '--upgrade', 'skillspector']);
          if (pipUp.status === 0) scannerUpdated = true;
        }
      } catch {}
    }
  }

  console.log('\nUpdate process complete.');
  bar();
}

// ── main ───────────────────────────────────────────────────────────────────

function main() {
  loadKeys();
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-V')) { console.log(VERSION); return; }
  if (args[0] === 'update') {
    const opts = {
      npm: false,
      bun: false,
      github: false,
      check: false,
      dryRun: false,
    };
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === '--npm') opts.npm = true;
      else if (a === '--bun') opts.bun = true;
      else if (a === '--github' || a === '--git') opts.github = true;
      else if (a === '--check') opts.check = true;
      else if (a === '--dry-run') opts.dryRun = true;
      else die(`unknown update option: ${a}`, 2);
    }
    runUpdate(opts);
    return;
  }
  if (args[0] === 'verify') {
    let customPath = null;
    let globalOnly = false;
    let strict = false;
    let customLock = null;
    let skillName = null;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === '--path') { customPath = args[++i]; continue; }
      if (a === '--global' || a === '-g') { globalOnly = true; continue; }
      if (a === '--strict') { strict = true; continue; }
      if (a === '--lockfile') { customLock = args[++i]; continue; }
      if (a === '--skill') { skillName = args[++i]; continue; }
      if (!skillName && !a.startsWith('-')) { skillName = a; continue; }
    }
    runVerify({ path: customPath, globalOnly, strict, customLock, skillName });
    return;
  }
  if (!args[0] || args[0] !== 'add') {
    const binBase = path.basename(process.argv[1] || '').replace(/\.js$/, '');
    if (binBase === 'skills' && args[0] && !['update', 'verify'].includes(args[0])) {
      const [icmd, ...iprefix] = (process.env.SAFE_SKILLS_UPSTREAM || 'npx --yes --package=skills -- skills').split(/\s+/).filter(Boolean);
      const r = spawnSync(icmd, [...iprefix, ...args], { stdio: 'inherit' });
      process.exit(r.status ?? 0);
    }
    die('usage: safe-skills <add|update|verify> [args]\n       safe-skills add <source> [--skill name ...] [options]\n       safe-skills verify [--global] [--strict] [--path dir]\n       safe-skills update [--npm|--bun|--github|--check|--dry-run]', 2);
  }

  const reserved = new Set(['--threshold', '--force', '--llm', '--no-llm', '--skill', '--dry-run', '--seed', '--temperature', '--anti-toctou', '--readonly']);
  let source = null;
  let threshold = 'high';
  let force = false;
  let dryRun = false;
  let readonly = false;
  let antiToctou = process.env.SAFE_SKILLS_ANTI_TOCTOU || 'off'; // 'local' | 'off'
  let forceLLM = null; // true=llm, false=no-llm, null=auto
  const skillNames = [];
  const passthrough = [];

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!source && !a.startsWith('-')) { source = a; continue; }
    if (a === '--threshold') { threshold = args[++i]; if (!(threshold in LEVELS)) die(`bad --threshold ${threshold}`, 2); continue; }
    if (a === '--force') { force = true; continue; }
    if (a === '--dry-run') { dryRun = true; continue; }
    if (a === '--readonly') { readonly = true; continue; }
    if (a === '--anti-toctou') {
      const mode = args[++i];
      if (!['local', 'off'].includes(mode)) die(`bad --anti-toctou ${mode || ''} (must be local or off)`, 2);
      antiToctou = mode;
      continue;
    }
    if (a === '--llm') { forceLLM = true; continue; }
    if (a === '--no-llm') { forceLLM = false; continue; }
    if (a === '--seed') {
      const s = args[++i];
      if (!s || !/^-?\d+$/.test(s)) die(`bad --seed ${s || ''}`, 2);
      process.env.SKILLSPECTOR_SEED = s;
      continue;
    }
    if (a === '--temperature') {
      const t = args[++i];
      const val = parseFloat(t);
      if (!t || isNaN(val) || val < 0.0 || val > 2.0) die(`bad --temperature ${t || ''}`, 2);
      process.env.SKILLSPECTOR_TEMPERATURE = t;
      continue;
    }
    if (a === '--skill') {
      const n = args[++i];
      if (!n) die('--skill requires a name', 2);
      skillNames.push(n);
      passthrough.push(a, n);
      continue;
    }
    passthrough.push(a);
  }
  if (!source) die('missing <source>', 2);

  const scope = passthrough.includes('-g') || passthrough.includes('--global') ? 'GLOBAL' : 'LOCAL';
  const trusted = readAllowlist().has(normalizeSource(source));
  const useLLM = forceLLM === true || (forceLLM === null && llmAvailable());
  const staticOnly = !useLLM;

  // Resolve + clone
  let root = null, commit = null, cleanup = null;
  if (isLocal(source)) {
    root = source.replace(/^~/, os.homedir());
    if (fs.existsSync(path.join(root, '.git'))) {
      try { commit = sh('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim(); } catch {}
    }
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-skills-src-'));
    commit = cloneSource(source, tmp);
    root = tmp;
    cleanup = tmp;
  }

  const targets = findSkillDirs(root, skillNames);
  for (const t of targets) {
    if (t.missing) {
      console.log(`safe-skills: WARNING skill "${t.label}" not found in repository — scanning whole repo instead`);
      t.dir = root;
    }
  }

  let reports, issues, metas;
  try {
    reports = targets.map(t => scanTarget(t.dir, useLLM));
    metas = targets.map((t, i) => ({
      repo: normalizeSource(source) || source,
      skill: t.label,
      scope,
      commit,
      lockfile: detectLockfile(t.dir, root),
    }));
    issues = reports.map(classifyIssues);
  } catch (e) {
    if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
    throw e;
  }
  // Per-target level: SAFE / MEDIUM / BLOCKED
  const allLow = reports.every(r => scoreLevel(r.risk_assessment?.score ?? 999) === 'LOW');
  const srcTrusted = isLocal(source) || trusted;
  const levels = reports.map((r, i) => {
    const score = r.risk_assessment?.score ?? 999;
    const sev = issues[i];
    const lvl = scoreLevel(score);
    const blockSeverity = severityScore(threshold) === 4 ? 'critical' : threshold;
    const anyBlockIssue = sev.bySeverity[blockSeverity]?.length > 0;
    if (sev.hardBlock) return 'BLOCKED';
    if (lvl === 'HIGH' || lvl === 'CRITICAL' || anyBlockIssue) return 'BLOCKED';
    if (lvl === 'MEDIUM' || sev.sentry || !(srcTrusted || allLow)) return 'MEDIUM';
    return 'SAFE';
  });

  // Per-skill gate: SAFE installs automatically; MEDIUM and BLOCKED ask one
  // skill at a time. Approved skills install together in one command.
  const approved = [];   // indices of targets to install
  let anyBlockedApproved = false;
  reports.forEach((r, i) => {
    const level = levels[i];
    const skill = metas[i].skill;
    if (level === 'SAFE') {
      summary(metas[i], r, issues[i], 'SAFE', trusted, staticOnly);
      approved.push(i);
      return;
    }
    summary(metas[i], r, issues[i], level, trusted, staticOnly);
    printFindings(issues[i], level === 'BLOCKED' ? 'high' : 'medium');
    if (level === 'BLOCKED') {
      console.log(force
        ? '\nWARNING: you are bypassing the security policy.\nYou are responsible for reviewing the findings.'
        : '\n🚨 INSTALLATION BLOCKED — do not install unless you reviewed the findings and accept the risk.');
      if (prompt(`Install "${skill}" anyway despite the security findings? [y/N]`)) {
        approved.push(i);
        anyBlockedApproved = true;
      } else {
        audit({ repository: metas[i].repo, skill, scope: scope.toLowerCase(), commit, risk_score: r.risk_assessment?.score, severity: r.risk_assessment?.severity, finding_ids: issues[i].bySeverity.high.concat(issues[i].bySeverity.critical).map(f => f.id), decision: force ? 'force_declined' : 'blocked', forced: force });
      }
    } else {
      console.log('\n⚠ MEDIUM risk — secondary review (Sentry skill-scanner) recommended.');
      if (prompt(`Install "${skill}" anyway? [y/N]`)) {
        approved.push(i);
      } else {
        audit({ repository: metas[i].repo, skill, scope: scope.toLowerCase(), commit, risk_score: r.risk_assessment?.score, severity: r.risk_assessment?.severity, finding_ids: issues[i].bySeverity.medium.concat(issues[i].bySeverity.high, issues[i].bySeverity.critical).map(f => f.id), decision: 'declined', forced: false });
      }
    }
  });

  // Rebuild passthrough args: only --skill for approved targets.
  const approvedSet = new Set(approved.map(i => metas[i].skill));
  const installArgs = [];
  for (let i = 0; i < passthrough.length; i++) {
    if (passthrough[i] === '--skill') { i++; continue; }
    installArgs.push(passthrough[i]);
  }
  for (const i of approved) {
    const label = metas[i].skill;
    if (skillNames.length) installArgs.push('--skill', label);
  }

  // ── Clean Target & Local Sandbox Mode ──
  // Strip any trailing `#<ref>` to keep downstream target clean (<owner>/<repo>).
  // Downstream `skills add` executes `git clone --depth 1 --branch <ref>` which rejects commit SHAs.
  let installTarget = isLocal(source) ? source : source.replace(/#.*$/, '');
  if (!isLocal(source) && antiToctou === 'local') {
    installTarget = root;
    console.log('safe-skills: Anti-TOCTOU active — installing from verified local sandbox');
  }

  // ── INSTALL (SOP §16) ──
  if (dryRun) {
    console.log(`\nsafe-skills: DRY RUN — would run:\n  npx skills add ${installTarget} ${installArgs.join(' ')}`);
    audit({
      repository: metas[0].repo,
      skill: metas.map(m => m.skill).join(','),
      scope: scope.toLowerCase(),
      commit,
      risk_score: reports[0].risk_assessment?.score,
      severity: reports[0].risk_assessment?.severity,
      finding_ids: issues.flatMap(i => [...i.bySeverity.low, ...i.bySeverity.medium, ...i.bySeverity.high, ...i.bySeverity.critical].map(f => f.id)),
      sentry_review: levels.some(l => l === 'MEDIUM') ? 'required' : 'not_required',
      decision: 'dry_run',
      forced: force || anyBlockedApproved,
    });
    return;
  }

  if (!approved.length) {
    console.log('\nsafe-skills: no skills approved — nothing installed.');
    process.exit(1);
  }

  console.log(`\nsafe-skills: gate passed — installing ${approved.map(i => metas[i].skill).join(', ')} ...`);
  const [icmd, ...iprefix] = INSTALLER.split(/\s+/).filter(Boolean);
  const r = sh(icmd, [...iprefix, 'skills', 'add', installTarget, ...installArgs], {
    stdio: 'inherit',
    env: { ...process.env, SAFE_SKILLS_PASSTHROUGH: '1' }
  });
  if (r.status !== 0) {
    audit({ repository: metas[0].repo, skill: approved.map(i => metas[i].skill).join(','), scope: scope.toLowerCase(), commit, risk_score: reports[0].risk_assessment?.score, severity: reports[0].risk_assessment?.severity, finding_ids: approved.flatMap(i => issues[i].bySeverity.medium.concat(issues[i].bySeverity.high, issues[i].bySeverity.critical).map(f => f.id)), decision: 'install_failed', forced: force || anyBlockedApproved });
    process.exit(r.status);
  }

  // Update cryptographic integrity ledger (skills-lock.json)
  const isGlobal = scope === 'GLOBAL';
  for (const i of approved) {
    const skillName = metas[i].skill;
    const targetDir = targets[i].dir;
    if (targetDir && fs.existsSync(targetDir)) {
      const hashes = computeSkillTreeHashes(targetDir);
      updateLockLedger(skillName, {
        repository: metas[i].repo,
        commit: metas[i].commit || null,
        scope: scope.toLowerCase(),
        installed_at: new Date().toISOString(),
        files: hashes,
      }, isGlobal);
    }
  }

  // Enforce read-only write protection if requested
  if (readonly || process.env.SAFE_SKILLS_READONLY === '1') {
    for (const i of approved) {
      const skillName = metas[i].skill;
      const installedDir = findInstalledSkillDir(skillName, scope.toLowerCase());
      if (installedDir) {
        applyWriteProtection(installedDir);
        console.log(`safe-skills: write-protection applied to ${skillName} (${installedDir})`);
      }
    }
  }

  audit({
    repository: metas[0].repo,
    skill: approved.map(i => metas[i].skill).join(','),
    scope: scope.toLowerCase(),
    commit,
    risk_score: reports[0].risk_assessment?.score,
    severity: reports[0].risk_assessment?.severity,
    finding_ids: approved.flatMap(i => [...issues[i].bySeverity.low, ...issues[i].bySeverity.medium, ...issues[i].bySeverity.high, ...issues[i].bySeverity.critical].map(f => f.id)),
    sentry_review: approved.some(i => levels[i] === 'MEDIUM') ? 'required' : 'not_required',
    decision: 'approved',
    forced: force || anyBlockedApproved,
  });

  if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
}

try {
  main();
} catch (e) {
  process.stderr.write(`safe-skills: error: ${e.message}\n`);
  process.exit(3);
}
