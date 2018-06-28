
import * as assert from 'assert';

import * as util from './util';

export interface WriteStream {
    writeByte(b: number): number;
    writeArray(bs: Array<number>): number;
}

// TODO: Improve this to flush to a backing-list of Uint8Arrays.  Then
//       they can be iterated over efficiently, and concatenating
//       different streams would become much faster and easier on
//       the GC (e.g. when creating sub-streams for lazy elements which
//       need to be prefixed with their encoded length).
export class ArrayWriteStream implements WriteStream {
    array: Array<number>;
    
    constructor() {
        this.array = new Array<number>();
    }

    get size(): number {
        return this.array.length;
    }

    writeByte(b: number): number {
        this.array.push(b);
        return 1;
    }

    writeArray(bs: Array<number>): number {
        this.array.push(...bs);
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

    private writeNonTerminalByte(b: number) {
        // ASSERT: Number.isInteger(b) && (b >= 0) && (b < 128)
        this.writeByte(b | 0x80);
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
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeByte((uval >> 7) & 0x7F);
            return 2;
        }

        // 21-bit number.
        if (uval < 0x200000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeByte((uval >> 14) & 0x7F);
            return 3;
        }

        // 28-bit number.
        if (uval < 0x10000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeByte((uval >> 21) & 0x7F);
            return 4;
        }

        // 35-bit number.
        if (uval < 0x800000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeNonTerminalByte((uval >> 21) & 0x7F);
            this.writeByte((uval >> 28) & 0x7F);
            return 5;
        }

        // 42-bit number.
        if (uval < 0x40000000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeNonTerminalByte((uval >> 21) & 0x7F);
            this.writeNonTerminalByte((uval >> 28) & 0x7F);
            this.writeByte((uval >> 35) & 0x7F);
            return 6;
        }

        // 49-bit number.
        if (uval < 0x2000000000000) {
            this.writeNonTerminalByte(uval & 0x7F);
            this.writeNonTerminalByte((uval >> 7) & 0x7F);
            this.writeNonTerminalByte((uval >> 14) & 0x7F);
            this.writeNonTerminalByte((uval >> 21) & 0x7F);
            this.writeNonTerminalByte((uval >> 28) & 0x7F);
            this.writeByte((uval >> 35) & 0x7F);
            return 6;
        }

        assert(uval < 0x2000000000000, `Value ${uval} out of range`);
    }

    writeFloat(f: number): number {
        return this.writeInlineString(f.toString());
    }

    writeInlineString(s: string): number {
        const bytes = util.jsStringToWtf8Bytes(s);
        return this.writeVarUint(bytes.length) + this.writeArray(bytes);
    }
}

export class Table<T> {
    // Array of all values in order
    readonly vals: Array<T>;

    // Map of each value to its array index.
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
        assert(Number.isInteger(r), `No table entry for '${v}'`);
        return r;
    }

    each(cb: (str: T, i?: number) => void) {
        this.vals.forEach(cb);
    }

    get size(): number {
        return this.table.size;
    }
}

