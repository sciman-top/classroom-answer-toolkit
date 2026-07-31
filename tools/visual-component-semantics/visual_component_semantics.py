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
REGION_SEMANTICS_ROOT = TOOL_ROOT.parent / "visual-region-semantics"
sys.path.insert(0, str(REGION_SEMANTICS_ROOT))
from visual_region_semantics import (  # noqa: E402
    atomic_write, decode_png, pixel_sha256, sha256_bytes, stable_json_bytes,
)


CANONICAL_ROOT = REPO_ROOT / "eval" / "visual-component-semantics" / "cases"
STRUCTURE_ROOT = REPO_ROOT / "eval" / "visual-structure-extraction" / "cases"
PREPROCESS_ROOT = REPO_ROOT / "eval" / "visual-preprocessing" / "cases"
STRUCTURE_NAME = "junior-instrument-scale.visual-structure-extraction-result.json"
PREPROCESS_NAME = "junior-instrument-scale.visual-preprocessing-result.json"
CROP_NAME = "junior-instrument-scale.crop-2x.png"
DECLARATION_NAME = "junior-instrument-scale.visual-synthetic-component-semantics-declaration.json"
REQUEST_NAME = "junior-instrument-scale.visual-component-semantics-request.json"
RESULT_NAME = "junior-instrument-scale.visual-component-semantics-result.json"
STRUCTURE_SHA256 = "e0e1e989dd3109790c842557cf4054f5beb3d450963a72217675b91f06ffa027"
PREPROCESS_SHA256 = "da5c7d84dabde7dc55df2a04a6441274b1f8616fdf8f653b68f6b00f2c2cb01b"
CROP_SHA256 = "70577ca429dbc6afd5b2ecf536fe4712001bfddd961f9a041b103dca5fb8bb40"
CROP_PIXEL_SHA256 = "4efe1386d15ea467781942982c77f2c6a38968509c79e72878eacf53fc711e30"
GENERATED_AT = "2026-07-31T13:00:00Z"

COMPONENT_SPECS = (
    ("scale-component-001", "pointer_indicator", 0, ("line-007", "line-008")),
    ("scale-component-002", "major_tick_mark", 1, ("line-009", "line-014")),
    ("scale-component-003", "major_tick_mark", 2, ("line-010", "line-015")),
    ("scale-component-004", "major_tick_mark", 3, ("line-011", "line-016")),
    ("scale-component-005", "major_tick_mark", 4, ("line-012", "line-017")),
    ("scale-component-006", "major_tick_mark", 5, ("line-013", "line-018")),
)


