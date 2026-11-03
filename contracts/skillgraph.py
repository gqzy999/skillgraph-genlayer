# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


try:
    _allow_storage = allow_storage
except NameError:
    def _allow_storage(cls):
        return cls


@_allow_storage
class SkillGraph(gl.Contract):
    claims: TreeMap[str, str]
    claim_index: TreeMap[str, str]
    claim_count: u32
    skills: TreeMap[str, str]
    skill_index: TreeMap[str, str]
    skill_count: u32
    claimers: TreeMap[str, str]
    claimer_index: TreeMap[str, str]
    claimer_count: u32
    claimer_skills: TreeMap[str, str]
    assessed_count: u32
    total_weight: u32

    def __init__(self):
        self.claims = TreeMap()
        self.claim_index = TreeMap()
        self.claim_count = u32(0)
        self.skills = TreeMap()
        self.skill_index = TreeMap()
        self.skill_count = u32(0)
        self.claimers = TreeMap()
        self.claimer_index = TreeMap()
        self.claimer_count = u32(0)
        self.claimer_skills = TreeMap()
        self.assessed_count = u32(0)
        self.total_weight = u32(0)

    def _lookup(self, table, key):
        try:
            return table[key]
        except Exception:
            return ""

    def _judge(self, url, skill_key):
        try:
            resp = gl.nondet.web.get(url)
            status = getattr(resp, "status", 200)
            if status != 200:
                return "UNREACHABLE"
            body = getattr(resp, "body", "")
            if isinstance(body, bytes):
                try:
                    body = body.decode("utf-8", "ignore")
                except Exception:
                    body = ""
            if body is None:
                body = ""
            body = str(body)
            lowered = body.lower()
            if skill_key in lowered:
                return "ENDORSED"
            if len(body) >= 100:
                return "WEAK"
            return "REJECTED"
        except Exception:
            return "UNREACHABLE"

    @gl.public.write
    def claim_skill(self, skill: str, evidence_url: str, note: str) -> str:
        clean_skill = skill.strip()
        clean_url = evidence_url.strip()
        clean_note = note.strip()
        if clean_skill == "" or len(clean_skill) > 64:
            raise gl.vm.UserError("INVALID_INPUT")
        if len(clean_url) == 0 or len(clean_url) > 500:
            raise gl.vm.UserError("INVALID_INPUT")
        if not (clean_url.startswith("http://") or clean_url.startswith("https://")):
            raise gl.vm.UserError("INVALID_INPUT")
        if len(clean_note) > 500:
            raise gl.vm.UserError("INVALID_INPUT")
        claimer = str(gl.message.sender_address).lower()
        skill_key = clean_skill.lower()
        dup_key = claimer + "|" + skill_key
        if self._lookup(self.claimer_skills, dup_key) != "":
            raise gl.vm.UserError("DUPLICATE_CLAIM")
        claimer_raw = self._lookup(self.claimers, claimer)
        if claimer_raw != "":
            claimer_rec = json.loads(claimer_raw)
            if int(claimer_rec["claim_count"]) >= 32:
                raise gl.vm.UserError("CAP_REACHED")
        claim_id = "claim-" + str(int(self.claim_count))
        claim_rec = {
            "claim_id": claim_id,
            "claimer": claimer,
            "skill": clean_skill,
            "skill_key": skill_key,
            "evidence_url": clean_url,
            "note": clean_note,
            "status": "PENDING",
            "verdict": "",
            "weight": 0,
        }
        self.claims[claim_id] = json.dumps(claim_rec)
        self.claim_index[str(int(self.claim_count))] = claim_id
        self.claim_count = u32(int(self.claim_count) + 1)
        skill_raw = self._lookup(self.skills, skill_key)
        if skill_raw == "":
            node = {
                "skill": clean_skill,
                "skill_key": skill_key,
                "weight": 0,
                "claim_count": 1,
                "endorsed_count": 0,
                "weak_count": 0,
                "rejected_count": 0,
                "pending_count": 1,
            }
            self.skills[skill_key] = json.dumps(node)
            self.skill_index[str(int(self.skill_count))] = skill_key
            self.skill_count = u32(int(self.skill_count) + 1)
        else:
            node = json.loads(skill_raw)
            node["claim_count"] = int(node["claim_count"]) + 1
            node["pending_count"] = int(node["pending_count"]) + 1
            self.skills[skill_key] = json.dumps(node)
        if claimer_raw == "":
            crec = {
                "claimer": claimer,
                "score": 0,
                "claim_count": 1,
                "endorsed_count": 0,
                "weak_count": 0,
                "rejected_count": 0,
                "pending_count": 1,
            }
            self.claimers[claimer] = json.dumps(crec)
            self.claimer_index[str(int(self.claimer_count))] = claimer
            self.claimer_count = u32(int(self.claimer_count) + 1)
        else:
            crec = json.loads(claimer_raw)
            crec["claim_count"] = int(crec["claim_count"]) + 1
            crec["pending_count"] = int(crec["pending_count"]) + 1
            self.claimers[claimer] = json.dumps(crec)
        self.claimer_skills[dup_key] = claim_id
        return claim_id

    @gl.public.write
    def endorse_skill(self, claim_id: str) -> str:
        raw = self._lookup(self.claims, claim_id)
        if raw == "":
            raise gl.vm.UserError("NOT_FOUND")
        claim = json.loads(raw)
        if claim["status"] != "PENDING":
            raise gl.vm.UserError("INVALID_STATUS")
        url = claim["evidence_url"]
        skill_key = claim["skill_key"]

        def leader_fn(u=url, s=skill_key):
            return self._judge(u, s)

        def validator_fn(leader_result, u=url, s=skill_key):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_verdict = leader_result.calldata
            if not isinstance(leader_verdict, str):
                return False
            try:
                own = self._judge(u, s)
            except Exception:
                return False
            return leader_verdict == own

        verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if verdict == "UNREACHABLE":
            raise gl.vm.UserError("EVIDENCE_UNREACHABLE")
        if verdict not in ("ENDORSED", "WEAK", "REJECTED"):
            raise gl.vm.UserError("CONSENSUS_RESULT_INVALID")
        if verdict == "ENDORSED":
            weight = 2
        elif verdict == "WEAK":
            weight = 1
        else:
            weight = 0
        claim["status"] = verdict
        claim["verdict"] = verdict
        claim["weight"] = weight
        self.claims[claim_id] = json.dumps(claim)
        node = json.loads(self._lookup(self.skills, skill_key))
        node["pending_count"] = int(node["pending_count"]) - 1
        if verdict == "ENDORSED":
            node["endorsed_count"] = int(node["endorsed_count"]) + 1
        elif verdict == "WEAK":
            node["weak_count"] = int(node["weak_count"]) + 1
        else:
            node["rejected_count"] = int(node["rejected_count"]) + 1
        node["weight"] = int(node["weight"]) + weight
        self.skills[skill_key] = json.dumps(node)
        crec = json.loads(self._lookup(self.claimers, claim["claimer"]))
        crec["pending_count"] = int(crec["pending_count"]) - 1
        if verdict == "ENDORSED":
            crec["endorsed_count"] = int(crec["endorsed_count"]) + 1
        elif verdict == "WEAK":
            crec["weak_count"] = int(crec["weak_count"]) + 1
        else:
            crec["rejected_count"] = int(crec["rejected_count"]) + 1
        crec["score"] = int(crec["score"]) + weight
        self.claimers[claim["claimer"]] = json.dumps(crec)
        self.assessed_count = u32(int(self.assessed_count) + 1)
        self.total_weight = u32(int(self.total_weight) + weight)
        return verdict

    @gl.public.view
    def get_claim(self, claim_id: str) -> str:
        return self._lookup(self.claims, claim_id)

    @gl.public.view
    def get_claim_id(self, index: u32) -> str:
        return self._lookup(self.claim_index, str(int(index)))

    @gl.public.view
    def get_skill(self, skill: str) -> str:
        return self._lookup(self.skills, skill.strip().lower())

    @gl.public.view
    def get_skill_id(self, index: u32) -> str:
        return self._lookup(self.skill_index, str(int(index)))

    @gl.public.view
    def get_leaderboard(self) -> str:
        nodes = []
        for i in range(int(self.skill_count)):
            raw = self._lookup(self.skill_index, str(i))
            if raw == "":
                continue
            node = json.loads(self._lookup(self.skills, raw))
            nodes.append(node)
        nodes.sort(key=lambda n: (-int(n["weight"]), n["skill_key"]))
        top_skills = [
            {
                "skill": n["skill"],
                "weight": int(n["weight"]),
                "claim_count": int(n["claim_count"]),
                "endorsed_count": int(n["endorsed_count"]),
            }
            for n in nodes[:10]
        ]
        people = []
        for i in range(int(self.claimer_count)):
            raw = self._lookup(self.claimer_index, str(i))
            if raw == "":
                continue
            crec = json.loads(self._lookup(self.claimers, raw))
            people.append(crec)
        people.sort(key=lambda c: (-int(c["score"]), c["claimer"]))
        top_claimers = [
            {
                "claimer": c["claimer"],
                "score": int(c["score"]),
                "claim_count": int(c["claim_count"]),
                "endorsed_count": int(c["endorsed_count"]),
            }
            for c in people[:10]
        ]
        return json.dumps({"top_skills": top_skills, "top_claimers": top_claimers})

    @gl.public.view
    def get_counts(self) -> str:
        return json.dumps(
            {
                "claim_count": int(self.claim_count),
                "skill_count": int(self.skill_count),
                "claimer_count": int(self.claimer_count),
                "assessed_count": int(self.assessed_count),
                "total_weight": int(self.total_weight),
            }
        )
