# Quick real website demo

This optional demo runs one bounded live collection against the public Welsh Government website. It reuses the normal platform and does not change the Synthetic Demo.

## Run it

On Windows 11 x64, with the normal platform prerequisites available, double-click:

```text
Start-Real-Website-Demo.bat
```

The launcher first starts Normal mode. It then uses the running API container to:

1. create or reuse **Quick Real Demo - Welsh Government**;
2. authorize only `https://www.gov.wales` with `/search` and `/written-statement-` path prefixes;
3. create or reuse a reviewed keyword-search Profile;
4. validate the Profile against the live publisher with keyword `inflation` before approving it;
5. create **Real Website Demo → Welsh Government Publications** and its binding;
6. submit a fresh live Collection Request;
7. wait for the Job to finish and open that Request in the Dashboard.

The Profile stores `title`, canonical `publication_url`, and optional `published_at`. It allows one detail page, three requests, no redirects, a 512,000-byte response cap, a five-second per-request timeout, a 25-second collection budget, one execution attempt and a two-second Source interval.

The permission reference is the Welsh Government copyright statement. This helper does not bypass robots, authentication, blocking, CAPTCHA, paywalls or any other access control.

## What to show

When the Request page opens:

1. show the Request status and its Welsh Government child Job;
2. open **View request records**;
3. inspect the accepted publication Record;
4. open **View capture evidence** and show the source URL, capture metadata and SHA-256;
5. return to the Request and download CSV or JSON.

Use **Sources** to show that the live Source and its approved Profile are normal Core objects, not Synthetic Demo fixtures.

## If it fails

This demo depends on a third-party live website. Publisher availability, robots policy, search markup, result ordering and response time can change. A failure is not automatically a Core failure.

Run `Diagnose-Platform.bat`, then inspect the Source, Profile validation result and Job error in the Dashboard. For a presentation where deterministic operation matters more than live access, use `Start-FYP-Demo.bat` instead.

Normal-mode data is retained after `Stop-Platform.bat`. Re-running `Start-Real-Website-Demo.bat` reuses the Source/Profile/Topic when their saved configuration still matches, but submits a new live Request.
