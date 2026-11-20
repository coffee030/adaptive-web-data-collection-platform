# Physical 8 GB Windows acceptance

Run this on a physical Windows 11 x64 machine with about 8 GB installed RAM. Record the machine model, installed and usable RAM, OS build, Windows boot state, WSL and Docker versions, Docker disk location, and any existing cache or running workload. Record whether a restart, license acceptance or administrator consent was required.

1. Follow the [clean-checkout acceptance procedure](Clean-Checkout-Acceptance.md) with a fresh release ZIP. Verify that no Node.js, npm or Python installation is needed to launch Normal and Demo. Use a separate fresh evaluation checkout for the timed run.
2. Run `powershell.exe -NoProfile -File scripts/windows/Test-ReleaseAcceptance.ps1 -Physical8GB -NoCache`. Use the default Docker Desktop and WSL memory settings on the test machine. The script records elapsed milliseconds and samples project container CPU and memory while the Demo runs, exports and restarts. Docker base-image cache may remain.
3. Record free disk before and after, sampled peak memory by container and by workload phase, first build time, first successful Dashboard time, repeated Start and restart times. A sampled peak can miss a short allocation. Use Task Manager or Resource Monitor to record host memory pressure, paging or stalls. Record Docker OOM or restart observations, throughput issues and their stage. Keep the sanitized Diagnose report.
4. Verify that the browser remains usable during idle startup, collection, CSV export, JSON export and Evidence inspection. Compare the same Request, Jobs, Records, events, Evidence and exports after restart. Verify that the launcher stops its project cleanly. Record the result for each check and repeat any interrupted run from a new checkout.
5. Record the tester, release SHA and actual outcome for every step. Leave physical acceptance pending until this procedure runs on the specified hardware. Label VM, CI and other machine results as simulated or current-host evidence.

Keep `.local/release-acceptance` and `logs/launcher` private. Share a sanitized summary with the [release matrix](Final-Core-Readiness.md).
