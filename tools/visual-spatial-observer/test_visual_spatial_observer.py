from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from visual_spatial_observer import (
    CANONICAL_ROOT,
    DEFINITIONS,
    INVENTORY_NAME,
    REPO_ROOT,
    compile_request,
    measure_pair,
    run_admitted_request,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
    validate_admitted_request_snapshot,
    validate_interpreter,
    validate_file_snapshot,
    validate_result_inventory_binding,
    validate_upstream_authorities,
)


class VisualSpatialObserverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.authorities = validate_upstream_authorities()

    def test_three_canonical_fixtures_replay_deterministically(self) -> None:
        self.assertEqual(validate_canonical_fixtures(), 3)

    def test_canonical_outputs_preserve_geometry_only_boundary(self) -> None:
        expected_counts = {
            "math-function-graph": (1, 0, 0),
            "junior-instrument-scale": (1, 1, 1),
            "senior-circuit-label": (23, 0, 0),
        }
        for request_path in sorted(CANONICAL_ROOT.glob("*.visual-spatial-observation-request.json")):
            result = compile_request(request_path, CANONICAL_ROOT, self.authorities)
            region_count, ocr_count, pair_count = expected_counts[result["requestId"]]
            self.assertEqual(result["summary"]["textRegionCandidateCount"], region_count)
            self.assertEqual(result["summary"]["ocrObservationCount"], ocr_count)
            self.assertEqual(result["summary"]["expectedPairCount"], pair_count)
            self.assertEqual(result["summary"]["measurementCount"], pair_count)
            self.assertEqual(
                result["dispositions"],
                {
                    "measurementStatus": "completed",
                    "associationDisposition": "not_decided",
                    "layoutDisposition": "not_inferred",
                    "semanticDisposition": "not_inferred",
                    "trackDisposition": "not_integrated",
                    "requiresHumanReview": True,
                },
            )
            self.assertNotIn("observedText", json.dumps(result))
        junior = compile_request(
            CANONICAL_ROOT / "junior-instrument-scale.visual-spatial-observation-request.json",
            CANONICAL_ROOT,
            self.authorities,
        )
        self.assertEqual(junior["summary"]["relationCounts"]["disjoint"], 1)
        self.assertEqual(junior["measurements"][0]["centroidDistanceSquared"], 31704.25)

    def test_geometry_relations_are_exhaustive_and_touching_is_disjoint(self) -> None:
        pixel_size = {"width": 100, "height": 100}

        def region(x, y, width, height):
            return {
                "candidateId": "text-region-001",
                "bbox": {"x": x, "y": y, "width": width, "height": height},
            }

        def observation(left, top, right, bottom):
            return {
                "observationId": "ocr-observation-001",
                "quad": [
                    {"x": left, "y": top}, {"x": right, "y": top},
                    {"x": right, "y": bottom}, {"x": left, "y": bottom},
                ],
            }

        cases = [
            (region(10, 10, 20, 20), observation(10, 10, 30, 30), "equal_bounds"),
            (region(15, 15, 5, 5), observation(10, 10, 30, 30), "observation_contains_region"),
            (region(10, 10, 20, 20), observation(15, 15, 20, 20), "region_contains_observation"),
            (region(10, 10, 20, 20), observation(20, 20, 40, 40), "overlap"),
            (region(10, 10, 20, 20), observation(30, 10, 40, 20), "disjoint"),
        ]
        for text_region, ocr_observation, expected in cases:
            with self.subTest(expected=expected):
                measurement = measure_pair(text_region, ocr_observation, pixel_size)
                self.assertEqual(measurement["spatialRelation"], expected)
                if expected == "disjoint":
                    self.assertEqual(measurement["intersectionArea"], 0)

    def test_invalid_or_crop_external_bounds_fail_closed(self) -> None:
        region = {
            "candidateId": "text-region-001",
            "bbox": {"x": 0, "y": 0, "width": 10, "height": 10},
        }
        degenerate = {
            "observationId": "ocr-observation-001",
            "quad": [{"x": 1, "y": 1}] * 4,
        }
        with self.assertRaisesRegex(ValueError, "degenerate"):
            measure_pair(region, degenerate, {"width": 100, "height": 100})
        external = {
            "observationId": "ocr-observation-001",
            "quad": [
                {"x": 90, "y": 90}, {"x": 101, "y": 90},
                {"x": 101, "y": 99}, {"x": 90, "y": 99},
            ],
        }
        with self.assertRaisesRegex(ValueError, "escapes the crop"):
            measure_pair(region, external, {"width": 100, "height": 100})

    def test_policy_cloud_and_interpreter_drift_fail_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-spatial-observation-request.json"
            request = self.read_json(request_path)
            request["geometryPolicy"]["ratioPrecision"] = 7
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "geometry policy drifted"):
                compile_request(request_path, root, self.authorities)
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-spatial-observation-request.json"
            request = self.read_json(request_path)
            request["egressPolicy"]["allowCloud"] = True
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "cloud egress"):
                compile_request(request_path, root, self.authorities)
        with patch(
            "visual_spatial_observer.interpreter_identity",
            return_value={"implementation": "CPython", "version": "3.12.10"},
        ):
            with self.assertRaisesRegex(ValueError, "Python interpreter drifted"):
                validate_interpreter()

    def test_upstream_and_crop_binding_drift_fail_closed(self) -> None:
        for field, message in (
            ("structureExtractionResult", "structure result authority drifted"),
            ("ocrObservationResult", "OCR result authority drifted"),
        ):
            with self.fixture_copy() as root:
                request_path = root / "math-function-graph.visual-spatial-observation-request.json"
                request = self.read_json(request_path)
                request[field]["rawByteSha256"] = "0" * 64
                self.write_json(request_path, request)
                with self.assertRaisesRegex(ValueError, message):
                    compile_request(request_path, root, self.authorities)
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-spatial-observation-request.json"
            request = self.read_json(request_path)
            request["crop"]["rawByteSha256"] = "0" * 64
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "crop binding drifted"):
                compile_request(request_path, root, self.authorities)

    def test_reloaded_upstream_result_must_match_committed_inventory(self) -> None:
        definition = next(value for value in DEFINITIONS if value.case_id == "math-function-graph")
        inventory = {
            "entries": [
                {
                    "caseId": definition.case_id,
                    "subjectPack": definition.subject_pack,
                    "expectedResultRef": definition.structure_result_name,
                    "expectedResultSha256": sha256_bytes(b"admitted"),
                }
            ]
        }
        validate_result_inventory_binding(
            inventory,
            definition,
            definition.structure_result_name,
            b"admitted",
            "Structure extraction",
        )
        with self.assertRaisesRegex(ValueError, "drifted from committed inventory"):
            validate_result_inventory_binding(
                inventory,
                definition,
                definition.structure_result_name,
                b"replaced",
                "Structure extraction",
            )

    def test_upstream_inventory_snapshot_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-spatial-inventory-drift-") as temp:
            path = Path(temp) / "inventory.json"
            path.write_bytes(b"before")
            validate_file_snapshot(path, b"before", "OCR observation inventory")
            path.write_bytes(b"after")
            with self.assertRaisesRegex(ValueError, "drifted while loading upstream authority"):
                validate_file_snapshot(path, b"before", "OCR observation inventory")

    def test_result_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            result_path = root / "junior-instrument-scale.visual-spatial-observation-result.json"
            result = self.read_json(result_path)
            result["summary"]["measurementCount"] = 0
            self.write_json(result_path, result)
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][1]["expectedResultSha256"] = sha256_bytes(result_path.read_bytes())
            self.write_json(inventory_path, inventory)
            with patch(
                "visual_spatial_observer.validate_upstream_authorities",
                return_value=self.authorities,
            ):
                with self.assertRaisesRegex(ValueError, "computed fields drifted"):
                    validate_canonical_fixtures(root)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "unlisted"
            nested.mkdir()
            shutil.copyfile(
                root / "math-function-graph.visual-spatial-observation-result.json",
                nested / "unknown.json",
            )
            with patch(
                "visual_spatial_observer.validate_upstream_authorities",
                return_value=self.authorities,
            ):
                with self.assertRaisesRegex(ValueError, "exactly cover canonical authority"):
                    validate_canonical_fixtures(root)

    def test_hardlink_alias_is_rejected(self) -> None:
        with self.fixture_copy() as root:
            source = root / "math-function-graph.visual-spatial-observation-request.json"
            alias = root / "junior-instrument-scale.visual-spatial-observation-request.json"
            alias.unlink()
            try:
                os.link(source, alias)
            except OSError as error:
                self.skipTest(f"hardlink capability unavailable: {error}")
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][1]["requestSha256"] = sha256_bytes(alias.read_bytes())
            self.write_json(inventory_path, inventory)
            with patch(
                "visual_spatial_observer.validate_upstream_authorities",
                return_value=self.authorities,
            ):
                with self.assertRaisesRegex(ValueError, "aliases another authority"):
                    validate_canonical_fixtures(root)

    def test_runtime_rejects_noncanonical_request_copy(self) -> None:
        with self.fixture_copy() as root, tempfile.TemporaryDirectory(
            prefix="visual-spatial-output-"
        ) as temp:
            copied_request = root / "math-function-graph.visual-spatial-observation-request.json"
            with self.assertRaisesRegex(ValueError, "escapes its allowed root"):
                run_admitted_request(copied_request, Path(temp) / "bundle")

    def test_runtime_rejects_request_bytes_drift_during_compilation(self) -> None:
        request_path = CANONICAL_ROOT / "math-function-graph.visual-spatial-observation-request.json"
        expected_sha256 = sha256_bytes(request_path.read_bytes())
        with self.assertRaisesRegex(ValueError, "drifted during runtime compilation"):
            validate_admitted_request_snapshot(
                request_path,
                expected_sha256,
                {"sourceRequestSha256": "0" * 64},
            )
        with tempfile.TemporaryDirectory(prefix="visual-spatial-request-drift-") as temp:
            copied = Path(temp) / request_path.name
            copied.write_bytes(request_path.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "drifted during runtime compilation"):
                validate_admitted_request_snapshot(
                    copied,
                    expected_sha256,
                    {"sourceRequestSha256": expected_sha256},
                )

    def test_runtime_writes_external_bundle_and_rejects_repo_output(self) -> None:
        request_path = CANONICAL_ROOT / "junior-instrument-scale.visual-spatial-observation-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-spatial-output-") as temp:
            output = Path(temp) / "bundle"
            result_path = run_admitted_request(request_path, output)
            result = self.read_json(result_path)
            self.assertEqual(result["engineProvenance"]["engineKind"], "deterministic_geometry")
            self.assertFalse(result["engineProvenance"]["liveProvider"])
            self.assertFalse(result["engineProvenance"]["cloudEgress"])
            self.assertEqual(len(list(output.iterdir())), 1)
        rejected = REPO_ROOT / ".eval-work" / "visual-spatial-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_admitted_request(request_path, rejected)

    def test_runtime_rejects_request_path_alias(self) -> None:
        request_path = CANONICAL_ROOT / "math-function-graph.visual-spatial-observation-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-spatial-alias-") as temp:
            alias = Path(temp) / request_path.name
            try:
                alias.symlink_to(request_path)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "canonical path"):
                run_admitted_request(alias, Path(temp) / "bundle")

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-spatial-fixture-"))
            self.root = self.temp / "cases"
            shutil.copytree(CANONICAL_ROOT, self.root)
            return self.root

        def __exit__(self, exc_type, exc_value, traceback) -> None:
            shutil.rmtree(self.temp)

    @staticmethod
    def read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8-sig"))

    @staticmethod
    def write_json(path: Path, value: dict) -> None:
        path.write_bytes(stable_json_bytes(value))


if __name__ == "__main__":
    unittest.main()
