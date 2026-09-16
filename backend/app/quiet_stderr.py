"""Drop known-harmless native log spam without hiding real errors.

mediapipe's C++ layer logs straight to file descriptor 2 before its logging
is initialised, so neither Python logging nor GLOG_* environment variables
can quiet it. The only reliable place to filter is the descriptor itself:
fd 2 is swapped for a pipe, and a thread forwards every line to the real
stderr unless it matches one of the noise patterns below.
"""
from __future__ import annotations

import os
import threading

NOISE = (
    b"inference_feedback_manager",
    b"landmark_projection_calculator",
    b"absl::InitializeLog()",
    b"XNNPACK delegate",
    b"oneDNN custom operations",
    b"TF_ENABLE_ONEDNN_OPTS",
    b"tensorflow/core/util/port.cc",
)

_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    real_fd = os.dup(2)
    read_fd, write_fd = os.pipe()
    os.dup2(write_fd, 2)
    os.close(write_fd)

    def pump():
        buf = b""
        while True:
            try:
                chunk = os.read(read_fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not any(p in line for p in NOISE):
                    os.write(real_fd, line + b"\n")
        if buf:
            os.write(real_fd, buf)

    threading.Thread(target=pump, name="stderr-filter", daemon=True).start()
