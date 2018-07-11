import * as assert from 'assert';
import { Writable } from 'stream';
import { TextDecoder, TextEncoder } from 'util';

import * as S from './schema';
import * as tr from './treerepair';
import { Grammar } from './grammar';
import { MruDeltaWriter } from './delta';
import { rewriteAst } from './ast_util';

// TODO(dpc): Rename this because it overlaps with fs.WriteStream.
export interface WriteStream {
    writeByte(b: number): number;
    writeArray(bs: Array<number>): number;
    writeUint8Array(bs: Uint8Array): number;
    // Writes a string *without a length prefix*.
    writeUtf8String(s: string): number;
}

const FIXED_SIZE: number = 0x10000;

export class FixedSizeBufStream implements WriteStream {
    readonly priors: Array<Uint8Array>;
    priorSize: number;

    cur: Uint8Array;
    curOffset: number;

    constructor() {
        this.priors = new Array();
        this.priorSize = 0;
        this.resetCurrent();
    }

    private resetCurrent() {
        this.cur = new Uint8Array(FIXED_SIZE);
        this.curOffset = 0;
    }

    get size(): number {
        return this.priorSize + this.curOffset;
    }

    writeByte(b: number): number {
        // assert(this.curOffset < this.cur.length)
        // assert(Number.isInteger(b));
        // assert((0 <= b) && (b < 256));
        const idx = this.curOffset++;
        this.cur[idx] = b;
        if (this.curOffset == this.cur.length) {
            this.priors.push(this.cur);
            this.priorSize += this.cur.length;
            this.resetCurrent();
        }
        return 1;
    }

    writeArray(bs: Array<number>): number {
        for (const b of bs) {
            this.writeByte(b);
        }
        return bs.length;
    }

    writeUint8Array(bs: Uint8Array): number {
        for (const b of bs) {
            this.writeByte(b);
        }
        return bs.length;
    }

    /**
     * Writes the accumulated output to a Writable.
     * @returns The number of bytes written to `s`.
     */
    copyToWritable(s: Writable): number {
        let bytes_written = 0;
        for (const buffer of this.priors) {
            s.write(buffer);
            bytes_written += buffer.length;
        }
        if (this.curOffset) {
            s.write(this.cur.slice(0, this.curOffset));
            bytes_written += this.curOffset;
        }
        return bytes_written;
    }

    copyToWriteStream(s: WriteStream): number {
        let bytes_written = 0;
        for (const buffer of this.priors) {
            s.writeUint8Array(buffer);
            bytes_written += buffer.length;
        }
        if (this.curOffset) {
            s.writeUint8Array(this.cur.slice(0, this.curOffset));
            bytes_written += this.curOffset;
        }
        return bytes_written;
    }

    writeUtf8String(s: string): number {
        return this.writeUint8Array(new TextEncoder().encode(s));
    }
}

export class EncodingWriter {
    readonly stream: WriteStream;

    constructor(stream) {
        this.stream = stream;
    }

    writeFloat(f: number): number {
        let floatBuf = new Float64Array([f]);
        let intBuf = new Uint8Array(floatBuf.buffer);
        let n = this.writeArray([
            intBuf[0], intBuf[1], intBuf[2], intBuf[3],
            intBuf[4], intBuf[5], intBuf[6], intBuf[7]
        ]);
        assert(n === 8, `should have written a eight-byte float, was ${n}`);
        return 8;
    }

    writeByte(b: number): number {
        return this.stream.writeByte(b);
    }

    writeArray(bs: Array<number>): number {
        return this.stream.writeArray(bs);
    }

    writeUint8Array(bs: Uint8Array): number {
        return this.stream.writeUint8Array(bs);
    }

    writeVarUint(uval: number): number {
        assert(Number.isInteger(uval), `not an integer: ${uval}`);
        assert(0 <= uval);
        let n = 0;
        do {
            let byte = uval & 0x7f;
            uval >>= 7;
            byte |= uval ? 0x80 : 0;
            n += this.writeByte(byte);
        } while (uval);
        return n;
    }

