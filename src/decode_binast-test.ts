import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ArrayStream } from './io';
import { Decoder } from './decode_binast';

function ascii(ch) {
    return ch.charCodeAt(0);
}

describe('Decoder', () => {
    it('should be able to read the string table', () => {
        let r = new ArrayStream(new Uint8Array([
            2, 2, 5,
            0x68, 0x69,
            0x74, 0x68, 0x65, 0x72, 0x65
        ]));
        let decoder = new Decoder(r);
        let strings = decoder.decodeStringTable();
        expect(strings).to.deep.equal(['hi', 'there']);
    });
});
