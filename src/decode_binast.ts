import { TextDecoder } from 'util';

import { ReadStream } from './io';

export class Decoder {
    readonly r: ReadStream;
    strings: string[];
    grammar: Map<string, string[]>;

    constructor(readStream: ReadStream) {
        this.r = readStream;
    }

    decode() {
        this.strings = this.decodeStringTable();
        this.grammar = this.decodeGrammar();
    }

    decodeStringTable(): string[] {
        // Number of strings.
        let n = this.r.readVarUint();

        // Length of each string, bytes.
        let lengthBytes = Array(n);
        for (let i = 0; i < n; i++) {
            lengthBytes[i] = this.r.readVarUint();
        }

        // String data.
        let stringDecoder = new TextDecoder('utf-8');
        let strings = Array(n);
        for (let i = 0; i < n; i++) {
            strings[i] = stringDecoder.decode(this.r.readBytes(lengthBytes[i]));
        }

        return strings;
    }

    decodeGrammar(): Map<string, string[]> {
        let length = this.r.readVarUint();
        return JSON.parse(this.r.readUtf8Bytes(length));
    }
}
