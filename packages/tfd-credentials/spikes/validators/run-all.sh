#!/usr/bin/env bash
# Interop spike: re-run the whole matrix. Third-party code lives under WORK (outside the repo); this script only reads it.
#
#   WORK=/tmp/tfdspike.XXXX ./run-all.sh            # after ./setup.sh WORK (clones, builds, venv, TLS)
#
# Needs: docker, bun, Node 24 (NODE24, default Homebrew node@24), the WORK layout made by setup.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PACKAGE="$(cd "$HERE/../.." && pwd)"
WORK="${WORK:?set WORK to the directory setup.sh prepared}"
NODE24="${NODE24:-/opt/homebrew/opt/node@24/bin/node}"
DOCKER="${DOCKER:-/usr/local/bin/docker}"
RESULTS="$HERE/results"

# 1. Fixtures (deterministic: keys from labels, seeded entropy, fixed clock).
(cd "$PACKAGE" && bun spikes/validators/generate-fixtures.ts spikes/validators/fixtures)

# 2. The 1EdTech validator (built jar, libsodium for its Ed25519 provider, our CA in its trust store) and, in the
#    same network namespace, the HTTPS fixture site on :8443. Ports: 18080 validator API, 8443 site.
"$DOCKER" rm -f tfdspike-site tfdspike-validator >/dev/null 2>&1 || true
"$DOCKER" run -d --name tfdspike-validator -p 18080:8080 -p 8443:8443 \
	-v "$WORK/1edtech/app:/app:ro" -v "$WORK/tls/ca.pem:/ca.pem:ro" eclipse-temurin:17-jre \
	bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq libsodium23 >/dev/null \
		&& ln -sf "$(ls /usr/lib/*/libsodium.so.23)" /usr/lib/libsodium.so \
		&& keytool -importcert -cacerts -storepass changeit -noprompt -alias tfdspike -file /ca.pem \
		&& exec java -jar /app/inspector-vc-web.jar' >/dev/null
sleep 1
"$DOCKER" run -d --name tfdspike-site --network container:tfdspike-validator \
	-v "$HERE/fixtures/site:/site:ro" -v "$HERE/serve.ts:/scripts/serve.ts:ro" -v "$WORK/tls:/tls:ro" \
	oven/bun:1.4.4 bun /scripts/serve.ts /site /tls/server.pem /tls/server.key 8443 >/dev/null
until curl -s -o /dev/null --cacert "$WORK/tls/ca.pem" https://localhost:8443/issuers/webpath/did.json \
	&& curl -s -o /dev/null http://localhost:18080/api/validators; do sleep 2; done

rm -rf "$RESULTS"
mkdir -p "$RESULTS"
CREDENTIALS="$HERE/fixtures/credentials"

# 3. Our fixtures through every target.
bun "$HERE/run-1edtech.ts" "$CREDENTIALS" "$RESULTS/1edtech" > "$RESULTS/1edtech-run.txt"
bun "$HERE/compare-intermediates.ts" "$CREDENTIALS" "$RESULTS/1edtech" > "$RESULTS/1edtech-intermediates.txt"
(cd "$WORK" && NODE_EXTRA_CA_CERTS="$WORK/tls/ca.pem" "$NODE24" "$HERE/run-verifier-core.mjs" \
	"$WORK/verifier-core/install" "$CREDENTIALS" "$RESULTS/verifier-core" > "$RESULTS/verifier-core-run.txt" 2>&1)
(cd "$WORK" && SSL_CERT_FILE="$WORK/tls/ca.pem" "$WORK/openbadgeslib/venv/bin/python" -I \
	"$HERE/run-openbadgeslib.py" "$CREDENTIALS" "$RESULTS/openbadgeslib" > "$RESULTS/openbadgeslib-run.txt" 2>&1)
bun "$HERE/run-ours.ts" "$CREDENTIALS" "$RESULTS/ours" "$WORK/tls/ca.pem" > "$RESULTS/ours-run.txt"

# 4. Reverse direction: other ecosystems' samples (copied by setup.sh into WORK/reverse) through every target.
for source in dcc-v2 dcc-v1 1edtech-tests; do
	bun "$HERE/run-ours.ts" "$WORK/reverse/$source" "$RESULTS/reverse-ours/$source" "$WORK/tls/ca.pem" \
		>> "$RESULTS/reverse-ours-run.txt"
done
for source in dcc-v2 1edtech-tests; do
	bun "$HERE/run-1edtech.ts" "$WORK/reverse/$source" "$RESULTS/reverse-1edtech/$source" > /dev/null
	(cd "$WORK" && NODE_EXTRA_CA_CERTS="$WORK/tls/ca.pem" "$NODE24" "$HERE/run-verifier-core.mjs" \
		"$WORK/verifier-core/install" "$WORK/reverse/$source" "$RESULTS/reverse-verifier-core/$source" > /dev/null 2>&1)
done
bun "$HERE/check-extra-context.ts" "$WORK/reverse/1edtech-tests/simple-did-key-method.json" \
	https://purl.imsglobal.org/spec/ob/v3p0/extensions.json \
	"$WORK/1edtech/repo/inspector-vc/src/main/resources/contexts/ob-v3p0-extensions.json" \
	> "$RESULTS/reverse-ours/extensions-optin.txt"

# 5. The verdict matrix, and what the site served.
bun "$HERE/summarize.ts" "$HERE/fixtures/manifest.json" "$RESULTS" > "$RESULTS/MATRIX.md"
"$DOCKER" logs tfdspike-site > "$RESULTS/site-requests.log" 2>&1
echo "done: $RESULTS/MATRIX.md. Stop with: $DOCKER rm -f tfdspike-site tfdspike-validator"
