from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import sys
import tempfile
from typing import Any
import xml.etree.ElementTree as ET
import zipfile


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parents[1]
COMPONENT_ROOT = TOOL_ROOT.parent / "visual-component-semantics"
sys.path.insert(0, str(COMPONENT_ROOT))
from visual_component_semantics import (  # noqa: E402
    atomic_write, decode_png, pixel_sha256, sha256_bytes, stable_json_bytes,
)


CANONICAL_ROOT = REPO_ROOT / "eval" / "docx-page-normalization" / "cases"
SOURCE_NAME = "junior-image-backed-page.docx"
REQUEST_NAME = "junior-image-backed-page.docx-page-normalization-request.json"
RESULT_NAME = "junior-image-backed-page.docx-page-normalization-result.json"
PAGE_NAME = "page-001.png"
SOURCE_SHA256 = "910a46a2e1dcc4cd0934df78670790b5af2a232031909367fbe962d5955fa519"
PAGE_SHA256 = "1ae505c96799bd36f5b18bc02aea8ab2560890b3d27989c6282b94c2c5ca8dd8"
PAGE_PIXEL_SHA256 = "4cfa63971d77ae3c8777784f72c6f5fec995e12871d5dc48674c2db2689100bd"
GENERATED_AT = "2026-07-31T15:00:00Z"
MAX_ENTRY_COUNT = 128
MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"


def _json(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    data = path.read_bytes()
    try:
        value = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object.")
    return data, value


def build_request(source_bytes: bytes) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "kind": "docx-page-normalization-request",
        "requestId": "junior-image-backed-page-normalization",
        "subjectPack": "junior-physics-answer",
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {"level": "public", "containsPersonalData": False},
        "sourceDocument": {
            "artifactRef": SOURCE_NAME,
            "rawByteSha256": sha256_bytes(source_bytes),
            "sourceKind": "docx",
        },
        "adapterProfile": "image_backed_single_page_only",
        "expectedPageImage": {
            "rawByteSha256": PAGE_SHA256,
            "decodedRgbPixelSha256": PAGE_PIXEL_SHA256,
            "pixelSize": {"width": 560, "height": 360},
            "dpi": 96,
        },
        "packageLimits": {
            "maxEntryCount": MAX_ENTRY_COUNT,
            "maxUncompressedBytes": MAX_UNCOMPRESSED_BYTES,
        },
        "egressPolicy": {"allowCloud": False},
        "requestedAt": GENERATED_AT,
    }


def _read_package(source_bytes: bytes) -> tuple[dict[str, bytes], list[zipfile.ZipInfo]]:
    try:
        from io import BytesIO
        with zipfile.ZipFile(BytesIO(source_bytes)) as package:
            infos = package.infolist()
            names = [info.filename for info in infos]
            if len(infos) > MAX_ENTRY_COUNT:
                raise ValueError("DOCX package entry count exceeds the admitted limit.")
            if len(names) != len(set(names)):
                raise ValueError("DOCX package contains duplicate entries.")
            if sum(info.file_size for info in infos) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("DOCX package uncompressed size exceeds the admitted limit.")
            normalized_names: set[str] = set()
            for info in infos:
                path = PurePosixPath(info.filename)
                normalized_name = posixpath.normpath(info.filename)
                if (
                    info.flag_bits & 0x1
                    or info.is_dir()
                    or path.is_absolute()
                    or ".." in path.parts
                    or "\\" in info.filename
                    or normalized_name != info.filename
                    or normalized_name in normalized_names
                ):
                    raise ValueError("DOCX package contains an unsafe entry.")
                normalized_names.add(normalized_name)
            bad = package.testzip()
            if bad is not None:
                raise ValueError(f"DOCX package CRC failed for {bad}.")
            return {name: package.read(name) for name in names}, infos
    except zipfile.BadZipFile as error:
        raise ValueError("Source DOCX is not a valid OPC ZIP package.") from error


def _xml(data: bytes, label: str) -> ET.Element:
    try:
        return ET.fromstring(data)
    except ET.ParseError as error:
        raise ValueError(f"{label} is not valid XML.") from error


