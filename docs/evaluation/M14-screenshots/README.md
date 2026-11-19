# M14 browser evidence

Captured in desktop Microsoft Edge 157.0.4341.60. Test Sources, Topics, operator labels, and records came from an isolated database, controlled fixtures, or explicitly labelled Playwright mocks.

| View | Evidence source |
| --- | --- |
| [01 Empty Normal catalog](01-normal-sources-empty.png) | Fresh, independently migrated PostgreSQL returned an empty array. |
| [02 Source Catalog](02-source-catalog.png) · [03 Registration](03-source-registration.png) | Isolated Core and controlled website fields. |
| [04 Pending](04-source-pending.png) · [05 Approved](05-source-approved.png) · [06 Revoked](06-source-revoked.png) | Actual Source and API results from manual actions. |
| [07 Profile Editor](07-profile-editor.png) · [08 Validation](08-profile-validation.png) · [09 Approval Review](09-profile-approval-review.png) · [10 Immutable Profile](10-profile-immutable.png) | Controlled HTML, saved versions, a validation report, and approval. |
| [11 Category and Topic](11-category-topic.png) · [12 No eligible binding](12-no-eligible-binding.png) · [13 Binding review](13-binding-approval.png) · [14 Bindings](14-bindings.png) | Actual categories, topics, version eligibility, and approval records. |
| [15 New Collection](15-new-collection.png) | Actual Topic deep link with two revalidated bindings selected. Capture taken before submission. |
| [16 Profile in mobile Dark](16-profile-mobile-dark.png) · [17 HTTP 503 recovery](17-source-recovery-503.png) | Playwright API mock. |
| [18 900px Dark](18-bindings-900-dark.png) · [19 768px System](19-bindings-768-system.png) · [20 390px Dark](20-bindings-390-dark.png) · [21 320px Light](21-bindings-320-light.png) | Playwright API mock. System used the dark media preference. |
| [22 Source 200%](22-source-edge-zoom-200.png) · [23 Binding 200%](23-binding-edge-zoom-200.png) · [24 Profile 200%](24-profile-edge-zoom-200.png) | Read-only browsing of the existing isolated Synthetic Demo. At native 200% Edge zoom, DPR was 2 and the viewport was 708 CSS px wide. Document width matched the viewport. |
