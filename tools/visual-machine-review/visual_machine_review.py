from __future__ import annotations

import argparse
import json
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
sys.path.insert(0, str(PREPROCESSOR_TOOL_ROOT))

from visual_preprocessor import (  # noqa: E402
    CANONICAL_ROOT as PREPROCESSING_ROOT,
    INVENTORY_NAME as PREPROCESSING_INVENTORY_NAME,
    atomic_write,
    decode_png,
    decoded_pixel_sha256,
    file_identity,
    is_sha256,
    read_json_bytes,
    require_exact_keys,
    resolve_bound_file,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures as validate_preprocessing_fixtures,
)


CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-machine-review" / "cases").resolve()
INVENTORY_NAME = "visual-machine-review-case-inventory.json"
REPORT_NAME = "visual-machine-review-report.json"
REPORT_GENERATED_AT = "2026-07-28T06:10:00Z"
CHECK_CODES = (
    "primary_content_visibility",
    "required_label_legibility",
    "geometry_integrity",
    "crop_boundary_disclosure",
)
SUBJECT_PACKS = (
    "math-answer",
    "junior-physics-answer",
    "senior-physics-answer",
)


@dataclass(frozen=True)
class FixtureDefinition:
    case_id: str
    subject_pack: str
    reviewed_at: str
    inspection_surfaces: tuple[str, ...]
    limitations: tuple[str, ...]
    check_statuses: tuple[str, ...]
    check_notes: tuple[str, ...]

    @property
    def preprocessing_result_name(self) -> str:
        return f"{self.case_id}.visual-preprocessing-result.json"

    @property
    def receipt_name(self) -> str:
        return f"{self.case_id}.visual-machine-review-receipt.json"


DEFINITIONS = (
    FixtureDefinition(
        "math-function-graph",
        "math-answer",
        "2026-07-28T06:00:00Z",
        ("direct_image_render",),
        ("outside_crop_axis_label",),
        ("pass", "pass", "pass", "pass_with_limitation"),
        (
            "The plotted line, axes, and tick marks are visibly coherent.",
            "The visible y label is legible at the top of the crop.",
            "Axis and line geometry remain connected and undistorted.",
            "The source-declared x label is outside this admitted crop and remains disclosed.",
        ),
    ),
    FixtureDefinition(
        "junior-instrument-scale",
        "junior-physics-answer",
        "2026-07-28T06:01:00Z",
        ("direct_image_render",),
        ("partially_clipped_header",),
        ("pass", "pass_with_limitation", "pass", "pass_with_limitation"),
        (
            "The scale frame, ticks, and red indicator are visibly coherent.",
            "The header label is only partially visible and is not treated as fully legible.",
            "Tick spacing, border geometry, and indicator alignment remain intact.",
            "The partial header clipping is visible and explicitly preserved as a limitation.",
        ),
    ),
    FixtureDefinition(
        "senior-circuit-label",
        "senior-physics-answer",
        "2026-07-28T06:02:00Z",
        ("direct_image_render", "windows_honeyview"),
        ("partially_clipped_header",),
        ("pass", "pass", "pass", "pass_with_limitation"),
        (
            "The circuit loop, meter symbols, and connecting wires are visibly coherent.",
            "The A and R labels are legible inside their corresponding symbols.",
            "The circuit path and component geometry remain connected and undistorted.",
            "The synthetic-circuit header is partially clipped and remains disclosed.",
        ),
    ),
)
DEFINITION_BY_ID = {definition.case_id: definition for definition in DEFINITIONS}


@dataclass(frozen=True)
class ReviewCompilation:
    report: dict[str, Any]
    snapshots: tuple[tuple[Path, bytes, str], ...]


def preprocessing_result_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-preprocessing/cases/{definition.preprocessing_result_name}"


def crop_ref(crop_name: str) -> str:
    return f"eval/visual-preprocessing/cases/{crop_name}"


def receipt_ref(definition: FixtureDefinition) -> str:
    return f"eval/visual-machine-review/cases/{definition.receipt_name}"


