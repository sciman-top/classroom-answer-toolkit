from __future__ import annotations

import argparse
import json
import os
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
OCR_DIAGNOSTIC_TOOL_ROOT = TOOL_ROOT.parent / "visual-ocr-diagnostics"
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))
sys.path.insert(0, str(STRUCTURE_TOOL_ROOT))
sys.path.insert(0, str(OCR_DIAGNOSTIC_TOOL_ROOT))

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
from visual_structure_extractor import (  # noqa: E402
    CANONICAL_ROOT as STRUCTURE_ROOT,
    INVENTORY_NAME as STRUCTURE_INVENTORY_NAME,
    validate_canonical_fixtures as validate_structure_fixtures,
)
from visual_ocr_diagnostics import (  # noqa: E402
    CANONICAL_ROOT as TRUTH_ROOT,
    DEFINITIONS,
    INTERPRETER,
    INVENTORY_NAME as TRUTH_INVENTORY_NAME,
    SUBJECT_PACKS,
    artifact_contract,
    truth_name,
    upstream_contract,
    validate_bounds,
    validate_canonical_fixtures as validate_truth_fixtures,
    validate_file_snapshot,
    validate_runtime_identity,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-text-region-diagnostics" / "cases").resolve()
INVENTORY_NAME = "visual-text-region-diagnostic-case-inventory.json"
REPORT_NAME = "visual-text-region-diagnostic-report.json"
REPORT_GENERATED_AT = "2026-07-29T05:20:00Z"


@dataclass(frozen=True)
class UpstreamFixture:
    structure_path: Path
    structure_bytes: bytes
    structure_result: dict[str, Any]
    truth_path: Path
    truth_bytes: bytes
    truth: dict[str, Any]


@dataclass(frozen=True)
class UpstreamSet:
    fixtures: dict[str, UpstreamFixture]
    snapshots: tuple[tuple[Path, bytes, str], ...]


@dataclass(frozen=True)
class DiagnosticCompilation:
    report: dict[str, Any]
    snapshots: tuple[tuple[Path, bytes, str], ...]


def structure_result_name(case_id: str) -> str:
    return f"{case_id}.visual-structure-extraction-result.json"


def structure_result_ref(case_id: str) -> str:
    return f"eval/visual-structure-extraction/cases/{structure_result_name(case_id)}"


def truth_ref(case_id: str) -> str:
    return f"eval/visual-ocr-diagnostics/cases/{truth_name(case_id)}"


def diagnostic_policy() -> dict[str, Any]:
    return {
        "scorableVisibility": "fully_visible",
        "coordinateSpace": "crop_pixel",
        "rectangleEdgeMode": "half_open",
        "matchIntersection": "positive_area",
        "partialOverlapDisposition": "unscored",
        "outsideCropShielding": False,
        "ambiguousCandidateDisposition": "fail_closed",
        "enumerationOrder": ["truth_label_id", "text_region_candidate_id"],
        "ratioPrecision": 8,
    }


def validate_snapshots(snapshots: tuple[tuple[Path, bytes, str], ...]) -> None:
    for path, expected_bytes, label in snapshots:
        validate_file_snapshot(path, expected_bytes, label)


def inventory_entry(inventory: dict[str, Any], case_id: str, label: str) -> dict[str, Any]:
    entries = inventory.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"{label} inventory entries are invalid.")
    matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("caseId") == case_id]
    if len(matches) != 1:
        raise ValueError(f"{label} inventory case coverage drifted for {case_id}.")
    return matches[0]


