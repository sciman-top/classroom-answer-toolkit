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
COMPONENT_ROOT = TOOL_ROOT.parent / "visual-component-semantics"
sys.path.insert(0, str(COMPONENT_ROOT))
from visual_component_semantics import (  # noqa: E402
    atomic_write, sha256_bytes, stable_json_bytes,
)


CANONICAL_ROOT = REPO_ROOT / "eval" / "visual-scale-lattice" / "cases"
COMPONENT_AUTHORITY_ROOT = REPO_ROOT / "eval" / "visual-component-semantics" / "cases"
STRUCTURE_ROOT = REPO_ROOT / "eval" / "visual-structure-extraction" / "cases"
COMPONENT_NAME = "junior-instrument-scale.visual-component-semantics-result.json"
STRUCTURE_NAME = "junior-instrument-scale.visual-structure-extraction-result.json"
DECLARATION_NAME = "junior-instrument-scale.visual-synthetic-scale-lattice-declaration.json"
REQUEST_NAME = "junior-instrument-scale.visual-scale-lattice-request.json"
RESULT_NAME = "junior-instrument-scale.visual-scale-lattice-result.json"
COMPONENT_SHA256 = "a7766c29845087d2106dd9cad25e6789845ddcd7a17f1ac0dcfaccfc4acbb97e"
STRUCTURE_SHA256 = "e0e1e989dd3109790c842557cf4054f5beb3d450963a72217675b91f06ffa027"
GENERATED_AT = "2026-07-31T14:00:00Z"

