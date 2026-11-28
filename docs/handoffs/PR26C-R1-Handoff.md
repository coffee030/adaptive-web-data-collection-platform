# PR26 Stage C correction R1 handoff

28 November 2026 · Ready for independent review

## Source identity and scope

| Item | Identity |
| --- | --- |
| Repository | `coffee030/adaptive-web-data-collection-platform` |
| Checkout | `C:/Users/noob/Downloads/ITE4116M_Final_Year_Project/Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch | `codex/pr26-research-clarity` |
| Starting and current HEAD | `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Accepted Stage B tree | `d2e3a01ba8c4a80b0a685dd1cc6f556ed95db352` |
| Reviewed Stage C tree | `45860fc67952c5268f9a9884082e6bba7713f3e9` |
| Original Stage C archive SHA-256 | `d7ebf31e713277e82eb754587113f8e219699984f663df0d30cfdad46f1daafe` |
| Migration head | `0034` |
| Corrected complete tree | `expected_git_tree` in the corrected ZIP manifest |

The starting working tree contained 20 tracked modifications and 21 untracked files. All 41 changed files matched the original Stage C archive byte for byte, with no additional changed paths. The reviewed tree was reconstructed from the original full patch. R1 adds two files and updates four Stage C files. The primary checkout stays on the original branch and HEAD without staging. Historical A, B and C handoffs retain their original bytes.

The independent Stage C review ZIP was unavailable in the local attachments and Downloads. Its stated SHA-256, `f4a1e23c1738ea9518cfc82c44f4e8480dc17d4c9fe41b715d810f96330f7f9b`, is an expected identity. The supplied goal records the required finding, and the original local browser independently reproduced it.

## Defect and corrected behavior

A saved campaign draft can pair an HKD evaluation with a USD scenario. It can also retain the USD scenario after losing its evaluation, in which case research derives the campaign from the brief and uses its existing HKD default. The original browser opened either valid draft, relabeled the inherited USD scenario as HKD and retained the same minor-unit values. The real preview accepted this silently altered brief and returned ready. The actual research contract already requires scenario and campaign currencies to agree inside a research brief. The generic saved campaign draft continues to allow independent currencies.

The corrected form shows **Review saved scenario currency** before preview and outside the optional section. It displays the saved ISO currency, current campaign currency, and original amounts for value per conversion, advertising spend and total campaign cost. The fallback case explains the HKD research default. Same-currency drafts open with their exact inherited amounts and existing provenance.

- **Use these same amounts in HKD** or the named campaign currency deliberately assigns that denomination to the displayed figures without currency conversion. The user can then edit the amounts. Explicit treatment of the scenario leaves inherited campaign currency and budget provenance intact.
- **Leave scenario out of this research** explicitly serializes `scenario: null`. The saved campaign and its scenario remain intact.
- **Restore saved USD assumptions** returns to the original read-only values and requires a new choice while the denominations differ. The old editable fields cannot carry forward prior amounts.
- Changing the campaign currency clears the budget for re-entry in the new denomination. It resets the scenario currency choice and invalidates the preview. On conflict the original saved budget remains visible in its original denomination. The currency and newly entered budget receive explicit provenance from those edits.

The form blocks unresolved currency at the preview control and at submission of the edit form. Inherited editable scenario inputs remount when the choice or denomination changes. Explicit omission skips FormData serialization. The form carries the previously supported `spend_minor` value as total cost through the existing input fallback, serializing it as `campaign_cost_minor`. Ordinary scenario edits invalidate review, and the replacement preview displays the actual server-returned denomination and monetary amounts.

The correction leaves the confirmed-v1 envelope, campaign association, returned proposal, fingerprint, and exact retry key behavior in place. Existing campaign research does not save the draft. Currency resolution, omission, restore, edits, preview and abandoning review make no campaign or run writes. Explicit confirmation still uses the returned preparation. No backend contract, migration, API, MCP, dependency, source presentation or history implementation changed.

## Changed files

