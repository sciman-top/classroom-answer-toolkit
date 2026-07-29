from __future__ import annotations

import argparse
import json
import math
import os
import platform
import shutil
import sys
import tempfile
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_EVEN
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent.resolve()
PREPROCESSOR_TOOL_ROOT = TOOL_ROOT.parent / "visual-preprocessor"
OCR_TOOL_ROOT = TOOL_ROOT.parent / "visual-ocr-observer"
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))
sys.path.insert(0, str(OCR_TOOL_ROOT))

from visual_preprocessor import (  # noqa: E402
    CANONICAL_ROOT as PREPROCESSING_ROOT,
    DEFINITIONS,
    INVENTORY_NAME as PREPROCESSING_INVENTORY_NAME,
    TEXT_DECLARATIONS,
    atomic_write,
    decode_png,
    decoded_pixel_sha256,
    encode_png,
    file_identity,
    is_sha256,
    read_json_bytes,
    require_exact_keys,
    render_synthetic_source,
    resolve_bound_file,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures as validate_preprocessing_fixtures,
)
from visual_ocr_observer import (  # noqa: E402
    CANONICAL_ROOT as OCR_ROOT,
    INVENTORY_NAME as OCR_INVENTORY_NAME,
    validate_canonical_fixtures as validate_ocr_fixtures,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-ocr-diagnostics" / "cases").resolve()
INVENTORY_NAME = "visual-ocr-diagnostic-case-inventory.json"
REPORT_NAME = "visual-ocr-diagnostic-report.json"
RENDERER_PATH = (PREPROCESSOR_TOOL_ROOT / "visual_preprocessor.py").resolve()
SUBJECT_PACKS = (
    "math-answer",
    "junior-physics-answer",
    "senior-physics-answer",
)
INTERPRETER = {"implementation": "CPython", "version": "3.13.7"}
PILLOW_VERSION = "12.3.0"
TRUTH_GENERATED_AT = {
    "math-function-graph": "2026-07-28T02:00:00Z",
    "junior-instrument-scale": "2026-07-28T02:01:00Z",
    "senior-circuit-label": "2026-07-28T02:02:00Z",
    "junior-readable-measurement": "2026-07-29T05:03:00Z",
}
REPORT_GENERATED_AT = "2026-07-29T05:10:00Z"


@dataclass(frozen=True)
class FixtureAuthority:
    preprocessing_bytes: bytes
    preprocessing_result: dict[str, Any]
    ocr_bytes: bytes
    ocr_result: dict[str, Any]


@dataclass(frozen=True)
class AuthoritySet:
    renderer_bytes: bytes
    fixtures: dict[str, FixtureAuthority]
    snapshots: tuple[tuple[Path, bytes, str], ...]


@dataclass(frozen=True)
class DiagnosticCompilation:
    report: dict[str, Any]
    snapshots: tuple[tuple[Path, bytes, str], ...]


def truth_name(case_id: str) -> str:
    return f"{case_id}.visual-synthetic-text-truth.json"


def preprocessing_result_name(case_id: str) -> str:
    return f"{case_id}.visual-preprocessing-result.json"


def ocr_result_name(case_id: str) -> str:
    return f"{case_id}.visual-ocr-observation-result.json"


def repo_ref(path: Path) -> str:
    return path.resolve().relative_to(REPO_ROOT).as_posix()


def artifact_contract(reference: str, data: bytes) -> dict[str, str]:
    return {"artifactRef": reference, "rawByteSha256": sha256_bytes(data)}


def upstream_contract(reference: str, data: bytes, request_id: str) -> dict[str, str]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "requestId": request_id,
    }


def diagnostic_policy() -> dict[str, Any]:
    return {
        "scorableVisibility": "fully_visible",
        "textComparison": "exact_case_sensitive_utf8",
        "quadBoundsMode": "axis_aligned_min_max",
        "rectangleEdgeMode": "half_open",
        "matchIntersection": "positive_area",
        "partialExactOverlapDisposition": "unscored",
        "ambiguousCandidateDisposition": "fail_closed",
        "enumerationOrder": ["truth_label_id", "ocr_observation_id"],
        "ratioPrecision": 8,
    }


def interpreter_identity() -> dict[str, str]:
    return {
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }


