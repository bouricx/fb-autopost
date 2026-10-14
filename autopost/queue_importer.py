import json
from .manager import validate

def parse(text):
    if len(text) > 200000:
        raise ValueError('Import exceeds 200 KB.')
    rows = json.loads(text)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise ValueError('Import must be a JSON array with 1–100 jobs.')
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Each job must be an object.')
        values = {key: str(row.get(key, '')) for key in ['page_id', 'message', 'link', 'scheduled_at']}
        validate(**values)
        result.append(values)
    return result