def review_policy() -> dict[str, Any]:
    return {
        "reviewerKind": "ai_agent",
        "humanReviewed": False,
        "attestationClass": "unattested_local_machine_review",
        "equivalencePolicy": "synthetic_fixture_equivalent",
        "acceptanceScope": "synthetic_fixture_diagnostic",
        "limitationHandling": "disclose_and_preserve",
        "requiredChecks": list(CHECK_CODES),
    }


def select_two_x_crop(preprocessing_result: dict[str, Any]) -> dict[str, Any]:
    crops = preprocessing_result.get("cropArtifacts")
    if not isinstance(crops, list):
        raise ValueError("VisualPreprocessingResult cropArtifacts are required.")
    selected = [crop for crop in crops if isinstance(crop, dict) and crop.get("scale") == 2]
    if len(selected) != 1:
        raise ValueError("Machine visual review requires exactly one scale=2 crop.")
    return selected[0]


def artifact(reference: str, data: bytes) -> dict[str, str]:
    return {"artifactRef": reference, "rawByteSha256": sha256_bytes(data)}


def upstream_artifact(reference: str, data: bytes, request_id: str) -> dict[str, str]:
    return {
        "artifactRef": reference,
        "rawByteSha256": sha256_bytes(data),
        "requestId": request_id,
    }


def crop_artifact(crop: dict[str, Any]) -> dict[str, Any]:
    return {
        field: crop[field]
        for field in (
            "artifactRef",
            "scale",
            "rawByteSha256",
            "decodedRgbPixelSha256",
            "pixelSize",
        )
    }


def build_receipt(
    definition: FixtureDefinition,
    preprocessing_bytes: bytes,
    preprocessing_result: dict[str, Any],
) -> dict[str, Any]:
    crop = select_two_x_crop(preprocessing_result)
    checks = [
        {"checkCode": code, "status": status, "note": note}
        for code, status, note in zip(
            CHECK_CODES,
            definition.check_statuses,
            definition.check_notes,
            strict=True,
        )
    ]
    return {
        "schemaVersion": "1.0",
        "kind": "visual-machine-review-receipt",
        "reviewId": f"vision013-{definition.case_id}-review",
        "caseId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "preprocessingResult": upstream_artifact(
            preprocessing_result_ref(definition),
            preprocessing_bytes,
            definition.case_id,
        ),
        "crop": crop_artifact(crop),
        "reviewer": {
            "reviewerKind": "ai_agent",
            "reviewerId": "codex_visual_review",
            "humanReviewed": False,
            "attestationClass": "unattested_local_machine_review",
            "inspectionSurfaces": list(definition.inspection_surfaces),
            "liveProvider": False,
            "cloudEgress": False,
        },
        "reviewPolicy": {
            "equivalencePolicy": "synthetic_fixture_equivalent",
            "acceptanceScope": "synthetic_fixture_diagnostic",
            "limitationHandling": "disclose_and_preserve",
        },
        "checks": checks,
        "knownLimitations": list(definition.limitations),
        "decision": "accept_for_diagnostic_use",
        "dispositions": {
            "reviewStatus": "completed",
            "deliveryTrustDisposition": "not_projected",
            "wpfDisposition": "not_integrated",
            "liveAcceptanceDisposition": "not_accepted",
            "optimizationCandidateDisposition": "none",
            "controlsDisposition": "not_verified",
            "eligible": False,
        },
        "reviewedAt": definition.reviewed_at,
    }


def validate_snapshots(snapshots: tuple[tuple[Path, bytes, str], ...]) -> None:
    for path, expected_bytes, label in snapshots:
        if not path.is_file() or path.read_bytes() != expected_bytes:
            raise ValueError(f"{label} bytes drifted.")


def validate_hash_artifact(value: Any, label: str, request_id: str | None = None) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{label} is invalid.")
    expected = {"artifactRef", "rawByteSha256"}
    if request_id is not None:
        expected.add("requestId")
    require_exact_keys(value, expected, label)
    if not isinstance(value.get("artifactRef"), str) or not value["artifactRef"]:
        raise ValueError(f"{label} artifactRef is invalid.")
    if not is_sha256(value.get("rawByteSha256")):
        raise ValueError(f"{label} raw-byte SHA-256 is invalid.")
    if request_id is not None and value.get("requestId") != request_id:
        raise ValueError(f"{label} request identity drifted.")


