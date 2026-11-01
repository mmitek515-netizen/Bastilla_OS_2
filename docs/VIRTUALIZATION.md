# BastillaOS — Debian 13 virtualization

This repository provides a software-emulation fallback for hosts without /dev/kvm.

## Current verification status

The repository currently has no Debian/QEMU boot workflow. The only tracked
workflow is `ci.yml`, which runs the JavaScript verification suite.

The current Codespaces environment was inspected without installing packages or
changing device permissions:

- Architecture: x86_64.
- `qemu-system-x86_64` and `qemu-img` are not installed.
- `/dev/kvm` exists but is not accessible to the current user (owned by `root:kvm`).
- `dpkg-deb` and `sha256sum` are available.
- Both QEMU launcher scripts pass `bash -n`; this is only a syntax check.

No VM or ISO boot was attempted, and there is no boot log.

## Reproducible, unprivileged boot plan

Run on a disposable AMD64 Linux host with `qemu-system-x86` and `qemu-utils`
already installed. Do not install packages or change `/dev/kvm` ownership/group
membership without separate approval. Record `uname -m`, `qemu-system-x86_64
--version`, `qemu-img --version`, `/dev/kvm` read/write access, the Debian image
release and its official SHA-256 before starting.

For a boot-only smoke test, obtain a versioned Debian 13 AMD64 cloud image from
an official Debian source, verify it against the separately published checksum,
and keep the source image untouched. Create a disposable qcow2 overlay and retain
the serial log:

```bash
set -euo pipefail
VM_DIR="$HOME/bastilla-debian13-smoke"
SOURCE_IMAGE="/absolute/path/to/verified-debian13-amd64.qcow2"
mkdir -p "$VM_DIR"
qemu-img create -f qcow2 -F qcow2 -b "$SOURCE_IMAGE" "$VM_DIR/smoke-overlay.qcow2"
set -o pipefail
timeout --signal=INT 300s bash scripts/launch-qemu-tcg.sh \
  "$VM_DIR/smoke-overlay.qcow2" 2048 2 2>&1 | tee "$VM_DIR/boot.log"
```

The launcher uses software emulation and user-mode networking without host port
forwards. Verify the actual Debian boot marker in `boot.log`; record the exact
image checksum and command alongside it. A timeout is not a successful boot.
For an installer ISO test, verify the ISO checksum first and use a new, empty
`VM_DIR` with `scripts/bastilla-debian13-qemu.sh`; that script creates a fresh
32-GiB disk and exposes VNC only on `127.0.0.1:5901`. Never reuse a valuable disk.
An installer test and a cloud-image boot smoke test are separate results.

**Important:** a passing boot smoke test is not proof that the BastillaOS
application, AI agents, MCP integration, networking, or desktop UI work.

## Running a pre-existing qcow2 disk

Install `qemu-system-x86` and `qemu-utils` on a Linux host, then run:

```bash
bash scripts/launch-qemu-tcg.sh /absolute/path/to/debian13.qcow2 2048 2
```

The launcher intentionally uses `accel=tcg` (no hardware virtualization).
It does **not** install Debian, create user credentials, or expose a remote
desktop. The image must already contain a bootable OS. QEMU TCG is slower
than KVM and should be treated as a compatibility fallback.

## How to validate results

1. Open the workflow run and confirm the `debian13-boot` job succeeds.
2. Download the `debian13-tcg-boot-log` artifact.
3. Inspect `boot.log` for the actual Debian 13 boot banner/login prompt.
4. For BastillaOS functionality, run separate app-level tests on a persistent
   host; this smoke test only validates the guest OS boot path.
