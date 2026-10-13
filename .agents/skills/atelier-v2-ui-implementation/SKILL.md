---
name: atelier-v2-ui-implementation
description: Implement and refine Atelier v2 interfaces while preserving existing features, roles, data flows, and approved desktop and mobile concepts.
---

# Atelier v2 UI implementation

Use this skill when editing Atelier v2 frontend code or connecting UI changes to existing product behavior.

## Before editing

- Read `docs/CURRENT_STATE.md` and `docs/V2_NEXT_IMPLEMENTATION.md`.
- Inspect the relevant routes, components, role checks, API calls, and data model before changing them.
- Work on v2 only. Preserve the existing architecture and current functions unless the user has approved a product change.
- Use the approved Atelier concepts as the visual reference.

## Interface behavior

- Keep forms compact: size fields to their contents, group related fields, and place the main action beside or below the form.
- Keep salon owners, salon employees, and independent masters within the permissions they already have.
- Preserve the unified portfolio publication flow, including a clear destination for a salon or a selected salon employee.
- Preserve the customer booking sequence: service → master → time → contact.
- Make mobile screens follow the same information hierarchy as desktop, with no horizontal page overflow and touch targets at least 44 px.
- For the shared works section, use a responsive Pinterest-like grid with four desktop columns and two mobile columns, author links, useful filters, and explicit pagination or “show more.”
- For the map, preserve the current provider and data flow unless a provider change is approved. Keep map points, result cards, and filters synchronized.

## Data and safety

- Follow the existing role checks and protect client and account information.
- Follow `lib/image-rules.json` for image uploads. Validate the uploaded image itself and preserve the saved image when a replacement fails.
- Do not add paid DaData autocomplete. Use the approved structured address flow, validate on save, and preserve confirmed address data if validation fails.
- Do not introduce mock business data into production flows.

## Verification and release

- Keep verification focused on the changed behavior. Avoid broad or repetitive test runs.
- Check that affected forms save and reload correctly and that role permissions still work.
- For booking changes, verify the service → master → time → contact flow.
- For map changes, verify that selecting filters updates both pins and results.
- Release only when the current task or an existing explicit instruction authorizes it; do not ship partial work.
- In the final update, state what changed and how it was checked. Do not claim a concept is implemented until the working UI confirms it.