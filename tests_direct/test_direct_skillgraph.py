import json
import re

import pytest


def _claim(contract, vm, sender, skill, url, note="note"):
    with vm.prank(sender):
        return contract.claim_skill(skill, url, note)


def _endorse(contract, claim_id):
    return contract.endorse_skill(claim_id)


def test_direct_claim_and_views(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/skillgraph.py")
    claim_id = _claim(
        contract, direct_vm, direct_alice, "Python", "https://example.com"
    )
    assert claim_id == "claim-0"
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["skill"] == "Python"
    assert claim["status"] == "PENDING"
    node = json.loads(contract.get_skill("Python"))
    assert node["claim_count"] == 1
    assert node["pending_count"] == 1
    counts = json.loads(contract.get_counts())
    assert counts["claim_count"] == 1
    assert counts["skill_count"] == 1
    assert counts["claimer_count"] == 1


def test_direct_duplicate_and_validation(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/skillgraph.py")
    _claim(contract, direct_vm, direct_alice, "Python", "https://example.com")
    with pytest.raises(Exception, match="DUPLICATE_CLAIM"):
        _claim(
            contract, direct_vm, direct_alice, "PYTHON", "https://example.com"
        )
    with pytest.raises(Exception, match="INVALID_INPUT"):
        _claim(contract, direct_vm, direct_alice, "", "https://example.com")
    with pytest.raises(Exception, match="INVALID_INPUT"):
        _claim(contract, direct_vm, direct_alice, "Rust", "ftp://example.com")


def test_direct_cap(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/skillgraph.py")
    for i in range(32):
        _claim(
            contract, direct_vm, direct_alice, f"skill-{i}", "https://example.com"
        )
    with pytest.raises(Exception, match="CAP_REACHED"):
        _claim(
            contract, direct_vm, direct_alice, "skill-32", "https://example.com"
        )


def test_direct_endorse_endorsed(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/skillgraph.py")
    _claim(contract, direct_vm, direct_alice, "Python", "https://example.com")
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        re.escape("https://example.com"),
        {"method": "GET", "status": 200, "body": "I write Python daily."},
    )
    verdict = _endorse(contract, "claim-0")
    assert verdict == "ENDORSED"
    node = json.loads(contract.get_skill("python"))
    assert node["weight"] == 2
    assert node["endorsed_count"] == 1


def test_direct_endorse_weak_and_rejected(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/skillgraph.py")
    _claim(contract, direct_vm, direct_alice, "Quantum", "https://example.com")
    _claim(contract, direct_vm, direct_alice, "Tiny", "https://example.com")
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        re.escape("https://example.com"),
        {"method": "GET", "status": 200, "body": "z" * 200},
    )
    assert _endorse(contract, "claim-0") == "WEAK"
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        re.escape("https://example.com"),
        {"method": "GET", "status": 200, "body": "short"},
    )
    assert _endorse(contract, "claim-1") == "REJECTED"
    board = json.loads(contract.get_leaderboard())
    assert board["top_skills"][0]["skill"] == "Quantum"
    assert board["top_skills"][0]["weight"] == 1
    assert board["top_skills"][1]["weight"] == 0


def test_direct_endorse_unreachable_stays_pending(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/skillgraph.py")
    _claim(contract, direct_vm, direct_alice, "Python", "https://example.com")
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        re.escape("https://example.com"),
        {"method": "GET", "status": 404, "body": "not found"},
    )
    with pytest.raises(Exception, match="EVIDENCE_UNREACHABLE"):
        _endorse(contract, "claim-0")
    claim = json.loads(contract.get_claim("claim-0"))
    assert claim["status"] == "PENDING"
    with pytest.raises(Exception, match="NOT_FOUND"):
        _endorse(contract, "claim-999")