def validate_receipt(
    receipt: dict[str, Any],
    definition: FixtureDefinition,
    preprocessing_contract: dict[str, Any],
    expected_crop: dict[str, Any],
) -> None:
    require_exact_keys(
        receipt,
        {
            "schemaVersion", "kind", "reviewId", "caseId", "subjectPack", "fixtureKind",
            "preprocessingResult", "crop", "reviewer", "reviewPolicy", "checks",
            "knownLimitations", "decision", "dispositions", "reviewedAt",
        },
        "VisualMachineReviewReceipt",
    )
    expected_scalars = {
        "schemaVersion": "1.0",
        "kind": "visual-machine-review-receipt",
        "reviewId": f"vision013-{definition.case_id}-review",
        "caseId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "decision": "accept_for_diagnostic_use",
        "reviewedAt": definition.reviewed_at,
    }
    if any(receipt.get(field) != expected for field, expected in expected_scalars.items()):
        raise ValueError(f"{definition.case_id} machine review identity or decision drifted.")
    validate_hash_artifact(receipt.get("preprocessingResult"), "preprocessingResult", definition.case_id)
    if receipt["preprocessingResult"] != preprocessing_contract:
        raise ValueError(f"{definition.case_id} preprocessing authority drifted.")
    if receipt.get("crop") != expected_crop:
        raise ValueError(f"{definition.case_id} crop authority drifted.")
    expected_reviewer = {
        "reviewerKind": "ai_agent",
        "reviewerId": "codex_visual_review",
        "humanReviewed": False,
        "attestationClass": "unattested_local_machine_review",
        "inspectionSurfaces": list(definition.inspection_surfaces),
        "liveProvider": False,
        "cloudEgress": False,
    }
    if receipt.get("reviewer") != expected_reviewer:
        raise ValueError(f"{definition.case_id} reviewer identity or inspection provenance drifted.")
    expected_policy = {
        "equivalencePolicy": "synthetic_fixture_equivalent",
        "acceptanceScope": "synthetic_fixture_diagnostic",
        "limitationHandling": "disclose_and_preserve",
    }
    if receipt.get("reviewPolicy") != expected_policy:
        raise ValueError(f"{definition.case_id} review policy drifted.")
    checks = receipt.get("checks")
    if not isinstance(checks, list) or len(checks) != len(CHECK_CODES):
        raise ValueError(f"{definition.case_id} review checks are incomplete.")
    expected_checks = [
        {"checkCode": code, "status": status, "note": note}
        for code, status, note in zip(
            CHECK_CODES,
            definition.check_statuses,
            definition.check_notes,
            strict=True,
        )
    ]
    if checks != expected_checks:
        raise ValueError(f"{definition.case_id} review checks or notes drifted.")
    if receipt.get("knownLimitations") != list(definition.limitations):
        raise ValueError(f"{definition.case_id} known limitations drifted.")
    if any(check["status"] == "fail" for check in checks):
        raise ValueError(f"{definition.case_id} accepted review cannot contain a failed check.")
    has_limited_check = any(check["status"] == "pass_with_limitation" for check in checks)
    if has_limited_check != bool(receipt["knownLimitations"]):
        raise ValueError(f"{definition.case_id} limitation disclosure is inconsistent.")
    expected_dispositions = {
        "reviewStatus": "completed",
        "deliveryTrustDisposition": "not_projected",
        "wpfDisposition": "not_integrated",
        "liveAcceptanceDisposition": "not_accepted",
        "optimizationCandidateDisposition": "none",
        "controlsDisposition": "not_verified",
        "eligible": False,
    }
    if receipt.get("dispositions") != expected_dispositions:
        raise ValueError(f"{definition.case_id} review dispositions drifted.")


