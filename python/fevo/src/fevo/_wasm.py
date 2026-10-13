"""Load sim.wasm with wasmtime and expose its raw exports.

This module is the only place that touches the wasm ABI. Everything that
decides a lap runs inside the wasm, so Python gets the same results as the
website and the server, bit for bit.
"""

from __future__ import annotations

import hashlib
import struct
from functools import lru_cache
from importlib import resources
from typing import Any, Sequence

import wasmtime


@lru_cache(maxsize=1)
def wasm_bytes() -> bytes:
    return resources.files("fevo").joinpath("_data/sim.wasm").read_bytes()


def wasm_sha256() -> str:
    return hashlib.sha256(wasm_bytes()).hexdigest()


@lru_cache(maxsize=1)
def _engine_and_module() -> tuple[wasmtime.Engine, wasmtime.Module]:
    engine = wasmtime.Engine()
    return engine, wasmtime.Module(engine, wasm_bytes())


class WasmError(RuntimeError):
    """The wasm aborted (an assert inside the simulator failed)."""


class Core:
    """One simulator instance: its own memory and state. Not thread-safe; use one per process."""

    def __init__(self) -> None:
        engine, module = _engine_and_module()
        self.store = wasmtime.Store(engine)
        linker = wasmtime.Linker(engine)
        self._abort: list[tuple[int, int, int, int]] = []
        linker.define_func(
            "env",
            "abort",
            wasmtime.FuncType([wasmtime.ValType.i32()] * 4, []),
            lambda msg, file, line, col: self._on_abort(msg, file, line, col),
        )
        self.instance = linker.instantiate(self.store, module)
        self._ex = self.instance.exports(self.store)
        self.memory: wasmtime.Memory = self._ex["memory"]  # type: ignore[assignment]
        self._fns: dict[str, Any] = {}
        self.f64_ptr = int(self.call("scratchF64"))
        self.i32_ptr = int(self.call("scratchI32"))
        self.f64_cap = int(self.call("scratchF64Capacity"))
        self.i32_cap = int(self.call("scratchI32Capacity"))

    def _on_abort(self, msg: int, file: int, line: int, col: int) -> None:
        raise WasmError(f"simulator assert failed: {self._read_string(msg)} ({self._read_string(file)}:{line}:{col})")

    def _read_string(self, ptr: int) -> str:
        if ptr == 0:
            return ""
        # AssemblyScript strings: UTF-16, byte length stored 4 bytes before the data.
        (length,) = struct.unpack("<I", bytes(self.memory.read(self.store, ptr - 4, ptr)))
        return bytes(self.memory.read(self.store, ptr, ptr + length)).decode("utf-16-le", "replace")

    def call(self, name: str, *args: Any) -> Any:
        fn = self._fns.get(name)
        if fn is None:
            fn = self._fns[name] = self._ex[name]
        return fn(self.store, *args)

    def global_value(self, name: str) -> Any:
        return self._ex[name].value(self.store)  # type: ignore[union-attr]

    def write_f64(self, values: Sequence[float], offset: int = 0) -> None:
        if offset + len(values) > self.f64_cap:
            raise ValueError("too many numbers for the simulator's scratch buffer")
        self.memory.write(self.store, struct.pack(f"<{len(values)}d", *values), self.f64_ptr + 8 * offset)

    def write_i32(self, values: Sequence[int], offset: int = 0) -> None:
        if offset + len(values) > self.i32_cap:
            raise ValueError("too many numbers for the simulator's scratch buffer")
        self.memory.write(self.store, struct.pack(f"<{len(values)}i", *values), self.i32_ptr + 4 * offset)