def inspect_image_backed_docx(source_bytes: bytes) -> tuple[dict[str, Any], bytes]:
    entries, infos = _read_package(source_bytes)
    required = {"[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels"}
    if not required.issubset(entries):
        raise ValueError("DOCX package is missing required OPC parts.")
    content_types = _xml(entries["[Content_Types].xml"], "[Content_Types].xml")
    document = _xml(entries["word/document.xml"], "word/document.xml")
    relationships = _xml(entries["word/_rels/document.xml.rels"], "document relationships")
    if content_types.tag != f"{{{CT}}}Types" or document.tag != f"{{{W}}}document" or relationships.tag != f"{{{PR}}}Relationships":
        raise ValueError("DOCX package contains an invalid OPC or WordprocessingML root.")

    bodies = document.findall(f"{{{W}}}body")
    if len(bodies) != 1:
        raise ValueError("Image-backed DOCX must contain exactly one document body.")

    text = "".join(node.text or "" for node in document.findall(f".//{{{W}}}t"))
    if text.strip():
        raise ValueError("Image-backed DOCX body text is not admitted.")
    if document.findall(f".//{{{W}}}tbl") or document.findall(f".//{{{M}}}oMath") or document.findall(f".//{{{M}}}oMathPara"):
        raise ValueError("Image-backed DOCX tables or OMML are not admitted.")
    page_breaks = [node for node in document.findall(f".//{{{W}}}br") if node.get(f"{{{W}}}type") == "page"]
    if page_breaks or len(document.findall(f".//{{{W}}}sectPr")) != 1:
        raise ValueError("Image-backed DOCX must contain exactly one section and no explicit page breaks.")

    drawings = document.findall(f".//{{{W}}}drawing")
    blips = document.findall(f".//{{{A}}}blip")
    inline = document.findall(f".//{{{WP}}}inline")
    if len(drawings) != 1 or len(blips) != 1 or len(inline) != 1:
        raise ValueError("Image-backed DOCX must contain exactly one drawing and one inline image.")
    body_children = list(bodies[0])
    if [child.tag for child in body_children] != [f"{{{W}}}p", f"{{{W}}}sectPr"]:
        raise ValueError("Image-backed DOCX body must contain only one image paragraph and one section declaration.")
    relationship_id = blips[0].get(f"{{{R}}}embed")
    if not relationship_id or blips[0].get(f"{{{R}}}link") is not None:
        raise ValueError("DOCX image drawing is missing an embedded relationship id.")

    relationship_nodes = relationships.findall(f"{{{PR}}}Relationship")
    relationship_ids = [node.get("Id") for node in relationship_nodes]
    if any(not value for value in relationship_ids) or len(relationship_ids) != len(set(relationship_ids)):
        raise ValueError("DOCX relationships must use unique non-empty ids.")
    rel_by_id = {node.get("Id"): node for node in relationship_nodes}
    image_rel = rel_by_id.get(relationship_id)
    image_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    image_relationships = [node for node in relationship_nodes if node.get("Type") == image_type]
    if (
        image_rel is None
        or image_rel.get("Type") != image_type
        or image_rel.get("TargetMode") is not None
        or len(image_relationships) != 1
    ):
        raise ValueError("DOCX must use exactly one internal image relationship.")
    target = image_rel.get("Target", "")
    part_name = posixpath.normpath(posixpath.join("word", target))
    if (
        part_name.startswith("../")
        or not part_name.startswith("word/media/")
        or part_name not in entries
        or target != posixpath.relpath(part_name, "word")
    ):
        raise ValueError("DOCX image relationship target escaped or is missing.")

    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    for node in content_types:
        if node.tag == f"{{{CT}}}Default":
            extension = node.get("Extension", "").lower()
            if not extension or extension in defaults:
                raise ValueError("DOCX content types contain a duplicate or empty extension.")
            defaults[extension] = node.get("ContentType", "")
        elif node.tag == f"{{{CT}}}Override":
            part = node.get("PartName", "")
            if not part.startswith("/") or part in overrides:
                raise ValueError("DOCX content types contain a duplicate or invalid part override.")
            overrides[part] = node.get("ContentType", "")
        else:
            raise ValueError("DOCX content types contain an unsupported declaration.")
    image_content_type = overrides.get(f"/{part_name}", defaults.get(PurePosixPath(part_name).suffix.lstrip(".").lower()))
    if image_content_type != "image/png":
        raise ValueError("DOCX embedded page image must be declared as image/png.")
    image_bytes = entries[part_name]
    if not part_name.lower().endswith(".png") or sha256_bytes(image_bytes) != PAGE_SHA256:
        raise ValueError("DOCX embedded page image authority drifted.")
    image = decode_png(image_bytes, part_name)
    if (image.shape[1], image.shape[0]) != (560, 360) or pixel_sha256(image) != PAGE_PIXEL_SHA256:
        raise ValueError("DOCX embedded page pixel authority drifted.")

    extent = inline[0].find(f"{{{WP}}}extent")
    if extent is None:
        raise ValueError("DOCX inline image extent is missing.")
    package_info = {
        "entryCount": len(infos),
        "uncompressedBytes": sum(info.file_size for info in infos),
        "documentPart": "word/document.xml",
        "relationshipId": relationship_id,
        "imagePart": part_name,
        "imageExtentEmu": {"cx": int(extent.get("cx", "0")), "cy": int(extent.get("cy", "0"))},
    }
    return package_info, image_bytes


