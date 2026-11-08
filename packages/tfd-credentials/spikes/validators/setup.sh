#!/usr/bin/env bash
# Interop spike: prepare WORK (outside the repo) with every third-party target, each in its own directory.
#
#   WORK=$(mktemp -d /tmp/tfdspike.XXXX) ./setup.sh
#
# Clones and builds run in their own trees; nothing here runs a build tool with our scripts in its cwd.
set -euo pipefail
WORK="${WORK:?set WORK to a fresh empty directory}"
DOCKER="${DOCKER:-/usr/local/bin/docker}"
NPM24="${NPM24:-/opt/homebrew/opt/node@24/bin/npm}"
mkdir -p "$WORK"/{1edtech/app,verifier-core/install,openbadgeslib,fixtures-dcc,reverse/{dcc-v2,dcc-v1,1edtech-tests},tls}

# 1EdTech public validator: build in a throwaway maven container, copy the jar out, drop the container.
git clone --depth 1 https://github.com/1EdTech/digital-credentials-public-validator.git "$WORK/1edtech/repo"
"$DOCKER" volume create tfdspike-m2 >/dev/null
"$DOCKER" run --rm -v "$WORK/1edtech/repo:/src:ro" -v tfdspike-m2:/root/.m2 -v "$WORK/1edtech/app:/out" \
	maven:3.9-eclipse-temurin-17 bash -c 'cp -r /src /build && cd /build && mvn -B -q -DskipTests install \
		&& cp inspector-vc-web/target/inspector-vc-web.jar /out/'

# DCC verifier-core 2.0.0-beta.1 (needs Node 24), install scripts disabled.
(cd "$WORK/verifier-core/install" && "$NPM24" init -y >/dev/null \
	&& "$NPM24" install --ignore-scripts --no-audit --no-fund @digitalcredentials/verifier-core@2.0.0-beta.1)

# openbadgeslib (low authority cross-check), wheels only.
python3 -m venv "$WORK/openbadgeslib/venv"
"$WORK/openbadgeslib/venv/bin/pip" install -q --only-binary :all: "openbadgeslib[ldp]"

# Reverse-direction samples: DCC's vc-test-fixtures and the 1EdTech validator's own OB3 test credentials.
git clone --depth 1 https://github.com/digitalcredentials/vc-test-fixtures.git "$WORK/fixtures-dcc/repo"
(cd "$WORK/fixtures-dcc/repo/verifiableCredentials" && for file in v2/*/*/*.json; do
	cp "$file" "$WORK/reverse/dcc-v2/$(echo "$file" | tr '/ ' '__')"; done
	for file in v1/dataIntegrityProof/didKey/*.json v1/bothSignatureTypes/didKey/legacy-noStatus-noExpiry-basicOBv3.json; do
	cp "$file" "$WORK/reverse/dcc-v1/$(echo "$file" | tr '/ ' '__')"; done)
for file in simple.json simple-eddsa-2022.json simple-did-key-method.json simple-did-web-method.json \
	simple-multiple-proofs.json complete.json simple-context-version.json simple-context-alias.json \
	credential-status-revoked.json simple-err-proof-value.json simple-err-expired.json; do
	cp "$WORK/1edtech/repo/inspector-vc/src/test/resources/ob30/$file" "$WORK/reverse/1edtech-tests/"
done

# A throwaway CA and a localhost leaf (SKI/AKI set: Python 3.13+ verifies X.509 strictly). Never committed.
cd "$WORK/tls"
openssl req -newkey rsa:2048 -nodes -keyout ca.key -out ca.csr -subj "/CN=tfdspike local CA" 2>/dev/null
printf "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n" > ca-ext.cnf
openssl x509 -req -in ca.csr -signkey ca.key -out ca.pem -days 30 -extfile ca-ext.cnf 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n" > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 30 -extfile ext.cnf 2>/dev/null
echo "WORK=$WORK is ready; now: WORK=$WORK $(dirname "$0")/run-all.sh"
