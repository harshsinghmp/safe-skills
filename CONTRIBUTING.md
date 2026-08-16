# Contributing to `safe-skills`

Thank you for helping make AI agent skills safer for everyone!

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/safe-skills.git
   cd safe-skills
   ```

2. **Ensure prerequisites are installed:**
   * Node.js $\ge$ 18.0.0
   * Python 3 + `uv` (for NVIDIA SkillSpector)
   * Git

3. **Install NVIDIA SkillSpector locally:**
   ```bash
   uv tool install skillspector
   # Or: pip install skillspector
   ```

## Running Tests

`safe-skills` includes an end-to-end integration test suite that tests scanning, allowlist matching, threshold enforcement, multi-skill repositories, and installation gates without needing network requests:

```bash
npm test
# Or: bash test/run.sh
```

## Pull Request Guidelines

1. **Deterministic behavior**: Ensure any new scan heuristics or command flags include test coverage in `test/run.sh`.
2. **Zero Dependencies**: `safe-skills.js` is intentionally written in zero-dependency Node.js standard library to ensure instant boot times and zero supply-chain exposure. Do NOT introduce external npm runtime dependencies without consensus.
3. **Follow the SOP**: All security scores and risk levels must adhere to the standard 4-tier risk policy (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
