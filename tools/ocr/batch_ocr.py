from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


@dataclass(frozen=True)
class OcrCandidate:
    mode: str
    image_path: Path
    items: list[dict]
    elapsed: list[float] | float | None

    @property
    def score(self) -> float:
        if not self.items:
            return 0.0

        confidences = [float(item["confidence"]) for item in self.items]
        average_confidence = sum(confidences) / len(confidences)
        text_chars = sum(len(item["text"]) for item in self.items)
        return average_confidence * math.log1p(len(self.items)) * math.log1p(text_chars)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch OCR rendered PDF page images with RapidOCR on CPU."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Image files or directories containing page images.",
    )
    parser.add_argument(
        "--out",
        help="Output directory. Defaults to <first input>/_rapidocr or ./_rapidocr.",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Search input directories recursively.",
    )
    parser.add_argument(
        "--preprocess",
        choices=["auto", "none", "clean"],
        default="auto",
        help="auto runs original and cleaned images then keeps the better score.",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.35,
        help="Drop OCR boxes below this confidence.",
    )
    parser.add_argument(
        "--keep-preprocessed",
        action="store_true",
        help="Keep cleaned page images even when the original image wins.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only OCR the first N images after sorting. 0 means no limit.",
    )
    return parser.parse_args()


def natural_key(path: Path) -> list[object]:
    parts = re.split(r"(\d+)", path.name.lower())
    return [int(part) if part.isdigit() else part for part in parts]


def collect_images(inputs: Sequence[str], recursive: bool, limit: int) -> list[Path]:
    images: list[Path] = []

    for raw_input in inputs:
      input_path = Path(raw_input).expanduser().resolve()
      if input_path.is_file() and input_path.suffix.lower() in IMAGE_EXTENSIONS:
          images.append(input_path)
          continue

      if input_path.is_dir():
          iterator = input_path.rglob("*") if recursive else input_path.glob("*")
          images.extend(
              item.resolve()
              for item in iterator
              if item.is_file() and item.suffix.lower() in IMAGE_EXTENSIONS
          )
          continue

      raise FileNotFoundError(f"No supported image input found: {input_path}")

    unique_images = sorted(set(images), key=natural_key)
    if limit > 0:
        return unique_images[:limit]

    return unique_images


def default_output_dir(first_input: str) -> Path:
    input_path = Path(first_input).expanduser().resolve()
    if input_path.is_dir():
        return input_path / "_rapidocr"

    return input_path.parent / "_rapidocr"


def read_image(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"OpenCV could not read image: {path}")
    return image


def write_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    success, buffer = cv2.imencode(path.suffix or ".png", image)
    if not success:
        raise ValueError(f"OpenCV could not encode image: {path}")
    buffer.tofile(str(path))