def crop_binding(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Upstream crop authority is invalid.")
    fields = ("artifactRef", "scale", "rawByteSha256", "decodedRgbPixelSha256", "pixelSize")
    if any(field not in value for field in fields):
        raise ValueError("Upstream crop authority is incomplete.")
    return {field: value[field] for field in fields}


def load_upstream_authorities() -> UpstreamSet:
    structure_inventory_path = resolve_bound_file(
        STRUCTURE_ROOT, STRUCTURE_INVENTORY_NAME, "structure extraction inventory"
    )
    truth_inventory_path = resolve_bound_file(
        TRUTH_ROOT, TRUTH_INVENTORY_NAME, "synthetic text truth inventory"
    )
    structure_inventory_bytes, structure_inventory = read_json_bytes(
        structure_inventory_path, "VisualStructureExtractionCaseInventory"
    )
    truth_inventory_bytes, truth_inventory = read_json_bytes(
        truth_inventory_path, "VisualOcrDiagnosticCaseInventory"
    )
    snapshots: list[tuple[Path, bytes, str]] = [
        (structure_inventory_path, structure_inventory_bytes, "Structure extraction inventory"),
        (truth_inventory_path, truth_inventory_bytes, "Synthetic text truth inventory"),
    ]
    validate_structure_fixtures()
    validate_truth_fixtures()
    validate_snapshots(tuple(snapshots))

    fixtures = {}
    identities = {file_identity(structure_inventory_path), file_identity(truth_inventory_path)}
    for definition in DEFINITIONS:
        case_id = definition.case_id
        structure_path = resolve_bound_file(
            STRUCTURE_ROOT, structure_result_name(case_id), f"{case_id} structure result"
        )
        truth_path = resolve_bound_file(TRUTH_ROOT, truth_name(case_id), f"{case_id} synthetic truth")
        for path in (structure_path, truth_path):
            identity = file_identity(path)
            if identity in identities:
                raise ValueError(f"{case_id} upstream authority aliases another physical file.")
            identities.add(identity)
        structure_bytes, structure_result = read_json_bytes(
            structure_path, "VisualStructureExtractionResult"
        )
        truth_bytes, truth = read_json_bytes(truth_path, "VisualSyntheticTextTruth")
        structure_entry = inventory_entry(structure_inventory, case_id, "Structure extraction")
        truth_entry = inventory_entry(truth_inventory, case_id, "Synthetic text truth")
        if (
            structure_entry.get("subjectPack") != definition.subject_pack
            or structure_entry.get("expectedResultRef") != structure_path.name
            or structure_entry.get("expectedResultSha256") != sha256_bytes(structure_bytes)
        ):
            raise ValueError(f"{case_id} structure result drifted from its inventory authority.")
        if (
            truth_entry.get("subjectPack") != definition.subject_pack
            or truth_entry.get("truthRef") != truth_path.name
            or truth_entry.get("truthSha256") != sha256_bytes(truth_bytes)
        ):
            raise ValueError(f"{case_id} synthetic truth drifted from its inventory authority.")
        expected_identity = {
            "subjectPack": definition.subject_pack,
            "fixtureKind": "synthetic_fixture",
        }
        if structure_result.get("requestId") != case_id or truth.get("caseId") != case_id:
            raise ValueError(f"{case_id} upstream request identity drifted.")
        for field, expected in expected_identity.items():
            if structure_result.get(field) != expected or truth.get(field) != expected:
                raise ValueError(f"{case_id} upstream {field} drifted.")
        if crop_binding(structure_result.get("crop")) != crop_binding(truth.get("crop")):
            raise ValueError(f"{case_id} structure and truth crop authorities differ.")
        snapshots.extend(
            [
                (structure_path, structure_bytes, f"{case_id} structure result"),
                (truth_path, truth_bytes, f"{case_id} synthetic truth"),
            ]
        )
        fixtures[case_id] = UpstreamFixture(
            structure_path, structure_bytes, structure_result, truth_path, truth_bytes, truth
        )
    upstream = UpstreamSet(fixtures, tuple(snapshots))
    validate_snapshots(upstream.snapshots)
    return upstream


def rounded_ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        raise ValueError("Coverage ratio denominator must be positive.")
    value = (Decimal(str(numerator)) / Decimal(str(denominator))).quantize(
        Decimal("0.00000001"), rounding=ROUND_HALF_EVEN
    )
    return float(value)


def available_ratio(numerator: int, denominator: int) -> dict[str, Any]:
    if denominator == 0:
        return {"available": False}
    return {"available": True, "value": rounded_ratio(numerator, denominator)}


def intersection_area(first: dict[str, float], second: dict[str, float]) -> float:
    width = max(
        0.0,
        min(first["x"] + first["width"], second["x"] + second["width"])
        - max(first["x"], second["x"]),
    )
    height = max(
        0.0,
        min(first["y"] + first["height"], second["y"] + second["height"])
        - max(first["y"], second["y"]),
    )
    return width * height


def metrics(
    scorable_truth_count: int,
    detected_truth_count: int,
    candidate_count: int,
    matched_candidate_count: int,
    unscored_candidate_count: int,
) -> dict[str, Any]:
    false_negative_count = scorable_truth_count - detected_truth_count
    false_positive_count = candidate_count - matched_candidate_count - unscored_candidate_count
    if false_negative_count < 0 or false_positive_count < 0:
        raise ValueError("Visual text-region diagnostic counts are internally inconsistent.")
    precision_denominator = matched_candidate_count + false_positive_count
    return {
        "scorableTruthCount": scorable_truth_count,
        "detectedTruthCount": detected_truth_count,
        "falseNegativeCount": false_negative_count,
        "candidateCount": candidate_count,
        "matchedCandidateCount": matched_candidate_count,
        "unscoredCandidateCount": unscored_candidate_count,
        "falsePositiveCount": false_positive_count,
        "precision": available_ratio(matched_candidate_count, precision_denominator),
        "recall": available_ratio(detected_truth_count, scorable_truth_count),
    }


def validate_ids(values: list[Any], expected_prefix: str, label: str) -> list[str]:
    ids = [value.get(label) for value in values if isinstance(value, dict)]
    if (
        len(ids) != len(values)
        or any(not isinstance(value, str) or not value.startswith(expected_prefix) for value in ids)
        or len(set(ids)) != len(ids)
        or ids != sorted(ids)
    ):
        raise ValueError(f"{label} values must be unique, sorted, and correctly prefixed.")
    return ids


def compile_case_report(
    case_id: str,
    subject_pack: str,
    truth_reference: str,
    truth_bytes: bytes,
    truth: dict[str, Any],
    structure_reference: str,
    structure_bytes: bytes,
    structure_result: dict[str, Any],
) -> dict[str, Any]:
    labels = truth.get("labels")
    candidates = structure_result.get("textRegionCandidates")
    if not isinstance(labels, list) or not isinstance(candidates, list):
        raise ValueError(f"{case_id} truth labels or text-region candidates are invalid.")
    validate_ids(labels, "truth-label-", "labelId")
    validate_ids(candidates, "text-region-", "candidateId")
    fully_visible = [label for label in labels if label.get("visibilityDisposition") == "fully_visible"]
    partial = [label for label in labels if label.get("visibilityDisposition") == "partially_clipped"]
    outside = [label for label in labels if label.get("visibilityDisposition") == "outside_crop"]
    if len(fully_visible) + len(partial) + len(outside) != len(labels):
        raise ValueError(f"{case_id} truth visibility disposition is invalid.")
    pixel_size = truth.get("crop", {}).get("pixelSize")
    if not isinstance(pixel_size, dict):
        raise ValueError(f"{case_id} truth crop pixelSize is invalid.")
    truth_bounds = {}
    for label in fully_visible + partial:
        truth_bounds[label["labelId"]] = validate_bounds(
            label.get("cropIntersectionBounds"), f"{case_id} truth crop bounds", pixel_size
        )
    for label in outside:
        if "cropIntersectionBounds" in label:
            raise ValueError(f"{case_id} outside-crop truth cannot have crop bounds.")
    candidate_bounds = {
        candidate["candidateId"]: validate_bounds(
            candidate.get("bbox"), f"{case_id} candidate bounds", pixel_size
        )
        for candidate in candidates
    }

    scorable_by_candidate: dict[str, list[dict[str, Any]]] = {}
    candidates_by_truth: dict[str, list[dict[str, Any]]] = {label["labelId"]: [] for label in fully_visible}
    for candidate in candidates:
        candidate_id = candidate["candidateId"]
        overlaps = [
            label
            for label in fully_visible
            if intersection_area(candidate_bounds[candidate_id], truth_bounds[label["labelId"]]) > 0
        ]
        if len(overlaps) > 1:
            raise ValueError(f"{case_id} candidate overlaps multiple scorable truth labels.")
        scorable_by_candidate[candidate_id] = overlaps
        for label in overlaps:
            candidates_by_truth[label["labelId"]].append(candidate)
    if any(len(matches) > 1 for matches in candidates_by_truth.values()):
        raise ValueError(f"{case_id} scorable truth overlaps multiple text-region candidates.")

    matches = []
    matched_candidates: set[str] = set()
    unmatched_truth_refs = []
    for label in fully_visible:
        label_id = label["labelId"]
        matches_for_truth = candidates_by_truth[label_id]
        if not matches_for_truth:
            unmatched_truth_refs.append(label_id)
            continue
        candidate = matches_for_truth[0]
        candidate_id = candidate["candidateId"]
        matched_candidates.add(candidate_id)
        area = intersection_area(truth_bounds[label_id], candidate_bounds[candidate_id])
        truth_area = truth_bounds[label_id]["width"] * truth_bounds[label_id]["height"]
        candidate_area = candidate_bounds[candidate_id]["width"] * candidate_bounds[candidate_id]["height"]
        matches.append(
            {
                "truthLabelRef": label_id,
                "textRegionCandidateRef": candidate_id,
                "truthBounds": label.get("cropIntersectionBounds"),
                "candidateBounds": candidate.get("bbox"),
                "intersectionArea": area,
                "truthCoverage": rounded_ratio(area, truth_area),
                "candidateCoverage": rounded_ratio(area, candidate_area),
                "diagnosticDisposition": "positive_overlap",
            }
        )

    unscored_candidates = []
    false_positive_candidates = []
    for candidate in candidates:
        candidate_id = candidate["candidateId"]
        if candidate_id in matched_candidates:
            continue
        partial_overlaps = [
            label
            for label in partial
            if intersection_area(candidate_bounds[candidate_id], truth_bounds[label["labelId"]]) > 0
        ]
        if partial_overlaps:
            unscored_candidates.append(candidate_id)
        else:
            false_positive_candidates.append(candidate_id)
    case_metrics = metrics(
        len(fully_visible), len(matches), len(candidates), len(matches), len(unscored_candidates)
    )
    return {
        "caseId": case_id,
        "subjectPack": subject_pack,
        "truth": artifact_contract(truth_reference, truth_bytes),
        "structureExtractionResult": upstream_contract(
            structure_reference, structure_bytes, case_id
        ),
        "matches": matches,
        "unmatchedTruthRefs": unmatched_truth_refs,
        "falsePositiveCandidateRefs": false_positive_candidates,
        "unscoredCandidateRefs": unscored_candidates,
        "metrics": case_metrics,
    }


def aggregate_metrics(case_reports: list[dict[str, Any]]) -> dict[str, Any]:
    fields = (
        "scorableTruthCount",
        "detectedTruthCount",
        "candidateCount",
        "matchedCandidateCount",
        "unscoredCandidateCount",
    )
    totals = {field: sum(report["metrics"][field] for report in case_reports) for field in fields}
    return metrics(
        totals["scorableTruthCount"],
        totals["detectedTruthCount"],
        totals["candidateCount"],
        totals["matchedCandidateCount"],
        totals["unscoredCandidateCount"],
    )


def validate_inventory(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualTextRegionDiagnosticCaseInventory",
    )
    expected = {
        "schemaVersion": "1.0",
        "kind": "visual-text-region-diagnostic-case-inventory",
        "fixtureSetId": "synthetic-visual-text-region-diagnostic-v1",
        "fixtureKind": "synthetic_fixture",
    }
    if any(inventory.get(field) != value for field, value in expected.items()):
        raise ValueError("VisualTextRegionDiagnosticCaseInventory identity drifted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("VisualTextRegionDiagnosticCaseInventory coverage drifted.")
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        if not isinstance(entry, dict):
            raise ValueError("VisualTextRegionDiagnosticCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId",
                "subjectPack",
                "truthRef",
                "truthSha256",
                "structureExtractionResultRef",
                "structureExtractionResultSha256",
            },
            "VisualTextRegionDiagnosticCaseInventory entry",
        )
        if entry.get("caseId") != definition.case_id or entry.get("subjectPack") != definition.subject_pack:
            raise ValueError("VisualTextRegionDiagnosticCaseInventory entry identity drifted.")
        if not is_sha256(entry.get("truthSha256")) or not is_sha256(
            entry.get("structureExtractionResultSha256")
        ):
            raise ValueError("VisualTextRegionDiagnosticCaseInventory hashes are invalid.")
    return entries


def _compile_report_snapshot(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamSet | None = None,
) -> DiagnosticCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    authorities = upstream or load_upstream_authorities()
    inventory_path = resolve_bound_file(
        fixture_root, INVENTORY_NAME, "visual text-region diagnostic inventory"
    )
    inventory_bytes, inventory = read_json_bytes(
        inventory_path, "VisualTextRegionDiagnosticCaseInventory"
    )
    entries = validate_inventory(inventory)
    case_reports = []
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        authority = authorities.fixtures[definition.case_id]
        if (
            entry.get("truthRef") != truth_ref(definition.case_id)
            or entry.get("truthSha256") != sha256_bytes(authority.truth_bytes)
            or entry.get("structureExtractionResultRef") != structure_result_ref(definition.case_id)
            or entry.get("structureExtractionResultSha256") != sha256_bytes(authority.structure_bytes)
        ):
            raise ValueError(f"{definition.case_id} diagnostic inventory upstream binding drifted.")
        case_reports.append(
            compile_case_report(
                definition.case_id,
                definition.subject_pack,
                entry["truthRef"],
                authority.truth_bytes,
                authority.truth,
                entry["structureExtractionResultRef"],
                authority.structure_bytes,
                authority.structure_result,
            )
        )
    subject_reports = []
    for subject_pack in SUBJECT_PACKS:
        selected = [report for report in case_reports if report["subjectPack"] == subject_pack]
        if not selected:
            raise ValueError(f"Visual text-region diagnostic subject {subject_pack} coverage drifted.")
        subject_reports.append(
            {
                "subjectPack": subject_pack,
                "caseCount": len(selected),
                "metrics": aggregate_metrics(selected),
            }
        )
    report = {
        "schemaVersion": "1.0",
        "kind": "visual-text-region-diagnostic-report",
        "fixtureSetId": "synthetic-visual-text-region-diagnostic-v1",
        "fixtureKind": "synthetic_fixture",
        "sourceInventory": artifact_contract(
            f"eval/visual-text-region-diagnostics/cases/{INVENTORY_NAME}", inventory_bytes
        ),
        "caseReports": case_reports,
        "subjectReports": subject_reports,
        "totals": aggregate_metrics(case_reports),
        "diagnosticPolicySha256": sha256_bytes(stable_json_bytes(diagnostic_policy())),
        "dispositions": {
            "diagnosticStatus": "completed",
            "diagnosticScope": "generator_declared_synthetic_fixture",
            "candidateKind": "text_region_candidate",
            "acceptanceDisposition": "not_accepted",
            "requiresHumanReview": True,
            "ocrDisposition": "not_inferred",
            "associationDisposition": "not_decided",
            "layoutDisposition": "not_inferred",
            "semanticDisposition": "not_inferred",
            "trackDisposition": "not_integrated",
        },
        "engineProvenance": {
            "engineKind": "deterministic_diagnostic",
            "engineId": "visual-text-region-diagnostics",
            "engineVersion": "1.0.0",
            "interpreter": INTERPRETER,
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": REPORT_GENERATED_AT,
    }
    compilation = DiagnosticCompilation(
        report, authorities.snapshots + ((inventory_path, inventory_bytes, "Diagnostic inventory"),)
    )
    validate_snapshots(compilation.snapshots)
    return compilation


def compile_report(
    fixture_root: Path = CANONICAL_ROOT,
    upstream: UpstreamSet | None = None,
) -> dict[str, Any]:
    return _compile_report_snapshot(fixture_root, upstream).report


def validate_fixture_structure(fixture_root: Path) -> None:
    expected_names = {INVENTORY_NAME, REPORT_NAME}
    actual_paths = list(fixture_root.rglob("*"))
    if any(
        path.is_dir()
        or path.is_symlink()
        or (hasattr(path, "is_junction") and path.is_junction())
        for path in actual_paths
    ):
        raise ValueError("Visual text-region diagnostic authority cannot contain nested or alias entries.")
    if {path.name for path in actual_paths} != expected_names:
        raise ValueError("Visual text-region diagnostic authority coverage drifted.")
    identities = [file_identity(path) for path in actual_paths]
    if len(set(identities)) != len(identities):
        raise ValueError("Visual text-region diagnostic authority files must have unique identities.")


def validated_canonical_compilation(
    fixture_root: Path = CANONICAL_ROOT,
) -> DiagnosticCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    validate_runtime_identity()
    validate_fixture_structure(fixture_root)
    compilation = _compile_report_snapshot(fixture_root)
    report_path = resolve_bound_file(fixture_root, REPORT_NAME, "visual text-region diagnostic report")
    report_bytes, tracked_report = read_json_bytes(report_path, "VisualTextRegionDiagnosticReport")
    if report_bytes != stable_json_bytes(compilation.report) or tracked_report != compilation.report:
        raise ValueError("Visual text-region diagnostic report does not deterministically replay.")
    compilation = DiagnosticCompilation(
        compilation.report,
        compilation.snapshots + ((report_path, report_bytes, "Diagnostic report"),),
    )
    validate_snapshots(compilation.snapshots)
    return compilation


def validate_canonical_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    compilation = validated_canonical_compilation(fixture_root)
    validate_fixture_structure(fixture_root)
    validate_snapshots(compilation.snapshots)
    return len(DEFINITIONS)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    validate_runtime_identity()
    fixture_root.mkdir(parents=True, exist_ok=True)
    upstream = load_upstream_authorities()
    entries = []
    for definition in DEFINITIONS:
        authority = upstream.fixtures[definition.case_id]
        entries.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "truthRef": truth_ref(definition.case_id),
                "truthSha256": sha256_bytes(authority.truth_bytes),
                "structureExtractionResultRef": structure_result_ref(definition.case_id),
                "structureExtractionResultSha256": sha256_bytes(authority.structure_bytes),
            }
        )
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-text-region-diagnostic-case-inventory",
        "fixtureSetId": "synthetic-visual-text-region-diagnostic-v1",
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
    compilation = validated_canonical_compilation(fixture_root)
    report_bytes = stable_json_bytes(compilation.report)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        stage_report = stage / REPORT_NAME
        atomic_write(stage_report, report_bytes)
        validate_file_snapshot(stage_report, report_bytes, "Staged diagnostic report")
        validate_fixture_structure(fixture_root)
        validate_snapshots(compilation.snapshots)
        os.replace(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output / REPORT_NAME


def run_diagnostics(output_dir: Path) -> Path:
    return _run_diagnostics(output_dir, CANONICAL_ROOT)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generator-declared synthetic text-region diagnostics.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic text-region diagnostic fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic text-region diagnostic fixtures.")
        return 0
    report_path = run_diagnostics(args.out)
    print(json.dumps({"status": "ok", "reportPath": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
