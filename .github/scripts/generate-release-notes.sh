#!/usr/bin/env bash
#
# Generate user-friendly release notes from git commit history using Groq's
# LLM API. Outputs Markdown to stdout.
#
# Usage: generate-release-notes.sh [PREVIOUS_TAG] [CURRENT_TAG]
#
# Requires: GROQ_API_KEY env var, jq, curl
# Optional: GROQ_MODEL (default: llama-3.3-70b-versatile)
#
# Exits non-zero on any failure so the workflow can fall back to
# GitHub's auto-generated notes.

set -euo pipefail

PREVIOUS_TAG="${1:-}"
CURRENT_TAG="${2:-}"
GROQ_API_KEY="${GROQ_API_KEY:-}"
MODEL="${GROQ_MODEL:-llama-3.3-70b-versatile}"

if [ -z "$GROQ_API_KEY" ]; then
  echo "GROQ_API_KEY not set" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "jq not found" >&2
  exit 1
fi

# Collect commit messages between tags (or last 30 if no previous tag).
if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$CURRENT_TAG" ]; then
  RANGE="${PREVIOUS_TAG}..HEAD"
  COMMITS=$(git log --pretty=format:"- %s" "$RANGE" 2>/dev/null || git log --pretty=format:"- %s" -30)
else
  COMMITS=$(git log --pretty=format:"- %s" -30)
fi

if [ -z "$COMMITS" ]; then
  echo "No commits found" >&2
  exit 1
fi

read -r -d '' PROMPT <<EOF || true
You are a technical writer generating release notes for an open-source developer tool called "ClickLens" (a ClickHouse query analyzer and dashboard).

Below are the git commit messages since the last release. Write concise, user-friendly release notes in Markdown.

Rules:
- Group changes under headings: "New Features", "Improvements", "Bug Fixes", and "Performance" (omit empty sections).
- Use bullet points starting with a verb in present tense (e.g., "Add", "Fix", "Improve").
- Omit purely internal commits (refactoring, CI, dependency bumps, formatting) unless they have user-facing impact.
- Merge related commits into a single bullet.
- Keep the total under 400 words.
- Do not include a top-level heading; start directly with the first section heading.

Commit messages:
${COMMITS}
EOF

PAYLOAD=$(jq -n \
  --arg prompt "$PROMPT" \
  --arg model "$MODEL" \
  '{
    model: $model,
    messages: [{role: "user", content: $prompt}],
    temperature: 0.3,
    max_tokens: 1200
  }')

RESPONSE=$(curl -sf -X POST "https://api.groq.com/openai/v1/chat/completions" \
  -H "Authorization: Bearer ${GROQ_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

NOTES=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty')

if [ -z "$NOTES" ] || [ "$NOTES" = "null" ]; then
  echo "Groq returned empty response" >&2
  echo "Response: $RESPONSE" >&2
  exit 1
fi

echo "$NOTES"
