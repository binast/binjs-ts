import * as assert from 'assert';

import { EncodingWriter } from './encode_binast';

export class DeltaWriter {
    private readonly w: EncodingWriter;
    private last: number = 0;

    constructor(w: EncodingWriter) {
        this.w = w;
    }

    write(d: number): number {
        assert(Math.floor(d) === d, 'must be an integer');
        let delta = d - this.last;
        this.last = d;
        return this.w.writeVarInt(delta);
    }
}
