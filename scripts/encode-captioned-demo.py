"""Compress a continuous captioned application recording and inspect every second.

Uses only the existing Playwright FFmpeg binary and Pillow. It does not launch
the app, load environment files, or call sponsors. Visual approval stays false
until a person inspects the generated frames/contact sheet.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT, APP_HEIGHT = 1440, 1080, 900
FPS = 12
MIN_SECONDS, MAX_SECONDS = 120, 180
DEFAULT_SOURCE = "docs/demo/payday-memory-submission-uncut.webm"
DEFAULT_OUTPUT = "docs/demo/payday-memory-submission.webm"
DEFAULT_METADATA = "docs/demo/captioned-recording.json"
DEFAULT_QA = ".data/submission-video-qa"


def local_path(value: str) -> Path:
    candidate = (ROOT / value).resolve()
    if not candidate.is_relative_to(ROOT):
        raise ValueError("Recording and output paths must stay inside this workspace.")
    return candidate


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def ffmpeg_path(value: str | None) -> Path:
    if value:
        return Path(value).resolve()
    return (
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "ms-playwright"
        / "ffmpeg-1013"
        / "ffmpeg-win64.exe"
    ).resolve()


def run_ffmpeg(binary: Path, arguments: list[str], *, inspect_only: bool = False) -> str:
    result = subprocess.run(
        [str(binary), "-hide_banner", *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        check=False,
    )
    diagnostics = result.stdout + result.stderr
    # `ffmpeg -i file` intentionally returns 1 because no output was selected.
    if result.returncode and not (inspect_only and "At least one output file" in diagnostics):
        raise RuntimeError(f"FFmpeg failed ({result.returncode}):\n{diagnostics[-6000:]}")
    return diagnostics


def parse_media(diagnostics: str) -> dict:
    duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", diagnostics)
    video = next(
        (line for line in diagnostics.splitlines() if re.search(r"Stream #.*Video:", line)),
        "",
    )
    dimensions = re.search(r"\b(\d{2,5})x(\d{2,5})\b", video)
    fps = re.search(r"\b(\d+(?:\.\d+)?) fps\b", video)
    codec = re.search(r"Video:\s*([^,\s]+)", video)
    if not duration or not dimensions or not codec:
        raise ValueError("FFmpeg did not report a finite duration and video dimensions.")
    return {
        "durationSeconds": round(
            int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3]), 3
        ),
        "width": int(dimensions[1]),
        "height": int(dimensions[2]),
        "fps": float(fps[1]) if fps else None,
        "codec": codec[1],
        "audio": bool(re.search(r"Stream #.*Audio:", diagnostics)),
    }


def inspect_media(binary: Path, file: Path) -> dict:
    return parse_media(run_ffmpeg(binary, ["-i", str(file)], inspect_only=True))


def validate_media(media: dict, *, source_duration: float | None = None) -> None:
    if (media["width"], media["height"]) != (WIDTH, HEIGHT):
        raise ValueError(f"Expected {WIDTH}x{HEIGHT}; received {media['width']}x{media['height']}.")
    if not MIN_SECONDS <= media["durationSeconds"] <= MAX_SECONDS:
        raise ValueError(f"The full recording must be {MIN_SECONDS}–{MAX_SECONDS} seconds.")
    if source_duration is not None:
        if media["codec"] != "vp9" or media["audio"]:
            raise ValueError("The presentation must be VP9 without an audio track.")
        if media["fps"] != FPS:
            raise ValueError(f"The presentation must have {FPS} frames per second.")
        if abs(media["durationSeconds"] - source_duration) > 0.15:
            raise ValueError("Encoded duration differs from the expected continuous segment by more than 0.15 seconds.")


def encode_arguments(source: Path, output: Path, crf: int, startup_seconds: float = 0) -> list[str]:
    # An explicitly reviewed opening delay may be removed. All subsequent
    # application actions remain continuous, without scaling or cropping.
    return [
        "-y", "-ss", str(startup_seconds), "-i", str(source), "-map", "0:v:0", "-an",
        "-r", str(FPS), "-c:v", "libvpx-vp9", "-b:v", "0",
        "-crf", str(crf), "-deadline", "good", "-cpu-used", "3",
        "-threads", "4", "-row-mt", "1", "-pix_fmt", "yuv420p",
        "-f", "webm", str(output),
    ]


def frame_metrics(frame: Image.Image) -> dict:
    if frame.size != (WIDTH, HEIGHT):
        return {"dimensions": list(frame.size), "passed": False, "reason": "wrong dimensions"}
    rgb = frame.convert("RGB")
    # Exclude the band border and outer edges so decorative rules alone cannot
    # make an otherwise blank caption band pass.
    caption = rgb.crop((32, APP_HEIGHT + 12, WIDTH - 32, HEIGHT - 12)).convert("L")
    histogram = caption.histogram()
    background = max(range(256), key=lambda level: histogram[level])
    contrast_pixels = sum(count for level, count in enumerate(histogram) if abs(level - background) >= 40)
    caption_fraction = contrast_pixels / (caption.width * caption.height)
    caption_ok = caption_fraction >= 0.0015

    # Detect the broad, near-neutral gray fill that corrupted the older recording.
    # This is a pixel heuristic, not a semantic verdict; legitimate overlays can
    # also be flagged and must be checked in the saved frame.
    upper_right = rgb.crop((int(WIDTH * 0.65), 40, WIDTH, APP_HEIGHT - 40))
    upper_right.thumbnail((126, 205), Image.Resampling.NEAREST)
    pixels = list(upper_right.getdata())
    gray = [
        pixel for pixel in pixels
        if max(pixel) - min(pixel) <= 10 and 75 <= sum(pixel) / 3 <= 210
    ]
    gray_fraction = len(gray) / len(pixels)
    gray_bins = Counter(tuple(channel // 8 for channel in pixel) for pixel in gray)
    dominant_gray_fraction = max(gray_bins.values(), default=0) / len(pixels)
    gray_ok = gray_fraction < 0.65 and dominant_gray_fraction < 0.55
    return {
        "dimensions": list(frame.size),
        "captionBand": {
            "backgroundLuminance": background,
            "contrastPixelFraction": round(caption_fraction, 6),
            "minimumContrastPixelFraction": 0.0015,
            "nonblank": caption_ok,
        },
        "upperRightAppRegion": {
            "grayPixelFraction": round(gray_fraction, 6),
            "dominantGrayFraction": round(dominant_gray_fraction, 6),
            "largeGrayFillDetected": not gray_ok,
        },
        "passed": caption_ok and gray_ok,
    }


def contact_sheet(frames: list[Path], times: list[int], destination: Path) -> None:
    tile_width, tile_height, label_height, columns = 480, 360, 32, 3
    sheet = Image.new("RGB", (tile_width * columns, (tile_height + label_height) * math.ceil(len(times) / columns)), "#e8e8e8")
    draw = ImageDraw.Draw(sheet)
    for position, second in enumerate(times):
        x = (position % columns) * tile_width
        y = (position // columns) * (tile_height + label_height)
        with Image.open(frames[min(second, len(frames) - 1)]) as frame:
            sheet.paste(frame.convert("RGB").resize((tile_width, tile_height), Image.Resampling.LANCZOS), (x, y + label_height))
        draw.text((x + 10, y + 8), f"{second // 60:02}:{second % 60:02} — full recorded frame", fill="#111111")
    sheet.save(destination, quality=92)


def extract_and_check(binary: Path, video: Path, directory: Path, media: dict, key_times: str) -> dict:
    directory.mkdir(parents=True, exist_ok=False)
    # Playwright's minimal FFmpeg has no fps filter. Output frame-rate conversion
    # uses the real presentation timestamps and keeps the complete duration.
    run_ffmpeg(binary, ["-i", str(video), "-r", "1", "-frames:v", str(math.ceil(media["durationSeconds"])), "-c:v", "png", "-f", "image2", str(directory / "frame-%03d.png")])
    frames = sorted(directory.glob("frame-*.png"))
    if not frames or abs(len(frames) - media["durationSeconds"]) > 1.1:
        raise ValueError("Per-second extraction did not cover the complete recording.")
    checks = []
    for second, file in enumerate(frames):
        with Image.open(file) as frame:
            checks.append({"second": second, "file": relative(file), **frame_metrics(frame)})
    times = sorted({0, len(frames) - 1, *[max(0, min(len(frames) - 1, int(value))) for value in key_times.split(",") if value.strip()]})
    sheet = directory / "contact-sheet.jpg"
    contact_sheet(frames, times, sheet)
    failed = [item["second"] for item in checks if not item["passed"]]
    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "video": relative(video),
        "dimensions": [media["width"], media["height"]],
        "durationSeconds": media["durationSeconds"],
        "sampleIntervalSeconds": 1,
        "checkedFrameCount": len(frames),
        "failedSeconds": failed,
        "automatedQaPassed": not failed,
        "visualReviewVerified": False,
        "limitations": "Pixel checks detect blank caption bands and large gray fills; a person must review text, content, clipping and transitions. PNGs are representative frames sampled at one per second.",
        "contactSheet": relative(sheet),
        "contactSheetSeconds": times,
        "frames": checks,
    }
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def self_test() -> None:
    diagnostics = "Duration: 00:02:46.08, start: 0.000000\n  Stream #0:0: Video: vp9, yuv420p, 1440x1080, 12 fps, 12 tbr\nAt least one output file must be specified"
    media = parse_media(diagnostics)
    validate_media(media, source_duration=166.04)
    assert media["durationSeconds"] == 166.08 and not media["audio"]
    blank = Image.new("RGB", (WIDTH, HEIGHT), "#f6f6ee")
    ImageDraw.Draw(blank).rectangle((0, APP_HEIGHT, WIDTH, HEIGHT), fill="#123e34")
    assert not frame_metrics(blank)["captionBand"]["nonblank"]
    readable = blank.copy()
    ImageDraw.Draw(readable).text((80, 940), "Fictional sample. Captured Mainnet evidence from 8 November.", fill="white", font_size=32)
    assert frame_metrics(readable)["passed"]
    broken = readable.copy()
    ImageDraw.Draw(broken).rectangle((int(WIDTH * 0.65), 40, WIDTH, APP_HEIGHT - 40), fill="#808080")
    assert frame_metrics(broken)["upperRightAppRegion"]["largeGrayFillDetected"]
    assert not frame_metrics(broken)["passed"]
    try:
        validate_media({**media, "durationSeconds": 181})
    except ValueError:
        pass
    else:
        raise AssertionError("An overlong recording must fail validation.")
    print(json.dumps({"selfTest": "passed", "filesWritten": 0, "providerCalls": 0}))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--metadata", default=DEFAULT_METADATA)
    parser.add_argument("--qa-directory", default=DEFAULT_QA)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--crf", type=int, choices=range(28, 31), default=29)
    parser.add_argument("--startup-seconds", type=float, default=0,
                        help="Remove only a visually reviewed opening delay; the uncut source is preserved.")
    parser.add_argument("--key-times", default="0,12,28,44,60,76,92,108,124,140,156")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--qa-only", action="store_true",
                        help="Validate and inspect an existing encoded output without re-encoding it.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.startup_seconds <= 15:
        raise ValueError("The reviewed startup delay must be between 0 and 15 seconds.")
    if args.self_test:
        self_test()
        return 0
    source, output, metadata_file, qa_root = map(local_path, (args.source, args.output, args.metadata, args.qa_directory))
    binary = ffmpeg_path(args.ffmpeg)
    temporary_output = output.with_name(output.stem + ".encoding.webm")
    if args.dry_run:
        print(json.dumps({
            "dryRun": True, "sourceExists": source.is_file(), "ffmpegExists": binary.is_file(),
            "expectedDimensions": [WIDTH, HEIGHT], "allowedDurationSeconds": [MIN_SECONDS, MAX_SECONDS],
            "trimSeconds": args.startup_seconds, "fps": FPS, "crf": args.crf, "audio": False,
            "command": [str(binary), "-hide_banner", *encode_arguments(source, temporary_output, args.crf, args.startup_seconds)],
            "output": relative(output), "metadata": relative(metadata_file), "qaRoot": relative(qa_root),
            "filesWritten": 0, "providerCalls": 0,
        }, indent=2))
        return 0
    if not binary.is_file():
        raise FileNotFoundError("Existing Playwright FFmpeg was not found; no download is attempted.")
    if not source.is_file() or not metadata_file.is_file():
        raise FileNotFoundError("Complete the raw recording and recording metadata before encoding.")
    if source == output or source == temporary_output:
        raise ValueError("The output must differ from the original recording.")
    if (output.exists() or temporary_output.exists()) and not (args.overwrite or args.qa_only):
        raise FileExistsError("Presentation output already exists; select a new output or use --overwrite.")
    metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
    if metadata.get("completed") is not True or metadata.get("consoleErrors"):
        raise ValueError("The recording metadata must report successful completion without console errors.")
    source_media = inspect_media(binary, source)
    validate_media(source_media)
    if args.qa_only:
        print(json.dumps({"phase": "verifying-existing-encode", "output": relative(output)}), flush=True)
        encoded_media = inspect_media(binary, output)
        validate_media(encoded_media, source_duration=source_media["durationSeconds"] - args.startup_seconds)
    else:
        print(json.dumps({"phase": "encoding", "source": relative(source), **source_media}), flush=True)
        run_ffmpeg(binary, encode_arguments(source, temporary_output, args.crf, args.startup_seconds))
        encoded_media = inspect_media(binary, temporary_output)
        validate_media(encoded_media, source_duration=source_media["durationSeconds"] - args.startup_seconds)
        temporary_output.replace(output)
    run_name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
    qa_directory = qa_root / run_name
    print(json.dumps({"phase": "per-second-qa", "directory": relative(qa_directory)}), flush=True)
    report = extract_and_check(binary, output, qa_directory, encoded_media, args.key_times)
    metadata["presentation"] = {
        "file": relative(output), "sourceFile": relative(source),
        "sourceDurationSeconds": source_media["durationSeconds"], **encoded_media,
        "bytes": output.stat().st_size, "captionsEmbedded": True,
        "startupTrimSeconds": args.startup_seconds,
        "edits": f"Removed {args.startup_seconds:g} seconds of reviewed browser startup; compression and 12 fps conversion only thereafter. The application run is continuous without cropping or scaling. The uncut source is preserved.",
        "automatedQaPassed": report["automatedQaPassed"], "verified": False,
        "visualReviewVerified": False, "qaReport": relative(qa_directory / "report.json"),
        "contactSheet": report["contactSheet"],
    }
    metadata_file.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "phase": "complete", "output": relative(output), "bytes": output.stat().st_size,
        **encoded_media, "failedSeconds": report["failedSeconds"],
        "contactSheet": report["contactSheet"], "qaReport": relative(qa_directory / "report.json"),
        "visualReviewVerified": False,
    }, indent=2))
    return 0 if report["automatedQaPassed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
