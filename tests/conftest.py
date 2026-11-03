import importlib.util
import sys
import types

import pytest


class FakeTreeMap(dict):
    pass


class FakeU32(int):
    def __new__(cls, value=0):
        return int.__new__(cls, int(value))


class UserError(Exception):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class FakeWebResponse:
    def __init__(self, status, body):
        self.status = status
        self.body = body


def build_stub(state):
    gl = types.SimpleNamespace()

    class Public:
        @staticmethod
        def write(fn):
            return fn

        @staticmethod
        def view(fn):
            return fn

    class Message:
        @property
        def sender_address(self):
            return state.get(
                "sender", "0x0000000000000000000000000000000000000000"
            )

    class Web:
        def get(self, url):
            resp = state.get("web")
            if isinstance(resp, Exception):
                raise resp
            return resp

    class Nondet:
        def __init__(self):
            self.web = Web()

    class VM:
        def run_nondet_unsafe(self, leader_fn, validator_fn):
            result = leader_fn()
            if not validator_fn(Return(result)):
                raise UserError("CONSENSUS_FAILED")
            return result

    class Contract:
        pass

    gl.public = Public()
    gl.message = Message()
    gl.vm = VM()
    gl.vm.Return = Return
    gl.vm.UserError = UserError
    gl.nondet = Nondet()
    gl.Contract = Contract

    def allow_storage(cls):
        cls.__gl_allow_storage__ = True
        return cls

    mod = types.ModuleType("genlayer")
    mod.TreeMap = FakeTreeMap
    mod.u32 = FakeU32
    mod.gl = gl
    mod.allow_storage = allow_storage
    mod.__all__ = ["TreeMap", "u32", "gl", "allow_storage"]
    return mod


@pytest.fixture
def state():
    return {
        "sender": "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
        "web": FakeWebResponse(200, ""),
    }


@pytest.fixture
def contract(state):
    stub = build_stub(state)
    sys.modules["genlayer"] = stub
    spec = importlib.util.spec_from_file_location(
        "skillgraph_contract", "contracts/skillgraph.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SkillGraph()


@pytest.fixture
def alice():
    return "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa"


@pytest.fixture
def bob():
    return "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb"