def validate_runtime_identity() -> None:
    if interpreter_identity() != INTERPRETER:
        raise ValueError("Visual OCR diagnostics Python interpreter drifted from admitted policy.")
    if package_version("Pillow") != PILLOW_VERSION:
        raise ValueError("Visual OCR diagnostics Pillow version drifted from admitted policy.")


def validate_file_snapshot(path: Path, expected_bytes: bytes, label: str) -> None:
    if path.read_bytes() != expected_bytes:
        raise ValueError(f"{label} bytes drifted while compiling diagnostics.")


def validate_authority_snapshots(authorities: AuthoritySet) -> None:
    for path, expected_bytes, label in authorities.snapshots:
        validate_file_snapshot(path, expected_bytes, label)


def validate_diagnostic_snapshots(compilation: DiagnosticCompilation) -> None:
    for path, expected_bytes, label in compilation.snapshots:
        validate_file_snapshot(path, expected_bytes, label)


def inventory_entry_for_case(inventory: dict[str, Any], case_id: str, label: str) -> dict[str, Any]:
    entries = inventory.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"{label} inventory entries are invalid.")
    matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("caseId") == case_id]
    if len(matches) != 1:
        raise ValueError(f"{label} inventory case coverage drifted for {case_id}.")
    return matches[0]


def validate_result_inventory_binding(
    inventory: dict[str, Any],
    case_id: str,
    subject_pack: str,
    expected_result_name: str,
    result_bytes: bytes,
    label: str,
) -> None:
    entry = inventory_entry_for_case(inventory, case_id, label)
    if (
        entry.get("subjectPack") != subject_pack
        or entry.get("expectedResultRef") != expected_result_name
        or entry.get("expectedResultSha256") != sha256_bytes(result_bytes)
    ):
        raise ValueError(f"{label} result bytes drifted from committed inventory authority.")


def crop_contract(preprocessing_result: dict[str, Any]) -> dict[str, Any]:
    crops = preprocessing_result.get("cropArtifacts")
    if not isinstance(crops, list):
        raise ValueError("Visual preprocessing result cropArtifacts are invalid.")
    selected = [crop for crop in crops if isinstance(crop, dict) and crop.get("scale") == 2]
    if len(selected) != 1:
        raise ValueError("Visual preprocessing result must contain exactly one scale=2 crop.")
    crop = selected[0]
    return {
        "artifactRef": crop.get("artifactRef"),
        "scale": crop.get("scale"),
        "rawByteSha256": crop.get("rawByteSha256"),
        "decodedRgbPixelSha256": crop.get("decodedRgbPixelSha256"),
        "pixelSize": crop.get("pixelSize"),
    }


def validate_image_contract(
    path: Path,
    contract: dict[str, Any],
    label: str,
) -> bytes:
    data = path.read_bytes()
    if sha256_bytes(data) != contract.get("rawByteSha256"):
        raise ValueError(f"{label} raw-byte SHA-256 drifted.")
    image = decode_png(data, label)
    if decoded_pixel_sha256(image) != contract.get("decodedRgbPixelSha256"):
        raise ValueError(f"{label} decoded RGB pixel SHA-256 drifted.")
    pixel_size = contract.get("pixelSize")
    if not isinstance(pixel_size, dict) or image.size != (
        pixel_size.get("width"), pixel_size.get("height")
    ):
        raise ValueError(f"{label} pixel dimensions drifted.")
    return data


