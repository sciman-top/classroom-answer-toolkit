from __future__ import annotations

import argparse
import hashlib
import io
import json
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
CANONICAL_ROOT = REPO_ROOT / "eval" / "visual-region-proposal" / "cases"
NORMALIZATION_ROOT = REPO_ROOT / "eval" / "visual-page-normalization" / "cases"
NORMALIZATION_RESULT_NAME = "junior-readable-measurement.visual-page-normalization-result.json"
NORMALIZED_ARTIFACT_NAME = "junior-readable-measurement.normalized.png"
NORMALIZATION_RESULT_REF = f"eval/visual-page-normalization/cases/{NORMALIZATION_RESULT_NAME}"
NORMALIZED_ARTIFACT_REF = f"eval/visual-page-normalization/cases/{NORMALIZED_ARTIFACT_NAME}"
NORMALIZATION_RESULT_SHA256 = "4aad1b3baee1d75340bfb200857946128dce4c8acbeba4118a69ffd11653f47f"
NORMALIZED_ARTIFACT_SHA256 = "1ae505c96799bd36f5b18bc02aea8ab2560890b3d27989c6282b94c2c5ca8dd8"
REQUEST_NAME = "junior-readable-measurement.visual-region-proposal-request.json"
RESULT_NAME = "junior-readable-measurement.visual-region-proposal-result.json"
OVERLAY_NAME = "junior-readable-measurement.visual-region-proposal-overlay.png"
TARGET_SIZE = (560, 360)
GENERATED_AT = "2026-07-31T06:00:00Z"
PROPOSAL_POLICY = {
    "foregroundThreshold": 180,
    "pageInset": 8,
    "morphologicalClose": {"kernelWidth": 3, "kernelHeight": 3},
    "connectivity": 8,
    "minimumForegroundArea": 20,
    "proposalPadding": 8,
    "maximumCandidateCount": 16,
    "ordering": "top_to_bottom_left_to_right",
}


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


