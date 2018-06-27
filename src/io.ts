import * as assert from 'assert';
import { TextDecoder } from 'util';

export interface ReadStream {
    readByte(): number;
    readBytes(n: number): Uint8Array;
    readUtf8Bytes(n: number): string;
    readVarUint(): number;
}


export class ArrayStream {
    readonly buffer: Uint8Array;
    offset: number;

    constructor(buffer: Uint8Array) {
        this.buffer = buffer;
        this.offset = 0;
    }

    readByte(): number {
        return this.buffer[this.offset++];
    }

    readBytes(n: number): Uint8Array {
        assert(Number.isInteger(n));
        assert(0 <= n);
        let result = this.buffer.slice(this.offset, this.offset + n);
        let overread = n - result.length;
        if (overread) {
            throw new Error(`read ${overread} bytes past end of input`);
        }
        assert(result.byteLength === n,
            `wanted ${n} bytes but got ${result.byteLength}`);
        this.offset += n;
        return result;
    }

    readUtf8Bytes(n: number): string {
        assert(Number.isInteger(n));
        assert(0 <= n);
        return new TextDecoder('utf-8').decode(this.readBytes(n));
    }

    readVarUint(): number {
        let result = 0;
        let i = 0;
        let byte;
        do {
            byte = this.readByte();
            result |= (byte & 0x7f) << i;
            i += 7;
        } while ((byte & 0x80) === 0x80);
        return result;
    }
}
