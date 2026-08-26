"""
ADK tools for saving bill records to Firestore and querying past bills
via native KNN vector search.

Firestore data model:
  users/{uid}/bill_records/{recordId}
    billingMonth:    string
    createdAt:       Timestamp
    electricity:     { currentReading, lastReading, usage, rate, total }
    water:           { currentReading, lastReading, usage, multiplierOne,
                       multiplierTwo, multiplierThree, taxBase, taxFinalCost, total }
    combinedTotal:   number
    summaryText:     string         ← human-readable, used for embedding
    embedding:       Vector(768)    ← Firestore native Vector type

Notes:
  - Embedding uses Vertex AI text-embedding-004 (768-dim, free tier).
  - The embedding is stored inline with the bill record — no separate collection needed.
  - KNN search uses Firestore find_nearest() which requires a composite vector index.
    Create it once with:
      gcloud firestore indexes composite create \
        --project=$GOOGLE_CLOUD_PROJECT \
        --collection-group=bill_records \
        --query-scope=COLLECTION_GROUP \
        --field-config=field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}'

Reference:
  https://firebase.google.com/docs/firestore/vector-search
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

try:
    from google.adk.tools import tool
except ImportError:
    def tool(fn):
        return fn

try:
    from telemetry import trace_tool
except ImportError:
    def trace_tool(tool_name=None):
        def decorator(fn):
            return fn
        return decorator

try:
    from google.cloud import firestore
    from google.cloud.firestore_v1.vector import Vector
    from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
except (ImportError, ModuleNotFoundError):
    firestore = None  # type: ignore
    Vector = None  # type: ignore
    DistanceMeasure = None  # type: ignore

try:
    import vertexai
    from vertexai.language_models import TextEmbeddingModel
except (ImportError, ModuleNotFoundError):
    vertexai = None  # type: ignore
    TextEmbeddingModel = None  # type: ignore

# ─── Lazy singletons ──────────────────────────────────────────────────────────

_db = None
_embed_model = None


def _get_db() -> firestore.Client:
    global _db
    if _db is None:
        db_name = os.getenv("FIRESTORE_DATABASE_ID", "utility-app-firestore")
        _db = firestore.Client(
            project=os.environ["GOOGLE_CLOUD_PROJECT"],
            database=db_name,
        )
    return _db


def _get_embed_model() -> TextEmbeddingModel:
    global _embed_model
    if _embed_model is None:
        vertexai.init(project=os.environ["GOOGLE_CLOUD_PROJECT"])
        _embed_model = TextEmbeddingModel.from_pretrained("text-embedding-004")
    return _embed_model


def _embed(text: str) -> list[float]:
    """Generate a 768-dim embedding via Vertex AI text-embedding-004."""
    model = _get_embed_model()
    return model.get_embeddings([text])[0].values


def _bills_col(uid: str):
    return _get_db().collection("users").document(uid).collection("bill_records")


# ─── Tools ────────────────────────────────────────────────────────────────────

@tool
@trace_tool("save_bill_to_firestore")
def save_bill_to_firestore(uid: str, record_json: str) -> dict:
    """
    Embed and save a completed bill calculation record to Firestore.
    Overwrites any existing document with the same record id (idempotent upsert).

    Args:
        uid: Firebase Auth user UID.
        record_json: JSON string of the canonical bill record produced by the
                     calculate_* tools. Must include a 'summaryText' field or
                     one will be generated automatically.

    Returns:
        dict with status and the Firestore document id.
    """
    record = json.loads(record_json)
    summary = record.get("summaryText") or _build_summary(record)
    embedding = _embed(summary)

    doc_id = record.get("id") or f"bill_{datetime.now(timezone.utc).timestamp()}"
    doc_ref = _bills_col(uid).document(doc_id)

    doc_ref.set({
        "billingMonth":  record.get("billingMonth", ""),
        "createdAt":     firestore.SERVER_TIMESTAMP,
        "electricity":   record.get("electricity", {}),
        "water":         record.get("water", {}),
        "combinedTotal": record.get("combinedTotal", 0),
        "summaryText":   summary,
        "embedding":     Vector(embedding),
    }, merge=False)

    return {"status": "saved", "firestoreDocId": doc_id}


@tool
@trace_tool("search_similar_bills")
def search_similar_bills(uid: str, query: str, top_k: int = 3) -> list[dict]:
    """
    Retrieve semantically similar past bill records using Firestore KNN vector search.

    Args:
        uid: Firebase Auth user UID (scopes results to that user).
        query: Natural language question e.g. "what did I pay last July?".
        top_k: Number of results to return (default 3).

    Returns:
        List of matching bill records ordered by semantic similarity,
        each containing billingMonth, summaryText, and the full record metadata.
    """
    embedding = _embed(query)
    col_ref = _bills_col(uid)

    vector_query = col_ref.find_nearest(
        vector_field="embedding",
        query_vector=Vector(embedding),
        distance_measure=DistanceMeasure.COSINE,
        limit=top_k,
    )

    results = []
    for doc in vector_query.stream():
        data = doc.to_dict()
        data.pop("embedding", None)   # don't return raw vector bytes to LLM
        results.append({"id": doc.id, **data})

    return results


@tool
@trace_tool("get_last_reading")
def get_last_reading(uid: str) -> dict:
    """
    Retrieve the most recent bill's currentReading values to use as lastReading
    for the current session. Returns null values if no history exists.

    Args:
        uid: Firebase Auth user UID.

    Returns:
        dict with electricityLastReading and waterLastReading (floats or null).
    """
    col_ref = _bills_col(uid)
    docs = (
        col_ref
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )

    for doc in docs:
        data = doc.to_dict()
        return {
            "electricityLastReading": data.get("electricity", {}).get("currentReading"),
            "waterLastReading":       data.get("water", {}).get("currentReading"),
            "fromBillingMonth":       data.get("billingMonth"),
        }

    return {
        "electricityLastReading": None,
        "waterLastReading":       None,
        "fromBillingMonth":       None,
    }


# ─── Internal helpers (not exposed as tools) ─────────────────────────────────

def _build_summary(record: dict) -> str:
    """Fallback summary builder if summaryText is not pre-computed."""
    e = record.get("electricity", {})
    w = record.get("water", {})
    return (
        f"Billing month: {record.get('billingMonth', 'unknown')}. "
        f"Electricity usage: {e.get('usage', 0)} kWh at "
        f"${e.get('rate', 0)}/kWh, total ${e.get('total', 0):.2f}. "
        f"Water usage: {w.get('usage', 0)} m³, total ${w.get('total', 0):.2f}. "
        f"Combined bill (incl. 9% GST): ${record.get('combinedTotal', 0):.2f}."
    )
