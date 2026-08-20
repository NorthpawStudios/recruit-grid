import gzip

from fastapi import FastAPI, Query, Request
from fastapi.responses import Response
from fastapi.middleware.gzip import GZipMiddleware
import pyarrow as pa
import pyarrow.compute as pc
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)
# Compress dynamic (filtered) responses at a fast level; the full snapshot is
# pre-compressed once at startup and served below without touching this.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=1)


TABLE: Optional[pa.Table] = None
# The unfiltered snapshot serialized (and gzipped) once at startup: the hot
# path (initial page load) then costs zero CPU per request.
SNAPSHOT_IPC: Optional[bytes] = None
SNAPSHOT_GZIP: Optional[bytes] = None

ARROW_MEDIA_TYPE = "application/vnd.apache.arrow.stream"


def serialize_ipc(tbl: pa.Table) -> bytes:
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, tbl.schema) as writer:
        writer.write_table(tbl)
    return sink.getvalue().to_pybytes()


@app.on_event("startup")
def load_table():
    global TABLE, SNAPSHOT_IPC, SNAPSHOT_GZIP
    with pa.memory_map("/tmp/candidates.arrow", "r") as source:
        reader = pa.ipc.RecordBatchFileReader(source)
        # combine_chunks: one contiguous batch serializes and scans faster
        TABLE = reader.read_all().combine_chunks()
    SNAPSHOT_IPC = serialize_ipc(TABLE)
    SNAPSHOT_GZIP = gzip.compress(SNAPSHOT_IPC, compresslevel=6)


@app.get("/health")
def health():
    return {"ok": True, "rows": int(TABLE.num_rows) if TABLE else 0}


@app.get("/candidates.arrow")
def candidates_arrow(
    request: Request,
    q: Optional[str] = Query(None, description="free text"),
    min_exp: Optional[int] = None,
    location: Optional[str] = None,
    limit: int = 250_000,
):
    tbl = TABLE
    filtered = False
    if q:
        qv = q.lower()
        # Substring match, not regex: no pattern compilation, no metachar
        # surprises. (pc.or_ because ChunkedArray doesn't support `|`.)
        mask = pc.or_(
            pc.or_(
                pc.match_substring(pc.utf8_lower(tbl["name"]), qv),
                pc.match_substring(pc.utf8_lower(tbl["title"]), qv),
            ),
            pc.or_(
                pc.match_substring(pc.utf8_lower(tbl["location"]), qv),
                pc.match_substring(pc.utf8_lower(tbl["skills"]), qv),
            ),
        )
        tbl = tbl.filter(mask)
        filtered = True
    if min_exp is not None:
        tbl = tbl.filter(pc.greater_equal(tbl["years_exp"], pa.scalar(min_exp)))
        filtered = True
    if location:
        tbl = tbl.filter(pc.equal(tbl["location"], pa.scalar(location)))
        filtered = True
    if tbl.num_rows > limit:
        tbl = tbl.slice(0, limit)
        filtered = True

    if filtered:
        return Response(
            content=serialize_ipc(tbl),
            media_type=ARROW_MEDIA_TYPE,
            headers={"Cache-Control": "no-cache"},
        )

    # Hot path: bytes were serialized and gzipped at startup.
    headers = {"Cache-Control": "public, max-age=300", "Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("accept-encoding", ""):
        headers["Content-Encoding"] = "gzip"
        return Response(content=SNAPSHOT_GZIP, media_type=ARROW_MEDIA_TYPE, headers=headers)
    return Response(content=SNAPSHOT_IPC, media_type=ARROW_MEDIA_TYPE, headers=headers)
