from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import visual_page_normalizer as normalizer

from visual_page_normalizer import (
    CANONICAL_ROOT,
    CAPTURE_NAME,
    NORMALIZED_NAME,
    REQUEST_NAME,
    RESULT_NAME,
    build_request,
    canonical_artifacts,
    compile_request,
    detect_page_quadrilateral,
    render_synthetic_capture,
    run_admitted_request,
    stable_json_bytes,
    validate_fixtures,
)


class VisualPageNormalizerTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def test_canonical_compile_detects_and_normalizes_page(self) -> None:
        result, normalized = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        self.assertEqual(result["pageDetection"]["status"], "detected")
        self.assertGreater(result["pageDetection"]["areaRatio"], 0.5)
        self.assertEqual(len(result["pageDetection"]["quadrilateral"]), 4)
        self.assertNotEqual(result["pageDetection"]["orientationDegrees"], 0)
        self.assertEqual(result["normalizedPage"]["pixelSize"], {"width": 560, "height": 360})
        self.assertTrue(result["normalizedPage"]["preprocessing"]["perspectiveCorrectionApplied"])
        self.assertTrue(result["normalizedPage"]["preprocessing"]["deskewApplied"])
        self.assertTrue(result["normalizedPage"]["preprocessing"]["denoiseApplied"])
        self.assertEqual(result["corrections"], result["normalizedPage"]["preprocessing"])
        self.assertEqual(result["normalizedPage"]["regionRefs"], [])
        self.assertEqual(result["normalizedPage"]["qualityFlags"], ["rotated"])
        self.assertGreater(len(normalized), 1000)
        self.assertFalse(result["engineProvenance"]["liveProvider"])
        self.assertFalse(result["engineProvenance"]["cloudEgress"])
        self.assertFalse(result["dispositions"]["eligible"])

    def test_detection_rejects_capture_without_a_page(self) -> None:
        empty = np.full((540, 720, 3), 72, dtype=np.uint8)
        with self.assertRaisesRegex(ValueError, "No admitted page quadrilateral"):
            detect_page_quadrilateral(empty)

    def test_request_policy_and_capture_hash_drift_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-test-") as directory:
            root = Path(directory)
            artifacts = canonical_artifacts()
            for name, data in artifacts.items():
                (root / name).write_bytes(data)
            request = json.loads((root / REQUEST_NAME).read_text(encoding="utf-8"))
            request["policy"]["minimumPageAreaRatio"] = 0.1
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "policy drifted"):
                compile_request(root / REQUEST_NAME, root)

            request = build_request(render_synthetic_capture())
            request["capture"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "Capture authority bytes drifted"):
                compile_request(root / REQUEST_NAME, root)

    def test_noncanonical_request_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-copy-") as directory:
            copied = Path(directory) / REQUEST_NAME
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, copied)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(copied, Path(directory) / "output")

    def test_runtime_writes_atomic_external_pair(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-output-") as directory:
            output = Path(directory) / "result"
            result_path = run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertEqual(result_path, output / RESULT_NAME)
            self.assertEqual(sorted(path.name for path in output.iterdir()), [NORMALIZED_NAME, RESULT_NAME])
            self.assertEqual((output / NORMALIZED_NAME).read_bytes(), (CANONICAL_ROOT / NORMALIZED_NAME).read_bytes())

    def test_staged_output_tamper_fails_closed_before_promotion(self) -> None:
        original = normalizer.atomic_write

        def tamper_result(path: Path, data: bytes) -> None:
            original(path, data)
            if path.name == RESULT_NAME:
                path.write_bytes(b"{}\n")

        with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-tamper-") as directory:
            output = Path(directory) / "result"
            with patch.object(normalizer, "atomic_write", side_effect=tamper_result):
                with self.assertRaisesRegex(ValueError, "Staged page-normalization output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

    def test_runtime_rejects_existing_and_repository_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-existing-") as directory:
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
        with tempfile.TemporaryDirectory(prefix="visual-page-normalizer-junction-") as directory:
            junction = Path(directory) / "repo"
            try:
                junction.symlink_to(CANONICAL_ROOT.parent, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            output = junction / ".normalizer-output"
            with self.assertRaisesRegex(ValueError, "outside repository authority"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)

    def test_canonical_artifacts_replay_byte_exactly(self) -> None:
        self.assertEqual(validate_fixtures(), 1)
        expected = canonical_artifacts()
        self.assertEqual(sorted(expected), sorted(path.name for path in CANONICAL_ROOT.iterdir()))
        for name, data in expected.items():
            self.assertEqual((CANONICAL_ROOT / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
