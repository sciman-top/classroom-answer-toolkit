from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version


TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent.resolve()
CANONICAL_ROOT = (REPO_ROOT / "eval" / "visual-preprocessing" / "cases").resolve()
INVENTORY_NAME = "visual-preprocessing-case-inventory.json"
SUBJECT_PACKS = (
    "math-answer",
    "junior-physics-answer",
    "senior-physics-answer",
)


@dataclass(frozen=True)
class FixtureDefinition:
    case_id: str
    subject_pack: str
    width: int
    height: int
    bbox: tuple[int, int, int, int]
    requested_at: str
    fixture_type: str

    @property
    def source_name(self) -> str:
        return f"{self.case_id}.source.png"

    @property
    def request_name(self) -> str:
        return f"{self.case_id}.visual-preprocessing-request.json"

    @property
    def result_name(self) -> str:
        return f"{self.case_id}.visual-preprocessing-result.json"

    def crop_name(self, scale: int) -> str:
        return f"{self.case_id}.crop-{scale}x.png"


@dataclass(frozen=True)
class SyntheticTextDeclaration:
    text: str
    position: tuple[int, int]
    fill: str | tuple[int, int, int]
    render_mode: str = "default_text"
    source_bounds: tuple[int, int, int, int] | None = None


DEFINITIONS = (
    FixtureDefinition(
        "math-function-graph",
        "math-answer",
        320,
        240,
        (45, 25, 230, 185),
        "2026-07-27T01:00:00Z",
        "function_graph",
    ),
    FixtureDefinition(
        "junior-instrument-scale",
        "junior-physics-answer",
        360,
        180,
        (35, 35, 290, 105),
        "2026-07-27T01:01:00Z",
        "instrument_scale",
    ),
    FixtureDefinition(
        "senior-circuit-label",
        "senior-physics-answer",
        360,
        220,
        (40, 40, 280, 140),
        "2026-07-27T01:02:00Z",
        "circuit_label",
    ),
    FixtureDefinition(
        "junior-readable-measurement",
        "junior-physics-answer",
        80,
        48,
        (0, 0, 80, 48),
        "2026-07-29T01:03:00Z",
        "readable_measurement",
    ),
)
DEFINITION_BY_ID = {definition.case_id: definition for definition in DEFINITIONS}
TEXT_DECLARATIONS = {
    "math-function-graph": (
        SyntheticTextDeclaration("x", (278, 168), "black"),
        SyntheticTextDeclaration("y", (116, 22), "black"),
    ),
    "junior-instrument-scale": (
        SyntheticTextDeclaration("synthetic scale", (50, 25), (35, 70, 120)),
    ),
    "senior-circuit-label": (
        SyntheticTextDeclaration("A", (116, 96), (25, 85, 180)),
        SyntheticTextDeclaration("R", (223, 96), (190, 35, 45)),
        SyntheticTextDeclaration("synthetic circuit", (50, 35), (35, 70, 120)),
    ),
    "junior-readable-measurement": (
        SyntheticTextDeclaration(
            "12",
            (34, 16),
            "black",
            "connected_bitmap",
            (37, 20, 43, 28),
        ),
    ),
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def decoded_pixel_sha256(image: Image.Image) -> str:
    rgb = image.convert("RGB")
    return sha256_bytes(rgb.tobytes())


def encode_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(
        buffer,
        format="PNG",
        optimize=False,
        compress_level=9,
    )
    return buffer.getvalue()


def decode_png(data: bytes, label: str) -> Image.Image:
    try:
        with Image.open(io.BytesIO(data)) as decoded:
            if decoded.format != "PNG":
                raise ValueError(f"{label} must be a PNG image.")
            return decoded.convert("RGB")
    except (OSError, ValueError) as error:
        raise ValueError(f"{label} could not be decoded as PNG: {error}") from error


def render_synthetic_source(definition: FixtureDefinition) -> Image.Image:
    image = Image.new("RGB", (definition.width, definition.height), "white")
    draw = ImageDraw.Draw(image)
    if definition.fixture_type == "function_graph":
        origin = (110, 175)
        draw.line((55, origin[1], 275, origin[1]), fill="black", width=3)
        draw.line((origin[0], 30, origin[0], 210), fill="black", width=3)
        for x in range(70, 271, 40):
            draw.line((x, 170, x, 180), fill="black", width=2)
        for y in range(55, 176, 30):
            draw.line((105, y, 115, y), fill="black", width=2)
        points = [(60, 190), (95, 165), (130, 140), (165, 115), (200, 90), (235, 65), (270, 40)]
        draw.line(points, fill=(25, 85, 180), width=4)
    elif definition.fixture_type == "instrument_scale":
        draw.rectangle((45, 50, 315, 125), outline="black", width=3)
        for index in range(21):
            x = 55 + index * 12
            tick = 28 if index % 5 == 0 else 16
            draw.line((x, 112, x, 112 - tick), fill="black", width=2)
        draw.line((187, 122, 187, 65), fill=(190, 35, 45), width=4)
    elif definition.fixture_type == "circuit_label":
        draw.line((55, 105, 100, 105), fill="black", width=3)
        draw.rectangle((100, 82, 145, 128), outline="black", width=3)
        draw.line((145, 105, 205, 105), fill="black", width=3)
        draw.ellipse((205, 80, 255, 130), outline="black", width=3)
        draw.line((255, 105, 305, 105), fill="black", width=3)
        draw.line((55, 105, 55, 155, 305, 155, 305, 105), fill="black", width=3)
    elif definition.fixture_type == "readable_measurement":
        draw.line((10, 38, 70, 38), fill="black", width=1)
    for declaration in TEXT_DECLARATIONS[definition.case_id]:
        if declaration.render_mode == "default_text":
            draw.text(declaration.position, declaration.text, fill=declaration.fill)
        elif declaration.render_mode == "connected_bitmap":
            font = ImageFont.load_default()
            bounds = font.getbbox(declaration.text)
            glyph = Image.new(
                "L",
                (bounds[2] - bounds[0] + 8, bounds[3] - bounds[1] + 8),
                255,
            )
            ImageDraw.Draw(glyph).text(
                (4 - bounds[0], 4 - bounds[1]),
                declaration.text,
                font=font,
                fill=0,
            )
            foreground = 255 - np.asarray(glyph, dtype=np.uint8)
            connected = cv2.dilate(
                foreground,
                np.ones((1, 2), dtype=np.uint8),
                iterations=1,
            )
            patch = Image.fromarray(255 - connected, mode="L").resize(
                (11, glyph.height),
                Image.Resampling.NEAREST,
            )
            image.paste(Image.merge("RGB", (patch, patch, patch)), declaration.position)
        else:
            raise ValueError(f"Unsupported synthetic text render mode: {declaration.render_mode}")
    return image


def build_request(definition: FixtureDefinition, source_bytes: bytes) -> dict[str, Any]:
    source = decode_png(source_bytes, definition.source_name)
    x, y, width, height = definition.bbox
    return {
        "schemaVersion": "1.0",
        "kind": "visual-preprocessing-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "dataClassification": {
            "level": "public",
            "notes": "Fully synthetic public fixture; no teacher, student, or exam data.",
        },
        "source": {
            "artifactRef": definition.source_name,
            "mediaType": "image/png",
            "rawByteSha256": sha256_bytes(source_bytes),
            "decodedRgbPixelSha256": decoded_pixel_sha256(source),
            "pixelSize": {"width": source.width, "height": source.height},
        },
        "bbox": {
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "coordinateSpace": "page_pixel",
        },
        "scales": [1, 2],
        "egressPolicy": {"allowCloud": False},
        "requestedAt": definition.requested_at,
    }


