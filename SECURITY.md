# Security Policy

## Reporting a Vulnerability

We take the security of `safe-skills` seriously. Because `safe-skills` serves as an active security gate for executing third-party code and AI agent skills, security vulnerabilities in this repository are given top priority.

### Disclosure Process
If you discover a security vulnerability or a bypass in `safe-skills`:

1. **Do NOT create a public GitHub Issue.**
2. Please report the issue via GitHub's Private Security Advisory feature on this repository, or email the maintainer directly.
3. Include detailed steps to reproduce the issue, including target skill repositories, command flags used, and the environment details.

### Security Guarantees & Philosophy
- **Defense in Depth**: `safe-skills` clones untrusted skills into ephemeral isolated temporary directories before running any static or LLM scans.
- **Fail-Safe Defaults**: If a scanner fails or produces an unparseable output, `safe-skills` halts with a non-zero exit code and blocks installation.
- **Hard Block Policy**: Any detection of known Remote Code Execution (RCE), credential exfiltration, malware heuristics, or privilege escalation causes an immediate, non-overridable block unless explicitly forced by the user.
