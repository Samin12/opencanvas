#!/usr/bin/env python3

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_queue_index() -> dict:
    return {
        "version": 1,
        "pending": [],
        "processed": [],
        "failed": [],
    }


def read_payload(input_path: str | None) -> dict:
    if input_path:
        content = Path(input_path).read_text(encoding="utf-8")
    else:
        content = sys.stdin.read()

    if not content.strip():
        raise SystemExit("No diagram JSON payload was provided.")

    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise SystemExit("Diagram payload must be a JSON object.")
    return payload


def write_atomic_json(target_path: Path, value: dict) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(target_path.suffix + ".tmp")
    temp_path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, target_path)


def write_atomic_text(target_path: Path, content: str) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(target_path.suffix + ".tmp")
    temp_path.write_text(content, encoding="utf-8")
    os.replace(temp_path, target_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Enqueue an Open Canvas diagram request.")
    parser.add_argument("--workspace-root", default=".", help="Workspace root path")
    parser.add_argument("--input", help="Path to a JSON payload file. Reads stdin when omitted.")
    parser.add_argument("--summary", help="Fallback prompt summary when payload omits one.")
    parser.add_argument("--request-id", help="Override the request id.")
    args = parser.parse_args()

    payload = read_payload(args.input)
    workspace_root = Path(args.workspace_root).resolve()
    inbox_root = workspace_root / ".claude-canvas" / "diagram-inbox"
    requests_dir = inbox_root / "requests"
    index_path = inbox_root / "index.json"

    request_id = args.request_id or payload.get("requestId") or f"req_{uuid.uuid4().hex[:12]}"
    created_at = payload.get("createdAt") or now_iso()
    prompt_summary = payload.get("promptSummary") or args.summary or "Open Canvas diagram request"

    payload["version"] = 1
    payload["skill"] = "open-canvas-diagrams"
    payload["requestId"] = request_id
    payload["createdAt"] = created_at
    payload["promptSummary"] = prompt_summary

    request_filename = f"{request_id}.oc-diagrams.json"
    request_path = requests_dir / request_filename
    request_relative_path = f".claude-canvas/diagram-inbox/requests/{request_filename}"

    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            index = default_queue_index()
    else:
        index = default_queue_index()

    if not isinstance(index, dict):
        index = default_queue_index()

    index.setdefault("version", 1)
    index.setdefault("pending", [])
    index.setdefault("processed", [])
    index.setdefault("failed", [])

    pending = []
    for entry in index.get("pending", []):
        if isinstance(entry, dict) and entry.get("requestId") != request_id:
            pending.append(entry)

    pending.append(
        {
            "requestId": request_id,
            "file": request_relative_path,
            "promptSummary": prompt_summary,
            "createdAt": created_at,
        }
    )
    index["pending"] = pending
    index["failed"] = [
        entry
        for entry in index.get("failed", [])
        if not (isinstance(entry, dict) and entry.get("requestId") == request_id)
    ]

    write_atomic_text(request_path, json.dumps(payload, indent=2) + "\n")
    write_atomic_json(index_path, index)

    print(request_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
