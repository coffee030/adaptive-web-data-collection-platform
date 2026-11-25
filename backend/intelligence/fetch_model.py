"""Explicit operator command to download verified, pinned model artifacts."""

import argparse
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

from .semantic import ARTIFACTS, REPOSITORY, REVISION, verified


def fetch(directory: Path) -> None:
    for name, (size, _) in ARTIFACTS.items():
        destination = directory / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if verified(destination, name):
            continue
        url = f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}"
        with NamedTemporaryFile(dir=destination.parent, delete=False) as staging:
            pending = Path(staging.name)
        try:
            copied = 0
            with urlopen(url, timeout=60) as response, pending.open("wb") as output:
                if not response.url.startswith("https://"):
                    raise ValueError("Model download requires HTTPS")
                while chunk := response.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > size:
                        raise ValueError("Model file exceeded its pinned size")
                    output.write(chunk)
            if not verified(pending, name):
                raise ValueError(f"Model verification failed for {name}")
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    fetch(parser.parse_args().directory)
