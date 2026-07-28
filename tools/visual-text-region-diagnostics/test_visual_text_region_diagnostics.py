from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from visual_text_region_diagnostics import (
    CANONICAL_ROOT,
    INVENTORY_NAME,
    REPORT_NAME,
    REPO_ROOT,
    _run_diagnostics,
    aggregate_metrics,
    atomic_write,
    compile_case_report,
    compile_report,
    load_upstream_authorities,
    metrics,
    run_diagnostics,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
    validate_fixture_structure,
)


class VisualTextRegionDiagnosticTests(unittest.TestCase):
    def test_canonical_report_preserves_diagnostic_only_boundary(self) -> None:
        report = self.read_json(CANONICAL_ROOT / REPORT_NAME)
        cases = {case["caseId"]: case for case in report["caseReports"]}
        self.assertEqual(cases["math-function-graph"]["metrics"]["detectedTruthCount"], 1)
        self.assertEqual(cases["junior-instrument-scale"]["metrics"]["unscoredCandidateCount"], 1)
        self.assertFalse(cases["junior-instrument-scale"]["metrics"]["precision"]["available"])
        self.assertEqual(cases["senior-circuit-label"]["metrics"]["matchedCandidateCount"], 2)
        self.assertEqual(report["totals"]["scorableTruthCount"], 3)
        self.assertEqual(report["totals"]["detectedTruthCount"], 3)
        self.assertEqual(report["totals"]["candidateCount"], 25)
        self.assertEqual(report["totals"]["unscoredCandidateCount"], 22)
        self.assertEqual(report["totals"]["falsePositiveCount"], 0)
        self.assertEqual(report["totals"]["precision"], {"available": True, "value": 1.0})
        self.assertEqual(report["totals"]["recall"], {"available": True, "value": 1.0})
        self.assertEqual(report["dispositions"]["acceptanceDisposition"], "not_accepted")
        self.assertEqual(report["dispositions"]["associationDisposition"], "not_decided")
        self.assertNotIn('"text"', json.dumps(report))
        self.assertNotIn("observedText", json.dumps(report))

    def test_match_records_exact_geometry_and_coverage(self) -> None:
        case = self.canonical_case("math-function-graph")
        match = case["matches"][0]
        self.assertEqual(match["truthLabelRef"], "truth-label-002")
        self.assertEqual(match["textRegionCandidateRef"], "text-region-001")
        self.assertEqual(match["intersectionArea"], 160.0)
        self.assertEqual(match["truthCoverage"], 0.83333333)
        self.assertEqual(match["candidateCoverage"], 1.0)

    def test_edge_touch_and_outside_truth_do_not_protect_candidate(self) -> None:
        truth, structure, truth_bytes, structure_bytes = self.case_inputs("math-function-graph")
        structure["textRegionCandidates"] = [self.candidate("text-region-001", 154, 2, 5, 16)]
        case = compile_case_report(
            "math-function-graph",
            "math-answer",
            "truth.json",
            truth_bytes,
            truth,
            "structure.json",
            structure_bytes,
            structure,
        )
        self.assertEqual(case["matches"], [])
        self.assertEqual(case["unmatchedTruthRefs"], ["truth-label-002"])
        self.assertEqual(case["falsePositiveCandidateRefs"], ["text-region-001"])
        self.assertEqual(case["unscoredCandidateRefs"], [])

    def test_partial_overlap_is_unscored(self) -> None:
        case = self.canonical_case("junior-instrument-scale")
        self.assertEqual(case["matches"], [])
        self.assertEqual(case["falsePositiveCandidateRefs"], [])
        self.assertEqual(case["unscoredCandidateRefs"], ["text-region-001"])
        self.assertFalse(case["metrics"]["precision"]["available"])
        self.assertFalse(case["metrics"]["recall"]["available"])

    def test_multiple_candidates_for_one_scorable_truth_fail_closed(self) -> None:
        truth, structure, truth_bytes, structure_bytes = self.case_inputs("math-function-graph")
        structure["textRegionCandidates"].append(self.candidate("text-region-002", 143, 3, 4, 8))
        with self.assertRaisesRegex(ValueError, "truth overlaps multiple"):
            compile_case_report(
                "math-function-graph", "math-answer", "truth.json", truth_bytes, truth,
                "structure.json", structure_bytes, structure,
            )

    def test_candidate_overlapping_multiple_scorable_truth_fails_closed(self) -> None:
        truth, structure, truth_bytes, structure_bytes = self.case_inputs("senior-circuit-label")
        truth["labels"][1]["cropIntersectionBounds"] = copy.deepcopy(
            truth["labels"][0]["cropIntersectionBounds"]
        )
        with self.assertRaisesRegex(ValueError, "candidate overlaps multiple"):
            compile_case_report(
                "senior-circuit-label", "senior-physics-answer", "truth.json", truth_bytes, truth,
                "structure.json", structure_bytes, structure,
            )

    def test_candidate_bounds_outside_crop_fail_closed(self) -> None:
        truth, structure, truth_bytes, structure_bytes = self.case_inputs("math-function-graph")
        structure["textRegionCandidates"][0]["bbox"]["x"] = -1
        with self.assertRaisesRegex(ValueError, "outside crop bounds"):
            compile_case_report(
                "math-function-graph", "math-answer", "truth.json", truth_bytes, truth,
                "structure.json", structure_bytes, structure,
            )

    def test_zero_denominators_are_unavailable(self) -> None:
        value = metrics(0, 0, 0, 0, 0)
        self.assertEqual(value["precision"], {"available": False})
        self.assertEqual(value["recall"], {"available": False})
        self.assertEqual(aggregate_metrics([{"metrics": value}]), value)

    def test_inventory_upstream_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["structureExtractionResultSha256"] = "0" * 64
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "upstream binding drifted"):
                compile_report(root)

    def test_report_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report = self.read_json(report_path)
            report["totals"]["falsePositiveCount"] = 1
            report_path.write_bytes(stable_json_bytes(report))
            with self.assertRaisesRegex(ValueError, "does not deterministically replay"):
                validate_canonical_fixtures(root)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "extra"
            nested.mkdir()
            (nested / "unknown.json").write_bytes(b"{}\n")
            with self.assertRaisesRegex(ValueError, "nested or alias"):
                validate_canonical_fixtures(root)

    def test_hardlink_authority_alias_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report_path.unlink()
            os.link(root / INVENTORY_NAME, report_path)
            with self.assertRaisesRegex(ValueError, "unique identities"):
                validate_fixture_structure(root)

    def test_runtime_writes_external_report_and_rejects_repo_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-text-region-output-") as temp:
            output = Path(temp) / "bundle"
            report_path = run_diagnostics(output)
            self.assertEqual(report_path.name, REPORT_NAME)
            self.assertEqual(len(list(output.iterdir())), 1)
            self.assertEqual(self.read_json(report_path), self.read_json(CANONICAL_ROOT / REPORT_NAME))
        rejected = REPO_ROOT / ".eval-work" / "visual-text-region-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_diagnostics(rejected)

    def test_runtime_public_api_rejects_copied_fixture_root(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-text-region-output-") as temp:
                with self.assertRaises(TypeError):
                    run_diagnostics(Path(temp) / "bundle", root)

    def test_runtime_rejects_midrun_inventory_and_report_drift(self) -> None:
        for authority_name in (INVENTORY_NAME, REPORT_NAME):
            with self.subTest(authority=authority_name), self.fixture_copy() as root:
                with tempfile.TemporaryDirectory(prefix="visual-text-region-output-") as temp:
                    output = Path(temp) / "bundle"
                    target = root / authority_name

                    def write_then_mutate(path: Path, data: bytes) -> None:
                        atomic_write(path, data)
                        target.write_bytes(b"{}\n")

                    with patch(
                        "visual_text_region_diagnostics.atomic_write", side_effect=write_then_mutate
                    ):
                        with self.assertRaisesRegex(ValueError, "bytes drifted"):
                            _run_diagnostics(output, root)

    def test_runtime_rejects_midrun_structure_and_staged_report_drift(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-text-region-output-") as temp:
                output = Path(temp) / "bundle"

                def write_then_add_authority(path: Path, data: bytes) -> None:
                    atomic_write(path, data)
                    extra = root / "extra"
                    extra.mkdir()
                    (extra / "unknown.json").write_bytes(b"{}\n")

                with patch(
                    "visual_text_region_diagnostics.atomic_write", side_effect=write_then_add_authority
                ):
                    with self.assertRaisesRegex(ValueError, "nested or alias"):
                        _run_diagnostics(output, root)

        with tempfile.TemporaryDirectory(prefix="visual-text-region-output-") as temp:
            output = Path(temp) / "bundle"

            def write_then_tamper(path: Path, data: bytes) -> None:
                atomic_write(path, data)
                path.write_bytes(b"{}\n")

            with patch("visual_text_region_diagnostics.atomic_write", side_effect=write_then_tamper):
                with self.assertRaisesRegex(ValueError, "Staged diagnostic report bytes drifted"):
                    run_diagnostics(output)

    def test_runtime_identity_drift_fails_closed(self) -> None:
        with patch(
            "visual_ocr_diagnostics.interpreter_identity",
            return_value={"implementation": "CPython", "version": "0.0.0"},
        ):
            with self.assertRaisesRegex(ValueError, "interpreter drifted"):
                validate_canonical_fixtures()

    def test_upstream_authority_snapshots_and_replay_are_deterministic(self) -> None:
        upstream = load_upstream_authorities()
        self.assertEqual(len(upstream.snapshots), 8)
        self.assertEqual(validate_canonical_fixtures(), 3)
        self.assertEqual(
            stable_json_bytes(compile_report()),
            (CANONICAL_ROOT / REPORT_NAME).read_bytes(),
        )

    @staticmethod
    def candidate(candidate_id: str, x: int, y: int, width: int, height: int) -> dict:
        return {
            "candidateId": candidate_id,
            "sourceRegionRef": "region-001",
            "bbox": {"x": x, "y": y, "width": width, "height": height},
            "foregroundArea": max(1, width * height),
            "heuristicOnly": True,
        }

    @staticmethod
    def case_inputs(case_id: str) -> tuple[dict, dict, bytes, bytes]:
        upstream = load_upstream_authorities().fixtures[case_id]
        return (
            copy.deepcopy(upstream.truth),
            copy.deepcopy(upstream.structure_result),
            upstream.truth_bytes,
            upstream.structure_bytes,
        )

    @staticmethod
    def canonical_case(case_id: str) -> dict:
        report = VisualTextRegionDiagnosticTests.read_json(CANONICAL_ROOT / REPORT_NAME)
        return next(case for case in report["caseReports"] if case["caseId"] == case_id)

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-text-region-fixture-"))
            self.root = self.temp / "cases"
            shutil.copytree(CANONICAL_ROOT, self.root)
            return self.root

        def __exit__(self, exc_type, exc_value, traceback) -> None:
            shutil.rmtree(self.temp)

    @staticmethod
    def read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