def validate_upstream_authorities() -> AuthoritySet:
    validate_runtime_identity()
    renderer_bytes = RENDERER_PATH.read_bytes()
    preprocessing_inventory_path = resolve_bound_file(
        PREPROCESSING_ROOT, PREPROCESSING_INVENTORY_NAME, "visual preprocessing inventory"
    )
    preprocessing_inventory_bytes, preprocessing_inventory = read_json_bytes(
        preprocessing_inventory_path, "VisualPreprocessingCaseInventory"
    )
    ocr_inventory_path = resolve_bound_file(
        OCR_ROOT, OCR_INVENTORY_NAME, "OCR observation inventory"
    )
    ocr_inventory_bytes, ocr_inventory = read_json_bytes(
        ocr_inventory_path, "VisualOcrObservationCaseInventory"
    )
    validate_preprocessing_fixtures()
    validate_ocr_fixtures()
    validate_file_snapshot(
        preprocessing_inventory_path,
        preprocessing_inventory_bytes,
        "Visual preprocessing inventory",
    )
    validate_file_snapshot(ocr_inventory_path, ocr_inventory_bytes, "OCR observation inventory")

    fixtures: dict[str, FixtureAuthority] = {}
    snapshots: list[tuple[Path, bytes, str]] = [
        (RENDERER_PATH, renderer_bytes, "Visual preprocessing renderer"),
        (
            preprocessing_inventory_path,
            preprocessing_inventory_bytes,
            "Visual preprocessing inventory",
        ),
        (ocr_inventory_path, ocr_inventory_bytes, "OCR observation inventory"),
    ]
    for definition in DEFINITIONS:
        preprocessing_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            preprocessing_result_name(definition.case_id),
            f"{definition.case_id} preprocessing result",
        )
        preprocessing_bytes, preprocessing_result = read_json_bytes(
            preprocessing_path, "VisualPreprocessingResult"
        )
        ocr_path = resolve_bound_file(
            OCR_ROOT,
            ocr_result_name(definition.case_id),
            f"{definition.case_id} OCR observation result",
        )
        ocr_bytes, ocr_result = read_json_bytes(ocr_path, "VisualOcrObservationResult")
        validate_result_inventory_binding(
            preprocessing_inventory,
            definition.case_id,
            definition.subject_pack,
            preprocessing_path.name,
            preprocessing_bytes,
            "Visual preprocessing",
        )
        validate_result_inventory_binding(
            ocr_inventory,
            definition.case_id,
            definition.subject_pack,
            ocr_path.name,
            ocr_bytes,
            "OCR observation",
        )
        expected_identity = {
            "requestId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "fixtureKind": "synthetic_fixture",
        }
        for field, expected in expected_identity.items():
            if preprocessing_result.get(field) != expected or ocr_result.get(field) != expected:
                raise ValueError(f"{definition.case_id} upstream identity drifted.")
        if ocr_result.get("preprocessingResult") != upstream_contract(
            repo_ref(preprocessing_path), preprocessing_bytes, definition.case_id
        ):
            raise ValueError(f"{definition.case_id} OCR preprocessing binding drifted.")
        expected_crop = crop_contract(preprocessing_result)
        if ocr_result.get("crop") != expected_crop:
            raise ValueError(f"{definition.case_id} OCR crop binding drifted.")
        if ocr_result.get("dispositions") != {
            "observationStatus": "completed",
            "groundTruthAvailable": False,
            "acceptanceDisposition": "not_evaluated",
            "requiresHumanReview": True,
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        }:
            raise ValueError(f"{definition.case_id} OCR dispositions are not admitted.")
        if (
            ocr_result.get("engineProvenance", {}).get("liveProvider") is not False
            or ocr_result.get("engineProvenance", {}).get("cloudEgress") is not False
        ):
            raise ValueError(f"{definition.case_id} OCR provenance is not local-only.")

        source_contract = preprocessing_result.get("source")
        if not isinstance(source_contract, dict):
            raise ValueError(f"{definition.case_id} source contract is invalid.")
        source_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            source_contract.get("artifactRef"),
            f"{definition.case_id} source image",
        )
        source_bytes = validate_image_contract(
            source_path, source_contract, f"{definition.case_id} source image"
        )
        if source_bytes != encode_png(render_synthetic_source(definition)):
            raise ValueError(
                f"{definition.case_id} source image drifted from the current deterministic renderer."
            )
        crop_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            expected_crop.get("artifactRef"),
            f"{definition.case_id} scale=2 crop",
        )
        crop_bytes = validate_image_contract(
            crop_path, expected_crop, f"{definition.case_id} scale=2 crop"
        )
        snapshots.extend(
            [
                (preprocessing_path, preprocessing_bytes, f"{definition.case_id} preprocessing result"),
                (ocr_path, ocr_bytes, f"{definition.case_id} OCR observation result"),
                (source_path, source_bytes, f"{definition.case_id} source image"),
                (crop_path, crop_bytes, f"{definition.case_id} scale=2 crop"),
            ]
        )
        fixtures[definition.case_id] = FixtureAuthority(
            preprocessing_bytes=preprocessing_bytes,
            preprocessing_result=preprocessing_result,
            ocr_bytes=ocr_bytes,
            ocr_result=ocr_result,
        )
    authorities = AuthoritySet(renderer_bytes, fixtures, tuple(snapshots))
    validate_authority_snapshots(authorities)
    return authorities


