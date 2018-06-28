import * as assert from 'assert';

import { EncodingWriter, WriteStream } from './encode_binast';
import { ReadStream } from './io';

export class DeltaWriter {
    private readonly w: EncodingWriter;
    private last: number = 0;

    constructor(w: EncodingWriter) {
        this.w = w;
    }

    write(d: number): number {
        assert(Number.isInteger(d), 'must be an integer');
        let delta = d - this.last;
        this.last = d;
        return this.w.writeVarInt(delta);
    }
}

const BITS_PER_BYTE = 8;

// The encoding scheme for this MruDeltaEncoder(2):
// h.o. bits  l.o. bits
// 00         0 <5-bit unsigned value>
// 00         1 <multi-byte varint, these are the l.o. 5 bits> <more bytes>
// 01         6-bit signed (2-complement) delta to MRU cell 0
// 10         6-bit signed delta to MRU cell 1
// 11         6-bit signed delta to MRU cell 2
export class MruDeltaWriter {
    private readonly numCellBits: number;
    private readonly w: WriteStream;
    private buffer: number[];

    constructor(numCellBits: number, w: WriteStream) {
        assert(0 <= numCellBits && numCellBits < 6);

        this.numCellBits = numCellBits;
        // TODO(dpc): Consider pre-populating this to put a bunch of
        // non-literals in the range of initial deltas.
        this.buffer = Array((1 << numCellBits) - 1).fill(0);
        this.w = w;
    }

    writeUint(v: number): number {
        assert(0 <= v);
        assert(Number.isInteger(v));
        // Any bits not used to pick the MRU cell are used to store
        // deltas (or the start of a value.)
        const numDeltaBits = BITS_PER_BYTE - this.numCellBits;
        // This is used as the limit for a small signed delta value or
        // an unsigned value with a reserved bit for continuation.
        const smallValue = 1 << (numDeltaBits - 1);

        // If the value is small enough to be written as a one-byte
        // literal, do that; don't add the value to the MRU.
        if (v < smallValue) {
            return this.w.writeByte(v);
        }

        // Find the smallest delta.
        const numCells = (1 << this.numCellBits) - 1;
        let minI = null;
        let minDelta = +Infinity;
        this.buffer.forEach((oldValue, i) => {
            const delta = v - oldValue;
            if (-smallValue <= delta &&
                delta < smallValue - 1 &&
                Math.abs(delta) < minDelta) {
                minDelta = Math.abs(delta);
                minI = i;
            }
        });

        // If there's no delta within range, write an unsigned literal.
        if (minI === null) {
            this.buffer.splice(this.buffer.length - 1, 1);
            this.buffer.splice(0, 0, v);

            let done;
            let byte = v & (1 << numDeltaBits - 1) - 1;
            v >>= numDeltaBits - 1;
            if (v) {
                byte |= 1 << numDeltaBits - 1;
            }
            let n = this.w.writeByte(byte);
            while (v) {
                byte = v & 0x7f;
                v >>= 7;
                if (v) {
                    byte |= 0x80;
                }
                n += this.w.writeByte(byte);
            }
            return n;
        }

        // There is a delta in range, so write it.
        {
            let delta = v - this.buffer[minI];
            assert(-smallValue <= delta && delta < smallValue - 1);

            // Shuffle the used MRU cell to the front.
            this.buffer.splice(minI, 1);
            this.buffer.splice(0, 0, v);

            let byte =
                (minI + 1) << numDeltaBits |
                (delta & ((1 << numDeltaBits) - 1));
            return this.w.writeByte(byte);
        }
    }
}

export class MruDeltaReader {
    private readonly numCellBits: number;
    private readonly r: ReadStream;
    private buffer: number[];

    constructor(numCellBits: number, r: ReadStream) {
        assert(numCellBits == 2, 'this reader is hard-coded for two cell bits');
        this.r = r;
        this.buffer = Array((1 << numCellBits) - 1).fill(0);
    }

    readUint(): number {
        let b = this.r.readByte();
        assert(!Number.isNaN(b));
        let cell = (b & 0xc0) >> 6;
        let value = b & 0x3f;

        if (cell === 0) {
            if ((value & 0x20) === 0) {
                // Small literal unsigned int.
                assert(!Number.isNaN(value), 'small value');
                return value;
            }
            // Multi-byte literal unsigned int.
            value &= 0x1f;
            let shift = 5;
            let more_bits;
            do {
                b = this.r.readByte();
                more_bits = b & 0x80;
                value |= (b & 0x7f) << shift;
                shift += 7;
            } while (more_bits);
            this.buffer.splice(this.buffer.length - 1, 1);
            this.buffer.splice(0, 0, value);
            assert(!Number.isNaN(value), 'multi-byte value');
            return value;
        }

        // Delta from the cell-th item.
        cell--;
        //console.log(`delta from cell ${cell}, cells=${this.buffer}, delta=${value}`);
        assert(0 <= cell && cell < 3);

        if (value & 0x20) {
            // Value is negative.
            value ^= 0x3f;
            value++;
            value = -value;
        }
        value += this.buffer[cell];

        assert(!Number.isNaN(value), `delta value, cell #${cell}, cells=${this.buffer}`);

        if (cell == 0) {
            this.buffer[0] = value;
        } else {
            // Shuffle this cell to the head of the list.
            this.buffer.splice(cell, 1);
            this.buffer.splice(0, 0, value);
        }

        return value;
    }
}
