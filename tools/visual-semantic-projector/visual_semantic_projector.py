from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent.resolve()
PREPROCESSOR_TOOL_ROOT = TOOL_ROOT.parent / "visual-preprocessor"
OCR_DIAGNOSTICS_TOOL_ROOT = TOOL_ROOT.parent / "visual-ocr-diagnostics"
TEXT_REGION_DIAGNOSTICS_TOOL_ROOT = TOOL_ROOT.parent / "visual-text-region-diagnostics"
ASSOCIATION_TOOL_ROOT = TOOL_ROOT.parent / "visual-ocr-region-association"
for tool_root in (
    PREPROCESSOR_TOOL_ROOT,
    OCR_DIAGNOSTICS_TOOL_ROOT,
    TEXT_REGION_DIAGNOSTICS_TOOL_ROOT,
    ASSOCIATION_TOOL_ROOT,
):
    sys.path.insert(0, str(tool_root))

from visual_preprocessor import (  # noqa: E402
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
from visual_ocr_diagnostics import (  # noqa: E402
    validate_canonical_fixtures as validate_ocr_diagnostic_fixtures,
)
from visual_text_region_diagnostics import (  # noqa: E402
    validate_canonical_fixtures as validate_text_region_diagnostic_fixtures,
)
from visual_ocr_region_association import (  # noqa: E402
    validate_canonical_fixtures as validate_association_fixtures,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-semantic-projection" / "cases").resolve()
INVENTORY_NAME = "visual-semantic-projection-case-inventory.json"
REPORT_NAME = "visual-semantic-projection-report.json"
INTERPRETER = {"implementation": "CPython", "version": "3.13.7"}
REPORT_GENERATED_AT = "2026-07-29T08:10:00Z"

TRUTH_REF = (
    "eval/visual-ocr-diagnostics/cases/"
    "junior-readable-measurement.visual-synthetic-text-truth.json"
)
OCR_DIAGNOSTIC_REPORT_REF = (
    "eval/visual-ocr-diagnostics/cases/visual-ocr-diagnostic-report.json"
)
TEXT_REGION_DIAGNOSTIC_REPORT_REF = (
    "eval/visual-text-region-diagnostics/cases/visual-text-region-diagnostic-report.json"
)
ASSOCIATION_RESULT_REF = (
    "eval/visual-ocr-region-association/cases/"
    "junior-readable-measurement.visual-ocr-region-association-result.json"
)
OCR_OBSERVATION_RESULT_REF = (
    "eval/visual-ocr-observation/cases/"
    "junior-readable-measurement.visual-ocr-observation-result.json"
)
PREPROCESSING_CASE_ROOT = (
    REPO_ROOT / "eval" / "visual-preprocessing" / "cases"
).resolve()


@dataclass(frozen=True)
class FixtureDefinition:
    case_id: str = "junior-readable-measurement"
    subject_pack: str = "junior-physics-answer"
    declaration_id: str = "junior-readable-measurement-semantic-declaration"
    request_id: str = "junior-readable-measurement-semantic-projection"
    semantic_role: str = "measurement_reading"
    truth_label_id: str = "truth-label-001"
    requested_at: str = "2026-07-29T08:03:00Z"
    generated_at: str = "2026-07-29T08:03:01Z"

    @property
    def declaration_name(self) -> str:
        return f"{self.case_id}.visual-synthetic-semantic-declaration.json"

    @property
    def request_name(self) -> str:
        return f"{self.case_id}.visual-semantic-projection-request.json"

    @property
    def result_name(self) -> str:
        return f"{self.case_id}.visual-semantic-projection-result.json"


DEFINITION = FixtureDefinition()


@dataclass(frozen=True)
class UpstreamAuthority:
    values: dict[str, dict[str, Any]]
    bytes_by_key: dict[str, bytes]
    snapshots: tuple[tuple[Path, bytes, str], ...]


@dataclass(frozen=True)
class ReportCompilation:
    report: dict[str, Any]
    snapshots: tuple[tuple[Path, bytes, str], ...]


def projection_policy() -> dict[str, str]:
    return {
        "roleSource": "explicit_semantic_declaration",
        "textSource": "bound_ocr_observation",
        "evidenceTriangle": "truth_ocr_truth_region_association",
        "cardinality": "exactly_one",
        "ambiguityDisposition": "fail_closed",
    }


def validate_runtime_identity() -> None:
    actual = {
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }
    if actual != INTERPRETER:
        raise ValueError("Visual semantic projector interpreter drifted from admitted policy.")


def artifact_contract(reference: str, data: bytes) -> dict[str, str]:
    return {"artifactRef": reference, "rawByteSha256": sha256_bytes(data)}


def result_contract(reference: str, data: bytes, request_id: str) -> dict[str, str]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "requestId": request_id,
    }


def declaration_contract(reference: str, data: bytes) -> dict[str, str]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "declarationId": DEFINITION.declaration_id,
    }


