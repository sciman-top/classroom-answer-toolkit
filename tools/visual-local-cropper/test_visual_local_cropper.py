from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import visual_local_cropper as cropper
from visual_local_cropper import (
    CANONICAL_ROOT, REQUEST_NAME, RESULT_NAME, canonical_artifacts, compile_request,
    render_crops, run_admitted_request, stable_json_bytes, validate_fixtures,
)


class VisualLocalCropperTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def test_canonical_compile_emits_two_scales_for_each_nonsemantic_proposal(self) -> None:
        result, crops = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        self.assertEqual(result["summary"], {"proposalCount": 2, "cropArtifactCount": 4})
        self.assertEqual(
            [(item["proposalRef"], item["scale"], item["pixelSize"]) for item in result["cropArtifacts"]],
            [
                ("content-block-001", 1, {"width": 53, "height": 65}),
                ("content-block-001", 2, {"width": 106, "height": 130}),
                ("content-block-002", 1, {"width": 386, "height": 26}),
                ("content-block-002", 2, {"width": 772, "height": 52}),
            ],
        )
        self.assertEqual(set(crops), {item["artifactRef"] for item in result["cropArtifacts"]})
        self.assertEqual(result["dispositions"]["semanticDisposition"], "not_inferred")
        self.assertEqual(result["dispositions"]["visualRegionDisposition"], "not_generated")

    def test_invalid_proposal_bounds_fail_closed(self) -> None:
        image = np.full((360, 560, 3), 255, dtype=np.uint8)
        proposals = [{"proposalId": "content-block-001", "bbox": {"x": 550, "y": 350, "width": 20, "height": 20}}]
        with self.assertRaisesRegex(ValueError, "outside normalized page"):
            render_crops(image, proposals, [1, 2])

    def test_request_policy_and_proposal_hash_drift_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-local-cropper-request-") as directory:
            root = Path(directory)
            artifacts = canonical_artifacts()
            request = json.loads(artifacts[REQUEST_NAME].decode("utf-8"))
            request["scales"] = [1]
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "scales drifted"):
                compile_request(root / REQUEST_NAME, root)
            request = json.loads(artifacts[REQUEST_NAME].decode("utf-8"))
            request["regionProposalResult"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "proposal authority drifted"):
                compile_request(root / REQUEST_NAME, root)

    def test_noncanonical_runtime_request_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-local-cropper-copy-") as directory:
            copied = Path(directory) / REQUEST_NAME
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, copied)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(copied, Path(directory) / "output")

    def test_runtime_writes_atomic_external_bundle(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-local-cropper-output-") as directory:
            output = Path(directory) / "result"
            result_path = run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertEqual(result_path, output / RESULT_NAME)
            self.assertEqual(len(list(output.iterdir())), 5)

    def test_staged_output_tamper_fails_closed_before_promotion(self) -> None:
        original = cropper.atomic_write
        def tamper(path: Path, data: bytes) -> None:
            original(path, data)
            if path.name == RESULT_NAME:
                path.write_bytes(b"{}\n")
        with tempfile.TemporaryDirectory(prefix="visual-local-cropper-tamper-") as directory:
            output = Path(directory) / "result"
            with patch.object(cropper, "atomic_write", side_effect=tamper):
                with self.assertRaisesRegex(ValueError, "Staged local-crop output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

    def test_runtime_rejects_existing_and_repository_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-local-cropper-existing-") as directory:
            existing = Path(directory) / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, existing)
        repository_output = CANONICAL_ROOT.parent / ".runtime-output"
        with self.assertRaisesRegex(ValueError, "outside repository authority"):
            run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, repository_output)

    def test_runtime_rejects_external_junction_into_repository(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-local-cropper-junction-") as directory:
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