MAJOR_COMPONENT_REFS = tuple(f"scale-component-{index:03d}" for index in range(2, 7))
MINOR_SLOT_SPECS = (
    ("region-008", 1), ("region-009", 2), ("region-010", 3), ("region-011", 4),
    ("region-012", 6), ("region-013", 7), ("region-014", 8), ("region-015", 9),
    ("region-016", 12), ("region-017", 13), ("region-018", 14),
    ("region-019", 16), ("region-020", 17), ("region-021", 18), ("region-022", 19),
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


def load_authority() -> tuple[bytes, dict[str, Any], bytes, dict[str, Any]]:
    component_path = (COMPONENT_AUTHORITY_ROOT / COMPONENT_NAME).resolve(strict=True)
    structure_path = (STRUCTURE_ROOT / STRUCTURE_NAME).resolve(strict=True)
    if component_path.parent != COMPONENT_AUTHORITY_ROOT.resolve(strict=True):
        raise ValueError("Component semantics authority escaped its canonical root.")
    if structure_path.parent != STRUCTURE_ROOT.resolve(strict=True):
        raise ValueError("Structure authority escaped its canonical root.")
    component_bytes, component = _json(component_path, "component semantics result")
    structure_bytes, structure = _json(structure_path, "structure result")
    if sha256_bytes(component_bytes) != COMPONENT_SHA256:
        raise ValueError("Component semantics result bytes drifted.")
    if sha256_bytes(structure_bytes) != STRUCTURE_SHA256:
        raise ValueError("Structure result bytes drifted.")
    if (
        component.get("kind") != "visual-component-semantics-result"
        or component.get("dispositions", {}).get("scaleInterpretationDisposition") != "not_established"
        or component.get("dispositions", {}).get("eligible") is not False
    ):
        raise ValueError("Component semantics scale-lattice authority drifted.")
    if structure.get("kind") != "visual-structure-extraction-result":
        raise ValueError("Structure scale-lattice authority drifted.")
    return component_bytes, component, structure_bytes, structure


def build_declaration() -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-synthetic-scale-lattice-declaration",
        "declarationId": "junior-instrument-scale-lattice-declaration",
        "caseId": "junior-instrument-scale",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "axis": "horizontal",
        "coordinateMetric": "inclusive_bbox_center_doubled_pixels",
        "pointerComponentRef": "scale-component-001",
        "majorTickComponentRefs": list(MAJOR_COMPONENT_REFS),
        "subdivisionsPerMajorInterval": 5,
        "minorTickSlots": [
            {"regionRef": region_ref, "slotIndex": slot_index}
            for region_ref, slot_index in MINOR_SLOT_SPECS
        ],
        "geometryToleranceDoubledPixels": 1,
        "authorityProvenance": {
            "authorityKind": "explicit_synthetic_scale_lattice_declaration",
            "inferencePerformed": False,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": GENERATED_AT,
    }


def validate_declaration(value: dict[str, Any]) -> None:
    if value != build_declaration():
        raise ValueError("Synthetic scale declaration authority drifted.")


def build_request(
    declaration_bytes: bytes,
    component_bytes: bytes,
    structure_bytes: bytes,
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-scale-lattice-request",
        "requestId": "junior-instrument-scale-lattice",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "scaleDeclaration": {
            "artifactRef": DECLARATION_NAME,
            "rawByteSha256": sha256_bytes(declaration_bytes),
            "declarationId": "junior-instrument-scale-lattice-declaration",
        },
        "componentSemanticsResult": {
            "artifactRef": f"eval/visual-component-semantics/cases/{COMPONENT_NAME}",
            "rawByteSha256": sha256_bytes(component_bytes),
            "requestId": "junior-instrument-scale-component-semantics",
        },
        "structureExtractionResult": {
            "artifactRef": f"eval/visual-structure-extraction/cases/{STRUCTURE_NAME}",
            "rawByteSha256": sha256_bytes(structure_bytes),
            "requestId": "junior-instrument-scale",
        },
        "egressPolicy": {"allowCloud": False},
        "requestedAt": GENERATED_AT,
    }


def _center2(bbox: dict[str, Any]) -> int:
    return 2 * bbox["x"] + bbox["width"] - 1


def build_result(
    request_bytes: bytes,
    request: dict[str, Any],
    declaration: dict[str, Any],
    component: dict[str, Any],
    structure: dict[str, Any],
) -> dict[str, Any]:
    components = {item["componentRef"]: item for item in component["components"]}
    regions = {item["candidateId"]: item for item in structure["connectedRegionCandidates"]}
    major_centers2 = [_center2(components[ref]["bbox"]) for ref in declaration["majorTickComponentRefs"]]
    major_deltas2 = [right - left for left, right in zip(major_centers2, major_centers2[1:])]
    if not major_deltas2 or len(set(major_deltas2)) != 1 or major_deltas2[0] <= 0:
        raise ValueError("Major tick spacing is not a regular increasing lattice.")
    major_spacing2 = major_deltas2[0]
    subdivisions = declaration["subdivisionsPerMajorInterval"]
    if major_spacing2 % subdivisions != 0:
        raise ValueError("Major tick spacing is not exactly divisible into declared subdivisions.")
    subdivision_spacing2 = major_spacing2 // subdivisions
    origin2 = major_centers2[0]
    tolerance2 = declaration["geometryToleranceDoubledPixels"]

    minor_slots = []
    for item in declaration["minorTickSlots"]:
        region = regions.get(item["regionRef"])
        if region is None:
            raise ValueError("Declared minor tick region is missing from structure authority.")
        observed2 = _center2(region["bbox"])
        expected2 = origin2 + item["slotIndex"] * subdivision_spacing2
        deviation2 = abs(observed2 - expected2)
        if deviation2 > tolerance2:
            raise ValueError("Declared minor tick geometry exceeds lattice tolerance.")
        minor_slots.append({
            "regionRef": item["regionRef"],
            "slotIndex": item["slotIndex"],
            "observedCenterDoubledPixels": observed2,
            "expectedCenterDoubledPixels": expected2,
            "deviationDoubledPixels": deviation2,
        })

    pointer = components[declaration["pointerComponentRef"]]
    pointer_center2 = _center2(pointer["bbox"])
    pointer_delta2 = pointer_center2 - origin2
    nearest_index = (pointer_delta2 + subdivision_spacing2 // 2) // subdivision_spacing2
    pointer_expected2 = origin2 + nearest_index * subdivision_spacing2
    pointer_deviation2 = abs(pointer_center2 - pointer_expected2)
    if pointer_delta2 < 0 or pointer_deviation2 > tolerance2:
        raise ValueError("Pointer geometry does not align to the declared scale lattice.")
    if nearest_index % subdivisions == 0 or nearest_index in {item["slotIndex"] for item in minor_slots}:
        raise ValueError("Pointer slot collides with a declared tick slot.")

    result = {
        "schemaVersion": "1.0",
        "kind": "visual-scale-lattice-result",
        "requestId": request["requestId"],
        "subjectPack": request["subjectPack"],
        "fixtureKind": request["fixtureKind"],
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "scaleDeclaration": request["scaleDeclaration"],
        "componentSemanticsResult": request["componentSemanticsResult"],
        "structureExtractionResult": request["structureExtractionResult"],
        "coordinateSpace": "crop_pixel",
        "scaleLattice": {
            "axis": declaration["axis"],
            "coordinateMetric": declaration["coordinateMetric"],
            "majorTickComponentRefs": declaration["majorTickComponentRefs"],
            "majorCentersDoubledPixels": major_centers2,
            "majorSpacingDoubledPixels": major_spacing2,
            "majorSpacingPixels": major_spacing2 // 2,
            "subdivisionsPerMajorInterval": subdivisions,
            "subdivisionSpacingDoubledPixels": subdivision_spacing2,
            "subdivisionSpacingPixels": subdivision_spacing2 // 2,
            "minorTickSlots": minor_slots,
            "maxObservedDeviationDoubledPixels": max(item["deviationDoubledPixels"] for item in minor_slots),
        },
        "pointerPosition": {
            "componentRef": declaration["pointerComponentRef"],
            "centerDoubledPixels": pointer_center2,
            "expectedCenterDoubledPixels": pointer_expected2,
            "alignmentDeviationDoubledPixels": pointer_deviation2,
            "relativeSubdivisionIndex": nearest_index,
            "valueSemantics": "relative_subdivision_index",
            "physicalQuantity": None,
            "unit": None,
        },
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "deterministic-explicit-scale-lattice-compiler",
            "engineVersion": "1.0.0",
            "inferencePerformed": False,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "dispositions": {
            "semanticDisposition": "explicit_declared_and_geometry_derived",
            "scaleInterpretationDisposition": "relative_lattice_only",
            "readingDisposition": "relative_index_only",
            "physicalReadingDisposition": "not_generated",
            "quantityInterpretationDisposition": "not_established",
            "unitInterpretationDisposition": "not_established",
            "figureUnderstandingDisposition": "partial_scale_lattice_only",
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
        "semanticDisposition": "explicit_declared_and_geometry_derived",
        "scaleInterpretationDisposition": "relative_lattice_only",
        "readingDisposition": "relative_index_only",
        "physicalReadingDisposition": "not_generated",
        "quantityInterpretationDisposition": "not_established",
        "unitInterpretationDisposition": "not_established",
        "figureUnderstandingDisposition": "partial_scale_lattice_only",
        "questionBindingDisposition": "not_established",
        "trackDisposition": "not_integrated",
        "answerDisposition": "not_generated",
        "requiresHumanReview": True,
        "acceptanceDisposition": "not_accepted",
        "controlsDisposition": "not_verified",
        "eligible": False,
        "optimizationCandidateRefs": [],
    }
    pointer = result.get("pointerPosition", {})
    lattice = result.get("scaleLattice", {})
    if (
        result.get("dispositions") != fixed
        or pointer.get("relativeSubdivisionIndex") != 11
        or pointer.get("physicalQuantity") is not None
        or pointer.get("unit") is not None
        or lattice.get("majorSpacingDoubledPixels") != 240
        or lattice.get("subdivisionSpacingDoubledPixels") != 48
    ):
        raise ValueError("Visual scale-lattice result boundary drifted.")


def compile_request(request_path: Path, fixture_root: Path = CANONICAL_ROOT) -> dict[str, Any]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical visual-scale-lattice request identity is admitted.")
    request_bytes, request = _json(request_path, "scale-lattice request")
    declaration_path = (fixture_root / request.get("scaleDeclaration", {}).get("artifactRef", "")).resolve(strict=True)
    if declaration_path.parent != fixture_root or declaration_path.name != DECLARATION_NAME:
        raise ValueError("Scale declaration escaped its fixture root.")
    declaration_bytes, declaration = _json(declaration_path, "scale declaration")
    component_bytes, component, structure_bytes, structure = load_authority()
    expected = build_request(declaration_bytes, component_bytes, structure_bytes)
    if request.get("componentSemanticsResult") != expected["componentSemanticsResult"]:
        raise ValueError("Visual scale-lattice component semantics authority drifted.")
    if request != expected:
        raise ValueError("Visual scale-lattice request authority drifted.")
    validate_declaration(declaration)
    return build_result(request_bytes, request, declaration, component, structure)


def canonical_artifacts() -> dict[str, bytes]:
    component_bytes, _, structure_bytes, _ = load_authority()
    declaration_bytes = stable_json_bytes(build_declaration())
    request_bytes = stable_json_bytes(build_request(declaration_bytes, component_bytes, structure_bytes))
    with tempfile.TemporaryDirectory(prefix="visual-scale-lattice-") as directory:
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
        raise ValueError("Canonical visual-scale-lattice fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    return 1


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    if request_path != (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True):
        raise ValueError("Only the canonical visual-scale-lattice request is admitted.")
    snapshot_paths = [
        request_path,
        (CANONICAL_ROOT / DECLARATION_NAME).resolve(strict=True),
        (COMPONENT_AUTHORITY_ROOT / COMPONENT_NAME).resolve(strict=True),
        (STRUCTURE_ROOT / STRUCTURE_NAME).resolve(strict=True),
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
            raise ValueError("Staged scale-lattice output drifted before promotion.")
        if any(path.read_bytes() != data for path, data in snapshots.items()):
            raise ValueError("Visual scale-lattice input drifted during execution.")
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
        print(f"Materialized and validated {materialize_fixtures()} synthetic scale-lattice fixture.")
        return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} synthetic scale-lattice fixture.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    print(json.dumps({"status": "ok", "resultPath": str(run_admitted_request(args.request, args.out))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
