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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = '1.1.0';

const CONFIG_DIR = process.env.SAFE_SKILLS_CONFIG || path.join(os.homedir(), '.config', 'safe-skills');
const DATA_DIR = process.env.SAFE_SKILLS_DATA || path.join(os.homedir(), '.local', 'share', 'safe-skills');
const ALLOWLIST_FILE = path.join(CONFIG_DIR, 'allowlist.toml');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

const SCANNER = process.env.SAFE_SKILLS_SCANNER || 'skillspector';
const INSTALLER = process.env.SAFE_SKILLS_INSTALLER || 'npx';

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

const rl = process.stdin.isTTY;

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
  let s = source.replace(/^https?:\/\//, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '');
  const m = s.match(/^(github\.com\/)?([^/]+\/[^/]+)/);
  return m ? m[2] : null;
}

// ── skill resolution (SOP §05) ─────────────────────────────────────────────

function isLocal(src) {
  return src.startsWith('./') || src.startsWith('/') || src.startsWith('~') || fs.existsSync(src);
}

function cloneSource(source, tmpDir) {
  console.log(`safe-skills: resolving ${source} ...`);
  sh('git', ['clone', '--depth', '1', source, tmpDir], { stdio: 'inherit' });
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

// ── main ───────────────────────────────────────────────────────────────────

function main() {
  loadKeys();
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-V')) { console.log(VERSION); return; }
  if (!args[0] || args[0] !== 'add') {
    die('usage: safe-skills add <source> [--skill name ...] [options]\n       reserved: --threshold <low|medium|high|critical>  --force  --llm  --no-llm  --seed <int>  --temperature <float>', 2);
  }

  const reserved = new Set(['--threshold', '--force', '--llm', '--no-llm', '--skill', '--dry-run', '--seed', '--temperature']);
  let source = null;
  let threshold = 'high';
  let force = false;
  let dryRun = false;
  let forceLLM = null; // true=llm, false=no-llm, null=auto
  const skillNames = [];
  const passthrough = [];

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!source && !a.startsWith('-')) { source = a; continue; }
    if (a === '--threshold') { threshold = args[++i]; if (!(threshold in LEVELS)) die(`bad --threshold ${threshold}`, 2); continue; }
    if (a === '--force') { force = true; continue; }
    if (a === '--dry-run') { dryRun = true; continue; }
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

  // ── INSTALL (SOP §16) ──
  if (dryRun) {
    console.log(`\nsafe-skills: DRY RUN — would run:\n  npx skills add ${source} ${installArgs.join(' ')}`);
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
  const r = sh(icmd, [...iprefix, 'skills', 'add', source, ...installArgs], { stdio: 'inherit' });
  if (r.status !== 0) {
    audit({ repository: metas[0].repo, skill: approved.map(i => metas[i].skill).join(','), scope: scope.toLowerCase(), commit, risk_score: reports[0].risk_assessment?.score, severity: reports[0].risk_assessment?.severity, finding_ids: approved.flatMap(i => issues[i].bySeverity.medium.concat(issues[i].bySeverity.high, issues[i].bySeverity.critical).map(f => f.id)), decision: 'install_failed', forced: force || anyBlockedApproved });
    process.exit(r.status);
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