def bounds_dict(left: int, top: int, right: int, bottom: int) -> dict[str, int]:
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def build_truth(definition: Any, authorities: AuthoritySet) -> dict[str, Any]:
    authority = authorities.fixtures[definition.case_id]
    preprocessing = authority.preprocessing_result
    source = preprocessing["source"]
    visual_region = preprocessing.get("visualRegion")
    if not isinstance(visual_region, dict) or not isinstance(visual_region.get("bbox"), dict):
        raise ValueError(f"{definition.case_id} preprocessing visualRegion is invalid.")
    crop_source_bounds = {
        field: visual_region["bbox"].get(field) for field in ("x", "y", "width", "height")
    }
    if any(type(crop_source_bounds[field]) is not int for field in crop_source_bounds):
        raise ValueError(f"{definition.case_id} crop source bounds are invalid.")
    crop = crop_contract(preprocessing)
    crop = {**crop, "sourceBounds": crop_source_bounds}
    image = Image.new("RGB", (source["pixelSize"]["width"], source["pixelSize"]["height"]), "white")
    draw = ImageDraw.Draw(image)
    crop_left = crop_source_bounds["x"]
    crop_top = crop_source_bounds["y"]
    crop_right = crop_left + crop_source_bounds["width"]
    crop_bottom = crop_top + crop_source_bounds["height"]
    labels = []
    for index, declaration in enumerate(TEXT_DECLARATIONS[definition.case_id], start=1):
        if declaration.source_bounds is None:
            left, top, right, bottom = draw.textbbox(declaration.position, declaration.text)
        else:
            left, top, right, bottom = declaration.source_bounds
        if right <= left or bottom <= top:
            raise ValueError(f"{definition.case_id} renderer declared a degenerate text bbox.")
        if (
            left < 0
            or top < 0
            or right > source["pixelSize"]["width"]
            or bottom > source["pixelSize"]["height"]
        ):
            raise ValueError(f"{definition.case_id} renderer declared text outside source pixel bounds.")
        intersection = (
            max(left, crop_left), max(top, crop_top),
            min(right, crop_right), min(bottom, crop_bottom),
        )
        if intersection[0] >= intersection[2] or intersection[1] >= intersection[3]:
            visibility = "outside_crop"
            crop_intersection = None
        else:
            visibility = (
                "fully_visible"
                if intersection == (left, top, right, bottom)
                else "partially_clipped"
            )
            crop_intersection = bounds_dict(
                (intersection[0] - crop_left) * 2,
                (intersection[1] - crop_top) * 2,
                (intersection[2] - crop_left) * 2,
                (intersection[3] - crop_top) * 2,
            )
        label = {
            "labelId": f"truth-label-{index:03d}",
            "text": declaration.text,
            "sourceBounds": bounds_dict(left, top, right, bottom),
            "visibilityDisposition": visibility,
        }
        if crop_intersection is not None:
            label["cropIntersectionBounds"] = crop_intersection
        labels.append(label)
    return {
        "schemaVersion": "1.0",
        "kind": "visual-synthetic-text-truth",
        "truthId": f"{definition.case_id}-synthetic-text-truth",
        "caseId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Generator-declared synthetic text only; no teacher, student, or exam data.",
        },
        "renderer": artifact_contract(repo_ref(RENDERER_PATH), authorities.renderer_bytes),
        "preprocessingResult": upstream_contract(
            f"eval/visual-preprocessing/cases/{preprocessing_result_name(definition.case_id)}",
            authority.preprocessing_bytes,
            definition.case_id,
        ),
        "source": source,
        "crop": crop,
        "coordinateSpace": "crop_pixel",
        "labels": labels,
        "truthProvenance": {
            "authorityKind": "generator_declared_synthetic",
            "declarationSource": "renderer_text_declarations",
            "interpreter": INTERPRETER,
            "pillowVersion": PILLOW_VERSION,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": TRUTH_GENERATED_AT[definition.case_id],
    }


def number(value: Any, label: str) -> float:
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number.")
    return float(value)


def validate_bounds(value: Any, label: str, pixel_size: dict[str, Any] | None = None) -> dict[str, float]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object.")
    require_exact_keys(value, {"x", "y", "width", "height"}, label)
    result = {field: number(value.get(field), f"{label}.{field}") for field in value}
    if result["width"] <= 0 or result["height"] <= 0:
        raise ValueError(f"{label} must have positive area.")
    if pixel_size is not None and (
        result["x"] < 0
        or result["y"] < 0
        or result["x"] + result["width"] > pixel_size.get("width")
        or result["y"] + result["height"] > pixel_size.get("height")
    ):
        raise ValueError(f"{label} is outside crop bounds.")
    return result