    writeVarInt(val: number): number {
        assert(Math.floor(val) === val, 'must be an integer');
        let n = 0;
        let done;
        do {
            done = -64 <= val && val <= 63;
            this.writeByte((done ? 0 : 1) << 7 | val & 0x7f);
            n++;
            val >>= 7;
        } while (!done);
        return n;
    }

    writeUtf8String(s: string): number {
        return this.stream.writeUtf8String(s);
    }
}

export class StringTable {
    // Array of all strings in order
    readonly strings: Array<string>

    // Map of each string to its array index.
    readonly table: Map<string, number>;

    constructor(strings: Array<string>) {
        this.strings = strings;

        const table: Map<string, number> = new Map();
        strings.forEach((s: string, i: number) => {
            table.set(s, i);
        });
        this.table = table;
    }

    stringIndex(s: string): number {
        const r: number = this.table.get(s);
        assert(Number.isInteger(r), s);
        return r;
    }

    eachString(cb: (str: string, i?: number) => void) {
        this.strings.forEach(cb);
    }
}

class TreeRePairApplicator {
    // This is the JavaScript grammar, not the AST
    // meta-grammar.
    grammar: Grammar;

    // This is the TreeRePair meta-grammar.
    tr_grammar: tr.Grammar;

    // Primitive symbols.
    t_true: tr.Terminal;
    t_false: tr.Terminal;
    t_null: tr.Terminal;
    t_undefined: tr.Terminal;

    // Primitive symbols used for encoding arrays.
    t_cons: tr.Terminal;
    t_nil: tr.Terminal;

    // Grammar production symbols.
    t_kind: Map<string, tr.Terminal>;

    // Literals.
    t_numbers: Map<number, { count: number, terminal: tr.Terminal }>;
    t_strings: Map<string, { count: number, terminal: tr.Terminal }>;

    constructor(g: Grammar) {
        this.grammar = g;
        this.t_true = new tr.Terminal(0);
        this.t_false = new tr.Terminal(0);
        this.t_null = new tr.Terminal(0);
        this.t_undefined = new tr.Terminal(0);
        this.t_numbers = new Map();
        this.t_strings = new Map();

        this.t_cons = new tr.Terminal(2);
        this.t_nil = new tr.Terminal(0);

        this.t_kind = new Map();
        for (let [rule, props] of g.rules) {
            let t = new tr.Terminal(props.length);
            this.t_kind.set(rule, t);
        }
    }

    apply(script: S.Script): void {
        const debug = false;
        let tree = this.build(script);
        let labels;
        if (debug) {
            labels = new Map([
                [this.t_true, 'true'],
                [this.t_false, 'false'],
                [this.t_null, 'null'],
                [this.t_undefined, 'undefined'],
                [this.t_cons, '<cons>'],
                [this.t_nil, '<nil>']
            ]);
            for (let [ctor, terminal] of this.t_kind) {
                labels.set(terminal, ctor);
            }
        }
        this.tr_grammar = new tr.Grammar(tree);
        this.tr_grammar.build();
        if (debug) {
            tr.check_grammar(this.tr_grammar);
            tr.check_tree(this.tr_grammar.tree);
            this.tr_grammar.debug_print(labels);

            for (let [num, t] of this.t_numbers) {
                labels.set(t.terminal, 'n:' + num);
            }
            let freq = new Map();
            for (let node of tr.pre_order(this.tr_grammar.tree)) {
                freq.set(node.label, 1 + (freq.get(node.label) || 0));
            }
            for (let body of this.tr_grammar.rules.values()) {
                for (let node of tr.pre_order(body)) {
                    freq.set(node.label, 1 + (freq.get(node.label) || 0));
                }
            }
            for (let [sym, count] of Array.from(freq).sort((a, b) => b[1] - a[1])) {
                if (!labels.has(sym)) {
                    if (sym instanceof tr.Parameter) {
                        labels.set(sym, 'parameter');
                    } else if (sym instanceof tr.Nonterminal) {
                        labels.set(sym, 'non-terminal');
                    }
                }
                console.log(labels.get(sym), count);
            }
        }
    }