def require_exact(value: dict[str, Any], keys: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{label} fields drifted.")


def load_normalization_authority() -> tuple[bytes, dict[str, Any], bytes, np.ndarray]:
    result_path = (NORMALIZATION_ROOT / NORMALIZATION_RESULT_NAME).resolve(strict=True)
    artifact_path = (NORMALIZATION_ROOT / NORMALIZED_ARTIFACT_NAME).resolve(strict=True)
    physical_root = NORMALIZATION_ROOT.resolve(strict=True)
    if result_path.parent != physical_root or artifact_path.parent != physical_root:
        raise ValueError("VISION-020 normalization authority escaped its canonical root.")
    result_bytes = result_path.read_bytes()
    artifact_bytes = artifact_path.read_bytes()
    if sha256_bytes(result_bytes) != NORMALIZATION_RESULT_SHA256:
        raise ValueError("VISION-020 normalization result bytes drifted.")
    if sha256_bytes(artifact_bytes) != NORMALIZED_ARTIFACT_SHA256:
        raise ValueError("VISION-020 normalized artifact bytes drifted.")
    result = json.loads(result_bytes.decode("utf-8-sig"))
    image = decode_png(artifact_bytes, "normalized artifact")
    if (
        result.get("kind") != "visual-page-normalization-result"
        or result.get("fixtureKind") != "synthetic_fixture"
        or result.get("normalizedPage", {}).get("pageId")
        != "junior-readable-measurement-normalized-page-1"
        or result.get("normalizedPage", {}).get("pixelSize")
        != {"width": TARGET_SIZE[0], "height": TARGET_SIZE[1]}
        or result.get("normalizedPage", {}).get("regionRefs") != []
        or result.get("normalizedArtifact", {}).get("artifactRef") != NORMALIZED_ARTIFACT_NAME
        or result.get("normalizedArtifact", {}).get("rawByteSha256") != NORMALIZED_ARTIFACT_SHA256
        or result.get("normalizedArtifact", {}).get("decodedRgbPixelSha256") != pixel_sha256(image)
        or result.get("dispositions", {}).get("controlsDisposition") != "not_verified"
        or result.get("dispositions", {}).get("eligible") is not False
    ):
        raise ValueError("VISION-020 normalized page authority drifted.")
    return result_bytes, result, artifact_bytes, image


def build_request(
    normalization_result_bytes: bytes,
    normalization_result: dict[str, Any],
    artifact_bytes: bytes,
    image: np.ndarray,
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-region-proposal-request",
        "requestId": "junior-readable-measurement-region-proposal",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "normalizationResult": {
            "artifactRef": NORMALIZATION_RESULT_REF,
            "rawByteSha256": sha256_bytes(normalization_result_bytes),
            "requestId": normalization_result["requestId"],
            "pageId": normalization_result["normalizedPage"]["pageId"],
        },
        "normalizedArtifact": {
            "artifactRef": NORMALIZED_ARTIFACT_REF,
            "rawByteSha256": sha256_bytes(artifact_bytes),
            "decodedRgbPixelSha256": pixel_sha256(image),
            "pixelSize": {"width": image.shape[1], "height": image.shape[0]},
        },
        "proposalPolicy": PROPOSAL_POLICY,
        "egressPolicy": {"allowCloud": False},
        "requestedAt": GENERATED_AT,
    }


def validate_request(
    request: dict[str, Any],
    normalization_result_bytes: bytes,
    normalization_result: dict[str, Any],
    artifact_bytes: bytes,
    image: np.ndarray,
) -> None:
    require_exact(
        request,
        {
            "schemaVersion", "kind", "requestId", "subjectPack", "fixtureKind",
            "dataClassification", "normalizationResult", "normalizedArtifact",
            "proposalPolicy", "egressPolicy", "requestedAt",
        },
        "VisualRegionProposalRequest",
    )
    if (
        request.get("schemaVersion") != "1.0"
        or request.get("kind") != "visual-region-proposal-request"
        or request.get("requestId") != "junior-readable-measurement-region-proposal"
        or request.get("subjectPack") != "junior-physics-answer"
        or request.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualRegionProposalRequest identity drifted.")
    if request.get("dataClassification") != {"level": "public", "containsPersonalData": False} \
            or request.get("egressPolicy") != {"allowCloud": False}:
        raise ValueError("VisualRegionProposalRequest local-only boundary drifted.")
    if request.get("proposalPolicy") != PROPOSAL_POLICY:
        raise ValueError("VisualRegionProposalRequest policy drifted.")
    expected = build_request(
        normalization_result_bytes, normalization_result, artifact_bytes, image
    )
    if request.get("normalizationResult") != expected["normalizationResult"]:
        raise ValueError("VisualRegionProposalRequest normalization result authority drifted.")
    if request.get("normalizedArtifact") != expected["normalizedArtifact"]:
        raise ValueError("VisualRegionProposalRequest normalized artifact authority drifted.")
    if request.get("requestedAt") != GENERATED_AT:
        raise ValueError("VisualRegionProposalRequest timestamp drifted.")


def propose_regions(image: np.ndarray, policy: dict[str, Any]) -> list[dict[str, Any]]:
    if image.shape != (TARGET_SIZE[1], TARGET_SIZE[0], 3):
        raise ValueError("Normalized page dimensions drifted before region proposal.")
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    inset = policy["pageInset"]
    mask = np.zeros(gray.shape, dtype=np.uint8)
    mask[inset:-inset, inset:-inset] = (
        gray[inset:-inset, inset:-inset] < policy["foregroundThreshold"]
    ).astype(np.uint8) * 255
    close = policy["morphologicalClose"]
    kernel = np.ones((close["kernelHeight"], close["kernelWidth"]), dtype=np.uint8)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    count, _, stats, _ = cv2.connectedComponentsWithStats(
        closed, connectivity=policy["connectivity"]
    )
    components: list[tuple[int, int, int, int, int]] = []
    for index in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[index])
        if area >= policy["minimumForegroundArea"]:
            components.append((x, y, width, height, area))
    components.sort(key=lambda value: (value[1], value[0], value[2], value[3], value[4]))
    if not components:
        raise ValueError("No admitted content-block candidate was detected.")
    if len(components) > policy["maximumCandidateCount"]:
        raise ValueError("Content-block candidate count exceeds the admitted maximum.")
    padding = policy["proposalPadding"]
    proposals: list[dict[str, Any]] = []
    for index, (x, y, width, height, area) in enumerate(components, start=1):
        left = max(0, x - padding)
        top = max(0, y - padding)
        right = min(image.shape[1], x + width + padding)
        bottom = min(image.shape[0], y + height + padding)
        bbox = {"x": left, "y": top, "width": right - left, "height": bottom - top}
        bbox_area = bbox["width"] * bbox["height"]
        proposals.append({
            "proposalId": f"content-block-{index:03d}",
            "proposalKind": "content_block_candidate",
            "bbox": bbox,
            "sourceComponentBounds": {"x": x, "y": y, "width": width, "height": height},
            "foregroundArea": area,
            "bboxArea": bbox_area,
            "foregroundCoverageRatio": round(area / bbox_area, 6),
            "touchesPageBoundary": left == 0 or top == 0 or right == image.shape[1] or bottom == image.shape[0],
            "heuristicOnly": True,
        })
    return proposals


def render_overlay(image: np.ndarray, proposals: list[dict[str, Any]]) -> bytes:
    overlay = Image.fromarray(image, mode="RGB")
    draw = ImageDraw.Draw(overlay)
    for proposal in proposals:
        bbox = proposal["bbox"]
        draw.rectangle(
            (
                bbox["x"], bbox["y"],
                bbox["x"] + bbox["width"] - 1,
                bbox["y"] + bbox["height"] - 1,
            ),
            outline=(0, 160, 90),
            width=3,
        )
    return encode_png(np.asarray(overlay, dtype=np.uint8))


def compile_request(
    request_path: Path, fixture_root: Path = CANONICAL_ROOT
) -> tuple[dict[str, Any], bytes]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical visual-region proposal request identity is admitted.")
    request_bytes = request_path.read_bytes()
    request = json.loads(request_bytes.decode("utf-8-sig"))
    result_bytes, normalization_result, artifact_bytes, image = load_normalization_authority()
    validate_request(request, result_bytes, normalization_result, artifact_bytes, image)
    proposals = propose_regions(image, request["proposalPolicy"])
    overlay_bytes = render_overlay(image, proposals)
    overlay = decode_png(overlay_bytes, "proposal overlay")
    result = {
        "schemaVersion": "1.0",
        "kind": "visual-region-proposal-result",
        "requestId": request["requestId"],
        "subjectPack": request["subjectPack"],
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "normalizationResult": request["normalizationResult"],
        "normalizedArtifact": request["normalizedArtifact"],
        "coordinateSpace": "normalized_page_pixel",
        "regionProposalCandidates": proposals,
        "summary": {
            "proposalCount": len(proposals),
            "boundaryTouchingCount": sum(
                1 for proposal in proposals if proposal["touchesPageBoundary"]
            ),
        },
        "diagnosticOverlay": {
            "artifactRef": OVERLAY_NAME,
            "rawByteSha256": sha256_bytes(overlay_bytes),
            "decodedRgbPixelSha256": pixel_sha256(overlay),
            "pixelSize": {"width": overlay.shape[1], "height": overlay.shape[0]},
            "authorityDisposition": "diagnostic_only",
        },
        "algorithmParameters": {
            "policySha256": sha256_bytes(stable_json_bytes(request["proposalPolicy"])),
        },
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "deterministic-visual-region-proposer",
            "engineVersion": "1.0.0",
            "components": [
                {"name": "opencv", "version": cv2.__version__},
                {"name": "pillow", "version": Image.__version__},
            ],
            "liveProvider": False,
            "cloudEgress": False,
        },
        "dispositions": {
            "proposalStatus": "completed",
            "semanticDisposition": "not_inferred",
            "visualRegionDisposition": "not_generated",
            "requiresHumanReview": True,
            "acceptanceDisposition": "not_accepted",
            "controlsDisposition": "not_verified",
            "eligible": False,
            "optimizationCandidateRefs": [],
        },
        "generatedAt": GENERATED_AT,
    }
    return result, overlay_bytes