def require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise ValueError(f"{label} fields differ: expected {sorted(expected)}, got {sorted(actual)}.")


def validate_request(request: dict[str, Any], definition: FixtureDefinition) -> None:
    if not isinstance(request, dict):
        raise ValueError("VisualPreprocessingRequest must be an object.")
    require_exact_keys(
        request,
        {
            "schemaVersion", "kind", "requestId", "subjectPack", "fixtureKind",
            "dataClassification", "source", "bbox", "scales", "egressPolicy", "requestedAt",
        },
        "VisualPreprocessingRequest",
    )
    expected_scalars = {
        "schemaVersion": "1.0",
        "kind": "visual-preprocessing-request",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "requestedAt": definition.requested_at,
    }
    for field, expected in expected_scalars.items():
        if request.get(field) != expected:
            raise ValueError(f"VisualPreprocessingRequest {field} is not admitted.")
    if request.get("scales") != [1, 2]:
        raise ValueError("VisualPreprocessingRequest scales must be exactly [1, 2].")
    if request.get("egressPolicy") != {"allowCloud": False}:
        raise ValueError("VisualPreprocessingRequest cloud egress must remain disabled.")
    classification = request.get("dataClassification")
    if not isinstance(classification, dict):
        raise ValueError("VisualPreprocessingRequest dataClassification is required.")
    require_exact_keys(classification, {"level", "notes"}, "dataClassification")
    if classification.get("level") != "public" or "Fully synthetic" not in classification.get("notes", ""):
        raise ValueError("VisualPreprocessingRequest must be explicitly public and fully synthetic.")
    source = request.get("source")
    if not isinstance(source, dict):
        raise ValueError("VisualPreprocessingRequest source is required.")
    require_exact_keys(
        source,
        {"artifactRef", "mediaType", "rawByteSha256", "decodedRgbPixelSha256", "pixelSize"},
        "source",
    )
    if source.get("artifactRef") != definition.source_name or source.get("mediaType") != "image/png":
        raise ValueError("VisualPreprocessingRequest source identity is not admitted.")
    for field in ("rawByteSha256", "decodedRgbPixelSha256"):
        if not is_sha256(source.get(field)):
            raise ValueError(f"VisualPreprocessingRequest source {field} is invalid.")
    if source.get("pixelSize") != {"width": definition.width, "height": definition.height}:
        raise ValueError("VisualPreprocessingRequest source pixelSize drifted.")
    bbox = request.get("bbox")
    if not isinstance(bbox, dict):
        raise ValueError("VisualPreprocessingRequest bbox is required.")
    require_exact_keys(bbox, {"x", "y", "width", "height", "coordinateSpace"}, "bbox")
    if any(type(bbox.get(field)) is not int for field in ("x", "y", "width", "height")):
        raise ValueError("VisualPreprocessingRequest bbox values must be integers.")
    if bbox.get("coordinateSpace") != "page_pixel":
        raise ValueError("VisualPreprocessingRequest bbox must use page_pixel coordinates.")
    x, y, width, height = (bbox[field] for field in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > definition.width or y + height > definition.height:
        raise ValueError("VisualPreprocessingRequest bbox is outside source pixel bounds.")
    if (x, y, width, height) != definition.bbox:
        raise ValueError("VisualPreprocessingRequest bbox does not match canonical fixture authority.")


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def resolve_bound_file(root: Path, reference: str, label: str) -> Path:
    if not isinstance(reference, str) or not reference or Path(reference).is_absolute():
        raise ValueError(f"{label} must be a non-empty relative path.")
    candidate = root / reference
    if candidate.is_symlink() or not candidate.is_file():
        raise ValueError(f"{label} must reference a regular non-symlink file.")
    resolved = candidate.resolve(strict=True)
    assert_within(resolved, root, label)
    return resolved


def assert_within(path: Path, root: Path, label: str) -> None:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise ValueError(f"{label} escapes its allowed root.") from error


def resolve_canonical_input(path: Path, root: Path, label: str) -> Path:
    absolute = Path(os.path.abspath(os.fspath(path)))
    resolved = absolute.resolve(strict=True)
    if os.path.normcase(str(absolute)) != os.path.normcase(str(resolved)):
        raise ValueError(f"{label} must use its canonical path, not a symlink or junction alias.")
    assert_within(resolved, root, label)
    return resolved


def read_json_bytes(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    data = path.read_bytes()
    try:
        value = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid UTF-8 JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object.")
    return data, value


def compile_request(request_path: Path, fixture_root: Path) -> tuple[dict[str, Any], dict[str, bytes]]:
    fixture_root = fixture_root.resolve()
    request_path = request_path.resolve(strict=True)
    assert_within(request_path, fixture_root, "request")
    request_bytes, request = read_json_bytes(request_path, "VisualPreprocessingRequest")
    definition = DEFINITION_BY_ID.get(request.get("requestId"))
    if definition is None or request_path.name != definition.request_name:
        raise ValueError("VisualPreprocessingRequest fixture identity is not admitted.")
    validate_request(request, definition)
    source_path = resolve_bound_file(fixture_root, request["source"]["artifactRef"], "source artifact")
    source_bytes = source_path.read_bytes()
    source_image = decode_png(source_bytes, "source artifact")
    source_contract = request["source"]
    if sha256_bytes(source_bytes) != source_contract["rawByteSha256"]:
        raise ValueError("VisualPreprocessingRequest source raw-byte SHA-256 drifted.")
    if decoded_pixel_sha256(source_image) != source_contract["decodedRgbPixelSha256"]:
        raise ValueError("VisualPreprocessingRequest source decoded RGB pixel SHA-256 drifted.")
    if source_image.size != (definition.width, definition.height):
        raise ValueError("VisualPreprocessingRequest decoded source dimensions drifted.")

    x, y, width, height = definition.bbox
    source_array = np.asarray(source_image, dtype=np.uint8)
    crop_1x_array = source_array[y:y + height, x:x + width].copy()
    crop_2x_array = cv2.resize(
        crop_1x_array,
        (width * 2, height * 2),
        interpolation=cv2.INTER_NEAREST,
    )
    crop_images = {
        1: Image.fromarray(crop_1x_array, mode="RGB"),
        2: Image.fromarray(crop_2x_array, mode="RGB"),
    }
    output_bytes = {
        definition.crop_name(scale): encode_png(crop_images[scale])
        for scale in (1, 2)
    }
    region_id = f"{definition.case_id}-crop"
    page_id = f"{definition.case_id}-page-1"
    crop_artifacts = []
    for scale in (1, 2):
        name = definition.crop_name(scale)
        image = crop_images[scale]
        crop_artifacts.append({
            "scale": scale,
            "artifactRef": name,
            "rawByteSha256": sha256_bytes(output_bytes[name]),
            "decodedRgbPixelSha256": decoded_pixel_sha256(image),
            "pixelSize": {"width": image.width, "height": image.height},
            "interpolation": "pixel_preserving" if scale == 1 else "nearest",
        })
    result = {
        "schemaVersion": "1.0",
        "kind": "visual-preprocessing-result",
        "requestId": definition.case_id,
        "subjectPack": definition.subject_pack,
        "fixtureKind": "synthetic_fixture",
        "sourceRequestSha256": sha256_bytes(request_bytes),
        "source": {
            "artifactRef": definition.source_name,
            "rawByteSha256": source_contract["rawByteSha256"],
            "decodedRgbPixelSha256": source_contract["decodedRgbPixelSha256"],
            "pixelSize": source_contract["pixelSize"],
        },
        "normalizedPage": {
            "schemaVersion": "1.0",
            "kind": "normalized-page",
            "pageId": page_id,
            "sourceDocument": definition.source_name,
            "sourceKind": "image",
            "pageNumber": 1,
            "imagePath": definition.source_name,
            "pixelSize": source_contract["pixelSize"],
            "dpi": 96,
            "renderScales": [1, 2],
            "preprocessing": {
                "orientationDegrees": 0,
                "deskewApplied": False,
                "denoiseApplied": False,
                "trimApplied": False,
                "perspectiveCorrectionApplied": False,
            },
            "regionRefs": [region_id],
            "generatedAt": definition.requested_at,
        },
        "visualRegion": {
            "schemaVersion": "1.0",
            "kind": "visual-region",
            "regionId": region_id,
            "pageId": page_id,
            "regionType": "crop",
            "bbox": request["bbox"],
            "cropRef": definition.crop_name(1),
            "imagePath": definition.crop_name(1),
            "pixelSize": {"width": width, "height": height},
            "generatedAt": definition.requested_at,
        },
        "cropArtifacts": crop_artifacts,
        "engineProvenance": {
            "engineKind": "local_runtime",
            "engineId": "deterministic-local-visual-preprocessor",
            "engineVersion": "1.0.0",
            "components": [
                {"name": "opencv", "version": cv2.__version__},
                {"name": "pillow", "version": pillow_version},
            ],
            "liveProvider": False,
            "cloudEgress": False,
        },
        "generatedAt": definition.requested_at,
    }
    return result, output_bytes


def file_identity(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino


def validate_canonical_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root = fixture_root.resolve(strict=True)
    inventory_path = resolve_bound_file(fixture_root, INVENTORY_NAME, "visual preprocessing inventory")
    inventory_bytes, inventory = read_json_bytes(inventory_path, "VisualPreprocessingCaseInventory")
    _ = inventory_bytes
    require_exact_keys(
        inventory,
        {"schemaVersion", "kind", "fixtureSetId", "fixtureKind", "entries"},
        "VisualPreprocessingCaseInventory",
    )
    if (
        inventory.get("schemaVersion") != "1.0"
        or inventory.get("kind") != "visual-preprocessing-case-inventory"
        or inventory.get("fixtureSetId") != "synthetic-visual-preprocessing-v1"
        or inventory.get("fixtureKind") != "synthetic_fixture"
    ):
        raise ValueError("VisualPreprocessingCaseInventory metadata is not admitted.")
    entries = inventory.get("entries")
    if not isinstance(entries, list) or len(entries) != len(DEFINITIONS):
        raise ValueError("VisualPreprocessingCaseInventory coverage drifted.")
    if [entry.get("subjectPack") for entry in entries] != [
        definition.subject_pack for definition in DEFINITIONS
    ]:
        raise ValueError("VisualPreprocessingCaseInventory subject packs or order drifted.")

    referenced_paths = {inventory_path}
    referenced_identities = {file_identity(inventory_path)}
    for entry, definition in zip(entries, DEFINITIONS, strict=True):
        if not isinstance(entry, dict):
            raise ValueError("VisualPreprocessingCaseInventory entry must be an object.")
        require_exact_keys(
            entry,
            {
                "caseId", "subjectPack", "sourceRef", "sourceSha256",
                "sourceDecodedRgbPixelSha256", "requestRef", "requestSha256",
                "expectedResultRef", "expectedResultSha256",
            },
            "VisualPreprocessingCaseInventory entry",
        )
        if entry.get("caseId") != definition.case_id or entry.get("subjectPack") != definition.subject_pack:
            raise ValueError("VisualPreprocessingCaseInventory entry identity drifted.")
        expected_refs = {
            "sourceRef": definition.source_name,
            "requestRef": definition.request_name,
            "expectedResultRef": definition.result_name,
        }
        for field, expected in expected_refs.items():
            if entry.get(field) != expected:
                raise ValueError(f"VisualPreprocessingCaseInventory {field} identity drifted.")
        source_path = bind_file(
            fixture_root, entry["sourceRef"], entry["sourceSha256"],
            f"{definition.case_id} source", referenced_paths, referenced_identities,
        )
        source_image = decode_png(source_path.read_bytes(), f"{definition.case_id} source")
        if decoded_pixel_sha256(source_image) != entry["sourceDecodedRgbPixelSha256"]:
            raise ValueError(f"{definition.case_id} source decoded RGB pixel SHA-256 drifted.")
        request_path = bind_file(
            fixture_root, entry["requestRef"], entry["requestSha256"],
            f"{definition.case_id} request", referenced_paths, referenced_identities,
        )
        request_bytes, request = read_json_bytes(request_path, f"{definition.case_id} request")
        validate_request(request, definition)
        if request["source"]["rawByteSha256"] != entry["sourceSha256"]:
            raise ValueError(f"{definition.case_id} request source raw-byte hash drifted from inventory.")
        if request["source"]["decodedRgbPixelSha256"] != entry["sourceDecodedRgbPixelSha256"]:
            raise ValueError(f"{definition.case_id} request source pixel hash drifted from inventory.")
        expected_result_path = bind_file(
            fixture_root, entry["expectedResultRef"], entry["expectedResultSha256"],
            f"{definition.case_id} result", referenced_paths, referenced_identities,
        )
        _, expected_result = read_json_bytes(expected_result_path, f"{definition.case_id} result")
        compiled_result, crop_bytes = compile_request(request_path, fixture_root)
        if expected_result != compiled_result:
            raise ValueError(f"{definition.case_id} result computed fields drifted from deterministic runtime.")
        if expected_result["sourceRequestSha256"] != sha256_bytes(request_bytes):
            raise ValueError(f"{definition.case_id} result request hash drifted.")
        for crop in expected_result["cropArtifacts"]:
            crop_path = bind_file(
                fixture_root, crop["artifactRef"], crop["rawByteSha256"],
                f"{definition.case_id} crop-{crop['scale']}x",
                referenced_paths, referenced_identities,
            )
            data = crop_path.read_bytes()
            if data != crop_bytes[crop["artifactRef"]]:
                raise ValueError(f"{definition.case_id} crop-{crop['scale']}x deterministic bytes drifted.")
            image = decode_png(data, f"{definition.case_id} crop-{crop['scale']}x")
            if decoded_pixel_sha256(image) != crop["decodedRgbPixelSha256"]:
                raise ValueError(f"{definition.case_id} crop-{crop['scale']}x decoded pixel hash drifted.")
            if {"width": image.width, "height": image.height} != crop["pixelSize"]:
                raise ValueError(f"{definition.case_id} crop-{crop['scale']}x dimensions drifted.")

    authority_paths = set()
    for candidate in fixture_root.rglob("*"):
        if candidate.is_symlink():
            raise ValueError("Visual preprocessing authority must not use symlink or junction aliases.")
        if candidate.is_file():
            authority_paths.add(candidate.resolve())
    if authority_paths != referenced_paths:
        raise ValueError("Visual preprocessing inventory must exactly cover canonical authority files.")
    return len(entries)


def bind_file(
    root: Path,
    reference: str,
    expected_sha256: str,
    label: str,
    referenced_paths: set[Path],
    referenced_identities: set[tuple[int, int]],
) -> Path:
    if not is_sha256(expected_sha256):
        raise ValueError(f"{label} inventory SHA-256 is invalid.")
    path = resolve_bound_file(root, reference, label)
    if path in referenced_paths:
        raise ValueError(f"{label} is referenced more than once.")
    identity = file_identity(path)
    if identity in referenced_identities:
        raise ValueError(f"{label} aliases another authority file by physical identity.")
    data = path.read_bytes()
    if sha256_bytes(data) != expected_sha256:
        raise ValueError(f"{label} raw bytes do not match inventory/result SHA-256.")
    referenced_paths.add(path)
    referenced_identities.add(identity)
    return path


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def materialize_fixtures(fixture_root: Path = CANONICAL_ROOT) -> int:
    fixture_root.mkdir(parents=True, exist_ok=True)
    entries = []
    for definition in DEFINITIONS:
        source_bytes = encode_png(render_synthetic_source(definition))
        source_path = fixture_root / definition.source_name
        atomic_write(source_path, source_bytes)
        request = build_request(definition, source_bytes)
        request_bytes = stable_json_bytes(request)
        request_path = fixture_root / definition.request_name
        atomic_write(request_path, request_bytes)
        result, crop_bytes = compile_request(request_path, fixture_root)
        for name, data in crop_bytes.items():
            atomic_write(fixture_root / name, data)
        result_bytes = stable_json_bytes(result)
        atomic_write(fixture_root / definition.result_name, result_bytes)
        entries.append({
            "caseId": definition.case_id,
            "subjectPack": definition.subject_pack,
            "sourceRef": definition.source_name,
            "sourceSha256": sha256_bytes(source_bytes),
            "sourceDecodedRgbPixelSha256": request["source"]["decodedRgbPixelSha256"],
            "requestRef": definition.request_name,
            "requestSha256": sha256_bytes(request_bytes),
            "expectedResultRef": definition.result_name,
            "expectedResultSha256": sha256_bytes(result_bytes),
        })
    inventory = {
        "schemaVersion": "1.0",
        "kind": "visual-preprocessing-case-inventory",
        "fixtureSetId": "synthetic-visual-preprocessing-v1",
        "fixtureKind": "synthetic_fixture",
        "entries": entries,
    }
    atomic_write(fixture_root / INVENTORY_NAME, stable_json_bytes(inventory))
    return validate_canonical_fixtures(fixture_root)


def run_admitted_request(request_path: Path, output_dir: Path) -> Path:
    inventory_path = (CANONICAL_ROOT / INVENTORY_NAME).resolve(strict=True)
    fixture_root = CANONICAL_ROOT.resolve(strict=True)
    validate_canonical_fixtures(fixture_root)
    request_path = resolve_canonical_input(request_path, fixture_root, "request")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
    entry = next(
        (item for item in inventory["entries"] if item["requestRef"] == request_path.name),
        None,
    )
    if entry is None or sha256_bytes(request_path.read_bytes()) != entry["requestSha256"]:
        raise ValueError("Request is not admitted by the canonical inventory.")
    output_dir = output_dir.resolve()
    assert_output_outside_repo(output_dir)
    if output_dir.exists():
        raise ValueError("Runtime output directory must not already exist.")
    result, crop_bytes = compile_request(request_path, fixture_root)
    stage = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    try:
        for name, data in crop_bytes.items():
            atomic_write(stage / name, data)
        result_name = DEFINITION_BY_ID[result["requestId"]].result_name
        atomic_write(stage / result_name, stable_json_bytes(result))
        os.replace(stage, output_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return output_dir / DEFINITION_BY_ID[result["requestId"]].result_name


def assert_output_outside_repo(output_dir: Path) -> None:
    try:
        output_dir.relative_to(REPO_ROOT)
    except ValueError:
        return
    raise ValueError("Runtime output directory must be outside the repository root.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deterministic local visual preprocessing runtime.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--materialize-fixtures", action="store_true")
    mode.add_argument("--validate-fixtures", action="store_true")
    mode.add_argument("--request", type=Path)
    parser.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.materialize_fixtures:
        count = materialize_fixtures()
        print(f"Materialized and validated {count} synthetic visual preprocessing fixtures.")
        return 0
    if args.validate_fixtures:
        count = validate_canonical_fixtures()
        print(f"Validated {count} synthetic visual preprocessing fixtures.")
        return 0
    if args.out is None:
        raise ValueError("--out is required with --request.")
    result_path = run_admitted_request(args.request, args.out)
    print(json.dumps({"status": "ok", "resultPath": str(result_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
