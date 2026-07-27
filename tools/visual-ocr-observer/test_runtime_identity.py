from __future__ import annotations

import unittest
from unittest.mock import patch

import runtime_identity


class _Session:
    def __init__(self, providers: list[str]) -> None:
        self._providers = providers

    def get_providers(self) -> list[str]:
        return self._providers


class _Wrapper:
    def __init__(self, providers: list[str]) -> None:
        self.session = _Session(providers)


class _Engine:
    def __init__(self, providers: list[str] | None = None) -> None:
        selected = providers or ["CPUExecutionProvider"]
        self.use_text_det = True
        self.use_angle_cls = True
        self.text_detector = type("Detector", (), {"infer": _Wrapper(selected)})()
        self.text_cls = type("Classifier", (), {"infer": _Wrapper(selected)})()
        self.text_recognizer = type("Recognizer", (), {"session": _Wrapper(selected)})()


class RuntimeIdentityTests(unittest.TestCase):
    def test_current_runtime_identity_is_admitted(self) -> None:
        engine = runtime_identity.validate_runtime_identity()
        self.assertIsNotNone(engine)
        self.assertEqual(
            runtime_identity.session_providers(engine),
            {
                "detector": ["CPUExecutionProvider"],
                "classifier": ["CPUExecutionProvider"],
                "recognizer": ["CPUExecutionProvider"],
            },
        )

    def test_version_drift_fails_closed(self) -> None:
        with patch("runtime_identity.importlib.metadata.version", return_value="9.9.9"):
            with self.assertRaisesRegex(ValueError, "RapidOCR version drifted"):
                runtime_identity.validate_runtime_identity(_Engine())

    def test_model_hash_drift_fails_closed(self) -> None:
        with patch("runtime_identity.sha256_file", return_value="0" * 64):
            with self.assertRaisesRegex(ValueError, "raw-byte SHA-256 drifted"):
                runtime_identity.validate_runtime_identity(_Engine())

    def test_execution_provider_drift_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "CPU-only policy"):
            runtime_identity.validate_runtime_identity(_Engine(["CUDAExecutionProvider"]))


if __name__ == "__main__":
    unittest.main()
