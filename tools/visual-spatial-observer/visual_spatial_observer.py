from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
import tempfile
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_EVEN
from pathlib import Path
from typing import Any


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent.resolve()
PREPROCESSOR_TOOL_ROOT = TOOL_ROOT.parent / "visual-preprocessor"
STRUCTURE_TOOL_ROOT = TOOL_ROOT.parent / "visual-structure-extractor"
OCR_TOOL_ROOT = TOOL_ROOT.parent / "visual-ocr-observer"
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))
sys.path.insert(0, str(STRUCTURE_TOOL_ROOT))
sys.path.insert(0, str(OCR_TOOL_ROOT))

from visual_preprocessor import (  # noqa: E402
    assert_output_outside_repo,
    atomic_write,
    file_identity,
    is_sha256,
    read_json_bytes,
    require_exact_keys,
    resolve_bound_file,
    resolve_canonical_input,
    sha256_bytes,
    stable_json_bytes,
)
from visual_structure_extractor import (  # noqa: E402
    CANONICAL_ROOT as STRUCTURE_ROOT,
    validate_canonical_fixtures as validate_structure_fixtures,
)
from visual_ocr_observer import (  # noqa: E402
    CANONICAL_ROOT as OCR_ROOT,
    bind_local_file,
    validate_canonical_fixtures as validate_ocr_fixtures,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-spatial-observation" / "cases").resolve()
INVENTORY_NAME = "visual-spatial-observation-case-inventory.json"
SUBJECT_PACKS = (
    "math-answer",
    "junior-physics-answer",
    "senior-physics-answer",
)
RELATIONS = (
    "equal_bounds",
    "observation_contains_region",
    "region_contains_observation",
    "overlap",
    "disjoint",
)
INTERPRETER = {"implementation": "CPython", "version": "3.13.7"}


@dataclass(frozen=True)
class FixtureDefinition:
    case_id: str
    subject_pack: str
    requested_at: str
    generated_at: str

    @property
    def structure_result_name(self) -> str:
        return f"{self.case_id}.visual-structure-extraction-result.json"

    @property
    def ocr_result_name(self) -> str:
        return f"{self.case_id}.visual-ocr-observation-result.json"

    @property
    def request_name(self) -> str:
        return f"{self.case_id}.visual-spatial-observation-request.json"

    @property
    def result_name(self) -> str:
        return f"{self.case_id}.visual-spatial-observation-result.json"


DEFINITIONS = (
    FixtureDefinition(
        "math-function-graph", "math-answer",
        "2026-07-28T01:00:00Z", "2026-07-28T01:00:01Z",
    ),
    FixtureDefinition(
        "junior-instrument-scale", "junior-physics-answer",
        "2026-07-28T01:01:00Z", "2026-07-28T01:01:01Z",
    ),
    FixtureDefinition(
        "senior-circuit-label", "senior-physics-answer",
        "2026-07-28T01:02:00Z", "2026-07-28T01:02:01Z",
    ),
)
DEFINITION_BY_ID = {definition.case_id: definition for definition in DEFINITIONS}


@dataclass(frozen=True)
class UpstreamAuthority:
    structure_bytes: bytes
    structure_result: dict[str, Any]
    ocr_bytes: bytes
    ocr_result: dict[str, Any]


def structure_result_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-structure-extraction/cases/{definition.structure_result_name}"


def ocr_result_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-ocr-observation/cases/{definition.ocr_result_name}"


def geometry_policy() -> dict[str, Any]:
    return {
        "quadBoundsMode": "axis_aligned_min_max",
        "rectangleEdgeMode": "half_open",
        "touchingRelation": "disjoint",
        "enumerationOrder": ["text_region_candidate_id", "ocr_observation_id"],
        "coordinatePrecision": 6,
        "ratioPrecision": 8,
    }


def interpreter_identity() -> dict[str, str]:
    return {
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }


def validate_interpreter() -> None:
    if interpreter_identity() != INTERPRETER:
        raise ValueError("Visual spatial observer Python interpreter drifted from admitted policy.")


def upstream_contract(reference: str, data: bytes, request_id: str) -> dict[str, Any]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "requestId": request_id,
    }


