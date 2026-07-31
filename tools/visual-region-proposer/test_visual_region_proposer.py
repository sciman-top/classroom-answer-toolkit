from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import visual_region_proposer as proposer
from visual_region_proposer import (
    CANONICAL_ROOT,
    OVERLAY_NAME,
    REQUEST_NAME,
    RESULT_NAME,
    canonical_artifacts,
    compile_request,
    propose_regions,
    run_admitted_request,
    stable_json_bytes,
    validate_fixtures,
)


class VisualRegionProposerTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def test_canonical_compile_proposes_two_nonsemantic_content_blocks(self) -> None:
        result, overlay = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        self.assertEqual(result["summary"], {"proposalCount": 2, "boundaryTouchingCount": 0})
        self.assertEqual(
            [candidate["bbox"] for candidate in result["regionProposalCandidates"]],
            [
                {"x": 254, "y": 147, "width": 53, "height": 65},
                {"x": 89, "y": 255, "width": 386, "height": 26},
            ],
        )
        expected_candidate_fields = {
            "proposalId", "proposalKind", "bbox", "sourceComponentBounds", "foregroundArea",
            "bboxArea", "foregroundCoverageRatio", "touchesPageBoundary", "heuristicOnly",
        }
        for candidate in result["regionProposalCandidates"]:
            self.assertEqual(set(candidate), expected_candidate_fields)
            self.assertTrue(candidate["heuristicOnly"])
            self.assertEqual(
                candidate["bboxArea"], candidate["bbox"]["width"] * candidate["bbox"]["height"]
            )
            self.assertEqual(
                candidate["foregroundCoverageRatio"],
                round(candidate["foregroundArea"] / candidate["bboxArea"], 6),
            )
        self.assertEqual(result["dispositions"]["semanticDisposition"], "not_inferred")
        self.assertEqual(result["dispositions"]["visualRegionDisposition"], "not_generated")
        self.assertFalse(result["dispositions"]["eligible"])
        self.assertGreater(len(overlay), 1000)

    def test_empty_page_rejects_missing_content_candidates(self) -> None:
        empty = np.full((360, 560, 3), 255, dtype=np.uint8)
        with self.assertRaisesRegex(ValueError, "No admitted content-block candidate"):
            propose_regions(empty, proposer.PROPOSAL_POLICY)

    def test_excess_candidate_inventory_fails_closed(self) -> None:
        crowded = np.full((360, 560, 3), 255, dtype=np.uint8)
        for index in range(17):
            x = 20 + (index % 6) * 80
            y = 20 + (index // 6) * 40
            crowded[y:y + 5, x:x + 5] = 0
        with self.assertRaisesRegex(ValueError, "exceeds the admitted maximum"):
            propose_regions(crowded, proposer.PROPOSAL_POLICY)

    def test_request_policy_and_upstream_hash_drift_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-proposer-request-") as directory:
            root = Path(directory)
            artifacts = canonical_artifacts()
            (root / REQUEST_NAME).write_bytes(artifacts[REQUEST_NAME])
            request = json.loads((root / REQUEST_NAME).read_text(encoding="utf-8"))
            request["proposalPolicy"]["minimumForegroundArea"] = 1
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "policy drifted"):
                compile_request(root / REQUEST_NAME, root)

            request = json.loads(artifacts[REQUEST_NAME].decode("utf-8"))
            request["normalizedArtifact"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "normalized artifact authority drifted"):
                compile_request(root / REQUEST_NAME, root)

    def test_noncanonical_runtime_request_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-proposer-copy-") as directory:
            copied = Path(directory) / REQUEST_NAME
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, copied)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(copied, Path(directory) / "output")

    def test_runtime_writes_atomic_external_pair(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-proposer-output-") as directory:
            output = Path(directory) / "result"
            result_path = run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertEqual(result_path, output / RESULT_NAME)
            self.assertEqual(sorted(path.name for path in output.iterdir()), [OVERLAY_NAME, RESULT_NAME])
            self.assertEqual((output / OVERLAY_NAME).read_bytes(), (CANONICAL_ROOT / OVERLAY_NAME).read_bytes())

    def test_staged_output_tamper_fails_closed_before_promotion(self) -> None:
        original = proposer.atomic_write

        def tamper_result(path: Path, data: bytes) -> None:
            original(path, data)
            if path.name == RESULT_NAME:
                path.write_bytes(b"{}\n")

        with tempfile.TemporaryDirectory(prefix="visual-region-proposer-tamper-") as directory:
            output = Path(directory) / "result"
            with patch.object(proposer, "atomic_write", side_effect=tamper_result):
                with self.assertRaisesRegex(ValueError, "Staged visual-region proposal output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

    def test_runtime_rejects_existing_and_repository_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-proposer-existing-") as directory:
            output = Path(directory) / "existing"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
        repository_output = CANONICAL_ROOT.parent / ".runtime-output"
        try:
            with self.assertRaisesRegex(ValueError, "outside repository authority"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, repository_output)
        finally:
            shutil.rmtree(repository_output, ignore_errors=True)

    def test_runtime_rejects_external_junction_into_repository(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-proposer-junction-") as directory:
            junction = Path(directory) / "repo"
            try:
                junction.symlink_to(CANONICAL_ROOT.parent, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "outside repository authority"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, junction / ".output")

    def test_canonical_artifacts_replay_byte_exactly(self) -> None:
        self.assertEqual(validate_fixtures(), 1)
        expected = canonical_artifacts()
        self.assertEqual(sorted(expected), sorted(path.name for path in CANONICAL_ROOT.iterdir()))
        for name, data in expected.items():
            self.assertEqual((CANONICAL_ROOT / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
