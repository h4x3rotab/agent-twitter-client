import logging

from tweet import check_last_tweet
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()
log = logging.getLogger(__name__)


@app.get("/")
async def root():
    try:
        check_last_tweet()
    except Exception as e:
        log.error(f"Error: {e}")
        return JSONResponse(status_code=400, content=dict(code=1, message=str(e)))
    return JSONResponse(status_code=200, content=dict(code=0, message="OK"))