def validate_upstream_authorities() -> dict[str, UpstreamAuthority]:
    validate_structure_fixtures()
    validate_ocr_fixtures()
    authorities = {}
    for definition in DEFINITIONS:
        structure_path = resolve_bound_file(
            STRUCTURE_ROOT,
            definition.structure_result_name,
            f"{definition.case_id} structure result",
        )
        structure_bytes, structure_result = read_json_bytes(
            structure_path, "VisualStructureExtractionResult"
        )
        ocr_path = resolve_bound_file(
            OCR_ROOT,
            definition.ocr_result_name,
            f"{definition.case_id} OCR result",
        )
        ocr_bytes, ocr_result = read_json_bytes(ocr_path, "VisualOcrObservationResult")
        expected_identity = {
            "requestId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "fixtureKind": "synthetic_fixture",
        }
        for field, expected in expected_identity.items():
            if structure_result.get(field) != expected or ocr_result.get(field) != expected:
                raise ValueError(f"{definition.case_id} upstream identity drifted.")
        if structure_result.get("crop") != ocr_result.get("crop"):
            raise ValueError(f"{definition.case_id} upstream crop authorities differ.")
        if structure_result.get("dispositions") != {
            "ocrDisposition": "not_attempted",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        }:
            raise ValueError(f"{definition.case_id} structure dispositions are not admitted.")
        if ocr_result.get("dispositions") != {
            "observationStatus": "completed",
            "groundTruthAvailable": False,
            "acceptanceDisposition": "not_evaluated",
            "requiresHumanReview": True,
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        }:
            raise ValueError(f"{definition.case_id} OCR dispositions are not admitted.")
        if ocr_result.get("structureExtractionResult") != upstream_contract(
            structure_result_ref(definition), structure_bytes, definition.case_id
        ):
            raise ValueError(f"{definition.case_id} OCR sibling structure binding drifted.")
        authorities[definition.case_id] = UpstreamAuthority(
            structure_bytes, structure_result, ocr_bytes, ocr_result
        )
    return authorities


def build_request(
    definition: FixtureDefinition,
    authorities: dict[str, UpstreamAuthority] | None = None,
) -> dict[str, Any]:
    authority = (authorities or validate_upstream_authorities())[definition.case_id]
    return {
        "schemaVersion": "1.0",
        "kind": "visual-spatial-observation-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
        },
        "structureExtractionResult": upstream_contract(
            structure_result_ref(definition), authority.structure_bytes, definition.case_id
        ),
        "ocrObservationResult": upstream_contract(
            ocr_result_ref(definition), authority.ocr_bytes, definition.case_id
        ),
        "crop": authority.structure_result["crop"],
        "geometryPolicy": geometry_policy(),
        "egressPolicy": {"allowCloud": False},
        "requestedAt": definition.requested_at,
    }


def validate_upstream_contract(value: Any, label: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"VisualSpatialObservationRequest {label} is required.")
    require_exact_keys(value, {"artifactRef", "rawByteSha256", "requestId"}, label)
    if not isinstance(value.get("artifactRef"), str) or not value["artifactRef"]:
        raise ValueError(f"VisualSpatialObservationRequest {label} artifactRef is invalid.")
    if not is_sha256(value.get("rawByteSha256")):
        raise ValueError(f"VisualSpatialObservationRequest {label} rawByteSha256 is invalid.")
    if not isinstance(value.get("requestId"), str) or not value["requestId"]:
        raise ValueError(f"VisualSpatialObservationRequest {label} requestId is invalid.")