    // Given a JavaScript AST node, translates it into TreeRePair
    // nodes.
    private build(node: any): tr.Node {
        if (node === true) {
            return new tr.Node(this.t_true);
        } else if (node === false) {
            return new tr.Node(this.t_false);
        } else if (node === null) {
            return new tr.Node(this.t_null);
        } else if (node === undefined) {
            // TODO: Remove. Never used?
            return new tr.Node(this.t_undefined);
        } else if (typeof node === 'string') {
            return new tr.Node(this.str(node));
        } else if (typeof node === 'number') {
            return new tr.Node(this.num(node));
        } else if (node instanceof Array) {
            let result = new tr.Node(this.t_nil);
            for (let i = node.length - 1; i >= 0; i--) {
                let tr_node = new tr.Node(this.t_cons);
                tr_node.appendChild(this.build(node[i]));
                tr_node.appendChild(result);
                result = tr_node;
            }
            return result;
        } else {
            let kind = node.constructor.name;
            let kind_symbol = this.t_kind.get(kind);
            if (!kind_symbol) {
                throw new Error(`missing symbol for "${kind}"`);
            }
            let tr_node = new tr.Node(kind_symbol);
            for (let property of this.grammar.rules.get(kind)) {
                tr_node.appendChild(this.build(node[property]));
            }
            return tr_node;
        }
    }

    private str(s: string): tr.Terminal {
        let t = this.t_strings.get(s);
        if (!t) {
            t = { count: 0, terminal: new tr.Terminal(0) };
            this.t_strings.set(s, t);
        }
        t.count++;
        return t.terminal;
    }

    private num(n: number): tr.Terminal {
        let t = this.t_numbers.get(n);
        if (!t) {
            t = { count: 0, terminal: new tr.Terminal(0) };
            this.t_numbers.set(n, t);
        }
        t.count++;
        return t.terminal;
    }
}

export class Encoder {
    readonly script: S.Script;
    readonly writeStream: WriteStream;
    readonly w: EncodingWriter;
    grammar: Grammar;

    constructor(params: {
        script: S.Script,
        writeStream: WriteStream
    }) {
        this.script = params.script;
        this.writeStream = params.writeStream;
        this.w = new EncodingWriter(this.writeStream);
        this.grammar = null;
    }

    public encode(): void {
        this.encodeGrammar();
        this.encodeAbstractSyntax();
    }

    encodeGrammar(): void {
        this.grammar = new Grammar();
        this.grammar.visit(this.script);
        assert(this.grammar.rules.has('Script'),
            'should have a grammar rule for top-level scripts');
        // TODO: Encode this in a better order
        let grammarNodes = [];
        for (let key of this.grammar.rules.keys()) {
            grammarNodes.push(new TextEncoder().encode(key));
        }

        this.w.writeVarUint(grammarNodes.length);
        for (let str of grammarNodes) {
            this.w.writeVarUint(str.length);
            this.w.writeUint8Array(str);
        }
    }

