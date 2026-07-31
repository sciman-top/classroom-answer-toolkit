from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import visual_component_semantics as compiler
from visual_component_semantics import (
    CANONICAL_ROOT, DECLARATION_NAME, REQUEST_NAME, RESULT_NAME,
    canonical_artifacts, compile_request, run_admitted_request, sha256_bytes,
    stable_json_bytes, validate_fixtures,
)


class VisualComponentSemanticsTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def _mutation(self, root: Path, mutate) -> Path:
        artifacts = canonical_artifacts()
        declaration = json.loads(artifacts[DECLARATION_NAME])
        mutate(declaration)
        declaration_bytes = stable_json_bytes(declaration)
        request = json.loads(artifacts[REQUEST_NAME])
        request["componentDeclaration"]["rawByteSha256"] = sha256_bytes(declaration_bytes)
        (root / DECLARATION_NAME).write_bytes(declaration_bytes)
        (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
        return root / REQUEST_NAME

    def test_canonical_compile_emits_pointer_and_five_major_ticks(self) -> None:
        result = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        self.assertEqual(result["summary"], {"componentCount": 6, "pointerCount": 1, "majorTickCount": 5})
        self.assertEqual(result["components"][0]["componentType"], "pointer_indicator")
        self.assertEqual(
            [item["componentType"] for item in result["components"][1:]],
            ["major_tick_mark"] * 5,
        )
        self.assertEqual(result["dispositions"]["inferenceDisposition"], "not_performed")
        self.assertEqual(result["dispositions"]["scaleInterpretationDisposition"], "not_established")
        self.assertEqual(result["dispositions"]["readingDisposition"], "not_generated")
        self.assertTrue(result["dispositions"]["requiresHumanReview"])
        self.assertFalse(result["dispositions"]["eligible"])

    def test_crossed_or_duplicate_candidate_refs_fail_closed(self) -> None:
        mutations = (
            lambda value: value["componentDeclarations"][0].update({"candidateRefs": ["line-009", "line-014"]}),
            lambda value: value["componentDeclarations"][1].update({"candidateRefs": ["line-007", "line-008"]}),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory(prefix="component-semantics-ref-") as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, "component declaration"):
                    compile_request(self._mutation(root, mutate), root)

    def test_unsupported_type_and_candidate_segment_drift_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="component-semantics-type-") as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "component declaration"):
                compile_request(self._mutation(root, lambda value: value["componentDeclarations"][0].update({"componentType": "scale_value"})), root)
        with tempfile.TemporaryDirectory(prefix="component-semantics-segment-") as directory:
            root = Path(directory)
            artifacts = canonical_artifacts()
            (root / DECLARATION_NAME).write_bytes(artifacts[DECLARATION_NAME])
            request = json.loads(artifacts[REQUEST_NAME])
            request["structureExtractionResult"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "structure authority drifted"):
                compile_request(root / REQUEST_NAME, root)

    def test_result_boundary_escalation_fails_closed(self) -> None:
        result = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        for key, value in (("inferenceDisposition", "performed"), ("requiresHumanReview", False), ("eligible", True)):
            candidate = json.loads(json.dumps(result))
            candidate["dispositions"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "result boundary"):
                compiler.validate_result(candidate)

    def test_noncanonical_request_and_unsafe_outputs_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="component-semantics-copy-") as directory:
            copy = Path(directory) / REQUEST_NAME
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, copy)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(copy, Path(directory) / "out")
        with tempfile.TemporaryDirectory(prefix="component-semantics-existing-") as directory:
            existing = Path(directory) / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, existing)
        with self.assertRaisesRegex(ValueError, "outside repository authority"):
            run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, CANONICAL_ROOT.parent / ".out")

    def test_runtime_is_atomic_and_staged_tamper_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="component-semantics-output-") as directory:
            output = Path(directory) / "out"
            self.assertEqual(run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output), output / RESULT_NAME)
        original = compiler.atomic_write
        def tamper(path: Path, data: bytes) -> None:
            original(path, data)
            path.write_bytes(b"{}\n")
        with tempfile.TemporaryDirectory(prefix="component-semantics-tamper-") as directory:
            output = Path(directory) / "out"
            with patch.object(compiler, "atomic_write", side_effect=tamper):
                with self.assertRaisesRegex(ValueError, "Staged component-semantics output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

    def test_runtime_input_snapshot_drift_fails_closed(self) -> None:
        declaration_path = CANONICAL_ROOT / DECLARATION_NAME
        declaration_bytes = declaration_path.read_bytes()
        original = compiler.atomic_write

        def drift_after_stage(path: Path, data: bytes) -> None:
            original(path, data)
            declaration_path.write_bytes(b"{}\n")

        try:
            with tempfile.TemporaryDirectory(prefix="component-semantics-input-drift-") as directory:
                output = Path(directory) / "out"
                with patch.object(compiler, "atomic_write", side_effect=drift_after_stage):
                    with self.assertRaisesRegex(ValueError, "input drifted during execution"):
                        run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
                self.assertFalse(output.exists())
        finally:
            declaration_path.write_bytes(declaration_bytes)

    def test_runtime_rejects_external_junction_into_repository(self) -> None:
        with tempfile.TemporaryDirectory(prefix="component-semantics-junction-") as directory:
            junction = Path(directory) / "repo"
            try:
                junction.symlink_to(CANONICAL_ROOT.parent, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink capability unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "outside repository authority"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, junction / ".output")

    def test_canonical_artifacts_replay_byte_exactly(self) -> None:
        expected = canonical_artifacts()
        self.assertEqual(validate_fixtures(), 1)
        self.assertEqual(sorted(expected), sorted(path.name for path in CANONICAL_ROOT.iterdir()))
        for name, data in expected.items():
            self.assertEqual((CANONICAL_ROOT / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
