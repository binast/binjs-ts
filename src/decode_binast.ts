import * as assert from 'assert';
import { TextDecoder } from 'util';

import { rewriteAst } from './ast_util';
import { Grammar } from './grammar';
import { ArrayStream, ReadStream } from './io';
import * as S from './schema';
import { BuiltInTags } from './encode_binast';

export class Decoder {
    readonly r: ReadStream;
    public strings: string[];
    stringStream: ReadStream;
    public grammar: Grammar;
    public program: S.Program;

    constructor(r: ReadStream) {
        this.r = r;
    }

    public decode(): void {
        this.grammar = this.decodeGrammar();
        this.strings = this.decodeStringTable();
        this.prepareStringStream();
        this.program = this.decodeAbstractSyntax();
        // TODO(dpc): Should check that the string stream is exhausted.
    }

    decodeGrammar(): Grammar {
        let length = this.r.readVarUint();
        let rules = JSON.parse(this.r.readUtf8Bytes(length));
        return new Grammar(rules);
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

    prepareStringStream(): void {
        let lengthBytes = this.r.readVarUint();
        this.stringStream = new ArrayStream(this.r.readBytes(lengthBytes));
    }

    readStringStream(): string {
        let index = this.stringStream.readVarUint();
        assert(0 <= index && index < this.strings.length,
            `string stream index out of bounds: ${index} of ${this.strings.length}`);
        return this.strings[index];
    }

    decodeAbstractSyntax(): S.Program {
        // TODO(dpc): Memo table needs to keep reading from string stream.
        let memoTable: any[] = [];
        let decode = (): any => {
            let tag = this.r.readVarUint();
            if (tag === BuiltInTags.MEMO_REPLAY) {
                let i = this.r.readVarUint();
                assert(0 <= i && i < memoTable.length, '' + i);
                return memoTable[i];
            }
            if (tag === BuiltInTags.MEMO_RECORD) {
                let i = memoTable.length;
                memoTable.push('<<replayed evacuated thunk>>');
                let memento = decode();
                memoTable[i] = memento;
                return memento;
            }
            if (tag === BuiltInTags.NULL) {
                return null;
            }
            if (tag === BuiltInTags.UNDEFINED) {
                return undefined;
            }
            if (tag === BuiltInTags.TRUE) {
                return true;
            }
            if (tag === BuiltInTags.FALSE) {
                return false;
            }
            if (tag === BuiltInTags.NUMBER) {
                let array = this.r.readBytes(8);
                assert(array.byteLength == 8, `expected 8 bytes, but was ${array.byteLength}`);
                let floats = new Float64Array(array.buffer);
                return floats[0];
            }
            if (tag === BuiltInTags.STRING) {
                return this.readStringStream();
            }
            if (tag === BuiltInTags.LIST) {
                let n = this.r.readVarUint();
                let result = new Array(n);
                for (let i = 0; i < n; i++) {
                    result[i] = decode();
                }
                return result;
            }
            tag -= BuiltInTags.FIRST_GRAMMAR_NODE;
            let kind = this.grammar.nodeType(tag);
            let ctor = S[kind];
            let props = {};
            for (let property of this.grammar.rules.get(kind)) {
                props[property] = decode();
            }
            return new ctor(props);
        };
        let p = decode();
        assert(p instanceof S.Script || p instanceof S.Module,
            p.constructor.name);
        return p;
    }
}