    encodeAbstractSyntax(): void {
        const debug = false;
        let applicator = new TreeRePairApplicator(this.grammar);
        applicator.apply(this.script);

        let symbol_code_map = new Map<tr.Symbol, number>();
        let debug_symbol_map = new Map<tr.Symbol, string>();
        let add_symbol = (symbol: tr.Symbol, label: string, value?: number): void => {
            assert(!symbol_code_map.has(symbol));
            symbol_code_map.set(symbol, value === undefined ? symbol_code_map.size : value);
            debug_symbol_map.set(symbol, label);
        };

        // Write: number of parameters.
        let parameters = new Set<tr.Parameter>();
        for (let symbol of applicator.tr_grammar.rules.keys()) {
            symbol.formals.forEach((p) => parameters.add(p));
        }
        const num_parameters = parameters.size;
        this.w.writeVarUint(num_parameters);
        for (let parameter of parameters) {
            add_symbol(parameter, 'param:0', 0);
        }

        assert(symbol_code_map.size === num_parameters);

        // Write: number of built-in symbols
        this.w.writeVarUint(6);
        // Symbols are enumerated in this order per format.
        add_symbol(applicator.t_nil, 'prim:nil');
        add_symbol(applicator.t_null, 'prim:null');
        add_symbol(applicator.t_cons, 'prim:cons');
        add_symbol(applicator.t_false, 'prim:false');
        add_symbol(applicator.t_true, 'prim:true');
        add_symbol(applicator.t_undefined, 'prim:undefined');

        // Write: number of meta-rules.
        let num_meta_rules = applicator.tr_grammar.rules.size;
        this.w.writeVarUint(num_meta_rules);
        // Assign the meta-rules.
        // TODO(dpc): Sort these by frequency.
        let i = 0;
        for (let symbol of applicator.tr_grammar.rules.keys()) {
            add_symbol(symbol, `rule:${i++}/${symbol.rank}`);
        }

        // Assign the grammar rules.
        for (let [name, rule] of applicator.t_kind) {
            add_symbol(rule, `node:${name}/${rule.rank}`);
        }

        // Write: number of strings; then their lengths; then values.
        this.w.writeVarUint(applicator.t_strings.size);
        let lexicographic = (a, b) => {
            if (a[0] < b[0]) {
                return -1;
            } else if (a[0] == b[0]) {
                throw Error('unreachable: the string table should intern strings');
            } else {
                return 1;
            }
        };
        let sorted_strings = Array.from(applicator.t_strings).sort(lexicographic);
        let string_bytes = Array(sorted_strings.length);
        let encoder = new TextEncoder();
        for (let [i, [str, symbol]] of sorted_strings.entries()) {
            const bytes = encoder.encode(str);
            // Note, this is *bytes* and not characters. This lets the
            // decoder skip chunks of the string table if it wants.
            this.w.writeVarUint(bytes.length);
            string_bytes[i] = bytes;
            add_symbol(symbol.terminal, `string:"${str}"`);
        }
        for (let bytes of string_bytes) {
            this.w.writeUint8Array(bytes);
        }

        // Write: number of numeric constants; then values.
        this.w.writeVarUint(applicator.t_numbers.size);
        for (let [value, symbol] of Array.from(applicator.t_numbers).sort((a, b) => b[1].count - a[1].count)) {
            this.w.writeFloat(value);
            add_symbol(symbol.terminal, `float:${value}`);
        }

        // Write the meta-rule lengths.
        const rule_bodies: FixedSizeBufStream[] = [];
        for (let [symbol, body] of applicator.tr_grammar.rules) {
            if (debug) {
                console.log(`${symbol_code_map.get(symbol)} : ${debug_symbol_map.get(symbol)} ::=`);
                tr.debug_print(debug_symbol_map, body);
            }

            const encoded = this.encodeRuleBody(symbol_code_map, body);
            this.w.writeVarUint(encoded.size);
            rule_bodies.push(encoded);
        }
        assert(rule_bodies.length == num_meta_rules);

        // Write the rules.
        for (let encoded of rule_bodies) {
            assert(encoded);
            encoded.copyToWriteStream(this.writeStream);
        }

        // Write the tree.
        let start_body = this.encodeRuleBody(symbol_code_map, applicator.tr_grammar.tree);
        if (debug) {
            console.log(`writing start production of ${start_body.size} bytes`);
        }
        this.w.writeVarUint(start_body.size);
        start_body.copyToWriteStream(this.writeStream);
        if (debug) {
            tr.debug_print(debug_symbol_map, applicator.tr_grammar.tree);
        }
    }

    writeTree(symbol_code_map: Map<tr.Symbol, number>, w: EncodingWriter, tree: tr.Node): void {
        for (let node of tr.pre_order(tree)) {
            let code = symbol_code_map.get(node.label);
            w.writeVarUint(code);
        }
    }

    encodeRuleBody(symbol_code_map: Map<tr.Symbol, number>, body: any): FixedSizeBufStream {
        let result = new FixedSizeBufStream();
        let writer = new EncodingWriter(result);
        this.writeTree(symbol_code_map, writer, body);
        return result;
    }
}
