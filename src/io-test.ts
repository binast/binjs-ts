import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ArrayStream } from './io';

describe('ArrayStream', () => {
    it('should be able to read a byte', () => {
        let r = new ArrayStream(new Uint8Array([42, 7]));
        expect(r.readByte()).to.equal(42);
        expect(r.readByte()).to.equal(7);
    });
});
