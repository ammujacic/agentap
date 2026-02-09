#!/usr/bin/env bash
#
# Agentap PreToolUse hook — routes approval requests to the daemon.
# Respects Claude Code's permission_mode. Read-only tools are
# auto-approved immediately. If the daemon isn't running, falls
# back to "ask" (normal terminal prompt).
#

set -euo pipefail

PIDFILE="$HOME/.agentap/daemon.pid"
ALLOW='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
FALLBACK='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}'

# Read hook input from stdin
INPUT=$(cat)

# Extract fields from JSON input (lightweight grep-based parsing, no jq dependency)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
PERMISSION_MODE=$(echo "$INPUT" | grep -o '"permission_mode":"[^"]*"' | head -1 | cut -d'"' -f4)

# ── Permission mode fast paths ─────────────────────────
# bypassPermissions = user opted into full trust (YOLO mode)
# plan = read-only mode, agent shouldn't be writing but don't block if it does
if [ "$PERMISSION_MODE" = "bypassPermissions" ] || [ "$PERMISSION_MODE" = "plan" ]; then
  echo "$ALLOW"
  exit 0
fi

# acceptEdits = auto-approve file edits, still route Bash to daemon
if [ "$PERMISSION_MODE" = "acceptEdits" ]; then
  case "$TOOL_NAME" in
    Write|Edit|NotebookEdit)
      echo "$ALLOW"
      exit 0
      ;;
  esac
  # Bash and other tools fall through to daemon routing below
fi

# ── Read-only tool fast path ───────────────────────────
# Auto-approve tools that cannot modify the filesystem
case "$TOOL_NAME" in
  Read|Glob|Grep|WebSearch|WebFetch|Task|TodoRead|TodoWrite|AskUserQuestion)
    echo "$ALLOW"
    exit 0
    ;;
esac

# ── Read-only Bash command detection ──────────────────
# Auto-approve Bash commands composed entirely of read-only programs.
# Splits command on shell operators (|, &&, ||, ;) and checks every
# segment's first word against a safe list. Falls safe: if parsing
# fails or a segment is unrecognized, we skip to daemon routing.
if [ "$TOOL_NAME" = "Bash" ]; then
  COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('tool_input', {}).get('command', ''))" 2>/dev/null) || COMMAND=""

  if [ -n "$COMMAND" ]; then
    ALL_READONLY=true

    while IFS= read -r seg; do
      seg=$(echo "$seg" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      [ -z "$seg" ] && continue

      prog=$(echo "$seg" | awk '{print $1}')
      case "$prog" in
        cat|head|tail|less|more|ls|find|grep|rg|ack|ag|\
        wc|file|stat|du|df|which|whereis|type|\
        echo|printf|sort|uniq|tr|cut|diff|\
        column|fold|fmt|nl|strings|readlink|\
        basename|dirname|realpath|pwd|whoami|id|\
        date|env|printenv|uname|hostname|\
        true|false|test|jq|yq)
          ;;
        git)
          # Strip -C <path> flag to find actual subcommand
          sub=$(echo "$seg" | sed 's/ -C [^ ]*//g' | awk '{print $2}')
          case "$sub" in
            status|log|diff|show|branch|tag|remote|\
            rev-parse|ls-files|ls-tree|describe|\
            shortlog|config|stash)
              ;;
            *) ALL_READONLY=false ;;
          esac
          ;;
        npm|pnpm|yarn)
          sub=$(echo "$seg" | awk '{print $2}')
          case "$sub" in
            info|view|ls|list|why|show)
              ;;
            *) ALL_READONLY=false ;;
          esac
          ;;
        docker)
          sub=$(echo "$seg" | awk '{print $2}')
          # Handle "docker compose <cmd>" (two-word form)
          if [ "$sub" = "compose" ]; then
            sub=$(echo "$seg" | awk '{print $3}')
          fi
          case "$sub" in
            ps|images|logs|inspect|info|version|stats|top|port|events)
              ;;
            *) ALL_READONLY=false ;;
          esac
          ;;
        docker-compose)
          sub=$(echo "$seg" | awk '{print $2}')
          case "$sub" in
            ps|images|logs|inspect|info|version|stats|top|port|events)
              ;;
            *) ALL_READONLY=false ;;
          esac
          ;;
        *) ALL_READONLY=false ;;
      esac
    done < <(echo "$COMMAND" | awk -F'[|;&]+' '{for(i=1;i<=NF;i++) print $i}')

    if [ "$ALL_READONLY" = true ]; then
      echo "$ALLOW"
      exit 0
    fi
  fi
fi

# ── Route to daemon for mobile approval ────────────────
# Check if daemon is running
if [ ! -f "$PIDFILE" ]; then
  echo "$FALLBACK"
  exit 0
fi

PORT=$(head -1 "$PIDFILE" 2>/dev/null)
if [ -z "$PORT" ]; then
  echo "$FALLBACK"
  exit 0
fi

# POST to daemon and wait for approval decision (long-poll).
# --max-time matches the hook timeout minus a small buffer.
RESPONSE=$(curl -s --max-time 295 \
  -X POST "http://localhost:${PORT}/api/hooks/approve" \
  -H "Content-Type: application/json" \
  -d "$INPUT" 2>/dev/null) || true

if [ -z "$RESPONSE" ]; then
  # Daemon unreachable or timed out — fall back to terminal prompt
  echo "$FALLBACK"
  exit 0
fi

# Return daemon's response (contains hookSpecificOutput with permissionDecision)
echo "$RESPONSE"
exit 0
