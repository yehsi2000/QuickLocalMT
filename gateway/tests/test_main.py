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
    def __init__(self):
        self.last_glossary = None

    async def translate(
        self, text, source_lang, target_lang, preset="translation-default", glossary=None
    ):
        self.last_glossary = glossary
        return {
            "translation": "Hello.",
            "detected_source_lang": "ko",
            "model": "test-model",
            "attempts": 1,
            "warnings": [],
        }


def test_translate_success(monkeypatch):
    client = TestClient(app)
    fake = FakeService()
    monkeypatch.setattr(app.state, "service", fake)
    response = client.post(
        "/translate", json={"text": "안녕하세요", "source_lang": "ko", "target_lang": "en"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["translation"] == "Hello."
    assert body["attempts"] == 1


def test_translate_passes_glossary_to_service(monkeypatch):
    client = TestClient(app)
    fake = FakeService()
    monkeypatch.setattr(app.state, "service", fake)
    response = client.post(
        "/translate",
        json={
            "text": "冒険者と魔法使い",
            "source_lang": "ja",
            "target_lang": "ko",
            "glossary": [
                {"source": "冒険者", "target": "모험가"},
                {"source": "魔法使い", "target": "마법사"},
            ],
        },
    )
    assert response.status_code == 200
    assert fake.last_glossary[0].source == "冒険者"
    assert fake.last_glossary[1].target == "마법사"


def test_translate_rejects_glossary_over_limit():
    client = TestClient(app)
    glossary = [{"source": f"term{i}", "target": "T"} for i in range(51)]
    response = client.post(
        "/translate",
        json={"text": "hello", "source_lang": "ko", "target_lang": "en", "glossary": glossary},
    )
    assert response.status_code == 422