def validate_snapshots(snapshots: tuple[tuple[Path, bytes, str], ...]) -> None:
    for path, expected_bytes, label in snapshots:
        if path.read_bytes() != expected_bytes:
            raise ValueError(f"{label} bytes drifted during semantic projection compilation.")


def validate_authority_integrity(upstream: UpstreamAuthority) -> None:
    for key in ("truth", "ocr_report", "text_report", "association", "ocr_result"):
        if upstream.bytes_by_key.get(key) != stable_json_bytes(upstream.values.get(key)):
            raise ValueError(f"{key} parsed authority drifted from its snapshotted bytes.")
    if sha256_bytes(upstream.bytes_by_key.get("crop", b"")) != upstream.values.get(
        "crop", {}
    ).get("rawByteSha256"):
        raise ValueError("Semantic projection crop authority drifted from its snapshotted bytes.")
    crop = upstream.values["crop"]
    if (
        upstream.values["association"].get("crop") != crop
        or upstream.values["ocr_result"].get("crop") != crop
    ):
        raise ValueError("Semantic projection crop authority drifted across upstream results.")
    expected_ocr_binding = result_contract(
        OCR_OBSERVATION_RESULT_REF,
        upstream.bytes_by_key["ocr_result"],
        DEFINITION.case_id,
    )
    ocr_case = _one_case(upstream.values["ocr_report"], "OCR diagnostic report")
    text_case = _one_case(
        upstream.values["text_report"], "text-region diagnostic report"
    )
    expected_truth_binding = artifact_contract(TRUTH_REF, upstream.bytes_by_key["truth"])
    if (
        ocr_case.get("truth") != expected_truth_binding
        or text_case.get("truth") != expected_truth_binding
        or ocr_case.get("ocrObservationResult") != expected_ocr_binding
        or upstream.values["association"].get("ocrObservationResult")
        != expected_ocr_binding
    ):
        raise ValueError("Semantic projection upstream authority binding drifted.")
    association = upstream.values["association"]
    if (
        association.get("dispositions", {}).get("associationStatus") != "matched"
        or association.get("summary", {}).get("matchedAssociationCount") != 1
        or association.get("summary", {}).get("ambiguousEndpointCount") != 0
    ):
        raise ValueError("Semantic projection requires one matched, unambiguous association.")
    for report, label in (
        (upstream.values["ocr_report"], "OCR diagnostic report"),
        (upstream.values["text_report"], "text-region diagnostic report"),
    ):
        dispositions = report.get("dispositions")
        if (
            not isinstance(dispositions, dict)
            or dispositions.get("diagnosticStatus") != "completed"
            or dispositions.get("acceptanceDisposition") != "not_accepted"
            or dispositions.get("semanticDisposition") != "not_inferred"
        ):
            raise ValueError(f"{label} dispositions are not admitted for semantic projection.")


def _load_repo_json(reference: str, label: str) -> tuple[Path, bytes, dict[str, Any]]:
    path = resolve_bound_file(REPO_ROOT, reference, label)
    data, value = read_json_bytes(path, label)
    return path, data, value


def _one_case(report: dict[str, Any], label: str) -> dict[str, Any]:
    cases = report.get("caseReports")
    if not isinstance(cases, list):
        raise ValueError(f"{label} caseReports are invalid.")
    matches = [
        case
        for case in cases
        if isinstance(case, dict) and case.get("caseId") == DEFINITION.case_id
    ]
    if len(matches) != 1:
        raise ValueError(f"{label} must contain exactly one admitted case report.")
    return matches[0]


def _one_by_id(values: Any, field: str, expected_id: str, label: str) -> dict[str, Any]:
    if not isinstance(values, list):
        raise ValueError(f"{label} must be an array.")
    ids = [value.get(field) for value in values if isinstance(value, dict)]
    if len(values) != 1 or len(ids) != 1 or len(set(ids)) != 1:
        raise ValueError(f"{label} must contain exactly one unique endpoint.")
    matches = [value for value in values if value.get(field) == expected_id]
    if len(matches) != 1:
        raise ValueError(f"{label} must contain exactly one {expected_id} entry.")
    return matches[0]


