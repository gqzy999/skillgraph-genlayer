# { "Depends": "py-genlayer:1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh" }
from genlayer import *


@allow_storage
class Probe:
    count: u32

    def __init__(self):
        self.count = u32(0)

    @gl.public.view
    def get_count(self) -> str:
        return str(int(self.count))
