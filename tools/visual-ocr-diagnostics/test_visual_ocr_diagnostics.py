from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from visual_ocr_diagnostics import (
    CANONICAL_ROOT,
    INVENTORY_NAME,
    REPO_ROOT,
    REPORT_NAME,
    compile_case_report,
    compile_report,
    run_diagnostics,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
    validate_file_snapshot,
    validate_runtime_identity,
)


class VisualOcrDiagnosticTests(unittest.TestCase):
    def test_canonical_report_preserves_diagnostic_only_boundary(self) -> None:
        report = self.read_json(CANONICAL_ROOT / REPORT_NAME)
        cases = {case["caseId"]: case for case in report["caseReports"]}
        self.assertEqual(cases["math-function-graph"]["metrics"]["falseNegativeCount"], 1)
        self.assertFalse(cases["math-function-graph"]["metrics"]["precision"]["available"])
        self.assertEqual(cases["junior-instrument-scale"]["metrics"]["falsePositiveCount"], 1)
        self.assertFalse(cases["junior-instrument-scale"]["metrics"]["recall"]["available"])
        self.assertEqual(cases["senior-circuit-label"]["metrics"]["falseNegativeCount"], 2)
        self.assertEqual(report["totals"]["scorableTruthCount"], 3)
        self.assertEqual(report["totals"]["detectedTruthCount"], 0)
        self.assertEqual(report["totals"]["falsePositiveCount"], 1)
        self.assertEqual(report["dispositions"]["acceptanceDisposition"], "not_accepted")
        self.assertEqual(report["dispositions"]["layoutDisposition"], "not_inferred")
        self.assertEqual(report["dispositions"]["trackDisposition"], "not_integrated")
        self.assertNotIn("observedText", json.dumps(report))

    def test_exact_overlap_matching_partial_unscored_and_metrics(self) -> None:
        truth_path = CANONICAL_ROOT / "senior-circuit-label.visual-synthetic-text-truth.json"
        truth_bytes = truth_path.read_bytes()
        truth = self.read_json(truth_path)
        observations = [
            self.observation("ocr-observation-001", "A", 152, 116, 14, 16),
            self.observation("ocr-observation-002", "synthetic circuit", 18, 0, 40, 12),
            self.observation("ocr-observation-003", "Z", 300, 200, 10, 10),
        ]
        case = compile_case_report(
            "senior-circuit-label",
            "senior-physics-answer",
            truth_path.name,
            truth_bytes,
            truth,
            "ocr.json",
            b"{}\n",
            {"observations": observations},
        )
        self.assertEqual(len(case["matches"]), 1)
        self.assertEqual(case["unmatchedTruthRefs"], ["truth-label-002"])
        self.assertEqual(case["unscoredObservationRefs"], ["ocr-observation-002"])
        self.assertEqual(case["falsePositiveObservationRefs"], ["ocr-observation-003"])
        self.assertEqual(case["metrics"]["precision"], {"available": True, "value": 0.5})
        self.assertEqual(case["metrics"]["recall"], {"available": True, "value": 0.5})

    def test_text_matching_is_case_sensitive(self) -> None:
        truth_path = CANONICAL_ROOT / "senior-circuit-label.visual-synthetic-text-truth.json"
        truth_bytes = truth_path.read_bytes()
        truth = self.read_json(truth_path)
        case = compile_case_report(
            "senior-circuit-label",
            "senior-physics-answer",
            truth_path.name,
            truth_bytes,
            truth,
            "ocr.json",
            b"{}\n",
            {"observations": [self.observation("ocr-observation-001", "a", 152, 116, 14, 16)]},
        )
        self.assertEqual(case["matches"], [])
        self.assertEqual(case["metrics"]["falseNegativeCount"], 2)
        self.assertEqual(case["metrics"]["falsePositiveCount"], 1)

    def test_ambiguous_and_duplicate_truth_candidates_fail_closed(self) -> None:
        truth_path = CANONICAL_ROOT / "senior-circuit-label.visual-synthetic-text-truth.json"
        truth_bytes = truth_path.read_bytes()
        truth = self.read_json(truth_path)
        duplicate_observations = [
            self.observation("ocr-observation-001", "A", 152, 116, 14, 16),
            self.observation("ocr-observation-002", "A", 153, 117, 10, 10),
        ]
        with self.assertRaisesRegex(ValueError, "ambiguous repeated exact"):
            compile_case_report(
                "senior-circuit-label", "senior-physics-answer", truth_path.name,
                truth_bytes, truth, "ocr.json", b"{}\n", {"observations": duplicate_observations},
            )
        duplicate_truth = copy.deepcopy(truth)
        duplicate_truth["labels"][1]["text"] = "A"
        with self.assertRaisesRegex(ValueError, "duplicate scorable truth text"):
            compile_case_report(
                "senior-circuit-label", "senior-physics-answer", truth_path.name,
                stable_json_bytes(duplicate_truth), duplicate_truth, "ocr.json", b"{}\n",
                {"observations": []},
            )

    def test_truth_bounds_outside_crop_fail_closed(self) -> None:
        truth_path = CANONICAL_ROOT / "senior-circuit-label.visual-synthetic-text-truth.json"
        truth = self.read_json(truth_path)
        truth["labels"][0]["cropIntersectionBounds"]["x"] = 999
        with self.assertRaisesRegex(ValueError, "outside crop bounds"):
            compile_case_report(
                "senior-circuit-label", "senior-physics-answer", truth_path.name,
                stable_json_bytes(truth), truth, "ocr.json", b"{}\n", {"observations": []},
            )

    def test_self_consistent_truth_drift_from_renderer_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            truth_path = root / "math-function-graph.visual-synthetic-text-truth.json"
            truth = self.read_json(truth_path)
            truth["labels"][1]["text"] = "not-y"
            truth_bytes = stable_json_bytes(truth)
            truth_path.write_bytes(truth_bytes)
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["truthSha256"] = sha256_bytes(truth_bytes)
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "drifted from renderer declarations"):
                compile_report(root)

    def test_inventory_ocr_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["ocrObservationResultSha256"] = "0" * 64
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "upstream binding drifted"):
                compile_report(root)

    def test_report_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report = self.read_json(report_path)
            report["totals"]["falseNegativeCount"] = 0
            report_path.write_bytes(stable_json_bytes(report))
            with self.assertRaisesRegex(ValueError, "does not deterministically replay"):
                validate_canonical_fixtures(root)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "extra"
            nested.mkdir()
            (nested / "unknown.json").write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "nested or symlink"):
                validate_canonical_fixtures(root)

    def test_hardlink_authority_alias_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            math_truth = root / "math-function-graph.visual-synthetic-text-truth.json"
            junior_truth = root / "junior-instrument-scale.visual-synthetic-text-truth.json"
            junior_truth.unlink()
            os.link(math_truth, junior_truth)
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][1]["truthSha256"] = sha256_bytes(math_truth.read_bytes())
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "aliases another authority"):
                compile_report(root)

    def test_runtime_writes_external_report_and_rejects_repo_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-ocr-diagnostic-output-") as temp:
            output = Path(temp) / "bundle"
            report_path = run_diagnostics(output)
            self.assertEqual(report_path.name, REPORT_NAME)
            self.assertEqual(len(list(output.iterdir())), 1)
            self.assertEqual(self.read_json(report_path), self.read_json(CANONICAL_ROOT / REPORT_NAME))
        rejected = REPO_ROOT / ".eval-work" / "visual-ocr-diagnostic-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_diagnostics(rejected)

    def test_snapshot_and_runtime_identity_drift_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-ocr-diagnostic-snapshot-") as temp:
            path = Path(temp) / "authority.json"
            path.write_bytes(b"before")
            with self.assertRaisesRegex(ValueError, "bytes drifted"):
                validate_file_snapshot(path, b"after", "Test authority")
        with patch("visual_ocr_diagnostics.interpreter_identity", return_value={"implementation": "CPython", "version": "0.0.0"}):
            with self.assertRaisesRegex(ValueError, "interpreter drifted"):
                validate_runtime_identity()
        with patch("visual_ocr_diagnostics.package_version", return_value="0.0.0"):
            with self.assertRaisesRegex(ValueError, "Pillow version drifted"):
                validate_runtime_identity()

    def test_canonical_fixtures_replay_deterministically(self) -> None:
        self.assertEqual(validate_canonical_fixtures(), 3)
        self.assertEqual(
            stable_json_bytes(compile_report()),
            (CANONICAL_ROOT / REPORT_NAME).read_bytes(),
        )

    @staticmethod
    def observation(observation_id: str, text: str, x: float, y: float, width: float, height: float) -> dict:
        return {
            "observationId": observation_id,
            "quad": [
                {"x": x, "y": y},
                {"x": x + width, "y": y},
                {"x": x + width, "y": y + height},
                {"x": x, "y": y + height},
            ],
            "observedText": text,
            "confidence": 0.5,
        }

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-ocr-diagnostic-fixture-"))
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
