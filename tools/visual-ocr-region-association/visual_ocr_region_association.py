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
OCR_TOOL_ROOT = TOOL_ROOT.parent / "visual-ocr-observer"
SPATIAL_TOOL_ROOT = TOOL_ROOT.parent / "visual-spatial-observer"
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))
sys.path.insert(0, str(OCR_TOOL_ROOT))
sys.path.insert(0, str(SPATIAL_TOOL_ROOT))

from visual_preprocessor import (  # noqa: E402
    atomic_write,
    file_identity,
    is_sha256,
    read_json_bytes,
    require_exact_keys,
    resolve_bound_file,
    sha256_bytes,
    stable_json_bytes,
)
from visual_spatial_observer import (  # noqa: E402
    CANONICAL_ROOT as SPATIAL_ROOT,
    INVENTORY_NAME as SPATIAL_INVENTORY_NAME,
    validate_canonical_fixtures as validate_spatial_fixtures,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-ocr-region-association" / "cases").resolve()
INVENTORY_NAME = "visual-ocr-region-association-case-inventory.json"
REPORT_NAME = "visual-ocr-region-association-report.json"
SUBJECT_PACKS = (
    "math-answer",
    "junior-physics-answer",
    "senior-physics-answer",
)
INTERPRETER = {"implementation": "CPython", "version": "3.13.7"}
REPORT_GENERATED_AT = "2026-07-28T07:10:00Z"


@dataclass(frozen=True)
class FixtureDefinition:
    case_id: str
    subject_pack: str
    requested_at: str
    generated_at: str

    @property
    def request_name(self) -> str:
        return f"{self.case_id}.visual-ocr-region-association-request.json"

    @property
    def result_name(self) -> str:
        return f"{self.case_id}.visual-ocr-region-association-result.json"

    @property
    def spatial_result_name(self) -> str:
        return f"{self.case_id}.visual-spatial-observation-result.json"


DEFINITIONS = (
    FixtureDefinition(
        "math-function-graph",
        "math-answer",
        "2026-07-28T07:00:00Z",
        "2026-07-28T07:00:01Z",
    ),
    FixtureDefinition(
        "junior-instrument-scale",
        "junior-physics-answer",
        "2026-07-28T07:01:00Z",
        "2026-07-28T07:01:01Z",
    ),
    FixtureDefinition(
        "senior-circuit-label",
        "senior-physics-answer",
        "2026-07-28T07:02:00Z",
        "2026-07-28T07:02:01Z",
    ),
)
DEFINITION_BY_ID = {definition.case_id: definition for definition in DEFINITIONS}


@dataclass(frozen=True)
class UpstreamAuthority:
    structure_path: Path
    structure_bytes: bytes
    structure_result: dict[str, Any]
    ocr_path: Path
    ocr_bytes: bytes
    ocr_result: dict[str, Any]
    spatial_path: Path
    spatial_bytes: bytes
    spatial_result: dict[str, Any]


@dataclass(frozen=True)
class UpstreamSet:
    fixtures: dict[str, UpstreamAuthority]
    snapshots: tuple[tuple[Path, bytes, str], ...]


@dataclass(frozen=True)
class ReportCompilation:
    report: dict[str, Any]
    snapshots: tuple[tuple[Path, bytes, str], ...]


def association_policy() -> dict[str, Any]:
    return {
        "eligibleMeasurement": "positive_intersection_non_disjoint",
        "cardinality": "bidirectional_unique",
        "ambiguityDisposition": "fail_closed",
        "zeroEndpointDisposition": "unavailable",
        "noEligibleEdgeDisposition": "unmatched",
        "ordering": ["text_region_candidate_id", "ocr_observation_id"],
        "ratioPrecision": 8,
    }


def validate_runtime_identity() -> None:
    actual = {
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }
    if actual != INTERPRETER:
        raise ValueError("Visual OCR-region association interpreter drifted from admitted policy.")


def artifact_contract(reference: str, data: bytes) -> dict[str, str]:
    return {"artifactRef": reference, "rawByteSha256": sha256_bytes(data)}


def upstream_contract(reference: str, data: bytes, request_id: str) -> dict[str, str]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "requestId": request_id,
    }


def structure_result_ref(case_id: str) -> str:
    return f"eval/visual-structure-extraction/cases/{case_id}.visual-structure-extraction-result.json"


