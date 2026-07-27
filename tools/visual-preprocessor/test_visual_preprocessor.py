from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from visual_preprocessor import (
    CANONICAL_ROOT,
    INVENTORY_NAME,
    REPO_ROOT,
    compile_request,
    decoded_pixel_sha256,
    run_admitted_request,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
)


class VisualPreprocessorTests(unittest.TestCase):
    def test_three_canonical_fixtures_replay_deterministically(self) -> None:
        self.assertEqual(validate_canonical_fixtures(), 3)

    def test_one_x_preserves_pixels_and_two_x_uses_nearest_dimensions(self) -> None:
        request_path = CANONICAL_ROOT / "math-function-graph.visual-preprocessing-request.json"
        result, crops = compile_request(request_path, CANONICAL_ROOT)
        source = Image.open(CANONICAL_ROOT / result["source"]["artifactRef"]).convert("RGB")
        bbox = result["visualRegion"]["bbox"]
        expected = source.crop((
            bbox["x"],
            bbox["y"],
            bbox["x"] + bbox["width"],
            bbox["y"] + bbox["height"],
        ))
        crop_1x = Image.open(CANONICAL_ROOT / result["cropArtifacts"][0]["artifactRef"]).convert("RGB")
        self.assertEqual(decoded_pixel_sha256(crop_1x), decoded_pixel_sha256(expected))
        self.assertEqual(result["cropArtifacts"][0]["interpolation"], "pixel_preserving")
        self.assertEqual(result["cropArtifacts"][1]["interpolation"], "nearest")
        self.assertEqual(result["cropArtifacts"][1]["pixelSize"], {
            "width": bbox["width"] * 2,
            "height": bbox["height"] * 2,
        })
        self.assertEqual(crops[result["cropArtifacts"][0]["artifactRef"]], (
            CANONICAL_ROOT / result["cropArtifacts"][0]["artifactRef"]
        ).read_bytes())

    def test_cloud_egress_and_scale_drift_fail_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-preprocessing-request.json"
            request = self.read_json(request_path)
            request["egressPolicy"]["allowCloud"] = True
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "cloud egress"):
                compile_request(request_path, root)

        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-preprocessing-request.json"
            request = self.read_json(request_path)
            request["scales"] = [1, 3]
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "exactly"):
                compile_request(request_path, root)

    def test_bbox_out_of_bounds_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-preprocessing-request.json"
            request = self.read_json(request_path)
            request["bbox"]["width"] = 999
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "outside source pixel bounds"):
                compile_request(request_path, root)

    def test_source_raw_byte_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            source_path = root / "math-function-graph.source.png"
            source_path.write_bytes(source_path.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "raw bytes do not match"):
                validate_canonical_fixtures(root)

    def test_request_inventory_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-preprocessing-request.json"
            request_path.write_bytes(request_path.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "raw bytes do not match"):
                validate_canonical_fixtures(root)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "unlisted"
            nested.mkdir()
            shutil.copyfile(
                root / "math-function-graph.source.png",
                nested / "unknown-authority.png",
            )
            with self.assertRaisesRegex(ValueError, "exactly cover canonical authority"):
                validate_canonical_fixtures(root)

    def test_result_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            result_path = root / "math-function-graph.visual-preprocessing-result.json"
            result = self.read_json(result_path)
            result["visualRegion"]["pixelSize"]["width"] += 1
            self.write_json(result_path, result)
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["expectedResultSha256"] = sha256_bytes(result_path.read_bytes())
            self.write_json(inventory_path, inventory)
            with self.assertRaisesRegex(ValueError, "computed fields drifted"):
                validate_canonical_fixtures(root)

    def test_source_path_escape_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / "math-function-graph.visual-preprocessing-request.json"
            request = self.read_json(request_path)
            request["source"]["artifactRef"] = "../outside.png"
            self.write_json(request_path, request)
            with self.assertRaisesRegex(ValueError, "source identity"):
                compile_request(request_path, root)

    def test_hardlink_alias_is_rejected(self) -> None:
        with self.fixture_copy() as root:
            source = root / "math-function-graph.visual-preprocessing-request.json"
            alias = root / "junior-instrument-scale.visual-preprocessing-request.json"
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

    def test_runtime_writes_new_external_bundle_and_rejects_repo_output(self) -> None:
        request_path = CANONICAL_ROOT / "junior-instrument-scale.visual-preprocessing-request.json"
        with tempfile.TemporaryDirectory(prefix="visual-preprocessor-output-") as temp:
            output = Path(temp) / "bundle"
            result_path = run_admitted_request(
                request_path,
                CANONICAL_ROOT / INVENTORY_NAME,
                output,
            )
            self.assertTrue(result_path.is_file())
            result = self.read_json(result_path)
            self.assertEqual(result["engineProvenance"]["engineKind"], "local_runtime")
            self.assertEqual(
                [component["name"] for component in result["engineProvenance"]["components"]],
                ["opencv", "pillow"],
            )
            self.assertFalse(result["engineProvenance"]["liveProvider"])
            self.assertFalse(result["engineProvenance"]["cloudEgress"])
            self.assertEqual(len(list(output.glob("*.png"))), 2)

        rejected = REPO_ROOT / ".eval-work" / "visual-preprocessor-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_admitted_request(
                request_path,
                CANONICAL_ROOT / INVENTORY_NAME,
                rejected,
            )

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-preprocessor-fixture-"))
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
