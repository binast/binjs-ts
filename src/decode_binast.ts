import * as assert from 'assert';
import { TextDecoder } from 'util';

import * as S from './schema';
import { ArrayStream, ReadStream, ReadStreamRecorder } from './io';
import { BuiltInGrammar, BuiltInTags } from './encode_binast';
import { Grammar } from './grammar';
import { MruDeltaReader } from './delta';
import { rewriteAst } from './ast_util';

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
        let key = (rule: string, child: number) => rule + '/' + child;

        // The table of children for nodes at a given level.
        let table = new Map<string, any[]>();

        // Reads a row of the table.
        let read_count = (rule: string, num_children: number) => {
            if (num_children === 0) {
                return;
            }
            let num_nodes = this.r.readVarUint();
            for (let i = 0; i < num_children; i++) {
                let data = [];
                for (let j = 0; j < num_nodes; j++) {
                    let value;
                    if (rule === BuiltInGrammar.NUMBER) {
                        let bytes = this.r.readBytes(8);
                        assert(bytes.byteLength == 8, `expected 8 bytes, but was ${bytes.byteLength}`);
                        let floats = new Float64Array(bytes.buffer);
                        value = floats[0];
                    } else {
                        value = this.r.readVarUint();
                    }
                    data.push(value);
                }
                table.set(key(rule, i), data);
            }
        };

        // Read the whole table.
        read_count(BuiltInGrammar.PROGRAM, 1);
        read_count(BuiltInGrammar.NUMBER, 1);
        read_count(BuiltInGrammar.CONS, 2);
        for (let [rule, body] of this.grammar.rules.entries()) {
            read_count(rule, body.length);
        }

        // Decode the program.
        let decode = (rule: string): any => {
            if (rule === BuiltInGrammar.NUMBER) {
                return table.get(key(rule, 0)).shift();
            }
            if (rule === BuiltInGrammar.CONS) {
                let result = [];
                let right;
                do {
                    result.push(decode_tag(table.get(key(rule, 0)).shift()));
                    right = table.get(key(rule, 1)).shift();
                } while (right === BuiltInTags.CONS);
                assert(right === BuiltInTags.NIL, 'list should end with nil');
                return result;
            }
            if (rule === BuiltInGrammar.PROGRAM) {
                return decode_tag(table.get(key(rule, 0)).shift());
            }
            let ctor = S[rule];
            let params = {};
            let i = 0;
            for (let property of this.grammar.rules.get(rule)) {
                params[property] = decode_tag(table.get(key(rule, i++)).shift());
            }
            return new ctor(params);
        };

        let decode_tag = (tag: number): any => {
            switch (tag) {
                case BuiltInTags.CONS:
                    return decode(BuiltInGrammar.CONS);
                case BuiltInTags.FALSE:
                    return false;
                case BuiltInTags.NIL:
                    return [];
                case BuiltInTags.NULL:
                    return null;
                case BuiltInTags.NUMBER:
                    return decode(BuiltInGrammar.NUMBER);
                case BuiltInTags.STRING:
                    return this.readStringStream();
                case BuiltInTags.TRUE:
                    return true;
                case BuiltInTags.UNDEFINED:
                    return undefined;
                default:
                    tag -= BuiltInTags.FIRST_GRAMMAR_NODE;
                    let kind = this.grammar.nodeType(tag);
                    return decode(kind);
            }
        };

        let program = decode(BuiltInGrammar.PROGRAM);
        assert(program instanceof S.Script || program instanceof S.Module,
            program.constructor.name);
        return program;
    }
}