def ocr_result_ref(case_id: str) -> str:
    return f"eval/visual-ocr-observation/cases/{case_id}.visual-ocr-observation-result.json"


def spatial_result_ref(case_id: str) -> str:
    return f"eval/visual-spatial-observation/cases/{case_id}.visual-spatial-observation-result.json"


def validate_snapshots(snapshots: tuple[tuple[Path, bytes, str], ...]) -> None:
    for path, expected_bytes, label in snapshots:
        if path.read_bytes() != expected_bytes:
            raise ValueError(f"{label} bytes drifted during association compilation.")


def _inventory_entry(inventory: dict[str, Any], case_id: str, label: str) -> dict[str, Any]:
    entries = inventory.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"{label} entries are invalid.")
    matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("caseId") == case_id]
    if len(matches) != 1:
        raise ValueError(f"{label} case coverage drifted for {case_id}.")
    return matches[0]


def _load_repo_binding(
    contract: Any,
    expected_reference: str,
    request_id: str,
    label: str,
) -> tuple[Path, bytes, dict[str, Any]]:
    if not isinstance(contract, dict):
        raise ValueError(f"{label} contract is invalid.")
    require_exact_keys(contract, {"artifactRef", "rawByteSha256", "requestId"}, label)
    if contract.get("artifactRef") != expected_reference or contract.get("requestId") != request_id:
        raise ValueError(f"{label} reference or request identity drifted.")
    if not is_sha256(contract.get("rawByteSha256")):
        raise ValueError(f"{label} SHA-256 is invalid.")
    path = resolve_bound_file(REPO_ROOT, expected_reference, label)
    data, value = read_json_bytes(path, label)
    if sha256_bytes(data) != contract["rawByteSha256"]:
        raise ValueError(f"{label} raw-byte SHA-256 drifted.")
    return path, data, value


def _ordered_ids(values: Any, field: str, prefix: str, label: str) -> list[str]:
    if not isinstance(values, list):
        raise ValueError(f"{label} must be an array.")
    ids = [value.get(field) for value in values if isinstance(value, dict)]
    if (
        len(ids) != len(values)
        or any(not isinstance(value, str) or not value.startswith(prefix) for value in ids)
        or len(set(ids)) != len(ids)
        or ids != sorted(ids)
    ):
        raise ValueError(f"{label} IDs must be unique, sorted, and correctly prefixed.")
    return ids


