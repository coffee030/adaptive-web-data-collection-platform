from pathlib import Path
from shutil import copyfile
from subprocess import run
from tempfile import TemporaryDirectory


def check(ignore: Path, allowed: tuple[str, ...], excluded: tuple[str, ...]):
    absent = [name for name in allowed if not (ignore.parent / name).is_file()]
    if absent:
        raise SystemExit(f"{ignore}: required files missing from checkout: {absent}")

    with TemporaryDirectory() as temp:
        context = Path(temp) / "context"
        context.mkdir()
        copyfile(ignore, context / ".dockerignore")
        for name in (*allowed, *excluded):
            path = context / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Build context test fixture\n", encoding="utf-8")

        exported = Path(temp) / "exported"
        run(
            [
                "docker",
                "build",
                "--file",
                "-",
                "--output",
                f"type=local,dest={exported}",
                ".",
            ],
            cwd=context,
            input="FROM scratch\nCOPY . /context/\n",
            text=True,
            check=True,
            timeout=90,
        )
        selected = exported / "context"
        missing = [name for name in allowed if not (selected / name).is_file()]
        unexpected = [name for name in excluded if (selected / name).exists()]
        if missing or unexpected:
            raise SystemExit(
                f"{ignore}: missing {missing}, unexpectedly included {unexpected}"
            )


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    check(
        root / ".dockerignore",
        (
            "alembic.ini",
            "backend/requirements-runtime.txt",
            "backend/requirements-marketing-onnx.txt",
            "backend/api/app.py",
            "backend/intelligence/recommend.py",
            "backend/marketing/pipeline.py",
            "backend/trends/api.py",
            "backend/trends/google_cli.py",
            "backend/migrations/versions/0010_worker_attempt_identity.py",
            "backend/migrations/versions/0011_youtube_marketing_research.py",
            "backend/experiments/demo_provision.py",
            "backend/tests/m3_fixture_site.py",
            "backend/tests/fixtures/m0/table.html",
        ),
        (
            "backend/.env",
            "backend/core/.env.local",
            "backend/core/.venv/check.py",
            "backend/marketing/.env.local",
            "backend/marketing/provider-snapshot.json",
            "backend/intelligence/model.onnx",
            ".local/marketing-granite/tokenizer.json",
            "backend/experiments/private-export.csv",
            "backend/trends/capture.json",
            "backend/tests/marketing_worker.py",
            "backend/tests/.pytest_cache/sentinel",
        ),
    )
    check(
        root / "frontend/.dockerignore",
        (
            "index.html",
            "src/main.tsx",
            "src/assets/workspace-icon.png",
            "public/licenses/Geist.txt",
            "public/licenses/Tremor.txt",
        ),
        (
            "public/.env",
            "public/private-export.csv",
            "public/licenses/private-export.csv",
            "src/.env.local",
            "dist/index.html",
        ),
    )
    print(
        "PASS Docker build contexts retain required files and exclude private fixtures."
    )
