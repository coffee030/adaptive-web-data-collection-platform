# FYP Development Instructions

- Use the current milestone's approved scope and record conflicts with the formal Proposal. Refer to `skills/AGENTS.md` for the existing project conventions and `skills/.agents/skills/` for task-specific guidance.
- Use **Adaptive Scalable and Observable Web Data Collection Platform** as the formal FYP title. Keep the Core reusable across domains. It collects from approved inputs and produces validated Records with Evidence lineage and export support. The downstream industry application remains open. [System overview](docs/architecture/System-Overview.md)
- Keep experiments in `backend/experiments/`. Use controlled fixtures and report actual commands, observed behavior, failed checks and unverified requirements.
- Keep Source authorization separate from human approval of extraction configurations. Validate destinations and stop on explicit blocking. Keep collection and ingestion generic, with evidence and provenance preserved.
- Use short-lived feature branches, keep runtime data and credentials out of Git, and record pending teammate review.
- Use English for all project-authored FYP materials and deliverables, including UI copy, instructions, comments, reports, and presentation assets. Team members choose the language of their private conversations. Preserve source material, evidence, and multilingual test data as recorded.

## Frontend design

- Read [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), and the existing FYP frontend skill for React UI work. Follow implemented API contracts and show unavailable states when functionality is pending.
- Use the vendored [UI Slop v1.7](.agents/skills/ui-slop/SKILL.md) as the primary design and browser review skill. See [M11 decisions](docs/evaluation/M11-Frontend-Redesign-Decisions.md) for the pinned revision and shell decisions.
