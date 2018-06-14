
import * as assert from 'assert';

import * as S from './schema';

export interface WriteStream {
    writeByte(b: number): number;
    writeArray(bs: Array<number>): number;

    writeVarUint(uval: number): number;
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

    writeVarUint(uval: number) {
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
        assert(Number.isInteger(r));
        return r;
    }

    eachString(cb: (str: string, i?: number) => void) {
        this.strings.forEach(cb);
    }
}

export class Encoder {
    readonly script: S.Script;
    readonly stringTable: StringTable;
    readonly writeStream: WriteStream;

    constructor(params: {script: S.Script,
                         stringTable: StringTable,
                         writeStream: WriteStream})
    {
        this.script = params.script;
        this.stringTable = params.stringTable;
        this.writeStream = params.writeStream;
    }

    encodeStringTable(): number {
        const ws = this.writeStream;
        let written = 0;
        this.stringTable.eachString((s: string) => {
            const len = s.length;
            written += ws.writeVarUint(len);
            for (let i = 0; i < s.length; i++) {
                const cc = s.charCodeAt(i);
                // TODO: implement UTF-8 encoding.
                /*
                if ((cc >= 0xD800) && (cc < 0xDC00)) {
                    throw new Error(`Invalid character ${cc}`);
                }
                */
                if (cc < 0x80) {
                    written += ws.writeByte(cc);
                    continue;
                }
                if (cc < 0x800) {
                    written += ws.writeByte(((cc >> 6) & 0x1F) | 0xC0);
                    written += ws.writeByte((cc & 0x3F) | 0x8);
                    continue;
                }

                written += ws.writeByte(((cc >> 12) & 0x0F) | 0xE0);
                written += ws.writeByte(((cc >> 6) & 0x3F) | 0x80);
                written += ws.writeByte((cc & 0x3F) | 0x80);
            }
        });
        return written;
    }
}
