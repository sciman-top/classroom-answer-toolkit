from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parents[1]
LOCAL_CROPPER_ROOT = TOOL_ROOT.parent / "visual-local-cropper"
sys.path.insert(0, str(LOCAL_CROPPER_ROOT))
from visual_local_cropper import (  # noqa: E402
    atomic_write,
    decode_png,
    pixel_sha256,
    sha256_bytes,
    stable_json_bytes,
)


CANONICAL_ROOT = REPO_ROOT / "eval" / "visual-region-semantics" / "cases"
PROPOSAL_ROOT = REPO_ROOT / "eval" / "visual-region-proposal" / "cases"
CROP_ROOT = REPO_ROOT / "eval" / "visual-local-crops" / "cases"
PROPOSAL_RESULT_NAME = "junior-readable-measurement.visual-region-proposal-result.json"
CROP_RESULT_NAME = "junior-readable-measurement.visual-local-crop-result.json"
DECLARATION_NAME = "junior-readable-measurement.visual-synthetic-region-semantics-declaration.json"
REQUEST_NAME = "junior-readable-measurement.visual-region-semantics-request.json"
RESULT_NAME = "junior-readable-measurement.visual-region-semantics-result.json"
PROPOSAL_RESULT_REF = f"eval/visual-region-proposal/cases/{PROPOSAL_RESULT_NAME}"
CROP_RESULT_REF = f"eval/visual-local-crops/cases/{CROP_RESULT_NAME}"
PROPOSAL_RESULT_SHA256 = "9597538175dd97686b1358de2515159c468cdafc62bf0ce71c49a8385bb319d4"
CROP_RESULT_SHA256 = "162d96d1ca4e15282e16d159853459c4843475f972d9045b99d80706acac506d"
GENERATED_AT = "2026-07-31T12:00:00Z"

DECLARED_SEMANTICS = (
    {
        "declarationRef": "region-semantic-declaration-001",
        "proposalRef": "content-block-001",
        "regionId": "junior-readable-measurement-text-region-001",
        "regionType": "text_area",
        "semanticRole": "measurement_reading",
        "componentKind": "recognized_value_component",
    },
    {
        "declarationRef": "region-semantic-declaration-002",
        "proposalRef": "content-block-002",
        "regionId": "junior-readable-measurement-scale-region-001",
        "regionType": "scale_area",
        "semanticRole": "measurement_scale_baseline",
        "componentKind": "scale_baseline_component",
    },
)


