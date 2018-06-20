
import * as assert from 'assert';

import * as S from './schema';
import * as util from './util';

export interface WriteStream {
    writeByte(b: number): number;
    writeArray(bs: Array<number>): number;
    writeUint8Array(bs: Uint8Array): number;
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
        // assert((0 <= b) && (b < 128));
        const idx = this.curOffset++;
        this.cur[idx] = b;
        if (idx == this.cur.length) {
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
}

export class EncodingWriter {
    readonly stream: WriteStream;

    constructor(stream) {
        this.stream = stream;
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
        // ASSERT: Number.isInteger(uval);
        // ASSERT: uval >= 0;
        // ASSERT: uval <= 0xFFFFFFFF

        // 7-bit number.
        if (uval < 0x80) {
            this.writeByte(uval);
            return 1;
        }

        // 14-bit number.
        if (uval < 0x4000) {
            this.writeByte(uval & 0x7F);
            this.writeByte((uval >> 7) & 0x7F);
            return 2;
        }

        // 21-bit number.
        if (uval < 0x200000) {
            this.writeByte(uval & 0x7F);
            this.writeByte((uval >> 7) & 0x7F);
            this.writeByte((uval >> 14) & 0x7F);
            return 3;
        }

        // 28-bit number.
        if (uval < 0x10000000) {
            this.writeByte(uval & 0x7F);
            this.writeByte((uval >> 7) & 0x7F);
            this.writeByte((uval >> 14) & 0x7F);
            this.writeByte((uval >> 21) & 0x7F);
            return 4;
        }

        assert(uval < 0x10000000, `Value ${uval} out of range`);
    }

    writeString(s: string): number {
        return this.writeVarUint(s.length) +
               this.writeUint8Array(util.jsStringToUtf8Bytes(s));
    }
}

export class Table<T> {
    // Array of all strings in order
    readonly vals: Array<T>;

    // Map of each string to its array index.
    readonly table: Map<T, number>;

    constructor(vals: Array<T>) {
        this.vals = vals;

        const table: Map<T, number> = new Map();
        vals.forEach((s: T, i: number) => {
            table.set(s, i);
        });
        this.table = table;
    }

    index(v: T): number {
        const r: number = this.table.get(v);
        assert(Number.isInteger(r));
        return r;
    }

    each(cb: (str: T, i?: number) => void) {
        this.vals.forEach(cb);
    }
}

export class Encoder {
    readonly script: S.Script;
    readonly stringTable: Table<string>;
    readonly nodeKindTable: Table<S.BaseNode>;
    readonly writeStream: WriteStream;
    readonly encWriter: EncodingWriter;

    constructor(params: {script: S.Script,
                         stringTable: Table<string>,
                         nodeKindTable: Table<S.BaseNode>,
                         writeStream: WriteStream})
    {
        this.script = params.script;
        this.stringTable = params.stringTable;
        this.nodeKindTable = params.nodeKindTable;
        this.writeStream = params.writeStream;
        this.encWriter = new EncodingWriter(this.writeStream);
    }

    encodeStringTable(): number {
        const ws = this.encWriter;
        let written = 0;
        this.stringTable.each((s: string) => {
            const len = s.length;
            const encBytes = util.jsStringToUtf8Bytes(s);
            written += ws.writeVarUint(len);
            written += ws.writeUint8Array(encBytes);
        });
        return written;
    }
}
