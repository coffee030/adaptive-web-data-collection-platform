from backend.experiments.marketing_m2 import harbourline_demo


def test_restart_preserves_withdrawn_fixtures_and_opens_empty_workspace(monkeypatch):
    monkeypatch.setenv("PLATFORM_SYNTHETIC_DEMO", "1")
    monkeypatch.setenv("MARKETING_DEMO_ENABLED", "1")
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", "fixture-only-withdrawn-dataset")
    seen = []

    def read(path, *, token=None):
        seen.append(path)
        if path.endswith("/processing"):
            return {"state": "empty", "eligible_datasets": 0, "indexed_datasets": 0}
        return {"state": "withdrawn", "record_count": 0}

    monkeypatch.setattr(harbourline_demo, "api", read)
    harbourline_demo.main()
    assert seen == [
        harbourline_demo.INTAKE + harbourline_demo.LIBRARY,
        harbourline_demo.INTAKE + harbourline_demo.BRIDGE,
        harbourline_demo.BASE + "/demo/processing",
    ]
