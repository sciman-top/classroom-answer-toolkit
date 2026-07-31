from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parents[1]
CANONICAL_ROOT = REPO_ROOT / "eval" / "visual-page-normalization" / "cases"
UPSTREAM_SOURCE = REPO_ROOT / "eval" / "visual-preprocessing" / "cases" / "junior-readable-measurement.source.png"
UPSTREAM_SOURCE_SHA256 = "58115ee4199983e2db264d5c23f26999454c2fc80203e619710a9e34ce5e4c89"
CAPTURE_NAME = "junior-readable-measurement.capture.png"
REQUEST_NAME = "junior-readable-measurement.visual-page-normalization-request.json"
NORMALIZED_NAME = "junior-readable-measurement.normalized.png"
RESULT_NAME = "junior-readable-measurement.visual-page-normalization-result.json"
CAPTURE_SIZE = (720, 540)
TARGET_SIZE = (560, 360)
CAPTURE_QUAD = np.float32([[70, 85], [650, 55], [670, 470], [50, 490]])
GENERATED_AT = "2026-07-30T06:00:00Z"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def encode_png(array: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(
        buffer, format="PNG", optimize=False, compress_level=9
    )
    return buffer.getvalue()


def decode_png(data: bytes, label: str) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG":
                raise ValueError(f"{label} must be PNG.")
            return np.asarray(image.convert("RGB"), dtype=np.uint8)
    except (OSError, ValueError) as error:
        raise ValueError(f"{label} could not be decoded: {error}") from error


def pixel_sha256(array: np.ndarray) -> str:
    return sha256_bytes(np.ascontiguousarray(array, dtype=np.uint8).tobytes())


def render_synthetic_capture() -> bytes:
    upstream_bytes = UPSTREAM_SOURCE.read_bytes()
    if sha256_bytes(upstream_bytes) != UPSTREAM_SOURCE_SHA256:
        raise ValueError("VISION-007 upstream source bytes drifted.")
    source = Image.open(io.BytesIO(upstream_bytes)).convert("RGB")
    page = Image.new("RGB", TARGET_SIZE, "white")
    enlarged = source.resize((480, 288), Image.Resampling.NEAREST)
    page.paste(enlarged, (40, 36))
    ImageDraw.Draw(page).rectangle((1, 1, TARGET_SIZE[0] - 2, TARGET_SIZE[1] - 2), outline="black", width=4)
    page_array = np.asarray(page, dtype=np.uint8)

    canvas = np.full((CAPTURE_SIZE[1], CAPTURE_SIZE[0], 3), 72, dtype=np.uint8)
    source_quad = np.float32([[0, 0], [TARGET_SIZE[0] - 1, 0], [TARGET_SIZE[0] - 1, TARGET_SIZE[1] - 1], [0, TARGET_SIZE[1] - 1]])
    transform = cv2.getPerspectiveTransform(source_quad, CAPTURE_QUAD)
    warped = cv2.warpPerspective(page_array, transform, CAPTURE_SIZE, flags=cv2.INTER_LINEAR, borderValue=(72, 72, 72))
    mask = cv2.warpPerspective(np.full(TARGET_SIZE[::-1], 255, dtype=np.uint8), transform, CAPTURE_SIZE)
    canvas[mask > 0] = warped[mask > 0]
    rng = np.random.default_rng(20260730)
    noise = rng.normal(0, 3, canvas.shape).round().astype(np.int16)
    canvas = np.clip(canvas.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return encode_png(canvas)


def build_request(capture_bytes: bytes) -> dict[str, Any]:
    capture = decode_png(capture_bytes, CAPTURE_NAME)
    return {
        "schemaVersion": "1.0",
        "kind": "visual-page-normalization-request",
        "requestId": "junior-readable-measurement-page-normalization",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "capture": {
            "artifactRef": CAPTURE_NAME,
            "mediaType": "image/png",
            "rawByteSha256": sha256_bytes(capture_bytes),
            "decodedRgbPixelSha256": pixel_sha256(capture),
            "pixelSize": {"width": CAPTURE_SIZE[0], "height": CAPTURE_SIZE[1]},
        },
        "targetPixelSize": {"width": TARGET_SIZE[0], "height": TARGET_SIZE[1]},
        "policy": {
            "pageDetection": "largest_external_quadrilateral",
            "minimumPageAreaRatio": 0.25,
            "denoise": "median_3",
            "outputInterpolation": "linear",
        },
        "egressPolicy": {"allowCloud": False},
        "requestedAt": GENERATED_AT,
    }


def require_exact(value: dict[str, Any], keys: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{label} fields drifted.")


def validate_request(request: dict[str, Any]) -> None:
    require_exact(request, {
        "schemaVersion", "kind", "requestId", "subjectPack", "fixtureKind", "dataClassification",
        "capture", "targetPixelSize", "policy", "egressPolicy", "requestedAt"
    }, "VisualPageNormalizationRequest")
    if request.get("schemaVersion") != "1.0" or request.get("kind") != "visual-page-normalization-request":
        raise ValueError("VisualPageNormalizationRequest identity drifted.")
    if request.get("requestId") != "junior-readable-measurement-page-normalization" \
            or request.get("subjectPack") != "junior-physics-answer" \
            or request.get("fixtureKind") != "synthetic_fixture":
        raise ValueError("VisualPageNormalizationRequest fixture identity drifted.")
    if request.get("dataClassification") != {"level": "public", "containsPersonalData": False}:
        raise ValueError("VisualPageNormalizationRequest data classification drifted.")
    require_exact(request["capture"], {
        "artifactRef", "mediaType", "rawByteSha256", "decodedRgbPixelSha256", "pixelSize"
    }, "capture")
    if request["capture"]["artifactRef"] != CAPTURE_NAME or request["capture"]["mediaType"] != "image/png":
        raise ValueError("VisualPageNormalizationRequest capture reference drifted.")
    if request["capture"]["pixelSize"] != {"width": CAPTURE_SIZE[0], "height": CAPTURE_SIZE[1]}:
        raise ValueError("VisualPageNormalizationRequest capture dimensions drifted.")
    if request.get("targetPixelSize") != {"width": TARGET_SIZE[0], "height": TARGET_SIZE[1]}:
        raise ValueError("VisualPageNormalizationRequest target dimensions drifted.")
    expected_policy = {
        "pageDetection": "largest_external_quadrilateral", "minimumPageAreaRatio": 0.25,
        "denoise": "median_3", "outputInterpolation": "linear"
    }
    if request.get("policy") != expected_policy or request.get("egressPolicy") != {"allowCloud": False}:
        raise ValueError("VisualPageNormalizationRequest policy drifted.")


def order_quad(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(differences)]
    ordered[3] = points[np.argmax(differences)]
    return ordered


def detect_page_quadrilateral(capture: np.ndarray, minimum_area_ratio: float = 0.25) -> tuple[np.ndarray, float]:
    gray = cv2.cvtColor(capture, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(blurred, 130, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8), iterations=2)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = capture.shape[0] * capture.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area_ratio = cv2.contourArea(contour) / image_area
        if area_ratio < minimum_area_ratio:
            break
        perimeter = cv2.arcLength(contour, True)
        approximation = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approximation) == 4 and cv2.isContourConvex(approximation):
            return order_quad(approximation[:, 0, :]), round(area_ratio, 6)
    raise ValueError("No admitted page quadrilateral was detected.")


def compile_request(request_path: Path, fixture_root: Path = CANONICAL_ROOT) -> tuple[dict[str, Any], bytes]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical page-normalization request is admitted.")
    request_bytes = request_path.read_bytes()
    request = json.loads(request_bytes.decode("utf-8-sig"))
    validate_request(request)
    capture_path = (fixture_root / request["capture"]["artifactRef"]).resolve(strict=True)
    if capture_path.parent != fixture_root:
        raise ValueError("Capture must resolve inside canonical fixture authority.")
    capture_bytes = capture_path.read_bytes()
    capture = decode_png(capture_bytes, "capture")
    if sha256_bytes(capture_bytes) != request["capture"]["rawByteSha256"] \
            or pixel_sha256(capture) != request["capture"]["decodedRgbPixelSha256"]:
        raise ValueError("Capture authority bytes drifted.")

    quad, area_ratio = detect_page_quadrilateral(capture, request["policy"]["minimumPageAreaRatio"])
    destination = np.float32([[0, 0], [TARGET_SIZE[0] - 1, 0], [TARGET_SIZE[0] - 1, TARGET_SIZE[1] - 1], [0, TARGET_SIZE[1] - 1]])
    transform = cv2.getPerspectiveTransform(quad, destination)
    normalized = cv2.warpPerspective(capture, transform, TARGET_SIZE, flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    normalized = cv2.medianBlur(normalized, 3)
    normalized_bytes = encode_png(normalized)
    orientation = round(math.degrees(math.atan2(float(quad[1][1] - quad[0][1]), float(quad[1][0] - quad[0][0]))), 6)
    result = {
        "schemaVersion": "1.0", "kind": "visual-page-normalization-result",
        "requestId": request["requestId"], "subjectPack": request["subjectPack"],
        "fixtureKind": "synthetic_fixture", "sourceRequestSha256": sha256_bytes(request_bytes),
        "capture": {
            "artifactRef": CAPTURE_NAME, "rawByteSha256": sha256_bytes(capture_bytes),
            "decodedRgbPixelSha256": pixel_sha256(capture),
            "pixelSize": {"width": CAPTURE_SIZE[0], "height": CAPTURE_SIZE[1]},
        },
        "pageDetection": {
            "status": "detected",
            "quadrilateral": [{"x": round(float(point[0]), 3), "y": round(float(point[1]), 3)} for point in quad],
            "areaRatio": area_ratio, "orientationDegrees": orientation,
        },
        "corrections": {
            "orientationDegrees": orientation, "deskewApplied": True, "denoiseApplied": True,
            "trimApplied": True, "perspectiveCorrectionApplied": True,
        },
        "normalizedPage": {
            "schemaVersion": "1.0", "kind": "normalized-page",
            "pageId": "junior-readable-measurement-normalized-page-1",
            "sourceDocument": CAPTURE_NAME, "sourceKind": "image", "pageNumber": 1,
            "imagePath": NORMALIZED_NAME,
            "pixelSize": {"width": TARGET_SIZE[0], "height": TARGET_SIZE[1]}, "dpi": 96,
            "renderScales": [1],
            "preprocessing": {
                "orientationDegrees": orientation, "deskewApplied": True, "denoiseApplied": True,
                "trimApplied": True, "perspectiveCorrectionApplied": True,
            },
            "regionRefs": [], "qualityFlags": ["rotated"], "generatedAt": GENERATED_AT,
        },
        "normalizedArtifact": {
            "artifactRef": NORMALIZED_NAME, "rawByteSha256": sha256_bytes(normalized_bytes),
            "decodedRgbPixelSha256": pixel_sha256(normalized),
            "pixelSize": {"width": TARGET_SIZE[0], "height": TARGET_SIZE[1]},
        },
        "engineProvenance": {
            "engineKind": "local_runtime", "engineId": "deterministic-visual-page-normalizer",
            "engineVersion": "1.0.0",
            "components": [{"name": "opencv", "version": cv2.__version__}, {"name": "pillow", "version": Image.__version__}],
            "fixtureSourceRef": "eval/visual-preprocessing/cases/junior-readable-measurement.source.png",
            "fixtureSourceSha256": UPSTREAM_SOURCE_SHA256, "liveProvider": False, "cloudEgress": False,
        },
        "dispositions": {
            "scope": "public_synthetic_page_normalization", "requiresHumanReview": True,
            "acceptanceDisposition": "not_accepted", "controlsDisposition": "not_verified",
            "eligible": False, "optimizationCandidateRefs": [],
        },
        "generatedAt": GENERATED_AT,
    }
    return result, normalized_bytes


def canonical_artifacts() -> dict[str, bytes]:
    capture_bytes = render_synthetic_capture()
    request = build_request(capture_bytes)
    request_bytes = stable_json_bytes(request)
    with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-") as directory:
        root = Path(directory)
        (root / CAPTURE_NAME).write_bytes(capture_bytes)
        (root / REQUEST_NAME).write_bytes(request_bytes)
        result, normalized_bytes = compile_request(root / REQUEST_NAME, root)
    return {
        CAPTURE_NAME: capture_bytes, REQUEST_NAME: request_bytes,
        NORMALIZED_NAME: normalized_bytes, RESULT_NAME: stable_json_bytes(result),
    }


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def materialize_fixtures() -> int:
    artifacts = canonical_artifacts()
    CANONICAL_ROOT.mkdir(parents=True, exist_ok=True)
    for name, data in artifacts.items():
        atomic_write(CANONICAL_ROOT / name, data)
    return validate_fixtures()


def validate_fixtures() -> int:
    expected = canonical_artifacts()
    actual_names = sorted(path.name for path in CANONICAL_ROOT.iterdir() if path.is_file()) if CANONICAL_ROOT.exists() else []
    if actual_names != sorted(expected):
        raise ValueError("Canonical page-normalization fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    result, normalized = compile_request(CANONICAL_ROOT / REQUEST_NAME)
    if stable_json_bytes(result) != expected[RESULT_NAME] or normalized != expected[NORMALIZED_NAME]:
        raise ValueError("Canonical page-normalization replay drifted.")
    return 1


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    canonical_request = (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True)
    if request_path != canonical_request:
        raise ValueError("Only the canonical page-normalization request is admitted.")
    input_snapshots = {
        canonical_request: canonical_request.read_bytes(),
        (CANONICAL_ROOT / CAPTURE_NAME).resolve(strict=True):
            (CANONICAL_ROOT / CAPTURE_NAME).read_bytes(),
    }
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    parent = output_dir.parent
    if not parent.is_dir():
        raise ValueError("Runtime output parent must exist.")
    physical_parent = parent.resolve(strict=True)
    try:
        output_dir.relative_to(REPO_ROOT)
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    try:
        physical_parent.relative_to(REPO_ROOT.resolve(strict=True))
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    result, normalized = compile_request(request_path)
    result_bytes = stable_json_bytes(result)
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=parent))
    try:
        atomic_write(stage / NORMALIZED_NAME, normalized)
        atomic_write(stage / RESULT_NAME, result_bytes)
        if (stage / NORMALIZED_NAME).read_bytes() != normalized \
                or (stage / RESULT_NAME).read_bytes() != result_bytes:
            raise ValueError("Staged page-normalization output drifted before promotion.")
        for path, snapshot in input_snapshots.items():
            if path.read_bytes() != snapshot:
                raise ValueError("Canonical page-normalization input drifted during runtime execution.")
        os.replace(stage, output_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output_dir / RESULT_NAME


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deterministic visual page normalization runtime.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--request", type=Path)
    parser.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        print(f"Materialized and validated {materialize_fixtures()} synthetic page-normalization fixture.")
        return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} synthetic page-normalization fixture.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
