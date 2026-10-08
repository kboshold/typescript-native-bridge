#!/usr/bin/env node
/**
 * Instantiated-symbol guard witness.
 *
 * getTypeOfInstantiatedSymbol's bridge guard used to dispatch by flags whenever
 * resolution RE-ENTERED the same symbol (`instantiatedSymbolActive`). That
 * fallback skips the Instantiated branch, so links.mapper is never applied and
 * the symbol keeps its declaration-site type. A self-referencing Zod schema
 * re-enters legitimately — stock and pristine tsgo both resolve it by recursing
 * and letting pushTypeResolution break the cycle in the per-kind getters — so
 * the guard leaked `$InferObjectOutput<Shape, Config["out"]>`, with Shape and
 * Config unsubstituted, into real diagnostics (13 errors on a Nuxt codebase, on
 * a plain CLI typecheck with no editor in play).
 *
 * The guard now keys on the pathology it was written for: a nil links.target or
 * a links.target chain closed into a loop (cross-checker SymbolHandle reuse).
 * Re-entrancy alone no longer short-circuits.
 *
 * This witness pins the correctness direction: the self-referencing schema's
 * inferred type and diagnostics must equal stock's. Pre-fix it reports TS2345
 * with the uninstantiated type; post-fix the program is clean, like stock.
 * Mutation-verified against the pre-fix bridge.
 *
 * The pathology direction (nil/cyclic target) is exercised by the editor-path
 * gates, not here: that state arises from the bridge reusing a SymbolHandle
 * across checkers, which no public-API call sequence constructs on demand.
 * check:sim-nav and the volar suite cover it — both are byte-identical across
 * the fix.
 *
 * Fixture: zod pinned at 4.4.3 under /tmp/tnb-instsymbol-fixture (cached;
 * network required on first run). A hand-rolled model of zod's inference chain
 * does not reproduce — the trigger needs zod's actual deferral shape
 * (`$ZodLooseShape = Record<string, any>` plus the `core.output<T>`
 * conditional), and three reductions of it all type-checked clean.
 *
 * Stock side: STOCK_TYPESCRIPT_PATH, else derived from STOCK_TSSERVER_PATH
 * (CI), else /tmp/stock-ts-p3/package/lib/typescript.js.
 *
 * Usage: node tools/triage-instsymbol-target-guard.mjs
 * Exit:  0 = PASS, 1 = FAIL.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

const require2 = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const tsb = require2(path.join(repoRoot, 'lib', 'typescript.js')); // TNB
const stockTsPath = process.env.STOCK_TYPESCRIPT_PATH
	?? (process.env.STOCK_TSSERVER_PATH ? path.join(path.dirname(process.env.STOCK_TSSERVER_PATH), 'typescript.js') : undefined)
	?? '/tmp/stock-ts-p3/package/lib/typescript.js';
const tss = require2(stockTsPath); // stock

const ZOD_VERSION = '4.4.3';
const dir = '/tmp/tnb-instsymbol-fixture';
const entry = path.join(dir, 'src', 'a.ts');

// A self-referencing schema through a getter — zod's documented recursive form.
const SOURCE = `import { z } from 'zod'

export const contentSchema = z.object({
	type: z.string(),
	get content() { return z.array(contentSchema).optional() },
	text: z.string().optional(),
})

type ContentNode = z.infer<typeof contentSchema>
declare function walk(nodes: ContentNode[]): void
export function f(n: ContentNode) { if (n.content) walk(n.content) }
`;

const CONFIG = {
	compilerOptions: {
		strict: true,
		noEmit: true,
		target: 'es2022',
		module: 'preserve',
		moduleResolution: 'bundler',
		skipLibCheck: true,
		types: [],
	},
	include: ['src'],
};

function provision() {
	const installed = (() => {
		try {
			return require2(path.join(dir, 'node_modules', 'zod', 'package.json')).version;
		} catch {
			return undefined;
		}
	})();
	fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
	fs.writeFileSync(entry, SOURCE);
	fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(CONFIG, null, 2));
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
		name: 'tnb-instsymbol-fixture',
		private: true,
		dependencies: { zod: ZOD_VERSION },
	}, null, 2));
	if (installed === ZOD_VERSION) return;
	execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
}

// The bridge only drives a program created through a host (tsgoChecker hooks
// createProgram's host path); a bare createProgram stays on the fork's JS
// checker and would make this witness unable to fail.
function tnbProgram() {
	const NOOP = () => {};
	const host = tsb.createWatchCompilerHost(path.join(dir, 'tsconfig.json'), {}, tsb.sys, tsb.createAbstractBuilder, NOOP, NOOP);
	host.watchFile = () => ({ close: NOOP });
	host.watchDirectory = () => ({ close: NOOP });
	host.setTimeout = undefined;
	host.clearTimeout = undefined;
	let builder;
	host.afterProgramCreate = b => { builder = b; };
	const watch = tsb.createWatchProgram(host);
	return { program: (builder ?? watch.getProgram()).getProgram(), close: () => watch.close?.() };
}

function stockProgram() {
	const parsed = tss.getParsedCommandLineOfConfigFile(path.join(dir, 'tsconfig.json'), {}, {
		...tss.sys,
		onUnRecoverableConfigFileDiagnostic: d => { throw new Error(tss.flattenDiagnosticMessageText(d.messageText, ' ')); },
	});
	return { program: tss.createProgram(parsed.fileNames, parsed.options), close: () => {} };
}

// Diagnostics as `TS<code>: <flattened message>`, sorted — the two engines are
// free to order the same set differently.
function diagnostics(ts, program, file) {
	return program.getSemanticDiagnostics(program.getSourceFile(file))
		.map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' | ')}`)
		.sort();
}

// The type of `n.content` at its narrowed use site, printed. Pre-fix this is
// where the unsubstituted `$InferObjectOutput<Shape, Config["out"]>` surfaces.
function contentTypeString(ts, program, file) {
	const checker = program.getTypeChecker();
	const sf = program.getSourceFile(file);
	let found;
	(function walk(node) {
		if (found === undefined
			&& ts.isPropertyAccessExpression(node)
			&& node.name.getText(sf) === 'content'
			&& ts.isCallExpression(node.parent)) {
			found = checker.typeToString(checker.getTypeAtLocation(node));
		}
		node.forEachChild(walk);
	})(sf);
	return found;
}

provision();

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const tnb = tnbProgram();
const stock = stockProgram();

const tnbDiags = diagnostics(tsb, tnb.program, entry);
const stockDiags = diagnostics(tss, stock.program, entry);

check(stockDiags.length === 0, `stock reports ${stockDiags.length} diagnostics on the fixture — the fixture, not the engine, is broken:\n    ${stockDiags.join('\n    ')}`);
check(
	tnbDiags.join('\n') === stockDiags.join('\n'),
	`semantic diagnostics diverge from stock\n  tnb:\n    ${tnbDiags.join('\n    ') || '(none)'}\n  stock:\n    ${stockDiags.join('\n    ') || '(none)'}`,
);

const tnbType = contentTypeString(tsb, tnb.program, entry);
const stockType = contentTypeString(tss, stock.program, entry);
check(stockType !== undefined && tnbType !== undefined, `could not locate the \`n.content\` argument (tnb=${tnbType}, stock=${stockType}) — the fixture drifted`);
check(tnbType === stockType, `\`n.content\` type diverges from stock\n  tnb:   ${tnbType}\n  stock: ${stockType}`);
// Belt and braces: a type parameter name in a resolved type is the fingerprint
// of a dropped mapper, whatever stock happens to print.
check(
	!/\bShape\b|\bConfig\b/.test(tnbType ?? ''),
	`\`n.content\` carries unsubstituted type parameters — links.mapper was not applied: ${tnbType}`,
);

tnb.close();
stock.close();

if (failures.length) {
	console.error('FAIL');
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`ok instsymbol-target-guard: self-referencing zod@${ZOD_VERSION} schema infers ${tnbType} with 0 diagnostics, equal to stock (fork ${tsb.version})`);
