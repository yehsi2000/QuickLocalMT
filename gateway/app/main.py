import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .model_client import OllamaClient
from .schemas import (
    ErrorResponse,
    HealthResponse,
    ModelPreset,
    ModelsResponse,
    TranslateRequest,
    TranslateResponse,
)
from .settings import get_settings
from .translation_service import TranslationError, TranslationService

logger = logging.getLogger("lst.gateway")


def create_app() -> FastAPI:
    settings = get_settings()

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    client = OllamaClient(settings=settings)
    service = TranslationService(client, settings)

    app = FastAPI(title="Local Selector Translator Gateway", version="0.1.0")
    app.state.service = service

    origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(
                error={"code": "VALIDATION_ERROR", "message": "Invalid request body"}
            ).model_dump(),
        )

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", runtime="ollama", model=settings.ollama_model)

    @app.get("/models", response_model=ModelsResponse)
    async def models() -> ModelsResponse:
        return ModelsResponse(
            presets=[
                ModelPreset(
                    id="translation-default",
                    label="Translation (default)",
                    description="Plain text translation with repetition guards.",
                )
            ]
        )

    @app.post("/translate", response_model=TranslateResponse)
    async def translate(payload: TranslateRequest, request: Request):
        current_service: TranslationService = request.app.state.service
        if settings.debug_log_text:
            logger.info(
                "translate request source=%s target=%s length=%d",
                payload.source_lang,
                payload.target_lang,
                len(payload.text),
            )
        else:
            logger.info(
                "translate request source=%s target=%s length=%d (text redacted)",
                payload.source_lang,
                payload.target_lang,
                len(payload.text),
            )
        try:
            result = await current_service.translate(
                payload.text,
                payload.source_lang,
                payload.target_lang,
                payload.preset,
            )
            return TranslateResponse(**result)
        except TranslationError as exc:
            logger.warning("translation failed code=%s", exc.code)
            return JSONResponse(
                status_code=502,
                content=ErrorResponse(error={"code": exc.code, "message": exc.message}).model_dump(),
            )
        except Exception:
            logger.exception("unexpected gateway error")
            return JSONResponse(
                status_code=500,
                content=ErrorResponse(
                    error={"code": "INTERNAL_ERROR", "message": "Internal gateway error"}
                ).model_dump(),
            )

    return app


app = create_app()