def validate_inventory(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualMachineReviewCaseInventory",
    )
    expected_scalars = {
        "schemaVersion": "1.0",
        "kind": "visual-machine-review-case-inventory",
        "fixtureSetId": "synthetic-visual-machine-review-v1",
        "fixtureKind": "synthetic_fixture",
    }
    if any(inventory.get(field) != expected for field, expected in expected_scalars.items()):
        raise ValueError("Machine review inventory identity drifted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("Machine review inventory coverage drifted.")
    if [entry.get("caseId") for entry in entries if isinstance(entry, dict)] != [
        definition.case_id for definition in DEFINITIONS
    ]:
        raise ValueError("Machine review inventory ordering or case coverage drifted.")
    return entries


def metrics_for_receipts(receipts: list[dict[str, Any]]) -> dict[str, int]:
    reviewed = len(receipts)
    accepted = sum(item["decision"] == "accept_for_diagnostic_use" for item in receipts)
    rejected = reviewed - accepted
    limited = sum(bool(item["knownLimitations"]) for item in receipts)
    machine = sum(item["reviewer"]["reviewerKind"] == "ai_agent" for item in receipts)
    human = sum(item["reviewer"]["humanReviewed"] is True for item in receipts)
    return {
        "reviewedCaseCount": reviewed,
        "acceptedCaseCount": accepted,
        "rejectedCaseCount": rejected,
        "limitedCaseCount": limited,
        "machineReviewedCount": machine,
        "humanReviewedCount": human,
    }


def compile_case_report(
    definition: FixtureDefinition,
    receipt_bytes: bytes,
    receipt: dict[str, Any],
) -> dict[str, Any]:
    return {
        "caseId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "reviewReceipt": artifact(receipt_ref(definition), receipt_bytes),
        "crop": {
            "artifactRef": crop_ref(receipt["crop"]["artifactRef"]),
            "rawByteSha256": receipt["crop"]["rawByteSha256"],
        },
        "decision": receipt["decision"],
        "limitationCount": len(receipt["knownLimitations"]),
        "metrics": metrics_for_receipts([receipt]),
    }


def _compile_report_snapshot(fixture_root: Path) -> ReviewCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    validate_preprocessing_fixtures()
    preprocessing_inventory_path = resolve_bound_file(
        PREPROCESSING_ROOT,
        PREPROCESSING_INVENTORY_NAME,
        "visual preprocessing inventory",
    )
    preprocessing_inventory_bytes = preprocessing_inventory_path.read_bytes()
    inventory_path = resolve_bound_file(fixture_root, INVENTORY_NAME, "machine review inventory")
    inventory_bytes, inventory = read_json_bytes(
        inventory_path, "VisualMachineReviewCaseInventory"
    )
    entries = validate_inventory(inventory)
    snapshots: list[tuple[Path, bytes, str]] = [
        (
            preprocessing_inventory_path,
            preprocessing_inventory_bytes,
            "Visual preprocessing inventory",
        ),
        (inventory_path, inventory_bytes, "Machine review inventory"),
    ]
    identities = {file_identity(preprocessing_inventory_path), file_identity(inventory_path)}
    receipts = []
    case_reports = []
    for definition, entry in zip(DEFINITIONS, entries, strict=True):
        require_exact_keys(
            entry,
            {
                "caseId", "subjectPack", "preprocessingResultRef",
                "preprocessingResultSha256", "cropRef", "cropSha256",
                "reviewReceiptRef", "reviewReceiptSha256",
            },
            "machine review inventory entry",
        )
        preprocessing_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            definition.preprocessing_result_name,
            f"{definition.case_id} preprocessing result",
        )
        preprocessing_bytes, preprocessing_result = read_json_bytes(
            preprocessing_path, "VisualPreprocessingResult"
        )
        if (
            preprocessing_result.get("requestId") != definition.case_id
            or preprocessing_result.get("subjectPack") != definition.subject_pack
            or preprocessing_result.get("fixtureKind") != "synthetic_fixture"
        ):
            raise ValueError(f"{definition.case_id} preprocessing identity drifted.")
        crop = select_two_x_crop(preprocessing_result)
        crop_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            crop["artifactRef"],
            f"{definition.case_id} scale=2 crop",
        )
        crop_bytes = crop_path.read_bytes()
        image = decode_png(crop_bytes, f"{definition.case_id} scale=2 crop")
        expected_crop = crop_artifact(crop)
        if (
            sha256_bytes(crop_bytes) != crop["rawByteSha256"]
            or decoded_pixel_sha256(image) != crop["decodedRgbPixelSha256"]
            or {"width": image.width, "height": image.height} != crop["pixelSize"]
        ):
            raise ValueError(f"{definition.case_id} crop bytes or pixels drifted.")
        receipt_path = resolve_bound_file(
            fixture_root,
            definition.receipt_name,
            f"{definition.case_id} machine review receipt",
        )
        receipt_bytes, receipt = read_json_bytes(
            receipt_path, "VisualMachineReviewReceipt"
        )
        for path in (preprocessing_path, crop_path, receipt_path):
            identity = file_identity(path)
            if identity in identities:
                raise ValueError(f"{definition.case_id} authority aliases another physical file.")
            identities.add(identity)
        expected_entry = {
            "caseId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "preprocessingResultRef": preprocessing_result_ref(definition),
            "preprocessingResultSha256": sha256_bytes(preprocessing_bytes),
            "cropRef": crop_ref(crop["artifactRef"]),
            "cropSha256": sha256_bytes(crop_bytes),
            "reviewReceiptRef": receipt_ref(definition),
            "reviewReceiptSha256": sha256_bytes(receipt_bytes),
        }
        if entry != expected_entry:
            raise ValueError(f"{definition.case_id} inventory binding drifted.")
        preprocessing_contract = upstream_artifact(
            preprocessing_result_ref(definition),
            preprocessing_bytes,
            definition.case_id,
        )
        validate_receipt(receipt, definition, preprocessing_contract, expected_crop)
        snapshots.extend(
            [
                (preprocessing_path, preprocessing_bytes, f"{definition.case_id} preprocessing result"),
                (crop_path, crop_bytes, f"{definition.case_id} scale=2 crop"),
                (receipt_path, receipt_bytes, f"{definition.case_id} machine review receipt"),
            ]
        )
        receipts.append(receipt)
        case_reports.append(
            compile_case_report(definition, receipt_bytes, receipt)
        )
    subject_reports = [
        {
            "subjectPack": subject_pack,
            "caseCount": len(selected),
            "metrics": metrics_for_receipts(selected),
        }
        for subject_pack in SUBJECT_PACKS
        for selected in [[item for item in receipts if item["subjectPack"] == subject_pack]]
    ]
    if any(item["caseCount"] != 1 for item in subject_reports):
        raise ValueError("Machine review subject coverage drifted.")
    report = {
        "schemaVersion": "1.0",
        "kind": "visual-machine-review-report",
        "fixtureSetId": "synthetic-visual-machine-review-v1",
        "fixtureKind": "synthetic_fixture",
        "sourceInventory": artifact(
            f"eval/visual-machine-review/cases/{INVENTORY_NAME}", inventory_bytes
        ),
        "caseReports": case_reports,
        "subjectReports": subject_reports,
        "totals": metrics_for_receipts(receipts),
        "reviewPolicySha256": sha256_bytes(stable_json_bytes(review_policy())),
        "dispositions": {
            "reviewStatus": "completed",
            "equivalencePolicy": "synthetic_fixture_equivalent",
            "acceptanceScope": "synthetic_fixture_diagnostic",
            "humanIdentityDisposition": "not_claimed",
            "deliveryTrustDisposition": "not_projected",
            "wpfDisposition": "not_integrated",
            "liveAcceptanceDisposition": "not_accepted",
            "controlsDisposition": "not_verified",
            "eligible": False,
            "optimizationCandidateRefs": [],
        },
        "engineProvenance": {
            "engineKind": "deterministic_review_compiler",
            "engineId": "visual-machine-review",
            "engineVersion": "1.0.0",
            "interpreter": {"implementation": "CPython", "version": "3.13.7"},
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": REPORT_GENERATED_AT,
    }
    compilation = ReviewCompilation(report, tuple(snapshots))
    validate_snapshots(compilation.snapshots)
    return compilation


def compile_report(fixture_root: Path = CANONICAL_ROOT) -> dict[str, Any]:
    return _compile_report_snapshot(fixture_root).report


def validate_fixture_structure(fixture_root: Path) -> None:
    expected_names = {
        INVENTORY_NAME,
        REPORT_NAME,
        *(definition.receipt_name for definition in DEFINITIONS),
    }
    actual_paths = list(fixture_root.rglob("*"))
    if any(
        path.is_dir()
        or path.is_symlink()
        or (hasattr(path, "is_junction") and path.is_junction())
        for path in actual_paths
    ):
        raise ValueError("Machine review authority cannot contain nested or alias entries.")
    if {path.name for path in actual_paths} != expected_names:
        raise ValueError("Machine review authority coverage drifted.")
    identities = [file_identity(path) for path in actual_paths]
    if len(set(identities)) != len(identities):
        raise ValueError("Machine review authority files must have unique identities.")


def validated_canonical_compilation(fixture_root: Path = CANONICAL_ROOT) -> ReviewCompilation:
    fixture_root = fixture_root.resolve(strict=True)
    validate_fixture_structure(fixture_root)
    compilation = _compile_report_snapshot(fixture_root)
    report_path = resolve_bound_file(fixture_root, REPORT_NAME, "machine review report")
    report_bytes, tracked_report = read_json_bytes(report_path, "VisualMachineReviewReport")
    if report_bytes != stable_json_bytes(compilation.report) or tracked_report != compilation.report:
        raise ValueError("Machine review report does not deterministically replay.")
    compilation = ReviewCompilation(
        compilation.report,
        compilation.snapshots + ((report_path, report_bytes, "Machine review report"),),
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
    fixture_root.mkdir(parents=True, exist_ok=True)
    validate_preprocessing_fixtures()
    entries = []
    for definition in DEFINITIONS:
        preprocessing_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            definition.preprocessing_result_name,
            f"{definition.case_id} preprocessing result",
        )
        preprocessing_bytes, preprocessing_result = read_json_bytes(
            preprocessing_path, "VisualPreprocessingResult"
        )
        crop = select_two_x_crop(preprocessing_result)
        crop_path = resolve_bound_file(
            PREPROCESSING_ROOT,
            crop["artifactRef"],
            f"{definition.case_id} scale=2 crop",
        )
        crop_bytes = crop_path.read_bytes()
        receipt = build_receipt(definition, preprocessing_bytes, preprocessing_result)
        receipt_bytes = stable_json_bytes(receipt)
        atomic_write(fixture_root / definition.receipt_name, receipt_bytes)
        entries.append(
            {
                "caseId": definition.case_id,
                "subjectPack": definition.subject_pack,
                "preprocessingResultRef": preprocessing_result_ref(definition),
                "preprocessingResultSha256": sha256_bytes(preprocessing_bytes),
                "cropRef": crop_ref(crop["artifactRef"]),
                "cropSha256": sha256_bytes(crop_bytes),
                "reviewReceiptRef": receipt_ref(definition),
                "reviewReceiptSha256": sha256_bytes(receipt_bytes),
            }
        )
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-machine-review-case-inventory",
        "fixtureSetId": "synthetic-visual-machine-review-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    atomic_write(fixture_root / REPORT_NAME, stable_json_bytes(compile_report(fixture_root)))
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


def _run_review(output_dir: Path, fixture_root: Path) -> Path:
    output = canonical_output_path(output_dir)
    compilation = validated_canonical_compilation(fixture_root)
    report_bytes = stable_json_bytes(compilation.report)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        stage_report = stage / REPORT_NAME
        atomic_write(stage_report, report_bytes)
        if stage_report.read_bytes() != report_bytes:
            raise ValueError("Staged machine review report bytes drifted.")
        validate_fixture_structure(fixture_root)
        validate_snapshots(compilation.snapshots)
        os.replace(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output / REPORT_NAME


def run_review(output_dir: Path) -> Path:
    return _run_review(output_dir, CANONICAL_ROOT)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synthetic machine-equivalent visual review.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic machine review fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic machine review fixtures.")
        return 0
    report_path = run_review(args.out)
    print(json.dumps({"status": "ok", "reportPath": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
