import { expect } from 'chai';
import { describe, it } from 'mocha';

import { DeltaWriter, MruDeltaReader, MruDeltaWriter } from './delta';

import { FixedSizeBufStream, EncodingWriter } from './encode_binast';
import { ArrayStream } from './io';

describe('DeltaWriter', () => {
    it('should write successive values as deltas', () => {
        let w = new FixedSizeBufStream();
        let d = new DeltaWriter(new EncodingWriter(w));
        d.write(1025);
        expect(w.size).to.equal(2); // 11 bits fits in 7+7 bits
        expect(w.cur[0]).to.equal(0x81);
        expect(w.cur[1]).to.equal(0x08);
        d.write(1025);
        expect(w.size).to.equal(3); // delta 0 should fit in one byte
        expect(w.cur[2]).to.equal(0);
    });
    it('should write negative deltas', () => {
        let w = new FixedSizeBufStream();
        let d = new DeltaWriter(new EncodingWriter(w));
        d.write(1023);
        expect(w.size).to.equal(2); // 10 bits fits in 7+7 bits
        expect(w.cur[0]).to.equal(0xff);
        expect(w.cur[1]).to.equal(0x07);
        d.write(0);
        expect(w.size).to.equal(4); // -1023 delta fits in 7 + 7 bits
        expect(w.cur[2]).to.equal(0x81);
        expect(w.cur[3]).to.equal(0x78);
    });
});

describe('MruDeltaWriter', () => {
    it('should write small values as compact literals', () => {
        let w = new FixedSizeBufStream();
        let d = new MruDeltaWriter(2, w);
        d.writeUint(31);
        expect(w.size).to.equal(1);
        expect(w.cur[0]).to.equal(31);
    });
    it('should write other values as multi-byte literals', () => {
        let w = new FixedSizeBufStream();
        let d = new MruDeltaWriter(2, w);
        d.writeUint(32);
        expect(w.size).to.equal(2);
        expect(w.cur[0]).to.equal(32);
        expect(w.cur[1]).to.equal(1);
    });
    it('should write duplicate, large values as zero deltas', () => {
        let w = new FixedSizeBufStream();
        let d = new MruDeltaWriter(2, w);
        d.writeUint(1234);
        expect(w.size).to.equal(2); // 11 bits fits in 5 + 7 bits
        d.writeUint(1234);
        expect(w.size).to.equal(3);
        expect(w.cur[2]).to.equal(0x40); // 0x40 => MRU cell 0, delta 0
    });
    it('should write similar large values as signed deltas', () => {
        let w = new FixedSizeBufStream();
        let d = new MruDeltaWriter(2, w);
        d.writeUint(1234);
        expect(w.size).to.equal(2); // 11 bits fits in 5 + 7 bits
        d.writeUint(1233);
        expect(w.size).to.equal(3);
        expect(w.cur[2]).to.equal(0x7f); // 0x40 => MRU cell 0, delta -1
    });
    // TODO(dpc): More tests, that shuffling works, boundaries for ranges.
});

function writeRead(values: number[]): number[] {
    let w = new FixedSizeBufStream();
    let d = new MruDeltaWriter(2, new EncodingWriter(w));
    for (let value of values) {
        d.writeUint(value);
    }

    let r = new MruDeltaReader(2, new ArrayStream(w.cur));
    let out = [];
    for (let i = 0; i < values.length; i++) {
        out.push(r.readUint());
    }
    return out;
}

describe('MruDeltaReader', () => {
    it('should read large values', () => {
        let values = [65535];
        expect(writeRead(values)).to.deep.equal(values);
    });

    it('should read the values with small constants', () => {
        let values = [0, 1, 3, 2, 0, 30, 31];
        expect(writeRead(values)).to.deep.equal(values);
    });

    it('should read the values with small deltas', () => {
        let values = [1000, 1001, 1002, 1005];
        expect(writeRead(values)).to.deep.equal(values);
    });

    it('should read the values with negative deltas', () => {
        let values = [1100, 1095];
        expect(writeRead(values)).to.deep.equal(values);
    });

    it('should read some random values', () => {
        let values = [1e4, 7, 8000, 1 << 30, 1 << 30 - 1, 1 << 100, 1 << 30, 2, 1, 0, 33, 32, 31, 1234567, 0x8000002, 0x7000001];
        expect(writeRead(values)).to.deep.equal(values);
    });
});
