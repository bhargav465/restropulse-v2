# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the RestroPulse codebase. ADRs document significant technical choices, the context behind them, the alternatives considered, and the consequences accepted.

## Format

Each ADR is a single markdown file named `NNNN-short-slug.md` where `NNNN` is a zero-padded sequence number. ADRs are immutable once accepted — superseding decisions get a new ADR that references the prior one in its Status block.

## Status values

- **Proposed** — under review, not yet adopted
- **Accepted** — adopted; implementation has begun or is complete
- **Superseded by NNNN** — replaced by a later ADR; do not follow
- **Deprecated** — no longer recommended; predates a replacement that has not yet been written

## Index

| ID | Title | Status |
|---|---|---|
| 0001 | [Content-Engine AI Framework + Current-Affairs RAG](0001-content-engine-ai-framework.md) | Accepted |

## Authoring guidelines

- Use plain ASCII (no emoji, per the project's "No Special Characters" rule)
- Cite primary sources for every claim about an external framework or API
- Keep the Decision section definitive — do not write "TBD"
- Include Revisit Triggers (or equivalent) so a future engineer knows when to re-evaluate the ADR