def _read_json(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    data = path.read_bytes()
    try:
        value = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object.")
    return data, value


def load_upstream_authority() -> tuple[bytes, dict[str, Any], bytes, dict[str, Any]]:
    proposal_path = (PROPOSAL_ROOT / PROPOSAL_RESULT_NAME).resolve(strict=True)
    crop_path = (CROP_ROOT / CROP_RESULT_NAME).resolve(strict=True)
    if proposal_path.parent != PROPOSAL_ROOT.resolve(strict=True):
        raise ValueError("Region proposal authority escaped its canonical root.")
    if crop_path.parent != CROP_ROOT.resolve(strict=True):
        raise ValueError("Local crop authority escaped its canonical root.")
    proposal_bytes, proposal = _read_json(proposal_path, "region proposal result")
    crop_bytes, crop = _read_json(crop_path, "local crop result")
    if sha256_bytes(proposal_bytes) != PROPOSAL_RESULT_SHA256:
        raise ValueError("Region proposal result bytes drifted.")
    if sha256_bytes(crop_bytes) != CROP_RESULT_SHA256:
        raise ValueError("Local crop result bytes drifted.")
    proposals = proposal.get("regionProposalCandidates")
    crops = crop.get("cropArtifacts")
    if (
        proposal.get("kind") != "visual-region-proposal-result"
        or proposal.get("dispositions", {}).get("semanticDisposition") != "not_inferred"
        or proposal.get("dispositions", {}).get("visualRegionDisposition") != "not_generated"
        or not isinstance(proposals, list)
        or [item.get("proposalId") for item in proposals] != ["content-block-001", "content-block-002"]
        or any(item.get("heuristicOnly") is not True for item in proposals)
    ):
        raise ValueError("Region proposal authority drifted.")
    if (
        crop.get("kind") != "visual-local-crop-result"
        or crop.get("regionProposalResult", {}).get("rawByteSha256") != PROPOSAL_RESULT_SHA256
        or crop.get("dispositions", {}).get("semanticDisposition") != "not_inferred"
        or crop.get("dispositions", {}).get("visualRegionDisposition") != "not_generated"
        or not isinstance(crops, list)
        or len(crops) != 4
    ):
        raise ValueError("Local crop authority drifted.")
    _validate_crop_files(crops)
    return proposal_bytes, proposal, crop_bytes, crop


def _validate_crop_files(crops: list[dict[str, Any]]) -> None:
    seen: set[tuple[str, int]] = set()
    for binding in crops:
        key = (binding.get("proposalRef"), binding.get("scale"))
        if key in seen:
            raise ValueError("Local crop authority contains duplicate proposal/scale binding.")
        seen.add(key)
        artifact_ref = binding.get("artifactRef")
        if not isinstance(artifact_ref, str) or Path(artifact_ref).name != artifact_ref:
            raise ValueError("Local crop artifact ref is not canonical.")
        path = (CROP_ROOT / artifact_ref).resolve(strict=True)
        if path.parent != CROP_ROOT.resolve(strict=True):
            raise ValueError("Local crop artifact escaped its canonical root.")
        data = path.read_bytes()
        image = decode_png(data, artifact_ref)
        if sha256_bytes(data) != binding.get("rawByteSha256"):
            raise ValueError("Local crop raw-byte binding drifted.")
        if pixel_sha256(image) != binding.get("decodedRgbPixelSha256"):
            raise ValueError("Local crop decoded-pixel binding drifted.")
        if {"width": image.shape[1], "height": image.shape[0]} != binding.get("pixelSize"):
            raise ValueError("Local crop pixel-size binding drifted.")
    if seen != {
        ("content-block-001", 1), ("content-block-001", 2),
        ("content-block-002", 1), ("content-block-002", 2),
    }:
        raise ValueError("Local crop proposal/scale coverage drifted.")


def _crop_bindings(crop: dict[str, Any], proposal_ref: str) -> list[dict[str, Any]]:
    return [
        {
            "scale": item["scale"],
            "artifactRef": f"eval/visual-local-crops/cases/{item['artifactRef']}",
            "rawByteSha256": item["rawByteSha256"],
            "decodedRgbPixelSha256": item["decodedRgbPixelSha256"],
            "pixelSize": item["pixelSize"],
            "interpolation": item["interpolation"],
        }
        for item in crop["cropArtifacts"]
        if item["proposalRef"] == proposal_ref
    ]


def build_declaration(proposal: dict[str, Any], crop: dict[str, Any]) -> dict[str, Any]:
    proposal_by_id = {item["proposalId"]: item for item in proposal["regionProposalCandidates"]}
    declarations = []
    for semantic in DECLARED_SEMANTICS:
        proposal_item = proposal_by_id[semantic["proposalRef"]]
        declarations.append({
            **semantic,
            "proposalKind": proposal_item["proposalKind"],
            "bbox": proposal_item["bbox"],
            "cropBindings": _crop_bindings(crop, semantic["proposalRef"]),
        })
    return {
        "schemaVersion": "1.0",
        "kind": "visual-synthetic-region-semantics-declaration",
        "declarationId": "junior-readable-measurement-region-semantics-declaration",
        "caseId": "junior-readable-measurement",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "regionDeclarations": declarations,
        "authorityProvenance": {
            "authorityKind": "explicit_synthetic_region_semantics_declaration",
            "sourceBasis": "fixture_author_declaration",
            "inferencePerformed": False,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": GENERATED_AT,
    }


def validate_declaration(declaration: dict[str, Any], proposal: dict[str, Any], crop: dict[str, Any]) -> None:
    declarations = declaration.get("regionDeclarations")
    if not isinstance(declarations, list) or len(declarations) != 2:
        raise ValueError("Synthetic region semantic declaration coverage drifted.")
    refs = [item.get("proposalRef") for item in declarations]
    if refs != ["content-block-001", "content-block-002"] or len(set(refs)) != 2:
        raise ValueError("Synthetic region semantic declaration coverage drifted.")
    for actual, expected_semantic in zip(declarations, DECLARED_SEMANTICS, strict=True):
        for field in ("declarationRef", "proposalRef", "regionId", "regionType", "semanticRole", "componentKind"):
            if actual.get(field) != expected_semantic[field]:
                raise ValueError("Synthetic region semantic declaration authority drifted.")
    expected = build_declaration(proposal, crop)
    if declaration != expected:
        raise ValueError("Synthetic region semantic declaration binding drifted.")


def build_request(
    declaration_bytes: bytes,
    declaration: dict[str, Any],
    proposal_bytes: bytes,
    proposal: dict[str, Any],
    crop_bytes: bytes,
    crop: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-region-semantics-request",
        "requestId": "junior-readable-measurement-region-semantics",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "semanticDeclaration": {
            "artifactRef": DECLARATION_NAME,
            "rawByteSha256": sha256_bytes(declaration_bytes),
            "declarationId": declaration["declarationId"],
        },
        "regionProposalResult": {
            "artifactRef": PROPOSAL_RESULT_REF,
            "rawByteSha256": sha256_bytes(proposal_bytes),
            "requestId": proposal["requestId"],
            "proposalRefs": [item["proposalId"] for item in proposal["regionProposalCandidates"]],
        },
        "localCropResult": {
            "artifactRef": CROP_RESULT_REF,
            "rawByteSha256": sha256_bytes(crop_bytes),
            "requestId": crop["requestId"],
            "proposalRefs": crop["regionProposalResult"]["proposalRefs"],
        },
        "egressPolicy": {"allowCloud": False},
        "requestedAt": GENERATED_AT,
    }


def validate_request(request: dict[str, Any], expected: dict[str, Any]) -> None:
    if request.get("regionProposalResult") != expected["regionProposalResult"]:
        raise ValueError("Visual region semantics proposal authority drifted.")
    if request.get("localCropResult") != expected["localCropResult"]:
        raise ValueError("Visual region semantics crop authority drifted.")
    if request != expected:
        raise ValueError("Visual region semantics request authority drifted.")


def build_result(
    request_bytes: bytes,
    request: dict[str, Any],
    declaration: dict[str, Any],
    proposal: dict[str, Any],
) -> dict[str, Any]:
    regions = []
    for item in declaration["regionDeclarations"]:
        regions.append({
            "declarationRef": item["declarationRef"],
            "proposalRef": item["proposalRef"],
            "proposalKind": item["proposalKind"],
            "semanticRole": item["semanticRole"],
            "componentKind": item["componentKind"],
            "classificationBasis": "explicit_synthetic_region_semantics_declaration",
            "visualRegion": {
                "schemaVersion": "1.0",
                "kind": "visual-region",
                "regionId": item["regionId"],
                "pageId": proposal["normalizationResult"]["pageId"],
                "regionType": item["regionType"],
                "bbox": {**item["bbox"], "coordinateSpace": "page_pixel"},
                "cropRef": next(binding["artifactRef"] for binding in item["cropBindings"] if binding["scale"] == 2),
                "qualityFlags": [],
                "generatedAt": GENERATED_AT,
            },
            "cropBindings": item["cropBindings"],
        })
    result = {
        "schemaVersion": "1.0",
        "kind": "visual-region-semantics-result",
        "requestId": request["requestId"],
        "subjectPack": request["subjectPack"],
        "fixtureKind": request["fixtureKind"],
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "semanticDeclaration": request["semanticDeclaration"],
        "regionProposalResult": request["regionProposalResult"],
        "localCropResult": request["localCropResult"],
        "pageAuthority": {
            "pageId": proposal["normalizationResult"]["pageId"],
            "coordinateSpace": "normalized_page_pixel",
            "normalizedArtifact": proposal["normalizedArtifact"],
        },
        "regionSemantics": regions,
        "summary": {
            "proposalCount": len(proposal["regionProposalCandidates"]),
            "declaredRegionCount": len(regions),
            "unclassifiedProposalRefs": [],
        },
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "deterministic-explicit-region-semantics-compiler",
            "engineVersion": "1.0.0",
            "inferencePerformed": False,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "dispositions": {
            "semanticDisposition": "explicit_declared",
            "visualRegionDisposition": "generated_from_explicit_synthetic_declaration",
            "inferenceDisposition": "not_performed",
            "questionBindingDisposition": "not_established",
            "trackDisposition": "not_integrated",
            "answerDisposition": "not_generated",
            "requiresHumanReview": True,
            "acceptanceDisposition": "not_accepted",
            "controlsDisposition": "not_verified",
            "eligible": False,
            "optimizationCandidateRefs": [],
        },
        "generatedAt": GENERATED_AT,
    }
    validate_result(result)
    return result


def validate_result(result: dict[str, Any]) -> None:
    expected_dispositions = {
        "semanticDisposition": "explicit_declared",
        "visualRegionDisposition": "generated_from_explicit_synthetic_declaration",
        "inferenceDisposition": "not_performed",
        "questionBindingDisposition": "not_established",
        "trackDisposition": "not_integrated",
        "answerDisposition": "not_generated",
        "requiresHumanReview": True,
        "acceptanceDisposition": "not_accepted",
        "controlsDisposition": "not_verified",
        "eligible": False,
        "optimizationCandidateRefs": [],
    }
    regions = result.get("regionSemantics")
    if result.get("dispositions") != expected_dispositions:
        raise ValueError("Visual region semantics result boundary drifted.")
    if not isinstance(regions, list) or len(regions) != 2:
        raise ValueError("Visual region semantics result boundary drifted.")
    actual = [(item.get("proposalRef"), item.get("visualRegion", {}).get("regionType"), item.get("semanticRole")) for item in regions]
    expected = [(item["proposalRef"], item["regionType"], item["semanticRole"]) for item in DECLARED_SEMANTICS]
    if actual != expected or any(item.get("classificationBasis") != "explicit_synthetic_region_semantics_declaration" for item in regions):
        raise ValueError("Visual region semantics result boundary drifted.")


def compile_request(request_path: Path, fixture_root: Path = CANONICAL_ROOT) -> dict[str, Any]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical visual-region-semantics request identity is admitted.")
    request_bytes, request = _read_json(request_path, "visual region semantics request")
    declaration_ref = request.get("semanticDeclaration", {}).get("artifactRef")
    if declaration_ref != DECLARATION_NAME:
        raise ValueError("Visual region semantics declaration ref drifted.")
    declaration_path = (fixture_root / declaration_ref).resolve(strict=True)
    if declaration_path.parent != fixture_root:
        raise ValueError("Visual region semantics declaration escaped its fixture root.")
    declaration_bytes, declaration = _read_json(declaration_path, "region semantics declaration")
    proposal_bytes, proposal, crop_bytes, crop = load_upstream_authority()
    expected_request = build_request(declaration_bytes, declaration, proposal_bytes, proposal, crop_bytes, crop)
    validate_request(request, expected_request)
    validate_declaration(declaration, proposal, crop)
    return build_result(request_bytes, request, declaration, proposal)


def canonical_artifacts() -> dict[str, bytes]:
    proposal_bytes, proposal, crop_bytes, crop = load_upstream_authority()
    declaration = build_declaration(proposal, crop)
    declaration_bytes = stable_json_bytes(declaration)
    request = build_request(declaration_bytes, declaration, proposal_bytes, proposal, crop_bytes, crop)
    request_bytes = stable_json_bytes(request)
    with tempfile.TemporaryDirectory(prefix="visual-region-semantics-") as directory:
        root = Path(directory)
        (root / DECLARATION_NAME).write_bytes(declaration_bytes)
        (root / REQUEST_NAME).write_bytes(request_bytes)
        result = compile_request(root / REQUEST_NAME, root)
    return {
        DECLARATION_NAME: declaration_bytes,
        REQUEST_NAME: request_bytes,
        RESULT_NAME: stable_json_bytes(result),
    }


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
        raise ValueError("Canonical visual-region-semantics fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    return 1


def _snapshot_paths() -> list[Path]:
    _, _, _, crop = load_upstream_authority()
    return [
        (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True),
        (CANONICAL_ROOT / DECLARATION_NAME).resolve(strict=True),
        (PROPOSAL_ROOT / PROPOSAL_RESULT_NAME).resolve(strict=True),
        (CROP_ROOT / CROP_RESULT_NAME).resolve(strict=True),
        *[(CROP_ROOT / item["artifactRef"]).resolve(strict=True) for item in crop["cropArtifacts"]],
    ]


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    if request_path != (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True):
        raise ValueError("Only the canonical visual-region-semantics request is admitted.")
    snapshots = {path: path.read_bytes() for path in _snapshot_paths()}
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
        if str(error).startswith("Runtime output"):
            raise
    try:
        parent.resolve(strict=True).relative_to(REPO_ROOT.resolve(strict=True))
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    result_bytes = stable_json_bytes(compile_request(request_path))
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=parent))
    try:
        atomic_write(stage / RESULT_NAME, result_bytes)
        if (stage / RESULT_NAME).read_bytes() != result_bytes:
            raise ValueError("Staged region-semantics output drifted before promotion.")
        if any(path.read_bytes() != data for path, data in snapshots.items()):
            raise ValueError("Visual-region-semantics input drifted during runtime execution.")
        os.replace(stage, output_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
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
        print(f"Materialized and validated {materialize_fixtures()} synthetic region-semantics fixture.")
        return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} synthetic region-semantics fixture.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    print(json.dumps({"status": "ok", "resultPath": str(run_admitted_request(args.request, args.out))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
