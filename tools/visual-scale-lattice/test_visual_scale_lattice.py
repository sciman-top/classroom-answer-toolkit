from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import visual_scale_lattice as lattice
from visual_scale_lattice import (
    CANONICAL_ROOT,
    DECLARATION_NAME,
    REQUEST_NAME,
    RESULT_NAME,
    canonical_artifacts,
    compile_request,
    run_admitted_request,
    sha256_bytes,
    stable_json_bytes,
    validate_fixtures,
)


class VisualScaleLatticeTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def _mutation(self, root: Path, mutate) -> Path:
        artifacts = canonical_artifacts()
        declaration = json.loads(artifacts[DECLARATION_NAME])
        mutate(declaration)
        declaration_bytes = stable_json_bytes(declaration)
        request = json.loads(artifacts[REQUEST_NAME])
        request["scaleDeclaration"]["rawByteSha256"] = sha256_bytes(declaration_bytes)
        (root / DECLARATION_NAME).write_bytes(declaration_bytes)
        (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
        return root / REQUEST_NAME

    def test_canonical_compile_derives_relative_subdivision_index(self) -> None:
        result = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        self.assertEqual(result["scaleLattice"]["majorSpacingPixels"], 120)
        self.assertEqual(result["scaleLattice"]["subdivisionSpacingPixels"], 24)
        self.assertEqual(result["scaleLattice"]["subdivisionsPerMajorInterval"], 5)
        self.assertEqual(result["pointerPosition"]["relativeSubdivisionIndex"], 11)
        self.assertEqual(result["pointerPosition"]["physicalQuantity"], None)
        self.assertEqual(result["pointerPosition"]["unit"], None)
        self.assertEqual(result["dispositions"]["readingDisposition"], "relative_index_only")
        self.assertTrue(result["dispositions"]["requiresHumanReview"])
        self.assertFalse(result["dispositions"]["eligible"])

    def test_minor_slot_coverage_and_geometry_are_fail_closed(self) -> None:
        mutations = (
            lambda value: value["minorTickSlots"][0].update({"slotIndex": 2}),
            lambda value: value["minorTickSlots"][1].update({"regionRef": "region-008"}),
            lambda value: value["minorTickSlots"].pop(),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory(prefix="scale-lattice-minor-") as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, "scale declaration"):
                    compile_request(self._mutation(root, mutate), root)

    def test_major_component_and_source_hash_drift_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="scale-lattice-major-") as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "scale declaration"):
                compile_request(self._mutation(root, lambda value: value["majorTickComponentRefs"].reverse()), root)
        with tempfile.TemporaryDirectory(prefix="scale-lattice-source-") as directory:
            root = Path(directory)
            artifacts = canonical_artifacts()
            (root / DECLARATION_NAME).write_bytes(artifacts[DECLARATION_NAME])
            request = json.loads(artifacts[REQUEST_NAME])
            request["componentSemanticsResult"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "component semantics authority drifted"):
                compile_request(root / REQUEST_NAME, root)

    def test_component_and_minor_region_geometry_drift_fail_closed(self) -> None:
        component_bytes, component, structure_bytes, structure = lattice.load_authority()
        drifted_component = json.loads(json.dumps(component))
        drifted_component["components"][0]["bbox"]["x"] += 1
        with patch.object(
            lattice,
            "load_authority",
            return_value=(component_bytes, drifted_component, structure_bytes, structure),
        ):
            with self.assertRaisesRegex(ValueError, "Pointer geometry"):
                compile_request(CANONICAL_ROOT / REQUEST_NAME)

        drifted_structure = json.loads(json.dumps(structure))
        region = next(item for item in drifted_structure["connectedRegionCandidates"] if item["candidateId"] == "region-008")
        region["bbox"]["x"] += 1
        with patch.object(
            lattice,
            "load_authority",
            return_value=(component_bytes, component, structure_bytes, drifted_structure),
        ):
            with self.assertRaisesRegex(ValueError, "minor tick geometry"):
                compile_request(CANONICAL_ROOT / REQUEST_NAME)

    def test_result_boundary_escalation_fails_closed(self) -> None:
        result = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        for key, value in (
            ("physicalReadingDisposition", "generated"),
            ("requiresHumanReview", False),
            ("eligible", True),
        ):
            candidate = json.loads(json.dumps(result))
            candidate["dispositions"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "result boundary"):
                lattice.validate_result(candidate)

    def test_noncanonical_request_and_unsafe_outputs_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="scale-lattice-copy-") as directory:
            copy = Path(directory) / REQUEST_NAME
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, copy)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(copy, Path(directory) / "out")
        with tempfile.TemporaryDirectory(prefix="scale-lattice-existing-") as directory:
            existing = Path(directory) / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, existing)
        with self.assertRaisesRegex(ValueError, "outside repository authority"):
            run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, CANONICAL_ROOT.parent / ".out")

    def test_runtime_rejects_external_junction_into_repository(self) -> None:
        with tempfile.TemporaryDirectory(prefix="scale-lattice-junction-") as directory:
            junction = Path(directory) / "repo"
            try:
                junction.symlink_to(CANONICAL_ROOT.parent, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "outside repository authority"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, junction / ".output")

    def test_runtime_is_atomic_and_rejects_staged_or_input_drift(self) -> None:
        with tempfile.TemporaryDirectory(prefix="scale-lattice-output-") as directory:
            output = Path(directory) / "out"
            self.assertEqual(run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output), output / RESULT_NAME)

        original = lattice.atomic_write

        def tamper(path: Path, data: bytes) -> None:
            original(path, data)
            path.write_bytes(b"{}\n")

        with tempfile.TemporaryDirectory(prefix="scale-lattice-stage-") as directory:
            output = Path(directory) / "out"
            with patch.object(lattice, "atomic_write", side_effect=tamper):
                with self.assertRaisesRegex(ValueError, "Staged scale-lattice output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

        declaration_path = CANONICAL_ROOT / DECLARATION_NAME
        declaration_bytes = declaration_path.read_bytes()

        def drift_after_stage(path: Path, data: bytes) -> None:
            original(path, data)
            declaration_path.write_bytes(b"{}\n")

        try:
            with tempfile.TemporaryDirectory(prefix="scale-lattice-input-") as directory:
                output = Path(directory) / "out"
                with patch.object(lattice, "atomic_write", side_effect=drift_after_stage):
                    with self.assertRaisesRegex(ValueError, "input drifted during execution"):
                        run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
                self.assertFalse(output.exists())
        finally:
            declaration_path.write_bytes(declaration_bytes)

    def test_canonical_artifacts_replay_byte_exactly(self) -> None:
        expected = canonical_artifacts()
        self.assertEqual(validate_fixtures(), 1)
        self.assertEqual(sorted(expected), sorted(path.name for path in CANONICAL_ROOT.iterdir()))
        for name, data in expected.items():
            self.assertEqual((CANONICAL_ROOT / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
