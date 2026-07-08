# ADR 0006: Typst Primary Renderer Target

## Status

Accepted target.

This ADR supersedes D-016 as an end-state target, but it does not switch the current runtime.

## Date

2026-07-08

## Context

The current delivery chain is Playwright / Chromium based and is already wired into validation, rendering, review images, delivery manifests, smoke tests, and answer evals.

The final product direction is an automatic solving workstation. That workstation needs a renderer contract that can support stable answer PDFs, review traceability, metadata, accessibility strategy, rollback, and renderer parity checks.

Typst is a strong target for the final primary renderer because official Typst documentation supports PDF export, PDF metadata, PDF/A, PDF/UA, and additional export formats including PNG, SVG, and HTML.

## Decision

Use Typst as the target primary renderer for the final refactor.

Keep Playwright / Chromium as the current runtime renderer until all parity gates pass. During migration, Chromium remains the fallback and comparison backend.

## Consequences

- The roadmap now distinguishes current renderer truth from final renderer target.
- `renderer-contract.schema.json` becomes the contract for both Chromium and Typst.
- Typst work must begin as an opt-in adapter and parity runner, not as a direct replacement.
- Documentation may say “Typst 主渲染目标”, but must not claim Typst is already the active runtime.

## Alternatives Considered

### Keep Chromium as permanent primary renderer

- Pros: Already works, integrated with review and smoke tests.
- Cons: Browser printing is less purpose-built for long-term document semantics, PDF standards, metadata and deterministic document layout.
- Rejected as final target, retained as current runtime and rollback backend.

### Switch immediately to Typst

- Pros: Faster route to target architecture.
- Cons: No adapter, no template, no parity data, no manifest integration, no review positioning proof.
- Rejected. It would break the repo truth boundary and increase delivery risk.

### Maintain equal dual primary renderers forever

- Pros: Maximum flexibility.
- Cons: Doubles validation and support burden, makes product status harder to explain.
- Rejected. Typst should become primary after gates pass; Chromium remains fallback.

## Rollback

If Typst parity fails or runtime reliability regresses, keep `renderer.engine=playwright_chromium` as the default and leave Typst behind an opt-in flag until the failing gate is repaired.
