import { TextDecoder } from 'util';

import { rewriteAst } from './ast_util';
import { Grammar } from './grammar';
import { ReadStream } from './io';
import * as S from './schema';

export class Decoder {
    readonly r: ReadStream;
    public strings: string[];
    public grammar: Grammar;
    public script: S.Script;

    constructor(readStream: ReadStream) {
        this.r = readStream;
    }

    public decode(): void {
        this.grammar = this.decodeGrammar();
        this.strings = this.decodeStringTable();
        this.script = this.decodeAbstractSyntax();
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

    decodeGrammar(): Grammar {
        let length = this.r.readVarUint();
        let rules = JSON.parse(this.r.readUtf8Bytes(length));
        return new Grammar(rules);
    }

    decodeAbstractSyntax(): S.Script {
        throw new Error('nyi');
    }
}
