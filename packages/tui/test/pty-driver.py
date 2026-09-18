#!/usr/bin/env python3
"""Drive logview inside a PTY, resize, and print captured output after quit."""

from __future__ import annotations

import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


TIMEOUT_SEC = 14.0


def set_winsize(fd: int, pid: int, rows: int, cols: int) -> None:
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)
    os.kill(pid, signal.SIGWINCH)


def drain(fd: int, deadline: float, until: bytes | None = None) -> bytes:
    chunks: list[bytes] = []

    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        ready, _, _ = select.select([fd], [], [], max(0.05, remaining))

        if not ready:
            joined = b"".join(chunks)
            if until is not None and until in joined:
                break
            if until is None:
                break
            continue

        try:
            data = os.read(fd, 8192)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise

        if not data:
            break

        chunks.append(data)
        joined = b"".join(chunks)

        if until is not None and until in joined:
            break

        if until is None and b"q quit" in joined:
            break

    return b"".join(chunks)


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: pty-driver.py COMMAND...\n")
        return 2

    command = sys.argv[1:]
    pid, fd = pty.fork()

    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execvp(command[0], command)

    set_winsize(fd, pid, 24, 80)
    deadline = time.monotonic() + TIMEOUT_SEC
    captured = drain(fd, deadline, b"logview")

    if b"q quit" not in captured and b"logview" not in captured:
        os.write(fd, b"q")
        captured += drain(fd, time.monotonic() + 2)

    set_winsize(fd, pid, 12, 48)
    time.sleep(0.12)
    captured += drain(fd, time.monotonic() + 0.6)

    set_winsize(fd, pid, 32, 160)
    time.sleep(0.12)
    captured += drain(fd, time.monotonic() + 0.6)

    set_winsize(fd, pid, 12, 48)
    time.sleep(0.12)
    captured += drain(fd, time.monotonic() + 0.6)

    os.write(fd, b"\x1b[A")
    time.sleep(0.05)
    os.write(fd, b"\r")
    time.sleep(0.08)
    captured += drain(fd, time.monotonic() + 0.5)
    os.write(fd, b"\x1b")
    time.sleep(0.05)
    os.write(fd, b"G")
    time.sleep(0.05)
    os.write(fd, b"q")
    captured += drain(fd, time.monotonic() + 2)

    try:
        os.close(fd)
    except OSError:
        pass

    _pid, status = os.waitpid(pid, 0)
    sys.stdout.buffer.write(captured)
    sys.stdout.buffer.write(b"\nPTY_WAIT_STATUS=" + str(status).encode("ascii") + b"\n")

    if b"q quit" not in captured and b"logview" not in captured:
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
