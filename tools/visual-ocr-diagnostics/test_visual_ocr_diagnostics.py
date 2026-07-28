from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from visual_ocr_diagnostics import (
    CANONICAL_ROOT,
    DEFINITIONS,
    INVENTORY_NAME,
    REPO_ROOT,
    REPORT_NAME,
    TEXT_DECLARATIONS,
    _run_diagnostics,
    atomic_write,
    build_truth,
    compile_case_report,
    compile_report,
    run_diagnostics,
    sha256_bytes,
    stable_json_bytes,
    validate_upstream_authorities,
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

    def test_renderer_text_bounds_must_stay_inside_source_pixels(self) -> None:
        authorities = validate_upstream_authorities()
        fixture_definition = next(item for item in DEFINITIONS if item.case_id == "math-function-graph")
        original = TEXT_DECLARATIONS[fixture_definition.case_id][0]
        declaration_type = type(original)
        invalid_positions = ((-100, 10), (fixture_definition.width, 10), (10, fixture_definition.height))
        for position in invalid_positions:
            with self.subTest(position=position), patch.dict(
                TEXT_DECLARATIONS,
                {fixture_definition.case_id: (declaration_type(original.text, position, original.fill),)},
            ):
                with self.assertRaisesRegex(ValueError, "outside source pixel bounds"):
                    build_truth(fixture_definition, authorities)

        draw = ImageDraw.Draw(Image.new("RGB", (fixture_definition.width, fixture_definition.height)))
        _, _, glyph_right, _ = draw.textbbox((0, 10), original.text)
        edge_position = (fixture_definition.width - glyph_right, 10)
        with patch.dict(
            TEXT_DECLARATIONS,
            {fixture_definition.case_id: (declaration_type(original.text, edge_position, original.fill),)},
        ):
            truth = build_truth(fixture_definition, authorities)
        edge_bounds = truth["labels"][0]["sourceBounds"]
        self.assertEqual(edge_bounds["x"] + edge_bounds["width"], fixture_definition.width)

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

    def test_runtime_rejects_midrun_diagnostic_authority_drift(self) -> None:
        authority_names = (
            INVENTORY_NAME,
            "math-function-graph.visual-synthetic-text-truth.json",
            REPORT_NAME,
        )
        for authority_name in authority_names:
            with self.subTest(authority=authority_name), self.fixture_copy() as root:
                with tempfile.TemporaryDirectory(prefix="visual-ocr-diagnostic-output-") as temp:
                    output = Path(temp) / "bundle"
                    target = root / authority_name
                    mutated = False

                    def write_then_mutate(path: Path, data: bytes) -> None:
                        nonlocal mutated
                        atomic_write(path, data)
                        if not mutated:
                            target.write_bytes(b"{}\n")
                            mutated = True

                    with patch("visual_ocr_diagnostics.atomic_write", side_effect=write_then_mutate):
                        with self.assertRaisesRegex(ValueError, "bytes drifted"):
                            _run_diagnostics(output, root)

    def test_runtime_public_api_rejects_copied_fixture_root(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-ocr-diagnostic-output-") as temp:
                with self.assertRaises(TypeError):
                    run_diagnostics(Path(temp) / "bundle", root)

    def test_runtime_rejects_midrun_structure_and_staged_report_drift(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-ocr-diagnostic-output-") as temp:
                output = Path(temp) / "bundle"

                def write_then_add_authority(path: Path, data: bytes) -> None:
                    atomic_write(path, data)
                    extra = root / "extra"
                    extra.mkdir()
                    (extra / "unknown.json").write_bytes(b"{}\n")

                with patch("visual_ocr_diagnostics.atomic_write", side_effect=write_then_add_authority):
                    with self.assertRaisesRegex(ValueError, "nested or symlink"):
                        _run_diagnostics(output, root)

        with tempfile.TemporaryDirectory(prefix="visual-ocr-diagnostic-output-") as temp:
            output = Path(temp) / "bundle"

            def write_then_tamper(path: Path, data: bytes) -> None:
                atomic_write(path, data)
                path.write_bytes(b"{}\n")

            with patch("visual_ocr_diagnostics.atomic_write", side_effect=write_then_tamper):
                with self.assertRaisesRegex(ValueError, "Staged visual OCR diagnostic report bytes drifted"):
                    run_diagnostics(output)

    def test_current_renderer_output_drift_fails_closed(self) -> None:
        definition = DEFINITIONS[0]
        blank = Image.new("RGB", (definition.width, definition.height), "white")
        with patch("visual_ocr_diagnostics.render_synthetic_source", return_value=blank):
            with self.assertRaisesRegex(ValueError, "current deterministic renderer"):
                validate_upstream_authorities()

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
