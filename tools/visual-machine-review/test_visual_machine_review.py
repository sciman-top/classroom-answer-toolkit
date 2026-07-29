from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import visual_machine_review as review
from visual_machine_review import (
    CANONICAL_ROOT,
    INVENTORY_NAME,
    REPORT_NAME,
    REPO_ROOT,
    _run_review,
    atomic_write,
    build_receipt,
    compile_report,
    materialize_fixtures,
    run_review,
    sha256_bytes,
    stable_json_bytes,
    validate_canonical_fixtures,
    validate_fixture_structure,
    validate_receipt,
    validate_runtime_identity,
)


class VisualMachineReviewTests(unittest.TestCase):
    def test_canonical_report_preserves_machine_identity_and_scope(self) -> None:
        report = self.read_json(CANONICAL_ROOT / REPORT_NAME)
        self.assertEqual(report["totals"]["reviewedCaseCount"], len(review.DEFINITIONS))
        self.assertEqual(report["totals"]["acceptedCaseCount"], len(review.DEFINITIONS))
        self.assertEqual(report["totals"]["rejectedCaseCount"], 0)
        self.assertEqual(report["totals"]["limitedCaseCount"], len(review.DEFINITIONS))
        self.assertEqual(report["totals"]["machineReviewedCount"], len(review.DEFINITIONS))
        self.assertEqual(report["totals"]["humanReviewedCount"], 0)
        self.assertEqual(
            report["dispositions"]["equivalencePolicy"],
            "synthetic_fixture_equivalent",
        )
        self.assertEqual(
            report["dispositions"]["acceptanceScope"],
            "synthetic_fixture_diagnostic",
        )
        self.assertEqual(report["dispositions"]["humanIdentityDisposition"], "not_claimed")
        self.assertEqual(report["dispositions"]["deliveryTrustDisposition"], "not_projected")
        self.assertEqual(report["dispositions"]["liveAcceptanceDisposition"], "not_accepted")
        self.assertFalse(report["dispositions"]["eligible"])
        self.assertEqual(report["dispositions"]["optimizationCandidateRefs"], [])

    def test_receipts_disclose_current_visual_review_provenance(self) -> None:
        receipts = [self.canonical_receipt(definition.case_id) for definition in review.DEFINITIONS]
        for receipt in receipts:
            self.assertEqual(receipt["reviewer"]["reviewerKind"], "ai_agent")
            self.assertFalse(receipt["reviewer"]["humanReviewed"])
            self.assertEqual(
                receipt["reviewer"]["attestationClass"],
                "unattested_local_machine_review",
            )
            self.assertFalse(receipt["reviewer"]["liveProvider"])
            self.assertFalse(receipt["reviewer"]["cloudEgress"])
            self.assertEqual(receipt["decision"], "accept_for_diagnostic_use")
        senior = self.canonical_receipt("senior-circuit-label")
        self.assertEqual(
            senior["reviewer"]["inspectionSurfaces"],
            ["direct_image_render", "windows_honeyview"],
        )

    def test_known_crop_limitations_are_not_hidden(self) -> None:
        math = self.canonical_receipt("math-function-graph")
        junior = self.canonical_receipt("junior-instrument-scale")
        senior = self.canonical_receipt("senior-circuit-label")
        self.assertEqual(math["knownLimitations"], ["outside_crop_axis_label"])
        self.assertEqual(junior["knownLimitations"], ["partially_clipped_header"])
        self.assertEqual(senior["knownLimitations"], ["partially_clipped_header"])
        for receipt in (math, junior, senior):
            self.assertTrue(
                any(check["status"] == "pass_with_limitation" for check in receipt["checks"])
            )

    def test_human_identity_and_positive_delivery_projection_fail_closed(self) -> None:
        receipt, definition, preprocessing_contract, crop = self.receipt_inputs(
            "math-function-graph"
        )
        for mutation, message in (
            (lambda value: value["reviewer"].__setitem__("humanReviewed", True), "reviewer identity"),
            (lambda value: value.__setitem__("humanApproved", True), "fields differ"),
            (
                lambda value: value["dispositions"].__setitem__(
                    "deliveryTrustDisposition", "trusted"
                ),
                "review dispositions",
            ),
            (
                lambda value: value["dispositions"].__setitem__(
                    "liveAcceptanceDisposition", "accepted"
                ),
                "review dispositions",
            ),
        ):
            with self.subTest(message=message):
                mutated = copy.deepcopy(receipt)
                mutation(mutated)
                with self.assertRaisesRegex(ValueError, message):
                    validate_receipt(mutated, definition, preprocessing_contract, crop)

    def test_missing_check_or_limitation_fails_closed(self) -> None:
        receipt, definition, preprocessing_contract, crop = self.receipt_inputs(
            "senior-circuit-label"
        )
        missing_check = copy.deepcopy(receipt)
        missing_check["checks"].pop()
        with self.assertRaisesRegex(ValueError, "checks are incomplete"):
            validate_receipt(missing_check, definition, preprocessing_contract, crop)
        hidden_limitation = copy.deepcopy(receipt)
        hidden_limitation["knownLimitations"] = []
        with self.assertRaisesRegex(ValueError, "known limitations drifted"):
            validate_receipt(hidden_limitation, definition, preprocessing_contract, crop)

    def test_materializer_rejects_unreviewed_crop_authority(self) -> None:
        with self.preprocessing_copy() as preprocessing_root:
            definition = review.DEFINITION_BY_ID["math-function-graph"]
            preprocessing_path = preprocessing_root / definition.preprocessing_result_name
            preprocessing = self.read_json(preprocessing_path)
            preprocessing["cropArtifacts"][1]["decodedRgbPixelSha256"] = "0" * 64
            preprocessing_path.write_bytes(stable_json_bytes(preprocessing))
            with patch.multiple(
                "visual_machine_review",
                PREPROCESSING_ROOT=preprocessing_root,
                validate_preprocessing_fixtures=lambda: None,
            ), tempfile.TemporaryDirectory(prefix="visual-machine-review-materialize-") as temp:
                with self.assertRaisesRegex(ValueError, "reviewed authority"):
                    materialize_fixtures(Path(temp) / "cases")

    def test_canonical_validator_rejects_coherent_unreviewed_authority_rewrite(self) -> None:
        with self.fixture_copy() as fixture_root, self.preprocessing_copy() as preprocessing_root:
            definition = review.DEFINITION_BY_ID["math-function-graph"]
            preprocessing_path = preprocessing_root / definition.preprocessing_result_name
            preprocessing = self.read_json(preprocessing_path)
            crop = review.select_two_x_crop(preprocessing)
            crop_path = preprocessing_root / crop["artifactRef"]
            image = review.decode_png(crop_path.read_bytes(), "mutated review crop").copy()
            pixel = image.getpixel((0, 0))
            mutated = ((pixel[0] + 1) % 256, *pixel[1:])
            image.putpixel((0, 0), mutated)
            image.save(crop_path, format="PNG")
            crop_bytes = crop_path.read_bytes()
            crop["rawByteSha256"] = sha256_bytes(crop_bytes)
            crop["decodedRgbPixelSha256"] = review.decoded_pixel_sha256(image)
            preprocessing_bytes = stable_json_bytes(preprocessing)
            preprocessing_path.write_bytes(preprocessing_bytes)

            receipt_path = fixture_root / definition.receipt_name
            receipt = self.read_json(receipt_path)
            receipt["preprocessingResult"]["rawByteSha256"] = sha256_bytes(
                preprocessing_bytes
            )
            receipt["crop"]["rawByteSha256"] = crop["rawByteSha256"]
            receipt["crop"]["decodedRgbPixelSha256"] = crop["decodedRgbPixelSha256"]
            receipt_bytes = stable_json_bytes(receipt)
            receipt_path.write_bytes(receipt_bytes)

            inventory_path = fixture_root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            entry = next(item for item in inventory["entries"] if item["caseId"] == definition.case_id)
            entry["preprocessingResultSha256"] = sha256_bytes(preprocessing_bytes)
            entry["cropSha256"] = sha256_bytes(crop_bytes)
            entry["reviewReceiptSha256"] = sha256_bytes(receipt_bytes)
            inventory_bytes = stable_json_bytes(inventory)
            inventory_path.write_bytes(inventory_bytes)

            report_path = fixture_root / REPORT_NAME
            report = self.read_json(report_path)
            report["sourceInventory"]["rawByteSha256"] = sha256_bytes(inventory_bytes)
            case_report = next(
                item for item in report["caseReports"] if item["caseId"] == definition.case_id
            )
            case_report["reviewReceipt"]["rawByteSha256"] = sha256_bytes(receipt_bytes)
            case_report["crop"]["rawByteSha256"] = sha256_bytes(crop_bytes)
            report_path.write_bytes(stable_json_bytes(report))

            with patch.multiple(
                "visual_machine_review",
                PREPROCESSING_ROOT=preprocessing_root,
                validate_preprocessing_fixtures=lambda: None,
            ):
                with self.assertRaisesRegex(ValueError, "reviewed authority"):
                    validate_canonical_fixtures(fixture_root)

    def test_rejected_review_is_reachable_and_requires_failed_check(self) -> None:
        _, definition, preprocessing_contract, crop = self.receipt_inputs(
            "math-function-graph"
        )
        rejected_definition = replace(
            definition,
            decision="reject_for_diagnostic_use",
            check_statuses=("fail", *definition.check_statuses[1:]),
        )
        preprocessing_path = review.PREPROCESSING_ROOT / definition.preprocessing_result_name
        rejected = build_receipt(
            rejected_definition,
            preprocessing_path.read_bytes(),
            self.read_json(preprocessing_path),
        )
        self.assertEqual(rejected["decision"], "reject_for_diagnostic_use")
        validate_receipt(rejected, rejected_definition, preprocessing_contract, crop)
        no_failed_check = replace(rejected_definition, check_statuses=definition.check_statuses)
        invalid_rejected = build_receipt(
            no_failed_check,
            preprocessing_path.read_bytes(),
            self.read_json(preprocessing_path),
        )
        with self.assertRaisesRegex(ValueError, "rejected review must contain a failed check"):
            validate_receipt(invalid_rejected, no_failed_check, preprocessing_contract, crop)

    def test_runtime_identity_drift_fails_closed(self) -> None:
        with patch(
            "visual_machine_review.interpreter_identity",
            return_value={"implementation": "PyPy", "version": "3.11.9"},
        ):
            with self.assertRaisesRegex(ValueError, "interpreter drifted"):
                validate_runtime_identity()
            with self.assertRaisesRegex(ValueError, "interpreter drifted"):
                compile_report()

    def test_inventory_receipt_hash_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            inventory_path = root / INVENTORY_NAME
            inventory = self.read_json(inventory_path)
            inventory["entries"][0]["reviewReceiptSha256"] = "0" * 64
            inventory_path.write_bytes(stable_json_bytes(inventory))
            with self.assertRaisesRegex(ValueError, "inventory binding drifted"):
                compile_report(root)

    def test_report_computed_field_drift_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report = self.read_json(report_path)
            report["totals"]["humanReviewedCount"] = 1
            report_path.write_bytes(stable_json_bytes(report))
            with self.assertRaisesRegex(ValueError, "does not deterministically replay"):
                validate_canonical_fixtures(root)

    def test_unlisted_nested_authority_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            nested = root / "extra"
            nested.mkdir()
            (nested / "unknown.json").write_bytes(b"{}\n")
            with self.assertRaisesRegex(ValueError, "nested or alias"):
                validate_canonical_fixtures(root)

    def test_hardlink_authority_alias_fails_closed(self) -> None:
        with self.fixture_copy() as root:
            report_path = root / REPORT_NAME
            report_path.unlink()
            os.link(root / INVENTORY_NAME, report_path)
            with self.assertRaisesRegex(ValueError, "unique identities"):
                validate_fixture_structure(root)

    def test_runtime_writes_external_report_and_rejects_repo_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-machine-review-output-") as temp:
            output = Path(temp) / "bundle"
            report_path = run_review(output)
            self.assertEqual(report_path.name, REPORT_NAME)
            self.assertEqual(len(list(output.iterdir())), 1)
            self.assertEqual(self.read_json(report_path), self.read_json(CANONICAL_ROOT / REPORT_NAME))
        rejected = REPO_ROOT / ".eval-work" / "visual-machine-review-output"
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run_review(rejected)

    def test_runtime_public_api_rejects_copied_fixture_root(self) -> None:
        with self.fixture_copy() as root:
            with tempfile.TemporaryDirectory(prefix="visual-machine-review-output-") as temp:
                with self.assertRaises(TypeError):
                    run_review(Path(temp) / "bundle", root)

    def test_runtime_rejects_midrun_receipt_and_inventory_drift(self) -> None:
        for authority_name in (
            INVENTORY_NAME,
            review.DEFINITIONS[0].receipt_name,
        ):
            with self.subTest(authority=authority_name), self.fixture_copy() as root:
                with tempfile.TemporaryDirectory(prefix="visual-machine-review-output-") as temp:
                    output = Path(temp) / "bundle"
                    target = root / authority_name

                    def write_then_mutate(path: Path, data: bytes) -> None:
                        atomic_write(path, data)
                        target.write_bytes(b"{}\n")

                    with patch("visual_machine_review.atomic_write", side_effect=write_then_mutate):
                        with self.assertRaisesRegex(ValueError, "bytes drifted"):
                            _run_review(output, root)

    def test_runtime_rejects_midrun_upstream_crop_drift(self) -> None:
        with self.fixture_copy() as root, self.preprocessing_copy() as preprocessing_root:
            crop_target = preprocessing_root / "senior-circuit-label.crop-2x.png"
            with patch.multiple(
                "visual_machine_review",
                PREPROCESSING_ROOT=preprocessing_root,
                validate_preprocessing_fixtures=lambda: None,
            ):
                with tempfile.TemporaryDirectory(prefix="visual-machine-review-output-") as temp:
                    output = Path(temp) / "bundle"

                    def write_then_mutate(path: Path, data: bytes) -> None:
                        atomic_write(path, data)
                        crop_target.write_bytes(b"not-a-png")

                    with patch("visual_machine_review.atomic_write", side_effect=write_then_mutate):
                        with self.assertRaisesRegex(ValueError, "bytes drifted"):
                            _run_review(output, root)

    def test_runtime_rejects_staged_report_tamper(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-machine-review-output-") as temp:
            output = Path(temp) / "bundle"

            def write_then_tamper(path: Path, data: bytes) -> None:
                atomic_write(path, data)
                path.write_bytes(b"{}\n")

            with patch("visual_machine_review.atomic_write", side_effect=write_then_tamper):
                with self.assertRaisesRegex(ValueError, "Staged machine review report bytes drifted"):
                    run_review(output)

    def test_materialization_and_report_replay_are_deterministic(self) -> None:
        with tempfile.TemporaryDirectory(prefix="visual-machine-review-materialize-") as temp:
            root = Path(temp) / "cases"
            self.assertEqual(materialize_fixtures(root), len(review.DEFINITIONS))
            for name in (
                INVENTORY_NAME,
                REPORT_NAME,
                *(definition.receipt_name for definition in review.DEFINITIONS),
            ):
                self.assertEqual((root / name).read_bytes(), (CANONICAL_ROOT / name).read_bytes())

    @staticmethod
    def canonical_receipt(case_id: str) -> dict:
        definition = review.DEFINITION_BY_ID[case_id]
        return VisualMachineReviewTests.read_json(CANONICAL_ROOT / definition.receipt_name)

    @staticmethod
    def receipt_inputs(case_id: str) -> tuple[dict, review.FixtureDefinition, dict, dict]:
        definition = review.DEFINITION_BY_ID[case_id]
        preprocessing_path = review.PREPROCESSING_ROOT / definition.preprocessing_result_name
        preprocessing_bytes = preprocessing_path.read_bytes()
        preprocessing = VisualMachineReviewTests.read_json(preprocessing_path)
        receipt = build_receipt(definition, preprocessing_bytes, preprocessing)
        preprocessing_contract = review.upstream_artifact(
            review.preprocessing_result_ref(definition),
            preprocessing_bytes,
            definition.case_id,
        )
        crop = review.crop_artifact(review.select_two_x_crop(preprocessing))
        return receipt, definition, preprocessing_contract, crop

    class fixture_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-machine-review-fixture-"))
            self.root = self.temp / "cases"
            shutil.copytree(CANONICAL_ROOT, self.root)
            return self.root

        def __exit__(self, exc_type, exc_value, traceback) -> None:
            shutil.rmtree(self.temp)

    class preprocessing_copy:
        def __enter__(self) -> Path:
            self.temp = Path(tempfile.mkdtemp(prefix="visual-machine-review-upstream-"))
            self.root = self.temp / "preprocessing"
            shutil.copytree(review.PREPROCESSING_ROOT, self.root)
            return self.root

        def __exit__(self, exc_type, exc_value, traceback) -> None:
            shutil.rmtree(self.temp)

    @staticmethod
    def read_json(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
