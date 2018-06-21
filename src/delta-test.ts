import { expect } from 'chai';
import { describe, it } from 'mocha';

import { DeltaWriter, MruDeltaWriter } from './delta';

import { FixedSizeBufStream, EncodingWriter } from './encode_binast';

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
