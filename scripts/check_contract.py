import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "contracts" / "skillgraph.py"
SRC = PATH.read_text(encoding="utf-8")
LINES = SRC.split("\n")

errors = []

if not LINES[0].startswith('# { "Depends": "py-genlayer:'):
    errors.append("first line must be the Depends header")
hash_lines = [i + 1 for i, line in enumerate(LINES) if "#" in line]
if hash_lines != [1]:
    errors.append(f"comment lines found at {hash_lines}, only line 1 may contain #")
if "class SkillGraph" not in SRC:
    errors.append("missing SkillGraph class")
if "class SkillGraph(gl.Contract)" not in SRC:
    errors.append("SkillGraph must subclass gl.Contract (Studio runner requires it)")
if "def __init__" not in SRC:
    errors.append("SkillGraph must define __init__")
if "import gl" in SRC and "from genlayer import" not in SRC:
    errors.append("must import via from genlayer import *")
if re.search(r"^import gl\b", SRC, re.M):
    errors.append("bare import gl is forbidden")
if "hashlib" in SRC:
    errors.append("hashlib is not available in GenVM")
if "allow_storage" not in SRC:
    errors.append("SkillGraph must carry @allow_storage for the current GenVM")
for method in [
    "claim_skill",
    "endorse_skill",
    "get_claim",
    "get_skill",
    "get_leaderboard",
    "get_counts",
]:
    if f"def {method}" not in SRC:
        errors.append(f"missing method {method}")
for err in [
    "INVALID_INPUT",
    "DUPLICATE_CLAIM",
    "CAP_REACHED",
    "NOT_FOUND",
    "INVALID_STATUS",
    "EVIDENCE_UNREACHABLE",
]:
    if err not in SRC:
        errors.append(f"missing error {err}")

if errors:
    print("FAILED:")
    for e in errors:
        print(f" - {e}")
    sys.exit(1)
print("All checks passed.")
