# TNB crash: `Type.ThisType()` nil deref on tuple types

Minimal reproduction for a SIGSEGV in `typescript-native-bridge`
`6.0.3-bridge.13.tsgo.7.0.2` when type-aware ESLint queries a tuple type.

Everything here is synthetic. There is no real-project code in the fixture.

## The crash

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation]
github.com/microsoft/typescript-go/internal/checker.(*Type).ThisType(...)
	typescript-go/internal/checker/types.go:754
```

`pnpm typecheck` never hits it. It only fires through the type-info API that
typescript-eslint drives (`getTypeAtLocation` -> `newTypeResponse` ->
`ThisType`), which is why whole-program checking stays clean but type-aware lint
aborts the whole process.

## Reproduce

Needs pnpm and a Linux x64 / macOS host that the published TNB ships a binary for.

```bash
MODE=published ./run.sh
```

Expected: the process aborts with the stack above (exit 134). One rule
(`@typescript-eslint/no-unsafe-argument`) and one call, `wantTuple([])`, are
enough.

## See the fix

```bash
MODE=local ./run.sh
```

This builds `bridge.node` from this branch (which carries the one-line guard)
and drops it over the installed binary, then runs the same fixture. Expected:
exit 0, no crash. Needs Go 1.26+, a C toolchain, and Node headers.

## What triggers it

`no-unsafe-argument` asks the checker for the type of every call argument. The
argument `[]` in `wantTuple([])` is contextually typed as the empty tuple `[]`.
Its type is a tuple *reference* produced by `createArrayLiteralType`, which
clones the reference and copies the source's object flags. The clone keeps the
`Tuple` object flag while its data stays a bare `*TypeReference`, so
`AsInterfaceType()` returns nil. `ThisType()` reads `.thisType` off that nil and
segfaults.

## The fix

`(*Type).ThisType()` guards the nil interface type and falls through to nil,
matching the function's own contract ("nil for other type kinds"), stock (which
keeps such references field-less), and the sibling `Target()` case that
`newTypeResponse` already guards for the same aliasing. See the commit on the
`fix/thistype-nil-guard-tuple` branch (regenerated
`patches/typescript-go/0001-bridge-inplace.patch`).
