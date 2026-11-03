import json

import pytest

from conftest import FakeWebResponse, UserError


def test_claim_ok(contract, state, alice):
    state["sender"] = alice
    claim_id = contract.claim_skill(
        "Python", "https://example.com", "built data pipelines"
    )
    assert claim_id == "claim-0"
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["claimer"] == alice.lower()
    assert claim["skill"] == "Python"
    assert claim["status"] == "PENDING"
    assert claim["verdict"] == ""
    assert claim["weight"] == 0
    node = json.loads(contract.get_skill("Python"))
    assert node["weight"] == 0
    assert node["claim_count"] == 1
    assert node["pending_count"] == 1
    counts = json.loads(contract.get_counts())
    assert counts == {
        "claim_count": 1,
        "skill_count": 1,
        "claimer_count": 1,
        "assessed_count": 0,
        "total_weight": 0,
    }
    assert contract.get_claim_id(0) == "claim-0"
    assert contract.get_skill_id(0) == "python"


def test_claim_validation(contract, state):
    with pytest.raises(UserError, match="INVALID_INPUT"):
        contract.claim_skill("", "https://example.com", "note")
    with pytest.raises(UserError, match="INVALID_INPUT"):
        contract.claim_skill("x" * 65, "https://example.com", "note")
    with pytest.raises(UserError, match="INVALID_INPUT"):
        contract.claim_skill("Python", "ftp://example.com", "note")
    with pytest.raises(UserError, match="INVALID_INPUT"):
        contract.claim_skill("Python", "", "note")
    with pytest.raises(UserError, match="INVALID_INPUT"):
        contract.claim_skill("Python", "https://example.com", "n" * 501)


def test_duplicate_same_case(contract, state):
    contract.claim_skill("Python", "https://example.com", "note")
    with pytest.raises(UserError, match="DUPLICATE_CLAIM"):
        contract.claim_skill("Python", "https://example.com", "other note")


def test_duplicate_case_insensitive(contract, state):
    contract.claim_skill("Python", "https://example.com", "note")
    with pytest.raises(UserError, match="DUPLICATE_CLAIM"):
        contract.claim_skill("PYTHON", "https://example.com", "other note")
    with pytest.raises(UserError, match="DUPLICATE_CLAIM"):
        contract.claim_skill(" python ", "https://example.com", "other note")


def test_duplicate_different_claimer_ok(contract, state, alice, bob):
    state["sender"] = alice
    contract.claim_skill("Python", "https://example.com", "alice note")
    state["sender"] = bob
    claim_id = contract.claim_skill("Python", "https://example.com", "bob note")
    assert claim_id == "claim-1"
    node = json.loads(contract.get_skill("python"))
    assert node["claim_count"] == 2
    assert node["pending_count"] == 2


def test_cap_32(contract, state):
    for i in range(32):
        contract.claim_skill(f"skill-{i}", "https://example.com", "note")
    with pytest.raises(UserError, match="CAP_REACHED"):
        contract.claim_skill("skill-32", "https://example.com", "note")
    counts = json.loads(contract.get_counts())
    assert counts["claim_count"] == 32
    assert counts["skill_count"] == 32


def test_endorse_endorsed(contract, state):
    contract.claim_skill("Python", "https://example.com", "note")
    state["web"] = FakeWebResponse(
        200, "I write Python every day for data work and web apps."
    )
    verdict = contract.endorse_skill("claim-0")
    assert verdict == "ENDORSED"
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["status"] == "ENDORSED"
    assert claim["weight"] == 2
    node = json.loads(contract.get_skill("python"))
    assert node["weight"] == 2
    assert node["endorsed_count"] == 1
    assert node["pending_count"] == 0
    counts = json.loads(contract.get_counts())
    assert counts["assessed_count"] == 1
    assert counts["total_weight"] == 2


def test_endorse_weak(contract, state):
    contract.claim_skill("Quantum", "https://example.com", "note")
    state["web"] = FakeWebResponse(200, "x" * 200)
    verdict = contract.endorse_skill("claim-0")
    assert verdict == "WEAK"
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["weight"] == 1
    node = json.loads(contract.get_skill("quantum"))
    assert node["weight"] == 1
    assert node["weak_count"] == 1


def test_endorse_rejected(contract, state):
    contract.claim_skill("Quantum", "https://example.com", "note")
    state["web"] = FakeWebResponse(200, "short")
    verdict = contract.endorse_skill("claim-0")
    assert verdict == "REJECTED"
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["weight"] == 0
    node = json.loads(contract.get_skill("quantum"))
    assert node["weight"] == 0
    assert node["rejected_count"] == 1


def test_endorse_unreachable_status(contract, state):
    contract.claim_skill("Python", "https://example.com", "note")
    state["web"] = FakeWebResponse(404, "not found")
    with pytest.raises(UserError, match="EVIDENCE_UNREACHABLE"):
        contract.endorse_skill("claim-0")
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["status"] == "PENDING"
    node = json.loads(contract.get_skill("python"))
    assert node["pending_count"] == 1
    assert json.loads(contract.get_counts())["assessed_count"] == 0


def test_endorse_unreachable_exception(contract, state):
    contract.claim_skill("Python", "https://example.com", "note")
    state["web"] = RuntimeError("network down")
    with pytest.raises(UserError, match="EVIDENCE_UNREACHABLE"):
        contract.endorse_skill("claim-0")
    assert json.loads(contract.get_claim("claim-0"))["status"] == "PENDING"


def test_endorse_not_found(contract, state):
    with pytest.raises(UserError, match="NOT_FOUND"):
        contract.endorse_skill("claim-999")


def test_endorse_invalid_status(contract, state):
    contract.claim_skill("Python", "https://example.com", "note")
    state["web"] = FakeWebResponse(200, "Python expert here")
    contract.endorse_skill("claim-0")
    with pytest.raises(UserError, match="INVALID_STATUS"):
        contract.endorse_skill("claim-0")


def test_leaderboard_ordering(contract, state, alice, bob):
    state["sender"] = alice
    contract.claim_skill("Alpha", "https://example.com", "a")
    contract.claim_skill("Beta", "https://example.com", "b")
    state["sender"] = bob
    contract.claim_skill("Alpha", "https://example.com", "a2")
    contract.claim_skill("Gamma", "https://example.com", "g")
    state["web"] = FakeWebResponse(200, "Alpha and Beta and Gamma skills")
    contract.endorse_skill("claim-0")
    contract.endorse_skill("claim-1")
    state["web"] = FakeWebResponse(200, "Alpha stuff")
    contract.endorse_skill("claim-2")
    state["web"] = FakeWebResponse(200, "y" * 150)
    contract.endorse_skill("claim-3")
    board = json.loads(contract.get_leaderboard())
    skills = [(s["skill"], s["weight"]) for s in board["top_skills"]]
    assert skills[0] == ("Alpha", 4)
    assert skills[1] == ("Beta", 2)
    assert skills[2] == ("Gamma", 1)
    claimers = [(c["score"]) for c in board["top_claimers"]]
    assert claimers[0] == 4
    assert claimers[1] == 3


def test_views_absent(contract, state):
    assert contract.get_claim("claim-999") == ""
    assert contract.get_skill("nope") == ""
    assert contract.get_claim_id(99) == ""
    assert contract.get_skill_id(99) == ""