def quad_bounds(quad: Any, pixel_size: dict[str, Any]) -> dict[str, float]:
    if not isinstance(quad, list) or len(quad) != 4:
        raise ValueError("OCR observation quad must contain exactly four points.")
    points = []
    for point in quad:
        if not isinstance(point, dict):
            raise ValueError("OCR observation quad point must be an object.")
        require_exact_keys(point, {"x", "y"}, "OCR observation quad point")
        points.append((number(point.get("x"), "OCR quad x"), number(point.get("y"), "OCR quad y")))
    left = min(point[0] for point in points)
    top = min(point[1] for point in points)
    right = max(point[0] for point in points)
    bottom = max(point[1] for point in points)
    return validate_bounds(
        {"x": left, "y": top, "width": right - left, "height": bottom - top},
        "OCR observation bounds",
        pixel_size,
    )


def positive_intersection(first: dict[str, float], second: dict[str, float]) -> bool:
    return (
        min(first["x"] + first["width"], second["x"] + second["width"])
        > max(first["x"], second["x"])
        and min(first["y"] + first["height"], second["y"] + second["height"])
        > max(first["y"], second["y"])
    )


def ratio(numerator: int, denominator: int) -> dict[str, Any]:
    if denominator == 0:
        return {"available": False}
    value = (Decimal(numerator) / Decimal(denominator)).quantize(
        Decimal("0.00000001"), rounding=ROUND_HALF_EVEN
    )
    return {"available": True, "value": float(value)}


def metrics(
    scorable_truth_count: int,
    detected_truth_count: int,
    observation_count: int,
    matched_observation_count: int,
    unscored_observation_count: int,
) -> dict[str, Any]:
    false_negative_count = scorable_truth_count - detected_truth_count
    false_positive_count = observation_count - matched_observation_count - unscored_observation_count
    if false_negative_count < 0 or false_positive_count < 0:
        raise ValueError("Visual OCR diagnostic counts are internally inconsistent.")
    precision_denominator = matched_observation_count + false_positive_count
    return {
        "scorableTruthCount": scorable_truth_count,
        "detectedTruthCount": detected_truth_count,
        "falseNegativeCount": false_negative_count,
        "observationCount": observation_count,
        "matchedObservationCount": matched_observation_count,
        "unscoredObservationCount": unscored_observation_count,
        "falsePositiveCount": false_positive_count,
        "precision": ratio(matched_observation_count, precision_denominator),
        "recall": ratio(detected_truth_count, scorable_truth_count),
    }