def _json(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    data = path.read_bytes()
    try:
        value = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object.")
    return data, value


def load_authority() -> tuple[bytes, dict[str, Any], bytes, dict[str, Any], bytes]:
    structure_path = (STRUCTURE_ROOT / STRUCTURE_NAME).resolve(strict=True)
    preprocess_path = (PREPROCESS_ROOT / PREPROCESS_NAME).resolve(strict=True)
    crop_path = (PREPROCESS_ROOT / CROP_NAME).resolve(strict=True)
    if structure_path.parent != STRUCTURE_ROOT.resolve(strict=True) or preprocess_path.parent != PREPROCESS_ROOT.resolve(strict=True) or crop_path.parent != PREPROCESS_ROOT.resolve(strict=True):
        raise ValueError("Visual component authority escaped its canonical root.")
    structure_bytes, structure = _json(structure_path, "structure result")
    preprocess_bytes, preprocess = _json(preprocess_path, "preprocessing result")
    crop_bytes = crop_path.read_bytes()
    if sha256_bytes(structure_bytes) != STRUCTURE_SHA256:
        raise ValueError("Structure result bytes drifted.")
    if sha256_bytes(preprocess_bytes) != PREPROCESS_SHA256:
        raise ValueError("Preprocessing result bytes drifted.")
    if sha256_bytes(crop_bytes) != CROP_SHA256:
        raise ValueError("Component crop bytes drifted.")
    crop = decode_png(crop_bytes, CROP_NAME)
    if pixel_sha256(crop) != CROP_PIXEL_SHA256 or (crop.shape[1], crop.shape[0]) != (580, 210):
        raise ValueError("Component crop pixel authority drifted.")
    lines = structure.get("lineSegmentCandidates")
    line_ids = [item.get("candidateId") for item in lines] if isinstance(lines, list) else []
    required = {ref for spec in COMPONENT_SPECS for ref in spec[3]}
    if (
        structure.get("kind") != "visual-structure-extraction-result"
        or structure.get("crop", {}).get("rawByteSha256") != CROP_SHA256
        or structure.get("dispositions", {}).get("semanticDisposition") != "not_inferred"
        or not required.issubset(line_ids)
    ):
        raise ValueError("Structure component authority drifted.")
    preprocess_crop = next((item for item in preprocess.get("cropArtifacts", []) if item.get("scale") == 2), None)
    if (
        preprocess.get("kind") != "visual-preprocessing-result"
        or preprocess_crop is None
        or preprocess_crop.get("rawByteSha256") != CROP_SHA256
        or preprocess_crop.get("decodedRgbPixelSha256") != CROP_PIXEL_SHA256
    ):
        raise ValueError("Preprocessing component authority drifted.")
    return structure_bytes, structure, preprocess_bytes, preprocess, crop_bytes


def build_declaration() -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-synthetic-component-semantics-declaration",
        "declarationId": "junior-instrument-scale-component-semantics-declaration",
        "caseId": "junior-instrument-scale",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "componentDeclarations": [
            {
                "componentRef": component_ref,
                "componentType": component_type,
                "componentOrder": order,
                "candidateKind": "line_segment_candidate_pair",
                "candidateRefs": list(candidate_refs),
                "authorityBasis": "explicit_fixture_author_grouping",
            }
            for component_ref, component_type, order, candidate_refs in COMPONENT_SPECS
        ],
        "authorityProvenance": {
            "authorityKind": "explicit_synthetic_component_semantics_declaration",
            "inferencePerformed": False,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": GENERATED_AT,
    }


def validate_declaration(value: dict[str, Any]) -> None:
    if value != build_declaration():
        raise ValueError("Synthetic component declaration authority drifted.")
    refs = [ref for item in value["componentDeclarations"] for ref in item["candidateRefs"]]
    if len(refs) != len(set(refs)):
        raise ValueError("Synthetic component declaration reuses candidate refs.")


def build_request(declaration_bytes: bytes, structure_bytes: bytes, structure: dict[str, Any], preprocess_bytes: bytes) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-component-semantics-request",
        "requestId": "junior-instrument-scale-component-semantics",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "componentDeclaration": {
            "artifactRef": DECLARATION_NAME,
            "rawByteSha256": sha256_bytes(declaration_bytes),
            "declarationId": "junior-instrument-scale-component-semantics-declaration",
        },
        "structureExtractionResult": {
            "artifactRef": f"eval/visual-structure-extraction/cases/{STRUCTURE_NAME}",
            "rawByteSha256": sha256_bytes(structure_bytes),
            "requestId": structure["requestId"],
        },
        "preprocessingResult": {
            "artifactRef": f"eval/visual-preprocessing/cases/{PREPROCESS_NAME}",
            "rawByteSha256": sha256_bytes(preprocess_bytes),
            "requestId": "junior-instrument-scale",
        },
        "crop": {
            "artifactRef": f"eval/visual-preprocessing/cases/{CROP_NAME}",
            "scale": 2,
            "rawByteSha256": CROP_SHA256,
            "decodedRgbPixelSha256": CROP_PIXEL_SHA256,
            "pixelSize": {"width": 580, "height": 210},
        },
        "egressPolicy": {"allowCloud": False},
        "requestedAt": GENERATED_AT,
    }


def _bbox(segments: list[dict[str, Any]]) -> dict[str, int]:
    xs = [value for segment in segments for value in (segment["x1"], segment["x2"])]
    ys = [value for segment in segments for value in (segment["y1"], segment["y2"])]
    return {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs) + 1, "height": max(ys) - min(ys) + 1}