- `frontend/src/features/marketing/ResearchCampaign.tsx` retains the source of the campaign currency in the saved brief seed.
- `frontend/src/features/marketing/ResearchBriefForm.tsx` gates preview, manages scenario choice and restoration, and protects the budget when its denomination changes.
- `frontend/src/features/marketing/ResearchScenarioCurrency.tsx` provides the accessible choice and original monetary context.
- `frontend/src/features/marketing/ResearchCriteriaReview.tsx` displays the server-returned denomination and amounts or omission.
- `frontend/tests/campaign-research.integration.ts` adds both mixed-currency cases and strengthens the matching-USD and legacy cost checks.
- `docs/handoffs/PR26C-R1-Handoff.md` records the correction.

## Verification

| Gate | Result | Boundary |
| --- | --- | --- |
| Original browser reproduction | Exit 0 · 2 passed, 0 skipped · 6.9 s | Assertions expected the defect. Authenticated FastAPI and isolated PostgreSQL returned ready with HKD and the original USD minor figures for both saved shapes. No research was confirmed. |
| Pilot TypeScript and Vite build | Exit 0 | Repository lockfile and installed dependencies. |
| Corrected research browser suites | Exit 0 · 13 passed, 0 skipped · 36.7 s | Real Chrome, saved campaign API, authenticated preview, explicit confirmed submission and PostgreSQL receipts. |
| Reconstruction | Both clean checkouts matched the corrected tree | Git whitespace, ZIP CRC, per-member SHA-256 and sizes, normalized source bytes and handoff byte equality checked. |

The maintained cases confirm blocked untouched preview, visible original USD values, keyboard activation, explicit resolution, invalidation from edits and currency changes, explicit omission after editable fields had held prior values, restore, legacy cost compatibility, and unchanged saved campaign records through the API. Each successful saved-campaign case confirmed the returned preparation and read back its one intended run. The existing suites also exercised standalone and prospective campaign association, duplicate-click protection and identical retry after a real write with a lost browser response.

Browser order delays and selected errors were controlled through Playwright routes. The historical findings presentation cases used controlled reports while exercising real receipts and relevant campaign actions. There were no blocked required gates. Live publishers, full deploy/Compose and standalone backend or MCP compatibility suites were outside the R1 rerun. The original Stage C handoff records the unaffected compatibility evidence.

Run from `frontend` with the pilot configuration used in the original handoff:

```powershell
npm run build
npm run test -- campaign-research.integration.ts research-preparation.integration.ts --workers=1
```

The test run used `HARBOURLINE_INSTALLATION=pilot`, `M4_REAL_API=1`, `HARBOURLINE_RESEARCH_TEST_PILOT=1`, `HARBOURLINE_SELF_REGISTRATION=1`, `PLAYWRIGHT_CHANNEL=chrome`, `M4_FRONTEND_PORT=5187`, and `API_PROXY_TARGET=http://127.0.0.1:18147`. The launcher checked the ports, used a dedicated `pr26c_r1_browser` database in the isolated local PostgreSQL cluster on 55439, ran `alembic upgrade head` and `alembic current`, and started `uvicorn backend.api.app:create_app --factory --host 127.0.0.1 --port 18147` with disposable pilot and partner credentials. Normal user data was outside this setup.

Runtime used Node 22.18.0, npm 10.9.3, TypeScript 7.0.2, Vite 8.3.8, Playwright 1.65.0, Chrome 158.0.8127.88, Python 3.12.16, FastAPI 0.162.7, Pydantic 2.14.3, SQLAlchemy 2.0.57, Alembic 1.20.1, Uvicorn 0.54.0, psycopg 3.3.9 and PostgreSQL 17.7.

## Review artifacts

The identical standalone `PR26C-R1-Handoff.md` and `PR26C_Corrected_Review_Package_R1.zip` are beside the checkout. The ZIP includes actual A/B/C/R1 changed source and fixture bytes, both patch routes, a correction inventory, a deletion list, instructions and the per-file manifest. The original browser reproduction test and its recorded outcome are under `verification/` and separate from the maintained corrected suite.

Stage C awaits independent acceptance. Stage D has not started. The work remains local.
