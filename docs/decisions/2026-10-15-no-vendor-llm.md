# Bring your own agent — no LLM in the framework

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

Bundling an LLM ties the framework to a vendor, costs and credentials.

## Decision

casefile never calls an LLM. The user's agent (Claude Code, Codex, …) does all inference through skills and MCP. Zero credits, zero framework-side inference.

## Alternatives Considered

- **Built-in LLM client with pluggable providers** — convenient, but adds cost, keys and a second agent loop.

## Consequences

- All intelligence lives in skills (markdown) and SPECs; core stays deterministic and testable.
- Skills must treat repo/ticket text as data (prompt-injection guardrail).