def build_result(request_bytes: bytes, request: dict[str, Any], declaration: dict[str, Any], structure: dict[str, Any]) -> dict[str, Any]:
    line_by_id = {item["candidateId"]: item for item in structure["lineSegmentCandidates"]}
    components = []
    for item in declaration["componentDeclarations"]:
        segments = [line_by_id[ref] for ref in item["candidateRefs"]]
        components.append({
            "componentRef": item["componentRef"],
            "componentType": item["componentType"],
            "componentOrder": item["componentOrder"],
            "candidateKind": item["candidateKind"],
            "candidateRefs": item["candidateRefs"],
            "segments": segments,
            "bbox": {**_bbox(segments), "coordinateSpace": "crop_pixel"},
            "classificationBasis": "explicit_synthetic_component_semantics_declaration",
        })
    result = {
        "schemaVersion": "1.0",
        "kind": "visual-component-semantics-result",
        "requestId": request["requestId"],
        "subjectPack": request["subjectPack"],
        "fixtureKind": request["fixtureKind"],
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "componentDeclaration": request["componentDeclaration"],
        "structureExtractionResult": request["structureExtractionResult"],
        "preprocessingResult": request["preprocessingResult"],
        "crop": request["crop"],
        "coordinateSpace": "crop_pixel",
        "components": components,
        "summary": {"componentCount": 6, "pointerCount": 1, "majorTickCount": 5},
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "deterministic-explicit-component-semantics-compiler",
            "engineVersion": "1.0.0",
            "inferencePerformed": False,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "dispositions": {
            "semanticDisposition": "explicit_declared",
            "inferenceDisposition": "not_performed",
            "figureUnderstandingDisposition": "not_generated",
            "scaleInterpretationDisposition": "not_established",
            "readingDisposition": "not_generated",
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
    fixed = {
        "semanticDisposition": "explicit_declared",
        "inferenceDisposition": "not_performed",
        "figureUnderstandingDisposition": "not_generated",
        "scaleInterpretationDisposition": "not_established",
        "readingDisposition": "not_generated",
        "questionBindingDisposition": "not_established",
        "trackDisposition": "not_integrated",
        "answerDisposition": "not_generated",
        "requiresHumanReview": True,
        "acceptanceDisposition": "not_accepted",
        "controlsDisposition": "not_verified",
        "eligible": False,
        "optimizationCandidateRefs": [],
    }
    components = result.get("components")
    if result.get("dispositions") != fixed or not isinstance(components, list) or len(components) != 6:
        raise ValueError("Visual component semantics result boundary drifted.")
    if [item.get("componentType") for item in components] != ["pointer_indicator", *("major_tick_mark" for _ in range(5))]:
        raise ValueError("Visual component semantics result boundary drifted.")


def compile_request(request_path: Path, fixture_root: Path = CANONICAL_ROOT) -> dict[str, Any]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical visual-component-semantics request identity is admitted.")
    request_bytes, request = _json(request_path, "component semantics request")
    declaration_path = (fixture_root / request.get("componentDeclaration", {}).get("artifactRef", "")).resolve(strict=True)
    if declaration_path.parent != fixture_root or declaration_path.name != DECLARATION_NAME:
        raise ValueError("Component declaration escaped its fixture root.")
    declaration_bytes, declaration = _json(declaration_path, "component declaration")
    structure_bytes, structure, preprocess_bytes, _, _ = load_authority()
    expected = build_request(declaration_bytes, structure_bytes, structure, preprocess_bytes)
    if request.get("structureExtractionResult") != expected["structureExtractionResult"]:
        raise ValueError("Visual component structure authority drifted.")
    if request != expected:
        raise ValueError("Visual component semantics request authority drifted.")
    validate_declaration(declaration)
    return build_result(request_bytes, request, declaration, structure)


def canonical_artifacts() -> dict[str, bytes]:
    structure_bytes, structure, preprocess_bytes, _, _ = load_authority()
    declaration_bytes = stable_json_bytes(build_declaration())
    request_bytes = stable_json_bytes(build_request(declaration_bytes, structure_bytes, structure, preprocess_bytes))
    with tempfile.TemporaryDirectory(prefix="visual-component-semantics-") as directory:
        root = Path(directory)
        (root / DECLARATION_NAME).write_bytes(declaration_bytes)
        (root / REQUEST_NAME).write_bytes(request_bytes)
        result = compile_request(root / REQUEST_NAME, root)
    return {DECLARATION_NAME: declaration_bytes, REQUEST_NAME: request_bytes, RESULT_NAME: stable_json_bytes(result)}


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
        raise ValueError("Canonical visual-component-semantics fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    return 1


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    if request_path != (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True):
        raise ValueError("Only the canonical visual-component-semantics request is admitted.")
    snapshot_paths = [
        request_path,
        (CANONICAL_ROOT / DECLARATION_NAME).resolve(strict=True),
        (STRUCTURE_ROOT / STRUCTURE_NAME).resolve(strict=True),
        (PREPROCESS_ROOT / PREPROCESS_NAME).resolve(strict=True),
        (PREPROCESS_ROOT / CROP_NAME).resolve(strict=True),
    ]
    snapshots = {path: path.read_bytes() for path in snapshot_paths}
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    if not output_dir.parent.is_dir():
        raise ValueError("Runtime output parent must exist.")
    try:
        output_dir.relative_to(REPO_ROOT)
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    try:
        output_dir.parent.resolve(strict=True).relative_to(REPO_ROOT.resolve(strict=True))
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    result_bytes = stable_json_bytes(compile_request(request_path))
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    try:
        atomic_write(stage / RESULT_NAME, result_bytes)
        if (stage / RESULT_NAME).read_bytes() != result_bytes:
            raise ValueError("Staged component-semantics output drifted before promotion.")
        if any(path.read_bytes() != data for path, data in snapshots.items()):
            raise ValueError("Visual component semantics input drifted during execution.")
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
        print(f"Materialized and validated {materialize_fixtures()} synthetic component-semantics fixture.")
        return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} synthetic component-semantics fixture.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    print(json.dumps({"status": "ok", "resultPath": str(run_admitted_request(args.request, args.out))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
