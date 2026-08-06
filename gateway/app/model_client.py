from typing import Protocol, TypedDict

import httpx

from .settings import Settings, get_settings


class ModelOptions(TypedDict, total=False):
    temperature: float
    top_p: float
    top_k: int
    repeat_penalty: float
    repeat_last_n: int
    num_ctx: int
    num_predict: int


class ModelClient(Protocol):
    async def translate(self, prompt: str, options: ModelOptions) -> str: ...


class ModelClientError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class OllamaClient:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        mode: str = "generate",
        keep_alive: str = "5m",
        timeout: float = 60.0,
        settings: Settings | None = None,
    ):
        resolved = settings or get_settings()
        self.base_url = (base_url or resolved.ollama_base_url).rstrip("/")
        self.model = model or resolved.ollama_model
        self.mode = mode
        self.keep_alive = keep_alive
        self.timeout = timeout

    async def translate(self, prompt: str, options: ModelOptions) -> str:
        payload_options = dict(options)
        if self.mode == "chat":
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": payload_options,
                "keep_alive": self.keep_alive,
            }
            data = await self._post("/api/chat", payload)
            content = data.get("message", {}).get("content")
            if not isinstance(content, str):
                raise ModelClientError("Ollama chat response missing message content")
            return content
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": payload_options,
            "keep_alive": self.keep_alive,
        }
        data = await self._post("/api/generate", payload)
        response = data.get("response")
        if not isinstance(response, str):
            raise ModelClientError("Ollama generate response missing response text")
        return response

    async def _post(self, path: str, payload: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}{path}", json=payload)
        except httpx.TimeoutException as exc:
            raise ModelClientError(f"Ollama request timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise ModelClientError(f"Unable to reach Ollama at {self.base_url}: {exc}") from exc
        if response.status_code >= 400:
            raise ModelClientError(
                f"Ollama returned HTTP {response.status_code}: {response.text[:300]}"
            )
        try:
            return response.json()
        except ValueError as exc:
            raise ModelClientError("Ollama returned a non-JSON response") from exc
