# M22C controlled onboarding pilot

Use the same reviewed product commit for both arms. The [original pilot checkpoint](M22C-Operator-Pilot.md) records the frozen study and prior technical rehearsal. For this release candidate, record the reviewed commit in `M22C_PRODUCT_SHA` before provisioning, and repeat the technical rehearsal on the actual pilot environment. Store results and raw artifacts under the private `.local/m22c` directory. Provisioning creates `onboarding-results.csv` from the [blank trial sheet](m22c-onboarding-results.csv).

## Operator cards

- **Manual.** Open the assigned Dashboard Source and permitted homepage. Use the browser and DOM inspector to choose the two detail links and map required Title (text) and Count (integer). In the Dashboard, choose keyword search and detail pages. Use the assigned keyword, one detail page, the card's request cap, two seconds per request and an empty next-link selector. Create the draft, preview, validate and explicitly approve the matching version. Signal the coordinator when approval is shown.
- **Assisted.** Use the same target, fields, limits and approval steps. Open **Get a profile suggestion**, enter the assigned homepage and keyword, and inspect the request outcome. You may request the permitted examples from the coordinator. Apply and edit the draft, or undo the suggestion. Preview and validate after corrections before explicitly approving and signaling the coordinator.

The runner opens only the current assignment. Use the [frozen assignment sheet](m22a-onboarding-trials.csv) for ordering and the [coordinator runbook](M22C-Coordinator-Runbook.md) for controlled fixture setup, automatic request and action capture, terminal approval adjudication and replay. Change only the result copy under `.local/m22c`. The 15-minute cap includes wait time, retries and fallback.

## Scoring and report template

Use the offline scorer to replay the final configuration. A complete score covers two expected detail links and four typed field values. Record wrong and missing links, unresolved fields, real configured-search results, unauthorized attempts, elapsed and waiting seconds, correction and retry counts, fallback reason and time, and failure reason. Keep a stable reference to the journal and approved version, revision, hash and validation report. Unobserved values stay blank. Record observed absence as zero.

Use one report section for setup and reviewed SHA, one row per trial with the arm, result and all measured values, a paired comparison with its limitations, and a section for failed or incomplete trials. Keep machine verification, human timing and reviewer approval distinct. With no human runs, report that timing and savings are unmeasured. Validate the CSV separately from the scorer and receipt audit.

```powershell
python -m backend.experiments.m22c_validate_trials .local/m22c/onboarding-results.csv
```

The release gate runs manual and assisted reference browser flows against real controlled fixtures and runs the scoring and cutoff regression tests. These functional checks do not measure a participant's speed.