def compile_case_report(
    case_id: str,
    subject_pack: str,
    truth_ref: str,
    truth_bytes: bytes,
    truth: dict[str, Any],
    ocr_ref: str,
    ocr_bytes: bytes,
    ocr_result: dict[str, Any],
) -> dict[str, Any]:
    labels = truth.get("labels")
    observations = ocr_result.get("observations")
    if not isinstance(labels, list) or not isinstance(observations, list):
        raise ValueError(f"{case_id} truth labels or OCR observations are invalid.")
    label_ids = [label.get("labelId") for label in labels if isinstance(label, dict)]
    observation_ids = [
        observation.get("observationId") for observation in observations if isinstance(observation, dict)
    ]
    if len(label_ids) != len(labels) or len(set(label_ids)) != len(label_ids) or label_ids != sorted(label_ids):
        raise ValueError(f"{case_id} truth label IDs must be unique and sorted.")
    if (
        len(observation_ids) != len(observations)
        or len(set(observation_ids)) != len(observation_ids)
        or observation_ids != sorted(observation_ids)
    ):
        raise ValueError(f"{case_id} OCR observation IDs must be unique and sorted.")
    fully_visible = [label for label in labels if label.get("visibilityDisposition") == "fully_visible"]
    partial = [label for label in labels if label.get("visibilityDisposition") == "partially_clipped"]
    outside = [label for label in labels if label.get("visibilityDisposition") == "outside_crop"]
    if len(fully_visible) + len(partial) + len(outside) != len(labels):
        raise ValueError(f"{case_id} truth visibility disposition is invalid.")
    fully_visible_texts = [label.get("text") for label in fully_visible]
    if len(set(fully_visible_texts)) != len(fully_visible_texts):
        raise ValueError(f"{case_id} duplicate scorable truth text is not admitted.")
    pixel_size = truth.get("crop", {}).get("pixelSize")
    if not isinstance(pixel_size, dict):
        raise ValueError(f"{case_id} truth crop pixelSize is invalid.")
    for label in fully_visible + partial:
        validate_bounds(label.get("cropIntersectionBounds"), f"{case_id} truth crop bounds", pixel_size)
    for label in outside:
        if "cropIntersectionBounds" in label:
            raise ValueError(f"{case_id} outside-crop truth label cannot have crop bounds.")
    observation_bounds = {
        observation["observationId"]: quad_bounds(observation.get("quad"), pixel_size)
        for observation in observations
    }
    matched_observations: set[str] = set()
    matches = []
    unmatched_truth_refs = []
    for label in fully_visible:
        label_bounds = validate_bounds(
            label.get("cropIntersectionBounds"), f"{case_id} truth crop bounds", pixel_size
        )
        candidates = [
            observation
            for observation in observations
            if observation.get("observationId") not in matched_observations
            and observation.get("observedText") == label.get("text")
            and positive_intersection(label_bounds, observation_bounds[observation["observationId"]])
        ]
        if len(candidates) > 1:
            raise ValueError(f"{case_id} has ambiguous repeated exact OCR match candidates.")
        if not candidates:
            unmatched_truth_refs.append(label["labelId"])
            continue
        observation_id = candidates[0]["observationId"]
        matched_observations.add(observation_id)
        matches.append(
            {
                "truthLabelRef": label["labelId"],
                "ocrObservationRef": observation_id,
                "diagnosticDisposition": "exact_text_positive_overlap",
            }
        )
    unscored_observations: list[str] = []
    false_positive_observations: list[str] = []
    for observation in observations:
        observation_id = observation["observationId"]
        if observation_id in matched_observations:
            continue
        partial_candidates = [
            label
            for label in partial
            if observation.get("observedText") == label.get("text")
            and positive_intersection(
                validate_bounds(
                    label.get("cropIntersectionBounds"),
                    f"{case_id} partial truth crop bounds",
                    pixel_size,
                ),
                observation_bounds[observation_id],
            )
        ]
        if len(partial_candidates) > 1:
            raise ValueError(f"{case_id} has ambiguous repeated partial OCR match candidates.")
        if partial_candidates:
            unscored_observations.append(observation_id)
        else:
            false_positive_observations.append(observation_id)
    case_metrics = metrics(
        len(fully_visible),
        len(matches),
        len(observations),
        len(matches),
        len(unscored_observations),
    )
    return {
        "caseId": case_id,
        "subjectPack": subject_pack,
        "truth": artifact_contract(truth_ref, truth_bytes),
        "ocrObservationResult": upstream_contract(ocr_ref, ocr_bytes, case_id),
        "matches": matches,
        "unmatchedTruthRefs": unmatched_truth_refs,
        "falsePositiveObservationRefs": false_positive_observations,
        "unscoredObservationRefs": unscored_observations,
        "metrics": case_metrics,
    }


def aggregate_metrics(case_reports: list[dict[str, Any]]) -> dict[str, Any]:
    fields = (
        "scorableTruthCount", "detectedTruthCount", "observationCount",
        "matchedObservationCount", "unscoredObservationCount",
    )
    totals = {field: sum(report["metrics"][field] for report in case_reports) for field in fields}
    return metrics(
        totals["scorableTruthCount"],
        totals["detectedTruthCount"],
        totals["observationCount"],
        totals["matchedObservationCount"],
        totals["unscoredObservationCount"],
    )


def validate_inventory(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualOcrDiagnosticCaseInventory",
    )
    if (
        inventory.get("schemaVersion") != "1.0"
        or inventory.get("kind") != "visual-ocr-diagnostic-case-inventory"
        or inventory.get("fixtureSetId") != "synthetic-visual-ocr-diagnostic-v1"
        or inventory.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualOcrDiagnosticCaseInventory metadata is not admitted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("VisualOcrDiagnosticCaseInventory coverage drifted.")
    if [entry.get("caseId") for entry in entries if isinstance(entry, dict)] != [
        definition.case_id for definition in DEFINITIONS
    ]:
        raise ValueError("VisualOcrDiagnosticCaseInventory case order or coverage drifted.")
    if [entry.get("subjectPack") for entry in entries if isinstance(entry, dict)] != [
        definition.subject_pack for definition in DEFINITIONS
    ]:
        raise ValueError("VisualOcrDiagnosticCaseInventory subject order drifted.")
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("VisualOcrDiagnosticCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId", "subjectPack", "truthRef", "truthSha256",
                "ocrObservationResultRef", "ocrObservationResultSha256",
            },
            "VisualOcrDiagnosticCaseInventory entry",
        )
        if not is_sha256(entry.get("truthSha256")) or not is_sha256(
            entry.get("ocrObservationResultSha256")
        ):
            raise ValueError("VisualOcrDiagnosticCaseInventory entry hashes are invalid.")
    return entries


