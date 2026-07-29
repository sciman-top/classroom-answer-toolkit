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


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent.resolve()
PREPROCESSOR_TOOL_ROOT = TOOL_ROOT.parent / "visual-preprocessor"
STRUCTURE_TOOL_ROOT = TOOL_ROOT.parent / "visual-structure-extractor"
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))
sys.path.insert(0, str(STRUCTURE_TOOL_ROOT))

from visual_preprocessor import (  # noqa: E402
    CANONICAL_ROOT as PREPROCESSING_ROOT,
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
from visual_structure_extractor import (  # noqa: E402
    CANONICAL_ROOT as STRUCTURE_ROOT,
    validate_canonical_fixtures as validate_structure_fixtures,
)

from runtime_identity import (  # noqa: E402
    PARAMETERS,
    engine_provenance,
    runtime_policy,
    validate_runtime_identity,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-ocr-observation" / "cases").resolve()
INVENTORY_NAME = "visual-ocr-observation-case-inventory.json"
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
    def structure_result_name(self) -> str:
        return f"{self.case_id}.visual-structure-extraction-result.json"

    @property
    def request_name(self) -> str:
        return f"{self.case_id}.visual-ocr-observation-request.json"

    @property
    def result_name(self) -> str:
        return f"{self.case_id}.visual-ocr-observation-result.json"


DEFINITIONS = (
    FixtureDefinition("math-function-graph", "math-answer", "2026-07-27T03:00:00Z"),
    FixtureDefinition("junior-instrument-scale", "junior-physics-answer", "2026-07-27T03:01:00Z"),
    FixtureDefinition("senior-circuit-label", "senior-physics-answer", "2026-07-27T03:02:00Z"),
    FixtureDefinition("junior-readable-measurement", "junior-physics-answer", "2026-07-29T03:03:00Z"),
)
DEFINITION_BY_ID = {definition.case_id: definition for definition in DEFINITIONS}


def preprocessing_result_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-preprocessing/cases/{definition.preprocessing_result_name}"


def structure_result_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-structure-extraction/cases/{definition.structure_result_name}"


def load_preprocessing_result(
    definition: FixtureDefinition,
) -> tuple[bytes, dict[str, Any]]:
    validate_preprocessing_fixtures()
    path = resolve_canonical_input(
        PREPROCESSING_ROOT / definition.preprocessing_result_name,
        PREPROCESSING_ROOT,
        "preprocessing result",
    )
    data, value = read_json_bytes(path, "VisualPreprocessingResult")
    if (
        value.get("requestId") != definition.case_id
        or value.get("subjectPack") != definition.subject_pack
        or value.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualPreprocessingResult identity is not admitted.")
    return data, value


def load_structure_result(
    definition: FixtureDefinition,
) -> tuple[bytes, dict[str, Any]]:
    validate_structure_fixtures()
    path = resolve_canonical_input(
        STRUCTURE_ROOT / definition.structure_result_name,
        STRUCTURE_ROOT,
        "structure extraction result",
    )
    data, value = read_json_bytes(path, "VisualStructureExtractionResult")
    if (
        value.get("requestId") != definition.case_id
        or value.get("subjectPack") != definition.subject_pack
        or value.get("fixtureKind") != "synthetic_fixture"
        or value.get("dispositions")
        != {
            "ocrDisposition": "not_attempted",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        }
    ):
        raise ValueError("VisualStructureExtractionResult identity or disposition is not admitted.")
    return data, value


def select_two_x_crop(preprocessing_result: dict[str, Any]) -> dict[str, Any]:
    crops = preprocessing_result.get("cropArtifacts")
    if not isinstance(crops, list):
        raise ValueError("VisualPreprocessingResult cropArtifacts are required.")
    selected = [crop for crop in crops if isinstance(crop, dict) and crop.get("scale") == 2]
    if len(selected) != 1:
        raise ValueError("Visual OCR observation requires exactly one scale=2 crop.")
    return selected[0]


def upstream_contract(reference: str, data: bytes, request_id: str) -> dict[str, Any]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "requestId": request_id,
    }


def build_request(definition: FixtureDefinition) -> dict[str, Any]:
    preprocessing_bytes, preprocessing_result = load_preprocessing_result(definition)
    structure_bytes, _ = load_structure_result(definition)
    crop = select_two_x_crop(preprocessing_result)
    return {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-observation-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
        },
        "preprocessingResult": upstream_contract(
            preprocessing_result_ref(definition),
            preprocessing_bytes,
            definition.case_id,
        ),
        "crop": {
            "artifactRef": crop["artifactRef"],
            "scale": crop["scale"],
            "rawByteSha256": crop["rawByteSha256"],
            "decodedRgbPixelSha256": crop["decodedRgbPixelSha256"],
            "pixelSize": crop["pixelSize"],
        },
        "structureExtractionResult": upstream_contract(
            structure_result_ref(definition),
            structure_bytes,
            definition.case_id,
        ),
        "runtimePolicy": runtime_policy(),
        "egressPolicy": {"allowCloud": False},
        "requestedAt": definition.requested_at,
    }


def validate_upstream_contract(value: Any, label: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"VisualOcrObservationRequest {label} is required.")
    require_exact_keys(value, {"artifactRef", "rawByteSha256", "requestId"}, label)
    if not isinstance(value.get("artifactRef"), str) or not value["artifactRef"]:
        raise ValueError(f"VisualOcrObservationRequest {label} artifactRef is invalid.")
    if not is_sha256(value.get("rawByteSha256")):
        raise ValueError(f"VisualOcrObservationRequest {label} rawByteSha256 is invalid.")
    if not isinstance(value.get("requestId"), str) or not value["requestId"]:
        raise ValueError(f"VisualOcrObservationRequest {label} requestId is invalid.")


def validate_request(request: dict[str, Any], definition: FixtureDefinition) -> None:
    require_exact_keys(
        request,
        {
            "schemaVersion", "kind", "requestId", "subjectPack", "fixtureKind",
            "dataClassification", "preprocessingResult", "crop",
            "structureExtractionResult", "runtimePolicy", "egressPolicy", "requestedAt",
        },
        "VisualOcrObservationRequest",
    )
    expected_scalars = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-observation-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "requestedAt": definition.requested_at,
    }
    for field, expected in expected_scalars.items():
        if request.get(field) != expected:
            raise ValueError(f"VisualOcrObservationRequest {field} is not admitted.")
    if request.get("dataClassification") != {
        "level": "public",
        "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
    }:
        raise ValueError("VisualOcrObservationRequest must remain public and fully synthetic.")
    if request.get("egressPolicy") != {"allowCloud": False}:
        raise ValueError("VisualOcrObservationRequest cloud egress must remain disabled.")
    if request.get("runtimePolicy") != runtime_policy():
        raise ValueError("VisualOcrObservationRequest runtime policy drifted.")
    validate_upstream_contract(request.get("preprocessingResult"), "preprocessingResult")
    validate_upstream_contract(
        request.get("structureExtractionResult"), "structureExtractionResult"
    )
    preprocessing_contract = request["preprocessingResult"]
    if (
        preprocessing_contract["artifactRef"] != preprocessing_result_ref(definition)
        or preprocessing_contract["requestId"] != definition.case_id
    ):
        raise ValueError("VisualOcrObservationRequest preprocessing identity is not admitted.")
    structure_contract = request["structureExtractionResult"]
    if (
        structure_contract["artifactRef"] != structure_result_ref(definition)
        or structure_contract["requestId"] != definition.case_id
    ):
        raise ValueError("VisualOcrObservationRequest structure identity is not admitted.")
    crop = request.get("crop")
    if not isinstance(crop, dict):
        raise ValueError("VisualOcrObservationRequest crop is required.")
    require_exact_keys(
        crop,
        {"artifactRef", "scale", "rawByteSha256", "decodedRgbPixelSha256", "pixelSize"},
        "crop",
    )
    if crop.get("scale") != 2:
        raise ValueError("VisualOcrObservationRequest requires the canonical scale=2 crop.")
    if not is_sha256(crop.get("rawByteSha256")) or not is_sha256(
        crop.get("decodedRgbPixelSha256")
    ):
        raise ValueError("VisualOcrObservationRequest crop hashes are invalid.")
    pixel_size = crop.get("pixelSize")
    if (
        not isinstance(pixel_size, dict)
        or set(pixel_size) != {"width", "height"}
        or any(
            type(pixel_size.get(field)) is not int or pixel_size[field] <= 0
            for field in ("width", "height")
        )
    ):
        raise ValueError("VisualOcrObservationRequest crop pixelSize is invalid.")


