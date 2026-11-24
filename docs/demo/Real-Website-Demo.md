# Quick real website demo

This optional demo runs one bounded live collection against the public Welsh Government website. It reuses the normal platform and does not change the Synthetic Demo.

## Run it

On Windows 11 x64, with the normal platform prerequisites available, double-click:

```text
Start-Real-Website-Demo.bat
```

On the first run, the launcher keeps the two approval decisions separate:

1. it creates the Source as Pending and shows the exact origin, path prefixes and permission reference;
2. type `YES` only if you approve that Source scope;
3. it creates the reviewed Profile as Draft and validates it against the live publisher;
4. after validation passes, it shows the exact configuration hash and validation report ID;
5. type `APPROVE` only if you approve that exact validated Profile;
6. it creates **Real Website Demo → Welsh Government Publications**, binds the approved Profile, submits `Autumn Budget`, waits for the Job and opens the Request page.

Later runs reuse the already approved Source/Profile/Topic and submit a fresh live Request without repeating those approvals unless the saved state changed.

The Source is restricted to `https://www.gov.wales` with `/announcements/search` and the exact `/written-statement-implications-uk-autumn-budget` detail path, plus a two-second minimum request interval. The permission reference is the Welsh Government copyright statement.

The Profile stores `title`, canonical `publication_url`, and optional `published_at`. It allows one detail page, three requests, no redirects, a 512,000-byte response cap, a five-second per-request timeout, a 25-second collection budget and one execution attempt.

This helper does not bypass robots, authentication, blocking, CAPTCHA, paywalls or any other access control.

## What to show

When the Request page opens:

1. show the Request status and its Welsh Government child Job;
2. open **View request records**;
3. inspect the accepted publication Record;
4. open **View capture evidence** and show the source URL, capture metadata and SHA-256;
5. return to the Request and download CSV or JSON;
6. open **Sources** to show that the live Source and approved Profile are normal Core objects, not Synthetic Demo fixtures.

## If it fails

This demo depends on a third-party live website. Publisher availability, robots policy, search markup, result ordering and response time can change. A failure is not automatically a Core failure.

Run `Diagnose-Platform.bat`, then inspect the Source, Profile validation result and Job error in the Dashboard. For a presentation where deterministic operation matters more than live access, use `Start-FYP-Demo.bat` instead.

Normal-mode data is retained after `Stop-Platform.bat`. Re-running `Start-Real-Website-Demo.bat` reuses matching saved setup and submits a new live Request.