def _validate_local_only(value: dict[str, Any], label: str) -> None:
    provenance = value.get("engineProvenance") or value.get("truthProvenance")
    if not isinstance(provenance, dict):
        raise ValueError(f"{label} provenance is missing.")
    if provenance.get("liveProvider") is not False or provenance.get("cloudEgress") is not False:
        raise ValueError(f"{label} must remain local-only with cloud egress disabled.")


def load_upstream_authorities(*, validate_upstream: bool = True) -> UpstreamAuthority:
    validate_runtime_identity()
    if validate_upstream:
        validate_ocr_diagnostic_fixtures()
        validate_text_region_diagnostic_fixtures()
        validate_association_fixtures()

    references = {
        "truth": (TRUTH_REF, "synthetic text truth"),
        "ocr_report": (OCR_DIAGNOSTIC_REPORT_REF, "OCR diagnostic report"),
        "text_report": (TEXT_REGION_DIAGNOSTIC_REPORT_REF, "text-region diagnostic report"),
        "association": (ASSOCIATION_RESULT_REF, "OCR-region association result"),
        "ocr_result": (OCR_OBSERVATION_RESULT_REF, "OCR observation result"),
    }
    values: dict[str, dict[str, Any]] = {}
    bytes_by_key: dict[str, bytes] = {}
    snapshots: list[tuple[Path, bytes, str]] = []
    identities: set[tuple[int, int]] = set()
    for key, (reference, label) in references.items():
        path, data, value = _load_repo_json(reference, label)
        identity = file_identity(path)
        if identity in identities:
            raise ValueError(f"{label} aliases another upstream authority by physical identity.")
        identities.add(identity)
        values[key] = value
        bytes_by_key[key] = data
        snapshots.append((path, data, label))

    truth = values["truth"]
    expected_identity = {
        "caseId": DEFINITION.case_id,
        "subjectPack": DEFINITION.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "coordinateSpace": "crop_pixel",
    }
    if any(truth.get(field) != expected for field, expected in expected_identity.items()):
        raise ValueError("Synthetic text truth identity drifted.")
    truth_label = _one_by_id(
        truth.get("labels"), "labelId", DEFINITION.truth_label_id, "synthetic truth labels"
    )
    if truth_label.get("visibilityDisposition") != "fully_visible":
        raise ValueError("Semantic projection truth label must remain fully visible.")
    _validate_local_only(truth, "synthetic text truth")

    truth_crop = truth.get("crop")
    if not isinstance(truth_crop, dict) or truth_crop.get("scale") != 2:
        raise ValueError("Synthetic text truth scale-2 crop authority is invalid.")
    crop = {
        field: truth_crop.get(field)
        for field in (
            "artifactRef",
            "scale",
            "rawByteSha256",
            "decodedRgbPixelSha256",
            "pixelSize",
        )
    }
    if isinstance(crop["pixelSize"], dict):
        crop["pixelSize"] = dict(crop["pixelSize"])
    if (
        not isinstance(crop["artifactRef"], str)
        or not is_sha256(crop["rawByteSha256"])
        or not is_sha256(crop["decodedRgbPixelSha256"])
        or not isinstance(crop["pixelSize"], dict)
    ):
        raise ValueError("Synthetic text truth crop contract is incomplete.")
    crop_path = resolve_bound_file(
        PREPROCESSING_CASE_ROOT, crop.get("artifactRef"), "semantic projection crop"
    )
    crop_bytes = crop_path.read_bytes()
    if sha256_bytes(crop_bytes) != crop.get("rawByteSha256"):
        raise ValueError("Semantic projection crop raw-byte SHA-256 drifted.")
    if file_identity(crop_path) in identities:
        raise ValueError("Semantic projection crop aliases another upstream authority.")
    values["crop"] = crop
    bytes_by_key["crop"] = crop_bytes
    snapshots.append((crop_path, crop_bytes, "semantic projection crop"))

    ocr_case = _one_case(values["ocr_report"], "OCR diagnostic report")
    text_case = _one_case(values["text_report"], "text-region diagnostic report")
    for report, case, label in (
        (values["ocr_report"], ocr_case, "OCR diagnostic report"),
        (values["text_report"], text_case, "text-region diagnostic report"),
    ):
        if case.get("subjectPack") != DEFINITION.subject_pack:
            raise ValueError(f"{label} subject-pack identity drifted.")
        truth_binding = case.get("truth")
        if truth_binding != artifact_contract(TRUTH_REF, bytes_by_key["truth"]):
            raise ValueError(f"{label} truth authority drifted.")
        dispositions = report.get("dispositions")
        if (
            not isinstance(dispositions, dict)
            or dispositions.get("diagnosticStatus") != "completed"
            or dispositions.get("acceptanceDisposition") != "not_accepted"
            or dispositions.get("semanticDisposition") != "not_inferred"
        ):
            raise ValueError(f"{label} dispositions are not admitted.")
        _validate_local_only(report, label)

    ocr_match = _one_by_id(
        ocr_case.get("matches"),
        "truthLabelRef",
        DEFINITION.truth_label_id,
        "OCR diagnostic matches",
    )
    if ocr_match.get("diagnosticDisposition") != "exact_text_positive_overlap":
        raise ValueError("OCR diagnostic match is not exact-text positive overlap.")
    if ocr_case.get("ocrObservationResult") != result_contract(
        OCR_OBSERVATION_RESULT_REF,
        bytes_by_key["ocr_result"],
        DEFINITION.case_id,
    ):
        raise ValueError("OCR diagnostic report observation authority drifted.")
    observation_id = ocr_match.get("ocrObservationRef")
    if observation_id != "ocr-observation-001":
        raise ValueError("OCR diagnostic observation endpoint drifted.")

    text_match = _one_by_id(
        text_case.get("matches"),
        "truthLabelRef",
        DEFINITION.truth_label_id,
        "text-region diagnostic matches",
    )
    if text_match.get("diagnosticDisposition") != "positive_overlap":
        raise ValueError("Text-region diagnostic match is not positive overlap.")
    candidate_id = text_match.get("textRegionCandidateRef")
    if candidate_id != "text-region-001":
        raise ValueError("Text-region diagnostic candidate endpoint drifted.")

    association = values["association"]
    if (
        association.get("requestId") != DEFINITION.case_id
        or association.get("subjectPack") != DEFINITION.subject_pack
        or association.get("fixtureKind") != "synthetic_fixture"
        or association.get("crop") != crop
        or association.get("dispositions", {}).get("associationStatus") != "matched"
        or association.get("summary", {}).get("matchedAssociationCount") != 1
        or association.get("summary", {}).get("ambiguousEndpointCount") != 0
        or association.get("ocrObservationResult")
        != result_contract(
            OCR_OBSERVATION_RESULT_REF,
            bytes_by_key["ocr_result"],
            DEFINITION.case_id,
        )
    ):
        raise ValueError("OCR-region association result is not one admitted exact match.")
    edge = _one_by_id(
        association.get("associations"),
        "associationId",
        "ocr-region-association-001",
        "OCR-region associations",
    )
    if (
        edge.get("ocrObservationRef") != observation_id
        or edge.get("textRegionCandidateRef") != candidate_id
    ):
        raise ValueError("OCR-region association endpoints do not close the evidence triangle.")
    _validate_local_only(association, "OCR-region association result")

    ocr_result = values["ocr_result"]
    if (
        ocr_result.get("requestId") != DEFINITION.case_id
        or ocr_result.get("subjectPack") != DEFINITION.subject_pack
        or ocr_result.get("fixtureKind") != "synthetic_fixture"
        or ocr_result.get("coordinateSpace") != "crop_pixel"
        or ocr_result.get("crop") != crop
    ):
        raise ValueError("OCR observation result identity or crop drifted.")
    observation = _one_by_id(
        ocr_result.get("observations"),
        "observationId",
        observation_id,
        "OCR observations",
    )
    if not isinstance(observation.get("observedText"), str) or not observation["observedText"]:
        raise ValueError("Bound OCR observation text is unavailable.")
    _validate_local_only(ocr_result, "OCR observation result")

    result = UpstreamAuthority(
        values,
        bytes_by_key,
        tuple(snapshots),
    )
    validate_authority_integrity(result)
    validate_snapshots(result.snapshots)
    return result