def load_upstream_authorities() -> UpstreamSet:
    validate_runtime_identity()
    validate_spatial_fixtures()
    spatial_inventory_path = resolve_bound_file(
        SPATIAL_ROOT, SPATIAL_INVENTORY_NAME, "spatial observation inventory"
    )
    spatial_inventory_bytes, spatial_inventory = read_json_bytes(
        spatial_inventory_path, "VisualSpatialObservationCaseInventory"
    )
    fixtures: dict[str, UpstreamAuthority] = {}
    snapshots: list[tuple[Path, bytes, str]] = [
        (spatial_inventory_path, spatial_inventory_bytes, "Spatial observation inventory")
    ]
    for definition in DEFINITIONS:
        entry = _inventory_entry(
            spatial_inventory, definition.case_id, "VisualSpatialObservationCaseInventory"
        )
        if (
            entry.get("subjectPack") != definition.subject_pack
            or entry.get("expectedResultRef") != definition.spatial_result_name
            or not is_sha256(entry.get("expectedResultSha256"))
        ):
            raise ValueError(f"{definition.case_id} spatial inventory identity drifted.")
        spatial_path = resolve_bound_file(
            SPATIAL_ROOT, definition.spatial_result_name, f"{definition.case_id} spatial result"
        )
        spatial_bytes, spatial_result = read_json_bytes(
            spatial_path, "VisualSpatialObservationResult"
        )
        if sha256_bytes(spatial_bytes) != entry["expectedResultSha256"]:
            raise ValueError(f"{definition.case_id} spatial result bytes drifted from inventory.")
        expected_identity = {
            "requestId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "fixtureKind": "synthetic_fixture",
            "coordinateSpace": "crop_pixel",
        }
        if any(spatial_result.get(field) != value for field, value in expected_identity.items()):
            raise ValueError(f"{definition.case_id} spatial result identity drifted.")
        if spatial_result.get("dispositions") != {
            "measurementStatus": "completed",
            "associationDisposition": "not_decided",
            "layoutDisposition": "not_inferred",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
            "requiresHumanReview": True,
        }:
            raise ValueError(f"{definition.case_id} spatial dispositions are not admitted.")
        provenance = spatial_result.get("engineProvenance")
        if not isinstance(provenance, dict) or provenance.get("liveProvider") is not False or provenance.get("cloudEgress") is not False:
            raise ValueError(f"{definition.case_id} spatial provenance is not local-only.")

        structure_path, structure_bytes, structure_result = _load_repo_binding(
            spatial_result.get("structureExtractionResult"),
            structure_result_ref(definition.case_id),
            definition.case_id,
            f"{definition.case_id} structure result",
        )
        ocr_path, ocr_bytes, ocr_result = _load_repo_binding(
            spatial_result.get("ocrObservationResult"),
            ocr_result_ref(definition.case_id),
            definition.case_id,
            f"{definition.case_id} OCR result",
        )
        if spatial_result.get("crop") != structure_result.get("crop") or spatial_result.get("crop") != ocr_result.get("crop"):
            raise ValueError(f"{definition.case_id} upstream crop authority drifted.")
        candidate_ids = _ordered_ids(
            structure_result.get("textRegionCandidates"),
            "candidateId",
            "text-region-",
            f"{definition.case_id} text-region candidates",
        )
        observation_ids = _ordered_ids(
            ocr_result.get("observations"),
            "observationId",
            "ocr-observation-",
            f"{definition.case_id} OCR observations",
        )
        summary = spatial_result.get("summary")
        if not isinstance(summary, dict) or (
            summary.get("textRegionCandidateCount") != len(candidate_ids)
            or summary.get("ocrObservationCount") != len(observation_ids)
            or summary.get("expectedPairCount") != len(candidate_ids) * len(observation_ids)
        ):
            raise ValueError(f"{definition.case_id} spatial summary upstream counts drifted.")
        fixtures[definition.case_id] = UpstreamAuthority(
            structure_path,
            structure_bytes,
            structure_result,
            ocr_path,
            ocr_bytes,
            ocr_result,
            spatial_path,
            spatial_bytes,
            spatial_result,
        )
        snapshots.extend(
            (
                (structure_path, structure_bytes, f"{definition.case_id} structure result"),
                (ocr_path, ocr_bytes, f"{definition.case_id} OCR result"),
                (spatial_path, spatial_bytes, f"{definition.case_id} spatial result"),
            )
        )
    result = UpstreamSet(fixtures, tuple(snapshots))
    validate_snapshots(result.snapshots)
    return result


def build_request(definition: FixtureDefinition, upstream: UpstreamSet) -> dict[str, Any]:
    authority = upstream.fixtures[definition.case_id]
    return {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-region-association-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
        },
        "structureExtractionResult": upstream_contract(
            structure_result_ref(definition.case_id),
            authority.structure_bytes,
            definition.case_id,
        ),
        "ocrObservationResult": upstream_contract(
            ocr_result_ref(definition.case_id), authority.ocr_bytes, definition.case_id
        ),
        "spatialObservationResult": upstream_contract(
            spatial_result_ref(definition.case_id), authority.spatial_bytes, definition.case_id
        ),
        "crop": authority.spatial_result["crop"],
        "associationPolicy": association_policy(),
        "egressPolicy": {"allowCloud": False},
        "requestedAt": definition.requested_at,
    }


def validate_request(request: dict[str, Any], definition: FixtureDefinition) -> None:
    require_exact_keys(
        request,
        {
            "schemaVersion",
            "kind",
            "requestId",
            "subjectPack",
            "fixtureKind",
            "dataClassification",
            "structureExtractionResult",
            "ocrObservationResult",
            "spatialObservationResult",
            "crop",
            "associationPolicy",
            "egressPolicy",
            "requestedAt",
        },
        "VisualOcrRegionAssociationRequest",
    )
    expected = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-region-association-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
        },
        "associationPolicy": association_policy(),
        "egressPolicy": {"allowCloud": False},
        "requestedAt": definition.requested_at,
    }
    for field, value in expected.items():
        if request.get(field) != value:
            raise ValueError(f"VisualOcrRegionAssociationRequest {field} is not admitted.")


