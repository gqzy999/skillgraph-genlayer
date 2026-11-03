# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


@allow_storage
class Probe(gl.Contract):
    count: u32

    def __init__(self):
        self.count = u32(0)

    @gl.public.view
    def get_count(self) -> str:
        return str(int(self.count))
