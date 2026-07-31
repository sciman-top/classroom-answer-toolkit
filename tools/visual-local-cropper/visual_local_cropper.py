from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

import cv2
import numpy as np
from PIL import Image


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parents[1]
PROPOSER_TOOL_ROOT = TOOL_ROOT.parent / "visual-region-proposer"
sys.path.insert(0, str(PROPOSER_TOOL_ROOT))
from visual_region_proposer import (  # noqa: E402
    NORMALIZATION_ROOT, NORMALIZED_ARTIFACT_NAME, NORMALIZED_ARTIFACT_SHA256,
    atomic_write, decode_png, encode_png, pixel_sha256, sha256_bytes, stable_json_bytes,
)


CANONICAL_ROOT = REPO_ROOT / "eval" / "visual-local-crops" / "cases"
PROPOSAL_ROOT = REPO_ROOT / "eval" / "visual-region-proposal" / "cases"
PROPOSAL_RESULT_NAME = "junior-readable-measurement.visual-region-proposal-result.json"
PROPOSAL_RESULT_REF = f"eval/visual-region-proposal/cases/{PROPOSAL_RESULT_NAME}"
PROPOSAL_RESULT_SHA256 = "9597538175dd97686b1358de2515159c468cdafc62bf0ce71c49a8385bb319d4"
NORMALIZED_ARTIFACT_REF = f"eval/visual-page-normalization/cases/{NORMALIZED_ARTIFACT_NAME}"
REQUEST_NAME = "junior-readable-measurement.visual-local-crop-request.json"
RESULT_NAME = "junior-readable-measurement.visual-local-crop-result.json"
GENERATED_AT = "2026-07-31T08:00:00Z"


def crop_name(proposal_id: str, scale: int) -> str:
    return f"junior-readable-measurement.{proposal_id}.crop-{scale}x.png"


def load_authority() -> tuple[bytes, dict[str, Any], bytes, np.ndarray]:
    proposal_path = (PROPOSAL_ROOT / PROPOSAL_RESULT_NAME).resolve(strict=True)
    image_path = (NORMALIZATION_ROOT / NORMALIZED_ARTIFACT_NAME).resolve(strict=True)
    if proposal_path.parent != PROPOSAL_ROOT.resolve(strict=True):
        raise ValueError("Region proposal authority escaped its canonical root.")
    proposal_bytes = proposal_path.read_bytes()
    image_bytes = image_path.read_bytes()
    if sha256_bytes(proposal_bytes) != PROPOSAL_RESULT_SHA256:
        raise ValueError("Region proposal result bytes drifted.")
    if sha256_bytes(image_bytes) != NORMALIZED_ARTIFACT_SHA256:
        raise ValueError("Normalized page bytes drifted.")
    proposal = json.loads(proposal_bytes.decode("utf-8-sig"))
    image = decode_png(image_bytes, "normalized page")
    candidates = proposal.get("regionProposalCandidates")
    if (
        proposal.get("kind") != "visual-region-proposal-result"
        or proposal.get("coordinateSpace") != "normalized_page_pixel"
        or not isinstance(candidates, list)
        or not candidates
        or proposal.get("normalizedArtifact", {}).get("rawByteSha256") != NORMALIZED_ARTIFACT_SHA256
        or proposal.get("normalizedArtifact", {}).get("decodedRgbPixelSha256") != pixel_sha256(image)
        or proposal.get("dispositions", {}).get("semanticDisposition") != "not_inferred"
        or proposal.get("dispositions", {}).get("visualRegionDisposition") != "not_generated"
        or any(candidate.get("heuristicOnly") is not True for candidate in candidates)
    ):
        raise ValueError("Region proposal authority drifted.")
    return proposal_bytes, proposal, image_bytes, image


