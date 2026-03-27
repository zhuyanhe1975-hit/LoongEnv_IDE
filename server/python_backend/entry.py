import json
import sys

from service import run_job


def main() -> int:
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    run_job(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
