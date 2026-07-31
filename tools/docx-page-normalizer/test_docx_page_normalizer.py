from __future__ import annotations

import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import docx_page_normalizer as normalizer
from docx_page_normalizer import (
    CANONICAL_ROOT,
    PAGE_NAME,
    REQUEST_NAME,
    RESULT_NAME,
    SOURCE_NAME,
    canonical_artifacts,
    compile_request,
    run_admitted_request,
    sha256_bytes,
    stable_json_bytes,
    validate_fixtures,
)


class DocxPageNormalizerTests(unittest.TestCase):
    def setUp(self) -> None:
        validate_fixtures()

    def _mutated_package(self, root: Path, mutate) -> Path:
        entries: dict[str, bytes] = {}
        with zipfile.ZipFile(CANONICAL_ROOT / SOURCE_NAME) as archive:
            for info in archive.infolist():
                entries[info.filename] = archive.read(info)
        mutate(entries)
        source_path = root / SOURCE_NAME
        with zipfile.ZipFile(source_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(entries):
                archive.writestr(name, entries[name])
        request = json.loads((CANONICAL_ROOT / REQUEST_NAME).read_bytes())
        request["sourceDocument"]["rawByteSha256"] = sha256_bytes(source_path.read_bytes())
        (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
        return root / REQUEST_NAME

    def test_canonical_compile_emits_one_image_backed_normalized_page(self) -> None:
        result, page_bytes = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        page = result["pages"][0]["normalizedPage"]
        self.assertEqual(result["summary"], {"pageCount": 1, "embeddedImageCount": 1})
        self.assertEqual(page["sourceKind"], "docx")
        self.assertEqual(page["pageNumber"], 1)
        self.assertEqual(page["imagePath"], PAGE_NAME)
        self.assertEqual(page["pixelSize"], {"width": 560, "height": 360})
        self.assertEqual(page["dpi"], 96)
        self.assertEqual(page["regionRefs"], [])
        self.assertEqual(result["pages"][0]["rawByteSha256"], sha256_bytes(page_bytes))
        self.assertEqual(result["dispositions"]["layoutDisposition"], "not_reconstructed")
        self.assertTrue(result["dispositions"]["requiresHumanReview"])
        self.assertFalse(result["dispositions"]["eligible"])

    def test_body_text_multiple_drawing_and_external_relationship_fail_closed(self) -> None:
        mutations = (
            lambda entries: entries.__setitem__(
                "word/document.xml",
                entries["word/document.xml"].replace(b"</w:body>", b"<w:p><w:r><w:t>not admitted</w:t></w:r></w:p></w:body>"),
            ),
            lambda entries: entries.__setitem__(
                "word/document.xml",
                entries["word/document.xml"].replace(b"</w:body>", entries["word/document.xml"].split(b"<w:drawing>", 1)[1].split(b"</w:drawing>", 1)[0].join((b"<w:p><w:r><w:drawing>", b"</w:drawing></w:r></w:p></w:body>"))),
            ),
            lambda entries: entries.__setitem__(
                "word/_rels/document.xml.rels",
                entries["word/_rels/document.xml.rels"].replace(b"Target=\"media/", b"TargetMode=\"External\" Target=\"https://example.invalid/"),
            ),
        )
        expected = ("body text", "exactly one drawing", "internal image relationship")
        for mutate, message in zip(mutations, expected):
            with self.subTest(message=message), tempfile.TemporaryDirectory(prefix="docx-normalizer-package-") as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, message):
                    compile_request(self._mutated_package(root, mutate), root)

    def test_relationship_and_content_type_ambiguity_fail_closed(self) -> None:
        mutations = (
            lambda entries: entries.__setitem__(
                "word/_rels/document.xml.rels",
                entries["word/_rels/document.xml.rels"].replace(b'Id="rId8"', b'Id="rId9"'),
            ),
            lambda entries: entries.__setitem__(
                "word/_rels/document.xml.rels",
                entries["word/_rels/document.xml.rels"].replace(
                    b"</Relationships>",
                    b'<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
                ),
            ),
            lambda entries: entries.__setitem__(
                "word/document.xml",
                entries["word/document.xml"].replace(b'r:embed="rId9"', b'r:embed="rId9" r:link="rId9"'),
            ),
            lambda entries: entries.__setitem__(
                "[Content_Types].xml",
                entries["[Content_Types].xml"].replace(b'ContentType="image/png"', b'ContentType="image/jpeg"'),
            ),
        )
        expected = ("unique non-empty ids", "exactly one internal image relationship", "embedded relationship id", "image/png")
        for mutate, message in zip(mutations, expected):
            with self.subTest(message=message), tempfile.TemporaryDirectory(prefix="docx-normalizer-package-") as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, message):
                    compile_request(self._mutated_package(root, mutate), root)

    def test_additional_empty_body_paragraph_fails_closed(self) -> None:
        def mutate(entries: dict[str, bytes]) -> None:
            entries["word/document.xml"] = entries["word/document.xml"].replace(b"<w:sectPr", b"<w:p/><w:sectPr")

        with tempfile.TemporaryDirectory(prefix="docx-normalizer-package-") as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "only one image paragraph"):
                compile_request(self._mutated_package(root, mutate), root)

    def test_source_hash_and_result_boundary_escalation_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="docx-normalizer-hash-") as directory:
            root = Path(directory)
            request = json.loads((CANONICAL_ROOT / REQUEST_NAME).read_bytes())
            request["sourceDocument"]["rawByteSha256"] = "0" * 64
            (root / REQUEST_NAME).write_bytes(stable_json_bytes(request))
            shutil.copyfile(CANONICAL_ROOT / SOURCE_NAME, root / SOURCE_NAME)
            with self.assertRaisesRegex(ValueError, "source authority drifted"):
                compile_request(root / REQUEST_NAME, root)

        result, _ = compile_request(CANONICAL_ROOT / REQUEST_NAME)
        for key, value in (("layoutDisposition", "reconstructed"), ("requiresHumanReview", False), ("eligible", True)):
            candidate = json.loads(json.dumps(result))
            candidate["dispositions"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "result boundary"):
                normalizer.validate_result(candidate)

    def test_noncanonical_request_and_unsafe_outputs_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="docx-normalizer-copy-") as directory:
            root = Path(directory)
            shutil.copyfile(CANONICAL_ROOT / SOURCE_NAME, root / SOURCE_NAME)
            shutil.copyfile(CANONICAL_ROOT / REQUEST_NAME, root / REQUEST_NAME)
            with self.assertRaisesRegex(ValueError, "Only the canonical"):
                run_admitted_request(root / REQUEST_NAME, root / "out")
        with tempfile.TemporaryDirectory(prefix="docx-normalizer-existing-") as directory:
            existing = Path(directory) / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, existing)
        with self.assertRaisesRegex(ValueError, "outside repository authority"):
            run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, CANONICAL_ROOT.parent / ".out")

    def test_runtime_is_atomic_and_rejects_staged_or_input_drift(self) -> None:
        with tempfile.TemporaryDirectory(prefix="docx-normalizer-output-") as directory:
            output = Path(directory) / "out"
            paths = run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertEqual(paths, (output / RESULT_NAME, output / PAGE_NAME))

        original = normalizer.atomic_write

        def tamper(path: Path, data: bytes) -> None:
            original(path, data)
            if path.name == RESULT_NAME:
                path.write_bytes(b"{}\n")

        with tempfile.TemporaryDirectory(prefix="docx-normalizer-stage-") as directory:
            output = Path(directory) / "out"
            with patch.object(normalizer, "atomic_write", side_effect=tamper):
                with self.assertRaisesRegex(ValueError, "Staged DOCX normalization output drifted"):
                    run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
            self.assertFalse(output.exists())

        request_path = CANONICAL_ROOT / REQUEST_NAME
        request_bytes = request_path.read_bytes()

        def drift_after_stage(path: Path, data: bytes) -> None:
            original(path, data)
            request_path.write_bytes(b"{}\n")

        try:
            with tempfile.TemporaryDirectory(prefix="docx-normalizer-input-") as directory:
                output = Path(directory) / "out"
                with patch.object(normalizer, "atomic_write", side_effect=drift_after_stage):
                    with self.assertRaisesRegex(ValueError, "input drifted during execution"):
                        run_admitted_request(CANONICAL_ROOT / REQUEST_NAME, output)
                self.assertFalse(output.exists())
        finally:
            request_path.write_bytes(request_bytes)

    def test_runtime_rejects_external_junction_into_repository(self) -> None:
        with tempfile.TemporaryDirectory(prefix="docx-normalizer-junction-") as directory:
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
        self.assertEqual(sorted(expected), sorted(path.name for path in CANONICAL_ROOT.iterdir() if path.is_file() and path.name != SOURCE_NAME))
        for name, data in expected.items():
            self.assertEqual((CANONICAL_ROOT / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