def build_declaration(upstream: UpstreamAuthority) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-synthetic-semantic-declaration",
        "declarationId": DEFINITION.declaration_id,
        "caseId": DEFINITION.case_id,
        "subjectPack": DEFINITION.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Explicit semantic role for one fully synthetic public fixture.",
        },
        "truth": {
            **artifact_contract(TRUTH_REF, upstream.bytes_by_key["truth"]),
            "truthId": upstream.values["truth"]["truthId"],
            "truthLabelRef": DEFINITION.truth_label_id,
        },
        "crop": upstream.values["crop"],
        "semanticRole": DEFINITION.semantic_role,
        "authorityProvenance": {
            "authorityKind": "explicit_synthetic_semantic_declaration",
            "interpreter": dict(INTERPRETER),
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": DEFINITION.requested_at,
    }


def build_request(declaration_bytes: bytes, upstream: UpstreamAuthority) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "visual-semantic-projection-request",
        "requestId": DEFINITION.request_id,
        "subjectPack": DEFINITION.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public semantic projection; no teacher, student, or exam data.",
        },
        "semanticDeclaration": declaration_contract(
            f"eval/visual-semantic-projection/cases/{DEFINITION.declaration_name}",
            declaration_bytes,
        ),
        "ocrDiagnosticReport": artifact_contract(
            OCR_DIAGNOSTIC_REPORT_REF, upstream.bytes_by_key["ocr_report"]
        ),
        "textRegionDiagnosticReport": artifact_contract(
            TEXT_REGION_DIAGNOSTIC_REPORT_REF, upstream.bytes_by_key["text_report"]
        ),
        "associationResult": result_contract(
            ASSOCIATION_RESULT_REF, upstream.bytes_by_key["association"], DEFINITION.case_id
        ),
        "ocrObservationResult": result_contract(
            OCR_OBSERVATION_RESULT_REF, upstream.bytes_by_key["ocr_result"], DEFINITION.case_id
        ),
        "crop": upstream.values["crop"],
        "projectionPolicy": projection_policy(),
        "egressPolicy": {"allowCloud": False},
        "requestedAt": DEFINITION.requested_at,
    }


