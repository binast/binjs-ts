import * as assert from 'assert';
import { Writable } from 'stream';
import { TextDecoder, TextEncoder } from 'util';

import { rewriteAst } from './ast_util';
import { Grammar } from './grammar';
import * as S from './schema';

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

    writeByte(b: number) {
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

    writeArray(bs: Array<number>) {
        for (const b of bs) {
            this.writeByte(b);
        }
        return bs.length;
    }
    writeUint8Array(bs: Uint8Array) {
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
        let floatBuf = new Float32Array([f]);
        let intBuf = new Uint8Array(floatBuf.buffer);
        let n = this.writeArray([
            intBuf[0], intBuf[1], intBuf[2], intBuf[3]
        ]);
        assert(n === 4, `should have written a four-byte float, was ${n}`);
        return 4;
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
        assert(Number.isInteger(uval));
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

export enum BuiltInTags {
    NULL = 0,
    UNDEFINED = 1,
    STRING = 2,
    NUMBER = 3,
    TRUE = 4,
    FALSE = 5,
    SUBTREE = 6,
    LIST = 7,

    FIRST_GRAMMAR_NODE = 7,
}

export class Encoder {
    readonly script: S.Script;
    readonly stringTable: StringTable;
    readonly writeStream: WriteStream;
    readonly w: EncodingWriter;
    grammar: Grammar;

    constructor(params: {
        script: S.Script,
        stringTable: StringTable,
        writeStream: WriteStream
    }) {
        this.script = params.script;
        this.stringTable = params.stringTable;
        this.writeStream = params.writeStream;
        this.w = new EncodingWriter(this.writeStream);
        this.grammar = null;
    }

    public encode(): void {
        this.encodeGrammar();
        this.encodeStringTable();
        this.encodeAbstractSyntax();
    }

    encodeStringTable() {
        this.w.writeVarUint(this.stringTable.strings.length);
        let stringData = [];
        this.stringTable.eachString((s: string) => {
            const encBytes = new TextEncoder().encode(s);
            assert(new TextDecoder('utf-8').decode(encBytes) === s);
            stringData.push(encBytes);
            // Note, this is *bytes* and not characters. This lets the
            // decoder skip chunks of the string table if it wants.
            const len = encBytes.length;
            this.w.writeVarUint(len);
        });
        stringData.forEach((encBytes: Uint8Array) => {
            this.w.writeUint8Array(encBytes);
        });
    }

    encodeGrammar() {
        this.grammar = new Grammar();
        this.grammar.visit(this.script);
        assert(this.grammar.rules.has('Script'),
            'should have a grammar rule for top-level scripts');
        // TODO: Encode this in a better order and not as JSON.
        let cheesyGrammar = {};
        for (let [key, value] of this.grammar.rules.entries()) {
            cheesyGrammar[key] = value;
        }
        let bytes =
            new TextEncoder().encode(JSON.stringify(cheesyGrammar));

        this.w.writeVarUint(bytes.length);
        this.w.writeUint8Array(bytes);
    }

    encodeAbstractSyntax(): void {
        let visit = (node) => {
            if (node === null) {
                this.w.writeVarUint(BuiltInTags.NULL);
            } else if (node === undefined) {
                this.w.writeVarUint(BuiltInTags.UNDEFINED);
            } else if (node instanceof Array) {
                this.w.writeVarUint(BuiltInTags.LIST);
                this.w.writeVarUint(node.length);
                for (let i = 0; i < node.length; i++) {
                    visit(node[i]);
                }
            } else if (node !== null && typeof node == 'object') {
                let kind = node.constructor.name;
                //console.log(kind);
                this.w.writeVarUint(BuiltInTags.FIRST_GRAMMAR_NODE +
                    this.grammar.index(kind));
                for (let property of this.grammar.rules.get(kind)) {
                    //console.log('  ', property);
                    visit(node[property]);
                }
            } else if (typeof node == 'string') {
                // TODO(dpc): Are strings part of a union? If not we
                // should not tag strings.
                this.w.writeVarUint(BuiltInTags.STRING);
                // TODO(dpc): Write this in a separate stream.
                this.w.writeVarUint(this.stringTable.stringIndex(node));
            } else if (typeof node == 'number') {
                this.w.writeVarUint(BuiltInTags.NUMBER);
                // TODO(dpc): Write this in a separate stream.
                this.w.writeFloat(node);
            } else if (typeof node == 'boolean') {
                this.w.writeVarUint(
                    node ? BuiltInTags.TRUE : BuiltInTags.FALSE);
            } else {
                throw new Error(`unknown node type ${typeof node}: ${node}`);
            }
        };
        visit(this.script);
    }
}