def canonical_artifacts() -> dict[str, bytes]:
    result_bytes, normalization_result, artifact_bytes, image = load_normalization_authority()
    request_bytes = stable_json_bytes(
        build_request(result_bytes, normalization_result, artifact_bytes, image)
    )
    with tempfile.TemporaryDirectory(prefix="visual-region-proposer-") as directory:
        root = Path(directory)
        (root / REQUEST_NAME).write_bytes(request_bytes)
        result, overlay_bytes = compile_request(root / REQUEST_NAME, root)
    return {
        REQUEST_NAME: request_bytes,
        OVERLAY_NAME: overlay_bytes,
        RESULT_NAME: stable_json_bytes(result),
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
    actual_names = (
        sorted(path.name for path in CANONICAL_ROOT.iterdir() if path.is_file())
        if CANONICAL_ROOT.exists() else []
    )
    if actual_names != sorted(expected):
        raise ValueError("Canonical visual-region proposal fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    result, overlay = compile_request(CANONICAL_ROOT / REQUEST_NAME)
    if stable_json_bytes(result) != expected[RESULT_NAME] or overlay != expected[OVERLAY_NAME]:
        raise ValueError("Canonical visual-region proposal replay drifted.")
    return 1


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    canonical_request = (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True)
    if request_path != canonical_request:
        raise ValueError("Only the canonical visual-region proposal request is admitted.")
    snapshot_paths = (
        canonical_request,
        (NORMALIZATION_ROOT / NORMALIZATION_RESULT_NAME).resolve(strict=True),
        (NORMALIZATION_ROOT / NORMALIZED_ARTIFACT_NAME).resolve(strict=True),
    )
    input_snapshots = {path: path.read_bytes() for path in snapshot_paths}
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
    result, overlay = compile_request(request_path)
    result_bytes = stable_json_bytes(result)
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=parent))
    try:
        atomic_write(stage / OVERLAY_NAME, overlay)
        atomic_write(stage / RESULT_NAME, result_bytes)
        if (stage / OVERLAY_NAME).read_bytes() != overlay \
                or (stage / RESULT_NAME).read_bytes() != result_bytes:
            raise ValueError("Staged visual-region proposal output drifted before promotion.")
        for path, snapshot in input_snapshots.items():
            if path.read_bytes() != snapshot:
                raise ValueError("Visual-region proposal input drifted during runtime execution.")
        os.replace(stage, output_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output_dir / RESULT_NAME


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deterministic visual region proposal runtime.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--request", type=Path)
    parser.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        print(f"Materialized and validated {materialize_fixtures()} synthetic region-proposal fixture.")
        return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} synthetic region-proposal fixture.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
