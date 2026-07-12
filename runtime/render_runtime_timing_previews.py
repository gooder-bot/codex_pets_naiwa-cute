#!/usr/bin/env python3
"""Render pet-row GIFs with the exact frame durations used by the runtime patch."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def load_timings(path: Path) -> dict[str, list[int]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    timings = payload.get("runtimeTimingsMs", payload)
    if not isinstance(timings, dict):
        raise SystemExit("Timing JSON must contain a runtimeTimingsMs object")
    return {state: [int(value) for value in values] for state, values in timings.items()}


def load_frames(directory: Path, expected: int) -> list[Image.Image]:
    paths = sorted(directory.glob("*.png"))
    if len(paths) != expected:
        raise SystemExit(f"{directory} needs {expected} PNG frames, found {len(paths)}")
    frames: list[Image.Image] = []
    for path in paths:
        with Image.open(path) as image:
            frames.append(image.convert("RGBA"))
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames-root", required=True)
    parser.add_argument("--timings", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    frames_root = Path(args.frames_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    timings = load_timings(Path(args.timings).resolve())

    previews = []
    for state, durations in timings.items():
        frames = load_frames(frames_root / state, len(durations))
        output = output_dir / f"{state}.gif"
        frames[0].save(
            output,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            disposal=2,
            optimize=False,
        )
        previews.append(
            {
                "state": state,
                "frames": len(frames),
                "durationsMs": durations,
                "loopDurationMs": sum(durations),
                "path": str(output),
            }
        )

    report = {"ok": True, "previews": previews}
    (output_dir / "preview-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