def build_result(
    request_bytes: bytes,
    request: dict[str, Any],
    source_bytes: bytes,
) -> tuple[dict[str, Any], bytes]:
    package_info, page_bytes = inspect_image_backed_docx(source_bytes)
    result = {
        "schemaVersion": "1.0",
        "kind": "docx-page-normalization-result",
        "requestId": request["requestId"],
        "subjectPack": request["subjectPack"],
        "fixtureKind": request["fixtureKind"],
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "sourceDocument": request["sourceDocument"],
        "adapterProfile": request["adapterProfile"],
        "packageInspection": package_info,
        "pages": [
            {
                "pageRef": "docx-page-001",
                "sourceImagePart": package_info["imagePart"],
                "rawByteSha256": sha256_bytes(page_bytes),
                "decodedRgbPixelSha256": PAGE_PIXEL_SHA256,
                "normalizedPage": {
                    "schemaVersion": "1.0",
                    "kind": "normalized-page",
                    "pageId": "junior-image-backed-page-1",
                    "sourceDocument": SOURCE_NAME,
                    "sourceKind": "docx",
                    "pageNumber": 1,
                    "imagePath": PAGE_NAME,
                    "pixelSize": {"width": 560, "height": 360},
                    "dpi": 96,
                    "renderScales": [1],
                    "preprocessing": {
                        "orientationDegrees": 0,
                        "deskewApplied": False,
                        "denoiseApplied": False,
                        "trimApplied": False,
                        "perspectiveCorrectionApplied": False,
                    },
                    "regionRefs": [],
                    "ocrRefs": [],
                    "layoutRefs": [],
                    "qualityFlags": [],
                    "generatedAt": GENERATED_AT,
                },
            }
        ],
        "summary": {"pageCount": 1, "embeddedImageCount": 1},
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "python-stdlib-opc-ooxml-image-page-adapter",
            "engineVersion": "1.0.0",
            "liveProvider": False,
            "cloudEgress": False,
        },
        "dispositions": {
            "adapterDisposition": "image_backed_single_page_only",
            "layoutDisposition": "not_reconstructed",
            "bodyTextDisposition": "not_extracted",
            "tableDisposition": "not_supported",
            "ommlDisposition": "not_supported",
            "paginationDisposition": "single_page_declared_shape_only",
            "regionDisposition": "not_generated",
            "ocrDisposition": "not_attempted",
            "trackDisposition": "not_integrated",
            "answerDisposition": "not_generated",
            "requiresHumanReview": True,
            "acceptanceDisposition": "not_accepted",
            "controlsDisposition": "not_verified",
            "eligible": False,
            "optimizationCandidateRefs": [],
        },
        "generatedAt": GENERATED_AT,
    }
    validate_result(result)
    return result, page_bytes


def validate_result(result: dict[str, Any]) -> None:
    fixed = {
        "adapterDisposition": "image_backed_single_page_only",
        "layoutDisposition": "not_reconstructed",
        "bodyTextDisposition": "not_extracted",
        "tableDisposition": "not_supported",
        "ommlDisposition": "not_supported",
        "paginationDisposition": "single_page_declared_shape_only",
        "regionDisposition": "not_generated",
        "ocrDisposition": "not_attempted",
        "trackDisposition": "not_integrated",
        "answerDisposition": "not_generated",
        "requiresHumanReview": True,
        "acceptanceDisposition": "not_accepted",
        "controlsDisposition": "not_verified",
        "eligible": False,
        "optimizationCandidateRefs": [],
    }
    pages = result.get("pages")
    if result.get("dispositions") != fixed or not isinstance(pages, list) or len(pages) != 1:
        raise ValueError("DOCX page-normalization result boundary drifted.")
    page = pages[0].get("normalizedPage", {})
    if page.get("sourceKind") != "docx" or page.get("regionRefs") != [] or page.get("imagePath") != PAGE_NAME:
        raise ValueError("DOCX page-normalization result boundary drifted.")


