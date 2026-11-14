# Adaptive Web Data Collection Platform

A local dashboard for turning HTML pages and CSV files into structured records. Define which fields to collect, test the rules on a sample, and run a collection job. The dashboard shows which records passed validation, what was rejected or counted as a duplicate, and where each accepted record came from.

This is a higher diploma final-year project. The current version runs on a trusted local machine and supports approved local HTML sources and allowlisted CSV inputs. The repository includes sample data for both. Public website collection is outside the current setup.

## Quick start on Windows

You’ll need Windows 11 with WSL 2, Docker Desktop running in Linux container mode, and Node.js 22.13 or later in the 22.x series.

```powershell
git clone https://github.com/coffee030/adaptive-web-data-collection-platform.git
cd adaptive-web-data-collection-platform
.\Setup-Platform.bat
```

To try the bundled examples, open `.local/launcher.env` after setup and set the following values. Keep the other settings as generated.

```dotenv
LAUNCHER_FIXTURE=1
LOCAL_PROFILE_APPROVAL=1
```

Run `.\Start-Platform.bat` and open the address printed by the launcher. The default is [http://127.0.0.1:5197](http://127.0.0.1:5197/). Run `.\Stop-Platform.bat` when you’re done. Your records and settings are kept for the next run.

## Run your first collection

1. In **Sources**, register a source and authorize it. Follow the [example data guide](docs/demo/M5.5-dashboard-demo-runbook.md) for the exact settings and sample input.
2. Create a profile for the source. A profile tells the platform which fields to extract and how to validate them. Preview the sample, run validation, and approve the profile.
3. Open **New Collection**, choose **HTML pages** or **CSV datasets**, select the approved source and profile, and click **Start Collection**.
4. Open **View job records** from the job page to inspect accepted records. Use **View quarantine** to see rejected rows and their validation errors. Open a record to see its source, profile version, and capture details.

The bundled HTML example produces two accepted records. The CSV example produces two accepted records, three invalid rows, and one duplicate.

## Documentation

- [Windows setup and troubleshooting](docs/setup/Windows-One-Click-Setup.md)
- [Example data and manual Docker Compose setup](docs/demo/M5.5-dashboard-demo-runbook.md)
- [Development and testing](docs/demo/M5-core-demo-runbook.md)