def build_request(proposal_bytes: bytes, proposal: dict[str, Any], image_bytes: bytes, image: np.ndarray) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0", "kind": "visual-local-crop-request",
        "requestId": "junior-readable-measurement-local-crops",
        "subjectPack": "junior-physics-answer", "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "regionProposalResult": {
            "artifactRef": PROPOSAL_RESULT_REF, "rawByteSha256": sha256_bytes(proposal_bytes),
            "requestId": proposal["requestId"], "proposalRefs": [c["proposalId"] for c in proposal["regionProposalCandidates"]],
        },
        "normalizedArtifact": {
            "artifactRef": NORMALIZED_ARTIFACT_REF, "rawByteSha256": sha256_bytes(image_bytes),
            "decodedRgbPixelSha256": pixel_sha256(image),
            "pixelSize": {"width": image.shape[1], "height": image.shape[0]},
        },
        "scales": [1, 2], "scale2Interpolation": "nearest",
        "egressPolicy": {"allowCloud": False}, "requestedAt": GENERATED_AT,
    }


def validate_request(request: dict[str, Any], proposal_bytes: bytes, proposal: dict[str, Any], image_bytes: bytes, image: np.ndarray) -> None:
    expected = build_request(proposal_bytes, proposal, image_bytes, image)
    if set(request) != set(expected):
        raise ValueError("VisualLocalCropRequest fields drifted.")
    if request.get("scales") != [1, 2] or request.get("scale2Interpolation") != "nearest":
        raise ValueError("VisualLocalCropRequest scales drifted.")
    if request.get("regionProposalResult") != expected["regionProposalResult"]:
        raise ValueError("VisualLocalCropRequest proposal authority drifted.")
    if request != expected:
        raise ValueError("VisualLocalCropRequest authority drifted.")


def render_crops(image: np.ndarray, proposals: list[dict[str, Any]], scales: list[int]) -> dict[str, bytes]:
    outputs: dict[str, bytes] = {}
    height, width = image.shape[:2]
    for proposal in proposals:
        bbox = proposal.get("bbox", {})
        x, y = bbox.get("x"), bbox.get("y")
        crop_width, crop_height = bbox.get("width"), bbox.get("height")
        if (
            not all(isinstance(value, int) for value in (x, y, crop_width, crop_height))
            or x < 0 or y < 0 or crop_width < 1 or crop_height < 1
            or x + crop_width > width or y + crop_height > height
        ):
            raise ValueError("Proposal bbox is outside normalized page authority.")
        crop_1x = image[y:y + crop_height, x:x + crop_width].copy()
        for scale in scales:
            crop = crop_1x if scale == 1 else cv2.resize(
                crop_1x, (crop_width * scale, crop_height * scale), interpolation=cv2.INTER_NEAREST
            )
            outputs[crop_name(proposal["proposalId"], scale)] = encode_png(crop)
    return outputs


def compile_request(request_path: Path, fixture_root: Path = CANONICAL_ROOT) -> tuple[dict[str, Any], dict[str, bytes]]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical visual-local-crop request identity is admitted.")
    request_bytes = request_path.read_bytes()
    request = json.loads(request_bytes.decode("utf-8-sig"))
    proposal_bytes, proposal, image_bytes, image = load_authority()
    validate_request(request, proposal_bytes, proposal, image_bytes, image)
    crops = render_crops(image, proposal["regionProposalCandidates"], request["scales"])
    artifacts = []
    for candidate in proposal["regionProposalCandidates"]:
        for scale in request["scales"]:
            name = crop_name(candidate["proposalId"], scale)
            crop = decode_png(crops[name], name)
            artifacts.append({
                "proposalRef": candidate["proposalId"], "sourceBbox": candidate["bbox"], "scale": scale,
                "artifactRef": name, "rawByteSha256": sha256_bytes(crops[name]),
                "decodedRgbPixelSha256": pixel_sha256(crop),
                "pixelSize": {"width": crop.shape[1], "height": crop.shape[0]},
                "interpolation": "pixel_preserving" if scale == 1 else "nearest",
            })
    result = {
        "schemaVersion": "1.0", "kind": "visual-local-crop-result",
        "requestId": request["requestId"], "subjectPack": request["subjectPack"],
        "fixtureKind": "synthetic_fixture", "sourceRequestSha256": sha256_bytes(request_bytes),
        "regionProposalResult": request["regionProposalResult"],
        "normalizedArtifact": request["normalizedArtifact"], "coordinateSpace": "normalized_page_pixel",
        "cropArtifacts": artifacts,
        "summary": {"proposalCount": len(proposal["regionProposalCandidates"]), "cropArtifactCount": len(artifacts)},
        "engineProvenance": {
            "engineKind": "local_runtime", "engineId": "deterministic-visual-local-cropper",
            "engineVersion": "1.0.0", "components": [
                {"name": "opencv", "version": cv2.__version__}, {"name": "pillow", "version": Image.__version__}],
            "liveProvider": False, "cloudEgress": False,
        },
        "dispositions": {
            "semanticDisposition": "not_inferred", "visualRegionDisposition": "not_generated",
            "trackDisposition": "not_integrated", "requiresHumanReview": True,
            "acceptanceDisposition": "not_accepted", "controlsDisposition": "not_verified",
            "eligible": False, "optimizationCandidateRefs": [],
        },
        "generatedAt": GENERATED_AT,
    }
    return result, crops


