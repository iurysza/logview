#!/usr/bin/env python3
"""Drive logview inside a PTY and print captured output after quit."""

from __future__ import annotations

import errno
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time


ROWS = 24
COLS = 80
TIMEOUT_SEC = 12.0


def set_winsize(fd: int) -> None:
    packed = struct.pack("HHHH", ROWS, COLS, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def drain(fd: int, deadline: float) -> bytes:
    chunks: list[bytes] = []

    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        ready, _, _ = select.select([fd], [], [], max(0.05, remaining))

        if not ready:
            continue

        try:
            data = os.read(fd, 4096)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise

        if not data:
            break

        chunks.append(data)

        if b"q quit" in b"".join(chunks):
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

    set_winsize(fd)
    deadline = time.monotonic() + TIMEOUT_SEC
    captured = drain(fd, deadline)

    if b"q quit" not in captured:
        os.write(fd, b"q")
        captured += drain(fd, time.monotonic() + 2)

    os.write(fd, b"\x1b[A")
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
