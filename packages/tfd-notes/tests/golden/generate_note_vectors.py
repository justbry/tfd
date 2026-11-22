#!/usr/bin/env python3
"""Writes the CC0 vectors under tests/golden/chain and tests/golden/documents.

Independent of the TypeScript library: hashlib for sha256 and sha512, a hand-written canonical JSON (keys sorted by UTF-16
code unit, no whitespace, no floats), a hand-written exact-fraction replay of the interest rules (spec R-5, R-9), and the
RFC 8032 reference Ed25519. Run from anywhere: python3 -I generate_note_vectors.py. The TEST keys are published on purpose:
the seed of key <id> is sha256 of the UTF-8 text "tfd.note-test-key:<id>".
"""

import hashlib
import json
import os
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- canonical JSON (what src/canonical.ts must equal) ----


def canon(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canon(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(value[k]) for k in keys) + "}"
    raise TypeError(type(value))


def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---- RFC 8032 Ed25519 (reference, section 6) ----

P = 2**255 - 19
D = -121665 * pow(121666, P - 2, P) % P
Q = 2**252 + 27742317777372353535851937790883648493
SQRT_M1 = pow(2, (P - 1) // 4, P)


def inv(x):
    return pow(x, P - 2, P)


def recover_x(y, sign):
    x2 = (y * y - 1) * inv(D * y * y + 1) % P
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P != 0:
        x = x * SQRT_M1 % P
    if (x * x - x2) % P != 0:
        raise ValueError("no square root")
    return P - x if (x & 1) != sign else x


G_Y = 4 * inv(5) % P
G = (recover_x(G_Y, 0), G_Y, 1, recover_x(G_Y, 0) * G_Y % P)


def point_add(a, b):
    aa = (a[1] - a[0]) * (b[1] - b[0]) % P
    bb = (a[1] + a[0]) * (b[1] + b[0]) % P
    cc = 2 * a[3] * b[3] * D % P
    dd = 2 * a[2] * b[2] % P
    e, f, g, h = bb - aa, dd - cc, dd + cc, bb + aa
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def point_mul(scalar, point):
    result = (0, 1, 1, 0)
    while scalar > 0:
        if scalar & 1:
            result = point_add(result, point)
        point = point_add(point, point)
        scalar >>= 1
    return result


def compress(point):
    zinv = inv(point[2])
    x, y = point[0] * zinv % P, point[1] * zinv % P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def expand(seed):
    digest = hashlib.sha512(seed).digest()
    scalar = int.from_bytes(digest[:32], "little")
    scalar &= (1 << 254) - 8
    scalar |= 1 << 254
    return scalar, digest[32:]


def sha512_int(data):
    return int.from_bytes(hashlib.sha512(data).digest(), "little")


def public_key(seed):
    return compress(point_mul(expand(seed)[0], G))


def sign(seed, message):
    scalar, prefix = expand(seed)
    public = compress(point_mul(scalar, G))
    r = sha512_int(prefix + message) % Q
    r_bytes = compress(point_mul(r, G))
    h = sha512_int(r_bytes + public + message) % Q
    return r_bytes + int.to_bytes((r + h * scalar) % Q, 32, "little")


def base64url(data):
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# RFC 8032 section 7.1, test 1: a self-check of the implementation above.
RFC_SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
assert public_key(RFC_SEED).hex().startswith("d75a980182b10ab7")
assert sign(RFC_SEED, b"").hex().startswith("e5564300c360ac72")


def test_seed(key_id):
    return hashlib.sha256(f"tfd.note-test-key:{key_id}".encode()).digest()


RECEIPT_KEY = "note-test-1"
SEAL_KEY = "note-test-seal-1"

# ---- the note ----

NOTE_ID = "note-demo-1"
SCHEMA = "tfd.note-event.v1"
TERMS = {
    "currency": "USD",
    "exponent": 2,
    "principal_minor": "100000",
    "issue_date": "2026-01-01",
    "annual_rate": "0.0365",
    "day_count": "actual/365",
    "rounding": "half-up",
    "timezone": "America/Denver",
    "schedule": {"type": "none"},
}


def event(seq, entered_at, entered_by, event_type, **fields):
    base = {
        "schema": SCHEMA,
        "id": f"evt-{seq}",
        "note_id": NOTE_ID,
        "seq": seq,
        "entered_at": entered_at,
        "entered_by": entered_by,
        "type": event_type,
    }
    base.update(fields)
    return base


EVENTS = [
    event(1, "2026-01-01T09:00:00Z", "lender", "note.created", terms=TERMS),
    event(2, "2026-01-02T10:00:00Z", "borrower", "terms.accepted", via="email-link"),
    event(3, "2026-01-12T10:00:00Z", "borrower", "payment.recorded", kind="payment", amount_minor="30000",
          value_date="2026-01-11", method="transfer", reference="TX-1", via="email-link"),
    event(4, "2026-01-14T10:00:00Z", "lender", "payment.confirmed", target="evt-3", via="account"),
    event(5, "2026-01-15T08:00:00Z", "borrower", "annotation.added", text="Café payment — thank you", via="email-link"),
    event(6, "2026-01-21T10:00:00Z", "borrower", "payment.recorded", kind="payment", amount_minor="20000",
          value_date="2026-01-20", via="email-link"),
    event(7, "2026-02-01T10:00:00Z", "lender", "payment.recorded", kind="payment", amount_minor="50000",
          value_date="2026-01-05", source="lender-states", via="account"),
    event(8, "2026-03-01T09:00:00Z", "lender", "release.drafted", via="account"),
    event(9, "2026-03-02T10:00:00Z", "lender", "release.confirmed", target="evt-8", via="account"),
]

# A second, shorter note whose value dates run against recording order.
OUT_OF_ORDER = [
    event(1, "2026-01-01T09:00:00Z", "lender", "note.created", terms=TERMS),
    event(2, "2026-03-01T10:00:00Z", "lender", "payment.recorded", kind="payment", amount_minor="10000",
          value_date="2026-02-10", via="account"),
    event(3, "2026-03-02T10:00:00Z", "lender", "payment.recorded", kind="payment", amount_minor="10000",
          value_date="2026-01-10", source="lender-states", via="account"),
    event(4, "2026-03-03T10:00:00Z", "lender", "payment.recorded", kind="payment", amount_minor="5000",
          value_date="2026-01-31", source="lender-states", via="account"),
]

# ---- the chain ----


def genesis(note_id):
    return sha256_hex("tfd.note-chain.v1:" + note_id)


def link_hash(link):
    return sha256_hex(canon(link))


def build_chain(events):
    links, previous = [], genesis(events[0]["note_id"])
    for ev in sorted(events, key=lambda e: e["seq"]):
        link = {"seq": ev["seq"], "event_id": ev["id"], "event_hash": sha256_hex(canon(ev)), "prev_hash": previous}
        links.append(link)
        previous = link_hash(link)
    return links, {"seq": links[-1]["seq"], "head_hash": previous}


# ---- the engine's figures, by an independent exact replay (spec R-3 to R-5, R-9, R-10) ----

RATE = Fraction(365, 10000)


def round_half_up(fraction):
    return (fraction * 2 + 1) // 2 if fraction >= 0 else -((-fraction * 2 + 1) // 2)


def days_between(first, second):
    from datetime import date

    return (date.fromisoformat(second) - date.fromisoformat(first)).days


def replay(payments, as_of):
    """payments: [(value_date, seq, amount)]. Returns (principal, interest, payoff) on as_of."""
    principal, accrued, last = int(TERMS["principal_minor"]), Fraction(0), TERMS["issue_date"]
    for value_date, _seq, amount in sorted(payments):
        if value_date > as_of:
            continue
        accrued += principal * RATE * days_between(last, value_date) / 365
        last = value_date
        due = max(0, round_half_up(accrued))
        interest = min(amount, due)
        applied = min(amount - interest, principal)
        accrued -= interest
        principal -= applied
    accrued += principal * RATE * days_between(last, as_of) / 365
    interest = max(0, round_half_up(accrued))
    return principal, interest, principal + interest


# Payments each view counts: evt-3 is confirmed (both), evt-7 is lender-recorded (both, R-10), evt-6 is only claimed by the
# borrower, so it counts in the borrower view alone.
SHARED = [("2026-01-11", 3, 30000), ("2026-01-05", 7, 50000)]
BORROWER_ONLY = [("2026-01-20", 6, 20000)]


def view_figures(as_of):
    lender = replay(SHARED, as_of)
    borrower = replay(SHARED + BORROWER_ONLY, as_of)
    return lender, borrower


def balance(figures):
    return {"principal_minor": str(figures[0]), "interest_minor": str(figures[1]), "payoff_minor": str(figures[2])}


# ---- the documents ----

PAYOFF_WORDING = "Computed by tfd-notes from the recorded events. A record, not legal or tax advice."
RELEASE_WORDING = "The lender states this note is released."


def documents(events, issued_at, sealed_at, payment_id, as_of, release_id, parties):
    links, head = build_chain(events)
    by_id = {e["id"]: e for e in events}
    base = {
        "schema": "tfd.note-document.v1",
        "engine_version": "tfd-notes/1",
        "note_id": NOTE_ID,
        "chain_head": head,
        "issued_at": issued_at,
        "parties": parties,
    }
    payment = by_id[payment_id]
    lender_at_payment, borrower_at_payment = view_figures(payment["value_date"])
    receipt = dict(base, **{
        "type": "note.payment-receipt",
        "payment_event_id": payment_id,
        "event_hash": sha256_hex(canon(payment)),
        "kind": payment["kind"],
        "amount_minor": payment["amount_minor"],
        "currency": TERMS["currency"],
        "exponent": TERMS["exponent"],
        "value_date": payment["value_date"],
        "recorded_by": payment["entered_by"],
        "via": payment["via"],
        # evt-6 was recorded by the borrower and nobody has answered it.
        "status": "claimed by " + payment["entered_by"],
        "lender_payoff_minor": str(lender_at_payment[2]),
        "borrower_payoff_minor": str(borrower_at_payment[2]),
    })
    lender, borrower = view_figures(as_of)
    payoff = dict(base, **{
        "type": "note.payoff-statement",
        "as_of": as_of,
        "currency": TERMS["currency"],
        "exponent": TERMS["exponent"],
        "lender": balance(lender),
        "borrower": balance(borrower),
        "payoff_gap_minor": str(lender[2] - borrower[2]),
        "wording": PAYOFF_WORDING,
    })
    release_event = by_id[release_id]
    release_date = release_event["entered_at"][:10]
    release_lender, _ = view_figures(release_date)
    release = dict(base, **{
        "type": "note.release",
        "release_event_id": release_id,
        "release_event_hash": sha256_hex(canon(release_event)),
        "as_of": release_date,
        "currency": TERMS["currency"],
        "exponent": TERMS["exponent"],
        "balance_at_release_minor": str(release_lender[2]),
        "released_with_balance": release_lender[2] > 0,
        "wording": RELEASE_WORDING,
    })
    seal = {
        "schema": "tfd.note-document.v1",
        "type": "note.chain-seal",
        "note_id": NOTE_ID,
        "head_seq": head["seq"],
        "head_hash": head["head_hash"],
        "sealed_at": sealed_at,
    }
    return {"payment_receipt": receipt, "payoff_statement": payoff, "release": release, "chain_seal": seal}


def signed(body, key_id, purpose):
    seed = test_seed(key_id)
    signature = sign(seed, canon(body).encode("utf-8"))
    return dict(body, signature={"key_id": key_id, "purpose": purpose, "alg": "Ed25519", "sig": base64url(signature)})


def write(folder, name, which, data):
    os.makedirs(os.path.join(HERE, folder), exist_ok=True)
    path = os.path.join(HERE, folder, f"{name}.{which}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent="\t", ensure_ascii=False, sort_keys=(which == "expected"))
        handle.write("\n")


def chain_vector(name, events):
    links, head = build_chain(events)
    write("chain", name, "input", {"events": events})
    write("chain", name, "expected", {
        "note_id": events[0]["note_id"],
        "genesis_hash": genesis(events[0]["note_id"]),
        "event_hashes": [link["event_hash"] for link in links],
        "links": links,
        "head": head,
    })


def main():
    chain_vector("small-note", EVENTS)
    chain_vector("value-dates-out-of-order", OUT_OF_ORDER)
    issued_at, sealed_at = "2026-03-05T12:00:00Z", "2026-03-05T12:00:01Z"
    parties = {"lender_ref": "party-lender-1", "borrower_ref": "party-borrower-1"}
    bodies = documents(EVENTS, issued_at, sealed_at, "evt-6", "2026-03-31", "evt-9", parties)
    write("documents", "small-note", "input", {
        "events": EVENTS,
        "payment_event_id": "evt-6",
        "as_of": "2026-03-31",
        "release_event_id": "evt-9",
        "issued_at": issued_at,
        "sealed_at": sealed_at,
        "parties": parties,
        "test_keys": {"receipt": RECEIPT_KEY, "seal": SEAL_KEY},
    })
    write("documents", "small-note", "expected", {
        "public_keys": {
            RECEIPT_KEY: public_key(test_seed(RECEIPT_KEY)).hex(),
            SEAL_KEY: public_key(test_seed(SEAL_KEY)).hex(),
        },
        "document_sha256": {name: sha256_hex(canon(body)) for name, body in bodies.items()},
        "documents": {
            "payment_receipt": signed(bodies["payment_receipt"], RECEIPT_KEY, "receipt"),
            "payoff_statement": signed(bodies["payoff_statement"], RECEIPT_KEY, "receipt"),
            "release": signed(bodies["release"], RECEIPT_KEY, "receipt"),
            "chain_seal": signed(bodies["chain_seal"], SEAL_KEY, "seal"),
        },
    })


if __name__ == "__main__":
    main()