def normalize_observations(raw_result: Any) -> list[dict[str, Any]]:
    if raw_result is None:
        return []
    if not isinstance(raw_result, (list, tuple)):
        raise ValueError("RapidOCR result must be a list or null.")
    normalized = []
    for entry in raw_result:
        if not isinstance(entry, (list, tuple)) or len(entry) < 3:
            raise ValueError("RapidOCR observation has an unexpected shape.")
        box, observed_text, confidence_value = entry[0], entry[1], entry[2]
        if not isinstance(observed_text, str) or not observed_text:
            raise ValueError("RapidOCR observation text must be non-empty.")
        confidence = float(confidence_value)
        if not math.isfinite(confidence) or confidence < 0 or confidence > 1:
            raise ValueError("RapidOCR observation confidence is invalid.")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            raise ValueError("RapidOCR observation quad must contain exactly four points.")
        quad = []
        for point in box:
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                raise ValueError("RapidOCR observation point must contain x and y.")
            x, y = float(point[0]), float(point[1])
            if not math.isfinite(x) or not math.isfinite(y) or x < 0 or y < 0:
                raise ValueError("RapidOCR observation coordinates are invalid.")
            quad.append({"x": round(x, 6), "y": round(y, 6)})
        normalized.append(
            {
                "quad": quad,
                "observedText": observed_text,
                "confidence": round(confidence, 8),
            }
        )
    normalized.sort(
        key=lambda item: (
            min(point["y"] for point in item["quad"]),
            min(point["x"] for point in item["quad"]),
            item["observedText"],
            item["confidence"],
            stable_json_bytes(item["quad"]),
        )
    )
    return [
        {"observationId": f"ocr-observation-{index:03d}", **observation}
        for index, observation in enumerate(normalized, start=1)
    ]