def rounded_ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        raise ValueError("Association ratio denominator must be positive.")
    return float(
        (Decimal(numerator) / Decimal(denominator)).quantize(
            Decimal("0.00000001"), rounding=ROUND_HALF_EVEN
        )
    )


def available_ratio(numerator: int, denominator: int) -> dict[str, Any]:
    if denominator == 0:
        return {"available": False}
    return {"available": True, "value": rounded_ratio(numerator, denominator)}


def apply_association_policy(
    candidate_ids: list[str],
    observation_ids: list[str],
    measurements: list[dict[str, Any]],
) -> dict[str, Any]:
    if candidate_ids != sorted(set(candidate_ids)) or observation_ids != sorted(set(observation_ids)):
        raise ValueError("Association endpoint IDs must be unique and sorted.")
    expected_pairs = {(candidate, observation) for candidate in candidate_ids for observation in observation_ids}
    actual_pairs: set[tuple[str, str]] = set()
    eligible = []
    measurement_fields = {
        "measurementId",
        "textRegionCandidateRef",
        "ocrObservationRef",
        "ocrAxisAlignedBounds",
        "intersectionArea",
        "intersectionOverTextRegionAreaRatio",
        "intersectionOverOcrBoundsAreaRatio",
        "centroidDistanceSquared",
        "spatialRelation",
    }
    for index, measurement in enumerate(measurements, start=1):
        if not isinstance(measurement, dict):
            raise ValueError("Association measurement must be an object.")
        require_exact_keys(measurement, measurement_fields, "Association measurement")
        if measurement.get("measurementId") != f"spatial-measurement-{index:03d}":
            raise ValueError("Association measurement ordering or IDs drifted.")
        pair = (
            measurement.get("textRegionCandidateRef"),
            measurement.get("ocrObservationRef"),
        )
        if pair not in expected_pairs or pair in actual_pairs:
            raise ValueError("Association measurement Cartesian coverage is invalid.")
        actual_pairs.add(pair)
        intersection = measurement.get("intersectionArea")
        region_ratio = measurement.get("intersectionOverTextRegionAreaRatio")
        ocr_ratio = measurement.get("intersectionOverOcrBoundsAreaRatio")
        relation = measurement.get("spatialRelation")
        if isinstance(intersection, bool) or not isinstance(intersection, (int, float)) or intersection < 0:
            raise ValueError("Association measurement intersection is invalid.")
        positive = intersection > 0
        non_disjoint = relation in {
            "equal_bounds",
            "observation_contains_region",
            "region_contains_observation",
            "overlap",
        }
        if positive != non_disjoint:
            raise ValueError("Association measurement relation conflicts with intersection area.")
        for ratio in (region_ratio, ocr_ratio):
            if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not 0 <= ratio <= 1:
                raise ValueError("Association measurement coverage ratio is invalid.")
            if (ratio > 0) != positive:
                raise ValueError("Association measurement coverage ratio conflicts with eligibility.")
        if positive:
            eligible.append(measurement)
    if actual_pairs != expected_pairs:
        raise ValueError("Association measurement Cartesian coverage is incomplete.")

    by_candidate = {candidate_id: [] for candidate_id in candidate_ids}
    by_observation = {observation_id: [] for observation_id in observation_ids}
    for measurement in eligible:
        by_candidate[measurement["textRegionCandidateRef"]].append(measurement)
        by_observation[measurement["ocrObservationRef"]].append(measurement)
    ambiguous_candidates = [key for key, values in by_candidate.items() if len(values) > 1]
    ambiguous_observations = [key for key, values in by_observation.items() if len(values) > 1]
    if ambiguous_candidates or ambiguous_observations:
        raise ValueError("Ambiguous OCR-region association conflicts fail closed.")

    associations = []
    for measurement in sorted(
        eligible,
        key=lambda value: (value["textRegionCandidateRef"], value["ocrObservationRef"]),
    ):
        associations.append(
            {
                "associationId": f"ocr-region-association-{len(associations) + 1:03d}",
                "textRegionCandidateRef": measurement["textRegionCandidateRef"],
                "ocrObservationRef": measurement["ocrObservationRef"],
                "spatialMeasurementRef": measurement["measurementId"],
                "intersectionArea": measurement["intersectionArea"],
                "intersectionOverTextRegionAreaRatio": measurement[
                    "intersectionOverTextRegionAreaRatio"
                ],
                "intersectionOverOcrBoundsAreaRatio": measurement[
                    "intersectionOverOcrBoundsAreaRatio"
                ],
                "spatialRelation": measurement["spatialRelation"],
            }
        )
    matched_candidates = {value["textRegionCandidateRef"] for value in associations}
    matched_observations = {value["ocrObservationRef"] for value in associations}
    unmatched_candidates = [value for value in candidate_ids if value not in matched_candidates]
    unmatched_observations = [value for value in observation_ids if value not in matched_observations]
    if not candidate_ids or not observation_ids:
        status = "unavailable"
    elif associations:
        status = "matched"
    else:
        status = "unmatched"
    return {
        "associations": associations,
        "unmatchedTextRegionCandidateRefs": unmatched_candidates,
        "unmatchedOcrObservationRefs": unmatched_observations,
        "summary": {
            "textRegionCandidateCount": len(candidate_ids),
            "ocrObservationCount": len(observation_ids),
            "eligibleMeasurementCount": len(eligible),
            "matchedAssociationCount": len(associations),
            "unmatchedTextRegionCandidateCount": len(unmatched_candidates),
            "unmatchedOcrObservationCount": len(unmatched_observations),
            "ambiguousEndpointCount": 0,
            "unavailableCaseCount": 1 if status == "unavailable" else 0,
            "associationRate": available_ratio(len(associations), len(observation_ids)),
        },
        "associationStatus": status,
    }


