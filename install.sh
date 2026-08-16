#!/usr/bin/env bash
# ==============================================================================
# safe-skills Universal Installer
# Security gate for AI agent skills, powered by NVIDIA SkillSpector
# ==============================================================================

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
NC='\033[0m'

say() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
ok()  { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
warn(){ printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
err() { printf "${RED}[ERROR]${NC} %s\n" "$1"; }

echo -e "${PURPLE}================================================================${NC}"
echo -e "${BLUE}        🛡️  safe-skills Installation & Setup                   ${NC}"
echo -e "${PURPLE}================================================================${NC}\n"

# 1. Prerequisite checks
say "Checking prerequisites..."
for req in node git; do
  if ! command -v "$req" >/dev/null 2>&1; then
    err "Missing required runtime: $req. Please install it first."
    exit 1
  fi
done
ok "Core runtimes found (Node $(node -v), Git $(git --version))."

# 2. Check or install uv for Python tooling
if ! command -v uv >/dev/null 2>&1; then
  say "Installing Astral uv (Python package manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# 3. Install NVIDIA SkillSpector scanner
if ! command -v skillspector >/dev/null 2>&1; then
  say "Installing NVIDIA SkillSpector via uv tool..."
  uv tool install skillspector || uv pip install --system skillspector || true
fi

if command -v skillspector >/dev/null 2>&1; then
  ok "NVIDIA SkillSpector scanner ready ($(skillspector --version 2>/dev/null || echo 'installed'))."
else
  warn "SkillSpector was not found on PATH. safe-skills will fall back to static heuristics until installed."
fi

# 4. Clone or deploy safe-skills
INSTALL_DIR="$HOME/.local/share/safe-skills"
mkdir -p "$INSTALL_DIR" "$HOME/.local/bin" "$HOME/.config/safe-skills"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/safe-skills.js" ]]; then
  cp -r "$SCRIPT_DIR/"* "$INSTALL_DIR/" 2>/dev/null || true
else
  say "Downloading latest safe-skills release..."
  git clone --depth 1 https://github.com/your-username/safe-skills.git "$INSTALL_DIR" 2>/dev/null || (cd "$INSTALL_DIR" && git pull)
fi

# 5. Symlink binaries & allowlist
ln -sfn "$INSTALL_DIR/bin/safe-skills" "$HOME/.local/bin/safe-skills"
ln -sfn "$INSTALL_DIR/bin/skills" "$HOME/.local/bin/skills"
chmod +x "$INSTALL_DIR/bin/safe-skills" "$INSTALL_DIR/bin/skills"

if [[ ! -f "$HOME/.config/safe-skills/allowlist.toml" ]]; then
  cp "$INSTALL_DIR/allowlist.toml" "$HOME/.config/safe-skills/allowlist.toml" 2>/dev/null || true
  ok "Created default allowlist at ~/.config/safe-skills/allowlist.toml"
fi

echo -e "\n${GREEN}✨ safe-skills successfully installed!${NC}"
echo -e "You can now run: ${BLUE}skills add <repository>${NC} or ${BLUE}safe-skills add <repository>${NC}"
echo -e "Try a scan test: ${YELLOW}safe-skills add https://github.com/anthropics/anthropic-quickstarts --dry-run${NC}\n"
