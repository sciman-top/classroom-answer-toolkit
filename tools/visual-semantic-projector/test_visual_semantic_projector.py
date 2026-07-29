from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import visual_semantic_projector as projector
from visual_semantic_projector import (
    CANONICAL_ROOT,
    DEFINITION,
    INVENTORY_NAME,
    REPORT_NAME,
    REPO_ROOT,
    UpstreamAuthority,
    _run_diagnostics,
    atomic_write,
    build_declaration,
    build_request,
    compile_request,
    load_upstream_authorities,
    materialize_fixtures,
    run_diagnostics,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
    validate_fixture_structure,
)


class VisualSemanticProjectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = load_upstream_authorities()

    def test_canonical_projection_uses_explicit_role_and_bound_ocr_text(self) -> None:
        result = self.read_json(CANONICAL_ROOT / DEFINITION.result_name)
        projection = result["projections"][0]
        self.assertEqual(projection["semanticRole"], "measurement_reading")
        self.assertEqual(projection["recognizedText"], "12")
        self.assertEqual(projection["truthLabelRef"], "truth-label-001")
        self.assertEqual(projection["ocrObservationRef"], "ocr-observation-001")
        self.assertEqual(projection["textRegionCandidateRef"], "text-region-001")
        self.assertEqual(projection["associationRef"], "ocr-region-association-001")
        self.assertEqual(result["dispositions"]["figureUnderstandingDisposition"], "not_generated")
        self.assertEqual(result["dispositions"]["trackDisposition"], "not_integrated")
        self.assertFalse(result["dispositions"]["eligible"])

    def test_recognized_text_is_not_loaded_from_truth_text(self) -> None:
        upstream = self.consistent_truth_text_mutation("not-the-ocr-text")
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            result = compile_request(root / DEFINITION.request_name, root, upstream)
        self.assertEqual(result["projections"][0]["recognizedText"], "12")

    def test_missing_declared_role_fails_even_when_other_evidence_is_positive(self) -> None:
        with self.fixture_copy() as root:
            declaration_path = root / DEFINITION.declaration_name
            declaration = self.read_json(declaration_path)
            declaration.pop("semanticRole")
            self.rebind_declaration(root, declaration)
            with self.assertRaisesRegex(ValueError, "Declaration.*drifted"):
                compile_request(root / DEFINITION.request_name, root, self.upstream)

    def test_duplicate_truth_label_fails_closed(self) -> None:
        upstream = self.mutated_upstream()
        upstream.values["truth"]["labels"].append(
            copy.deepcopy(upstream.values["truth"]["labels"][0])
        )
        self.reserialize(upstream, "truth")
        self.rebind_truth_contracts(upstream)
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            with self.assertRaisesRegex(ValueError, "exactly one unique endpoint"):
                compile_request(root / DEFINITION.request_name, root, upstream)

    def test_missing_truth_label_fails_closed(self) -> None:
        upstream = self.mutated_upstream()
        upstream.values["truth"]["labels"] = []
        self.reserialize(upstream, "truth")
        self.rebind_truth_contracts(upstream)
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            with self.assertRaisesRegex(ValueError, "exactly one unique endpoint"):
                compile_request(root / DEFINITION.request_name, root, upstream)

    def test_missing_and_duplicate_diagnostic_matches_fail_closed(self) -> None:
        for report_key in ("ocr_report", "text_report"):
            canonical_match = self.case_report(self.upstream.values[report_key])["matches"][0]
            for matches in ([], [copy.deepcopy(canonical_match), copy.deepcopy(canonical_match)]):
                with self.subTest(report=report_key, count=len(matches)):
                    upstream = self.mutated_upstream()
                    self.case_report(upstream.values[report_key])["matches"] = matches
                    self.reserialize(upstream, report_key)
                    with self.fixture_copy() as root:
                        self.rebind_fixture_to_upstream(root, upstream)
                        with self.assertRaisesRegex(ValueError, "exactly one unique endpoint"):
                            compile_request(root / DEFINITION.request_name, root, upstream)

    def test_missing_and_duplicate_observation_endpoints_fail_closed(self) -> None:
        for observations in ([], [
            copy.deepcopy(self.upstream.values["ocr_result"]["observations"][0]),
            copy.deepcopy(self.upstream.values["ocr_result"]["observations"][0]),
        ]):
            with self.subTest(count=len(observations)):
                upstream = self.mutated_upstream()
                upstream.values["ocr_result"]["observations"] = observations
                self.reserialize(upstream, "ocr_result")
                self.rebind_ocr_result_contracts(upstream)
                with self.fixture_copy() as root:
                    self.rebind_fixture_to_upstream(root, upstream)
                    with self.assertRaisesRegex(ValueError, "exactly one unique endpoint"):
                        compile_request(root / DEFINITION.request_name, root, upstream)

    def test_missing_and_ambiguous_association_endpoints_fail_closed(self) -> None:
        canonical_edge = self.upstream.values["association"]["associations"][0]
        for edges in ([], [copy.deepcopy(canonical_edge), {
            **copy.deepcopy(canonical_edge),
            "associationId": "ocr-region-association-002",
        }]):
            with self.subTest(count=len(edges)):
                upstream = self.mutated_upstream()
                upstream.values["association"]["associations"] = edges
                upstream.values["association"]["summary"]["matchedAssociationCount"] = len(edges)
                upstream.values["association"]["summary"]["ambiguousEndpointCount"] = (
                    1 if len(edges) > 1 else 0
                )
                upstream.values["association"]["dispositions"]["associationStatus"] = (
                    "unavailable" if not edges else "matched"
                )
                self.reserialize(upstream, "association")
                with self.fixture_copy() as root:
                    self.rebind_fixture_to_upstream(root, upstream)
                    with self.assertRaises(ValueError):
                        compile_request(root / DEFINITION.request_name, root, upstream)

    def test_crossed_ocr_endpoint_fails_closed(self) -> None:
        upstream = self.mutated_upstream()
        ocr_case = self.case_report(upstream.values["ocr_report"])
        ocr_case["matches"][0]["ocrObservationRef"] = "ocr-observation-999"
        self.reserialize(upstream, "ocr_report")
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            with self.assertRaisesRegex(ValueError, "evidence triangle|exactly one"):
                compile_request(root / DEFINITION.request_name, root, upstream)

    def test_crossed_candidate_endpoint_fails_closed(self) -> None:
        upstream = self.mutated_upstream()
        text_case = self.case_report(upstream.values["text_report"])
        text_case["matches"][0]["textRegionCandidateRef"] = "text-region-999"
        self.reserialize(upstream, "text_report")
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            with self.assertRaisesRegex(ValueError, "evidence triangle"):
                compile_request(root / DEFINITION.request_name, root, upstream)

    def test_unmatched_association_state_fails_closed(self) -> None:
        upstream = self.mutated_upstream()
        upstream.values["association"]["dispositions"]["associationStatus"] = "unmatched"
        upstream.values["association"]["associations"] = []
        self.reserialize(upstream, "association")
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            with self.assertRaisesRegex(ValueError, "matched, unambiguous association"):
                compile_request(root / DEFINITION.request_name, root, upstream)

    def test_nonmatched_or_ambiguous_association_disposition_fails_closed(self) -> None:
        for status in ("unmatched", "unavailable", "ambiguous"):
            with self.subTest(status=status):
                upstream = self.mutated_upstream()
                upstream.values["association"]["dispositions"]["associationStatus"] = status
                upstream.values["association"]["summary"]["ambiguousEndpointCount"] = (
                    1 if status == "ambiguous" else 0
                )
                self.reserialize(upstream, "association")
                with self.fixture_copy() as root:
                    self.rebind_fixture_to_upstream(root, upstream)
                    with self.assertRaisesRegex(ValueError, "matched, unambiguous association"):
                        compile_request(root / DEFINITION.request_name, root, upstream)

    def test_request_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            request_path = root / DEFINITION.request_name
            request = self.read_json(request_path)
            request["associationResult"]["rawByteSha256"] = "0" * 64
            request_path.write_bytes(stable_json_bytes(request))
            with self.assertRaisesRegex(ValueError, "Request authority drifted"):
                compile_request(request_path, root, self.upstream)

    def test_request_path_escape_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            outside = root.parent / DEFINITION.request_name
            shutil.copy2(root / DEFINITION.request_name, outside)
            with self.assertRaisesRegex(ValueError, "escapes its allowed root"):
                compile_request(outside, root, self.upstream)

    def test_result_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            result_path = root / DEFINITION.result_name
            result = self.read_json(result_path)
            result["projections"][0]["recognizedText"] = "99"
            result_path.write_bytes(stable_json_bytes(result))
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["expectedResultSha256"] = sha256_bytes(
                result_path.read_bytes()
            )
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "does not deterministically replay"):
                projector.compile_report(root, self.upstream)

    def test_crop_drift_fails_closed(self) -> None:
        upstream = self.mutated_upstream()
        upstream.values["crop"]["pixelSize"]["width"] += 1
        with self.fixture_copy() as root:
            self.rebind_fixture_to_upstream(root, upstream)
            with self.assertRaisesRegex(ValueError, "crop authority drifted"):
                compile_request(root / DEFINITION.request_name, root, upstream)

    def test_unlisted_nested_and_hardlink_authority_fail_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "extra"
            nested.mkdir()
            (nested / "unknown.json").write_bytes(b"{}\n")
            with self.assertRaisesRegex(ValueError, "nested or alias"):
                validate_fixture_structure(root)
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report_path.unlink()
            os.link(root / INVENTORY_NAME, report_path)
            with self.assertRaisesRegex(ValueError, "unique physical identities"):
                validate_fixture_structure(root)

    def test_runtime_writes_external_report_and_rejects_repository_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-semantic-output-") as temp:
            output = Path(temp) / "bundle"
            report_path = run_diagnostics(output)
            self.assertEqual(report_path.name, REPORT_NAME)
            self.assertEqual(len(list(output.iterdir())), 1)
            self.assertEqual(
                self.read_json(report_path), self.read_json(CANONICAL_ROOT / REPORT_NAME)
            )
        rejected = REPO_ROOT / ".eval-work" / "visual-semantic-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_diagnostics(rejected)

    def test_staged_output_tamper_fails_closed_before_promotion(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-semantic-output-") as temp:
                output = Path(temp) / "bundle"
                original = atomic_write

                def tamper_stage(path: Path, data: bytes) -> None:
                    original(path, data)
                    if path.name == REPORT_NAME and path.parent.name.startswith(".bundle."):
                        path.write_bytes(b"{}\n")

                with patch.object(projector, "atomic_write", side_effect=tamper_stage):
                    with self.assertRaisesRegex(ValueError, "Staged semantic projection report"):
                        _run_diagnostics(output, root, self.upstream)
                self.assertFalse(output.exists())

    def test_inventory_toctou_drift_fails_closed_before_promotion(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-semantic-output-") as temp:
                output = Path(temp) / "bundle"
                original = projector.validate_snapshots
                call_count = 0

                def drift_on_later_check(snapshots):
                    nonlocal call_count
                    call_count += 1
                    if call_count == 2:
                        (root / INVENTORY_NAME).write_bytes(b"{}\n")
                    original(snapshots)

                with patch.object(
                    projector, "validate_snapshots", side_effect=drift_on_later_check
                ):
                    with self.assertRaisesRegex(ValueError, "bytes drifted"):
                        _run_diagnostics(output, root, self.upstream)
                self.assertFalse(output.exists())

    def test_canonical_fixtures_replay(self) -> None:
        self.assertEqual(validate_canonical_fixtures(upstream=self.upstream), 1)

    def test_materialization_is_repeatable_and_byte_exact(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-semantic-materialize-") as temp:
            root = Path(temp) / "cases"
            self.assertEqual(materialize_fixtures(root, self.upstream), 1)
            first = {path.name: path.read_bytes() for path in root.iterdir()}
            self.assertEqual(materialize_fixtures(root, self.upstream), 1)
            second = {path.name: path.read_bytes() for path in root.iterdir()}
            self.assertEqual(first, second)

    def mutated_upstream(self) -> UpstreamAuthority:
        return UpstreamAuthority(
            values=copy.deepcopy(self.upstream.values),
            bytes_by_key=dict(self.upstream.bytes_by_key),
            snapshots=self.upstream.snapshots,
        )

    def consistent_truth_text_mutation(self, text: str) -> UpstreamAuthority:
        upstream = self.mutated_upstream()
        upstream.values["truth"]["labels"][0]["text"] = text
        self.reserialize(upstream, "truth")
        self.rebind_truth_contracts(upstream)
        return upstream

    def rebind_truth_contracts(self, upstream: UpstreamAuthority) -> None:
        truth_contract = {
            "artifactRef": projector.TRUTH_REF,
            "rawByteSha256": sha256_bytes(upstream.bytes_by_key["truth"]),
        }
        for key in ("ocr_report", "text_report"):
            self.case_report(upstream.values[key])["truth"] = truth_contract
            self.reserialize(upstream, key)

    @staticmethod
    def reserialize(upstream: UpstreamAuthority, key: str) -> None:
        upstream.bytes_by_key[key] = stable_json_bytes(upstream.values[key])

    @staticmethod
    def case_report(report: dict) -> dict:
        return next(case for case in report["caseReports"] if case["caseId"] == DEFINITION.case_id)

    def rebind_fixture_to_upstream(self, root: Path, upstream: UpstreamAuthority) -> None:
        declaration = build_declaration(upstream)
        declaration_bytes = stable_json_bytes(declaration)
        (root / DEFINITION.declaration_name).write_bytes(declaration_bytes)
        request = build_request(declaration_bytes, upstream)
        (root / DEFINITION.request_name).write_bytes(stable_json_bytes(request))

    def rebind_ocr_result_contracts(self, upstream: UpstreamAuthority) -> None:
        contract = {
            "artifactRef": projector.OCR_OBSERVATION_RESULT_REF,
            "rawByteSha256": sha256_bytes(upstream.bytes_by_key["ocr_result"]),
            "requestId": DEFINITION.case_id,
        }
        self.case_report(upstream.values["ocr_report"])["ocrObservationResult"] = contract
        self.reserialize(upstream, "ocr_report")
        upstream.values["association"]["ocrObservationResult"] = contract
        self.reserialize(upstream, "association")

    def rebind_declaration(self, root: Path, declaration: dict) -> None:
        declaration_bytes = stable_json_bytes(declaration)
        (root / DEFINITION.declaration_name).write_bytes(declaration_bytes)
        request_path = root / DEFINITION.request_name
        request = self.read_json(request_path)
        request["semanticDeclaration"]["rawByteSha256"] = sha256_bytes(declaration_bytes)
        request_path.write_bytes(stable_json_bytes(request))

    @staticmethod
    def read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8-sig"))

    @contextmanager
    def fixture_copy(self):
        with tempfile.TemporaryDirectory(prefix="visual-semantic-fixture-") as temp:
            root = Path(temp) / "cases"
            shutil.copytree(CANONICAL_ROOT, root)
            yield root


if __name__ == "__main__":
    unittest.main()
