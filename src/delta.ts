import * as assert from 'assert';

import { EncodingWriter, WriteStream } from './encode_binast';

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
        this.buffer = Array((1 << numCellBits - 1) - 1).fill(0);
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
        const smallValue = 1 << numDeltaBits - 2;

        // If the value is small enough to be written as a one-byte
        // literal, do that.
        if (v < smallValue) {
            this.buffer.splice(this.buffer.length - 1, 1);
            this.buffer.splice(0, 0, v);
            return this.w.writeByte(v);
        }

        // Find the smallest delta.
        const numCells = (1 << this.numCellBits - 1) - 1;
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
                byte = v & (1 << BITS_PER_BYTE) - 1;
                v >>= BITS_PER_BYTE - 1;
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
                minI + 1 << numDeltaBits |
                delta & (1 << numDeltaBits) - 1;
            return this.w.writeByte(byte);
        }
    }
}
