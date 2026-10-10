"""CSV exports for the 이수관리 dashboard (UTF-8 BOM so Excel opens Korean)."""

from __future__ import annotations

import csv
import io
from typing import AsyncIterator, Awaitable, Callable

BOM = "﻿"


def _csv_safe(value) -> str:
    """Neutralise spreadsheet formula injection."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def rows_to_csv(header: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([_csv_safe(v) for v in r])
    return buf.getvalue()


async def paged_csv(
    header: list[str],
    fetch_page: Callable[[int], Awaitable[dict]],
    to_rows: Callable[[dict], list[list]],
    page_size: int = 200,
) -> AsyncIterator[str]:
    """Stream a CSV page by page so a 10k-row export never materialises at once."""
    yield BOM + rows_to_csv(header, [])
    page = 1
    while True:
        result = await fetch_page(page)
        rows = to_rows(result)
        if rows:
            buf = io.StringIO()
            w = csv.writer(buf)
            for r in rows:
                w.writerow([_csv_safe(v) for v in r])
            yield buf.getvalue()
        if page * result.get("page_size", page_size) >= result.get("total", 0) or not result.get("data"):
            break
        page += 1
