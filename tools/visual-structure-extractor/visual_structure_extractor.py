from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import __version__ as pillow_version


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent.resolve()
PREPROCESSOR_TOOL_ROOT = TOOL_ROOT.parent / "visual-preprocessor"
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))

from visual_preprocessor import (  # noqa: E402
    CANONICAL_ROOT as PREPROCESSING_ROOT,
    INVENTORY_NAME as PREPROCESSING_INVENTORY_NAME,
    assert_output_outside_repo,
    assert_within,
    atomic_write,
    decode_png,
    decoded_pixel_sha256,
    file_identity,
    is_sha256,
    read_json_bytes,
    require_exact_keys,
    resolve_bound_file,
    resolve_canonical_input,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures as validate_preprocessing_fixtures,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-structure-extraction" / "cases").resolve()
INVENTORY_NAME = "visual-structure-extraction-case-inventory.json"
SUBJECT_PACKS = (
    "math-answer",
    "junior-physics-answer",
    "senior-physics-answer",
)


@dataclass(frozen=True)
class FixtureDefinition:
    case_id: str
    subject_pack: str
    requested_at: str

    @property
    def preprocessing_result_name(self) -> str:
        return f"{self.case_id}.visual-preprocessing-result.json"

    @property
    def request_name(self) -> str:
        return f"{self.case_id}.visual-structure-extraction-request.json"

    @property
    def result_name(self) -> str:
        return f"{self.case_id}.visual-structure-extraction-result.json"


DEFINITIONS = (
    FixtureDefinition("math-function-graph", "math-answer", "2026-07-27T02:00:00Z"),
    FixtureDefinition("junior-instrument-scale", "junior-physics-answer", "2026-07-27T02:01:00Z"),
    FixtureDefinition("senior-circuit-label", "senior-physics-answer", "2026-07-27T02:02:00Z"),
    FixtureDefinition("junior-readable-measurement", "junior-physics-answer", "2026-07-29T02:03:00Z"),
)
DEFINITION_BY_ID = {definition.case_id: definition for definition in DEFINITIONS}


def extraction_policy() -> dict[str, Any]:
    return {
        "binaryThreshold": {"value": 200, "mode": "binary_inverted"},
        "connectedComponents": {"connectivity": 8, "minimumArea": 8},
        "canny": {
            "threshold1": 50,
            "threshold2": 150,
            "apertureSize": 3,
            "l2Gradient": False,
        },
        "houghLinesP": {
            "rho": 1,
            "thetaDegrees": 1,
            "threshold": 30,
            "minimumLineLength": 20,
            "maximumLineGap": 4,
        },
        "textCandidateHeuristic": {
            "minimumArea": 8,
            "maximumArea": 200,
            "maximumWidth": 20,
            "maximumHeight": 20,
        },
    }


def preprocessing_result_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-preprocessing/cases/{definition.preprocessing_result_name}"


def load_preprocessing_result(definition: FixtureDefinition) -> tuple[Path, bytes, dict[str, Any]]:
    validate_preprocessing_fixtures()
    path = PREPROCESSING_ROOT / definition.preprocessing_result_name
    path = resolve_canonical_input(path, PREPROCESSING_ROOT, "preprocessing result")
    data, value = read_json_bytes(path, "VisualPreprocessingResult")
    if (
        value.get("requestId") != definition.case_id
        or value.get("subjectPack") != definition.subject_pack
        or value.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualPreprocessingResult identity is not admitted.")
    return path, data, value


def select_two_x_crop(preprocessing_result: dict[str, Any]) -> dict[str, Any]:
    crops = preprocessing_result.get("cropArtifacts")
    if not isinstance(crops, list):
        raise ValueError("VisualPreprocessingResult cropArtifacts are required.")
    selected = [crop for crop in crops if isinstance(crop, dict) and crop.get("scale") == 2]
    if len(selected) != 1:
        raise ValueError("Visual structure extraction requires exactly one scale=2 crop.")
    return selected[0]


def build_request(definition: FixtureDefinition) -> dict[str, Any]:
    _, preprocessing_bytes, preprocessing_result = load_preprocessing_result(definition)
    crop = select_two_x_crop(preprocessing_result)
    return {
        "schemaVersion": "1.0",
        "kind": "visual-structure-extraction-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
        },
        "preprocessingResult": {
            "artifactRef": preprocessing_result_ref(definition),
            "rawByteSha256": sha256_bytes(preprocessing_bytes),
            "requestId": preprocessing_result["requestId"],
        },
        "crop": {
            "artifactRef": crop["artifactRef"],
            "scale": crop["scale"],
            "rawByteSha256": crop["rawByteSha256"],
            "decodedRgbPixelSha256": crop["decodedRgbPixelSha256"],
            "pixelSize": crop["pixelSize"],
        },
        "extractionPolicy": extraction_policy(),
        "egressPolicy": {"allowCloud": False},
        "requestedAt": definition.requested_at,
    }


def validate_request(request: dict[str, Any], definition: FixtureDefinition) -> None:
    if not isinstance(request, dict):
        raise ValueError("VisualStructureExtractionRequest must be an object.")
    require_exact_keys(
        request,
        {
            "schemaVersion", "kind", "requestId", "subjectPack", "fixtureKind",
            "dataClassification", "preprocessingResult", "crop", "extractionPolicy",
            "egressPolicy", "requestedAt",
        },
        "VisualStructureExtractionRequest",
    )
    expected_scalars = {
        "schemaVersion": "1.0",
        "kind": "visual-structure-extraction-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "requestedAt": definition.requested_at,
    }
    for field, expected in expected_scalars.items():
        if request.get(field) != expected:
            raise ValueError(f"VisualStructureExtractionRequest {field} is not admitted.")
    classification = request.get("dataClassification")
    if classification != {
        "level": "public",
        "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
    }:
        raise ValueError("VisualStructureExtractionRequest must be explicitly public and fully synthetic.")
    if request.get("egressPolicy") != {"allowCloud": False}:
        raise ValueError("VisualStructureExtractionRequest cloud egress must remain disabled.")
    if request.get("extractionPolicy") != extraction_policy():
        raise ValueError("VisualStructureExtractionRequest algorithm policy drifted.")
    preprocessing = request.get("preprocessingResult")
    if not isinstance(preprocessing, dict):
        raise ValueError("VisualStructureExtractionRequest preprocessingResult is required.")
    require_exact_keys(preprocessing, {"artifactRef", "rawByteSha256", "requestId"}, "preprocessingResult")
    if (
        preprocessing.get("artifactRef") != preprocessing_result_ref(definition)
        or preprocessing.get("requestId") != definition.case_id
        or not is_sha256(preprocessing.get("rawByteSha256"))
    ):
        raise ValueError("VisualStructureExtractionRequest preprocessing result identity is not admitted.")
    crop = request.get("crop")
    if not isinstance(crop, dict):
        raise ValueError("VisualStructureExtractionRequest crop is required.")
    require_exact_keys(
        crop,
        {"artifactRef", "scale", "rawByteSha256", "decodedRgbPixelSha256", "pixelSize"},
        "crop",
    )
    if crop.get("scale") != 2:
        raise ValueError("VisualStructureExtractionRequest requires the canonical scale=2 crop.")
    for field in ("rawByteSha256", "decodedRgbPixelSha256"):
        if not is_sha256(crop.get(field)):
            raise ValueError(f"VisualStructureExtractionRequest crop {field} is invalid.")
    pixel_size = crop.get("pixelSize")
    if (
        not isinstance(pixel_size, dict)
        or set(pixel_size) != {"width", "height"}
        or any(type(pixel_size.get(field)) is not int or pixel_size[field] <= 0 for field in ("width", "height"))
    ):
        raise ValueError("VisualStructureExtractionRequest crop pixelSize is invalid.")


def normalize_line(raw: np.ndarray) -> tuple[int, int, int, int]:
    values = tuple(int(value) for value in raw.reshape(-1))
    if len(values) != 4:
        raise ValueError("OpenCV Hough line output has an unexpected shape.")
    x1, y1, x2, y2 = values
    if (x2, y2) < (x1, y1):
        return x2, y2, x1, y1
    return x1, y1, x2, y2


def extract_candidates(image_rgb: np.ndarray, policy: dict[str, Any]) -> tuple[list[dict], list[dict], list[dict]]:
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    threshold_policy = policy["binaryThreshold"]
    _, foreground = cv2.threshold(
        gray,
        threshold_policy["value"],
        255,
        cv2.THRESH_BINARY_INV,
    )
    component_policy = policy["connectedComponents"]
    _, _, stats, _ = cv2.connectedComponentsWithStats(
        foreground,
        connectivity=component_policy["connectivity"],
    )
    region_values = [
        tuple(int(value) for value in row)
        for row in stats[1:]
        if int(row[4]) >= component_policy["minimumArea"]
    ]
    region_values.sort(key=lambda value: (value[1], value[0], value[2], value[3], value[4]))
    regions = [
        {
            "candidateId": f"region-{index:03d}",
            "bbox": {"x": x, "y": y, "width": width, "height": height},
            "foregroundArea": area,
        }
        for index, (x, y, width, height, area) in enumerate(region_values, start=1)
    ]

    canny = policy["canny"]
    edges = cv2.Canny(
        gray,
        canny["threshold1"],
        canny["threshold2"],
        apertureSize=canny["apertureSize"],
        L2gradient=canny["l2Gradient"],
    )
    hough = policy["houghLinesP"]
    raw_lines = cv2.HoughLinesP(
        edges,
        hough["rho"],
        math.pi / 180 * hough["thetaDegrees"],
        threshold=hough["threshold"],
        minLineLength=hough["minimumLineLength"],
        maxLineGap=hough["maximumLineGap"],
    )
    normalized = set()
    if raw_lines is not None:
        normalized = {normalize_line(raw) for raw in raw_lines}
    line_values = sorted(normalized, key=lambda value: (value[1], value[0], value[3], value[2]))
    lines = []
    for index, (x1, y1, x2, y2) in enumerate(line_values, start=1):
        lines.append({
            "candidateId": f"line-{index:03d}",
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "lengthSquared": (x2 - x1) ** 2 + (y2 - y1) ** 2,
        })

    text_policy = policy["textCandidateHeuristic"]
    text_regions = []
    for region in regions:
        bbox = region["bbox"]
        area = region["foregroundArea"]
        if (
            text_policy["minimumArea"] <= area <= text_policy["maximumArea"]
            and bbox["width"] <= text_policy["maximumWidth"]
            and bbox["height"] <= text_policy["maximumHeight"]
        ):
            text_regions.append({
                "candidateId": f"text-region-{len(text_regions) + 1:03d}",
                "sourceRegionRef": region["candidateId"],
                "bbox": bbox,
                "foregroundArea": area,
                "heuristicOnly": True,
            })
    return lines, regions, text_regions


def compile_request(request_path: Path, fixture_root: Path) -> dict[str, Any]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    assert_within(request_path, fixture_root, "structure extraction request")
    request_bytes, request = read_json_bytes(request_path, "VisualStructureExtractionRequest")
    definition = DEFINITION_BY_ID.get(request.get("requestId"))
    if definition is None or request_path.name != definition.request_name:
        raise ValueError("VisualStructureExtractionRequest fixture identity is not admitted.")
    validate_request(request, definition)

    _, preprocessing_bytes, preprocessing_result = load_preprocessing_result(definition)
    preprocessing_contract = request["preprocessingResult"]
    if sha256_bytes(preprocessing_bytes) != preprocessing_contract["rawByteSha256"]:
        raise ValueError("VisualStructureExtractionRequest preprocessing result raw-byte SHA-256 drifted.")
    crop_authority = select_two_x_crop(preprocessing_result)
    if request["crop"] != {
        "artifactRef": crop_authority["artifactRef"],
        "scale": 2,
        "rawByteSha256": crop_authority["rawByteSha256"],
        "decodedRgbPixelSha256": crop_authority["decodedRgbPixelSha256"],
        "pixelSize": crop_authority["pixelSize"],
    }:
        raise ValueError("VisualStructureExtractionRequest crop binding drifted from preprocessing authority.")
    crop_path = resolve_bound_file(PREPROCESSING_ROOT, crop_authority["artifactRef"], "scale=2 crop")
    crop_bytes = crop_path.read_bytes()
    if sha256_bytes(crop_bytes) != crop_authority["rawByteSha256"]:
        raise ValueError("Scale=2 crop raw-byte SHA-256 drifted.")
    crop_image = decode_png(crop_bytes, "scale=2 crop")
    if decoded_pixel_sha256(crop_image) != crop_authority["decodedRgbPixelSha256"]:
        raise ValueError("Scale=2 crop decoded RGB pixel SHA-256 drifted.")
    if {"width": crop_image.width, "height": crop_image.height} != crop_authority["pixelSize"]:
        raise ValueError("Scale=2 crop dimensions drifted.")

    lines, regions, text_regions = extract_candidates(
        np.asarray(crop_image, dtype=np.uint8),
        request["extractionPolicy"],
    )
    if not lines or not regions:
        raise ValueError("Visual structure extraction must produce non-empty line and region candidates.")
    return {
        "schemaVersion": "1.0",
        "kind": "visual-structure-extraction-result",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "preprocessingResult": preprocessing_contract,
        "crop": request["crop"],
        "coordinateSpace": "crop_pixel",
        "lineSegmentCandidates": lines,
        "connectedRegionCandidates": regions,
        "textRegionCandidates": text_regions,
        "summary": {
            "lineSegmentCount": len(lines),
            "connectedRegionCount": len(regions),
            "textRegionCandidateCount": len(text_regions),
        },
        "dispositions": {
            "ocrDisposition": "not_attempted",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        },
        "algorithmParameters": {
            "policySha256": sha256_bytes(stable_json_bytes(request["extractionPolicy"])),
        },
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "deterministic-local-visual-structure-extractor",
            "engineVersion": "1.0.0",
            "components": [
                {"name": "opencv", "version": cv2.__version__},
                {"name": "pillow", "version": pillow_version},
            ],
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": definition.requested_at,
    }


def bind_local_file(
    root: Path,
    reference: str,
    expected_sha256: str,
    label: str,
    referenced_paths: set[Path],
    referenced_identities: set[tuple[int, int]],
) -> Path:
    if not is_sha256(expected_sha256):
        raise ValueError(f"{label} inventory SHA-256 is invalid.")
    path = resolve_bound_file(root, reference, label)
    if path in referenced_paths:
        raise ValueError(f"{label} is referenced more than once.")
    identity = file_identity(path)
    if identity in referenced_identities:
        raise ValueError(f"{label} aliases another authority file by physical identity.")
    if sha256_bytes(path.read_bytes()) != expected_sha256:
        raise ValueError(f"{label} raw bytes do not match inventory SHA-256.")
    referenced_paths.add(path)
    referenced_identities.add(identity)
    return path


def validate_canonical_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    inventory_path = resolve_bound_file(fixture_root, INVENTORY_NAME, "structure extraction inventory")
    _, inventory = read_json_bytes(inventory_path, "VisualStructureExtractionCaseInventory")
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualStructureExtractionCaseInventory",
    )
    if (
        inventory.get("schemaVersion") != "1.0"
        or inventory.get("kind") != "visual-structure-extraction-case-inventory"
        or inventory.get("fixtureSetId") != "synthetic-visual-structure-extraction-v1"
        or inventory.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualStructureExtractionCaseInventory metadata is not admitted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("VisualStructureExtractionCaseInventory coverage drifted.")
    if [entry.get("subjectPack") for entry in entries] != [
        definition.subject_pack for definition in DEFINITIONS
    ]:
        raise ValueError("VisualStructureExtractionCaseInventory subject packs or order drifted.")

    referenced_paths = {inventory_path}
    referenced_identities = {file_identity(inventory_path)}
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        if not isinstance(entry, dict):
            raise ValueError("VisualStructureExtractionCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId", "subjectPack", "preprocessingResultRef", "preprocessingResultSha256",
                "requestRef", "requestSha256", "expectedResultRef", "expectedResultSha256",
            },
            "VisualStructureExtractionCaseInventory entry",
        )
        if entry.get("caseId") != definition.case_id or entry.get("subjectPack") != definition.subject_pack:
            raise ValueError("VisualStructureExtractionCaseInventory entry identity drifted.")
        if entry.get("preprocessingResultRef") != preprocessing_result_ref(definition):
            raise ValueError("VisualStructureExtractionCaseInventory preprocessing result ref drifted.")
        _, preprocessing_bytes, _ = load_preprocessing_result(definition)
        if sha256_bytes(preprocessing_bytes) != entry.get("preprocessingResultSha256"):
            raise ValueError(f"{definition.case_id} preprocessing result hash drifted from inventory.")
        if entry.get("requestRef") != definition.request_name or entry.get("expectedResultRef") != definition.result_name:
            raise ValueError("VisualStructureExtractionCaseInventory local refs drifted.")
        request_path = bind_local_file(
            fixture_root, entry["requestRef"], entry["requestSha256"],
            f"{definition.case_id} request", referenced_paths, referenced_identities,
        )
        result_path = bind_local_file(
            fixture_root, entry["expectedResultRef"], entry["expectedResultSha256"],
            f"{definition.case_id} result", referenced_paths, referenced_identities,
        )
        _, expected_result = read_json_bytes(result_path, f"{definition.case_id} result")
        compiled_result = compile_request(request_path, fixture_root)
        if expected_result != compiled_result:
            raise ValueError(f"{definition.case_id} result computed fields drifted from deterministic runtime.")

    authority_paths = set()
    for candidate in fixture_root.rglob("*"):
        if candidate.is_symlink() or (
            hasattr(candidate, "is_junction") and candidate.is_junction()
        ):
            raise ValueError("Structure extraction authority must not use symlink or junction aliases.")
        if candidate.is_file():
            authority_paths.add(candidate.resolve())
    if authority_paths != referenced_paths:
        raise ValueError("Structure extraction inventory must exactly cover canonical authority files.")
    return len(entries)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root.mkdir(parents=True, exist_ok=True)
    entries = []
    for definition in DEFINITIONS:
        request = build_request(definition)
        request_bytes = stable_json_bytes(request)
        request_path = fixture_root / definition.request_name
        atomic_write(request_path, request_bytes)
        result = compile_request(request_path, fixture_root)
        result_bytes = stable_json_bytes(result)
        atomic_write(fixture_root / definition.result_name, result_bytes)
        entries.append({
            "caseId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "preprocessingResultRef": preprocessing_result_ref(definition),
            "preprocessingResultSha256": request["preprocessingResult"]["rawByteSha256"],
            "requestRef": definition.request_name,
            "requestSha256": sha256_bytes(request_bytes),
            "expectedResultRef": definition.result_name,
            "expectedResultSha256": sha256_bytes(result_bytes),
        })
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-structure-extraction-case-inventory",
        "fixtureSetId": "synthetic-visual-structure-extraction-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    return validate_canonical_fixtures(fixture_root)


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    inventory_path = (CANONICAL_ROOT / INVENTORY_NAME).resolve(strict=True)
    fixture_root = CANONICAL_ROOT.resolve(strict=True)
    validate_canonical_fixtures(fixture_root)
    request_path = resolve_canonical_input(request_path, fixture_root, "structure extraction request")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
    entry = next((item for item in inventory["entries"] if item["requestRef"] == request_path.name), None)
    if entry is None or sha256_bytes(request_path.read_bytes()) != entry["requestSha256"]:
        raise ValueError("Structure extraction request is not admitted by the canonical inventory.")
    output_dir = output_dir.resolve()
    assert_output_outside_repo(output_dir)
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    result = compile_request(request_path, fixture_root)
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    try:
        result_name = DEFINITION_BY_ID[result["requestId"]].result_name
        atomic_write(stage / result_name, stable_json_bytes(result))
        os.replace(stage, output_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output_dir / DEFINITION_BY_ID[result["requestId"]].result_name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deterministic local visual structure extraction runtime.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--request", type=Path)
    parser.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic visual structure extraction fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic visual structure extraction fixtures.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