def rotate_bound(image: np.ndarray, angle: float) -> np.ndarray:
    height, width = image.shape[:2]
    center = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])

    new_width = int((height * sin) + (width * cos))
    new_height = int((height * cos) + (width * sin))
    matrix[0, 2] += (new_width / 2) - center[0]
    matrix[1, 2] += (new_height / 2) - center[1]

    return cv2.warpAffine(
        image,
        matrix,
        (new_width, new_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def deskew_if_needed(binary: np.ndarray, source: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(binary < 255))
    if coords.shape[0] < 300:
        return source

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    if abs(angle) < 0.25 or abs(angle) > 7:
        return source

    return rotate_bound(source, angle)


def clean_image(source: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    denoised = cv2.fastNlMeansDenoising(enhanced, h=9)
    binary = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        35,
        11,
    )
    deskewed = deskew_if_needed(binary, binary)
    return cv2.cvtColor(deskewed, cv2.COLOR_GRAY2BGR)


def normalize_ocr_items(raw_result: object, min_confidence: float) -> list[dict]:
    if raw_result is None:
        return []

    items = []
    for entry in raw_result:
        if not entry or len(entry) < 3:
            continue

        box, text, confidence = entry[0], str(entry[1]).strip(), float(entry[2])
        if not text or confidence < min_confidence:
            continue

        items.append(
            {
                "box": [[float(point[0]), float(point[1])] for point in box],
                "text": text,
                "confidence": confidence,
            }
        )

    items.sort(key=lambda item: (min(point[1] for point in item["box"]), min(point[0] for point in item["box"])))
    return items


def run_engine(engine: RapidOCR, image_path: Path, mode: str, min_confidence: float) -> OcrCandidate:
    raw_result, elapsed = engine(str(image_path))
    return OcrCandidate(
        mode=mode,
        image_path=image_path,
        items=normalize_ocr_items(raw_result, min_confidence),
        elapsed=elapsed,
    )


def page_text(items: Iterable[dict]) -> str:
    return "\n".join(str(item["text"]) for item in items).strip()


def ocr_one(
    engine: RapidOCR,
    image_path: Path,
    output_dir: Path,
    preprocess: str,
    min_confidence: float,
    keep_preprocessed: bool,
) -> dict:
    page_stem = image_path.stem
    preprocessed_dir = output_dir / "preprocessed"
    candidates = [run_engine(engine, image_path, "original", min_confidence)]
    clean_path: Path | None = None

    if preprocess in {"auto", "clean"}:
        source = read_image(image_path)
        cleaned = clean_image(source)
        clean_path = preprocessed_dir / f"{page_stem}.clean.png"
        write_image(clean_path, cleaned)
        candidates.append(run_engine(engine, clean_path, "clean", min_confidence))

    if preprocess == "clean":
        winner = candidates[-1]
    else:
        winner = max(candidates, key=lambda item: item.score)

    if clean_path and not keep_preprocessed and winner.image_path != clean_path:
        clean_path.unlink(missing_ok=True)

    text_dir = output_dir / "text"
    text_dir.mkdir(parents=True, exist_ok=True)
    text_path = text_dir / f"{page_stem}.txt"
    text_path.write_text(page_text(winner.items) + "\n", encoding="utf-8")

    return {
        "source_image": str(image_path),
        "selected_mode": winner.mode,
        "selected_score": winner.score,
        "text_path": str(text_path),
        "text": page_text(winner.items),
        "item_count": len(winner.items),
        "average_confidence": (
            sum(float(item["confidence"]) for item in winner.items) / len(winner.items)
            if winner.items
            else 0.0
        ),
        "elapsed": winner.elapsed,
        "items": winner.items,
        "candidates": [
            {
                "mode": candidate.mode,
                "image_path": str(candidate.image_path),
                "score": candidate.score,
                "item_count": len(candidate.items),
            }
            for candidate in candidates
        ],
    }


def write_outputs(output_dir: Path, results: list[dict], started_at: float, args: argparse.Namespace) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    jsonl_path = output_dir / "rapidocr.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for result in results:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsed_seconds": time.perf_counter() - started_at,
        "input_count": len(results),
        "preprocess": args.preprocess,
        "min_confidence": args.min_confidence,
        "results": results,
    }
    (output_dir / "rapidocr.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    markdown_lines = ["# RapidOCR 批量识别结果", ""]
    for index, result in enumerate(results, start=1):
        source_name = Path(result["source_image"]).name
        markdown_lines.extend(
            [
                f"## {index}. {source_name}",
                "",
                f"- 模式：{result['selected_mode']}",
                f"- 文本块：{result['item_count']}",
                f"- 平均置信度：{result['average_confidence']:.3f}",
                "",
                "```text",
                result["text"],
                "```",
                "",
            ]
        )

    (output_dir / "rapidocr.md").write_text("\n".join(markdown_lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    started_at = time.perf_counter()
    images = collect_images(args.inputs, args.recursive, args.limit)
    if not images:
        print("No supported images found.", file=sys.stderr)
        return 2

    output_dir = Path(args.out).expanduser().resolve() if args.out else default_output_dir(args.inputs[0])
    output_dir.mkdir(parents=True, exist_ok=True)

    engine = RapidOCR()
    results: list[dict] = []
    for index, image_path in enumerate(images, start=1):
        print(f"[{index}/{len(images)}] OCR {image_path.name}")
        results.append(
            ocr_one(
                engine=engine,
                image_path=image_path,
                output_dir=output_dir,
                preprocess=args.preprocess,
                min_confidence=args.min_confidence,
                keep_preprocessed=args.keep_preprocessed,
            )
        )

    write_outputs(output_dir, results, started_at, args)
    print(f"OCR complete: {len(results)} image(s)")
    print(f"Output: {output_dir}")
    print(f"Markdown: {output_dir / 'rapidocr.md'}")
    print(f"JSONL: {output_dir / 'rapidocr.jsonl'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
