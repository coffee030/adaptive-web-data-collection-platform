# FYP Development Instructions

- Use the current milestone's approved scope and record conflicts with the formal Proposal. Refer to `skills/AGENTS.md` for the existing project conventions and `skills/.agents/skills/` for task-specific guidance.
- Keep experiments in `backend/experiments/`. Use controlled fixtures and report actual commands, observed behavior, failed checks and unverified requirements.
- Keep Source authorization separate from human approval of extraction configurations. Validate destinations and stop on explicit blocking. Keep collection and ingestion generic, with evidence and provenance preserved.
- Use short-lived feature branches, keep runtime data and credentials out of Git, and record pending teammate review. Use Traditional Chinese for project explanations and English for code, identifiers and comments.

## Frontend design

- Read [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), and the existing FYP frontend skill for React UI work. Follow implemented API contracts and show unavailable states when functionality is pending.
- Use the project Impeccable skill selectively for design and review. Keep hooks and Live Mode subject to separate approval.
