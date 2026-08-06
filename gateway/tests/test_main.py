from fastapi.testclient import TestClient

from app.main import app


def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["runtime"] == "ollama"
    assert body["model"]


def test_models_returns_presets():
    client = TestClient(app)
    response = client.get("/models")
    assert response.status_code == 200
    presets = response.json()["presets"]
    assert presets[0]["id"] == "translation-default"


def test_translate_rejects_blank_text():
    client = TestClient(app)
    response = client.post(
        "/translate", json={"text": "", "source_lang": "ko", "target_lang": "en"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_translate_rejects_bad_language():
    client = TestClient(app)
    response = client.post(
        "/translate", json={"text": "hello", "source_lang": "fr", "target_lang": "en"}
    )
    assert response.status_code == 422


class FakeService:
    async def translate(self, text, source_lang, target_lang, preset="translation-default"):
        return {
            "translation": "Hello.",
            "detected_source_lang": "ko",
            "model": "test-model",
            "attempts": 1,
            "warnings": [],
        }


def test_translate_success(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(app.state, "service", FakeService())
    response = client.post(
        "/translate", json={"text": "안녕하세요", "source_lang": "ko", "target_lang": "en"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["translation"] == "Hello."
    assert body["attempts"] == 1
