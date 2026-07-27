from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from visual_ocr_observer import (
    CANONICAL_ROOT,
    INVENTORY_NAME,
    REPO_ROOT,
    compile_request,
    normalize_observations,
    run_admitted_request,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
)


class VisualOcrObserverTests(unittest.TestCase):
    def test_inference_uses_the_already_verified_crop_bytes(self) -> None:
        captured = []

        class FakeEngine:
            def __call__(self, source, **_kwargs):
                captured.append(source)
                return None, None

        request_path = CANONICAL_ROOT / "math-function-graph.visual-ocr-observation-request.json"
        with patch("visual_ocr_observer.validate_runtime_identity", return_value=FakeEngine()):
            compile_request(request_path, CANONICAL_ROOT)
        self.assertEqual(len(captured), 1)
        self.assertIsInstance(captured[0], bytes)
        self.assertEqual(sha256_bytes(captured[0]), self.read_json(request_path)["crop"]["rawByteSha256"])

    def test_three_canonical_fixtures_replay_deterministically(self) -> None:
        self.assertEqual(validate_canonical_fixtures(), 3)

    def test_canonical_outputs_preserve_diagnostic_only_observations(self) -> None:
        expected = {
            "math-function-graph": [],
            "junior-instrument-scale": ["+++++++++"],
            "senior-circuit-label": [],
        }
        for request_path in sorted(CANONICAL_ROOT.glob("*.visual-ocr-observation-request.json")):
            result = compile_request(request_path, CANONICAL_ROOT)
            self.assertEqual(
                [item["observedText"] for item in result["observations"]],
                expected[result["requestId"]],
            )
            self.assertEqual(result["summary"]["observationCount"], len(result["observations"]))
            self.assertEqual(
                result["dispositions"],
                {
                    "observationStatus": "completed",
                    "groundTruthAvailable": False,
                    "acceptanceDisposition": "not_evaluated",
                    "requiresHumanReview": True,
                    "semanticDisposition": "not_inferred",
                    "trackDisposition": "not_integrated",
                },
            )
            self.assertNotIn("elapsed", json.dumps(result))

    def test_normalization_orders_and_rounds_observations(self) -> None:
        raw = [
            [[[20, 10], [30, 10], [30, 20], [20, 20]], "second", "0.876543219"],
            [[[1.12345678, 2], [4, 2], [4, 8], [1, 8]], "first", 0.75],
        ]
        result = normalize_observations(raw)
        self.assertEqual([item["observationId"] for item in result], [
            "ocr-observation-001", "ocr-observation-002"
        ])
        self.assertEqual([item["observedText"] for item in result], ["first", "second"])
        self.assertEqual(result[0]["quad"][0]["x"], 1.123457)
        self.assertEqual(result[1]["confidence"], 0.87654322)

    def test_runtime_policy_and_cloud_drift_fail_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-ocr-observation-request.json"
            request = self.read_json(request_path)
            request["runtimePolicy"]["parameters"]["textScore"] = 0.4
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "runtime policy drifted"):
                compile_request(request_path, root)
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-ocr-observation-request.json"
            request = self.read_json(request_path)
            request["egressPolicy"]["allowCloud"] = True
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "cloud egress"):
                compile_request(request_path, root)

    def test_upstream_authority_hash_drift_fails_closed(self) -> None:
        for field, message in (
            ("preprocessingResult", "preprocessing result raw-byte"),
            ("structureExtractionResult", "structure result raw-byte"),
        ):
            with self.fixture_copy() as root:
                request_path = root / "math-function-graph.visual-ocr-observation-request.json"
                request = self.read_json(request_path)
                request[field]["rawByteSha256"] = "0" * 64
                self.write_json(request_path, request)
                with self.assertRaisesRegex(ValueError, message):
                    compile_request(request_path, root)

    def test_crop_binding_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-ocr-observation-request.json"
            request = self.read_json(request_path)
            request["crop"]["scale"] = 1
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "scale=2"):
                compile_request(request_path, root)
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-ocr-observation-request.json"
            request = self.read_json(request_path)
            request["crop"]["rawByteSha256"] = "0" * 64
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "crop binding drifted"):
                compile_request(request_path, root)

    def test_result_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            result_path = root / "math-function-graph.visual-ocr-observation-result.json"
            result = self.read_json(result_path)
            result["summary"]["observationCount"] += 1
            self.write_json(result_path, result)
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["expectedResultSha256"] = sha256_bytes(result_path.read_bytes())
            self.write_json(inventory_path, inventory)
            with self.assertRaisesRegex(ValueError, "computed fields drifted"):
                validate_canonical_fixtures(root)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "unlisted"
            nested.mkdir()
            shutil.copyfile(
                root / "math-function-graph.visual-ocr-observation-result.json",
                nested / "unknown.json",
            )
            with self.assertRaisesRegex(ValueError, "exactly cover canonical authority"):
                validate_canonical_fixtures(root)

    def test_hardlink_alias_is_rejected(self) -> None:
        with self.fixture_copy() as root:
            source = root / "math-function-graph.visual-ocr-observation-request.json"
            alias = root / "junior-instrument-scale.visual-ocr-observation-request.json"
            alias.unlink()
            try:
                os.link(source, alias)
            except OSError as error:
                self.skipTest(f"hardlink capability unavailable: {error}")
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][1]["requestSha256"] = sha256_bytes(alias.read_bytes())
            self.write_json(inventory_path, inventory)
            with self.assertRaisesRegex(ValueError, "aliases another authority"):
                validate_canonical_fixtures(root)

    def test_runtime_rejects_noncanonical_request_copy(self) -> None:
        with self.fixture_copy() as root, tempfile.TemporaryDirectory(
            prefix="visual-ocr-output-"
        ) as temp:
            copied_request = root / "math-function-graph.visual-ocr-observation-request.json"
            with self.assertRaisesRegex(ValueError, "escapes its allowed root"):
                run_admitted_request(copied_request, Path(temp) / "bundle")

    def test_runtime_writes_external_bundle_and_rejects_repo_output(self) -> None:
        request_path = CANONICAL_ROOT / "junior-instrument-scale.visual-ocr-observation-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-ocr-output-") as temp:
            output = Path(temp) / "bundle"
            result_path = run_admitted_request(request_path, output)
            result = self.read_json(result_path)
            self.assertEqual(result["engineProvenance"]["engineKind"], "local_runtime")
            self.assertFalse(result["engineProvenance"]["liveProvider"])
            self.assertFalse(result["engineProvenance"]["cloudEgress"])
            self.assertEqual(len(list(output.iterdir())), 1)
        rejected = REPO_ROOT / ".eval-work" / "visual-ocr-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_admitted_request(request_path, rejected)

    def test_runtime_rejects_request_path_alias(self) -> None:
        request_path = CANONICAL_ROOT / "math-function-graph.visual-ocr-observation-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-ocr-alias-") as temp:
            alias = Path(temp) / request_path.name
            try:
                alias.symlink_to(request_path)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "canonical path"):
                run_admitted_request(alias, Path(temp) / "bundle")

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-ocr-fixture-"))
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
