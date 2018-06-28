import * as assert from 'assert';
import { TextDecoder } from 'util';

export interface ReadStream {
    readByte(): number;
    readBytes(n: number): Uint8Array;
    readUtf8Bytes(n: number): string;
    readVarUint(): number;
}


type LogRecord = 'byte' | 'bytes' | 'utf8' | 'varuint';


class ReplayStream implements ReadStream {
    readonly log: any[];
    i: number;

    constructor(log: any[]) {
        this.log = log;
        this.i = 0;
    }

    readByte(): number {
        return this.replay<number>('byte');
    }

    readBytes(n: number): Uint8Array {
        return this.replay<Uint8Array>('bytes', n).slice();
    }

    readUtf8Bytes(n: number): string {
        return this.replay<string>('utf8', n);
    }

    readVarUint(): number {
        return this.replay<number>('varuint');
    }

    private replay<T>(label: LogRecord, opt_argument?: number): T {
        let [what, value, arg] = this.log[this.i++];
        if (what !== label) {
            throw new Error(`replaying stream expected to read ${what} but asked to read ${label}`);
        }
        if (arg !== opt_argument) {
            throw new Error(`replaying stream expected to read ${arg} ${what} but asked to read ${opt_argument}`);
        }
        return value as T;
    }
}

// This forks a ReadStream and records its content to replay it later.
export class ReadStreamRecorder implements ReadStream {
    readonly log: [LogRecord, any, number][];
    r: ReadStream;

    constructor(r: ReadStream) {
        this.log = [];
        this.r = r;
    }

    replay(): ReadStream {
        assert(this.r === null, 'stream should be detached first');
        return new ReplayStream(this.log);
    }

    detach(): this {
        this.r = null;
        return this;
    }

    readByte(): number {
        return this.record<number>('byte', this.r.readByte());
    }

    readBytes(n: number): Uint8Array {
        return this.record<Uint8Array>('bytes', this.r.readBytes(n), n);
    }

    readUtf8Bytes(n: number): string {
        return this.record<string>('utf8', this.r.readUtf8Bytes(n), n);
    }

    readVarUint(): number {
        return this.record<number>('varuint', this.r.readVarUint());
    }

    private record<T>(label: LogRecord, value: T, opt_argument?: number): T {
        this.log.push([label, value, opt_argument]);
        return value;
    }
}


export class ArrayStream implements ReadStream {
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