def canonical_artifacts() -> dict[str, bytes]:
    proposal_bytes, proposal, image_bytes, image = load_authority()
    request_bytes = stable_json_bytes(build_request(proposal_bytes, proposal, image_bytes, image))
    with tempfile.TemporaryDirectory(prefix="visual-local-cropper-") as directory:
        root = Path(directory)
        (root / REQUEST_NAME).write_bytes(request_bytes)
        result, crops = compile_request(root / REQUEST_NAME, root)
    return {REQUEST_NAME: request_bytes, **crops, RESULT_NAME: stable_json_bytes(result)}


def materialize_fixtures() -> int:
    artifacts = canonical_artifacts()
    CANONICAL_ROOT.mkdir(parents=True, exist_ok=True)
    for name, data in artifacts.items():
        atomic_write(CANONICAL_ROOT / name, data)
    return validate_fixtures()


def validate_fixtures() -> int:
    expected = canonical_artifacts()
    actual = sorted(path.name for path in CANONICAL_ROOT.iterdir() if path.is_file()) if CANONICAL_ROOT.exists() else []
    if actual != sorted(expected):
        raise ValueError("Canonical visual-local-crop fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    return 1


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    canonical_request = (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True)
    if request_path != canonical_request:
        raise ValueError("Only the canonical visual-local-crop request is admitted.")
    snapshots = {path: path.read_bytes() for path in (
        canonical_request, (PROPOSAL_ROOT / PROPOSAL_RESULT_NAME).resolve(strict=True),
        (NORMALIZATION_ROOT / NORMALIZED_ARTIFACT_NAME).resolve(strict=True))}
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    parent = output_dir.parent
    if not parent.is_dir():
        raise ValueError("Runtime output parent must exist.")
    try:
        output_dir.relative_to(REPO_ROOT)
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"): raise
    try:
        parent.resolve(strict=True).relative_to(REPO_ROOT.resolve(strict=True))
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"): raise
    result, crops = compile_request(request_path)
    outputs = {**crops, RESULT_NAME: stable_json_bytes(result)}
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=parent))
    try:
        for name, data in outputs.items(): atomic_write(stage / name, data)
        if any((stage / name).read_bytes() != data for name, data in outputs.items()):
            raise ValueError("Staged local-crop output drifted before promotion.")
        if any(path.read_bytes() != data for path, data in snapshots.items()):
            raise ValueError("Visual-local-crop input drifted during runtime execution.")
        os.replace(stage, output_dir)
    finally:
        if stage.exists(): shutil.rmtree(stage)
    return output_dir / RESULT_NAME


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--request", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.materialize_fixtures:
        print(f"Materialized and validated {materialize_fixtures()} synthetic local-crop fixture."); return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} synthetic local-crop fixture."); return 0
    if args.out is None: raise ValueError("--out is required with --request.")
    print(json.dumps({"status": "ok", "resultPath": str(run_admitted_request(args.request, args.out))})); return 0


if __name__ == "__main__":
    raise SystemExit(main())
