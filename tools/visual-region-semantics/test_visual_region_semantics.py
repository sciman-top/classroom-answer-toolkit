from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import visual_region_semantics as semantics
from visual_region_semantics import (
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


class VisualRegionSemanticsTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def _write_mutation(self, root: Path, mutate) -> Path:
        artifacts = canonical_artifacts()
        declaration = json.loads(artifacts[DECLARATION_NAME].decode("utf-8"))
        mutate(declaration)
        declaration_bytes = stable_json_bytes(declaration)
        request = json.loads(artifacts[REQUEST_NAME].decode("utf-8"))
        request["semanticDeclaration"]["rawByteSha256"] = sha256_bytes(declaration_bytes)
        (root / DECLARATION_NAME).write_bytes(declaration_bytes)
        (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
        return root / REQUEST_NAME

    def test_canonical_compile_projects_two_explicit_regions(self) -> None:
        result = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        self.assertEqual(
            [(item["proposalRef"], item["visualRegion"]["regionType"], item["semanticRole"])
             for item in result["regionSemantics"]],
            [
                ("content-block-001", "text_area", "measurement_reading"),
                ("content-block-002", "scale_area", "measurement_scale_baseline"),
            ],
        )
        self.assertTrue(all(len(item["cropBindings"]) == 2 for item in result["regionSemantics"]))
        self.assertEqual(result["dispositions"]["inferenceDisposition"], "not_performed")
        self.assertEqual(result["dispositions"]["questionBindingDisposition"], "not_established")
        self.assertEqual(result["dispositions"]["trackDisposition"], "not_integrated")
        self.assertEqual(result["dispositions"]["answerDisposition"], "not_generated")
        self.assertTrue(result["dispositions"]["requiresHumanReview"])
        self.assertFalse(result["dispositions"]["eligible"])

    def test_crossed_proposal_declaration_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-crossed-") as directory:
            root = Path(directory)
            request_path = self._write_mutation(
                root,
                lambda value: value["regionDeclarations"][0].update(
                    {"proposalRef": "content-block-002"}),
            )
            with self.assertRaisesRegex(ValueError, "declaration coverage"):
                compile_request(request_path, root)

    def test_unsupported_role_and_region_type_fail_closed(self) -> None:
        mutations = (
            lambda value: value["regionDeclarations"][0].update({"semanticRole": "answer_value"}),
            lambda value: value["regionDeclarations"][1].update({"regionType": "axis_area"}),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory(
                prefix="visual-region-semantics-role-"
            ) as directory:
                root = Path(directory)
                request_path = self._write_mutation(root, mutate)
                with self.assertRaisesRegex(ValueError, "semantic declaration"):
                    compile_request(request_path, root)

    def test_stale_crop_hash_and_bbox_fail_closed(self) -> None:
        mutations = (
            lambda value: value["regionDeclarations"][0]["cropBindings"][0].update(
                {"rawByteSha256": "0" * 64}),
            lambda value: value["regionDeclarations"][1]["bbox"].update({"width": 385}),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory(
                prefix="visual-region-semantics-binding-"
            ) as directory:
                root = Path(directory)
                request_path = self._write_mutation(root, mutate)
                with self.assertRaisesRegex(ValueError, "binding"):
                    compile_request(request_path, root)

    def test_request_or_upstream_hash_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-request-") as directory:
            root = Path(directory)
            artifacts = canonical_artifacts()
            (root / DECLARATION_NAME).write_bytes(artifacts[DECLARATION_NAME])
            request = json.loads(artifacts[REQUEST_NAME].decode("utf-8"))
            request["localCropResult"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "crop authority drifted"):
                compile_request(root / REQUEST_NAME, root)

    def test_semantic_or_trust_escalation_fails_closed(self) -> None:
        result = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        mutations = (
            lambda value: value["dispositions"].update({"inferenceDisposition": "performed"}),
            lambda value: value["dispositions"].update({"requiresHumanReview": False}),
            lambda value: value["dispositions"].update({"eligible": True}),
        )
        for mutate in mutations:
            candidate = json.loads(json.dumps(result))
            mutate(candidate)
            with self.assertRaisesRegex(ValueError, "result boundary"):
                semantics.validate_result(candidate)

    def test_noncanonical_runtime_request_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-copy-") as directory:
            copied = Path(directory) / REQUEST_NAME
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, copied)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(copied, Path(directory) / "output")

    def test_runtime_writes_atomic_external_result(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-output-") as directory:
            output = Path(directory) / "result"
            result_path = run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertEqual(result_path, output / RESULT_NAME)
            self.assertEqual([path.name for path in output.iterdir()], [RESULT_NAME])

    def test_staged_output_tamper_fails_closed_before_promotion(self) -> None:
        original = semantics.atomic_write

        def tamper(path: Path, data: bytes) -> None:
            original(path, data)
            path.write_bytes(b"{}\n")

        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-tamper-") as directory:
            output = Path(directory) / "result"
            with patch.object(semantics, "atomic_write", side_effect=tamper):
                with self.assertRaisesRegex(ValueError, "Staged region-semantics output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

    def test_runtime_rejects_existing_repository_and_junction_outputs(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-existing-") as directory:
            existing = Path(directory) / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, existing)
        with self.assertRaisesRegex(ValueError, "outside repository authority"):
            run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, CANONICAL_ROOT.parent / ".output")
        with tempfile.TemporaryDirectory(prefix="visual-region-semantics-junction-") as directory:
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