def compile_request(
    request_path: Path,
    fixture_root: Path,
    upstream: UpstreamSet | None = None,
) -> dict[str, Any]:
    validate_runtime_identity()
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    request_path.relative_to(fixture_root)
    request_bytes, request = read_json_bytes(request_path, "VisualOcrRegionAssociationRequest")
    definition = DEFINITION_BY_ID.get(request.get("requestId"))
    if definition is None or request_path.name != definition.request_name:
        raise ValueError("VisualOcrRegionAssociationRequest fixture identity is not admitted.")
    validate_request(request, definition)
    authorities = upstream or load_upstream_authorities()
    authority = authorities.fixtures[definition.case_id]
    expected = build_request(definition, authorities)
    for field in (
        "structureExtractionResult",
        "ocrObservationResult",
        "spatialObservationResult",
        "crop",
    ):
        if request.get(field) != expected[field]:
            raise ValueError(f"Association request {field} authority drifted.")
    candidate_ids = _ordered_ids(
        authority.structure_result.get("textRegionCandidates"),
        "candidateId",
        "text-region-",
        "Association text-region candidates",
    )
    observation_ids = _ordered_ids(
        authority.ocr_result.get("observations"),
        "observationId",
        "ocr-observation-",
        "Association OCR observations",
    )
    measurements = authority.spatial_result.get("measurements")
    if not isinstance(measurements, list):
        raise ValueError("Association spatial measurements are invalid.")
    policy_result = apply_association_policy(candidate_ids, observation_ids, measurements)
    validate_snapshots(authorities.snapshots)
    return {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-region-association-result",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "structureExtractionResult": request["structureExtractionResult"],
        "ocrObservationResult": request["ocrObservationResult"],
        "spatialObservationResult": request["spatialObservationResult"],
        "crop": request["crop"],
        "coordinateSpace": "crop_pixel",
        "associations": policy_result["associations"],
        "unmatchedTextRegionCandidateRefs": policy_result[
            "unmatchedTextRegionCandidateRefs"
        ],
        "unmatchedOcrObservationRefs": policy_result["unmatchedOcrObservationRefs"],
        "summary": policy_result["summary"],
        "dispositions": {
            "associationStatus": policy_result["associationStatus"],
            "diagnosticScope": "synthetic_fixture_association_policy",
            "acceptanceDisposition": "not_accepted",
            "requiresHumanReview": True,
            "ocrCorrectnessDisposition": "not_inferred",
            "layoutDisposition": "not_inferred",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        },
        "associationPolicySha256": sha256_bytes(stable_json_bytes(association_policy())),
        "engineProvenance": {
            "engineKind": "deterministic_association_policy",
            "engineId": "visual-ocr-region-association",
            "engineVersion": "1.0.0",
            "interpreter": dict(INTERPRETER),
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": definition.generated_at,
    }


def case_report_metrics(result: dict[str, Any]) -> dict[str, Any]:
    summary = result["summary"]
    status = result["dispositions"]["associationStatus"]
    return {
        "caseCount": 1,
        "matchedCaseCount": 1 if status == "matched" else 0,
        "unmatchedCaseCount": 1 if status == "unmatched" else 0,
        "ambiguousCaseCount": 0,
        "unavailableCaseCount": 1 if status == "unavailable" else 0,
        "textRegionCandidateCount": summary["textRegionCandidateCount"],
        "ocrObservationCount": summary["ocrObservationCount"],
        "matchedAssociationCount": summary["matchedAssociationCount"],
        "unmatchedTextRegionCandidateCount": summary[
            "unmatchedTextRegionCandidateCount"
        ],
        "unmatchedOcrObservationCount": summary["unmatchedOcrObservationCount"],
        "associationRate": summary["associationRate"],
    }


def aggregate_metrics(case_reports: list[dict[str, Any]]) -> dict[str, Any]:
    fields = (
        "caseCount",
        "matchedCaseCount",
        "unmatchedCaseCount",
        "ambiguousCaseCount",
        "unavailableCaseCount",
        "textRegionCandidateCount",
        "ocrObservationCount",
        "matchedAssociationCount",
        "unmatchedTextRegionCandidateCount",
        "unmatchedOcrObservationCount",
    )
    totals = {
        field: sum(report["metrics"][field] for report in case_reports) for field in fields
    }
    totals["associationRate"] = available_ratio(
        totals["matchedAssociationCount"], totals["ocrObservationCount"]
    )
    return totals


def validate_inventory(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualOcrRegionAssociationCaseInventory",
    )
    expected = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-region-association-case-inventory",
        "fixtureSetId": "synthetic-visual-ocr-region-association-v1",
        "fixtureKind": "synthetic_fixture",
    }
    if any(inventory.get(field) != value for field, value in expected.items()):
        raise ValueError("VisualOcrRegionAssociationCaseInventory identity drifted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("VisualOcrRegionAssociationCaseInventory coverage drifted.")
    if [entry.get("subjectPack") for entry in entries if isinstance(entry, dict)] != list(
        SUBJECT_PACKS
    ):
        raise ValueError("VisualOcrRegionAssociationCaseInventory subject order drifted.")
    return entries


def _compile_report_snapshot(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamSet | None = None,
) -> ReportCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    authorities = upstream or load_upstream_authorities()
    inventory_path = resolve_bound_file(
        fixture_root, INVENTORY_NAME, "OCR-region association inventory"
    )
    inventory_bytes, inventory = read_json_bytes(
        inventory_path, "VisualOcrRegionAssociationCaseInventory"
    )
    entries = validate_inventory(inventory)
    snapshots: list[tuple[Path, bytes, str]] = list(authorities.snapshots)
    snapshots.append((inventory_path, inventory_bytes, "Association inventory"))
    case_reports = []
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        if not isinstance(entry, dict):
            raise ValueError("VisualOcrRegionAssociationCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId",
                "subjectPack",
                "structureExtractionResultRef",
                "structureExtractionResultSha256",
                "ocrObservationResultRef",
                "ocrObservationResultSha256",
                "spatialObservationResultRef",
                "spatialObservationResultSha256",
                "requestRef",
                "requestSha256",
                "expectedResultRef",
                "expectedResultSha256",
            },
            "VisualOcrRegionAssociationCaseInventory entry",
        )
        authority = authorities.fixtures[definition.case_id]
        expected_bindings = {
            "caseId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "structureExtractionResultRef": structure_result_ref(definition.case_id),
            "structureExtractionResultSha256": sha256_bytes(authority.structure_bytes),
            "ocrObservationResultRef": ocr_result_ref(definition.case_id),
            "ocrObservationResultSha256": sha256_bytes(authority.ocr_bytes),
            "spatialObservationResultRef": spatial_result_ref(definition.case_id),
            "spatialObservationResultSha256": sha256_bytes(authority.spatial_bytes),
            "requestRef": definition.request_name,
            "expectedResultRef": definition.result_name,
        }
        for field, value in expected_bindings.items():
            if entry.get(field) != value:
                raise ValueError(f"{definition.case_id} association inventory {field} drifted.")
        if not is_sha256(entry.get("requestSha256")) or not is_sha256(
            entry.get("expectedResultSha256")
        ):
            raise ValueError(f"{definition.case_id} association inventory local hash is invalid.")
        request_path = resolve_bound_file(
            fixture_root, entry["requestRef"], f"{definition.case_id} association request"
        )
        result_path = resolve_bound_file(
            fixture_root, entry["expectedResultRef"], f"{definition.case_id} association result"
        )
        request_bytes = request_path.read_bytes()
        result_bytes, result = read_json_bytes(
            result_path, "VisualOcrRegionAssociationResult"
        )
        if sha256_bytes(request_bytes) != entry["requestSha256"]:
            raise ValueError(f"{definition.case_id} association request bytes drifted.")
        if sha256_bytes(result_bytes) != entry["expectedResultSha256"]:
            raise ValueError(f"{definition.case_id} association result bytes drifted.")
        compiled_result = compile_request(request_path, fixture_root, authorities)
        if result_bytes != stable_json_bytes(compiled_result) or result != compiled_result:
            raise ValueError(f"{definition.case_id} association result does not replay.")
        snapshots.extend(
            (
                (request_path, request_bytes, f"{definition.case_id} association request"),
                (result_path, result_bytes, f"{definition.case_id} association result"),
            )
        )
        case_reports.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "associationResult": upstream_contract(
                    f"eval/visual-ocr-region-association/cases/{definition.result_name}",
                    result_bytes,
                    definition.case_id,
                ),
                "associationStatus": result["dispositions"]["associationStatus"],
                "metrics": case_report_metrics(result),
            }
        )
    subject_reports = []
    for subject_pack in SUBJECT_PACKS:
        selected = [report for report in case_reports if report["subjectPack"] == subject_pack]
        if len(selected) != 1:
            raise ValueError(f"Association subject {subject_pack} coverage drifted.")
        subject_reports.append(
            {"subjectPack": subject_pack, "caseCount": 1, "metrics": aggregate_metrics(selected)}
        )
    report = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-region-association-report",
        "fixtureSetId": "synthetic-visual-ocr-region-association-v1",
        "fixtureKind": "synthetic_fixture",
        "sourceInventory": artifact_contract(
            f"eval/visual-ocr-region-association/cases/{INVENTORY_NAME}", inventory_bytes
        ),
        "caseReports": case_reports,
        "subjectReports": subject_reports,
        "totals": aggregate_metrics(case_reports),
        "associationPolicySha256": sha256_bytes(stable_json_bytes(association_policy())),
        "dispositions": {
            "diagnosticStatus": "completed",
            "diagnosticScope": "synthetic_fixture_association_policy",
            "acceptanceDisposition": "not_accepted",
            "requiresHumanReview": True,
            "ocrCorrectnessDisposition": "not_inferred",
            "layoutDisposition": "not_inferred",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
            "deliveryTrustDisposition": "not_projected",
            "wpfDisposition": "not_integrated",
            "liveAcceptanceDisposition": "not_accepted",
            "controlsDisposition": "not_verified",
            "eligible": False,
            "optimizationCandidateRefs": [],
        },
        "engineProvenance": {
            "engineKind": "deterministic_association_policy",
            "engineId": "visual-ocr-region-association",
            "engineVersion": "1.0.0",
            "interpreter": dict(INTERPRETER),
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": REPORT_GENERATED_AT,
    }
    compilation = ReportCompilation(report, tuple(snapshots))
    validate_snapshots(compilation.snapshots)
    return compilation