def compile_request(request_path: Path, fixture_root: Path = CANONICAL_ROOT) -> tuple[dict[str, Any], bytes]:
    fixture_root = fixture_root.resolve(strict=True)
    request_path = request_path.resolve(strict=True)
    if request_path.parent != fixture_root or request_path.name != REQUEST_NAME:
        raise ValueError("Only the canonical DOCX page-normalization request identity is admitted.")
    request_bytes, request = _json(request_path, "DOCX page-normalization request")
    source_path = (fixture_root / request.get("sourceDocument", {}).get("artifactRef", "")).resolve(strict=True)
    if source_path.parent != fixture_root or source_path.name != SOURCE_NAME:
        raise ValueError("DOCX source escaped its fixture root.")
    source_bytes = source_path.read_bytes()
    expected = build_request(source_bytes)
    if request.get("sourceDocument") != expected["sourceDocument"]:
        raise ValueError("DOCX page-normalization source authority drifted.")
    if request != expected:
        raise ValueError("DOCX page-normalization request authority drifted.")
    return build_result(request_bytes, request, source_bytes)


def canonical_artifacts() -> dict[str, bytes]:
    source_bytes = (CANONICAL_ROOT / SOURCE_NAME).read_bytes()
    if sha256_bytes(source_bytes) != SOURCE_SHA256:
        raise ValueError("Canonical DOCX source bytes drifted.")
    request_bytes = stable_json_bytes(build_request(source_bytes))
    with tempfile.TemporaryDirectory(prefix="docx-page-normalizer-") as directory:
        root = Path(directory)
        (root / SOURCE_NAME).write_bytes(source_bytes)
        (root / REQUEST_NAME).write_bytes(request_bytes)
        result, page_bytes = compile_request(root / REQUEST_NAME, root)
    return {REQUEST_NAME: request_bytes, RESULT_NAME: stable_json_bytes(result), PAGE_NAME: page_bytes}


def materialize_fixtures() -> int:
    artifacts = canonical_artifacts()
    for name, data in artifacts.items():
        atomic_write(CANONICAL_ROOT / name, data)
    return validate_fixtures()


def validate_fixtures() -> int:
    expected = canonical_artifacts()
    actual = sorted(path.name for path in CANONICAL_ROOT.iterdir() if path.is_file() and path.name != SOURCE_NAME)
    if actual != sorted(expected):
        raise ValueError("Canonical DOCX page-normalization fixture inventory drifted.")
    for name, data in expected.items():
        if (CANONICAL_ROOT / name).read_bytes() != data:
            raise ValueError(f"{name} is not byte-exact.")
    return 1


def run_admitted_request(request_path: Path, output_dir: Path) -> tuple[Path, Path]:
    validate_fixtures()
    request_path = request_path.resolve(strict=True)
    if request_path != (CANONICAL_ROOT / REQUEST_NAME).resolve(strict=True):
        raise ValueError("Only the canonical DOCX page-normalization request is admitted.")
    source_path = (CANONICAL_ROOT / SOURCE_NAME).resolve(strict=True)
    snapshots = {path: path.read_bytes() for path in (request_path, source_path)}
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    if not output_dir.parent.is_dir():
        raise ValueError("Runtime output parent must exist.")
    try:
        output_dir.relative_to(REPO_ROOT)
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    try:
        output_dir.parent.resolve(strict=True).relative_to(REPO_ROOT.resolve(strict=True))
        raise ValueError("Runtime output must be outside repository authority.")
    except ValueError as error:
        if str(error).startswith("Runtime output"):
            raise
    result, page_bytes = compile_request(request_path)
    result_bytes = stable_json_bytes(result)
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    try:
        atomic_write(stage / RESULT_NAME, result_bytes)
        atomic_write(stage / PAGE_NAME, page_bytes)
        if (stage / RESULT_NAME).read_bytes() != result_bytes or (stage / PAGE_NAME).read_bytes() != page_bytes:
            raise ValueError("Staged DOCX normalization output drifted before promotion.")
        if any(path.read_bytes() != data for path, data in snapshots.items()):
            raise ValueError("DOCX normalization input drifted during execution.")
        os.replace(stage, output_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output_dir / RESULT_NAME, output_dir / PAGE_NAME


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--request", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.materialize_fixtures:
        print(f"Materialized and validated {materialize_fixtures()} image-backed DOCX fixture.")
        return 0
    if args.validate_fixtures:
        print(f"Validated {validate_fixtures()} image-backed DOCX fixture.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path, page_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path), "pagePath": str(page_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
