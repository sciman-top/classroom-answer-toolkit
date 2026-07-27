from __future__ import annotations

import hashlib
import importlib.metadata
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime
import rapidocr_onnxruntime
from PIL import __version__ as pillow_version
from rapidocr_onnxruntime import RapidOCR


ENGINE_ID = "rapidocr-onnxruntime"
ENGINE_VERSION = "1.2.3"
EXECUTION_PROVIDER = "CPUExecutionProvider"
COMPONENT_VERSIONS = {
    "onnxruntime": "1.27.0",
    "opencv": "5.0.0",
    "pillow": "12.3.0",
    "numpy": "2.5.0",
}
ARTIFACTS = {
    "configSha256": (
        "config.yaml",
        "a61ac7c6f753b9840ae77306f31a4845788c530d8ebe950f0c5476e30b984917",
    ),
    "detectionModelSha256": (
        "models/ch_PP-OCRv3_det_infer.onnx",
        "3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526",
    ),
    "classificationModelSha256": (
        "models/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    ),
    "recognitionModelSha256": (
        "models/ch_PP-OCRv3_rec_infer.onnx",
        "897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615",
    ),
}
PARAMETERS = {
    "inputMode": "whole_crop",
    "preprocessMode": "none",
    "boxThreshold": 0.5,
    "unclipRatio": 1.6,
    "textScore": 0.5,
    "useTextDetection": True,
    "useAngleClassification": True,
}


def runtime_policy() -> dict[str, Any]:
    return {
        "engineId": ENGINE_ID,
        "engineVersion": ENGINE_VERSION,
        "executionProvider": EXECUTION_PROVIDER,
        "components": dict(COMPONENT_VERSIONS),
        "artifacts": {
            field: expected_hash
            for field, (_, expected_hash) in ARTIFACTS.items()
        },
        "parameters": dict(PARAMETERS),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def installed_component_versions() -> dict[str, str]:
    return {
        "onnxruntime": onnxruntime.__version__,
        "opencv": cv2.__version__,
        "pillow": pillow_version,
        "numpy": np.__version__,
    }


def session_providers(engine: RapidOCR) -> dict[str, list[str]]:
    return {
        "detector": engine.text_detector.infer.session.get_providers(),
        "classifier": engine.text_cls.infer.session.get_providers(),
        "recognizer": engine.text_recognizer.session.session.get_providers(),
    }


def validate_runtime_identity(engine: RapidOCR | None = None) -> RapidOCR:
    installed_engine = importlib.metadata.version("rapidocr-onnxruntime")
    if installed_engine != ENGINE_VERSION:
        raise ValueError(
            f"RapidOCR version drifted: expected {ENGINE_VERSION}, got {installed_engine}."
        )
    installed_components = installed_component_versions()
    if installed_components != COMPONENT_VERSIONS:
        raise ValueError("OCR runtime component versions drifted from admitted policy.")

    package_root = Path(rapidocr_onnxruntime.__file__).resolve().parent
    for label, (relative_path, expected_hash) in ARTIFACTS.items():
        artifact = (package_root / relative_path).resolve(strict=True)
        try:
            artifact.relative_to(package_root)
        except ValueError as error:
            raise ValueError(f"OCR runtime {label} escapes the RapidOCR package root.") from error
        if not artifact.is_file() or sha256_file(artifact) != expected_hash:
            raise ValueError(f"OCR runtime {label} raw-byte SHA-256 drifted.")

    admitted_engine = engine or RapidOCR()
    if admitted_engine.use_text_det is not True or admitted_engine.use_angle_cls is not True:
        raise ValueError("OCR runtime detection/classification configuration drifted.")
    providers = session_providers(admitted_engine)
    if any(value != [EXECUTION_PROVIDER] for value in providers.values()):
        raise ValueError("OCR runtime execution provider drifted from CPU-only policy.")
    return admitted_engine


def engine_provenance() -> dict[str, Any]:
    policy = runtime_policy()
    return {
        "engineKind": "local_runtime",
        "engineId": policy["engineId"],
        "engineVersion": policy["engineVersion"],
        "executionProvider": policy["executionProvider"],
        "components": policy["components"],
        "artifacts": policy["artifacts"],
        "liveProvider": False,
        "cloudEgress": False,
    }