def compile_report(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamSet | None = None,
) -> dict[str, Any]:
    return _compile_report_snapshot(fixture_root, upstream).report


def validate_fixture_structure(fixture_root: Path) -> None:
    expected_names = {INVENTORY_NAME, REPORT_NAME}
    for definition in DEFINITIONS:
        expected_names.add(definition.request_name)
        expected_names.add(definition.result_name)
    actual_paths = list(fixture_root.rglob("*"))
    if any(
        path.is_dir()
        or path.is_symlink()
        or (hasattr(path, "is_junction") and path.is_junction())
        for path in actual_paths
    ):
        raise ValueError("Association authority cannot contain nested or alias entries.")
    if {path.name for path in actual_paths} != expected_names:
        raise ValueError("Association authority coverage drifted.")
    identities = [file_identity(path) for path in actual_paths]
    if len(set(identities)) != len(identities):
        raise ValueError("Association authority files must have unique physical identities.")


def validate_canonical_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    validate_runtime_identity()
    validate_fixture_structure(fixture_root)
    compilation = _compile_report_snapshot(fixture_root)
    report_path = resolve_bound_file(fixture_root, REPORT_NAME, "association report")
    report_bytes, report = read_json_bytes(report_path, "VisualOcrRegionAssociationReport")
    if report_bytes != stable_json_bytes(compilation.report) or report != compilation.report:
        raise ValueError("Association report does not deterministically replay.")
    snapshots = compilation.snapshots + ((report_path, report_bytes, "Association report"),)
    validate_snapshots(snapshots)
    validate_fixture_structure(fixture_root)
    return len(DEFINITIONS)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    validate_runtime_identity()
    fixture_root.mkdir(parents=True, exist_ok=True)
    upstream = load_upstream_authorities()
    entries = []
    for definition in DEFINITIONS:
        authority = upstream.fixtures[definition.case_id]
        request = build_request(definition, upstream)
        request_bytes = stable_json_bytes(request)
        request_path = fixture_root / definition.request_name
        atomic_write(request_path, request_bytes)
        result_bytes = stable_json_bytes(compile_request(request_path, fixture_root, upstream))
        atomic_write(fixture_root / definition.result_name, result_bytes)
        entries.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "structureExtractionResultRef": request["structureExtractionResult"]["artifactRef"],
                "structureExtractionResultSha256": sha256_bytes(authority.structure_bytes),
                "ocrObservationResultRef": request["ocrObservationResult"]["artifactRef"],
                "ocrObservationResultSha256": sha256_bytes(authority.ocr_bytes),
                "spatialObservationResultRef": request["spatialObservationResult"]["artifactRef"],
                "spatialObservationResultSha256": sha256_bytes(authority.spatial_bytes),
                "requestRef": definition.request_name,
                "requestSha256": sha256_bytes(request_bytes),
                "expectedResultRef": definition.result_name,
                "expectedResultSha256": sha256_bytes(result_bytes),
            }
        )
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-region-association-case-inventory",
        "fixtureSetId": "synthetic-visual-ocr-region-association-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    report = compile_report(fixture_root, upstream)
    atomic_write(fixture_root / REPORT_NAME, stable_json_bytes(report))
    return validate_canonical_fixtures(fixture_root)