def _compile_report_snapshot(
    fixture_root: Path = CANONICAL_ROOT,
    authorities: AuthoritySet | None = None,
) -> DiagnosticCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    current_authorities = authorities or validate_upstream_authorities()
    inventory_path = resolve_bound_file(
        fixture_root, INVENTORY_NAME, "visual OCR diagnostic inventory"
    )
    inventory_bytes, inventory = read_json_bytes(
        inventory_path, "VisualOcrDiagnosticCaseInventory"
    )
    diagnostic_snapshots = [
        (inventory_path, inventory_bytes, "Visual OCR diagnostic inventory")
    ]
    entries = validate_inventory(inventory)
    referenced_identities = {file_identity(inventory_path)}
    case_reports = []
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        expected_truth_ref = truth_name(definition.case_id)
        expected_ocr_ref = f"eval/visual-ocr-observation/cases/{ocr_result_name(definition.case_id)}"
        authority = current_authorities.fixtures[definition.case_id]
        if (
            entry.get("truthRef") != expected_truth_ref
            or entry.get("ocrObservationResultRef") != expected_ocr_ref
            or entry.get("ocrObservationResultSha256") != sha256_bytes(authority.ocr_bytes)
        ):
            raise ValueError(f"{definition.case_id} diagnostic inventory upstream binding drifted.")
        truth_path = resolve_bound_file(
            fixture_root, entry["truthRef"], f"{definition.case_id} synthetic text truth"
        )
        identity = file_identity(truth_path)
        if identity in referenced_identities:
            raise ValueError(f"{definition.case_id} truth aliases another authority by physical identity.")
        referenced_identities.add(identity)
        truth_bytes, truth = read_json_bytes(truth_path, "VisualSyntheticTextTruth")
        diagnostic_snapshots.append(
            (truth_path, truth_bytes, f"{definition.case_id} synthetic text truth")
        )
        if sha256_bytes(truth_bytes) != entry.get("truthSha256"):
            raise ValueError(f"{definition.case_id} truth raw-byte SHA-256 drifted.")
        expected_truth = build_truth(definition, current_authorities)
        if truth != expected_truth:
            raise ValueError(f"{definition.case_id} truth drifted from renderer declarations.")
        case_reports.append(
            compile_case_report(
                definition.case_id,
                definition.subject_pack,
                f"eval/visual-ocr-diagnostics/cases/{truth_path.name}",
                truth_bytes,
                truth,
                expected_ocr_ref,
                authority.ocr_bytes,
                authority.ocr_result,
            )
        )
    subject_reports = []
    for subject_pack in SUBJECT_PACKS:
        selected = [report for report in case_reports if report["subjectPack"] == subject_pack]
        if not selected:
            raise ValueError(f"Visual OCR diagnostic subject {subject_pack} has no cases.")
        subject_reports.append(
            {"subjectPack": subject_pack, "caseCount": len(selected), "metrics": aggregate_metrics(selected)}
        )
    report = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-diagnostic-report",
        "fixtureSetId": "synthetic-visual-ocr-diagnostic-v1",
        "fixtureKind": "synthetic_fixture",
        "sourceInventory": artifact_contract(
            f"eval/visual-ocr-diagnostics/cases/{INVENTORY_NAME}", inventory_bytes
        ),
        "caseReports": case_reports,
        "subjectReports": subject_reports,
        "totals": aggregate_metrics(case_reports),
        "diagnosticPolicySha256": sha256_bytes(stable_json_bytes(diagnostic_policy())),
        "dispositions": {
            "diagnosticStatus": "completed",
            "diagnosticScope": "generator_declared_synthetic_fixture",
            "acceptanceDisposition": "not_accepted",
            "requiresHumanReview": True,
            "layoutDisposition": "not_inferred",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        },
        "engineProvenance": {
            "engineKind": "deterministic_diagnostic",
            "engineId": "visual-ocr-diagnostics",
            "engineVersion": "1.0.0",
            "interpreter": INTERPRETER,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": REPORT_GENERATED_AT,
    }
    validate_authority_snapshots(current_authorities)
    compilation = DiagnosticCompilation(
        report=report,
        snapshots=current_authorities.snapshots + tuple(diagnostic_snapshots),
    )
    validate_diagnostic_snapshots(compilation)
    return compilation