def compile_request(request_path: Path, fixture_root: Path) -> dict[str, Any]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    assert_within(request_path, fixture_root, "OCR observation request")
    request_bytes, request = read_json_bytes(request_path, "VisualOcrObservationRequest")
    definition = DEFINITION_BY_ID.get(request.get("requestId"))
    if definition is None or request_path.name != definition.request_name:
        raise ValueError("VisualOcrObservationRequest fixture identity is not admitted.")
    validate_request(request, definition)

    preprocessing_bytes, preprocessing_result = load_preprocessing_result(definition)
    if sha256_bytes(preprocessing_bytes) != request["preprocessingResult"]["rawByteSha256"]:
        raise ValueError("OCR request preprocessing result raw-byte SHA-256 drifted.")
    structure_bytes, structure_result = load_structure_result(definition)
    if sha256_bytes(structure_bytes) != request["structureExtractionResult"]["rawByteSha256"]:
        raise ValueError("OCR request structure result raw-byte SHA-256 drifted.")

    crop_authority = select_two_x_crop(preprocessing_result)
    expected_crop = {
        "artifactRef": crop_authority["artifactRef"],
        "scale": 2,
        "rawByteSha256": crop_authority["rawByteSha256"],
        "decodedRgbPixelSha256": crop_authority["decodedRgbPixelSha256"],
        "pixelSize": crop_authority["pixelSize"],
    }
    if request["crop"] != expected_crop or structure_result.get("crop") != expected_crop:
        raise ValueError("OCR request crop binding drifted from upstream authority.")
    crop_path = resolve_bound_file(PREPROCESSING_ROOT, crop_authority["artifactRef"], "scale=2 crop")
    crop_bytes = crop_path.read_bytes()
    if sha256_bytes(crop_bytes) != crop_authority["rawByteSha256"]:
        raise ValueError("OCR crop raw-byte SHA-256 drifted.")
    crop_image = decode_png(crop_bytes, "OCR scale=2 crop")
    if decoded_pixel_sha256(crop_image) != crop_authority["decodedRgbPixelSha256"]:
        raise ValueError("OCR crop decoded RGB pixel SHA-256 drifted.")
    if {"width": crop_image.width, "height": crop_image.height} != crop_authority["pixelSize"]:
        raise ValueError("OCR crop dimensions drifted.")

    engine = validate_runtime_identity()
    raw_result, _ = engine(
        crop_bytes,
        box_thresh=PARAMETERS["boxThreshold"],
        unclip_ratio=PARAMETERS["unclipRatio"],
        text_score=PARAMETERS["textScore"],
    )
    observations = normalize_observations(raw_result)
    observed_texts = [item["observedText"] for item in observations]
    return {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-observation-result",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "preprocessingResult": request["preprocessingResult"],
        "crop": request["crop"],
        "structureExtractionResult": request["structureExtractionResult"],
        "coordinateSpace": "crop_pixel",
        "observations": observations,
        "summary": {
            "observationCount": len(observations),
            "observedTextSha256": sha256_bytes(stable_json_bytes(observed_texts)),
        },
        "dispositions": {
            "observationStatus": "completed",
            "groundTruthAvailable": False,
            "acceptanceDisposition": "not_evaluated",
            "requiresHumanReview": True,
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        },
        "runtimePolicySha256": sha256_bytes(stable_json_bytes(request["runtimePolicy"])),
        "engineProvenance": engine_provenance(),
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
    inventory_path = resolve_bound_file(fixture_root, INVENTORY_NAME, "OCR observation inventory")
    _, inventory = read_json_bytes(inventory_path, "VisualOcrObservationCaseInventory")
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualOcrObservationCaseInventory",
    )
    if (
        inventory.get("schemaVersion") != "1.0"
        or inventory.get("kind") != "visual-ocr-observation-case-inventory"
        or inventory.get("fixtureSetId") != "synthetic-visual-ocr-observation-v1"
        or inventory.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualOcrObservationCaseInventory metadata is not admitted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("VisualOcrObservationCaseInventory coverage drifted.")
    if [entry.get("subjectPack") for entry in entries] != [
        definition.subject_pack for definition in DEFINITIONS
    ]:
        raise ValueError("VisualOcrObservationCaseInventory subject packs or order drifted.")

    referenced_paths = {inventory_path}
    referenced_identities = {file_identity(inventory_path)}
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        if not isinstance(entry, dict):
            raise ValueError("VisualOcrObservationCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId", "subjectPack", "preprocessingResultRef",
                "preprocessingResultSha256", "structureExtractionResultRef",
                "structureExtractionResultSha256", "requestRef", "requestSha256",
                "expectedResultRef", "expectedResultSha256",
            },
            "VisualOcrObservationCaseInventory entry",
        )
        if entry.get("caseId") != definition.case_id or entry.get("subjectPack") != definition.subject_pack:
            raise ValueError("VisualOcrObservationCaseInventory entry identity drifted.")
        preprocessing_bytes, _ = load_preprocessing_result(definition)
        structure_bytes, _ = load_structure_result(definition)
        if (
            entry.get("preprocessingResultRef") != preprocessing_result_ref(definition)
            or entry.get("preprocessingResultSha256") != sha256_bytes(preprocessing_bytes)
        ):
            raise ValueError("OCR inventory preprocessing authority drifted.")
        if (
            entry.get("structureExtractionResultRef") != structure_result_ref(definition)
            or entry.get("structureExtractionResultSha256") != sha256_bytes(structure_bytes)
        ):
            raise ValueError("OCR inventory structure authority drifted.")
        if entry.get("requestRef") != definition.request_name or entry.get("expectedResultRef") != definition.result_name:
            raise ValueError("OCR inventory local refs drifted.")
        request_path = bind_local_file(
            fixture_root, entry["requestRef"], entry["requestSha256"],
            f"{definition.case_id} request", referenced_paths, referenced_identities,
        )
        result_path = bind_local_file(
            fixture_root, entry["expectedResultRef"], entry["expectedResultSha256"],
            f"{definition.case_id} result", referenced_paths, referenced_identities,
        )
        _, expected_result = read_json_bytes(result_path, f"{definition.case_id} result")
        if expected_result != compile_request(request_path, fixture_root):
            raise ValueError(f"{definition.case_id} result computed fields drifted from runtime.")

    authority_paths = set()
    for candidate in fixture_root.rglob("*"):
        if candidate.is_symlink() or (
            hasattr(candidate, "is_junction") and candidate.is_junction()
        ):
            raise ValueError("OCR observation authority must not use symlink or junction aliases.")
        if candidate.is_file():
            authority_paths.add(candidate.resolve())
    if authority_paths != referenced_paths:
        raise ValueError("OCR observation inventory must exactly cover canonical authority files.")
    return len(entries)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root.mkdir(parents=True, exist_ok=True)
    entries = []
    for definition in DEFINITIONS:
        request = build_request(definition)
        request_bytes = stable_json_bytes(request)
        request_path = fixture_root / definition.request_name
        atomic_write(request_path, request_bytes)
        result_bytes = stable_json_bytes(compile_request(request_path, fixture_root))
        atomic_write(fixture_root / definition.result_name, result_bytes)
        entries.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "preprocessingResultRef": request["preprocessingResult"]["artifactRef"],
                "preprocessingResultSha256": request["preprocessingResult"]["rawByteSha256"],
                "structureExtractionResultRef": request["structureExtractionResult"]["artifactRef"],
                "structureExtractionResultSha256": request["structureExtractionResult"]["rawByteSha256"],
                "requestRef": definition.request_name,
                "requestSha256": sha256_bytes(request_bytes),
                "expectedResultRef": definition.result_name,
                "expectedResultSha256": sha256_bytes(result_bytes),
            }
        )
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-observation-case-inventory",
        "fixtureSetId": "synthetic-visual-ocr-observation-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    return validate_canonical_fixtures(fixture_root)


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    inventory_path = (CANONICAL_ROOT / INVENTORY_NAME).resolve(strict=True)
    fixture_root = CANONICAL_ROOT.resolve(strict=True)
    validate_canonical_fixtures(fixture_root)
    request_path = resolve_canonical_input(request_path, fixture_root, "OCR observation request")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
    entry = next((item for item in inventory["entries"] if item["requestRef"] == request_path.name), None)
    if entry is None or sha256_bytes(request_path.read_bytes()) != entry["requestSha256"]:
        raise ValueError("OCR observation request is not admitted by the canonical inventory.")
    output_dir = output_dir.resolve()
    assert_output_outside_repo(output_dir)
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    if not output_dir.parent.is_dir():
        raise ValueError("Runtime output parent directory must already exist.")
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
    parser = argparse.ArgumentParser(description="Deterministic local visual OCR observation runtime.")
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
        print(f"Materialized and validated {count} synthetic visual OCR observation fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic visual OCR observation fixtures.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