def validate_declaration(declaration: dict[str, Any], upstream: UpstreamAuthority) -> None:
    expected = build_declaration(upstream)
    if declaration != expected:
        raise ValueError("VisualSyntheticSemanticDeclaration authority drifted.")


def validate_request(
    request: dict[str, Any], declaration_bytes: bytes, upstream: UpstreamAuthority
) -> None:
    expected = build_request(declaration_bytes, upstream)
    if request != expected:
        raise ValueError("VisualSemanticProjectionRequest authority drifted.")


def _load_local_binding(
    fixture_root: Path,
    contract: dict[str, Any],
    expected_name: str,
    label: str,
) -> tuple[Path, bytes, dict[str, Any]]:
    expected_ref = f"eval/visual-semantic-projection/cases/{expected_name}"
    if contract.get("artifactRef") != expected_ref or not is_sha256(contract.get("rawByteSha256")):
        raise ValueError(f"{label} contract drifted.")
    path = resolve_bound_file(fixture_root, expected_name, label)
    data, value = read_json_bytes(path, label)
    if sha256_bytes(data) != contract["rawByteSha256"]:
        raise ValueError(f"{label} raw-byte SHA-256 drifted.")
    return path, data, value


def compile_request(
    request_path: Path,
    fixture_root: Path,
    upstream: UpstreamAuthority | None = None,
) -> dict[str, Any]:
    validate_runtime_identity()
    fixture_root = fixture_root.resolve(strict=True)
    request_path = resolve_canonical_input(request_path, fixture_root, "semantic projection request")
    if request_path.name != DEFINITION.request_name:
        raise ValueError("VisualSemanticProjectionRequest fixture identity is not admitted.")
    request_bytes, request = read_json_bytes(request_path, "VisualSemanticProjectionRequest")
    authorities = upstream or load_upstream_authorities()
    validate_authority_integrity(authorities)
    declaration_path, declaration_bytes, declaration = _load_local_binding(
        fixture_root,
        request.get("semanticDeclaration", {}),
        DEFINITION.declaration_name,
        "semantic declaration",
    )
    if request["semanticDeclaration"].get("declarationId") != DEFINITION.declaration_id:
        raise ValueError("Semantic declaration ID drifted.")
    validate_declaration(declaration, authorities)
    validate_request(request, declaration_bytes, authorities)

    _one_by_id(
        authorities.values["truth"].get("labels"),
        "labelId",
        declaration["truth"]["truthLabelRef"],
        "synthetic truth labels",
    )
    ocr_case = _one_case(authorities.values["ocr_report"], "OCR diagnostic report")
    text_case = _one_case(
        authorities.values["text_report"], "text-region diagnostic report"
    )
    ocr_match = _one_by_id(
        ocr_case.get("matches"),
        "truthLabelRef",
        declaration["truth"]["truthLabelRef"],
        "OCR diagnostic matches",
    )
    text_match = _one_by_id(
        text_case.get("matches"),
        "truthLabelRef",
        declaration["truth"]["truthLabelRef"],
        "text-region diagnostic matches",
    )
    edge = _one_by_id(
        authorities.values["association"].get("associations"),
        "associationId",
        "ocr-region-association-001",
        "OCR-region associations",
    )
    if (
        ocr_match.get("diagnosticDisposition") != "exact_text_positive_overlap"
        or text_match.get("diagnosticDisposition") != "positive_overlap"
        or edge.get("ocrObservationRef") != ocr_match.get("ocrObservationRef")
        or edge.get("textRegionCandidateRef") != text_match.get("textRegionCandidateRef")
    ):
        raise ValueError("Semantic projection evidence triangle is not exact and unique.")
    observation = _one_by_id(
        authorities.values["ocr_result"].get("observations"),
        "observationId",
        ocr_match["ocrObservationRef"],
        "OCR observations",
    )
    recognized_text = observation.get("observedText")
    if not isinstance(recognized_text, str) or not recognized_text:
        raise ValueError("Semantic projection recognized text is unavailable.")

    snapshots = authorities.snapshots + (
        (declaration_path, declaration_bytes, "semantic declaration"),
        (request_path, request_bytes, "semantic projection request"),
    )
    validate_snapshots(snapshots)
    return {
        "schemaVersion": "1.0",
        "kind": "visual-semantic-projection-result",
        "requestId": DEFINITION.request_id,
        "subjectPack": DEFINITION.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "semanticDeclaration": request["semanticDeclaration"],
        "ocrDiagnosticReport": request["ocrDiagnosticReport"],
        "textRegionDiagnosticReport": request["textRegionDiagnosticReport"],
        "associationResult": request["associationResult"],
        "ocrObservationResult": request["ocrObservationResult"],
        "crop": request["crop"],
        "coordinateSpace": "crop_pixel",
        "projections": [
            {
                "projectionId": "semantic-projection-001",
                "semanticDeclarationRef": DEFINITION.declaration_id,
                "truthLabelRef": declaration["truth"]["truthLabelRef"],
                "semanticRole": declaration["semanticRole"],
                "ocrObservationRef": ocr_match["ocrObservationRef"],
                "textRegionCandidateRef": text_match["textRegionCandidateRef"],
                "associationRef": edge["associationId"],
                "recognizedText": recognized_text,
                "projectionBasis": "declared_role_exact_truth_region_association",
            }
        ],
        "summary": {
            "declarationCount": 1,
            "projectedCount": 1,
            "withheldCount": 0,
            "unavailableCount": 0,
        },
        "dispositions": result_dispositions(),
        "projectionPolicySha256": sha256_bytes(stable_json_bytes(projection_policy())),
        "engineProvenance": engine_provenance(),
        "generatedAt": DEFINITION.generated_at,
    }


