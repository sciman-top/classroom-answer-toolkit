from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import visual_ocr_region_association as association
from visual_ocr_region_association import (
    CANONICAL_ROOT,
    INVENTORY_NAME,
    REPORT_NAME,
    REPO_ROOT,
    _run_diagnostics,
    apply_association_policy,
    atomic_write,
    compile_request,
    load_upstream_authorities,
    run_diagnostics,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
    validate_fixture_structure,
)


class VisualOcrRegionAssociationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = load_upstream_authorities()

    def test_canonical_report_preserves_actual_unavailable_and_unmatched_outcomes(self) -> None:
        report = self.read_json(CANONICAL_ROOT / REPORT_NAME)
        statuses = {
            case["caseId"]: case["associationStatus"] for case in report["caseReports"]
        }
        self.assertEqual(
            statuses,
            {
                "math-function-graph": "unavailable",
                "junior-instrument-scale": "unmatched",
                "senior-circuit-label": "unavailable",
                "junior-readable-measurement": "matched",
            },
        )
        self.assertEqual(report["totals"]["matchedCaseCount"], 1)
        self.assertEqual(report["totals"]["unmatchedCaseCount"], 1)
        self.assertEqual(report["totals"]["ambiguousCaseCount"], 0)
        self.assertEqual(report["totals"]["unavailableCaseCount"], 2)
        self.assertEqual(report["totals"]["matchedAssociationCount"], 1)
        self.assertEqual(report["totals"]["ocrObservationCount"], 2)
        self.assertEqual(report["totals"]["associationRate"], {"available": True, "value": 0.5})
        self.assertEqual(report["dispositions"]["acceptanceDisposition"], "not_accepted")
        self.assertFalse(report["dispositions"]["eligible"])
        self.assertEqual(report["dispositions"]["optimizationCandidateRefs"], [])
        encoded = json.dumps(report)
        self.assertNotIn("observedText", encoded)
        self.assertNotIn("truth-label", encoded)

    def test_policy_level_unique_positive_edge_associates_without_becoming_authority(self) -> None:
        result = apply_association_policy(
            ["text-region-001"],
            ["ocr-observation-001"],
            [self.measurement(1, "text-region-001", "ocr-observation-001", positive=True)],
        )
        self.assertEqual(result["associationStatus"], "matched")
        self.assertEqual(result["summary"]["matchedAssociationCount"], 1)
        self.assertEqual(result["summary"]["associationRate"], {"available": True, "value": 1.0})
        self.assertEqual(
            result["associations"][0]["spatialMeasurementRef"], "spatial-measurement-001"
        )
        self.assertNotIn("observedText", json.dumps(result))

    def test_policy_level_ambiguity_fails_closed(self) -> None:
        measurements = [
            self.measurement(1, "text-region-001", "ocr-observation-001", positive=True),
            self.measurement(2, "text-region-002", "ocr-observation-001", positive=True),
        ]
        with self.assertRaisesRegex(ValueError, "Ambiguous OCR-region association"):
            apply_association_policy(
                ["text-region-001", "text-region-002"],
                ["ocr-observation-001"],
                measurements,
            )

    def test_empty_observation_is_unavailable_with_unavailable_denominator(self) -> None:
        result = apply_association_policy(["text-region-001"], [], [])
        self.assertEqual(result["associationStatus"], "unavailable")
        self.assertEqual(result["summary"]["unavailableCaseCount"], 1)
        self.assertEqual(result["summary"]["associationRate"], {"available": False})
        self.assertEqual(result["unmatchedTextRegionCandidateRefs"], ["text-region-001"])

    def test_disjoint_pair_is_unmatched_and_never_uses_distance_fallback(self) -> None:
        result = apply_association_policy(
            ["text-region-001"],
            ["ocr-observation-001"],
            [self.measurement(1, "text-region-001", "ocr-observation-001", positive=False)],
        )
        self.assertEqual(result["associationStatus"], "unmatched")
        self.assertEqual(result["associations"], [])
        self.assertEqual(result["summary"]["associationRate"], {"available": True, "value": 0.0})

    def test_incomplete_cartesian_measurements_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "Cartesian coverage is incomplete"):
            apply_association_policy(
                ["text-region-001", "text-region-002"],
                ["ocr-observation-001"],
                [self.measurement(1, "text-region-001", "ocr-observation-001", positive=False)],
            )

    def test_relation_and_intersection_conflict_fails_closed(self) -> None:
        value = self.measurement(1, "text-region-001", "ocr-observation-001", positive=False)
        value["spatialRelation"] = "overlap"
        with self.assertRaisesRegex(ValueError, "relation conflicts"):
            apply_association_policy(
                ["text-region-001"], ["ocr-observation-001"], [value]
            )

    def test_request_upstream_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "junior-instrument-scale.visual-ocr-region-association-request.json"
            request = self.read_json(request_path)
            request["spatialObservationResult"]["rawByteSha256"] = "0" * 64
            request_path.write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "authority drifted"):
                compile_request(request_path, root, self.upstream)

    def test_inventory_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["spatialObservationResultSha256"] = "0" * 64
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "spatialObservationResultSha256 drifted"):
                association.compile_report(root, self.upstream)

    def test_result_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            result_path = root / "junior-instrument-scale.visual-ocr-region-association-result.json"
            result = self.read_json(result_path)
            result["summary"]["unmatchedOcrObservationCount"] = 0
            result_path.write_bytes(stable_json_bytes(result))
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][1]["expectedResultSha256"] = sha256_bytes(
                result_path.read_bytes()
            )
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "does not replay"):
                association.compile_report(root, self.upstream)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "extra"
            nested.mkdir()
            (nested / "unknown.json").write_bytes(b"{}\n")
            with self.assertRaisesRegex(ValueError, "nested or alias"):
                validate_fixture_structure(root)

    def test_hardlink_authority_alias_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report_path.unlink()
            os.link(root / INVENTORY_NAME, report_path)
            with self.assertRaisesRegex(ValueError, "unique physical identities"):
                validate_fixture_structure(root)

    def test_runtime_writes_external_report_and_rejects_repo_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-association-output-") as temp:
            output = Path(temp) / "bundle"
            report_path = run_diagnostics(output)
            self.assertEqual(report_path.name, REPORT_NAME)
            self.assertEqual(len(list(output.iterdir())), 1)
            self.assertEqual(self.read_json(report_path), self.read_json(CANONICAL_ROOT / REPORT_NAME))
        rejected = REPO_ROOT / ".eval-work" / "visual-association-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_diagnostics(rejected)

    def test_staged_output_tamper_fails_closed_before_promotion(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-association-output-") as temp:
                output = Path(temp) / "bundle"
                original = atomic_write

                def tamper_stage(path: Path, data: bytes) -> None:
                    original(path, data)
                    if path.name == REPORT_NAME and path.parent.name.startswith(".bundle."):
                        path.write_bytes(b"{}\n")

                with patch.object(association, "atomic_write", side_effect=tamper_stage):
                    with self.assertRaisesRegex(ValueError, "Staged association report bytes drifted"):
                        _run_diagnostics(output, root)
                self.assertFalse(output.exists())

    def test_inventory_toctou_drift_fails_closed_before_promotion(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-association-output-") as temp:
                output = Path(temp) / "bundle"
                original = association.validate_snapshots
                call_count = 0

                def drift_on_later_check(snapshots):
                    nonlocal call_count
                    call_count += 1
                    if call_count == 2:
                        (root / INVENTORY_NAME).write_bytes(b"{}\n")
                    original(snapshots)

                with patch.object(association, "validate_snapshots", side_effect=drift_on_later_check):
                    with self.assertRaisesRegex(ValueError, "bytes drifted"):
                        _run_diagnostics(output, root)
                self.assertFalse(output.exists())

    def test_canonical_fixtures_replay_in_fresh_process_contract(self) -> None:
        self.assertEqual(validate_canonical_fixtures(), len(association.DEFINITIONS))

    @staticmethod
    def measurement(
        index: int,
        candidate_id: str,
        observation_id: str,
        *,
        positive: bool,
    ) -> dict:
        return {
            "measurementId": f"spatial-measurement-{index:03d}",
            "textRegionCandidateRef": candidate_id,
            "ocrObservationRef": observation_id,
            "ocrAxisAlignedBounds": {"x": 1.0, "y": 1.0, "width": 4.0, "height": 4.0},
            "intersectionArea": 4.0 if positive else 0.0,
            "intersectionOverTextRegionAreaRatio": 0.5 if positive else 0.0,
            "intersectionOverOcrBoundsAreaRatio": 0.25 if positive else 0.0,
            "centroidDistanceSquared": 100.0,
            "spatialRelation": "overlap" if positive else "disjoint",
        }

    @staticmethod
    def read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8-sig"))

    @contextmanager
    def fixture_copy(self):
        with tempfile.TemporaryDirectory(prefix="visual-association-fixture-") as temp:
            root = Path(temp) / "cases"
            shutil.copytree(CANONICAL_ROOT, root)
            yield root


if __name__ == "__main__":
    unittest.main()
