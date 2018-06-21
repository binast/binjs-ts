import * as assert from 'assert';
import { Writable } from 'stream';

import { DeltaWriter } from './delta';
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
        // assert((0 <= b) && (b < 256));
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

    writeString(s: string): number {
        return this.writeVarUint(s.length) +
            this.writeUint8Array(util.jsStringToUtf8Bytes(s));
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
    readonly encWriter: EncodingWriter;

    constructor(params: {
        script: S.Script,
        stringTable: StringTable,
        writeStream: WriteStream
    }) {
        this.script = params.script;
        this.stringTable = params.stringTable;
        this.writeStream = params.writeStream;
        this.encWriter = new EncodingWriter(this.writeStream);
    }

    encodeStringTable(): number {
        const ws = this.encWriter;
        let written = 0;
        let delta = new DeltaWriter(ws);
        let stringData = [];
        this.stringTable.eachString((s: string) => {
            const encBytes = util.jsStringToUtf8Bytes(s);
            stringData.push(encBytes);
            // Note, this is *bytes* and not characters. This lets the
            // decoder skip chunks of the string table if it wants.
            const len = encBytes.length;
            written += delta.write(len);
        });
        stringData.forEach((encBytes: Uint8Array) => {
            written += ws.writeUint8Array(encBytes);
        });
        return written;
    }
}
