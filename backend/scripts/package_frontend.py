"""Copy a verified Next.js export into the backend's served static directory."""

from hashlib import sha256
from pathlib import Path
from shutil import copy2


def digest(path: Path) -> bytes:
    return sha256(path.read_bytes()).digest()


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    source = (root / "frontend" / "out").resolve()
    target = (root / "backend" / "static").resolve()
    if not source.is_relative_to(root) or not target.is_relative_to(root):
        raise RuntimeError("Static paths escaped the project")
    if not (source / "index.html").is_file() or not (source / "inventory.html").is_file():
        raise RuntimeError("Build the complete frontend export before packaging")

    files = {path.relative_to(source): path for path in source.rglob("*") if path.is_file()}
    old_files = {path.relative_to(target): path for path in target.rglob("*") if path.is_file()}
    if any(path.is_symlink() for path in (*files.values(), *old_files.values())):
        raise RuntimeError("Refusing to package through symbolic links")

    for relative, path in old_files.items():
        if relative not in files:
            if not path.resolve().is_relative_to(target):
                raise RuntimeError("Stale file escaped the static directory")
            path.unlink()
    for relative, path in files.items():
        destination = target / relative
        if not destination.resolve().is_relative_to(target):
            raise RuntimeError("Output file escaped the static directory")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or digest(path) != digest(destination):
            copy2(path, destination)
    if any(digest(path) != digest(target / relative) for relative, path in files.items()):
        raise RuntimeError("Packaged frontend does not match its source export")
    print(f"Packaged and verified {len(files)} frontend files")


if __name__ == "__main__":
    main()