def validate_crop(value: Any) -> None:
    if not isinstance(value, dict):
        raise ValueError("VisualSpatialObservationRequest crop is required.")
    require_exact_keys(
        value,
        {"artifactRef", "scale", "rawByteSha256", "decodedRgbPixelSha256", "pixelSize"},
        "crop",
    )
    if value.get("scale") != 2:
        raise ValueError("VisualSpatialObservationRequest requires the canonical scale=2 crop.")
    if not is_sha256(value.get("rawByteSha256")) or not is_sha256(
        value.get("decodedRgbPixelSha256")
    ):
        raise ValueError("VisualSpatialObservationRequest crop hashes are invalid.")
    pixel_size = value.get("pixelSize")
    if (
        not isinstance(pixel_size, dict)
        or set(pixel_size) != {"width", "height"}
        or any(
            type(pixel_size.get(field)) is not int or pixel_size[field] <= 0
            for field in ("width", "height")
        )
    ):
        raise ValueError("VisualSpatialObservationRequest crop pixelSize is invalid.")


def validate_request(request: dict[str, Any], definition: FixtureDefinition) -> None:
    require_exact_keys(
        request,
        {
            "schemaVersion", "kind", "requestId", "subjectPack", "fixtureKind",
            "dataClassification", "structureExtractionResult", "ocrObservationResult",
            "crop", "geometryPolicy", "egressPolicy", "requestedAt",
        },
        "VisualSpatialObservationRequest",
    )
    expected_scalars = {
        "schemaVersion": "1.0",
        "kind": "visual-spatial-observation-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "requestedAt": definition.requested_at,
    }
    for field, expected in expected_scalars.items():
        if request.get(field) != expected:
            raise ValueError(f"VisualSpatialObservationRequest {field} is not admitted.")
    if request.get("dataClassification") != {
        "level": "public",
        "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
    }:
        raise ValueError("VisualSpatialObservationRequest must remain public and synthetic.")
    if request.get("geometryPolicy") != geometry_policy():
        raise ValueError("VisualSpatialObservationRequest geometry policy drifted.")
    if request.get("egressPolicy") != {"allowCloud": False}:
        raise ValueError("VisualSpatialObservationRequest cloud egress must remain disabled.")
    validate_upstream_contract(request.get("structureExtractionResult"), "structureExtractionResult")
    validate_upstream_contract(request.get("ocrObservationResult"), "ocrObservationResult")
    validate_crop(request.get("crop"))


