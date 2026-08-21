#!/usr/bin/env bash
# Reproduce (and, with MODE=local, fix) the TNB Type.ThisType nil-deref crash.
#
#   MODE=published ./run.sh   # default: crashes on the published npm binary
#   MODE=local     ./run.sh   # builds bridge.node from this branch: runs clean
#
# Each run starts from a fresh install so the two modes are independent and
# repeatable no matter what the previous run did to the native binary.
set -uo pipefail
cd "$(dirname "$0")"
MODE="${MODE:-published}"
REPO_ROOT="$(cd .. && pwd)"

echo "== fresh install (typescript = published TNB) =="
rm -rf node_modules
pnpm install --silent

store_bridge() {
  find node_modules/.pnpm -path '*@typescript-native-bridge*/native/bridge.node' | head -1
}

if [ "$MODE" = "local" ]; then
  echo "== MODE=local: building patched bridge.node from $REPO_ROOT =="
  echo "   (needs Go 1.26+, a C toolchain, and Node headers)"
  # Start from a clean submodule: --force resets tracked files to the recorded
  # commit and clean removes leftover overlay files, so patch:tsgo always
  # applies onto pristine source (a re-patched tree fails "does not apply").
  git -C "$REPO_ROOT" submodule update --init --force typescript-go
  git -C "$REPO_ROOT/typescript-go" clean -fdq
  NODE_PREFIX="$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")"
  rm -f "$REPO_ROOT/native/bridge.node"
  ( cd "$REPO_ROOT" && node tools/patch-tsgo.js \
      && NODE_INCLUDE="$NODE_PREFIX/include/node" node tools/build-bridge.js ) \
    || { echo "BUILD FAILED: not touching the installed binary"; exit 1; }
  if [ ! -f "$REPO_ROOT/native/bridge.node" ]; then
    echo "BUILD FAILED: native/bridge.node was not produced"; exit 1
  fi
  dst="$(store_bridge)"
  echo "== overwriting $dst with the patched build =="
  # --remove-destination breaks the store hardlink so the global pnpm store
  # stays pristine.
  cp --remove-destination "$REPO_ROOT/native/bridge.node" "$dst"
fi

echo "== running eslint (MODE=$MODE) =="
node_modules/.bin/eslint src
rc=$?

echo
if [ "$MODE" = "local" ]; then
  if [ $rc -eq 0 ]; then
    echo "RESULT: exit 0. Fixed. The patched engine returns nil for the tuple"
    echo "        reference instead of dereferencing it."
  else
    echo "RESULT: unexpected non-zero exit ($rc) for MODE=local."
  fi
else
  if [ $rc -ge 128 ]; then
    echo "RESULT: crashed (exit $rc). SIGSEGV in (*Type).ThisType, checker/types.go."
    echo "        Re-run with 'MODE=local ./run.sh' to see the fix."
  else
    echo "RESULT: exit $rc, expected a crash on the published binary; did the"
    echo "        published TNB version change?"
  fi
fi
exit $rc
