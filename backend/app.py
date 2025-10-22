from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
import pyarrow as pa
import pyarrow.compute as pc
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)



TABLE: Optional[pa.Table] = None

@app.on_event("startup")
def load_table():
    global TABLE
    with pa.memory_map("/tmp/candidates.arrow", "r") as source:
        reader = pa.ipc.RecordBatchFileReader(source)
        TABLE = reader.read_all()

@app.get("/health")
def health():
    return {"ok": True, "rows": int(TABLE.num_rows) if TABLE else 0}

@app.get("/candidates.arrow")
def candidates_arrow(
    q: Optional[str] = Query(None, description="free text"),
    min_exp: Optional[int] = None,
    location: Optional[str] = None,
    limit: int = 250_000
):
    tbl = TABLE
    if q:
        qv = q.lower()
        mask = (
            pc.match_substring_regex(pc.utf8_lower(tbl["name"]), qv)
            | pc.match_substring_regex(pc.utf8_lower(tbl["title"]), qv)
            | pc.match_substring_regex(pc.utf8_lower(tbl["location"]), qv)
            | pc.match_substring_regex(pc.utf8_lower(tbl["skills"]), qv)
        )
        tbl = tbl.filter(mask)
    if min_exp is not None:
        tbl = tbl.filter(pc.greater_equal(tbl["years_exp"], pa.scalar(min_exp)))
    if location:
        tbl = tbl.filter(pc.equal(tbl["location"], pa.scalar(location)))
    if tbl.num_rows > limit:
        tbl = tbl.slice(0, limit)

    def streamer():
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, tbl.schema) as writer:
            writer.write_table(tbl)
        yield sink.getvalue().to_pybytes()

    return StreamingResponse(streamer(), media_type="application/vnd.apache.arrow.stream")