def decimal_number(value: Any, label: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric.")
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError(f"{label} must be finite.")
    return result


def normalized_number(value: Decimal, precision: int) -> float:
    quantum = Decimal(1).scaleb(-precision)
    return float(value.quantize(quantum, rounding=ROUND_HALF_EVEN))


def validate_region_bounds(bbox: Any, pixel_size: dict[str, int]) -> dict[str, Decimal]:
    if not isinstance(bbox, dict) or set(bbox) != {"x", "y", "width", "height"}:
        raise ValueError("TextRegionCandidate bbox is invalid.")
    bounds = {field: decimal_number(bbox.get(field), f"bbox.{field}") for field in bbox}
    if bounds["x"] < 0 or bounds["y"] < 0 or bounds["width"] <= 0 or bounds["height"] <= 0:
        raise ValueError("TextRegionCandidate bbox is negative or degenerate.")
    bounds["right"] = bounds["x"] + bounds["width"]
    bounds["bottom"] = bounds["y"] + bounds["height"]
    if bounds["right"] > pixel_size["width"] or bounds["bottom"] > pixel_size["height"]:
        raise ValueError("TextRegionCandidate bbox escapes the crop coordinate space.")
    return bounds


def quad_bounds(quad: Any, pixel_size: dict[str, int]) -> dict[str, Decimal]:
    if not isinstance(quad, list) or len(quad) != 4:
        raise ValueError("OCR observation quad must contain exactly four points.")
    points = []
    for point in quad:
        if not isinstance(point, dict) or set(point) != {"x", "y"}:
            raise ValueError("OCR observation quad point is invalid.")
        x = decimal_number(point.get("x"), "quad.x")
        y = decimal_number(point.get("y"), "quad.y")
        if x < 0 or y < 0 or x > pixel_size["width"] or y > pixel_size["height"]:
            raise ValueError("OCR observation quad escapes the crop coordinate space.")
        points.append((x, y))
    left = min(point[0] for point in points)
    top = min(point[1] for point in points)
    right = max(point[0] for point in points)
    bottom = max(point[1] for point in points)
    if right <= left or bottom <= top:
        raise ValueError("OCR observation axis-aligned bounds are degenerate.")
    return {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
        "right": right,
        "bottom": bottom,
    }


def contains(outer: dict[str, Decimal], inner: dict[str, Decimal]) -> bool:
    return (
        outer["x"] <= inner["x"]
        and outer["y"] <= inner["y"]
        and outer["right"] >= inner["right"]
        and outer["bottom"] >= inner["bottom"]
    )


def measure_pair(
    text_region: dict[str, Any],
    observation: dict[str, Any],
    pixel_size: dict[str, int],
) -> dict[str, Any]:
    region = validate_region_bounds(text_region.get("bbox"), pixel_size)
    observed = quad_bounds(observation.get("quad"), pixel_size)
    intersection_width = max(
        Decimal(0), min(region["right"], observed["right"]) - max(region["x"], observed["x"])
    )
    intersection_height = max(
        Decimal(0), min(region["bottom"], observed["bottom"]) - max(region["y"], observed["y"])
    )
    intersection_area = intersection_width * intersection_height
    region_area = region["width"] * region["height"]
    observation_area = observed["width"] * observed["height"]
    if all(region[field] == observed[field] for field in ("x", "y", "right", "bottom")):
        relation = "equal_bounds"
    elif contains(observed, region):
        relation = "observation_contains_region"
    elif contains(region, observed):
        relation = "region_contains_observation"
    elif intersection_area > 0:
        relation = "overlap"
    else:
        relation = "disjoint"
    region_center_x = region["x"] + region["width"] / 2
    region_center_y = region["y"] + region["height"] / 2
    observed_center_x = observed["x"] + observed["width"] / 2
    observed_center_y = observed["y"] + observed["height"] / 2
    centroid_distance_squared = (
        (region_center_x - observed_center_x) ** 2
        + (region_center_y - observed_center_y) ** 2
    )
    coordinate_precision = geometry_policy()["coordinatePrecision"]
    ratio_precision = geometry_policy()["ratioPrecision"]
    return {
        "textRegionCandidateRef": text_region["candidateId"],
        "ocrObservationRef": observation["observationId"],
        "ocrAxisAlignedBounds": {
            field: normalized_number(observed[field], coordinate_precision)
            for field in ("x", "y", "width", "height")
        },
        "intersectionArea": normalized_number(intersection_area, coordinate_precision),
        "intersectionOverTextRegionAreaRatio": normalized_number(
            intersection_area / region_area, ratio_precision
        ),
        "intersectionOverOcrBoundsAreaRatio": normalized_number(
            intersection_area / observation_area, ratio_precision
        ),
        "centroidDistanceSquared": normalized_number(
            centroid_distance_squared, coordinate_precision
        ),
        "spatialRelation": relation,
    }


def compile_request(
    request_path: Path,
    fixture_root: Path,
    authorities: dict[str, UpstreamAuthority] | None = None,
) -> dict[str, Any]:
    validate_interpreter()
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    request_path.relative_to(fixture_root)
    request_bytes, request = read_json_bytes(request_path, "VisualSpatialObservationRequest")
    definition = DEFINITION_BY_ID.get(request.get("requestId"))
    if definition is None or request_path.name != definition.request_name:
        raise ValueError("VisualSpatialObservationRequest fixture identity is not admitted.")
    validate_request(request, definition)
    authority = (authorities or validate_upstream_authorities())[definition.case_id]
    expected_structure = upstream_contract(
        structure_result_ref(definition), authority.structure_bytes, definition.case_id
    )
    expected_ocr = upstream_contract(
        ocr_result_ref(definition), authority.ocr_bytes, definition.case_id
    )
    if request["structureExtractionResult"] != expected_structure:
        raise ValueError("Spatial request structure result authority drifted.")
    if request["ocrObservationResult"] != expected_ocr:
        raise ValueError("Spatial request OCR result authority drifted.")
    if request["crop"] != authority.structure_result["crop"] or request["crop"] != authority.ocr_result["crop"]:
        raise ValueError("Spatial request crop binding drifted from upstream authority.")

    text_regions = authority.structure_result.get("textRegionCandidates")
    observations = authority.ocr_result.get("observations")
    if not isinstance(text_regions, list) or not isinstance(observations, list):
        raise ValueError("Spatial upstream candidate or observation collection is invalid.")
    sorted_regions = sorted(text_regions, key=lambda value: value.get("candidateId", ""))
    sorted_observations = sorted(observations, key=lambda value: value.get("observationId", ""))
    if sorted_regions != text_regions or sorted_observations != observations:
        raise ValueError("Spatial upstream candidate or observation ordering drifted.")
    measurements = []
    for text_region in text_regions:
        for observation in observations:
            measurements.append(
                measure_pair(text_region, observation, request["crop"]["pixelSize"])
            )
    measurements = [
        {"measurementId": f"spatial-measurement-{index:03d}", **measurement}
        for index, measurement in enumerate(measurements, start=1)
    ]
    relation_counts = {relation: 0 for relation in RELATIONS}
    for measurement in measurements:
        relation_counts[measurement["spatialRelation"]] += 1
    expected_pair_count = len(text_regions) * len(observations)
    if len(measurements) != expected_pair_count:
        raise ValueError("Spatial measurement Cartesian coverage is incomplete.")
    return {
        "schemaVersion": "1.0",
        "kind": "visual-spatial-observation-result",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "structureExtractionResult": expected_structure,
        "ocrObservationResult": expected_ocr,
        "crop": request["crop"],
        "coordinateSpace": "crop_pixel",
        "measurements": measurements,
        "summary": {
            "textRegionCandidateCount": len(text_regions),
            "ocrObservationCount": len(observations),
            "expectedPairCount": expected_pair_count,
            "measurementCount": len(measurements),
            "relationCounts": relation_counts,
        },
        "dispositions": {
            "measurementStatus": "completed",
            "associationDisposition": "not_decided",
            "layoutDisposition": "not_inferred",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
            "requiresHumanReview": True,
        },
        "geometryPolicySha256": sha256_bytes(stable_json_bytes(geometry_policy())),
        "engineProvenance": {
            "engineKind": "deterministic_geometry",
            "engineId": "visual-spatial-observer",
            "engineVersion": "1.0.0",
            "interpreter": dict(INTERPRETER),
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": definition.generated_at,
    }


def validate_canonical_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    authorities = validate_upstream_authorities()
    inventory_path = resolve_bound_file(fixture_root, INVENTORY_NAME, "spatial observation inventory")
    _, inventory = read_json_bytes(inventory_path, "VisualSpatialObservationCaseInventory")
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualSpatialObservationCaseInventory",
    )
    if (
        inventory.get("schemaVersion") != "1.0"
        or inventory.get("kind") != "visual-spatial-observation-case-inventory"
        or inventory.get("fixtureSetId") != "synthetic-visual-spatial-observation-v1"
        or inventory.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualSpatialObservationCaseInventory metadata is not admitted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != 3:
        raise ValueError("VisualSpatialObservationCaseInventory must contain exactly three entries.")
    if [entry.get("subjectPack") for entry in entries] != list(SUBJECT_PACKS):
        raise ValueError("VisualSpatialObservationCaseInventory subject packs or order drifted.")
    referenced_paths = {inventory_path}
    referenced_identities = {file_identity(inventory_path)}
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        if not isinstance(entry, dict):
            raise ValueError("VisualSpatialObservationCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId", "subjectPack", "structureExtractionResultRef",
                "structureExtractionResultSha256", "ocrObservationResultRef",
                "ocrObservationResultSha256", "requestRef", "requestSha256",
                "expectedResultRef", "expectedResultSha256",
            },
            "VisualSpatialObservationCaseInventory entry",
        )
        authority = authorities[definition.case_id]
        if entry.get("caseId") != definition.case_id or entry.get("subjectPack") != definition.subject_pack:
            raise ValueError("VisualSpatialObservationCaseInventory entry identity drifted.")
        if (
            entry.get("structureExtractionResultRef") != structure_result_ref(definition)
            or entry.get("structureExtractionResultSha256") != sha256_bytes(authority.structure_bytes)
        ):
            raise ValueError("Spatial inventory structure authority drifted.")
        if (
            entry.get("ocrObservationResultRef") != ocr_result_ref(definition)
            or entry.get("ocrObservationResultSha256") != sha256_bytes(authority.ocr_bytes)
        ):
            raise ValueError("Spatial inventory OCR authority drifted.")
        if entry.get("requestRef") != definition.request_name or entry.get("expectedResultRef") != definition.result_name:
            raise ValueError("Spatial inventory local refs drifted.")
        request_path = bind_local_file(
            fixture_root, entry["requestRef"], entry["requestSha256"],
            f"{definition.case_id} request", referenced_paths, referenced_identities,
        )
        result_path = bind_local_file(
            fixture_root, entry["expectedResultRef"], entry["expectedResultSha256"],
            f"{definition.case_id} result", referenced_paths, referenced_identities,
        )
        _, expected_result = read_json_bytes(result_path, f"{definition.case_id} result")
        if expected_result != compile_request(request_path, fixture_root, authorities):
            raise ValueError(f"{definition.case_id} result computed fields drifted from runtime.")
    authority_paths = set()
    for candidate in fixture_root.rglob("*"):
        if candidate.is_symlink() or (
            hasattr(candidate, "is_junction") and candidate.is_junction()
        ):
            raise ValueError("Spatial observation authority must not use symlink or junction aliases.")
        if candidate.is_file():
            authority_paths.add(candidate.resolve())
    if authority_paths != referenced_paths:
        raise ValueError("Spatial observation inventory must exactly cover canonical authority files.")
    return len(entries)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    validate_interpreter()
    fixture_root.mkdir(parents=True, exist_ok=True)
    authorities = validate_upstream_authorities()
    entries = []
    for definition in DEFINITIONS:
        authority = authorities[definition.case_id]
        request = build_request(definition, authorities)
        request_bytes = stable_json_bytes(request)
        request_path = fixture_root / definition.request_name
        atomic_write(request_path, request_bytes)
        result_bytes = stable_json_bytes(compile_request(request_path, fixture_root, authorities))
        atomic_write(fixture_root / definition.result_name, result_bytes)
        entries.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "structureExtractionResultRef": request["structureExtractionResult"]["artifactRef"],
                "structureExtractionResultSha256": sha256_bytes(authority.structure_bytes),
                "ocrObservationResultRef": request["ocrObservationResult"]["artifactRef"],
                "ocrObservationResultSha256": sha256_bytes(authority.ocr_bytes),
                "requestRef": definition.request_name,
                "requestSha256": sha256_bytes(request_bytes),
                "expectedResultRef": definition.result_name,
                "expectedResultSha256": sha256_bytes(result_bytes),
            }
        )
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-spatial-observation-case-inventory",
        "fixtureSetId": "synthetic-visual-spatial-observation-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    return validate_canonical_fixtures(fixture_root)


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    fixture_root = CANONICAL_ROOT.resolve(strict=True)
    inventory_path = (fixture_root / INVENTORY_NAME).resolve(strict=True)
    validate_canonical_fixtures(fixture_root)
    request_path = resolve_canonical_input(request_path, fixture_root, "spatial observation request")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
    entry = next((item for item in inventory["entries"] if item["requestRef"] == request_path.name), None)
    if entry is None or sha256_bytes(request_path.read_bytes()) != entry["requestSha256"]:
        raise ValueError("Spatial observation request is not admitted by the canonical inventory.")
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
    parser = argparse.ArgumentParser(description="Deterministic local visual spatial observer.")
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
        print(f"Materialized and validated {count} synthetic visual spatial observation fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic visual spatial observation fixtures.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