def result_dispositions() -> dict[str, Any]:
    return {
        "diagnosticScope": "public_synthetic_semantic_projection",
        "semanticStatus": "projected",
        "acceptanceDisposition": "not_accepted",
        "requiresHumanReview": True,
        "layoutDisposition": "not_inferred",
        "figureUnderstandingDisposition": "not_generated",
        "trackDisposition": "not_integrated",
        "deliveryTrustDisposition": "not_projected",
        "wpfDisposition": "not_integrated",
        "liveAcceptanceDisposition": "not_accepted",
        "controlsDisposition": "not_verified",
        "eligible": False,
        "optimizationCandidateRefs": [],
    }


def report_dispositions() -> dict[str, Any]:
    result = result_dispositions()
    result.pop("semanticStatus")
    return {"diagnosticStatus": "completed", **result}


def engine_provenance() -> dict[str, Any]:
    return {
        "engineKind": "deterministic_semantic_projection",
        "engineId": "visual-semantic-projector",
        "engineVersion": "1.0.0",
        "interpreter": dict(INTERPRETER),
        "liveProvider": False,
        "cloudEgress": False,
    }


def validate_inventory(inventory: dict[str, Any]) -> dict[str, Any]:
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualSemanticProjectionCaseInventory",
    )
    if (
        inventory.get("schemaVersion") != "1.0"
        or inventory.get("kind") != "visual-semantic-projection-case-inventory"
        or inventory.get("fixtureSetId") != "synthetic-visual-semantic-projection-v1"
        or inventory.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualSemanticProjectionCaseInventory identity drifted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != 1 or not isinstance(entries[0], dict):
        raise ValueError("VisualSemanticProjectionCaseInventory must admit exactly one case.")
    return entries[0]


def _compile_report_snapshot(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamAuthority | None = None,
) -> ReportCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    authorities = upstream or load_upstream_authorities()
    inventory_path = resolve_bound_file(
        fixture_root, INVENTORY_NAME, "semantic projection inventory"
    )
    inventory_bytes, inventory = read_json_bytes(
        inventory_path, "VisualSemanticProjectionCaseInventory"
    )
    entry = validate_inventory(inventory)
    require_exact_keys(
        entry,
        {
            "caseId",
            "subjectPack",
            "declarationRef",
            "declarationSha256",
            "requestRef",
            "requestSha256",
            "expectedResultRef",
            "expectedResultSha256",
        },
        "VisualSemanticProjectionCaseInventory entry",
    )
    expected_refs = {
        "caseId": DEFINITION.case_id,
        "subjectPack": DEFINITION.subject_pack,
        "declarationRef": DEFINITION.declaration_name,
        "requestRef": DEFINITION.request_name,
        "expectedResultRef": DEFINITION.result_name,
    }
    if any(entry.get(field) != value for field, value in expected_refs.items()):
        raise ValueError("Semantic projection inventory identity drifted.")
    for field in ("declarationSha256", "requestSha256", "expectedResultSha256"):
        if not is_sha256(entry.get(field)):
            raise ValueError(f"Semantic projection inventory {field} is invalid.")

    declaration_path = resolve_bound_file(
        fixture_root, entry["declarationRef"], "semantic declaration"
    )
    request_path = resolve_bound_file(fixture_root, entry["requestRef"], "projection request")
    result_path = resolve_bound_file(
        fixture_root, entry["expectedResultRef"], "projection result"
    )
    local_paths = (inventory_path, declaration_path, request_path, result_path)
    identities = [file_identity(path) for path in local_paths]
    if len(set(identities)) != len(identities):
        raise ValueError("Semantic projection authority files must have unique physical identities.")

    declaration_bytes, declaration = read_json_bytes(
        declaration_path, "VisualSyntheticSemanticDeclaration"
    )
    request_bytes, request = read_json_bytes(request_path, "VisualSemanticProjectionRequest")
    result_bytes, result = read_json_bytes(result_path, "VisualSemanticProjectionResult")
    expected_hashes = {
        "declarationSha256": sha256_bytes(declaration_bytes),
        "requestSha256": sha256_bytes(request_bytes),
        "expectedResultSha256": sha256_bytes(result_bytes),
    }
    if any(entry.get(field) != value for field, value in expected_hashes.items()):
        raise ValueError("Semantic projection inventory local artifact hash drifted.")
    validate_declaration(declaration, authorities)
    validate_request(request, declaration_bytes, authorities)
    compiled = compile_request(request_path, fixture_root, authorities)
    if result != compiled or result_bytes != stable_json_bytes(compiled):
        raise ValueError("Semantic projection result does not deterministically replay.")

    snapshots = authorities.snapshots + (
        (inventory_path, inventory_bytes, "semantic projection inventory"),
        (declaration_path, declaration_bytes, "semantic declaration"),
        (request_path, request_bytes, "semantic projection request"),
        (result_path, result_bytes, "semantic projection result"),
    )
    report = {
        "schemaVersion": "1.0",
        "kind": "visual-semantic-projection-report",
        "fixtureSetId": "synthetic-visual-semantic-projection-v1",
        "fixtureKind": "synthetic_fixture",
        "sourceInventory": artifact_contract(
            f"eval/visual-semantic-projection/cases/{INVENTORY_NAME}", inventory_bytes
        ),
        "caseReports": [
            {
                "caseId": DEFINITION.case_id,
                "subjectPack": DEFINITION.subject_pack,
                "projectionResult": result_contract(
                    f"eval/visual-semantic-projection/cases/{DEFINITION.result_name}",
                    result_bytes,
                    DEFINITION.request_id,
                ),
                "semanticRole": DEFINITION.semantic_role,
                "projectionStatus": "projected",
            }
        ],
        "totals": {
            "caseCount": 1,
            "projectedCaseCount": 1,
            "withheldCaseCount": 0,
            "unavailableCaseCount": 0,
        },
        "dispositions": report_dispositions(),
        "projectionPolicySha256": sha256_bytes(stable_json_bytes(projection_policy())),
        "engineProvenance": engine_provenance(),
        "generatedAt": REPORT_GENERATED_AT,
    }
    compilation = ReportCompilation(report, snapshots)
    validate_snapshots(compilation.snapshots)
    return compilation


def compile_report(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamAuthority | None = None,
) -> dict[str, Any]:
    return _compile_report_snapshot(fixture_root, upstream).report


def validate_fixture_structure(fixture_root: Path) -> None:
    expected_names = {
        DEFINITION.declaration_name,
        DEFINITION.request_name,
        DEFINITION.result_name,
        INVENTORY_NAME,
        REPORT_NAME,
    }
    actual_paths = list(fixture_root.rglob("*"))
    if any(
        path.is_dir()
        or path.is_symlink()
        or (hasattr(path, "is_junction") and path.is_junction())
        for path in actual_paths
    ):
        raise ValueError("Semantic projection authority cannot contain nested or alias entries.")
    if {path.name for path in actual_paths} != expected_names:
        raise ValueError("Semantic projection authority coverage drifted.")
    identities = [file_identity(path) for path in actual_paths]
    if len(set(identities)) != len(identities):
        raise ValueError("Semantic projection authority files must have unique physical identities.")


def validate_canonical_fixtures(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamAuthority | None = None,
) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    validate_fixture_structure(fixture_root)
    compilation = _compile_report_snapshot(fixture_root, upstream)
    report_path = resolve_bound_file(fixture_root, REPORT_NAME, "semantic projection report")
    report_bytes, report = read_json_bytes(report_path, "VisualSemanticProjectionReport")
    if report != compilation.report or report_bytes != stable_json_bytes(compilation.report):
        raise ValueError("Semantic projection report does not deterministically replay.")
    validate_snapshots(
        compilation.snapshots + ((report_path, report_bytes, "semantic projection report"),)
    )
    validate_fixture_structure(fixture_root)
    return 1


def materialize_fixtures(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamAuthority | None = None,
) -> int:
    validate_runtime_identity()
    fixture_root.mkdir(parents=True, exist_ok=True)
    if any(fixture_root.iterdir()):
        validate_fixture_structure(fixture_root)
    authorities = upstream or load_upstream_authorities()
    declaration = build_declaration(authorities)
    declaration_bytes = stable_json_bytes(declaration)
    atomic_write(fixture_root / DEFINITION.declaration_name, declaration_bytes)
    request = build_request(declaration_bytes, authorities)
    request_bytes = stable_json_bytes(request)
    request_path = fixture_root / DEFINITION.request_name
    atomic_write(request_path, request_bytes)
    result_bytes = stable_json_bytes(compile_request(request_path, fixture_root, authorities))
    atomic_write(fixture_root / DEFINITION.result_name, result_bytes)
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-semantic-projection-case-inventory",
        "fixtureSetId": "synthetic-visual-semantic-projection-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": [
            {
                "caseId": DEFINITION.case_id,
                "subjectPack": DEFINITION.subject_pack,
                "declarationRef": DEFINITION.declaration_name,
                "declarationSha256": sha256_bytes(declaration_bytes),
                "requestRef": DEFINITION.request_name,
                "requestSha256": sha256_bytes(request_bytes),
                "expectedResultRef": DEFINITION.result_name,
                "expectedResultSha256": sha256_bytes(result_bytes),
            }
        ],
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    report = compile_report(fixture_root, authorities)
    atomic_write(fixture_root / REPORT_NAME, stable_json_bytes(report))
    return validate_canonical_fixtures(fixture_root, authorities)


def canonical_output_path(output_dir: Path) -> Path:
    absolute = Path(os.path.abspath(os.fspath(output_dir)))
    try:
        absolute.relative_to(REPO_ROOT)
    except ValueError:
        pass
    else:
        raise ValueError("Runtime output directory must be outside the repository root.")
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


def _run_diagnostics(
    output_dir: Path,
    fixture_root: Path,
    upstream: UpstreamAuthority | None = None,
) -> Path:
    output = canonical_output_path(output_dir)
    fixture_root = fixture_root.resolve(strict=True)
    validate_fixture_structure(fixture_root)
    compilation = _compile_report_snapshot(fixture_root, upstream)
    report_bytes = stable_json_bytes(compilation.report)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        stage_report = stage / REPORT_NAME
        atomic_write(stage_report, report_bytes)
        if stage_report.read_bytes() != report_bytes:
            raise ValueError("Staged semantic projection report bytes drifted before promotion.")
        validate_fixture_structure(fixture_root)
        validate_snapshots(compilation.snapshots)
        os.replace(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output / REPORT_NAME


def run_diagnostics(output_dir: Path) -> Path:
    canonical_output_path(output_dir)
    upstream = load_upstream_authorities()
    validate_canonical_fixtures(CANONICAL_ROOT, upstream)
    return _run_diagnostics(output_dir, CANONICAL_ROOT, upstream)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synthetic visual semantic projection diagnostics.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic semantic projection fixture.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic semantic projection fixture.")
        return 0
    report_path = run_diagnostics(args.out)
    print(json.dumps({"status": "ok", "reportPath": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
