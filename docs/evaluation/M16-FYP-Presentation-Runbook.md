# M16 FYP Presentation Runbook

## Before the demonstration

Use Windows 11, WSL2, Docker Desktop in Linux container mode, Node.js 22.13 or later, and a local browser. In the release candidate or accepted `main` checkout, double-click **Start-FYP-Demo.bat** in File Explorer. Read and confirm any installation or trust prompts. Wait for `Synthetic Demo is ready!`. The launcher verifies three persisted baselines before asking Windows to open the default browser. If a port is already in use, use the loopback URL the launcher prints. Relaunch the same checkout to continue with its persisted data.

| Preset | Keyword | Expected baseline |
| --- | --- | --- |
| Core Demonstration → Fixture Listings | `quick` | 2 Jobs, 2 Records, 4 Evidence captures |
| Marketing Intelligence → Influencer Advertising and Sponsorship | `partnership` | 2 Jobs, 8 Records, 12 captures |
| Financial Markets → Market News and Economic Updates | `market` | 2 Jobs, 8 Records, 12 captures |

The sources are bundled controlled fixtures. The marketing content is fictional. Price fields and exports carry the warning **SIMULATED DATA — NOT LIVE MARKET PRICES**. The three presets contain 6 Jobs, 18 Records or Observations, and 28 Evidence captures in total.

## Complete demonstration

1. In **Overview**, introduce Topics, recent Requests, child Jobs, and validated records. Select **New Collection**, expand **Core Demonstration**, and select **Fixture Listings** with both approved sources. Enter `quick`, select **Review collection**, verify the sources and Profile versions, and select **Start topic collection**.
2. After the Request is created, view **Child jobs**. Open **Job details** and inspect **Execution and dispatch** and **Execution events**. Wait for both Jobs to reach a terminal state. Return to the Request and select **View request records** and **Inspect Alpha**. Show the extracted payload, Job, pinned Source and Profile, and Evidence. Open Evidence to show the capture time, type, and SHA-256.
3. Return to the Record Inspector and open **Article history**. Show the Article identity, content version, and current observation. Return to the Request, select **Refresh collection**, and explain that every refresh adds a Request and observations. Identical content reuses the existing content version. Use the internal financial fixture revision to exercise a content change in a separate Demo. [Fixture revision](M10-Demo-Presets-and-Launcher.md#controlled-financial-refresh)
4. Download **CSV** and **JSON** from the completed Request. Both formats contain the accepted results for that Request. Downloading from a single Job limits the export to that Job. Explain that a running scope must finish before export. Partial completion can retain valid records.
5. To demonstrate an exception, run `detail404` under **Fixture Listings**. Expect two Partial Jobs that each retain Alpha. Open **Execution events** and **Capture evidence** to show the errors alongside valid evidence. Use a separate CSV test case to show how a nonnumeric value or missing required field ends up in **Quarantine**.
6. In **Operations → Sources**, demonstrate registration, Source authorisation, Draft configuration, saving, Preview, Validate, and explicit approval. In **Topics & bindings**, create a Category and Topic, approve a binding, and select **Continue to New Collection**. Use a separate empty Normal project for this demonstration, with its controlled fixture and manual approvals. [Windows Normal setup](../setup/Windows-One-Click-Setup.md)

## Stop and resume

Run `Stop-Platform.bat -Demo` in the same checkout. Reopen **Start-FYP-Demo.bat** and verify persistence with the same Request, Evidence reference, and attachment. Run `Diagnose-Platform.bat -Demo` to inspect the fixture, schema, API proxy, and baselines. If the deployment mode, database, or ports fail, follow the Windows error-code table. When needed, show M10's verified reliability results and actual Dispatcher and worker history during the live Demo. The final MVP acceptance report contains the full test details. [Windows launcher errors](../setup/Windows-One-Click-Setup.md#troubleshooting) [M10 reliability evidence](M10-Reliability-Evaluation.md) [Final MVP acceptance](M16-Final-MVP-Acceptance.md)
