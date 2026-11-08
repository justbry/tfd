"""Interop spike: verify every fixture with openbadgeslib's OB3LdpVerifier (no pinned key, so did:key is resolved
offline and did:web over HTTPS through an injected `download` that allows localhost), first without and then with status checking.

    SSL_CERT_FILE=<ca.pem> <venv>/bin/python -I run-openbadgeslib.py <credentials dir> <results dir>

Run with -I from a directory that is not the openbadgeslib checkout, so nothing local shadows an import.
"""
import json
import os
import sys

from openbadgeslib.ob3 import OB3LdpVerifier
from openbadgeslib.util import download_file


def download_local(url: str) -> bytes:
    """The library refuses private addresses (an SSRF guard); the fixture site is on localhost, so allow it here."""
    return download_file(url, allow_private=True)


def main() -> None:
    credentials_dir, results_dir = sys.argv[1], sys.argv[2]
    os.makedirs(results_dir, exist_ok=True)
    summary = {}
    for file in sorted(os.listdir(credentials_dir)):
        if not file.endswith(".json"):
            continue
        name = file[: -len(".json")]
        with open(os.path.join(credentials_dir, file), encoding="utf-8") as handle:
            document = handle.read()
        outcome = {}
        for label, check_status in (("signature", False), ("status", True)):
            try:
                OB3LdpVerifier().verify(
                    document, check_status=check_status, download=download_local
                )
                outcome[label] = "accepted"
            except Exception as error:  # noqa: BLE001 - record whatever the verifier raises
                outcome[label] = f"rejected: {type(error).__name__}: {str(error)[:300]}"
        summary[name] = outcome
        print(f"{name:42} sig={outcome['signature'][:110]}")
        print(f"{'':42} status={outcome['status'][:110]}")
    with open(os.path.join(results_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)
        handle.write("\n")


main()