def compile_report(
    fixture_root: Path = CANONICAL_ROOT,
    authorities: AuthoritySet | None = None,
) -> dict[str, Any]:
    return _compile_report_snapshot(fixture_root, authorities).report


def validated_canonical_compilation(
    fixture_root: Path = CANONICAL_ROOT,
) -> DiagnosticCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    validate_fixture_structure(fixture_root)
    authorities = validate_upstream_authorities()
    compilation = _compile_report_snapshot(fixture_root, authorities)
    report = compilation.report
    report_path = resolve_bound_file(fixture_root, REPORT_NAME, "visual OCR diagnostic report")
    report_bytes, tracked_report = read_json_bytes(report_path, "VisualOcrDiagnosticReport")
    if report_bytes != stable_json_bytes(report) or tracked_report != report:
        raise ValueError("Visual OCR diagnostic report does not deterministically replay.")
    return DiagnosticCompilation(
        report=report,
        snapshots=compilation.snapshots
        + ((report_path, report_bytes, "Visual OCR diagnostic report"),),
    )


def validate_fixture_structure(fixture_root: Path) -> None:
    expected_names = {INVENTORY_NAME, REPORT_NAME} | {
        truth_name(definition.case_id) for definition in DEFINITIONS
    }
    actual_paths = list(fixture_root.rglob("*"))
    if any(path.is_dir() or path.is_symlink() for path in actual_paths):
        raise ValueError("Visual OCR diagnostic authority cannot contain nested or symlink entries.")
    if {path.name for path in actual_paths} != expected_names:
        raise ValueError("Visual OCR diagnostic authority coverage drifted.")
    identities = [file_identity(path) for path in actual_paths]
    if len(set(identities)) != len(identities):
        raise ValueError("Visual OCR diagnostic authority files must have unique physical identities.")


def validate_canonical_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    compilation = validated_canonical_compilation(fixture_root)
    validate_fixture_structure(fixture_root)
    validate_diagnostic_snapshots(compilation)
    return len(DEFINITIONS)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root.mkdir(parents=True, exist_ok=True)
    authorities = validate_upstream_authorities()
    entries = []
    for definition in DEFINITIONS:
        truth = build_truth(definition, authorities)
        truth_bytes = stable_json_bytes(truth)
        truth_path = fixture_root / truth_name(definition.case_id)
        atomic_write(truth_path, truth_bytes)
        authority = authorities.fixtures[definition.case_id]
        entries.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "truthRef": truth_path.name,
                "truthSha256": sha256_bytes(truth_bytes),
                "ocrObservationResultRef": (
                    f"eval/visual-ocr-observation/cases/{ocr_result_name(definition.case_id)}"
                ),
                "ocrObservationResultSha256": sha256_bytes(authority.ocr_bytes),
            }
        )
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-ocr-diagnostic-case-inventory",
        "fixtureSetId": "synthetic-visual-ocr-diagnostic-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    report = compile_report(fixture_root, authorities)
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
    compilation = validated_canonical_compilation(fixture_root)
    report_bytes = stable_json_bytes(compilation.report)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        stage_report = stage / REPORT_NAME
        atomic_write(stage_report, report_bytes)
        validate_file_snapshot(stage_report, report_bytes, "Staged visual OCR diagnostic report")
        validate_fixture_structure(fixture_root)
        validate_diagnostic_snapshots(compilation)
        os.replace(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output / REPORT_NAME


def run_diagnostics(output_dir: Path) -> Path:
    return _run_diagnostics(output_dir, CANONICAL_ROOT)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generator-declared synthetic OCR diagnostics.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic visual OCR diagnostic fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic visual OCR diagnostic fixtures.")
        return 0
    report_path = run_diagnostics(args.out)
    print(json.dumps({"status": "ok", "reportPath": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