def canonical_output_path(output_dir: Path) -> Path:
    absolute = Path(os.path.abspath(os.fspath(output_dir)))
    parent = absolute.parent.resolve(strict=True)
    output = parent / absolute.name
    try:
        output.relative_to(REPO_ROOT)
    except ValueError:
        pass
    else:
        raise ValueError("Runtime output directory must be outside the repository root.")
    if output.exists():
        raise ValueError("Runtime output directory must not already exist.")
    return output


def _run_diagnostics(output_dir: Path, fixture_root: Path) -> Path:
    output = canonical_output_path(output_dir)
    fixture_root = fixture_root.resolve(strict=True)
    validate_fixture_structure(fixture_root)
    compilation = _compile_report_snapshot(fixture_root)
    report_bytes = stable_json_bytes(compilation.report)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        stage_report = stage / REPORT_NAME
        atomic_write(stage_report, report_bytes)
        if stage_report.read_bytes() != report_bytes:
            raise ValueError("Staged association report bytes drifted before promotion.")
        validate_fixture_structure(fixture_root)
        validate_snapshots(compilation.snapshots)
        os.replace(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output / REPORT_NAME


def run_diagnostics(output_dir: Path) -> Path:
    validate_canonical_fixtures()
    return _run_diagnostics(output_dir, CANONICAL_ROOT)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synthetic OCR-region association diagnostics.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic OCR-region association fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic OCR-region association fixtures.")
        return 0
    report_path = run_diagnostics(args.out)
    print(json.dumps({"status": "ok", "reportPath": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
