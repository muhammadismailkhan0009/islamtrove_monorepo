"""Public published grouping catalog and CSRF-protected bulk administrator publication."""

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from islamtrove.api.alignment_admin import enforce_origin
from islamtrove.application.grouping_store import GroupingConflict

router = APIRouter(tags=["Passage groupings"])


class SurahGrouping(BaseModel):
    surahId: int = Field(ge=1, le=114)
    boundaries: list[int] = Field(min_length=1, max_length=286)


class BulkGroupingInput(BaseModel):
    expectedRevision: int = Field(ge=0)
    groupings: list[SurahGrouping] = Field(max_length=114)


@router.get("/api/quran/groupings")
async def published_groupings(request: Request) -> Response:
    try:
        doc = request.app.state.grouping_store.read()
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Published grouping data is invalid") from exc
    return JSONResponse(doc, headers={"Cache-Control": "no-store"})


@router.post("/api/admin/groupings")
async def publish_all(body: BulkGroupingInput, request: Request) -> Response:
    enforce_origin(request)
    request.app.state.admin_sessions.require(request)
    async with request.app.state.grouping_lock:
        try:
            doc = request.app.state.grouping_store.publish(
                [group.model_dump() for group in body.groupings], body.expectedRevision
            )
        except GroupingConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=500, detail="Unable to publish groupings") from exc
    return JSONResponse(doc, headers={"Cache-Control": "no-store"})
