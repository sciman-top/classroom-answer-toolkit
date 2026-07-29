from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from visual_structure_extractor import (
    CANONICAL_ROOT,
    DEFINITIONS,
    INVENTORY_NAME,
    REPO_ROOT,
    compile_request,
    run_admitted_request,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
)


class VisualStructureExtractorTests(unittest.TestCase):
    def test_all_canonical_fixtures_replay_deterministically(self) -> None:
        self.assertEqual(validate_canonical_fixtures(), len(DEFINITIONS))

    def test_all_subjects_produce_nonsemantic_candidates(self) -> None:
        for request_path in sorted(CANONICAL_ROOT.glob("*.visual-structure-extraction-request.json")):
            result = compile_request(request_path, CANONICAL_ROOT)
            self.assertGreater(result["summary"]["lineSegmentCount"], 0)
            self.assertGreater(result["summary"]["connectedRegionCount"], 0)
            self.assertEqual(result["summary"]["lineSegmentCount"], len(result["lineSegmentCandidates"]))
            self.assertEqual(result["summary"]["connectedRegionCount"], len(result["connectedRegionCandidates"]))
            self.assertEqual(result["summary"]["textRegionCandidateCount"], len(result["textRegionCandidates"]))
            self.assertEqual(result["dispositions"], {
                "ocrDisposition": "not_attempted",
                "semanticDisposition": "not_inferred",
                "trackDisposition": "not_integrated",
            })
            self.assertNotIn("recognizedText", json.dumps(result))

    def test_candidate_ids_and_order_are_stable(self) -> None:
        request_path = CANONICAL_ROOT / "math-function-graph.visual-structure-extraction-request.json"
        result = compile_request(request_path, CANONICAL_ROOT)
        self.assertEqual(
            [candidate["candidateId"] for candidate in result["lineSegmentCandidates"]],
            [f"line-{index:03d}" for index in range(1, len(result["lineSegmentCandidates"]) + 1)],
        )
        self.assertEqual(
            [candidate["candidateId"] for candidate in result["connectedRegionCandidates"]],
            [f"region-{index:03d}" for index in range(1, len(result["connectedRegionCandidates"]) + 1)],
        )

    def test_policy_and_cloud_egress_drift_fail_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-structure-extraction-request.json"
            request = self.read_json(request_path)
            request["extractionPolicy"]["houghLinesP"]["threshold"] = 31
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "algorithm policy drifted"):
                compile_request(request_path, root)
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-structure-extraction-request.json"
            request = self.read_json(request_path)
            request["egressPolicy"]["allowCloud"] = True
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "cloud egress"):
                compile_request(request_path, root)

    def test_scale_one_or_crop_hash_drift_fail_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-structure-extraction-request.json"
            request = self.read_json(request_path)
            request["crop"]["scale"] = 1
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "scale=2"):
                compile_request(request_path, root)
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-structure-extraction-request.json"
            request = self.read_json(request_path)
            request["crop"]["rawByteSha256"] = "0" * 64
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "crop binding drifted"):
                compile_request(request_path, root)

    def test_preprocessing_result_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-structure-extraction-request.json"
            request = self.read_json(request_path)
            request["preprocessingResult"]["rawByteSha256"] = "0" * 64
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "raw-byte SHA-256 drifted"):
                compile_request(request_path, root)

    def test_result_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            result_path = root / "math-function-graph.visual-structure-extraction-result.json"
            result = self.read_json(result_path)
            result["summary"]["lineSegmentCount"] += 1
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
                root / "math-function-graph.visual-structure-extraction-result.json",
                nested / "unknown.json",
            )
            with self.assertRaisesRegex(ValueError, "exactly cover canonical authority"):
                validate_canonical_fixtures(root)

    def test_hardlink_alias_is_rejected(self) -> None:
        with self.fixture_copy() as root:
            source = root / "math-function-graph.visual-structure-extraction-request.json"
            alias = root / "junior-instrument-scale.visual-structure-extraction-request.json"
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
            prefix="visual-structure-output-"
        ) as temp:
            copied_request = root / "math-function-graph.visual-structure-extraction-request.json"
            with self.assertRaisesRegex(ValueError, "escapes its allowed root"):
                run_admitted_request(copied_request, Path(temp) / "bundle")

    def test_runtime_writes_external_bundle_and_rejects_repo_output(self) -> None:
        request_path = CANONICAL_ROOT / "junior-instrument-scale.visual-structure-extraction-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-structure-output-") as temp:
            output = Path(temp) / "bundle"
            result_path = run_admitted_request(request_path, output)
            result = self.read_json(result_path)
            self.assertEqual(result["engineProvenance"]["engineKind"], "local_runtime")
            self.assertFalse(result["engineProvenance"]["liveProvider"])
            self.assertFalse(result["engineProvenance"]["cloudEgress"])
            self.assertEqual(len(list(output.iterdir())), 1)
        rejected = REPO_ROOT / ".eval-work" / "visual-structure-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_admitted_request(request_path, rejected)

    def test_runtime_rejects_request_path_alias(self) -> None:
        request_path = CANONICAL_ROOT / "math-function-graph.visual-structure-extraction-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-structure-alias-") as temp:
            alias = Path(temp) / request_path.name
            try:
                alias.symlink_to(request_path)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "canonical path"):
                run_admitted_request(alias, Path(temp) / "bundle")

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-structure-fixture-"))
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
