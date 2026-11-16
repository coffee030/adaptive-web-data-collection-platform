"""Topic catalog and collection request endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import AfterValidator

from backend.application.collection import (
    ApproveBinding,
    Binding,
    CatalogEdit,
    Category,
    CollectionRequest,
    NewRequest,
    RefreshRequest,
    Topic,
    TopicCreate,
)
from backend.core.contracts import Contract, Name
from backend.persistence.collection import CategoryRow, TopicRow

from .jobs import PageLimit, PageOffset

router = APIRouter(tags=["topic collections"])


class RestoreBinding(Contract):
    approved_by: Annotated[Name, AfterValidator(CatalogEdit.printable_name)]


@router.get("/categories", response_model=list[Category])
def list_categories(request: Request, limit: PageLimit = 50, offset: PageOffset = 0):
    return request.app.state.catalog.list(CategoryRow, Category, limit, offset)


@router.post("/categories", response_model=Category, status_code=201)
def create_category(request: Request, body: CatalogEdit):
    return request.app.state.catalog.save(CategoryRow, Category, body, "category")


@router.get("/categories/{identity}", response_model=Category)
def get_category(request: Request, identity: UUID):
    return request.app.state.catalog.get(CategoryRow, Category, identity, "category")


@router.put("/categories/{identity}", response_model=Category)
def edit_category(request: Request, identity: UUID, body: CatalogEdit):
    return request.app.state.catalog.save(
        CategoryRow, Category, body, "category", identity
    )


@router.get("/topics", response_model=list[Topic])
def list_topics(
    request: Request,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
    active_only: bool = False,
    category_id: UUID | None = None,
):
    return request.app.state.catalog.list(
        TopicRow, Topic, limit, offset, active_only=active_only, category_id=category_id
    )


@router.post("/topics", response_model=Topic, status_code=201)
def create_topic(request: Request, body: TopicCreate):
    return request.app.state.catalog.save(TopicRow, Topic, body, "topic")


@router.get("/topics/{identity}", response_model=Topic)
def get_topic(request: Request, identity: UUID):
    return request.app.state.catalog.get(TopicRow, Topic, identity, "topic")


@router.put("/topics/{identity}", response_model=Topic)
def edit_topic(request: Request, identity: UUID, body: CatalogEdit):
    return request.app.state.catalog.save(TopicRow, Topic, body, "topic", identity)


@router.get("/topics/{topic_id}/bindings", response_model=list[Binding])
def list_bindings(
    request: Request,
    topic_id: UUID,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
    eligible_only: bool = False,
):
    return request.app.state.catalog.bindings(
        topic_id, limit, offset, eligible_only=eligible_only
    )


@router.post("/topics/{topic_id}/bindings", response_model=Binding, status_code=201)
def approve_binding(request: Request, topic_id: UUID, body: ApproveBinding):
    return request.app.state.catalog.approve(topic_id, body)


@router.post("/topics/{topic_id}/bindings/{binding_id}/disable", response_model=Binding)
def disable_binding(request: Request, topic_id: UUID, binding_id: UUID):
    return request.app.state.catalog.set_binding(topic_id, binding_id)


@router.post("/topics/{topic_id}/bindings/{binding_id}/approve", response_model=Binding)
def restore_binding(
    request: Request, topic_id: UUID, binding_id: UUID, body: RestoreBinding
):
    return request.app.state.catalog.set_binding(
        topic_id, binding_id, approver=body.approved_by
    )


@router.get("/collection-requests", response_model=list[CollectionRequest])
def list_requests(request: Request, limit: PageLimit = 50, offset: PageOffset = 0):
    return request.app.state.collection_requests.list(limit, offset)


@router.get("/collection-requests/{request_id}", response_model=CollectionRequest)
def get_request(request: Request, request_id: UUID):
    return request.app.state.collection_requests.get(request_id)


@router.post(
    "/collection-requests",
    response_model=CollectionRequest,
    status_code=201,
    responses={200: {"model": CollectionRequest}},
)
def create_request(request: Request, response: Response, body: NewRequest):
    result, created = request.app.state.collection_requests.create(body)
    if not created:
        response.status_code = 200
    return result


@router.post(
    "/collection-requests/{request_id}/refresh",
    response_model=CollectionRequest,
    status_code=201,
    responses={200: {"model": CollectionRequest}},
)
def refresh_request(
    request: Request, response: Response, request_id: UUID, body: RefreshRequest
):
    result, created = request.app.state.collection_requests.refresh(
        request_id, body.request_key
    )
    if not created:
        response.status_code = 200
    return result
